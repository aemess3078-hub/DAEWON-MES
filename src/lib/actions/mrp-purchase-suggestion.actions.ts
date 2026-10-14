"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db/prisma"
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

export async function createDraftPurchaseOrdersFromMrpSuggestions(input: DraftPoInput): Promise<DraftPoResult> {
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
      },
    },
    input
  )
  if (result.success) revalidatePath("/app/mes/purchase-orders")
  return result
}
