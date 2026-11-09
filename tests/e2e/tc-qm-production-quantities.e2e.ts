/**
 * 2-A 생산 수량 조회 모델 검증 (로컬 테스트 DB 전용) — 서버 액션 코드를 실제 세션 토큰·실제 권한 로직으로 호출하고(next/headers 의 쿠키 저장소만 대체),
 * 결과를 DB 직접 질의(SQL 오라클)와 대조한다. 데이터는 실제 서버 액션(HTTP)으로 만든다.
 *  조회 모델: src/lib/production-quantity-model(.server).ts, 액션: src/lib/actions/production-quantity.actions.ts
 */
import { test, expect } from "@playwright/test"
import Module from "node:module"
import { assertSafeE2eEnvironment, adminCredentials, developerCredentials } from "./guard"
import { apiLogin, roleCreds, signToken } from "./support/perm-lib"
import { loadData, logDetail, db, closeDb, num, call, findAction, warm, rid, iso, addDays, fingerprint } from "./support/o2s-lib"

assertSafeE2eEnvironment()
const D = loadData()
const T = D.tenantId
let admin = ""
const A = (n: string, re: RegExp) => findAction(n, re)
const note = (id: string, o: Record<string, unknown>) => logDetail({ id, ...o })
const ok = (r: { ok: boolean; value: any }) => r.ok && r.value?.ok !== false && r.value?.success !== false
const errOf = (r: { value: any; error: string | null }) => String(r.value?.error ?? r.error ?? "")
const RUN = Date.now().toString(36).toUpperCase()

// ── 조회 액션 호출 환경: 실제 세션 토큰(로그인 API 로 발급) + 실제 getCurrentUser/권한 로직. next/headers 쿠키 저장소만 대체 ──
let sessionToken: string | null = null
const M = Module as any
const origLoad = M._load
M._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/headers") return { cookies: async () => ({ get: (n: string) => (sessionToken ? { name: n, value: sessionToken } : undefined) }), headers: async () => new Headers() }
  return origLoad.call(this, request, ...rest)
}
const tokenOf = (cookie: string | null) => { const m = cookie ? /^[^=]+=([^;]+)/.exec(cookie) : null; return m ? m[1] : null }
let _actions: any
const actions = () => (_actions ??= require("../../src/lib/actions/production-quantity.actions"))
let _soActions: any
const soActions = () => (_soActions ??= require("../../src/lib/actions/sales-order.actions"))
async function as(cookie: string | null, fn: () => Promise<any>): Promise<any> {
  sessionToken = tokenOf(cookie)
  try { return await fn() } finally { sessionToken = null }
}
const orderQ = (cookie: string | null, soId: string) => as(cookie, () => actions().getSalesOrderProductionQuantities(soId))
const planQ = (cookie: string | null, ids?: string[]) => as(cookie, () => actions().getProductionPlanQuantities(ids))
const item0 = async (soId: string) => (await orderQ(admin, soId))!.items[0]

test.beforeAll(async () => {
  const a = adminCredentials(), d = developerCredentials()
  admin = (await apiLogin(a.loginId, a.password)).cookie ?? ""
  const dev = (await apiLogin(d.loginId, d.password)).cookie ?? ""
  await warm(dev, ["/app/mes/sales-orders", "/app/mes/production-plan", "/app/mes/mrp", "/app/mes/material-issue", "/app/mes/work-orders", "/app/mes/inspection-stages", "/app/mes/final-inspection", "/app/mes/finished-goods-receipt", "/app/mes/shipments", "/pop/work-select", "/login"])
})
test.afterAll(async () => { await closeDb() })

// ───────────────────────── 데이터 만들기 (실제 서버 액션) ─────────────────────────
async function mkSo(qty: number) {
  const r = await call(admin, A("createSalesOrder", /sales-order\.actions/), [T, D.site.id, { customerId: D.customer.id, orderDate: iso(new Date()), deliveryDate: iso(addDays(10)), status: "CONFIRMED", items: [{ itemId: D.items.fg.id, qty, unitPrice: 1, deliveryDate: iso(addDays(10)) }] }])
  expect(r.ok, r.error ?? "").toBe(true)
  const so = await db().salesOrder.findFirstOrThrow({ where: { tenantId: T }, orderBy: { createdAt: "desc" }, include: { items: true } })
  return { id: so.id, no: so.orderNo, itemId: so.items[0].id }
}
type So = Awaited<ReturnType<typeof mkSo>>
const request = (so: So, qty: number, over: { extraQty?: number; extraReason?: string } = {}) =>
  call(admin, A("requestProductionFromSalesOrder", /sales-order\.actions/), [so.id, [{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty, ...over }], T, D.site.id, rid("qm")])
const reqOk = async (so: So, qty: number, over: { extraQty?: number; extraReason?: string } = {}) => { const r = await request(so, qty, over); expect(ok(r), errOf(r)).toBe(true); return r }
const rowsOf = (soItemId: string) => db().productionPlanItem.findMany({ where: { salesOrderItemId: soItemId }, include: { plan: true }, orderBy: { plan: { createdAt: "asc" } } })
async function updatePlan(rowId: string, over: { plannedQty: number; allocatedQty?: number; extraReason?: string; status?: "DRAFT" | "CONFIRMED" }) {
  const row = await db().productionPlanItem.findUniqueOrThrow({ where: { id: rowId }, include: { plan: true } })
  const item: Record<string, unknown> = { productionPlanItemId: row.id, itemId: row.itemId, bomId: row.bomId ?? D.bom.id, routingId: row.routingId ?? D.routing.id, plannedQty: over.plannedQty }
  if (row.salesOrderItemId) item.salesOrderItemId = row.salesOrderItemId
  if (over.allocatedQty !== undefined) item.allocatedQty = over.allocatedQty
  if (over.extraReason !== undefined) item.extraReason = over.extraReason
  return call(admin, A("updatePlan", /production-plan\.actions/), [row.planId, { siteId: row.plan.siteId, planNo: row.plan.planNo, planType: row.plan.planType, startDate: "2026-11-02", endDate: "2026-11-30", status: over.status ?? (row.plan.status === "CONFIRMED" ? "CONFIRMED" : "DRAFT"), note: row.plan.note, items: [item] }])
}
let stockSeq = 0
async function createStockPlan(qty: number) {
  const tag = `E2E-QM stock ${RUN}-${++stockSeq}`
  const r = await call(admin, A("createPlan", /production-plan\.actions/), [{ siteId: D.site.id, planNo: "", planType: "DAILY", startDate: "2026-11-02", endDate: "2026-11-30", status: "DRAFT", note: tag, items: [{ itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, plannedQty: qty }] }, T])
  expect(ok(r), errOf(r)).toBe(true)
  return db().productionPlanItem.findFirstOrThrow({ where: { plan: { tenantId: T, note: tag } }, include: { plan: true } })
}
const cancelPlan = async (planId: string) => { const r = await call(admin, A("cancelProductionPlan", /production-plan\.actions/), [planId, "E2E-QM 취소"]); expect(r.ok, r.error ?? "").toBe(true) }

async function seedRawStock(tag: string, qty1: number, qty2: number) {
  const mk = async (item: { id: string }, qty: number, label: string) => {
    const lot = await db().lot.create({ data: { tenantId: T, itemId: item.id, lotNo: `E2E-QM-${RUN}-${tag}-${label}`, status: "ACTIVE" } })
    await db().inventoryBalance.create({ data: { tenantId: T, siteId: D.site.id, itemId: item.id, lotId: lot.id, warehouseId: D.warehouses.raw.id, qtyOnHand: qty, qtyAvailable: qty, qtyHold: 0 } })
    await db().inventoryTransaction.create({ data: { tenantId: T, itemId: item.id, lotId: lot.id, toLocationId: D.warehouses.raw.id, txNo: `E2E-QM-${RUN}-${tag}-${label}-RCV`, txType: "RECEIPT", qty, refType: "E2E_FIXTURE", refId: lot.lotNo } })
    return lot
  }
  return { l1: await mk(D.items.rm1, qty1, "R1"), l2: await mk(D.items.rm2, qty2, "R2") }
}
/** 완제품 재고 LOT 를 DB 로 직접 만든다(격리·보류·만료 상태 시험용 픽스처). lotId=false 면 LOT 미지정 재고 */
async function seedFgBalance(tag: string, status: "ACTIVE" | "QUARANTINE" | "ON_HOLD" | "EXPIRED" | "CONSUMED" | null, qty: number) {
  let lotId: string | null = null
  if (status) {
    const lot = await db().lot.create({ data: { tenantId: T, itemId: D.items.fg.id, lotNo: `E2E-QM-${RUN}-${tag}`, status } })
    lotId = lot.id
  }
  await db().inventoryBalance.create({ data: { tenantId: T, siteId: D.site.id, itemId: D.items.fg.id, lotId, warehouseId: D.warehouses.fg.id, qtyOnHand: qty, qtyAvailable: qty, qtyHold: 0 } })
  await db().inventoryTransaction.create({ data: { tenantId: T, itemId: D.items.fg.id, lotId, toLocationId: D.warehouses.fg.id, txNo: `E2E-QM-${RUN}-${tag}-RCV`, txType: "RECEIPT", qty, refType: "E2E_FIXTURE", refId: tag } })
  return lotId
}

/** 계획 줄 확정 → 작업지시 → 출고 → POP 실적(전량 양품) → 최종검사 PASS → 완제품 입고(receipts 만큼 순서대로). 결과 식별자를 돌려준다 */
async function produce(rowId: string, qty: number, tag: string, receipts: number[]) {
  const row = await db().productionPlanItem.findUniqueOrThrow({ where: { id: rowId } })
  const conf = await updatePlan(rowId, { plannedQty: num(row.plannedQty), status: "CONFIRMED" })
  expect(ok(conf), `계획 확정: ${errOf(conf)}`).toBe(true)
  const MFG = `E2E-QM-${RUN}-${tag}`
  const woRes = await call(admin, A("createWorkOrder", /work-order\.actions/), [{
    siteId: D.site.id, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, orderNo: "", manufacturingNo: MFG, plannedQty: qty, status: "DRAFT", dueDate: iso(addDays(14)), productionPlanItemId: rowId,
    operations: [
      { routingOperationId: D.routing.ops[0], seq: 1, plannedQty: qty, equipmentId: D.equipments.eq1.id, assignments: [{ equipmentId: D.equipments.eq1.id, assignedQty: qty }] },
      { routingOperationId: D.routing.ops[1], seq: 2, plannedQty: qty },
    ],
  }, T])
  expect(woRes.value?.success, `작업지시 생성: ${errOf(woRes)}`).toBe(true)
  const wo = await db().workOrder.findFirstOrThrow({ where: { tenantId: T, manufacturingNo: MFG }, include: { operations: { orderBy: { seq: "asc" }, include: { assignments: true } } } })
  expect((await call(admin, A("releaseWorkOrder", /work-order\.actions/), [wo.id])).ok).toBe(true)
  const raw = await seedRawStock(tag, qty * 2, qty * 3)
  const iss = await call(admin, A("issueMaterialsForWorkOrder", /material-issue\.actions/), [{ workOrderId: wo.id, siteId: D.site.id, items: [
    { itemId: D.items.rm1.id, lots: [{ lotId: raw.l1.id, warehouseId: D.warehouses.raw.id, quantity: qty * 2 }], issueQty: qty * 2, requiredQty: qty * 2, reservationId: null },
    { itemId: D.items.rm2.id, lots: [{ lotId: raw.l2.id, warehouseId: D.warehouses.raw.id, quantity: qty * 3 }], issueQty: qty * 3, requiredQty: qty * 3, reservationId: null },
  ] }, T])
  expect(iss.value?.ok, `자재 출고: ${errOf(iss)}`).toBe(true)
  const pop = await call(null, A("popLogin", /pop\.actions/), [D.worker.pin, T])
  const m = /nmes-pop-worker-session=([^;]+)/.exec(pop.setCookie)
  expect(m, "POP 로그인").toBeTruthy()
  const pc = `nmes-pop-worker-session=${m![1]}`
  const [op1, op2] = wo.operations
  const pp1 = { pagePath: `/pop/production/${op1.id}` }, pp2 = { pagePath: `/pop/production/${op2.id}` }
  expect((await call(pc, A("startOperation", /pop\.actions/), [op1.id, op1.assignments[0].id], pp1)).value?.success).toBe(true)
  expect((await call(pc, A("submitProductionResult", /pop\.actions/), [{ workOrderOperationId: op1.id, assignmentId: op1.assignments[0].id, goodQty: qty, defectQty: 0, reworkQty: 0 }], pp1)).value?.success).toBe(true)
  expect((await call(pc, A("startOperation", /pop\.actions/), [op2.id, null], pp2)).value?.success).toBe(true)
  expect((await call(pc, A("submitProductionResult", /pop\.actions/), [{ workOrderOperationId: op2.id, goodQty: qty, defectQty: 0, reworkQty: 0 }], pp2)).value?.success).toBe(true)
  await new Promise((r) => setTimeout(r, 1100))
  const ins = A("createStagedInspection", /inspection-stages\.actions/)
  for (const stage of ["FIRST", "MID"] as const) expect((await call(admin, ins, [{ workOrderOperationId: op1.id, inspectionSpecId: D.specs.op1, stage, result: "PASS", inspectedQty: 5 }])).ok).toBe(true)
  expect((await call(admin, ins, [{ workOrderOperationId: op2.id, inspectionSpecId: D.specs.op2, stage: "FINAL", result: "PASS", inspectedQty: qty }])).ok).toBe(true)
  const lotNos: string[] = []
  for (const q of receipts) {
    const rcv = await call(admin, A("createFinishedGoodsReceiptAction", /finished-goods\.actions/), [{ workOrderId: wo.id, itemId: D.items.fg.id, siteId: D.site.id, warehouseId: D.warehouses.fg.id, receiptQty: q }])
    expect(rcv.value?.ok, `완제품 입고 ${q}: ${rcv.value?.error}`).toBe(true)
    lotNos.push(rcv.value.lotNo)
  }
  const lots = await db().lot.findMany({ where: { tenantId: T, lotNo: { in: lotNos } } })
  return { woId: wo.id, op2Id: op2.id, lotNos, lotIds: lotNos.map((n) => lots.find((l) => l.lotNo === n)!.id) }
}
async function ship(so: So, lotId: string, qty: number, confirm: boolean) {
  const r = await call(admin, A("createShipment", /shipment\.actions/), [T, { salesOrderId: so.id, plannedDate: iso(addDays(1)), warehouseId: D.warehouses.fg.id, items: [{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty, lotId }] }])
  expect(r.ok, r.error ?? "").toBe(true)
  const sh = await db().shipmentOrder.findFirstOrThrow({ where: { tenantId: T, salesOrderId: so.id, status: "PLANNED", items: { some: { lotId } } }, orderBy: { createdAt: "desc" } })
  if (confirm) { const c = await call(admin, A("confirmShipment", /shipment\.actions/), [sh.id]); expect(c.ok, c.error ?? "").toBe(true) }
  return sh.id
}

// ───────────────────────── SQL 오라클 (조회 모델 코드와 독립) ─────────────────────────
async function oracleSoi(soiId: string) {
  const r = await db().$queryRawUnsafe<Record<string, string>[]>(`
    select soi.qty::text ordered, soi."shippedQty"::text shipped_col,
      coalesce((select sum(si.qty) from "ShipmentItem" si join "ShipmentOrder" so on so.id=si."shipmentOrderId" where si."salesOrderItemId"=soi.id and so.status in ('SHIPPED','DELIVERED')),0)::text shipped_valid,
      coalesce((select sum(p."allocatedQty") from "ProductionPlanItem" p join "ProductionPlan" pl on pl.id=p."planId" where p."salesOrderItemId"=soi.id and pl.status<>'CANCELLED'),0)::text allocated,
      coalesce((select sum(p."plannedQty") from "ProductionPlanItem" p join "ProductionPlan" pl on pl.id=p."planId" where p."salesOrderItemId"=soi.id and pl.status<>'CANCELLED'),0)::text planned,
      coalesce((select sum(f."receiptQty") from "ProductionPlanItem" p join "ProductionPlan" pl on pl.id=p."planId" join "WorkOrder" w on w."productionPlanItemId"=p.id join "FinishedGoodsReceipt" f on f."workOrderId"=w.id where p."salesOrderItemId"=soi.id and pl.status<>'CANCELLED'),0)::text received,
      coalesce((select sum(w."plannedQty") from "ProductionPlanItem" p join "ProductionPlan" pl on pl.id=p."planId" join "WorkOrder" w on w."productionPlanItemId"=p.id where p."salesOrderItemId"=soi.id and pl.status<>'CANCELLED' and w.status<>'CANCELLED'),0)::text wo_qty
    from "SalesOrderItem" soi where soi.id='${soiId}'`)
  const o = r[0]
  return { ordered: Number(o.ordered), shippedCol: Number(o.shipped_col), shipped: Number(o.shipped_valid), allocated: Number(o.allocated), planned: Number(o.planned), received: Number(o.received), woQty: Number(o.wo_qty) }
}
/** 미입고 예정·미입고 충당 구간을 DB 원본 행에서 직접 계산(모델 코드와 독립 구현, 규칙은 production-quantity-model.ts 머리말과 동일) */
async function oraclePending(soiId: string) {
  const lines = await db().productionPlanItem.findMany({
    where: { salesOrderItemId: soiId, plan: { status: { not: "CANCELLED" } } },
    include: { plan: true, workOrders: { include: { operations: true, finishedGoodsReceipts: true } } },
  })
  let lo = 0, hi = 0, pending = 0, shortfall = 0
  for (const l of lines) {
    const P = num(l.plannedQty), A = num(l.allocatedQty)
    const open = ["DRAFT", "CONFIRMED", "IN_PROGRESS"].includes(l.plan.status)
    let R = 0, woQty = 0, receivable = 0
    for (const w of l.workOrders) {
      const r = w.finishedGoodsReceipts.reduce((t, x) => t + num(x.receiptQty), 0)
      R += r
      if (w.status === "CANCELLED") continue
      woQty += num(w.plannedQty)
      const finalOp = w.operations.slice().sort((x, y) => y.seq - x.seq)[0]
      const expected = w.status === "COMPLETED" ? (finalOp ? num(finalOp.completedQty) : num(w.plannedQty)) : num(w.plannedQty)
      receivable += Math.max(0, expected - r)
    }
    const pend = receivable + (open ? Math.max(0, P - woQty) : 0)
    pending += pend; shortfall += Math.max(0, P - R - pend)
    if (pend > 0) {
      const d = R + pend, x = Math.max(0, P - A)
      const h = Math.min(pend, Math.min(A, Math.max(0, Math.min(A, d) - Math.max(0, R - x))))
      const lw = Math.min(h, Math.max(0, Math.max(0, d - x) - Math.min(A, R)))
      lo += lw; hi += h
    }
  }
  return { lo, hi, planned: pending, shortfall }
}
/** 품목 재고 오라클: blockedLotIds 는 테스트가 알고 있는 품질 차단 LOT */
async function oracleStock(itemId: string, blockedLotIds: string[] = []) {
  const bal = await db().$queryRawUnsafe<{ lotId: string | null; status: string | null; avail: string }[]>(`
    select b."lotId", l.status::text status, sum(b."qtyAvailable")::text avail from "InventoryBalance" b left join "Lot" l on l.id=b."lotId" where b."tenantId"='${T}' and b."itemId"='${itemId}' group by b."lotId", l.status`)
  const res = await db().$queryRawUnsafe<{ lotId: string | null; q: string }[]>(`
    select si."lotId", sum(si.qty)::text q from "ShipmentItem" si join "ShipmentOrder" so on so.id=si."shipmentOrderId" where so."tenantId"='${T}' and so.status='PLANNED' and si."itemId"='${itemId}' group by si."lotId"`)
  const reserved = new Map(res.map((r) => [r.lotId ?? "", Number(r.q)]))
  let legacy = 0, activeLot = 0, blocked = 0, plannedReserved = 0, shippable = 0, unassigned = 0
  const excluded: Record<string, number> = {}
  for (const b of bal) {
    const avail = Number(b.avail); legacy += avail
    if (avail <= 0) continue
    if (!b.lotId) { unassigned += avail; continue } // 완제품은 LOT 관리 품목
    if (b.status !== "ACTIVE") { excluded[b.status!] = (excluded[b.status!] ?? 0) + avail; continue }
    activeLot += avail
    if (blockedLotIds.includes(b.lotId)) { blocked += avail; continue }
    const r = Math.min(reserved.get(b.lotId) ?? 0, avail); plannedReserved += r; shippable += avail - r
  }
  return { legacy, activeLot, blocked, plannedReserved, shippable, unassigned, excluded }
}
async function oracleCompeting(itemId: string, exceptSoiId: string) {
  const r = await db().$queryRawUnsafe<{ q: string; n: string }[]>(`
    select coalesce(sum(greatest(0, soi.qty - coalesce((select sum(si.qty) from "ShipmentItem" si join "ShipmentOrder" sh on sh.id=si."shipmentOrderId" where si."salesOrderItemId"=soi.id and sh.status in ('SHIPPED','DELIVERED')),0))),0)::text q,
           count(distinct case when soi.qty - coalesce((select sum(si.qty) from "ShipmentItem" si join "ShipmentOrder" sh on sh.id=si."shipmentOrderId" where si."salesOrderItemId"=soi.id and sh.status in ('SHIPPED','DELIVERED')),0) > 0 then soi."salesOrderId" end)::text n
    from "SalesOrderItem" soi join "SalesOrder" so on so.id=soi."salesOrderId"
    where so."tenantId"='${T}' and so.status in ('CONFIRMED','IN_PRODUCTION','PARTIAL_SHIPPED') and soi."itemId"='${itemId}' and soi.id<>'${exceptSoiId}'`)
  return { qty: Number(r[0].q), count: Number(r[0].n) }
}
/** 모든 수량 필드를 오라클과 대조하고, 기존 부족수량 액션(checkInventoryForSalesOrder)과 같은 값을 내는지 확인 */
/** 최종검사 불합격 이력이 있는 작업지시의 완제품 LOT — DB 에서 직접 조회(워커가 다시 시작돼도 유지) */
async function failedLotIds(): Promise<string[]> {
  const r = await db().$queryRawUnsafe<{ lotId: string }[]>(`select distinct f."lotId" from "FinishedGoodsReceipt" f join "WorkOrderOperation" o on o."workOrderId"=f."workOrderId" join "QualityInspection" q on q."workOrderOperationId"=o.id where f."tenantId"='${T}' and q.stage='FINAL' and q.result='FAIL' and f."lotId" is not null`)
  return r.map((x) => x.lotId)
}
const lotByTag = async (tag: string) => db().lot.findFirstOrThrow({ where: { tenantId: T, itemId: D.items.fg.id, lotNo: { contains: `-${tag}` } } })
async function cross(soId: string, opts: { blockedLotIds?: string[] } = {}) {
  const res = (await orderQ(admin, soId))!
  const legacyRows = await as(admin, () => soActions().checkInventoryForSalesOrder(soId, T))
  for (const v of res.items) {
    const o = await oracleSoi(v.salesOrderItemId), p = await oraclePending(v.salesOrderItemId), s = await oracleStock(v.itemId, opts.blockedLotIds ?? (await failedLotIds()))
    const c = await oracleCompeting(v.itemId, v.salesOrderItemId)
    expect([v.orderedQty, v.shippedQty, v.shippedQtyColumn, v.outstandingQty], "수주·출하·미납").toEqual([o.ordered, o.shipped, o.shippedCol, Math.max(0, o.ordered - o.shipped)])
    expect([v.allocatedQty, v.unallocatedQty, v.plannedQty, v.receivedQty, v.workOrderQty], "충당·미충당·계획·입고·작업지시").toEqual([o.allocated, Math.max(0, o.ordered - o.allocated), o.planned, o.received, o.woQty])
    expect(v.extraQty, "여유 = 계획 − 충당(수주 연결 줄)").toBeCloseTo(o.planned - o.allocated, 6)
    expect([v.pendingAllocatedReceipt.minQty, v.pendingAllocatedReceipt.maxQty, v.pendingPlannedReceiptQty], "미입고 충당 구간·미입고 예정").toEqual([p.lo, p.hi, p.planned])
    expect([v.stock.legacyAvailableQty, v.stock.shippableQty, v.stock.breakdown.activeLotQty, v.stock.breakdown.qualityBlockedQty, v.stock.breakdown.plannedShipmentReservedQty, v.stock.breakdown.unassignedForLotTrackedQty], "재고 구성").toEqual([s.legacy, s.shippable, s.activeLot, s.blocked, s.plannedReserved, s.unassigned])
    expect(v.stock.breakdown.excludedByLotStatus, "LOT 상태별 제외").toEqual(s.excluded)
    expect([v.stock.competingOutstandingQty, v.stock.competingOrderCount], "경합 수주").toEqual([c.qty, c.count])
    expect([v.stock.reservation.supported, v.stock.reservation.reservedForThisOrder], "재고 예약 없음 표시").toEqual([false, null])
    // 부족수량: 기존 액션과 같은 식, 신규는 서로 겹치지 않는 공급원만 차감
    const legacy = legacyRows.find((r: any) => r.salesOrderItemId === v.salesOrderItemId)
    note("QM-CMP", { orderNo: v.orderNo, ordered: v.orderedQty, shipped: v.shippedQty, allocated: v.allocatedQty, received: v.receivedQty, pending: [v.pendingAllocatedReceipt.minQty, v.pendingAllocatedReceipt.maxQty], legacyAvail: v.stock.legacyAvailableQty, shippable: v.stock.shippableQty, legacyShortage: v.shortage.legacy.shortageQty, newShortage: [v.shortage.proposed.shortageMinQty, v.shortage.proposed.shortageMaxQty], codes: v.shortage.differenceCodes })
    expect([v.shortage.legacy.remainingQty, v.shortage.legacy.availableStock, v.shortage.legacy.shortageQty], "기존 부족수량 계산과 동일").toEqual([legacy.remainingQty, legacy.availableStock, legacy.shortageQty])
    expect(v.shortage.proposed.shortageMinQty).toBeCloseTo(Math.max(0, v.outstandingQty - s.shippable - p.hi), 6)
    expect(v.shortage.proposed.shortageMaxQty).toBeCloseTo(Math.max(0, v.outstandingQty - s.shippable - p.lo), 6)
    expect(v.shortage.suggestedAllocationQty.maxQty).toBeLessThanOrEqual(v.unallocatedQty + 1e-9)
    // 중복 차감 방지 항등식: 입고된 충당분은 미입고 충당에 들어가지 않는다 (ORDER 줄은 충당 = 입고 + 미입고)
    for (const l of v.lines.filter((x: any) => x.counted && x.productionKind === "ORDER" && x.planStatus !== "COMPLETED")) {
      expect(l.receivedQty + l.pendingAllocatedReceipt.maxQty, `ORDER 줄 ${l.planNo}: 입고 + 미입고 충당 = 충당`).toBeCloseTo(Math.max(l.allocatedQty, l.receivedQty), 6)
    }
  }
  return res
}

// ───────────────────────── QM-01 ~ QM-06: 계획·충당 ─────────────────────────
test("[QM-01][시나리오1] 수주 100, 계획 없음 — 미납 100·충당 0·미충당 100·계획 0, 재고 예약 없음 표시, 기존 부족수량과 동일", async () => {
  const so = await mkSo(100)
  const res = await cross(so.id)
  const v = res.items[0]
  expect([v.orderedQty, v.shippedQty, v.outstandingQty, v.allocatedQty, v.unallocatedQty, v.plannedQty, v.extraQty, v.lines.length]).toEqual([100, 0, 100, 0, 0 + 100, 0, 0, 0])
  expect([v.shortage.legacy.shortageQty, v.shortage.proposed.shortageMinQty, v.shortage.proposed.exact, v.shortage.deltaMinQty]).toEqual([100, 100, true, 0])
  expect(v.stock.reservation.note).toMatch(/예약 기능이 없어/)
  expect(res.orderNo).toBe(so.no)
})

test("[QM-02][시나리오2] 수주 100, 충당 40 — 미충당 60, 미입고 충당 40(정확), 신규 부족 60 vs 기존 100(미입고 충당 차감)", async () => {
  const so = await mkSo(100)
  await reqOk(so, 40)
  const v = (await cross(so.id)).items[0]
  expect([v.allocatedQty, v.unallocatedQty, v.plannedQty, v.extraQty, v.lines.length]).toEqual([40, 60, 40, 0, 1])
  expect(v.lines[0]).toMatchObject({ productionKind: "ORDER", plannedQty: 40, allocatedQty: 40, extraQty: 0, receivedQty: 0, counted: true, planStatus: "CONFIRMED" })
  expect(v.pendingAllocatedReceipt).toEqual({ minQty: 40, maxQty: 40, exact: true })
  expect([v.shortage.legacy.shortageQty, v.shortage.proposed.shortageMinQty, v.shortage.proposed.shortageMaxQty, v.shortage.deltaMinQty]).toEqual([100, 60, 60, -40])
  expect(v.shortage.differenceCodes).toContain("PENDING_ALLOCATION_NOT_IN_LEGACY")
  expect(v.shortage.suggestedAllocationQty).toEqual({ minQty: 60, maxQty: 60 })
})

test("[QM-03][시나리오3] 수주 100, 충당 40+60 — 두 줄 합산 100, 미충당 0, 추가 충당 제안 0, 신규 부족 0", async () => {
  const so = await mkSo(100)
  await reqOk(so, 40); await reqOk(so, 60)
  const v = (await cross(so.id)).items[0]
  expect([v.allocatedQty, v.unallocatedQty, v.plannedQty, v.lines.length, new Set(v.lines.map((l: any) => l.planId)).size]).toEqual([100, 0, 100, 2, 2])
  expect(v.lines.map((l: any) => l.allocatedQty).sort((a: number, b: number) => a - b)).toEqual([40, 60])
  expect([v.shortage.proposed.shortageMinQty, v.shortage.suggestedAllocationQty.maxQty, v.shortage.legacy.shortageQty]).toEqual([0, 0, 100])
})

test("[QM-04][시나리오4] 수주 100, 충당 100 + 여유 10 — 계획 110, 여유 10, 승인 상태는 DB 값 그대로(PENDING 을 승인으로 보지 않음, 정책 미적용)", async () => {
  const so = await mkSo(100)
  await reqOk(so, 100, { extraQty: 10, extraReason: "불량 대비" })
  const row = (await rowsOf(so.itemId))[0]
  let v = (await cross(so.id)).items[0]
  expect([v.allocatedQty, v.plannedQty, v.extraQty, v.unallocatedQty]).toEqual([100, 110, 10, 0])
  expect(v.lines[0]).toMatchObject({ productionKind: "ORDER_EXTRA", plannedQty: 110, allocatedQty: 100, extraQty: 10, extraReason: "불량 대비" })
  expect(v.lines[0].approval).toMatchObject({ status: "NOT_REQUIRED", approved: false, needsAttention: false, policyApplied: false })
  expect(v.pendingAllocatedReceipt).toEqual({ minQty: 100, maxQty: 100, exact: true })
  expect(v.pendingPlannedReceiptQty).toBe(110)
  for (const [status, approved, attention] of [["PENDING", false, true], ["REJECTED", false, true], ["APPROVED", true, false]] as const) {
    await db().productionPlanItem.update({ where: { id: row.id }, data: { extraApprovalStatus: status } })
    v = (await orderQ(admin, so.id))!.items[0]
    expect(v.lines[0].approval, `승인 상태 ${status}`).toMatchObject({ status, approved, needsAttention: attention, policyApplied: false })
    expect(v.totals.hasApprovalAttention).toBe(attention)
  }
  await db().productionPlanItem.update({ where: { id: row.id }, data: { extraApprovalStatus: "NOT_REQUIRED" } })
  // 계획 화면 모델: 같은 줄을 수주 맥락과 함께 제공
  const pv = (await planQ(admin, [row.planId]))[0]
  expect(pv).toMatchObject({ planNo: row.plan.planNo, kindSummary: "ORDER_EXTRA" })
  expect(pv.lines[0]).toMatchObject({ plannedQty: 110, allocatedQty: 100, extraQty: 10, order: { orderNo: so.no, orderedQty: 100, allocatedAllPlansQty: 100, allocatedByOtherLinesQty: 0, allocatableMoreQty: 0 } })
  expect(pv.totals).toMatchObject({ plannedQty: 110, allocatedQty: 100, extraQty: 10, stockProductionQty: 0 })
})

test("[QM-05][시나리오5] 취소된 생산계획 제외 — 합계·미충당에서 빠지고 줄은 counted=false 로 남으며, 재의뢰하면 새 계획만 합산", async () => {
  const so = await mkSo(100)
  await reqOk(so, 100, { extraQty: 10, extraReason: "취소 시험" })
  const first = (await rowsOf(so.itemId))[0]
  await cancelPlan(first.planId)
  let v = (await cross(so.id)).items[0]
  expect([v.allocatedQty, v.unallocatedQty, v.plannedQty, v.extraQty, v.lines.length, v.pendingAllocatedReceipt.maxQty]).toEqual([0, 100, 0, 0, 0, 0])
  const pv = (await planQ(admin, [first.planId]))[0]
  expect(pv.planStatus).toBe("CANCELLED")
  expect(pv.lines[0]).toMatchObject({ counted: false, plannedQty: 110, allocatedQty: 100, pendingPlannedReceiptQty: 0, pendingAllocatedReceipt: { minQty: 0, maxQty: 0, exact: true } })
  expect(pv.totals).toMatchObject({ lineCount: 0, plannedQty: 0, allocatedQty: 0 })
  await reqOk(so, 60)
  v = (await cross(so.id)).items[0]
  expect([v.allocatedQty, v.unallocatedQty, v.plannedQty, v.lines.length], "취소 이력(110)은 합산하지 않음").toEqual([60, 40, 60, 1])
  expect((await rowsOf(so.itemId)).length, "취소 계획 이력은 DB 에 보존").toBe(2)
})

test("[QM-06][시나리오6] 재고 생산 계획 — 충당 0·유형 STOCK·수주 맥락 없음·여유로 세지 않음, 같은 품목 수주 화면에는 독립 재고 생산 미입고로만 나타남", async () => {
  const before = (await orderQ(admin, (await mkSo(10)).id))!.items[0].stock.independentStockPendingQty
  const row = await createStockPlan(200)
  const pv = (await planQ(admin, [row.planId]))[0]
  expect(pv.kindSummary).toBe("STOCK")
  expect(pv.lines[0]).toMatchObject({ productionKind: "STOCK", plannedQty: 200, allocatedQty: 0, salesOrderItemId: null, order: null, pendingPlannedReceiptQty: 200, pendingAllocatedReceipt: { minQty: 0, maxQty: 0, exact: true } })
  expect(pv.totals).toMatchObject({ plannedQty: 200, allocatedQty: 0, extraQty: 0, stockProductionQty: 200 })
  const so = await mkSo(50)
  const v = (await cross(so.id)).items[0]
  expect([v.allocatedQty, v.lines.length], "재고 생산은 수주 충당에 포함되지 않음").toEqual([0, 0])
  expect(v.stock.independentStockPendingQty - before, "독립 재고 생산 미입고 +200").toBe(200)
  const sumPending = await db().$queryRawUnsafe<{ q: string }[]>(`select coalesce(sum(greatest(0,p."plannedQty" - coalesce((select sum(f."receiptQty") from "WorkOrder" w join "FinishedGoodsReceipt" f on f."workOrderId"=w.id where w."productionPlanItemId"=p.id),0))),0)::text q from "ProductionPlanItem" p join "ProductionPlan" pl on pl.id=p."planId" and pl.status in ('DRAFT','CONFIRMED','IN_PROGRESS') where p."salesOrderItemId" is null and p."itemId"='${D.items.fg.id}'`)
  expect(v.stock.independentStockPendingQty).toBe(Number(sumPending[0].q))
})

// ───────────────────────── QM-07 ~ QM-10: 출하·재고 ─────────────────────────
test("[QM-07][시나리오7] 부분 출하 후 미납 수량 — 확정 출하만 출하 완료, 예정(PLANNED)·취소 출하는 제외하고 예정 출하는 재고 예약으로만 반영, 출하 수량 컬럼 불일치 표시", async () => {
  const so = await mkSo(100)
  await reqOk(so, 100)
  const row = (await rowsOf(so.itemId))[0]
  const p = await produce(row.id, 100, "S7", [100])
  expect(p.lotIds.length).toBe(1)
  let v = (await cross(so.id)).items[0]
  expect([v.receivedQty, v.pendingAllocatedReceipt.maxQty, v.shippedQty, v.outstandingQty], "입고 100·미입고 충당 0").toEqual([100, 0, 0, 100])
  await ship(so, p.lotIds[0], 30, true)
  const plannedShipId = await ship(so, p.lotIds[0], 20, false)
  v = (await cross(so.id, {})).items[0]
  expect([v.shippedQty, v.shippedQtyColumn, v.outstandingQty, v.shippedQtySourceMismatch], "확정 30 만 출하 완료, 미납 70").toEqual([30, 30, 70, false])
  expect([v.stock.breakdown.plannedShipmentReservedQty, v.stock.shippableQty, v.stock.legacyAvailableQty], "예정 출하 20 은 재고 예약으로만 반영").toEqual([20, v.stock.legacyAvailableQty - 20, v.stock.legacyAvailableQty])
  expect(v.shortage.differenceCodes).toContain("STOCK_RESERVED_BY_PLANNED_SHIPMENT")
  await db().shipmentOrder.update({ where: { id: plannedShipId }, data: { status: "CANCELLED" } }) // 취소 출하(픽스처)
  v = (await cross(so.id)).items[0]
  expect([v.shippedQty, v.outstandingQty, v.stock.breakdown.plannedShipmentReservedQty], "취소 출하는 출하 완료·예약에서 제외").toEqual([30, 70, 0])
  await db().salesOrderItem.update({ where: { id: so.itemId }, data: { shippedQty: 99 } })
  v = (await cross(so.id)).items[0]
  expect([v.shippedQty, v.shippedQtyColumn, v.shippedQtySourceMismatch, v.shortage.legacy.remainingQty], "컬럼 99 ≠ 확정 출하 30: 신규는 확정 출하 기준·기존 식은 컬럼 기준").toEqual([30, 99, true, 1])
  expect(v.shortage.differenceCodes).toContain("SHIPPED_QTY_SOURCE_MISMATCH")
  await db().salesOrderItem.update({ where: { id: so.itemId }, data: { shippedQty: 30 } })
})

test("[QM-08][시나리오8] 완제품 재고가 있는 수주 — 재고 70 이 있어도 특정 수주에 확보되었다고 표시하지 않고, 입고된 충당분을 미입고로 다시 세지 않는다", async () => {
  const so = await mkSo(50)
  const res = await cross(so.id)
  const v = res.items[0]
  const s = await oracleStock(D.items.fg.id)
  expect(v.stock.shippableQty).toBe(s.shippable)
  expect(v.stock.shippableQty).toBeGreaterThanOrEqual(70)
  expect([v.shortage.legacy.shortageQty, v.shortage.proposed.shortageMinQty], "재고가 충분하면 둘 다 0").toEqual([0, 0])
  expect(v.stock.reservation).toMatchObject({ supported: false, reservedForThisOrder: null })
  expect(v.lines.length).toBe(0)
  note("QM-08", { shippable: v.stock.shippableQty, competing: v.stock.competingOutstandingQty, orders: v.stock.competingOrderCount })
})

test("[QM-09][시나리오9] 격리·보류·만료·소진 LOT 와 LOT 미지정 재고는 출하 가능 재고에서 제외하고 사유별로 표시, 최종검사 불합격 LOT 는 품질 게이트로 제외", async () => {
  const so = await mkSo(40)
  const base = await oracleStock(D.items.fg.id)
  await seedFgBalance(`Q9-ACT-${++stockSeq}`, "ACTIVE", 10)
  await seedFgBalance(`Q9-QUA-${stockSeq}`, "QUARANTINE", 25)
  await seedFgBalance(`Q9-HLD-${stockSeq}`, "ON_HOLD", 15)
  await seedFgBalance(`Q9-EXP-${stockSeq}`, "EXPIRED", 5)
  await seedFgBalance(`Q9-CON-${stockSeq}`, "CONSUMED", 3)
  await seedFgBalance(`Q9-NOLOT-${stockSeq}`, null, 7)
  let v = (await cross(so.id)).items[0]
  expect(v.stock.shippableQty - base.shippable, "ACTIVE 10 만 가산").toBe(10)
  expect(v.stock.legacyAvailableQty - base.legacy, "기존 계산은 전부(10+25+15+5+3+7=65) 가산").toBe(65)
  expect(v.stock.breakdown.excludedByLotStatus).toMatchObject({ QUARANTINE: base.excluded.QUARANTINE ? base.excluded.QUARANTINE + 25 : 25, ON_HOLD: 15, EXPIRED: 5, CONSUMED: 3 })
  expect(v.stock.breakdown.unassignedForLotTrackedQty - base.unassigned).toBe(7)
  expect(v.shortage.differenceCodes).toEqual(expect.arrayContaining(["STOCK_EXCLUDED_BY_LOT_STATUS", "STOCK_WITHOUT_LOT_EXCLUDED"]))
  // 최종검사 불합격 LOT
  const lot7Qty = (await oracleStock(D.items.fg.id)).shippable
  await new Promise((r) => setTimeout(r, 1100))
  const lot7 = await lotByTag("S7")
  const fgLot7 = lot7.id, fgLot7No = lot7.lotNo
  const op2 = await db().workOrderOperation.findFirstOrThrow({ where: { workOrder: { finishedGoodsReceipts: { some: { lotId: fgLot7 } } }, seq: 2 } })
  const fail = await call(admin, A("createStagedInspection", /inspection-stages\.actions/), [{ workOrderOperationId: op2.id, inspectionSpecId: D.specs.op2, stage: "FINAL", result: "FAIL", inspectedQty: 1 }])
  expect(fail.ok, fail.error ?? "").toBe(true)
  v = (await cross(so.id)).items[0]
  const lot7Avail = Number((await db().inventoryBalance.findFirstOrThrow({ where: { lotId: fgLot7 } })).qtyAvailable)
  expect(v.stock.breakdown.qualityBlockedQty, `LOT ${fgLot7No} 차단`).toBe(lot7Avail)
  expect(lot7Qty - v.stock.shippableQty, "출하 가능에서 해당 LOT 만큼 감소").toBe(lot7Avail)
  expect(v.shortage.differenceCodes).toContain("STOCK_BLOCKED_BY_QUALITY_GATE")
  note("QM-09", { shippable: v.stock.shippableQty, legacy: v.stock.legacyAvailableQty, excluded: v.stock.breakdown.excludedByLotStatus })
})

test("[QM-10][시나리오10] 여러 수주에서 같은 품목 재고 조회 — 같은 재고가 모든 수주에 동일하게 보이고(예약 없음), 서로의 미납이 경합 수량으로만 표시된다", async () => {
  const a = await mkSo(30), b = await mkSo(40)
  const ra = (await cross(a.id)).items[0], rb = (await cross(b.id)).items[0]
  expect(ra.stock.shippableQty).toBe(rb.stock.shippableQty)
  expect([ra.stock.reservation.supported, rb.stock.reservation.supported]).toEqual([false, false])
  const ca = await oracleCompeting(D.items.fg.id, a.itemId), cb = await oracleCompeting(D.items.fg.id, b.itemId)
  expect([ra.stock.competingOutstandingQty, rb.stock.competingOutstandingQty]).toEqual([ca.qty, cb.qty])
  expect(ra.stock.competingOutstandingQty - rb.stock.competingOutstandingQty, "서로의 미납(40−30)만큼 차이").toBe(40 - 30)
  expect(ra.shortage.differenceCodes).toContain("STOCK_SHARED_WITH_OTHER_ORDERS")
  expect(ra.allocatedQty + rb.allocatedQty, "충당은 수주별로 분리").toBe(0)
})

// ───────────────────────── QM-11 ~ QM-14: 입고·중복 ─────────────────────────
test("[QM-11][시나리오11] 생산계획 일부 입고 — ORDER: 미입고 충당 정확, ORDER_EXTRA: 입고가 충당/여유 어느 몫인지 DB 에 없어 구간(추정 없음)으로 표시", async () => {
  const so = await mkSo(100)
  await reqOk(so, 100, { extraQty: 10, extraReason: "부분 입고 시험" })
  const row = (await rowsOf(so.itemId))[0]
  const p = await produce(row.id, 110, "S11", [60])
  let v = (await cross(so.id)).items[0]
  expect([v.receivedQty, v.pendingPlannedReceiptQty, v.workOrderQty]).toEqual([60, 50, 110])
  expect(v.pendingAllocatedReceipt, "입고 60: 충당부터 채워졌다면 40, 여유부터면 50").toEqual({ minQty: 40, maxQty: 50, exact: false })
  expect(v.shortage.differenceCodes).toContain("PENDING_ALLOCATION_RANGE")
  expect(v.shortage.proposed.exact).toBe(v.shortage.proposed.shortageMinQty === v.shortage.proposed.shortageMaxQty)
  const more = await call(admin, A("createFinishedGoodsReceiptAction", /finished-goods\.actions/), [{ workOrderId: p.woId, itemId: D.items.fg.id, siteId: D.site.id, warehouseId: D.warehouses.fg.id, receiptQty: 45 }])
  expect(more.value?.ok, more.value?.error).toBe(true)
  v = (await cross(so.id)).items[0]
  expect([v.receivedQty, v.pendingPlannedReceiptQty, v.pendingAllocatedReceipt]).toEqual([105, 5, { minQty: 0, maxQty: 5, exact: false }])
  const so2 = await mkSo(100)
  await reqOk(so2, 100)
  await produce((await rowsOf(so2.itemId))[0].id, 100, "S11B", [60])
  const v2 = (await cross(so2.id)).items[0]
  expect([v2.receivedQty, v2.pendingAllocatedReceipt, v2.pendingPlannedReceiptQty], "ORDER 는 정확").toEqual([60, { minQty: 40, maxQty: 40, exact: true }, 40])
})

test("[QM-12][시나리오12] 생산계획 전량 입고 — 미입고 0(정확)·입고 = 계획, 계획 수량을 넘는 입고는 없다", async () => {
  const so = await mkSo(100)
  await reqOk(so, 100, { extraQty: 10, extraReason: "전량 입고 시험" })
  const p = await produce((await rowsOf(so.itemId))[0].id, 110, "S12", [110])
  const v = (await cross(so.id)).items[0]
  expect([v.receivedQty, v.plannedQty, v.pendingPlannedReceiptQty, v.pendingAllocatedReceipt, v.lines[0].receivedOverPlannedQty]).toEqual([110, 110, 0, { minQty: 0, maxQty: 0, exact: true }, 0])
  expect(v.lines[0].workOrderCount).toBe(1)
  const more = await call(admin, A("createFinishedGoodsReceiptAction", /finished-goods\.actions/), [{ workOrderId: p.woId, itemId: D.items.fg.id, siteId: D.site.id, warehouseId: D.warehouses.fg.id, receiptQty: 1 }])
  expect(more.value?.ok, "전량 입고 후 추가 입고는 서버가 거부").toBe(false)
  note("QM-12", { planStatus: v.lines[0].planStatus, shortfall: v.lines[0].shortfallQty })
})

test("[QM-13][시나리오13] 충당량 중복 계산 방지 — 입고분은 재고에만, 미입고분은 계획에만 잡히고(합 = 충당), 다른 수주·재고 생산의 충당이 섞이지 않는다", async () => {
  const x = await mkSo(100), y = await mkSo(100)
  await reqOk(x, 100); await reqOk(y, 70)
  const stockRow = await createStockPlan(500)
  await produce((await rowsOf(x.itemId))[0].id, 100, "S13", [60])
  const vx = (await cross(x.id)).items[0], vy = (await cross(y.id)).items[0]
  expect([vx.allocatedQty, vy.allocatedQty], "수주별 충당만 합산").toEqual([100, 70])
  expect(vx.lines.every((l: any) => l.salesOrderItemId === x.itemId), "다른 수주·재고 생산 줄이 섞이지 않음").toBe(true)
  expect(vx.receivedQty + vx.pendingAllocatedReceipt.maxQty, "입고 60 + 미입고 40 = 충당 100 (겹치지 않음)").toBe(100)
  const s = await oracleStock(D.items.fg.id)
  expect(vx.shortage.proposed.shortageMaxQty).toBeCloseTo(Math.max(0, 100 - s.shippable - 40), 6)
  // 단순히 재고와 전체 충당을 함께 빼는 계산(이중 차감)과의 차이를 기록
  note("QM-13", { naiveDoubleCount: Math.max(0, 100 - s.shippable - 100), proposed: vx.shortage.proposed, legacy: vx.shortage.legacy })
  const pv = (await planQ(admin, [stockRow.planId]))[0]
  expect(pv.lines[0].order).toBeNull()
  expect(pv.totals.allocatedQty).toBe(0)
})

test("[QM-14][시나리오14] 동일 품목에 여러 생산계획 연결 — 같은 수주 품목 30+30+40 은 모두 합산, 계획 화면 모델은 '다른 줄 충당'을 줄별로 분리", async () => {
  const so = await mkSo(100)
  await reqOk(so, 30); await reqOk(so, 30); await reqOk(so, 40, { extraQty: 5, extraReason: "복수 계획" })
  const other = await mkSo(100)
  await reqOk(other, 20)
  const v = (await cross(so.id)).items[0]
  expect([v.allocatedQty, v.plannedQty, v.extraQty, v.unallocatedQty, v.lines.length]).toEqual([100, 105, 5, 0, 3])
  expect(v.lines.map((l: any) => l.productionKind).sort()).toEqual(["ORDER", "ORDER", "ORDER_EXTRA"])
  const rows = await rowsOf(so.itemId)
  const pvs = await planQ(admin, rows.map((r) => r.planId))
  const byPlan = new Map<string, any>(pvs.map((p: any) => [p.planId as string, p]))
  for (const r of rows) {
    const line = byPlan.get(r.planId).lines[0]
    expect([line.order.allocatedAllPlansQty, line.order.allocatedByOtherLinesQty, line.order.allocatableMoreQty], `${r.plan.planNo} 맥락`).toEqual([100, 100 - num(r.allocatedQty), 0])
  }
  expect((await cross(other.id)).items[0].allocatedQty, "다른 수주 충당 20 은 섞이지 않음").toBe(20)
  const all = await planQ(admin)
  expect(all.length, "전체 계획 조회").toBeGreaterThanOrEqual(rows.length)
})

// ───────────────────────── QM-15: 비로그인·권한·범위·조회 전용 ─────────────────────────
test("[QM-15][시나리오15] 비로그인 거부·권한 제한 사용자 거부·타 테넌트 비노출·잘못된 입력·조회 전용(DB 불변)", async () => {
  const so = await mkSo(100)
  await reqOk(so, 40)
  const planIds = (await rowsOf(so.itemId)).map((r) => r.planId)
  // 비로그인
  await expect(orderQ(null, so.id)).rejects.toThrow(/UNAUTHORIZED/)
  await expect(planQ(null, planIds)).rejects.toThrow(/UNAUTHORIZED/)
  // 위조/만료 토큰
  await expect(as("nmes_session=not-a-valid-token", () => actions().getSalesOrderProductionQuantities(so.id))).rejects.toThrow(/UNAUTHORIZED/)
  // 읽기 권한이 있는 역할(VIEWER)은 같은 결과
  const v = roleCreds("VIEWER")
  const vl = await apiLogin(v.loginId, v.password)
  const viewer = vl.cookie
  note("QM-15", { viewerLoginStatus: vl.status, hasCookie: !!viewer })
  note("QM-15", { step: "admin/viewer 조회" })
  const adminRes = await orderQ(admin, so.id)
  const viewerRes = await orderQ(viewer, so.id)
  expect(JSON.stringify({ ...viewerRes, generatedAt: 0 })).toBe(JSON.stringify({ ...adminRes, generatedAt: 0 }))
  // 권한 제한: VIEWER 의 PRODUCTION_PLAN READ / SALES_ORDER READ 를 각각 끈 상태
  for (const resource of ["PRODUCTION_PLAN", "SALES_ORDER"]) {
    const rows = await db().rolePermission.findMany({ where: { tenantId: T, role: "VIEWER", resource, action: "READ" } })
    expect(rows.length, `${resource}:READ 권한 행`).toBeGreaterThan(0)
    await db().rolePermission.updateMany({ where: { tenantId: T, role: "VIEWER", resource, action: "READ" }, data: { isAllowed: false } })
    try {
      await expect(orderQ(viewer, so.id), `${resource} READ 없음 → 수주 수량 조회 거부`).rejects.toThrow(/권한|UNAUTHORIZED/)
      await expect(planQ(viewer, planIds), `${resource} READ 없음 → 계획 수량 조회 거부`).rejects.toThrow(/권한|UNAUTHORIZED/)
    } finally {
      await db().rolePermission.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { isAllowed: rows[0].isAllowed } })
    }
  }
  expect((await orderQ(viewer, so.id))!.items[0].allocatedQty, "권한 복원 후 다시 조회 가능").toBe(40)
  // 타 테넌트: T2 사용자가 T1 수주·계획 ID 로 조회하면 존재 여부를 알 수 없다
  const t2 = roleCreds("T2OWNER")
  const T2 = "e2e-tenant-002"
  const cred = await db().userCredential.findUniqueOrThrow({ where: { tenantId_loginId: { tenantId: T2, loginId: t2.loginId } } })
  const prof = await db().profile.findUniqueOrThrow({ where: { id: cred.profileId } })
  const t2k = "nmes-session=" + signToken({ profileId: cred.profileId, tenantId: T2, loginId: cred.loginId, name: prof.name, role: "OWNER", email: prof.email })
  const t2all = await planQ(t2k) // 테넌트 2 의 전체 계획 조회에는 테넌트 1 계획이 하나도 없다(테넌트 2 자체 샘플 계획만)
  expect(t2all.every((p: any) => !planIds.includes(p.planId)), "T2 전체 조회에 T1 계획 없음").toBe(true)
  expect(t2all.length, "T2 자체 데이터는 보임").toBeGreaterThan(0)
  expect(await orderQ(t2k, so.id)).toBeNull()
  expect(await planQ(t2k, planIds)).toEqual([])
  // 잘못된 입력
  expect(await orderQ(admin, "")).toBeNull()
  expect(await orderQ(admin, "no-such-id")).toBeNull()
  await expect(planQ(admin, [123 as unknown as string])).rejects.toThrow(/올바르지/)
  await expect(planQ(admin, Array.from({ length: 501 }, (_, i) => `p${i}`))).rejects.toThrow(/올바르지/)
  expect(await planQ(admin, [])).toEqual([])
  // 조회 전용: 위 모든 호출이 DB 를 바꾸지 않았다
  const fp = await fingerprint()
  await orderQ(admin, so.id); await planQ(admin); await planQ(admin, planIds)
  expect(await fingerprint(), "조회는 DB 불변").toBe(fp)
})
