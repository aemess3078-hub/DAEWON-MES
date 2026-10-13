"use server"

import { prisma } from "@/lib/db/prisma"
import { requireRole } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { assertLotQualityReleaseAllowed } from "./quality-release-gate.helpers"
import type { Prisma } from "@prisma/client"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import {
  lockInventoryBalancesForUpdate,
  lockSalesOrderItemsForUpdate,
  withQuantityTransactionRetry,
} from "@/lib/quantity-concurrency"
import { recordAuditLog, summarizeAuditItems } from "@/lib/audit-log"
import { kstDateParts, withUniqueBusinessNumberRetry } from "@/lib/business-numbering"

export async function getShipments(tenantId: string) {
  const rows = await prisma.shipmentOrder.findMany({
    where: { tenantId },
    include: {
      salesOrder: { include: { customer: true } },
      items: {
        include: {
          salesOrderItem: { include: { item: true } },
          item: true,
          lot: { select: { id: true, lotNo: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })
  return rows.map((o) => ({
    ...o,
    salesOrder: {
      ...o.salesOrder,
      totalAmount: o.salesOrder.totalAmount !== null ? Number(o.salesOrder.totalAmount) : null,
    },
    items: o.items.map((item) => ({
      ...item,
      qty: Number(item.qty),
      salesOrderItem: {
        ...item.salesOrderItem,
        qty: Number(item.salesOrderItem.qty),
        unitPrice: item.salesOrderItem.unitPrice !== null ? Number(item.salesOrderItem.unitPrice) : null,
        producedQty: Number(item.salesOrderItem.producedQty),
        shippedQty: Number(item.salesOrderItem.shippedQty),
      },
    })),
  }))
}

export type DeliveryStatusRow = Awaited<ReturnType<typeof getDeliveryStatusRows>>[number]

export async function getDeliveryStatusRows(tenantId: string) {
  const rows = await prisma.shipmentOrder.findMany({
    where: { tenantId },
    select: {
      id: true,
      shipmentNo: true,
      status: true,
      plannedDate: true,
      shippedDate: true,
      deliveredDate: true,
      salesOrder: {
        select: {
          id: true,
          orderNo: true,
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
      },
      items: {
        select: {
          id: true,
          qty: true,
          lotId: true,
          lot: { select: { id: true, lotNo: true } },
          item: {
            select: {
              id: true,
              code: true,
              name: true,
              uom: true,
            },
          },
          salesOrderItem: {
            select: {
              id: true,
              qty: true,
              shippedQty: true,
            },
          },
        },
        orderBy: { item: { code: "asc" } },
      },
    },
    orderBy: [{ plannedDate: "desc" }, { shipmentNo: "desc" }],
  })
  return rows.map((o) => ({
    ...o,
    salesOrder: {
      ...o.salesOrder,
      items: o.salesOrder.items.map((i) => ({
        ...i,
        qty: Number(i.qty),
        shippedQty: Number(i.shippedQty),
      })),
    },
    items: o.items.map((item) => ({
      ...item,
      qty: Number(item.qty),
      salesOrderItem: {
        ...item.salesOrderItem,
        qty: Number(item.salesOrderItem.qty),
        shippedQty: Number(item.salesOrderItem.shippedQty),
      },
    })),
  }))
}

export async function getShippableSalesOrders(tenantId: string) {
  const user = await requireRole("VIEWER")
  if (user.tenantId !== tenantId) {
    throw new Error("FORBIDDEN")
  }

  const rows = await prisma.salesOrder.findMany({
    where: {
      tenantId,
      status: { in: ["CONFIRMED", "IN_PRODUCTION", "PARTIAL_SHIPPED"] },
    },
    select: {
      id: true,
      orderNo: true,
      status: true,
      deliveryDate: true,
      customer: { select: { name: true } },
      items: {
        select: {
          id: true,
          itemId: true,
          qty: true,
          shippedQty: true,
          item: { select: { id: true, code: true, name: true, isLotTracked: true } },
        },
      },
    },
    orderBy: { deliveryDate: "asc" },
  })
  return rows.map((o) => ({
    ...o,
    items: o.items.map((i) => ({
      ...i,
      qty: Number(i.qty),
      shippedQty: Number(i.shippedQty),
    })),
  }))
}

export async function getWarehouses(tenantId: string) {
  const user = await requireRole("VIEWER")
  if (user.tenantId !== tenantId) {
    throw new Error("FORBIDDEN")
  }

  return prisma.warehouse.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
  })
}

export type AvailableFinishedGoodsLot = {
  lotId: string
  lotNo: string
  itemId: string
  warehouseId: string
  warehouseName: string
  locationId: string | null
  locationName: string | null
  qtyAvailable: number
}

export type EmptyLotReason =
  | "NO_AVAILABLE_LOT"
  | "UNASSIGNED_STOCK_ONLY"
  | "ALL_LOTS_DEPLETED"

export type AvailableFinishedGoodsLotResult = {
  lotsByItem: Record<string, AvailableFinishedGoodsLot[]>
  emptyReasonByItem: Record<string, EmptyLotReason>
}

/** Quantity that can be newly reserved without changing physical inventory. */
function calculateReservableQty(
  physicalQty: number,
  reservedQty: number,
): number {
  return Math.max(0, physicalQty - reservedQty)
}

export async function getAvailableFinishedGoodsLots(
  tenantId: string,
  warehouseId: string,
  itemIds: string[]
): Promise<AvailableFinishedGoodsLotResult> {
  const user = await requireRole("VIEWER")
  if (user.tenantId !== tenantId) {
    throw new Error("FORBIDDEN")
  }

  const uniqueItemIds = Array.from(new Set(itemIds.filter(Boolean)))
  if (!warehouseId || uniqueItemIds.length === 0) {
    return { lotsByItem: {}, emptyReasonByItem: {} }
  }

  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId, tenantId },
    select: { id: true, siteId: true },
  })
  if (!warehouse) {
    throw new Error("선택한 창고를 사용할 수 없습니다.")
  }

  const availableBalances = await prisma.inventoryBalance.findMany({
    where: {
      tenantId,
      siteId: warehouse.siteId,
      warehouseId,
      itemId: { in: uniqueItemIds },
      lotId: { not: null },
      qtyAvailable: { gt: 0 },
      lot: { status: "ACTIVE" },
    },
    include: {
      warehouse: { select: { id: true, name: true } },
      lot: { select: { id: true, lotNo: true, itemId: true, status: true } },
    },
    orderBy: [{ item: { code: "asc" } }, { lot: { lotNo: "asc" } }],
  })

  const validBalances = availableBalances.filter(
    (balance): balance is typeof balance & { lot: NonNullable<typeof balance.lot> } =>
      balance.lot != null &&
      balance.lot.itemId === balance.itemId,
  )

  const reservedRows = await prisma.shipmentItem.groupBy({
    by: ["itemId", "lotId"],
    where: {
      shipmentOrder: { tenantId, siteId: warehouse.siteId, warehouseId, status: "PLANNED" },
      itemId: { in: uniqueItemIds },
      lotId: { not: null },
    },
    _sum: { qty: true },
  })
  const reservedByLot = new Map(
    reservedRows.map((row) => [row.lotId!, Number(row._sum.qty ?? 0)]),
  )

  const lotIds = validBalances.map((balance) => balance.lot.id)
  const receipts = lotIds.length > 0
    ? await prisma.finishedGoodsReceipt.findMany({
        where: {
          tenantId,
          siteId: warehouse.siteId,
          warehouseId,
          lotId: { in: lotIds },
        },
        select: {
          lotId: true,
          location: { select: { id: true, name: true } },
          receiptAt: true,
        },
        orderBy: { receiptAt: "desc" },
      })
    : []

  const receiptByLotId = new Map<string, { locationId: string | null; locationName: string | null }>()
  for (const receipt of receipts) {
    if (!receipt.lotId || receiptByLotId.has(receipt.lotId)) continue
    receiptByLotId.set(receipt.lotId, {
      locationId: receipt.location?.id ?? null,
      locationName: receipt.location?.name ?? null,
    })
  }

  const lotsByItem: Record<string, AvailableFinishedGoodsLot[]> = {}
  for (const balance of validBalances) {
    const receipt = receiptByLotId.get(balance.lot.id)
    const row: AvailableFinishedGoodsLot = {
      lotId: balance.lot.id,
      lotNo: balance.lot.lotNo,
      itemId: balance.itemId,
      warehouseId: balance.warehouseId,
      warehouseName: balance.warehouse.name,
      locationId: receipt?.locationId ?? null,
      locationName: receipt?.locationName ?? null,
      qtyAvailable: calculateReservableQty(
        Number(balance.qtyAvailable),
        reservedByLot.get(balance.lot.id) ?? 0,
      ),
    }
    if (row.qtyAvailable <= 0) continue
    if (!lotsByItem[row.itemId]) lotsByItem[row.itemId] = []
    lotsByItem[row.itemId].push(row)
  }

  const emptyReasonByItem: Record<string, EmptyLotReason> = {}
  const emptyItemIds = uniqueItemIds.filter(
    (itemId) => (lotsByItem[itemId]?.length ?? 0) === 0,
  )
  const diagnosticBalances = emptyItemIds.length > 0
    ? await prisma.inventoryBalance.findMany({
        where: {
          tenantId,
          siteId: warehouse.siteId,
          warehouseId,
          itemId: { in: emptyItemIds },
        },
        select: {
          itemId: true,
          lotId: true,
          qtyAvailable: true,
        },
      })
    : []

  for (const itemId of emptyItemIds) {
    const itemBalances = diagnosticBalances.filter(
      (balance) => balance.itemId === itemId,
    )
    const hasUnassignedAvailable = itemBalances.some(
      (balance) => balance.lotId == null && Number(balance.qtyAvailable) > 0,
    )
    const lotBalances = itemBalances.filter((balance) => balance.lotId != null)
    const allLotsDepleted =
      lotBalances.length > 0 &&
      lotBalances.every((balance) => Number(balance.qtyAvailable) <= 0)

    emptyReasonByItem[itemId] = hasUnassignedAvailable
      ? "UNASSIGNED_STOCK_ONLY"
      : allLotsDepleted
        ? "ALL_LOTS_DEPLETED"
        : "NO_AVAILABLE_LOT"
  }

  return { lotsByItem, emptyReasonByItem }
}

export async function generateShipmentNo(tenantId: string): Promise<string> {
  const { year } = kstDateParts()
  const prefix = `SH-${year}-`
  const last = await prisma.shipmentOrder.findFirst({
    where: { tenantId, shipmentNo: { startsWith: prefix } },
    orderBy: { shipmentNo: "desc" },
    select: { shipmentNo: true },
  })
  const seq = last ? (parseInt(last.shipmentNo.split("-")[2] ?? "0", 10) || 0) + 1 : 1
  return `${prefix}${String(seq).padStart(3, "0")}`
}

function generateShipmentIssueTxNo(): string {
  const now = new Date()
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, "")
  const hhmmssSSS = now.toISOString().slice(11, 23).replace(/[:.]/g, "")
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0")
  return `ISS-${yyyymmdd}-${hhmmssSSS}-${random}`
}

async function resolveSalesOrderStatusAfterShipmentRollback(
  tx: Prisma.TransactionClient,
  salesOrderId: string
) {
  const salesOrder = await tx.salesOrder.findUniqueOrThrow({
    where: { id: salesOrderId },
    select: {
      status: true,
      items: { select: { qty: true, shippedQty: true } },
    },
  })

  if (salesOrder.status === "CLOSED" || salesOrder.status === "CANCELLED") {
    return salesOrder.status
  }

  const totalQty = salesOrder.items.reduce((sum, item) => sum + Number(item.qty), 0)
  const shippedQty = salesOrder.items.reduce((sum, item) => sum + Number(item.shippedQty), 0)

  if (totalQty > 0 && shippedQty >= totalQty) return "SHIPPED"
  if (shippedQty > 0) return "PARTIAL_SHIPPED"

  const productionWorkOrder = await tx.workOrder.findFirst({
    where: {
      productionPlanItem: {
        salesOrderItem: { salesOrderId },
      },
      OR: [
        { status: { in: ["IN_PROGRESS", "COMPLETED"] } },
        { operations: { some: { status: { in: ["IN_PROGRESS", "COMPLETED"] } } } },
        { finishedGoodsReceipts: { some: {} } },
      ],
    },
    select: { id: true },
  })

  return productionWorkOrder ? "IN_PRODUCTION" : "CONFIRMED"
}

export type CreateShipmentItemInput = {
  salesOrderItemId: string
  itemId: string
  qty: number
  lotId?: string
}

export type CreateShipmentInput = {
  salesOrderId: string
  plannedDate: Date
  warehouseId?: string
  note?: string
  items: CreateShipmentItemInput[]
}

export async function createShipment(
  tenantId: string,
  data: CreateShipmentInput
) {
  await requireResourcePermission("SHIPMENT", "CREATE")
  const user = await requireRole("OPERATOR")
  if (user.tenantId !== tenantId) {
    throw new Error("FORBIDDEN")
  }
  if (!data.warehouseId) {
    throw new Error("출하 창고를 선택하세요.")
  }
  if (data.items.length === 0) {
    throw new Error("출하 품목을 1개 이상 추가하세요.")
  }
  const warehouseId = data.warehouseId

  const duplicateKeys = new Set<string>()
  for (const item of data.items) {
    const key = `${item.salesOrderItemId}:${item.lotId}`
    if (duplicateKeys.has(key)) {
      throw new Error("같은 수주 품목과 LOT는 한 출하에 중복 등록할 수 없습니다.")
    }
    duplicateKeys.add(key)
  }

  await withUniqueBusinessNumberRetry(async () => {
    const shipmentNo = await generateShipmentNo(tenantId)
    await withQuantityTransactionRetry(() => prisma.$transaction(async (tx) => {
    const warehouse = await tx.warehouse.findFirst({
      where: { id: warehouseId, tenantId },
      select: { id: true, siteId: true },
    })
    if (!warehouse) {
      throw new Error("선택한 창고를 사용할 수 없습니다.")
    }

    const salesOrder = await tx.salesOrder.findFirst({
      where: { id: data.salesOrderId, tenantId },
      select: { id: true, siteId: true },
    })
    if (!salesOrder) {
      throw new Error("수주를 찾을 수 없습니다.")
    }

    const salesOrderItemIds = Array.from(
      new Set(data.items.map((item) => item.salesOrderItemId)),
    )
    await lockSalesOrderItemsForUpdate(tx, tenantId, salesOrderItemIds)

    const salesOrderItems = await tx.salesOrderItem.findMany({
      where: {
        id: { in: salesOrderItemIds },
        salesOrder: {
          id: data.salesOrderId,
          tenantId,
        },
      },
      include: {
        item: { select: { code: true, name: true, isLotTracked: true } },
      },
    })
    const salesOrderItemById = new Map(
      salesOrderItems.map((item) => [item.id, item]),
    )
    const requestedQtyBySalesOrderItem = new Map<string, number>()

    for (const item of data.items) {
      if (item.qty <= 0) {
        throw new Error("출하 수량은 0보다 커야 합니다.")
      }

      const salesOrderItem = salesOrderItemById.get(item.salesOrderItemId)
      if (!salesOrderItem) {
        throw new Error("수주 품목을 찾을 수 없습니다.")
      }
      if (salesOrderItem.itemId !== item.itemId) {
        throw new Error("수주 품목과 출하 품목이 일치하지 않습니다.")
      }

      requestedQtyBySalesOrderItem.set(
        item.salesOrderItemId,
        (requestedQtyBySalesOrderItem.get(item.salesOrderItemId) ?? 0) + item.qty,
      )
    }

    const reservedBySalesOrderItem = new Map<string, number>()
    const reservedSalesOrderItems = await tx.shipmentItem.groupBy({
      by: ["salesOrderItemId"],
      where: {
        salesOrderItemId: { in: salesOrderItemIds },
        shipmentOrder: { tenantId, status: "PLANNED" },
      },
      _sum: { qty: true },
    })
    for (const row of reservedSalesOrderItems) {
      reservedBySalesOrderItem.set(row.salesOrderItemId, Number(row._sum.qty ?? 0))
    }

    for (const [salesOrderItemId, requestedQty] of Array.from(requestedQtyBySalesOrderItem)) {
      const salesOrderItem = salesOrderItemById.get(salesOrderItemId)!
      const remainingQty =
        Number(salesOrderItem.qty) - Number(salesOrderItem.shippedQty) -
        (reservedBySalesOrderItem.get(salesOrderItemId) ?? 0)
      if (requestedQty > remainingQty) {
        throw new Error(
          `[${salesOrderItem.item.code}] LOT 분할수량 합계(${requestedQty})가 미출하수량(${remainingQty})을 초과합니다.`,
        )
      }
    }

    const balanceIdsToLock: string[] = []
    for (const item of data.items) {
      const salesOrderItem = salesOrderItemById.get(item.salesOrderItemId)!
      if (salesOrderItem.item.isLotTracked) {
        if (!item.lotId) {
          throw new Error(`[${salesOrderItem.item.code}] LOT 관리 품목은 LOT를 선택해야 합니다.`)
        }
        const lot = await tx.lot.findFirst({
          where: { id: item.lotId, tenantId, status: "ACTIVE" },
          select: { id: true, lotNo: true, itemId: true },
        })
        if (!lot) {
          throw new Error("출하할 완제품 LOT를 찾을 수 없습니다.")
        }
        if (lot.itemId !== item.itemId) {
          throw new Error(`LOT(${lot.lotNo}) 품목과 출하 품목이 일치하지 않습니다.`)
        }
        await assertLotQualityReleaseAllowed(tx, { tenantId, lotId: lot.id })
        const balance = await tx.inventoryBalance.findFirst({
          where: {
            tenantId,
            siteId: warehouse.siteId,
            warehouseId,
            itemId: item.itemId,
            lotId: lot.id,
          },
          select: { id: true },
        })
        if (!balance) {
          throw new Error(`LOT(${lot.lotNo})의 출하 가능 재고가 없습니다.`)
        }
        balanceIdsToLock.push(balance.id)
      } else {
        const balance = await tx.inventoryBalance.findFirst({
          where: {
            tenantId,
            siteId: warehouse.siteId,
            warehouseId,
            itemId: item.itemId,
            lotId: null,
          },
          select: { id: true },
        })
        if (!balance) {
          throw new Error(`[${salesOrderItem.item.code}] 선택한 창고에 출하 가능한 재고가 없습니다.`)
        }
        balanceIdsToLock.push(balance.id)
      }
    }

    await lockInventoryBalancesForUpdate(tx, balanceIdsToLock)

    const shipment = await tx.shipmentOrder.create({
      data: {
        tenantId,
        siteId: salesOrder.siteId,
        salesOrderId: data.salesOrderId,
        shipmentNo,
        plannedDate: data.plannedDate,
        warehouseId,
        note: data.note,
      },
    })

    for (const item of data.items) {
      const salesOrderItem = salesOrderItemById.get(item.salesOrderItemId)!

      const isLotTracked = salesOrderItem.item.isLotTracked

      if (isLotTracked) {
        if (!item.lotId) {
          throw new Error(`[${salesOrderItem.item.code}] LOT 관리 품목은 LOT를 선택해야 합니다.`)
        }

        const lot = await tx.lot.findFirst({
          where: { id: item.lotId, tenantId, status: "ACTIVE" },
          select: { id: true, lotNo: true, itemId: true },
        })
        if (!lot) {
          throw new Error("출하할 완제품 LOT를 찾을 수 없습니다.")
        }
        if (lot.itemId !== item.itemId) {
          throw new Error(`LOT(${lot.lotNo}) 품목과 출하 품목이 일치하지 않습니다.`)
        }

        await assertLotQualityReleaseAllowed(tx, { tenantId, lotId: lot.id })

        const balance = await tx.inventoryBalance.findFirst({
          where: {
            tenantId,
            siteId: warehouse.siteId,
            warehouseId,
            itemId: item.itemId,
            lotId: lot.id,
          },
        })
        if (!balance) {
          throw new Error(`LOT(${lot.lotNo})의 출하 가능 재고가 없습니다.`)
        }
        const reserved = await tx.shipmentItem.aggregate({
          where: { itemId: item.itemId, lotId: lot.id, shipmentOrder: { tenantId, siteId: warehouse.siteId, warehouseId, status: "PLANNED" } },
          _sum: { qty: true },
        })
        const reservableQty = calculateReservableQty(Number(balance.qtyAvailable), Number(reserved._sum.qty ?? 0))
        if (reservableQty < item.qty || Number(balance.qtyOnHand) < item.qty) {
          throw new Error(
            `LOT(${lot.lotNo}) 예약 가능 수량(${reservableQty})보다 많은 수량(${item.qty})을 출하할 수 없습니다.`,
          )
        }

        await tx.shipmentItem.create({
          data: {
            shipmentOrderId: shipment.id,
            salesOrderItemId: item.salesOrderItemId,
            itemId: item.itemId,
            qty: item.qty,
            lotId: lot.id,
          },
        })

      } else {
        // 비LOT 품목: lotId 없이 처리
        const balance = await tx.inventoryBalance.findFirst({
          where: {
            tenantId,
            siteId: warehouse.siteId,
            warehouseId,
            itemId: item.itemId,
            lotId: null,
          },
        })
        if (!balance) {
          throw new Error(`[${salesOrderItem.item.code}] 선택한 창고에 출하 가능한 재고가 없습니다.`)
        }
        const qtyAvailable = Number(balance.qtyAvailable)
        const reserved = await tx.shipmentItem.aggregate({
          where: { itemId: item.itemId, lotId: null, shipmentOrder: { tenantId, siteId: warehouse.siteId, warehouseId, status: "PLANNED" } },
          _sum: { qty: true },
        })
        const reservableQty = calculateReservableQty(qtyAvailable, Number(reserved._sum.qty ?? 0))
        if (reservableQty < item.qty) {
          throw new Error(
            `[${salesOrderItem.item.code}] 예약 가능 수량(${reservableQty})보다 많은 수량(${item.qty})을 출하할 수 없습니다.`,
          )
        }

        await tx.shipmentItem.create({
          data: {
            shipmentOrderId: shipment.id,
            salesOrderItemId: item.salesOrderItemId,
            itemId: item.itemId,
            qty: item.qty,
          },
        })

      }
    }
    await recordAuditLog(tx, {
      tenantId,
      actor: user,
      entityType: "ShipmentOrder",
      entityId: shipment.id,
      action: "CREATE",
      afterData: {
        shipmentNo,
        status: "PLANNED",
        salesOrderId: data.salesOrderId,
        warehouseId,
        itemCount: data.items.length,
        items: summarizeAuditItems(data.items, ["salesOrderItemId", "itemId", "lotId", "qty"]),
      },
      menuName: "출하관리",
    })
    }))
  }, { fields: ["tenantId", "shipmentNo"], message: "출하번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요." })

  revalidatePath("/app/mes/shipments")
  revalidatePath("/app/mes/sales-orders")
  revalidatePath("/app/mes/sales/delivery-status")
  revalidatePath("/app/mes/sales/order-status")
  revalidatePath("/app/mes/inventory")
  revalidatePath("/app/mes/inventory-transactions")
  revalidatePath("/app/mes/manufacturing-traceability")
}

export async function confirmShipment(id: string) {
  await requireResourcePermission("SHIPMENT", "UPDATE")
  const user = await requireRole("OPERATOR")
  await withQuantityTransactionRetry(() => prisma.$transaction(async (tx) => {
    // The conditional transition makes a second confirmation a no-op failure,
    // before any physical inventory mutation is made.
    const transitioned = await tx.shipmentOrder.updateMany({
      where: { id, tenantId: user.tenantId, status: "PLANNED" },
      data: { status: "SHIPPED", shippedDate: new Date() },
    })
    if (transitioned.count !== 1) throw new Error("PLANNED 상태의 출하만 확정할 수 있습니다.")

    const shipment = await tx.shipmentOrder.findFirstOrThrow({
      where: { id, tenantId: user.tenantId },
      include: {
        warehouse: { select: { siteId: true } },
        items: {
          include: {
            item: { select: { code: true, isLotTracked: true } },
            lot: { select: { lotNo: true, itemId: true, status: true } },
          },
        },
      },
    })
    if (!shipment.warehouseId || !shipment.warehouse) throw new Error("출하 창고 정보를 찾을 수 없습니다.")

    await lockSalesOrderItemsForUpdate(
      tx,
      user.tenantId,
      shipment.items.map((item) => item.salesOrderItemId)
    )

    for (const item of shipment.items) {
      if (item.item.isLotTracked && (!item.lotId || !item.lot || item.lot.itemId !== item.itemId || item.lot.status !== "ACTIVE")) {
        throw new Error(`[${item.item.code}] 출하 LOT 정보를 확인할 수 없습니다.`)
      }
      const balance = await tx.inventoryBalance.findFirst({
        where: { tenantId: user.tenantId, siteId: shipment.warehouse.siteId, warehouseId: shipment.warehouseId, itemId: item.itemId, lotId: item.lotId ?? null },
      })
      if (!balance || Number(balance.qtyOnHand) < Number(item.qty) || Number(balance.qtyAvailable) < Number(item.qty)) {
        throw new Error(`[${item.item.code}] 출하 가능한 재고가 부족합니다.`)
      }
      const orderItem = await tx.salesOrderItem.findUniqueOrThrow({ where: { id: item.salesOrderItemId }, select: { qty: true, shippedQty: true } })
      if (Number(orderItem.shippedQty) + Number(item.qty) > Number(orderItem.qty)) {
        throw new Error(`[${item.item.code}] 실제 출하 수량이 수주 수량을 초과합니다.`)
      }
      const updated = await tx.inventoryBalance.updateMany({
        where: { id: balance.id, qtyOnHand: { gte: item.qty }, qtyAvailable: { gte: item.qty } },
        data: { qtyOnHand: { decrement: item.qty }, qtyAvailable: { decrement: item.qty } },
      })
      if (updated.count !== 1) throw new Error(`[${item.item.code}] 출하 가능한 재고가 부족합니다.`)
      await tx.inventoryTransaction.create({ data: { tenantId: user.tenantId, itemId: item.itemId, lotId: item.lotId, fromLocationId: shipment.warehouseId, txNo: generateShipmentIssueTxNo(), txType: "ISSUE", qty: item.qty, refType: "SHIPMENT_ITEM", refId: item.id, note: `출하 처리 (${shipment.shipmentNo})`, txAt: new Date() } })
      await tx.salesOrderItem.update({ where: { id: item.salesOrderItemId }, data: { shippedQty: { increment: item.qty } } })
    }
    const status = await resolveSalesOrderStatusAfterShipmentRollback(tx, shipment.salesOrderId)
    await tx.salesOrder.update({ where: { id: shipment.salesOrderId }, data: { status } })
    await recordAuditLog(tx, {
      tenantId: user.tenantId,
      actor: user,
      entityType: "ShipmentOrder",
      entityId: shipment.id,
      action: "UPDATE",
      beforeData: { status: "PLANNED" },
      afterData: {
        status: "SHIPPED",
        shipmentNo: shipment.shipmentNo,
        salesOrderId: shipment.salesOrderId,
        salesOrderStatus: status,
        itemCount: shipment.items.length,
        items: summarizeAuditItems(shipment.items, ["salesOrderItemId", "itemId", "lotId", "qty"]),
      },
      menuName: "출하관리",
    })
  }))
  revalidatePath("/app/mes/shipments")
  revalidatePath("/app/mes/sales-orders")
  revalidatePath("/app/mes/sales/delivery-status")
  revalidatePath("/app/mes/sales/order-status")
  revalidatePath("/app/mes/inventory")
  revalidatePath("/app/mes/inventory-transactions")
}

export async function deleteShipment(id: string) {
  await requireResourcePermission("SHIPMENT", "DELETE")
  const user = await requireRole("OPERATOR")
  const shipment = await prisma.shipmentOrder.findFirstOrThrow({
    where: { id, tenantId: user.tenantId },
    include: {
      warehouse: { select: { siteId: true, tenantId: true } },
      items: {
        include: { item: { select: { isLotTracked: true } } },
      },
    },
  })
  if (shipment.status !== "PLANNED") {
    throw new Error("PLANNED 상태의 출하만 삭제할 수 있습니다.")
  }
  await prisma.$transaction(async (tx) => {
    // PLANNED is only a reservation: there is no balance, ledger, or SO rollback.
    await tx.shipmentItem.deleteMany({ where: { shipmentOrderId: id } })
    await tx.shipmentOrder.delete({ where: { id } })
    await recordAuditLog(tx, {
      tenantId: user.tenantId,
      actor: user,
      entityType: "ShipmentOrder",
      entityId: id,
      action: "DELETE",
      beforeData: {
        shipmentNo: shipment.shipmentNo,
        status: shipment.status,
        salesOrderId: shipment.salesOrderId,
        warehouseId: shipment.warehouseId,
        itemCount: shipment.items.length,
        items: summarizeAuditItems(shipment.items, ["salesOrderItemId", "itemId", "lotId", "qty"]),
      },
      menuName: "출하관리",
    })
  })

  revalidatePath("/app/mes/shipments")
  revalidatePath("/app/mes/sales-orders")
  revalidatePath("/app/mes/sales/delivery-status")
  revalidatePath("/app/mes/sales/order-status")
  revalidatePath("/app/mes/inventory")
  revalidatePath("/app/mes/inventory-transactions")
  revalidatePath("/app/mes/manufacturing-traceability")
}
