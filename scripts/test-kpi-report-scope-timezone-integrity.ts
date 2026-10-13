import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  kstDateRangeToUtcBounds,
  resolveKstDateRangeFilter,
} from "../src/lib/date/kst"

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), "utf8")

let passed = 0
function ok(condition: unknown, message: string) {
  assert.ok(condition, message)
  passed += 1
}

const kst = read("src/lib/date/kst.ts")
const productionService = read("src/lib/actions/production-progress.service.ts")
const productionActions = read("src/lib/actions/production-progress.actions.ts")
const productionTypes = read("src/lib/actions/production-progress.types.ts")
const productionClient = read("src/app/app/mes/production-progress/production-progress-client.tsx")
const productionSummary = read("src/app/app/mes/production-progress/production-summary.tsx")
const productionColumns = read("src/app/app/mes/production-progress/columns.tsx")
const reportActions = read("src/lib/actions/report.actions.ts")
const reportHelpers = read("src/lib/actions/report.helpers.ts")
const resultActions = read("src/lib/actions/production-result.actions.ts")
const dailyPage = read("src/app/app/mes/reports/production-daily/page.tsx")
const dailyClient = read("src/app/app/mes/reports/production-daily/production-daily-report-client.tsx")
const defectStats = read("src/lib/actions/defect-stats.actions.ts")
const equipmentStats = read("src/lib/actions/equipment-statistics.actions.ts")
const kpiActions = read("src/lib/actions/kpi.actions.ts")
const dashboardPage = read("src/app/app/mes/dashboard/page.tsx")
const qualityPage = read("src/app/app/mes/reports/quality/page.tsx")
const equipmentPage = read("src/app/app/mes/reports/equipment/page.tsx")
const packageJson = read("package.json")

ok(kst.includes("function kstDateKeyToNextUtcStart"), "F24: KST helper exposes next-day start for exclusive upper bounds")
ok(kst.includes("toExclusiveDate: kstDateKeyToNextUtcStart(resolved.to)"), "F24: resolved KST ranges include exclusive upper bound")
ok(kst.includes("function kstDateRangeToUtcBounds"), "F24: strict KST range helper exists")
{
  const bounds = kstDateRangeToUtcBounds("2026-09-29", "2026-09-29")
  ok(bounds.fromDate.toISOString() === "2026-09-28T15:00:00.000Z", "F24: KST start boundary maps to previous-day 15:00Z")
  ok(bounds.toExclusiveDate.toISOString() === "2026-09-29T15:00:00.000Z", "F24: KST exclusive end boundary maps to current-day 15:00Z")
}
for (const [from, to] of [
  ["2026-02-30", "2026-03-01"],
  ["2026-13-01", "2026-13-02"],
  ["abcd", "2026-09-29"],
  ["2026-09-30", "2026-09-29"],
] as const) {
  assert.throws(() => kstDateRangeToUtcBounds(from, to), /조회 기간이 올바르지 않습니다/)
  passed += 1
}
{
  const fallback = resolveKstDateRangeFilter(30, "2026-02-30", "abcd", new Date("2026-09-29T01:00:00.000Z"))
  ok(fallback.from === "2026-08-30" && fallback.to === "2026-09-29", "F24: page-level KST resolver falls back on invalid query strings")
}
ok(productionService.includes("const latestOperation = operationsWithResults.reduce"), "F24: production-progress keeps highest-seq operation output canonical")
ok(productionService.includes("sum + result.goodQty"), "F24: production-progress output remains latest operation goodQty sum")
ok(!productionService.includes("completedQty / plannedQty"), "F24: production-progress does not switch to operation completed/planned progress")
ok(productionTypes.includes("itemUom: string"), "F24: production-progress rows carry item UOM")
ok(productionTypes.includes("isMixedUom: boolean"), "F24: production-progress summary exposes mixed UOM flag")
ok(productionActions.includes("item: { select: { code: true, name: true, uom: true } }"), "F24: production-progress queries item UOM")
ok(productionActions.includes("resolveOptionalKstRange"), "F24: production-progress list validates optional KST ranges")
ok(productionActions.includes("kstDateRangeToUtcBounds(from, to)"), "F24: production-progress daily trend uses strict KST range")
ok(productionActions.includes("isMixedUom ? null"), "F24: production-progress summary withholds UOM when mixed")
ok(productionClient.includes("단위 혼합"), "F24: production-progress UI hides aggregate quantity/rate on mixed UOM")
ok(!productionClient.includes('suffix="EA"'), "F24: production-progress no longer hard-codes EA suffix")
ok(productionColumns.includes("row.original.itemUom"), "F24: production-progress row quantities display actual UOM")
ok(productionActions.includes("!isMixedUom && totalPlannedQty > 0"), "F24: production-progress aggregate rate is blocked when UOM is mixed")
ok(productionClient.includes("복수 단위가 포함되어 전체 달성률을 표시하지 않습니다."), "F24: production-progress aggregate rate UI is blocked when UOM is mixed")
ok(productionSummary.includes("totalWipDisplay") && productionSummary.includes("단위 혼합"), "F24: production-progress total WIP hides mixed UOM aggregate")

ok(reportActions.includes("kstDateRangeToUtcBounds(from, to)"), "F24: production daily uses strict KST range helper")
ok(reportActions.includes("siteId?: string"), "F24: production daily filter supports siteId")
ok(reportActions.includes("endDateExclusive"), "F24: production daily passes exclusive end date")
ok(reportActions.includes("prisma.site.findMany"), "F24: report options include tenant-scoped sites")
ok(resultActions.includes("siteId?: string"), "F24: production results filter accepts siteId")
ok(resultActions.includes("endDateExclusive?: Date"), "F24: production results filter accepts exclusive end")
ok(resultActions.includes("lt: filters.endDateExclusive"), "F24: production results use lt for exclusive end")
ok(resultActions.includes("uom: true"), "F24: production results include item UOM")
ok(reportHelpers.includes("itemUom: string"), "F24: daily production rows carry UOM")
ok(reportHelpers.includes("producedQty: r.goodQty + r.defectQty + r.reworkQty"), "F24: daily producedQty remains good+defect+rework")
ok(!reportHelpers.includes("progressRate:"), "F24: daily row progressRate is removed")
ok(!reportHelpers.includes("overallProgressRate"), "F24: daily summary overallProgressRate is removed")
ok(reportHelpers.includes("isMixedUom"), "F24: daily summary detects mixed UOM")
ok(reportHelpers.includes("uom: isMixedUom ? null : (uoms[0] ?? null)"), "F24: daily date groups withhold subtotal UOM when mixed")
ok(dailyPage.includes("siteId: params.siteId"), "F24: production daily page reads siteId query")
ok(dailyPage.includes("resolveKstDateRangeFilter(0, params.from, params.to)"), "F24: production daily page sanitizes date query")
ok(dailyClient.includes("options.sites.map"), "F24: production daily UI exposes site filter")
ok(dailyClient.includes("재작업수량"), "F24: production daily UI/Excel shows rework quantity separately")
ok(!dailyClient.includes("진행률(%)"), "F24: production daily Excel progress column is removed")
ok(!dailyClient.includes("formatPercent"), "F24: production daily UI no longer formats progress")
ok(dailyClient.includes("공정계획수량"), "F24: production daily renames planned qty to operation planned qty")
ok(dailyClient.includes("실적수량"), "F24: production daily renames produced qty to actual result qty")
ok(dailyClient.includes("단위 혼합"), "F24: production daily hides aggregate quantity on mixed UOM")
ok(dailyClient.includes("총재작업수량"), "F24: production daily summary includes total rework quantity")
ok(dailyClient.includes("quantitySubtotal"), "F24: production daily date subtotal blocks mixed UOM quantities")

ok(defectStats.includes("where: { tenantId, status: \"ACTIVE\" }"), "F24: defect stats item options are tenant scoped")
ok(defectStats.includes("inspectedAt: { gte: from, lt: toExclusive }"), "F24: quality report range uses KST exclusive end")
ok(defectStats.includes("kstDateRangeToUtcBounds(fromKey, toKey)"), "F24: quality report validates KST range strictly")
ok(equipmentStats.includes("kstDefaultDateRange(30)"), "F24: equipment stats default range uses shared KST helper")
ok(equipmentStats.includes("startedAt: { gte: from, lt: toExclusive }"), "F24: equipment stats range uses exclusive end")
ok(equipmentStats.includes("toKstDateKey(r.startedAt)"), "F24: equipment daily grouping uses KST date key")
ok(equipmentStats.includes("kstDateRangeToUtcBounds(f.from, f.to)"), "F24: equipment statistics validates KST range strictly")
ok(kpiActions.includes("kstDefaultDateRange(30)"), "F24: KPI dashboard action default range uses shared KST helper")
ok(kpiActions.includes("lt: toExclusive"), "F24: KPI dashboard action uses exclusive end")
ok(kpiActions.includes("toKstDateKey(r.startedAt)"), "F24: KPI action daily grouping uses KST date key")
ok(kpiActions.includes("kstDateRangeToUtcBounds(f.from, f.to)"), "F24: KPI actions validate KST range strictly")
ok(dashboardPage.includes("todayStart") && dashboardPage.includes("tomorrowStart"), "F24: dashboard today metrics use KST day bounds")
ok(qualityPage.includes("resolveKstDateRangeFilter(30, params.from, params.to)"), "F24: quality report page sanitizes date query")
ok(equipmentPage.includes("resolveKstDateRangeFilter(30, params.from, params.to)"), "F24: equipment report page sanitizes date query")
ok(packageJson.includes("test:kpi-report-scope-timezone-integrity"), "F24: package script exposes KPI/report/timezone integrity test")

console.log(`F24 KPI/report scope timezone integrity: ${passed} passed, 0 failed`)
