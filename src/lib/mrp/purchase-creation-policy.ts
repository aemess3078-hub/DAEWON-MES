/**
 * MRP 결과 → 구매발주(DRAFT) 생성 정책
 *
 * 수주기준 / 생산계획 MRP 는 같은 공통 파이프라인(mrp-purchase-draft.service: 요청 ID 멱등성 · tenant 잠금 ·
 * DRAFT Coverage 중복 방지 · 공급업체/MOQ/발주배수 서버 재검증 · 실행 Snapshot 연결)으로만 발주를 만든다.
 * 이 정책은 "기능을 켤지"만 판정한다. 권한(MRP·PURCHASE_ORDER CREATE, OPERATOR 이상)과 위 검증은 정책과 무관하게 항상 수행된다.
 *
 * 기본값은 비활성이다. 아래 둘 중 하나일 때만 켜진다.
 *  1) 명시적 활성화 — 환경변수 MRP_PURCHASE_CREATION_ENABLED=1 (정확히 "1"). 운영(Vercel Production) 포함 어느 환경이든
 *     배포 설정에서 이 값을 직접 지정해야만 켜진다. 값이 없거나 "1" 이 아니면 꺼진다.
 *  2) 로컬 개발 호환 — 환경변수 MRP_PURCHASE_CREATION_LOCAL=1 + DATABASE_URL 호스트가 루프백(127.0.0.1 / localhost / ::1)
 *     + Vercel 환경이 아님. (이 경로는 운영에서 절대 켜지지 않는다.)
 * 이 값은 서버 액션이 권한 확인 직후 요청마다 읽는다. 화면 버튼 상태는 서버가 내려준 같은 판정을 따르지만 화면은 방어선이 아니다.
 * (상수 하나를 true 로 바꿔 여는 방식이 아니다.)
 */

export type MrpPurchaseCreationPolicy = { enabled: boolean; reason: "ENABLED_EXPLICIT" | "ENABLED_LOCAL" | "DISABLED" }

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
  if (env.MRP_PURCHASE_CREATION_ENABLED === "1") return { enabled: true, reason: "ENABLED_EXPLICIT" }
  if (env.VERCEL || env.VERCEL_ENV) return { enabled: false, reason: "DISABLED" }
  if (env.MRP_PURCHASE_CREATION_LOCAL === "1") {
    const host = databaseHost(env.DATABASE_URL)
    if (host !== null && LOOPBACK_HOSTS.has(host)) return { enabled: true, reason: "ENABLED_LOCAL" }
  }
  return { enabled: false, reason: "DISABLED" }
}

export function isMrpPurchaseCreationEnabled(env?: Readonly<Record<string, string | undefined>>): boolean {
  return evaluateMrpPurchaseCreationPolicy(env).enabled
}

export const MRP_PURCHASE_CREATION_DISABLED_MESSAGE =
  "이 환경에서는 MRP 결과로 구매발주를 생성할 수 없습니다. MRP 계산 결과는 조회용으로 확인하시고, 구매발주는 발주관리 화면에서 직접 등록해 주세요."
