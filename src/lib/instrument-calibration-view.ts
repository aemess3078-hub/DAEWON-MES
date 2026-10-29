// 계측기 검교정관리 화면/서버 공용: 원본 행 → 표시용 행 변환, 필터, KPI, 엑셀 행 (순수 모듈)

import {
  CALIBRATION_PROGRESS_LABELS,
  CALIBRATION_RESULT_LABELS,
  CALIBRATION_STATE_LABELS,
  USAGE_STATUS_LABELS,
  computeCalibrationState,
  computeRemainingDays,
  deriveScheduleProgress,
  evaluateInstrumentUsability,
  formatIntervalMonths,
  summarizeCalibrations,
  type CalibrationProgressValue,
  type CalibrationRecordLike,
  type CalibrationResultValue,
  type CalibrationStateValue,
  type InstrumentUsageStatusValue,
} from "./instrument-calibration"

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

export type DataSourceValue = "MANUAL" | "EXCEL_IMPORT"

// ─── 서버 → 변환 입력 ─────────────────────────────────────────────────────────

export type RawCalibration = {
  id: string
  progressStatus: CalibrationProgressValue
  plannedDate: string | null
  calibrationDate: string | null
  agency: string | null
  certificateNo: string | null
  result: CalibrationResultValue | null
  nextCalibrationDate: string | null
  nextDateOverridden: boolean
  nextDateChangeReason: string | null
  cost: number | null
  managerId: string | null
  managerName: string | null
  remarks: string | null
  source: DataSourceValue
  sourceRef: string | null
  cancelledAt: string | null
  cancelReason: string | null
  createdAtMs: number
}

export type RawInstrument = {
  id: string
  managementNo: string
  name: string
  category: string | null
  specification: string | null
  serialNo: string | null
  manufacturer: string | null
  calibrationRequired: boolean
  calibrationIntervalMonths: number | null
  department: string | null
  location: string | null
  managerId: string | null
  managerName: string | null
  usageStatus: InstrumentUsageStatusValue
  lastCalibrationDate: string | null
  nextCalibrationDate: string | null
  currentCalibrationId: string | null
  remarks: string | null
  source: DataSourceValue
  sourceRef: string | null
  calibrations: RawCalibration[]
}

// ─── 표시용 행 ────────────────────────────────────────────────────────────────

export type InstrumentRow = {
  id: string
  managementNo: string
  name: string
  category: string
  specification: string
  serialNo: string
  manufacturer: string
  calibrationRequired: boolean
  calibrationIntervalMonths: number | null
  intervalLabel: string
  department: string
  location: string
  managerId: string | null
  managerName: string
  usageStatus: InstrumentUsageStatusValue
  lastCalibrationDate: string | null
  nextCalibrationDate: string | null
  remainingDays: number | null
  calibrationState: CalibrationStateValue
  latestResult: CalibrationResultValue | null
  usable: boolean
  blockReasons: string[]
  warnings: string[]
  currentAgency: string
  currentCertificateNo: string
  scheduleProgress: CalibrationProgressValue
  openCalibrationId: string | null
  plannedDate: string | null
  scheduleManagerId: string | null
  scheduleManagerName: string
  scheduleAgency: string
  remarks: string
  source: DataSourceValue
  historyCount: number
}

export type CalibrationRow = {
  id: string
  instrumentId: string
  managementNo: string
  instrumentName: string
  category: string
  progressStatus: CalibrationProgressValue
  plannedDate: string | null
  calibrationDate: string | null
  agency: string
  certificateNo: string
  result: CalibrationResultValue | null
  nextCalibrationDate: string | null
  nextDateOverridden: boolean
  nextDateChangeReason: string
  cost: number | null
  managerId: string | null
  managerName: string
  remarks: string
  source: DataSourceValue
  sourceRef: string
  cancelled: boolean
  cancelReason: string
  isCurrent: boolean
  createdAtMs: number
}

function toRecordLike(c: RawCalibration): CalibrationRecordLike {
  return {
    id: c.id,
    progressStatus: c.progressStatus,
    calibrationDate: c.calibrationDate,
    nextCalibrationDate: c.nextCalibrationDate,
    result: c.result,
    cancelled: c.cancelledAt !== null,
    createdAtMs: c.createdAtMs,
  }
}

export function buildViewRows(
  raws: RawInstrument[],
  asOf: string,
): { instruments: InstrumentRow[]; calibrations: CalibrationRow[] } {
  const instruments: InstrumentRow[] = []
  const calibrations: CalibrationRow[] = []

  for (const raw of raws) {
    const summary = summarizeCalibrations(raw.calibrations.map(toRecordLike))
    const state = computeCalibrationState(
      { usageStatus: raw.usageStatus, calibrationRequired: raw.calibrationRequired, nextCalibrationDate: raw.nextCalibrationDate },
      asOf,
    )
    const usability = evaluateInstrumentUsability(
      {
        usageStatus: raw.usageStatus,
        calibrationRequired: raw.calibrationRequired,
        nextCalibrationDate: raw.nextCalibrationDate,
        latestResult: summary.latestResult,
      },
      asOf,
    )

    const current = raw.calibrations.find((c) => c.id === raw.currentCalibrationId) ?? null
    const open =
      [...raw.calibrations]
        .filter((c) => c.cancelledAt === null && c.progressStatus !== "COMPLETED")
        .sort((a, b) => b.createdAtMs - a.createdAtMs)[0] ?? null
    const completedCount = raw.calibrations.filter((c) => c.progressStatus === "COMPLETED").length

    instruments.push({
      id: raw.id,
      managementNo: raw.managementNo,
      name: raw.name,
      category: raw.category ?? "",
      specification: raw.specification ?? "",
      serialNo: raw.serialNo ?? "",
      manufacturer: raw.manufacturer ?? "",
      calibrationRequired: raw.calibrationRequired,
      calibrationIntervalMonths: raw.calibrationIntervalMonths,
      intervalLabel: formatIntervalMonths(raw.calibrationIntervalMonths, raw.calibrationRequired),
      department: raw.department ?? "",
      location: raw.location ?? "",
      managerId: raw.managerId,
      managerName: raw.managerName ?? "",
      usageStatus: raw.usageStatus,
      lastCalibrationDate: raw.lastCalibrationDate,
      nextCalibrationDate: raw.nextCalibrationDate,
      remainingDays: computeRemainingDays(raw.nextCalibrationDate, asOf),
      calibrationState: state,
      latestResult: summary.latestResult,
      usable: usability.usable,
      blockReasons: usability.blockReasons,
      warnings: usability.warnings,
      currentAgency: current?.agency ?? "",
      currentCertificateNo: current?.certificateNo ?? "",
      scheduleProgress: deriveScheduleProgress(open?.progressStatus ?? null, state),
      openCalibrationId: open?.id ?? null,
      plannedDate: open?.plannedDate ?? null,
      scheduleManagerId: open?.managerId ?? null,
      scheduleManagerName: open?.managerName ?? "",
      scheduleAgency: open?.agency ?? "",
      remarks: raw.remarks ?? "",
      source: raw.source,
      historyCount: completedCount,
    })

    for (const c of raw.calibrations) {
      calibrations.push({
        id: c.id,
        instrumentId: raw.id,
        managementNo: raw.managementNo,
        instrumentName: raw.name,
        category: raw.category ?? "",
        progressStatus: c.progressStatus,
        plannedDate: c.plannedDate,
        calibrationDate: c.calibrationDate,
        agency: c.agency ?? "",
        certificateNo: c.certificateNo ?? "",
        result: c.result,
        nextCalibrationDate: c.nextCalibrationDate,
        nextDateOverridden: c.nextDateOverridden,
        nextDateChangeReason: c.nextDateChangeReason ?? "",
        cost: c.cost,
        managerId: c.managerId,
        managerName: c.managerName ?? "",
        remarks: c.remarks ?? "",
        source: c.source,
        sourceRef: c.sourceRef ?? "",
        cancelled: c.cancelledAt !== null,
        cancelReason: c.cancelReason ?? "",
        isCurrent: c.id === raw.currentCalibrationId,
        createdAtMs: c.createdAtMs,
      })
    }
  }

  instruments.sort((a, b) => a.managementNo.localeCompare(b.managementNo, "ko", { numeric: true }))
  return { instruments, calibrations }
}

// ─── KPI ──────────────────────────────────────────────────────────────────────

export type KpiKey = "ALL" | "USABLE" | "DUE_SOON" | "OVERDUE" | "INACTIVE"

export type InstrumentKpis = Record<KpiKey, number>

/** KPI 카드 하나가 대표하는 계측기인가 (카드 클릭 필터와 집계가 같은 기준을 쓴다) */
export function matchesKpi(row: InstrumentRow, key: KpiKey): boolean {
  switch (key) {
    case "ALL":
      return true
    case "USABLE":
      return row.usable
    case "DUE_SOON":
      return row.calibrationState === "DUE_SOON" && row.usageStatus !== "DISPOSED"
    case "OVERDUE":
      return row.calibrationState === "OVERDUE"
    case "INACTIVE":
      return row.usageStatus === "SUSPENDED" || row.usageStatus === "DISPOSED"
  }
}

export function computeKpis(rows: InstrumentRow[]): InstrumentKpis {
  const keys: KpiKey[] = ["ALL", "USABLE", "DUE_SOON", "OVERDUE", "INACTIVE"]
  const result = { ALL: 0, USABLE: 0, DUE_SOON: 0, OVERDUE: 0, INACTIVE: 0 } as InstrumentKpis
  for (const row of rows) for (const key of keys) if (matchesKpi(row, key)) result[key] += 1
  return result
}

// ─── 필터 ─────────────────────────────────────────────────────────────────────

export type InstrumentFilters = {
  /** 관리번호/계측기명 부분일치 */
  query?: string
  category?: string
  department?: string
  usageStatus?: InstrumentUsageStatusValue | ""
  calibrationState?: CalibrationStateValue | ""
  kpi?: KpiKey
  /** 차기교정일 기간 (YYYY-MM-DD, 포함) */
  nextDateFrom?: string
  nextDateTo?: string
  scheduleProgress?: CalibrationProgressValue | ""
}

export function filterInstrumentRows(rows: InstrumentRow[], filters: InstrumentFilters): InstrumentRow[] {
  const query = (filters.query ?? "").trim().toLowerCase()
  return rows.filter((row) => {
    if (query && !row.managementNo.toLowerCase().includes(query) && !row.name.toLowerCase().includes(query)) return false
    if (filters.category && row.category !== filters.category) return false
    if (filters.department && row.department !== filters.department) return false
    if (filters.usageStatus && row.usageStatus !== filters.usageStatus) return false
    if (filters.calibrationState && row.calibrationState !== filters.calibrationState) return false
    if (filters.kpi && !matchesKpi(row, filters.kpi)) return false
    if (filters.scheduleProgress && row.scheduleProgress !== filters.scheduleProgress) return false
    if (filters.nextDateFrom && (!row.nextCalibrationDate || row.nextCalibrationDate < filters.nextDateFrom)) return false
    if (filters.nextDateTo && (!row.nextCalibrationDate || row.nextCalibrationDate > filters.nextDateTo)) return false
    return true
  })
}

export type CalibrationFilters = {
  query?: string
  result?: CalibrationResultValue | ""
  /** 교정일 기간 (YYYY-MM-DD, 포함) */
  dateFrom?: string
  dateTo?: string
  includeCancelled?: boolean
}

export function filterCalibrationRows(rows: CalibrationRow[], filters: CalibrationFilters): CalibrationRow[] {
  const query = (filters.query ?? "").trim().toLowerCase()
  return rows.filter((row) => {
    if (row.progressStatus !== "COMPLETED") return false
    if (!filters.includeCancelled && row.cancelled) return false
    if (query) {
      const haystack = `${row.managementNo} ${row.instrumentName} ${row.certificateNo} ${row.agency}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    if (filters.result && row.result !== filters.result) return false
    if (filters.dateFrom && (!row.calibrationDate || row.calibrationDate < filters.dateFrom)) return false
    if (filters.dateTo && (!row.calibrationDate || row.calibrationDate > filters.dateTo)) return false
    return true
  })
}

// ─── 엑셀 행 ──────────────────────────────────────────────────────────────────

export const INSTRUMENT_EXPORT_HEADER = [
  "No",
  "관리번호",
  "계측기명",
  "규격",
  "Serial No",
  "제조사",
  "교정주기",
  "최근교정일",
  "교정기관",
  "교정성적서번호",
  "사용부서",
  "사용상태",
  "차기교정일",
  "잔여일수",
  "교정상태",
  "비고",
] as const

/** 엑셀 셀 값. string 은 문자열 셀(관리번호/Serial No 선행 0 보존), date 는 날짜 셀, number 는 숫자 셀 */
export type ExportCell = string | number | { date: string } | null

export function toInstrumentExportRows(rows: InstrumentRow[]): ExportCell[][] {
  return rows.map((row, index) => [
    index + 1,
    row.managementNo,
    row.name,
    row.specification,
    row.serialNo,
    row.manufacturer,
    row.intervalLabel === "-" ? "" : row.intervalLabel,
    row.lastCalibrationDate ? { date: row.lastCalibrationDate } : null,
    row.currentAgency,
    row.currentCertificateNo,
    [row.department, row.location].filter(Boolean).join(" / "),
    USAGE_STATUS_LABELS[row.usageStatus],
    row.nextCalibrationDate ? { date: row.nextCalibrationDate } : null,
    row.remainingDays,
    CALIBRATION_STATE_LABELS[row.calibrationState],
    row.remarks,
  ])
}

export const CALIBRATION_EXPORT_HEADER = [
  "No",
  "관리번호",
  "계측기명",
  "교정실시일",
  "교정기관",
  "교정성적서번호",
  "교정결과",
  "차기교정일",
  "차기교정일 수정사유",
  "교정비용",
  "교정담당자",
  "구분",
  "현재 유효 이력",
  "비고",
] as const

export function toCalibrationExportRows(rows: CalibrationRow[]): ExportCell[][] {
  return rows.map((row, index) => [
    index + 1,
    row.managementNo,
    row.instrumentName,
    row.calibrationDate ? { date: row.calibrationDate } : null,
    row.agency,
    row.certificateNo,
    row.cancelled ? "취소" : row.result ? CALIBRATION_RESULT_LABELS[row.result] : "미확인(이관)",
    row.nextCalibrationDate ? { date: row.nextCalibrationDate } : null,
    row.nextDateChangeReason,
    row.cost,
    row.managerName,
    row.source === "EXCEL_IMPORT" ? "엑셀 이관" : "직접 등록",
    row.isCurrent ? "Y" : "",
    row.remarks,
  ])
}

export { CALIBRATION_PROGRESS_LABELS }
