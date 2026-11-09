"use server"

import { prisma } from "@/lib/db/prisma"
import { requireRole, requireTenantAccess } from "@/lib/auth"
import { PlanStatus, Prisma, SalesOrderStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { getErrorMessage } from "@/lib/utils"
import { hasResourcePermission, getCurrentPermissionSnapshot, requireResourcePermission } from "@/lib/auth/role-permissions"
import { buildAuditChanges, recordAuditLog, summarizeAuditItems } from "@/lib/audit-log"
import { kstDateParts, withUniqueBusinessNumberRetry } from "@/lib/business-numbering"
import { getSalesOrderProgressForTenant } from "@/lib/sales-order-progress.server"
import { lockSalesOrderItemsForUpdate } from "@/lib/quantity-concurrency"
import { NEW_PLAN_STATUS } from "@/lib/production-plan-status"
import {
  SALES_ORDER_STATUS_LABEL,
  isTerminalSalesOrderStatus,
  resolveNewSalesOrderStatus,
  salesOrderItemEditBlockReason,
  sameSalesOrderItems,
  validateSalesOrderItemEditInput,
  validateSalesOrderStatusChange,
  type SalesOrderFollowUp,
  type SalesOrderStatusValue,
} from "@/lib/sales-order-status"
import { formatScaledQuantity, toScaledQuantity } from "@/lib/quantity-scale"
import {
  PRODUCTION_REQUEST_CONFLICT_MESSAGE,
  PRODUCTION_REQUEST_ID_INVALID_MESSAGE,
  PRODUCTION_REQUEST_TERMINAL_ORDER_MESSAGE,
  findProductionRequestViolation,
  hashProductionRequest,
  isValidProductionRequestId,
  normalizeRequestLines,
  productionRequestTag,
  productionRequestTagPrefix,
  productionRequestViolationMessage,
} from "@/lib/production-request"

// ─── Query Functions ──────────────────────────────────────────────────────────

export async function getSalesOrders(tenantId: string) {
  await requireTenantAccess(tenantId)
  const rows = await prisma.salesOrder.findMany({
    where: { tenantId },
    include: {
      customer: true,
      items: {
        include: {
          item: true,
          // 품목 수정 가능 여부 판단용(취소되지 않은 생산계획). 화면에는 사유 문장만 내려보낸다.
          productionPlanItems: { where: { plan: { tenantId, status: { not: "CANCELLED" } } }, select: { plan: { select: { planNo: true } } } },
        },
      },
      shipments: true,
    },
    orderBy: { createdAt: "desc" },
  })
  return rows.map((o) => {
    // 서버(updateSalesOrder)가 최종 판정하고, 화면은 같은 규칙으로 미리 입력을 막아 안내한다(작업지시는 활성 생산계획이 있어야 존재하므로 계획으로 갈음)
    const liveShipments = o.shipments.filter((s) => s.status !== "CANCELLED")
    const itemEditBlockedReason = salesOrderItemEditBlockReason(o.status as SalesOrderStatusValue, {
      activePlanNos: Array.from(new Set(o.items.flatMap((i) => i.productionPlanItems.map((p) => p.plan.planNo)))).sort(),
      workOrderNos: [],
      shipmentNos: liveShipments.map((s) => s.shipmentNo).sort(),
      openShipmentNos: [],
      fullyShipped: false,
      hasShippedQty: o.items.some((i) => Number(i.shippedQty) > 0),
    })
    return {
      ...o,
      itemEditBlockedReason,
      totalAmount: o.totalAmount !== null ? Number(o.totalAmount) : null,
      items: o.items.map(({ productionPlanItems: _pp, ...i }) => ({
        ...i,
        qty:         Number(i.qty),
        unitPrice:   i.unitPrice   !== null ? Number(i.unitPrice)   : null,
        producedQty: Number(i.producedQty),
        shippedQty:  Number(i.shippedQty),
      })),
    }
  })
}

export type SalesOrderStatusRow = Awaited<ReturnType<typeof getSalesOrderStatusRows>>[number]

export async function getSalesOrderStatusRows(tenantId: string) {
  await requireTenantAccess(tenantId)
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
  await requireTenantAccess(tenantId)
  return prisma.businessPartner.findMany({
    where: { tenantId, partnerType: { in: ["CUSTOMER", "BOTH"] } },
    orderBy: { name: "asc" },
  })
}

export async function getItemsForSales(tenantId: string) {
  await requireTenantAccess(tenantId)
  return prisma.item.findMany({
    where: { tenantId, status: "ACTIVE", itemType: "FINISHED" },
    orderBy: { name: "asc" },
  })
}

// ─── Business Logic ───────────────────────────────────────────────────────────

export async function generateSalesOrderNo(tenantId: string): Promise<string> {
  await requireTenantAccess(tenantId)
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
  /** 구 클라이언트 호환용. 값과 무관하게 서버가 CONFIRMED 로 저장한다(등록 즉시 확정). 초안·확정 외의 값은 거부한다. */
  status?: SalesOrderStatus
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
  // 신규 수주는 등록 즉시 확정(CONFIRMED)으로 저장한다. 화면이 보낸 상태값과 무관하며 서버가 최종 결정한다.
  // (생산중·부분출하·출하완료는 처리 결과로 자동 변경되고, 완료·취소는 등록 대상이 아니다. 기존 초안 수주는 건드리지 않는다.)
  const resolvedStatus = resolveNewSalesOrderStatus(data.status)
  if (!resolvedStatus.ok) throw new Error(resolvedStatus.error)
  const newStatus = resolvedStatus.status as SalesOrderStatus
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
          status: newStatus,
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
          status: newStatus,
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

export async function updateSalesOrder(id: string, data: UpdateSalesOrderInput): Promise<{ ok: boolean; error?: string }> {
  await requireResourcePermission("SALES_ORDER", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = actor.tenantId

  try {
    await prisma.$transaction(async (tx) => {
      const head = await tx.salesOrder.findFirst({ where: { id, tenantId }, select: { items: { select: { id: true } } } })
      if (!head) throw new Error("수주를 찾을 수 없습니다.")
      // 같은 수주 품목을 쓰는 생산의뢰·출하 등록·출하 확정과 같은 잠금(수주 품목 행)을 먼저 잡아 직렬화한다.
      // 잠금 이후의 상태와 이력으로 판정하므로 취소와 출하가 동시에 성공해 모순이 생기지 않는다.
      await lockSalesOrderItemsForUpdate(tx, tenantId, head.items.map((i) => i.id))
      const current = await tx.salesOrder.findFirstOrThrow({ where: { id, tenantId }, include: { items: { include: { item: { select: { code: true } } } } } })
      const itemIds = current.items.map((i) => i.id)

      const currentStatus = current.status as SalesOrderStatusValue
      const target = data.status as SalesOrderStatusValue | undefined
      if (target !== undefined && !(target in SALES_ORDER_STATUS_LABEL)) throw new Error("올바르지 않은 수주 상태입니다.")
      if (isTerminalSalesOrderStatus(currentStatus)) {
        throw new Error(`${SALES_ORDER_STATUS_LABEL[currentStatus]} 수주는 수정할 수 없습니다.`)
      }

      const followUp = await loadSalesOrderFollowUp(tx, tenantId, current.items)
      if (target !== undefined) {
        const reason = validateSalesOrderStatusChange(currentStatus, target, followUp)
        if (reason) throw new Error(reason)
      }
      // 품목·수량 수정: 초안·확정 수주에 후속 업무(생산계획·작업지시·출하·출하 수량)가 없을 때만 허용한다(수주 충당·출하 수량·LOT 연결 보호).
      // 후속 업무가 있는데 품목이 바뀐 요청은 거부하고, 품목이 그대로인 일반 수정(비고·고객·납기 등)은 통과시킨다.
      let applyItems = false
      if (data.items) {
        const blocked = salesOrderItemEditBlockReason(currentStatus, followUp)
        const unchanged = sameSalesOrderItems(current.items, data.items)
        if (blocked) {
          if (!unchanged) throw new Error(blocked)
        } else if (!unchanged) {
          const inputError = validateSalesOrderItemEditInput(data.items)
          if (inputError) throw new Error(inputError)
          applyItems = true
        }
      }

      if (applyItems && data.items) {
        // 품목 줄은 지우고 다시 만들지 않고 제자리에서 고친다(줄 ID 보존). 취소된 생산계획·출하 이력이 걸린 줄은 삭제할 수 없다.
        const wanted = new Map(data.items.map((i) => [i.itemId, i]))
        for (const cur of current.items) {
          if (wanted.has(cur.itemId)) continue
          const [planRefs, shipRefs] = await Promise.all([
            tx.productionPlanItem.count({ where: { salesOrderItemId: cur.id } }),
            tx.shipmentItem.count({ where: { salesOrderItemId: cur.id } }),
          ])
          if (planRefs + shipRefs > 0) throw new Error(`'${cur.item.code}' 품목에는 취소된 생산계획·출하 이력이 남아 있어 삭제할 수 없습니다. 수량은 수정할 수 있습니다.`)
          await tx.salesOrderItem.delete({ where: { id: cur.id } })
        }
        const existingByItem = new Map(current.items.map((c) => [c.itemId, c]))
        for (const item of data.items) {
          const cur = existingByItem.get(item.itemId)
          if (cur) {
            await tx.salesOrderItem.update({
              where: { id: cur.id },
              data: {
                qty: item.qty,
                unitPrice: item.unitPrice ?? null,
                ...(item.deliveryDate !== undefined && { deliveryDate: item.deliveryDate }),
                ...(item.note !== undefined && { note: item.note }),
              },
            })
          } else {
            await tx.salesOrderItem.create({
              data: { salesOrderId: id, itemId: item.itemId, qty: item.qty, unitPrice: item.unitPrice, deliveryDate: item.deliveryDate, note: item.note },
            })
          }
        }
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
          ...(applyItems && data.items ? { itemsChanged: true, items: summarizeAuditItems(data.items, ["itemId", "qty", "unitPrice"]) } : {}),
        },
        menuName: "수주관리",
      })
    })
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
  revalidatePath("/app/mes/sales-orders")
  return { ok: true }
}

/** 수주에 연결된 후속 업무(취소되지 않은 생산계획·작업지시·출하)와 출하 진행 정도를 조회한다. 잠금을 잡은 트랜잭션 안에서 호출한다. */
async function loadSalesOrderFollowUp(
  tx: Prisma.TransactionClient,
  tenantId: string,
  items: Array<{ id: string; qty: unknown; shippedQty: unknown }>
): Promise<SalesOrderFollowUp> {
  const itemIds = items.map((i) => i.id)
  if (itemIds.length === 0) return { activePlanNos: [], workOrderNos: [], shipmentNos: [], openShipmentNos: [], fullyShipped: false, hasShippedQty: false }
  const [planItems, workOrders, shipmentItems] = await Promise.all([
    tx.productionPlanItem.findMany({
      where: { salesOrderItemId: { in: itemIds }, plan: { tenantId, status: { not: "CANCELLED" } } },
      select: { plan: { select: { planNo: true } } },
    }),
    tx.workOrder.findMany({
      where: { tenantId, status: { not: "CANCELLED" }, productionPlanItem: { salesOrderItemId: { in: itemIds } } },
      select: { orderNo: true },
    }),
    tx.shipmentItem.findMany({
      where: { salesOrderItemId: { in: itemIds }, shipmentOrder: { tenantId, status: { not: "CANCELLED" } } },
      select: { shipmentOrder: { select: { shipmentNo: true, status: true } } },
    }),
  ])
  const uniq = (a: string[]) => Array.from(new Set(a)).sort()
  const shipments = new Map(shipmentItems.map((s) => [s.shipmentOrder.shipmentNo, s.shipmentOrder.status]))
  return {
    activePlanNos: uniq(planItems.map((p) => p.plan.planNo)),
    workOrderNos: uniq(workOrders.map((w) => w.orderNo)),
    shipmentNos: uniq(Array.from(shipments.keys())),
    openShipmentNos: uniq(Array.from(shipments.entries()).filter(([, st]) => st === "PLANNED" || st === "PICKED").map(([no]) => no)),
    fullyShipped: items.every((i) => Number(i.shippedQty) >= Number(i.qty)),
    hasShippedQty: items.some((i) => Number(i.shippedQty) > 0),
  }
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
  await requireTenantAccess(tenantId)
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
  await requireTenantAccess(tenantId)
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

async function generateSalesRequestPlanNo(db: Pick<typeof prisma, "productionPlan">, tenantId: string): Promise<string> {
  const { yyyymmdd } = kstDateParts()
  const prefix = `PP-REQ-${yyyymmdd}`
  const last = await db.productionPlan.findFirst({
    where: { tenantId, planNo: { startsWith: prefix } },
    orderBy: { planNo: "desc" },
    select: { planNo: true },
  })
  const seq = last ? (parseInt(last.planNo.split("-")[3] ?? "0", 10) || 0) + 1 : 1
  return `${prefix}-${String(seq).padStart(3, "0")}`
}

/**
 * 수주 기반 생산의뢰 (N-14).
 * 수주 품목별 의뢰 가능 잔량(수주 수량 − 취소되지 않은 계획의 연결 수량)을 서버가 계산해 초과 요청을 거부하고,
 * 같은 수주 품목의 동시 요청은 수주 품목 행 잠금으로 직렬화한다. requestId(선택)가 같은 재전송은 새 계획 없이 처음 결과를 돌려준다.
 */
export async function requestProductionFromSalesOrder(
  salesOrderId: string,
  items: { salesOrderItemId: string; itemId: string; qty: number; extraQty?: number | null; extraReason?: string | null }[],
  tenantId: string,
  siteId: string,
  requestId?: string
): Promise<{ ok: boolean; planNo?: string; error?: string; replayed?: boolean }> {
  await requireResourcePermission("SALES_ORDER", "UPDATE")
  await requireResourcePermission("PRODUCTION_PLAN", "CREATE")
  const actor = await requireRole("OPERATOR")
  if (actor.tenantId !== tenantId) return { ok: false, error: "FORBIDDEN" }
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "생산의뢰 품목이 없습니다." }
  if (requestId !== undefined && !isValidProductionRequestId(requestId)) return { ok: false, error: PRODUCTION_REQUEST_ID_INVALID_MESSAGE }
  const normalized = normalizeRequestLines(items)
  if (!normalized.ok) return { ok: false, error: normalized.error }
  const lines = normalized.lines
  const requestHash = hashProductionRequest(salesOrderId, lines)

  try {
    const result = await withUniqueBusinessNumberRetry(async () => {
      return prisma.$transaction(async (tx) => {
        // 같은 수주 품목의 의뢰를 직렬화한다(동시 요청이 서로의 의뢰 수량을 보기 전에 잔량을 판정하지 못하게 함)
        await lockSalesOrderItemsForUpdate(tx, tenantId, lines.map((l) => l.salesOrderItemId))

        if (requestId) {
          const prior = await tx.productionPlan.findFirst({
            where: { tenantId, note: { contains: productionRequestTagPrefix(requestId) } },
            select: { planNo: true, note: true },
          })
          if (prior) {
            if ((prior.note ?? "").includes(productionRequestTag(requestId, requestHash))) return { planNo: prior.planNo, replayed: true }
            throw new Error(PRODUCTION_REQUEST_CONFLICT_MESSAGE)
          }
        }

        const salesOrder = await tx.salesOrder.findFirst({
          where: { id: salesOrderId, tenantId },
          select: { orderNo: true, status: true, items: { select: { id: true, itemId: true, qty: true, item: { select: { code: true } } } } },
        })
        if (!salesOrder) throw new Error("수주를 찾을 수 없습니다.")
        if (["CANCELLED", "CLOSED", "SHIPPED"].includes(salesOrder.status)) throw new Error(PRODUCTION_REQUEST_TERMINAL_ORDER_MESSAGE)

        const ordered = new Map<string, bigint>()
        for (const line of lines) {
          const soi = salesOrder.items.find((i) => i.id === line.salesOrderItemId)
          if (!soi) throw new Error("해당 수주의 품목이 아닙니다. 화면을 새로고침한 뒤 다시 시도해 주세요.")
          if (soi.itemId !== line.itemId) throw new Error("수주 품목과 생산의뢰 품목이 일치하지 않습니다.")
          ordered.set(soi.id, toScaledQuantity(String(soi.qty)) ?? BigInt(0))
        }
        // 이미 충당된 수량: 취소되지 않은 생산계획(초안·확정·진행·완료)의 수주 충당 수량(allocatedQty). 여유 생산분은 포함하지 않는다.
        const requestedRows = await tx.productionPlanItem.groupBy({
          by: ["salesOrderItemId"],
          where: { salesOrderItemId: { in: lines.map((l) => l.salesOrderItemId) }, plan: { tenantId, status: { not: "CANCELLED" } } },
          _sum: { allocatedQty: true },
        })
        const already = new Map(requestedRows.map((r) => [r.salesOrderItemId as string, toScaledQuantity(String(r._sum.allocatedQty ?? 0)) ?? BigInt(0)]))
        const violation = findProductionRequestViolation(lines, ordered, already)
        if (violation) {
          const code = salesOrder.items.find((i) => i.id === violation.salesOrderItemId)?.item.code ?? violation.salesOrderItemId
          throw new Error(productionRequestViolationMessage(code, violation))
        }

        const candidatePlanNo = await generateSalesRequestPlanNo(tx, tenantId)
        const baseNote = `수주 기반 생산의뢰 (수주번호: ${salesOrder.orderNo})`
        const plan = await tx.productionPlan.create({
          data: {
            tenantId,
            siteId,
            planNo: candidatePlanNo,
            planType: "DAILY",
            startDate: new Date(),
            endDate: new Date(),
            // 생산의뢰로 만드는 계획은 등록 즉시 확정(작업지시 생성 가능). 여유 생산 승인 상태(extraApprovalStatus)는 DB 기본값을 그대로 둔다.
            status: NEW_PLAN_STATUS as PlanStatus,
            note: requestId ? `${baseNote} ${productionRequestTag(requestId, requestHash)}` : baseNote,
            items: {
              // 계획 수량 = 수주 충당 수량 + 여유 수량. 여유가 있으면 ORDER_EXTRA(사유 필수), 없으면 ORDER.
              create: lines.map((line) => {
                const plannedScaled = line.qtyScaled + line.extraScaled
                return {
                  itemId: line.itemId,
                  plannedQty: formatScaledQuantity(plannedScaled),
                  allocatedQty: formatScaledQuantity(line.qtyScaled),
                  productionKind: line.extraScaled > BigInt(0) ? ("ORDER_EXTRA" as const) : ("ORDER" as const),
                  extraReason: line.extraScaled > BigInt(0) ? line.extraReason : null,
                  salesOrderItemId: line.salesOrderItemId,
                }
              }),
            },
          },
        })

        // 수주 상태를 IN_PRODUCTION으로 전환
        await tx.salesOrder.update({ where: { id: salesOrderId }, data: { status: "IN_PRODUCTION" } })
        await recordAuditLog(tx, {
          tenantId,
          actor,
          entityType: "ProductionPlan",
          entityId: plan.id,
          action: "CREATE",
          afterData: {
            planNo: candidatePlanNo,
            sourceSalesOrderId: salesOrderId,
            sourceSalesOrderNo: salesOrder.orderNo,
            requestId: requestId ?? null,
            itemCount: items.length,
            items: summarizeAuditItems(items, ["salesOrderItemId", "itemId", "qty", "extraQty", "extraReason"]),
            plannedQtyTotal: formatScaledQuantity(lines.reduce((s, l) => s + l.qtyScaled + l.extraScaled, BigInt(0))),
            allocatedQtyTotal: formatScaledQuantity(lines.reduce((s, l) => s + l.qtyScaled, BigInt(0))),
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
        return { planNo: candidatePlanNo, replayed: false }
      })
    }, { fields: ["tenantId", "planNo"], message: "생산의뢰번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요." })

    if (result.replayed) return { ok: true, planNo: result.planNo, replayed: true } // 같은 요청 ID 의 재전송 — 이번 호출에서는 아무것도 쓰지 않았다
    revalidatePath("/app/mes/sales-orders")
    revalidatePath("/app/mes/production-plan")
    return { ok: true, planNo: result.planNo }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}
