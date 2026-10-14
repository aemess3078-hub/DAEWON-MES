"use server"

import { prisma } from "@/lib/db/prisma"
import { requireRole, getTenantId } from "@/lib/auth"
import { getDefectStats, getDefectStatsFilterOptions, type DefectStatsDailyPoint, type DefectStatsByItem, type DefectStatsByOperation } from "./defect-stats.actions"
import { getDefectCauseAnalysisList } from "./defect-cause-analysis.actions"
import { getDefectCorrectiveActionList } from "./defect-corrective-action.actions"
import { getDefectRecurrencePreventionList } from "./defect-recurrence-prevention.actions"
import {
  buildQualityDashboardKpi,
  topDefectTypes,
  buildCapaStageBreakdown,
  buildQualityIssues,
  buildRecentQualityIssues,
  latestStatusByDefectRecord,
  type QualityDashboardKpi,
  type CapaStageBreakdown,
  type QualityIssueItem,
  type RecentQualityIssueRow,
} from "./quality-dashboard.helpers"
import type { DefectStatsByType } from "./defect-stats.actions"
import { requireReadActor } from "@/lib/auth/action-guards"

export type {
  QualityDashboardKpi,
  CapaStageBreakdown,
  QualityIssueItem,
  RecentQualityIssueRow,
  DefectStatsDailyPoint,
  DefectStatsByType,
  DefectStatsByItem,
  DefectStatsByOperation,
}

// ─── 청운커팅 사업계획서 "품질검사 > 품질현황" ──────────────────────────────
//
// 종합 품질 상태를 한 화면에서 확인하는 대시보드다. 불량분석(PR 기존)/원인분석
// (PR #55)/조치관리(PR #66)/재발방지관리(PR #67)가 이미 각자의 정확한 정의로
// 불량률·상태·기한초과를 계산하고 있어, 이 대시보드는 그 계산식을 다시 만들지
// 않고 각 화면의 기존 조회 함수(getDefectStats/getDefectCauseAnalysisList/
// getDefectCorrectiveActionList/getDefectRecurrencePreventionList)를 그대로
// 호출해 결과를 조합만 한다 — "정본"이 여러 개 생기는 것을 막기 위함이다
// (같은 이유로 이 화면의 숫자는 항상 기존 불량분석/원인분석/조치관리/재발방지관리
// 화면과 정확히 일치한다).
//
// AI 관련 카드(품질 위험도/AI 종합 진단/영향요인/권장 공정조건 등)는 이번 PR에서
// 구현하지 않는다 — 실제 학습/추론 모델이 없는 상태에서 가짜 점수·문구를 만들어
// AI처럼 보이게 표시하지 않는다. "확인 필요 품질이슈"는 기한초과/검증대기/미등록처럼
// DB에서 확정적으로 계산 가능한 조건만 사용한다.
//
// 조회 전용(Prisma schema/migration 변경 없음) — mutating action이 없다.

export type QualityDashboardFilter = {
  from?: string
  to?: string
  itemId?: string
  routingOperationId?: string
}

export type QualityDashboardData = {
  kpi: QualityDashboardKpi
  daily: DefectStatsDailyPoint[]
  topDefectTypes: DefectStatsByType[]
  byItem: DefectStatsByItem[]
  byOperation: DefectStatsByOperation[]
  capa: CapaStageBreakdown
  issues: QualityIssueItem[]
  recentIssues: RecentQualityIssueRow[]
  truncated: boolean
}

export async function getQualityDashboardData(
  filter: QualityDashboardFilter = {}
): Promise<QualityDashboardData> {
  await requireReadActor(["DEFECT_MANAGEMENT", "QUALITY_INSPECTION"])
  await requireRole("VIEWER")
  const tenantId = await getTenantId()

  // 불량분석/원인분석/조치관리/재발방지관리와 동일한 from/to/itemId/routingOperationId
  // 필터를 그대로 전달한다 — 각 화면이 이미 검증한 필터 해석(KST 기간 등)을 재사용.
  const sharedFilter = {
    from: filter.from,
    to: filter.to,
    itemId: filter.itemId,
    routingOperationId: filter.routingOperationId,
  }

  const [stats, causeRows, correctiveRows, preventionRows] = await Promise.all([
    getDefectStats(sharedFilter),
    getDefectCauseAnalysisList(sharedFilter),
    getDefectCorrectiveActionList(sharedFilter),
    getDefectRecurrencePreventionList(sharedFilter),
  ])

  const kpi = buildQualityDashboardKpi(stats.summary, correctiveRows, preventionRows)
  const capa = buildCapaStageBreakdown(causeRows, correctiveRows, preventionRows)
  const issues = buildQualityIssues(causeRows, correctiveRows, preventionRows)

  // 최근 품질이슈: causeRows(이미 inspectedAt desc로 정렬됨)에서 상위 N건의
  // defectRecordId만 뽑아, 그 건들에 대한 조치/재발방지 최신 상태를 direct FK로
  // 배치 조회한다(추측성 join 아님 — defectRecordId 등호 조건만 사용).
  const recentDefectRecordIds = causeRows.slice(0, 8).map((r) => r.defectRecordId)

  const [correctiveForRecent, preventionForRecent] = recentDefectRecordIds.length
    ? await Promise.all([
        prisma.defectCorrectiveAction.findMany({
          where: { defectRecordId: { in: recentDefectRecordIds }, tenantId },
          select: { defectRecordId: true, status: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.defectRecurrencePrevention.findMany({
          where: { defectRecordId: { in: recentDefectRecordIds }, tenantId },
          select: { defectRecordId: true, status: true },
          orderBy: { createdAt: "desc" },
        }),
      ])
    : [[], []]

  const recentIssues = buildRecentQualityIssues(
    causeRows,
    latestStatusByDefectRecord(correctiveForRecent),
    latestStatusByDefectRecord(preventionForRecent)
  )

  return {
    kpi,
    daily: stats.daily,
    topDefectTypes: topDefectTypes(stats.byType),
    byItem: stats.byItem,
    byOperation: stats.byOperation,
    capa,
    issues,
    recentIssues,
    truncated: stats.truncated,
  }
}

// 필터 옵션(품목/공정)은 불량분석 화면과 완전히 동일한 대상 범위를 재사용한다.
export async function getQualityDashboardFilterOptions() {
  await requireReadActor(["DEFECT_MANAGEMENT", "QUALITY_INSPECTION"])
  return getDefectStatsFilterOptions()
}
