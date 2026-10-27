/**
 * LOT 관리 · LOT 번호 규칙 "조회" 서버 액션의 접근 확인 (서버 전용 모듈 — "use server" 파일이 아니라 클라이언트가 직접 호출할 수 없다).
 *
 *  - 로그인(세션)이 없으면 UNAUTHORIZED
 *  - 권한은 LOT 화면(메뉴 lot → 자원 LOT)의 페이지 접근 기준과 같은 규칙(canReadMenuCode)을 쓴다. 그래서 LOT 화면을 열 수 있는
 *    사용자는 그 화면이 쓰는 조회 액션도 그대로 쓸 수 있다(READ 행이 설정되지 않은 기존 역할도 화면과 동일하게 처리).
 *  - LOT 등록 시트의 후보/규칙 조회(requireLotEntryReader)는 조회 권한 또는 LOT 등록(CREATE) 권한이 있으면 허용한다.
 *  - tenant 는 항상 세션 값이다. 클라이언트가 보낸 tenantId 는 신뢰하지 않고, 있다면 세션과 같은지만 확인한다.
 *  - 새 권한 코드를 만들지 않는다. getTenantId 의 개발용 대체값(DEFAULT_TENANT_ID)은 쓰지 않는다.
 */
import {
  ROLE_PERMISSION_DENIED_MESSAGE,
  canReadMenuCode,
  getCurrentPermissionSnapshot,
  hasResourcePermission,
} from "@/lib/auth/role-permissions"

/** LOT 화면(메뉴 코드 lot)을 열 수 있는 사용자만. 반환 tenant 는 세션 값. */
export async function requireLotReader(): Promise<{ tenantId: string }> {
  const snapshot = await getCurrentPermissionSnapshot()
  if (!snapshot) throw new Error("UNAUTHORIZED")
  if (!canReadMenuCode(snapshot, "lot")) throw new Error(ROLE_PERMISSION_DENIED_MESSAGE)
  return { tenantId: snapshot.user.tenantId }
}

/** LOT 등록 시트가 쓰는 후보/규칙 조회: LOT 화면 조회 권한 또는 LOT 등록(CREATE) 권한. */
export async function requireLotEntryReader(): Promise<{ tenantId: string }> {
  const snapshot = await getCurrentPermissionSnapshot()
  if (!snapshot) throw new Error("UNAUTHORIZED")
  if (!canReadMenuCode(snapshot, "lot") && !hasResourcePermission(snapshot, "LOT", "CREATE")) {
    throw new Error(ROLE_PERMISSION_DENIED_MESSAGE)
  }
  return { tenantId: snapshot.user.tenantId }
}

/** 클라이언트가 보낸 tenantId 가 세션 tenant 와 같은지 확인한다(다르면 권한 없음과 같은 오류). */
export function assertSessionTenant(clientTenantId: unknown, sessionTenantId: string): void {
  if (typeof clientTenantId !== "string" || clientTenantId !== sessionTenantId) {
    throw new Error(ROLE_PERMISSION_DENIED_MESSAGE)
  }
}
