/**
 * 수주·생산계획 자동 확정(초안 단계 제거) 서버 검증 (서버 액션 실호출 + DB 직접 대조, 로컬 테스트 DB 전용)
 *  정책: 앞으로 만드는 수주(수주 등록)와 생산계획(수주 생산의뢰·수주+여유 생산의뢰·재고 생산계획)은 등록 즉시 CONFIRMED.
 *        기존 DRAFT 데이터는 일괄 변경하지 않고 조회·개별 확정 경로를 유지한다. 승인 상태·LOT·재고·수불은 건드리지 않는다.
 *  권한: 확정 전용 권한은 없다(CREATE 만으로 확정 등록). 자동 확정이 기존 권한 검증을 우회하지 않는지도 확인한다.
 */
import { test, expect } from "@playwright/test"
import { assertSafeE2eEnvironment, adminCredentials, developerCredentials } from "./guard"
import { apiLogin, roleCreds } from "./support/perm-lib"
import { loadData, logDetail, db, closeDb, num, call, findAction, warm, rid, iso, addDays, counts, diffCounts, legacyDraftSalesOrder, legacyDraftStockPlan, sumOnHand } from "./support/o2s-lib"

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

// ── 서버 액션 래퍼 ──
const soArgs = (qty: number, status?: string) => [T, D.site.id, { customerId: D.customer.id, orderDate: iso(new Date()), deliveryDate: iso(addDays(10)), ...(status !== undefined ? { status } : {}), items: [{ itemId: D.items.fg.id, qty, unitPrice: 1, deliveryDate: iso(addDays(10)) }] }]
/** 상태를 보내지 않는 수주 등록(수정된 화면이 보내는 형태) */
async function mkSo(qty: number, cookie: string = admin, status?: string) {
  const r = await call(cookie, A("createSalesOrder", /sales-order\.actions/), soArgs(qty, status))
  expect(r.ok, r.error ?? "").toBe(true)
  const so = await db().salesOrder.findFirstOrThrow({ where: { tenantId: T }, orderBy: { createdAt: "desc" }, include: { items: true } })
  return { id: so.id, no: so.orderNo, itemId: so.items[0].id, status: so.status }
}
type So = Awaited<ReturnType<typeof mkSo>>
const request = (so: { id: string; itemId: string }, qty: number, over: { extraQty?: number; extraReason?: string } = {}, cookie: string = admin, requestId = rid("ac")) =>
  call(cookie, A("requestProductionFromSalesOrder", /sales-order\.actions/), [so.id, [{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty, ...over }], T, D.site.id, requestId])
const planArgs = (qty: number, tag: string, status?: string) => [{ siteId: D.site.id, planNo: "", planType: "DAILY", startDate: "2026-11-02", endDate: "2026-11-30", ...(status !== undefined ? { status } : {}), note: tag, items: [{ itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, plannedQty: qty }] }, T]
async function createStockPlan(qty: number, status?: string, cookie: string = admin) {
  const tag = `E2E-AC stock ${RUN}-${++seq}`
  const r = await call(cookie, A("createPlan", /production-plan\.actions/), planArgs(qty, tag, status))
  return { r, find: () => db().productionPlan.findFirstOrThrow({ where: { tenantId: T, note: tag }, include: { items: true } }) }
}
const planOf = (id: string) => db().productionPlan.findUniqueOrThrow({ where: { id }, include: { items: true } })
const soStatus = async (id: string) => (await db().salesOrder.findUniqueOrThrow({ where: { id } })).status
const rowOfRequest = async (so: { itemId: string }, planNo: string) => db().productionPlanItem.findFirstOrThrow({ where: { salesOrderItemId: so.itemId, plan: { planNo } }, include: { plan: true } })

async function rawUpdatePlan(planId: string, over: { status?: string }, cookie: string = admin) {
  const p = await planOf(planId)
  const items = p.items.map((r) => ({ productionPlanItemId: r.id, itemId: r.itemId, bomId: r.bomId ?? D.bom.id, routingId: r.routingId ?? D.routing.id, plannedQty: num(r.plannedQty), ...(r.salesOrderItemId ? { salesOrderItemId: r.salesOrderItemId } : {}) }))
  return call(cookie, A("updatePlan", /production-plan\.actions/), [planId, { siteId: p.siteId, planNo: p.planNo, planType: p.planType, startDate: "2026-11-02", endDate: "2026-11-30", status: over.status ?? p.status, note: p.note, items }])
}
const setSoStatus = (so: { id: string }, status: string, cookie: string = admin) => call(cookie, A("updateSalesOrder", /sales-order\.actions/), [so.id, { status }])

// ── 작업지시 → POP → 검사 → 입고 → 출하 (실제 흐름) ──
const WH_RAW = () => D.warehouses.raw.id
async function seedRawStock(tag: string, qty1: number, qty2: number) {
  const mk = async (item: { id: string }, qty: number, label: string) => {
    const lot = await db().lot.create({ data: { tenantId: T, itemId: item.id, lotNo: `E2E-AC-${RUN}-${tag}-${label}`, status: "ACTIVE" } })
    await db().inventoryBalance.create({ data: { tenantId: T, siteId: D.site.id, itemId: item.id, lotId: lot.id, warehouseId: WH_RAW(), qtyOnHand: qty, qtyAvailable: qty, qtyHold: 0 } })
    await db().inventoryTransaction.create({ data: { tenantId: T, itemId: item.id, lotId: lot.id, toLocationId: WH_RAW(), txNo: `E2E-AC-${RUN}-${tag}-${label}-RCV`, txType: "RECEIPT", qty, refType: "E2E_FIXTURE", refId: lot.lotNo } })
    return lot
  }
  return { l1: await mk(D.items.rm1, qty1, "R1"), l2: await mk(D.items.rm2, qty2, "R2") }
}
const woArgs = (rowId: string, qty: number, mfg: string) => [{
  siteId: D.site.id, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, orderNo: "", manufacturingNo: mfg, plannedQty: qty, status: "DRAFT", dueDate: iso(addDays(14)), productionPlanItemId: rowId,
  operations: [
    { routingOperationId: D.routing.ops[0], seq: 1, plannedQty: qty, equipmentId: D.equipments.eq1.id, assignments: [{ equipmentId: D.equipments.eq1.id, assignedQty: qty }] },
    { routingOperationId: D.routing.ops[1], seq: 2, plannedQty: qty },
  ],
}, T]
async function createWo(rowId: string, qty: number, tag: string) {
  const MFG = `E2E-AC-${RUN}-${tag}`
  const res = await call(admin, A("createWorkOrder", /work-order\.actions/), woArgs(rowId, qty, MFG))
  expect(res.value?.success, `작업지시 생성: ${errOf(res)}`).toBe(true)
  return db().workOrder.findFirstOrThrow({ where: { tenantId: T, manufacturingNo: MFG }, include: { operations: { orderBy: { seq: "asc" }, include: { assignments: true } } } })
}
async function popSession() {
  const pop = await call(null, A("popLogin", /pop\.actions/), [D.worker.pin, T])
  const m = /nmes-pop-worker-session=([^;]+)/.exec(pop.setCookie)
  expect(m, "POP 로그인").toBeTruthy()
  return `nmes-pop-worker-session=${m![1]}`
}
/** 릴리즈 → 자재 출고 → POP 전 공정 양품 실적 */
async function runProduction(wo: Awaited<ReturnType<typeof createWo>>, qty: number, tag: string) {
  expect((await call(admin, A("releaseWorkOrder", /work-order\.actions/), [wo.id])).ok).toBe(true)
  const raw = await seedRawStock(tag, qty * 2, qty * 3)
  const iss = await call(admin, A("issueMaterialsForWorkOrder", /material-issue\.actions/), [{ workOrderId: wo.id, siteId: D.site.id, items: [
    { itemId: D.items.rm1.id, lots: [{ lotId: raw.l1.id, warehouseId: WH_RAW(), quantity: qty * 2 }], issueQty: qty * 2, requiredQty: qty * 2, reservationId: null },
    { itemId: D.items.rm2.id, lots: [{ lotId: raw.l2.id, warehouseId: WH_RAW(), quantity: qty * 3 }], issueQty: qty * 3, requiredQty: qty * 3, reservationId: null },
  ] }, T])
  expect(iss.value?.ok, `자재 출고: ${errOf(iss)}`).toBe(true)
  const pc = await popSession()
  const [op1, op2] = wo.operations
  const pp1 = { pagePath: `/pop/production/${op1.id}` }, pp2 = { pagePath: `/pop/production/${op2.id}` }
  expect((await call(pc, A("startOperation", /pop\.actions/), [op1.id, op1.assignments[0].id], pp1)).value?.success).toBe(true)
  const s1 = await call(pc, A("submitProductionResult", /pop\.actions/), [{ workOrderOperationId: op1.id, assignmentId: op1.assignments[0].id, goodQty: qty, defectQty: 0, reworkQty: 0 }], pp1)
  expect(s1.value?.success, `1공정 실적: ${s1.value?.error}`).toBe(true)
  expect((await call(pc, A("startOperation", /pop\.actions/), [op2.id, null], pp2)).value?.success).toBe(true)
  const s2 = await call(pc, A("submitProductionResult", /pop\.actions/), [{ workOrderOperationId: op2.id, goodQty: qty, defectQty: 0, reworkQty: 0 }], pp2)
  expect(s2.value?.success, `2공정 실적: ${s2.value?.error}`).toBe(true)
}
async function inspectAndReceive(wo: Awaited<ReturnType<typeof createWo>>, qty: number) {
  await new Promise((r) => setTimeout(r, 1100))
  const [op1, op2] = wo.operations
  const ins = A("createStagedInspection", /inspection-stages\.actions/)
  for (const stage of ["FIRST", "MID"] as const) expect((await call(admin, ins, [{ workOrderOperationId: op1.id, inspectionSpecId: D.specs.op1, stage, result: "PASS", inspectedQty: 5 }])).ok).toBe(true)
  expect((await call(admin, ins, [{ workOrderOperationId: op2.id, inspectionSpecId: D.specs.op2, stage: "FINAL", result: "PASS", inspectedQty: qty }])).ok).toBe(true)
  const rcv = await call(admin, A("createFinishedGoodsReceiptAction", /finished-goods\.actions/), [{ workOrderId: wo.id, itemId: D.items.fg.id, siteId: D.site.id, warehouseId: D.warehouses.fg.id, receiptQty: qty }])
  expect(rcv.value?.ok, `완제품 입고: ${rcv.value?.error}`).toBe(true)
  return rcv.value.lotNo as string
}
async function shipAll(so: { id: string; itemId: string }, qty: number, lotNo: string) {
  const lot = await db().lot.findFirstOrThrow({ where: { tenantId: T, lotNo } })
  const ship = await call(admin, A("createShipment", /shipment\.actions/), [T, { salesOrderId: so.id, plannedDate: iso(addDays(1)), warehouseId: D.warehouses.fg.id, items: [{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty, lotId: lot.id }] }])
  expect(ship.ok, ship.error ?? "").toBe(true)
  const sh = await db().shipmentOrder.findFirstOrThrow({ where: { tenantId: T, salesOrderId: so.id }, orderBy: { createdAt: "desc" } })
  const cf = await call(admin, A("confirmShipment", /shipment\.actions/), [sh.id])
  expect(cf.ok, cf.error ?? "").toBe(true)
}

// ───────────────────────── AC-01 수주 등록 → CONFIRMED ─────────────────────────
test("[AC-01] 수주 등록 — 상태를 보내지 않아도, 초안·확정을 보내도 서버가 항상 CONFIRMED 로 저장(서버 정책), 생산중·출하·완료·취소 등록은 거부(DB 불변)", async () => {
  const before = await counts()
  const variants: (string | undefined)[] = [undefined, "CONFIRMED", "DRAFT"]
  for (const v of variants) {
    const so = await mkSo(10, admin, v)
    note("AC-01", { requested: v ?? "(없음)", saved: so.status })
    expect(so.status, `요청 상태 ${v ?? "(없음)"} → CONFIRMED`).toBe("CONFIRMED")
    const audit = await db().auditLog.findFirst({ where: { tenantId: T, entityType: "SalesOrder", entityId: so.id, action: "CREATE" } })
    expect((audit?.afterData as any)?.status, "감사 로그에도 CONFIRMED").toBe("CONFIRMED")
  }
  const mid = await counts()
  for (const bad of ["IN_PRODUCTION", "PARTIAL_SHIPPED", "SHIPPED", "CLOSED", "CANCELLED", "BOGUS"]) {
    const r = await call(admin, A("createSalesOrder", /sales-order\.actions/), soArgs(10, bad))
    expect(r.ok, `${bad} 등록이 허용됨`).toBe(false)
    expect(errOf(r)).toMatch(/등록 즉시 확정/)
  }
  expect(diffCounts(mid, await counts()), "거부된 등록은 DB 불변").toEqual([])
  expect(diffCounts(before, mid).sort(), "정상 등록 3건은 수주·수주품목만 증가").toEqual(["SalesOrder:" + before.SalesOrder + "→" + (before.SalesOrder + 3), "SalesOrderItem:" + before.SalesOrderItem + "→" + (before.SalesOrderItem + 3)].sort())
  expect(await db().salesOrder.count({ where: { tenantId: T, status: "DRAFT", orderNo: { not: { startsWith: "E2E-LEG" } } } }), "서버가 만든 초안 수주 없음").toBe(0)
})

// ───────────────────────── AC-02 등록 후 생산의뢰 ─────────────────────────
test("[AC-02] 수주 등록 후 별도 확정 작업 없이 바로 생산의뢰 — 수주 IN_PRODUCTION 전환·멱등성(같은 요청 ID 재전송) 유지", async () => {
  const so = await mkSo(100)
  expect(so.status).toBe("CONFIRMED")
  const id = rid("ac02")
  const r = await request(so, 100, {}, admin, id)
  expect(ok(r), errOf(r)).toBe(true)
  expect(await soStatus(so.id), "생산의뢰 후 수주는 기존대로 IN_PRODUCTION").toBe("IN_PRODUCTION")
  const replay = await request(so, 100, {}, admin, id)
  expect([replay.value?.ok, replay.value?.replayed, replay.value?.planNo], "같은 요청 ID 재전송은 새 계획 없이 처음 결과").toEqual([true, true, r.value.planNo])
  expect(await db().productionPlanItem.count({ where: { salesOrderItemId: so.itemId } })).toBe(1)
  const over = await request(so, 1)
  expect(ok(over), "잔량 0 초과 의뢰는 거부(N-14)").toBe(false)
})

// ───────────────────────── AC-03 수주 생산계획 자동 확정 ─────────────────────────
test("[AC-03] 수주 생산의뢰 → 생산계획 CONFIRMED(ORDER, 충당=계획), 승인 상태는 DB 기본값 그대로, LOT·재고·수불 불변", async () => {
  const so = await mkSo(100)
  const before = await counts()
  const r = await request(so, 100)
  expect(ok(r), errOf(r)).toBe(true)
  const row = await rowOfRequest(so, r.value.planNo)
  expect([row.plan.status, row.productionKind, num(row.plannedQty), num(row.allocatedQty), row.extraReason, row.extraApprovalStatus]).toEqual(["CONFIRMED", "ORDER", 100, 100, null, "NOT_REQUIRED"])
  expect(diffCounts(before, await counts()).sort(), "생산의뢰는 계획·계획품목만 추가(LOT·재고·수불 변화 없음)").toEqual([`ProductionPlan:${before.ProductionPlan}→${before.ProductionPlan + 1}`, `ProductionPlanItem:${before.ProductionPlanItem}→${before.ProductionPlanItem + 1}`])
  const audit = await db().auditLog.findFirst({ where: { tenantId: T, entityType: "ProductionPlan", entityId: row.planId, action: "CREATE" } })
  expect(audit, "계획 생성 감사 로그").toBeTruthy()
})

// ───────────────────────── AC-04 수주+여유 생산계획 자동 확정 ─────────────────────────
test("[AC-04] 수주+여유 생산의뢰 → 생산계획 CONFIRMED(ORDER_EXTRA, 계획=충당+여유), 여유 승인 상태는 APPROVED 로 바뀌지 않고 DB 기본값 유지", async () => {
  const so = await mkSo(100)
  const r = await request(so, 100, { extraQty: 10, extraReason: "불량 대비" })
  expect(ok(r), errOf(r)).toBe(true)
  const row = await rowOfRequest(so, r.value.planNo)
  expect([row.plan.status, row.productionKind, num(row.plannedQty), num(row.allocatedQty), row.extraReason]).toEqual(["CONFIRMED", "ORDER_EXTRA", 110, 100, "불량 대비"])
  expect(row.extraApprovalStatus, "자동 확정을 이유로 승인 상태를 바꾸지 않는다").toBe("NOT_REQUIRED")
  expect(row.extraApprovedById).toBeNull()
  expect(row.extraApprovedAt).toBeNull()
  // 기존 DB 에 이미 PENDING 인 줄이 있어도 자동 확정 경로가 값을 건드리지 않는다(승인 대기 계획을 향후 별도 통제할 수 있도록 값 보존)
  await db().productionPlanItem.update({ where: { id: row.id }, data: { extraApprovalStatus: "PENDING" } })
  const so2 = await mkSo(50)
  expect(ok(await request(so2, 50, { extraQty: 5, extraReason: "여유" }))).toBe(true)
  expect((await db().productionPlanItem.findUniqueOrThrow({ where: { id: row.id } })).extraApprovalStatus, "다른 의뢰가 기존 승인 상태를 바꾸지 않음").toBe("PENDING")
  note("AC-04", { approval: "NOT_REQUIRED 유지, PENDING 보존" })
})

// ───────────────────────── AC-05 재고 생산계획 자동 확정 ─────────────────────────
test("[AC-05] 재고 생산계획 등록 → 요청 상태와 무관하게 CONFIRMED(STOCK, 충당 0, 수주 연결 없음), 진행중·완료·취소 지정은 거부(DB 불변)", async () => {
  for (const st of [undefined, "DRAFT", "CONFIRMED"]) {
    const { r, find } = await createStockPlan(10, st)
    expect(ok(r), errOf(r)).toBe(true)
    const p = await find()
    expect([p.status, p.items[0].productionKind, num(p.items[0].allocatedQty), p.items[0].salesOrderItemId], `요청 ${st ?? "(없음)"} → 확정`).toEqual(["CONFIRMED", "STOCK", 0, null])
  }
  const before = await counts()
  for (const st of ["IN_PROGRESS", "COMPLETED", "CANCELLED"]) {
    const { r } = await createStockPlan(10, st)
    expect(ok(r), `${st} 등록이 허용됨`).toBe(false)
  }
  expect(diffCounts(before, await counts())).toEqual([])
  expect(await db().productionPlan.count({ where: { tenantId: T, status: "DRAFT", planNo: { not: { startsWith: "E2E-LEG" } } } }), "서버가 만든 초안 계획 없음").toBe(0)
})

// ───────────────────────── AC-06~08 확정 계획 → 작업지시 → 상태 전이 → POP → 완료 ─────────────────────────
test("[AC-06~08] 확정 계획에서 별도 확정 없이 작업지시 생성 → 계획 자동 진행중 → POP 실적·전 공정 완료 → 계획 자동 완료(작업지시 자동 생성 없음)", async () => {
  const so = await mkSo(30)
  const r = await request(so, 30)
  expect(ok(r), errOf(r)).toBe(true)
  const row = await rowOfRequest(so, r.value.planNo)
  expect(await db().workOrder.count({ where: { productionPlanItemId: row.id } }), "작업지시는 자동 생성되지 않는다").toBe(0)
  expect(row.plan.status).toBe("CONFIRMED")
  const wo = await createWo(row.id, 30, "L1")
  expect((await planOf(row.planId)).status, "작업지시 생성 → 계획 자동 진행중").toBe("IN_PROGRESS")
  await runProduction(wo, 30, "L1")
  expect((await db().workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status).toBe("COMPLETED")
  expect((await planOf(row.planId)).status, "작업지시 완료 → 계획 자동 완료").toBe("COMPLETED")
  // 같은 방식으로 재고 생산계획에서도 바로 작업지시
  const { r: sr, find } = await createStockPlan(20)
  expect(ok(sr)).toBe(true)
  const sp = await find()
  const swo = await createWo(sp.items[0].id, 20, "L1S")
  expect((await planOf(sp.id)).status).toBe("IN_PROGRESS")
  expect(swo.orderNo).toBeTruthy()
})

// ───────────────────────── AC-09 수주~출하 전체 흐름의 상태 일관성 ─────────────────────────
test("[AC-09] 수주 등록 → 생산의뢰 → 작업지시 → 실적 → 입고 → 출하: 수주 CONFIRMED→IN_PRODUCTION→SHIPPED, 계획 CONFIRMED→IN_PROGRESS→COMPLETED, 재고·원장 일치", async () => {
  const fgBefore = await sumOnHand(T, D.items.fg.id)
  const trace: string[] = []
  const so = await mkSo(40)
  trace.push(`등록 수주=${await soStatus(so.id)}`)
  const r = await request(so, 40)
  expect(ok(r), errOf(r)).toBe(true)
  const row = await rowOfRequest(so, r.value.planNo)
  trace.push(`생산의뢰 수주=${await soStatus(so.id)} 계획=${(await planOf(row.planId)).status}`)
  const wo = await createWo(row.id, 40, "FULL")
  trace.push(`작업지시 수주=${await soStatus(so.id)} 계획=${(await planOf(row.planId)).status}`)
  await runProduction(wo, 40, "FULL")
  trace.push(`생산완료 수주=${await soStatus(so.id)} 계획=${(await planOf(row.planId)).status}`)
  const lotNo = await inspectAndReceive(wo, 40)
  expect((await sumOnHand(T, D.items.fg.id)) - fgBefore, "완제품 +40").toBe(40)
  await shipAll(so, 40, lotNo)
  trace.push(`출하완료 수주=${await soStatus(so.id)}`)
  note("AC-09", { trace })
  expect(trace).toEqual([
    "등록 수주=CONFIRMED",
    "생산의뢰 수주=IN_PRODUCTION 계획=CONFIRMED",
    "작업지시 수주=IN_PRODUCTION 계획=IN_PROGRESS",
    "생산완료 수주=IN_PRODUCTION 계획=COMPLETED",
    "출하완료 수주=SHIPPED",
  ])
  expect(await sumOnHand(T, D.items.fg.id), "출하 후 완제품 재고 원복").toBe(fgBefore)
  expect(num((await db().salesOrderItem.findUniqueOrThrow({ where: { id: so.itemId } })).shippedQty)).toBe(40)
  expect(ok(await setSoStatus(so, "CLOSED")), "출하완료 → 완료(수동)는 기존대로").toBe(true)
})

// ───────────────────────── AC-10~11 기존 초안 데이터 보존·개별 확정 ─────────────────────────
test("[AC-10~11] 기존 초안(DRAFT) 데이터 — 새 등록이 건드리지 않고 조회되며, 수정 화면 경로(updateSalesOrder·updatePlan)로 개별 확정할 수 있다", async () => {
  const legSo = await legacyDraftSalesOrder(D, 25)
  const legPlan = await legacyDraftStockPlan(D, 15, `E2E-AC legacy ${RUN}`)
  const snapshot = async () => JSON.stringify((await db().$queryRawUnsafe<{ id: string; status: string }[]>(`select id, status::text from "SalesOrder" where "tenantId"='${T}' union all select id, status::text from "ProductionPlan" where "tenantId"='${T}' order by 1`)).filter((x) => [legSo.id, legPlan.id].includes(x.id)))
  const snap0 = await snapshot()
  // 새 수주·의뢰·재고 계획을 여러 건 만들어도 기존 초안은 그대로
  const so = await mkSo(10); expect(ok(await request(so, 10))).toBe(true)
  expect(ok((await createStockPlan(5)).r)).toBe(true)
  expect(await snapshot(), "새 등록이 기존 초안을 바꾸지 않음").toBe(snap0)
  expect([(await db().salesOrder.findUniqueOrThrow({ where: { id: legSo.id } })).status, (await planOf(legPlan.id)).status]).toEqual(["DRAFT", "DRAFT"])
  // 조회(목록 액션)에서도 보인다
  const list = await call(admin, A("getSalesOrders", /sales-order\.actions/), [T])
  expect(JSON.stringify(list.value)).toContain(legSo.no)
  const plans = await call(admin, A("getProductionPlans", /production-plan\.actions/), [])
  expect(JSON.stringify(plans.value)).toContain(legPlan.planNo)
  // 초안 계획에는 작업지시를 만들 수 없다(개별 확정이 먼저)
  const blocked = await call(admin, A("createWorkOrder", /work-order\.actions/), woArgs(legPlan.items[0].id, 15, `E2E-AC-${RUN}-LEGBLOCK`))
  expect(blocked.value?.success, "초안 계획에 작업지시").toBe(false)
  expect(errOf(blocked)).toMatch(/확정된 생산계획 품목만/)
  // 개별 확정(수정 경로)
  expect(ok(await setSoStatus(legSo, "CONFIRMED")), "초안 수주 개별 확정").toBe(true)
  expect(await soStatus(legSo.id)).toBe("CONFIRMED")
  expect(ok(await rawUpdatePlan(legPlan.id, { status: "CONFIRMED" })), "초안 계획 개별 확정").toBe(true)
  expect((await planOf(legPlan.id)).status).toBe("CONFIRMED")
  const wo = await createWo(legPlan.items[0].id, 15, "LEG")
  expect((await planOf(legPlan.id)).status, "개별 확정 뒤에는 작업지시 생성 가능 → 자동 진행중").toBe("IN_PROGRESS")
  expect(wo.orderNo).toBeTruthy()
  // 확정 수주는 (이력이 없으면) 초안으로 되돌릴 수 있는 기존 경로도 유지 — 잘못 등록한 수주의 품목 수정·삭제를 위한 경로
  const so2 = await mkSo(7)
  expect(ok(await setSoStatus(so2, "DRAFT")), "확정 → 초안 복귀(이력 없음)").toBe(true)
  expect(await soStatus(so2.id)).toBe("DRAFT")
  // 초안 수주에 바로 생산의뢰해도 기존처럼 동작(확정을 거치지 않고 생산중)
  const legSo2 = await legacyDraftSalesOrder(D, 12)
  expect(ok(await request(legSo2, 12)), "기존 초안 수주도 생산의뢰 가능(기존 동작 유지)").toBe(true)
  expect(await soStatus(legSo2.id)).toBe("IN_PRODUCTION")
})

// ───────────────────────── AC-12 취소·진행·완료 상태 보호 ─────────────────────────
test("[AC-12] 취소된 수주·생산계획 보호 — 취소 수주에는 생산의뢰 불가, 취소 계획은 수정·작업지시 불가, 진행·완료 계획 상태는 새 등록으로 바뀌지 않는다", async () => {
  const so = await mkSo(50)
  const r = await request(so, 50)
  expect(ok(r), errOf(r)).toBe(true)
  const row = await rowOfRequest(so, r.value.planNo)
  const cancel = await call(admin, A("cancelProductionPlan", /production-plan\.actions/), [row.planId, "AC-12 취소"])
  expect(cancel.ok, cancel.error ?? "").toBe(true)
  expect((await planOf(row.planId)).status).toBe("CANCELLED")
  expect(await soStatus(so.id), "계획 취소 → 수주는 확정으로 복귀(기존 동작)").toBe("CONFIRMED")
  // 취소된 계획: 수정 불가, 확정 재지정 불가, 작업지시 불가
  const upd = await rawUpdatePlan(row.planId, { status: "CONFIRMED" })
  expect(ok(upd), "취소 계획 재확정").toBe(false)
  expect(errOf(upd)).toMatch(/취소.*수정할 수 없습니다/)
  const wo = await call(admin, A("createWorkOrder", /work-order\.actions/), woArgs(row.id, 50, `E2E-AC-${RUN}-CXL`))
  expect(wo.value?.success, "취소 계획에 작업지시").toBe(false)
  // 취소된 수주: 새 생산의뢰 불가
  const so2 = await mkSo(20)
  expect(ok(await setSoStatus(so2, "CANCELLED"))).toBe(true)
  const req2 = await request(so2, 20)
  expect(ok(req2), "취소 수주 생산의뢰").toBe(false)
  expect(await db().productionPlanItem.count({ where: { salesOrderItemId: so2.itemId } })).toBe(0)
  expect(await soStatus(so2.id)).toBe("CANCELLED")
  // 진행중·완료·취소 계획은 새 등록·의뢰·상태 지정이 바꾸지 않는다
  const { r: pr, find } = await createStockPlan(11)
  expect(ok(pr)).toBe(true)
  const inprog = await find()
  await createWo(inprog.items[0].id, 11, "PROT")
  const protectedIds = [inprog.id, row.planId]
  const sig = async () => JSON.stringify((await db().productionPlan.findMany({ where: { id: { in: protectedIds } }, orderBy: { id: "asc" }, select: { id: true, status: true } })))
  const sig0 = await sig()
  expect(ok((await createStockPlan(3)).r)).toBe(true)
  expect(ok(await request(await mkSo(3), 3))).toBe(true)
  expect(await sig(), "진행중·취소 계획 불변").toBe(sig0)
  expect(ok(await rawUpdatePlan(inprog.id, { status: "CONFIRMED" })), "진행중 계획 재지정 거부").toBe(false)
})

// ───────────────────────── AC-13 역할별 생성·확정 권한 ─────────────────────────
test("[AC-13] 역할별 권한 — 자동 확정이 권한 검증을 우회하지 않는다: 수주 등록(MANAGER·OPERATOR 가능/VIEWER 거부), 생산의뢰·재고 계획(MANAGER 가능/OPERATOR·VIEWER 거부), 초안 개별 확정(수정 권한 필요)", async () => {
  const cookies: Record<string, string> = {}
  for (const role of ["MANAGER", "OPERATOR", "VIEWER"] as const) {
    const c = roleCreds(role)
    const l = await apiLogin(c.loginId, c.password)
    expect(l.cookie, `${role} 로그인`).toBeTruthy()
    cookies[role] = l.cookie!
  }
  const perms = async (role: string, resource: string) => (await db().rolePermission.findMany({ where: { tenantId: T, role: role as any, resource, isAllowed: true }, select: { action: true } })).map((p) => String(p.action)).sort()
  const matrix = { MANAGER: { SO: await perms("MANAGER", "SALES_ORDER"), PP: await perms("MANAGER", "PRODUCTION_PLAN") }, OPERATOR: { SO: await perms("OPERATOR", "SALES_ORDER"), PP: await perms("OPERATOR", "PRODUCTION_PLAN") }, VIEWER: { SO: await perms("VIEWER", "SALES_ORDER"), PP: await perms("VIEWER", "PRODUCTION_PLAN") } }
  note("AC-13", { matrix })
  const can = (role: "MANAGER" | "OPERATOR" | "VIEWER", res: "SO" | "PP", action: string) => matrix[role][res].includes(action)
  expect(can("VIEWER", "SO", "CREATE") || can("VIEWER", "PP", "CREATE"), "VIEWER 는 생성 권한 없음(전제)").toBe(false)

  // ① 수주 등록
  for (const role of ["MANAGER", "OPERATOR", "VIEWER"] as const) {
    const before = await db().salesOrder.count({ where: { tenantId: T } })
    const r = await call(cookies[role], A("createSalesOrder", /sales-order\.actions/), soArgs(5))
    const created = (await db().salesOrder.count({ where: { tenantId: T } })) - before
    if (can(role, "SO", "CREATE")) {
      expect(r.ok, `${role} 수주 등록: ${r.error}`).toBe(true)
      expect(created).toBe(1)
      expect((await db().salesOrder.findFirstOrThrow({ where: { tenantId: T }, orderBy: { createdAt: "desc" } })).status, `${role} 가 등록해도 CONFIRMED`).toBe("CONFIRMED")
    } else {
      expect(r.ok, `${role} 수주 등록이 허용됨`).toBe(false)
      expect(created, `${role} 거부 시 DB 불변`).toBe(0)
    }
  }
  // ② 생산의뢰(수주 UPDATE + 생산계획 CREATE 가 모두 필요)
  for (const role of ["MANAGER", "OPERATOR", "VIEWER"] as const) {
    const so = await mkSo(5)
    const beforePlans = await db().productionPlan.count({ where: { tenantId: T } })
    const r = await request(so, 5, {}, cookies[role])
    const made = (await db().productionPlan.count({ where: { tenantId: T } })) - beforePlans
    const allowed = can(role, "SO", "UPDATE") && can(role, "PP", "CREATE")
    expect(ok(r), `${role} 생산의뢰 ${allowed ? "가능" : "거부"}: ${errOf(r)}`).toBe(allowed)
    expect(made).toBe(allowed ? 1 : 0)
    if (allowed) expect((await db().productionPlan.findFirstOrThrow({ where: { tenantId: T }, orderBy: { createdAt: "desc" } })).status).toBe("CONFIRMED")
    else expect(await soStatus(so.id), `${role} 거부 시 수주 상태 불변`).toBe("CONFIRMED")
  }
  // ③ 재고 생산계획 등록(생산계획 CREATE)
  for (const role of ["MANAGER", "OPERATOR", "VIEWER"] as const) {
    const before = await db().productionPlan.count({ where: { tenantId: T } })
    const { r } = await createStockPlan(4, undefined, cookies[role])
    const made = (await db().productionPlan.count({ where: { tenantId: T } })) - before
    const allowed = can(role, "PP", "CREATE")
    expect(ok(r), `${role} 재고 계획 ${allowed ? "가능" : "거부"}: ${errOf(r)}`).toBe(allowed)
    expect(made).toBe(allowed ? 1 : 0)
  }
  // ④ 기존 초안의 개별 확정(수정 권한)
  for (const role of ["MANAGER", "OPERATOR", "VIEWER"] as const) {
    const legSo = await legacyDraftSalesOrder(D, 3)
    const legPlan = await legacyDraftStockPlan(D, 3, `E2E-AC perm ${RUN}-${role}`)
    const rs = await setSoStatus(legSo, "CONFIRMED", cookies[role])
    const rp = await rawUpdatePlan(legPlan.id, { status: "CONFIRMED" }, cookies[role])
    expect([role, ok(rs)], `${role} 초안 수주 확정`).toEqual([role, can(role, "SO", "UPDATE")])
    expect([role, ok(rp)], `${role} 초안 계획 확정`).toEqual([role, can(role, "PP", "UPDATE")])
    expect(await soStatus(legSo.id)).toBe(can(role, "SO", "UPDATE") ? "CONFIRMED" : "DRAFT")
    expect((await planOf(legPlan.id)).status).toBe(can(role, "PP", "UPDATE") ? "CONFIRMED" : "DRAFT")
  }
  // 영향도 기록: 확정 전용 권한은 없다 — 등록(CREATE) 권한이 곧 확정 등록 권한이다(기존 화면도 등록 시 확정을 고를 수 있었음)
  note("AC-13", { impact: "신규 등록은 CREATE 권한만 검사(확정 전용 권한 없음). 초안 개별 확정은 UPDATE 권한." })
})

// ───────────────────────── AC-14 승인 상태 값 보존 ─────────────────────────
test("[AC-14] 자동 확정은 LOT·재고·수불·여유 승인 데이터를 건드리지 않는다 — 등록·의뢰·재고 계획 반복 후에도 해당 테이블 행 수·승인 상태 불변", async () => {
  const before = await counts()
  const approvals = async () => JSON.stringify(await db().productionPlanItem.findMany({ where: { plan: { tenantId: T } }, orderBy: { id: "asc" }, select: { id: true, extraApprovalStatus: true, extraApprovedById: true } }))
  const a0 = await approvals()
  for (let i = 0; i < 3; i++) {
    const so = await mkSo(10)
    expect(ok(await request(so, 10, i === 1 ? { extraQty: 2, extraReason: "여유" } : {}))).toBe(true)
    expect(ok((await createStockPlan(6)).r)).toBe(true)
  }
  const diff = diffCounts(before, await counts()).map((d) => d.split(":")[0]).sort()
  expect(diff, "변한 테이블은 수주·계획 관련뿐").toEqual(["ProductionPlan", "ProductionPlanItem", "SalesOrder", "SalesOrderItem"])
  const a1 = JSON.parse(await approvals()) as { id: string; extraApprovalStatus: string }[]
  const old = new Set((JSON.parse(a0) as { id: string }[]).map((x) => x.id))
  expect(JSON.stringify(a1.filter((x) => old.has(x.id))), "기존 줄의 승인 상태 불변").toBe(a0)
  expect(a1.every((x) => x.extraApprovalStatus !== "APPROVED"), "자동 확정이 APPROVED 를 만들지 않음").toBe(true)
})

// ───────────────────────── 수주 수정(입력 실수 정정) ─────────────────────────
const editSo = (so: { id: string }, data: Record<string, unknown>, cookie: string = admin) => call(cookie, A("updateSalesOrder", /sales-order\.actions/), [so.id, data])
const soItems = (soId: string) => db().salesOrderItem.findMany({ where: { salesOrderId: soId }, orderBy: { itemId: "asc" } })
const itemSig = async (soId: string) => JSON.stringify((await soItems(soId)).map((i) => [i.id, i.itemId, num(i.qty), num(i.unitPrice), num(i.shippedQty)]))
const line = (itemId: string, qty: number, extra: Record<string, unknown> = {}) => ({ itemId, qty, unitPrice: 5, ...extra })
async function seedFgLot(qty: number) {
  const lot = await db().lot.create({ data: { tenantId: T, itemId: D.items.fg.id, lotNo: `E2E-AC-FG-${RUN}-${++seq}`, status: "ACTIVE" } })
  await db().inventoryBalance.create({ data: { tenantId: T, siteId: D.site.id, itemId: D.items.fg.id, lotId: lot.id, warehouseId: D.warehouses.fg.id, qtyOnHand: qty, qtyAvailable: qty, qtyHold: 0 } })
  await db().inventoryTransaction.create({ data: { tenantId: T, itemId: D.items.fg.id, lotId: lot.id, toLocationId: D.warehouses.fg.id, txNo: `${lot.lotNo}-RCV`, txType: "RECEIPT", qty, refType: "E2E_FIXTURE", refId: lot.lotNo } })
  return lot
}

test("[AC-15] 확정 수주 수정 — 후속 업무가 없으면 품목·수량·단가를 안전하게 수정(줄 ID 보존), 입력 오류는 거부(DB 불변)", async () => {
  const so = await mkSo(100)
  expect(so.status).toBe("CONFIRMED")
  const [orig] = await soItems(so.id)
  // 수량·단가 수정(제자리 수정: 줄 ID 유지, 상태 CONFIRMED 유지)
  const r1 = await editSo(so, { items: [line(D.items.fg.id, 80, { unitPrice: 7 })] })
  expect(ok(r1), errOf(r1)).toBe(true)
  const [after] = await soItems(so.id)
  expect([after.id, num(after.qty), num(after.unitPrice)], "같은 줄에서 수량·단가만 변경").toEqual([orig.id, 80, 7])
  expect(await soStatus(so.id)).toBe("CONFIRMED")
  const audit = await db().auditLog.findFirst({ where: { tenantId: T, entityType: "SalesOrder", entityId: so.id, action: "UPDATE" }, orderBy: { actedAt: "desc" } })
  expect((audit?.afterData as any)?.itemsChanged, "감사 로그에 품목 변경 기록").toBe(true)
  // 품목 추가 → 삭제
  expect(ok(await editSo(so, { items: [line(D.items.fg.id, 80, { unitPrice: 7 }), line(D.items.rm1.id, 5)] }))).toBe(true)
  expect((await soItems(so.id)).length).toBe(2)
  expect(ok(await editSo(so, { items: [line(D.items.fg.id, 80, { unitPrice: 7 })] })), "추가했던 줄 삭제(이력 없음)").toBe(true)
  expect((await soItems(so.id)).map((i) => i.id)).toEqual([orig.id])
  // 품목 납기·비고는 입력에 없으면 보존
  await db().salesOrderItem.update({ where: { id: orig.id }, data: { note: "줄 비고", deliveryDate: new Date("2026-12-24") } })
  expect(ok(await editSo(so, { items: [{ itemId: D.items.fg.id, qty: 90, unitPrice: 7 }] }))).toBe(true)
  const kept = await db().salesOrderItem.findUniqueOrThrow({ where: { id: orig.id } })
  expect([num(kept.qty), kept.note, kept.deliveryDate?.toISOString().slice(0, 10)], "입력에 없던 납기·비고는 보존").toEqual([90, "줄 비고", "2026-12-24"])
  // 입력 오류: 수량 0·음수·같은 품목 중복·품목 0건·음수 단가
  const sig0 = await itemSig(so.id)
  const before = await counts()
  const bad: [string, Record<string, unknown>[]][] = [["수량 0", [line(D.items.fg.id, 0)]], ["수량 음수", [line(D.items.fg.id, -3)]], ["품목 중복", [line(D.items.fg.id, 1), line(D.items.fg.id, 2)]], ["품목 0건", []], ["음수 단가", [line(D.items.fg.id, 5, { unitPrice: -1 })]]]
  for (const [label, items] of bad) {
    const r = await editSo(so, { items })
    expect(ok(r), `${label} 이 허용됨`).toBe(false)
    note("AC-15", { label, err: errOf(r) })
  }
  expect(await itemSig(so.id), "거부된 수정은 품목 불변").toBe(sig0)
  expect(diffCounts(before, await counts())).toEqual([])
  // 기존 초안 수주도 같은 규칙
  const leg = await legacyDraftSalesOrder(D, 30)
  expect(ok(await editSo(leg, { items: [line(D.items.fg.id, 35)] })), "초안 수주 수정").toBe(true)
  expect(num((await soItems(leg.id))[0].qty)).toBe(35)
  expect(await soStatus(leg.id)).toBe("DRAFT")
})

test("[AC-16] 생산의뢰·출하 후 수주 수정 제한 — 후속 업무가 있으면 품목·수량 수정 거부, 일반 수정은 허용, 취소된 계획 이력이 걸린 줄은 삭제 불가·수량만 수정", async () => {
  // (a) 생산의뢰 후
  const so = await mkSo(100)
  const r = await request(so, 100)
  expect(ok(r), errOf(r)).toBe(true)
  const sig0 = await itemSig(so.id)
  const blocked = await editSo(so, { items: [line(D.items.fg.id, 50)] })
  expect(ok(blocked), "생산의뢰 후 수량 수정이 허용됨").toBe(false)
  expect(errOf(blocked)).toContain(r.value.planNo)
  expect(errOf(blocked)).toMatch(/품목·수량을 수정할 수 없습니다/)
  expect(await itemSig(so.id), "거부 후 품목 불변").toBe(sig0)
  const cur = (await soItems(so.id))[0]
  expect(ok(await editSo(so, { note: "비고만 수정", items: [{ itemId: D.items.fg.id, qty: num(cur.qty), unitPrice: num(cur.unitPrice) }] })), "품목이 그대로인 일반 수정(화면이 품목을 함께 보내는 경우)").toBe(true)
  expect((await db().salesOrder.findUniqueOrThrow({ where: { id: so.id } })).note).toBe("비고만 수정")
  // (b) 계획 취소 후에는 수정 가능하지만 취소 이력이 걸린 줄은 삭제할 수 없다(줄 ID·연결 보존)
  const row = await rowOfRequest(so, r.value.planNo)
  expect((await call(admin, A("cancelProductionPlan", /production-plan\.actions/), [row.planId, "AC-16 취소"])).ok).toBe(true)
  expect(ok(await editSo(so, { items: [line(D.items.fg.id, 60)] })), "계획 취소 후 수량 수정").toBe(true)
  const afterCancel = (await soItems(so.id))[0]
  expect([afterCancel.id, num(afterCancel.qty)]).toEqual([cur.id, 60])
  expect((await db().productionPlanItem.findUniqueOrThrow({ where: { id: row.id } })).salesOrderItemId, "취소된 계획의 수주 연결 보존").toBe(cur.id)
  const del = await editSo(so, { items: [line(D.items.rm1.id, 5)] })
  expect(ok(del), "이력이 있는 줄 삭제가 허용됨").toBe(false)
  expect(errOf(del)).toMatch(/취소된 생산계획·출하 이력/)
  expect((await soItems(so.id)).map((i) => i.id)).toEqual([cur.id])
  // (c) 예정 출하 → 부분 출하
  const lot = await seedFgLot(100)
  const so2 = await mkSo(40)
  const ship = (qty: number) => call(admin, A("createShipment", /shipment\.actions/), [T, { salesOrderId: so2.id, plannedDate: iso(addDays(1)), warehouseId: D.warehouses.fg.id, items: [{ salesOrderItemId: so2.itemId, itemId: D.items.fg.id, qty, lotId: lot.id }] }])
  expect((await ship(10)).ok).toBe(true)
  const e1 = await editSo(so2, { items: [line(D.items.fg.id, 20)] })
  expect(ok(e1), "예정 출하가 있는 수주의 수량 수정").toBe(false)
  expect(errOf(e1)).toMatch(/출하\(/)
  const sh = await db().shipmentOrder.findFirstOrThrow({ where: { tenantId: T, salesOrderId: so2.id } })
  expect((await call(admin, A("confirmShipment", /shipment\.actions/), [sh.id])).ok).toBe(true)
  const stock0 = await db().inventoryBalance.findFirstOrThrow({ where: { tenantId: T, lotId: lot.id } })
  const e2 = await editSo(so2, { items: [line(D.items.fg.id, 5)] })
  expect(ok(e2), "부분출하 수주의 수량 수정").toBe(false)
  const it2 = (await soItems(so2.id))[0]
  expect([num(it2.qty), num(it2.shippedQty), await soStatus(so2.id)], "수주 수량·출하 수량·상태 보존").toEqual([40, 10, "PARTIAL_SHIPPED"])
  expect(num((await db().inventoryBalance.findFirstOrThrow({ where: { tenantId: T, lotId: lot.id } })).qtyOnHand), "재고 불변").toBe(num(stock0.qtyOnHand))
  expect(ok(await editSo(so2, { note: "부분출하 후 비고" })), "부분출하 수주의 일반 수정").toBe(true)
})

test("[AC-17] 수주 수정 ↔ 생산의뢰 동시 요청 — 어떤 순서로 끝나도 수주 충당 합계가 수주 수량을 넘지 않고, 수정과 의뢰가 서로 모순되게 둘 다 성공하지 않는다", async () => {
  const outcomes: string[] = []
  for (let i = 0; i < 8; i++) {
    const so = await mkSo(100)
    const [e, r] = await Promise.all([editSo(so, { items: [line(D.items.fg.id, 60)] }), request(so, 100)])
    const item = (await soItems(so.id))[0]
    const allocated = (await db().productionPlanItem.aggregate({ where: { salesOrderItemId: item.id, plan: { status: { not: "CANCELLED" } } }, _sum: { allocatedQty: true } }))._sum.allocatedQty
    expect(num(allocated), `반복 ${i}: 충당 합계 ≤ 수주 수량`).toBeLessThanOrEqual(num(item.qty))
    expect(ok(e) && ok(r), `반복 ${i}: 수량 60 으로 줄이고도 100 을 의뢰하는 모순`).toBe(false)
    outcomes.push(`${ok(e) ? "수정O" : "수정X"}/${ok(r) ? "의뢰O" : "의뢰X"}`)
  }
  note("AC-17", { outcomes })
})

// ───────────────────────── 생산계획 수정(자동 확정 계획) ─────────────────────────
async function updPlan(planId: string, items: Record<string, unknown>[], extra: { status?: string; note?: string | null } = {}) {
  const p = await planOf(planId)
  return call(admin, A("updatePlan", /production-plan\.actions/), [planId, { siteId: p.siteId, planNo: p.planNo, planType: p.planType, startDate: "2026-11-02", endDate: "2026-11-30", status: extra.status ?? p.status, note: extra.note !== undefined ? extra.note : p.note, items }])
}
const planLine = (row: { id: string; salesOrderItemId: string | null }, qty: number, extra: Record<string, unknown> = {}) => ({ productionPlanItemId: row.id, ...(row.salesOrderItemId ? { salesOrderItemId: row.salesOrderItemId } : {}), itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, plannedQty: qty, ...extra })

test("[AC-18] 자동 확정된 생산계획 수정 — 작업지시 전에는 수량 수정 가능(수주 충당 상한·여유 사유 검증·요청 ID 태그 유지), 작업지시가 생기면 기존 수정 제한", async () => {
  const so = await mkSo(100)
  const reqId = rid("ac18")
  const r = await request(so, 100, {}, admin, reqId)
  expect(ok(r), errOf(r)).toBe(true)
  const row = await rowOfRequest(so, r.value.planNo)
  expect(row.plan.status).toBe("CONFIRMED")
  // 여유 생산: 사유 없이 계획 수량만 올리면 거부, 사유와 함께면 허용(ORDER_EXTRA, 충당 100 유지)
  const noReason = await updPlan(row.planId, [planLine(row, 110)])
  expect(ok(noReason), "사유 없는 여유").toBe(false)
  const withReason = await updPlan(row.planId, [planLine(row, 110, { allocatedQty: 100, extraReason: "불량 대비" })])
  expect(ok(withReason), errOf(withReason)).toBe(true)
  let cur = (await planOf(row.planId)).items[0]
  expect([num(cur.plannedQty), num(cur.allocatedQty), cur.productionKind, cur.extraReason, cur.extraApprovalStatus]).toEqual([110, 100, "ORDER_EXTRA", "불량 대비", "NOT_REQUIRED"])
  expect((await planOf(row.planId)).status, "수정해도 확정 유지").toBe("CONFIRMED")
  // 수주 충당 상한: 수주 수량(100)을 넘는 충당은 거부
  const over = await updPlan(row.planId, [planLine(row, 120, { allocatedQty: 101, extraReason: "초과" })])
  expect(ok(over), "충당 > 수주 수량").toBe(false)
  cur = (await planOf(row.planId)).items[0]
  expect([num(cur.plannedQty), num(cur.allocatedQty)], "거부 후 불변").toEqual([110, 100])
  // 비고 수정 후에도 요청 ID 태그 유지 → 같은 요청 ID 재전송은 새 계획 없이 처음 결과
  expect(ok(await updPlan(row.planId, [planLine(row, 110, { allocatedQty: 100, extraReason: "불량 대비" })], { note: "비고 수정" }))).toBe(true)
  expect((await planOf(row.planId)).note).toContain(`[pr:${reqId}:`)
  const replay = await request(so, 100, {}, admin, reqId)
  expect([replay.value?.ok, replay.value?.replayed]).toEqual([true, true])
  expect(await db().productionPlanItem.count({ where: { salesOrderItemId: so.itemId } })).toBe(1)
  // 여유를 없애면 다시 ORDER
  expect(ok(await updPlan(row.planId, [planLine(row, 100, { allocatedQty: 100 })]))).toBe(true)
  cur = (await planOf(row.planId)).items[0]
  expect([num(cur.plannedQty), cur.productionKind, cur.extraReason]).toEqual([100, "ORDER", null])
  // 재고 생산계획: 작업지시 전 수량 수정 가능 → 작업지시 생성 후 수정 거부(계획 자동 진행중)
  const { r: sr, find } = await createStockPlan(50)
  expect(ok(sr)).toBe(true)
  const sp = await find()
  expect(ok(await updPlan(sp.id, [planLine(sp.items[0], 70)])), "작업지시 전 수량 수정").toBe(true)
  expect(num((await planOf(sp.id)).items[0].plannedQty)).toBe(70)
  const wo = await createWo(sp.items[0].id, 70, "AC18")
  expect((await planOf(sp.id)).status).toBe("IN_PROGRESS")
  const afterWo = await updPlan(sp.id, [planLine(sp.items[0], 90)])
  expect(ok(afterWo), "작업지시 후 수정(진행중 계획)").toBe(false)
  expect(errOf(afterWo)).toMatch(/진행중.*수정할 수 없습니다/)
  expect(num((await planOf(sp.id)).items[0].plannedQty)).toBe(70)
  expect(wo.orderNo).toBeTruthy()
})

// ───────────────────────── 견적 → 수주 전환 ─────────────────────────
test("[AC-19] 견적→수주 전환 — 대원정밀 화면(일반 계정)에서는 사용할 수 없고(서버 FORBIDDEN·수주 미생성), 개발자 전용 경로의 DRAFT 생성은 문서화된 예외로 기록", async () => {
  const dev = developerCredentials()
  const devCookie = (await apiLogin(dev.loginId, dev.password)).cookie ?? ""
  await warm(devCookie, ["/app/mes/quotations", "/app/mes/sales-orders"])
  const q = await db().quotation.create({ data: { tenantId: T, siteId: D.site.id, customerId: D.customer.id, quotationNo: `E2E-AC-QT-${RUN}`, quotationDate: new Date(), validUntil: addDays(30), status: "WON", items: { create: [{ itemId: D.items.fg.id, qty: 3, unitPrice: 1000 }] } } })
  const convert = A("convertToSalesOrder", /quotation\.actions/)
  const before = await db().salesOrder.count({ where: { tenantId: T } })
  const denied = await call(admin, convert, [q.id, T], { pagePath: "/app/mes/quotations" })
  expect(denied.ok, "일반(비개발자) 계정의 견적 전환이 허용됨").toBe(false)
  expect(errOf(denied), "서버 가드가 거부(개발 서버는 FORBIDDEN 을 HTTP 500 으로 돌려준다)").toMatch(/FORBIDDEN|권한|HTTP 500/)
  expect(await db().salesOrder.count({ where: { tenantId: T } }), "수주 미생성").toBe(before)
  expect((await db().quotation.findUniqueOrThrow({ where: { id: q.id } })).convertedSalesOrderId).toBeNull()
  // 개발자 전용 경로: 현재는 DRAFT 수주를 만든다(범위 밖 메뉴라 변경하지 않음 — docs/DAEWON-AUTO-CONFIRM.md 의 예외)
  const conv = await call(devCookie, convert, [q.id, T], { pagePath: "/app/mes/quotations" })
  expect(conv.ok, errOf(conv)).toBe(true)
  const created = await db().salesOrder.findFirstOrThrow({ where: { tenantId: T, note: { contains: q.quotationNo } } })
  note("AC-19", { developerPathStatus: created.status })
  expect(created.status, "개발자 전용 견적 전환은 DRAFT(예외)").toBe("DRAFT")
})
