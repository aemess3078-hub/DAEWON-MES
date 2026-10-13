import type { OperationStatus, WipUnitStatus, WorkOrderStatus } from "@prisma/client"

// ─── 생산진행 현황(NewMES 전용) 집계 입력/출력 타입 ─────────────────────────────
//
// 이 파일은 Prisma의 거대한 include 결과를 그대로 쓰지 않고, production-progress.service.ts가
// 테스트 가능한 순수 함수로 남을 수 있도록 필요한 최소 필드만 정의한 입력 DTO다.
// 실제 Server Action(다음 단계)에서 Prisma 조회 결과를 이 타입으로 매핑해 전달한다.
//
// 브랜드 분기 안내: 이 화면은 NewMES 전용 기능이며, 이 타입/서비스 자체는 브랜드에
// 의존하지 않는 순수 계산 로직이다. 향후 페이지/메뉴 단계에서 NEXT_PUBLIC_BRAND
// (기존 관례, src/app/layout.tsx / src/components/brand-logo.tsx 참고)로 노출 여부를
// 제어할 예정이며, 이 파일에는 브랜드 분기 코드를 넣지 않는다.

// ─── 입력 DTO ──────────────────────────────────────────────────────────────

/** ProductionResult의 최소 구조 — 생산실적 합산 및 시작일 판정에 사용 */
export type ProductionProgressResultInput = {
  goodQty: number
  /** ProductionResult.startedAt — 시작일 fallback 계산에만 사용 */
  startedAt: Date | null
}

/** WorkOrderOperationAssignment의 최소 구조 — 배정설비 정규화에 사용 */
export type ProductionProgressAssignmentInput = {
  equipmentName: string | null
}

/**
 * WorkOrderOperation의 최소 구조.
 * productionResults에는 해당 공정에 속한 "모든" ProductionResult(복수 설비 배정 포함)를 담는다.
 */
export type ProductionProgressOperationInput = {
  id: string
  seq: number
  status: OperationStatus
  /** 참고용 — 계획수량 집계에는 사용하지 않는다(§계획수량 규칙 참고) */
  plannedQty: number
  /** 참고용 — completedQty는 goodQty+defectQty+reworkQty를 포함하므로 대표 진행률에는 사용하지 않는다 */
  completedQty: number
  operationName: string
  /** RoutingOperation.id — 공정 필터(routingOperation 단위)에서만 사용, 진행률/실적 계산에는 관여하지 않음 */
  routingOperationId: string
  /** WorkOrderOperation.equipment (단일 배정) — assignments가 없을 때만 fallback으로 사용 */
  equipmentName: string | null
  assignments: ProductionProgressAssignmentInput[]
  productionResults: ProductionProgressResultInput[]
}

/**
 * WipUnit의 최소 구조. root 판별(parentWipUnitId, sourceProductionResultId)과
 * 활성 상태 판별에 필요한 필드만 포함한다.
 */
export type ProductionProgressWipInput = {
  id: string
  qty: number
  status: WipUnitStatus
  parentWipUnitId: string | null
  sourceProductionResultId: string | null
  workOrderOperationId: string
  /** 레거시로 root가 여러 건 존재할 때 최신 항목을 고르기 위한 tie-break 기준.
   *  findActiveWipUnitForWorkOrder()의 orderBy(updatedAt desc, createdAt desc)와 동일 기준. */
  updatedAt: Date
  createdAt: Date
}

/** WipMovement의 최소 구조 — 시작일(STARTED) 판정에 사용 */
export type ProductionProgressWipMovementInput = {
  movementType: string
  createdAt: Date
}

/** 작업지시(WorkOrder) 입력 — Row 계산의 최상위 입력 */
export type ProductionProgressWorkOrderInput = {
  id: string
  orderNo: string
  itemId: string
  itemCode: string
  itemName: string
  itemUom: string
  /** WorkOrder.plannedQty — 계획수량의 유일한 출처 */
  plannedQty: number
  status: WorkOrderStatus
  dueDate: Date | null
  operations: ProductionProgressOperationInput[]
  wipUnits: ProductionProgressWipInput[]
  wipMovements: ProductionProgressWipMovementInput[]
}

// ─── 출력 DTO ──────────────────────────────────────────────────────────────

export type ProductionProgressHealth = "NORMAL" | "WARNING" | "DELAYED"

export type ProductionProgressCurrentOperation = {
  operationId: string
  seq: number
  operationName: string
  /** 활성/완료 root WipUnit의 상태. fallback으로 판정된 경우(WIP 데이터 없음)에는 null */
  wipStatus: WipUnitStatus | null
} | null

/**
 * 생산진행 현황 목록의 행(row) 1건.
 * 담당자/최근검사자는 이번 단계(순수 계산)에서는 포함하지 않는다 — 실제 Server Action
 * 구현 시 QualityInspection.inspector 조회 결과를 별도로 얹는다.
 */
export type ProductionProgressRow = {
  workOrderId: string
  orderNo: string
  itemId: string
  itemCode: string
  itemName: string
  itemUom: string

  plannedQty: number
  /** 실적이 존재하는 가장 높은 seq 공정의 goodQty 합 — 전 공정 합산 금지 */
  productionOutputQty: number
  /** productionOutputQty / plannedQty × 100, 0~100 clamp (초과생산이어도 productionOutputQty 자체는 자르지 않음) */
  progressRate: number

  currentOperation: ProductionProgressCurrentOperation
  /** 활성 root WipUnit qty 합 — 계획수량-생산실적 계산 아님 */
  wipQty: number

  equipmentNames: string[]

  startedAt: Date | null
  dueDate: Date | null

  workOrderStatus: WorkOrderStatus
  healthStatus: ProductionProgressHealth
  /** REWORK로 분리된 child WipUnit이 남아 있는지(완제품 입고가 막힐 수 있음). healthStatus와 독립적 */
  hasUnresolvedRework: boolean
}

// ─── Server Action(3단계) 필터/응답 타입 ────────────────────────────────────────
//
// Client → Server Action 직렬화 관례(EquipmentOutputFilter, KpiFilter 등 기존 필터
// 타입)를 따라 기간은 Date가 아닌 "YYYY-MM-DD" 문자열로 받는다. 아직 UI가 없으므로
// 과도하게 세분화하지 않고 조사 단계에서 요구된 5개 조건만 정의한다.

export type ProductionProgressFilter = {
  /** WorkOrder.createdAt 기준 조회 시작일 (YYYY-MM-DD, inclusive) */
  from?: string
  /** WorkOrder.createdAt 기준 조회 종료일 (YYYY-MM-DD, inclusive) */
  to?: string
  siteId?: string
  itemId?: string
  /** RoutingOperation.id — "현재공정이 이 공정인 작업지시"만 필터링(메모리 필터) */
  operationId?: string
  workOrderStatus?: WorkOrderStatus
}

export type ProductionProgressSummary = {
  totalWorkOrders: number
  /** Σ row.plannedQty */
  totalPlannedQty: number
  /** Σ row.productionOutputQty (공정 goodQty 원본 재합산 아님) */
  totalProductionOutputQty: number
  /** 단일 UOM이면 해당 값, 여러 UOM이 섞이면 null */
  uom: string | null
  isMixedUom: boolean
  /** totalProductionOutputQty / totalPlannedQty × 100, 0~100 clamp. 개별 진행률 평균 아님 */
  overallProgressRate: number
  normalCount: number
  warningCount: number
  delayedCount: number
}

export type ProductionProgressData = {
  summary: ProductionProgressSummary
  rows: ProductionProgressRow[]
  appliedFilter: ProductionProgressFilter
}

export type ProductionProgressFilterOptionItem = {
  id: string
  code?: string
  name: string
}

export type ProductionProgressFilterOptions = {
  sites: ProductionProgressFilterOptionItem[]
  items: ProductionProgressFilterOptionItem[]
  /** RoutingOperation 기준 (id, name). 동일 이름이 서로 다른 routing에서 여러 건일 수 있음 */
  operations: ProductionProgressFilterOptionItem[]
  workOrderStatuses: WorkOrderStatus[]
}

// ─── 일별 생산실적 추이(6단계 설계 확정, 7단계 Server Action) ────────────────────
//
// 정의: 작업지시별 최종공정(WorkOrderOperation 중 seq 최댓값)에서, 해당 KST 달력일에
// 등록된 ProductionResult.goodQty 합계. 전 공정 합산이 아니다 — 공정별 goodQty를
// 그대로 더하면 같은 제품이 공정을 이동할 때마다 중복 계상된다(6단계 조사 결론).
//
// getDailyProductionTrend()는 ProductionProgressFilter를 그대로 받아 사용하되,
// from/to는 WorkOrder.createdAt이 아니라 ProductionResult.startedAt(KST 달력일)
// 기준으로 해석하고, operationId(현재공정 스냅샷 필터)는 의미가 달라 무시한다 —
// 자세한 이유는 production-progress.actions.ts의 getDailyProductionTrend 주석 참고.
export type DailyProductionTrendPoint = {
  /** KST 달력일, YYYY-MM-DD */
  date: string
  /** 최종공정에서 그 날짜에 등록된 ProductionResult.goodQty 합 */
  outputQty: number
}
