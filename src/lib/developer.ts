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
 * 이미 로드된 user 객체만으로 개발자 여부를 판별하는 순수 함수.
 * DB 호출 없음.
 */
export function isDeveloperUser(
  user: { loginId: string } | null | undefined,
): boolean {
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
  return user.loginId === DEVELOPER_LOGIN_ID || user.role === 'OWNER'
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
