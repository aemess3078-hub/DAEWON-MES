import { formatCurrency, formatQuantity } from "@/lib/utils"

/**
 * 수주 금액(통화 코드 포함) 표시. sales-orders 폼은 통화를 KRW 외에도
 * USD/EUR/JPY로 선택할 수 있으므로, KRW일 때만 "원"으로 표기하고
 * (DB currency 값 자체는 변경하지 않음) 그 외 통화는 코드를 그대로 붙인다 —
 * 모든 금액에 무조건 "원"을 붙이면 외화 금액이 잘못 표기된다.
 * 외화는 DB 컬럼 정밀도(Decimal(18,2))에 맞춰 소수 2자리까지 표시한다.
 */
export function formatAmountWithCurrency(
  amount: number | string | null | undefined,
  currency: string
): string {
  if (currency === "KRW") return formatCurrency(amount)
  return `${formatQuantity(amount, { maxDecimals: 2 })} ${currency}`
}
