"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db/prisma"
import { isMrpPurchaseCreationEnabled, MRP_PURCHASE_CREATION_DISABLED_MESSAGE } from "@/lib/mrp/purchase-creation-policy"
import { requireRole } from "@/lib/auth"
import { hasCurrentUserResourcePermission, requireResourcePermission } from "@/lib/auth/role-permissions"
import {
  createDraftPurchaseOrdersFromSuggestions,
  type DraftPoInput,
  type DraftPoResult,
} from "@/lib/services/mrp-purchase-draft.service"
import {
  executePurchaseSuggestionRequest,
  type PurchaseSuggestionPayload,
} from "@/lib/services/mrp-purchase-suggestion.service"
import {
  buildPlanRunForPurchase,
  executePlanPurchaseSuggestionRequest,
  type PlanPurchaseSuggestionPayload,
} from "@/lib/services/mrp-plan-purchase.service"
import type { OrderMrpParams } from "@/lib/services/mrp-order.service"
import { buildRunFromCurrentMrp } from "@/lib/services/mrp-run.service"

/**
 * 수주기준 MRP 구매 발주제안 (Phase 5C)
 *
 * 조회: MRP READ — 읽기 전용(DB write 없음). 단가는 ITEM_PRICE READ 또는 PURCHASE_ORDER CREATE 권한이 있을 때만 포함한다.
 * 생성: MRP CREATE + PURCHASE_ORDER CREATE (+ role OPERATOR 이상, Phase 2.5 정책 유지). 결과는 항상 DRAFT.
 * Phase 6: 생성 시 서버가 기존 DRAFT Coverage 를 다시 읽어 중복 발주를 막고(사유가 있으면 override),
 *          요청 단위 멱등 키로 재전송을 한 번만 처리하며, 근거 MRP 실행이력(Snapshot)을 같은 트랜잭션에 저장/연결한다.
 * tenantId 는 인증 컨텍스트에서만 결정하며 입력으로 받지 않는다.
 */
export async function getPurchaseSuggestions(
  params: Pick<OrderMrpParams, "from" | "to" | "includeDraft">
): Promise<PurchaseSuggestionPayload> {
  return executePurchaseSuggestionRequest(
    {
      authorize: () => requireResourcePermission("MRP", "READ"),
      canViewPrices: async () =>
        (await hasCurrentUserResourcePermission("ITEM_PRICE", "READ")) ||
        (await hasCurrentUserResourcePermission("PURCHASE_ORDER", "CREATE")),
      db: prisma,
    },
    params
  )
}

/**
 * 생산계획 MRP 발주제안 조회 (MRP READ, 읽기 전용). 계산은 기존 생산계획 MRP 와 같다.
 * 존재하지 않는 계획과 다른 tenant 의 계획은 같은 오류로 응답한다.
 */
export async function getPlanPurchaseSuggestions(planId: string): Promise<PlanPurchaseSuggestionPayload> {
  return executePlanPurchaseSuggestionRequest(
    {
      authorize: () => requireResourcePermission("MRP", "READ"),
      canViewPrices: async () =>
        (await hasCurrentUserResourcePermission("ITEM_PRICE", "READ")) ||
        (await hasCurrentUserResourcePermission("PURCHASE_ORDER", "CREATE")),
      db: prisma,
    },
    planId
  )
}

/** 화면 버튼 표시용(서버 판정을 그대로 알려 줄 뿐이며, 생성 액션이 항상 같은 판정을 다시 수행한다). */
export async function getMrpPurchaseCreationState(): Promise<{ enabled: boolean }> {
  await requireResourcePermission("MRP", "READ")
  return { enabled: isMrpPurchaseCreationEnabled() }
}

/**
 * 수주기준(mrp / runId) 과 생산계획(planId) MRP 가 같은 파이프라인으로 DRAFT 구매발주를 만든다.
 * 권한·정책 판정 → 서버 재계산/재검증 → tenant 잠금 안에서 DRAFT Coverage·MOQ·배수·공급업체 검증 → 멱등 생성.
 */
export async function createDraftPurchaseOrdersFromMrpSuggestions(input: DraftPoInput): Promise<DraftPoResult> {
  // 정책(로컬 환경 한정)이 꺼져 있으면 권한 확인 후 DB 접근·쓰기 없이 안내만 반환한다.
  // 같은 requestKey 재전송(replay)도 이 경로로 들어오므로 함께 막힌다.
  if (!isMrpPurchaseCreationEnabled()) {
    await requireResourcePermission("MRP", "CREATE")
    const user = await requireResourcePermission("PURCHASE_ORDER", "CREATE")
    await requireRole("OPERATOR", user)
    return { success: false, code: "CREATION_DISABLED", error: MRP_PURCHASE_CREATION_DISABLED_MESSAGE }
  }
  const result = await createDraftPurchaseOrdersFromSuggestions(
    {
      authorize: async () => {
        await requireResourcePermission("MRP", "CREATE")
        const user = await requireResourcePermission("PURCHASE_ORDER", "CREATE")
        const actor = await requireRole("OPERATOR", user)
        return { id: actor.id, name: actor.name, tenantId: actor.tenantId }
      },
      db: prisma,
      history: {
        // 서버가 현재 MRP 를 계산해 Snapshot 으로 만든다(클라이언트 결과를 쓰지 않는다)
        loadBuilt: (tenantId, params, now) => buildRunFromCurrentMrp(prisma, tenantId, params, now),
        loadPlanBuilt: (tenantId, planId, now) => buildPlanRunForPurchase(prisma, tenantId, planId, now),
      },
    },
    input
  )
  if (result.success) revalidatePath("/app/mes/purchase-orders")
  return result
}
