/**
 * DRAFT 구매발주 Coverage (순수 모듈 — DB/Prisma/현재 시각 비의존) — Phase 6
 *
 *   MRP 정책 필요량(raw) − 기존 활성 DRAFT 미입고 합계 = 추가 DRAFT 필요량 → (그 다음) 공급업체 MOQ / 발주배수
 *
 * 정책
 *  - DRAFT 구매발주는 확정 공급이 아니다. 재고 / 입고예정(Scheduled Receipt) / 예상잔량에 절대 가산하지 않는다.
 *    입고예정은 Phase 5B 정책 그대로 ORDERED / PARTIAL_RECEIVED 만이다. 여기서는 "중복 발주를 막기 위한 별도 표시"만 계산한다.
 *  - Coverage 대상: 같은 tenant 의 상태 DRAFT 구매발주 품목 중 미입고 수량(qty − receivedQty) > 0 인 행. 외주발주 제외.
 *    CANCELLED / CLOSED / RECEIVED / ORDERED 는 DRAFT 가 아니므로 포함되지 않는다
 *    (DRAFT → ORDERED 가 되면 Coverage 에서 빠지고 입고예정에 들어간다 — 둘 다에 있는 경우는 없다).
 *  - 기본은 "품목 전체" Coverage(어떤 공급업체의 DRAFT 든) 기준이다. 선택 공급업체 Coverage 와 다른 공급업체 DRAFT 는 따로 보여 준다.
 *  - 계산 순서: remainingRawNeed = max(0, raw − coverage) → 남은 필요량에만 MOQ → 발주배수 올림.
 *    remaining = 0 이면 MOQ 를 적용하지 않고 0 이다(예: 필요 100, DRAFT 80, MOQ 50, 배수 10 → 20 → 50 / 필요 100, DRAFT 110 → 0).
 */

import { applySupplierTerms } from "./purchase-policy"

export type DraftCoverageOrder = { orderNo: string; supplierId: string; qty: number }

export type ItemDraftCoverage = {
  /** 품목의 활성 DRAFT 미입고 합계(공급업체 무관) */
  total: number
  /** supplierId → 해당 공급업체 DRAFT 미입고 합계 */
  bySupplier: Record<string, number>
  /** 발주서별 미입고 수량(표시용, 상위 일부) */
  orders: DraftCoverageOrder[]
  /** DRAFT 발주서 수(품목 기준) */
  orderCount: number
}

export type CoverageStatus = "NONE" | "PARTIAL" | "COVERED"

export const COVERAGE_ORDER_PREVIEW_LIMIT = 5

export function roundQty6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

export function emptyItemCoverage(): ItemDraftCoverage {
  return { total: 0, bySupplier: {}, orders: [], orderCount: 0 }
}

/** (품목, DRAFT 발주 행) 단위 입력을 품목별 Coverage 로 합산한다(순수). */
export function aggregateDraftCoverage(
  rows: ReadonlyArray<{ itemId: string; supplierId: string; orderNo: string; openQty: number }>
): Map<string, ItemDraftCoverage> {
  const byItem = new Map<string, ItemDraftCoverage>()
  const orderKey = new Set<string>()
  for (const r of rows) {
    if (!(r.openQty > 0)) continue
    let c = byItem.get(r.itemId)
    if (!c) {
      c = emptyItemCoverage()
      byItem.set(r.itemId, c)
    }
    c.total = roundQty6(c.total + r.openQty)
    c.bySupplier[r.supplierId] = roundQty6((c.bySupplier[r.supplierId] ?? 0) + r.openQty)
    const k = `${r.itemId}|${r.orderNo}`
    const existing = c.orders.find((o) => o.orderNo === r.orderNo && o.supplierId === r.supplierId)
    if (existing) existing.qty = roundQty6(existing.qty + r.openQty)
    else c.orders.push({ orderNo: r.orderNo, supplierId: r.supplierId, qty: r.openQty })
    if (!orderKey.has(k)) {
      orderKey.add(k)
      c.orderCount += 1
    }
  }
  byItem.forEach((c) => {
    c.orders.sort((a, b) => (a.orderNo < b.orderNo ? -1 : a.orderNo > b.orderNo ? 1 : 0))
    if (c.orders.length > COVERAGE_ORDER_PREVIEW_LIMIT) c.orders = c.orders.slice(0, COVERAGE_ORDER_PREVIEW_LIMIT)
  })
  return byItem
}

export type CoverageEvaluation = {
  /** 구매조건 적용 전 정책 필요량(raw) */
  rawNeed: number
  /** 기존 활성 DRAFT 미입고 합계(품목 전체) */
  coverageQty: number
  /** max(0, raw − coverage) */
  remainingRawNeed: number
  /** remaining 에 공급업체 MOQ/배수를 적용한 추가 DRAFT 제안량 */
  additionalQty: number
  qtyAfterMoq: number
  moqApplied: boolean
  multipleApplied: boolean
  termsInvalid: boolean
  status: CoverageStatus
}

/**
 * Coverage 평가(순수).
 *  - supplier 가 null 이면 구매조건 없이 remaining 을 그대로 추가량으로 쓴다.
 *  - remaining = 0 이면 MOQ/배수를 적용하지 않는다(0 유지).
 */
export function evaluateCoverage(args: {
  rawNeed: number
  coverageQty: number
  supplier: { moq: number | null; orderMultiple: number | null } | null
}): CoverageEvaluation {
  const rawNeed = roundQty6(Math.max(0, Number.isFinite(args.rawNeed) ? args.rawNeed : 0))
  const coverageQty = roundQty6(Math.max(0, Number.isFinite(args.coverageQty) ? args.coverageQty : 0))
  const remainingRawNeed = roundQty6(Math.max(0, rawNeed - coverageQty))
  let additionalQty = remainingRawNeed
  let qtyAfterMoq = remainingRawNeed
  let moqApplied = false
  let multipleApplied = false
  let termsInvalid = false
  if (args.supplier && remainingRawNeed > 0) {
    const applied = applySupplierTerms(remainingRawNeed, {
      moq: args.supplier.moq,
      orderMultiple: args.supplier.orderMultiple,
    })
    if (applied.ok) {
      additionalQty = applied.qty
      qtyAfterMoq = applied.qtyAfterMoq
      moqApplied = applied.moqApplied
      multipleApplied = applied.multipleApplied
    } else {
      termsInvalid = true
    }
  }
  const status: CoverageStatus =
    rawNeed > 0 && coverageQty >= rawNeed ? "COVERED" : rawNeed > 0 && coverageQty > 0 ? "PARTIAL" : "NONE"
  return { rawNeed, coverageQty, remainingRawNeed, additionalQty, qtyAfterMoq, moqApplied, multipleApplied, termsInvalid, status }
}

/** 선택한 공급업체 기준 Coverage 분해: 선택 공급업체 DRAFT / 다른 공급업체 DRAFT */
export function splitCoverageBySupplier(
  coverage: Pick<ItemDraftCoverage, "total" | "bySupplier">,
  supplierId: string | null
): { selectedSupplierQty: number; otherSupplierQty: number } {
  const selected = supplierId ? coverage.bySupplier[supplierId] ?? 0 : 0
  return { selectedSupplierQty: roundQty6(selected), otherSupplierQty: roundQty6(Math.max(0, coverage.total - selected)) }
}
