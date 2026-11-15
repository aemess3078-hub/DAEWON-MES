// 수주 등록/수정 화면의 총금액 ↔ 단가 자동 계산 규칙 (순수 함수, UI 비의존)
//
// 규칙
// - 단가 = 총금액 ÷ 수량 (단일 품목). 원 단위 정수로 반올림한다(MoneyInput 이 정수만 다루고 소수점 입력이 불가하므로).
// - "자동" 행: 사용자가 단가를 직접 건드리지 않은 행. "수동" 행: 사용자가 단가를 입력했거나 기존 수주에서 불러온 저장값.
// - 수동 단가는 절대 덮어쓰지 않는다.
// - 자동 행이 정확히 하나이고, 나머지 행은 모두 단가가 확정(수동)되어 있을 때만 계산한다.
//   - 단일 품목: 총금액 ÷ 수량
//   - 여러 품목: (총금액 - 확정 품목 금액 합계) ÷ 수량 (잔여 금액). 총금액을 여러 품목에 배분하지 않는다.
// - 총금액 미입력/0, 수량 0 또는 미입력, 잔여 금액이 음수인 경우에는 계산하지 않는다.

export type UnitPriceRow = {
  qty: number | undefined
  unitPrice: number | undefined
  /** true: 사용자가 직접 입력했거나 저장된 단가 — 자동 계산 대상이 아니다 */
  manual: boolean
}

export type AutoUnitPriceResult = {
  /** 자동 계산 대상 행 인덱스 */
  rowIndex: number
  /** 계산 기준 금액 (단일: 총금액, 여러 품목: 잔여 금액) */
  basisAmount: number
  /** 계산 기준이 총금액 전체인지 잔여 금액인지 */
  basis: "total" | "remainder"
  qty: number
  /** 반올림된 단가 (원 단위 정수) */
  unitPrice: number
}

function isPositiveNumber(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
}

/** 자동 계산해야 할 단가를 구한다. 계산할 대상이 없으면 null (= 현재 값 유지). */
export function deriveAutoUnitPrice(
  totalAmount: number | undefined,
  rows: UnitPriceRow[]
): AutoUnitPriceResult | null {
  if (!isPositiveNumber(totalAmount)) return null

  const autoIndexes = rows.flatMap((r, i) => (r.manual ? [] : [i]))
  if (autoIndexes.length !== 1) return null
  const rowIndex = autoIndexes[0]
  const target = rows[rowIndex]
  if (!isPositiveNumber(target.qty)) return null

  const others = rows.filter((_, i) => i !== rowIndex)
  let confirmedSum = 0
  for (const o of others) {
    // 나머지 품목은 수량·단가가 모두 확정되어 있어야 한다
    if (!isPositiveNumber(o.qty) || typeof o.unitPrice !== "number" || !Number.isFinite(o.unitPrice) || o.unitPrice < 0) {
      return null
    }
    confirmedSum += o.qty * o.unitPrice
  }

  const basisAmount = totalAmount - confirmedSum
  if (basisAmount < 0) return null

  return {
    rowIndex,
    basisAmount,
    basis: others.length === 0 ? "total" : "remainder",
    qty: target.qty,
    unitPrice: Math.round(basisAmount / target.qty),
  }
}

export type AmountMismatch = {
  lineSum: number
  difference: number
  /**
   * true: KRW 자동 계산 단가의 원 단위 반올림으로만 생긴 1원 이하 차이.
   * 안내 문구만 보여 주고 저장 확인창은 생략한다. 총금액·단가는 바꾸지 않는다.
   */
  roundingOnly: boolean
}

/**
 * 확정 단가(수량 × 단가) 합계와 총금액의 차이. 모든 행의 단가가 있을 때만 계산한다. 일치하거나 비교 불가이면 null.
 * - rows[].manual === false 인 행만 자동 계산 행으로 본다 (manual 이 없으면 수동으로 취급).
 * - roundingOnly 는 통화 KRW, |차이| ≤ 1, 그리고 차이가 자동 계산 행의 반올림에서만 나온 경우에만 true.
 */
export function getAmountMismatch(
  totalAmount: number | undefined,
  rows: { qty?: number | undefined; unitPrice?: number | undefined; manual?: boolean }[],
  currency: string = "KRW"
): AmountMismatch | null {
  if (!isPositiveNumber(totalAmount)) return null
  if (rows.length === 0) return null
  let lineSum = 0
  for (const r of rows) {
    if (!isPositiveNumber(r.qty) || typeof r.unitPrice !== "number" || !Number.isFinite(r.unitPrice)) return null
    lineSum += r.qty * r.unitPrice
  }
  const difference = totalAmount - lineSum
  // 1원 미만 차이는 불일치로 보지 않는다 (기존 동작 유지)
  if (Math.abs(difference) < 1) return null

  let roundingOnly = false
  if (currency === "KRW" && Math.abs(difference) <= 1) {
    const autoRowIndexes = rows.flatMap((r, i) => (r.manual === false ? [i] : []))
    if (autoRowIndexes.length === 1) {
      const auto = deriveAutoUnitPrice(
        totalAmount,
        rows.map((r) => ({ qty: r.qty, unitPrice: r.unitPrice, manual: r.manual !== false }))
      )
      // 자동 행의 현재 단가가 자동 계산 결과와 같아야 차이가 반올림 때문이다
      roundingOnly = auto !== null && auto.rowIndex === autoRowIndexes[0] && rows[auto.rowIndex].unitPrice === auto.unitPrice
    }
  }
  return { lineSum, difference, roundingOnly }
}
