/**
 * 2-C 생산계획 상태 전이·수정 보호 서버 검증 (서버 액션 실호출 + DB 직접 대조, 로컬 테스트 DB 전용)
 *  정책: 사용자가 직접 지정할 수 있는 상태는 초안·확정뿐. 진행중·완료는 작업지시·POP 실적이 자동으로 바꾼다(기존 자동 로직 유지).
 *  작업지시가 있는 줄의 생산 유형·충당은 바꿀 수 없고, 수주 연결 줄·작업지시 연결 줄은 수정으로 삭제할 수 없다.
 */
import { test, expect } from "@playwright/test"
import { assertSafeE2eEnvironment, adminCredentials, developerCredentials } from "./guard"
import { apiLogin } from "./support/perm-lib"
import { loadData, logDetail, db, closeDb, num, call, findAction, warm, rid, iso, addDays, counts, diffCounts } from "./support/o2s-lib"

assertSafeE2eEnvironment()
const D = loadData()
const T = D.tenantId
let admin = ""
const A = (n: string, re: RegExp) => findAction(n, re)
const note = (id: string, o: Record<string, unknown>) => logDetail({ id, ...o })
const ok = (r: { ok: boolean; value: any }) => r.ok && r.value?.ok !== false && r.value?.success !== false
const errOf = (r: { value: any; error: string | null }) => String(r.value?.error ?? r.error ?? "")
const RUN = Date.now().toString(36).toUpperCase()
let seq = 0

test.beforeAll(async () => {
  const a = adminCredentials(), d = developerCredentials()
  admin = (await apiLogin(a.loginId, a.password)).cookie ?? ""
  const dev = (await apiLogin(d.loginId, d.password)).cookie ?? ""
  await warm(dev, ["/app/mes/sales-orders", "/app/mes/production-plan", "/app/mes/material-issue", "/app/mes/work-orders", "/app/mes/inspection-stages", "/app/mes/final-inspection", "/app/mes/finished-goods-receipt", "/app/mes/shipments", "/pop/work-select", "/login"])
})
test.afterAll(async () => { await closeDb() })

async function mkSo(qty: number, status: "CONFIRMED" | "DRAFT" = "CONFIRMED") {
  const r = await call(admin, A("createSalesOrder", /sales-order\.actions/), [T, D.site.id, { customerId: D.customer.id, orderDate: iso(new Date()), deliveryDate: iso(addDays(10)), status, items: [{ itemId: D.items.fg.id, qty, unitPrice: 1, deliveryDate: iso(addDays(10)) }] }])
  expect(r.ok, r.error ?? "").toBe(true)
  const so = await db().salesOrder.findFirstOrThrow({ where: { tenantId: T }, orderBy: { createdAt: "desc" }, include: { items: true } })
  return { id: so.id, no: so.orderNo, itemId: so.items[0].id }
}
type So = Awaited<ReturnType<typeof mkSo>>
const apiRequest = async (so: So, qty: number, over: { extraQty?: number; extraReason?: string } = {}) => {
  const r = await call(admin, A("requestProductionFromSalesOrder", /sales-order\.actions/), [so.id, [{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty, ...over }], T, D.site.id, rid("pc")])
  expect(ok(r), errOf(r)).toBe(true)
  return db().productionPlanItem.findFirstOrThrow({ where: { salesOrderItemId: so.itemId, plan: { planNo: r.value.planNo } }, include: { plan: true } })
}
const planOf = (id: string) => db().productionPlan.findUniqueOrThrow({ where: { id }, include: { items: true } })

/** 임의 상태·품목 목록으로 updatePlan 호출 */
async function rawUpdate(planId: string, over: { status?: string; items?: Record<string, unknown>[] }) {
  const p = await planOf(planId)
  const items = over.items ?? p.items.map((r) => ({ productionPlanItemId: r.id, itemId: r.itemId, bomId: r.bomId ?? D.bom.id, routingId: r.routingId ?? D.routing.id, plannedQty: num(r.plannedQty), ...(r.salesOrderItemId ? { salesOrderItemId: r.salesOrderItemId } : {}) }))
  return call(admin, A("updatePlan", /production-plan\.actions/), [planId, { siteId: p.siteId, planNo: p.planNo, planType: p.planType, startDate: "2026-11-02", endDate: "2026-11-30", status: over.status ?? p.status, note: p.note, items }])
}
async function createStockPlan(qty: number, status = "DRAFT", itemId = D.items.fg.id) {
  const tag = `E2E-PC stock ${RUN}-${++seq}`
  const r = await call(admin, A("createPlan", /production-plan\.actions/), [{ siteId: D.site.id, planNo: "", planType: "DAILY", startDate: "2026-11-02", endDate: "2026-11-30", status, note: tag, items: [{ itemId, bomId: itemId === D.items.fg.id ? D.bom.id : null, routingId: itemId === D.items.fg.id ? D.routing.id : null, plannedQty: qty }] }, T])
  return { r, find: () => db().productionPlan.findFirstOrThrow({ where: { tenantId: T, note: tag }, include: { items: true } }) }
}

// ── 작업지시 → POP 실적 → 입고 (QM 시험과 같은 실제 흐름). 단계별 계획 상태를 돌려준다 ──
async function seedRawStock(tag: string, qty1: number, qty2: number) {
  const mk = async (item: { id: string }, qty: number, label: string) => {
    const lot = await db().lot.create({ data: { tenantId: T, itemId: item.id, lotNo: `E2E-PC-${RUN}-${tag}-${label}`, status: "ACTIVE" } })
    await db().inventoryBalance.create({ data: { tenantId: T, siteId: D.site.id, itemId: item.id, lotId: lot.id, warehouseId: D.warehouses.raw.id, qtyOnHand: qty, qtyAvailable: qty, qtyHold: 0 } })
    await db().inventoryTransaction.create({ data: { tenantId: T, itemId: item.id, lotId: lot.id, toLocationId: D.warehouses.raw.id, txNo: `E2E-PC-${RUN}-${tag}-${label}-RCV`, txType: "RECEIPT", qty, refType: "E2E_FIXTURE", refId: lot.lotNo } })
    return lot
  }
  return { l1: await mk(D.items.rm1, qty1, "R1"), l2: await mk(D.items.rm2, qty2, "R2") }
}
async function createWo(rowId: string, qty: number, tag: string) {
  const MFG = `E2E-PC-${RUN}-${tag}`
  const woRes = await call(admin, A("createWorkOrder", /work-order\.actions/), [{
    siteId: D.site.id, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, orderNo: "", manufacturingNo: MFG, plannedQty: qty, status: "DRAFT", dueDate: iso(addDays(14)), productionPlanItemId: rowId,
    operations: [
      { routingOperationId: D.routing.ops[0], seq: 1, plannedQty: qty, equipmentId: D.equipments.eq1.id, assignments: [{ equipmentId: D.equipments.eq1.id, assignedQty: qty }] },
      { routingOperationId: D.routing.ops[1], seq: 2, plannedQty: qty },
    ],
  }, T])
  expect(woRes.value?.success, `작업지시 생성: ${errOf(woRes)}`).toBe(true)
  return db().workOrder.findFirstOrThrow({ where: { tenantId: T, manufacturingNo: MFG }, include: { operations: { orderBy: { seq: "asc" }, include: { assignments: true } } } })
}
async function runProduction(wo: Awaited<ReturnType<typeof createWo>>, qty: number, tag: string) {
  expect((await call(admin, A("releaseWorkOrder", /work-order\.actions/), [wo.id])).ok).toBe(true)
  const raw = await seedRawStock(tag, qty * 2, qty * 3)
  const iss = await call(admin, A("issueMaterialsForWorkOrder", /material-issue\.actions/), [{ workOrderId: wo.id, siteId: D.site.id, items: [
    { itemId: D.items.rm1.id, lots: [{ lotId: raw.l1.id, warehouseId: D.warehouses.raw.id, quantity: qty * 2 }], issueQty: qty * 2, requiredQty: qty * 2, reservationId: null },
    { itemId: D.items.rm2.id, lots: [{ lotId: raw.l2.id, warehouseId: D.warehouses.raw.id, quantity: qty * 3 }], issueQty: qty * 3, requiredQty: qty * 3, reservationId: null },
  ] }, T])
  expect(iss.value?.ok, `자재 출고: ${errOf(iss)}`).toBe(true)
  const pop = await call(null, A("popLogin", /pop\.actions/), [D.worker.pin, T])
  const m = /nmes-pop-worker-session=([^;]+)/.exec(pop.setCookie)
  const pc = `nmes-pop-worker-session=${m![1]}`
  const [op1, op2] = wo.operations
  const pp1 = { pagePath: `/pop/production/${op1.id}` }, pp2 = { pagePath: `/pop/production/${op2.id}` }
  expect((await call(pc, A("startOperation", /pop\.actions/), [op1.id, op1.assignments[0].id], pp1)).value?.success).toBe(true)
  expect((await call(pc, A("submitProductionResult", /pop\.actions/), [{ workOrderOperationId: op1.id, assignmentId: op1.assignments[0].id, goodQty: qty, defectQty: 0, reworkQty: 0 }], pp1)).value?.success).toBe(true)
  expect((await call(pc, A("startOperation", /pop\.actions/), [op2.id, null], pp2)).value?.success).toBe(true)
  expect((await call(pc, A("submitProductionResult", /pop\.actions/), [{ workOrderOperationId: op2.id, goodQty: qty, defectQty: 0, reworkQty: 0 }], pp2)).value?.success).toBe(true)
}

// ───────────────────────── PS-01 등록 상태 ─────────────────────────
test("[PS-01] 등록 — 새 생산계획은 초안·확정으로만 등록, 진행중·완료·취소 지정은 거부(DB 불변)", async () => {
  const before = await counts()
  for (const st of ["IN_PROGRESS", "COMPLETED", "CANCELLED"]) {
    const { r } = await createStockPlan(10, st)
    note("PS-01", { st, err: errOf(r) })
    expect(ok(r), `${st} 등록이 허용됨`).toBe(false)
    expect(errOf(r)).toMatch(st === "CANCELLED" ? /취소/ : /자동으로 바뀝니다/)
  }
  expect(diffCounts(before, await counts()), "거부된 등록은 DB 불변").toEqual([])
  for (const st of ["DRAFT", "CONFIRMED"]) {
    const { r, find } = await createStockPlan(10, st)
    expect(ok(r), errOf(r)).toBe(true)
    const p = await find()
    expect([p.status, p.items[0].productionKind, num(p.items[0].allocatedQty), p.items[0].salesOrderItemId]).toEqual([st, "STOCK", 0, null])
  }
})

// ───────────────────────── PS-02 수정 전이 ─────────────────────────
test("[PS-02] 수정 — 수동 전이는 초안↔확정만: 초안→진행중·완료·취소 거부, 초안→확정·확정→초안 허용, 작업지시가 있는 확정 계획은 초안 복귀 거부", async () => {
  const { r, find } = await createStockPlan(40)
  expect(ok(r)).toBe(true)
  const p = await find()
  const before = await counts()
  for (const st of ["IN_PROGRESS", "COMPLETED", "CANCELLED"]) {
    const u = await rawUpdate(p.id, { status: st })
    note("PS-02", { st, err: errOf(u) })
    expect(ok(u), `초안→${st} 가 허용됨`).toBe(false)
  }
  expect(errOf(await rawUpdate(p.id, { status: "COMPLETED" }))).toMatch(/직접 지정할 수 없습니다/)
  expect(diffCounts(before, await counts())).toEqual([])
  expect((await planOf(p.id)).status).toBe("DRAFT")
  expect(ok(await rawUpdate(p.id, { status: "CONFIRMED" }))).toBe(true)
  expect((await planOf(p.id)).status).toBe("CONFIRMED")
  expect(ok(await rawUpdate(p.id, { status: "DRAFT" })), "작업지시가 없으면 확정→초안").toBe(true)
  expect((await planOf(p.id)).status).toBe("DRAFT")
  expect(ok(await rawUpdate(p.id, { status: "CONFIRMED" }))).toBe(true)
  // 작업지시가 생기면 계획이 자동으로 진행중이 되어 수정 자체가 막힌다
  const wo = await createWo(p.items[0].id, 40, "PS02")
  expect((await planOf(p.id)).status, "작업지시 생성 → 자동 진행중").toBe("IN_PROGRESS")
  const locked = await rawUpdate(p.id, { status: "IN_PROGRESS" })
  expect(ok(locked), "진행중 계획 수정").toBe(false)
  expect(errOf(locked)).toMatch(/진행중.*수정할 수 없습니다/)
  expect(ok(await rawUpdate(p.id, { items: [{ productionPlanItemId: p.items[0].id, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, plannedQty: 99 }] })), "진행중 계획의 수량 변경").toBe(false)
  expect(num((await planOf(p.id)).items[0].plannedQty)).toBe(40)
  // 상태가 어긋난 데이터(확정인데 유효한 작업지시 있음)에서도 초안 복귀는 막힌다
  await db().productionPlan.update({ where: { id: p.id }, data: { status: "CONFIRMED" } })
  const back = await rawUpdate(p.id, { status: "DRAFT" })
  expect(ok(back)).toBe(false)
  expect(errOf(back)).toMatch(/작업지시가 있는/)
  expect((await planOf(p.id)).status).toBe("CONFIRMED")
  note("PS-02", { wo: wo.orderNo })
})

// ───────────────────────── PS-03 자동 상태 유지 ─────────────────────────
test("[PS-03] 기존 자동 상태 변경 유지 — 확정 → (작업지시 생성) 진행중 → (POP 실적·전 공정 완료) 완료, 입고까지 정상", async () => {
  const { r, find } = await createStockPlan(30, "CONFIRMED")
  expect(ok(r)).toBe(true)
  const p = await find()
  expect(p.status).toBe("CONFIRMED")
  const wo = await createWo(p.items[0].id, 30, "PS03")
  expect((await planOf(p.id)).status, "작업지시 생성").toBe("IN_PROGRESS")
  await runProduction(wo, 30, "PS03")
  expect((await db().workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status).toBe("COMPLETED")
  expect((await planOf(p.id)).status, "작업지시 완료 → 계획 완료(자동)").toBe("COMPLETED")
  // 완료 계획은 수정·재지정 불가
  expect(ok(await rawUpdate(p.id, { status: "CONFIRMED" })), "완료→확정 직접 변경").toBe(false)
  // 취소된 작업지시만 있으면 진행중이 되지 않는다(기존 동작)
  const p2 = await (await createStockPlan(20, "CONFIRMED")).find()
  expect((await planOf(p2.id)).status).toBe("CONFIRMED")
})

// ───────────────────────── PS-04 작업지시·수주 연결 줄 보호 ─────────────────────────
test("[PS-04] 줄 보호 — 작업지시가 있는 줄은 유형·충당 변경 불가와 작업지시 수량 미만 축소 불가, 수주 연결 줄·작업지시 연결 줄은 수정으로 삭제 불가", async () => {
  const so = await mkSo(100)
  const row = await apiRequest(so, 60, { extraQty: 10, extraReason: "줄 보호 시험" })
  expect([num(row.plannedQty), num(row.allocatedQty), row.productionKind]).toEqual([70, 60, "ORDER_EXTRA"])
  // (a) 수주 연결 줄 삭제 거부: 재고 줄과 함께 저장하면서 연결 줄을 빼 본다
  const a = await rawUpdate(row.planId, { items: [{ itemId: D.items.rm1.id, plannedQty: 5 }] })
  note("PS-04", { delete: errOf(a) })
  expect(ok(a), "수주 연결 줄 삭제").toBe(false)
  expect(errOf(a)).toMatch(/수주와 연결된 생산계획 품목은 삭제할 수 없습니다/)
  expect((await planOf(row.planId)).items.length).toBe(1)
  // 확정 → 작업지시 생성(계획은 자동 진행중) 뒤 상태를 확정으로 되돌린 데이터에서 줄 보호 확인
  expect(ok(await rawUpdate(row.planId, { status: "CONFIRMED" })), "확정").toBe(true)
  const wo = await createWo(row.id, 70, "PS04")
  await db().productionPlan.update({ where: { id: row.planId }, data: { status: "CONFIRMED" } })
  const line = (extra: Record<string, unknown>) => ({ productionPlanItemId: row.id, salesOrderItemId: so.itemId, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, ...extra })
  const b = await rawUpdate(row.planId, { items: [line({ plannedQty: 70, allocatedQty: 50, extraReason: "충당 변경" })] })
  expect(ok(b), "작업지시가 있는 줄의 충당 변경").toBe(false)
  expect(errOf(b)).toMatch(/작업지시가 생성된 생산계획 품목은 생산 유형과 수주 충당 수량을 변경할 수 없습니다/)
  const c = await rawUpdate(row.planId, { items: [line({ plannedQty: 65, allocatedQty: 60, extraReason: "축소" })] })
  expect(ok(c), "작업지시 수량(70) 미만으로 축소").toBe(false)
  expect(errOf(c)).toMatch(/작업지시 수량 합계\(70\) 이상/)
  const d = await rawUpdate(row.planId, { items: [line({ plannedQty: 80, allocatedQty: 60, extraReason: "여유 증가" })] })
  expect(ok(d), `유형 유지·수량 증가는 허용: ${errOf(d)}`).toBe(true)
  const after = (await planOf(row.planId)).items[0]
  expect([num(after.plannedQty), num(after.allocatedQty), after.productionKind]).toEqual([80, 60, "ORDER_EXTRA"])
  // (e) 작업지시 연결 줄 삭제 거부(재고 줄)
  const sp = await (await createStockPlan(25, "CONFIRMED")).find()
  await createWo(sp.items[0].id, 25, "PS04S")
  await db().productionPlan.update({ where: { id: sp.id }, data: { status: "CONFIRMED" } })
  const e = await rawUpdate(sp.id, { items: [{ itemId: D.items.rm1.id, plannedQty: 3 }] })
  expect(ok(e), "작업지시 연결 줄 삭제").toBe(false)
  expect(errOf(e)).toMatch(/작업지시가 연결된 생산계획 품목은 삭제할 수 없습니다/)
  expect(wo.orderNo).toBeTruthy()
})

// ───────────────────────── PS-06 요청 ID 태그 보존 ─────────────────────────
test("[PS-06] 비고 수정 — 생산계획 비고를 고쳐도 생산의뢰 요청 ID 태그는 보존되어 같은 요청 ID 재전송이 중복 계획을 만들지 않는다", async () => {
  const so = await mkSo(100)
  const requestId = rid("tag")
  const reqArgs = [so.id, [{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty: 40 }], T, D.site.id, requestId]
  const first = await call(admin, A("requestProductionFromSalesOrder", /sales-order\.actions/), reqArgs)
  expect(ok(first), errOf(first)).toBe(true)
  const row = await db().productionPlanItem.findFirstOrThrow({ where: { salesOrderItemId: so.itemId }, include: { plan: true } })
  expect(row.plan.note).toContain(`[pr:${requestId}:`)
  const p = await planOf(row.planId)
  const upd = await call(admin, A("updatePlan", /production-plan\.actions/), [row.planId, { siteId: p.siteId, planNo: p.planNo, planType: p.planType, startDate: "2026-11-02", endDate: "2026-11-30", status: p.status, note: "사용자가 고친 비고", items: [{ productionPlanItemId: row.id, salesOrderItemId: so.itemId, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, plannedQty: 40 }] }])
  expect(ok(upd), errOf(upd)).toBe(true)
  const after = await db().productionPlan.findUniqueOrThrow({ where: { id: row.planId } })
  expect(after.note).toContain("사용자가 고친 비고")
  expect(after.note, "요청 ID 태그 보존").toContain(`[pr:${requestId}:`)
  const replay = await call(admin, A("requestProductionFromSalesOrder", /sales-order\.actions/), reqArgs)
  expect(replay.value?.ok, errOf(replay)).toBe(true)
  expect(replay.value?.replayed, "같은 요청 ID 는 재전송으로 처리").toBe(true)
  expect((await db().productionPlanItem.findMany({ where: { salesOrderItemId: so.itemId } })).length, "계획은 1건").toBe(1)
})

// ───────────────────────── PS-05 수주·계획 상태 관계(현행 동작 기록) ─────────────────────────
test("[PS-05] 수주 상태와 생산계획 상태의 현행 관계 기록 — 생산의뢰 시 수주 생산중·계획 초안, 계획 확정·작업지시·실적 시작은 수주 상태를 바꾸지 않고, 계획 취소는 수주를 확정으로 되돌림, 초안 수주도 생산의뢰하면 생산중", async () => {
  const so = await mkSo(100)
  const row = await apiRequest(so, 100)
  const soStatus = async () => (await db().salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status
  const trace: Record<string, string> = { afterRequest: `${row.plan.status}/${await soStatus()}` }
  expect(trace.afterRequest).toBe("DRAFT/IN_PRODUCTION")
  expect(ok(await rawUpdate(row.planId, { status: "CONFIRMED" }))).toBe(true)
  trace.afterConfirm = `${(await planOf(row.planId)).status}/${await soStatus()}`
  const wo = await createWo(row.id, 100, "PS05")
  trace.afterWorkOrder = `${(await planOf(row.planId)).status}/${await soStatus()}`
  const raw = await seedRawStock("PS05", 200, 300)
  await call(admin, A("releaseWorkOrder", /work-order\.actions/), [wo.id])
  await call(admin, A("issueMaterialsForWorkOrder", /material-issue\.actions/), [{ workOrderId: wo.id, siteId: D.site.id, items: [
    { itemId: D.items.rm1.id, lots: [{ lotId: raw.l1.id, warehouseId: D.warehouses.raw.id, quantity: 200 }], issueQty: 200, requiredQty: 200, reservationId: null },
    { itemId: D.items.rm2.id, lots: [{ lotId: raw.l2.id, warehouseId: D.warehouses.raw.id, quantity: 300 }], issueQty: 300, requiredQty: 300, reservationId: null }] }, T])
  const pop = await call(null, A("popLogin", /pop\.actions/), [D.worker.pin, T])
  const pc = `nmes-pop-worker-session=${/nmes-pop-worker-session=([^;]+)/.exec(pop.setCookie)![1]}`
  const op1 = wo.operations[0]
  expect((await call(pc, A("startOperation", /pop\.actions/), [op1.id, op1.assignments[0].id], { pagePath: `/pop/production/${op1.id}` })).value?.success).toBe(true)
  trace.afterOperationStart = `${(await planOf(row.planId)).status}/${await soStatus()}`
  note("PS-05", { trace })
  expect(trace.afterConfirm).toBe("CONFIRMED/IN_PRODUCTION")
  expect(trace.afterWorkOrder).toBe("IN_PROGRESS/IN_PRODUCTION")
  expect(trace.afterOperationStart).toBe("IN_PROGRESS/IN_PRODUCTION")
  // 계획 취소(작업지시 없는 계획) → 수주는 확정으로 복귀
  const so2 = await mkSo(50)
  const r2 = await apiRequest(so2, 50)
  const cancel = await call(admin, A("cancelProductionPlan", /production-plan\.actions/), [r2.planId, "E2E-PC 취소"])
  expect(cancel.ok, cancel.error ?? "").toBe(true)
  expect((await db().salesOrder.findUniqueOrThrow({ where: { id: so2.id } })).status).toBe("CONFIRMED")
  // 초안 수주에 생산의뢰 → 확정을 거치지 않고 생산중
  const so3 = await mkSo(30, "DRAFT")
  await apiRequest(so3, 30)
  const s3 = (await db().salesOrder.findUniqueOrThrow({ where: { id: so3.id } })).status
  note("PS-05", { draftOrderAfterRequest: s3 })
  expect(s3).toBe("IN_PRODUCTION")
})
