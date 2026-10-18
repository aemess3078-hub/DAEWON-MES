/**
 * 사용자에게 보여줄 오류 메시지 변환.
 *
 * Server Action 에서 throw 한 Error 메시지는 Next.js 프로덕션 빌드에서 자동으로 지워진다.
 * 그래서 사용자 안내가 필요한 업무 액션(발주/입고/작업지시/출고)은 오류를 잡아
 * `{ success: false, message }` 형태로 반환하고, 이 모듈이 message 를 안전하게 만든다.
 *
 *  - 업무 규칙 메시지(한글로 작성한 "재고 부족", "이미 사용 중인 제조번호입니다" 등)는 그대로 전달한다.
 *  - Prisma/DB/네트워크 내부 오류(쿼리 원문, 테이블·컬럼명, 오류 코드, 스택)는 사용자에게 노출하지 않고
 *    이해하기 쉬운 안내로 바꾼다. 원본 오류는 호출부가 console.error 로 서버 로그에 남긴다.
 */

export type ActionResult = { success: true } | { success: false; message: string }

export const GENERIC_USER_ERROR_MESSAGE =
  "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 문의해 주세요."
export const DUPLICATE_USER_ERROR_MESSAGE =
  "이미 사용 중인 번호이거나 이미 등록된 값입니다. 번호를 확인한 후 다시 시도해 주세요."
export const REFERENCE_USER_ERROR_MESSAGE =
  "연결된 데이터를 찾을 수 없거나 다른 데이터에서 사용 중이어서 처리할 수 없습니다. 화면을 새로고침한 후 다시 시도해 주세요."
export const NOT_FOUND_USER_ERROR_MESSAGE =
  "대상 데이터를 찾을 수 없습니다. 화면을 새로고침한 후 다시 시도해 주세요."
export const CONCURRENT_USER_ERROR_MESSAGE =
  "다른 작업과 동시에 처리되어 완료하지 못했습니다. 현재 상태를 확인한 후 다시 시도해 주세요."
export const TIMEOUT_USER_ERROR_MESSAGE =
  "처리 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
export const FORBIDDEN_USER_ERROR_MESSAGE = "이 기능을 사용할 권한이 없습니다."
export const UNAUTHORIZED_USER_ERROR_MESSAGE = "로그인이 필요합니다. 다시 로그인해 주세요."

/** 업무 코드(영문) → 사용자 안내 */
const CODE_MESSAGES: Record<string, string> = {
  FORBIDDEN: FORBIDDEN_USER_ERROR_MESSAGE,
  UNAUTHORIZED: UNAUTHORIZED_USER_ERROR_MESSAGE,
  INVALID_ITEM: "품목 정보를 찾을 수 없습니다. 품목을 다시 선택해 주세요.",
}

/** Prisma 오류 코드 → 사용자 안내 (P2002 는 호출부가 duplicateMessage 로 덮어쓸 수 있다) */
const PRISMA_CODE_MESSAGES: Record<string, string> = {
  P2002: DUPLICATE_USER_ERROR_MESSAGE,
  P2003: REFERENCE_USER_ERROR_MESSAGE,
  P2014: REFERENCE_USER_ERROR_MESSAGE,
  P2025: NOT_FOUND_USER_ERROR_MESSAGE,
  P2034: CONCURRENT_USER_ERROR_MESSAGE,
  P2028: TIMEOUT_USER_ERROR_MESSAGE,
  P2024: TIMEOUT_USER_ERROR_MESSAGE,
}

/** 내부 정보(쿼리/테이블/오류코드/스택/연결정보)가 섞인 메시지를 가려내는 패턴 */
const INTERNAL_MESSAGE_PATTERNS: RegExp[] = [
  /Invalid\s+`?prisma\./i,
  /prisma\.\w+\.\w+\(/i,
  /Unique constraint failed/i,
  /Foreign key constraint/i,
  /Raw query failed/i,
  /Failed to deserialize/i,
  /Inconsistent column data/i,
  /Argument [`"]?\w+[`"]? (is missing|must not be)/i,
  /Unknown (argument|field|arg)/i,
  /\bP\d{4}\b/,
  /Can't reach database/i,
  /Timed out fetching a new connection/i,
  /Transaction (API error|already closed)/i,
  /connection (pool|refused|terminated|timeout)/i,
  /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND)\b/,
  /relation "[^"]+" does not exist/i,
  /column "?[^"\s]+"? (of relation|does not exist)/i,
  /\bSELECT\b[\s\S]*\bFROM\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+"?\w+"?\s+SET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\n\s+at\s+\S+/,
  /postgres(ql)?:\/\//i,
  /supabase\.co/i,
  /\bDATABASE_URL\b/,
]

export function isInternalErrorMessage(message: string): boolean {
  return INTERNAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
}

function errorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === "string") return code
  }
  return null
}

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && typeof (error as { name?: unknown }).name === "string"
    ? ((error as { name: string }).name)
    : ""
}

export type UserErrorOptions = {
  /** 이 호출에서 P2002(unique 충돌)를 설명하는 문구. 예) "이미 사용 중인 제조번호입니다." */
  duplicateMessage?: string
  /** 변환할 수 없는 내부 오류일 때 쓰는 문구 */
  fallback?: string
}

/** 어떤 오류든 사용자에게 보여도 안전한 한글 안내문으로 변환한다. */
export function toUserErrorMessage(error: unknown, options: UserErrorOptions = {}): string {
  const fallback = options.fallback ?? GENERIC_USER_ERROR_MESSAGE
  const code = errorCode(error)
  const name = errorName(error)

  // Prisma 오류 (런타임 타입이 달라도 name/code 로 식별 — 테스트 fake 포함)
  if (name.startsWith("PrismaClient") || (code && /^P\d{4}$/.test(code))) {
    if (code === "P2002" && options.duplicateMessage) return options.duplicateMessage
    if (code && PRISMA_CODE_MESSAGES[code]) return PRISMA_CODE_MESSAGES[code]
    return fallback
  }

  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  const trimmed = message.trim()
  if (!trimmed) return fallback
  if (CODE_MESSAGES[trimmed]) return CODE_MESSAGES[trimmed]
  if (isInternalErrorMessage(trimmed)) {
    if (/Unique constraint failed/i.test(trimmed)) return options.duplicateMessage ?? DUPLICATE_USER_ERROR_MESSAGE
    if (/Foreign key constraint/i.test(trimmed)) return REFERENCE_USER_ERROR_MESSAGE
    return fallback
  }
  return trimmed
}

/** 업무 액션 공통: 오류를 서버 로그에 남기고 `{ success:false, message }` 로 변환한다. */
export function failureResult(scope: string, error: unknown, options: UserErrorOptions = {}): ActionResult {
  console.error(`[${scope}] error:`, error)
  return { success: false, message: toUserErrorMessage(error, options) }
}
