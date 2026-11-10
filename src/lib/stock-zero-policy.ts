// 재고 0 표시 정책 — 재고현황/자재재고현황 공통.
// 현재고가 정확히 0인 LOT·창고별 재고 행은 기본적으로 숨기고(includeZero=false),
// 품목 합계·LOT 개수·창고 개수는 보이는 행 기준으로 다시 계산한다.
// 음수 재고는 이상 징후이므로 숨기지 않는다. 원본 데이터(LOT/수불 이력)는 변경하지 않는다.

type StockRow = {
  qtyOnHand: number
  qtyAvailable: number
  qtyHold: number
  lotId: string | null
  warehouseId: string
}

type StockGroup = {
  isLotTracked: boolean
  totalQtyOnHand: number
  totalQtyAvailable: number
  totalQtyHold: number
  lotCount: number
  warehouseCount: number
  hasUnlottedStock: boolean
}

export function isZeroStockRow(row: { qtyOnHand: number }): boolean {
  return row.qtyOnHand === 0
}

/** 한 품목의 행 목록을 정책에 맞게 걸러 합계/개수를 재계산한다. 보이는 행이 없으면 null. */
export function applyZeroStockPolicyToGroup<R extends StockRow, G extends StockGroup>(
  group: G,
  rows: R[],
  includeZero: boolean,
): { group: G; rows: R[] } | null {
  const visible = includeZero ? rows : rows.filter((r) => !isZeroStockRow(r))
  if (visible.length === 0) return null
  const lotIds = new Set(visible.filter((r) => r.lotId).map((r) => r.lotId as string))
  const warehouseIds = new Set(visible.map((r) => r.warehouseId))
  return {
    rows: visible,
    group: {
      ...group,
      totalQtyOnHand: visible.reduce((s, r) => s + r.qtyOnHand, 0),
      totalQtyAvailable: visible.reduce((s, r) => s + r.qtyAvailable, 0),
      totalQtyHold: visible.reduce((s, r) => s + r.qtyHold, 0),
      lotCount: lotIds.size,
      warehouseCount: warehouseIds.size,
      hasUnlottedStock: group.isLotTracked && visible.some((r) => !r.lotId && r.qtyOnHand > 0),
    },
  }
}
