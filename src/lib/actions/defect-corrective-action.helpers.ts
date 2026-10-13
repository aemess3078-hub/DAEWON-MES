import type { CorrectiveActionStatus, DefectSeverity, DefectDisposition, InspectionStage } from "@prisma/client"
import { kstDaysUntil } from "../date/kst"

// defect-corrective-action.actions.ts("use server")는 async export만 허용되므로,
// DB에 의존하지 않는 순수 로직(검증/where절 조립/직렬화/기한초과 계산)을 이 파일로
// 분리한다(defect-cause-analysis.helpers.ts와 동일한 이유).
// code-path 테스트는 scripts/test-corrective-action.ts 참조.

export type CorrectiveActionStatusFilter = "ALL" | "OPEN" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE"

/** actionContent를 trim하고, 빈 문자열이면 명시적으로 거부한다. */
export function normalizeActionContent(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error("조치내용을 입력해 주세요.")
  }
  return trimmed
}

/** completionNote는 선택값 — trim 후 빈 문자열/undefined/null이면 null로 정규화한다. */
export function normalizeCompletionNote(value?: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * 완료예정일(dueDate)은 사업계획서 기준 조치관리의 핵심 필드라 필수로 받는다.
 * "YYYY-MM-DD" 문자열을 서버에서 Date로 변환하며, 비어있거나 파싱 불가능하면 거부한다.
 */
export function normalizeDueDate(value: string | null | undefined): Date {
  if (!value?.trim()) {
    throw new Error("완료예정일을 입력해 주세요.")
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error("완료예정일 형식이 올바르지 않습니다.")
  }
  return date
}

/**
 * 기한초과 여부는 DB에 별도 컬럼/상태로 저장하지 않고 조회·표시 시점에 계산한다.
 * dueDate < 오늘(KST) && status !== COMPLETED 이면 기한초과.
 */
export function isOverdue(
  dueDate: Date | string,
  status: CorrectiveActionStatus,
  now: Date = new Date()
): boolean {
  if (status === "COMPLETED") return false
  const target = typeof dueDate === "string" ? new Date(dueDate) : dueDate
  return kstDaysUntil(target, now) < 0
}

/** "상태" 필터를 Prisma DefectCorrectiveAction.where 절로 변환한다. OVERDUE는 DB 컬럼이 아니라 애플리케이션에서 별도 계산한다. */
export function buildCorrectiveActionStatusWhere(
  status?: CorrectiveActionStatusFilter
): Record<string, unknown> {
  if (status === "OPEN" || status === "IN_PROGRESS" || status === "COMPLETED") {
    return { status }
  }
  // "OVERDUE"는 status 컬럼으로 표현할 수 없으므로(완료 전 상태 전부가 대상일 수 있음)
  // 여기서는 필터링하지 않고, 목록 조회 후 isOverdue()로 애플리케이션 레벨에서 걸러낸다.
  return {}
}

// ─── 목록 직렬화 ──────────────────────────────────────────────────────────────

export type DefectCorrectiveActionRow = {
  id: string
  defectRecordId: string
  inspectedAt: string
  stage: InspectionStage
  itemCode: string
  itemName: string
  routingOperationName: string
  orderNo: string
  manufacturingNo: string | null
  defectCode: string
  defectCodeName: string
  defectQty: number
  severity: DefectSeverity
  disposition: DefectDisposition | null
  rootCause: string | null
  analysisDetail: string | null
  actionContent: string
  assigneeId: string | null
  assigneeName: string | null
  dueDate: string
  status: CorrectiveActionStatus
  completedAt: string | null
  completionNote: string | null
  createdByName: string
  updatedByName: string
  createdAt: string
  updatedAt: string
  overdue: boolean
}

/** getDefectCorrectiveActionRecords()가 반환하는 select shape과 정확히 대응하는 순수 매핑 함수. */
export type DefectCorrectiveActionRecordLike = {
  id: string
  actionContent: string
  assigneeId: string | null
  assignee: { name: string } | null
  dueDate: Date
  status: CorrectiveActionStatus
  completedAt: Date | null
  completionNote: string | null
  createdBy: { name: string }
  updatedBy: { name: string }
  createdAt: Date
  updatedAt: Date
  defectRecord: {
    id: string
    qty: unknown // Prisma Decimal — Number()로 변환
    severity: DefectSeverity
    disposition: DefectDisposition | null
    defectCode: { code: string; name: string }
    causeAnalysis: { rootCause: string; analysisDetail: string | null } | null
    qualityInspection: {
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
  }
}

export function serializeDefectCorrectiveActionRow(
  record: DefectCorrectiveActionRecordLike,
  now: Date = new Date()
): DefectCorrectiveActionRow {
  const defect = record.defectRecord
  const woOp = defect.qualityInspection.workOrderOperation
  return {
    id: record.id,
    defectRecordId: defect.id,
    inspectedAt: defect.qualityInspection.inspectedAt.toISOString(),
    stage: defect.qualityInspection.stage,
    itemCode: woOp.workOrder.item.code,
    itemName: woOp.workOrder.item.name,
    routingOperationName: woOp.routingOperation.name,
    orderNo: woOp.workOrder.orderNo,
    manufacturingNo: woOp.workOrder.manufacturingNo,
    defectCode: defect.defectCode.code,
    defectCodeName: defect.defectCode.name,
    defectQty: Number(defect.qty),
    severity: defect.severity,
    disposition: defect.disposition,
    rootCause: defect.causeAnalysis?.rootCause ?? null,
    analysisDetail: defect.causeAnalysis?.analysisDetail ?? null,
    actionContent: record.actionContent,
    assigneeId: record.assigneeId,
    assigneeName: record.assignee?.name ?? null,
    dueDate: record.dueDate.toISOString(),
    status: record.status,
    completedAt: record.completedAt?.toISOString() ?? null,
    completionNote: record.completionNote,
    createdByName: record.createdBy.name,
    updatedByName: record.updatedBy.name,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    overdue: isOverdue(record.dueDate, record.status, now),
  }
}
