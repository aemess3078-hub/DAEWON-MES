export type ProductionResultTimeInput = {
  endedAt: Date
  operationStartedAt: Date | null
  assignmentStartedAt?: Date | null
  previousResultEndedAt?: Date | null
}

export type ProductionResultTime = {
  startedAt: Date | null
  endedAt: Date
}

/**
 * 첫 실적은 POP 작업시작 시각부터, 후속 실적은 직전 실적 종료시각부터 계산한다.
 * 배포 전부터 진행 중이어서 시작시각을 알 수 없는 공정은 가짜 시각을 만들지 않는다.
 */
export function resolveProductionResultTime(
  input: ProductionResultTimeInput
): ProductionResultTime {
  const startedAt =
    input.previousResultEndedAt ??
    input.assignmentStartedAt ??
    input.operationStartedAt

  if (startedAt && input.endedAt.getTime() < startedAt.getTime()) {
    throw new Error("작업 종료시각은 시작시각보다 빠를 수 없습니다.")
  }

  return { startedAt, endedAt: input.endedAt }
}

export function calculateWorkDurationMinutes(
  startedAt: Date | string | null,
  endedAt: Date | string | null
): number | null {
  if (!startedAt || !endedAt) return null
  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(durationMs) || durationMs < 0) return null
  return Math.round(durationMs / 60_000)
}
