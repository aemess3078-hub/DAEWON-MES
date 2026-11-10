// 재작업 완료 팝업 수량 계산(순수 함수): 양품 복귀 수량만 입력받고 폐기 수량은 자동 계산한다.

const SCALE = 1_000_000

const round6 = (n: number) => Math.round(n * SCALE) / SCALE

/** 입력 문자열을 0 ~ reworkQty 범위로 보정한다(음수 → 0, 초과 → reworkQty, 숫자가 아니면 빈 문자열 유지). */
export function clampMergedInput(raw: string, reworkQty: number): string {
  if (raw.trim() === "") return ""
  const n = Number(raw)
  if (!Number.isFinite(n)) return ""
  if (n < 0) return "0"
  if (n > reworkQty) return String(round6(reworkQty))
  return raw
}

/** 폐기 수량 = 재작업 대상 수량 - 양품 복귀 수량 (읽기 전용 표시용). 입력이 올바르지 않으면 null. */
export function computeScrapQty(mergedRaw: string, reworkQty: number): number | null {
  if (mergedRaw.trim() === "") return null
  const merged = Number(mergedRaw)
  if (!Number.isFinite(merged) || merged < 0 || merged > reworkQty + 1e-9) return null
  return round6(Math.max(0, reworkQty - merged))
}

/** 제출 가능 여부와 서버로 보낼 수량. 폐기 0(전량 복귀)·복귀 0(전량 폐기) 모두 허용한다. */
export function resolveReworkCompletion(
  mergedRaw: string,
  reworkQty: number,
): { ok: true; mergedQty: number; scrapQty: number } | { ok: false; error: string } {
  const scrap = computeScrapQty(mergedRaw, reworkQty)
  if (scrap === null) return { ok: false, error: `양품 복귀 수량은 0 이상 재작업 수량(${reworkQty}) 이하로 입력해 주세요.` }
  return { ok: true, mergedQty: round6(Number(mergedRaw)), scrapQty: scrap }
}
