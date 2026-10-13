import { kstDaysUntil } from "@/lib/date/kst"

// ─── 프로젝트 이슈 D-Day/지연 순수 계산 helper (client/server 공용, DB 의존성 없음) ──
// project-stage-progress.ts와 동일한 원칙: @prisma/client를 import하지 않는다
// (순수 문자열 유니온 타입만 사용) — client 컴포넌트에서도 그대로 재사용할 수 있도록.
// DB에는 지연상태를 저장하지 않고 화면/서비스에서 매번 계산한다(§18).

export type ProjectIssueStatusForDelay = "OPEN" | "IN_PROGRESS" | "RESOLVED"

const DUE_SOON_DAYS = 3

export type ProjectIssueDelayStatus = "NO_DUE_DATE" | "RESOLVED" | "NORMAL" | "DUE_SOON" | "DELAYED"

// §18:
// - dueDate 없음 → NO_DUE_DATE(일정없음)
// - RESOLVED → RESOLVED(완료), dueDate 유무와 무관하게 지연 제외
// - dueDate < 오늘 && status !== RESOLVED → DELAYED
// - D-3 이내 → DUE_SOON
// - 그 외 → NORMAL
export function resolveProjectIssueDelayStatus(
  dueDate: Date | string | null,
  status: ProjectIssueStatusForDelay,
  now: Date = new Date()
): ProjectIssueDelayStatus {
  if (status === "RESOLVED") return "RESOLVED"
  if (!dueDate) return "NO_DUE_DATE"
  const diff = kstDaysUntil(new Date(dueDate), now)
  if (diff < 0) return "DELAYED"
  if (diff <= DUE_SOON_DAYS) return "DUE_SOON"
  return "NORMAL"
}

// 지연/마감임박 판단만 필요한 목록 필터용 간단 boolean.
export function isProjectIssueOverdue(
  dueDate: Date | string | null,
  status: ProjectIssueStatusForDelay,
  now: Date = new Date()
): boolean {
  return resolveProjectIssueDelayStatus(dueDate, status, now) === "DELAYED"
}
