/**
 * 자재입고 요청 ID(멱등 키) — 클라이언트/서버 공용 순수 모듈.
 *
 * 규칙
 *  - 하나의 입고 "작업"(같은 품목·같은 내용을 저장하려는 시도)에는 같은 요청 ID 를 재시도에도 유지한다.
 *  - 사용자가 새 입고를 시작할 때만 새 ID 를 만든다. 같은 발주품목이라도 ID 가 다르면 서로 다른 정상 입고(분할 입고)이다.
 *  - 형식: 영숫자/하이픈/밑줄 16~128자 (UUID v4 36자 권장). 서버가 같은 규칙으로 다시 검증한다.
 */

export const RECEIVING_UNKNOWN_MESSAGE =
  "처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 저장하면 서버가 중복 없이 처리합니다(이미 처리된 경우 그대로 완료로 표시됩니다)."

export const RECEIVING_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export function isValidReceivingRequestId(value: unknown): value is string {
  return typeof value === "string" && RECEIVING_REQUEST_ID_PATTERN.test(value)
}

/**
 * UUID v4 생성. 사내 태블릿이 http(비보안 컨텍스트)로 접속하면 crypto.randomUUID 가 없을 수 있어
 * getRandomValues → Math.random 순으로 대체한다.
 */
export function generateReceivingRequestId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.randomUUID === "function") return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
