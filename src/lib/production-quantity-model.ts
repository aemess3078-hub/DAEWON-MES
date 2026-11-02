/**
 * 생산 수량 조회 모델 — 순수 계산 모듈 (DB·React 의존 없음, 서버/테스트 공용)
 *
 * 수주 처리 화면과 생산계획 화면이 같은 수량 정의를 쓰도록 모든 수량을 한 곳에서 계산한다.
 * 조회 전용이다(상태·수량을 바꾸지 않는다). 수량은 소수점 6자리 정수(bigint)로 계산한다.
 *
 * 수량 정의
 *  - 수주 수량(orderedQty)            : SalesOrderItem.qty
 *  - 출하 완료 수량(shippedQty)       : 확정된 출하(SHIPPED·DELIVERED)의 ShipmentItem 수량 합. 취소(CANCELLED)·미확정(PLANNED·PICKED)은 제외
 *  - 수주 미납 수량(outstandingQty)   : max(0, 수주 수량 − 출하 완료 수량)
 *  - 충당 수량(allocatedQty)          : 취소되지 않은 생산계획 줄의 allocatedQty 합 (N-14·N-19 중복 충당 방지와 같은 기준)
 *  - 수주 미충당 수량(unallocatedQty) : max(0, 수주 수량 − 충당 수량) — 더 충당할 수 있는 잔량
 *  - 계획 수량(plannedQty)            : 취소되지 않은 계획 줄의 plannedQty 합 (= 실제 생산 허용량, MRP 기준)
 *  - 여유 수량(extraQty)              : 계획 수량 − 충당 수량 (재고 생산 줄은 충당이 0이므로 계획 전체가 "독립 재고 생산"이며 여유가 아니다)
 *  - 입고 수량(receivedQty)           : 계획 줄 → 작업지시(WorkOrder.productionPlanItemId) → 완제품입고(FinishedGoodsReceipt)의 DB 참조로 산출한 합
 *  - 미입고 예정 수량(pending)        : 앞으로 재고로 들어올 것으로 DB 참조상 확인되는 수량.
 *                                       = Σ 취소되지 않은 작업지시 max(0, 기대 공급 − 입고) + (진행 가능한 계획이면 작업지시에 배정되지 않은 계획 수량)
 *                                       기대 공급: 완료(COMPLETED) 작업지시는 마지막 공정 완료 수량, 그 외는 작업지시 계획 수량. 취소 계획은 0.
 *                                       (완료된 작업지시의 생산분이 아직 입고되지 않은 경우도 미입고에 포함된다)
 *  - 더 입고되지 않는 수량(shortfall)  : max(0, 계획 − 입고 − 미입고 예정) — 완료된 작업지시가 계획보다 적게 생산했거나 완료된 계획에 배정되지 않은 수량
 *  - 미입고 충당 수량(구간)           : 입고분·남은 공급이 충당 몫인지 여유 몫인지는 DB 에 기록되지 않는다. 추정하지 않고 구간으로 낸다.
 *                                       D = 입고 + 미입고 예정, X = 계획 − 충당. 하한 = max(0, max(0, D − X) − min(충당, 입고)), 상한 = min(미입고 예정, 충당, max(0, min(충당, D) − max(0, 입고 − X))).
 *                                       유형이 ORDER 이거나 입고가 0, 또는 더 들어올 수량이 없으면 하한 = 상한(정확).
 *
 * 한계(기록)
 *  - 재고는 특정 수주에 예약되지 않는다. 같은 품목의 재고는 모든 수주 화면에서 똑같이 "사용 가능"으로 보이며, 출하 시점에 LOT 를 골라 소진한다.
 *    PLANNED 출하가 LOT 수량을 예약하는 것(createShipment)만 반영된다.
 *  - 승인 정책은 아직 없다(3단계). 승인 상태 컬럼 값만 그대로 보여 주고 PENDING 을 승인 완료로 보지 않는다.
 */
import { formatScaledQuantity, fromScaledQuantity, toScaledQuantity } from "./quantity-scale"

export type QtyInput = number | string | { toString(): string } | null | undefined
export type PlanStatusValue = "DRAFT" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
export type ProductionKindValue = "ORDER" | "ORDER_EXTRA" | "STOCK"
export type ExtraApprovalStatusValue = "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED"

const ZERO = BigInt(0)
export const sc = (v: QtyInput): bigint => {
  if (v === null || v === undefined) return ZERO
  return toScaledQuantity(typeof v === "number" ? v : String(v)) ?? ZERO
}
const num = (v: bigint) => fromScaledQuantity(v)
const max0 = (v: bigint) => (v > ZERO ? v : ZERO)
const min = (a: bigint, b: bigint) => (a < b ? a : b)

// ─── 입력 행 (서버 로더가 DB 에서 채운다) ────────────────────────────────────────

export type PlanLineInput = {
  planItemId: string
  planId: string
  planNo: string
  planStatus: PlanStatusValue
  itemId: string
  salesOrderItemId: string | null
  productionKind: ProductionKindValue
  plannedQty: QtyInput
  allocatedQty: QtyInput
  extraReason: string | null
  extraApprovalStatus: ExtraApprovalStatusValue
  extraApprovedById?: string | null
  extraApprovedAt?: Date | string | null
  /** 이 계획 줄에 연결된, 취소되지 않은 작업지시의 계획 수량 합 */
  workOrderQty: QtyInput
  workOrderCount: number
  /** 이 계획 줄에 연결된 작업지시의 완제품 입고 수량 합 */
  receivedQty: QtyInput
  /** 취소되지 않은 작업지시별 max(0, 기대 공급 − 입고) 의 합 (기대 공급: 완료 작업지시는 마지막 공정 완료 수량, 그 외는 작업지시 계획 수량) */
  receivableFromWorkOrdersQty: QtyInput
}

export type OrderItemInput = {
  salesOrderItemId: string
  salesOrderId: string
  orderNo: string
  orderStatus: string
  itemId: string
  itemCode: string
  itemName: string
  uom: string
  isLotTracked: boolean
  customerName?: string | null
  orderedQty: QtyInput
  /** 확정된 출하(SHIPPED·DELIVERED)의 출하 품목 수량 합 */
  shippedQtyFromShipments: QtyInput
  /** SalesOrderItem.shippedQty 컬럼 값(기존 부족수량 계산이 쓰는 값) */
  shippedQtyColumn: QtyInput
}

export type ItemStockInput = {
  itemId: string
  /** 기존 부족수량 계산이 쓰는 값: 해당 품목 전 창고·전 LOT 상태의 qtyAvailable 합 */
  legacyAvailableQty: QtyInput
  /** 출하 가능 재고: ACTIVE LOT·품질 출고 가능·PLANNED 출하 예약 차감 후 (LOT 관리 품목이 아니면 LOT 미지정 재고 포함) */
  shippableQty: QtyInput
  breakdown: {
    activeLotQty: QtyInput
    /** LOT 상태별(ACTIVE 제외) 가용 수량 */
    excludedByLotStatus: Record<string, QtyInput>
    /** ACTIVE 이지만 품질 출고 게이트에 걸린 LOT 수량 */
    qualityBlockedQty: QtyInput
    /** PLANNED 출하(예정)가 LOT 별로 예약한 수량(가용 한도 안에서 차감된 만큼) */
    plannedShipmentReservedQty: QtyInput
    /** LOT 관리 품목인데 LOT 가 없는 재고(출하 불가) */
    unassignedForLotTrackedQty: QtyInput
  }
}

// ─── 출력 ───────────────────────────────────────────────────────────────────────

export type ApprovalView = {
  /** DB 컬럼 값 그대로 */
  status: ExtraApprovalStatusValue
  /** 승인 완료로 볼 수 있는 경우만 true (APPROVED). PENDING·NOT_REQUIRED 는 false */
  approved: boolean
  /** 사람이 확인해야 하는 상태(PENDING·REJECTED) */
  needsAttention: boolean
  /** 승인 정책 적용 여부 — 3단계 전이라 항상 false (상태 값은 정책이 설정한 것이 아니다) */
  policyApplied: false
  approvedById: string | null
  approvedAt: string | null
}

export type PendingAllocation = { minQty: number; maxQty: number; exact: boolean }

export type PlanLineView = {
  planItemId: string
  planId: string
  planNo: string
  planStatus: PlanStatusValue
  itemId: string
  salesOrderItemId: string | null
  productionKind: ProductionKindValue
  plannedQty: number
  allocatedQty: number
  extraQty: number
  extraReason: string | null
  workOrderQty: number
  workOrderCount: number
  receivedQty: number
  /** 입고 수량이 계획 수량을 넘은 양(정상 데이터에서는 0) */
  receivedOverPlannedQty: number
  /** 앞으로 입고될 것으로 확인되는 수량(미입고 예정, 취소 계획은 0) */
  pendingPlannedReceiptQty: number
  /** 계획했지만 더 입고되지 않는 수량(완료된 작업지시의 부족 생산, 완료 계획의 미배정분 등) */
  shortfallQty: number
  pendingAllocatedReceipt: PendingAllocation
  /** 이 줄이 충당·계획 합계에 포함되는지(취소 계획 제외) */
  counted: boolean
  approval: ApprovalView
}

export function buildPlanLineView(input: PlanLineInput): PlanLineView {
  const planned = sc(input.plannedQty)
  const allocated = sc(input.allocatedQty)
  const received = sc(input.receivedQty)
  const cancelled = input.planStatus === "CANCELLED"
  const completed = input.planStatus === "COMPLETED"
  const open = !cancelled && !completed
  const linked = input.salesOrderItemId !== null
  const unreleased = open ? max0(planned - sc(input.workOrderQty)) : ZERO
  const pendingPlanned = cancelled ? ZERO : sc(input.receivableFromWorkOrdersQty) + unreleased
  const shortfall = cancelled ? ZERO : max0(planned - received - pendingPlanned)
  let lo = ZERO, hi = ZERO
  if (!cancelled && linked && pendingPlanned > ZERO) {
    const d = received + pendingPlanned // 결국 들어올 총량
    const x = max0(planned - allocated) // 여유 몫
    lo = max0(max0(d - x) - min(allocated, received))
    hi = min(pendingPlanned, min(allocated, max0(min(allocated, d) - max0(received - x))))
    if (lo > hi) lo = hi
  }
  const approval: ApprovalView = {
    status: input.extraApprovalStatus,
    approved: input.extraApprovalStatus === "APPROVED",
    needsAttention: input.extraApprovalStatus === "PENDING" || input.extraApprovalStatus === "REJECTED",
    policyApplied: false,
    approvedById: input.extraApprovedById ?? null,
    approvedAt: input.extraApprovedAt ? new Date(input.extraApprovedAt).toISOString() : null,
  }
  return {
    planItemId: input.planItemId,
    planId: input.planId,
    planNo: input.planNo,
    planStatus: input.planStatus,
    itemId: input.itemId,
    salesOrderItemId: input.salesOrderItemId,
    productionKind: input.productionKind,
    plannedQty: num(planned),
    allocatedQty: num(allocated),
    extraQty: num(max0(planned - allocated)),
    extraReason: input.extraReason,
    workOrderQty: num(sc(input.workOrderQty)),
    workOrderCount: input.workOrderCount,
    receivedQty: num(received),
    receivedOverPlannedQty: num(max0(received - planned)),
    pendingPlannedReceiptQty: num(pendingPlanned),
    shortfallQty: num(shortfall),
    pendingAllocatedReceipt: { minQty: num(lo), maxQty: num(hi), exact: lo === hi },
    counted: !cancelled,
    approval,
  }
}

export type PlanTotals = {
  lineCount: number
  plannedQty: number
  allocatedQty: number
  extraQty: number
  /** 재고 생산(수주 연결 없음) 줄의 계획 수량 — 여유가 아니라 독립 재고 생산 */
  stockProductionQty: number
  receivedQty: number
  pendingPlannedReceiptQty: number
  pendingAllocatedReceipt: PendingAllocation
  approvalCounts: Record<ExtraApprovalStatusValue, number>
  /** 승인 대기·반려가 있는 줄이 있는지(확정 차단은 3단계에서 구현, 여기서는 표시만) */
  hasApprovalAttention: boolean
}

export function sumPlanLines(lines: PlanLineView[]): PlanTotals {
  const counted = lines.filter((l) => l.counted)
  const S = (f: (l: PlanLineView) => number) => {
    let t = ZERO
    for (const l of counted) t += sc(f(l))
    return t
  }
  let lo = ZERO, hi = ZERO
  for (const l of counted) { lo += sc(l.pendingAllocatedReceipt.minQty); hi += sc(l.pendingAllocatedReceipt.maxQty) }
  const approvalCounts: Record<ExtraApprovalStatusValue, number> = { NOT_REQUIRED: 0, PENDING: 0, APPROVED: 0, REJECTED: 0 }
  for (const l of counted) approvalCounts[l.approval.status] += 1
  let stock = ZERO
  for (const l of counted) if (l.salesOrderItemId === null) stock += sc(l.plannedQty)
  return {
    lineCount: counted.length,
    plannedQty: num(S((l) => l.plannedQty)),
    allocatedQty: num(S((l) => l.allocatedQty)),
    extraQty: num(S((l) => (l.salesOrderItemId === null ? 0 : l.extraQty))),
    stockProductionQty: num(stock),
    receivedQty: num(S((l) => l.receivedQty)),
    pendingPlannedReceiptQty: num(S((l) => l.pendingPlannedReceiptQty)),
    pendingAllocatedReceipt: { minQty: num(lo), maxQty: num(hi), exact: lo === hi },
    approvalCounts,
    hasApprovalAttention: approvalCounts.PENDING + approvalCounts.REJECTED > 0,
  }
}

export type ItemStockView = {
  itemId: string
  /** 기존 부족수량 계산이 쓰는 값(참고): 모든 LOT 상태·창고의 qtyAvailable 합 */
  legacyAvailableQty: number
  /** 출하 가능 재고(기준은 breakdown) */
  shippableQty: number
  breakdown: {
    activeLotQty: number
    excludedByLotStatus: Record<string, number>
    qualityBlockedQty: number
    plannedShipmentReservedQty: number
    unassignedForLotTrackedQty: number
  }
  /** 재고 예약 기능 없음 — 어느 수주에도 재고가 확보되었다고 표시하지 않는다 */
  reservation: { supported: false; reservedForThisOrder: null; note: string }
  /** 같은 품목을 기다리는 다른 열린 수주들의 미납 합계(이 재고를 두고 경합) */
  competingOutstandingQty: number
  competingOrderCount: number
  /** 이 품목의 독립 재고 생산(수주 연결 없음) 중 아직 입고되지 않은 계획 수량 */
  independentStockPendingQty: number
}

export const STOCK_NOT_RESERVED_NOTE = "재고 예약 기능이 없어 특정 수주에 확보된 재고가 아닙니다. 같은 품목 재고는 모든 수주에 동일하게 보이며 출하 시점에 LOT 를 골라 소진됩니다."

export type ShortageComparison = {
  /** 기존 계산(checkInventoryForSalesOrder 와 같은 식): max(0, 수주 − SalesOrderItem.shippedQty − 전체 qtyAvailable) */
  legacy: { remainingQty: number; availableStock: number; shortageQty: number }
  /** 신규 계산: max(0, 미납 − 출하 가능 재고 − 미입고 충당) — 미입고 충당이 구간이라 부족수량도 구간 */
  proposed: { outstandingQty: number; shippableStock: number; pendingAllocated: PendingAllocation; shortageMinQty: number; shortageMaxQty: number; exact: boolean }
  /** 새로 요청할 수 있는 충당 수량의 상한 구간: min(부족수량, 수주 미충당 수량) */
  suggestedAllocationQty: { minQty: number; maxQty: number }
  /** proposed − legacy 의 구간 */
  deltaMinQty: number
  deltaMaxQty: number
  differenceCodes: string[]
}

export type OrderItemQuantityView = {
  salesOrderItemId: string
  salesOrderId: string
  orderNo: string
  orderStatus: string
  itemId: string
  itemCode: string
  itemName: string
  uom: string
  isLotTracked: boolean
  orderedQty: number
  shippedQty: number
  shippedQtyColumn: number
  shippedQtySourceMismatch: boolean
  outstandingQty: number
  allocatedQty: number
  unallocatedQty: number
  /** 충당 합계가 수주 수량을 넘은 양(N-19 이전 비정상 데이터 표시용, 정상은 0) */
  overAllocatedQty: number
  plannedQty: number
  extraQty: number
  workOrderQty: number
  receivedQty: number
  pendingPlannedReceiptQty: number
  pendingAllocatedReceipt: PendingAllocation
  totals: PlanTotals
  lines: PlanLineView[]
  stock: ItemStockView
  shortage: ShortageComparison
}

export type ItemContextInput = {
  stock: ItemStockInput
  competingOutstandingQty: QtyInput
  competingOrderCount: number
  /** 이 품목의 모든 활성 계획 줄 중 수주 연결 없는(재고 생산) 줄 */
  independentStockLines: PlanLineInput[]
}

export function buildItemStockView(ctx: ItemContextInput): ItemStockView {
  const b = ctx.stock.breakdown
  const excluded: Record<string, number> = {}
  for (const [k, v] of Object.entries(b.excludedByLotStatus)) excluded[k] = num(sc(v))
  let pending = ZERO
  for (const l of ctx.independentStockLines) pending += sc(buildPlanLineView(l).pendingPlannedReceiptQty)
  return {
    itemId: ctx.stock.itemId,
    legacyAvailableQty: num(sc(ctx.stock.legacyAvailableQty)),
    shippableQty: num(sc(ctx.stock.shippableQty)),
    breakdown: {
      activeLotQty: num(sc(b.activeLotQty)),
      excludedByLotStatus: excluded,
      qualityBlockedQty: num(sc(b.qualityBlockedQty)),
      plannedShipmentReservedQty: num(sc(b.plannedShipmentReservedQty)),
      unassignedForLotTrackedQty: num(sc(b.unassignedForLotTrackedQty)),
    },
    reservation: { supported: false, reservedForThisOrder: null, note: STOCK_NOT_RESERVED_NOTE },
    competingOutstandingQty: num(sc(ctx.competingOutstandingQty)),
    competingOrderCount: ctx.competingOrderCount,
    independentStockPendingQty: num(pending),
  }
}

export function buildOrderItemQuantityView(order: OrderItemInput, lineInputs: PlanLineInput[], stock: ItemStockView): OrderItemQuantityView {
  const ordered = sc(order.orderedQty)
  const shipped = sc(order.shippedQtyFromShipments)
  const shippedCol = sc(order.shippedQtyColumn)
  const outstanding = max0(ordered - shipped)
  const lines = lineInputs.map(buildPlanLineView)
  const totals = sumPlanLines(lines)
  const allocated = sc(totals.allocatedQty)
  const unallocated = max0(ordered - allocated)
  const over = max0(allocated - ordered)
  const pend = totals.pendingAllocatedReceipt

  // 기존 계산(같은 식 — 컬럼 shippedQty, 전체 qtyAvailable)
  const legacyRemaining = max0(ordered - shippedCol)
  const legacyAvail = sc(stock.legacyAvailableQty)
  const legacyShortage = max0(legacyRemaining - legacyAvail)
  // 신규 계산: 서로 겹치지 않는 공급원만 차감한다(입고된 물량은 재고에, 미입고 충당은 계획에, 출하된 물량은 미납에서 이미 빠져 있다)
  const shippable = sc(stock.shippableQty)
  const pendLo = sc(pend.minQty), pendHi = sc(pend.maxQty)
  const shortHi = max0(outstanding - shippable - pendLo) // 미입고 충당이 적게 잡힌 쪽 → 부족이 큰 쪽
  const shortLo = max0(outstanding - shippable - pendHi)
  const deltaLo = shortLo - legacyShortage
  const deltaHi = shortHi - legacyShortage

  const codes: string[] = []
  const excludedTotal = Object.values(stock.breakdown.excludedByLotStatus).reduce((s, v) => s + v, 0)
  if (excludedTotal > 0) codes.push("STOCK_EXCLUDED_BY_LOT_STATUS")
  if (stock.breakdown.qualityBlockedQty > 0) codes.push("STOCK_BLOCKED_BY_QUALITY_GATE")
  if (stock.breakdown.plannedShipmentReservedQty > 0) codes.push("STOCK_RESERVED_BY_PLANNED_SHIPMENT")
  if (stock.breakdown.unassignedForLotTrackedQty > 0) codes.push("STOCK_WITHOUT_LOT_EXCLUDED")
  if (pendHi > ZERO) codes.push("PENDING_ALLOCATION_NOT_IN_LEGACY")
  if (shipped !== shippedCol) codes.push("SHIPPED_QTY_SOURCE_MISMATCH")
  if (over > ZERO) codes.push("OVER_ALLOCATED_LEGACY_DATA")
  if (stock.competingOrderCount > 0) codes.push("STOCK_SHARED_WITH_OTHER_ORDERS")
  if (pendLo !== pendHi) codes.push("PENDING_ALLOCATION_RANGE")

  return {
    salesOrderItemId: order.salesOrderItemId,
    salesOrderId: order.salesOrderId,
    orderNo: order.orderNo,
    orderStatus: order.orderStatus,
    itemId: order.itemId,
    itemCode: order.itemCode,
    itemName: order.itemName,
    uom: order.uom,
    isLotTracked: order.isLotTracked,
    orderedQty: num(ordered),
    shippedQty: num(shipped),
    shippedQtyColumn: num(shippedCol),
    shippedQtySourceMismatch: shipped !== shippedCol,
    outstandingQty: num(outstanding),
    allocatedQty: num(allocated),
    unallocatedQty: num(unallocated),
    overAllocatedQty: num(over),
    plannedQty: totals.plannedQty,
    extraQty: totals.extraQty,
    workOrderQty: num(lines.filter((l) => l.counted).reduce((s, l) => s + sc(l.workOrderQty), ZERO)),
    receivedQty: totals.receivedQty,
    pendingPlannedReceiptQty: totals.pendingPlannedReceiptQty,
    pendingAllocatedReceipt: pend,
    totals,
    lines,
    stock,
    shortage: {
      legacy: { remainingQty: num(legacyRemaining), availableStock: num(legacyAvail), shortageQty: num(legacyShortage) },
      proposed: { outstandingQty: num(outstanding), shippableStock: num(shippable), pendingAllocated: pend, shortageMinQty: num(shortLo), shortageMaxQty: num(shortHi), exact: shortLo === shortHi },
      suggestedAllocationQty: { minQty: num(min(shortLo, unallocated)), maxQty: num(min(shortHi, unallocated)) },
      deltaMinQty: num(deltaLo),
      deltaMaxQty: num(deltaHi),
      differenceCodes: codes,
    },
  }
}

// ─── 생산계획 화면용 ─────────────────────────────────────────────────────────────

export type PlanOrderContext = {
  salesOrderItemId: string
  orderNo: string
  orderStatus: string
  customerName: string | null
  itemCode: string
  orderedQty: number
  shippedQty: number
  outstandingQty: number
  /** 이 수주 품목에 대한 모든 활성 계획의 충당 합 */
  allocatedAllPlansQty: number
  /** 이 줄을 뺀 다른 활성 계획의 충당 합 */
  allocatedByOtherLinesQty: number
  /** 더 충당 가능한 잔량(수주 수량 − 모든 활성 충당) */
  allocatableMoreQty: number
}

export type PlanLineWithOrderView = PlanLineView & { order: PlanOrderContext | null }

export type PlanQuantityView = {
  planId: string
  planNo: string
  planStatus: PlanStatusValue
  /** 한 계획의 줄 유형 요약: 모두 같으면 그 유형, 섞이면 MIXED */
  kindSummary: ProductionKindValue | "MIXED"
  lines: PlanLineWithOrderView[]
  totals: PlanTotals
}

export function buildPlanQuantityView(
  plan: { planId: string; planNo: string; planStatus: PlanStatusValue },
  lineInputs: PlanLineInput[],
  orderContexts: Map<string, OrderItemInput>,
  allocatedBySoi: Map<string, bigint>
): PlanQuantityView {
  const lines: PlanLineWithOrderView[] = lineInputs.map((li) => {
    const v = buildPlanLineView(li)
    let order: PlanOrderContext | null = null
    if (li.salesOrderItemId) {
      const o = orderContexts.get(li.salesOrderItemId)
      if (o) {
        const ordered = sc(o.orderedQty), shipped = sc(o.shippedQtyFromShipments)
        const all = allocatedBySoi.get(li.salesOrderItemId) ?? ZERO
        const own = v.counted ? sc(v.allocatedQty) : ZERO
        order = {
          salesOrderItemId: o.salesOrderItemId,
          orderNo: o.orderNo,
          orderStatus: o.orderStatus,
          customerName: o.customerName ?? null,
          itemCode: o.itemCode,
          orderedQty: num(ordered),
          shippedQty: num(shipped),
          outstandingQty: num(max0(ordered - shipped)),
          allocatedAllPlansQty: num(all),
          allocatedByOtherLinesQty: num(max0(all - own)),
          allocatableMoreQty: num(max0(ordered - all)),
        }
      }
    }
    return { ...v, order }
  })
  const kinds = Array.from(new Set(lines.map((l) => l.productionKind)))
  return {
    planId: plan.planId,
    planNo: plan.planNo,
    planStatus: plan.planStatus,
    kindSummary: kinds.length === 1 ? kinds[0] : kinds.length === 0 ? "STOCK" : "MIXED",
    lines,
    totals: sumPlanLines(lines),
  }
}

export { formatScaledQuantity }
