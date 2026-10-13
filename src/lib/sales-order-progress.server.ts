import { PlanStatus, ShipmentStatus, WorkOrderStatus } from "@prisma/client"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/db/prisma"
import { kstDaysUntil, toKstDateKey } from "@/lib/date/kst"
import { computeProductionOutputQty } from "@/lib/actions/production-progress.service"
import type { ProductionProgressOperationInput } from "@/lib/actions/production-progress.types"

export type SalesOrderProductionDisplayStatus =
  | "NOT_PLANNED"
  | "PLANNED"
  | "READY"
  | "IN_PROGRESS"
  | "COMPLETED"

export type SalesOrderShipmentDisplayStatus = "NOT_SHIPPED" | "IN_PROGRESS" | "COMPLETED"

export type SalesOrderProgressPermissions = {
  canReadProductionPlan: boolean
  canReadWorkOrder: boolean
  canReadShipment: boolean
}

export type SalesOrderProgressLink = {
  id: string
  label: string
  href: string
}

export type SalesOrderProgressItem = {
  salesOrderItemId: string
  itemId: string
  itemCode: string
  itemName: string
  uom: string
  orderedQty: number
  plannedQty: number
  workOrderQty: number
  producedQty: number
  finishedGoodsReceiptQty: number
  shippedQty: number
  plannedShipmentQty: number
  remainingQty: number
  effectiveDeliveryDate: string
  isOverdue: boolean
  productionStatus: SalesOrderProductionDisplayStatus
  shipmentStatus: SalesOrderShipmentDisplayStatus
  productionPlans: SalesOrderProgressLink[]
  workOrders: SalesOrderProgressLink[]
  shipments: SalesOrderProgressLink[]
}

export type SalesOrderProgressSummary = {
  orderedQty: number
  plannedQty: number
  workOrderQty: number
  producedQty: number
  finishedGoodsReceiptQty: number
  shippedQty: number
  plannedShipmentQty: number
  remainingQty: number
  hasOverdueItem: boolean
}

export type SalesOrderProgress = {
  salesOrderId: string
  orderNo: string
  customerDeliveryDate: string
  hasOverdueItem: boolean
  summary: SalesOrderProgressSummary
  items: SalesOrderProgressItem[]
  permissions: SalesOrderProgressPermissions
}

type DbWorkOrder = {
  id: string
  orderNo: string
  status: WorkOrderStatus
  plannedQty: Prisma.Decimal
  productionPlanItemId: string | null
}

function resolveProductionStatus(input: {
  orderedQty: number
  plannedQty: number
  workOrderQty: number
  producedQty: number
}): SalesOrderProductionDisplayStatus {
  if (input.plannedQty === 0) return "NOT_PLANNED"
  if (input.workOrderQty === 0) return "PLANNED"
  if (input.producedQty === 0) return "READY"
  if (input.producedQty < input.orderedQty) return "IN_PROGRESS"
  return "COMPLETED"
}

function resolveShipmentStatus(input: {
  orderedQty: number
  shippedQty: number
}): SalesOrderShipmentDisplayStatus {
  if (input.shippedQty === 0) return "NOT_SHIPPED"
  if (input.shippedQty < input.orderedQty) return "IN_PROGRESS"
  return "COMPLETED"
}

function addLink(map: Map<string, SalesOrderProgressLink>, link: SalesOrderProgressLink) {
  if (!map.has(link.id)) map.set(link.id, link)
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function mapOperationsForProgress(
  operations: Array<{
    id: string
    seq: number
    status: any
    plannedQty: Prisma.Decimal
    completedQty: Prisma.Decimal
    routingOperation: { id: string; name: string }
    equipment: { name: string } | null
    assignments: { equipment: { name: string } }[]
    productionResults: { goodQty: Prisma.Decimal; startedAt: Date | null }[]
  }>
): ProductionProgressOperationInput[] {
  return operations.map((operation) => ({
    id: operation.id,
    seq: operation.seq,
    status: operation.status,
    plannedQty: Number(operation.plannedQty),
    completedQty: Number(operation.completedQty),
    operationName: operation.routingOperation.name,
    routingOperationId: operation.routingOperation.id,
    equipmentName: operation.equipment?.name ?? null,
    assignments: operation.assignments.map((assignment) => ({
      equipmentName: assignment.equipment.name,
    })),
    productionResults: operation.productionResults.map((result) => ({
      goodQty: Number(result.goodQty),
      startedAt: result.startedAt,
    })),
  }))
}

export async function getSalesOrderProgressForTenant(params: {
  salesOrderId: string
  tenantId: string
  permissions: SalesOrderProgressPermissions
  now?: Date
}): Promise<SalesOrderProgress | null> {
  const now = params.now ?? new Date()
  const salesOrder = await prisma.salesOrder.findFirst({
    where: { id: params.salesOrderId, tenantId: params.tenantId },
    select: {
      id: true,
      orderNo: true,
      deliveryDate: true,
      customer: { select: { name: true } },
      items: {
        select: {
          id: true,
          itemId: true,
          qty: true,
          deliveryDate: true,
          shippedQty: true,
          item: { select: { id: true, code: true, name: true, uom: true } },
        },
        orderBy: { item: { code: "asc" } },
      },
    },
  })

  if (!salesOrder) return null

  const salesOrderItemIds = salesOrder.items.map((item) => item.id)

  const [planItems, plannedShipments] = await Promise.all([
    salesOrderItemIds.length
      ? prisma.productionPlanItem.findMany({
          where: {
            salesOrderItemId: { in: salesOrderItemIds },
            plan: { tenantId: params.tenantId },
          },
          select: {
            id: true,
            salesOrderItemId: true,
            plannedQty: true,
            plan: {
              select: {
                id: true,
                planNo: true,
                status: true,
                startDate: true,
                endDate: true,
              },
            },
            workOrders: {
              select: {
                id: true,
                orderNo: true,
                status: true,
                plannedQty: true,
                productionPlanItemId: true,
              },
            },
          },
        })
      : [],
    salesOrderItemIds.length
      ? prisma.shipmentItem.groupBy({
          by: ["salesOrderItemId"],
          where: {
            salesOrderItemId: { in: salesOrderItemIds },
            shipmentOrder: { tenantId: params.tenantId, status: ShipmentStatus.PLANNED },
          },
          _sum: { qty: true },
        })
      : [],
  ])

  const activePlanItems = planItems.filter((planItem) => planItem.plan.status !== PlanStatus.CANCELLED)
  const activeWorkOrders: DbWorkOrder[] = activePlanItems.flatMap((planItem) =>
    planItem.workOrders.filter((workOrder) => workOrder.status !== WorkOrderStatus.CANCELLED)
  )
  const workOrderIds = activeWorkOrders.map((workOrder) => workOrder.id)

  const [operations, receiptRows, shipmentRows] = await Promise.all([
    workOrderIds.length
      ? prisma.workOrderOperation.findMany({
          where: { workOrderId: { in: workOrderIds }, workOrder: { tenantId: params.tenantId } },
          select: {
            id: true,
            workOrderId: true,
            seq: true,
            status: true,
            plannedQty: true,
            completedQty: true,
            routingOperation: { select: { id: true, name: true } },
            equipment: { select: { name: true } },
            assignments: { select: { equipment: { select: { name: true } } } },
            productionResults: { select: { goodQty: true, startedAt: true } },
          },
          orderBy: { seq: "asc" },
        })
      : [],
    workOrderIds.length
      ? prisma.finishedGoodsReceipt.groupBy({
          by: ["workOrderId"],
          where: { tenantId: params.tenantId, workOrderId: { in: workOrderIds } },
          _sum: { receiptQty: true },
        })
      : [],
    salesOrderItemIds.length
      ? prisma.shipmentItem.findMany({
          where: {
            salesOrderItemId: { in: salesOrderItemIds },
            shipmentOrder: { tenantId: params.tenantId },
          },
          select: {
            salesOrderItemId: true,
            shipmentOrder: { select: { id: true, shipmentNo: true, status: true } },
          },
        })
      : [],
  ])

  const planItemsBySalesOrderItem = new Map<string, typeof activePlanItems>()
  for (const planItem of activePlanItems) {
    if (!planItem.salesOrderItemId) continue
    const list = planItemsBySalesOrderItem.get(planItem.salesOrderItemId) ?? []
    list.push(planItem)
    planItemsBySalesOrderItem.set(planItem.salesOrderItemId, list)
  }

  const operationsByWorkOrder = new Map<string, typeof operations>()
  for (const operation of operations) {
    const list = operationsByWorkOrder.get(operation.workOrderId) ?? []
    list.push(operation)
    operationsByWorkOrder.set(operation.workOrderId, list)
  }

  const receiptQtyByWorkOrder = new Map<string, number>()
  for (const row of receiptRows) {
    receiptQtyByWorkOrder.set(row.workOrderId, Number(row._sum.receiptQty ?? 0))
  }

  const plannedShipmentQtyBySalesOrderItem = new Map<string, number>()
  for (const row of plannedShipments) {
    plannedShipmentQtyBySalesOrderItem.set(row.salesOrderItemId, Number(row._sum.qty ?? 0))
  }

  const shipmentLinksBySalesOrderItem = new Map<string, Map<string, SalesOrderProgressLink>>()
  if (params.permissions.canReadShipment) {
    for (const row of shipmentRows) {
      const map = shipmentLinksBySalesOrderItem.get(row.salesOrderItemId) ?? new Map<string, SalesOrderProgressLink>()
      addLink(map, {
        id: row.shipmentOrder.id,
        label: row.shipmentOrder.shipmentNo,
        href: `/app/mes/shipments?salesOrderId=${encodeURIComponent(salesOrder.id)}`,
      })
      shipmentLinksBySalesOrderItem.set(row.salesOrderItemId, map)
    }
  }

  const items: SalesOrderProgressItem[] = salesOrder.items.map((item) => {
    const orderedQty = Number(item.qty)
    const shippedQty = Number(item.shippedQty)
    const remainingQty = Math.max(0, orderedQty - shippedQty)
    const effectiveDeliveryDate = item.deliveryDate ?? salesOrder.deliveryDate
    const linkedPlanItems = planItemsBySalesOrderItem.get(item.id) ?? []
    const linkedWorkOrders = linkedPlanItems.flatMap((planItem) =>
      planItem.workOrders.filter((workOrder) => workOrder.status !== WorkOrderStatus.CANCELLED)
    )

    const planLinks = new Map<string, SalesOrderProgressLink>()
    const workOrderLinks = new Map<string, SalesOrderProgressLink>()
    if (params.permissions.canReadProductionPlan || params.permissions.canReadWorkOrder) {
      for (const planItem of linkedPlanItems) {
        if (params.permissions.canReadProductionPlan) {
          addLink(planLinks, {
            id: planItem.plan.id,
            label: planItem.plan.planNo,
            href: `/app/mes/production-plan?salesOrderId=${encodeURIComponent(salesOrder.id)}`,
          })
        }
        if (params.permissions.canReadWorkOrder) {
          for (const workOrder of planItem.workOrders) {
            if (workOrder.status === WorkOrderStatus.CANCELLED) continue
            addLink(workOrderLinks, {
              id: workOrder.id,
              label: workOrder.orderNo,
              href: `/app/mes/work-orders?productionPlanId=${encodeURIComponent(planItem.plan.id)}&productionPlanItemId=${encodeURIComponent(planItem.id)}`,
            })
          }
        }
      }
    }

    const producedQty = sum(
      linkedWorkOrders.map((workOrder) =>
        computeProductionOutputQty(
          mapOperationsForProgress(operationsByWorkOrder.get(workOrder.id) ?? [])
        )
      )
    )
    const finishedGoodsReceiptQty = sum(
      linkedWorkOrders.map((workOrder) => receiptQtyByWorkOrder.get(workOrder.id) ?? 0)
    )
    const plannedQty = sum(linkedPlanItems.map((planItem) => Number(planItem.plannedQty)))
    const workOrderQty = sum(linkedWorkOrders.map((workOrder) => Number(workOrder.plannedQty)))
    const plannedShipmentQty = plannedShipmentQtyBySalesOrderItem.get(item.id) ?? 0

    return {
      salesOrderItemId: item.id,
      itemId: item.itemId,
      itemCode: item.item.code,
      itemName: item.item.name,
      uom: item.item.uom,
      orderedQty,
      plannedQty,
      workOrderQty,
      producedQty,
      finishedGoodsReceiptQty,
      shippedQty,
      plannedShipmentQty,
      remainingQty,
      effectiveDeliveryDate: toKstDateKey(effectiveDeliveryDate),
      isOverdue: kstDaysUntil(effectiveDeliveryDate, now) < 0 && remainingQty > 0,
      productionStatus: resolveProductionStatus({ orderedQty, plannedQty, workOrderQty, producedQty }),
      shipmentStatus: resolveShipmentStatus({ orderedQty, shippedQty }),
      productionPlans: Array.from(planLinks.values()),
      workOrders: Array.from(workOrderLinks.values()),
      shipments: Array.from(shipmentLinksBySalesOrderItem.get(item.id)?.values() ?? []),
    }
  })

  const summary: SalesOrderProgressSummary = {
    orderedQty: sum(items.map((item) => item.orderedQty)),
    plannedQty: sum(items.map((item) => item.plannedQty)),
    workOrderQty: sum(items.map((item) => item.workOrderQty)),
    producedQty: sum(items.map((item) => item.producedQty)),
    finishedGoodsReceiptQty: sum(items.map((item) => item.finishedGoodsReceiptQty)),
    shippedQty: sum(items.map((item) => item.shippedQty)),
    plannedShipmentQty: sum(items.map((item) => item.plannedShipmentQty)),
    remainingQty: sum(items.map((item) => item.remainingQty)),
    hasOverdueItem: items.some((item) => item.isOverdue),
  }

  return {
    salesOrderId: salesOrder.id,
    orderNo: salesOrder.orderNo,
    customerDeliveryDate: toKstDateKey(salesOrder.deliveryDate),
    hasOverdueItem: summary.hasOverdueItem,
    summary,
    items,
    permissions: params.permissions,
  }
}
