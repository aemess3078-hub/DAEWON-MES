"use server"

import { prisma } from "@/lib/db/prisma"
import { requireRole } from "@/lib/auth"
import { SalesOrderStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { getErrorMessage } from "@/lib/utils"
import { hasResourcePermission, getCurrentPermissionSnapshot, requireResourcePermission } from "@/lib/auth/role-permissions"
import { buildAuditChanges, recordAuditLog, summarizeAuditItems } from "@/lib/audit-log"
import { kstDateParts, withUniqueBusinessNumberRetry } from "@/lib/business-numbering"
import { getSalesOrderProgressForTenant } from "@/lib/sales-order-progress.server"

// ─── Query Functions ──────────────────────────────────────────────────────────

export async function getSalesOrders(tenantId: string) {
  const rows = await prisma.salesOrder.findMany({
    where: { tenantId },
    include: {
      customer: true,
      items: { include: { item: true } },
      shipments: true,
    },
    orderBy: { createdAt: "desc" },
  })
  return rows.map((o) => ({
    ...o,
    totalAmount: o.totalAmount !== null ? Number(o.totalAmount) : null,
    items: o.items.map((i) => ({
      ...i,
      qty:         Number(i.qty),
      unitPrice:   i.unitPrice   !== null ? Number(i.unitPrice)   : null,
      producedQty: Number(i.producedQty),
      shippedQty:  Number(i.shippedQty),
    })),
  }))
}

export type SalesOrderStatusRow = Awaited<ReturnType<typeof getSalesOrderStatusRows>>[number]

export async function getSalesOrderStatusRows(tenantId: string) {
  const rows = await prisma.salesOrder.findMany({
    where: { tenantId },
    select: {
      id: true,
      orderNo: true,
      orderDate: true,
      deliveryDate: true,
      status: true,
      customer: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      items: {
        select: {
          id: true,
          qty: true,
          shippedQty: true,
          item: {
            select: {
              id: true,
              code: true,
              name: true,
              uom: true,
            },
          },
        },
        orderBy: { item: { code: "asc" } },
      },
    },
    orderBy: [{ deliveryDate: "asc" }, { orderNo: "desc" }],
  })
  return rows.map((o) => ({
    ...o,
    items: o.items.map((i) => ({
      ...i,
      qty:       Number(i.qty),
      shippedQty: Number(i.shippedQty),
    })),
  }))
}

export async function getCustomers(tenantId: string) {
  return prisma.businessPartner.findMany({
    where: { tenantId, partnerType: { in: ["CUSTOMER", "BOTH"] } },
    orderBy: { name: "asc" },
  })
}

export async function getItemsForSales(tenantId: string) {
  return prisma.item.findMany({
    where: { tenantId, status: "ACTIVE", itemType: "FINISHED" },
    orderBy: { name: "asc" },
  })
}

// ─── Business Logic ───────────────────────────────────────────────────────────

export async function generateSalesOrderNo(tenantId: string): Promise<string> {
  const { year } = kstDateParts()
  const prefix = `SO-${year}-`
  const last = await prisma.salesOrder.findFirst({
    where: { tenantId, orderNo: { startsWith: prefix } },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  })
  const seq = last ? (parseInt(last.orderNo.split("-")[2] ?? "0", 10) || 0) + 1 : 1
  return `${prefix}${String(seq).padStart(3, "0")}`
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export type CreateSalesOrderItemInput = {
  itemId: string
  qty: number
  unitPrice?: number
  deliveryDate?: Date
  note?: string
}

export type CreateSalesOrderInput = {
  customerId: string
  orderDate: Date
  deliveryDate: Date
  status: SalesOrderStatus
  totalAmount?: number
  currency?: string
  note?: string
  items: CreateSalesOrderItemInput[]
}

export async function createSalesOrder(
  tenantId: string,
  siteId: string,
  data: CreateSalesOrderInput
) {
  await requireResourcePermission("SALES_ORDER", "CREATE")
  const actor = await requireRole("OPERATOR")
  if (actor.tenantId !== tenantId) throw new Error("FORBIDDEN")
  const order = await withUniqueBusinessNumberRetry(async () => {
    const orderNo = await generateSalesOrderNo(tenantId)
    return prisma.$transaction(async (tx) => {
      const created = await tx.salesOrder.create({
        data: {
          tenantId,
          siteId,
          customerId: data.customerId,
          orderNo,
          orderDate: data.orderDate,
          deliveryDate: data.deliveryDate,
          status: data.status,
          totalAmount: data.totalAmount,
          currency: data.currency ?? "KRW",
          note: data.note,
          items: {
            create: data.items.map((item) => ({
              itemId: item.itemId,
              qty: item.qty,
              unitPrice: item.unitPrice,
              deliveryDate: item.deliveryDate,
              note: item.note,
            })),
          },
        },
      })
      await recordAuditLog(tx, {
        tenantId,
        actor,
        entityType: "SalesOrder",
        entityId: created.id,
        action: "CREATE",
        afterData: {
          orderNo,
          siteId,
          customerId: data.customerId,
          status: data.status,
          itemCount: data.items.length,
          items: summarizeAuditItems(data.items, ["itemId", "qty", "unitPrice"]),
        },
        menuName: "수주관리",
      })
      return created
    })
  }, { fields: ["tenantId", "orderNo"], message: "수주번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요." })
  revalidatePath("/app/mes/sales-orders")
  return order
}

export type UpdateSalesOrderInput = {
  customerId?: string
  orderDate?: Date
  deliveryDate?: Date
  status?: SalesOrderStatus
  totalAmount?: number
  currency?: string
  note?: string
  items?: CreateSalesOrderItemInput[]
}

export async function updateSalesOrder(id: string, data: UpdateSalesOrderInput) {
  await requireResourcePermission("SALES_ORDER", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const current = await prisma.salesOrder.findUniqueOrThrow({
    where: { id },
    include: { items: true },
  })
  if (current.tenantId !== actor.tenantId) throw new Error("FORBIDDEN")
  const canEditItems = current.status === "DRAFT"

  await prisma.$transaction(async (tx) => {
    if (canEditItems && data.items) {
      await tx.salesOrderItem.deleteMany({ where: { salesOrderId: id } })
    }
    const updated = await tx.salesOrder.update({
      where: { id },
      data: {
        ...(data.customerId !== undefined && { customerId: data.customerId }),
        ...(data.orderDate !== undefined && { orderDate: data.orderDate }),
        ...(data.deliveryDate !== undefined && { deliveryDate: data.deliveryDate }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.totalAmount !== undefined && { totalAmount: data.totalAmount }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.note !== undefined && { note: data.note }),
        ...(canEditItems && data.items && {
          items: {
            create: data.items.map((item) => ({
              itemId: item.itemId,
              qty: item.qty,
              unitPrice: item.unitPrice,
              deliveryDate: item.deliveryDate,
              note: item.note,
            })),
          },
        }),
      },
      include: { items: true },
    })
    await recordAuditLog(tx, {
      tenantId: actor.tenantId,
      actor,
      entityType: "SalesOrder",
      entityId: id,
      action: "UPDATE",
      beforeData: {
        orderNo: current.orderNo,
        customerId: current.customerId,
        status: current.status,
        totalAmount: current.totalAmount,
        itemCount: current.items.length,
      },
      afterData: {
        changes: buildAuditChanges(current as any, updated as any, [
          "customerId",
          "orderDate",
          "deliveryDate",
          "status",
          "totalAmount",
          "currency",
          "note",
        ]),
        itemCount: updated.items.length,
      },
      menuName: "수주관리",
    })
  })
  revalidatePath("/app/mes/sales-orders")
}

export async function deleteSalesOrder(id: string) {
  await requireResourcePermission("SALES_ORDER", "DELETE")
  const actor = await requireRole("OPERATOR")
  const order = await prisma.salesOrder.findUniqueOrThrow({
    where: { id },
    include: { items: true },
  })
  if (order.tenantId !== actor.tenantId) throw new Error("FORBIDDEN")
  if (order.status !== "DRAFT") {
    throw new Error("DRAFT 상태인 수주만 삭제할 수 있습니다.")
  }
  // PR #52A에서 ProjectOrderPrice.salesOrderId → SalesOrder FK가 ON DELETE RESTRICT로
  // 추가된다. 참조가 있으면 Header 삭제만 FK 오류로 실패해, 아이템은 이미 지워졌는데
  // Header는 남는 partial delete가 될 수 있다. 그래서 (1) 사전에 참조를 확인해 사용자
  // 친화적으로 차단하고, (2) 아이템/Header 삭제를 하나의 트랜잭션으로 묶어 향후 다른
  // FK 제약으로 Header 삭제가 실패해도 아이템 삭제까지 함께 롤백되게 한다.
  const priceRefCount = await prisma.projectOrderPrice.count({ where: { salesOrderId: id } })
  if (priceRefCount > 0) {
    throw new Error("프로젝트 단가정보에서 사용 중인 수주는 삭제할 수 없습니다.")
  }
  await prisma.$transaction(async (tx) => {
    await tx.salesOrderItem.deleteMany({ where: { salesOrderId: id } })
    await tx.salesOrder.delete({ where: { id } })
    await recordAuditLog(tx, {
      tenantId: actor.tenantId,
      actor,
      entityType: "SalesOrder",
      entityId: id,
      action: "DELETE",
      beforeData: {
        orderNo: order.orderNo,
        customerId: order.customerId,
        status: order.status,
        itemCount: order.items.length,
      },
      menuName: "수주관리",
    })
  })
  revalidatePath("/app/mes/sales-orders")
}

export async function getSalesOrderProgress(salesOrderId: string) {
  const user = await requireResourcePermission("SALES_ORDER", "READ")
  const snapshot = await getCurrentPermissionSnapshot(user)
  return getSalesOrderProgressForTenant({
    salesOrderId,
    tenantId: user.tenantId,
    permissions: {
      canReadProductionPlan: hasResourcePermission(snapshot, "PRODUCTION_PLAN", "READ"),
      canReadWorkOrder: hasResourcePermission(snapshot, "WORK_ORDER", "READ"),
      canReadShipment: hasResourcePermission(snapshot, "SHIPMENT", "READ"),
    },
  })
}
// ─── S2: 재고 조회 ─────────────────────────────────────────────────────────────

export type ItemStockStatus = {
  salesOrderItemId: string
  itemId: string
  itemCode: string
  itemName: string
  uom: string
  orderedQty: number
  shippedQty: number
  remainingQty: number
  availableStock: number   // 전체 창고 합산 가용재고
  shippableQty: number     // min(remainingQty, availableStock)
  shortageQty: number      // max(0, remainingQty - availableStock)
  isLotTracked: boolean
  defaultWarehouseId: string | null
}

export async function checkInventoryForSalesOrder(
  salesOrderId: string,
  tenantId: string
): Promise<ItemStockStatus[]> {
  const order = await prisma.salesOrder.findUniqueOrThrow({
    where: { id: salesOrderId },
    include: {
      items: { include: { item: { select: { id: true, code: true, name: true, uom: true, isLotTracked: true, defaultWarehouseId: true } } } },
    },
  })

  const itemIds = order.items.map((i) => i.itemId)
  const balances = await prisma.inventoryBalance.findMany({
    where: { tenantId, itemId: { in: itemIds } },
    select: { itemId: true, qtyAvailable: true },
  })

  const stockMap = new Map<string, number>()
  for (const b of balances) {
    stockMap.set(b.itemId, (stockMap.get(b.itemId) ?? 0) + Number(b.qtyAvailable))
  }

  return order.items.map((soi) => {
    const orderedQty = Number(soi.qty)
    const shippedQty = Number(soi.shippedQty ?? 0)
    const remainingQty = Math.max(0, orderedQty - shippedQty)
    const availableStock = stockMap.get(soi.itemId) ?? 0
    const shippableQty = Math.min(remainingQty, availableStock)
    const shortageQty = Math.max(0, remainingQty - availableStock)

    return {
      salesOrderItemId: soi.id,
      itemId: soi.itemId,
      itemCode: soi.item.code,
      itemName: soi.item.name,
      uom: soi.item.uom,
      orderedQty,
      shippedQty,
      remainingQty,
      availableStock,
      shippableQty,
      shortageQty,
      isLotTracked: soi.item.isLotTracked,
      defaultWarehouseId: soi.item.defaultWarehouseId,
    }
  })
}

// ─── 수주 충족 현황 분석 ───────────────────────────────────────────────────────

export type MaterialShortage = {
  itemId: string
  itemCode: string
  itemName: string
  uom: string
  neededQty: number
  availableQty: number
  shortageQty: number
}

export type FulfillmentRow = {
  itemId: string
  itemCode: string
  itemName: string
  uom: string
  confirmedQty: number
  inProductionQty: number
  partialShippedQty: number
  draftQty: number
  totalOrderedQty: number
  finishedGoodsStock: number
  fromSemiFinished: number
  fromRawMaterial: number
  totalFulfillable: number
  shortageQty: number
  materialShortages: MaterialShortage[]
}

export async function getSalesOrderFulfillmentStatus(
  tenantId: string,
  includeNonConfirmed: boolean
): Promise<FulfillmentRow[]> {
  const statusFilter: SalesOrderStatus[] = [
    "CONFIRMED",
    "IN_PRODUCTION",
    "PARTIAL_SHIPPED",
  ]
  if (includeNonConfirmed) statusFilter.push("DRAFT")

  const orders = await prisma.salesOrder.findMany({
    where: { tenantId, status: { in: statusFilter } },
    include: {
      items: {
        include: {
          item: {
            select: { id: true, code: true, name: true, uom: true, itemType: true },
          },
        },
      },
    },
  })

  // 품목별 수주 잔여량 집계
  type ItemAccumulator = {
    itemCode: string
    itemName: string
    uom: string
    confirmedQty: number
    inProductionQty: number
    partialShippedQty: number
    draftQty: number
  }

  const itemMap = new Map<string, ItemAccumulator>()

  for (const order of orders) {
    for (const soi of order.items) {
      const orderedQty = Number(soi.qty)
      const shippedQty = Number(soi.shippedQty ?? 0)
      const remainingQty = Math.max(0, orderedQty - shippedQty)

      if (!itemMap.has(soi.itemId)) {
        itemMap.set(soi.itemId, {
          itemCode: soi.item.code,
          itemName: soi.item.name,
          uom: soi.item.uom,
          confirmedQty: 0,
          inProductionQty: 0,
          partialShippedQty: 0,
          draftQty: 0,
        })
      }
      const acc = itemMap.get(soi.itemId)!

      if (order.status === "CONFIRMED") acc.confirmedQty += remainingQty
      else if (order.status === "IN_PRODUCTION") acc.inProductionQty += remainingQty
      else if (order.status === "PARTIAL_SHIPPED") acc.partialShippedQty += remainingQty
      else if (order.status === "DRAFT") acc.draftQty += remainingQty
    }
  }

  if (itemMap.size === 0) return []

  const itemIds = Array.from(itemMap.keys())

  // BOM 조회
  const boms = await prisma.bOM.findMany({
    where: { tenantId, itemId: { in: itemIds }, isDefault: true },
    include: { bomItems: { include: { componentItem: true } } },
  })
  const bomMap = new Map(boms.map((b) => [b.itemId, b]))

  // 재고 조회
  const balances = await prisma.inventoryBalance.findMany({
    where: { tenantId },
    select: { itemId: true, qtyAvailable: true },
  })
  const inventoryMap = new Map<string, number>()
  for (const b of balances) {
    inventoryMap.set(b.itemId, (inventoryMap.get(b.itemId) ?? 0) + Number(b.qtyAvailable))
  }

  const results: FulfillmentRow[] = []

  for (const [itemId, acc] of Array.from(itemMap.entries())) {
    const totalOrderedQty =
      acc.confirmedQty + acc.inProductionQty + acc.partialShippedQty + acc.draftQty

    const fgStock = inventoryMap.get(itemId) ?? 0
    let remaining = Math.max(0, totalOrderedQty - fgStock)

    const bom = bomMap.get(itemId)

    let fromSF = 0
    let fromRM = 0
    const materialShortages: MaterialShortage[] = []

    if (bom) {
      // 반제품(SF) 처리
      const sfComponents = bom.bomItems.filter(
        (c) => c.componentItem.itemType === "SEMI_FINISHED"
      )
      for (const comp of sfComponents) {
        if (remaining <= 0) break
        const sfStock = inventoryMap.get(comp.componentItemId) ?? 0
        const qtyPer = Number(comp.qtyPer)
        const canMake = qtyPer > 0 ? Math.floor(sfStock / qtyPer) : 0
        const use = Math.min(remaining, canMake)
        fromSF += use
        remaining -= use
      }

      // 원자재(RM) 처리
      const rmComponents = bom.bomItems.filter(
        (c) => c.componentItem.itemType === "RAW_MATERIAL"
      )
      if (remaining > 0 && rmComponents.length > 0) {
        let canFromRM = remaining
        for (const rm of rmComponents) {
          const rmStock = inventoryMap.get(rm.componentItemId) ?? 0
          const qtyPer = Number(rm.qtyPer)
          const possible = qtyPer > 0 ? Math.floor(rmStock / qtyPer) : 0
          canFromRM = Math.min(canFromRM, possible)
        }
        fromRM = canFromRM
        remaining -= fromRM
      }

      // 자재 부족 계산
      const totalNeedFromRM = fromRM + remaining
      if (totalNeedFromRM > 0) {
        const rmComponents2 = bom.bomItems.filter(
          (c) => c.componentItem.itemType === "RAW_MATERIAL"
        )
        for (const rm of rmComponents2) {
          const qtyPer = Number(rm.qtyPer)
          const neededQty = Math.ceil(totalNeedFromRM * qtyPer)
          const availableQty = inventoryMap.get(rm.componentItemId) ?? 0
          const shortage = Math.max(0, neededQty - availableQty)
          if (shortage > 0) {
            materialShortages.push({
              itemId: rm.componentItemId,
              itemCode: rm.componentItem.code,
              itemName: rm.componentItem.name,
              uom: rm.componentItem.uom,
              neededQty,
              availableQty,
              shortageQty: shortage,
            })
          }
        }
      }
    }

    const shortageQty = remaining
    const totalFulfillable = Math.min(totalOrderedQty, fgStock + fromSF + fromRM)

    results.push({
      itemId,
      itemCode: acc.itemCode,
      itemName: acc.itemName,
      uom: acc.uom,
      confirmedQty: acc.confirmedQty,
      inProductionQty: acc.inProductionQty,
      partialShippedQty: acc.partialShippedQty,
      draftQty: acc.draftQty,
      totalOrderedQty,
      finishedGoodsStock: fgStock,
      fromSemiFinished: fromSF,
      fromRawMaterial: fromRM,
      totalFulfillable,
      shortageQty,
      materialShortages,
    })
  }

  return results.sort((a, b) => {
    if (a.shortageQty > 0 && b.shortageQty <= 0) return -1
    if (a.shortageQty <= 0 && b.shortageQty > 0) return 1
    return a.itemCode.localeCompare(b.itemCode)
  })
}

// ─── S4: 생산의뢰 생성 ─────────────────────────────────────────────────────────

async function generateSalesRequestPlanNo(tenantId: string): Promise<string> {
  const { yyyymmdd } = kstDateParts()
  const prefix = `PP-REQ-${yyyymmdd}`
  const last = await prisma.productionPlan.findFirst({
    where: { tenantId, planNo: { startsWith: prefix } },
    orderBy: { planNo: "desc" },
    select: { planNo: true },
  })
  const seq = last ? (parseInt(last.planNo.split("-")[3] ?? "0", 10) || 0) + 1 : 1
  return `${prefix}-${String(seq).padStart(3, "0")}`
}

export async function requestProductionFromSalesOrder(
  salesOrderId: string,
  items: { salesOrderItemId: string; itemId: string; qty: number }[],
  tenantId: string,
  siteId: string
): Promise<{ ok: boolean; planNo?: string; error?: string }> {
  await requireResourcePermission("SALES_ORDER", "UPDATE")
  await requireResourcePermission("PRODUCTION_PLAN", "CREATE")
  const actor = await requireRole("OPERATOR")
  if (actor.tenantId !== tenantId) return { ok: false, error: "FORBIDDEN" }
  if (items.length === 0) return { ok: false, error: "생산의뢰 품목이 없습니다." }

  try {
    const salesOrderForNote = await prisma.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: { orderNo: true },
    })
    const noteOrderRef = salesOrderForNote?.orderNo ?? ""
    const planNote = noteOrderRef
      ? `수주 기반 생산의뢰 (수주번호: ${noteOrderRef})`
      : "수주 기반 생산의뢰"

    const planNo = await withUniqueBusinessNumberRetry(async () => {
      const candidatePlanNo = await generateSalesRequestPlanNo(tenantId)
      await prisma.$transaction(async (tx) => {
        const plan = await tx.productionPlan.create({
          data: {
            tenantId,
            siteId,
            planNo: candidatePlanNo,
            planType: "DAILY",
            startDate: new Date(),
            endDate: new Date(),
            status: "DRAFT",
            note: planNote,
            items: {
              create: items.map((item) => ({
                itemId: item.itemId,
                plannedQty: item.qty,
                salesOrderItemId: item.salesOrderItemId,
              })),
            },
          },
        })

        // 수주 상태를 IN_PRODUCTION으로 전환
        await tx.salesOrder.update({
          where: { id: salesOrderId },
          data: { status: "IN_PRODUCTION" },
        })
        await recordAuditLog(tx, {
          tenantId,
          actor,
          entityType: "ProductionPlan",
          entityId: plan.id,
          action: "CREATE",
          afterData: {
            planNo: candidatePlanNo,
            sourceSalesOrderId: salesOrderId,
            sourceSalesOrderNo: noteOrderRef,
            itemCount: items.length,
            items: summarizeAuditItems(items, ["salesOrderItemId", "itemId", "qty"]),
          },
          menuName: "수주관리",
        })
        await recordAuditLog(tx, {
          tenantId,
          actor,
          entityType: "SalesOrder",
          entityId: salesOrderId,
          action: "UPDATE",
          afterData: { status: "IN_PRODUCTION", productionPlanId: plan.id, planNo: candidatePlanNo },
          menuName: "수주관리",
        })
      })
      return candidatePlanNo
    }, { fields: ["tenantId", "planNo"], message: "생산의뢰번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요." })

    revalidatePath("/app/mes/sales-orders")
    revalidatePath("/app/mes/production-plan")
    return { ok: true, planNo }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}
