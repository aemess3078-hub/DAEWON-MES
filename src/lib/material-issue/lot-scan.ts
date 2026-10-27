/**
 * 자재출고 화면 QR 스캔 → LOT 선택 보조 로직 (순수 함수, 서버/DOM 비의존).
 *
 * QR 스캔은 "LOT 선택"만 돕는다. 이 모듈은 이미 화면에 있는 LOT 분할 행(기존 수동 선택과 같은 데이터 구조)에
 * 선택 결과를 반영하는 규칙만 가진다 — 수량을 정하지 않고, 서버 호출/재고 계산을 하지 않는다.
 */

/** 서버 조회가 거부하는 사유와 사용자 안내(서버 액션과 화면이 같은 문구를 쓴다). */
export type IssueLotLookupFailCode =
  | "UNAUTHORIZED"
  | "DENIED"
  | "INVALID"
  | "WORK_ORDER_NOT_FOUND"
  | "LOT_NOT_FOUND"
  | "NOT_BOM_MATERIAL"
  | "LOT_RESTRICTED"
  | "LOT_EXPIRED"
  | "NO_STOCK"

export const ISSUE_LOT_LOOKUP_MESSAGES: Record<IssueLotLookupFailCode, string> = {
  UNAUTHORIZED: "로그인이 필요합니다.",
  DENIED: "LOT 를 조회할 권한이 없습니다.",
  INVALID: "QR 의 LOT 번호가 올바르지 않습니다.",
  WORK_ORDER_NOT_FOUND: "작업지시를 찾을 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
  LOT_NOT_FOUND: "등록되지 않은 LOT 이거나 이 화면에서 조회할 수 없는 LOT 입니다. LOT 번호를 확인하거나 목록에서 직접 선택해 주세요.",
  NOT_BOM_MATERIAL: "이 작업지시의 출고 대상 자재(BOM 구성품)가 아닌 LOT 입니다.",
  LOT_RESTRICTED: "사용이 제한된 LOT 입니다(격리·보류·소진). 출고 대상으로 선택할 수 없습니다.",
  LOT_EXPIRED: "유효기간이 만료된 LOT 입니다. 출고 대상으로 선택할 수 없습니다.",
  NO_STOCK: "출고 가능한 재고가 없는 LOT 입니다.",
}

/** 자재출고 화면의 LOT 분할 행(issue-form-dialog.tsx 의 LotSplitRow 와 같은 구조). */
export type LotSplitRowLike = { key: string; lotValue: string; qty: string }

/** 수동 선택 UI 의 LOT 선택 값과 같은 형식: "lotId:warehouseId". */
export function lotSelectValue(option: { lotId: string; warehouseId: string }): string {
  return `${option.lotId}:${option.warehouseId}`
}

export type ApplyScannedLotOutcome =
  /** 아직 LOT 를 고르지 않은 행에 채움(그 행의 기존 출고수량 입력은 그대로 유지) */
  | "FILLED_EMPTY_ROW"
  /** 모든 행에 LOT 가 이미 있어 새 행을 추가(수량은 비워 둠 — 사용자가 입력) */
  | "ADDED_ROW"
  /** 같은 LOT(다른 창고 포함)가 이미 선택되어 있어 변경하지 않음(서버도 동일 LOT 중복을 거부한다) */
  | "ALREADY_SELECTED"

/**
 * 스캔한 LOT 를 기존 LOT 분할 행에 반영한다. 기존 행/수량/다른 LOT 선택은 건드리지 않는다.
 * 출고 수량은 정하지 않는다(스캔한 LOT 의 재고를 출고 수량으로 자동 확정하지 않는다).
 */
export function applyScannedLot(
  splits: LotSplitRowLike[],
  option: { lotId: string; warehouseId: string },
  makeKey: () => string,
): { splits: LotSplitRowLike[]; outcome: ApplyScannedLotOutcome } {
  const value = lotSelectValue(option)
  // 같은 LOT 는 창고가 달라도 한 자재 안에서 1회만 허용(기존 서버 검증과 동일)
  if (splits.some((row) => row.lotValue === value || row.lotValue.startsWith(`${option.lotId}:`))) {
    return { splits, outcome: "ALREADY_SELECTED" }
  }
  const emptyIndex = splits.findIndex((row) => !row.lotValue)
  if (emptyIndex >= 0) {
    return { splits: splits.map((row, i) => (i === emptyIndex ? { ...row, lotValue: value } : row)), outcome: "FILLED_EMPTY_ROW" }
  }
  return { splits: [...splits, { key: makeKey(), lotValue: value, qty: "" }], outcome: "ADDED_ROW" }
}

export type ScanTargetMaterial = { itemId: string; pendingQty: number; lotManaged: boolean }

export type ScanTargetCheck =
  | { ok: true }
  | { ok: false; reason: "NOT_IN_LIST" | "ALREADY_FULLY_ISSUED" | "NOT_LOT_MANAGED"; message: string }

/**
 * 서버가 확인한 품목이 이 화면의 출고 자재 목록에서 "지금 LOT 를 고를 수 있는" 자재인지 확인한다.
 * @param allMaterials 작업지시의 전체 자재(필요수량을 모두 출고한 자재 포함)
 */
export function checkScanTarget(allMaterials: ScanTargetMaterial[], itemId: string): ScanTargetCheck {
  const material = allMaterials.find((m) => m.itemId === itemId)
  if (!material) {
    return { ok: false, reason: "NOT_IN_LIST", message: "이 작업지시의 출고 자재 목록에 없는 품목의 LOT 입니다." }
  }
  if (!material.lotManaged) {
    return { ok: false, reason: "NOT_LOT_MANAGED", message: "LOT 관리 품목이 아니어서 LOT 선택 대상이 아닙니다. 창고와 수량을 직접 입력해 주세요." }
  }
  if (!(material.pendingQty > 0)) {
    return { ok: false, reason: "ALREADY_FULLY_ISSUED", message: "이 자재는 필요수량이 이미 모두 출고되어 더 선택할 수 없습니다." }
  }
  return { ok: true }
}
