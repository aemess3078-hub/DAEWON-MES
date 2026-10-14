/**
 * 식별자/문자열 정규화 (순수)
 *
 * 원칙: 식별자(코드)는 원본을 훼손하지 않는다. 문제를 "진단"할 뿐 임의로 고치지 않는다.
 */

import type { CodeInfo, GridCell, UomName } from "./types"

/** 보이지 않는/제어 문자 정규식(코드 포인트로 구성: 소스에 특수 문자를 직접 쓰지 않는다) */
function rangeClass(ranges: Array<[number, number]>): string {
  return ranges.map(([a, b]) => String.fromCharCode(a) + (b > a ? '-' + String.fromCharCode(b) : '')).join('')
}
const HIDDEN_CHARS = new RegExp('[' + rangeClass([[0, 8], [11, 12], [14, 31], [127, 127], [160, 160], [0x200b, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0xfeff, 0xfeff]]) + ']')
/** 공백으로 취급할 보이지 않는 문자(NBSP, zero-width, BOM) */
export const INVISIBLE_SPACE = new RegExp('[' + rangeClass([[160, 160], [0x200b, 0x200f], [0xfeff, 0xfeff]]) + ']', 'g')

/** 셀 → 식별자 정보. 숫자 셀은 선행 0/지수 표기가 이미 손실됐을 수 있어 진단한다. */
export function inspectCode(cell: GridCell, numberFormat?: string): CodeInfo {
  if (cell === null || cell === undefined || cell === "") {
    return { raw: null, numericCell: false, diagnostics: ["EMPTY"], foldKey: null }
  }
  const diagnostics: string[] = []
  let raw: string
  let numericCell = false
  if (typeof cell === "number") {
    numericCell = true
    raw = String(cell)
    diagnostics.push("NUMERIC_CELL")
    if (numberFormat && /^0+$/.test(numberFormat)) diagnostics.push("LEADING_ZERO_FORMAT")
  } else {
    raw = String(cell)
  }
  if (raw.length === 0) return { raw: null, numericCell, diagnostics: ["EMPTY"], foldKey: null }
  if (raw.trim().length === 0) return { raw, numericCell, diagnostics: ["BLANK"], foldKey: null }
  if (raw !== raw.trim()) diagnostics.push("OUTER_WHITESPACE")
  if (HIDDEN_CHARS.test(raw)) diagnostics.push("HIDDEN_CHAR")
  if (/\s{2,}/.test(raw.trim())) diagnostics.push("INNER_WHITESPACE_RUN")
  if (raw !== raw.normalize("NFKC")) diagnostics.push("FULLWIDTH_OR_COMPAT")
  const foldKey = raw.normalize("NFKC").replace(INVISIBLE_SPACE, "").trim().replace(/\s+/g, " ").toUpperCase()
  return { raw, numericCell, diagnostics, foldKey }
}

/** 이름/규격 같은 설명 문자열: 바깥 공백만 제거(식별자가 아니다). 비어 있으면 null */
export function cleanText(cell: GridCell): string | null {
  if (cell === null || cell === undefined) return null
  const s = typeof cell === "number" ? String(cell) : String(cell)
  const t = s.replace(INVISIBLE_SPACE, " ").trim()
  return t.length === 0 ? null : t
}

const UOMS: readonly UomName[] = ["EA", "KG", "G", "L", "ML", "M", "CM", "MM", "BOX", "SET"]

/** 단위: MES enum 과 정확히 일치할 때만 인정한다(대소문자/공백 보정 없음 → 호출부가 REVIEW 처리). */
export function exactUom(value: string | null): UomName | null {
  if (value === null) return null
  return (UOMS as readonly string[]).includes(value) ? (value as UomName) : null
}

/** 단위 후보(공백/대소문자만 다른 경우) — 자동 적용하지 않고 제안으로만 쓴다 */
export function uomSuggestion(value: string | null): UomName | null {
  if (value === null) return null
  const t = value.normalize("NFKC").trim().toUpperCase()
  return (UOMS as readonly string[]).includes(t) ? (t as UomName) : null
}

/** BOM 수량: 유한한 양수 숫자만 허용. "." / 빈칸 / 문자 / 0 / 음수는 null (자동 1 처리 금지) */
export function parseQty(value: unknown): number | null {
  if (typeof value !== "number") return null
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}
