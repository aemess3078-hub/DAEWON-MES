"use server"

/**
 * 생산 수량 조회 모델 서버 액션 (조회 전용) — 수주 처리 화면과 생산계획 화면이 공통으로 사용한다.
 * 인증: 서버 세션. tenantId 는 세션에서만 결정하며 클라이언트 입력을 받지 않는다.
 * 권한: 수주 조회(SALES_ORDER READ) + 생산계획 조회(PRODUCTION_PLAN READ). 수량 정의와 한계는 src/lib/production-quantity-model.ts 참고.
 */
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import {
  loadPlanQuantities,
  loadSalesOrderQuantities,
  type SalesOrderQuantityResult,
} from "@/lib/production-quantity-model.server"
import type { PlanQuantityView } from "@/lib/production-quantity-model"

const MAX_PLAN_IDS = 500

export async function getSalesOrderProductionQuantities(salesOrderId: string): Promise<SalesOrderQuantityResult | null> {
  await requireResourcePermission("SALES_ORDER", "READ")
  const user = await requireResourcePermission("PRODUCTION_PLAN", "READ")
  if (typeof salesOrderId !== "string" || salesOrderId.trim().length === 0) return null
  return loadSalesOrderQuantities(user.tenantId, salesOrderId.trim())
}

export async function getProductionPlanQuantities(planIds?: string[]): Promise<PlanQuantityView[]> {
  await requireResourcePermission("SALES_ORDER", "READ")
  const user = await requireResourcePermission("PRODUCTION_PLAN", "READ")
  if (planIds !== undefined) {
    if (!Array.isArray(planIds) || planIds.length > MAX_PLAN_IDS || planIds.some((id) => typeof id !== "string")) {
      throw new Error("조회할 생산계획 목록이 올바르지 않습니다.")
    }
    if (planIds.length === 0) return []
  }
  return loadPlanQuantities(user.tenantId, planIds)
}
