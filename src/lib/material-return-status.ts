import { MaterialReturnStatus, UserRole } from "@prisma/client"

// ─── 반품관리 상태전이 규칙 (client/server 공용 단일 출처) ──────────────────────
// material-return.actions.ts("use server")는 export된 최상위 문이 async function만
// 허용되므로(check:server-actions), 이 표는 별도 plain module에 두고 양쪽에서
// import해 쓴다 — 서버가 최종 검증을 하고, 클라이언트는 이 표로 UI만 좁힌다.
//
// PR #50 결정사항: DRAFT -> COMPLETED / DRAFT -> CANCELLED만 허용한다. COMPLETED와
// CANCELLED는 terminal 상태로 역전이(재오픈)를 만들지 않는다. CONFIRMED 같은 중간
// 승인 상태도 만들지 않는다 — 별도의 전자결재/승인 workflow는 없다(§6/§12).
export const MATERIAL_RETURN_STATUS_TRANSITIONS: Record<MaterialReturnStatus, MaterialReturnStatus[]> = {
  DRAFT:     ["DRAFT", "COMPLETED", "CANCELLED"],
  COMPLETED: ["COMPLETED"],
  CANCELLED: ["CANCELLED"],
}

// §6: 반품완료(COMPLETED 전환 + 실제 재고차감)는 MANAGER 이상만 수행할 수 있다.
// 서버(completeMaterialReturn)가 requireRole("MANAGER")로 최종 검증하며, 이 상수는
// 클라이언트에서 버튼 노출 여부를 좁히는 용도로만 쓴다.
const ROLE_ORDER: Record<UserRole, number> = {
  VIEWER: 1,
  OPERATOR: 2,
  MANAGER: 3,
  ADMIN: 4,
  OWNER: 5,
}

export function canCompleteMaterialReturn(role: UserRole): boolean {
  return ROLE_ORDER[role] >= ROLE_ORDER.MANAGER
}
