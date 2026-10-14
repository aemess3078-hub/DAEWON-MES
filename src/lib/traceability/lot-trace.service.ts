/**
 * LOT 정/역방향 제조이력 추적 서비스 (Phase 11 / DG-006 · DG-007).
 *
 * 'use server' 파일이 아니다 — 인증/권한은 이 서비스를 호출하는 Server Action(lot-trace.actions.ts)이 담당하고,
 * 이 모듈은 이미 확정된 tenantId 로만 동작한다.
 *
 * Source of Truth = 기존 DB 관계(새 모델/중복 복사 없음):
 *   공급사(BusinessPartner) → 발주(PurchaseOrder) → 입고 InventoryTransaction(RECEIPT, refType=PURCHASE_ORDER)
 *     → 원자재 LOT → WorkOrderMaterialLot(materialLotNo · inventoryTransactionId) → WorkOrder
 *     → FinishedGoodsReceipt(workOrderId · lotId) → 완제품 LOT → ShipmentItem(lotId) → ShipmentOrder → SalesOrder.customer
 *   (+ LotGenealogy 가 있으면 LOT↔LOT 간선으로 함께 따라간다)
 *
 * 쿼리 전략: 노드별 조회(N+1) 금지. 한 단계(depth)마다 테이블별 1회 `in` 배치 조회만 한다.
 *   쿼리 수는 LOT/작업지시 개수와 무관하게 (단계 수 × 상수) 이다. 방문 집합으로 cycle 에 무한루프하지 않는다.
 * 모든 조회는 tenantId 로 한정하고, tenantId 컬럼이 없는 테이블은 tenant 로 확정된 부모 id 로만 접근한다.
 */

export type TraceDirection = "FORWARD" | "REVERSE" | "BOTH"

export type TraceNodeType =
  | "SUPPLIER"
  | "PURCHASE_ORDER"
  | "RAW_LOT"
  | "SEMI_LOT"
  | "FINISHED_LOT"
  | "OTHER_LOT"
  | "PRODUCTION_PLAN"
  | "WORK_ORDER"
  | "SHIPMENT"
  | "CUSTOMER"

export type TraceRelationship =
  | "SUPPLIES"
  | "RECEIVED_AS"
  | "CONSUMED_BY"
  | "PRODUCED"
  | "GENEALOGY"
  | "SHIPPED_IN"
  | "DELIVERED_TO"
  | "PLANNED"

/** DTO/ViewModel — DB 모델이 아니다. */
export type TraceNode = {
  id: string
  type: TraceNodeType
  refId: string
  code: string
  label: string
  date: string | null
  status: string | null
  qty: number | null
}

export type TraceEdge = {
  from: string
  to: string
  relationship: TraceRelationship
  qty: number | null
}

export type TraceMissingCode =
  | "SUPPLIER"
  | "WORK_ORDER"
  | "ROUTING"
  | "EQUIPMENT"
  | "OPERATOR"
  | "INSPECTION"
  | "SHIPMENT"

/** 데이터가 없어서 못 이은 구간 — Trace 전체를 깨뜨리지 않고 "알려진 누락"으로 표현한다. */
export type TraceMissing = { code: TraceMissingCode; ref: string; message: string }

export type TraceWorkOrderDetail = {
  nodeId: string
  workOrderId: string
  orderNo: string
  manufacturingNo: string | null
  status: string
  plannedQty: number
  item: { code: string; name: string } | null
  plan: { planNo: string } | null
  operations: Array<{
    seq: number
    name: string
    status: string
    completedQty: number
    equipment: Array<{ code: string; name: string }>
    results: Array<{
      goodQty: number
      defectQty: number
      reworkQty: number
      startedAt: string | null
      endedAt: string | null
      operator: { name: string } | null
      equipment: { code: string; name: string } | null
    }>
    inspections: Array<{
      id: string
      stage: string
      result: string | null
      inspectedQty: number
      inspectedAt: string
      inspector: { name: string } | null
      attribution: "LOT" | "WORK_ORDER"
    }>
  }>
}

export type TraceLotSummary = {
  nodeId: string
  lotId: string
  lotNo: string
  status: string
  role: "RAW" | "SEMI" | "FINISHED" | "OTHER"
  item: { code: string; name: string; itemType: string }
}

export type TraceResult = {
  direction: TraceDirection
  start: Array<{ nodeId: string; lotNo: string }>
  nodes: TraceNode[]
  edges: TraceEdge[]
  lots: TraceLotSummary[]
  workOrders: TraceWorkOrderDetail[]
  missing: TraceMissing[]
  truncated: boolean
}

// ─── DB 접근 계약(prisma 와 테스트용 fake 모두 만족) ──────────────────────────

type Delegate = { findMany(args: any): Promise<any[]>; findFirst(args: any): Promise<any | null> }
export type TraceDb = {
  lot: Delegate
  lotGenealogy: Delegate
  finishedGoodsReceipt: Delegate
  workOrderMaterialLot: Delegate
  inventoryTransaction: Delegate
  purchaseOrder: Delegate
  businessPartner: Delegate
  item: Delegate
  workOrder: Delegate
  workOrderOperation: Delegate
  workOrderOperationAssignment: Delegate
  routingOperation: Delegate
  productionResult: Delegate
  equipment: Delegate
  profile: Delegate
  qualityInspection: Delegate
  productionPlanItem: Delegate
  productionPlan: Delegate
  shipmentItem: Delegate
  shipmentOrder: Delegate
  salesOrder: Delegate
}

export const TRACE_LIMITS = {
  MAX_DEPTH: 6,
  MAX_LOTS: 500,
  MAX_WORK_ORDERS: 200,
  IN_CHUNK: 1000,
} as const

const num = (v: unknown) => Number(v ?? 0)
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null)
const uniq = <T,>(values: Array<T | null | undefined>): T[] => Array.from(new Set(values.filter((v): v is T => v !== null && v !== undefined)))

async function findManyIn<T = any>(
  delegate: Delegate,
  field: string,
  ids: string[],
  base: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<T[]> {
  if (ids.length === 0) return []
  const out: T[] = []
  for (let i = 0; i < ids.length; i += TRACE_LIMITS.IN_CHUNK) {
    const slice = ids.slice(i, i + TRACE_LIMITS.IN_CHUNK)
    out.push(...((await delegate.findMany({ where: { ...base, [field]: { in: slice } }, ...extra })) as T[]))
  }
  return out
}

const lotRole = (itemType: string | null | undefined): TraceLotSummary["role"] =>
  itemType === "RAW_MATERIAL" ? "RAW" : itemType === "SEMI_FINISHED" ? "SEMI" : itemType === "FINISHED" ? "FINISHED" : "OTHER"

const lotNodeType = (role: TraceLotSummary["role"]): TraceNodeType =>
  role === "RAW" ? "RAW_LOT" : role === "SEMI" ? "SEMI_LOT" : role === "FINISHED" ? "FINISHED_LOT" : "OTHER_LOT"

// ─── 핵심: LOT 집합에서 출발하는 추적 ─────────────────────────────────────────

export async function traceFromLots(
  db: TraceDb,
  tenantId: string,
  startLotIds: string[],
  direction: TraceDirection,
  options: { extraNodes?: TraceNode[]; extraEdges?: TraceEdge[] } = {},
): Promise<TraceResult | null> {
  const tenantWhere = { tenantId }
  const startLots = await findManyIn<any>(db.lot, "id", uniq(startLotIds), tenantWhere)
  if (startLots.length === 0) return null

  const lotById = new Map<string, any>(startLots.map((l) => [l.id, l]))
  const woIds = new Set<string>()
  const womlRows = new Map<string, any>()
  const fgrRows = new Map<string, any>()
  const genealogy = new Map<string, any>()
  let truncated = false

  const wantReverse = direction === "REVERSE" || direction === "BOTH"
  const wantForward = direction === "FORWARD" || direction === "BOTH"

  let frontier = startLots.map((l) => l.id as string)
  const visited = new Set<string>(frontier)

  for (let depth = 0; depth < TRACE_LIMITS.MAX_DEPTH && frontier.length > 0; depth += 1) {
    const frontierLots = frontier.map((id) => lotById.get(id)).filter(Boolean)
    const frontierLotNos = frontierLots.map((l) => l.lotNo as string)
    const nextLotIds = new Set<string>()
    const reachedWoIds = new Set<string>()

    // 1) 이 LOT 를 만든 작업지시(역방향) / 이 LOT 를 투입한 작업지시(정방향)
    if (wantReverse) {
      const produced = await findManyIn<any>(db.finishedGoodsReceipt, "lotId", frontier, tenantWhere)
      for (const r of produced) {
        fgrRows.set(r.id, r)
        reachedWoIds.add(r.workOrderId)
      }
    }
    if (wantForward) {
      const consumed = await findManyIn<any>(db.workOrderMaterialLot, "materialLotNo", frontierLotNos, tenantWhere)
      for (const m of consumed) {
        womlRows.set(m.id, m)
        reachedWoIds.add(m.workOrderId)
      }
    }

    // 2) LotGenealogy(있을 때만): 부모/자식 LOT
    if (wantReverse) {
      for (const g of await findManyIn<any>(db.lotGenealogy, "childLotId", frontier, {})) {
        genealogy.set(g.id ?? `${g.parentLotId}>${g.childLotId}>${g.relationType}`, g)
        if (!visited.has(g.parentLotId)) nextLotIds.add(g.parentLotId)
      }
    }
    if (wantForward) {
      for (const g of await findManyIn<any>(db.lotGenealogy, "parentLotId", frontier, {})) {
        genealogy.set(g.id ?? `${g.parentLotId}>${g.childLotId}>${g.relationType}`, g)
        if (!visited.has(g.childLotId)) nextLotIds.add(g.childLotId)
      }
    }

    // 3) 도달한 작업지시의 반대편 LOT 확장
    const newWoIds = Array.from(reachedWoIds).filter((id) => !woIds.has(id))
    for (const id of newWoIds) woIds.add(id)
    if (woIds.size > TRACE_LIMITS.MAX_WORK_ORDERS) {
      truncated = true
      break
    }
    if (newWoIds.length > 0) {
      if (wantReverse) {
        // 완제품 → 작업지시 → 투입 원자재 LOT
        const consumed = await findManyIn<any>(db.workOrderMaterialLot, "workOrderId", newWoIds, tenantWhere)
        const txIds = uniq(consumed.map((m) => m.inventoryTransactionId as string | null))
        const txs = await findManyIn<any>(db.inventoryTransaction, "id", txIds, tenantWhere)
        const lotIdByTx = new Map<string, string>(txs.filter((t) => t.lotId).map((t) => [t.id, t.lotId]))
        const unresolvedNos: string[] = []
        for (const m of consumed) {
          womlRows.set(m.id, m)
          const lotId = m.inventoryTransactionId ? lotIdByTx.get(m.inventoryTransactionId) : undefined
          if (lotId) m.__lotId = lotId
          else unresolvedNos.push(m.materialLotNo)
        }
        const byNo = await findManyIn<any>(db.lot, "lotNo", uniq(unresolvedNos), tenantWhere)
        const idByNo = new Map<string, string>(byNo.map((l) => [l.lotNo, l.id]))
        for (const m of consumed) {
          if (!m.__lotId) m.__lotId = idByNo.get(m.materialLotNo)
          if (m.__lotId && !visited.has(m.__lotId)) nextLotIds.add(m.__lotId)
        }
      }
      if (wantForward) {
        // 원자재 → 작업지시 → 완제품 LOT
        const produced = await findManyIn<any>(db.finishedGoodsReceipt, "workOrderId", newWoIds, tenantWhere)
        for (const r of produced) {
          fgrRows.set(r.id, r)
          if (r.lotId && !visited.has(r.lotId)) nextLotIds.add(r.lotId)
        }
      }
    }

    // 4) 새 LOT 로드(tenant 한정) 후 다음 단계 frontier
    const toLoad = Array.from(nextLotIds).filter((id) => !lotById.has(id))
    const loaded = await findManyIn<any>(db.lot, "id", toLoad, tenantWhere)
    const nextFrontier: string[] = []
    for (const l of loaded) {
      if (lotById.size >= TRACE_LIMITS.MAX_LOTS) {
        truncated = true
        break
      }
      lotById.set(l.id, l)
      if (!visited.has(l.id)) {
        visited.add(l.id)
        nextFrontier.push(l.id)
      }
    }
    frontier = nextFrontier
  }

  // 작업지시가 있으면 반대편 자료(투입/입고)를 한 번 더 보충한다: 정방향으로 시작했어도 WO 의 입고/투입 내역을 상세에 쓴다.
  const allWoIds = Array.from(woIds)
  if (allWoIds.length > 0) {
    if (womlRows.size === 0 || !wantReverse) {
      for (const m of await findManyIn<any>(db.workOrderMaterialLot, "workOrderId", allWoIds, tenantWhere)) {
        if (!womlRows.has(m.id)) womlRows.set(m.id, m)
      }
    }
    if (fgrRows.size === 0 || !wantForward) {
      for (const r of await findManyIn<any>(db.finishedGoodsReceipt, "workOrderId", allWoIds, tenantWhere)) {
        if (!fgrRows.has(r.id)) fgrRows.set(r.id, r)
      }
    }
  }

  // ── LOT 품목 정보 ─────────────────────────────────────────────────────────
  const allLotIds = Array.from(lotById.keys())
  const lotItemIds = uniq(Array.from(lotById.values()).map((l) => l.itemId as string))
  const itemRows = await findManyIn<any>(db.item, "id", lotItemIds, tenantWhere)
  const itemById = new Map<string, any>(itemRows.map((i) => [i.id, i]))

  // ── 입고(공급사) · 출하(고객) ─────────────────────────────────────────────
  const lotTxs = await findManyIn<any>(db.inventoryTransaction, "lotId", allLotIds, tenantWhere)
  const poReceipts = lotTxs.filter((t) => t.txType === "RECEIPT" && t.refType === "PURCHASE_ORDER" && t.refId)
  const poRows = await findManyIn<any>(db.purchaseOrder, "id", uniq(poReceipts.map((t) => t.refId as string)), tenantWhere)
  const poById = new Map<string, any>(poRows.map((p) => [p.id, p]))
  const supplierRows = await findManyIn<any>(db.businessPartner, "id", uniq(poRows.map((p) => p.supplierId as string)), tenantWhere)
  const supplierById = new Map<string, any>(supplierRows.map((s) => [s.id, s]))

  const shipItems = await findManyIn<any>(db.shipmentItem, "lotId", allLotIds, {})
  const shipOrderRows = await findManyIn<any>(db.shipmentOrder, "id", uniq(shipItems.map((s) => s.shipmentOrderId as string)), tenantWhere)
  const shipOrderById = new Map<string, any>(shipOrderRows.map((s) => [s.id, s]))
  const salesOrderRows = await findManyIn<any>(db.salesOrder, "id", uniq(shipOrderRows.map((s) => s.salesOrderId as string)), tenantWhere)
  const salesOrderById = new Map<string, any>(salesOrderRows.map((s) => [s.id, s]))
  const customerRows = await findManyIn<any>(db.businessPartner, "id", uniq(salesOrderRows.map((s) => s.customerId as string)), tenantWhere)
  const customerById = new Map<string, any>(customerRows.map((c) => [c.id, c]))

  // ── 작업지시 상세(공정 · 설비 · 작업자 · 실적 · 검사) ─────────────────────
  const woRows = await findManyIn<any>(db.workOrder, "id", allWoIds, tenantWhere)
  const woById = new Map<string, any>(woRows.map((w) => [w.id, w]))
  const woItemRows = await findManyIn<any>(db.item, "id", uniq(woRows.map((w) => w.itemId as string)), tenantWhere)
  for (const i of woItemRows) itemById.set(i.id, i)
  const planItemRows = await findManyIn<any>(db.productionPlanItem, "id", uniq(woRows.map((w) => w.productionPlanItemId as string | null)), {})
  const planRows = await findManyIn<any>(db.productionPlan, "id", uniq(planItemRows.map((p) => p.planId as string)), tenantWhere)
  const planById = new Map<string, any>(planRows.map((p) => [p.id, p]))
  const planByItemId = new Map<string, any>(planItemRows.map((p) => [p.id, planById.get(p.planId)]))

  const opRows = await findManyIn<any>(db.workOrderOperation, "workOrderId", Array.from(woById.keys()), {})
  const opIds = opRows.map((o) => o.id as string)
  const routingOpRows = await findManyIn<any>(db.routingOperation, "id", uniq(opRows.map((o) => o.routingOperationId as string)), {})
  const routingOpById = new Map<string, any>(routingOpRows.map((r) => [r.id, r]))
  const assignmentRows = await findManyIn<any>(db.workOrderOperationAssignment, "workOrderOperationId", opIds, tenantWhere)
  const resultRows = await findManyIn<any>(db.productionResult, "workOrderOperationId", opIds, {})
  const inspectionRows = await findManyIn<any>(db.qualityInspection, "workOrderOperationId", opIds, {})

  const equipmentIds = uniq([
    ...opRows.map((o) => o.equipmentId as string | null),
    ...assignmentRows.map((a) => a.equipmentId as string | null),
  ])
  const equipmentRows = await findManyIn<any>(db.equipment, "id", equipmentIds, tenantWhere)
  const equipmentById = new Map<string, any>(equipmentRows.map((e) => [e.id, e]))
  const profileIds = uniq([
    ...resultRows.map((r) => r.operatorId as string | null),
    ...inspectionRows.map((i) => i.inspectorId as string | null),
  ])
  const profileRows = await findManyIn<any>(db.profile, "id", profileIds, {})
  const profileById = new Map<string, any>(profileRows.map((p) => [p.id, p]))

  // ── 그래프 조립 ──────────────────────────────────────────────────────────
  const nodes = new Map<string, TraceNode>()
  const edges = new Map<string, TraceEdge>()
  const addNode = (n: TraceNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n)
  }
  const addEdge = (from: string, to: string, relationship: TraceRelationship, qty: number | null) => {
    const key = `${from}>${to}>${relationship}`
    const prev = edges.get(key)
    if (prev) prev.qty = (prev.qty ?? 0) + (qty ?? 0)
    else edges.set(key, { from, to, relationship, qty })
  }
  const missing: TraceMissing[] = []

  const lotSummaries: TraceLotSummary[] = []
  const lotNodeId = (lotId: string) => `LOT:${lotId}`
  for (const lot of Array.from(lotById.values())) {
    const item = itemById.get(lot.itemId)
    const role = lotRole(item?.itemType)
    const nodeId = lotNodeId(lot.id)
    addNode({
      id: nodeId,
      type: lotNodeType(role),
      refId: lot.id,
      code: lot.lotNo,
      label: item?.name ?? "(품목 정보 없음)",
      date: iso(lot.createdAt),
      status: lot.status ?? null,
      qty: null,
    })
    lotSummaries.push({
      nodeId,
      lotId: lot.id,
      lotNo: lot.lotNo,
      status: lot.status,
      role,
      item: { code: item?.code ?? "", name: item?.name ?? "", itemType: item?.itemType ?? "" },
    })
  }

  // 공급사 → 발주 → 원자재 LOT
  const receiptByLot = new Set<string>()
  for (const tx of poReceipts) {
    const po = poById.get(tx.refId)
    const lot = lotById.get(tx.lotId)
    if (!po || !lot) continue
    const poNode = `PURCHASE_ORDER:${po.id}`
    addNode({ id: poNode, type: "PURCHASE_ORDER", refId: po.id, code: po.orderNo, label: "발주", date: iso(po.orderDate), status: po.status ?? null, qty: null })
    addEdge(poNode, lotNodeId(lot.id), "RECEIVED_AS", num(tx.qty))
    receiptByLot.add(lot.id)
    const supplier = supplierById.get(po.supplierId)
    if (supplier) {
      const supNode = `SUPPLIER:${supplier.id}`
      addNode({ id: supNode, type: "SUPPLIER", refId: supplier.id, code: supplier.code, label: supplier.name, date: null, status: null, qty: null })
      addEdge(supNode, poNode, "SUPPLIES", null)
    }
  }
  for (const s of lotSummaries) {
    if (s.role === "RAW" && !receiptByLot.has(s.lotId)) {
      missing.push({ code: "SUPPLIER", ref: s.lotNo, message: `원자재 LOT ${s.lotNo}: 발주 연결 입고 이력이 없어 공급사를 알 수 없습니다.` })
    }
  }

  // 투입(원자재 LOT → 작업지시)
  const issuedQtyByLotWo = new Map<string, number>()
  const lotIdByNo = new Map<string, string>(Array.from(lotById.values()).map((l) => [l.lotNo as string, l.id as string]))
  for (const m of Array.from(womlRows.values())) {
    const lotId: string | undefined = m.__lotId ?? lotIdByNo.get(m.materialLotNo)
    if (!lotId || !woById.has(m.workOrderId)) continue
    const key = `${lotId}>${m.workOrderId}`
    issuedQtyByLotWo.set(key, (issuedQtyByLotWo.get(key) ?? 0) + num(m.qty))
  }
  for (const [key, qty] of Array.from(issuedQtyByLotWo.entries())) {
    const [lotId, woId] = key.split(">")
    if (lotById.has(lotId)) addEdge(lotNodeId(lotId), `WORK_ORDER:${woId}`, "CONSUMED_BY", qty)
  }

  // 작업지시 노드 + 생산계획 + 완제품 LOT
  for (const wo of Array.from(woById.values())) {
    const nodeId = `WORK_ORDER:${wo.id}`
    const item = itemById.get(wo.itemId)
    addNode({
      id: nodeId,
      type: "WORK_ORDER",
      refId: wo.id,
      code: wo.orderNo,
      label: item?.name ?? "작업지시",
      date: iso(wo.createdAt),
      status: wo.status ?? null,
      qty: num(wo.plannedQty),
    })
    const plan = wo.productionPlanItemId ? planByItemId.get(wo.productionPlanItemId) : null
    if (plan) {
      const planNode = `PRODUCTION_PLAN:${plan.id}`
      addNode({ id: planNode, type: "PRODUCTION_PLAN", refId: plan.id, code: plan.planNo, label: "생산계획", date: iso(plan.startDate), status: plan.status ?? null, qty: null })
      addEdge(planNode, nodeId, "PLANNED", null)
    }
  }
  for (const r of Array.from(fgrRows.values())) {
    if (!r.lotId || !lotById.has(r.lotId) || !woById.has(r.workOrderId)) continue
    addEdge(`WORK_ORDER:${r.workOrderId}`, lotNodeId(r.lotId), "PRODUCED", num(r.receiptQty))
  }
  for (const g of Array.from(genealogy.values())) {
    if (lotById.has(g.parentLotId) && lotById.has(g.childLotId)) {
      addEdge(lotNodeId(g.parentLotId), lotNodeId(g.childLotId), "GENEALOGY", num(g.qty))
    }
  }

  // 완제품 LOT → 출하 → 고객
  const shippedLotIds = new Set<string>()
  for (const si of shipItems) {
    const order = shipOrderById.get(si.shipmentOrderId)
    if (!order || !si.lotId || !lotById.has(si.lotId)) continue
    shippedLotIds.add(si.lotId)
    const shipNode = `SHIPMENT:${order.id}`
    addNode({
      id: shipNode,
      type: "SHIPMENT",
      refId: order.id,
      code: order.shipmentNo,
      label: salesOrderById.get(order.salesOrderId)?.orderNo ?? "출하",
      date: iso(order.shippedDate) ?? iso(order.plannedDate),
      status: order.status ?? null,
      qty: null,
    })
    addEdge(lotNodeId(si.lotId), shipNode, "SHIPPED_IN", num(si.qty))
    const so = salesOrderById.get(order.salesOrderId)
    const customer = so ? customerById.get(so.customerId) : null
    if (customer) {
      const cusNode = `CUSTOMER:${customer.id}`
      addNode({ id: cusNode, type: "CUSTOMER", refId: customer.id, code: customer.code, label: customer.name, date: null, status: null, qty: null })
      addEdge(shipNode, cusNode, "DELIVERED_TO", null)
    }
  }
  for (const s of lotSummaries) {
    if (s.role === "FINISHED" && !shippedLotIds.has(s.lotId)) {
      missing.push({ code: "SHIPMENT", ref: s.lotNo, message: `완제품 LOT ${s.lotNo}: 출하 이력이 없습니다(미출하).` })
    }
  }

  // 작업지시 상세
  const workOrders: TraceWorkOrderDetail[] = []
  const tracedLotIdSet = new Set(allLotIds)
  for (const wo of Array.from(woById.values())) {
    const ops = opRows.filter((o) => o.workOrderId === wo.id).sort((a, b) => num(a.seq) - num(b.seq))
    if (ops.length === 0) {
      missing.push({ code: "ROUTING", ref: wo.orderNo, message: `작업지시 ${wo.orderNo}: 공정 이력이 없습니다.` })
    }
    const opDetails: TraceWorkOrderDetail["operations"] = ops.map((op) => {
      const routingOp = routingOpById.get(op.routingOperationId)
      const assignedEquip = assignmentRows
        .filter((a) => a.workOrderOperationId === op.id)
        .map((a) => equipmentById.get(a.equipmentId))
        .filter(Boolean)
      const opEquip = op.equipmentId ? equipmentById.get(op.equipmentId) : null
      const equipments = uniq<any>([...(opEquip ? [opEquip] : []), ...assignedEquip])
      const results = resultRows
        .filter((r) => r.workOrderOperationId === op.id)
        .map((r) => {
          const assignment = r.workOrderOperationAssignmentId
            ? assignmentRows.find((a) => a.id === r.workOrderOperationAssignmentId)
            : null
          const equip = assignment ? equipmentById.get(assignment.equipmentId) : opEquip
          const operator = r.operatorId ? profileById.get(r.operatorId) : null
          return {
            goodQty: num(r.goodQty),
            defectQty: num(r.defectQty),
            reworkQty: num(r.reworkQty),
            startedAt: iso(r.startedAt),
            endedAt: iso(r.endedAt),
            operator: operator ? { name: operator.name } : null,
            equipment: equip ? { code: equip.code, name: equip.name } : null,
          }
        })
      const inspections = inspectionRows
        .filter((i) => i.workOrderOperationId === op.id)
        .map((i) => ({
          id: i.id as string,
          stage: String(i.stage),
          result: (i.result ?? null) as string | null,
          inspectedQty: num(i.inspectedQty),
          inspectedAt: iso(i.inspectedAt) ?? "",
          inspector: i.inspectorId && profileById.get(i.inspectorId) ? { name: profileById.get(i.inspectorId).name } : null,
          attribution: (i.lotId && tracedLotIdSet.has(i.lotId) ? "LOT" : "WORK_ORDER") as "LOT" | "WORK_ORDER",
        }))
      return {
        seq: num(op.seq),
        name: routingOp?.name ?? `공정 ${num(op.seq)}`,
        status: String(op.status),
        completedQty: num(op.completedQty),
        equipment: equipments.map((e: any) => ({ code: e.code, name: e.name })),
        results,
        inspections,
      }
    })

    if (opDetails.length > 0) {
      if (opDetails.every((o) => o.equipment.length === 0 && o.results.every((r) => !r.equipment))) {
        missing.push({ code: "EQUIPMENT", ref: wo.orderNo, message: `작업지시 ${wo.orderNo}: 설비 이력이 없습니다(설비 마스터/배정 필요).` })
      }
      const anyResult = opDetails.some((o) => o.results.length > 0)
      if (anyResult && opDetails.every((o) => o.results.every((r) => !r.operator))) {
        missing.push({ code: "OPERATOR", ref: wo.orderNo, message: `작업지시 ${wo.orderNo}: 작업자 이력이 없습니다.` })
      }
      if (opDetails.every((o) => o.inspections.length === 0)) {
        missing.push({ code: "INSPECTION", ref: wo.orderNo, message: `작업지시 ${wo.orderNo}: 품질검사 이력이 없습니다(검사표준 미등록 포함).` })
      }
    }

    const item = itemById.get(wo.itemId)
    const plan = wo.productionPlanItemId ? planByItemId.get(wo.productionPlanItemId) : null
    workOrders.push({
      nodeId: `WORK_ORDER:${wo.id}`,
      workOrderId: wo.id,
      orderNo: wo.orderNo,
      manufacturingNo: wo.manufacturingNo ?? null,
      status: String(wo.status),
      plannedQty: num(wo.plannedQty),
      item: item ? { code: item.code, name: item.name } : null,
      plan: plan ? { planNo: plan.planNo } : null,
      operations: opDetails,
    })
  }

  // 완제품 LOT 가 있는데 작업지시와 끊긴 경우 — provenance 단절을 명시한다.
  for (const s of lotSummaries) {
    if (s.role !== "FINISHED") continue
    const hasProducer = Array.from(fgrRows.values()).some((r) => r.lotId === s.lotId && woById.has(r.workOrderId))
    if (!hasProducer && wantReverse) {
      missing.push({ code: "WORK_ORDER", ref: s.lotNo, message: `완제품 LOT ${s.lotNo}: 연결된 작업지시(완제품입고)가 없습니다.` })
    }
  }

  for (const n of options.extraNodes ?? []) addNode(n)
  for (const e of options.extraEdges ?? []) addEdge(e.from, e.to, e.relationship, e.qty)

  const nodeList = Array.from(nodes.values())
  const nodeIds = new Set(nodeList.map((n) => n.id))
  const edgeList = Array.from(edges.values()).filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))

  return {
    direction,
    start: startLots.map((l) => ({ nodeId: lotNodeId(l.id), lotNo: l.lotNo })),
    nodes: nodeList.sort((a, b) => a.id.localeCompare(b.id)),
    edges: edgeList.sort((a, b) => `${a.from}>${a.to}>${a.relationship}`.localeCompare(`${b.from}>${b.to}>${b.relationship}`)),
    lots: lotSummaries.sort((a, b) => a.lotNo.localeCompare(b.lotNo)),
    workOrders: workOrders.sort((a, b) => a.orderNo.localeCompare(b.orderNo)),
    missing,
    truncated,
  }
}

export const traceLotDb = (db: unknown): TraceDb => db as TraceDb
