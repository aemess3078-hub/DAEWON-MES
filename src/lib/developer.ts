/**
 * 개발자 전용 계정 판별 유틸리티
 *
 * 로그인 ID가 정확히 'test'인 계정을 최상위 개발자 계정으로 취급한다.
 * 기존 'admin' ID는 더 이상 특별 취급하지 않는다.
 *
 * NOTE: 'use server' 없는 순수 모듈 — Server Component, Client Component,
 *       Server Action 어디서든 import 가능.
 */

import type { UserRole } from '@prisma/client'

export const DEVELOPER_LOGIN_ID = 'test' as const

/**
 * 운영 Go-Live 시 개발자 권한 상승을 DB 변경 없이 끄는 환경변수 스위치 (Phase 10 / DG-017).
 * DAEWON_DISABLE_DEVELOPER_ACCESS=1 이면 loginId='test' 라도 개발자 전용 기능/범위 예외가 적용되지 않는다
 * (일반 OWNER 로만 동작). 계정 자체의 비활성/삭제는 docs/DAEWON-GO-LIVE-ACCOUNT-RUNBOOK.md 참고.
 */
export function isDeveloperAccessDisabled(): boolean {
  return process.env.DAEWON_DISABLE_DEVELOPER_ACCESS === '1'
}

/**
 * 이미 로드된 user 객체만으로 개발자 여부를 판별하는 순수 함수.
 * DB 호출 없음.
 */
export function isDeveloperUser(
  user: { loginId: string } | null | undefined,
): boolean {
  if (isDeveloperAccessDisabled()) return false
  return user?.loginId === DEVELOPER_LOGIN_ID
}

/**
 * 사용자관리 전체 탭 접근 가능 여부.
 * 조건: 로그인 ID가 'test' OR role이 OWNER
 */
export function canAccessFullUserManagement(
  user: { loginId: string; role: UserRole } | null | undefined,
): boolean {
  if (!user) return false
  return isDeveloperUser(user) || user.role === 'OWNER'
}

/**
 * 사용자 목록 탭만 접근 가능 여부.
 * 조건: ADMIN / MANAGER / OPERATOR / VIEWER (OWNER 이하이면서 full-access 아닌 경우)
 */
export function canViewUserListOnly(
  user: { loginId: string; role: UserRole } | null | undefined,
): boolean {
  if (!user) return false
  if (canAccessFullUserManagement(user)) return false
  return (['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'] as UserRole[]).includes(user.role)
}
