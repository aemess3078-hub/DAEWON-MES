/**
 * 자재출고 LOT "출고 적격성" 판단 — 수동 LOT 선택 목록 · QR 스캔 조회 · 출고 확정(서버 액션)이 모두 같은 규칙을 쓴다.
 * 순수 함수(DB/DOM 비의존)라 서버/클라이언트/테스트에서 같은 결과를 낸다.
 *
 * 프로젝트의 실제 정의(prisma/schema.prisma, LOT 관리 화면)
 *  - Lot.status(LotStatus): ACTIVE(활성) · QUARANTINE(격리) · ON_HOLD(보류) · CONSUMED(소진) · EXPIRED(만료).
 *    값은 LOT 관리 화면의 [상태 변경] 메뉴(updateLotStatus)로만 바뀐다 — 자동 전환(소진/만료 자동 처리)은 코드에 없다.
 *  - Lot.expiryDate(DateTime?): 선택 입력(LOT 생성 화면). 자재입고는 값을 넣지 않는다 → 비어 있으면 "유효기간을 관리하지 않는 LOT".
 *
 * 정책
 *  - 출고 허용: status = ACTIVE 이고, 유효기간이 있으면 오늘(한국 날짜)이 유효기간 날짜 이하일 때(유효기간 당일까지 사용 가능).
 *  - 출고 제한: QUARANTINE · ON_HOLD · CONSUMED · EXPIRED, 유효기간이 지난 LOT, 그리고 정의되지 않은 상태값(안전 쪽으로 차단).
 *  - "가용재고 없음"은 이 함수의 범위가 아니다(기존 재고 조회/차감 검증이 그대로 담당한다).
 */

export type LotIssueBlockCode = "LOT_RESTRICTED" | "LOT_EXPIRED"

export type LotIssueEligibility = { eligible: true } | { eligible: false; code: LotIssueBlockCode; message: string; label: string }

export const ISSUABLE_LOT_STATUS = "ACTIVE"

const STATUS_MESSAGES: Record<string, { code: LotIssueBlockCode; message: string; label: string }> = {
  QUARANTINE: { code: "LOT_RESTRICTED", label: "격리", message: "격리(QUARANTINE) 상태의 LOT 입니다. 격리가 해제되기 전에는 출고할 수 없습니다." },
  ON_HOLD: { code: "LOT_RESTRICTED", label: "보류", message: "보류(ON_HOLD) 상태의 LOT 입니다. 보류가 해제되기 전에는 출고할 수 없습니다." },
  CONSUMED: { code: "LOT_RESTRICTED", label: "소진", message: "소진(CONSUMED) 처리된 LOT 입니다. 출고할 수 없습니다." },
  EXPIRED: { code: "LOT_EXPIRED", label: "만료", message: "유효기간 만료(EXPIRED) 처리된 LOT 입니다. 출고할 수 없습니다." },
}

/** 한국 시간 기준 YYYY-MM-DD */
export function kstDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * LOT 1건의 출고 적격성. 상태를 먼저, 그다음 유효기간을 본다.
 * @param now 기준 시각(테스트용). 기본 현재 시각.
 */
export function evaluateLotIssueEligibility(
  lot: { status: unknown; expiryDate?: Date | string | null },
  now: Date = new Date(),
): LotIssueEligibility {
  const status = String(lot.status ?? "")
  if (status !== ISSUABLE_LOT_STATUS) {
    const known = STATUS_MESSAGES[status]
    if (known) return { eligible: false, ...known }
    // 정의되지 않은 상태값: 임의로 허용하지 않는다(안전 쪽 차단).
    return { eligible: false, code: "LOT_RESTRICTED", label: "상태 불명", message: `알 수 없는 LOT 상태(${status || "없음"})입니다. LOT 관리 화면에서 상태를 확인해 주세요.` }
  }
  const expiry = toDate(lot.expiryDate)
  if (expiry && kstDateString(expiry) < kstDateString(now)) {
    return { eligible: false, code: "LOT_EXPIRED", label: "유효기간 경과", message: `유효기간(${kstDateString(expiry)})이 지난 LOT 입니다. 출고할 수 없습니다.` }
  }
  return { eligible: true }
}

/** 출고 확정 서버 액션용 오류 문구: 어떤 LOT 인지 함께 알려 준다. */
export function lotIssueBlockedMessage(lotNo: string, result: Extract<LotIssueEligibility, { eligible: false }>): string {
  return `LOT ${lotNo} 출고 불가: ${result.message}`
}
