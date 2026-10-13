// work-order 화면 전용 수량 포맷터.
// Decimal(18,6) precision을 보존해야 하므로 maximumFractionDigits: 6을 명시한다
// (Intl.NumberFormat 기본값에 맡기면 소수 자릿수가 로케일 기본치로 잘릴 수 있음).
// 전역 formatNumber(src/lib/utils.ts) 개편은 별도의 숫자/통화 표준화 PR에서 진행한다.
export function formatQty(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "-"
  const num = typeof value === "string" ? Number(value) : value
  if (!Number.isFinite(num)) return "-"
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 6 }).format(num)
}
