"use server"

import { prisma } from "@/lib/db/prisma"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { executeOrderMrpRequest } from "@/lib/services/mrp-order.service"
import type { OrderMrpParams, OrderMrpPayload } from "@/lib/services/mrp-order.service"

/**
 * 수주 기반 MRP 조회 (읽기 전용 — DB write 없음).
 * - tenantId 는 인증 컨텍스트에서만 결정한다. 파라미터로 받지 않는다.
 * - MRP READ 권한 필요.
 */
export async function runOrderBasedMrp(params: OrderMrpParams): Promise<OrderMrpPayload> {
  return executeOrderMrpRequest(
    {
      authorize: () => requireResourcePermission("MRP", "READ"),
      db: prisma,
    },
    params
  )
}
