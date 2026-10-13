import type { DefectStatsSummary, DefectStatsByType } from "./defect-stats.actions"
import type { DefectCauseAnalysisRow } from "./defect-cause-analysis.helpers"
import type { DefectCorrectiveActionRow } from "./defect-corrective-action.helpers"
import type { DefectRecurrencePreventionRow } from "./defect-recurrence-prevention.helpers"

// quality-dashboard.actions.ts("use server")는 async export만 허용되므로, DB에
// 의존하지 않는 순수 조합/집계 로직을 이 파일로 분리한다(defect-corrective-action.helpers.ts와
// 동일한 이유). 이 파일은 불량률/일별추이/불량유형TOP5/품목별·공정별 집계
// "계산식 자체"를 다시 만들지 않는다 — 그 계산은 이미 defect-stats.actions.ts의
// getDefectStats()가 수행하며, 이 대시보드는 그 결과를 그대로 재사용한다
// (§ quality-dashboard.actions.ts 주석 참조, STEP 18: 정본을 여러 개 만들지 않음).
// 여기서 새로 다루는 것은 이 대시보드에서만 필요한 조합 로직뿐이다:
// (1) 원인분석/조치관리/재발방지관리 상태 집계, (2) 확인 필요 품질이슈 우선순위 목록,
// (3) 최근 품질이슈 목록(DefectRecord 기준으로 세 화면의 상태를 병합).
// code-path 테스트는 scripts/test-quality-dashboard.ts 참조.

// ─── KPI ──────────────────────────────────────────────────────────────────────

export type QualityDashboardKpi = {
  inspectedQty: number
  inspectionCount: number
  defectQty: number
  defectRate: number // 0~1 — defect-stats.getDefectStats()의 summary.defectRate를 그대로 사용(재계산 금지)
  openCorrectiveActionCount: number // OPEN + IN_PROGRESS
  verifyingRecurrencePreventionCount: number // VERIFYING
}

export function buildQualityDashboardKpi(
  statsSummary: DefectStatsSummary,
  correctiveRows: DefectCorrectiveActionRow[],
  preventionRows: DefectRecurrencePreventionRow[]
): QualityDashboardKpi {
  return {
    inspectedQty: statsSummary.inspectedQty,
    inspectionCount: statsSummary.inspectionCount,
    defectQty: statsSummary.defectQty,
    defectRate: statsSummary.defectRate,
    openCorrectiveActionCount: correctiveRows.filter((r) => r.status === "OPEN" || r.status === "IN_PROGRESS").length,
    verifyingRecurrencePreventionCount: preventionRows.filter((r) => r.status === "VERIFYING").length,
  }
}

// ─── 불량유형 TOP5 — defect-stats의 byType(이미 수량 내림차순 정렬됨)을 자르기만 한다 ──

export function topDefectTypes(byType: DefectStatsByType[], limit = 5): DefectStatsByType[] {
  return byType.slice(0, limit)
}

// ─── CAPA 단계별 상태 집계 ────────────────────────────────────────────────────

export type CauseAnalysisStageBreakdown = { unanalyzed: number; analyzed: number }
export type CorrectiveActionStageBreakdown = { open: number; inProgress: number; completed: number; overdue: number }
export type RecurrencePreventionStageBreakdown = {
  open: number
  inProgress: number
  verifying: number
  completed: number
  overdue: number
}

export type CapaStageBreakdown = {
  causeAnalysis: CauseAnalysisStageBreakdown
  correctiveAction: CorrectiveActionStageBreakdown
  recurrencePrevention: RecurrencePreventionStageBreakdown
}

export function countCauseAnalysisStatus(rows: DefectCauseAnalysisRow[]): CauseAnalysisStageBreakdown {
  return {
    unanalyzed: rows.filter((r) => r.analysisStatus === "UNANALYZED").length,
    analyzed: rows.filter((r) => r.analysisStatus === "ANALYZED").length,
  }
}

export function countCorrectiveActionStatus(rows: DefectCorrectiveActionRow[]): CorrectiveActionStageBreakdown {
  return {
    open: rows.filter((r) => r.status === "OPEN").length,
    inProgress: rows.filter((r) => r.status === "IN_PROGRESS").length,
    completed: rows.filter((r) => r.status === "COMPLETED").length,
    // overdue는 각 row의 dueDate/status로부터 이미 계산되어 있는 값(defect-corrective-action.helpers.ts의
    // isOverdue)을 그대로 센다 — 여기서 기한초과 여부를 다시 계산하지 않는다.
    overdue: rows.filter((r) => r.overdue).length,
  }
}

export function countRecurrencePreventionStatus(rows: DefectRecurrencePreventionRow[]): RecurrencePreventionStageBreakdown {
  return {
    open: rows.filter((r) => r.status === "OPEN").length,
    inProgress: rows.filter((r) => r.status === "IN_PROGRESS").length,
    verifying: rows.filter((r) => r.status === "VERIFYING").length,
    completed: rows.filter((r) => r.status === "COMPLETED").length,
    overdue: rows.filter((r) => r.overdue).length,
  }
}

export function buildCapaStageBreakdown(
  causeRows: DefectCauseAnalysisRow[],
  correctiveRows: DefectCorrectiveActionRow[],
  preventionRows: DefectRecurrencePreventionRow[]
): CapaStageBreakdown {
  return {
    causeAnalysis: countCauseAnalysisStatus(causeRows),
    correctiveAction: countCorrectiveActionStatus(correctiveRows),
    recurrencePrevention: countRecurrencePreventionStatus(preventionRows),
  }
}

// ─── 확인 필요 품질이슈 — 명확한 기준(기한초과/검증대기/미등록)만 사용, AI 위험도 없음 ─

export type QualityIssueCategory =
  | "CORRECTIVE_OVERDUE"
  | "PREVENTION_OVERDUE"
  | "PREVENTION_VERIFYING"
  | "CAUSE_UNANALYZED"

export type QualityIssueItem = {
  category: QualityIssueCategory
  label: string
  itemName: string
  routingOperationName: string
  statusLabel: string
  dateLabel: string // ISO — 상황에 따라 발생일(inspectedAt) 또는 목표일(dueDate)
  linkHref: string
}

const CATEGORY_LABEL: Record<QualityIssueCategory, string> = {
  CORRECTIVE_OVERDUE: "조치 기한초과",
  PREVENTION_OVERDUE: "재발방지 기한초과",
  PREVENTION_VERIFYING: "효과성 검증 대기",
  CAUSE_UNANALYZED: "원인분석 미등록",
}

/**
 * 우선순위 고정: 조치 기한초과 → 재발방지 기한초과 → 효과성 검증대기 → 원인분석 미등록.
 * "최근 불량 발생 증가" 같은 추세 판단은 명확한 계산근거 없이 넣지 않는다(§ STEP 8).
 */
export function buildQualityIssues(
  causeRows: DefectCauseAnalysisRow[],
  correctiveRows: DefectCorrectiveActionRow[],
  preventionRows: DefectRecurrencePreventionRow[],
  limit = 8
): QualityIssueItem[] {
  const issues: QualityIssueItem[] = []

  for (const r of correctiveRows.filter((r) => r.overdue)) {
    issues.push({
      category: "CORRECTIVE_OVERDUE",
      label: CATEGORY_LABEL.CORRECTIVE_OVERDUE,
      itemName: r.itemName,
      routingOperationName: r.routingOperationName,
      statusLabel: "기한초과",
      dateLabel: r.dueDate,
      linkHref: "/app/mes/quality/corrective-action",
    })
  }
  for (const r of preventionRows.filter((r) => r.overdue)) {
    issues.push({
      category: "PREVENTION_OVERDUE",
      label: CATEGORY_LABEL.PREVENTION_OVERDUE,
      itemName: r.itemName,
      routingOperationName: r.routingOperationName,
      statusLabel: "기한초과",
      dateLabel: r.dueDate,
      linkHref: "/app/mes/quality/recurrence-prevention",
    })
  }
  for (const r of preventionRows.filter((r) => r.status === "VERIFYING")) {
    issues.push({
      category: "PREVENTION_VERIFYING",
      label: CATEGORY_LABEL.PREVENTION_VERIFYING,
      itemName: r.itemName,
      routingOperationName: r.routingOperationName,
      statusLabel: "검증중",
      dateLabel: r.dueDate,
      linkHref: "/app/mes/quality/recurrence-prevention",
    })
  }
  for (const r of causeRows.filter((r) => r.analysisStatus === "UNANALYZED")) {
    issues.push({
      category: "CAUSE_UNANALYZED",
      label: CATEGORY_LABEL.CAUSE_UNANALYZED,
      itemName: r.itemName,
      routingOperationName: r.routingOperationName,
      statusLabel: "미등록",
      dateLabel: r.inspectedAt,
      linkHref: "/app/mes/quality/cause-analysis",
    })
  }

  return issues.slice(0, limit)
}

// ─── 최근 품질이슈 — DefectRecord 기준, 원인분석/조치/재발방지 상태를 병합 ────

export type RecentQualityIssueRow = {
  defectRecordId: string
  inspectedAt: string
  itemCode: string
  itemName: string
  orderNo: string
  manufacturingNo: string | null
  routingOperationName: string
  defectCode: string
  defectCodeName: string
  qty: number
  causeAnalysisStatus: "ANALYZED" | "UNANALYZED"
  correctiveActionStatus: string | null // 최신 1건의 상태, 등록된 조치가 없으면 null
  recurrencePreventionStatus: string | null
}

/**
 * causeRows는 이미 inspectedAt desc로 정렬되어 있다(defect-cause-analysis.actions.ts).
 * correctiveByDefect/preventionByDefect는 defectRecordId → 최신 상태 1건 맵으로,
 * DB 조회는 actions.ts에서 defectRecordId 기준 직접 FK로 수행하고(추측성 join 아님)
 * 이 함수는 병합만 담당한다.
 */
export function buildRecentQualityIssues(
  causeRows: DefectCauseAnalysisRow[],
  correctiveByDefect: Map<string, string>,
  preventionByDefect: Map<string, string>,
  limit = 8
): RecentQualityIssueRow[] {
  return causeRows.slice(0, limit).map((r) => ({
    defectRecordId: r.defectRecordId,
    inspectedAt: r.inspectedAt,
    itemCode: r.itemCode,
    itemName: r.itemName,
    orderNo: r.orderNo,
    manufacturingNo: r.manufacturingNo,
    routingOperationName: r.routingOperationName,
    defectCode: r.defectCode,
    defectCodeName: r.defectCodeName,
    qty: r.qty,
    causeAnalysisStatus: r.analysisStatus,
    correctiveActionStatus: correctiveByDefect.get(r.defectRecordId) ?? null,
    recurrencePreventionStatus: preventionByDefect.get(r.defectRecordId) ?? null,
  }))
}

/** findMany 결과(최신순 정렬)에서 defectRecordId별 첫 번째(최신) 항목만 남긴다. */
export function latestStatusByDefectRecord(records: { defectRecordId: string; status: string }[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const r of records) {
    if (!map.has(r.defectRecordId)) map.set(r.defectRecordId, r.status)
  }
  return map
}
