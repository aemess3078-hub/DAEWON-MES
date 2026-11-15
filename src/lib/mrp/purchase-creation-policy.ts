/**
 * MRP 결과 → 구매발주(DRAFT) 생성 정책
 *
 * 수주기준 / 생산계획 MRP 는 같은 공통 파이프라인(mrp-purchase-draft.service: 요청 ID 멱등성 · tenant 잠금 ·
 * DRAFT Coverage 중복 방지 · 공급업체/MOQ/발주배수 서버 재검증 · 실행 Snapshot 연결)으로만 발주를 만든다.
 *
 * 활성화 조건 — 아래를 모두 만족할 때만 켜진다(운영/Vercel 에서는 켜질 수 없다):
 *  1) 환경변수 MRP_PURCHASE_CREATION_LOCAL=1  (로컬 .env.local 에서만 설정)
 *  2) DATABASE_URL 호스트가 루프백(127.0.0.1 / localhost / ::1) — 운영 DB 로는 켜지지 않는다
 *  3) VERCEL 환경이 아님
 * 이 값은 서버 액션이 권한 확인 직후 읽는다. 화면 버튼 상태는 서버가 내려준 같은 판정을 따르지만 화면은 방어선이 아니다.
 * (상수 하나를 true 로 바꿔 여는 방식이 아니다 — 환경 판정이 서버에서 매 요청마다 수행된다.)
 */

export type MrpPurchaseCreationPolicy = { enabled: boolean; reason: "ENABLED" | "NOT_LOCAL_FLAG" | "NOT_LOCAL_DB" | "HOSTED" }

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

function databaseHost(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function evaluateMrpPurchaseCreationPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env
): MrpPurchaseCreationPolicy {
  if (env.VERCEL || env.VERCEL_ENV) return { enabled: false, reason: "HOSTED" }
  if (env.MRP_PURCHASE_CREATION_LOCAL !== "1") return { enabled: false, reason: "NOT_LOCAL_FLAG" }
  const host = databaseHost(env.DATABASE_URL)
  if (host === null || !LOOPBACK_HOSTS.has(host)) return { enabled: false, reason: "NOT_LOCAL_DB" }
  return { enabled: true, reason: "ENABLED" }
}

export function isMrpPurchaseCreationEnabled(env?: Readonly<Record<string, string | undefined>>): boolean {
  return evaluateMrpPurchaseCreationPolicy(env).enabled
}

export const MRP_PURCHASE_CREATION_DISABLED_MESSAGE =
  "이 환경에서는 MRP 결과로 구매발주를 생성할 수 없습니다. MRP 계산 결과는 조회용으로 확인하시고, 구매발주는 발주관리 화면에서 직접 등록해 주세요."
