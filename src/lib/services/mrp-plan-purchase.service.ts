/**
 * 생산계획 MRP 구매 발주제안 서비스 (DB 읽기 전용, DB 클라이언트 주입형)
 *
 *   생산계획 MRP(기존 calculatePlanMrp 계산 그대로) → 부족 자재 → ItemSupplier 정책 + 현재 단가 + DRAFT Coverage → 발주제안 행
 *
 * - DB 쓰기 없음. tenantId 는 인증 사용자에서만 결정한다(요청의 tenantId 는 무시).
 * - 행 모델은 수주기준 MRP 와 같은 PurchaseSuggestionLine 이므로 같은 화면·같은 발주 생성 파이프라인을 쓴다.
 * - 조회 쿼리는 계산(자재별 재고/발주중 조회, 기존 로직) 외에 일괄 4회(공급업체 정책/단가/DRAFT/사이트).
 */

import type { PrismaClient } from "@prisma/client"
import { buildPlanPurchaseSuggestionRows } from "../mrp/plan-purchase-suggestion"
import { buildPlanMrpRunSnapshot, type BuiltMrpRun } from "../mrp/mrp-run-snapshot"
import { toDateOnly } from "../mrp/period"
import type { SupplierCandidateInput } from "../mrp/purchase-suggestion"
import type { DateOnly } from "../mrp/types"
import { loadSupplierPolicies } from "./item-supplier.service"
import { loadCurrentPurchasePrices, loadDraftCoverage } from "./mrp-loaders"
import { calculatePlanMrp, type MRPResult, type PlanMrpDb } from "./mrp-plan.service"
import type { PurchaseSuggestionPayload } from "./mrp-purchase-suggestion.service"

export type PlanPurchaseDb = PlanMrpDb & Pick<PrismaClient, "itemSupplier" | "itemPrice" | "site">

export type PlanPurchaseSuggestionPayload = PurchaseSuggestionPayload & {
  plan: { id: string; planNo: string; status: string; startDate: DateOnly; endDate: DateOnly }
  /** 계산 대상 자재 수 / 충분 자재 수(부족하지 않은 자재는 제안 행에 나오지 않는다) */
  materialCount: number
  sufficientCount: number
}

const ACTIVE_PLAN_STATUSES = ["CONFIRMED", "IN_PROGRESS"]

export class PlanNotAvailableError extends Error {
  constructor() {
    super("생산계획을 찾을 수 없습니다.")
  }
}

async function loadPlanHeader(db: PlanPurchaseDb, tenantId: string, planId: string, activeOnly: boolean) {
  const plan = await db.productionPlan.findFirst({
    where: { id: planId, tenantId, ...(activeOnly ? { status: { in: ACTIVE_PLAN_STATUSES as any } } : {}) },
    select: { id: true, planNo: true, siteId: true, status: true, startDate: true, endDate: true },
  })
  // 존재하지 않는 계획과 다른 tenant 의 계획을 구분하지 않는다(존재 여부 비노출)
  if (!plan) throw new PlanNotAvailableError()
  return plan
}

export async function computePlanPurchaseSuggestions(
  db: PlanPurchaseDb,
  tenantId: string,
  planId: string,
  options: { now?: () => Date; includePrices: boolean; activeOnly?: boolean }
): Promise<{ payload: PlanPurchaseSuggestionPayload; mrp: MRPResult; siteId: string }> {
  const now = options.now ?? (() => new Date())
  const calculatedAt = now()
  const plan = await loadPlanHeader(db, tenantId, planId, options.activeOnly === true)
  // 계산은 기존 생산계획 MRP 와 완전히 같은 함수다(로직 변경 없음)
  const mrp = await calculatePlanMrp(db, planId, tenantId)
  const baseDate = toDateOnly(calculatedAt)
  const shortage = mrp.items.filter((i) => i.netRequirement > 0)
  const targetIds = shortage.map((i) => i.itemId)

  const policies = targetIds.length > 0 ? await loadSupplierPolicies(db, tenantId, targetIds) : new Map()
  const suppliersByItem = new Map<string, SupplierCandidateInput[]>()
  const supplierIds = new Set<string>()
  policies.forEach((policy, itemId) => {
    suppliersByItem.set(
      itemId,
      policy.suppliers.map((s: SupplierCandidateInput & { relationId: string }) => {
        supplierIds.add(s.supplierId)
        return {
          supplierId: s.supplierId,
          supplierCode: s.supplierCode,
          supplierName: s.supplierName,
          isDefault: s.isDefault,
          priority: s.priority,
          leadTimeDays: s.leadTimeDays,
          moq: s.moq,
          orderMultiple: s.orderMultiple,
        }
      })
    )
  })

  let prices = new Map<string, { unitPrice: number; currency: string; effectiveFrom: string }>()
  if (options.includePrices) {
    prices = (await loadCurrentPurchasePrices(db, tenantId, targetIds, Array.from(supplierIds), now())).prices
  }
  const drafts = await loadDraftCoverage(db, tenantId, targetIds)
  const site = await db.site.findFirst({ where: { id: plan.siteId, tenantId }, select: { id: true, name: true } })

  const planStart = toDateOnly(plan.startDate)
  const rows = buildPlanPurchaseSuggestionRows({
    materials: shortage,
    planStartDate: planStart,
    baseDate,
    suppliersByItem,
    prices,
    draftCoverage: drafts.byItem,
  })

  const payload: PlanPurchaseSuggestionPayload = {
    params: { from: planStart, to: toDateOnly(plan.endDate), includeDraft: false },
    calculatedAt: calculatedAt.toISOString(),
    baseDate,
    site: site ? { id: site.id, name: site.name } : null,
    priceVisible: options.includePrices,
    rows,
    summary: {
      finalShortageCount: rows.length,
      temporaryShortageCount: 0,
      noSupplierCount: rows.filter((r) => r.supplierReason === "NONE").length,
      ambiguousSupplierCount: rows.filter((r) => r.supplierReason === "AMBIGUOUS_PRIORITY").length,
    },
    policySummary: {
      purchaseNeededCount: rows.length,
      safetyStockCount: 0,
      orderOverdueCount: rows.filter((r) => r.orderTiming === "OVERDUE").length,
      leadTimeMissingCount: rows.filter((r) => r.recommendedSupplierId !== null && r.orderTiming === "LEAD_TIME_MISSING").length,
    },
    coverageSummary: {
      coveredCount: rows.filter((r) => r.coverageStatus === "COVERED").length,
      partialCount: rows.filter((r) => r.coverageStatus === "PARTIAL").length,
      draftExistsCount: rows.filter((r) => r.draftCoverageQty > 0).length,
    },
    overdueReceiptCount: 0,
    diagnostics: { queryCount: 0 },
    plan: {
      id: plan.id,
      planNo: plan.planNo,
      status: String(plan.status),
      startDate: planStart,
      endDate: toDateOnly(plan.endDate),
    },
    materialCount: mrp.items.length,
    sufficientCount: mrp.items.length - shortage.length,
  }
  return { payload, mrp, siteId: plan.siteId }
}

/** 발주 생성 근거 Snapshot(서버가 생산계획을 다시 계산). 계획이 없거나 확정/진행 상태가 아니면 null. */
export async function buildPlanRunForPurchase(
  db: PlanPurchaseDb,
  tenantId: string,
  planId: string,
  now: () => Date
): Promise<{ built: BuiltMrpRun; siteId: string; planNo: string } | null> {
  try {
    const computed = await computePlanPurchaseSuggestions(db, tenantId, planId, { now, includePrices: false, activeOnly: true })
    const built = buildPlanMrpRunSnapshot({
      rows: computed.payload.rows,
      planId,
      planNo: computed.payload.plan.planNo,
      baseDate: computed.payload.baseDate ?? toDateOnly(now()),
      planStartDate: computed.payload.plan.startDate,
      planEndDate: computed.payload.plan.endDate,
      materialCount: computed.payload.materialCount,
      generatedAt: new Date(computed.payload.calculatedAt),
    })
    return { built, siteId: computed.siteId, planNo: computed.payload.plan.planNo }
  } catch (e) {
    if (e instanceof PlanNotAvailableError) return null
    throw e
  }
}

/** 서버 액션 본체: 인증/권한을 DB 접근보다 먼저, tenantId 는 인증 사용자에서만 결정한다. */
export async function executePlanPurchaseSuggestionRequest(
  deps: {
    authorize: () => Promise<{ tenantId: string }>
    canViewPrices: () => Promise<boolean>
    db: PlanPurchaseDb
    now?: () => Date
  },
  planId: unknown
): Promise<PlanPurchaseSuggestionPayload> {
  const user = await deps.authorize()
  if (typeof planId !== "string" || planId.length === 0 || planId.length > 100) throw new PlanNotAvailableError()
  const includePrices = await deps.canViewPrices()
  return (await computePlanPurchaseSuggestions(deps.db, user.tenantId, planId, { now: deps.now, includePrices })).payload
}
