// ─── 프로젝트 단가관리 금액/조정률 계산 (client/server 공용 순수함수) ────────────
// 금액은 DB에 중복 저장하지 않고 snapshot 단가 × snapshot quantity로 매번
// 계산한다(§16) — quotationUnitPrice/orderUnitPrice/finalUnitPrice/quantity가
// snapshot이므로 이 계산 자체도 과거 값 기준으로 항상 재현 가능하다.
//
// 0/null 방어: 단가가 없거나(null) 분모가 0이면 조정률은 null(UI에서 "—" 표시)로
// 처리한다 — 무한대/NaN을 노출하지 않는다.

export type ProjectOrderPriceAmounts = {
  quotationAmount: number | null
  orderAmount: number | null
  finalAmount: number | null
  quoteToFinalDifference: number | null
  quoteToFinalRate: number | null
  orderToFinalDifference: number | null
  orderToFinalRate: number | null
}

function amountOf(unitPrice: number | null, quantity: number): number | null {
  return unitPrice != null ? unitPrice * quantity : null
}

function differenceOf(from: number | null, to: number | null): number | null {
  return from != null && to != null ? to - from : null
}

function rateOf(fromUnitPrice: number | null, toUnitPrice: number | null): number | null {
  if (fromUnitPrice == null || toUnitPrice == null || fromUnitPrice === 0) return null
  return ((toUnitPrice - fromUnitPrice) / fromUnitPrice) * 100
}

export function calculateProjectOrderPriceAmounts(input: {
  quantity: number
  quotationUnitPrice: number | null
  orderUnitPrice: number | null
  finalUnitPrice: number | null
}): ProjectOrderPriceAmounts {
  const quotationAmount = amountOf(input.quotationUnitPrice, input.quantity)
  const orderAmount = amountOf(input.orderUnitPrice, input.quantity)
  const finalAmount = amountOf(input.finalUnitPrice, input.quantity)

  return {
    quotationAmount,
    orderAmount,
    finalAmount,
    quoteToFinalDifference: differenceOf(quotationAmount, finalAmount),
    quoteToFinalRate: rateOf(input.quotationUnitPrice, input.finalUnitPrice),
    orderToFinalDifference: differenceOf(orderAmount, finalAmount),
    orderToFinalRate: rateOf(input.orderUnitPrice, input.finalUnitPrice),
  }
}
