"use server"

import { prisma } from "@/lib/db/prisma"
import { executeRunMrpRequest } from "@/lib/services/mrp-plan.service"
import { createPurchaseOrdersFromMrp } from "@/lib/services/mrp-purchase.service"
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
 * 두 번째 인자(_tenantId)는 기존 호출부 호환을 위해서만 남아 있으며 **무시된다**.
 * 발주 대상 tenant 는 항상 인증된 사용자의 tenant 이다.
 */
export async function createPurchaseOrdersFromMRP(
  items: { itemId: string; qty: number }[],
  _tenantId: string | undefined,
  siteId: string
): Promise<{ success: boolean; orderNo?: string; error?: string }> {
  return createPurchaseOrdersFromMrp(
    {
      authorize: async () => {
        await requireResourcePermission("MRP", "CREATE")
        return requireResourcePermission("PURCHASE_ORDER", "CREATE")
      },
      db: prisma,
    },
    items,
    siteId
  )
}
