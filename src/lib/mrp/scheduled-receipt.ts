/**
 * 예정입고(Scheduled Receipt) 분류 (순수 모듈 — DB/Prisma 를 import 하지 않는다)
 *
 *   PurchaseOrderItem 행(plain object) ──> 엔진 입력 MrpScheduledReceipt[] + 사용자 안내(경과/날짜없음/수량이상)
 *
 * 확정 정책(Phase 5B)
 *  - 미입고 수량 openQty = PurchaseOrderItem.qty − receivedQty  (> 0 인 경우만)
 *  - 인정 상태: ORDERED, PARTIAL_RECEIVED.  제외: DRAFT, RECEIVED, CLOSED, CANCELLED
 *  - 외주발주 제외(자재 구매가 아님): orderNo "OS-" 접두어 / note 의 "[OUTSOURCING]" / 품목 행의 workOrderOperationId 존재
 *    — 기존 외주 화면(outsourcing.actions.ts isOutsourcingPurchaseOrder, 발주 목록 필터)과 같은 규칙 + 공정 연결 행
 *  - 입고예정일 = PurchaseOrder.expectedDate(헤더). 품목별 ETA 는 없다. KST 달력 날짜로 변환.
 *  - 기준일(baseDate) 이전의 예정일(예정일 경과)은 자동 가산하지 않고 OVERDUE 안내만 한다.
 *    기준일 당일은 인정한다(오늘 입고 예정).
 *  - 예정일이 없거나 날짜로 해석할 수 없으면 가산하지 않고 안내만 한다.
 *  - receivedQty > qty 같은 데이터 이상은 openQty 0 으로 클램프하고 안내한다(음수 입고예정을 만들지 않는다).
 *  - tenant 가 다른 행은 방어적으로 한 번 더 제외한다(DB where 와 별개).
 */

import { isDateOnly, toDateOnly } from "./period"
import type { DateOnly, MrpScheduledReceipt } from "./types"

/** MRP 예정입고로 인정하는 구매발주 상태 */
export const SCHEDULED_RECEIPT_PO_STATUSES = ["ORDERED", "PARTIAL_RECEIVED"] as const

export type PurchaseOrderItemRow = {
  id: string
  itemId: string
  qty: unknown
  receivedQty: unknown
  workOrderOperationId: string | null
  purchaseOrder: {
    id: string
    tenantId: string
    orderNo: string
    status: string
    expectedDate: Date | string | null
    note: string | null
    supplier: { id: string; name: string } | null
  }
}

export type ScheduledReceiptDetail = {
  purchaseOrderId: string
  purchaseOrderNo: string
  purchaseOrderItemId: string
  itemId: string
  supplierName: string | null
  expectedDate: DateOnly
  orderedQty: number
  receivedQty: number
  openQty: number
}

export type ReceiptIssueCode =
  | "OVERDUE_SCHEDULED_RECEIPT"
  | "MISSING_RECEIPT_DATE"
  | "RECEIVED_QTY_EXCEEDS_ORDER"

export type ReceiptIssue = {
  code: ReceiptIssueCode
  severity: "WARNING" | "INFO"
  message: string
  purchaseOrderId: string
  purchaseOrderNo: string
  purchaseOrderItemId: string
  itemId: string
  /** 경과/날짜없음 건의 미입고 수량 */
  openQty: number
  expectedDate: DateOnly | null
}

export type ScheduledReceiptClassification = {
  /** 엔진에 전달할 유효 예정입고 */
  receipts: MrpScheduledReceipt[]
  /** receipts 와 같은 순서의 상세 */
  details: ScheduledReceiptDetail[]
  /** 예정일 경과(미입고 잔량 있음) — 계산에 가산하지 않음 */
  overdue: ScheduledReceiptDetail[]
  issues: ReceiptIssue[]
  /** 외주발주라서 제외한 행 수(참고) */
  excludedOutsourcingCount: number
}

function num(v: unknown): number {
  if (typeof v === "number") return v
  if (v === null || v === undefined) return Number.NaN
  return Number(v as string)
}

/** 외주발주 판정. 자재 구매 입고예정에서는 제외한다. */
export function isOutsourcingPurchaseOrderRow(row: PurchaseOrderItemRow): boolean {
  const po = row.purchaseOrder
  return (
    po.orderNo.startsWith("OS-") ||
    (po.note ?? "").includes("[OUTSOURCING]") ||
    (row.workOrderOperationId !== null && row.workOrderOperationId !== undefined)
  )
}

function toExpectedDateOnly(value: Date | string | null): DateOnly | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") {
    if (isDateOnly(value)) return value
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return null
    return toDateOnly(parsed)
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null
  return toDateOnly(value)
}

/**
 * @param rows        구매발주 품목 행(후보). 상태/외주/수량/날짜를 여기서 최종 판정한다.
 * @param tenantId    인증된 tenant (다른 tenant 행은 제외)
 * @param baseDate    기준일(date-only). 호출자가 KST 오늘을 명시적으로 전달한다(이 함수는 현재 시각을 읽지 않는다).
 */
export function classifyScheduledReceipts(
  rows: readonly PurchaseOrderItemRow[],
  args: { tenantId: string; baseDate: DateOnly }
): ScheduledReceiptClassification {
  if (!isDateOnly(args.baseDate)) throw new RangeError(`baseDate 는 YYYY-MM-DD 여야 합니다: ${String(args.baseDate)}`)

  const statuses = new Set<string>(SCHEDULED_RECEIPT_PO_STATUSES)
  // 결정적 순서: 발주번호 → 품목 행 id
  const sorted = [...rows].sort((a, b) => {
    const an = a.purchaseOrder.orderNo
    const bn = b.purchaseOrder.orderNo
    return an < bn ? -1 : an > bn ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const out: ScheduledReceiptClassification = {
    receipts: [],
    details: [],
    overdue: [],
    issues: [],
    excludedOutsourcingCount: 0,
  }

  sorted.forEach((row) => {
    const po = row.purchaseOrder
    if (po.tenantId !== args.tenantId) return
    if (!statuses.has(po.status)) return
    if (isOutsourcingPurchaseOrderRow(row)) {
      out.excludedOutsourcingCount += 1
      return
    }

    const ordered = num(row.qty)
    const received = num(row.receivedQty)
    if (!Number.isFinite(ordered) || !Number.isFinite(received)) return

    const base = {
      purchaseOrderId: po.id,
      purchaseOrderNo: po.orderNo,
      purchaseOrderItemId: row.id,
      itemId: row.itemId,
    }
    if (received > ordered) {
      out.issues.push({
        code: "RECEIVED_QTY_EXCEEDS_ORDER",
        severity: "WARNING",
        message: `발주 ${po.orderNo} 의 입고수량(${received})이 발주수량(${ordered})보다 커서 입고예정에 반영하지 않았습니다. 발주 데이터를 확인하세요.`,
        ...base,
        openQty: 0,
        expectedDate: toExpectedDateOnly(po.expectedDate),
      })
      return
    }
    const openQty = ordered - received
    if (!(openQty > 0)) return

    const expected = toExpectedDateOnly(po.expectedDate)
    if (expected === null) {
      out.issues.push({
        code: "MISSING_RECEIPT_DATE",
        severity: "WARNING",
        message: `발주 ${po.orderNo} 의 입고예정일이 없거나 올바르지 않아 입고예정에 반영하지 않았습니다(미입고 ${openQty}).`,
        ...base,
        openQty,
        expectedDate: null,
      })
      return
    }

    const detail: ScheduledReceiptDetail = {
      purchaseOrderId: po.id,
      purchaseOrderNo: po.orderNo,
      purchaseOrderItemId: row.id,
      itemId: row.itemId,
      supplierName: po.supplier?.name ?? null,
      expectedDate: expected,
      orderedQty: ordered,
      receivedQty: received,
      openQty,
    }

    if (expected < args.baseDate) {
      out.overdue.push(detail)
      out.issues.push({
        code: "OVERDUE_SCHEDULED_RECEIPT",
        severity: "WARNING",
        message: `발주 ${po.orderNo} 의 입고예정일(${expected})이 지났지만 미입고 ${openQty}가 남아 있어 입고예정에 반영하지 않았습니다. 입고예정일을 수정하거나 잔량을 종결하세요.`,
        ...base,
        openQty,
        expectedDate: expected,
      })
      return
    }

    out.details.push(detail)
    out.receipts.push({
      componentItemId: row.itemId,
      quantity: openQty,
      expectedDate: expected,
      purchaseOrderId: po.id,
      purchaseOrderNo: po.orderNo,
      purchaseOrderItemId: row.id,
      originalIndex: out.receipts.length,
    })
  })

  return out
}
