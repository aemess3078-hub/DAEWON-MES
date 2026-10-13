import type { WorkOrderStatus } from "@prisma/client"
import { WipMovementType, WipUnitStatus } from "@prisma/client"
import { REUSABLE_WIP_STATUSES } from "@/lib/actions/wip-traceability.helpers"
import { computeExpectedProgressRate } from "@/lib/actions/production-progress.calculations"
import type {
  ProductionProgressAssignmentInput,
  ProductionProgressCurrentOperation,
  ProductionProgressHealth,
  ProductionProgressOperationInput,
  ProductionProgressRow,
  ProductionProgressWipInput,
  ProductionProgressWipMovementInput,
  ProductionProgressWorkOrderInput,
} from "@/lib/actions/production-progress.types"

// ─── 생산진행 현황(NewMES 전용) 집계 규칙 — 순수 함수 ────────────────────────────
//
// 이 파일은 DB 조회를 하지 않는다("prisma" import 없음, "use server" 없음).
// 실제 조회는 다음 단계(production-progress.actions.ts)에서 이 함수들에
// Prisma 결과를 매핑해 전달하는 방식으로 이루어진다.
//
// NewMES 전용 안내: 이 서비스는 브랜드 분기 로직을 포함하지 않는다. 순수 계산이므로
// CNS Medical 코드/데이터와 무관하며, 화면 노출 여부는 이후 단계에서
// 기존 NEXT_PUBLIC_BRAND 관례로 제어한다.

const REUSABLE_WIP_STATUS_SET = new Set<WipUnitStatus>(REUSABLE_WIP_STATUSES)

// ─── 1. 계획수량 ──────────────────────────────────────────────────────────────
//
// 작업지시 계획수량은 반드시 WorkOrder.plannedQty를 그대로 사용한다.
// Σ WorkOrderOperation.plannedQty로 계산하면 공정 수만큼(예: 5공정 → 5배) 중복된다.

export function getPlannedQty(
  workOrder: Pick<ProductionProgressWorkOrderInput, "plannedQty">
): number {
  return workOrder.plannedQty
}

// ─── 2. 생산실적 ──────────────────────────────────────────────────────────────
//
// "생산실적"은 전 공정 ProductionResult.goodQty의 합계가 아니다.
// (예: CNC 1000 + 연마 1000 + 조립 880 = 2880은 잘못된 값 — 같은 물건이 공정을
//  지날 때마다 중복 계상된다.)
// 실적이 실제로 기록된 "가장 높은 seq 공정" 1개만을 최종 산출량으로 본다.
// 동일 공정에 복수 설비 배정(WorkOrderOperationAssignment)으로 인해 여러
// ProductionResult가 존재할 수 있으므로, 그 공정에 속한 모든 실적을 합산한다.

export function computeProductionOutputQty(
  operations: ProductionProgressOperationInput[]
): number {
  const operationsWithResults = operations.filter(
    (operation) => operation.productionResults.length > 0
  )
  if (operationsWithResults.length === 0) return 0

  const latestOperation = operationsWithResults.reduce((latest, operation) =>
    operation.seq > latest.seq ? operation : latest
  )

  return latestOperation.productionResults.reduce(
    (sum, result) => sum + result.goodQty,
    0
  )
}

// ─── 3. 진행률(생산 달성률) ────────────────────────────────────────────────────
//
// Σ operation.completedQty / Σ operation.plannedQty 방식은 쓰지 않는다.
// completedQty에는 goodQty+defectQty+reworkQty가 모두 포함되므로, 불량이 섞여도
// 100%로 보일 수 있어 "계획/실적/진행률" 컬럼 구성과 의미가 어긋난다.
// 대표 진행률은 생산 달성률(productionOutputQty / plannedQty)로 정의한다.
// 화면 표시용 비율만 0~100으로 clamp하고, productionOutputQty 원본 값은 자르지 않는다.

export function computeProgressRate(
  plannedQty: number,
  productionOutputQty: number
): number {
  if (plannedQty <= 0) return 0
  const rate = (productionOutputQty / plannedQty) * 100
  return Math.min(100, Math.max(0, rate))
}

// ─── 4. 현재공정 ──────────────────────────────────────────────────────────────
//
// 우선순위:
//   1) 활성 root WipUnit(REUSABLE_WIP_STATUSES에 속함) 존재 → 그 WipUnit의 workOrderOperationId
//   2) root WipUnit이 COMPLETED → 최종공정 완료(입고 대기)
//   3) root WipUnit이 아예 없음 → 자재출고 전 (null 반환)
//   4) fallback: COMPLETED/SKIPPED가 아닌 가장 낮은 seq 공정
//
// root 판별은 parentWipUnitId===null && sourceProductionResultId===null (불량/재작업으로
// 분리된 child WipUnit 제외). 레거시 데이터로 root가 여러 건 존재할 수 있는 경우,
// findActiveWipUnitForWorkOrder()와 동일하게 updatedAt desc → createdAt desc로 최신 1건을 취한다.

function pickLatestWipUnit(
  units: ProductionProgressWipInput[]
): ProductionProgressWipInput {
  return units.reduce((latest, unit) => {
    if (unit.updatedAt.getTime() !== latest.updatedAt.getTime()) {
      return unit.updatedAt > latest.updatedAt ? unit : latest
    }
    return unit.createdAt > latest.createdAt ? unit : latest
  })
}

export function resolveCurrentOperation(
  operations: ProductionProgressOperationInput[],
  wipUnits: ProductionProgressWipInput[]
): ProductionProgressCurrentOperation {
  const rootCandidates = wipUnits.filter(
    (unit) => unit.parentWipUnitId == null && unit.sourceProductionResultId == null
  )

  const toCurrentOperation = (
    unit: ProductionProgressWipInput
  ): ProductionProgressCurrentOperation => {
    const operation = operations.find((op) => op.id === unit.workOrderOperationId)
    if (!operation) return null
    return {
      operationId: operation.id,
      seq: operation.seq,
      operationName: operation.operationName,
      wipStatus: unit.status,
    }
  }

  if (rootCandidates.length > 0) {
    // 1) 활성 root
    const activeRoots = rootCandidates.filter((unit) =>
      REUSABLE_WIP_STATUS_SET.has(unit.status)
    )
    if (activeRoots.length > 0) {
      return toCurrentOperation(pickLatestWipUnit(activeRoots))
    }

    // 2) 완료 root
    const completedRoots = rootCandidates.filter(
      (unit) => unit.status === WipUnitStatus.COMPLETED
    )
    if (completedRoots.length > 0) {
      return toCurrentOperation(pickLatestWipUnit(completedRoots))
    }

    // root는 있으나 활성도 완료도 아닌 비정상 상태(예: root 자체가 SCRAPPED)
    // → 4) fallback으로 내려간다.
  } else {
    // 3) root WipUnit이 전혀 없음 = 자재출고 전. 표시할 공정 정보가 없으므로 null.
    return null
  }

  // 4) fallback: COMPLETED/SKIPPED가 아닌 가장 낮은 seq 공정
  const pendingOperations = operations
    .filter((op) => op.status !== "COMPLETED" && op.status !== "SKIPPED")
    .sort((a, b) => a.seq - b.seq)
  const fallbackOperation = pendingOperations[0]
  if (!fallbackOperation) return null

  return {
    operationId: fallbackOperation.id,
    seq: fallbackOperation.seq,
    operationName: fallbackOperation.operationName,
    wipStatus: null,
  }
}

// ─── 5. 재공수량 ──────────────────────────────────────────────────────────────
//
// "계획수량 - 생산실적"으로 계산하지 않는다. 불량 SCRAP 분리·외주 반출 등을
// 반영하지 못하기 때문이다. 실제 WipUnit 기준으로, root이면서 활성 상태
// (REUSABLE_WIP_STATUSES)인 것만 합산한다. 불량/재작업으로 분리된 child WipUnit은
// 이미 root qty에서 차감되어 있으므로 별도로 합산하면 안 된다(중복 계상).
//
// 작업지시당 root는 원칙적으로 1건이지만, 레거시 데이터 오류로 여러 건이 존재할
// 가능성을 배제할 수 없어 안전하게 "활성 root qty 합산"으로 처리한다. 이 정책이
// 실제 시스템의 다른 정본(findActiveWipUnitForWorkOrder는 단건만 반환)과 다르게
// 동작할 수 있음을 인지하고, Server Action 단계에서 데이터가 실제로 1건뿐인지
// 확인되면 이 함수는 그대로 두어도 안전하다(1건일 때 결과가 동일하다).

export function computeWipQty(wipUnits: ProductionProgressWipInput[]): number {
  const activeRootUnits = wipUnits.filter(
    (unit) =>
      unit.parentWipUnitId == null &&
      unit.sourceProductionResultId == null &&
      REUSABLE_WIP_STATUS_SET.has(unit.status)
  )
  return activeRootUnits.reduce((sum, unit) => sum + unit.qty, 0)
}

// ─── 5-B. 미해결 재작업 ────────────────────────────────────────────────────────
//
// REWORK로 분리된 child WipUnit(parentWipUnitId != null)이 남아 있으면 완제품
// 입고가 막힐 수 있다(wip-receipt.helpers.ts의 computeWipReceiptStatus가 판정하는
// 것과 같은 현상). 이 함수는 그 전체 정본을 그대로 재구현하지 않는다 — 그러려면
// WipMovement(REWORK) 연결 여부까지 확인해야 하는데 이 화면의 Query에는 그 데이터가
// 없다. 대신 "REWORK 상태 child WipUnit 존재"라는 최소 조건만 본다.
// 반드시 child(parentWipUnitId != null)만 검사한다 — root WipUnit.status===REWORK를
// 보는 것으로 바꾸지 않는다(그런 경우는 이 화면에서 REWORK가 아니라 currentOperation의
// fallback 판정 대상이다).

export function hasUnresolvedRework(wipUnits: ProductionProgressWipInput[]): boolean {
  return wipUnits.some(
    (unit) => unit.parentWipUnitId != null && unit.status === WipUnitStatus.REWORK
  )
}

// ─── 6. 배정설비 정규화 ────────────────────────────────────────────────────────
//
// WorkOrderOperationAssignment가 하나 이상 있으면 assignments의 설비를 사용하고,
// 없으면 WorkOrderOperation.equipment(단일 배정)로 fallback한다. 중복 제거한
// 배열을 반환하며, UI 문자열 변환(", " join 등)은 이 단계에서 하지 않는다.

export function normalizeEquipmentNames(
  operation: Pick<ProductionProgressOperationInput, "equipmentName" | "assignments">
): string[] {
  const fromAssignments = dedupe(
    operation.assignments
      .map((assignment: ProductionProgressAssignmentInput) => assignment.equipmentName)
      .filter((name): name is string => name != null && name.length > 0)
  )
  if (fromAssignments.length > 0) return fromAssignments

  return operation.equipmentName ? [operation.equipmentName] : []
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values))
}

// ─── 7. 시작일 ────────────────────────────────────────────────────────────────
//
// WorkOrder에는 실제 시작일 컬럼이 없다. 우선순위:
//   1) WipMovement 중 movementType===STARTED의 가장 이른 createdAt
//   2) 없으면 ProductionResult.startedAt 중 가장 이른 값
//   3) 둘 다 없으면 null
// KST 등 timezone 변환은 이 단계에서 하지 않고 Date 원본을 그대로 반환한다.

export function resolveStartedAt(
  operations: ProductionProgressOperationInput[],
  wipMovements: ProductionProgressWipMovementInput[]
): Date | null {
  const startedMovementDates = wipMovements
    .filter((movement) => movement.movementType === WipMovementType.STARTED)
    .map((movement) => movement.createdAt)
  if (startedMovementDates.length > 0) {
    return earliest(startedMovementDates)
  }

  const resultStartedDates = operations
    .flatMap((operation) => operation.productionResults)
    .map((result) => result.startedAt)
    .filter((date): date is Date => date != null)
  if (resultStartedDates.length > 0) {
    return earliest(resultStartedDates)
  }

  return null
}

function earliest(dates: Date[]): Date {
  return dates.reduce((min, date) => (date < min ? date : min))
}

// ─── 8. 예상 진행률 (건강도 판정 보조) ───────────────────────────────────────────
//
// computeExpectedProgressRate()는 production-progress.calculations.ts로 이동했다
// (production-alerts.ts가 클라이언트 번들에서 이 계산만 재사용하면서, service.ts
// 전체와 그 서버 의존성까지 함께 딸려 들어오는 문제가 있었다 — 계산식은 그대로,
// 위치만 옮겼고 구현은 그 파일 하나뿐이다). resolveHealthStatus()는 아래에서
// import한 동일 함수를 그대로 호출한다.

// ─── 9. 상태 건강도 ────────────────────────────────────────────────────────────
//
// WorkOrder.status === COMPLETED이면 실적이 계획에 못 미치더라도 DELAYED로
// 판정하지 않는다(완료된 작업지시를 "지연"으로 표시하는 것은 오해를 유발한다).
//
// DELAYED: 미완료 && (납기 초과 || 예상 진행률 - 실제 진행률 >= 20%p)
// WARNING: 미완료 && ((납기 2일 이내 && 진행률 < 80%) || (0 < 진행률 격차 < 20%p))
// NORMAL : 그 외 (완료 포함)

export function resolveHealthStatus(params: {
  workOrderStatus: WorkOrderStatus
  progressRate: number
  dueDate: Date | null
  startedAt: Date | null
  referenceDate: Date
}): ProductionProgressHealth {
  const { workOrderStatus, progressRate, dueDate, startedAt, referenceDate } = params

  if (workOrderStatus === "COMPLETED") return "NORMAL"

  const isPastDue = dueDate != null && dueDate.getTime() < referenceDate.getTime()
  const expectedProgressRate = computeExpectedProgressRate(startedAt, dueDate, referenceDate)
  const progressGap =
    expectedProgressRate != null ? expectedProgressRate - progressRate : null

  if (isPastDue) return "DELAYED"
  if (progressGap != null && progressGap >= 20) return "DELAYED"

  if (dueDate != null) {
    const daysUntilDue =
      (dueDate.getTime() - referenceDate.getTime()) / (24 * 60 * 60 * 1000)
    if (daysUntilDue <= 2 && progressRate < 80) return "WARNING"
  }
  if (progressGap != null && progressGap > 0 && progressGap < 20) return "WARNING"

  return "NORMAL"
}

// ─── 10. 대표 Row 조립 ─────────────────────────────────────────────────────────
//
// 위 함수들을 조합해 목록 1행을 만든다. referenceDate는 건강도/예상진행률 계산의
// "지금" 기준이며, 기본값은 호출 시점의 new Date()이지만 테스트에서는 고정값을
// 넘겨 결정적으로 검증한다. 담당자/최근검사자는 이번 단계에 포함하지 않는다
// (Server Action 단계에서 QualityInspection 조회 결과를 얹어 확장).

export function buildProductionProgressRow(
  workOrder: ProductionProgressWorkOrderInput,
  referenceDate: Date = new Date()
): ProductionProgressRow {
  const plannedQty = getPlannedQty(workOrder)
  const productionOutputQty = computeProductionOutputQty(workOrder.operations)
  const progressRate = computeProgressRate(plannedQty, productionOutputQty)
  const currentOperation = resolveCurrentOperation(workOrder.operations, workOrder.wipUnits)
  const wipQty = computeWipQty(workOrder.wipUnits)
  const reworkPending = hasUnresolvedRework(workOrder.wipUnits)

  const currentOperationRecord = currentOperation
    ? workOrder.operations.find((op) => op.id === currentOperation.operationId) ?? null
    : null
  const equipmentNames = currentOperationRecord
    ? normalizeEquipmentNames(currentOperationRecord)
    : []

  const startedAt = resolveStartedAt(workOrder.operations, workOrder.wipMovements)
  const dueDate = workOrder.dueDate ?? null // 임의 예정일 생성하지 않음 — 없으면 null 그대로

  const healthStatus = resolveHealthStatus({
    workOrderStatus: workOrder.status,
    progressRate,
    dueDate,
    startedAt,
    referenceDate,
  })

  return {
    workOrderId: workOrder.id,
    orderNo: workOrder.orderNo,
    itemId: workOrder.itemId,
    itemCode: workOrder.itemCode,
    itemName: workOrder.itemName,
    itemUom: workOrder.itemUom,
    plannedQty,
    productionOutputQty,
    progressRate,
    currentOperation,
    wipQty,
    equipmentNames,
    startedAt,
    dueDate,
    workOrderStatus: workOrder.status,
    healthStatus,
    hasUnresolvedRework: reworkPending,
  }
}
