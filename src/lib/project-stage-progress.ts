import { kstDaysUntil } from "@/lib/date/kst"

// ─── 프로젝트 진행현황 순수 계산 helper (client/server 공용, DB 의존성 없음) ──────
// production-progress.calculations.ts와 동일한 원칙: 이 파일은 @prisma/client를
// import하지 않는다(순수 문자열 유니온 타입만 사용) — client 컴포넌트에서도
// 그대로 재사용할 수 있도록.

export type StageForProgress = {
  seq: number
  name: string
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED"
}

export type ProjectStatusForDelay =
  | "DRAFT"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "COMPLETED"
  | "CANCELLED"

const DUE_SOON_DAYS = 3

// §5: 완료 단계 수 / 전체 유효 단계 수 × 100. 단계 완료율이며 MES 생산 달성률과 무관하다.
// 가중치/생산수량 실적과 섞지 않는다.
export function computeStageSummary(stages: StageForProgress[]): {
  totalCount: number
  completedCount: number
  percent: number
} {
  const totalCount = stages.length
  const completedCount = stages.filter((s) => s.status === "COMPLETED").length
  const percent = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100)
  return { totalCount, completedCount, percent }
}

// §6: IN_PROGRESS가 있으면 그 단계, 없으면 가장 앞의 PENDING, 모두 COMPLETED면 "완료",
// 단계가 없으면 "단계 미등록".
export function resolveCurrentStageLabel(stages: StageForProgress[]): string {
  if (stages.length === 0) return "단계 미등록"
  const sorted = [...stages].sort((a, b) => a.seq - b.seq)
  const inProgress = sorted.find((s) => s.status === "IN_PROGRESS")
  if (inProgress) return inProgress.name
  const pending = sorted.find((s) => s.status === "PENDING")
  if (pending) return pending.name
  return "완료"
}

export type ProjectDelayStatus = "NORMAL" | "DUE_SOON" | "DELAYED"

// §13: 프로젝트 지연은 파생 계산만 한다. 납기일이 지났는데 완료/취소가 아니면 지연,
// D-3 이내면 마감임박. 기존 NMES에 재사용 가능한 마감임박 정책 helper가 없어
// 단순 기준(D-3)만 명확히 정의한다.
export function resolveProjectDelayStatus(
  dueDate: Date | string | null,
  projectStatus: ProjectStatusForDelay,
  now: Date = new Date()
): ProjectDelayStatus {
  if (!dueDate) return "NORMAL"
  if (projectStatus === "COMPLETED" || projectStatus === "CANCELLED") return "NORMAL"
  const diff = kstDaysUntil(new Date(dueDate), now)
  if (diff < 0) return "DELAYED"
  if (diff <= DUE_SOON_DAYS) return "DUE_SOON"
  return "NORMAL"
}

// §13: 단계 dueDate가 지났는데 완료가 아니면 단계 지연.
export function isStageDelayed(
  stage: { dueDate: Date | string | null; status: StageForProgress["status"] },
  now: Date = new Date()
): boolean {
  if (!stage.dueDate || stage.status === "COMPLETED") return false
  return kstDaysUntil(new Date(stage.dueDate), now) < 0
}
