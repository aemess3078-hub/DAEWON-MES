import { cookies } from "next/headers"
import { verifyAuthToken, NMES_SESSION_COOKIE } from "@/lib/jwt"
import { isDeveloperLogin, isScopeEnforced } from "@/lib/auth/daewon-scope"

/**
 * 서버 액션 / API 용 대원정밀 구축 범위 가드.
 *
 * 대원정밀 구축 범위에서 제외된 기능(DAEWON_HIDDEN_NAV)의 서버 액션과 API 는, 페이지 접근을 막는 것만으로는
 * 우회(액션 직접 호출)될 수 있으므로 각 액션 진입 시 서명 검증된 세션(JWT)으로 한 번 더 검사한다.
 *  - 일반 사용자: FORBIDDEN
 *  - 개발자 계정(loginId='test'): 허용
 *  - NEXT_PUBLIC_BRAND=newmes 에서는 검사하지 않는다.
 * 'use server' 파일이 아니므로 이 함수들은 클라이언트에서 호출 가능한 액션으로 노출되지 않는다.
 */
async function getVerifiedLoginId(): Promise<string> {
  const store = await cookies()
  const token = store.get(NMES_SESSION_COOKIE)?.value
  const payload = token ? verifyAuthToken(token) : null
  if (!payload) throw new Error("UNAUTHORIZED")
  return payload.loginId
}

/** 구축 범위 밖 기능의 서버 액션 진입 가드 (개발자 계정만 통과). */
export async function assertDaewonFeatureScope(): Promise<void> {
  if (!isScopeEnforced()) return
  const loginId = await getVerifiedLoginId()
  if (!isDeveloperLogin(loginId)) throw new Error("FORBIDDEN")
}

/** 개발자 전용 기능(Gateway/태그/번호 규칙/기능 관리/코드관리)의 서버 액션 진입 가드. */
export async function assertDeveloperOnly(): Promise<void> {
  if (!isScopeEnforced()) return
  const loginId = await getVerifiedLoginId()
  if (!isDeveloperLogin(loginId)) throw new Error("FORBIDDEN")
}

/** API Route 용: 허용되면 null, 아니면 응답 상태코드(401/403). */
export async function checkDaewonFeatureScopeForApi(): Promise<401 | 403 | null> {
  try {
    await assertDaewonFeatureScope()
    return null
  } catch (e) {
    return e instanceof Error && e.message === "UNAUTHORIZED" ? 401 : 403
  }
}
