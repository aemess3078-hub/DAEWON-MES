/**
 * POP 작업 화면 잔여수량 계산 (표시 전용 순수 로직 — DB/React 의존 없음).
 *
 * 서버 실적 검증(submitProductionResult)과 같은 기준으로 이번에 더 등록할 수 있는 수량을 보여 준다.
 *  - 계획 잔여 = 계획(배정)수량 − 완료수량
 *  - availableWipQty = root WIP 수량 − 이 공정 기등록 양품 (getOperationDetail 이 계산한 "남은 투입 가능량")
 *    → 이미 잔여량이므로 완료수량을 다시 빼지 않는다(ISSUE-03 이중 차감).
 *  - 투입 가능 WIP 가 계획 잔여보다 적을 때만 전공정 불량·재작업으로 줄어든 것이다(경고 표시).
 *  - 자재 기준 추가 생산가능량이 있으면 그보다 클 수 없다.
 */
import { subtractQuantities } from "../quantity-scale"

export type PopRemainingInput = {
  plannedQty: number
  completedQty: number
  /** null 이면 WIP 추적 없음 → 계획 기준 */
  availableWipQty: number | null
  status: string
  /** null 이면 자재 제한 없음 */
  materialMaxAdditional: number | null
}

export type PopRemaining = {
  planRemaining: number
  hasWipShortfall: boolean
  wipLimitedRemaining: number
  effectiveRemaining: number
  hasMaterialShortfall: boolean
}

export function computePopRemaining(input: PopRemainingInput): PopRemaining {
  const { plannedQty, completedQty, availableWipQty, status, materialMaxAdditional } = input
  const planRemaining = Math.max(subtractQuantities(plannedQty, completedQty) ?? plannedQty - completedQty, 0)
  const hasWipShortfall =
    availableWipQty !== null && availableWipQty < planRemaining && status !== "COMPLETED"
  const wipLimitedRemaining = hasWipShortfall ? Math.max(availableWipQty, 0) : planRemaining
  const effectiveRemaining =
    materialMaxAdditional !== null ? Math.min(wipLimitedRemaining, materialMaxAdditional) : wipLimitedRemaining
  const hasMaterialShortfall = materialMaxAdditional !== null && materialMaxAdditional < wipLimitedRemaining
  return { planRemaining, hasWipShortfall, wipLimitedRemaining, effectiveRemaining, hasMaterialShortfall }
}
