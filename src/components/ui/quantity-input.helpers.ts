// quantity-input.tsx("use client")는 React/JSX에 의존하므로, ts-node로 직접
// 실행 가능한 순수 로직(sanitize/format)을 이 파일로 분리한다
// (defect-cause-analysis.helpers.ts / spc-calculations.ts와 동일한 이유).
// code-path 테스트는 scripts/test-number-format.ts 참조.
//
// 상대경로만 사용한다 — ts-node로 직접 실행할 때 "@/" alias가 해석되지
// 않기 때문(기존 test-*.ts 스크립트들과 동일한 제약).
import { formatQuantity } from "../../lib/utils"

/**
 * 타이핑 중인 원시 입력을 "정규 raw 문자열"로 정리한다.
 * - 콤마 제거(붙여넣기 "1,234.56" 대응)
 * - 숫자/'.'/선행 '-'(allowNegative일 때만) 외 문자 제거
 * - '.'은 최초 1개만 유지
 * - 정수부 선행 0 정규화("05" -> "5", "0"은 유지)
 * - 소수부는 maxDecimals까지만 유지(반올림 없이 그 이상은 자름 — 갑작스러운
 *   반올림으로 사용자를 놀라게 하지 않기 위함)
 * - maxDecimals가 0이면 '.' 자체를 허용하지 않는다(정수 전용 필드)
 *
 * 이 함수가 반환하는 문자열은 formatLiveDisplay()가 콤마만 삽입하면 그대로
 * 화면에 표시할 수 있는 "콤마 없는 canonical 형태"다 — 즉 sanitized 문자열과
 * 화면 표시 문자열의 차이는 콤마뿐이므로, caret 위치 계산이 단순해진다.
 */
export function sanitizeTypedValue(
  raw: string,
  { allowNegative, maxDecimals }: { allowNegative: boolean; maxDecimals: number }
): string {
  let s = raw.replace(/,/g, "")

  const negative = allowNegative && s.trimStart().startsWith("-")
  s = s.replace(/[^0-9.]/g, "")

  const firstDot = s.indexOf(".")
  let intPart = firstDot === -1 ? s : s.slice(0, firstDot)
  let decPart = firstDot === -1 ? "" : s.slice(firstDot + 1).replace(/\./g, "")

  intPart = intPart.replace(/^0+(?=\d)/, "")

  const hasDecimals = maxDecimals > 0
  decPart = hasDecimals ? decPart.slice(0, maxDecimals) : ""

  const hasDot = firstDot !== -1 && hasDecimals
  const body = hasDot ? `${intPart}.${decPart}` : intPart

  // body가 빈 문자열이어도(예: 사용자가 방금 '-'만 입력한 상태) 부호는 보존한다
  // — 그래야 "-" -> "-1" -> "-1.5"로 이어지는 타이핑이 중간에 끊기지 않는다.
  return negative ? `-${body}` : body
}

/** sanitizeTypedValue()가 반환한 canonical 문자열의 정수부에만 콤마를 삽입한다. */
export function formatLiveDisplay(sanitized: string): string {
  if (sanitized === "" || sanitized === "-") return sanitized

  const negative = sanitized.startsWith("-")
  const body = negative ? sanitized.slice(1) : sanitized
  const dotIndex = body.indexOf(".")
  const intPart = dotIndex === -1 ? body : body.slice(0, dotIndex)
  const rest = dotIndex === -1 ? "" : body.slice(dotIndex) // '.'과 소수부 그대로 보존

  const intWithCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `${negative ? "-" : ""}${intWithCommas}${rest}`
}

/**
 * blur/mount 시점의 canonical 표시 문자열. 공통 formatQuantity()를 그대로
 * 재사용하되(하드코딩 중복 방지), 편집 필드에서는 "-"(null 표시 관례)를
 * 빈 문자열로 바꾼다 — 입력창에 "-" 텍스트가 남아있으면 사용자가 직접 입력한
 * 음수 부호로 오해할 수 있기 때문이다.
 */
export function toEditableDisplay(
  value: number | string | null | undefined,
  maxDecimals: number
): string {
  const formatted = formatQuantity(value, { maxDecimals })
  return formatted === "-" ? "" : formatted
}

export const TRACKED_CHAR_PATTERN = /[0-9.\-]/
