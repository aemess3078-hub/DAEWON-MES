/**
 * 품목 안전재고(Item.safetyStock) 입력 검증 (순수 모듈)
 *
 * 정책(Phase 5D)
 *  - MRP 발주제안에서 예상 가용재고가 유지해야 하는 "목표 하한"이다. 물리 재고를 차감하는 값이 아니다.
 *  - 0 이상의 유한한 수. 미지정(undefined/null)은 0 (기존 Excel 업로드/호출부 호환).
 *  - 소수는 6자리까지(Decimal(18,6) 재고 수량과 같은 단위), 상한 1e12 미만. DB CHECK 와 같은 범위.
 */

export const SAFETY_STOCK_MAX = 1_000_000_000_000

export const SAFETY_STOCK_ERROR = "INVALID_SAFETY_STOCK"

export function isValidSafetyStock(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false
  if (value < 0 || value >= SAFETY_STOCK_MAX) return false
  return Number(value.toFixed(6)) === value
}

/** undefined/null → 0, 올바르지 않으면 Error(INVALID_SAFETY_STOCK) */
export function normalizeSafetyStock(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (!isValidSafetyStock(value)) throw new Error(SAFETY_STOCK_ERROR)
  return value
}
