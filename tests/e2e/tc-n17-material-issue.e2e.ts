/**
 * N-17 자재 과다출고·중복 요청 수정 검증 (서버 액션 실호출 + DB 직접 대조, 로컬 테스트 DB 전용)
 * 선행: seed-o2s.ts(품목·BOM(원자재1×2, 원자재2×3)·라우팅·POP 작업자). 작업지시 계획수량 20 → 필요량 원자재1 40 / 원자재2 60.
 * 모든 테스트에서 수불 원장(ISSUE−RETURN) · 재고 잔고 · 투입 LOT · 예약 누계를 DB 에서 직접 대조한다.
 */
import { test, expect } from "@playwright/test"
import { assertSafeE2eEnvironment, adminCredentials, developerCredentials } from "./guard"
import { apiLogin } from "./support/perm-lib"
import { loadData, logDetail, db, closeDb, num, call, findAction, warm, rid, iso, addDays, fingerprint } from "./support/o2s-lib"

assertSafeE2eEnvironment()
const D = loadData()
const T = D.tenantId
const RAW = D.warehouses.raw.id
let admin = "", pop = ""
let seq = 0
const A = (n: string, re: RegExp) => findAction(n, re)
const note = (id: string, o: Record<string, unknown>) => logDetail({ id, ...o })
const REQ = { rm1: 40, rm2: 60, plan: 20 } // 필요량(BOM×계획수량)

test.beforeAll(async () => {
  const a = adminCredentials(), d = developerCredentials()
  admin = (await apiLogin(a.loginId, a.password)).cookie ?? ""
  const dev = (await apiLogin(d.loginId, d.password)).cookie ?? ""
  await warm(dev, ["/app/mes/material-issue", "/app/mes/work-orders", "/pop/work-select", "/login"])
  const r = await call(null, A("popLogin", /pop\.actions/), [D.worker.pin, T])
  pop = /nmes-pop-worker-session=([^;]+)/.exec(r.setCookie)?.[1] ? `nmes-pop-worker-session=${/nmes-pop-worker-session=([^;]+)/.exec(r.setCookie)![1]}` : ""
})
test.afterAll(async () => { await closeDb() })

// ───────── 픽스처 ─────────
/** LOT + 재고 + 입고 수불(원장)을 DB 에 직접 만든다(원장 합 = 잔고 가 되도록). */
async function seedLot(itemId: string, lotNo: string, qty: number) {
  const lot = await db().lot.create({ data: { tenantId: T, itemId, lotNo, status: "ACTIVE" } })
  await db().inventoryBalance.create({ data: { tenantId: T, siteId: D.site.id, itemId, warehouseId: RAW, lotId: lot.id, qtyOnHand: qty, qtyAvailable: qty, qtyHold: 0 } })
  await db().inventoryTransaction.create({ data: { tenantId: T, itemId, lotId: lot.id, toLocationId: RAW, txNo: `N17-RCV-${lotNo}`, txType: "RECEIPT", qty, refType: "PURCHASE_ORDER", note: "N17 픽스처 입고" } })
  return lot.id
}
const lotTag = () => `N17-${Date.now().toString(36)}-${++seq}`

async function mkWo(tag: string, plannedQty = REQ.plan) {
  const r = await call(admin, A("createWorkOrder", /work-order\.actions/), [{
    siteId: D.site.id, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, orderNo: "", manufacturingNo: `E2E-OS-N17-${tag}`, plannedQty, status: "DRAFT", dueDate: iso(addDays(10)), productionPlanItemId: null,
    operations: [{ routingOperationId: D.routing.ops[0], seq: 1, plannedQty }, { routingOperationId: D.routing.ops[1], seq: 2, plannedQty }],
  }, T])
  expect(r.value?.success, `작업지시 생성: ${r.value?.error ?? r.error}`).toBe(true)
  const wo = await db().workOrder.findFirstOrThrow({ where: { tenantId: T, manufacturingNo: `E2E-OS-N17-${tag}` }, include: { operations: { orderBy: { seq: "asc" } } } })
  expect((await call(admin, A("releaseWorkOrder", /work-order\.actions/), [wo.id])).ok).toBe(true)
  return wo
}
type Line = { itemId: string; lots: { lotId: string; quantity: number }[] }
const issue = (woId: string, lines: Line[], requestId: string | undefined = rid("iss")) =>
  call(admin, A("issueMaterialsForWorkOrder", /material-issue\.actions/), [{
    workOrderId: woId, siteId: D.site.id, requestId,
    // 클라이언트가 보내는 requiredQty 는 서버가 신뢰하지 않는다 — 일부러 틀린 값(1)을 보낸다
    items: lines.map((l) => ({ itemId: l.itemId, lots: l.lots.map((x) => ({ lotId: x.lotId, warehouseId: RAW, quantity: x.quantity })), issueQty: l.lots.reduce((s, x) => s + x.quantity, 0), requiredQty: 1, reservationId: null })),
  }, T])

// ───────── DB 오라클 ─────────
async function oracle(woId: string, itemId: string) {
  const [tx, ml, res] = await Promise.all([
    db().inventoryTransaction.findMany({ where: { tenantId: T, refType: "WORK_ORDER", refId: woId, itemId } }),
    db().workOrderMaterialLot.findMany({ where: { tenantId: T, workOrderId: woId, materialItemId: itemId } }),
    db().materialReservation.findFirst({ where: { workOrderId: woId, itemId } }),
  ])
  const issued = tx.filter((t) => t.txType === "ISSUE").reduce((s, t) => s + num(t.qty), 0)
  const returned = tx.filter((t) => t.txType === "RETURN").reduce((s, t) => s + num(t.qty), 0)
  return { net: issued - returned, txCount: tx.length, mlSum: ml.reduce((s, m) => s + num(m.qty), 0), mlCount: ml.length, resIssued: res ? num(res.issuedQty) : null, resRequired: res ? num(res.requiredQty) : null, resStatus: res?.status ?? null }
}
const onHand = async (lotId: string) => num((await db().inventoryBalance.findFirstOrThrow({ where: { tenantId: T, lotId } })).qtyOnHand)
/** 모든 잔고에서 원장(RECEIPT−ISSUE) 합 = 잔고, 음수·가용 불일치 없음 */
async function ledgerEqualsBalance() {
  const rows = await db().$queryRawUnsafe<{ id: string; ledger: string; bal: string; avail: string; hold: string }[]>(
    `select b.id, coalesce(sum(case when t."txType"='RECEIPT' then t.qty when t."txType" in ('ISSUE','SUPPLIER_RETURN') then -t.qty when t."txType"='RETURN' then t.qty else 0 end),0)::text ledger, b."qtyOnHand"::text bal, b."qtyAvailable"::text avail, b."qtyHold"::text hold
     from "InventoryBalance" b left join "InventoryTransaction" t on t."tenantId"=b."tenantId" and t."itemId"=b."itemId" and t."lotId" is not distinct from b."lotId"
     where b."tenantId"='${T}' group by b.id, b."qtyOnHand", b."qtyAvailable", b."qtyHold"`)
  return rows.filter((r) => Math.abs(Number(r.ledger) - Number(r.bal)) > 1e-9 || Number(r.bal) < 0 || Math.abs(Number(r.avail) - (Number(r.bal) - Number(r.hold))) > 1e-9).map((r) => r.id)
}

// ───────── 1~4. 정상 → 부분 → 잔여 → 초과 ─────────
test("[N17-01] 정상 출고 — 필요량 전량(원자재1 40 / 원자재2 60) 출고, 원장·재고·투입 LOT·예약 일치", async () => {
  const tag = lotTag()
  const l1 = await seedLot(D.items.rm1.id, `${tag}-A1`, 100), l2 = await seedLot(D.items.rm2.id, `${tag}-A2`, 100)
  const wo = await mkWo(tag)
  const r = await issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 40 }] }, { itemId: D.items.rm2.id, lots: [{ lotId: l2, quantity: 60 }] }])
  expect(r.value?.ok, `출고: ${r.value?.error ?? r.error}`).toBe(true)
  const o1 = await oracle(wo.id, D.items.rm1.id), o2 = await oracle(wo.id, D.items.rm2.id)
  expect([o1.net, o1.mlSum, o1.resIssued, o1.resRequired, o1.resStatus]).toEqual([40, 40, 40, 40, "FULFILLED"])
  expect([o2.net, o2.mlSum, o2.resIssued, o2.resRequired, o2.resStatus]).toEqual([60, 60, 60, 60, "FULFILLED"])
  expect([await onHand(l1), await onHand(l2)], "재고 차감").toEqual([60, 40])
  expect(await db().wipUnit.count({ where: { tenantId: T, workOrderId: wo.id } }), "WIP 1건").toBe(1)
  expect(await ledgerEqualsBalance(), "원장 합 = 잔고").toEqual([])
})

test("[N17-02] 부분 출고 — 예약은 PARTIAL, 필요량은 클라이언트 값(1)이 아니라 서버 BOM 계산값(40)으로 저장", async () => {
  const tag = lotTag()
  const l1 = await seedLot(D.items.rm1.id, `${tag}-A1`, 100)
  const wo = await mkWo(tag)
  const r = await issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 10 }] }])
  expect(r.value?.ok, r.value?.error).toBe(true)
  const o = await oracle(wo.id, D.items.rm1.id)
  expect([o.net, o.mlSum, o.resIssued, o.resRequired, o.resStatus]).toEqual([10, 10, 10, 40, "PARTIAL"])
  expect(await onHand(l1)).toBe(90)
  expect(await ledgerEqualsBalance()).toEqual([])
})

test("[N17-03][N17-04] 잔여 수량만큼 추가 출고는 허용, 그 이상(+1)은 한글 오류로 거부되고 DB 불변", async () => {
  const tag = lotTag()
  const l1 = await seedLot(D.items.rm1.id, `${tag}-A1`, 100)
  const wo = await mkWo(tag)
  expect((await issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 10 }] }])).value?.ok).toBe(true)
  // 잔여 30 을 넘는 31 → 거부
  const fp0 = await fingerprint()
  const over = await issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 31 }] }])
  note("N17-03", { over: over.value })
  expect(over.value?.ok).toBe(false)
  expect(over.value?.error, "한글 오류에 필요량·기출고·잔량·요청량 표시").toMatch(/출고 수량 초과.*BOM 필요량 40.*이미 출고 10.*출고 가능 잔량 30.*이번 요청 31/)
  expect(await fingerprint(), "거부된 요청은 재고·수불·투입 LOT 를 바꾸지 않음").toBe(fp0)
  // 잔여 30 정확히 → 허용
  const exact = await issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 30 }] }])
  expect(exact.value?.ok, exact.value?.error).toBe(true)
  const o = await oracle(wo.id, D.items.rm1.id)
  expect([o.net, o.mlSum, o.resIssued, o.resStatus]).toEqual([40, 40, 40, "FULFILLED"])
  // 이미 전량 출고된 뒤 +1 → 거부(통합 테스트 O2S-B05 재현: 필요 40 전량 출고 후 10 추가가 허용되던 결함)
  const fp1 = await fingerprint()
  const extra = await issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 10 }] }])
  expect(extra.value?.ok, "필요량 전량 출고 후 추가 출고 거부").toBe(false)
  expect(extra.value?.error).toMatch(/출고 가능 잔량 0/)
  expect(await fingerprint()).toBe(fp1)
  expect([await onHand(l1)], "재고는 100−40").toEqual([60])
  expect(await ledgerEqualsBalance()).toEqual([])
})

// ───────── 5. 동일 요청 2회 ─────────
test("[N17-05] 동일 요청 2회 전송 — 재전송은 새 출고·재고 차감 없이 성공(replayed), 다른 내용/다른 작업지시의 같은 요청ID 는 거부", async () => {
  const tag = lotTag()
  const l1 = await seedLot(D.items.rm1.id, `${tag}-A1`, 100)
  const wo = await mkWo(tag), wo2 = await mkWo(tag + "b")
  const reqId = rid("same")
  const lines = [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 20 }] }]
  const a = await issue(wo.id, lines, reqId)
  expect(a.value?.ok, a.value?.error).toBe(true)
  const fp = await fingerprint()
  const b = await issue(wo.id, lines, reqId)
  expect([b.value?.ok, b.value?.replayed], "재전송은 성공 + replayed").toEqual([true, true])
  expect(await fingerprint(), "재전송은 DB 불변").toBe(fp)
  expect((await oracle(wo.id, D.items.rm1.id)).net, "출고 20 (이중 아님)").toBe(20)
  expect(await onHand(l1)).toBe(80)
  // 같은 요청ID + 다른 수량
  const diff = await issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 5 }] }], reqId)
  expect(diff.value?.ok).toBe(false)
  expect(diff.value?.error).toMatch(/같은 요청 ID/)
  // 같은 요청ID + 다른 작업지시
  const other = await issue(wo2.id, lines, reqId)
  expect(other.value?.ok, "다른 작업지시에 같은 요청ID 재사용 거부").toBe(false)
  expect(await fingerprint(), "거부는 DB 불변").toBe(fp)
  // 잘못된 요청ID 형식
  const bad = await issue(wo.id, lines, "short")
  expect(bad.value?.ok).toBe(false)
  expect(await ledgerEqualsBalance()).toEqual([])
})

// ───────── 6. 동시 10건 ─────────
test("[N17-06] 동시 출고 요청 10건 — (a) 서로 다른 요청ID 10×10 은 필요량 40 만큼(4건)만 반영, (b) 같은 요청ID 10건은 1회만 반영", async () => {
  const tag = lotTag()
  const l1 = await seedLot(D.items.rm1.id, `${tag}-A1`, 200)
  const wo = await mkWo(tag)
  const one = (qty: number, id: string) => issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: qty }] }], id)
  const results = await Promise.all(Array.from({ length: 10 }, () => one(10, rid("par"))))
  const okN = results.filter((r) => r.value?.ok === true).length
  note("N17-06", { ok: okN, errors: Array.from(new Set(results.filter((r) => !r.value?.ok).map((r) => r.value?.error))) })
  expect(okN, "성공은 정확히 4건(40/10)").toBe(4)
  expect(results.filter((r) => !r.value?.ok).every((r) => /출고 수량 초과/.test(String(r.value?.error))), "나머지 6건은 필요량 초과 안내로 거부").toBe(true)
  const o = await oracle(wo.id, D.items.rm1.id)
  expect([o.net, o.txCount, o.mlSum, o.mlCount, o.resIssued, o.resStatus], "원장 ISSUE 4건·누계 40").toEqual([40, 4, 40, 4, 40, "FULFILLED"])
  expect(await onHand(l1)).toBe(160)
  expect(await db().wipUnit.count({ where: { tenantId: T, workOrderId: wo.id } }), "WIP 중복 생성 없음").toBe(1)
  // (b) 같은 요청ID 동시 10건
  const wo2 = await mkWo(tag + "s")
  const same = rid("parsame")
  const ls = await Promise.all(Array.from({ length: 10 }, () => issue(wo2.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 10 }] }], same)))
  note("N17-06", { sameOk: ls.filter((r) => r.value?.ok).length, replayed: ls.filter((r) => r.value?.replayed).length, errs: Array.from(new Set(ls.filter((r) => !r.value?.ok).map((r) => r.value?.error))) })
  const o2 = await oracle(wo2.id, D.items.rm1.id)
  expect([o2.net, o2.txCount, o2.mlCount], "같은 요청ID 10건 → 출고 1회(10)").toEqual([10, 1, 1])
  expect(ls.every((r) => r.value?.ok === true), "모든 응답은 성공(1건 처리 + 9건 replay)").toBe(true)
  expect(await onHand(l1)).toBe(150)
  expect(await ledgerEqualsBalance()).toEqual([])
})

// ───────── 7. 서로 다른 LOT ─────────
test("[N17-07] 서로 다른 원자재 LOT 분할 출고 — LOT 별 차감·수불·투입 LOT·WIP 연결 일치", async () => {
  const tag = lotTag()
  const a1 = await seedLot(D.items.rm1.id, `${tag}-A1`, 30), b1 = await seedLot(D.items.rm1.id, `${tag}-B1`, 30)
  const a2 = await seedLot(D.items.rm2.id, `${tag}-A2`, 25), b2 = await seedLot(D.items.rm2.id, `${tag}-B2`, 50)
  const wo = await mkWo(tag)
  const r = await issue(wo.id, [
    { itemId: D.items.rm1.id, lots: [{ lotId: a1, quantity: 30 }, { lotId: b1, quantity: 10 }] },
    { itemId: D.items.rm2.id, lots: [{ lotId: a2, quantity: 25 }, { lotId: b2, quantity: 35 }] },
  ])
  expect(r.value?.ok, r.value?.error).toBe(true)
  expect([await onHand(a1), await onHand(b1), await onHand(a2), await onHand(b2)], "LOT 별 잔고").toEqual([0, 20, 0, 15])
  const tx = await db().inventoryTransaction.findMany({ where: { tenantId: T, refType: "WORK_ORDER", refId: wo.id }, orderBy: { txNo: "asc" } })
  expect(tx.map((t) => [t.lotId, num(t.qty)]).sort()).toEqual([[a1, 30], [b1, 10], [a2, 25], [b2, 35]].sort())
  expect(new Set(tx.map((t) => t.txNo)).size, "수불 거래번호 고유").toBe(4)
  const ml = await db().workOrderMaterialLot.findMany({ where: { tenantId: T, workOrderId: wo.id } })
  expect(ml.length).toBe(4)
  expect(ml.every((m) => tx.some((t) => t.id === m.inventoryTransactionId && num(t.qty) === num(m.qty))), "투입 LOT ↔ 수불 연결").toBe(true)
  const wip = await db().wipUnit.findFirstOrThrow({ where: { tenantId: T, workOrderId: wo.id } })
  expect(await db().wipUnitMaterialLot.count({ where: { wipUnitId: wip.id } }), "WIP ↔ 투입 LOT 4건").toBe(4)
  expect([(await oracle(wo.id, D.items.rm1.id)).net, (await oracle(wo.id, D.items.rm2.id)).net]).toEqual([40, 60])
  expect(await ledgerEqualsBalance()).toEqual([])
})

// ───────── 8~9. 재고 부족 / 실패 롤백 ─────────
test("[N17-08] 재고 부족 — 필요량 이내여도 가용재고를 넘으면 거부되고 DB 불변", async () => {
  const tag = lotTag()
  const l1 = await seedLot(D.items.rm1.id, `${tag}-A1`, 5)
  const wo = await mkWo(tag)
  const fp = await fingerprint()
  const r = await issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 10 }] }])
  expect(r.value?.ok).toBe(false)
  expect(r.value?.error).toMatch(/가용재고 부족/)
  expect(await fingerprint()).toBe(fp)
  expect(await onHand(l1)).toBe(5)
  // 재고 5 만큼은 출고 가능(필요량 40 이내)
  const ok5 = await issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 5 }] }])
  expect(ok5.value?.ok, ok5.value?.error).toBe(true)
  expect(await onHand(l1)).toBe(0)
  expect(await ledgerEqualsBalance()).toEqual([])
})

test("[N17-09] 출고 실패 시 전체 롤백 — 한 품목이 필요량 초과/재고 부족이면 같은 요청의 다른 품목도 재고·수불·투입 LOT·WIP·예약이 반영되지 않는다", async () => {
  const tag = lotTag()
  const l1 = await seedLot(D.items.rm1.id, `${tag}-A1`, 100), l2 = await seedLot(D.items.rm2.id, `${tag}-A2`, 100)
  const wo = await mkWo(tag)
  const reqId = rid("rb")
  for (const [label, bad] of [["필요량 초과(원자재2 61)", 61], ["재고 부족(원자재2 LOT 재고 초과)", -1]] as const) {
    const lotForRm2 = bad === -1 ? await seedLot(D.items.rm2.id, `${tag}-LOW`, 3) : l2
    const fp = await fingerprint()
    const r = await issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 20 }] }, { itemId: D.items.rm2.id, lots: [{ lotId: lotForRm2, quantity: bad === -1 ? 10 : bad }] }], reqId)
    note("N17-09", { label, err: r.value?.error })
    expect(r.value?.ok, label).toBe(false)
    const fpAfter = await fingerprint()
    // 새로 만든 픽스처(LOT)는 카운트에 포함되므로 거부 전후 지문이 같아야 한다(픽스처는 fp 이전에 생성)
    expect(fpAfter, `${label}: 거부 후 DB 불변`).toBe(fp)
    expect(await onHand(l1), "첫 품목 재고 미차감").toBe(100)
    expect((await oracle(wo.id, D.items.rm1.id)).txCount, "수불 없음").toBe(0)
    expect(await db().wipUnit.count({ where: { tenantId: T, workOrderId: wo.id } }), "WIP 미생성").toBe(0)
    expect(await db().materialReservation.count({ where: { workOrderId: wo.id } }), "예약 미생성").toBe(0)
  }
  // 실패한 요청은 요청ID 를 점유하지 않는다: 같은 ID 로 고친 내용을 다시 보내면 처리된다
  const retry = await issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 20 }] }, { itemId: D.items.rm2.id, lots: [{ lotId: l2, quantity: 30 }] }], reqId)
  expect(retry.value?.ok, retry.value?.error).toBe(true)
  expect([(await oracle(wo.id, D.items.rm1.id)).net, (await oracle(wo.id, D.items.rm2.id)).net]).toEqual([20, 30])
  expect(await ledgerEqualsBalance()).toEqual([])
})

// ───────── 10. 자재출고 ↔ POP 실적 정합 ─────────
test("[N17-10] 자재출고와 POP 실적의 수량 정합 — 출고분 기준 생산가능량(floor(출고/단위소요))만 실적 등록, 초과 출고가 없으므로 생산가능량이 계획을 넘지 않는다", async () => {
  expect(pop, "POP 로그인").not.toBe("")
  const tag = lotTag()
  const l1 = await seedLot(D.items.rm1.id, `${tag}-A1`, 200), l2 = await seedLot(D.items.rm2.id, `${tag}-A2`, 300)
  const wo = await mkWo(tag)
  const op1 = wo.operations[0].id
  const pp = { pagePath: `/pop/production/${op1}` }
  // 절반 출고(원자재1 20 / 원자재2 30) → 생산가능 10
  expect((await issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 20 }] }, { itemId: D.items.rm2.id, lots: [{ lotId: l2, quantity: 30 }] }])).value?.ok).toBe(true)
  expect((await call(pop, A("startOperation", /pop\.actions/), [op1, null], pp)).value?.success).toBe(true)
  const sub = (good: number) => call(pop, A("submitProductionResult", /pop\.actions/), [{ workOrderOperationId: op1, goodQty: good, defectQty: 0, reworkQty: 0 }], pp)
  const over = await sub(11)
  expect(over.value?.success, `출고분(10개분) 초과 실적 거부: ${over.value?.error}`).toBe(false)
  expect(over.value?.error).toMatch(/최대 10/)
  expect((await sub(10)).value?.success).toBe(true)
  // 남은 출고(원자재1 20 / 원자재2 30) → 추가 출고 허용(필요량 이내) 후 나머지 10개 생산
  expect((await issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 20 }] }, { itemId: D.items.rm2.id, lots: [{ lotId: l2, quantity: 30 }] }])).value?.ok).toBe(true)
  const more = await issue(wo.id, [{ itemId: D.items.rm1.id, lots: [{ lotId: l1, quantity: 1 }] }])
  expect(more.value?.ok, "필요량 초과 출고 거부 — 생산가능량이 계획수량을 넘어서지 않음").toBe(false)
  expect((await sub(11)).value?.success, "계획(20) 초과 실적 거부").toBe(false)
  expect((await sub(10)).value?.success).toBe(true)
  const op = await db().workOrderOperation.findUniqueOrThrow({ where: { id: op1 } })
  const prod = await db().productionResult.aggregate({ where: { workOrderOperationId: op1 }, _sum: { goodQty: true } })
  expect([op.status, num(op.completedQty), num(prod._sum.goodQty)], "1공정 완료·실적 합계 20").toEqual(["COMPLETED", 20, 20])
  const o1 = await oracle(wo.id, D.items.rm1.id), o2 = await oracle(wo.id, D.items.rm2.id)
  expect([o1.net, o2.net, o1.mlSum, o2.mlSum], "출고 합계 = 필요량 = 투입 LOT 합계").toEqual([REQ.rm1, REQ.rm2, REQ.rm1, REQ.rm2])
  expect(num(prod._sum.goodQty) * 2, "실적 20 × 단위소요 2 = 원자재1 출고 40").toBe(o1.net)
  expect(num(prod._sum.goodQty) * 3, "실적 20 × 단위소요 3 = 원자재2 출고 60").toBe(o2.net)
  expect(await ledgerEqualsBalance()).toEqual([])
})
