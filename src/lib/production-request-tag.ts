/**
 * 생산의뢰 요청 ID 태그(`[pr:<요청ID>:<해시>]`) 보존 규칙 — 순수 모듈(클라이언트·서버 공용, 암호화 의존 없음)
 *
 * 수주 생산의뢰는 요청 ID 의 멱등성을 생산계획 비고에 남긴 태그로 판단한다(production-request.ts).
 * 사용자가 생산계획 수정 화면에서 비고를 고쳐도 이 태그가 사라지면 같은 요청 ID 의 재전송이 중복 계획을 만들 수 있으므로,
 *  - 화면에는 태그를 보여 주지 않고(사용자 메모만 표시)
 *  - 서버는 비고를 저장할 때 기존 태그를 다시 붙인다.
 */
export const PRODUCTION_REQUEST_TAG_PATTERN = /\s*\[pr:[A-Za-z0-9_-]{16,128}:[0-9a-f]{32}\]/g

/** 화면 표시용: 요청 ID 태그를 뺀 사용자 메모 */
export function stripProductionRequestTag(note: string | null | undefined): string {
  return (note ?? "").replace(PRODUCTION_REQUEST_TAG_PATTERN, "").trim()
}

/** 저장용: 새 비고에 기존 요청 ID 태그가 없으면 기존 태그를 다시 붙인다(새 비고가 이미 같은 태그를 가지고 있으면 그대로) */
export function keepProductionRequestTag(oldNote: string | null | undefined, newNote: string | null | undefined): string | null {
  const tags = (oldNote ?? "").match(PRODUCTION_REQUEST_TAG_PATTERN)?.map((t) => t.trim()) ?? []
  const base = (newNote ?? "").trim()
  if (tags.length === 0) return newNote ?? null
  const missing = tags.filter((t) => !base.includes(t))
  if (missing.length === 0) return base
  return [base, ...missing].filter((p) => p.length > 0).join(" ")
}
