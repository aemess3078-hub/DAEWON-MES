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
// 재작업(ISSUE-013): 미해결 REWORK child 는 입고 전체를 막지 않는다.
//   - 재작업 대상 수량은 SPLIT 으로 root 에서 이미 빠져 있어(root.qty 미포함) 입고 대상이 아니다 → 별도 보류(reworkHoldQty).
//   - 재작업 종결(completeRework) 시 양품 복귀분은 root.qty 에 MERGE 되어 추가 입고 가능 수량으로 늘어나고,
//     폐기분은 child 가 SCRAP 처리되어 입고 대상에서 제외된다. 이미 입고한 수량은 totalReceiptQty 로 차감해 중복 입고를 막는다.
//
// 보류 사유(전체 차단) — 기존 조건 유지:
//   1) 판별 불가 레거시 REWORK (reworkQty>0 인데 매칭 child 없음 / REWORK movement 의 relatedWipUnitId 비어있음)
//   2) 완료수량 비정합 (완료 root qty > 최종공정 completedQty + 재작업 양품 복귀분)
//
// 이 헬퍼는 "use server" 가 아님 — 호출부 트랜잭션/쿼리 결과를 그대로 받아서 계산만 수행.

export const WIP_RECEIPT_BLOCK_REASONS = {
  // 재공품재고 화면용 — "보류 중" 톤
  UNRESOLVED_REWORK_DISPLAY: "미해결 재작업 분리 재공품이 있어 입고 보류 중입니다.", // (전체 차단 아님 — 재작업 수량만 보류 안내용)
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
  // MERGE(재작업 양품 복귀) movement 는 qty/sourceType 를 함께 넘겨야 복귀 수량이 완료수량 비정합 판정에 반영된다.
  movements: { movementType: string; relatedWipUnitId: string | null; qty?: unknown; sourceType?: string | null }[]
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
  /** 재작업 중(REWORK child)이라 입고 대상에서 보류된 수량 */
  reworkHoldQty: number
  /** 재작업 종결로 root 에 복귀(MERGE)한 양품 수량 누계 */
  reworkReturnedQty: number
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

  // 재작업 보류 수량(REWORK child) / 재작업 종결로 root 에 복귀한 양품 수량
  const reworkHoldQty = reworkChildWipUnits
    .filter((unit) => unit.status === WipUnitStatus.REWORK)
    .reduce((sum, unit) => sum + Number(unit.qty), 0)
  const reworkReturnedQty = rootWipUnits.reduce(
    (sum, unit) =>
      sum +
      unit.movements
        .filter((m) => m.movementType === WipMovementType.MERGE && m.sourceType === "ReworkCompletion")
        .reduce((s, m) => s + Number(m.qty ?? 0), 0),
    0,
  )

  // 4) 완료수량 비정합 (WIP 추적 작업지시에서만 의미 있음)
  //    최종공정 completedQty 는 재작업 복귀 양품을 포함하지 않으므로 복귀분만큼 허용한다.
  const hasInconsistentCompletedWipQty =
    isWipTracked && completedRootQty > finalOperationCompletedQty + reworkReturnedQty + 0.000001

  // 미해결 REWORK child 는 더 이상 전체 차단 사유가 아니다(재작업 수량만 보류).
  const blockReasonDisplay = hasLegacyRework
    ? WIP_RECEIPT_BLOCK_REASONS.LEGACY_REWORK_DISPLAY
    : hasInconsistentCompletedWipQty
      ? WIP_RECEIPT_BLOCK_REASONS.INCONSISTENT_WIP_DISPLAY
      : null
  const blockReasonError = hasLegacyRework
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
    reworkHoldQty,
    reworkReturnedQty,
    hasLegacyRework,
    hasInconsistentCompletedWipQty,
    blocked,
    blockReasonDisplay,
    blockReasonError,
    completedRootWipUnits,
  }
}
