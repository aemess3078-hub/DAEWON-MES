"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId, requireRole } from "@/lib/auth"
import { Prisma, PurchaseOrderStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { buildAuditChanges, recordAuditLog, summarizeAuditItems } from "@/lib/audit-log"
import { kstDateParts, withUniqueBusinessNumberRetry } from "@/lib/business-numbering"

// ─── Query Functions ──────────────────────────────────────────────────────────

export async function getPurchaseOrders(tenantId: string) {
  const rows = await prisma.purchaseOrder.findMany({
    where: {
      tenantId,
      NOT: [
        { orderNo: { startsWith: "OS-" } },
        { note: { contains: "[OUTSOURCING]" } },
      ],
    },
    include: {
      supplier: true,
      items: {
        include: {
          item: true,
          receivingInspections: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })
  return rows.map((o) => ({
    ...o,
    totalAmount: o.totalAmount !== null ? Number(o.totalAmount) : null,
    items: o.items.map((item) => ({
      ...item,
      qty:          Number(item.qty),
      unitPrice:    Number(item.unitPrice),
      receivedQty:  Number(item.receivedQty),
      stockAtOrder: Number(item.stockAtOrder),
      receivingInspections: item.receivingInspections.map((ri) => ({
        ...ri,
        receivedQty:  Number(ri.receivedQty),
        acceptedQty:  Number(ri.acceptedQty),
        rejectedQty:  Number(ri.rejectedQty),
      })),
    })),
  }))
}

// 자재입고 대기 목록 전용 조회
//  - 현재 site의 발주만 (다른 site 발주는 입고 site 창고와 불일치하여 서버 검증에서 거부됨)
//  - 입고 대기 상태(ORDERED / PARTIAL_RECEIVED)만
//  - 외주발주(OS- / [OUTSOURCING]) 제외 — getPurchaseOrders와 동일 정책
export async function getPendingPurchaseOrdersForReceipt(tenantId: string, siteId: string) {
  const rows = await prisma.purchaseOrder.findMany({
    where: {
      tenantId,
      siteId,
      status: { in: ["ORDERED", "PARTIAL_RECEIVED"] },
      NOT: [
        { orderNo: { startsWith: "OS-" } },
        { note: { contains: "[OUTSOURCING]" } },
      ],
    },
    include: {
      supplier: true,
      items: {
        include: {
          item: true,
          receivingInspections: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })
  return rows.map((o) => ({
    ...o,
    totalAmount: o.totalAmount !== null ? Number(o.totalAmount) : null,
    items: o.items.map((item) => ({
      ...item,
      qty:          Number(item.qty),
      unitPrice:    Number(item.unitPrice),
      receivedQty:  Number(item.receivedQty),
      stockAtOrder: Number(item.stockAtOrder),
      receivingInspections: item.receivingInspections.map((ri) => ({
        ...ri,
        receivedQty:  Number(ri.receivedQty),
        acceptedQty:  Number(ri.acceptedQty),
        rejectedQty:  Number(ri.rejectedQty),
      })),
    })),
  }))
}

export async function getSuppliers(tenantId: string) {
  return prisma.businessPartner.findMany({
    where: { tenantId, partnerType: { in: ["SUPPLIER", "BOTH"] } },
    orderBy: { name: "asc" },
  })
}

export async function getRawMaterials(tenantId: string) {
  return prisma.item.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      itemType: { in: ["RAW_MATERIAL", "SEMI_FINISHED", "CONSUMABLE"] },
    },
    orderBy: { name: "asc" },
  })
}

export async function getItemCurrentStock(
  itemId: string,
  tenantId: string
): Promise<{ qtyOnHand: number; qtyAvailable: number }> {
  const balances = await prisma.inventoryBalance.findMany({
    where: { itemId, tenantId },
  })
  const qtyOnHand = balances.reduce((s, b) => s + Number(b.qtyOnHand), 0)
  const qtyAvailable = balances.reduce((s, b) => s + Number(b.qtyAvailable), 0)
  return { qtyOnHand, qtyAvailable }
}

export async function getItemPrice(
  tenantId: string,
  itemId: string,
  partnerId: string
) {
  return prisma.itemPrice.findFirst({
    where: {
      tenantId,
      itemId,
      partnerId,
      priceType: "PURCHASE",
      effectiveFrom: { lte: new Date() },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
    },
    orderBy: { effectiveFrom: "desc" },
  })
}

// ─── Business Logic ───────────────────────────────────────────────────────────

async function generatePurchaseOrderNo(tenantId: string): Promise<string> {
  const { year } = kstDateParts()
  const prefix = `PO-${year}-`
  const last = await prisma.purchaseOrder.findFirst({
    where: { tenantId, orderNo: { startsWith: prefix } },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  })
  const seq = last ? (parseInt(last.orderNo.split("-")[2] ?? "0", 10) || 0) + 1 : 1
  return `${prefix}${String(seq).padStart(3, "0")}`
}

async function assertPurchaseOrderHasNoOperationalHistory(
  db: Pick<
    Prisma.TransactionClient,
    "purchaseOrderItem" | "receivingInspection" | "materialReturnItem" | "wipMovement"
  >,
  purchaseOrderId: string,
  tenantId: string
) {
  const items = await db.purchaseOrderItem.findMany({
    where: { purchaseOrderId, purchaseOrder: { tenantId } },
    select: { id: true },
  })
  const itemIds = items.map((item) => item.id)
  if (itemIds.length === 0) return

  const [receivingCount, materialReturnCount, wipMovementCount] = await Promise.all([
    db.receivingInspection.count({ where: { purchaseOrderItemId: { in: itemIds } } }),
    db.materialReturnItem.count({
      where: {
        purchaseOrderItemId: { in: itemIds },
        materialReturn: { tenantId, status: "COMPLETED" },
      },
    }),
    db.wipMovement.count({
      where: {
        tenantId,
        sourceType: "PurchaseOrderItem",
        sourceId: { in: itemIds },
      },
    }),
  ])

  if (receivingCount > 0 || materialReturnCount > 0 || wipMovementCount > 0) {
    throw new Error(
      `발주 처리 이력이 있어 품목 재구성/삭제를 할 수 없습니다. 입고검사 ${receivingCount}건, 자재반품 ${materialReturnCount}건, 외주이동 ${wipMovementCount}건`
    )
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export type CreatePurchaseOrderItemInput = {
  itemId: string
  qty: number
  unitPrice: number
  note?: string
}

export type CreatePurchaseOrderInput = {
  supplierId: string
  orderDate: Date
  expectedDate: Date
  status: PurchaseOrderStatus
  totalAmount?: number
  currency?: string
  note?: string
  items: CreatePurchaseOrderItemInput[]
}

export async function createPurchaseOrder(
  tenantId: string,
  siteId: string,
  data: CreatePurchaseOrderInput
) {
  await requireResourcePermission("PURCHASE_ORDER", "CREATE")
  const actor = await requireRole("OPERATOR")
  if (actor.tenantId !== tenantId) throw new Error("FORBIDDEN")
  const itemsWithStock = await Promise.all(
    data.items.map(async (item) => {
      const stock = await getItemCurrentStock(item.itemId, tenantId)
      return { ...item, stockAtOrder: stock.qtyOnHand }
    })
  )

  await withUniqueBusinessNumberRetry(async () => {
    const orderNo = await generatePurchaseOrderNo(tenantId)
    await prisma.$transaction(async (tx) => {
    const created = await tx.purchaseOrder.create({
      data: {
        tenantId,
        siteId,
        supplierId: data.supplierId,
        orderNo,
        orderDate: data.orderDate,
        expectedDate: data.expectedDate,
        status: data.status,
        totalAmount: data.totalAmount,
        currency: data.currency ?? "KRW",
        note: data.note,
        items: {
          create: itemsWithStock.map((item) => ({
            itemId: item.itemId,
            qty: item.qty,
            unitPrice: item.unitPrice,
            stockAtOrder: item.stockAtOrder,
            note: item.note,
          })),
        },
      },
    })
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "PurchaseOrder",
      entityId: created.id,
      action: "CREATE",
      afterData: {
        orderNo,
        siteId,
        supplierId: data.supplierId,
        status: data.status,
        itemCount: itemsWithStock.length,
        items: summarizeAuditItems(itemsWithStock, ["itemId", "qty", "unitPrice", "stockAtOrder"]),
      },
      menuName: "발주관리",
    })
  })
  }, { fields: ["tenantId", "orderNo"], message: "발주번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요." })

  revalidatePath("/app/mes/purchase-orders")
}

export type UpdatePurchaseOrderInput = {
  supplierId?: string
  orderDate?: Date
  expectedDate?: Date
  status?: PurchaseOrderStatus
  totalAmount?: number
  currency?: string
  note?: string
  items?: CreatePurchaseOrderItemInput[]
}

export async function updatePurchaseOrder(id: string, data: UpdatePurchaseOrderInput) {
  await requireResourcePermission("PURCHASE_ORDER", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = actor.tenantId
  const current = await prisma.purchaseOrder.findFirstOrThrow({ where: { id, tenantId } })
  const canEditItems = current.status === "DRAFT"

  await prisma.$transaction(async (tx) => {
    if (canEditItems && data.items) {
      await assertPurchaseOrderHasNoOperationalHistory(tx, id, tenantId)
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } })
    }
    if (data.supplierId !== undefined && data.supplierId !== current.supplierId) {
      await assertPurchaseOrderHasNoOperationalHistory(tx, id, tenantId)
    }
    const updated = await tx.purchaseOrder.update({
      where: { id, tenantId },
      data: {
        ...(data.supplierId !== undefined && { supplierId: data.supplierId }),
        ...(data.orderDate !== undefined && { orderDate: data.orderDate }),
        ...(data.expectedDate !== undefined && { expectedDate: data.expectedDate }),
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
              note: item.note,
            })),
          },
        }),
      },
      include: { items: true },
    })
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "PurchaseOrder",
      entityId: id,
      action: "UPDATE",
      beforeData: current,
      afterData: {
        changes: buildAuditChanges(current as any, updated as any, [
          "supplierId",
          "orderDate",
          "expectedDate",
          "status",
          "totalAmount",
          "currency",
          "note",
        ]),
        itemCount: updated.items.length,
      },
      menuName: "발주관리",
    })
  })

  revalidatePath("/app/mes/purchase-orders")
}

export async function deletePurchaseOrder(id: string) {
  await requireResourcePermission("PURCHASE_ORDER", "DELETE")
  const actor = await requireRole("OPERATOR")
  const tenantId = actor.tenantId
  const order = await prisma.purchaseOrder.findFirstOrThrow({
    where: { id, tenantId },
    include: { items: true },
  })
  if (order.status !== "DRAFT") {
    throw new Error("DRAFT 상태인 발주만 삭제할 수 있습니다.")
  }
  await prisma.$transaction(async (tx) => {
    await assertPurchaseOrderHasNoOperationalHistory(tx, id, tenantId)
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } })
    await tx.purchaseOrder.delete({ where: { id, tenantId } })
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "PurchaseOrder",
      entityId: id,
      action: "DELETE",
      beforeData: {
        orderNo: order.orderNo,
        supplierId: order.supplierId,
        status: order.status,
        itemCount: order.items.length,
      },
      menuName: "발주관리",
    })
  })
  revalidatePath("/app/mes/purchase-orders")
}
