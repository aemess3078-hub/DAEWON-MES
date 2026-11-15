/**
 * 서버 액션의 "예상 가능한 업무 검증 오류"를 구조화된 결과({ success:false, error })로 돌려주기 위한 서버 전용 도구.
 *
 * 배경: 프로덕션 빌드는 서버 액션이 throw 한 오류의 메시지를 사용자에게 보내지 않고(digest 만 전달)
 * "An error occurred in the Server Components render…" 로 가린다. 사용 중 라우팅 수정 차단,
 * 측정 이력이 있는 검사표준 수정 차단, 수주 충당 수량 초과 같은 업무 검증 안내는 한글 문구가 화면에 보여야 하므로
 * throw 대신 { success:false, error } 로 돌려준다.
 *
 * 규칙
 *  - 업무 검증 오류만 변환한다: BusinessRuleError, 또는 한글 메시지를 가진 일반 Error(코드가 의도적으로 던진 안내 문구).
 *  - 권한 거부 문구, Prisma/시스템 예외, 한글 메시지가 없는 코드("NOT_FOUND"·"FORBIDDEN" 등)는 그대로 다시 던진다 —
 *    정상 결과로 위장하지 않으며 기존 로깅·오류 처리(Next 서버 로그)가 유지된다.
 */
import { ROLE_PERMISSION_DENIED_MESSAGE } from "@/lib/auth/role-permissions"
import type { ActionFailure } from "@/lib/action-result"

export class BusinessRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BusinessRuleError"
  }
}

const HANGUL = /[가-힣]/

/** 예상 가능한 업무 검증 오류면 실패 결과를, 아니면 오류를 그대로 다시 던진다. */
export function businessFailure(error: unknown): ActionFailure {
  if (error instanceof BusinessRuleError) return { success: false, error: error.message }
  if (
    error instanceof Error &&
    error.constructor === Error &&
    HANGUL.test(error.message) &&
    error.message !== ROLE_PERMISSION_DENIED_MESSAGE
  ) {
    return { success: false, error: error.message }
  }
  throw error
}
