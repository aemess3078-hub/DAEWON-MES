import { prisma } from "@/lib/db/prisma"

/**
 * 로그인 실패 잠금 / IP 실패 제한 정책 (스키마 변경 없이 UserCredential 과 LoginHistory 를 재사용).
 *
 * ── 자동 잠금과 수동 잠금의 구분 ──────────────────────────────────────────────
 * UserCredential.isLocked 는 하나의 필드지만, 현재 코드에서 isLocked=true 를 쓰는 곳은
 * 로그인 실패 자동 잠금(/api/auth/login) 하나뿐이다. 이때 항상 아래 세 조건이 함께 기록된다.
 *   isLocked = true  AND  lockedAt != null  AND  failCount >= LOGIN_FAIL_LOCK_THRESHOLD
 * 이 조합("자동 잠금 서명")인 경우에만 cooldown 후 자동으로 풀린다.
 * 관리자가 별도 수단(DB/향후 기능)으로 잠근 계정은 lockedAt 이 null 이거나 failCount 가 임계치 미만이므로
 * 이 서명에 해당하지 않아 **시간이 지나도 자동 해제되지 않는다.**
 * 수동 잠금 기능을 만들 때는 lockedAt 을 null 로 두거나(권장) failCount 를 임계치 미만으로 유지할 것.
 */

export const LOGIN_FAIL_LOCK_THRESHOLD = 5
/** 자동 잠금 cooldown: 이 시간이 지나면 다시 로그인 시도 가능 */
export const LOGIN_LOCK_COOLDOWN_MS = 15 * 60 * 1000

/** 동일 IP 의 로그인 실패 제한: 시간창과 한도 (공장/사무실 NAT 고려해 넉넉히, POP PIN 정책과 별도) */
export const LOGIN_IP_FAIL_WINDOW_MS = 10 * 60 * 1000
export const LOGIN_IP_FAIL_LIMIT = 20

/** POP PIN 로그인 실패 이력이 LoginHistory 에 쓰는 loginId. 웹 로그인 IP 제한 집계에서는 제외한다. */
export const POP_PIN_LOGIN_HISTORY_ID = "pop-pin-login"

export type LockState = {
  isLocked: boolean
  lockedAt: Date | null
  failCount: number
}

/** 로그인 실패 자동 잠금의 서명을 가진 잠금인지 */
export function isAutoLock(c: LockState): boolean {
  return c.isLocked && c.lockedAt != null && c.failCount >= LOGIN_FAIL_LOCK_THRESHOLD
}

/** 자동 잠금이고 cooldown 이 지났는지(= 이제 다시 시도해도 되는지). 수동 잠금은 항상 false. */
export function isAutoLockExpired(c: LockState, nowMs: number = Date.now()): boolean {
  if (!isAutoLock(c)) return false
  return nowMs - (c.lockedAt as Date).getTime() >= LOGIN_LOCK_COOLDOWN_MS
}

/**
 * 같은 IP 에서 최근 시간창 동안 웹 로그인 실패가 한도 이상이면 true.
 * ip 를 알 수 없거나 조회에 실패하면 false (로그인을 막지 않는다 — createLoginHistoryLog 와 동일한 fail-open).
 */
export async function isLoginIpThrottled(tenantId: string, ip: string | null): Promise<boolean> {
  if (!ip) return false
  try {
    const failures = await prisma.loginHistory.count({
      where: {
        tenantId,
        ipAddress: ip,
        eventType: "LOGIN_FAIL",
        loginId: { not: POP_PIN_LOGIN_HISTORY_ID },
        createdAt: { gte: new Date(Date.now() - LOGIN_IP_FAIL_WINDOW_MS) },
      },
    })
    return failures >= LOGIN_IP_FAIL_LIMIT
  } catch {
    return false
  }
}
