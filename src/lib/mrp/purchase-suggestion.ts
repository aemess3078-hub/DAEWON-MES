/**
 * 수주기준 MRP 구매 발주제안 (순수 모듈 — DB/Prisma/현재 시각 비의존)
 *
 *   OrderMrpView(NORMAL, 예정입고 반영) + 공급업체 정책 + 현재 단가 ──> 발주제안 행
 *
 * 제안 유형
 *  - FINAL_SHORTAGE     : 확정 발주(예정입고)를 모두 반영해도 최종 예상재고가 0 미만. 자동 제안 대상.
 *  - TEMPORARY_SHORTAGE : 기간 중 결품이 있지만 기존 확정 발주의 후속 입고로 최종 예상재고는 0 이상.
 *                         새 PO 를 자동 제안하지 않는다(기존 PO 납기 당김/긴급조달 검토). suggestedQty 기본 0.
 *
 * 제안수량(suggestedQty) 의미 — "필요 입고일(결품예정일)까지 도착한다는 전제에서 전 기간 결품을 막는 최소 추가 공급량"
 *  - 시간축 잔량을 B(t) 라고 하면, 추가 공급 Q 가 최초 결품일에 (같은 날은 입고 → 수요) 도착할 때 모든 이후 잔량이 +Q 된다.
 *    따라서 전 기간 결품이 사라지는 최소 Q 는 -min B(t) = peakShortageQty 이다.
 *  - 기존 예정입고는 이미 B(t) 에 반영돼 있으므로 중복 공급되지 않는다(이미 들어올 물량은 제안량에서 빠진다).
 *  - finalShortageQty 만 사면(Q = final) 최종 잔량은 0 이 되지만, 후속 입고 전 구간의 일시 결품(peak > final)이 남는다.
 *    그 차이(peak − final)는 "새 공급이 필요 입고일까지 도착해야 한다"는 조건과 함께 화면에 설명한다.
 *  - 새 공급이 필요 입고일보다 늦게 도착하면 일시 결품이 남는다 — 리드타임 반영은 Phase 5D 범위이며 여기서는 계산하지 않는다.
 *  - MOQ / 발주배수 / 안전재고는 적용하지 않는다(Phase 5D).
 *
 * 공급업체 추천(ItemSupplier, ACTIVE 관계 + ACTIVE SUPPLIER/BOTH 거래처만 입력으로 받는다)
 *  1) isDefault  2) Default 가 없으면 priority 최소가 정확히 1개일 때  3) 동률이면 자동 선택하지 않음(AMBIGUOUS)
 *  4) 관계 없음 → NONE. "tenant 의 첫 공급업체"나 최근 PO 는 사용하지 않는다.
 */

import type { OrderMrpMaterialView, OrderMrpView } from "./order-mrp-adapter"
import type { DateOnly } from "./types"

export type SuggestionKind = "FINAL_SHORTAGE" | "TEMPORARY_SHORTAGE"

export type SupplierRecommendationReason = "DEFAULT" | "LOWEST_PRIORITY" | "AMBIGUOUS_PRIORITY" | "NONE"

export type SupplierCandidateInput = {
  supplierId: string
  supplierCode: string
  supplierName: string
  isDefault: boolean
  priority: number
  leadTimeDays: number | null
  moq: number | null
  orderMultiple: number | null
}

export type SupplierPrice = { unitPrice: number; currency: string; effectiveFrom: DateOnly }

export type SupplierChoice = SupplierCandidateInput & {
  /** 현재 유효한 구매단가(ItemPrice PURCHASE, 같은 공급업체). 없으면 null = 단가 미등록 */
  price: SupplierPrice | null
}

export type PurchaseSuggestionRow = {
  componentItemId: string
  code: string
  name: string
  spec: string | null
  uom: string
  kind: SuggestionKind
  qtyAvailable: number
  totalRequirement: number
  scheduledReceiptQty: number
  /** 시간축 최대 결품(= 새 공급이 필요 입고일에 도착할 때 전 기간 결품을 막는 필요량) */
  peakShortageQty: number
  /** 예정입고를 모두 반영한 최종 부족 */
  finalShortageQty: number
  /** 기본 제안량: FINAL_SHORTAGE = peakShortageQty, TEMPORARY_SHORTAGE = 0 */
  suggestedQty: number
  /** 결품예정일(= 최초 결품 수주 납기) = 필요 입고일. 없으면 사용자가 입력해야 한다 */
  requiredDate: DateOnly | null
  firstShortageOrderNo: string | null
  /** 일시 결품이 입고로 해소되는 일자 */
  shortageRecoveredAt: DateOnly | null
  nextReceiptDate: DateOnly | null
  recommendedSupplierId: string | null
  supplierReason: SupplierRecommendationReason
  suppliers: SupplierChoice[]
  /** 같은 자재의 DRAFT 발주 미입고 합계(참고용, MRP 재고에는 가산하지 않음) */
  draftOpenQty: number
}

function roundQty(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/** 공급업체 추천(순수). candidates 는 ACTIVE 관계 + 자격 있는 거래처만 전달한다. */
export function recommendSupplier(candidates: readonly SupplierCandidateInput[]): {
  supplierId: string | null
  reason: SupplierRecommendationReason
} {
  if (candidates.length === 0) return { supplierId: null, reason: "NONE" }
  const defaults = candidates.filter((c) => c.isDefault)
  if (defaults.length === 1) return { supplierId: defaults[0].supplierId, reason: "DEFAULT" }
  if (defaults.length > 1) {
    // 데이터 이상(Default 중복): 자동 선택하지 않고 사용자가 고르게 한다
    return { supplierId: null, reason: "AMBIGUOUS_PRIORITY" }
  }
  const min = Math.min(...candidates.map((c) => c.priority))
  const lowest = candidates.filter((c) => c.priority === min)
  if (lowest.length === 1) return { supplierId: lowest[0].supplierId, reason: "LOWEST_PRIORITY" }
  return { supplierId: null, reason: "AMBIGUOUS_PRIORITY" }
}

/** 제안 대상 판정: 최종 부족 → FINAL, 기간 중 결품 후 회복 → TEMPORARY, 그 외 제안 불필요(null) */
export function classifySuggestion(m: Pick<OrderMrpMaterialView, "shortageQty" | "temporaryShortage">): SuggestionKind | null {
  if (m.shortageQty > 0) return "FINAL_SHORTAGE"
  if (m.temporaryShortage) return "TEMPORARY_SHORTAGE"
  return null
}

export type BuildSuggestionArgs = {
  view: OrderMrpView
  /** itemId → 공급업체 후보(ACTIVE) */
  suppliersByItem: ReadonlyMap<string, readonly SupplierCandidateInput[]>
  /** `${itemId}|${supplierId}` → 현재 단가 */
  prices: ReadonlyMap<string, SupplierPrice>
  /** itemId → DRAFT 발주 미입고 합계(참고) */
  draftOpenQty: ReadonlyMap<string, number>
}

export function priceKey(itemId: string, supplierId: string): string {
  return `${itemId}|${supplierId}`
}

export function buildPurchaseSuggestionRows(args: BuildSuggestionArgs): PurchaseSuggestionRow[] {
  const rows: PurchaseSuggestionRow[] = []
  for (const m of args.view.materials) {
    const kind = classifySuggestion(m)
    if (kind === null) continue
    const candidates = args.suppliersByItem.get(m.componentItemId) ?? []
    const rec = recommendSupplier(candidates)
    const sortedCandidates = [...candidates].sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        a.priority - b.priority ||
        (a.supplierCode < b.supplierCode ? -1 : a.supplierCode > b.supplierCode ? 1 : 0)
    )
    const peak = roundQty(m.peakShortageQty)
    rows.push({
      componentItemId: m.componentItemId,
      code: m.code,
      name: m.name,
      spec: m.spec,
      uom: m.uom,
      kind,
      qtyAvailable: m.qtyAvailable,
      totalRequirement: m.totalRequirement,
      scheduledReceiptQty: m.scheduledReceiptQty,
      peakShortageQty: peak,
      finalShortageQty: roundQty(m.shortageQty),
      suggestedQty: kind === "FINAL_SHORTAGE" ? peak : 0,
      requiredDate: m.firstShortageDate,
      firstShortageOrderNo: m.firstShortageOrderNo,
      shortageRecoveredAt: m.shortageRecoveredAt,
      nextReceiptDate: m.nextReceiptDate,
      recommendedSupplierId: rec.supplierId,
      supplierReason: rec.reason,
      suppliers: sortedCandidates.map((c) => ({ ...c, price: args.prices.get(priceKey(m.componentItemId, c.supplierId)) ?? null })),
      draftOpenQty: roundQty(args.draftOpenQty.get(m.componentItemId) ?? 0),
    })
  }
  // 최종 부족 먼저(필요일 빠른 순, 날짜 없음은 뒤) → 일시 결품, 같으면 자재코드
  rows.sort((a, b) => {
    const ka = a.kind === "FINAL_SHORTAGE" ? 0 : 1
    const kb = b.kind === "FINAL_SHORTAGE" ? 0 : 1
    if (ka !== kb) return ka - kb
    const da = a.requiredDate ?? "9999-12-31"
    const db = b.requiredDate ?? "9999-12-31"
    if (da !== db) return da < db ? -1 : 1
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0
  })
  return rows
}
