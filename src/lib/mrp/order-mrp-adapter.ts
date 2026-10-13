/**
 * 수주 기반 MRP 어댑터 (순수 모듈 — DB/Prisma 클라이언트를 import 하지 않는다)
 *
 *   DB 행(plain object) ──> 엔진 입력(OrderMrpInput) ──> runOrderMrp ──> 화면용 View 모델
 *
 * 확정 정책(Phase 2)
 *  - 재고: InventoryBalance.qtyAvailable 합계가 openingStock. qtyOnHand / qtyHold 는 표시 전용.
 *          LOT 상태가 ACTIVE 가 아닌 재고(QUARANTINE, ON_HOLD, EXPIRED, CONSUMED)는 제외.
 *  - 출하잔량: remainingQty = max(0, SalesOrderItem.qty - SalesOrderItem.shippedQty)
 *          shippedQty 는 출하 확정(confirmShipment)에서만 증가한다. PLANNED 출하는 차감하지 않는다.
 *  - BOM: tenant 일치 + status=ACTIVE + isDefault=true 인 BOM 정확히 1개.
 *          0개 → MISSING_DEFAULT_BOM, 2개 이상 → MULTIPLE_DEFAULT_BOM (임의 선택 금지, 계산 제외)
 *  - (Phase 5B) 예정입고: scheduledReceiptRows 와 baseDate 가 모두 주어질 때만 시간축에 반영한다.
 *          분류 규칙은 scheduled-receipt.ts. 주어지지 않으면 기존 계산과 동일하다.
 */

import { runOrderMrp } from "./order-mrp-engine"
import { toDateOnly } from "./period"
import {
  classifyScheduledReceipts,
  type PurchaseOrderItemRow,
  type ScheduledReceiptClassification,
} from "./scheduled-receipt"
import type {
  DateOnly,
  ExcludedOrderLine,
  MrpBomLine,
  MrpDemandLine,
  MrpStockEntry,
  MrpWarning,
  OrderMrpInput,
  OrderMrpResult,
} from "./types"

// ─── DB 행 타입 (실제 schema 필드명) ──────────────────────────────────────────

export type SalesOrderItemRow = {
  id: string
  qty: unknown
  shippedQty: unknown
  deliveryDate: Date | null
  itemId: string
  item: { id: string; code: string; name: string }
  salesOrder: {
    id: string
    orderNo: string
    status: string
    deliveryDate: Date
    customer: { name: string } | null
  }
}

export type BomRow = {
  id: string
  tenantId: string
  itemId: string
  version: string
  status: string
  isDefault: boolean
  bomItems: Array<{
    componentItemId: string
    seq: number
    qtyPer: unknown
    scrapRate: unknown
    componentItem: {
      code: string
      name: string
      spec: string | null
      uom: string
      itemType: string
      /** Phase 5D 품목 안전재고(없으면 0). MRP 물리 재고 계산에는 사용하지 않는다. */
      safetyStock?: unknown
    }
  }>
}

export type InventoryBalanceRow = {
  itemId: string
  qtyOnHand: unknown
  qtyAvailable: unknown
  qtyHold: unknown
  lotId: string | null
  lot: { status: string } | null
}

// ─── 공통 ────────────────────────────────────────────────────────────────────

export type BomIssueCode = "MISSING_DEFAULT_BOM" | "MULTIPLE_DEFAULT_BOM" | "EMPTY_DEFAULT_BOM"

export type AdapterWarningCode =
  | BomIssueCode
  | "COMPONENT_MISSING_DEFAULT_BOM"
  | "COMPONENT_MULTIPLE_DEFAULT_BOM"

export type AdapterWarning = {
  code: AdapterWarningCode
  severity: "WARNING" | "INFO"
  message: string
  itemId: string
  itemCode: string
}

/** MRP 가용재고로 인정하는 LOT 상태. LOT 가 없는 재고(lotId=null)는 항상 인정 */
export const USABLE_LOT_STATUS = "ACTIVE"

/** MRP 수요로 인정하는 수주 상태. DRAFT 는 includeDraft 일 때만 */
export const DEMAND_ORDER_STATUSES = ["CONFIRMED", "IN_PRODUCTION", "PARTIAL_SHIPPED"] as const

export function toNum(value: unknown): number {
  if (typeof value === "number") return value
  if (value === null || value === undefined) return 0
  const n = Number(value as string)
  return Number.isFinite(n) ? n : Number.NaN
}

// ─── 수요 ────────────────────────────────────────────────────────────────────

export function toDemandLines(rows: readonly SalesOrderItemRow[]): MrpDemandLine[] {
  const ordinalByOrder = new Map<string, number>()
  return rows.map((row, index) => {
    const ordinal = (ordinalByOrder.get(row.salesOrder.id) ?? 0) + 1
    ordinalByOrder.set(row.salesOrder.id, ordinal)
    const qty = toNum(row.qty)
    const shipped = toNum(row.shippedQty)
    const status = row.salesOrder.status
    return {
      orderId: row.salesOrder.id,
      orderNo: row.salesOrder.orderNo,
      customerPoNo: null,
      orderLineId: row.id,
      orderLineNo: ordinal,
      itemId: row.itemId,
      itemCode: row.item.code,
      orderQty: qty,
      remainingQty: Number.isFinite(qty) && Number.isFinite(shipped) ? Math.max(0, qty - shipped) : Number.NaN,
      deliveryDate: toDateOnly(row.deliveryDate ?? row.salesOrder.deliveryDate),
      cancelled: status === "CANCELLED",
      completed: status === "SHIPPED" || status === "CLOSED",
      originalIndex: index,
    }
  })
}

// ─── BOM ─────────────────────────────────────────────────────────────────────

export type DefaultBomSelection = {
  /** itemId → 사용할 BOM (정확히 1개일 때만) */
  selected: Map<string, BomRow>
  /** itemId → 문제 유형 (MULTIPLE_DEFAULT_BOM / EMPTY_DEFAULT_BOM) */
  issues: Map<string, BomIssueCode>
}

/**
 * tenant 일치 + ACTIVE + isDefault 인 BOM 만 후보로 본다. DB where 와 별개로 한 번 더 검증(방어적).
 * 후보 0개는 issues 에 넣지 않는다(= 누락). 2개 이상이면 MULTIPLE_DEFAULT_BOM.
 */
export function selectDefaultBoms(rows: readonly BomRow[], tenantId: string): DefaultBomSelection {
  const byItem = new Map<string, BomRow[]>()
  for (const row of rows) {
    if (row.tenantId !== tenantId || row.status !== "ACTIVE" || row.isDefault !== true) continue
    const list = byItem.get(row.itemId)
    if (list) list.push(row)
    else byItem.set(row.itemId, [row])
  }
  const selected = new Map<string, BomRow>()
  const issues = new Map<string, BomIssueCode>()
  byItem.forEach((list, itemId) => {
    if (list.length > 1) {
      issues.set(itemId, "MULTIPLE_DEFAULT_BOM")
    } else if (list[0].bomItems.length === 0) {
      issues.set(itemId, "EMPTY_DEFAULT_BOM")
    } else {
      selected.set(itemId, list[0])
    }
  })
  return { selected, issues }
}

export function toBomLines(selected: ReadonlyMap<string, BomRow>): MrpBomLine[] {
  const lines: MrpBomLine[] = []
  selected.forEach((bom, parentItemId) => {
    for (const bi of bom.bomItems) {
      lines.push({
        parentItemId,
        componentItemId: bi.componentItemId,
        componentCode: bi.componentItem.code,
        componentItemType: bi.componentItem.itemType,
        qtyPer: toNum(bi.qtyPer),
        scrapRate: toNum(bi.scrapRate),
        lineNo: bi.seq,
      })
    }
  })
  return lines
}

// ─── 재고 ────────────────────────────────────────────────────────────────────

export type StockAggregate = {
  qtyOnHand: number
  qtyHold: number
  qtyAvailable: number
  /** 사용 불가 LOT 상태로 제외된 qtyOnHand */
  qtyExcludedByLot: number
}

export function aggregateStock(rows: readonly InventoryBalanceRow[]): Map<string, StockAggregate> {
  const map = new Map<string, StockAggregate>()
  for (const row of rows) {
    let agg = map.get(row.itemId)
    if (!agg) {
      agg = { qtyOnHand: 0, qtyHold: 0, qtyAvailable: 0, qtyExcludedByLot: 0 }
      map.set(row.itemId, agg)
    }
    const usable = row.lotId === null || row.lot === null || row.lot.status === USABLE_LOT_STATUS
    if (!usable) {
      agg.qtyExcludedByLot += toNum(row.qtyOnHand)
      continue
    }
    agg.qtyOnHand += toNum(row.qtyOnHand)
    agg.qtyHold += toNum(row.qtyHold)
    agg.qtyAvailable += toNum(row.qtyAvailable)
  }
  return map
}

/** MRP openingStock = qtyAvailable 합계 (qtyHold 를 다시 빼지 않는다) */
export function toStockEntries(stock: ReadonlyMap<string, StockAggregate>): MrpStockEntry[] {
  return Array.from(stock.entries()).map(([componentItemId, agg]) => ({
    componentItemId,
    quantity: agg.qtyAvailable,
  }))
}

// ─── View 모델 (화면/직렬화용 plain object) ──────────────────────────────────

export type OrderMrpStepView = {
  sequence: number
  orderId: string
  orderNo: string
  orderLineId: string
  customerName: string | null
  itemCode: string
  itemName: string
  deliveryDate: DateOnly | null
  /** 수주 잔량(계산에 사용된 수요 수량) */
  demandQty: number
  /** 제품 1단위당 이 자재의 BOM 소요량 = requirement / demandQty (다단계·스크랩 반영, 소수 6자리) */
  bomQtyPerUnit: number
  /** 이 수주에서 이 자재의 소요량 */
  requirement: number
  balanceBefore: number
  balanceAfter: number
  shortageAtThisDemand: number
  isShortage: boolean
}

export type OrderMrpMaterialView = {
  componentItemId: string
  code: string
  name: string
  spec: string | null
  uom: string
  itemType: string
  qtyOnHand: number
  qtyHold: number
  qtyAvailable: number
  qtyExcludedByLot: number
  totalRequirement: number
  finalBalance: number
  shortageQty: number
  firstShortageDate: DateOnly | null
  firstShortageOrderNo: string | null
  shortageDemandCount: number
  /** 결품을 유발한 PO(수주번호) — 처리 순서, 중복 제거 */
  shortageOrderNos: string[]
  /** 이 자재를 필요로 하는 수주 라인 수 (기간 소요량) */
  demandLineCount: number
  /** 이 자재를 필요로 하는 제품(품목) 종류 수 */
  productCount: number
  /** 이 자재가 처음/마지막으로 필요한 납기일 */
  firstNeedDate: DateOnly | null
  lastNeedDate: DateOnly | null
  /** requirement > 0 인 수주만 (잔량 체인은 0 소요 단계에서 변하지 않으므로 손실 없음) */
  steps: OrderMrpStepView[]
  // ── Phase 5B: 예정입고 / 시간축 (예정입고를 반영하지 않으면 0·null·빈 배열) ──
  /** 계산에 반영된 입고예정 수량 합계 */
  scheduledReceiptQty: number
  scheduledReceiptCount: number
  /** 반영된 입고예정 중 가장 이른 입고일 */
  nextReceiptDate: DateOnly | null
  /** 기간 중 결품이 한 번이라도 있었는가(최종 잔량이 회복돼도 true) */
  hadShortage: boolean
  /** 시간축 최저 잔량의 부족 크기 */
  peakShortageQty: number
  /** 결품 후 입고예정으로 회복되어 최종 예상재고가 0 이상인가(일시 결품) */
  temporaryShortage: boolean
  /** 일시 결품이 입고로 해소된 일자 */
  shortageRecoveredAt: DateOnly | null
  /** 예정일이 지나 가산하지 않은 미입고 잔량 합계/건수 */
  overdueReceiptQty: number
  overdueReceiptCount: number
  /** 입고/수요 이벤트 시간축(예정입고를 반영한 경우에만) */
  timeline: OrderMrpTimelineEventView[]
  /** Phase 5D: 품목 안전재고(구매정책 목표 하한, 0 이상). 물리 재고 계산에는 영향이 없다. */
  safetyStock?: number
}

export type OrderMrpTimelineEventView = {
  type: "SCHEDULED_RECEIPT" | "DEMAND"
  date: DateOnly | null
  /** 입고: 발주번호, 수요: 수주번호 */
  referenceNo: string
  /** 입고: 공급사, 수요: 고객 */
  partyName: string | null
  /** 수요: 제품 코드 */
  itemCode: string | null
  /** 항상 양수 */
  quantity: number
  /** 입고 +, 수요 − */
  signedQuantity: number
  balanceBefore: number
  balanceAfter: number
  isShortage: boolean
  /** 수요 처리 순서 */
  sequence: number | null
}

export type OrderMrpOverdueReceiptView = {
  purchaseOrderNo: string
  supplierName: string | null
  itemCode: string
  itemName: string
  expectedDate: DateOnly
  orderedQty: number
  receivedQty: number
  openQty: number
  daysOverdue: number
}

export type OrderMrpScheduledReceiptsView = {
  /** 예정입고를 계산에 반영했는가 */
  enabled: boolean
  baseDate: DateOnly | null
  /** 계산에 반영된 입고예정 건수(발주 품목 행) / 해당 자재 수 */
  appliedReceiptCount: number
  appliedMaterialCount: number
  /** 예정일 경과로 가산하지 않은 미입고 건(결과 자재 한정) */
  overdue: OrderMrpOverdueReceiptView[]
  /** 외주발주라서 제외한 건수(참고) */
  excludedOutsourcingCount: number
}

export type OrderMrpExcludedLineView = {
  reason: string
  reasonLabel: string
  isBomIssue: boolean
  orderId: string
  orderNo: string
  orderLineId: string
  customerName: string | null
  itemCode: string
  itemName: string
  deliveryDate: DateOnly | null
  orderQty: number
  remainingQty: number | null
}

export type OrderMrpWarningView = {
  code: string
  severity: "WARNING" | "INFO"
  message: string
  orderNo?: string
  itemCode?: string
  relatedOrderLineIds?: string[]
}

export type OrderMrpKpi = {
  /** 계산에 포함된 수주 라인 수 */
  demandLineCount: number
  /** 총 소요량 > 0 인 자재 수 */
  requiredMaterialCount: number
  /** 최종 예상재고 < 0 인 자재 수 */
  shortageMaterialCount: number
  /** 1개 이상 자재에서 결품이 발생한 수주 라인 수 */
  shortageDemandCount: number
  /** 기본 BOM 문제(누락/다중/비어 있음/비정상)로 제외된 수주 라인 수 */
  bomIssueLineCount: number
  /** 계산에 포함된 수주 라인의 고유 제품(품목) 수 */
  productCount: number
  /** (수주 라인 × 자재) 소요 라인 수. 단위가 달라 수량 합계는 만들지 않는다 */
  requirementLineCount: number
  /** Phase 5B: 기간 중 결품이 있었으나 입고예정으로 회복되어 최종 예상재고가 0 이상인 자재 수 */
  temporaryShortageMaterialCount: number
  /** Phase 5B: 입고예정이 계산에 반영된 자재 수 */
  scheduledReceiptMaterialCount: number
  /** Phase 5B: 예정일 경과로 가산하지 않은 미입고 건수 */
  overdueReceiptCount: number
}

export type OrderMrpView = {
  mode: "NORMAL"
  params: { from: DateOnly | null; to: DateOnly | null; includeDraft: boolean }
  kpi: OrderMrpKpi
  materials: OrderMrpMaterialView[]
  /** Phase 5B 예정입고 요약(반영하지 않았으면 enabled=false) */
  scheduledReceipts: OrderMrpScheduledReceiptsView
  /** 사용자 조치가 필요한 제외 라인(BOM 문제, 비정상 수량/날짜 등) */
  excludedLines: OrderMrpExcludedLineView[]
  /** 사유별 제외 건수(기간 밖/잔량 없음 포함) */
  excludedCounts: Record<string, number>
  warnings: OrderMrpWarningView[]
}

const REASON_LABEL: Record<string, string> = {
  MISSING_DEFAULT_BOM: "ACTIVE 기본(Default) BOM 없음",
  MULTIPLE_DEFAULT_BOM: "기본(Default) BOM 중복 지정 (데이터 오류)",
  EMPTY_DEFAULT_BOM: "기본 BOM 에 자재 라인 없음",
  INVALID_BOM: "BOM 수량 오류 또는 순환 참조",
  CANCELLED: "취소된 수주",
  COMPLETED: "출하 완료",
  SHIPPED: "출하 완료",
  NO_REMAINING_QTY: "미출하 잔량 없음",
  INVALID_QUANTITY: "수량 오류",
  OUT_OF_PERIOD: "조회 기간 밖",
  MISSING_DELIVERY_DATE: "납기 없음",
  INVALID_DELIVERY_DATE: "납기 형식 오류",
  MISSING_BOM: "BOM 없음",
}

const BOM_ISSUE_REASONS = new Set<string>([
  "MISSING_DEFAULT_BOM",
  "MULTIPLE_DEFAULT_BOM",
  "EMPTY_DEFAULT_BOM",
  "INVALID_BOM",
])

/** 사용자에게 개별 목록으로 보여줘야 하는(= 조용히 사라지면 안 되는) 제외 사유 */
const ACTIONABLE_REASONS = new Set<string>([
  ...Array.from(BOM_ISSUE_REASONS),
  "INVALID_QUANTITY",
  "INVALID_DELIVERY_DATE",
  "MISSING_DELIVERY_DATE",
])

export type BuildViewArgs = {
  result: OrderMrpResult
  demandRows: readonly SalesOrderItemRow[]
  /** 모든 BOM 구성품 메타 (itemId → 정보) */
  componentMeta: ReadonlyMap<
    string,
    { code: string; name: string; spec: string | null; uom: string; itemType: string; safetyStock?: unknown }
  >
  stock: ReadonlyMap<string, StockAggregate>
  /** 수요 품목별 BOM 문제 유형 */
  bomIssues: ReadonlyMap<string, BomIssueCode>
  adapterWarnings: readonly AdapterWarning[]
  params: { from: DateOnly | null; to: DateOnly | null; includeDraft: boolean }
  /** Phase 5B: 예정입고 분류 결과(없으면 반영하지 않음) */
  scheduled?: { baseDate: DateOnly; classification: ScheduledReceiptClassification } | null
}

function daysBetween(from: DateOnly, to: DateOnly): number {
  const f = from.split("-").map(Number)
  const t = to.split("-").map(Number)
  return Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(f[0], f[1] - 1, f[2])) / 86_400_000)
}

export function buildOrderMrpView(args: BuildViewArgs): OrderMrpView {
  const { result, demandRows, componentMeta, stock, bomIssues, adapterWarnings, params } = args
  const scheduled = args.scheduled ?? null
  const rowByLineId = new Map(demandRows.map((r) => [r.id, r]))

  const relabel = (e: ExcludedOrderLine): string => {
    if (e.reason !== "MISSING_BOM") return e.reason
    return bomIssues.get(e.itemId) ?? "MISSING_DEFAULT_BOM"
  }

  const excludedCounts: Record<string, number> = {}
  const excludedLines: OrderMrpExcludedLineView[] = []
  for (const e of result.excludedOrderLines) {
    const reason = relabel(e)
    excludedCounts[reason] = (excludedCounts[reason] ?? 0) + 1
    if (!ACTIONABLE_REASONS.has(reason)) continue
    const row = rowByLineId.get(e.orderLineId)
    excludedLines.push({
      reason,
      reasonLabel: REASON_LABEL[reason] ?? reason,
      isBomIssue: BOM_ISSUE_REASONS.has(reason),
      orderId: e.orderId,
      orderNo: e.orderNo,
      orderLineId: e.orderLineId,
      customerName: row?.salesOrder.customer?.name ?? null,
      itemCode: e.itemCode,
      itemName: row?.item.name ?? e.itemCode,
      deliveryDate: e.deliveryDate,
      orderQty: e.orderQty,
      remainingQty: e.remainingQty,
    })
  }

  const demandBySeq = new Map(result.demands.map((d) => [d.orderLineId, d]))
  const resultMaterialIds = new Set(result.materials.map((m) => m.componentItemId))
  const overdueByItem = new Map<string, { qty: number; count: number }>()
  if (scheduled) {
    for (const o of scheduled.classification.overdue) {
      if (!resultMaterialIds.has(o.itemId)) continue
      const agg = overdueByItem.get(o.itemId) ?? { qty: 0, count: 0 }
      agg.qty += o.openQty
      agg.count += 1
      overdueByItem.set(o.itemId, agg)
    }
  }
  const supplierByPoLine = new Map<string, string | null>()
  if (scheduled) {
    for (const d of scheduled.classification.details) supplierByPoLine.set(d.purchaseOrderItemId, d.supplierName)
  }
  const materials: OrderMrpMaterialView[] = []
  for (const m of result.materials) {
    if (!(m.totalRequirement > 0) && !(m.finalBalance < 0)) continue
    const meta = componentMeta.get(m.componentItemId)
    const agg = stock.get(m.componentItemId)
    const steps: OrderMrpStepView[] = []
    const shortageOrderNos: string[] = []
    for (const mv of m.movements) {
      if (!(mv.requirement > 0)) continue
      const demand = demandBySeq.get(mv.orderLineId)
      const row = rowByLineId.get(mv.orderLineId)
      if (!demand) continue
      steps.push({
        sequence: mv.sequence,
        orderId: demand.orderId,
        orderNo: demand.orderNo,
        orderLineId: demand.orderLineId,
        customerName: row?.salesOrder.customer?.name ?? null,
        itemCode: demand.itemCode,
        itemName: row?.item.name ?? demand.itemCode,
        deliveryDate: demand.deliveryDate,
        demandQty: demand.demandQty,
        bomQtyPerUnit: demand.demandQty > 0 ? Math.round((mv.requirement / demand.demandQty) * 1e6) / 1e6 : 0,
        requirement: mv.requirement,
        balanceBefore: mv.balanceBefore,
        balanceAfter: mv.balanceAfter,
        shortageAtThisDemand: mv.shortageAtThisDemand,
        isShortage: mv.isShortage,
      })
      if (mv.isShortage && !shortageOrderNos.includes(demand.orderNo)) shortageOrderNos.push(demand.orderNo)
    }
    materials.push({
      componentItemId: m.componentItemId,
      code: m.componentCode,
      name: meta?.name ?? m.name ?? m.componentCode,
      spec: meta?.spec ?? null,
      uom: meta?.uom ?? m.uom ?? "",
      itemType: meta?.itemType ?? m.componentItemType ?? "",
      qtyOnHand: agg?.qtyOnHand ?? 0,
      qtyHold: agg?.qtyHold ?? 0,
      qtyAvailable: agg?.qtyAvailable ?? 0,
      qtyExcludedByLot: agg?.qtyExcludedByLot ?? 0,
      totalRequirement: m.totalRequirement,
      finalBalance: m.finalBalance,
      shortageQty: m.finalShortageQty,
      firstShortageDate: m.firstShortage?.deliveryDate ?? null,
      firstShortageOrderNo: m.firstShortage?.orderNo ?? null,
      shortageDemandCount: m.shortageDemandCount,
      shortageOrderNos,
      demandLineCount: steps.length,
      productCount: new Set(steps.map((st) => st.itemCode)).size,
      firstNeedDate: steps.reduce<DateOnly | null>((min, st) => (st.deliveryDate !== null && (min === null || st.deliveryDate < min) ? st.deliveryDate : min), null),
      lastNeedDate: steps.reduce<DateOnly | null>((max, st) => (st.deliveryDate !== null && (max === null || st.deliveryDate > max) ? st.deliveryDate : max), null),
      steps,
      scheduledReceiptQty: m.scheduledReceiptQty,
      scheduledReceiptCount: m.scheduledReceiptCount,
      nextReceiptDate: m.timeline.reduce<DateOnly | null>(
        (min, ev) => (ev.type === "SCHEDULED_RECEIPT" && ev.date !== null && (min === null || ev.date < min) ? ev.date : min),
        null
      ),
      hadShortage: m.hadShortage,
      peakShortageQty: m.peakShortageQty,
      temporaryShortage: m.hadShortage && m.finalBalance >= 0,
      shortageRecoveredAt: m.hadShortage && m.finalBalance >= 0 ? m.shortageRecoveredAt : null,
      overdueReceiptQty: overdueByItem.get(m.componentItemId)?.qty ?? 0,
      overdueReceiptCount: overdueByItem.get(m.componentItemId)?.count ?? 0,
      safetyStock: (() => {
        const v = toNum(meta?.safetyStock)
        return Number.isFinite(v) && v > 0 ? v : 0
      })(),
      timeline: m.timeline.map<OrderMrpTimelineEventView>((ev) => {
        if (ev.type === "SCHEDULED_RECEIPT") {
          return {
            type: "SCHEDULED_RECEIPT",
            date: ev.date,
            referenceNo: ev.purchaseOrderNo ?? "",
            partyName: ev.purchaseOrderItemId ? supplierByPoLine.get(ev.purchaseOrderItemId) ?? null : null,
            itemCode: null,
            quantity: ev.quantity,
            signedQuantity: ev.quantity,
            balanceBefore: ev.balanceBefore,
            balanceAfter: ev.balanceAfter,
            isShortage: false,
            sequence: null,
          }
        }
        const row = ev.orderLineId ? rowByLineId.get(ev.orderLineId) : undefined
        const demand = ev.orderLineId ? demandBySeq.get(ev.orderLineId) : undefined
        return {
          type: "DEMAND",
          date: ev.date,
          referenceNo: ev.orderNo ?? "",
          partyName: row?.salesOrder.customer?.name ?? null,
          itemCode: demand?.itemCode ?? null,
          quantity: ev.quantity,
          signedQuantity: -ev.quantity,
          balanceBefore: ev.balanceBefore,
          balanceAfter: ev.balanceAfter,
          isShortage: ev.isShortage === true,
          sequence: ev.sequence ?? null,
        }
      }),
    })
  }

  // 결품 자재 먼저(최초 결품 처리 순서), 그 다음 코드순
  const firstSeq = (v: OrderMrpMaterialView) => v.steps.find((s) => s.isShortage)?.sequence ?? Number.POSITIVE_INFINITY
  materials.sort((a, b) => {
    // 최종 부족 → 일시 결품(입고로 회복) → 정상. 예정입고가 없으면 일시 결품이 없어 기존 정렬과 동일하다.
    const as = a.shortageQty > 0 ? 0 : a.temporaryShortage ? 1 : 2
    const bs = b.shortageQty > 0 ? 0 : b.temporaryShortage ? 1 : 2
    if (as !== bs) return as - bs
    const f = firstSeq(a) - firstSeq(b)
    if (f !== 0 && Number.isFinite(f)) return f
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0
  })

  const warnings: OrderMrpWarningView[] = [
    ...adapterWarnings.map<OrderMrpWarningView>((w) => ({
      code: w.code,
      severity: w.severity,
      message: w.message,
      itemCode: w.itemCode,
    })),
    ...result.warnings
      // MISSING_BOM 은 excludedLines(MISSING_DEFAULT_BOM 등)로 대체되어 별도 노출한다
      .filter((w: MrpWarning) => w.code !== "MISSING_BOM")
      .map<OrderMrpWarningView>((w) => ({
        code: w.code,
        severity: w.severity,
        message: w.message,
        orderNo: w.orderNo,
        itemCode: w.itemCode,
        relatedOrderLineIds: w.relatedOrderLineIds,
      })),
    // Phase 5B: 결과 자재와 관련된 예정입고 이슈만 노출(경과 / 날짜 없음 / 수량 이상)
    ...(scheduled
      ? scheduled.classification.issues
          .filter((i) => resultMaterialIds.has(i.itemId))
          .map<OrderMrpWarningView>((i) => ({
            code: i.code,
            severity: i.severity,
            message: i.message,
            itemCode: componentMeta.get(i.itemId)?.code,
          }))
      : []),
  ]

  return {
    mode: "NORMAL",
    params,
    kpi: {
      demandLineCount: result.summary.includedDemandCount,
      requiredMaterialCount: result.materials.filter((m) => m.totalRequirement > 0).length,
      shortageMaterialCount: result.summary.shortageComponentCount,
      shortageDemandCount: result.summary.shortageDemandCount,
      bomIssueLineCount: excludedLines.filter((l) => l.isBomIssue).length,
      productCount: new Set(result.demands.map((d) => d.itemId)).size,
      requirementLineCount: result.demands.reduce((sum, d) => sum + d.requirements.length, 0),
      temporaryShortageMaterialCount: result.summary.temporaryShortageComponentCount,
      scheduledReceiptMaterialCount: result.materials.filter((m) => m.scheduledReceiptCount > 0).length,
      overdueReceiptCount: Array.from(overdueByItem.values()).reduce((sum, v) => sum + v.count, 0),
    },
    materials,
    scheduledReceipts: scheduled
      ? {
          enabled: true,
          baseDate: scheduled.baseDate,
          appliedReceiptCount: result.materials.reduce((sum, m) => sum + m.scheduledReceiptCount, 0),
          appliedMaterialCount: result.materials.filter((m) => m.scheduledReceiptCount > 0).length,
          overdue: scheduled.classification.overdue
            .filter((o) => resultMaterialIds.has(o.itemId))
            .map<OrderMrpOverdueReceiptView>((o) => ({
              purchaseOrderNo: o.purchaseOrderNo,
              supplierName: o.supplierName,
              itemCode: componentMeta.get(o.itemId)?.code ?? o.itemId,
              itemName: componentMeta.get(o.itemId)?.name ?? "",
              expectedDate: o.expectedDate,
              orderedQty: o.orderedQty,
              receivedQty: o.receivedQty,
              openQty: o.openQty,
              daysOverdue: daysBetween(o.expectedDate, scheduled.baseDate),
            })),
          excludedOutsourcingCount: scheduled.classification.excludedOutsourcingCount,
        }
      : {
          enabled: false,
          baseDate: null,
          appliedReceiptCount: 0,
          appliedMaterialCount: 0,
          overdue: [],
          excludedOutsourcingCount: 0,
        },
    excludedLines,
    excludedCounts,
    warnings,
  }
}

// ─── 한 번에 실행(순수): 행 → 엔진 → View ────────────────────────────────────

export type RunAdapterArgs = {
  tenantId: string
  demandRows: readonly SalesOrderItemRow[]
  bomRows: readonly BomRow[]
  stockRows: readonly InventoryBalanceRow[]
  params: { from: DateOnly | null; to: DateOnly | null; includeDraft: boolean }
  /** Phase 5B: 구매발주 품목 후보 행. baseDate 와 함께 주어질 때만 예정입고를 반영한다. */
  scheduledReceiptRows?: readonly PurchaseOrderItemRow[]
  /** Phase 5B: 기준일(KST 오늘, date-only). 엔진/어댑터는 현재 시각을 읽지 않는다. */
  baseDate?: DateOnly | null
}

export function runOrderMrpFromRows(args: RunAdapterArgs): OrderMrpView {
  const { selected, issues } = selectDefaultBoms(args.bomRows, args.tenantId)
  const demands = toDemandLines(args.demandRows)
  const stock = aggregateStock(args.stockRows)

  const adapterWarnings: AdapterWarning[] = []
  const demandItemIds = new Set(args.demandRows.map((r) => r.itemId))
  const itemCodeById = new Map<string, string>()
  args.demandRows.forEach((r) => itemCodeById.set(r.itemId, r.item.code))

  // 수요 품목 BOM 문제 (누락은 issues 에 없으므로 별도 계산)
  const bomIssues = new Map<string, BomIssueCode>()
  demandItemIds.forEach((itemId) => {
    if (selected.has(itemId)) return
    bomIssues.set(itemId, issues.get(itemId) ?? "MISSING_DEFAULT_BOM")
  })

  // 반제품 구성품의 BOM 문제는 계산을 중단시키지 않고 경고로 노출
  const componentMeta = new Map<
    string,
    { code: string; name: string; spec: string | null; uom: string; itemType: string; safetyStock?: unknown }
  >()
  selected.forEach((bom) => {
    for (const bi of bom.bomItems) componentMeta.set(bi.componentItemId, bi.componentItem)
  })
  componentMeta.forEach((meta, componentId) => {
    if (meta.itemType !== "SEMI_FINISHED" || demandItemIds.has(componentId) || selected.has(componentId)) return
    const issue = issues.get(componentId)
    adapterWarnings.push({
      code: issue === "MULTIPLE_DEFAULT_BOM" ? "COMPONENT_MULTIPLE_DEFAULT_BOM" : "COMPONENT_MISSING_DEFAULT_BOM",
      severity: issue === "MULTIPLE_DEFAULT_BOM" ? "WARNING" : "INFO",
      message:
        issue === "MULTIPLE_DEFAULT_BOM"
          ? `반제품 ${meta.code} 에 기본(Default) BOM 이 여러 개 지정되어 하위 자재를 전개하지 않았습니다.`
          : `반제품 ${meta.code} 에 ACTIVE 기본 BOM 이 없어 하위 자재를 전개하지 않았습니다(구매/외주 반제품이면 정상).`,
      itemId: componentId,
      itemCode: meta.code,
    })
  })

  const scheduled =
    args.scheduledReceiptRows !== undefined && args.baseDate
      ? {
          baseDate: args.baseDate,
          classification: classifyScheduledReceipts(args.scheduledReceiptRows, {
            tenantId: args.tenantId,
            baseDate: args.baseDate,
          }),
        }
      : null

  const input: OrderMrpInput = {
    demands,
    boms: toBomLines(selected),
    stocks: toStockEntries(stock),
    ...(scheduled ? { scheduledReceipts: scheduled.classification.receipts } : {}),
  }
  const result = runOrderMrp(input, {
    mode: "NORMAL",
    from: args.params.from,
    to: args.params.to,
    stockProviderType: "ACTUAL",
  })

  return buildOrderMrpView({
    result,
    demandRows: args.demandRows,
    componentMeta,
    stock,
    bomIssues,
    adapterWarnings,
    params: args.params,
    scheduled,
  })
}
