/**
 * N-18 수주 상태 무결성 검증 (서버 액션 실호출 + DB 직접 대조, 로컬 테스트 DB 전용)
 * 정책: 수동 변경 — 초안→확정/취소, 확정→초안/취소, 생산중→취소(계획 모두 취소·작업지시·출하 없음), 출하완료→완료(전량 출하·열린 출하 없음),
 *       부분출하·완료·취소는 수동 변경 불가. 생산중·부분출하·출하완료는 시스템이 계산하며 수동 지정 불가.
 * 취소·초안 복귀는 활성 생산계획·작업지시·출하(예정/확정) 이력이 있으면 거부(연쇄 취소 없음). 취소·종결·미확정 수주의 출하 등록·확정 금지.
 * 선행: seed-o2s.ts. 수정 전에는 우회가 가능해 실패하고, 수정 후 통과해야 한다.
 */
import { test, expect } from "@playwright/test"
import { assertSafeE2eEnvironment, adminCredentials, developerCredentials } from "./guard"
import { apiLogin } from "./support/perm-lib"
import { loadData, logDetail, db, closeDb, num, call, findAction, warm, iso, addDays, rid, fingerprint, counts, diffCounts, legacyDraftSalesOrder } from "./support/o2s-lib"

assertSafeE2eEnvironment()
const D = loadData()
const T = D.tenantId
let admin = ""
const A = (n: string, re: RegExp) => findAction(n, re)
const note = (id: string, o: Record<string, unknown>) => logDetail({ id, ...o })
let seq = 0

test.beforeAll(async () => {
  const a = adminCredentials(), d = developerCredentials()
  admin = (await apiLogin(a.loginId, a.password)).cookie ?? ""
  const dev = (await apiLogin(d.loginId, d.password)).cookie ?? ""
  await warm(dev, ["/app/mes/sales-orders", "/app/mes/production-plan", "/app/mes/shipments", "/app/mes/work-orders"])
})
test.afterAll(async () => { await closeDb() })

async function mkSo(qty: number, status: "DRAFT" | "CONFIRMED" = "CONFIRMED") {
  if (status === "DRAFT") return legacyDraftSalesOrder(D, qty) // 서버는 항상 확정으로 등록하므로 초안은 과거 데이터로 심는다
  const r = await call(admin, A("createSalesOrder", /sales-order\.actions/), [T, D.site.id, { customerId: D.customer.id, orderDate: iso(new Date()), deliveryDate: iso(addDays(10)), status, items: [{ itemId: D.items.fg.id, qty, unitPrice: 1, deliveryDate: iso(addDays(10)) }] }])
  expect(r.ok, r.error ?? "").toBe(true)
  const so = await db().salesOrder.findFirstOrThrow({ where: { tenantId: T }, orderBy: { createdAt: "desc" }, include: { items: true } })
  return { id: so.id, no: so.orderNo, itemId: so.items[0].id }
}
type So = Awaited<ReturnType<typeof mkSo>>
const setStatus = (so: So, status: string, extra: Record<string, unknown> = {}) => call(admin, A("updateSalesOrder", /sales-order\.actions/), [so.id, { status, ...extra }])
const statusOf = async (so: So) => (await db().salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status
const errOf = (r: { value: any; error: string | null }) => String(r.value?.error ?? r.error ?? "")
const okOf = (r: { ok: boolean; value: any }) => r.ok && r.value?.ok !== false

async function request(so: So, qty: number) {
  const r = await call(admin, A("requestProductionFromSalesOrder", /sales-order\.actions/), [so.id, [{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty }], T, D.site.id, rid("pr")])
  expect(r.value?.ok, r.value?.error ?? "").toBe(true)
  const pi = await db().productionPlanItem.findFirstOrThrow({ where: { salesOrderItemId: so.itemId, plan: { planNo: r.value.planNo } }, include: { plan: true } })
  return { planId: pi.planId, itemRowId: pi.id, planNo: pi.plan.planNo }
}
async function fgStock(qty: number) {
  const lot = await db().lot.create({ data: { tenantId: T, itemId: D.items.fg.id, lotNo: `N18-${Date.now().toString(36)}-${++seq}`, status: "ACTIVE" } })
  await db().inventoryBalance.create({ data: { tenantId: T, siteId: D.site.id, itemId: D.items.fg.id, warehouseId: D.warehouses.fg.id, lotId: lot.id, qtyOnHand: qty, qtyAvailable: qty, qtyHold: 0 } })
  await db().inventoryTransaction.create({ data: { tenantId: T, itemId: D.items.fg.id, lotId: lot.id, toLocationId: D.warehouses.fg.id, txNo: `N18-RCV-${lot.lotNo}`, txType: "RECEIPT", qty, refType: "WORK_ORDER" } })
  return lot
}
const createShip = (so: So, lotId: string, qty: number) => call(admin, A("createShipment", /shipment\.actions/), [T, { salesOrderId: so.id, plannedDate: iso(addDays(1)), warehouseId: D.warehouses.fg.id, items: [{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty, lotId }] }])
const lastShipment = (so: So) => db().shipmentOrder.findFirstOrThrow({ where: { tenantId: T, salesOrderId: so.id }, orderBy: { createdAt: "desc" } })
const confirm = (id: string) => call(admin, A("confirmShipment", /shipment\.actions/), [id])
const lotOnHand = async (lotId: string) => num((await db().inventoryBalance.findFirstOrThrow({ where: { tenantId: T, lotId } })).qtyOnHand)
async function ledgerEqualsBalance() {
  const rows = await db().$queryRawUnsafe<{ id: string; ledger: string; bal: string }[]>(
    `select b.id, coalesce(sum(case when t."txType"='RECEIPT' then t.qty when t."txType" in ('ISSUE','SUPPLIER_RETURN') then -t.qty when t."txType"='RETURN' then t.qty else 0 end),0)::text ledger, b."qtyOnHand"::text bal
     from "InventoryBalance" b left join "InventoryTransaction" t on t."tenantId"=b."tenantId" and t."itemId"=b."itemId" and t."lotId" is not distinct from b."lotId"
     where b."tenantId"='${T}' group by b.id, b."qtyOnHand"`)
  return rows.filter((r) => Math.abs(Number(r.ledger) - Number(r.bal)) > 1e-9 || Number(r.bal) < 0).map((r) => r.id)
}

test("[N18-01] 초안 → 확정 정상 변경, 확정 → 초안(후속 이력 없음)·다시 확정", async () => {
  const so = await mkSo(10, "DRAFT")
  expect(okOf(await setStatus(so, "CONFIRMED")), "초안→확정").toBe(true)
  expect(await statusOf(so)).toBe("CONFIRMED")
  expect(okOf(await setStatus(so, "DRAFT")), "확정→초안(이력 없음)").toBe(true)
  expect(await statusOf(so)).toBe("DRAFT")
  expect(okOf(await setStatus(so, "CONFIRMED"))).toBe(true)
  expect(okOf(await setStatus(so, "CONFIRMED", { note: "같은 상태 유지 + 비고 수정" })), "같은 상태의 일반 수정은 허용").toBe(true)
})

test("[N18-02] 후속 이력 없는 수주 취소 — 초안/확정 모두 허용, 이후 상태 변경 불가(종결)", async () => {
  const a = await mkSo(10, "DRAFT"), b = await mkSo(10)
  expect(okOf(await setStatus(a, "CANCELLED"))).toBe(true)
  expect(okOf(await setStatus(b, "CANCELLED"))).toBe(true)
  expect([await statusOf(a), await statusOf(b)]).toEqual(["CANCELLED", "CANCELLED"])
  for (const target of ["CONFIRMED", "DRAFT", "CLOSED"]) {
    const r = await setStatus(b, target)
    expect(okOf(r), `취소 → ${target} 거부`).toBe(false)
    expect(errOf(r), "한글 안내").toMatch(/취소.*수주.*변경할 수 없습니다|수정할 수 없습니다/)
  }
  expect(await statusOf(b)).toBe("CANCELLED")
  expect(okOf(await call(admin, A("updateSalesOrder", /sales-order\.actions/), [b.id, { note: "종결 수주 수정 시도" }])), "종결 수주의 일반 수정도 거부").toBe(false)
})

test("[N18-03] 활성 생산계획이 있는 수주 취소/초안 복귀 거부 — 계획을 먼저 취소하면 허용(연쇄 취소 없음)", async () => {
  const so = await mkSo(100)
  const p = await request(so, 100)
  for (const target of ["CANCELLED", "DRAFT"]) {
    const r = await setStatus(so, target)
    note("N18-03", { target, err: errOf(r) })
    expect(okOf(r), `생산중 수주 → ${target} 거부`).toBe(false)
    if (target === "CANCELLED") {
      expect(errOf(r), "취소 거부 사유에 생산계획 번호 포함").toContain(p.planNo)
      expect(errOf(r)).toMatch(/생산계획/)
    } else {
      expect(errOf(r), "생산중 → 초안은 정책상 불가").toMatch(/변경할 수 없습니다/)
    }
  }
  expect(await statusOf(so), "상태 불변").toBe("IN_PRODUCTION")
  expect((await db().productionPlan.findUniqueOrThrow({ where: { id: p.planId } })).status, "계획은 연쇄 취소되지 않음(생산의뢰 계획은 등록 즉시 확정)").toBe("CONFIRMED")
  // 확정 상태인데 활성 계획이 있는 불일치 데이터(과거 우회로 생긴 것): 초안 복귀도 거부
  const so3 = await mkSo(20)
  const p3 = await request(so3, 20)
  await db().salesOrder.update({ where: { id: so3.id }, data: { status: "CONFIRMED" } })
  const toDraft = await setStatus(so3, "DRAFT")
  expect(okOf(toDraft), "확정 + 활성 계획 → 초안 거부").toBe(false)
  expect(errOf(toDraft)).toContain(p3.planNo)
  // 계획 취소 후에는 수주가 확정으로 돌아가고 취소 가능
  expect((await call(admin, A("cancelProductionPlan", /production-plan\.actions/), [p.planId, "N18 계획 취소"])).ok).toBe(true)
  expect(okOf(await setStatus(so, "CANCELLED")), "계획 모두 취소 후 수주 취소").toBe(true)
  // 생산중 상태에서 계획이 모두 취소된 경우(상태 불일치 보정): 생산중 → 취소 허용
  const so2 = await mkSo(50)
  const p2 = await request(so2, 50)
  expect((await call(admin, A("cancelProductionPlan", /production-plan\.actions/), [p2.planId, "N18 계획 취소 2"])).ok).toBe(true)
  await db().salesOrder.update({ where: { id: so2.id }, data: { status: "IN_PRODUCTION" } }) // 픽스처: 생산중 + 취소된 계획만 남은 상태
  expect(okOf(await setStatus(so2, "CANCELLED")), "생산중 + 활성 계획 없음 → 취소 허용").toBe(true)
})

test("[N18-04] 작업지시가 있는 수주 취소 거부", async () => {
  const so = await mkSo(100)
  const p = await request(so, 100)
  const plan = await db().productionPlan.findUniqueOrThrow({ where: { id: p.planId } })
  expect((await call(admin, A("updatePlan", /production-plan\.actions/), [p.planId, { siteId: D.site.id, planNo: plan.planNo, planType: plan.planType, startDate: "2026-11-02", endDate: "2026-11-30", status: "CONFIRMED", items: [{ productionPlanItemId: p.itemRowId, salesOrderItemId: so.itemId, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, plannedQty: 100 }] }])).ok).toBe(true)
  const wo = await call(admin, A("createWorkOrder", /work-order\.actions/), [{ siteId: D.site.id, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, orderNo: "", manufacturingNo: `E2E-OS-N18-${Date.now().toString(36)}`, plannedQty: 100, status: "DRAFT", dueDate: iso(addDays(10)), productionPlanItemId: p.itemRowId,
    operations: [{ routingOperationId: D.routing.ops[0], seq: 1, plannedQty: 100 }, { routingOperationId: D.routing.ops[1], seq: 2, plannedQty: 100 }] }, T])
  expect(wo.value?.success, wo.value?.error ?? "").toBe(true)
  const r = await setStatus(so, "CANCELLED")
  expect(okOf(r), "작업지시가 있는 수주 취소 거부").toBe(false)
  expect(errOf(r)).toMatch(/작업지시|생산계획/)
  expect(await statusOf(so)).toBe("IN_PRODUCTION")
  expect(await db().workOrder.count({ where: { tenantId: T, productionPlanItem: { salesOrderItemId: so.itemId } } }), "작업지시 보존").toBe(1)
})

test("[N18-05] 예정(PLANNED) 출하가 있는 수주 취소 거부 — 출하를 삭제하면 허용", async () => {
  const lot = await fgStock(100)
  const so = await mkSo(40)
  expect((await createShip(so, lot.id, 10)).ok).toBe(true)
  const sh = await lastShipment(so)
  const r = await setStatus(so, "CANCELLED")
  note("N18-05", { err: errOf(r) })
  expect(okOf(r), "예정 출하가 남은 수주 취소 거부").toBe(false)
  expect(errOf(r)).toContain(sh.shipmentNo)
  expect(await statusOf(so)).toBe("CONFIRMED")
  expect(await setStatus(so, "DRAFT").then(okOf), "예정 출하가 있으면 초안 복귀도 거부").toBe(false)
  expect((await call(admin, A("deleteShipment", /shipment\.actions/), [sh.id])).ok).toBe(true)
  expect(okOf(await setStatus(so, "CANCELLED")), "예정 출하 삭제 후 취소 허용").toBe(true)
})

test("[N18-06] 부분출하 수주 — 취소·초안·완료·확정 등 모든 수동 변경 거부, 일반 수정(비고)은 허용", async () => {
  const lot = await fgStock(100)
  const so = await mkSo(40)
  expect((await createShip(so, lot.id, 10)).ok).toBe(true)
  expect((await confirm((await lastShipment(so)).id)).ok).toBe(true)
  expect(await statusOf(so)).toBe("PARTIAL_SHIPPED")
  for (const target of ["CANCELLED", "DRAFT", "CONFIRMED", "CLOSED", "SHIPPED", "IN_PRODUCTION"]) {
    const r = await setStatus(so, target)
    expect(okOf(r), `부분출하 → ${target} 거부`).toBe(false)
    expect(errOf(r), "한글 안내").toMatch(/부분출하|직접|변경할 수 없습니다/)
  }
  expect(await statusOf(so)).toBe("PARTIAL_SHIPPED")
  expect(num((await db().salesOrderItem.findUniqueOrThrow({ where: { id: so.itemId } })).shippedQty), "출하수량 보존").toBe(10)
  expect(okOf(await call(admin, A("updateSalesOrder", /sales-order\.actions/), [so.id, { note: "비고만 수정" }])), "상태 변경 없는 일반 수정은 허용").toBe(true)
})

test("[N18-07] 취소 수주의 출하 등록 거부(데이터 미생성), 취소 수주에 남은 예정 출하의 확정 거부 — 재고·수불 불변", async () => {
  const lot = await fgStock(50)
  // (a) 출하 등록
  const a = await mkSo(20)
  expect(okOf(await setStatus(a, "CANCELLED"))).toBe(true)
  const fp0 = await fingerprint()
  const c = await createShip(a, lot.id, 5)
  note("N18-07", { createOnCancelled: c.ok ? "허용" : errOf(c) })
  expect(c.ok, "취소 수주 출하 등록 거부").toBe(false)
  expect(errOf(c)).toMatch(/취소|출하.*(등록|할 수 없)/)
  expect(await db().shipmentOrder.count({ where: { tenantId: T, salesOrderId: a.id } }), "출하 데이터 미생성").toBe(0)
  expect(await fingerprint(), "등록 거부 후 DB 불변").toBe(fp0)
  // (b) 이미 있던 예정 출하(상태가 사후에 취소로 바뀐 불일치 데이터)를 확정
  const b = await mkSo(20)
  expect((await createShip(b, lot.id, 5)).ok).toBe(true)
  const sh = await lastShipment(b)
  await db().salesOrder.update({ where: { id: b.id }, data: { status: "CANCELLED" } }) // 픽스처: 기존 우회로 생긴 불일치 데이터
  const stockBefore = await lotOnHand(lot.id)
  const fp1 = await fingerprint()
  const k = await confirm(sh.id)
  note("N18-07", { confirmOnCancelled: k.ok ? "허용" : errOf(k) })
  expect(k.ok, "취소 수주 출하 확정 거부").toBe(false)
  expect(errOf(k)).toMatch(/취소|출하.*(확정|할 수 없)/)
  expect((await db().shipmentOrder.findUniqueOrThrow({ where: { id: sh.id } })).status, "출하는 PLANNED 유지").toBe("PLANNED")
  expect(await lotOnHand(lot.id), "재고 불변").toBe(stockBefore)
  expect(await fingerprint(), "확정 거부 후 재고·수불·수주 출하수량 불변").toBe(fp1)
  expect(await db().inventoryTransaction.count({ where: { tenantId: T, refType: "SHIPMENT_ITEM", refId: (await db().shipmentItem.findFirstOrThrow({ where: { shipmentOrderId: sh.id } })).id } }), "수불 미생성").toBe(0)
  expect(await ledgerEqualsBalance()).toEqual([])
})

test("[N18-08] 파생 상태 수동 지정 거부 — 생산중·부분출하·출하완료(및 완료)를 직접 지정할 수 없고, 등록 시에도 초안·확정만 가능", async () => {
  const leaked: string[] = []
  for (const target of ["IN_PRODUCTION", "PARTIAL_SHIPPED", "SHIPPED", "CLOSED"]) {
    const so = await mkSo(10)
    const r = await setStatus(so, target)
    note("N18-08", { target, ok: okOf(r), err: errOf(r) })
    if (okOf(r)) leaked.push(target)
    else expect(errOf(r), "한글 안내").toMatch(/직접|변경할 수 없습니다/)
    expect(await statusOf(so), "상태 불변").toBe("CONFIRMED")
  }
  expect(leaked, `수동으로 지정된 상태: ${leaked.join(", ")}`).toEqual([])
  const before = await counts()
  const c = await call(admin, A("createSalesOrder", /sales-order\.actions/), [T, D.site.id, { customerId: D.customer.id, orderDate: iso(new Date()), deliveryDate: iso(addDays(10)), status: "SHIPPED", items: [{ itemId: D.items.fg.id, qty: 5, unitPrice: 1 }] }])
  expect(c.ok, "등록 시 출하완료 지정 거부").toBe(false)
  expect(diffCounts(before, await counts()), "DB 불변").toEqual([])
})

test("[N18-09] 출하완료 → 완료 — 전량 출하·열린 출하 없음일 때만 허용", async () => {
  const lot = await fgStock(100)
  const so = await mkSo(20)
  expect((await createShip(so, lot.id, 20)).ok).toBe(true)
  expect((await confirm((await lastShipment(so)).id)).ok).toBe(true)
  expect(await statusOf(so)).toBe("SHIPPED")
  expect(okOf(await setStatus(so, "CANCELLED")), "출하완료 → 취소 거부").toBe(false)
  expect(okOf(await setStatus(so, "CONFIRMED")), "출하완료 → 확정 거부").toBe(false)
  expect(okOf(await setStatus(so, "CLOSED")), "출하완료 → 완료").toBe(true)
  expect(await statusOf(so)).toBe("CLOSED")
  expect(okOf(await setStatus(so, "SHIPPED")), "완료 → 다른 상태 거부").toBe(false)
  // 조건 미충족(출하수량 부족) 이면 거부: 픽스처로 SHIPPED 표시된 미출하 수주
  const bad = await mkSo(20)
  await db().salesOrder.update({ where: { id: bad.id }, data: { status: "SHIPPED" } })
  const r = await setStatus(bad, "CLOSED")
  expect(okOf(r), "실제 출하 완료 조건 미충족 시 완료 거부").toBe(false)
  expect(errOf(r)).toMatch(/출하|전량/)
})

test("[N18-10] 동시성 — 수주 취소 ↔ 출하 등록(10회 반복): 취소와 출하가 동시에 남는 모순이 없어야 한다", async () => {
  const lot = await fgStock(1000)
  const results: string[] = []
  for (let i = 0; i < 10; i++) {
    const so = await mkSo(10)
    const [c, s] = await Promise.all([setStatus(so, "CANCELLED"), createShip(so, lot.id, 5)])
    const ships = await db().shipmentOrder.count({ where: { tenantId: T, salesOrderId: so.id } })
    const st = await statusOf(so)
    results.push(`cancel=${okOf(c) ? "ok" : "no"} ship=${s.ok ? "ok" : "no"} status=${st} shipments=${ships}`)
    // 정확히 한쪽만 성공: (취소 성공 ∧ 출하 0건) 또는 (취소 실패 ∧ 출하 1건 ∧ 상태 비취소)
    const consistent = (st === "CANCELLED" && ships === 0 && okOf(c) && !s.ok) || (st !== "CANCELLED" && ships === 1 && !okOf(c) && s.ok)
    expect(consistent, `모순된 결과: ${results[i]}`).toBe(true)
  }
  note("N18-10", { results })
})

test("[N18-11] 동시성 — 수주 취소 ↔ 출하 확정: 출하가 먼저면 취소 실패, 예정 출하가 남아 있으면 취소는 항상 실패하고 확정은 1회만 반영", async () => {
  const lot = await fgStock(100)
  const so = await mkSo(30)
  expect((await createShip(so, lot.id, 10)).ok).toBe(true)
  const sh = await lastShipment(so)
  const [c, k, k2] = await Promise.all([setStatus(so, "CANCELLED"), confirm(sh.id), confirm(sh.id)])
  note("N18-11", { cancel: okOf(c), confirm: [k.ok, k2.ok], status: await statusOf(so) })
  expect(okOf(c), "취소는 실패").toBe(false)
  expect([k.ok, k2.ok].filter(Boolean).length, "확정은 정확히 1회").toBe(1)
  expect(await statusOf(so)).toBe("PARTIAL_SHIPPED")
  expect(await lotOnHand(lot.id), "재고 100 − 10").toBe(90)
  expect(num((await db().salesOrderItem.findUniqueOrThrow({ where: { id: so.itemId } })).shippedQty), "출하수량 10").toBe(10)
  expect(await ledgerEqualsBalance()).toEqual([])
})

test("[N18-12] 정상 수주~출하 업무 유지 — 확정 → 부분출하(자동) → 출하완료(자동) → 완료, 재고 차감·멱등(재확정 거부) 정합", async () => {
  const lot = await fgStock(100)
  const so = await mkSo(30, "DRAFT")
  expect(okOf(await setStatus(so, "CONFIRMED"))).toBe(true)
  const p = await request(so, 30)
  expect(await statusOf(so), "생산의뢰 → 생산중(자동)").toBe("IN_PRODUCTION")
  expect((await call(admin, A("cancelProductionPlan", /production-plan\.actions/), [p.planId, "N18 정상 흐름"])).ok).toBe(true)
  expect(await statusOf(so), "계획 취소 → 확정 복귀(자동)").toBe("CONFIRMED")
  expect((await createShip(so, lot.id, 10)).ok).toBe(true)
  const s1 = await lastShipment(so)
  expect((await confirm(s1.id)).ok).toBe(true)
  expect(await statusOf(so), "일부 출하 → 부분출하(자동)").toBe("PARTIAL_SHIPPED")
  const again = await confirm(s1.id)
  expect(again.ok, "재확정 거부(멱등)").toBe(false)
  expect(await lotOnHand(lot.id), "재고 1회만 차감").toBe(90)
  expect((await createShip(so, lot.id, 20)).ok).toBe(true)
  expect((await confirm((await lastShipment(so)).id)).ok).toBe(true)
  expect(await statusOf(so), "전량 출하 → 출하완료(자동)").toBe("SHIPPED")
  expect(okOf(await setStatus(so, "CLOSED"))).toBe(true)
  expect(await lotOnHand(lot.id)).toBe(70)
  expect(await db().inventoryTransaction.count({ where: { tenantId: T, txType: "ISSUE", refType: "SHIPMENT_ITEM", lotId: lot.id } }), "출하 수불 2건").toBe(2)
  expect(await ledgerEqualsBalance(), "원장 합 = 잔고").toEqual([])
})
