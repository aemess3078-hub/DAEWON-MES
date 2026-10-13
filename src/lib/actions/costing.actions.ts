"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId } from "@/lib/auth"
import {
  calculateStandardCost,
  calculateActualCost,
  getCostHistory,
  getCostComparison,
  type CostComparison,
  type CostHistoryItem,
  type CostResult,
} from "@/lib/services/costing.service"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

export async function getItemsForCosting() {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  return prisma.item.findMany({
    where: {
      tenantId,
      itemType: { in: ["FINISHED", "SEMI_FINISHED"] },
      status: "ACTIVE",
    },
    select: { id: true, code: true, name: true, itemType: true },
    orderBy: { name: "asc" },
  })
}

export async function getBomsForItem(itemId: string) {
  await assertDaewonFeatureScope()
  return prisma.bOM.findMany({
    where: { itemId },
    select: { id: true, version: true, status: true, isDefault: true },
    orderBy: { version: "desc" },
  })
}

export async function getWorkOrdersForItem(itemId: string) {
  await assertDaewonFeatureScope()
  return prisma.workOrder.findMany({
    where: { itemId, status: "COMPLETED" },
    select: { id: true, orderNo: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  })
}

export async function runStandardCost(
  itemId: string,
  bomId: string
): Promise<{ success: boolean; result?: CostResult; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("COSTING", "CREATE")
  try {
    const tenantId = await getTenantId()
    const result = await calculateStandardCost(itemId, bomId, tenantId)
    return { success: true, result }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "계산 실패" }
  }
}

export async function runActualCost(
  itemId: string,
  workOrderId: string
): Promise<{ success: boolean; result?: CostResult; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("COSTING", "CREATE")
  try {
    const tenantId = await getTenantId()
    const result = await calculateActualCost(itemId, workOrderId, tenantId)
    return { success: true, result }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "계산 실패" }
  }
}

export async function fetchCostComparison(itemId: string): Promise<CostComparison> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  return getCostComparison(tenantId, itemId)
}

export async function fetchCostHistory(itemId: string): Promise<CostHistoryItem[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  return getCostHistory(tenantId, itemId)
}
