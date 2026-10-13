import { WipUnitStatus, WipMovementType } from "@prisma/client"

// ─── WIP 기반 완제품 입고 가능 수량 / 보류 사유 계산 헬퍼 ────────────────────
//
// 재공품재고 화면(getWipInventoryRows)과 완제품입고 검증(createFinishedGoodsReceiptAction)
// 양쪽에서 동일한 기준으로 입고 가능 수량을 산정하기 위한 공용 헬퍼.
//
// 산정 기준 (Phase 3-B-2):
//   - root WipUnit.qty (parentWipUnitId == null && sourceProductionResultId == null)
//   - 최종공정(seq 가장 큰 operation)에 COMPLETED 상태로 도달한 root 만 합산
//   - 기존 FinishedGoodsReceipt 누적 receiptQty 차감
//   - 보류 사유가 있으면 입고 가능 수량은 0
//
// 보류 사유 우선순위:
//   1) 미해결 REWORK child (status=REWORK, REWORK movement 로 연결됨)
//   2) 판별 불가 레거시 REWORK (reworkQty>0 인데 매칭 child 없음 / REWORK movement 의 relatedWipUnitId 비어있음)
//   3) 완료수량 비정합 (완료 root qty > 최종공정 completedQty)
//
// 이 헬퍼는 "use server" 가 아님 — 호출부 트랜잭션/쿼리 결과를 그대로 받아서 계산만 수행.

export const WIP_RECEIPT_BLOCK_REASONS = {
  // 재공품재고 화면용 — "보류 중" 톤
  UNRESOLVED_REWORK_DISPLAY: "미해결 재작업 분리 재공품이 있어 입고 보류 중입니다.",
  LEGACY_REWORK_DISPLAY:
    "종결 상태를 판별할 수 없는 기존 재작업 이력이 있어 입고 보류 중입니다.",
  INCONSISTENT_WIP_DISPLAY:
    "최종공정 완료 수량과 재공 수량이 맞지 않아 입고가 보류되었습니다.",

  // 완제품입고 검증용 — 운영자에게 보여줄 차단 에러 톤
  UNRESOLVED_REWORK_ERROR:
    "재작업 중인 재공품이 있어 완제품 입고를 진행할 수 없습니다.",
  LEGACY_REWORK_ERROR:
    "종결 상태를 판별할 수 없는 기존 재작업 이력이 있어 완제품 입고를 진행할 수 없습니다.",
  INCONSISTENT_WIP_ERROR:
    "최종공정 완료수량과 재공 수량이 일치하지 않아 완제품 입고를 진행할 수 없습니다.",
  FULLY_RECEIVED_ERROR: "이미 모든 완료 재공품이 입고되어 추가 입고가 불가합니다.",
  NO_AVAILABLE_QTY_ERROR: "입고 가능한 완료 재공품 수량이 부족합니다.",
  NO_COMPLETED_ROOT_ERROR:
    "완제품 입고 대상인 완료 재공품이 없습니다. 최종공정 완료 여부를 확인하세요.",
} as const

// ─── 입력/출력 타입 (호출부 쿼리 결과를 구조적 타이핑으로 수용) ───────────────

type WipReceiptOperationInput = {
  id: string
  seq: number
  completedQty: unknown
  productionResults: { id: string; reworkQty: unknown }[]
}

type WipReceiptWipUnitInput = {
  id: string
  workOrderOperationId: string
  parentWipUnitId: string | null
  sourceProductionResultId: string | null
  qty: unknown
  status: string
  // 호출부에서 movementType=REWORK 로 필터된 movement 리스트를 넘기거나
  // 전체 movement 를 넘겨도 됨 (헬퍼 내부에서 movementType==="REWORK" 재확인).
  movements: { movementType: string; relatedWipUnitId: string | null }[]
  // movementType=REWORK 로 필터된 relatedMovements (이 unit 을 가리키는 REWORK movement).
  relatedMovements: { id: string }[]
}

export type WipReceiptInput<TWipUnit extends WipReceiptWipUnitInput = WipReceiptWipUnitInput> = {
  operations: WipReceiptOperationInput[]
  finishedGoodsReceipts: { receiptQty: unknown }[]
  wipUnits: TWipUnit[]
}

export type WipReceiptStatus<TWipUnit extends WipReceiptWipUnitInput = WipReceiptWipUnitInput> = {
  /** 최종공정 (seq 가장 큰 operation) id */
  finalOperationId: string | null
  /** 최종공정 completedQty */
  finalOperationCompletedQty: number
  /** WipUnit 추적 작업지시 여부 (root WipUnit 1건 이상) */
  isWipTracked: boolean
  /** 최종공정 COMPLETED root 수량 합 */
  completedRootQty: number
  /** 기존 FinishedGoodsReceipt 누적 수량 */
  totalReceiptQty: number
  /** 추가 입고 가능 수량 (보류면 0) */
  availableReceiptQty: number
  hasUnresolvedReworkChild: boolean
  hasLegacyRework: boolean
  hasInconsistentCompletedWipQty: boolean
  /** 보류 여부 */
  blocked: boolean
  /** 재공품재고 화면용 보류 사유 (없으면 null) */
  blockReasonDisplay: string | null
  /** 완제품입고 검증용 차단 사유 (없으면 null) */
  blockReasonError: string | null
  /** 완제품입고 대상 root WipUnit 들 (status=COMPLETED && 최종공정) */
  completedRootWipUnits: TWipUnit[]
}

export function computeWipReceiptStatus<TWipUnit extends WipReceiptWipUnitInput>(
  input: WipReceiptInput<TWipUnit>,
): WipReceiptStatus<TWipUnit> {
  const totalReceiptQty = input.finishedGoodsReceipts.reduce(
    (sum, receipt) => sum + Number(receipt.receiptQty),
    0,
  )

  // 최종공정 = seq 가 가장 큰 operation
  const finalOperation = input.operations.reduce<WipReceiptOperationInput | null>(
    (latest, op) => (!latest || op.seq > latest.seq ? op : latest),
    null,
  )
  const finalOperationCompletedQty = Number(finalOperation?.completedQty ?? 0)

  const rootWipUnits = input.wipUnits.filter(
    (unit) =>
      unit.parentWipUnitId == null && unit.sourceProductionResultId == null,
  )
  const isWipTracked = rootWipUnits.length > 0

  // 완제품입고 대상 = ROOT && COMPLETED && 최종공정에 도달
  // (parent 있는 child / SCRAPPED / REWORK / IN_PROCESS / WAITING 모두 자연스럽게 제외)
  const completedRootWipUnits = rootWipUnits.filter(
    (unit) =>
      unit.status === WipUnitStatus.COMPLETED &&
      unit.workOrderOperationId === finalOperation?.id,
  )
  const completedRootQty = completedRootWipUnits.reduce(
    (sum, unit) => sum + Number(unit.qty),
    0,
  )

  // REWORK child = parent 있고 REWORK relatedMovement 로 연결된 WipUnit
  // (재공품재고 화면과 동일 기준)
  const reworkChildWipUnits = input.wipUnits.filter(
    (unit) => unit.parentWipUnitId != null && unit.relatedMovements.length > 0,
  )
  const linkedReworkProductionResultIds = new Set(
    reworkChildWipUnits
      .map((unit) => unit.sourceProductionResultId)
      .filter((id): id is string => id != null),
  )

  // 1) 미해결 REWORK child
  const hasUnresolvedReworkChild = reworkChildWipUnits.some(
    (unit) => unit.status === WipUnitStatus.REWORK,
  )

  // 2) 레거시 reworkQty: ProductionResult.reworkQty > 0 인데 매칭되는 REWORK child 가 없음
  const hasLegacyReworkResult = input.operations.some((op) =>
    op.productionResults.some(
      (result) =>
        Number(result.reworkQty) > 0 &&
        !linkedReworkProductionResultIds.has(result.id),
    ),
  )

  // 3) 레거시 REWORK movement: REWORK movement 인데 relatedWipUnitId 비어있음
  const hasUnlinkedReworkMovement = input.wipUnits.some((unit) =>
    unit.movements.some(
      (movement) =>
        movement.movementType === WipMovementType.REWORK &&
        movement.relatedWipUnitId == null,
    ),
  )
  const hasLegacyRework = hasLegacyReworkResult || hasUnlinkedReworkMovement

  // 4) 완료수량 비정합 (WIP 추적 작업지시에서만 의미 있음)
  const hasInconsistentCompletedWipQty =
    isWipTracked && completedRootQty > finalOperationCompletedQty

  const blockReasonDisplay = hasUnresolvedReworkChild
    ? WIP_RECEIPT_BLOCK_REASONS.UNRESOLVED_REWORK_DISPLAY
    : hasLegacyRework
      ? WIP_RECEIPT_BLOCK_REASONS.LEGACY_REWORK_DISPLAY
      : hasInconsistentCompletedWipQty
        ? WIP_RECEIPT_BLOCK_REASONS.INCONSISTENT_WIP_DISPLAY
        : null
  const blockReasonError = hasUnresolvedReworkChild
    ? WIP_RECEIPT_BLOCK_REASONS.UNRESOLVED_REWORK_ERROR
    : hasLegacyRework
      ? WIP_RECEIPT_BLOCK_REASONS.LEGACY_REWORK_ERROR
      : hasInconsistentCompletedWipQty
        ? WIP_RECEIPT_BLOCK_REASONS.INCONSISTENT_WIP_ERROR
        : null
  const blocked = blockReasonDisplay !== null
  const availableReceiptQty = blocked
    ? 0
    : Math.max(0, completedRootQty - totalReceiptQty)

  return {
    finalOperationId: finalOperation?.id ?? null,
    finalOperationCompletedQty,
    isWipTracked,
    completedRootQty,
    totalReceiptQty,
    availableReceiptQty,
    hasUnresolvedReworkChild,
    hasLegacyRework,
    hasInconsistentCompletedWipQty,
    blocked,
    blockReasonDisplay,
    blockReasonError,
    completedRootWipUnits,
  }
}
