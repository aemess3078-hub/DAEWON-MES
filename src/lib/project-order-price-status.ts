import { ProjectPriceStatus, UserRole } from "@prisma/client"

// ─── 프로젝트 단가관리 상태전이 규칙 (client/server 공용 단일 출처) ─────────────
// project-order-price.actions.ts("use server")는 export된 최상위 문이 async
// function만 허용되므로(check:server-actions), 이 표는 별도 plain module에 두고
// 양쪽에서 import해 쓴다 — 서버가 최종 검증을 하고, 클라이언트는 이 표로 UI만
// 좁힌다.
//
// DRAFT -> DECIDED만 허용한다. DECIDED에서 DRAFT로 되돌리는 기능은 명시적
// 필요가 없어 만들지 않는다(§9) — DECIDED 이후 finalUnitPrice 재수정은 별도
// 전용 액션(setProjectOrderPriceFinal의 재결정 분기)이 담당하며 상태 자체는
// DECIDED로 유지된다.
export const PROJECT_PRICE_STATUS_TRANSITIONS: Record<ProjectPriceStatus, ProjectPriceStatus[]> = {
  DRAFT: ["DRAFT", "DECIDED"],
  DECIDED: ["DECIDED"],
}

// §10: 최종결정단가 확정 및 재수정은 MANAGER 이상만 수행할 수 있다. 서버
// (setProjectOrderPriceFinal)가 requireRole("MANAGER")로 최종 검증하며, 이
// 상수는 클라이언트에서 버튼 노출 여부를 좁히는 용도로만 쓴다.
const ROLE_ORDER: Record<UserRole, number> = {
  VIEWER: 1,
  OPERATOR: 2,
  MANAGER: 3,
  ADMIN: 4,
  OWNER: 5,
}

export function canDecideProjectOrderPrice(role: UserRole): boolean {
  return ROLE_ORDER[role] >= ROLE_ORDER.MANAGER
}
