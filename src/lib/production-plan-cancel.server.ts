import { PlanStatus, type SalesOrderStatus } from "@prisma/client"
import type { Prisma } from "@prisma/client"

import type { CurrentUser } from "@/lib/auth"
import { recordAuditLog } from "@/lib/audit-log"
import { lockProductionPlanItemsForUpdate } from "@/lib/quantity-concurrency"

type CancelPlanTx = Prisma.TransactionClient

const CANCELABLE_PLAN_STATUSES: PlanStatus[] = [PlanStatus.DRAFT, PlanStatus.CONFIRMED]
const TERMINAL_SALES_ORDER_STATUSES: SalesOrderStatus[] = ["CANCELLED", "CLOSED"]

export async function assertProductionPlanCancelable(params: {
  tx: Pick<CancelPlanTx, "productionPlan">
  planId: string
  tenantId: string
}) {
  const plan = await params.tx.productionPlan.findFirst({
    where: { id: params.planId, tenantId: params.tenantId },
    select: {
      id: true,
      tenantId: true,
      planNo: true,
      status: true,
      items: {
        select: {
          id: true,
          salesOrderItemId: true,
          _count: { select: { workOrders: true } },
        },
      },
    },
  })

  if (!plan) throw new Error("생산계획을 찾을 수 없습니다.")
  if (plan.status === PlanStatus.CANCELLED) {
    throw new Error("이미 취소된 생산계획입니다.")
  }
  if (!CANCELABLE_PLAN_STATUSES.includes(plan.status)) {
    throw new Error("DRAFT 또는 CONFIRMED 상태의 생산계획만 취소할 수 있습니다.")
  }
  if (plan.items.some((item) => item._count.workOrders > 0)) {
    throw new Error("연결된 작업지시가 있습니다. 작업지시를 먼저 확인/정리한 후 생산계획을 취소하세요.")
  }

  return plan
}

async function resolveSalesOrderStatusAfterPlanCancel(
  tx: Pick<CancelPlanTx, "salesOrder" | "productionPlanItem">,
  salesOrderId: string,
  tenantId: string,
): Promise<SalesOrderStatus | null> {
  const salesOrder = await tx.salesOrder.findFirst({
    where: { id: salesOrderId, tenantId },
    select: {
      id: true,
      status: true,
      items: { select: { id: true, qty: true, shippedQty: true } },
    },
  })

  if (!salesOrder) return null
  if (TERMINAL_SALES_ORDER_STATUSES.includes(salesOrder.status)) return salesOrder.status
  if (salesOrder.status === "DRAFT") return salesOrder.status

  const totalQty = salesOrder.items.reduce((sum, item) => sum + Number(item.qty), 0)
  const shippedQty = salesOrder.items.reduce((sum, item) => sum + Number(item.shippedQty), 0)
  if (totalQty > 0 && shippedQty >= totalQty) return "SHIPPED"
  if (shippedQty > 0) return "PARTIAL_SHIPPED"

  const activePlanItem = await tx.productionPlanItem.findFirst({
    where: {
      salesOrderItem: { salesOrderId, salesOrder: { tenantId } },
      plan: { tenantId, status: { not: PlanStatus.CANCELLED } },
    },
    select: { id: true },
  })

  if (activePlanItem) return "IN_PRODUCTION"
  if (salesOrder.status === "IN_PRODUCTION") return "CONFIRMED"
  return salesOrder.status
}

export async function cancelProductionPlanForTenant(params: {
  tx: CancelPlanTx
  planId: string
  tenantId: string
  actor: CurrentUser
  reason: string
}) {
  const reason = params.reason.trim()
  if (!reason) throw new Error("취소사유를 입력하세요.")

  const planForLock = await params.tx.productionPlan.findFirst({
    where: { id: params.planId, tenantId: params.tenantId },
    select: {
      id: true,
      items: { select: { id: true } },
    },
  })
  if (!planForLock) throw new Error("생산계획을 찾을 수 없습니다.")

  await lockProductionPlanItemsForUpdate(
    params.tx,
    params.tenantId,
    planForLock.items.map((item) => item.id)
  )

  const plan = await assertProductionPlanCancelable({
    tx: params.tx,
    planId: params.planId,
    tenantId: params.tenantId,
  })

  const linkedSalesOrderIds = Array.from(
    new Set(
      plan.items
        .map((item) => item.salesOrderItemId)
        .filter((id): id is string => id != null)
    )
  )

  let actualSalesOrderIds: string[] = []
  if (linkedSalesOrderIds.length > 0) {
    const rows = await params.tx.salesOrderItem.findMany({
      where: { id: { in: linkedSalesOrderIds }, salesOrder: { tenantId: params.tenantId } },
      select: { salesOrderId: true },
    })
    actualSalesOrderIds = Array.from(new Set(rows.map((row) => row.salesOrderId)))
  }

  await params.tx.productionPlan.update({
    where: { id: params.planId },
    data: { status: PlanStatus.CANCELLED },
  })

  await recordAuditLog(params.tx, {
    tenantId: params.tenantId,
    actor: params.actor,
    entityType: "ProductionPlan",
    entityId: params.planId,
    action: "UPDATE",
    beforeData: { planNo: plan.planNo, status: plan.status },
    afterData: {
      planNo: plan.planNo,
      status: PlanStatus.CANCELLED,
      previousStatus: plan.status,
      cancelReason: reason,
    },
    menuName: "생산계획",
  })

  const salesOrderStatusChanges: Array<{ id: string; before: SalesOrderStatus; after: SalesOrderStatus }> = []
  for (const salesOrderId of actualSalesOrderIds) {
    const current = await params.tx.salesOrder.findFirst({
      where: { id: salesOrderId, tenantId: params.tenantId },
      select: { id: true, orderNo: true, status: true },
    })
    if (!current) continue

    const nextStatus = await resolveSalesOrderStatusAfterPlanCancel(
      params.tx,
      salesOrderId,
      params.tenantId,
    )
    if (!nextStatus || nextStatus === current.status) continue

    await params.tx.salesOrder.update({
      where: { id: salesOrderId },
      data: { status: nextStatus },
    })
    await recordAuditLog(params.tx, {
      tenantId: params.tenantId,
      actor: params.actor,
      entityType: "SalesOrder",
      entityId: salesOrderId,
      action: "UPDATE",
      beforeData: { orderNo: current.orderNo, status: current.status },
      afterData: {
        orderNo: current.orderNo,
        status: nextStatus,
        source: "PRODUCTION_PLAN_CANCEL",
        productionPlanId: params.planId,
        planNo: plan.planNo,
      },
      menuName: "생산계획",
    })
    salesOrderStatusChanges.push({ id: salesOrderId, before: current.status, after: nextStatus })
  }

  return {
    planId: params.planId,
    previousStatus: plan.status,
    status: PlanStatus.CANCELLED,
    salesOrderStatusChanges,
  }
}
