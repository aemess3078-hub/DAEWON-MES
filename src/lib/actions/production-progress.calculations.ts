// ─── 생산진행 현황(NewMES 전용) — 서버/클라이언트 공용 순수 계산 ───────────────────
//
// 이 파일은 production-progress.service.ts(서버 전용 계산 정본, wip-traceability.helpers.ts
// 등을 통해 간접적으로 @prisma/client에 의존)와 production-alerts.ts(클라이언트
// 번들에 포함되는 순수 알림 builder) 양쪽에서 공통으로 쓰는 함수만 둔다.
//
// @prisma/client, DB, Server Action, wip-traceability 등 서버 전용 의존성을
// 이 파일에 절대 추가하지 않는다 — 추가하는 순간 production-alerts.ts의 클라이언트
// 번들에 다시 섞여 들어간다. 계산식은 절대 여기서 새로 만들거나 복제하지 않는다 —
// production-progress.service.ts가 이 파일의 함수를 import해서 쓰고, 두 번째
// 구현을 만들지 않는다.

// ─── 예상 진행률 (건강도 판정 보조) ───────────────────────────────────────────────
//
// startedAt과 dueDate가 모두 있을 때만 계산 가능. 아래 예외는 모두 null로 처리해
// 호출부(건강도 판정)가 "판정 불가"로 다룰 수 있게 한다:
//   - startedAt 또는 dueDate 없음
//   - dueDate <= startedAt (기간이 0 이하)
// 미래 시작일(아직 시작 전)은 0%, 이미 dueDate를 지났으면 100%로 clamp한다.

export function computeExpectedProgressRate(
  startedAt: Date | null,
  dueDate: Date | null,
  referenceDate: Date
): number | null {
  if (startedAt == null || dueDate == null) return null

  const totalDurationMs = dueDate.getTime() - startedAt.getTime()
  if (totalDurationMs <= 0) return null

  const elapsedMs = referenceDate.getTime() - startedAt.getTime()
  const rate = (elapsedMs / totalDurationMs) * 100
  return Math.min(100, Math.max(0, rate))
}
