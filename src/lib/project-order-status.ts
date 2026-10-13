import { ProjectOrderStatus } from "@prisma/client"

// ─── 프로젝트 오더 상태전이 규칙 (client/server 공용 단일 출처) ─────────────────
// project-order.actions.ts("use server")는 export된 최상위 문이 async function만
// 허용되므로(check:server-actions), 이 표는 별도 plain module에 두고 양쪽에서
// import해 쓴다 — 서버가 최종 검증을 하고, 클라이언트는 이 표로 Select 옵션만 좁힌다.

export const PROJECT_ORDER_STATUS_TRANSITIONS: Record<ProjectOrderStatus, ProjectOrderStatus[]> = {
  DRAFT:       ["DRAFT", "CONFIRMED", "CANCELLED"],
  CONFIRMED:   ["CONFIRMED", "IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD:     ["ON_HOLD", "IN_PROGRESS", "CANCELLED"],
  COMPLETED:   ["COMPLETED"],
  CANCELLED:   ["CANCELLED"],
}

export const PROJECT_ORDER_CREATABLE_STATUSES: ProjectOrderStatus[] = ["DRAFT", "CONFIRMED"]
