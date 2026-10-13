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
