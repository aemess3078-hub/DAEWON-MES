import type {
  RecurrencePreventionStatus,
  VerificationResult,
  DefectSeverity,
  DefectDisposition,
  InspectionStage,
} from "@prisma/client"
import { kstDaysUntil } from "../date/kst"

// defect-recurrence-prevention.actions.ts("use server")는 async export만 허용되므로,
// DB에 의존하지 않는 순수 로직(검증/where절 조립/직렬화/기한초과 계산)을 이 파일로
// 분리한다(defect-corrective-action.helpers.ts와 동일한 이유). 두 helpers 파일 간
// import는 하지 않는다 — 각 기능이 독립적으로 유지되도록, 비슷한 소규모 검증
// 로직은 각자 파일에 둔다(defect-cause-analysis.helpers.ts/defect-corrective-action.helpers.ts
// 관계와 동일한 선례).
// code-path 테스트는 scripts/test-recurrence-prevention.ts 참조.

export type RecurrencePreventionStatusFilter = "ALL" | "OPEN" | "IN_PROGRESS" | "VERIFYING" | "COMPLETED" | "OVERDUE"

/** preventionContent를 trim하고, 빈 문자열이면 명시적으로 거부한다. */
export function normalizePreventionContent(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error("재발방지 대책을 입력해 주세요.")
  }
  return trimmed
}

/**
 * 완료예정일(dueDate)은 조치관리와 동일하게 필수로 받는다.
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

/** 효과성 검증 시 검증내용은 필수로 받는다(검증결과만 남기고 근거 없이 종료되는 것을 막기 위함). */
export function normalizeVerificationContent(value: string | null | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error("검증내용을 입력해 주세요.")
  }
  return trimmed
}

/**
 * 기한초과 여부는 DB에 별도 컬럼/상태로 저장하지 않고 조회·표시 시점에 계산한다
 * (조치관리 isOverdue와 동일 규칙). dueDate < 오늘(KST) && status !== COMPLETED.
 */
export function isOverdue(
  dueDate: Date | string,
  status: RecurrencePreventionStatus,
  now: Date = new Date()
): boolean {
  if (status === "COMPLETED") return false
  const target = typeof dueDate === "string" ? new Date(dueDate) : dueDate
  return kstDaysUntil(target, now) < 0
}

/** "상태" 필터를 Prisma DefectRecurrencePrevention.where 절로 변환한다. OVERDUE는 DB 컬럼이 아니라 애플리케이션에서 별도 계산한다. */
export function buildRecurrencePreventionStatusWhere(
  status?: RecurrencePreventionStatusFilter
): Record<string, unknown> {
  if (status === "OPEN" || status === "IN_PROGRESS" || status === "VERIFYING" || status === "COMPLETED") {
    return { status }
  }
  return {}
}

// ─── 목록 직렬화 ──────────────────────────────────────────────────────────────

export type DefectRecurrencePreventionRow = {
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
  correctiveActionTotal: number
  correctiveActionCompleted: number
  correctiveActions: { id: string; actionContent: string; status: string; completedAt: string | null }[]
  preventionContent: string
  assigneeId: string | null
  assigneeName: string | null
  dueDate: string
  status: RecurrencePreventionStatus
  verificationContent: string | null
  verificationResult: VerificationResult | null
  verifierId: string | null
  verifierName: string | null
  verifiedAt: string | null
  completedAt: string | null
  createdByName: string
  updatedByName: string
  createdAt: string
  updatedAt: string
  overdue: boolean
}

/** getDefectRecurrencePreventionRecords()가 반환하는 select shape과 정확히 대응하는 순수 매핑 함수. */
export type DefectRecurrencePreventionRecordLike = {
  id: string
  preventionContent: string
  assigneeId: string | null
  assignee: { name: string } | null
  dueDate: Date
  status: RecurrencePreventionStatus
  verificationContent: string | null
  verificationResult: VerificationResult | null
  verifierId: string | null
  verifier: { name: string } | null
  verifiedAt: Date | null
  completedAt: Date | null
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
    correctiveActions: { id: string; actionContent: string; status: string; completedAt: Date | null }[]
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

export function serializeDefectRecurrencePreventionRow(
  record: DefectRecurrencePreventionRecordLike,
  now: Date = new Date()
): DefectRecurrencePreventionRow {
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
    correctiveActionTotal: defect.correctiveActions.length,
    correctiveActionCompleted: defect.correctiveActions.filter((a) => a.status === "COMPLETED").length,
    correctiveActions: defect.correctiveActions.map((a) => ({
      id: a.id,
      actionContent: a.actionContent,
      status: a.status,
      completedAt: a.completedAt?.toISOString() ?? null,
    })),
    preventionContent: record.preventionContent,
    assigneeId: record.assigneeId,
    assigneeName: record.assignee?.name ?? null,
    dueDate: record.dueDate.toISOString(),
    status: record.status,
    verificationContent: record.verificationContent,
    verificationResult: record.verificationResult,
    verifierId: record.verifierId,
    verifierName: record.verifier?.name ?? null,
    verifiedAt: record.verifiedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdByName: record.createdBy.name,
    updatedByName: record.updatedBy.name,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    overdue: isOverdue(record.dueDate, record.status, now),
  }
}
