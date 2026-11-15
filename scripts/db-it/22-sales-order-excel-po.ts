/**
 * 수주 엑셀 업로드 + 거래처 발주번호 — 실제 DB·실제 서버 액션 검증(격리 테스트 DB 전용, lib.ts 가드 적용).
 *  P1  발주번호 저장·재조회(앞자리 0 보존) · 수정 · 미전달 시 유지 · 빈 값으로 삭제 · 발주번호 중복 조회
 *  P2  단일 수주 엑셀 등록(확정 상태, SO-YYYY-NNN, 감사로그 출처)
 *  P3  여러 수주 일괄 등록 + 한 수주 여러 품목 + 총금액 단가 계산 저장
 *  P4  같은 발주번호 중복 의심 → 확인 전 차단, 확인 후 등록, 기존 수주 불변
 *  P5  다른 발주번호의 반복 수주 허용
 *  P6  발주번호 없는 수주 등록 + 내용 일치 안내(확인 후 등록)
 *  P7  등록 도중 오류 → 전체 롤백(부분 저장 없음)
 *  P8  같은 파일 재업로드 방지 + 동시 이중 업로드 직렬화
 *  P9  기존 수주 등록·수정 기능 회귀
 * 모든 데이터는 ZT6 접두어 + 실행마다 새 스탬프. 이 스크립트는 SalesOrder 행을 삭제하지 않는다(트리거는 끝에 제거).
 */
import { assertTarget, check, info, loginAs, preflight, prisma, summary, TENANT_ID } from "./lib"

const mod = {
  so: () => require("../../src/lib/actions/sales-order.actions") as typeof import("../../src/lib/actions/sales-order.actions"),
  ex: () => require("../../src/lib/actions/sales-order-excel.actions") as typeof import("../../src/lib/actions/sales-order-excel.actions"),
  lib: () => require("../../src/lib/sales-order-excel") as typeof import("../../src/lib/sales-order-excel"),
}

async function main() {
  assertTarget()
  await preflight("수주 엑셀 + 발주번호(22)")
  const stamp = Date.now().toString(36).toUpperCase()
  const site = await prisma.site.findFirstOrThrow({ where: { tenantId: TENANT_ID }, orderBy: { createdAt: "asc" } })

  // 테스트 사용자(OPERATOR) — 비밀번호 로그인 없음
  const email = `zt6-operator-${stamp.toLowerCase()}@zt6.test.invalid`
  const profile = await prisma.profile.create({ data: { email, name: "ZT6 OPERATOR" } })
  await prisma.userCredential.create({ data: { tenantId: TENANT_ID, loginId: `zt6-op-${stamp.toLowerCase()}`, profileId: profile.id, passwordHash: "!zt6-no-password-login", mustChangePw: false } })
  await prisma.tenantUser.create({ data: { tenantId: TENANT_ID, profileId: profile.id, role: "OPERATOR", siteId: site.id, isActive: true } })
  loginAs({ profileId: profile.id, loginId: `zt6-op-${stamp.toLowerCase()}`, name: "ZT6 OPERATOR", email, role: "OPERATOR" })

  const custA = await prisma.businessPartner.create({ data: { tenantId: TENANT_ID, code: `ZT6-CA-${stamp}`, name: "ZT6 고객 A", partnerType: "CUSTOMER" } })
  const custB = await prisma.businessPartner.create({ data: { tenantId: TENANT_ID, code: `ZT6-CB-${stamp}`, name: "ZT6 고객 B", partnerType: "CUSTOMER" } })
  const mkItem = (n: number) =>
    prisma.item.create({ data: { tenantId: TENANT_ID, code: `ZT6-FG${n}-${stamp}`, name: `ZT6 완제품 ${n}`, itemType: "FINISHED", uom: "EA", isLotTracked: false, status: "ACTIVE" } })
  const [it1, it2, it3] = [await mkItem(1), await mkItem(2), await mkItem(3)]
  const custIds = [custA.id, custB.id]
  const countOrders = () => prisma.salesOrder.count({ where: { tenantId: TENANT_ID, customerId: { in: custIds } } })

  const { SALES_ORDER_EXCEL_COLUMNS: COL } = mod.lib()
  const headers = Object.values(COL) as string[]
  let rn = 3
  const R = (g: string, cust: string, item: string, qty: unknown, extra: Record<string, unknown> = {}) => ({
    rowNum: rn++,
    cells: { [COL.groupId]: g, [COL.customerCode]: cust, [COL.orderDate]: "2026-11-13", [COL.deliveryDate]: "2026-12-05", [COL.itemCode]: item, [COL.qty]: qty, ...extra },
  })
  const file = (...rows: ReturnType<typeof R>[]) => ({ headers, rows })
  const PO = (v: string) => ({ [COL.customerPoNo]: v })
  const validate = (f: ReturnType<typeof file>, confirmed: string[] = []) => mod.ex().validateSalesOrderExcelRows(f, confirmed)
  const run = (f: ReturnType<typeof file>, confirmed: string[] = []) => mod.ex().importSalesOrderExcelRows(f, site.id, confirmed)
  const byPo = (po: string) => prisma.salesOrder.findMany({ where: { tenantId: TENANT_ID, customerPoNo: po }, include: { items: true } })

  // ── P1 발주번호 저장·재조회·수정 ──────────────────────────────────────────────
  const created = await mod.so().createSalesOrder(TENANT_ID, site.id, {
    customerId: custA.id, orderDate: new Date("2026-11-13"), deliveryDate: new Date("2026-12-05"), customerPoNo: "  000123  ",
    items: [{ itemId: it1.id, qty: 5, unitPrice: 1000 }],
  })
  const reread = await prisma.salesOrder.findUniqueOrThrow({ where: { id: created.id } })
  check("P1a", reread.customerPoNo === "000123", "발주번호 저장·재조회: 앞자리 0 보존 + 앞뒤 공백 제거", reread.customerPoNo)
  check("P1b", /^SO-\d{4}-\d{3,}$/.test(reread.orderNo) && reread.status === "CONFIRMED", "MES 수주번호 자동 채번 규칙 유지 + 확정 상태", { orderNo: reread.orderNo, status: reread.status })
  const listRow = (await mod.so().getSalesOrders(TENANT_ID)).find((o) => o.id === created.id)
  check("P1c", listRow?.customerPoNo === "000123", "수주 목록 조회(getSalesOrders)에 발주번호 포함", listRow?.customerPoNo)
  const u1 = await mod.so().updateSalesOrder(created.id, { customerPoNo: "A-0045" })
  check("P1d", u1.ok && (await prisma.salesOrder.findUniqueOrThrow({ where: { id: created.id } })).customerPoNo === "A-0045", "수정 화면에서 발주번호 변경", u1)
  const u2 = await mod.so().updateSalesOrder(created.id, { note: "발주번호 미전달" })
  check("P1e", u2.ok && (await prisma.salesOrder.findUniqueOrThrow({ where: { id: created.id } })).customerPoNo === "A-0045", "발주번호를 보내지 않은 수정은 기존 값 유지", u2)
  const u3 = await mod.so().updateSalesOrder(created.id, { customerPoNo: "" })
  check("P1f", u3.ok && (await prisma.salesOrder.findUniqueOrThrow({ where: { id: created.id } })).customerPoNo === null, "빈 값으로 수정하면 발주번호 삭제(null)", u3)
  const dupSrc = await mod.so().createSalesOrder(TENANT_ID, site.id, {
    customerId: custA.id, orderDate: new Date("2026-11-13"), deliveryDate: new Date("2026-12-05"), customerPoNo: `PO-DUP-${stamp}`, items: [{ itemId: it1.id, qty: 1 }],
  })
  const f1 = await mod.so().findSalesOrderPoDuplicates(custA.id, `po-dup-${stamp.toLowerCase()}`)
  const f2 = await mod.so().findSalesOrderPoDuplicates(custA.id, `PO-DUP-${stamp}`, dupSrc.id)
  const f3 = await mod.so().findSalesOrderPoDuplicates(custB.id, `PO-DUP-${stamp}`)
  check("P1g", f1.length === 1 && f1[0].orderNo === dupSrc.orderNo && f2.length === 0 && f3.length === 0, "발주번호 중복 조회: 대소문자 무시·자기 자신 제외·다른 거래처 제외", { f1: f1.length, f2: f2.length, f3: f3.length })
  let tooLong = ""
  try {
    await mod.so().createSalesOrder(TENANT_ID, site.id, { customerId: custA.id, orderDate: new Date(), deliveryDate: new Date(), customerPoNo: "X".repeat(101), items: [{ itemId: it1.id, qty: 1 }] })
  } catch (e) { tooLong = e instanceof Error ? e.message : String(e) }
  check("P1h", /100자/.test(tooLong), "발주번호 101자는 서버가 거부", tooLong)

  // ── P2 단일 수주 ────────────────────────────────────────────────────────────
  const poSingle = `ZT6-0001-${stamp}`
  const before2 = await countOrders()
  const r2 = await run(file(R("S1", custA.code, it1.code, 10, { ...PO(poSingle), [COL.unitPrice]: 2500, [COL.note]: "엑셀 단일" })))
  const s2 = await byPo(poSingle)
  check("P2a", r2.success && s2.length === 1 && (await countOrders()) === before2 + 1, "단일 수주 엑셀 등록(1건 증가)", r2)
  check("P2b", s2[0]?.status === "CONFIRMED" && /^SO-\d{4}-\d{3,}$/.test(s2[0].orderNo) && s2[0].items.length === 1 && Number(s2[0].items[0].qty) === 10 && Number(s2[0].items[0].unitPrice) === 2500 && s2[0].note === "엑셀 단일", "확정 상태·자동 수주번호·품목·단가·비고 저장", s2[0] && { orderNo: s2[0].orderNo, status: s2[0].status })
  const aud = await prisma.auditLog.findMany({ where: { tenantId: TENANT_ID, entityType: "SalesOrder", entityId: s2[0]?.id ?? "" } })
  check("P2c", aud.length === 1 && JSON.stringify(aud[0]).includes("EXCEL_UPLOAD") && JSON.stringify(aud[0]).includes(poSingle), "감사로그 1건 · 출처 EXCEL_UPLOAD · 발주번호 기록")

  // ── P3 여러 수주 + 한 수주 여러 품목 + 총금액 단가 계산 ─────────────────────────
  const [poA, poB, poC] = [`ZT6-A-${stamp}`, `ZT6-B-${stamp}`, `ZT6-C-${stamp}`]
  const bulk = file(
    R("B1", custA.code, it1.code, 3, PO(poA)),
    R("B1", custA.code, it2.code, 4, PO(poA)),
    R("B1", custA.code, it3.code, 5, PO(poA)),
    R("B2", custB.code, it2.code, 6, { ...PO(poB), [COL.totalAmount]: 60000 }),
    R("B3", custB.code, it1.code, 2, { ...PO(poC), [COL.unitPrice]: 1000, [COL.totalAmount]: 6000 }),
    R("B3", custB.code, it3.code, 2, { ...PO(poC), [COL.totalAmount]: 6000 }),
  )
  const before3 = await countOrders()
  const pv3 = await validate(bulk)
  check("P3a", pv3.success && pv3.plan.canImport && pv3.plan.summary.orderCount === 3 && pv3.plan.summary.itemCount === 6 && pv3.plan.duplicates.length === 0, "미리보기: 수주 3건·품목 6개·오류/중복 없음", pv3.success && pv3.plan.summary)
  check("P3b", (await countOrders()) === before3, "미리보기는 DB를 변경하지 않음")
  const r3 = await run(bulk)
  const [oa, ob, oc] = [await byPo(poA), await byPo(poB), await byPo(poC)]
  check("P3c", r3.success && (await countOrders()) === before3 + 3 && oa.length === 1 && oa[0].items.length === 3, "여러 수주 일괄 등록(3건) + 한 수주 여러 품목(3개)", r3.success ? r3.created.map((c) => c.orderNo) : r3)
  const nums = r3.success ? r3.created.map((c) => c.orderNo) : []
  check("P3d", new Set(nums).size === 3 && nums.every((n) => /^SO-\d{4}-\d{3,}$/.test(n)), "수주번호 3건 모두 고유한 SO-YYYY-NNN", nums)
  check("P3e", Number(ob[0]?.items[0].unitPrice) === 10000 && Number(ob[0]?.totalAmount) === 60000, "단일 품목 총금액 60000 ÷ 6 = 단가 10000 저장", ob[0]?.items[0] && Number(ob[0].items[0].unitPrice))
  const p3 = oc[0]?.items.find((i) => i.itemId === it3.id)
  check("P3f", Number(p3?.unitPrice) === 2000, "다중 품목: 단가 빈 품목 하나는 잔여 금액(6000-2×1000)/2 = 2000", p3 && Number(p3.unitPrice))

  // ── P4 같은 발주번호 → 중복 의심, 확인 후 등록, 기존 수주 불변 ─────────────────
  const snapBefore = await prisma.salesOrder.findUniqueOrThrow({ where: { id: s2[0].id }, include: { items: true } })
  const dupFile = () => file(R("D1", custA.code, it2.code, 7, PO(poSingle.toLowerCase())))
  const pv4 = await validate(dupFile())
  check("P4a", pv4.success && pv4.plan.duplicates.length === 1 && pv4.plan.duplicates[0].basis === "PO_NO" && pv4.plan.duplicates[0].existing?.orderNo === s2[0].orderNo && !pv4.plan.canImport, "같은 거래처·같은 발주번호(대소문자 무시) → 중복 의심 + 기존 수주 정보(수주번호) 표시, 확인 전 등록 불가", pv4.success && pv4.plan.duplicates[0])
  const n4 = await countOrders()
  const r4a = await run(dupFile())
  check("P4b", !r4a.success && (await countOrders()) === n4, "확인하지 않으면 서버가 등록을 거부(변경 없음)", !r4a.success && r4a.error)
  const r4b = await run(dupFile(), ["D1"])
  check("P4c", r4b.success && (await countOrders()) === n4 + 1, "확인(분할 납품 등)한 수주는 등록됨", r4b)
  const snapAfter = await prisma.salesOrder.findUniqueOrThrow({ where: { id: s2[0].id }, include: { items: true } })
  check("P4d", snapAfter.updatedAt.getTime() === snapBefore.updatedAt.getTime() && snapAfter.items.length === snapBefore.items.length && Number(snapAfter.items[0].qty) === Number(snapBefore.items[0].qty) && snapAfter.customerPoNo === snapBefore.customerPoNo, "기존 수주는 수정·덮어쓰기 되지 않음")
  const confirmedAudit = await prisma.auditLog.findMany({ where: { tenantId: TENANT_ID, entityType: "SalesOrder", entityId: r4b.success ? (await prisma.salesOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, orderNo: r4b.created[0].orderNo } })).id : "" } })
  check("P4e", JSON.stringify(confirmedAudit).includes("\"duplicateConfirmed\":true"), "확인 후 등록한 수주는 감사로그에 duplicateConfirmed 기록")

  // ── P5 다른 발주번호의 반복 수주는 확인 없이 등록 ─────────────────────────────
  const repeat = file(R("RP", custA.code, it1.code, 10, { ...PO(`ZT6-REPEAT-${stamp}`), [COL.unitPrice]: 2500 }))
  const pv5 = await validate(repeat)
  check("P5a", pv5.success && pv5.plan.duplicates.length === 0 && pv5.plan.canImport, "내용(거래처·일자·품목·수량)이 기존과 같아도 발주번호가 다르면 중복 의심 없음", pv5.success && pv5.plan.duplicates.length)
  const r5 = await run(repeat)
  check("P5b", r5.success && (await byPo(`ZT6-REPEAT-${stamp}`)).length === 1, "반복 발주 등록됨", r5)

  // ── P6 발주번호 없는 수주 ────────────────────────────────────────────────────
  const noPo = () => file(R("N1", custB.code, it3.code, 9))
  const n6 = await countOrders()
  const r6 = await run(noPo())
  const created6 = r6.success ? await prisma.salesOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, orderNo: r6.created[0].orderNo } }) : null
  check("P6a", r6.success && created6?.customerPoNo === null && (await countOrders()) === n6 + 1, "발주번호 없는 수주 등록(null 저장)", r6)
  const pv6 = await validate(noPo())
  check("P6b", pv6.success && pv6.plan.duplicates.length === 1 && pv6.plan.duplicates[0].basis === "CONTENT" && !pv6.plan.canImport, "발주번호 없는 같은 내용 재업로드 → 내용 일치 중복 가능성 안내, 확인 전 등록 불가")
  const r6b = await run(noPo())
  check("P6c", !r6b.success && (await countOrders()) === n6 + 1, "확인 없이는 서버가 거부", !r6b.success && r6b.error)

  // ── P7 등록 도중 오류 → 전체 롤백 ────────────────────────────────────────────
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION zt6_fail_item() RETURNS trigger AS $$ BEGIN IF NEW.qty = 777.777 THEN RAISE EXCEPTION 'ZT6 forced failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER zt6_fail_item_trg BEFORE INSERT ON "SalesOrderItem" FOR EACH ROW EXECUTE FUNCTION zt6_fail_item()`)
  try {
    const poOk = `ZT6-RB-OK-${stamp}`
    const poFail = `ZT6-RB-FAIL-${stamp}`
    const rb = file(R("RB1", custA.code, it1.code, 1, PO(poOk)), R("RB2", custB.code, it2.code, 777.777, PO(poFail)))
    const before7 = await countOrders()
    const auditBefore = await prisma.auditLog.count({ where: { tenantId: TENANT_ID, entityType: "SalesOrder" } })
    const pv7 = await validate(rb)
    check("P7a", pv7.success && pv7.plan.canImport, "롤백 시나리오 파일은 검증은 통과(DB 단계에서만 실패)")
    const r7 = await run(rb)
    check("P7b", !r7.success, "두 번째 수주 저장 중 DB 오류 → 등록 실패 응답", !r7.success && r7.error)
    check("P7c", (await countOrders()) === before7 && (await byPo(poOk)).length === 0 && (await byPo(poFail)).length === 0, "첫 번째 수주도 저장되지 않음(전체 롤백)")
    check("P7d", (await prisma.auditLog.count({ where: { tenantId: TENANT_ID, entityType: "SalesOrder" } })) === auditBefore, "감사로그도 남지 않음")
    const r7b = await run(file(R("RB1", custA.code, it1.code, 1, PO(poOk))))
    check("P7e", r7b.success && (await byPo(poOk)).length === 1, "실패 후 정상 파일은 문제없이 등록(번호 채번 정상)", r7b)
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS zt6_fail_item_trg ON "SalesOrderItem"`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS zt6_fail_item()`)
  }

  // ── P8 같은 파일 재업로드 / 동시 이중 업로드 ──────────────────────────────────
  const n8 = await countOrders()
  const pv8 = await validate(bulk)
  check("P8a", pv8.success && pv8.plan.duplicates.length === 3 && pv8.plan.duplicates.every((d) => d.basis === "PO_NO" && d.existing) && !pv8.plan.canImport, "P3 파일을 그대로 다시 올리면 3건 모두 중복 의심(기존 수주 표시)·등록 불가")
  const r8 = await run(bulk)
  check("P8b", !r8.success && (await countOrders()) === n8, "재업로드는 확인 없이 등록되지 않음(수주 수 불변)", !r8.success && r8.error)
  const raceFile = () => file(R("RC", custA.code, it2.code, 1, PO(`ZT6-RACE-${stamp}`)))
  const [x, y] = await Promise.all([run(raceFile()), run(raceFile())])
  const raceOrders = await byPo(`ZT6-RACE-${stamp}`)
  check("P8c", [x, y].filter((r) => r.success).length === 1 && raceOrders.length === 1, "같은 파일 동시 이중 업로드: 1건만 등록(테넌트 잠금으로 직렬화)", { x: x.success, y: y.success, n: raceOrders.length })

  // ── P9 기존 수주 등록·수정 회귀 ───────────────────────────────────────────────
  const plain = await mod.so().createSalesOrder(TENANT_ID, site.id, {
    customerId: custB.id, orderDate: new Date("2026-11-13"), deliveryDate: new Date("2026-12-10"), totalAmount: 5000,
    items: [{ itemId: it1.id, qty: 2, unitPrice: 2500 }],
  })
  const plainRow = await prisma.salesOrder.findUniqueOrThrow({ where: { id: plain.id }, include: { items: true } })
  check("P9a", plainRow.customerPoNo === null && plainRow.status === "CONFIRMED" && Number(plainRow.totalAmount) === 5000 && Number(plainRow.items[0].unitPrice) === 2500, "발주번호 없이 기존 방식 등록: null · 확정 · 총금액/단가 유지")
  const up = await mod.so().updateSalesOrder(plain.id, { note: "수정 확인", deliveryDate: new Date("2026-12-20"), items: [{ itemId: it1.id, qty: 3, unitPrice: 2500 }] })
  const upRow = await prisma.salesOrder.findUniqueOrThrow({ where: { id: plain.id }, include: { items: true } })
  check("P9b", up.ok && upRow.note === "수정 확인" && Number(upRow.items[0].qty) === 3 && upRow.customerPoNo === null, "기존 수정(비고·납기·수량) 정상, 발주번호는 그대로 null", up)
  const cancel = await mod.so().updateSalesOrder(plain.id, { status: "CANCELLED" })
  check("P9c", cancel.ok && (await prisma.salesOrder.findUniqueOrThrow({ where: { id: plain.id } })).status === "CANCELLED", "상태 변경(취소) 정상", cancel)
  const afterCancel = await validate(file(R("CX", custB.code, it1.code, 3, { [COL.deliveryDate]: "2026-12-20", [COL.unitPrice]: 2500 })))
  info("P9d", "취소된 수주는 중복 비교에서 제외 → 확인 없이 등록 가능")
  check("P9d", afterCancel.success && afterCancel.plan.duplicates.length === 0, "취소된 기존 수주와 같은 내용은 중복 의심이 아님", afterCancel.success && afterCancel.plan.duplicates.length)

  summary("수주 엑셀 + 발주번호(22)")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error("FAILED:", e instanceof Error ? e.stack : e)
  try { await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS zt6_fail_item_trg ON "SalesOrderItem"`) } catch {}
  process.exit(1)
})
