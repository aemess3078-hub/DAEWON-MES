/**
 * 작업지시 제조번호 입력 정책 판정 (순수 함수 — DB/React 의존 없음).
 *
 * 품목 설정 조합:
 *   lotNumberingType: DEFAULT | MANUAL | RAW_DATE_SEQ | PREFIX_MONTH_SEQ
 *   manualLotPolicy : ALLOWED | REQUIRED | DISABLED
 *
 * 대원정밀은 LOT/제조번호 자동 채번 규칙이 확정되지 않아(lot-brand-guard) 자동 발행이 불가능하다(autoAllowed=false).
 * 이 모듈은 새 채번 규칙을 만들지 않고, 현재 규칙으로 처리할 수 없는 설정 조합에 대해 **명확한 안내**만 돌려준다.
 * 품목 정책을 바꾸지 않는다.
 *
 * 판정 순서
 *  1. 직접 입력 필수(MANUAL 또는 REQUIRED) + 직접 입력 금지(DISABLED) → 설정 충돌 오류
 *  2. 직접 입력 필수 + 번호 없음 → 직접 입력 요구
 *  3. 직접 입력 금지(DISABLED) + (번호 입력함 또는 자동 발행 대상): 자동 발행 가능하면 AUTO, 아니면 오류
 *     (DISABLED 에서는 입력한 번호가 무시되므로, 자동 발행이 불가능하면 작업지시를 만들 수 없다는 점을 알린다)
 *  4. 번호 입력함 → MANUAL
 *  5. 번호 없음: 자동 발행 대상(blankMeansAuto)이면 가능 시 AUTO, 불가 시 오류 / 아니면 NONE(번호 없이 저장)
 */

import { DAEWON_LOT_RULE_NOT_CONFIGURED_MESSAGE } from "./lot-brand-guard"

export const MANUFACTURING_NO_REQUIRED_MESSAGE = "제조번호를 직접 입력해야 하는 품목입니다."
export const MANUFACTURING_NO_POLICY_CONFLICT_MESSAGE =
  "이 품목의 LOT 정책이 서로 충돌합니다(직접 입력 필수이면서 직접 입력 금지). 품목 정보의 LOT 정책을 확인해 주세요."
export const MANUFACTURING_NO_DISABLED_NO_AUTO_MESSAGE =
  "이 품목은 제조번호 직접 입력이 허용되지 않도록 설정되어 있는데, 대원정밀 제조번호 자동 채번 규칙은 아직 확정되지 않았습니다. 품목의 LOT 정책(직접 입력 허용 여부)을 확인해 주세요."

export type ManufacturingNoDecision =
  | { kind: "MANUAL"; value: string }
  | { kind: "AUTO" }
  | { kind: "NONE" }
  | { kind: "ERROR"; message: string }

export function decideManufacturingNo(params: {
  lotNumberingType?: string | null
  manualLotPolicy?: string | null
  input?: string | null
  /** 자동 채번이 가능한가 (대원정밀: false) */
  autoAllowed: boolean
  /** 번호가 비어 있을 때 자동 발행을 시도하는 흐름인가 (등록: true, 수정: false) */
  blankMeansAuto: boolean
}): ManufacturingNoDecision {
  const value = params.input?.trim() || ""
  const required = params.lotNumberingType === "MANUAL" || params.manualLotPolicy === "REQUIRED"
  const disabled = params.manualLotPolicy === "DISABLED"

  if (required && disabled) return { kind: "ERROR", message: MANUFACTURING_NO_POLICY_CONFLICT_MESSAGE }
  if (required && !value) return { kind: "ERROR", message: MANUFACTURING_NO_REQUIRED_MESSAGE }
  if (disabled && (value || params.blankMeansAuto)) {
    return params.autoAllowed
      ? { kind: "AUTO" }
      : { kind: "ERROR", message: MANUFACTURING_NO_DISABLED_NO_AUTO_MESSAGE }
  }
  if (value) return { kind: "MANUAL", value }
  if (!params.blankMeansAuto) return { kind: "NONE" }
  return params.autoAllowed
    ? { kind: "AUTO" }
    : { kind: "ERROR", message: DAEWON_LOT_RULE_NOT_CONFIGURED_MESSAGE }
}
