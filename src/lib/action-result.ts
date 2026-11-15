/**
 * 서버 액션의 "예상 가능한 업무 검증 오류" 결과 타입 — 클라이언트 컴포넌트에서도 import 할 수 있도록 서버 전용 코드를 담지 않는다.
 * 서버 쪽 변환(businessFailure)은 business-error.server.ts 를 본다.
 */
export type ActionFailure = { success: false; error: string }

/** 서버 액션이 돌려준 값이 업무 검증 실패 결과인지 확인한다. */
export function isActionFailure(result: unknown): result is ActionFailure {
  return !!result && typeof result === "object" && (result as { success?: unknown }).success === false && typeof (result as { error?: unknown }).error === "string"
}
