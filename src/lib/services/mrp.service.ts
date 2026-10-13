import { prisma } from "@/lib/db/prisma"
import { calculatePlanMrp } from "./mrp-plan.service"

export type { MRPItem, MRPResult } from "./mrp-plan.service"

/**
 * 생산계획 기반 MRP 계산.
 * tenantId 는 반드시 인증 컨텍스트에서 취득한 값을 전달해야 한다(서버 액션이 보장).
 * 계산 알고리즘은 mrp-plan.service.ts 에 있으며 변경되지 않았다.
 */
export async function calculateMRP(planId: string, tenantId: string) {
  return calculatePlanMrp(prisma, planId, tenantId)
}
