import { ProjectIssueStatus } from "@prisma/client"

// ─── 프로젝트 이슈 상태전이 규칙 (client/server 공용 단일 출처) ─────────────────
// project-issue.actions.ts("use server")는 export된 최상위 문이 async function만
// 허용되므로(check:server-actions), 이 표는 별도 plain module에 두고 양쪽에서
// import해 쓴다 — 서버가 최종 검증을 하고, 클라이언트는 이 표로 UI만 좁힌다.
//
// 이번 PR에서는 RESOLVED → OPEN / RESOLVED → IN_PROGRESS 재오픈을 만들지 않는다.
// 상태변경은 임의 status Select가 아니라 startProjectIssue()/resolveProjectIssue()
// 전용 액션으로만 이루어진다(project-order-status.ts의 자유 Select 패턴과 다름).

// 정본 업무 흐름은 OPEN → IN_PROGRESS → RESOLVED뿐이다 — OPEN → RESOLVED 직접
// 전이는 허용하지 않는다(UI도 OPEN에서는 "조치 시작"만, IN_PROGRESS에서만
// "해결 완료"를 제공하므로 서버도 동일하게 강제한다).
export const PROJECT_ISSUE_STATUS_TRANSITIONS: Record<ProjectIssueStatus, ProjectIssueStatus[]> = {
  OPEN:        ["OPEN", "IN_PROGRESS"],
  IN_PROGRESS: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED:    ["RESOLVED"],
}

// §14: ProjectOrder가 COMPLETED/CANCELLED면 Issue 신규등록/수정/시작/해결을 모두 막는다.
// ON_HOLD는 계속 허용한다(보류 이유 자체를 Issue/Risk로 관리할 수 있으므로).
export const PROJECT_ISSUE_BLOCKED_ORDER_STATUSES = ["COMPLETED", "CANCELLED"] as const
