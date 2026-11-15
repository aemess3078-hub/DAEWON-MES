"use server"

import { prisma } from "@/lib/db/prisma"
import { executeRunMrpRequest } from "@/lib/services/mrp-plan.service"
import type { MRPResult } from "@/lib/services/mrp.service"
import { requireResourcePermission } from "@/lib/auth/role-permissions"

/**
 * 보안 원칙(Phase 2.5): tenantId 는 인증 컨텍스트(requireResourcePermission 이 돌려준 사용자)에서만 결정한다.
 * 클라이언트가 보낸 tenantId 는 어떤 권한/조회 범위 결정에도 사용하지 않는다.
 *
 * 대원정밀 MRP 는 인공지능 기능을 제공하지 않는다(해당 서버 액션·서비스 제거). 발주 제안은 규칙 기반(purchase-suggestion)만 사용한다.
 */

export async function getPlansForMRP() {
  const user = await requireResourcePermission("MRP", "READ")

  return prisma.productionPlan.findMany({
    where: {
      tenantId: user.tenantId,
      status: { in: ["CONFIRMED", "IN_PROGRESS"] },
    },
    include: {
      site: true,
      items: { include: { item: true } },
    },
    orderBy: { createdAt: "desc" },
  })
}

export async function runMRP(planId: string): Promise<MRPResult> {
  return executeRunMrpRequest(
    { authorize: () => requireResourcePermission("MRP", "READ"), db: prisma },
    planId
  )
}

/**
 * [폐기된 구 진입점] 공급업체·중복 발주 방지·멱등성이 없는 구 방식(tenant 첫 공급업체 / 요청 ID 없음)이라 더 이상 발주를 만들지 않는다.
 * 호출 호환을 위해 이름만 남기며 권한 확인 후 항상 안내만 반환한다(쓰기 없음).
 * 생산계획·수주기준 MRP 는 모두 createDraftPurchaseOrdersFromMrpSuggestions(mrp-purchase-suggestion.actions)로 발주를 만든다.
 */
export async function createPurchaseOrdersFromMRP(
  _items: { itemId: string; qty: number }[],
  _tenantId: string | undefined,
  _siteId: string
): Promise<{ success: boolean; orderNo?: string; error?: string }> {
  await requireResourcePermission("MRP", "CREATE")
  await requireResourcePermission("PURCHASE_ORDER", "CREATE")
  return { success: false, error: "이 방식의 발주 생성은 사용할 수 없습니다. MRP 화면의 '구매발주 생성'을 이용해 주세요." }
}
