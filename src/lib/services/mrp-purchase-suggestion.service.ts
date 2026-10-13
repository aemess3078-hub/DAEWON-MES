/**
 * 수주기준 MRP 구매 발주제안 조회 서비스 (DB 읽기 전용, DB 클라이언트 주입형) — Phase 5C
 *
 *   수주기준 MRP(NORMAL, 예정입고 반영) → 부족/일시 결품 자재 → ItemSupplier 정책 + 현재 단가 → 제안 행
 *
 * - DB 쓰기 없음. tenantId 는 인증 사용자에서만 결정한다(요청의 tenantId 는 무시).
 * - 추가 쿼리는 모두 일괄 조회다: 공급업체 정책 1 + 단가 1 + DRAFT 미입고 1 + 사이트 1 (자재 수와 무관, N+1 없음).
 * - 제안량/공급업체/필요일 계산은 순수 모듈(mrp/purchase-suggestion.ts)이 한다.
 */

import type { PrismaClient } from "@prisma/client"
import { buildPurchaseSuggestionRows, type PurchaseSuggestionRow, type SupplierCandidateInput } from "../mrp/purchase-suggestion"
import type { DateOnly } from "../mrp/types"
import { loadSupplierPolicies } from "./item-supplier.service"
import { loadCurrentPurchasePrices, loadDraftOpenQuantities } from "./mrp-loaders"
import { loadAndRunOrderMrp, normalizeOrderMrpParams, type OrderMrpDb } from "./mrp-order.service"

export type PurchaseSuggestionDb = OrderMrpDb &
  Pick<PrismaClient, "itemSupplier" | "itemPrice" | "purchaseOrderItem" | "site">

export type PurchaseSuggestionPayload = {
  params: { from: DateOnly | null; to: DateOnly | null; includeDraft: boolean }
  calculatedAt: string
  /** 예정입고 기준일(KST 오늘) */
  baseDate: DateOnly | null
  /** DRAFT PO 가 만들어질 사이트(기본: 이름순 첫 사이트). null 이면 사이트 등록 필요 */
  site: { id: string; name: string } | null
  /** 단가 정보 표시 권한 여부 */
  priceVisible: boolean
  rows: PurchaseSuggestionRow[]
  summary: {
    finalShortageCount: number
    temporaryShortageCount: number
    /** 제안 대상 중 공급업체가 없는 자재 수 */
    noSupplierCount: number
    /** 제안 대상 중 최우선 공급업체가 불명확(동률/Default 중복)한 자재 수 */
    ambiguousSupplierCount: number
  }
  /** 예정일이 지나 가산하지 않은 미입고 발주 건수(제안 수량에 영향을 줄 수 있는 참고 정보) */
  overdueReceiptCount: number
  diagnostics: { queryCount: number }
}

export async function loadPurchaseSuggestions(
  db: PurchaseSuggestionDb,
  tenantId: string,
  params: { from: string | null; to: string | null; includeDraft: boolean },
  options: { now?: () => Date; includePrices: boolean }
): Promise<PurchaseSuggestionPayload> {
  const now = options.now ?? (() => new Date())
  const mrp = await loadAndRunOrderMrp(db, tenantId, { ...params, includeScheduledReceipts: true }, now)
  let queryCount = mrp.diagnostics.queryCount
  const view = mrp.view

  // 제안 대상 자재(최종 부족 / 일시 결품)만 정책·단가·DRAFT 를 조회한다
  const targetIds = view.materials.filter((m) => m.shortageQty > 0 || m.temporaryShortage).map((m) => m.componentItemId)

  const policies = targetIds.length > 0 ? await loadSupplierPolicies(db, tenantId, targetIds) : new Map()
  if (targetIds.length > 0) queryCount += 1
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
    const loaded = await loadCurrentPurchasePrices(db, tenantId, targetIds, Array.from(supplierIds), now())
    prices = loaded.prices
    if (loaded.queried) queryCount += 1
  }

  const drafts = await loadDraftOpenQuantities(db, tenantId, targetIds)
  if (drafts.queried) queryCount += 1

  const site = await db.site.findFirst({
    where: { tenantId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })
  queryCount += 1

  const rows = buildPurchaseSuggestionRows({
    view,
    suppliersByItem,
    prices,
    draftOpenQty: drafts.byItem,
  })

  return {
    params: view.params,
    calculatedAt: mrp.calculatedAt,
    baseDate: view.scheduledReceipts.baseDate,
    site: site ? { id: site.id, name: site.name } : null,
    priceVisible: options.includePrices,
    rows,
    summary: {
      finalShortageCount: rows.filter((r) => r.kind === "FINAL_SHORTAGE").length,
      temporaryShortageCount: rows.filter((r) => r.kind === "TEMPORARY_SHORTAGE").length,
      noSupplierCount: rows.filter((r) => r.supplierReason === "NONE").length,
      ambiguousSupplierCount: rows.filter((r) => r.supplierReason === "AMBIGUOUS_PRIORITY").length,
    },
    overdueReceiptCount: view.kpi.overdueReceiptCount,
    diagnostics: { queryCount },
  }
}

/**
 * 서버 액션 본체. 인증/권한은 DB 접근보다 먼저, tenantId 는 인증 사용자에서만 결정한다.
 * canViewPrices: 단가 표시 권한(ITEM_PRICE READ 또는 PURCHASE_ORDER CREATE) — 권한 판단은 호출부가 한다.
 */
export async function executePurchaseSuggestionRequest(
  deps: {
    authorize: () => Promise<{ tenantId: string }>
    canViewPrices: () => Promise<boolean>
    db: PurchaseSuggestionDb
    now?: () => Date
  },
  rawParams: unknown
): Promise<PurchaseSuggestionPayload> {
  const user = await deps.authorize()
  const normalized = normalizeOrderMrpParams(rawParams)
  const includePrices = await deps.canViewPrices()
  return loadPurchaseSuggestions(
    deps.db,
    user.tenantId,
    { from: normalized.from, to: normalized.to, includeDraft: normalized.includeDraft },
    { now: deps.now, includePrices }
  )
}
