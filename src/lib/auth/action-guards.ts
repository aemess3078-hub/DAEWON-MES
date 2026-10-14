/**
 * Server Action 진입 가드 (Phase 10 / DG-013).
 *
 * 'use server' 파일이 아니므로 이 모듈의 함수는 클라이언트에서 호출 가능한 액션으로 노출되지 않는다.
 *
 * 원칙
 *  - 인증된 서버 세션(JWT 서명 검증 + 활성 TenantUser)의 사용자만 Source of Truth 로 사용한다.
 *  - 클라이언트가 넘긴 tenantId 는 권한 판단에 쓰지 않는다. 세션 tenant 와 다르면 거부한다.
 *  - 새 인증 체계를 만들지 않고 기존 getCurrentUser / requireResourcePermission 을 재사용한다.
 */

import { getCurrentUser, type CurrentUser } from "@/lib/auth"
import {
  ROLE_PERMISSION_DENIED_MESSAGE,
  getCurrentPermissionSnapshot,
  hasResourcePermission,
  requireResourcePermission,
} from "@/lib/auth/role-permissions"

/** 로그인(세션) 필수. 권한 리소스 구분이 필요 없는 tenant 범위 참조 데이터 조회용. */
export async function requireActor(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error("UNAUTHORIZED")
  return user
}

/**
 * 리소스 READ 권한 필수. 배열을 주면 하나라도 READ 가 허용되면 통과(여러 화면이 공유하는 조회 액션용).
 * 권한 스냅샷은 1회만 읽는다(루프 내 반복 호출 금지).
 */
export async function requireReadActor(resource: string | readonly string[]): Promise<CurrentUser> {
  if (typeof resource === "string") return requireResourcePermission(resource, "READ")
  const user = await requireActor()
  const snapshot = await getCurrentPermissionSnapshot(user)
  if (!snapshot) throw new Error("UNAUTHORIZED")
  if (resource.some((r) => hasResourcePermission(snapshot, r, "READ"))) return user
  throw new Error(ROLE_PERMISSION_DENIED_MESSAGE)
}

/** 클라이언트가 전달한 tenantId 가 세션 tenant 와 다르면 거부한다(값이 없으면 통과 — 세션 tenant 사용). */
export function assertSessionTenant(actor: { tenantId: string }, tenantId?: string | null): void {
  if (tenantId !== undefined && tenantId !== null && tenantId !== actor.tenantId) {
    throw new Error("FORBIDDEN")
  }
}
