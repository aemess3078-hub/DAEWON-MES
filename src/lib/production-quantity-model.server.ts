/**
 * 생산 수량 조회 모델 — 서버 로더 (조회 전용)
 *
 * 모든 조회는 tenantId 로 범위를 제한하고, 계획·작업지시·입고·출하·재고를 품목/계획 단위 배치 쿼리로 한 번에 읽는다(행마다 반복 조회 없음).
 * 계산은 순수 모듈(production-quantity-model.ts)이 한다. 이 파일은 쓰기를 하지 않는다.
 *
 * 계획 줄 ↔ 입고 연결: ProductionPlanItem ← WorkOrder.productionPlanItemId ← FinishedGoodsReceipt.workOrderId (DB 참조만 사용, 번호 일치로 추정하지 않음).
 */
import { prisma } from "@/lib/db/prisma"
import type { Prisma } from "@prisma/client"
import { assertLotQualityReleaseAllowed } from "@/lib/actions/quality-release-gate.helpers"
import { DEMAND_ORDER_STATUSES } from "@/lib/mrp/order-mrp-adapter"
import { formatScaledQuantity } from "@/lib/quantity-scale"
import {
  buildItemStockView,
  buildOrderItemQuantityView,
  buildPlanQuantityView,
  sc,
  type ItemStockInput,
  type OrderItemInput,
  type OrderItemQuantityView,
  type PlanLineInput,
  type PlanQuantityView,
  type PlanStatusValue,
} from "@/lib/production-quantity-model"

type Db = typeof prisma | Prisma.TransactionClient

const ZERO = BigInt(0)
const CONFIRMED_SHIPMENT_STATUSES = ["SHIPPED", "DELIVERED"] as const
const fmt = (v: bigint) => formatScaledQuantity(v)

/** 확정된 출하(SHIPPED·DELIVERED)의 수주 품목별 출하 수량. 취소·예정·피킹 출하는 제외 */
async function loadConfirmedShippedBySoi(db: Db, tenantId: string, soiIds: string[]): Promise<Map<string, bigint>> {
  if (soiIds.length === 0) return new Map()
  const rows = await db.shipmentItem.groupBy({
    by: ["salesOrderItemId"],
    where: { salesOrderItemId: { in: soiIds }, shipmentOrder: { tenantId, status: { in: [...CONFIRMED_SHIPMENT_STATUSES] } } },
    _sum: { qty: true },
  })
  return new Map(rows.map((r) => [r.salesOrderItemId, sc(r._sum.qty)]))
}

/** 계획 줄 + 작업지시 수량 + 완제품 입고 수량 (DB 참조 기준) */
async function loadPlanLines(db: Db, tenantId: string, planItemWhere: Prisma.ProductionPlanItemWhereInput): Promise<PlanLineInput[]> {
  const rows = await db.productionPlanItem.findMany({
    where: { AND: [planItemWhere, { plan: { tenantId } }] },
    select: {
      id: true, planId: true, itemId: true, salesOrderItemId: true,
      productionKind: true, plannedQty: true, allocatedQty: true, extraReason: true,
      extraApprovalStatus: true, extraApprovedById: true, extraApprovedAt: true,
      plan: { select: { id: true, planNo: true, status: true } },
    },
    orderBy: [{ plan: { createdAt: "asc" } }, { id: "asc" }],
  })
  if (rows.length === 0) return []
  const wos = await db.workOrder.findMany({
    where: { tenantId, productionPlanItemId: { in: rows.map((r) => r.id) } },
    select: { id: true, productionPlanItemId: true, status: true, plannedQty: true },
  })
  const woIds = wos.map((w) => w.id)
  const [receipts, finalOps] = await Promise.all([
    wos.length
      ? db.finishedGoodsReceipt.groupBy({ by: ["workOrderId"], where: { tenantId, workOrderId: { in: woIds } }, _sum: { receiptQty: true } })
      : Promise.resolve([] as { workOrderId: string; _sum: { receiptQty: unknown } }[]),
    // 완료된 작업지시의 기대 공급 = 마지막 공정 완료 수량
    wos.some((w) => w.status === "COMPLETED")
      ? db.workOrderOperation.findMany({ where: { workOrderId: { in: wos.filter((w) => w.status === "COMPLETED").map((w) => w.id) } }, select: { workOrderId: true, seq: true, completedQty: true } })
      : Promise.resolve([] as { workOrderId: string; seq: number; completedQty: unknown }[]),
  ])
  const receiptByWo = new Map(receipts.map((r) => [r.workOrderId, sc(r._sum.receiptQty as never)]))
  const finalQty = new Map<string, { seq: number; qty: bigint }>()
  for (const op of finalOps) {
    const cur = finalQty.get(op.workOrderId)
    if (!cur || op.seq > cur.seq) finalQty.set(op.workOrderId, { seq: op.seq, qty: sc(op.completedQty as never) })
  }
  const woQty = new Map<string, bigint>(), woCount = new Map<string, number>(), recQty = new Map<string, bigint>(), receivable = new Map<string, bigint>()
  for (const w of wos) {
    const key = w.productionPlanItemId as string
    const received = receiptByWo.get(w.id) ?? ZERO
    recQty.set(key, (recQty.get(key) ?? ZERO) + received) // 취소된 작업지시의 입고도 실제 재고이므로 포함
    if (w.status === "CANCELLED") continue
    woQty.set(key, (woQty.get(key) ?? ZERO) + sc(w.plannedQty))
    woCount.set(key, (woCount.get(key) ?? 0) + 1)
    const expected = w.status === "COMPLETED" ? (finalQty.get(w.id)?.qty ?? sc(w.plannedQty)) : sc(w.plannedQty)
    receivable.set(key, (receivable.get(key) ?? ZERO) + (expected > received ? expected - received : ZERO))
  }
  return rows.map((r) => ({
    planItemId: r.id,
    planId: r.planId,
    planNo: r.plan.planNo,
    planStatus: r.plan.status as PlanStatusValue,
    itemId: r.itemId,
    salesOrderItemId: r.salesOrderItemId,
    productionKind: r.productionKind,
    plannedQty: String(r.plannedQty),
    allocatedQty: String(r.allocatedQty),
    extraReason: r.extraReason,
    extraApprovalStatus: r.extraApprovalStatus,
    extraApprovedById: r.extraApprovedById,
    extraApprovedAt: r.extraApprovedAt,
    workOrderQty: fmt(woQty.get(r.id) ?? ZERO),
    workOrderCount: woCount.get(r.id) ?? 0,
    receivedQty: fmt(recQty.get(r.id) ?? ZERO),
    receivableFromWorkOrdersQty: fmt(receivable.get(r.id) ?? ZERO),
  }))
}

/**
 * 품목별 가용/출하 가능 재고.
 *  - legacyAvailableQty : 기존 부족수량 계산이 쓰는 값(전 창고·전 LOT 상태 qtyAvailable 합)
 *  - shippableQty       : ACTIVE LOT 이고 품질 출고 게이트를 통과한 LOT 의 qtyAvailable − PLANNED 출하 예약.
 *                         LOT 관리 품목이 아니면 LOT 미지정 재고(qtyAvailable − LOT 미지정 PLANNED 예약)도 포함. 격리·보류·소진·만료 LOT 는 제외
 */
async function loadItemStocks(db: Db, tenantId: string, items: Map<string, { isLotTracked: boolean }>): Promise<Map<string, ItemStockInput>> {
  const itemIds = Array.from(items.keys())
  const out = new Map<string, ItemStockInput>()
  if (itemIds.length === 0) return out
  const balances = await db.inventoryBalance.findMany({
    where: { tenantId, itemId: { in: itemIds } },
    select: { itemId: true, lotId: true, qtyAvailable: true, lot: { select: { status: true } } },
  })
  const planned = await db.shipmentItem.groupBy({
    by: ["itemId", "lotId"],
    where: { itemId: { in: itemIds }, shipmentOrder: { tenantId, status: "PLANNED" } },
    _sum: { qty: true },
  })
  const reserved = new Map(planned.map((r) => [`${r.itemId}|${r.lotId ?? ""}`, sc(r._sum.qty)]))

  type Agg = { legacy: bigint; lots: Map<string, bigint>; nonLot: bigint; excluded: Map<string, bigint>; unassigned: bigint }
  const agg = new Map<string, Agg>()
  const lotStatus = new Map<string, string>()
  for (const id of itemIds) agg.set(id, { legacy: ZERO, lots: new Map(), nonLot: ZERO, excluded: new Map(), unassigned: ZERO })
  for (const b of balances) {
    const a = agg.get(b.itemId)!
    const avail = sc(b.qtyAvailable)
    a.legacy += sc(b.qtyAvailable)
    if (avail <= ZERO) continue
    if (b.lotId) {
      const st = b.lot?.status ?? "UNKNOWN"
      if (st !== "ACTIVE") { a.excluded.set(st, (a.excluded.get(st) ?? ZERO) + avail); continue }
      lotStatus.set(b.lotId, st)
      a.lots.set(b.lotId, (a.lots.get(b.lotId) ?? ZERO) + avail)
    } else if (items.get(b.itemId)!.isLotTracked) {
      a.unassigned += avail
    } else {
      a.nonLot += avail
    }
  }

  // 품질 출고 게이트(최종검사 불합격·미검사 LOT 제외) — 가용 수량이 있는 ACTIVE LOT 만 확인
  const quality = new Map<string, boolean>()
  for (const a of Array.from(agg.values())) {
    for (const lotId of Array.from(a.lots.keys())) {
      if (quality.has(lotId)) continue
      try { await assertLotQualityReleaseAllowed(db as typeof prisma, { tenantId, lotId }); quality.set(lotId, true) } catch { quality.set(lotId, false) }
    }
  }

  for (const [itemId, a] of Array.from(agg.entries())) {
    let activeLot = ZERO, blocked = ZERO, shippable = ZERO, plannedReserved = ZERO
    for (const [lotId, avail] of Array.from(a.lots.entries())) {
      activeLot += avail
      if (quality.get(lotId) === false) { blocked += avail; continue }
      const res = reserved.get(`${itemId}|${lotId}`) ?? ZERO
      const reservedWithin = res < avail ? res : avail
      plannedReserved += reservedWithin
      shippable += avail - reservedWithin
    }
    if (a.nonLot > ZERO) {
      const res = reserved.get(`${itemId}|`) ?? ZERO
      const reservedWithin = res < a.nonLot ? res : a.nonLot
      plannedReserved += reservedWithin
      shippable += a.nonLot - reservedWithin
    }
    const excluded: Record<string, string> = {}
    for (const [st, q] of Array.from(a.excluded.entries())) excluded[st] = fmt(q)
    out.set(itemId, {
      itemId,
      legacyAvailableQty: fmt(a.legacy),
      shippableQty: fmt(shippable),
      breakdown: {
        activeLotQty: fmt(activeLot),
        excludedByLotStatus: excluded,
        qualityBlockedQty: fmt(blocked),
        plannedShipmentReservedQty: fmt(plannedReserved),
        unassignedForLotTrackedQty: fmt(a.unassigned),
      },
    })
  }
  return out
}

export type SalesOrderQuantityResult = {
  salesOrderId: string
  orderNo: string
  orderStatus: string
  generatedAt: string
  items: OrderItemQuantityView[]
}

/** 수주 1건의 품목별 수량 모델. 수주가 없거나 다른 테넌트면 null */
export async function loadSalesOrderQuantities(tenantId: string, salesOrderId: string, db: Db = prisma): Promise<SalesOrderQuantityResult | null> {
  const order = await db.salesOrder.findFirst({
    where: { id: salesOrderId, tenantId },
    select: {
      id: true, orderNo: true, status: true,
      customer: { select: { name: true } },
      items: { select: { id: true, itemId: true, qty: true, shippedQty: true, item: { select: { code: true, name: true, uom: true, isLotTracked: true } } }, orderBy: { id: "asc" } },
    },
  })
  if (!order) return null
  const itemMap = new Map(order.items.map((i) => [i.itemId, { isLotTracked: i.item.isLotTracked }]))
  const itemIds = Array.from(itemMap.keys())

  const [planLines, openItems, stocks] = await Promise.all([
    loadPlanLines(db, tenantId, { itemId: { in: itemIds }, plan: { status: { not: "CANCELLED" } } }),
    db.salesOrderItem.findMany({
      where: { itemId: { in: itemIds }, salesOrder: { tenantId, status: { in: [...DEMAND_ORDER_STATUSES] } } },
      select: { id: true, itemId: true, qty: true, salesOrderId: true },
    }),
    loadItemStocks(db, tenantId, itemMap),
  ])
  const shipped = await loadConfirmedShippedBySoi(db, tenantId, Array.from(new Set([...order.items.map((i) => i.id), ...openItems.map((i) => i.id)])))

  const items = order.items.map((soi) => {
    const input: OrderItemInput = {
      salesOrderItemId: soi.id, salesOrderId: order.id, orderNo: order.orderNo, orderStatus: order.status,
      itemId: soi.itemId, itemCode: soi.item.code, itemName: soi.item.name, uom: soi.item.uom, isLotTracked: soi.item.isLotTracked,
      customerName: order.customer?.name ?? null,
      orderedQty: String(soi.qty),
      shippedQtyFromShipments: fmt(shipped.get(soi.id) ?? ZERO),
      shippedQtyColumn: String(soi.shippedQty),
    }
    let competing = ZERO, competingOrders = new Set<string>()
    for (const o of openItems) {
      if (o.itemId !== soi.itemId || o.id === soi.id) continue
      const out = sc(o.qty) - (shipped.get(o.id) ?? ZERO)
      if (out > ZERO) { competing += out; competingOrders.add(o.salesOrderId) }
    }
    const stockInput = stocks.get(soi.itemId)!
    const stockView = buildItemStockView({
      stock: stockInput,
      competingOutstandingQty: fmt(competing),
      competingOrderCount: competingOrders.size,
      independentStockLines: planLines.filter((l) => l.itemId === soi.itemId && l.salesOrderItemId === null),
    })
    return buildOrderItemQuantityView(input, planLines.filter((l) => l.salesOrderItemId === soi.id), stockView)
  })
  return { salesOrderId: order.id, orderNo: order.orderNo, orderStatus: order.status, generatedAt: new Date().toISOString(), items }
}

/** 생산계획별 수량 모델. planIds 를 생략하면 테넌트의 모든 계획(취소 포함, 취소 줄은 합계에서 제외) */
export async function loadPlanQuantities(tenantId: string, planIds?: string[], db: Db = prisma): Promise<PlanQuantityView[]> {
  const plans = await db.productionPlan.findMany({
    where: { tenantId, ...(planIds ? { id: { in: planIds } } : {}) },
    select: { id: true, planNo: true, status: true },
    orderBy: { createdAt: "desc" },
  })
  if (plans.length === 0) return []
  const lines = await loadPlanLines(db, tenantId, { planId: { in: plans.map((p) => p.id) } })
  const soiIds = Array.from(new Set(lines.map((l) => l.salesOrderItemId).filter((v): v is string => v !== null)))
  const soi = soiIds.length
    ? await db.salesOrderItem.findMany({
        where: { id: { in: soiIds }, salesOrder: { tenantId } },
        select: { id: true, salesOrderId: true, itemId: true, qty: true, shippedQty: true, salesOrder: { select: { orderNo: true, status: true, customer: { select: { name: true } } } }, item: { select: { code: true, name: true, uom: true, isLotTracked: true } } },
      })
    : []
  const [shipped, allocRows] = await Promise.all([
    loadConfirmedShippedBySoi(db, tenantId, soiIds),
    soiIds.length
      ? db.productionPlanItem.groupBy({ by: ["salesOrderItemId"], where: { salesOrderItemId: { in: soiIds }, plan: { tenantId, status: { not: "CANCELLED" } } }, _sum: { allocatedQty: true } })
      : Promise.resolve([] as { salesOrderItemId: string | null; _sum: { allocatedQty: unknown } }[]),
  ])
  const allocatedBySoi = new Map<string, bigint>(allocRows.filter((r) => r.salesOrderItemId).map((r) => [r.salesOrderItemId as string, sc(r._sum.allocatedQty as never)]))
  const contexts = new Map<string, OrderItemInput>(soi.map((s) => [s.id, {
    salesOrderItemId: s.id, salesOrderId: s.salesOrderId, orderNo: s.salesOrder.orderNo, orderStatus: s.salesOrder.status,
    itemId: s.itemId, itemCode: s.item.code, itemName: s.item.name, uom: s.item.uom, isLotTracked: s.item.isLotTracked,
    customerName: s.salesOrder.customer?.name ?? null,
    orderedQty: String(s.qty), shippedQtyFromShipments: fmt(shipped.get(s.id) ?? ZERO), shippedQtyColumn: String(s.shippedQty),
  }]))
  return plans.map((p) => buildPlanQuantityView({ planId: p.id, planNo: p.planNo, planStatus: p.status as PlanStatusValue }, lines.filter((l) => l.planId === p.id), contexts, allocatedBySoi))
}
