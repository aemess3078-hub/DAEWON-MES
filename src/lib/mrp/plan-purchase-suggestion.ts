/**
 * 생산계획 MRP 구매 발주제안 행 빌더 (순수 모듈 — DB/Prisma/현재 시각 비의존)
 *
 *   생산계획 MRP 결과(기존 계산 로직 그대로: 총소요량 − 가용재고 − 발주중 = 순소요량) + 공급업체 정책 + 단가 + DRAFT Coverage
 *   ──> 수주기준 MRP 와 같은 PurchaseSuggestionLine 행
 *
 * 같은 행 모델을 쓰므로 수주기준 MRP 와 같은 화면/검증/서버 발주 파이프라인(MOQ·발주배수·DRAFT Coverage·멱등)을 그대로 쓴다.
 *  - rawSuggestedQty = 순소요량(구매조건 적용 전 정책 필요량). 안전재고는 기존 생산계획 MRP 계산에 없으므로 0 으로 둔다.
 *  - 필요 입고일 = 생산계획 시작일(이미 지났으면 기준일). 발주 필요일 = 필요 입고일 − 리드타임.
 *  - DRAFT 는 확정 공급이 아니므로 재고/발주중에 더하지 않고 필요량에서만 따로 뺀다(수주기준과 같은 규칙) → 같은 자재를 어느 MRP 에서 만들었든
 *    품목 전체 DRAFT Coverage 로 중복 발주가 막힌다.
 */

import { emptyItemCoverage, evaluateCoverage, type ItemDraftCoverage } from "./draft-coverage"
import { applySupplierTerms, evaluateOrderTiming } from "./purchase-policy"
import {
  priceKey,
  recommendSupplier,
  type PurchaseSuggestionLine,
  type SupplierCandidateInput,
  type SupplierPrice,
} from "./purchase-suggestion"
import type { DateOnly } from "./types"

export type PlanMrpMaterial = {
  itemId: string
  itemCode: string
  itemName: string
  uom: string
  grossRequirement: number
  currentStock: number
  availableStock: number
  onOrder: number
  netRequirement: number
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

export function buildPlanPurchaseSuggestionRows(args: {
  materials: readonly PlanMrpMaterial[]
  /** 생산계획 시작일 */
  planStartDate: DateOnly
  /** 오늘(KST) */
  baseDate: DateOnly
  suppliersByItem: ReadonlyMap<string, readonly SupplierCandidateInput[]>
  prices: ReadonlyMap<string, SupplierPrice>
  draftCoverage: ReadonlyMap<string, ItemDraftCoverage>
}): PurchaseSuggestionLine[] {
  const rows: PurchaseSuggestionLine[] = []
  const requiredDate: DateOnly = args.planStartDate < args.baseDate ? args.baseDate : args.planStartDate
  for (const m of args.materials) {
    const net = Number.isFinite(m.netRequirement) ? m.netRequirement : 0
    if (!(net > 0)) continue
    const rawQty = round6(net)

    const candidates = args.suppliersByItem.get(m.itemId) ?? []
    const rec = recommendSupplier(candidates)
    const sorted = [...candidates].sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        a.priority - b.priority ||
        (a.supplierCode < b.supplierCode ? -1 : a.supplierCode > b.supplierCode ? 1 : 0)
    )
    const recommended = rec.supplierId ? sorted.find((c) => c.supplierId === rec.supplierId) ?? null : null

    let suggestedQty = rawQty
    let moqApplied = false
    let multipleApplied = false
    let termsInvalid = false
    if (recommended) {
      const applied = applySupplierTerms(rawQty, { moq: recommended.moq, orderMultiple: recommended.orderMultiple })
      if (applied.ok) {
        suggestedQty = applied.qty
        moqApplied = applied.moqApplied
        multipleApplied = applied.multipleApplied
      } else {
        termsInvalid = true
      }
    }
    const timing = evaluateOrderTiming(requiredDate, recommended?.leadTimeDays ?? null, args.baseDate)

    const coverage: ItemDraftCoverage = args.draftCoverage.get(m.itemId) ?? emptyItemCoverage()
    const ev = evaluateCoverage({
      rawNeed: rawQty,
      coverageQty: coverage.total,
      supplier: recommended ? { moq: recommended.moq, orderMultiple: recommended.orderMultiple } : null,
    })

    rows.push({
      componentItemId: m.itemId,
      code: m.itemCode,
      name: m.itemName,
      spec: null,
      uom: m.uom,
      kind: "FINAL_SHORTAGE",
      qtyAvailable: m.availableStock,
      totalRequirement: m.grossRequirement,
      scheduledReceiptQty: m.onOrder,
      peakShortageQty: rawQty,
      finalShortageQty: rawQty,
      suggestedQty,
      requiredDate,
      firstShortageOrderNo: null,
      shortageRecoveredAt: null,
      nextReceiptDate: null,
      recommendedSupplierId: rec.supplierId,
      supplierReason: rec.reason,
      suppliers: sorted.map((c) => ({ ...c, price: args.prices.get(priceKey(m.itemId, c.supplierId)) ?? null })),
      draftOpenQty: round6(coverage.total),
      safetyStock: 0,
      openingStock: m.availableStock,
      finalBalance: round6(-net),
      minProjectedBalance: round6(-net),
      finalTargetDeficit: rawQty,
      peakTargetDeficit: rawQty,
      rawSuggestedQty: rawQty,
      breachKind: "SHORTAGE",
      firstBreachOrderNo: null,
      leadTimeDays: recommended?.leadTimeDays ?? null,
      moq: recommended?.moq ?? null,
      orderMultiple: recommended?.orderMultiple ?? null,
      moqApplied,
      multipleApplied,
      termsInvalid,
      orderByDate: timing.status === "OVERDUE" || timing.status === "DUE_TODAY" || timing.status === "OK" ? timing.orderByDate : null,
      orderTiming: timing.status,
      orderOverdueDays: timing.status === "OVERDUE" ? timing.overdueDays : 0,
      baseDate: args.baseDate,
      draftCoverageQty: coverage.total,
      draftCoverageBySupplier: coverage.bySupplier,
      draftOrders: coverage.orders,
      draftOrderCount: coverage.orderCount,
      remainingRawNeed: ev.remainingRawNeed,
      additionalQty: ev.additionalQty,
      coverageStatus: ev.status,
    })
  }
  rows.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  return rows
}
