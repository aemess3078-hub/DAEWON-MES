// 계측기 검교정 엑셀 이관 계획 생성기 (순수 모듈 — DB/브라우저 의존 없음)
//
// 입력: 엑셀 시트별 행 배열(문자열). 브라우저에서 SheetJS 로 읽어 `sheet_to_json(ws, { header: 1, raw: false, defval: "" })`
//       형태로 만든 값을 그대로 넣는다(Serial No/성적서번호 선행 0 보존을 위해 "표시 문자열"을 쓴다).
// 출력: 계측기 생성 후보 / 교정이력 생성 후보 / 오류·경고 목록. DB 비교(classifyImportPlan)는 별도 함수.
//
// 이관 기준
//  - 종합 관리대장("계측기 검교정 계획서")만 계측기 기본정보의 기준이다. 종류별(A - 캘리퍼스 ...)·날짜별(20240403 ...) 시트는
//    교정이력 후보로만 쓰고 계측기를 새로 만들지 않는다.
//  - 엑셀에는 교정실시일·적합여부 칸이 비어 있다. 시트 이름의 날짜는 실제 교정실시일이 아니므로 교정일/결과를 만들지 않고
//    (calibrationDate=null, result=null) 교정기관·성적서번호·차기교정일만 "이관 이력"으로 보존한다.
//  - 사용불가/폐기 계측기는 사용가능으로 이관하지 않는다.
//  - 이관 이력의 중복 판단 키(sourceKey) = 관리번호 + 성적서번호 + 차기교정일. 같은 파일을 다시 이관해도 중복이 생기지 않는다.

import {
  isValidDateKey,
  normalizeManagementNo,
  parseIntervalText,
  type InstrumentUsageStatusValue,
} from "./instrument-calibration"

export const MASTER_SHEET_NAME_HINT = "계측기 검교정 계획서"
export const IMPORT_SOURCE_TAG = "엑셀 이관"
const MANAGEMENT_NO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,49}$/
const TYPE_SHEET_PATTERN = /^([A-Za-z])\s*-\s*(.+)$/
const DATED_SHEET_PATTERN = /^\d{8}$/
export const MAX_IMPORT_SHEETS = 60
export const MAX_IMPORT_ROWS_PER_SHEET = 2000

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export type ImportSheetInput = { name: string; rows: string[][] }

export type ImportIssue = {
  level: "error" | "warning" | "info"
  sheet: string
  rowRef: string
  managementNo: string
  message: string
}

export type ImportInstrumentData = {
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
  usageStatus: InstrumentUsageStatusValue
  remarks: string | null
  sourceRef: string
}

export type ImportCalibrationData = {
  sourceKey: string
  managementNo: string
  calibrationAgency: string | null
  certificateNo: string | null
  nextCalibrationDate: string | null
  sourceRef: string
  remarks: string
}

export type PlannedInstrument = {
  rowRef: string
  data: ImportInstrumentData
  action: "NEW" | "EXISTING"
  /** 이미 등록된 계측기와 엑셀 값이 다른 항목(참고용 — 기존 값은 덮어쓰지 않는다) */
  differences: string[]
}

export type PlannedCalibration = {
  data: ImportCalibrationData
  sheet: string
  rowRef: string
  action: "NEW" | "DUPLICATE" | "SKIPPED"
  reason?: string
}

export type ImportPlan = {
  masterSheet: string | null
  sheetsRead: number
  instruments: PlannedInstrument[]
  calibrations: PlannedCalibration[]
  issues: ImportIssue[]
}

export type ImportPlanSummary = {
  masterSheet: string | null
  sheetsRead: number
  instrumentsNew: number
  instrumentsExisting: number
  instrumentErrors: number
  calibrationsNew: number
  calibrationsDuplicate: number
  calibrationsSkipped: number
  warnings: number
}

type InstrumentCandidate = Omit<PlannedInstrument, "action" | "differences">

type CalibrationCandidate = {
  data: ImportCalibrationData
  sheet: string
  rowRef: string
  priority: number
}

// ─── 문자열/날짜 정규화 ───────────────────────────────────────────────────────

function clean(value: unknown): string {
  return (value == null ? "" : String(value))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function cut(value: string, max: number): string | null {
  return value ? value.slice(0, max) : null
}

/** "2026.04.18" / "2026-04-18" / "2026/4/18" / "20260418" → "2026-04-18". 실패하면 null(빈 문자열도 null) */
export function parseExcelDate(raw: string): string | null {
  const text = clean(raw)
  if (!text) return null
  let match = /^(\d{4})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{1,2})\.?$/.exec(text)
  if (!match) match = /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  if (!match) return null
  const key = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`
  return isValidDateKey(key) ? key : null
}

function normalizeLabel(value: string): string {
  return clean(value).replace(/\s+/g, "")
}

// ─── 헤더 해석 ────────────────────────────────────────────────────────────────

type ColumnMap = Partial<
  Record<
    | "managementNo"
    | "name"
    | "specification"
    | "serialNo"
    | "manufacturer"
    | "interval"
    | "plan"
    | "agency"
    | "certificate"
    | "department"
    | "status"
    | "nextDate"
    | "remarks",
    number
  >
>

function resolveColumns(rows: string[][]): { map: ColumnMap; dataStart: number } | null {
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalizeLabel(cell) === "관리번호"))
  if (headerIndex < 0) return null
  const header = rows[headerIndex] ?? []
  const sub = rows[headerIndex + 1] ?? []
  const width = Math.max(header.length, sub.length)
  const map: ColumnMap = {}

  const assign = (key: keyof ColumnMap, index: number) => {
    if (map[key] === undefined) map[key] = index
  }

  for (let col = 0; col < width; col++) {
    const main = normalizeLabel(header[col] ?? "")
    const second = normalizeLabel(sub[col] ?? "")
    // 병합 셀 때문에 같은 열의 라벨이 위/아래 줄 어디에 있을 수 있다.
    for (const label of [main, second]) {
      if (!label) continue
      if (label === "관리번호") assign("managementNo", col)
      else if (label === "계측기명") assign("name", col)
      else if (label === "규격") assign("specification", col)
      else if (label.toLowerCase() === "serialno") assign("serialNo", col)
      else if (label === "제조사") assign("manufacturer", col)
      else if (label === "교정주기") assign("interval", col)
      else if (label === "계획") assign("plan", col)
      else if (label === "교정기관") assign("agency", col)
      else if (label === "교정번호" || label === "교정성적서번호" || label === "성적서번호") assign("certificate", col)
      else if (label.startsWith("사용부서")) assign("department", col)
      else if (label === "제품상태" || label === "사용상태") assign("status", col)
      else if (label === "차기교정일") assign("nextDate", col)
      else if (label === "비고") assign("remarks", col)
    }
  }

  const hasSubHeader = Boolean(sub.some((cell) => ["계획", "실적", "교정기관"].includes(normalizeLabel(cell))))
  return { map, dataStart: headerIndex + (hasSubHeader ? 2 : 1) }
}

function cell(row: string[], index: number | undefined): string {
  return index === undefined ? "" : clean(row[index])
}

// ─── 매핑 규칙 ────────────────────────────────────────────────────────────────

function mapUsageStatus(
  statusText: string,
  remarks: string,
  planText: string,
): { status: InstrumentUsageStatusValue; warning?: string } {
  const joined = `${statusText} ${remarks}`
  if (joined.includes("폐기")) return { status: "DISPOSED" }
  if (statusText === "사용불가" || statusText === "사용중지") return { status: "SUSPENDED" }
  if (statusText === "보류" || remarks.includes("보류") || planText.includes("보류")) return { status: "ON_HOLD" }
  if (statusText === "사용가능") return { status: "AVAILABLE" }
  return {
    status: "ON_HOLD",
    warning: `제품상태 '${statusText || "(공란)"}'을(를) 해석할 수 없어 '보류'로 이관합니다. 확인 후 사용상태를 지정하세요.`,
  }
}

/** 사용부서(장소) 값: '~부'로 끝나면 사용부서, 아니면 사용장소로 본다(부서를 임의로 추정하지 않는다). */
function splitDepartment(value: string): { department: string | null; location: string | null } {
  if (!value) return { department: null, location: null }
  return /부$/.test(value) ? { department: value, location: null } : { department: null, location: value }
}

function categoryLetter(managementNo: string): string | null {
  const match = /^[A-Za-z]+-([A-Za-z])\d+$/.exec(managementNo.trim())
  return match ? match[1].toUpperCase() : null
}

function buildSourceKey(managementNo: string, certificateNo: string, nextDate: string | null): string {
  return `XL|${normalizeManagementNo(managementNo)}|${certificateNo.trim().toUpperCase()}|${nextDate ?? ""}`
}

// ─── 계획 생성 ────────────────────────────────────────────────────────────────

export function buildImportPlan(sheets: ImportSheetInput[]): ImportPlan {
  const issues: ImportIssue[] = []
  const push = (level: ImportIssue["level"], sheet: string, rowRef: string, managementNo: string, message: string) =>
    issues.push({ level, sheet, rowRef, managementNo, message })

  if (sheets.length > MAX_IMPORT_SHEETS) {
    push("error", "(파일)", "-", "", `시트가 너무 많습니다(최대 ${MAX_IMPORT_SHEETS}개).`)
    return { masterSheet: null, sheetsRead: 0, instruments: [], calibrations: [], issues }
  }

  // 1) 시트 분류
  const typeNames = new Map<string, string>() // 분류 문자 → 분류명
  const masterCandidates: ImportSheetInput[] = []
  const historySheets: Array<{ sheet: ImportSheetInput; priority: number }> = []

  for (const sheet of sheets) {
    if (sheet.rows.length > MAX_IMPORT_ROWS_PER_SHEET) {
      push("error", sheet.name, "-", "", `행이 너무 많습니다(최대 ${MAX_IMPORT_ROWS_PER_SHEET}행).`)
      continue
    }
    const name = clean(sheet.name)
    const typeMatch = TYPE_SHEET_PATTERN.exec(name)
    if (typeMatch) {
      typeNames.set(typeMatch[1].toUpperCase(), clean(typeMatch[2]))
      historySheets.push({ sheet, priority: 3 })
    } else if (DATED_SHEET_PATTERN.test(name)) {
      historySheets.push({ sheet, priority: 2 })
    } else if (resolveColumns(sheet.rows)) {
      masterCandidates.push(sheet)
    } else {
      push("info", name, "-", "", "관리번호 헤더가 없어 읽지 않았습니다.")
    }
  }

  // 종합 관리대장: 이름에 힌트가 있는 시트 우선, 없으면 첫 번째 후보
  const master = masterCandidates.find((s) => clean(s.name).includes(MASTER_SHEET_NAME_HINT)) ?? masterCandidates[0] ?? null
  for (const extra of masterCandidates) {
    if (extra !== master) push("warning", extra.name, "-", "", "종합 관리대장이 아닌 시트라 읽지 않았습니다.")
  }

  const instruments: InstrumentCandidate[] = []
  const calibrationCandidates: CalibrationCandidate[] = []
  const seenInstrumentKeys = new Map<string, string>() // key → 첫 행 ref
  const serialSeen = new Map<string, string>() // serial → 관리번호

  // 2) 종합 관리대장 → 계측기 + 교정이력 후보
  if (!master) {
    push("error", "(파일)", "-", "", `종합 관리대장 시트('${MASTER_SHEET_NAME_HINT}')를 찾을 수 없습니다.`)
  } else {
    const layout = resolveColumns(master.rows)!
    const { map } = layout
    if (map.managementNo === undefined || map.name === undefined) {
      push("error", master.name, "-", "", "관리번호/계측기명 열을 찾을 수 없습니다.")
    } else {
      for (let i = layout.dataStart; i < master.rows.length; i++) {
        const row = master.rows[i] ?? []
        const rowRef = `R${i + 1}`
        const managementNo = cell(row, map.managementNo)
        if (!managementNo) continue // 빈 줄/결재란 등

        const name = cell(row, map.name)
        if (!MANAGEMENT_NO_PATTERN.test(managementNo)) {
          push("error", master.name, rowRef, managementNo, "관리번호 형식이 올바르지 않습니다(영문·숫자·-·_·. 만, 최대 50자).")
          continue
        }
        if (!name) {
          push("error", master.name, rowRef, managementNo, "계측기명이 비어 있습니다.")
          continue
        }
        const key = normalizeManagementNo(managementNo)
        if (seenInstrumentKeys.has(key)) {
          push("error", master.name, rowRef, managementNo, `관리번호가 ${seenInstrumentKeys.get(key)} 행과 중복됩니다.`)
          continue
        }

        const remarksText = cell(row, map.remarks)
        const planText = cell(row, map.plan)
        const statusText = cell(row, map.status)
        const status = mapUsageStatus(statusText, remarksText, planText)
        if (status.warning) push("warning", master.name, rowRef, managementNo, status.warning)

        const intervalRaw = cell(row, map.interval)
        const interval = parseIntervalText(intervalRaw)
        let calibrationRequired = true
        let intervalMonths: number | null = null
        if (interval.kind === "months") intervalMonths = interval.months
        else if (interval.kind === "exempt") calibrationRequired = false
        else if (interval.kind === "invalid") {
          push("error", master.name, rowRef, managementNo, `교정주기 '${intervalRaw}'을(를) 해석할 수 없습니다(예: 6개월, 1년, 2년).`)
          continue
        } else if (status.status !== "DISPOSED") {
          push("warning", master.name, rowRef, managementNo, "교정주기가 비어 있습니다. 등록 후 직접 지정하세요.")
        }

        const serialNo = cell(row, map.serialNo)
        if (serialNo) {
          const owner = serialSeen.get(serialNo)
          if (owner) push("warning", master.name, rowRef, managementNo, `Serial No '${serialNo}'이(가) ${owner}와 같습니다(그대로 이관).`)
          else serialSeen.set(serialNo, managementNo)
        }

        const { department, location } = splitDepartment(cell(row, map.department))
        const remarkParts: string[] = []
        if (remarksText) remarkParts.push(remarksText)
        if (planText && planText !== "보류" && !/^\d{4}년/.test(planText)) remarkParts.push(`교정계획: ${planText}`)

        const letter = categoryLetter(managementNo)
        seenInstrumentKeys.set(key, rowRef)
        instruments.push({
          rowRef,
          data: {
            managementNo,
            name: name.slice(0, 200),
            category: letter ? (typeNames.get(letter) ?? null) : null,
            specification: cut(cell(row, map.specification), 200),
            serialNo: cut(serialNo, 100),
            manufacturer: cut(cell(row, map.manufacturer), 100),
            calibrationRequired,
            calibrationIntervalMonths: intervalMonths,
            department: cut(department ?? "", 100),
            location: cut(location ?? "", 100),
            usageStatus: status.status,
            remarks: cut(remarkParts.join(" / "), 500),
            sourceRef: `${master.name}!${rowRef}`,
          },
        })
        collectCalibrationCandidate(master.name, rowRef, row, map, 1)
      }
    }
  }

  // 3) 종류별/날짜별 시트 → 교정이력 후보만
  for (const { sheet, priority } of historySheets) {
    const layout = resolveColumns(sheet.rows)
    if (!layout || layout.map.managementNo === undefined) {
      push("warning", sheet.name, "-", "", "관리번호 헤더를 찾을 수 없어 읽지 않았습니다.")
      continue
    }
    for (let i = layout.dataStart; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? []
      if (!cell(row, layout.map.managementNo)) continue
      collectCalibrationCandidate(sheet.name, `R${i + 1}`, row, layout.map, priority)
    }
  }

  function collectCalibrationCandidate(sheet: string, rowRef: string, row: string[], map: ColumnMap, priority: number) {
    const managementNo = cell(row, map.managementNo)
    if (!MANAGEMENT_NO_PATTERN.test(managementNo)) return
    const agency = cell(row, map.agency)
    const certificateNo = cell(row, map.certificate)
    const nextRaw = cell(row, map.nextDate)
    if (!agency && !certificateNo && !nextRaw) return // 폐기 등 교정 정보가 전혀 없는 행

    const nextDate = parseExcelDate(nextRaw)
    if (nextRaw && !nextDate) {
      push("warning", sheet, rowRef, managementNo, `차기교정일 '${nextRaw}'은(는) 올바른 날짜가 아닙니다.${certificateNo ? " 차기교정일 없이 이력만 이관합니다." : " 이력을 이관하지 않습니다."}`)
      if (!certificateNo) return
    }
    if (!certificateNo && !nextDate) return

    calibrationCandidates.push({
      sheet,
      rowRef,
      priority,
      data: {
        sourceKey: buildSourceKey(managementNo, certificateNo, nextDate),
        managementNo,
        calibrationAgency: cut(agency, 100),
        certificateNo: cut(certificateNo, 100),
        nextCalibrationDate: nextDate,
        sourceRef: `${sheet}!${rowRef}`,
        remarks: `${IMPORT_SOURCE_TAG}(${sheet}): 교정실시일·적합여부 미기재`,
      },
    })
  }

  // 4) 이력 후보 중복 제거 (종합 관리대장 > 날짜별 > 종류별 순으로 먼저 본 것을 유지)
  const ordered = [...calibrationCandidates].sort((a, b) => a.priority - b.priority || a.sheet.localeCompare(b.sheet))
  const calibrations: PlannedCalibration[] = []
  const seenKeys = new Set<string>()
  for (const candidate of ordered) {
    if (seenKeys.has(candidate.data.sourceKey)) continue // 다른 시트의 동일 이력 — 하나로 합친다
    seenKeys.add(candidate.data.sourceKey)
    calibrations.push({ data: candidate.data, sheet: candidate.sheet, rowRef: candidate.rowRef, action: "NEW" })
  }

  return {
    masterSheet: master?.name ?? null,
    sheetsRead: (master ? 1 : 0) + historySheets.length,
    instruments: instruments.map((item) => ({ ...item, action: "NEW", differences: [] })),
    calibrations,
    issues,
  }
}

// ─── DB 비교 ──────────────────────────────────────────────────────────────────

export type ExistingInstrumentForImport = {
  id: string
  managementNo: string
  name: string
  specification: string | null
  serialNo: string | null
  manufacturer: string | null
  deleted: boolean
}

export type ExistingCalibrationForImport = {
  instrumentId: string
  certificateNo: string | null
  nextCalibrationDate: string | null
  sourceKey: string | null
}

/**
 * 계획을 DB 현재 상태와 비교해 신규/기존/중복을 분류한다.
 *  - 이미 있는 관리번호는 기존 값을 덮어쓰지 않는다(EXISTING). 소프트 삭제된 계측기도 같은 관리번호로 새로 만들지 않는다.
 *  - 교정이력은 sourceKey 또는 (계측기, 성적서번호, 차기교정일)이 같으면 중복(DUPLICATE)이다.
 *  - 관리대장에도 DB 에도 없는 관리번호의 이력은 건너뛴다(SKIPPED).
 */
export function classifyImportPlan(
  plan: ImportPlan,
  existingInstruments: ExistingInstrumentForImport[],
  existingCalibrations: ExistingCalibrationForImport[],
): ImportPlan {
  const issues = [...plan.issues]
  const existingByKey = new Map(existingInstruments.map((item) => [normalizeManagementNo(item.managementNo), item]))
  const idByKey = new Map(existingInstruments.map((item) => [normalizeManagementNo(item.managementNo), item.id]))

  const instruments: PlannedInstrument[] = plan.instruments.map((item) => {
    const existing = existingByKey.get(normalizeManagementNo(item.data.managementNo))
    if (!existing) return { ...item, action: "NEW", differences: [] }
    const differences: string[] = []
    if (existing.name !== item.data.name) differences.push(`계측기명(${existing.name} ↔ ${item.data.name})`)
    if ((existing.specification ?? "") !== (item.data.specification ?? "")) differences.push("규격")
    if ((existing.serialNo ?? "") !== (item.data.serialNo ?? "")) differences.push("Serial No")
    if ((existing.manufacturer ?? "") !== (item.data.manufacturer ?? "")) differences.push("제조사")
    if (existing.deleted) {
      issues.push({
        level: "warning",
        sheet: plan.masterSheet ?? "",
        rowRef: item.rowRef,
        managementNo: item.data.managementNo,
        message: "삭제 처리된 계측기와 관리번호가 같습니다. 새로 만들지 않고 건너뜁니다.",
      })
    }
    return { ...item, action: "EXISTING", differences }
  })

  const importedKeys = new Set(
    plan.instruments.map((item) => normalizeManagementNo(item.data.managementNo)),
  )
  const existingPairs = new Set(
    existingCalibrations.map((c) => `${c.instrumentId}|${(c.certificateNo ?? "").toUpperCase()}|${c.nextCalibrationDate ?? ""}`),
  )
  const existingSourceKeys = new Set(existingCalibrations.map((c) => c.sourceKey).filter((k): k is string => Boolean(k)))

  const calibrations: PlannedCalibration[] = plan.calibrations.map((item) => {
    const key = normalizeManagementNo(item.data.managementNo)
    const instrumentId = idByKey.get(key)
    if (!instrumentId && !importedKeys.has(key)) {
      issues.push({
        level: "warning",
        sheet: item.sheet,
        rowRef: item.rowRef,
        managementNo: item.data.managementNo,
        message: "종합 관리대장·기존 등록에 없는 관리번호라 이력을 이관하지 않습니다.",
      })
      return { ...item, action: "SKIPPED", reason: "미등록 관리번호" }
    }
    if (existingSourceKeys.has(item.data.sourceKey)) return { ...item, action: "DUPLICATE", reason: "이미 이관된 이력" }
    if (instrumentId) {
      const pair = `${instrumentId}|${(item.data.certificateNo ?? "").toUpperCase()}|${item.data.nextCalibrationDate ?? ""}`
      if (existingPairs.has(pair)) return { ...item, action: "DUPLICATE", reason: "동일한 성적서번호/차기교정일 이력 존재" }
    }
    return { ...item, action: "NEW" }
  })

  return { ...plan, instruments, calibrations, issues }
}

export function summarizeImportPlan(plan: ImportPlan): ImportPlanSummary {
  return {
    masterSheet: plan.masterSheet,
    sheetsRead: plan.sheetsRead,
    instrumentsNew: plan.instruments.filter((i) => i.action === "NEW").length,
    instrumentsExisting: plan.instruments.filter((i) => i.action === "EXISTING").length,
    instrumentErrors: plan.issues.filter((i) => i.level === "error").length,
    calibrationsNew: plan.calibrations.filter((c) => c.action === "NEW").length,
    calibrationsDuplicate: plan.calibrations.filter((c) => c.action === "DUPLICATE").length,
    calibrationsSkipped: plan.calibrations.filter((c) => c.action === "SKIPPED").length,
    warnings: plan.issues.filter((i) => i.level === "warning").length,
  }
}
