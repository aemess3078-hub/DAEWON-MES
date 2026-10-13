/**
 * MRP 기간/날짜 유틸 (순수 모듈)
 *
 * 정책: 엔진 내부의 모든 날짜는 시간대 영향이 없는 date-only 문자열("YYYY-MM-DD")이다.
 *  - 비교는 문자열 사전순 비교(= 달력 순서)이므로 하루 밀림이 발생하지 않는다.
 *  - Date → date-only 변환은 호출자가 명시적으로 `toDateOnly(date, timeZone)` 로 수행한다.
 *    (기본 Asia/Seoul. 현재 시각은 이 모듈이 읽지 않는다.)
 *  - 기간은 양끝 포함: from <= date <= to
 */

import type { DateOnly } from "./types"

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== "string") return false
  const m = DATE_ONLY_PATTERN.exec(value)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth
}

/** a<b → 음수, a==b → 0, a>b → 양수. 두 값 모두 유효한 DateOnly 여야 한다. */
export function compareDateOnly(a: DateOnly, b: DateOnly): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Date 를 지정한 시간대의 달력 날짜로 변환한다 (기본 Asia/Seoul).
 * 입력 Date 만 사용하며 현재 시각을 읽지 않는다.
 */
export function toDateOnly(date: Date, timeZone = "Asia/Seoul"): DateOnly {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** Excel 날짜 일련번호(1900 date system, 1900-03-01 이후) → DateOnly */
export function excelSerialToDateOnly(serial: number): DateOnly {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

export type MrpPeriod = {
  from: DateOnly | null
  to: DateOnly | null
}

/** from/to 양끝 포함 판정. null 경계는 무제한. date 가 null 이면 false. */
export function isWithinPeriod(
  date: DateOnly | null,
  period: MrpPeriod
): boolean {
  if (date === null) return false
  if (period.from !== null && date < period.from) return false
  if (period.to !== null && date > period.to) return false
  return true
}

// ─── 달력 단위 기간 (월 / 분기 / 반기 / 연) ──────────────────────────────────
//
// Excel 의 년/월/분기/반기 ▲▼ 에 대응한다. 모두 달력 기준이며 양끝 포함이다.
//  - 월   : 1일 ~ 말일 (윤년 2월 29일 포함)
//  - 분기 : Q1 01-01~03-31, Q2 04-01~06-30, Q3 07-01~09-30, Q4 10-01~12-31
//  - 반기 : 상반기 01-01~06-30, 하반기 07-01~12-31
//  - 연   : 01-01 ~ 12-31
// "오늘" 같은 기준일은 함수가 읽지 않고 호출자가 DateOnly 로 전달한다.

export type PeriodKind = "MONTH" | "QUARTER" | "HALF" | "YEAR"

/** index: MONTH 1~12, QUARTER 1~4, HALF 1~2, YEAR 는 항상 1 */
export type PeriodUnit = { kind: PeriodKind; year: number; index: number }

const MONTHS_PER: Record<PeriodKind, number> = { MONTH: 1, QUARTER: 3, HALF: 6, YEAR: 12 }
const UNITS_PER_YEAR: Record<PeriodKind, number> = { MONTH: 12, QUARTER: 4, HALF: 2, YEAR: 1 }

const pad2 = (n: number) => String(n).padStart(2, "0")
const pad4 = (n: number) => String(n).padStart(4, "0")

/** DateOnly → [year, month, day] (유효하지 않으면 RangeError) */
export function dateOnlyParts(date: DateOnly): [number, number, number] {
  if (!isDateOnly(date)) throw new RangeError(`YYYY-MM-DD 형식이 아닙니다: ${String(date)}`)
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))]
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function unitRange(unit: PeriodUnit): { from: DateOnly; to: DateOnly } {
  const months = MONTHS_PER[unit.kind]
  if (unit.index < 1 || unit.index > UNITS_PER_YEAR[unit.kind]) {
    throw new RangeError(`${unit.kind} index 범위 오류: ${unit.index}`)
  }
  const startMonth = (unit.index - 1) * months + 1
  const endMonth = startMonth + months - 1
  return {
    from: `${pad4(unit.year)}-${pad2(startMonth)}-01`,
    to: `${pad4(unit.year)}-${pad2(endMonth)}-${pad2(lastDayOfMonth(unit.year, endMonth))}`,
  }
}

/** 기준일이 속한 단위 */
export function unitFromDate(kind: PeriodKind, date: DateOnly): PeriodUnit {
  const [year, month] = dateOnlyParts(date)
  const months = MONTHS_PER[kind]
  return { kind, year, index: Math.floor((month - 1) / months) + 1 }
}

/** delta 단위만큼 이전(-)/다음(+) 으로 이동. 연도 경계를 넘는다. */
export function shiftUnit(unit: PeriodUnit, delta: number): PeriodUnit {
  const per = UNITS_PER_YEAR[unit.kind]
  const total = unit.year * per + (unit.index - 1) + delta
  const year = Math.floor(total / per)
  const index = total - year * per + 1
  return { kind: unit.kind, year, index }
}

export function unitLabel(unit: PeriodUnit): string {
  switch (unit.kind) {
    case "MONTH":
      return `${unit.year}년 ${unit.index}월`
    case "QUARTER":
      return `${unit.year}년 ${unit.index}분기`
    case "HALF":
      return `${unit.year}년 ${unit.index === 1 ? "상반기" : "하반기"}`
    default:
      return `${unit.year}년`
  }
}

export function unitsEqual(a: PeriodUnit | null, b: PeriodUnit | null): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.year === b.year && a.index === b.index
}

/** from~to 가 정확히 어떤 달력 단위(월/분기/반기/연)와 같으면 그 단위를, 아니면 null */
export function matchUnit(from: DateOnly | null, to: DateOnly | null): PeriodUnit | null {
  if (from === null || to === null || !isDateOnly(from) || !isDateOnly(to)) return null
  for (const kind of ["MONTH", "QUARTER", "HALF", "YEAR"] as const) {
    const unit = unitFromDate(kind, from)
    const r = unitRange(unit)
    if (r.from === from && r.to === to) return unit
  }
  return null
}

// ─── 화면 상태 ───────────────────────────────────────────────────────────────

export type PeriodSelection =
  | { mode: "ALL" }
  | { mode: "UNIT"; unit: PeriodUnit }
  | { mode: "CUSTOM"; from: DateOnly | null; to: DateOnly | null }

export function selectionRange(sel: PeriodSelection): { from: DateOnly | null; to: DateOnly | null } {
  if (sel.mode === "ALL") return { from: null, to: null }
  if (sel.mode === "UNIT") return unitRange(sel.unit)
  return { from: sel.from, to: sel.to }
}

/** 날짜 범위(예: URL query, 직접 입력)에서 선택 상태를 복원한다 */
export function selectionFromRange(from: DateOnly | null, to: DateOnly | null): PeriodSelection {
  if (from === null && to === null) return { mode: "ALL" }
  const unit = matchUnit(from, to)
  return unit ? { mode: "UNIT", unit } : { mode: "CUSTOM", from, to }
}

/** 빠른 선택 프리셋. baseDate 는 "오늘"(KST date-only)로 호출자가 전달한다. */
export type PeriodPreset =
  | "ALL"
  | "THIS_MONTH"
  | "NEXT_MONTH"
  | "THIS_QUARTER"
  | "NEXT_QUARTER"
  | "H1"
  | "H2"
  | "THIS_YEAR"

export function presetSelection(preset: PeriodPreset, baseDate: DateOnly): PeriodSelection {
  const [year] = dateOnlyParts(baseDate)
  switch (preset) {
    case "ALL":
      return { mode: "ALL" }
    case "THIS_MONTH":
      return { mode: "UNIT", unit: unitFromDate("MONTH", baseDate) }
    case "NEXT_MONTH":
      return { mode: "UNIT", unit: shiftUnit(unitFromDate("MONTH", baseDate), 1) }
    case "THIS_QUARTER":
      return { mode: "UNIT", unit: unitFromDate("QUARTER", baseDate) }
    case "NEXT_QUARTER":
      return { mode: "UNIT", unit: shiftUnit(unitFromDate("QUARTER", baseDate), 1) }
    case "H1":
      return { mode: "UNIT", unit: { kind: "HALF", year, index: 1 } }
    case "H2":
      return { mode: "UNIT", unit: { kind: "HALF", year, index: 2 } }
    default:
      return { mode: "UNIT", unit: { kind: "YEAR", year, index: 1 } }
  }
}

/** 단위 기간 이전/다음 이동. UNIT 이 아니면 그대로 반환 */
export function moveSelection(sel: PeriodSelection, delta: number): PeriodSelection {
  return sel.mode === "UNIT" ? { mode: "UNIT", unit: shiftUnit(sel.unit, delta) } : sel
}

export function selectionLabel(sel: PeriodSelection): string {
  if (sel.mode === "ALL") return "전체 미출하"
  if (sel.mode === "UNIT") return unitLabel(sel.unit)
  if (sel.from && sel.to) return `${sel.from} ~ ${sel.to}`
  if (sel.from) return `${sel.from} 이후`
  if (sel.to) return `${sel.to} 이전`
  return "전체 미출하"
}
