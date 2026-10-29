import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import XLSX from "xlsx"

import {
  addMonthsToDateKey,
  computeCalibrationState,
  computeNextCalibrationDate,
  computeRemainingDays,
  diffDays,
  evaluateInstrumentUsability,
  isValidDateKey,
  parseIntervalText,
  summarizeCalibrations,
  type CalibrationRecordLike,
} from "../src/lib/instrument-calibration"
import {
  buildImportPlan,
  classifyImportPlan,
  parseExcelDate,
  summarizeImportPlan,
  type ImportSheetInput,
} from "../src/lib/instrument-calibration-import"
import { buildCalibrationWorkbook } from "../src/lib/instrument-calibration-excel"
import {
  INSTRUMENT_EXPORT_HEADER,
  buildViewRows,
  computeKpis,
  filterInstrumentRows,
  toInstrumentExportRows,
  type RawInstrument,
} from "../src/lib/instrument-calibration-view"

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${passed}: ${name}`)
}

// ─── 차기교정일 계산 ──────────────────────────────────────────────────────────

check("차기교정일: 요구사항 예시(2026-10-20 + 1년 = 2027-10-20)", () => {
  assert.equal(computeNextCalibrationDate("2026-10-20", 12), "2027-10-20")
})
check("차기교정일: 6개월/2년", () => {
  assert.equal(computeNextCalibrationDate("2026-10-20", 6), "2027-04-20")
  assert.equal(computeNextCalibrationDate("2026-10-20", 24), "2028-10-20")
})
check("차기교정일: 월말 보정 (8/31 + 6개월 = 2/28, 1/31 + 1개월 = 2/28, 윤년 1/31 + 1개월 = 2/29)", () => {
  assert.equal(addMonthsToDateKey("2026-08-31", 6), "2027-02-28")
  assert.equal(addMonthsToDateKey("2026-01-31", 1), "2026-02-28")
  assert.equal(addMonthsToDateKey("2028-01-31", 1), "2028-02-29")
  assert.equal(addMonthsToDateKey("2025-10-31", 6), "2026-04-30")
})
check("차기교정일: 윤일 2024-02-29 + 1년 = 2025-02-28, + 2년 = 2026-02-28, + 4년 = 2028-02-29", () => {
  assert.equal(addMonthsToDateKey("2024-02-29", 12), "2025-02-28")
  assert.equal(addMonthsToDateKey("2024-02-29", 24), "2026-02-28")
  assert.equal(addMonthsToDateKey("2024-02-29", 48), "2028-02-29")
})
check("차기교정일: 연도 경계와 음수 개월", () => {
  assert.equal(addMonthsToDateKey("2026-12-15", 1), "2027-01-15")
  assert.equal(addMonthsToDateKey("2026-01-15", -1), "2025-12-15")
})
check("차기교정일: 주기 없음/잘못된 날짜는 null", () => {
  assert.equal(computeNextCalibrationDate("2026-10-20", null), null)
  assert.equal(computeNextCalibrationDate("2026-02-30", 12), null)
})
check("날짜 유효성: 2026-06-00, 2026-02-30 거부 / 윤일 허용", () => {
  assert.equal(isValidDateKey("2026-06-00"), false)
  assert.equal(isValidDateKey("2026-02-30"), false)
  assert.equal(isValidDateKey("2024-02-29"), true)
  assert.equal(isValidDateKey("2025-02-29"), false)
  assert.equal(diffDays("2026-10-29", "2026-11-28"), 30)
})

// ─── 교정주기 해석 ────────────────────────────────────────────────────────────

check("교정주기 해석: 엑셀 값 호환(1년/2년/6개월/공백/교정대상 제외)", () => {
  assert.deepEqual(parseIntervalText("1년"), { kind: "months", months: 12 })
  assert.deepEqual(parseIntervalText(" 2 년 "), { kind: "months", months: 24 })
  assert.deepEqual(parseIntervalText("6개월"), { kind: "months", months: 6 })
  assert.deepEqual(parseIntervalText("18개월"), { kind: "months", months: 18 })
  assert.deepEqual(parseIntervalText(""), { kind: "empty" })
  assert.deepEqual(parseIntervalText("교정대상 제외"), { kind: "exempt" })
  assert.deepEqual(parseIntervalText("수시"), { kind: "invalid" })
})

// ─── 교정상태 판정 ────────────────────────────────────────────────────────────

const AS_OF = "2026-10-29"
const base = { usageStatus: "AVAILABLE" as const, calibrationRequired: true }

check("교정상태: 경계값(초과/D-Day/30일/31일)", () => {
  assert.equal(computeCalibrationState({ ...base, nextCalibrationDate: "2026-10-28" }, AS_OF), "OVERDUE")
  assert.equal(computeCalibrationState({ ...base, nextCalibrationDate: "2026-10-29" }, AS_OF), "DUE_SOON")
  assert.equal(computeCalibrationState({ ...base, nextCalibrationDate: "2026-11-28" }, AS_OF), "DUE_SOON")
  assert.equal(computeCalibrationState({ ...base, nextCalibrationDate: "2026-11-29" }, AS_OF), "NORMAL")
})
check("교정상태: 미등록/폐기·교정대상 제외", () => {
  assert.equal(computeCalibrationState({ ...base, nextCalibrationDate: null }, AS_OF), "UNREGISTERED")
  assert.equal(computeCalibrationState({ ...base, usageStatus: "DISPOSED", nextCalibrationDate: "2020-01-01" }, AS_OF), "EXEMPT")
  assert.equal(computeCalibrationState({ ...base, calibrationRequired: false, nextCalibrationDate: null }, AS_OF), "EXEMPT")
})
check("교정상태: 기준일이 지나면 자동으로 바뀐다(저장값이 아닌 계산값)", () => {
  const input = { ...base, nextCalibrationDate: "2026-12-01" }
  assert.equal(computeCalibrationState(input, "2026-10-29"), "NORMAL")
  assert.equal(computeCalibrationState(input, "2026-11-15"), "DUE_SOON")
  assert.equal(computeCalibrationState(input, "2026-12-02"), "OVERDUE")
  assert.equal(computeRemainingDays("2026-12-01", "2026-12-02"), -1)
})

// ─── 사용 가능 판단 ───────────────────────────────────────────────────────────

check("사용 가능 판단: 정상 계측기는 사용 가능, 교정임박은 경고만", () => {
  const ok = evaluateInstrumentUsability({ ...base, nextCalibrationDate: "2027-05-01", latestResult: "PASS" }, AS_OF)
  assert.equal(ok.usable, true)
  const soon = evaluateInstrumentUsability({ ...base, nextCalibrationDate: "2026-11-10", latestResult: null }, AS_OF)
  assert.equal(soon.usable, true)
  assert.equal(soon.warnings.length, 1)
})
check("사용 가능 판단: 기한초과/미등록/부적합/사용중지·보류·폐기는 사용 불가", () => {
  assert.equal(evaluateInstrumentUsability({ ...base, nextCalibrationDate: "2026-10-01", latestResult: null }, AS_OF).usable, false)
  assert.equal(evaluateInstrumentUsability({ ...base, nextCalibrationDate: null, latestResult: null }, AS_OF).usable, false)
  assert.equal(evaluateInstrumentUsability({ ...base, nextCalibrationDate: "2027-05-01", latestResult: "FAIL" }, AS_OF).usable, false)
  for (const usageStatus of ["SUSPENDED", "ON_HOLD", "DISPOSED"] as const) {
    assert.equal(evaluateInstrumentUsability({ ...base, usageStatus, nextCalibrationDate: "2027-05-01", latestResult: "PASS" }, AS_OF).usable, false)
  }
})
check("사용 가능 판단: 교정대상 제외 계측기는 기한을 따지지 않는다", () => {
  assert.equal(evaluateInstrumentUsability({ ...base, calibrationRequired: false, nextCalibrationDate: null, latestResult: null }, AS_OF).usable, true)
})

// ─── 최신 유효 교정이력 / 과거 이력 / 부적합 ──────────────────────────────────

let seq = 0
function rec(overrides: Partial<CalibrationRecordLike> & { id: string }): CalibrationRecordLike {
  seq += 1
  return {
    progressStatus: "COMPLETED",
    calibrationDate: null,
    nextCalibrationDate: null,
    result: "PASS",
    cancelled: false,
    createdAtMs: seq,
    ...overrides,
  }
}

check("요약: 최신 교정일의 이력이 현재 유효 이력이 된다", () => {
  const s = summarizeCalibrations([
    rec({ id: "a", calibrationDate: "2024-04-03", nextCalibrationDate: "2025-04-03" }),
    rec({ id: "b", calibrationDate: "2025-04-15", nextCalibrationDate: "2026-04-15" }),
  ])
  assert.equal(s.currentCalibrationId, "b")
  assert.equal(s.nextCalibrationDate, "2026-04-15")
  assert.equal(s.lastCalibrationDate, "2025-04-15")
})
check("요약: 과거 이력을 나중에 등록해도 최신 교정일/차기교정일이 과거 값으로 바뀌지 않는다", () => {
  const s = summarizeCalibrations([
    rec({ id: "new", calibrationDate: "2026-04-15", nextCalibrationDate: "2027-04-15" }),
    rec({ id: "late-entered-old", calibrationDate: "2023-03-01", nextCalibrationDate: "2024-03-01" }),
  ])
  assert.equal(s.currentCalibrationId, "new")
  assert.equal(s.nextCalibrationDate, "2027-04-15")
})
check("요약: 부적합 이력은 현재 교정이 될 수 없고, 계측기를 정상 교정 완료로 만들지 않는다", () => {
  const s = summarizeCalibrations([
    rec({ id: "pass", calibrationDate: "2025-04-15", nextCalibrationDate: "2026-04-15" }),
    rec({ id: "fail", calibrationDate: "2026-04-20", nextCalibrationDate: null, result: "FAIL" }),
  ])
  assert.equal(s.currentCalibrationId, "pass")
  assert.equal(s.latestResult, "FAIL")
})
check("요약: 이후 적합 교정을 등록하면 최근 결과가 적합이 된다(사용 가능 상태 자동 복귀는 별도로 하지 않음)", () => {
  const s = summarizeCalibrations([
    rec({ id: "fail", calibrationDate: "2026-04-20", nextCalibrationDate: null, result: "FAIL" }),
    rec({ id: "repass", calibrationDate: "2026-05-02", nextCalibrationDate: "2027-05-02" }),
  ])
  assert.equal(s.latestResult, "PASS")
  assert.equal(s.currentCalibrationId, "repass")
})
check("요약: 취소/미완료(예정·진행중) 이력은 제외", () => {
  const s = summarizeCalibrations([
    rec({ id: "ok", calibrationDate: "2025-04-15", nextCalibrationDate: "2026-04-15" }),
    rec({ id: "cancelled", calibrationDate: "2026-04-15", nextCalibrationDate: "2027-04-15", cancelled: true }),
    rec({ id: "open", progressStatus: "IN_PROGRESS", calibrationDate: null, nextCalibrationDate: null, result: null }),
  ])
  assert.equal(s.currentCalibrationId, "ok")
  assert.equal(s.nextCalibrationDate, "2026-04-15")
})
check("요약: 교정일 미상(엑셀 이관) 이력은 교정일이 있는 이력보다 낮은 순위, 이관 이력끼리는 차기교정일이 늦은 쪽", () => {
  const legacyOnly = summarizeCalibrations([
    rec({ id: "l1", result: null, nextCalibrationDate: "2025-04-04" }),
    rec({ id: "l2", result: null, nextCalibrationDate: "2026-04-18" }),
  ])
  assert.equal(legacyOnly.currentCalibrationId, "l2")
  assert.equal(legacyOnly.lastCalibrationDate, null)
  assert.equal(legacyOnly.latestResult, null)
  const mixed = summarizeCalibrations([
    rec({ id: "l2", result: null, nextCalibrationDate: "2026-04-18" }),
    rec({ id: "manual", calibrationDate: "2026-06-01", nextCalibrationDate: "2027-06-01" }),
  ])
  assert.equal(mixed.currentCalibrationId, "manual")
})
check("취소 후 재계산: 취소한 최신 이력 대신 직전 이력으로 돌아간다", () => {
  const s = summarizeCalibrations([
    rec({ id: "old", calibrationDate: "2025-04-15", nextCalibrationDate: "2026-04-15" }),
    rec({ id: "new", calibrationDate: "2026-04-15", nextCalibrationDate: "2027-04-15", cancelled: true }),
  ])
  assert.equal(s.currentCalibrationId, "old")
})

// ─── 화면 행 / KPI / 필터 / 엑셀 행 ───────────────────────────────────────────

function raw(overrides: Partial<RawInstrument> & { id: string; managementNo: string }): RawInstrument {
  return {
    name: "버니어캘리퍼스",
    category: null,
    specification: null,
    serialNo: null,
    manufacturer: null,
    calibrationRequired: true,
    calibrationIntervalMonths: 12,
    department: "생산부",
    location: null,
    managerId: null,
    managerName: null,
    usageStatus: "AVAILABLE",
    lastCalibrationDate: null,
    nextCalibrationDate: null,
    currentCalibrationId: null,
    remarks: null,
    source: "MANUAL",
    sourceRef: null,
    calibrations: [],
    ...overrides,
  }
}

const sample: RawInstrument[] = [
  raw({ id: "1", managementNo: "DW-A01", nextCalibrationDate: "2027-05-01", serialNo: "0089483" }),
  raw({ id: "2", managementNo: "DW-A02", nextCalibrationDate: "2026-11-10" }),
  raw({ id: "3", managementNo: "DW-A03", nextCalibrationDate: "2026-04-18" }),
  raw({ id: "4", managementNo: "DW-A04", usageStatus: "DISPOSED", nextCalibrationDate: "2020-01-01" }),
  raw({ id: "5", managementNo: "DW-A05", usageStatus: "SUSPENDED", nextCalibrationDate: "2027-05-01" }),
  raw({ id: "6", managementNo: "DW-A06" }),
]

check("KPI: 사용가능/교정임박/기한초과/사용중지·폐기 집계", () => {
  const { instruments } = buildViewRows(sample, AS_OF)
  const kpis = computeKpis(instruments)
  assert.equal(kpis.ALL, 6)
  assert.equal(kpis.USABLE, 2) // A01(정상) + A02(임박) — 초과·미등록·중지·폐기는 제외
  assert.equal(kpis.DUE_SOON, 1)
  assert.equal(kpis.OVERDUE, 1)
  assert.equal(kpis.INACTIVE, 2)
})
check("필터: 관리번호/계측기명 부분일치, 교정상태, KPI 카드 조건", () => {
  const { instruments } = buildViewRows(sample, AS_OF)
  assert.equal(filterInstrumentRows(instruments, { query: "a0" }).length, 6)
  assert.deepEqual(filterInstrumentRows(instruments, { query: "dw-a02" }).map((r) => r.managementNo), ["DW-A02"])
  assert.deepEqual(filterInstrumentRows(instruments, { calibrationState: "OVERDUE" }).map((r) => r.managementNo), ["DW-A03"])
  assert.deepEqual(filterInstrumentRows(instruments, { kpi: "INACTIVE" }).map((r) => r.managementNo), ["DW-A04", "DW-A05"])
})
check("엑셀 행: Serial No 문자열 유지(선행 0), 날짜 셀 구분, 잔여일수/교정상태", () => {
  const { instruments } = buildViewRows(sample, AS_OF)
  const rows = toInstrumentExportRows(instruments)
  assert.equal(rows[0][4], "0089483")
  assert.deepEqual(rows[0][12], { date: "2027-05-01" })
  assert.equal(rows[2][14], "기한초과")
  assert.equal(rows[2][13], -194)
})

// ─── 엑셀 다운로드 워크북 ─────────────────────────────────────────────────────

async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn()
  passed += 1
  console.log(`PASS ${passed}: ${name}`)
}

const exportedChecks = (async () => {
  const { instruments } = buildViewRows(sample, AS_OF)
  const rows = toInstrumentExportRows(instruments)
  const { XLSX, wb } = await buildCalibrationWorkbook({ sheetName: "t", header: [...INSTRUMENT_EXPORT_HEADER], rows })
  const roundTrip = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellNF: true })
  const ws = roundTrip.Sheets["t"]
  await checkAsync("엑셀 다운로드: 헤더 16개 컬럼이 요구 순서와 같다", async () => {
    const header = (XLSX.utils.sheet_to_json(ws, { header: 1 })[0] as string[])
    assert.deepEqual(header, ["No", "관리번호", "계측기명", "규격", "Serial No", "제조사", "교정주기", "최근교정일", "교정기관", "교정성적서번호", "사용부서", "사용상태", "차기교정일", "잔여일수", "교정상태", "비고"])
  })
  await checkAsync("엑셀 다운로드: Serial No 는 문자열 셀(선행 0 유지), 날짜는 날짜 서식 숫자 셀", async () => {
    const serial = ws["E2"] // DW-A01 Serial No
    assert.equal(serial.t, "s")
    assert.equal(serial.v, "0089483")
    const next = ws["M2"] // 차기교정일 2027-05-01
    assert.equal(next.t, "n")
    assert.equal(next.z, "yyyy-mm-dd")
    assert.equal(XLSX.SSF.format("yyyy-mm-dd", next.v), "2027-05-01")
    assert.equal(ws["B2"].v, "DW-A01")
  })
})()

// ─── 엑셀 이관 계획 ───────────────────────────────────────────────────────────

const header = ["No", "관리번호", "계측기명", "규격", "Serial No", "제조사", "교정주기", "검교정 계획 대비 실적", "", "", "", "", "", "차기교정일", "비 고"]
const subHeader = ["", "", "", "", "", "", "", "계획", "실적", "교정기관", "교정번호", "사용부서(장소)", "제품상태"]
const masterRows: string[][] = [
  ["계측기 검교정 관리대장"],
  [],
  [],
  [],
  header,
  subHeader,
  ["1", "DW-A01", "버니어캘리퍼스", "300/0.05", "60404998", "MITUTOYO", "1년", "", "", "에어텍", "AT25-0412-4", "생산부", "사용가능", "2026.04.18"],
  ["2", "DW-A13", "디지털캘리퍼스", "600/0.01", "0089483", "MITUTOYO", "1년", "", "", "에어텍", "AT25-01052-11", "생산부", "사용가능", "2026.10.19"],
  ["3", "DW-A03", "다이얼캘리퍼스", "300/0.02", "10580175", "MITUTOYO", "", "", "", "", "", "", "사용불가", "", "폐기"],
  ["4", "DW-H03", "나사링게이지 (GO)", "M80", "", "MIKRON", "2년", "보류", "", "㈜에이치피아이", "H18-1134-012", "생산부", "사용가능", "2020.05.31", "보류"],
  ["5", "DW-F01", "높이게이지(다이얼)", "300/0.01", "0708541", "MITUTOYO", "1년", "", "", "에어텍", "AT25-0412-25", "밸브조립실", "사용가능", "2026.04.18"],
  ["6", "DW-A01", "중복 행", "", "", "", "1년", "", "", "", "", "", "사용가능", ""],
  ["7", "DW-X01", "교정주기오류", "", "", "", "수시", "", "", "", "", "", "사용가능", ""],
  ["8", "DW-X02", "이름", "", "", "", "1년", "", "", "", "", "", "점검중", ""],
]
const datedRows: string[][] = [
  ["2024년 계측기 검교정 계획서"],
  [],
  [],
  ["No", "관리번호", "계측기명", "규격", "Serial No", "제조사", "교정주기", "2023년 검교정 계획 대비 실적", "", "", "", "", "", "차기교정일", "비 고"],
  ["", "", "", "", "", "", "", "계획", "실적", "교정기관", "교정번호", "사용부서", "제품상태"],
  ["1", "DW-A01", "버니어캘리퍼스", "300/0.05", "60404998", "MITUTOYO", "1년", "", "", "㈜에이치피아이", "H24-0663-010", "생산부", "사용가능", "2025.04.04"],
  ["2", "DW-A01", "버니어캘리퍼스", "300/0.05", "60404998", "MITUTOYO", "1년", "", "", "에어텍", "AT25-0412-4", "생산부", "사용가능", "2026.04.18"], // 마스터와 동일 → 중복
  ["3", "DW-ZZ9", "미등록", "", "", "", "1년", "", "", "에어텍", "AT-ZZ", "생산부", "사용가능", "2025.01.01"],
  ["4", "DW-A13", "디지털캘리퍼스", "", "", "", "1년", "", "", "에어텍", "", "생산부", "사용가능", "2026.06.00"],
]
const typeRows: string[][] = [
  ["계측기 검교정 관리대장"],
  [],
  [],
  [],
  header,
  subHeader,
  ["1", "DW-A01", "버니어캘리퍼스", "300/0.05", "60404998", "MITUTOYO", "1년", "", "", "에어텍", "AT25-0412-4", "생산부", "사용가능", "2026.04.18"],
]
const sheets: ImportSheetInput[] = [
  { name: "계측기 검교정 계획서", rows: masterRows },
  { name: "A - 캘리퍼스", rows: typeRows },
  { name: "20240403", rows: datedRows },
]

check("이관: 날짜 파싱('2026.04.18', 존재하지 않는 날짜 거부)", () => {
  assert.equal(parseExcelDate("2026.04.18"), "2026-04-18")
  assert.equal(parseExcelDate("2026-4-8"), "2026-04-08")
  assert.equal(parseExcelDate("20260418"), "2026-04-18")
  assert.equal(parseExcelDate("2026.06.00"), null)
  assert.equal(parseExcelDate(""), null)
})

const plan = buildImportPlan(sheets)

check("이관: 종합 관리대장 기준으로 계측기 생성 후보, 관리번호 보존, 분류는 종류별 시트명에서", () => {
  assert.equal(plan.masterSheet, "계측기 검교정 계획서")
  assert.deepEqual(plan.instruments.map((i) => i.data.managementNo), ["DW-A01", "DW-A13", "DW-A03", "DW-H03", "DW-F01", "DW-X02"])
  assert.equal(plan.instruments[0].data.category, "캘리퍼스")
})
check("이관: Serial No 선행 0 유지, 공란은 null", () => {
  assert.equal(plan.instruments.find((i) => i.data.managementNo === "DW-A13")!.data.serialNo, "0089483")
  assert.equal(plan.instruments.find((i) => i.data.managementNo === "DW-H03")!.data.serialNo, null)
})
check("이관: 폐기/보류 계측기는 사용가능으로 이관하지 않는다", () => {
  assert.equal(plan.instruments.find((i) => i.data.managementNo === "DW-A03")!.data.usageStatus, "DISPOSED")
  assert.equal(plan.instruments.find((i) => i.data.managementNo === "DW-H03")!.data.usageStatus, "ON_HOLD")
  assert.equal(plan.instruments.find((i) => i.data.managementNo === "DW-A01")!.data.usageStatus, "AVAILABLE")
})
check("이관: 교정주기 해석(1년→12, 2년→24), 공란은 경고", () => {
  assert.equal(plan.instruments.find((i) => i.data.managementNo === "DW-A01")!.data.calibrationIntervalMonths, 12)
  assert.equal(plan.instruments.find((i) => i.data.managementNo === "DW-H03")!.data.calibrationIntervalMonths, 24)
})
check("이관: 사용부서(장소) — '부'로 끝나면 부서, 아니면 장소", () => {
  const a01 = plan.instruments.find((i) => i.data.managementNo === "DW-A01")!.data
  assert.equal(a01.department, "생산부")
  assert.equal(a01.location, null)
  const f01 = plan.instruments.find((i) => i.data.managementNo === "DW-F01")!.data
  assert.equal(f01.department, null)
  assert.equal(f01.location, "밸브조립실")
})
check("이관: 중복 관리번호/교정주기 오류/해석 불가 제품상태는 오류·경고로 보고하고 해당 행은 제외", () => {
  const errors = plan.issues.filter((i) => i.level === "error")
  assert.equal(errors.length, 2)
  assert.ok(errors.some((i) => i.managementNo === "DW-A01" && i.message.includes("중복")))
  assert.ok(errors.some((i) => i.managementNo === "DW-X01" && i.message.includes("교정주기")))
  assert.ok(!plan.instruments.some((i) => i.data.managementNo === "DW-X01"))
  assert.ok(plan.issues.some((i) => i.level === "warning" && i.message.includes("점검중")))
  assert.equal(plan.instruments.find((i) => i.data.managementNo === "DW-X02")!.data.usageStatus, "ON_HOLD") // 해석 불가 → 사용가능으로 두지 않는다
})
check("이관: 교정일/적합여부를 만들어 넣지 않는다 — 이력은 기관·성적서번호·차기교정일만", () => {
  for (const c of plan.calibrations) {
    assert.deepEqual(Object.keys(c.data).sort(), ["calibrationAgency", "certificateNo", "managementNo", "nextCalibrationDate", "remarks", "sourceKey", "sourceRef"])
  }
})
check("이관: 같은 이력은 시트가 달라도 하나로 합쳐지고(출처는 종합 관리대장), 잘못된 날짜 이력은 제외", () => {
  const a01 = plan.calibrations.filter((c) => c.data.managementNo === "DW-A01")
  assert.deepEqual(a01.map((c) => c.data.certificateNo).sort(), ["AT25-0412-4", "H24-0663-010"])
  assert.equal(a01.find((c) => c.data.certificateNo === "AT25-0412-4")!.sheet, "계측기 검교정 계획서")
  assert.ok(!plan.calibrations.some((c) => c.data.managementNo === "DW-A13" && c.data.certificateNo === null))
  assert.ok(plan.issues.some((i) => i.managementNo === "DW-A13" && i.message.includes("2026.06.00")))
})

const emptyDb = classifyImportPlan(plan, [], [])

check("이관: 미등록 관리번호의 이력은 건너뛴다", () => {
  const zz = emptyDb.calibrations.find((c) => c.data.managementNo === "DW-ZZ9")!
  assert.equal(zz.action, "SKIPPED")
})
check("이관 멱등성: 이관 결과가 DB 에 있다고 가정하고 같은 파일을 다시 분류하면 신규 0건", () => {
  const existingInstruments = emptyDb.instruments.map((i, idx) => ({
    id: `id-${idx}`,
    managementNo: i.data.managementNo,
    name: i.data.name,
    specification: i.data.specification,
    serialNo: i.data.serialNo,
    manufacturer: i.data.manufacturer,
    deleted: false,
  }))
  const idByNo = new Map(existingInstruments.map((i) => [i.managementNo, i.id]))
  const existingCalibrations = emptyDb.calibrations
    .filter((c) => c.action === "NEW")
    .map((c) => ({
      instrumentId: idByNo.get(c.data.managementNo)!,
      certificateNo: c.data.certificateNo,
      nextCalibrationDate: c.data.nextCalibrationDate,
      sourceKey: c.data.sourceKey,
    }))
  const second = classifyImportPlan(buildImportPlan(sheets), existingInstruments, existingCalibrations)
  const summary = summarizeImportPlan(second)
  assert.equal(summary.instrumentsNew, 0)
  assert.equal(summary.instrumentsExisting, existingInstruments.length)
  assert.equal(summary.calibrationsNew, 0)
  assert.ok(summary.calibrationsDuplicate > 0)
})
check("이관: 기존 계측기와 값이 달라도 덮어쓰지 않고 차이만 보고한다", () => {
  const classified = classifyImportPlan(
    plan,
    [{ id: "x", managementNo: "dw-a01", name: "사용자가 바꾼 이름", specification: "300/0.05", serialNo: "60404998", manufacturer: "MITUTOYO", deleted: false }],
    [],
  )
  const a01 = classified.instruments.find((i) => i.data.managementNo === "DW-A01")!
  assert.equal(a01.action, "EXISTING")
  assert.ok(a01.differences.some((d) => d.includes("계측기명")))
})

// ─── 서버 액션 정적 점검 ──────────────────────────────────────────────────────

const actionsPath = "src/lib/actions/instrument-calibration.actions.ts"
const actionsSource = fs.readFileSync(path.join(process.cwd(), actionsPath), "utf8")
const sourceFile = ts.createSourceFile(actionsPath, actionsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const exported = new Map<string, string>()
sourceFile.forEachChild((node) => {
  if (ts.isFunctionDeclaration(node) && node.name && node.body && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
    exported.set(node.name.text, actionsSource.slice(node.body.getStart(sourceFile), node.body.end))
  }
})

const EXPECTED_GUARDS: Record<string, string> = {
  createInstrument: 'requirePermission("CREATE")',
  updateInstrument: 'requirePermission("UPDATE")',
  deleteInstrument: 'requirePermission("DELETE")',
  registerCalibration: 'requirePermission("CREATE")',
  updateCalibration: 'requirePermission("UPDATE")',
  cancelCalibration: 'requirePermission("UPDATE")',
  saveCalibrationSchedule: 'requirePermission("UPDATE")',
  exportInstrumentRows: 'requirePermission("EXPORT")',
  exportCalibrationRows: 'requirePermission("EXPORT")',
  previewInstrumentImport: 'requirePermission("CREATE")',
  commitInstrumentImport: 'requirePermission("CREATE")',
  getCalibrationOverview: "requireRead()",
  getInstrumentDetailExtras: "requireRead()",
}

check("서버 권한: 모든 export 액션이 서버에서 권한을 검증한다", () => {
  assert.deepEqual(Array.from(exported.keys()).sort(), Object.keys(EXPECTED_GUARDS).sort())
  for (const [name, guard] of Object.entries(EXPECTED_GUARDS)) {
    assert.ok(exported.get(name)!.includes(guard), `${name} 는 ${guard} 를 호출해야 합니다.`)
  }
})
check("서버 권한: 폐기 상태 변경은 DELETE 권한도 요구한다", () => {
  assert.ok(exported.get("updateInstrument")!.includes('requirePermission("DELETE")'))
  assert.ok(exported.get("createInstrument")!.includes('requirePermission("DELETE")'))
})
check("서버 격리: 쿼리는 tenantId 로 한정하고, 품질검사·첨부 기능에는 연결하지 않는다", () => {
  assert.ok(!/qualityInspection|inspectionMeasurement|attachment/i.test(actionsSource))
  assert.ok(!/assertDaewonFeatureScope/.test(actionsSource)) // 범위 내 신규 기능이므로 일반 사용자도 접근해야 한다
  assert.ok(!/\.delete\(|\.deleteMany\(/.test(actionsSource)) // 물리 삭제 없음
})
check("권한 등록: 리소스/메뉴 매핑/라우트 허용 목록/메뉴 링크가 연결되어 있다", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8")
  assert.ok(read("src/lib/auth/role-permissions.ts").includes('calibration: "INSTRUMENT_CALIBRATION"'))
  assert.ok(read("src/lib/actions/permission.actions.ts").includes("INSTRUMENT_CALIBRATION"))
  assert.ok(read("src/lib/auth/daewon-scope.ts").includes('"/app/mes/quality/calibration"'))
  assert.ok(read("src/lib/nav-config.ts").includes("href: '/app/mes/quality/calibration'"))
  assert.ok(read("prisma/seed-daewon.ts").includes("INSTRUMENT_CALIBRATION"))
})
check("범위 제외: 성적서 파일 첨부/품질검사 연동 스키마가 없다", () => {
  const schema = fs.readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8")
  const block = schema.slice(schema.indexOf("model MeasuringInstrument"))
  assert.ok(!/fileUrl|filePath|storagePath|attachment/i.test(block.slice(0, block.indexOf("model InstrumentStatusHistory") + 600)))
})

// ─── 실제 엑셀 파일 (있을 때만) ───────────────────────────────────────────────

const workbookPath = process.env.CALIBRATION_XLSX
if (workbookPath && fs.existsSync(workbookPath)) {
  const wb = XLSX.readFile(workbookPath)
  const realSheets = wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" }).map((r) => r.map((c) => String(c ?? ""))),
  }))
  const realPlan = classifyImportPlan(buildImportPlan(realSheets), [], [])
  check("실제 엑셀: 종합 관리대장 80대, 오류 0건", () => {
    assert.equal(realPlan.instruments.length, 80)
    assert.equal(realPlan.issues.filter((i) => i.level === "error").length, 0)
    assert.equal(new Set(realPlan.instruments.map((i) => i.data.managementNo)).size, 80)
  })
  check("실제 엑셀: 사용불가·폐기·보류는 사용가능으로 이관되지 않는다", () => {
    const status = (no: string) => realPlan.instruments.find((i) => i.data.managementNo === no)!.data.usageStatus
    for (const no of ["DW-A03", "DW-A09", "DW-D04", "DW-D11", "DW-G03"]) assert.equal(status(no), "DISPOSED")
    for (const no of ["DW-H03", "DW-H04"]) assert.equal(status(no), "ON_HOLD")
    assert.equal(realPlan.instruments.filter((i) => i.data.usageStatus === "AVAILABLE").length, 73)
  })
  check("실제 엑셀: Serial No 선행 0 유지", () => {
    const serial = (no: string) => realPlan.instruments.find((i) => i.data.managementNo === no)!.data.serialNo
    assert.equal(serial("DW-A13"), "0089483")
    assert.equal(serial("DW-A15"), "0124645")
    assert.equal(serial("DW-A16"), "0080210")
    assert.equal(serial("DW-G04"), "032288725393291")
  })
  check("실제 엑셀: 이력은 교정일·결과 없이 이관 후보로만 만들어진다", () => {
    assert.ok(realPlan.calibrations.length > 0)
    assert.equal(new Set(realPlan.calibrations.map((c) => c.data.sourceKey)).size, realPlan.calibrations.length)
    assert.ok(realPlan.calibrations.every((c) => c.action === "NEW"))
  })
} else {
  console.log("SKIP 실제 엑셀 검증 (환경변수 CALIBRATION_XLSX 에 파일 경로를 지정하면 실행됩니다)")
}

exportedChecks.then(() => console.log(`\n${passed} checks passed`))
