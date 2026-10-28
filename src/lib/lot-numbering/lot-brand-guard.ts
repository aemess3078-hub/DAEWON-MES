/**
 * LOT/제조번호 자동 채번 안전 차단.
 *
 * cns-lot-rules.ts 의 규칙(접두사 "C", 연-월문자-일 패턴 등)은 CNS Medical 전용이다.
 * 대원정밀 LOT 채번 규칙은 아직 확정되지 않았으므로, 대원정밀 프로젝트에서는 이 규칙으로
 * 번호가 자동 생성되지 않도록 모든 자동 채번 경로(자재입고/제조번호/완제품 LOT/LOT 예약)의
 * 공통 진입점(resolveCnsLotRule)에서 차단한다.
 *
 * - 수동 입력(품목 lotNumberingType=MANUAL)은 영향받지 않는다.
 * - NEXT_PUBLIC_BRAND=newmes (NMES 개발 서버)에서만 기존 규칙을 허용한다.
 *   그 외(daewon 및 미설정)는 fail-closed.
 *
 * 대원정밀 LOT 번호(원자재 입고·완제품 입고·LOT 등록 화면)는 이 가드와 무관하게
 * 번호 규칙 관리에 저장된 LOT 규칙(tenant-lot-rule.ts)으로 발행한다. CNS 규칙은 여전히 적용되지 않는다.
 * 제조번호 자동 채번은 규칙이 확정되지 않아 계속 차단된다(TODO(DAEWON): 제조번호 규칙 확정 시 교체).
 */
export const DAEWON_LOT_RULE_NOT_CONFIGURED_MESSAGE =
  "대원정밀 LOT 채번 규칙이 설정되지 않았습니다. 규칙 확정 전에는 LOT/제조번호를 직접 입력해 주세요."

/**
 * 제조번호(작업지시)는 LOT 와 별개다. 번호 규칙 관리의 LOT 규칙은 LOT 번호에만 쓰이며,
 * 제조번호 규칙은 확정되지 않았으므로 제조번호는 계속 직접 입력한다.
 */
export const DAEWON_MANUFACTURING_NO_RULE_NOT_CONFIGURED_MESSAGE =
  "제조번호 자동 채번 규칙은 아직 확정되지 않았습니다. 제조번호를 직접 입력해 주세요."

export function isCnsLotRuleAllowed(): boolean {
  return process.env.NEXT_PUBLIC_BRAND === "newmes"
}

export function assertCnsLotRuleAllowed(): void {
  if (!isCnsLotRuleAllowed()) {
    throw new Error(DAEWON_LOT_RULE_NOT_CONFIGURED_MESSAGE)
  }
}
