import type { DefectSeverity, DefectDisposition, InspectionStage } from "@prisma/client"

// defect-cause-analysis.actions.ts("use server")는 async export만 허용되므로,
// DB에 의존하지 않는 순수 로직(검증/where절 조립/직렬화)을 이 파일로 분리한다
// (inspection-measurement.helpers.ts / spc-calculations.ts와 동일한 이유).
// code-path 테스트는 scripts/test-defect-cause-analysis.ts 참조.

export type AnalysisStatusFilter = "ALL" | "ANALYZED" | "UNANALYZED"

/** rootCause를 trim하고, 빈 문자열이면 명시적으로 거부한다. */
export function normalizeRootCause(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error("근본원인을 입력해 주세요.")
  }
  return trimmed
}

/** analysisDetail은 선택값 — trim 후 빈 문자열/undefined/null이면 null로 정규화한다. */
export function normalizeAnalysisDetail(value?: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** "분석여부" 필터를 Prisma DefectRecord.where 절의 causeAnalysis 조건으로 변환한다. */
export function buildAnalysisStatusWhere(
  status?: AnalysisStatusFilter
): Record<string, unknown> {
  if (status === "ANALYZED") return { causeAnalysis: { isNot: null } }
  if (status === "UNANALYZED") return { causeAnalysis: null }
  return {}
}

// ─── 목록 직렬화 ──────────────────────────────────────────────────────────────

export type DefectCauseAnalysisRow = {
  defectRecordId: string
  inspectionId: string
  inspectedAt: string
  stage: InspectionStage
  itemCode: string
  itemName: string
  routingOperationName: string
  orderNo: string
  manufacturingNo: string | null
  defectCodeId: string
  defectCode: string
  defectCodeName: string
  qty: number
  severity: DefectSeverity
  disposition: DefectDisposition | null
  analysisId: string | null
  analysisStatus: "ANALYZED" | "UNANALYZED"
  rootCause: string | null
  analysisDetail: string | null
  updatedByName: string | null
  updatedAt: string | null
}

/** getDefectCauseAnalysisRecords()가 반환하는 select shape과 정확히 대응하는 순수 매핑 함수. */
export type DefectRecordLike = {
  id: string
  qty: unknown // Prisma Decimal — Number()로 변환
  severity: DefectSeverity
  disposition: DefectDisposition | null
  defectCode: { id: string; code: string; name: string }
  qualityInspection: {
    id: string
    inspectedAt: Date
    stage: InspectionStage
    workOrderOperation: {
      routingOperation: { name: string }
      workOrder: {
        orderNo: string
        manufacturingNo: string | null
        item: { code: string; name: string }
      }
    }
  }
  causeAnalysis: {
    id: string
    rootCause: string
    analysisDetail: string | null
    updatedAt: Date
    updatedBy: { name: string }
  } | null
}

export function serializeDefectCauseAnalysisRow(record: DefectRecordLike): DefectCauseAnalysisRow {
  const woOp = record.qualityInspection.workOrderOperation
  const analysis = record.causeAnalysis
  return {
    defectRecordId: record.id,
    inspectionId: record.qualityInspection.id,
    inspectedAt: record.qualityInspection.inspectedAt.toISOString(),
    stage: record.qualityInspection.stage,
    itemCode: woOp.workOrder.item.code,
    itemName: woOp.workOrder.item.name,
    routingOperationName: woOp.routingOperation.name,
    orderNo: woOp.workOrder.orderNo,
    manufacturingNo: woOp.workOrder.manufacturingNo,
    defectCodeId: record.defectCode.id,
    defectCode: record.defectCode.code,
    defectCodeName: record.defectCode.name,
    qty: Number(record.qty),
    severity: record.severity,
    disposition: record.disposition,
    analysisId: analysis?.id ?? null,
    analysisStatus: analysis ? "ANALYZED" : "UNANALYZED",
    rootCause: analysis?.rootCause ?? null,
    analysisDetail: analysis?.analysisDetail ?? null,
    updatedByName: analysis?.updatedBy.name ?? null,
    updatedAt: analysis?.updatedAt.toISOString() ?? null,
  }
}
