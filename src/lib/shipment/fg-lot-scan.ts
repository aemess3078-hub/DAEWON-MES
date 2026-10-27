/**
 * 출하예정 등록 화면 QR 스캔 → 완제품 LOT 선택 보조 로직 (순수 함수, 서버/DOM 비의존).
 *
 * QR 스캔은 "LOT 선택"만 돕는다. 이 모듈은 이미 화면에 있는 LOT 분할 행(기존 수동 선택과 같은 lotAllocations 구조)에
 * 어느 행에 반영할지만 정한다 — 수량을 정하지 않고, 서버 호출/재고 계산을 하지 않는다.
 */

/** 서버 조회가 거부하는 사유와 사용자 안내(서버 액션과 화면이 같은 문구를 쓴다). */
export type ShipmentLotLookupFailCode =
  | "UNAUTHORIZED"
  | "DENIED"
  | "INVALID"
  | "WAREHOUSE_NOT_FOUND"
  | "LOT_NOT_FOUND"
  | "NOT_FINISHED_GOODS"
  | "ITEM_MISMATCH"
  | "LOT_RESTRICTED"
  | "QUALITY_HOLD"
  | "OTHER_WAREHOUSE"
  | "NO_STOCK"
  | "AMBIGUOUS"

export const SHIPMENT_LOT_LOOKUP_MESSAGES: Record<ShipmentLotLookupFailCode, string> = {
  UNAUTHORIZED: "로그인이 필요합니다.",
  DENIED: "LOT 를 조회할 권한이 없습니다.",
  INVALID: "QR 의 LOT 번호가 올바르지 않습니다.",
  WAREHOUSE_NOT_FOUND: "출하 창고를 확인할 수 없습니다. 출하 창고를 다시 선택해 주세요.",
  LOT_NOT_FOUND: "등록되지 않은 LOT 이거나 이 화면에서 조회할 수 없는 LOT 입니다. LOT 번호를 확인하거나 목록에서 직접 선택해 주세요.",
  NOT_FINISHED_GOODS: "원자재·소모품 LOT 는 출하 대상이 아닙니다. 완제품 LOT 라벨의 QR 을 스캔해 주세요.",
  ITEM_MISMATCH: "이 출하 품목과 다른 품목의 LOT 입니다.",
  LOT_RESTRICTED: "사용이 제한된 LOT 입니다(격리·보류·소진·만료). 출하 대상으로 선택할 수 없습니다.",
  QUALITY_HOLD: "최종검사 결과로 출하가 제한된 LOT 입니다.",
  OTHER_WAREHOUSE: "선택한 출하 창고가 아닌 다른 창고에 있는 LOT 입니다. 이 LOT 를 출하하려면 해당 창고를 출하 창고로 선택해 주세요.",
  NO_STOCK: "선택한 출하 창고에 출하 가능한(가용·미예약) 재고가 없는 LOT 입니다.",
  AMBIGUOUS: "같은 LOT 의 재고가 여러 건이라 하나로 정할 수 없습니다. 목록에서 직접 선택해 주세요.",
}

/** 화면의 LOT 분할 행(shipmentLotAllocationSchema 와 같은 구조). */
export type LotAllocationLike = { lotId: string; qty: number }

export type ScannedLotPlan =
  /** 아직 LOT 를 고르지 않은 행에 채움 */
  | { outcome: "FILLED_EMPTY_ROW"; rowIndex: number; preserveQty: number | null }
  /** 모든 행에 LOT 가 이미 있어 새 행을 추가해 그 행에 채움 */
  | { outcome: "ADDED_ROW"; rowIndex: number; preserveQty: null }
  /** 같은 LOT 가 이미 선택되어 있어 변경하지 않음(서버·화면 모두 동일 LOT 중복을 거부한다) */
  | { outcome: "ALREADY_SELECTED"; rowIndex: number; preserveQty: null }

/**
 * 스캔한 LOT 를 기존 LOT 분할 행의 어디에 반영할지 정한다. 입력 배열은 바꾸지 않는다.
 *  - 이미 같은 LOT 가 있으면 변경 없음
 *  - LOT 가 비어 있는 첫 행이 있으면 그 행(그 행에 사용자가 이미 입력한 수량(>0)은 보존)
 *  - 없으면 새 행을 추가
 * 다른 행의 LOT/수량은 건드리지 않는다. 스캔한 LOT 의 재고를 출하 수량으로 확정하지 않는다.
 */
export function planScannedFgLot(allocations: ReadonlyArray<LotAllocationLike>, lotId: string): ScannedLotPlan {
  const existing = allocations.findIndex((row) => row.lotId === lotId)
  if (existing >= 0) return { outcome: "ALREADY_SELECTED", rowIndex: existing, preserveQty: null }
  const emptyIndex = allocations.findIndex((row) => !row.lotId)
  if (emptyIndex >= 0) {
    const typed = Number(allocations[emptyIndex].qty) || 0
    return { outcome: "FILLED_EMPTY_ROW", rowIndex: emptyIndex, preserveQty: typed > 0 ? typed : null }
  }
  return { outcome: "ADDED_ROW", rowIndex: allocations.length, preserveQty: null }
}

export type ScanTargetItem = { itemId: string; isLotTracked: boolean }

export type FgScanTargetCheck = { ok: true } | { ok: false; message: string }

/** 이 품목 행이 LOT 선택 대상(LOT 관리 품목)인지 확인한다. */
export function checkFgScanTarget(item: ScanTargetItem | null | undefined): FgScanTargetCheck {
  if (!item) return { ok: false, message: "출하 품목을 확인할 수 없습니다. 목록에서 직접 선택해 주세요." }
  if (!item.isLotTracked) return { ok: false, message: "LOT 관리 품목이 아니어서 LOT 선택 대상이 아닙니다. 출하수량을 직접 입력해 주세요." }
  return { ok: true }
}
