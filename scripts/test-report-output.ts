/**
 * 사업계획서 "리포트" (생산일보/품질리포트/설비리포트) code-path test.
 *
 * report.helpers.ts는 DB에 의존하지 않는 순수 집계/포맷 로직이라 fabricated
 * fixture로 직접 검증한다. report.actions.ts/화면 컴포넌트가 기존 정본
 * (getProductionResults/getDefectStats/getEquipmentStatisticsData)을 그대로
 * 재사용하고 새 계산을 만들지 않는지, tenant 분리가 유지되는지, identifier
 * 컬럼에 수량 포맷터를 적용하지 않는지는 실제 배포된 소스를 읽어 검증한다
 * ("code-path"/"source-check" 라벨 규칙은 scripts/test-backup-management.ts와 동일).
 *
 * 실행:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/test-report-output.ts
 */
import * as fs from "fs"
import {
  toKstDateOnly,
  buildReportFilename,
  buildDailyProductionRows,
  groupDailyProductionByDate,
  computeDailyProductionSummary,
  buildEquipmentReportRows,
  buildEquipmentDailyTrend,
} from "../src/lib/actions/report.helpers"
import { formatPercent } from "../src/lib/utils"
import type { ProductionResultWithDetails } from "../src/lib/actions/production-result.actions"
import type { EquipmentStatisticsData } from "../src/lib/actions/equipment-statistics.actions"

let passed = 0
let failed = 0

function assertEqual<T>(actual: T, expected: T, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  }
}

function assertTrue(cond: boolean, label: string) {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

// ─── fixture 빌더 ─────────────────────────────────────────────────────────────

function makeResult(over: Partial<{
  id: string
  workOrderOperationId: string
  goodQty: number
  defectQty: number
  reworkQty: number
  startedAt: string | null
  endedAt: string | null
  equipmentName: string | null
  orderNo: string
  manufacturingNo: string | null
  itemCode: string
  itemName: string
  itemUom: string
  operationName: string
  plannedQty: number
  completedQty: number
}> = {}): ProductionResultWithDetails {
  const o = {
    id: "r1",
    workOrderOperationId: "op1",
    goodQty: 90,
    defectQty: 10,
    reworkQty: 0,
    startedAt: "2026-09-04T00:30:00.000Z" as string | null,
    endedAt: "2026-09-04T01:30:00.000Z" as string | null,
    equipmentName: "설비1" as string | null,
    orderNo: "WO-001",
    manufacturingNo: "MFG-001" as string | null,
    itemCode: "ITEM-1",
    itemName: "품목1",
    itemUom: "EA",
    operationName: "사출",
    plannedQty: 100,
    completedQty: 100,
    ...over,
  }
  return {
    id: o.id,
    workOrderOperationId: o.workOrderOperationId,
    goodQty: o.goodQty,
    defectQty: o.defectQty,
    reworkQty: o.reworkQty,
    startedAt: o.startedAt,
    endedAt: o.endedAt,
    workDurationMinutes:
      o.startedAt && o.endedAt
        ? Math.round((new Date(o.endedAt).getTime() - new Date(o.startedAt).getTime()) / 60_000)
        : null,
    operator: null,
    equipment: o.equipmentName ? { id: "eq1", code: "EQ01", name: o.equipmentName } : null,
    workOrderOperation: {
      id: o.workOrderOperationId,
      seq: 1,
      status: "IN_PROGRESS",
      plannedQty: o.plannedQty,
      completedQty: o.completedQty,
      workOrder: {
        id: "wo1",
        orderNo: o.orderNo,
        manufacturingNo: o.manufacturingNo,
        item: { id: "item1", code: o.itemCode, name: o.itemName, uom: o.itemUom },
      },
      routingOperation: {
        id: "ro1",
        name: o.operationName,
        seq: 1,
        workCenter: { id: "wc1", name: "WC1" },
      },
    },
  }
}

// ─── T1~T2: KST 일자 변환 ────────────────────────────────────────────────────

assertEqual(toKstDateOnly("2026-09-04T00:30:00.000Z"), "2026-09-04", "T1. UTC 00:30 -> KST 09:30(같은 날짜)")
assertEqual(toKstDateOnly("2026-09-03T16:00:00.000Z"), "2026-09-04", "T2. UTC 16:00(전날) -> KST 01:00(다음날, 자정 경계 넘어감)")

// ─── T3~T6: 생산일보 행 생성 ──────────────────────────────────────────────────

{
  const results = [makeResult({ id: "r1" })]
  const rows = buildDailyProductionRows(results)
  assertEqual(rows.length, 1, "T3. 정상 실적 1건 -> 행 1개 생성")
  assertEqual(rows[0].producedQty, 100, "T3. producedQty = goodQty+defectQty+reworkQty")
  assertEqual(rows[0].itemUom, "EA", "T3. row는 품목 UOM을 유지한다")
}
{
  const rows = buildDailyProductionRows([makeResult({ startedAt: null })])
  assertEqual(rows.length, 0, "T4. startedAt이 없는 실적은 가짜 일자를 만들지 않고 제외한다(§ STEP 7)")
}
{
  const rows = buildDailyProductionRows([makeResult({ endedAt: null })])
  assertEqual(rows[0].workHours, null, "T5. endedAt이 없으면 가짜 작업시간을 만들지 않고 null")
}

// ─── T7~T8: 일자별 그룹핑/소계 ────────────────────────────────────────────────

{
  const results = [
    makeResult({ id: "r1", startedAt: "2026-09-03T16:00:00.000Z", goodQty: 10, defectQty: 0 }), // KST 09-04
    makeResult({ id: "r2", startedAt: "2026-09-04T05:00:00.000Z", goodQty: 20, defectQty: 5 }), // KST 09-04
    makeResult({ id: "r3", startedAt: "2026-09-02T16:00:00.000Z", goodQty: 5, defectQty: 0 }), // KST 09-03
  ]
  const rows = buildDailyProductionRows(results)
  const groups = groupDailyProductionByDate(rows)
  assertEqual(groups.map((g) => g.date), ["2026-09-04", "2026-09-03"], "T7. 최신 날짜부터 내림차순 정렬")
  assertEqual(groups[0].rows.length, 2, "T7. 같은 KST 날짜의 실적이 한 그룹으로 묶임")
  assertEqual(groups[0].subtotal.goodQty, 30, "T8. 일자별 소계(goodQty) 합산")
  assertEqual(groups[0].subtotal.defectQty, 5, "T8. 일자별 소계(defectQty) 합산")
}

// ─── T9~T10: 기간 요약 — 계획수량 중복 합산 방지 ─────────────────────────────

{
  // 같은 workOrderOperationId(op1)에 실적이 2건 걸쳐 있어도 계획수량은 한 번만 센다.
  const results = [
    makeResult({ id: "r1", workOrderOperationId: "op1", plannedQty: 100, completedQty: 100, goodQty: 60, defectQty: 0 }),
    makeResult({ id: "r2", workOrderOperationId: "op1", plannedQty: 100, completedQty: 100, goodQty: 40, defectQty: 0 }),
  ]
  const rows = buildDailyProductionRows(results)
  const summary = computeDailyProductionSummary(results, rows)
  assertEqual(summary.totalPlannedQty, 100, "T9. 같은 공정(workOrderOperationId)의 계획수량은 실적 행 수와 무관하게 한 번만 합산(중복 방지)")
  assertEqual(summary.totalGoodQty, 100, "T9. 생산수량(goodQty)은 실적 행 단위로 정상 합산")
  assertEqual(summary.isMixedUom, false, "T10. 단일 UOM 기간은 aggregate UOM 표시 가능")
  assertEqual(summary.uom, "EA", "T10. 단일 UOM 기간의 UOM을 summary에 보존")
}
{
  const summary = computeDailyProductionSummary([], [])
  assertEqual(summary, {
    resultCount: 0,
    totalPlannedQty: 0,
    totalWorkHours: 0,
    totalProducedQty: 0,
    totalGoodQty: 0,
    totalDefectQty: 0,
    totalReworkQty: 0,
    uom: null,
    isMixedUom: false,
  }, "T11. 빈 기간(실적 0건) -> 모든 합계 0, UOM 없음")
}
{
  const results = [
    makeResult({ id: "r1", workOrderOperationId: "op1", itemUom: "EA", plannedQty: 100, goodQty: 80 }),
    makeResult({ id: "r2", workOrderOperationId: "op2", itemUom: "EA", plannedQty: 50, goodQty: 40 }),
  ]
  const rows = buildDailyProductionRows(results)
  const summary = computeDailyProductionSummary(results, rows)
  assertEqual(summary.isMixedUom, false, "T12. EA+EA summary는 mixed UOM 아님")
  assertEqual(summary.uom, "EA", "T12. EA+EA summary UOM은 EA")
  assertEqual(summary.totalPlannedQty, 150, "T12. 단일 UOM이면 계획수량 집계 가능")
}
{
  const results = [
    makeResult({ id: "r1", workOrderOperationId: "op1", itemUom: "EA", plannedQty: 100, goodQty: 80 }),
    makeResult({ id: "r2", workOrderOperationId: "op2", itemUom: "KG", plannedQty: 20, goodQty: 10 }),
  ]
  const rows = buildDailyProductionRows(results)
  const summary = computeDailyProductionSummary(results, rows)
  const groups = groupDailyProductionByDate(rows)
  assertEqual(summary.isMixedUom, true, "T13. EA+KG summary는 mixed UOM")
  assertEqual(summary.uom, null, "T13. mixed summary는 aggregate UOM 없음")
  assertEqual(groups[0].isMixedUom, true, "T13. 같은 날짜 EA+KG subtotal은 mixed UOM")
  assertEqual(groups[0].uom, null, "T13. 같은 날짜 mixed subtotal은 UOM 없음")
}
{
  const results = [
    makeResult({ id: "r1", workOrderOperationId: "op1", itemUom: "EA", startedAt: "2026-09-01T00:00:00.000Z" }),
    makeResult({ id: "r2", workOrderOperationId: "op2", itemUom: "KG", startedAt: "2026-09-02T00:00:00.000Z" }),
  ]
  const rows = buildDailyProductionRows(results)
  const summary = computeDailyProductionSummary(results, rows)
  const groups = groupDailyProductionByDate(rows)
  assertEqual(summary.isMixedUom, true, "T14. 날짜별 단일 UOM이어도 전체 summary는 mixed UOM")
  assertEqual(groups.map((group) => group.isMixedUom), [false, false], "T14. 날짜가 다르면 각 일자 subtotal은 단일 UOM")
  assertEqual(groups.map((group) => group.uom), ["KG", "EA"], "T14. 각 일자 subtotal은 자기 UOM 유지")
}

// ─── T12~T14: 설비리포트 조인 ─────────────────────────────────────────────────

function makeEquipStats(over: Partial<EquipmentStatisticsData> = {}): EquipmentStatisticsData {
  return {
    filter: { from: "2026-08-01", to: "2026-08-31" },
    production: { totalGoodQty: 0, totalDefectQty: 0, defectRate: null, resultCount: 0, rows: [] },
    errors: { total: 0, alarmCount: 0, warningCount: 0, rows: [] },
    downtime: { totalMinutes: 0, eventCount: 0, rows: [] },
    workTime: { totalHours: null, resultCount: 0, rows: [] },
    availability: { avgRate: null, equipmentCount: 0, rows: [] },
    ...over,
  }
}

{
  const data = makeEquipStats({
    availability: { avgRate: 0.8, equipmentCount: 1, rows: [{ code: "EQ01", name: "설비1", runMinutes: 600, rate: 0.8 }] },
    downtime: { totalMinutes: 60, eventCount: 2, rows: [{ equipmentCode: "EQ01", equipmentName: "설비1", stopMinutes: 40, maintenanceMinutes: 20, total: 60 }] },
    errors: { total: 3, alarmCount: 2, warningCount: 1, rows: [{ equipmentCode: "EQ01", equipmentName: "설비1", alarmCount: 2, warningCount: 1 }] },
  })
  const rows = buildEquipmentReportRows(data)
  assertEqual(rows.length, 1, "T12. 설비코드 기준으로 가동률/비가동/알람 통계가 한 행으로 합쳐짐(새 지표 계산 없이 join만)")
  assertEqual(rows[0], { code: "EQ01", name: "설비1", goodQty: 0, defectQty: 0, workHours: 0, runMinutes: 600, availabilityRate: 0.8, stopMinutes: 40, maintenanceMinutes: 20, downtimeMinutes: 60, alarmCount: 2, warningCount: 1 }, "T12. 조인 결과가 각 카테고리의 canonical 값을 그대로 보존")
}
{
  const rows = buildEquipmentReportRows(makeEquipStats())
  assertEqual(rows, [], "T13. 설비 데이터가 전혀 없으면(빈 기간) 빈 배열 — 가짜 설비 행 생성 없음")
}
{
  const data = makeEquipStats({
    production: { totalGoodQty: 10, totalDefectQty: 2, defectRate: 2 / 12, resultCount: 1, rows: [{ date: "2026-08-01", equipmentId: "EQ01", equipmentCode: "EQ01", equipmentName: "설비1", goodQty: 10, defectQty: 2 }] },
    workTime: { totalHours: 5, resultCount: 1, rows: [{ date: "2026-08-01", equipmentId: "EQ01", equipmentCode: "EQ01", equipmentName: "설비1", hours: 5, goodQty: 10 }] },
  })
  const trend = buildEquipmentDailyTrend(data)
  assertEqual(trend, [{ date: "2026-08-01", goodQty: 10, defectQty: 2, hours: 5 }], "T14. 일자별 생산량(production.rows)과 작업시간(workTime.rows)이 날짜 기준으로 합쳐짐")
}

// ─── T15~T16: Excel 파일명 규칙 ───────────────────────────────────────────────

assertEqual(buildReportFilename("생산일보", "2026-09-04", "2026-09-04"), "생산일보_20260904.xlsx", "T15. 단일 일자 조회 -> {prefix}_YYYYMMDD.xlsx")
assertEqual(buildReportFilename("품질리포트", "2026-09-01", "2026-09-04"), "품질리포트_20260901_20260904.xlsx", "T16. 기간 조회 -> {prefix}_YYYYMMDD_YYYYMMDD.xlsx")

// ─── T17: percentage 포맷 ────────────────────────────────────────────────────

assertEqual(formatPercent(0.5), "50.0%", "T17. formatPercent(0.5) -> \"50.0%\"")
assertEqual(formatPercent(0), "0.0%", "T17. formatPercent(0) -> \"0.0%\"(0과 null을 구분)")
assertEqual(formatPercent(null), "-", "T17. formatPercent(null) -> \"-\"")
assertEqual(formatPercent(undefined), "-", "T17. formatPercent(undefined) -> \"-\"")
assertEqual(formatPercent(0.12345, 2), "12.35%", "T17. decimals 파라미터로 소수 자릿수 조절")

// ─── T18~T20: source-check — 정본 재사용 / tenant / identifier 포맷 금지 ─────

const reportActionsSource = fs.readFileSync("src/lib/actions/report.actions.ts", "utf8")
const productionClientSource = fs.readFileSync(
  "src/app/app/mes/reports/production-daily/production-daily-report-client.tsx",
  "utf8"
)
const qualityClientSource = fs.readFileSync(
  "src/app/app/mes/reports/quality/quality-report-client.tsx",
  "utf8"
)
const equipmentClientSource = fs.readFileSync(
  "src/app/app/mes/reports/equipment/equipment-report-client.tsx",
  "utf8"
)

{
  const wrapsDefectStats = /getQualityReport[\s\S]{0,120}return getDefectStats\(filter\)/.test(reportActionsSource)
  const noOwnDefectMath = !/defectQty\s*\/\s*inspectedQty/.test(reportActionsSource) // 새 불량률 정의를 만들지 않음
  assertTrue(wrapsDefectStats && noOwnDefectMath, "T18. getQualityReport은 getDefectStats(정본)를 그대로 감싸고 불량률을 새로 계산하지 않는다(§ STEP 14/16)")
}
{
  const wrapsEquipStats = /getEquipmentReport[\s\S]{0,150}return getEquipmentStatisticsData\(filter\)/.test(reportActionsSource)
  assertTrue(wrapsEquipStats, "T19. getEquipmentReport은 getEquipmentStatisticsData(정본)를 그대로 감싼다(§ STEP 17)")
}
{
  const viewerGateCount = (reportActionsSource.match(/await requireRole\("VIEWER"\)/g) || []).length
  assertTrue(viewerGateCount >= 4, "T20. 리포트 조회 함수(생산일보/품질/설비/필터옵션) 모두 VIEWER 이상 권한 확인(§ STEP 19) — tenant 분리 자체는 getTenantId()를 쓰는 하위 정본 함수가 담당")
}
{
  // identifier(작업지시/제조번호/품목코드/설비코드 등)는 formatQuantity로 감싸지 않는다(§ STEP 22).
  const forbidden = [
    /formatQuantity\(\s*r\.orderNo/,
    /formatQuantity\(\s*r\.manufacturingNo/,
    /formatQuantity\(\s*r\.itemCode/,
    /formatQuantity\(\s*r\.code/,
    /formatQuantity\(\s*eq\.code/,
  ]
  const noneMatched = [productionClientSource, qualityClientSource, equipmentClientSource].every(
    (src) => forbidden.every((re) => !re.test(src))
  )
  assertTrue(noneMatched, "T21. 작업지시/제조번호/품목코드/설비코드 등 identifier 컬럼에 수량 포맷터(formatQuantity)를 적용하지 않는다(§ STEP 22)")
}

// ─── T22: 화면별 데이터가 실제 존재하는 지표만 표시(가짜 지표 없음) ──────────
{
  // 설비리포트 화면이 "점검/수리 현황" 같은, 이번 PR에 정본 집계가 없는 지표를
  // 새로 발명해 표시하지 않는지 확인한다(§ STEP 17 — 없는 지표를 만들지 않음).
  const noFabricatedInspectionMetric = !/점검\/수리 현황/.test(equipmentClientSource)
  assertTrue(noFabricatedInspectionMetric, "T22. 설비리포트가 기존 정본 집계가 없는 점검/수리 현황을 임의로 만들어 표시하지 않는다")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
