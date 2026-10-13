/**
 * 사업계획서 "품질검사 > 품질현황" code-path test.
 *
 * quality-dashboard.helpers.ts는 DB에 의존하지 않는 순수 함수라 직접 검증한다
 * (defect-corrective-action.helpers.ts와 동일 방식). 이 대시보드는 불량률/일별
 * 추이/불량유형TOP5/품목별·공정별 집계의 "계산식 자체"를 다시 만들지 않고
 * defect-stats.actions.ts의 getDefectStats() 결과를 그대로 재사용하므로, 그
 * 계산식은 여기서 다시 테스트하지 않는다(이미 존재하는 계산을 복붙해 두 번째
 * 정본을 만들지 않기 위함, § STEP 18). 이 테스트는 이 PR에서 새로 추가된
 * 조합 로직(KPI 조합/CAPA 상태 집계/확인 필요 품질이슈 우선순위/최근 품질이슈
 * 병합)만 검증한다. tenant 필터링/defectRecordId 직접 FK 조회처럼 DB(Prisma)
 * 호출이 필수인 로직은 실제 배포된 소스 구조를 검증하는 source-check로 확인한다
 * ("code-path"/"source-check" 라벨 규칙은 scripts/test-corrective-action.ts와 동일).
 *
 * 실행:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/test-quality-dashboard.ts
 */
import * as fs from "fs"
import {
  buildQualityDashboardKpi,
  topDefectTypes,
  countCauseAnalysisStatus,
  countCorrectiveActionStatus,
  countRecurrencePreventionStatus,
  buildCapaStageBreakdown,
  buildQualityIssues,
  buildRecentQualityIssues,
  latestStatusByDefectRecord,
} from "../src/lib/actions/quality-dashboard.helpers"
import type { DefectStatsSummary, DefectStatsByType } from "../src/lib/actions/defect-stats.actions"
import type { DefectCauseAnalysisRow } from "../src/lib/actions/defect-cause-analysis.helpers"
import type { DefectCorrectiveActionRow } from "../src/lib/actions/defect-corrective-action.helpers"
import type { DefectRecurrencePreventionRow } from "../src/lib/actions/defect-recurrence-prevention.helpers"

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

// ─── 픽스처 팩토리 ────────────────────────────────────────────────────────────

function makeSummary(overrides: Partial<DefectStatsSummary> = {}): DefectStatsSummary {
  return {
    inspectionCount: 10,
    inspectedQty: 1000,
    passQty: 950,
    failQty: 50,
    defectQty: 53,
    defectRate: 0.053,
    ...overrides,
  }
}

function makeCauseRow(overrides: Partial<DefectCauseAnalysisRow> & { defectRecordId: string }): DefectCauseAnalysisRow {
  return {
    defectRecordId: overrides.defectRecordId,
    inspectionId: "insp-1",
    inspectedAt: overrides.inspectedAt ?? "2026-09-01T00:00:00.000Z",
    stage: "MID" as never,
    itemCode: overrides.itemCode ?? "ITEM-1",
    itemName: overrides.itemName ?? "테스트품목",
    routingOperationName: overrides.routingOperationName ?? "검사공정",
    orderNo: overrides.orderNo ?? "WO-1",
    manufacturingNo: overrides.manufacturingNo ?? "MFG-1",
    defectCodeId: "dc-1",
    defectCode: overrides.defectCode ?? "DIM-001",
    defectCodeName: overrides.defectCodeName ?? "치수불량",
    qty: overrides.qty ?? 5,
    severity: "MAJOR" as never,
    disposition: null,
    analysisId: overrides.analysisId === undefined ? null : overrides.analysisId,
    analysisStatus: overrides.analysisStatus ?? "UNANALYZED",
    rootCause: overrides.rootCause === undefined ? null : overrides.rootCause,
    analysisDetail: null,
    updatedByName: null,
    updatedAt: null,
  }
}

function makeCorrectiveRow(overrides: Partial<DefectCorrectiveActionRow> & { id: string }): DefectCorrectiveActionRow {
  return {
    id: overrides.id,
    defectRecordId: overrides.defectRecordId ?? "dr-1",
    inspectedAt: "2026-09-01T00:00:00.000Z",
    stage: "MID" as never,
    itemCode: "ITEM-1",
    itemName: overrides.itemName ?? "테스트품목",
    routingOperationName: overrides.routingOperationName ?? "검사공정",
    orderNo: "WO-1",
    manufacturingNo: "MFG-1",
    defectCode: "DIM-001",
    defectCodeName: "치수불량",
    defectQty: 5,
    severity: "MAJOR" as never,
    disposition: null,
    rootCause: null,
    analysisDetail: null,
    actionContent: "조치내용",
    assigneeId: null,
    assigneeName: null,
    dueDate: overrides.dueDate ?? "2026-09-10T00:00:00.000Z",
    status: overrides.status ?? "OPEN",
    completedAt: null,
    completionNote: null,
    createdByName: "생산관리자",
    updatedByName: "생산관리자",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    overdue: overrides.overdue ?? false,
  }
}

function makePreventionRow(overrides: Partial<DefectRecurrencePreventionRow> & { id: string }): DefectRecurrencePreventionRow {
  return {
    id: overrides.id,
    defectRecordId: overrides.defectRecordId ?? "dr-1",
    inspectedAt: "2026-09-01T00:00:00.000Z",
    stage: "MID" as never,
    itemCode: "ITEM-1",
    itemName: overrides.itemName ?? "테스트품목",
    routingOperationName: overrides.routingOperationName ?? "검사공정",
    orderNo: "WO-1",
    manufacturingNo: "MFG-1",
    defectCode: "DIM-001",
    defectCodeName: "치수불량",
    defectQty: 5,
    severity: "MAJOR" as never,
    disposition: null,
    rootCause: null,
    analysisDetail: null,
    correctiveActionTotal: 1,
    correctiveActionCompleted: 1,
    correctiveActions: [],
    preventionContent: "재발방지대책",
    assigneeId: null,
    assigneeName: null,
    dueDate: overrides.dueDate ?? "2026-09-10T00:00:00.000Z",
    status: overrides.status ?? "OPEN",
    verificationContent: null,
    verificationResult: null,
    verifierId: null,
    verifierName: null,
    verifiedAt: null,
    completedAt: null,
    createdByName: "생산관리자",
    updatedByName: "생산관리자",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    overdue: overrides.overdue ?? false,
  }
}

// ─── T1~T2: KPI 조합 — defect-stats 계산식을 재계산하지 않고 그대로 통과시킴 ──
{
  const kpi = buildQualityDashboardKpi(
    makeSummary(),
    [makeCorrectiveRow({ id: "ca-1", status: "OPEN" }), makeCorrectiveRow({ id: "ca-2", status: "IN_PROGRESS" }), makeCorrectiveRow({ id: "ca-3", status: "COMPLETED" })],
    [makePreventionRow({ id: "rp-1", status: "VERIFYING" }), makePreventionRow({ id: "rp-2", status: "OPEN" })]
  )
  assertTrue(
    kpi.inspectedQty === 1000 && kpi.defectQty === 53 && kpi.defectRate === 0.053 && kpi.inspectionCount === 10,
    "T1. KPI의 검사수량/불량수량/불량률/검사건수는 defect-stats summary 값을 재계산 없이 그대로 사용"
  )
  assertEqual(kpi.openCorrectiveActionCount, 2, "T1. 미완료 조치 = OPEN + IN_PROGRESS 건수(COMPLETED 제외)")
  assertEqual(kpi.verifyingRecurrencePreventionCount, 1, "T1. 재발방지 검증대기 = VERIFYING 건수만")
}
// T2: denominator 0(검사수량 0) — defect-stats가 이미 0으로 계산해 준 값을 그대로 통과
{
  const kpi = buildQualityDashboardKpi(makeSummary({ inspectedQty: 0, defectQty: 0, defectRate: 0, inspectionCount: 0 }), [], [])
  assertTrue(
    kpi.inspectedQty === 0 && kpi.defectRate === 0 && kpi.openCorrectiveActionCount === 0 && kpi.verifyingRecurrencePreventionCount === 0,
    "T2. 검사수량 0(빈 데이터셋)이어도 예외 없이 0으로 정상 처리(division-by-zero는 defect-stats 쪽 책임)"
  )
}

// ─── T3: 불량유형 TOP5 — byType을 자르기만 함(재계산 없음) ──────────────────
{
  const byType: DefectStatsByType[] = Array.from({ length: 8 }, (_, i) => ({
    defectCodeId: `dc-${i}`,
    code: `C${i}`,
    name: `불량${i}`,
    category: "DIMENSIONAL" as never,
    qty: 100 - i,
    percentage: 0.1,
  }))
  assertEqual(topDefectTypes(byType).length, 5, "T3. 불량유형 TOP5는 상위 5건만 자름")
  assertEqual(topDefectTypes(byType)[0].code, "C0", "T3. 정렬 순서(수량 내림차순)는 defect-stats가 이미 정렬한 순서를 그대로 유지")
  assertEqual(topDefectTypes([]), [], "T3. 빈 배열이면 빈 배열 반환")
}

// ─── T4~T6: CAPA 상태 집계 — 각 화면의 기존 status/overdue 값을 그대로 카운트 ─
{
  const causeRows = [
    makeCauseRow({ defectRecordId: "dr-1", analysisStatus: "ANALYZED" }),
    makeCauseRow({ defectRecordId: "dr-2", analysisStatus: "UNANALYZED" }),
    makeCauseRow({ defectRecordId: "dr-3", analysisStatus: "UNANALYZED" }),
  ]
  assertEqual(countCauseAnalysisStatus(causeRows), { unanalyzed: 2, analyzed: 1 }, "T4. 원인분석 상태 집계(미분석/분석완료)")
}
{
  const correctiveRows = [
    makeCorrectiveRow({ id: "1", status: "OPEN" }),
    makeCorrectiveRow({ id: "2", status: "IN_PROGRESS", overdue: true }),
    makeCorrectiveRow({ id: "3", status: "IN_PROGRESS" }),
    makeCorrectiveRow({ id: "4", status: "COMPLETED" }),
  ]
  assertEqual(
    countCorrectiveActionStatus(correctiveRows),
    { open: 1, inProgress: 2, completed: 1, overdue: 1 },
    "T5. 조치관리 상태 집계 — overdue는 각 row에 이미 계산된 값을 그대로 세고 재계산하지 않음"
  )
}
{
  const preventionRows = [
    makePreventionRow({ id: "1", status: "OPEN" }),
    makePreventionRow({ id: "2", status: "IN_PROGRESS" }),
    makePreventionRow({ id: "3", status: "VERIFYING" }),
    makePreventionRow({ id: "4", status: "VERIFYING", overdue: true }),
    makePreventionRow({ id: "5", status: "COMPLETED" }),
  ]
  assertEqual(
    countRecurrencePreventionStatus(preventionRows),
    { open: 1, inProgress: 1, verifying: 2, completed: 1, overdue: 1 },
    "T6. 재발방지관리 상태 집계(OPEN/IN_PROGRESS/VERIFYING/COMPLETED/기한초과)"
  )
}
// T6b: 빈 데이터셋 — 세 집계 함수 모두 0으로 정상 처리
{
  const empty = buildCapaStageBreakdown([], [], [])
  assertEqual(
    empty,
    { causeAnalysis: { unanalyzed: 0, analyzed: 0 }, correctiveAction: { open: 0, inProgress: 0, completed: 0, overdue: 0 }, recurrencePrevention: { open: 0, inProgress: 0, verifying: 0, completed: 0, overdue: 0 } },
    "T6b. 빈 데이터셋이어도 CAPA 집계 전체가 0으로 예외 없이 처리됨"
  )
}

// ─── T7~T9: 확인 필요 품질이슈 — 고정 우선순위, AI 위험도 없음 ──────────────
{
  const causeRows = [makeCauseRow({ defectRecordId: "dr-4", analysisStatus: "UNANALYZED" })]
  const correctiveRows = [makeCorrectiveRow({ id: "1", overdue: true })]
  const preventionRows = [makePreventionRow({ id: "1", overdue: true }), makePreventionRow({ id: "2", status: "VERIFYING" })]
  const issues = buildQualityIssues(causeRows, correctiveRows, preventionRows)
  assertEqual(issues.length, 4, "T7. 조치기한초과 1 + 재발방지기한초과 1 + 검증대기 1 + 원인분석미등록 1 = 총 4건")
  assertEqual(
    issues.map((i) => i.category),
    ["CORRECTIVE_OVERDUE", "PREVENTION_OVERDUE", "PREVENTION_VERIFYING", "CAUSE_UNANALYZED"],
    "T7. 우선순위 고정 순서(조치기한초과 → 재발방지기한초과 → 검증대기 → 원인분석미등록)"
  )
}
{
  // T8: limit — 8건을 넘으면 잘라냄
  const manyCorrective = Array.from({ length: 10 }, (_, i) => makeCorrectiveRow({ id: `c-${i}`, overdue: true }))
  const issues = buildQualityIssues([], manyCorrective, [])
  assertEqual(issues.length, 8, "T8. 확인 필요 품질이슈는 최대 8건으로 제한(limit)")
}
{
  // T9: AI 관련 필드/문구가 전혀 없음(가짜 AI 위험도 절대 금지, § STEP 8/21)
  const issue = buildQualityIssues([], [makeCorrectiveRow({ id: "1", overdue: true })], [])[0]
  const keys = Object.keys(issue)
  assertTrue(
    !keys.some((k) => /ai/i.test(k)) && !/AI/.test(JSON.stringify(issue)),
    "T9. QualityIssueItem에 'AI' 관련 필드/문구가 전혀 없음(위험도 점수 등 가짜 AI 결과 미생성)"
  )
}

// ─── T10~T12: 최근 품질이슈 — DefectRecord 기준 병합, direct FK 매핑 ────────
{
  const causeRows = [
    makeCauseRow({ defectRecordId: "dr-1", analysisStatus: "ANALYZED", inspectedAt: "2026-09-03T00:00:00.000Z" }),
    makeCauseRow({ defectRecordId: "dr-2", analysisStatus: "UNANALYZED", inspectedAt: "2026-09-02T00:00:00.000Z" }),
  ]
  const correctiveMap = latestStatusByDefectRecord([
    { defectRecordId: "dr-1", status: "IN_PROGRESS" },
    { defectRecordId: "dr-1", status: "OPEN" }, // 더 오래된 항목 — 먼저 온 것(최신)만 유지되어야 함
  ])
  const preventionMap = latestStatusByDefectRecord([])
  const rows = buildRecentQualityIssues(causeRows, correctiveMap, preventionMap)

  assertEqual(rows.length, 2, "T10. causeRows 건수만큼 최근 품질이슈 행 생성")
  assertEqual(rows[0].defectRecordId, "dr-1", "T10. causeRows의 기존 정렬 순서(inspectedAt desc)를 그대로 유지")
  assertEqual(rows[0].correctiveActionStatus, "IN_PROGRESS", "T11. 조치 상태는 defectRecordId로 매핑된 최신 상태를 사용")
  assertEqual(rows[0].recurrencePreventionStatus, null, "T11. 매핑이 없는 경우(등록된 재발방지 없음) null로 '미등록' 표현")
  assertEqual(rows[1].correctiveActionStatus, null, "T11. dr-2는 조치이력이 없어 null(미등록)")
}
{
  // T12: latestStatusByDefectRecord — findMany가 최신순(desc)으로 넘겨준다는 전제 하에 첫 값만 유지
  const map = latestStatusByDefectRecord([
    { defectRecordId: "dr-1", status: "COMPLETED" },
    { defectRecordId: "dr-1", status: "OPEN" },
    { defectRecordId: "dr-2", status: "VERIFYING" },
  ])
  assertEqual(map.get("dr-1"), "COMPLETED", "T12. 같은 defectRecordId가 여러 건이면 첫 번째(최신) 값만 유지")
  assertEqual(map.get("dr-2"), "VERIFYING", "T12. 서로 다른 defectRecordId는 각각 독립적으로 매핑")
  assertEqual(map.get("dr-3"), undefined, "T12. 매핑 없는 키는 undefined")
}
// T13: 빈 데이터셋
assertEqual(buildRecentQualityIssues([], new Map(), new Map()), [], "T13. causeRows가 비어있으면 최근 품질이슈도 빈 배열")

// ─── T14~T17: source-check — quality-dashboard.actions.ts 실제 구조 검증 ────
const actionsSource = fs.readFileSync("src/lib/actions/quality-dashboard.actions.ts", "utf8")

// T14: 권한 게이트 — VIEWER 이상만 조회 가능, mutating action 없음
{
  const hasViewerGate = /await requireRole\("VIEWER"\)/.test(actionsSource)
  const hasNoMutation = !/requireRole\("OPERATOR"\)|requireRole\("MANAGER"\)|prisma\.\w+\.(create|update|delete)\(/.test(actionsSource)
  assertTrue(hasViewerGate && hasNoMutation, "T14. getQualityDashboardData가 VIEWER 권한 게이트를 통과하고, create/update/delete 등 mutating 로직이 전혀 없음(조회 전용)")
}

// T15: 기존 정본 재사용 — 불량률/원인분석/조치관리/재발방지관리 계산을 다시 만들지 않고 그대로 import
{
  const reusesDefectStats = /import\s*\{[^}]*getDefectStats[^}]*\}\s*from\s*"\.\/defect-stats\.actions"/.test(actionsSource)
  const reusesCauseAnalysis = /import\s*\{\s*getDefectCauseAnalysisList\s*\}\s*from\s*"\.\/defect-cause-analysis\.actions"/.test(actionsSource)
  const reusesCorrectiveAction = /import\s*\{\s*getDefectCorrectiveActionList\s*\}\s*from\s*"\.\/defect-corrective-action\.actions"/.test(actionsSource)
  const reusesRecurrencePrevention = /import\s*\{\s*getDefectRecurrencePreventionList\s*\}\s*from\s*"\.\/defect-recurrence-prevention\.actions"/.test(actionsSource)
  assertTrue(
    reusesDefectStats && reusesCauseAnalysis && reusesCorrectiveAction && reusesRecurrencePrevention,
    "T15. 불량통계/원인분석/조치관리/재발방지관리 각 화면의 기존 조회 함수를 그대로 import해서 재사용(같은 계산식의 두 번째 정본을 만들지 않음)"
  )
}

// T16: 최근 품질이슈 배치 조회 — defectRecordId 직접 FK 조건만 사용(추측성 join 아님), tenantId 필수
{
  const hasCorrectiveBatch = /defectCorrectiveAction\.findMany\(\{\s*where:\s*\{\s*defectRecordId:\s*\{\s*in:\s*recentDefectRecordIds\s*\},\s*tenantId\s*\}/.test(actionsSource)
  const hasPreventionBatch = /defectRecurrencePrevention\.findMany\(\{\s*where:\s*\{\s*defectRecordId:\s*\{\s*in:\s*recentDefectRecordIds\s*\},\s*tenantId\s*\}/.test(actionsSource)
  assertTrue(
    hasCorrectiveBatch && hasPreventionBatch,
    "T16. 최근 품질이슈의 조치/재발방지 상태 배치 조회가 defectRecordId(직접 FK) + tenantId 조건만 사용 — N+1 없이 2개의 명확한 쿼리로 처리, 추측성 join 없음"
  )
}

// T17: Prisma schema/migration 변경 없음 — 이 PR은 읽기 전용 기능만 추가
{
  const hasNewMigrationDir = fs.readdirSync("prisma/migrations_legacy_nmes").some((d) => d.startsWith("2026") && /quality.?dashboard/i.test(d))
  assertTrue(!hasNewMigrationDir, "T17. 품질현황 대시보드는 조회 전용이라 신규 Prisma migration이 없음")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
