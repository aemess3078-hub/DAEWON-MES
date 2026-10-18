import { createHash, randomBytes } from "crypto"

/**
 * 수집 에이전트 키 (Phase 10 / DG-033). 스키마 변경 없이 EdgeGateway.apiKey 컬럼을 그대로 사용한다.
 *
 *  - 발급: 암호학적 난수 256bit (cuid 기본값 사용 안 함). 평문은 발급 시 1회만 화면에 표시.
 *  - 저장: "sha256:<hex>" 해시만 저장(DB 유출 시 키 재사용 불가).
 *  - 검증: 제시된 키를 해시해 비교. 과거 평문 저장 행은 읽기 호환(성공 시 해시로 전환).
 *  - 해시 문자열 자체를 키로 제시하는 우회를 막기 위해 "sha256:" 접두 키는 항상 거부한다.
 */
export const AGENT_KEY_HASH_PREFIX = "sha256:"
export const AGENT_KEY_PLAINTEXT_PREFIX = "dwk_"

export function generateAgentKey(): string {
  return AGENT_KEY_PLAINTEXT_PREFIX + randomBytes(32).toString("base64url")
}

export function hashAgentKey(key: string): string {
  return AGENT_KEY_HASH_PREFIX + createHash("sha256").update(key, "utf8").digest("hex")
}

export function isStoredAgentKeyHash(value: string): boolean {
  return value.startsWith(AGENT_KEY_HASH_PREFIX)
}

/** 헤더로 제시된 키가 조회에 쓸 수 있는 형식인지(해시 접두 거부, 길이 제한). */
export function isPresentableAgentKey(key: string | null | undefined): key is string {
  if (!key) return false
  if (key.length < 16 || key.length > 256) return false
  if (key.startsWith(AGENT_KEY_HASH_PREFIX)) return false
  return true
}

/** 수집 API 입력 상한 */
export const INGEST_MAX_BODY_BYTES = 256 * 1024
export const INGEST_MAX_MACHINES = 50
export const INGEST_MAX_MACHINE_NAME_LENGTH = 100
