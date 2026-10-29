// 계측기 검교정관리 공용 도메인 로직 (순수 모듈 — 서버/클라이언트/스크립트 어디서든 import 가능)
//
// 원칙
//  - 날짜는 시각 없는 달력일 문자열 "YYYY-MM-DD"(KST 기준)로만 다룬다. 계산은 UTC 달력 연산이라 timezone/DST 영향이 없다.
//  - 교정상태(정상/임박/초과/미등록/제외)는 DB 에 저장하지 않고 차기교정일과 "기준일"로 매번 계산한다.
//  - 사용 가능 판단(evaluateInstrumentUsability)은 이 파일에 두어 이후 다른 기능(예: 품질검사)이 재사용할 수 있게 한다.
//    이번 개발에서는 품질검사 등 기존 프로세스에 연결하지 않는다.

import { toKstDateKey } from "./date/kst"

// ─── 상수/라벨 ────────────────────────────────────────────────────────────────

/** 차기교정일까지 0~30일이면 교정임박, 31일 이상이면 정상 */
export const DUE_SOON_DAYS = 30

export type InstrumentUsageStatusValue = "AVAILABLE" | "SUSPENDED" | "ON_HOLD" | "DISPOSED"
export type CalibrationResultValue = "PASS" | "FAIL"
export type CalibrationProgressValue = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED"
export type CalibrationStateValue = "NORMAL" | "DUE_SOON" | "OVERDUE" | "UNREGISTERED" | "EXEMPT"

export const USAGE_STATUS_LABELS: Record<InstrumentUsageStatusValue, string> = {
  AVAILABLE: "사용가능",
  SUSPENDED: "사용중지",
  ON_HOLD: "보류",
  DISPOSED: "폐기",
}

export const CALIBRATION_STATE_LABELS: Record<CalibrationStateValue, string> = {
  NORMAL: "정상",
  DUE_SOON: "교정임박",
  OVERDUE: "기한초과",
  UNREGISTERED: "미등록",
  EXEMPT: "제외",
}

export const CALIBRATION_RESULT_LABELS: Record<CalibrationResultValue, string> = {
  PASS: "적합",
  FAIL: "부적합",
}

export const CALIBRATION_PROGRESS_LABELS: Record<CalibrationProgressValue, string> = {
  SCHEDULED: "예정",
  IN_PROGRESS: "진행중",
  COMPLETED: "완료",
}

/** 교정주기 프리셋(개월). 그 외 값은 "사용자 지정"으로 직접 입력한다. */
export const INTERVAL_PRESETS: ReadonlyArray<{ months: number; label: string }> = [
  { months: 6, label: "6개월" },
  { months: 12, label: "1년" },
  { months: 24, label: "2년" },
]

// ─── 달력일 helper ────────────────────────────────────────────────────────────

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

/** "YYYY-MM-DD" 형식이면서 실제 존재하는 날짜인가 (예: 2026-02-30, 2026-06-00 은 false) */
export function isValidDateKey(value: string | null | undefined): value is string {
  if (!value) return false
  const match = DATE_KEY_PATTERN.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false
  return day <= daysInMonth(year, month)
}

function toUtcMs(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

/** 오늘(KST 달력일). 테스트/재현을 위해 now 를 주입할 수 있다. */
export function todayDateKey(now: Date = new Date()): string {
  return toKstDateKey(now)
}

/** Date(@db.Date 는 UTC 자정으로 읽힌다) → "YYYY-MM-DD" */
export function dateToKey(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

/** "YYYY-MM-DD" → @db.Date 저장용 UTC 자정 Date */
export function dateKeyToDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

/**
 * 달력일에 개월 수를 더한다. 월말은 대상 월의 말일로 보정한다.
 *  - 2026-10-20 + 12개월 = 2027-10-20
 *  - 2024-02-29 + 12개월 = 2025-02-28 (윤년 → 평년)
 *  - 2026-08-31 +  6개월 = 2027-02-28
 */
export function addMonthsToDateKey(dateKey: string, months: number): string {
  if (!isValidDateKey(dateKey)) throw new Error(`유효하지 않은 날짜입니다: ${dateKey}`)
  if (!Number.isInteger(months)) throw new Error("개월 수는 정수여야 합니다.")
  const [year, month, day] = dateKey.split("-").map(Number)
  const index = year * 12 + (month - 1) + months
  const targetYear = Math.floor(index / 12)
  const targetMonth = (((index % 12) + 12) % 12) + 1
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth))
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`
}

/** to - from (일). 같은 날이면 0 */
export function diffDays(fromDateKey: string, toDateKey: string): number {
  return Math.round((toUtcMs(toDateKey) - toUtcMs(fromDateKey)) / 86_400_000)
}

/** 교정실시일 + 교정주기 = 차기교정일. 주기가 없거나 날짜가 잘못되면 null */
export function computeNextCalibrationDate(
  calibrationDate: string | null | undefined,
  intervalMonths: number | null | undefined,
): string | null {
  if (!isValidDateKey(calibrationDate)) return null
  if (!intervalMonths || !Number.isInteger(intervalMonths) || intervalMonths <= 0) return null
  return addMonthsToDateKey(calibrationDate, intervalMonths)
}

// ─── 교정주기 표기 ────────────────────────────────────────────────────────────

export function formatIntervalMonths(months: number | null | undefined, calibrationRequired = true): string {
  if (!calibrationRequired) return "교정대상 제외"
  if (!months) return "-"
  if (months % 12 === 0) return `${months / 12}년`
  return `${months}개월`
}

export type ParsedInterval =
  | { kind: "months"; months: number }
  | { kind: "exempt" }
  | { kind: "empty" }
  | { kind: "invalid" }

/** 엑셀/입력의 교정주기 문자열("1년", "6개월", "2년", "18개월", "교정대상 제외")을 해석한다. */
export function parseIntervalText(raw: string | null | undefined): ParsedInterval {
  const text = (raw ?? "").replace(/\s+/g, "")
  if (!text) return { kind: "empty" }
  if (/^(교정대상제외|교정제외|제외|해당없음|N\/?A)$/i.test(text)) return { kind: "exempt" }
  let match = /^(\d+)년$/.exec(text)
  if (match) {
    const years = Number(match[1])
    return years > 0 && years <= 30 ? { kind: "months", months: years * 12 } : { kind: "invalid" }
  }
  match = /^(\d+)(?:개월|월)$/.exec(text)
  if (match) {
    const months = Number(match[1])
    return months > 0 && months <= 360 ? { kind: "months", months } : { kind: "invalid" }
  }
  return { kind: "invalid" }
}

// ─── 교정상태 판정 ────────────────────────────────────────────────────────────

export type CalibrationStateInput = {
  usageStatus: InstrumentUsageStatusValue
  calibrationRequired: boolean
  nextCalibrationDate: string | null
}

/**
 * 교정상태 자동판정 (기준일 asOf = KST 달력일)
 *  - 폐기 또는 교정대상 제외 → 제외
 *  - 차기교정일 없음 → 미등록
 *  - 차기교정일 < 기준일 → 기한초과
 *  - 0~30일 → 교정임박, 31일 이상 → 정상
 */
export function computeCalibrationState(input: CalibrationStateInput, asOf: string): CalibrationStateValue {
  if (input.usageStatus === "DISPOSED" || !input.calibrationRequired) return "EXEMPT"
  if (!isValidDateKey(input.nextCalibrationDate)) return "UNREGISTERED"
  const days = diffDays(asOf, input.nextCalibrationDate)
  if (days < 0) return "OVERDUE"
  if (days <= DUE_SOON_DAYS) return "DUE_SOON"
  return "NORMAL"
}

/** 차기교정일까지 남은 일수(음수 = 초과 일수). 계산 불가면 null */
export function computeRemainingDays(nextCalibrationDate: string | null, asOf: string): number | null {
  if (!isValidDateKey(nextCalibrationDate)) return null
  return diffDays(asOf, nextCalibrationDate)
}

// ─── 사용 가능 여부 (추후 다른 기능에서 재사용) ───────────────────────────────

export type UsabilityInput = CalibrationStateInput & {
  /** 가장 최근(교정일 기준) 완료 교정의 결과. 이력이 없으면 null */
  latestResult: CalibrationResultValue | null
}

export type InstrumentUsability = {
  usable: boolean
  /** 사용을 막는 사유(하나라도 있으면 usable=false) */
  blockReasons: string[]
  /** 사용은 가능하나 주의가 필요한 사유 */
  warnings: string[]
}

/**
 * 계측기를 측정에 사용해도 되는지 판단한다.
 *  - 사용상태가 사용가능이 아니면 불가 (사용중지/보류/폐기)
 *  - 최근 교정 결과가 부적합이면 불가 (사용가능 상태로 자동 복귀하지 않는다)
 *  - 교정대상 제외 계측기는 교정 기한을 따지지 않는다
 *  - 기한초과·교정정보 미등록은 불가, 교정임박은 사용 가능 + 경고
 */
export function evaluateInstrumentUsability(input: UsabilityInput, asOf: string): InstrumentUsability {
  const blockReasons: string[] = []
  const warnings: string[] = []

  if (input.usageStatus !== "AVAILABLE") {
    blockReasons.push(`사용상태가 '${USAGE_STATUS_LABELS[input.usageStatus]}'입니다.`)
  }
  if (input.latestResult === "FAIL") {
    blockReasons.push("최근 교정 결과가 부적합입니다.")
  }

  const state = computeCalibrationState(input, asOf)
  if (input.usageStatus !== "DISPOSED" && input.calibrationRequired) {
    const days = computeRemainingDays(input.nextCalibrationDate, asOf)
    if (state === "OVERDUE" && days !== null) {
      blockReasons.push(`교정 기한이 ${Math.abs(days)}일 초과되었습니다.`)
    } else if (state === "UNREGISTERED") {
      blockReasons.push("교정 정보(차기교정일)가 등록되지 않았습니다.")
    } else if (state === "DUE_SOON" && days !== null) {
      warnings.push(days === 0 ? "오늘이 교정 기한입니다." : `교정 기한이 ${days}일 남았습니다.`)
    }
  }

  return { usable: blockReasons.length === 0, blockReasons, warnings }
}

// ─── 최신 유효 교정이력 선정 / 요약 ───────────────────────────────────────────

export type CalibrationRecordLike = {
  id: string
  progressStatus: CalibrationProgressValue
  calibrationDate: string | null
  nextCalibrationDate: string | null
  result: CalibrationResultValue | null
  cancelled: boolean
  createdAtMs: number
}

export type CalibrationSummary = {
  currentCalibrationId: string | null
  lastCalibrationDate: string | null
  nextCalibrationDate: string | null
  /** 가장 최근(교정일 기준) 완료 교정의 결과 — 부적합 여부 판단용 */
  latestResult: CalibrationResultValue | null
}

function compareText(a: string | null, b: string | null): number {
  // null(교정일 미상 = 이관된 과거 이력)은 가장 낮은 순위
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return a < b ? -1 : 1
}

function compareRecords(a: CalibrationRecordLike, b: CalibrationRecordLike): number {
  return (
    compareText(a.calibrationDate, b.calibrationDate) ||
    compareText(a.nextCalibrationDate, b.nextCalibrationDate) ||
    a.createdAtMs - b.createdAtMs
  )
}

/**
 * 계측기의 교정이력 전체에서 "현재 유효한 교정"을 고르고 마스터 요약값을 만든다.
 *  - 취소된 이력, 완료되지 않은(예정/진행중) 이력, 부적합 이력, 차기교정일이 없는 이력은 현재 교정이 될 수 없다.
 *  - 교정일이 가장 늦은 이력이 이긴다(교정일 미상 이력은 가장 낮음). 따라서 과거 이력을 나중에 등록해도
 *    최신 교정일/차기교정일이 과거 값으로 되돌아가지 않는다.
 *  - 부적합 이력은 현재 교정이 되지 못하며, 최신 결과(latestResult)로만 반영되어 사용 불가 판단에 쓰인다.
 */
export function summarizeCalibrations(records: CalibrationRecordLike[]): CalibrationSummary {
  const completed = records.filter((r) => !r.cancelled && r.progressStatus === "COMPLETED")
  const effective = completed.filter((r) => r.result !== "FAIL" && isValidDateKey(r.nextCalibrationDate))
  const current = effective.length > 0 ? [...effective].sort(compareRecords)[effective.length - 1] : null

  const dated = completed.filter((r) => isValidDateKey(r.calibrationDate))
  const latestDated = dated.length > 0 ? [...dated].sort(compareRecords)[dated.length - 1] : null

  return {
    currentCalibrationId: current?.id ?? null,
    lastCalibrationDate: current?.calibrationDate ?? null,
    nextCalibrationDate: current?.nextCalibrationDate ?? null,
    latestResult: latestDated?.result ?? null,
  }
}

/** 교정 진행상태(일정관리 탭용): 열린(예정/진행중, 미취소) 이력이 있으면 그 상태, 없으면 교정상태로 유추 */
export function deriveScheduleProgress(
  openRecordStatus: CalibrationProgressValue | null,
  state: CalibrationStateValue,
): CalibrationProgressValue {
  if (openRecordStatus === "IN_PROGRESS" || openRecordStatus === "SCHEDULED") return openRecordStatus
  return state === "NORMAL" || state === "EXEMPT" ? "COMPLETED" : "SCHEDULED"
}

// ─── 관리번호/문자열 정규화 ───────────────────────────────────────────────────

/** 관리번호 비교용 키 (앞뒤 공백 제거 + 대문자). DW-A01 과 dw-a01 을 같은 번호로 본다. */
export function normalizeManagementNo(value: string): string {
  return value.trim().toUpperCase()
}
