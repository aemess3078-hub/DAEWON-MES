"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId, requireRole } from "@/lib/auth"
import { Prisma, PurchaseOrderStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { buildAuditChanges, recordAuditLog, summarizeAuditItems } from "@/lib/audit-log"
import { kstDateParts, withUniqueBusinessNumberRetry } from "@/lib/business-numbering"
import { lockPurchaseOrderItemsForUpdate } from "@/lib/quantity-concurrency"
import { allocatePurchaseOrderNumbers } from "@/lib/services/purchase-order-number.service"
import {
  closePurchaseOrderRemainder as closePurchaseOrderRemainderCore,
  type PurchaseOrderCloseResult,
} from "@/lib/services/purchase-order-close.service"
import { requireActor, requireReadActor, assertSessionTenant } from "@/lib/auth/action-guards"
import { PO_CREATE_STATUSES, isAllowedPurchaseOrderTransition, transitionRequiresNoHistory } from "@/lib/purchase-order-status"

// ─── Query Functions ──────────────────────────────────────────────────────────

export async function getPurchaseOrders(tenantId: string) {
  const sessionActor = await requireReadActor("PURCHASE_ORDER")
  assertSessionTenant(sessionActor, tenantId)
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
  const sessionActor = await requireReadActor("PURCHASE_ORDER")
  assertSessionTenant(sessionActor, tenantId)
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
  const sessionActor = await requireReadActor(["PURCHASE_ORDER", "PARTNER_MANAGEMENT"])
  assertSessionTenant(sessionActor, tenantId)
  return prisma.businessPartner.findMany({
    where: { tenantId, partnerType: { in: ["SUPPLIER", "BOTH"] } },
    orderBy: { name: "asc" },
  })
}

export async function getRawMaterials(tenantId: string) {
  const sessionActor = await requireReadActor(["PURCHASE_ORDER", "ITEM"])
  assertSessionTenant(sessionActor, tenantId)
  return prisma.item.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      itemType: { in: ["RAW_MATERIAL", "SEMI_FINISHED", "CONSUMABLE"] },
    },
    orderBy: { name: "asc" },
  })
}

// 서버 내부(이미 인증된 createPurchaseOrder 루프)에서 재사용하는 비공개 조회 — 품목마다 권한 쿼리를 반복하지 않는다.
async function loadItemCurrentStock(
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

export async function getItemCurrentStock(
  itemId: string,
  tenantId: string
): Promise<{ qtyOnHand: number; qtyAvailable: number }> {
  const sessionActor = await requireReadActor("PURCHASE_ORDER")
  assertSessionTenant(sessionActor, tenantId)
  return loadItemCurrentStock(itemId, tenantId)
}

export async function getItemPrice(
  tenantId: string,
  itemId: string,
  partnerId: string
) {
  const sessionActor = await requireReadActor(["PURCHASE_ORDER", "ITEM_PRICE"])
  assertSessionTenant(sessionActor, tenantId)
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

// 발주번호는 purchase-order-number.service.ts 에서 트랜잭션 안에서 확보한다(Phase 5C):
// 연도별 숫자 최대값 + 1, 6자리 이상 순번, (tenant, 연도) advisory lock.

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

// 발주 입력 무결성: 수량/단가 숫자 검증 + site/supplier/item 이 세션 tenant 소유인지 확인(DG-021).
function assertPurchaseOrderItemInputs(items: { itemId: string; qty: number; unitPrice: number }[]) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("발주 품목을 1개 이상 입력해 주세요.")
  const seen = new Set<string>()
  for (const item of items) {
    if (!item.itemId) throw new Error("품목을 선택해 주세요.")
    if (seen.has(item.itemId)) throw new Error("같은 품목을 한 발주에 중복 등록할 수 없습니다.")
    seen.add(item.itemId)
    if (!Number.isFinite(item.qty) || item.qty <= 0) throw new Error("발주수량은 0보다 큰 숫자여야 합니다.")
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw new Error("발주단가는 0 이상의 숫자여야 합니다.")
  }
}

async function assertPurchaseOrderRelationsOwned(
  tenantId: string,
  rel: { siteId?: string; supplierId?: string; itemIds?: string[] }
) {
  const itemIds = Array.from(new Set(rel.itemIds ?? []))
  const [site, supplier, itemCount] = await Promise.all([
    rel.siteId ? prisma.site.findFirst({ where: { id: rel.siteId, tenantId }, select: { id: true } }) : Promise.resolve(true),
    rel.supplierId
      ? prisma.businessPartner.findFirst({
          where: { id: rel.supplierId, tenantId, partnerType: { in: ["SUPPLIER", "BOTH"] } },
          select: { id: true },
        })
      : Promise.resolve(true),
    itemIds.length > 0 ? prisma.item.count({ where: { id: { in: itemIds }, tenantId } }) : Promise.resolve(0),
  ])
  if (!site) throw new Error("사업장을 찾을 수 없습니다.")
  if (!supplier) throw new Error("공급처를 찾을 수 없습니다.")
  if (itemCount !== itemIds.length) throw new Error("발주 품목 중 사용할 수 없는 품목이 있습니다.")
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
  if (!PO_CREATE_STATUSES.includes(data.status)) {
    throw new Error("발주 생성 시에는 초안 또는 발주완료 상태만 지정할 수 있습니다.")
  }
  assertPurchaseOrderItemInputs(data.items)
  await assertPurchaseOrderRelationsOwned(tenantId, {
    siteId,
    supplierId: data.supplierId,
    itemIds: data.items.map((item) => item.itemId),
  })
  const itemsWithStock = await Promise.all(
    data.items.map(async (item) => {
      const stock = await loadItemCurrentStock(item.itemId, tenantId)
      return { ...item, stockAtOrder: stock.qtyOnHand }
    })
  )

  await withUniqueBusinessNumberRetry(async () => {
    await prisma.$transaction(async (tx) => {
    // 번호 확보와 생성을 같은 트랜잭션에서 수행한다(채번 잠금이 생성까지 유지된다)
    const [orderNo] = await allocatePurchaseOrderNumbers(tx, tenantId, 1, { year: kstDateParts().year })
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

  // 상태 전이 검증: 입고/종결 상태는 시스템 처리(입고·잔량 종결)로만 바뀐다.
  const statusChanged = data.status !== undefined && data.status !== current.status
  if (data.status !== undefined && !isAllowedPurchaseOrderTransition(current.status, data.status)) {
    throw new Error(`발주 상태를 ${current.status} 에서 ${data.status} (으)로 변경할 수 없습니다.`)
  }
  if (canEditItems && data.items) assertPurchaseOrderItemInputs(data.items)
  await assertPurchaseOrderRelationsOwned(tenantId, {
    supplierId: data.supplierId,
    itemIds: canEditItems ? data.items?.map((item) => item.itemId) : undefined,
  })

  await prisma.$transaction(async (tx) => {
    if (statusChanged && data.status && transitionRequiresNoHistory(current.status, data.status)) {
      await assertPurchaseOrderHasNoOperationalHistory(tx, id, tenantId)
    }
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

/**
 * 미입고 잔량 종결 (Phase 5B): 발주완료/부분입고 발주를 CLOSED 로 바꿔 남은 수량을 더 이상 입고예정으로 계산하지 않는다.
 * 발주수량·입고수량은 그대로 보존된다. 권한: PURCHASE_ORDER UPDATE. tenantId 는 인증 컨텍스트에서만 결정한다.
 */
export async function closePurchaseOrderRemainder(
  purchaseOrderId: string,
  reason?: string
): Promise<PurchaseOrderCloseResult> {
  const result = await closePurchaseOrderRemainderCore(
    {
      authorize: async () => {
        await requireResourcePermission("PURCHASE_ORDER", "UPDATE")
        const actor = await requireRole("OPERATOR")
        return { id: actor.id, name: actor.name, tenantId: actor.tenantId }
      },
      db: prisma,
      lockItems: (tx, tenantId, ids) => lockPurchaseOrderItemsForUpdate(tx, tenantId, ids),
    },
    purchaseOrderId,
    reason
  )
  if (result.success) {
    revalidatePath("/app/mes/purchase-orders")
    revalidatePath("/app/mes/material-receipt")
  }
  return result
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
