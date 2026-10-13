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
 * Phase 5D — 안전재고 / 구매조건 (물리 재고 계산은 바꾸지 않는다)
 *  - 안전재고(Item.safetyStock)는 openingStock 에서 빼지 않는다. "예상 잔량이 유지해야 하는 목표 하한"으로만 쓴다.
 *      finalTargetDeficit = max(0, safety − finalBalance)      (현재 예정입고까지 반영한 최종 미달)
 *      peakTargetDeficit  = max(0, safety − minProjectedBalance) (시간축에서 하한을 지키려면 필요한 최대 보충량)
 *  - A) finalTargetDeficit > 0 → 신규 보충 필요(자동 제안, 기본 제안량 = peakTargetDeficit)
 *    B) final = 0 이고 peak > 0 → 중간에만 미달, 기존 확정 입고로 회복: 자동 제안 0(납기 당김/긴급조달 검토)
 *    C) 둘 다 0 → 제안 불필요
 *  - safety = 0 이면 5C 결과와 동일하다(final = 최종 부족, peak = 최대 결품, 필요일 = 최초 결품일).
 *  - 필요 입고일 = 최초 안전재고 침범일(opening 이 이미 미달이면 기준일, IMMEDIATE). safety = 0 이면 최초 결품일.
 *  - 공급업체 구매조건: 필요량 → MOQ → 발주배수 올림(purchase-policy.ts). 발주 필요일 = 필요 입고일 − 리드타임(달력일).
 *
 * 공급업체 추천(ItemSupplier, ACTIVE 관계 + ACTIVE SUPPLIER/BOTH 거래처만 입력으로 받는다)
 *  1) isDefault  2) Default 가 없으면 priority 최소가 정확히 1개일 때  3) 동률이면 자동 선택하지 않음(AMBIGUOUS)
 *  4) 관계 없음 → NONE. "tenant 의 첫 공급업체"나 최근 PO 는 사용하지 않는다.
 */

import type { OrderMrpMaterialView, OrderMrpView } from "./order-mrp-adapter"
import { applySupplierTerms, evaluateOrderTiming, type OrderTiming } from "./purchase-policy"
import type { DateOnly } from "./types"

/**
 * FINAL_SHORTAGE          : 예정입고 반영 후에도 물리 재고 부족(최종 예상재고 < 0)
 * SAFETY_STOCK_SHORTAGE   : 물리 부족은 없지만 최종 예상재고가 안전재고 미만
 * TEMPORARY_SHORTAGE      : 기간 중 물리 결품 후 기존 확정 입고로 회복(자동 제안 없음)
 * SAFETY_STOCK_TEMPORARY  : 기간 중 안전재고 일시 미달 후 회복(자동 제안 없음)
 */
export type SuggestionKind =
  | "FINAL_SHORTAGE"
  | "SAFETY_STOCK_SHORTAGE"
  | "TEMPORARY_SHORTAGE"
  | "SAFETY_STOCK_TEMPORARY"

export const AUTO_SUGGEST_KINDS: readonly SuggestionKind[] = ["FINAL_SHORTAGE", "SAFETY_STOCK_SHORTAGE"]

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

/** Phase 5D 정책 필드(5C 의 PurchaseSuggestionRow 에 더해지는 안전재고 / 구매조건 / 발주 필요일 정보) */
export type PolicyFields = {
  /** 품목 안전재고(목표 하한). 물리 재고를 차감하지 않는다 */
  safetyStock: number
  /** 시작 가용재고(= qtyAvailable) */
  openingStock: number
  /** 예정입고까지 반영한 최종 예상재고 */
  finalBalance: number
  /** 시간축 최저 예상재고(opening 포함) */
  minProjectedBalance: number
  /** max(0, safety − finalBalance): 현재 확정 입고를 모두 반영한 최종 안전재고 미달 */
  finalTargetDeficit: number
  /** max(0, safety − minProjectedBalance): 전 시간축에서 하한을 지키는 데 필요한 최대 보충량 */
  peakTargetDeficit: number
  /** 구매조건 적용 전 정책상 필요량: 자동 제안 유형 = peakTargetDeficit, 그 외 0 */
  rawSuggestedQty: number
  /** 최초 안전재고(안전재고 0 이면 결품) 침범 시점. IMMEDIATE = 시작 재고가 이미 미달(기준일) */
  breachKind: "NONE" | "IMMEDIATE" | "DEMAND" | "SHORTAGE"
  /** 침범을 일으키는 수주(DEMAND/SHORTAGE 일 때) */
  firstBreachOrderNo: string | null
  /** 추천 공급업체 기준 구매조건/타이밍 (공급업체 변경 시 화면이 같은 순수 함수로 다시 계산한다) */
  leadTimeDays: number | null
  moq: number | null
  orderMultiple: number | null
  moqApplied: boolean
  multipleApplied: boolean
  /** 구매조건 데이터 오류(MOQ/배수 0 이하 등) — 조건을 적용하지 못했다 */
  termsInvalid: boolean
  /** 발주 필요일(= 필요 입고일 − 리드타임). 리드타임 미등록이면 null */
  orderByDate: DateOnly | null
  orderTiming: OrderTiming["status"]
  /** 발주 필요일 경과 일수(OVERDUE 일 때) */
  orderOverdueDays: number
  /** 예정입고 기준일(KST 오늘) */
  baseDate: DateOnly | null
}

/** 5C 행 + Phase 5D 정책 필드 */
export type PurchaseSuggestionLine = PurchaseSuggestionRow & PolicyFields

/** 제안 대상 판정(Phase 5D): 안전재고 목표 하한 기준. kind=null → 제안 불필요 */
export function classifyByPolicy(args: {
  safetyStock: number
  finalBalance: number
  minProjectedBalance: number
}): { kind: SuggestionKind | null; finalTargetDeficit: number; peakTargetDeficit: number } {
  const finalTargetDeficit = roundQty(Math.max(0, args.safetyStock - args.finalBalance))
  const peakTargetDeficit = roundQty(Math.max(0, args.safetyStock - args.minProjectedBalance))
  let kind: SuggestionKind | null = null
  if (finalTargetDeficit > 0) {
    kind = args.finalBalance < 0 ? "FINAL_SHORTAGE" : "SAFETY_STOCK_SHORTAGE"
  } else if (peakTargetDeficit > 0) {
    kind = args.minProjectedBalance < 0 ? "TEMPORARY_SHORTAGE" : "SAFETY_STOCK_TEMPORARY"
  }
  return { kind, finalTargetDeficit, peakTargetDeficit }
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

/** 자재의 시간축 최저 예상재고 = min(시작 재고, 모든 수요 단계 이후 잔량). 입고는 잔량을 올리기만 하므로 최저점이 될 수 없다. */
export function minProjectedBalanceOf(m: Pick<OrderMrpMaterialView, "qtyAvailable" | "steps">): number {
  let min = m.qtyAvailable
  for (const s of m.steps) if (s.balanceAfter < min) min = s.balanceAfter
  return min
}

export function buildPurchaseSuggestionRows(args: BuildSuggestionArgs): PurchaseSuggestionLine[] {
  const rows: PurchaseSuggestionLine[] = []
  const baseDate = args.view.scheduledReceipts.baseDate
  for (const m of args.view.materials) {
    const safety = m.safetyStock !== undefined && Number.isFinite(m.safetyStock) && m.safetyStock > 0 ? m.safetyStock : 0
    const minBalance = minProjectedBalanceOf(m)
    const cls = classifyByPolicy({ safetyStock: safety, finalBalance: m.finalBalance, minProjectedBalance: minBalance })
    if (cls.kind === null) continue
    const kind = cls.kind
    const auto = AUTO_SUGGEST_KINDS.includes(kind)

    // 필요 입고일(최초 침범 시점)
    let breachKind: PolicyFields["breachKind"] = "NONE"
    let requiredDate: DateOnly | null = null
    let breachOrderNo: string | null = null
    if (safety === 0) {
      // 5C 와 동일: 최초 결품일
      breachKind = "SHORTAGE"
      requiredDate = m.firstShortageDate
      breachOrderNo = m.firstShortageOrderNo
    } else if (m.qtyAvailable < safety) {
      breachKind = "IMMEDIATE"
      requiredDate = baseDate
    } else {
      const step = m.steps.find((st) => st.balanceAfter < safety)
      if (step) {
        breachKind = "DEMAND"
        requiredDate = step.deliveryDate
        breachOrderNo = step.orderNo
      }
    }

    const candidates = args.suppliersByItem.get(m.componentItemId) ?? []
    const rec = recommendSupplier(candidates)
    const sortedCandidates = [...candidates].sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        a.priority - b.priority ||
        (a.supplierCode < b.supplierCode ? -1 : a.supplierCode > b.supplierCode ? 1 : 0)
    )
    const recommended = rec.supplierId ? sortedCandidates.find((c) => c.supplierId === rec.supplierId) ?? null : null

    const rawQty = auto ? cls.peakTargetDeficit : 0
    let suggestedQty = rawQty
    let moqApplied = false
    let multipleApplied = false
    let termsInvalid = false
    if (recommended && rawQty > 0) {
      const applied = applySupplierTerms(rawQty, { moq: recommended.moq, orderMultiple: recommended.orderMultiple })
      if (applied.ok) {
        suggestedQty = applied.qty
        moqApplied = applied.moqApplied
        multipleApplied = applied.multipleApplied
      } else {
        termsInvalid = true
      }
    }
    const timing = evaluateOrderTiming(requiredDate, recommended?.leadTimeDays ?? null, baseDate)

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
      // 물리 결품 지표(5C 와 같은 의미): 안전재고와 무관
      peakShortageQty: roundQty(m.peakShortageQty),
      finalShortageQty: roundQty(m.shortageQty),
      suggestedQty,
      requiredDate,
      firstShortageOrderNo: m.firstShortageOrderNo,
      shortageRecoveredAt: m.shortageRecoveredAt,
      nextReceiptDate: m.nextReceiptDate,
      recommendedSupplierId: rec.supplierId,
      supplierReason: rec.reason,
      suppliers: sortedCandidates.map((c) => ({ ...c, price: args.prices.get(priceKey(m.componentItemId, c.supplierId)) ?? null })),
      draftOpenQty: roundQty(args.draftOpenQty.get(m.componentItemId) ?? 0),
      // Phase 5D
      safetyStock: safety,
      openingStock: m.qtyAvailable,
      finalBalance: m.finalBalance,
      minProjectedBalance: roundQty(minBalance),
      finalTargetDeficit: cls.finalTargetDeficit,
      peakTargetDeficit: cls.peakTargetDeficit,
      rawSuggestedQty: rawQty,
      breachKind,
      firstBreachOrderNo: breachOrderNo,
      leadTimeDays: recommended?.leadTimeDays ?? null,
      moq: recommended?.moq ?? null,
      orderMultiple: recommended?.orderMultiple ?? null,
      moqApplied,
      multipleApplied,
      termsInvalid,
      orderByDate: timing.status === "OVERDUE" || timing.status === "DUE_TODAY" || timing.status === "OK" ? timing.orderByDate : null,
      orderTiming: timing.status,
      orderOverdueDays: timing.status === "OVERDUE" ? timing.overdueDays : 0,
      baseDate,
    })
  }
  // 자동 제안 대상(최종 부족/안전재고 부족) 먼저(필요일 빠른 순, 날짜 없음은 뒤) → 일시 미달·결품, 같으면 자재코드
  rows.sort((a, b) => {
    const ka = AUTO_SUGGEST_KINDS.includes(a.kind) ? 0 : 1
    const kb = AUTO_SUGGEST_KINDS.includes(b.kind) ? 0 : 1
    if (ka !== kb) return ka - kb
    const da = a.requiredDate ?? "9999-12-31"
    const db = b.requiredDate ?? "9999-12-31"
    if (da !== db) return da < db ? -1 : 1
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0
  })
  return rows
}

/**
 * 선택한 공급업체 기준 구매조건/타이밍 재계산 (순수 — 서버 추천값과 화면 공급업체 변경이 같은 함수를 쓴다)
 *  - 다른 공급업체의 MOQ/배수/리드타임/단가를 섞지 않는다: 전달한 supplier 의 값만 사용한다.
 *  - 공급업체가 없으면 구매조건 없이 정책상 필요량(raw)을 그대로 돌려준다.
 */
export function deriveForSupplier(
  line: Pick<PolicyFields, "rawSuggestedQty" | "baseDate"> & { requiredDate: DateOnly | null },
  supplier: SupplierChoice | null
): {
  qty: number
  qtyAfterMoq: number
  moqApplied: boolean
  multipleApplied: boolean
  termsInvalid: boolean
  timing: OrderTiming
  price: SupplierPrice | null
} {
  const raw = line.rawSuggestedQty
  let qty = raw
  let qtyAfterMoq = raw
  let moqApplied = false
  let multipleApplied = false
  let termsInvalid = false
  if (supplier && raw > 0) {
    const applied = applySupplierTerms(raw, { moq: supplier.moq, orderMultiple: supplier.orderMultiple })
    if (applied.ok) {
      qty = applied.qty
      qtyAfterMoq = applied.qtyAfterMoq
      moqApplied = applied.moqApplied
      multipleApplied = applied.multipleApplied
    } else {
      termsInvalid = true
    }
  }
  return {
    qty,
    qtyAfterMoq,
    moqApplied,
    multipleApplied,
    termsInvalid,
    timing: evaluateOrderTiming(line.requiredDate, supplier?.leadTimeDays ?? null, line.baseDate),
    price: supplier?.price ?? null,
  }
}
