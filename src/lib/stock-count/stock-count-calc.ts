/** 재고실사 순수 계산 로직(DB 없음). 수량은 소수 6자리로 정리한다. */

const r6 = (v: number) => Math.round(v * 1e6) / 1e6

/** 실사 차이 = 실사수량 − 시작 시점 전산수량. 실사수량이 없으면 null(미실사). */
export function calcCountDiff(systemQty: number, countedQty: number | null): number | null {
  if (countedQty == null || !Number.isFinite(countedQty)) return null
  return r6(countedQty - systemQty)
}

/**
 * 재고조정 목표 수량. 실사 중에도 입출고가 가능하므로, 시작 시점 이후 변동분(현재고 − 시작 시점 전산수량)을 보존한다.
 *   목표 = 실사수량 + (현재고 − 시작 시점 전산수량)   (0 미만이면 0)
 * 변동이 없으면 목표 = 실사수량.
 */
export function calcAdjustTarget(countedQty: number, systemQtyAtStart: number, currentQty: number): number {
  return Math.max(0, r6(countedQty + (currentQty - systemQtyAtStart)))
}

/** 실사 시작 이후 재고가 변동되었는지 */
export function hasDriftedSinceStart(systemQtyAtStart: number, currentQty: number): boolean {
  return Math.abs(currentQty - systemQtyAtStart) > 1e-9
}

export type CountLineLike = {
  systemQty: number
  countedQty: number | null
  adjustedAt: unknown | null
}

export type CountSummary = {
  lineCount: number
  countedCount: number
  uncountedCount: number
  diffLineCount: number
  plusQty: number
  minusQty: number
  adjustedCount: number
  /** 차이가 있고 아직 조정하지 않은 줄 수 */
  pendingAdjustCount: number
}

export function summarizeCount(lines: CountLineLike[]): CountSummary {
  let countedCount = 0
  let diffLineCount = 0
  let plusQty = 0
  let minusQty = 0
  let adjustedCount = 0
  let pendingAdjustCount = 0
  for (const l of lines) {
    const diff = calcCountDiff(l.systemQty, l.countedQty)
    if (diff == null) continue
    countedCount += 1
    if (diff !== 0) {
      diffLineCount += 1
      if (diff > 0) plusQty = r6(plusQty + diff)
      else minusQty = r6(minusQty + diff)
      if (l.adjustedAt) adjustedCount += 1
      else pendingAdjustCount += 1
    }
  }
  return { lineCount: lines.length, countedCount, uncountedCount: lines.length - countedCount, diffLineCount, plusQty, minusQty, adjustedCount, pendingAdjustCount }
}

export const STOCK_COUNT_STATUS_LABEL = { IN_PROGRESS: "실사중", COMPLETED: "실사 종료", CANCELLED: "취소" } as const
export type StockCountStatusKey = keyof typeof STOCK_COUNT_STATUS_LABEL

/** 입력값(문자열)을 실사수량으로 해석. 빈 값은 null(미입력), 음수·숫자 아님은 undefined(오류). */
export function parseCountedQty(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return null
  if (typeof raw === "string" && raw.trim() === "") return null
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "").trim())
  if (!Number.isFinite(n) || n < 0) return undefined
  return r6(n)
}
