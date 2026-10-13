import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "../src/lib/db/prisma"
import {
  CONCURRENT_QUANTITY_CHANGE_MESSAGE,
  isRetryableQuantityTransactionError,
  lockInventoryBalancesForUpdate,
  lockProductionPlanItemsForUpdate,
  lockPurchaseOrderItemsForUpdate,
  lockSalesOrderItemsForUpdate,
  lockWorkOrderForUpdate,
  lockWorkOrderOperationForUpdate,
  withQuantityTransactionRetry,
} from "../src/lib/quantity-concurrency"
import { assertProductionPlanItemCapacity } from "../src/lib/production-plan-workorder-integrity"
import {
  assertProductionQuantityWithinMaterialLimit,
  getWorkOrderMaterialSufficiency,
} from "../src/lib/bom-material-sufficiency"

const runId = `F11-${Date.now()}-${Math.floor(Math.random() * 10000)}`
let passed = 0

function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}

function equal(actual: unknown, expected: unknown, label: string) {
  assert.deepEqual(actual, expected, label)
  passed += 1
  console.log(`PASS ${label}`)
}

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8")
}

function txNo(prefix: string) {
  return `${prefix}-${runId}-${Math.floor(Math.random() * 1000000)}`
}

type BaseContext = Awaited<ReturnType<typeof createBaseContext>>

async function cleanupTenant(tenantId: string) {
  await prisma.productionResult.deleteMany({
    where: { workOrderOperation: { workOrder: { tenantId } } },
  })
  await prisma.finishedGoodsReceipt.deleteMany({ where: { tenantId } })
  await prisma.shipmentItem.deleteMany({ where: { shipmentOrder: { tenantId } } })
  await prisma.shipmentOrder.deleteMany({ where: { tenantId } })
  await prisma.receivingInspection.deleteMany({
    where: { purchaseOrderItem: { purchaseOrder: { tenantId } } },
  })
  await prisma.inventoryTransaction.deleteMany({ where: { tenantId } })
  await prisma.wipMovement.deleteMany({ where: { tenantId } })
  await prisma.wipUnitMaterialLot.deleteMany({ where: { tenantId } })
  await prisma.workOrderMaterialLot.deleteMany({ where: { tenantId } })
  await prisma.materialReservation.deleteMany({ where: { workOrder: { tenantId } } })
  await prisma.wipUnit.deleteMany({ where: { tenantId } })
  await prisma.workOrderOperationAssignment.deleteMany({ where: { tenantId } })
  await prisma.workOrderOperation.deleteMany({ where: { workOrder: { tenantId } } })
  await prisma.workOrder.deleteMany({ where: { tenantId } })
  await prisma.productionPlanItem.deleteMany({ where: { plan: { tenantId } } })
  await prisma.productionPlan.deleteMany({ where: { tenantId } })
  await prisma.bOMItem.deleteMany({ where: { bom: { tenantId } } })
  await prisma.bOM.deleteMany({ where: { tenantId } })
  await prisma.routingOperation.deleteMany({ where: { routing: { tenantId } } })
  await prisma.routing.deleteMany({ where: { tenantId } })
  await prisma.workCenter.deleteMany({ where: { site: { tenantId } } })
  await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { tenantId } } })
  await prisma.purchaseOrder.deleteMany({ where: { tenantId } })
  await prisma.salesOrderItem.deleteMany({ where: { salesOrder: { tenantId } } })
  await prisma.salesOrder.deleteMany({ where: { tenantId } })
  await prisma.inventoryBalance.deleteMany({ where: { tenantId } })
  await prisma.lot.deleteMany({ where: { tenantId } })
  await prisma.location.deleteMany({ where: { warehouse: { tenantId } } })
  await prisma.warehouse.deleteMany({ where: { tenantId } })
  await prisma.item.deleteMany({ where: { tenantId } })
  await prisma.businessPartner.deleteMany({ where: { tenantId } })
  await prisma.site.deleteMany({ where: { tenantId } })
  await prisma.tenant.deleteMany({ where: { id: tenantId } })
}

async function createBaseContext(label: string) {
  const tenant = await prisma.tenant.create({ data: { code: `${runId}-${label}`, name: `${runId} ${label}` } })
  const site = await prisma.site.create({ data: { tenantId: tenant.id, code: `${label}-SITE`, name: `${label} Site` } })
  const warehouse = await prisma.warehouse.create({ data: { tenantId: tenant.id, siteId: site.id, code: `${label}-WH`, name: `${label} Warehouse` } })
  const location = await prisma.location.create({ data: { warehouseId: warehouse.id, code: `${label}-LOC`, name: `${label} Location` } })
  const workCenter = await prisma.workCenter.create({ data: { siteId: site.id, code: `${label}-WC`, name: `${label} WorkCenter`, kind: "ASSEMBLY" } })
  const customer = await prisma.businessPartner.create({ data: { tenantId: tenant.id, code: `${label}-CUST`, name: `${label} Customer`, partnerType: "CUSTOMER" } })
  const supplier = await prisma.businessPartner.create({ data: { tenantId: tenant.id, code: `${label}-SUP`, name: `${label} Supplier`, partnerType: "SUPPLIER" } })
  const fgItem = await prisma.item.create({ data: { tenantId: tenant.id, code: `${label}-FG`, name: `${label} FG`, itemType: "FINISHED", isLotTracked: true } })
  const rawItem = await prisma.item.create({ data: { tenantId: tenant.id, code: `${label}-RAW`, name: `${label} RAW`, itemType: "RAW_MATERIAL", isLotTracked: true } })
  const routing = await prisma.routing.create({ data: { tenantId: tenant.id, code: `${label}-RT`, name: `${label} Routing`, version: "1", status: "ACTIVE", scope: "COMMON" } })
  const routingOperation = await prisma.routingOperation.create({ data: { routingId: routing.id, seq: 10, operationCode: "CUT", name: "CUT", workCenterId: workCenter.id, standardTime: 1 } })
  const bom = await prisma.bOM.create({ data: { tenantId: tenant.id, itemId: fgItem.id, version: "1", status: "ACTIVE" } })
  await prisma.bOMItem.create({ data: { bomId: bom.id, componentItemId: rawItem.id, seq: 10, qtyPer: 1, scrapRate: 0 } })

  return { tenant, site, warehouse, location, workCenter, customer, supplier, fgItem, rawItem, routing, routingOperation, bom }
}

async function createLotStock(ctx: BaseContext, itemId: string, qty: number, suffix: string) {
  const lot = await prisma.lot.create({ data: { tenantId: ctx.tenant.id, itemId, lotNo: `${runId}-${suffix}`, status: "ACTIVE" } })
  const balance = await prisma.inventoryBalance.create({
    data: {
      tenantId: ctx.tenant.id,
      siteId: ctx.site.id,
      warehouseId: ctx.warehouse.id,
      itemId,
      lotId: lot.id,
      qtyOnHand: qty,
      qtyAvailable: qty,
      qtyHold: 0,
    },
  })
  return { lot, balance }
}

async function createSalesOrder(ctx: BaseContext, qty: number, suffix: string) {
  const order = await prisma.salesOrder.create({
    data: {
      tenantId: ctx.tenant.id,
      siteId: ctx.site.id,
      customerId: ctx.customer.id,
      orderNo: `${runId}-SO-${suffix}`,
      orderDate: new Date(),
      deliveryDate: new Date(),
      status: "CONFIRMED",
      items: { create: [{ itemId: ctx.fgItem.id, qty, unitPrice: 0 }] },
    },
    include: { items: true },
  })
  return { order, item: order.items[0] }
}

async function createWorkOrder(ctx: BaseContext, plannedQty: number, suffix: string, productionPlanItemId?: string | null) {
  const workOrder = await prisma.workOrder.create({
    data: {
      tenantId: ctx.tenant.id,
      siteId: ctx.site.id,
      itemId: ctx.fgItem.id,
      bomId: ctx.bom.id,
      routingId: ctx.routing.id,
      productionPlanItemId: productionPlanItemId ?? null,
      orderNo: `${runId}-WO-${suffix}`,
      manufacturingNo: `${runId}-MFG-${suffix}`,
      plannedQty,
      status: "IN_PROGRESS",
      operations: {
        create: [{ routingOperationId: ctx.routingOperation.id, seq: 10, plannedQty, status: "IN_PROGRESS", startedAt: new Date() }],
      },
    },
    include: { operations: true },
  })
  return { workOrder, operation: workOrder.operations[0] }
}

async function reserveShipment(ctx: BaseContext, params: { salesOrderId: string; salesOrderItemId: string; lotId: string; qty: number; suffix: string }) {
  return withQuantityTransactionRetry(() => prisma.$transaction(async (tx) => {
    await lockSalesOrderItemsForUpdate(tx, ctx.tenant.id, [params.salesOrderItemId])
    const balance = await tx.inventoryBalance.findFirstOrThrow({
      where: { tenantId: ctx.tenant.id, siteId: ctx.site.id, warehouseId: ctx.warehouse.id, itemId: ctx.fgItem.id, lotId: params.lotId },
      select: { id: true, qtyAvailable: true, qtyOnHand: true },
    })
    await lockInventoryBalancesForUpdate(tx, [balance.id])
    const salesOrderItem = await tx.salesOrderItem.findUniqueOrThrow({ where: { id: params.salesOrderItemId }, select: { qty: true, shippedQty: true } })
    const reservedForOrder = await tx.shipmentItem.aggregate({
      where: { salesOrderItemId: params.salesOrderItemId, shipmentOrder: { tenantId: ctx.tenant.id, status: "PLANNED" } },
      _sum: { qty: true },
    })
    const remainingOrderQty = Number(salesOrderItem.qty) - Number(salesOrderItem.shippedQty) - Number(reservedForOrder._sum.qty ?? 0)
    if (params.qty > remainingOrderQty) throw new Error("수주 예약 가능 수량을 초과했습니다.")
    const reservedForStock = await tx.shipmentItem.aggregate({
      where: { itemId: ctx.fgItem.id, lotId: params.lotId, shipmentOrder: { tenantId: ctx.tenant.id, siteId: ctx.site.id, warehouseId: ctx.warehouse.id, status: "PLANNED" } },
      _sum: { qty: true },
    })
    const reservableStockQty = Number(balance.qtyAvailable) - Number(reservedForStock._sum.qty ?? 0)
    if (params.qty > reservableStockQty || params.qty > Number(balance.qtyOnHand)) throw new Error("출하 가능한 재고가 부족합니다.")
    const shipment = await tx.shipmentOrder.create({
      data: { tenantId: ctx.tenant.id, siteId: ctx.site.id, salesOrderId: params.salesOrderId, shipmentNo: `${runId}-SH-${params.suffix}`, plannedDate: new Date(), warehouseId: ctx.warehouse.id },
    })
    await tx.shipmentItem.create({ data: { shipmentOrderId: shipment.id, salesOrderItemId: params.salesOrderItemId, itemId: ctx.fgItem.id, lotId: params.lotId, qty: params.qty } })
    return shipment.id
  }))
}

async function confirmShipmentOnce(ctx: BaseContext, shipmentId: string) {
  return withQuantityTransactionRetry(() => prisma.$transaction(async (tx) => {
    const transitioned = await tx.shipmentOrder.updateMany({ where: { id: shipmentId, tenantId: ctx.tenant.id, status: "PLANNED" }, data: { status: "SHIPPED", shippedDate: new Date() } })
    if (transitioned.count !== 1) throw new Error("PLANNED 상태의 출하만 확정할 수 있습니다.")
    const shipment = await tx.shipmentOrder.findFirstOrThrow({ where: { id: shipmentId, tenantId: ctx.tenant.id }, include: { warehouse: true, items: true } })
    await lockSalesOrderItemsForUpdate(tx, ctx.tenant.id, shipment.items.map((item) => item.salesOrderItemId))
    for (const item of shipment.items) {
      const orderItem = await tx.salesOrderItem.findUniqueOrThrow({ where: { id: item.salesOrderItemId }, select: { qty: true, shippedQty: true } })
      if (Number(orderItem.shippedQty) + Number(item.qty) > Number(orderItem.qty)) throw new Error("실제 출하 수량이 수주 수량을 초과합니다.")
      const updated = await tx.inventoryBalance.updateMany({
        where: { tenantId: ctx.tenant.id, siteId: ctx.site.id, warehouseId: ctx.warehouse.id, itemId: item.itemId, lotId: item.lotId, qtyOnHand: { gte: item.qty }, qtyAvailable: { gte: item.qty } },
        data: { qtyOnHand: { decrement: item.qty }, qtyAvailable: { decrement: item.qty } },
      })
      if (updated.count !== 1) throw new Error("출하 가능한 재고가 부족합니다.")
      await tx.inventoryTransaction.create({ data: { tenantId: ctx.tenant.id, itemId: item.itemId, lotId: item.lotId, fromLocationId: ctx.warehouse.id, txNo: txNo("SHIP"), txType: "ISSUE", qty: item.qty, refType: "SHIPMENT_ITEM", refId: item.id } })
      await tx.salesOrderItem.update({ where: { id: item.salesOrderItemId }, data: { shippedQty: { increment: item.qty } } })
    }
  }))
}

async function atomicIssue(ctx: BaseContext, params: { balanceId: string; itemId: string; lotId: string; workOrderId: string; qty: number; refSuffix: string }) {
  return withQuantityTransactionRetry(() => prisma.$transaction(async (tx) => {
    const updated = await tx.inventoryBalance.updateMany({
      where: { id: params.balanceId, tenantId: ctx.tenant.id, qtyOnHand: { gte: params.qty }, qtyAvailable: { gte: params.qty } },
      data: { qtyOnHand: { decrement: params.qty }, qtyAvailable: { decrement: params.qty } },
    })
    if (updated.count !== 1) throw new Error("가용재고 부족")
    await tx.inventoryTransaction.create({ data: { tenantId: ctx.tenant.id, itemId: params.itemId, lotId: params.lotId, fromLocationId: ctx.warehouse.id, txNo: txNo("MAT"), txType: "ISSUE", qty: params.qty, refType: "WORK_ORDER", refId: params.workOrderId, note: params.refSuffix } })
  }))
}

async function receiveFinishedGoods(ctx: BaseContext, params: { workOrderId: string; itemId: string; qty: number; suffix: string }) {
  return withQuantityTransactionRetry(() => prisma.$transaction(async (tx) => {
    await lockWorkOrderForUpdate(tx, ctx.tenant.id, params.workOrderId)
    const workOrder = await tx.workOrder.findFirstOrThrow({ where: { id: params.workOrderId, tenantId: ctx.tenant.id }, include: { finishedGoodsReceipts: true } })
    const receivedQty = workOrder.finishedGoodsReceipts.reduce((sum, row) => sum + Number(row.receiptQty), 0)
    const pendingQty = Number(workOrder.plannedQty) - receivedQty
    if (params.qty > pendingQty) throw new Error("완제품 입고 가능 수량을 초과했습니다.")
    const lot = await tx.lot.create({ data: { tenantId: ctx.tenant.id, itemId: params.itemId, lotNo: `${runId}-FG-RCP-${params.suffix}`, status: "ACTIVE" } })
    await tx.finishedGoodsReceipt.create({ data: { tenantId: ctx.tenant.id, siteId: ctx.site.id, workOrderId: params.workOrderId, itemId: params.itemId, lotId: lot.id, warehouseId: ctx.warehouse.id, locationId: ctx.location.id, receiptQty: params.qty } })
    await tx.inventoryTransaction.create({ data: { tenantId: ctx.tenant.id, itemId: params.itemId, lotId: lot.id, toLocationId: ctx.warehouse.id, txNo: txNo("FGR"), txType: "RECEIPT", qty: params.qty, refType: "WORK_ORDER", refId: params.workOrderId } })
  }))
}

async function recordProduction(ctx: BaseContext, params: { operationId: string; qty: number }) {
  return prisma.$transaction(async (tx) => {
    await lockWorkOrderOperationForUpdate(tx, params.operationId)
    const sufficiency = await getWorkOrderMaterialSufficiency(tx, { tenantId: ctx.tenant.id, workOrderOperationId: params.operationId })
    assertProductionQuantityWithinMaterialLimit(sufficiency, params.qty)
    await tx.productionResult.create({ data: { workOrderOperationId: params.operationId, goodQty: params.qty, defectQty: 0, reworkQty: 0, startedAt: new Date(), endedAt: new Date() } })
  })
}

async function allocateWorkOrder(ctx: BaseContext, params: { productionPlanItemId: string; qty: number; suffix: string }) {
  return withQuantityTransactionRetry(() => prisma.$transaction(async (tx) => {
    await lockProductionPlanItemsForUpdate(tx, ctx.tenant.id, [params.productionPlanItemId])
    const item = await tx.productionPlanItem.findFirstOrThrow({
      where: { id: params.productionPlanItemId, plan: { tenantId: ctx.tenant.id } },
      select: { plannedQty: true, itemId: true, bomId: true, routingId: true, workOrders: { select: { id: true, plannedQty: true, status: true } } },
    })
    assertProductionPlanItemCapacity({ plannedQty: item.plannedQty, workOrders: item.workOrders, requestedQty: params.qty })
    await tx.workOrder.create({
      data: {
        tenantId: ctx.tenant.id,
        siteId: ctx.site.id,
        itemId: item.itemId,
        bomId: item.bomId!,
        routingId: item.routingId!,
        productionPlanItemId: params.productionPlanItemId,
        orderNo: `${runId}-ALLOC-${params.suffix}`,
        manufacturingNo: `${runId}-ALLOC-MFG-${params.suffix}`,
        plannedQty: params.qty,
        status: "RELEASED",
        operations: { create: [{ routingOperationId: ctx.routingOperation.id, seq: 10, plannedQty: params.qty, status: "PENDING" }] },
      },
    })
  }))
}

async function receivePurchase(ctx: BaseContext, params: { purchaseOrderItemId: string; qty: number; suffix: string }) {
  return prisma.$transaction(async (tx) => {
    await lockPurchaseOrderItemsForUpdate(tx, ctx.tenant.id, [params.purchaseOrderItemId])
    const item = await tx.purchaseOrderItem.findFirstOrThrow({ where: { id: params.purchaseOrderItemId, purchaseOrder: { tenantId: ctx.tenant.id } }, select: { qty: true, receivedQty: true, itemId: true } })
    const pendingQty = Number(item.qty) - Number(item.receivedQty)
    if (params.qty > pendingQty) throw new Error("입고수량은 잔여수량을 초과할 수 없습니다.")
    await tx.receivingInspection.create({ data: { purchaseOrderItemId: params.purchaseOrderItemId, receivedQty: params.qty, acceptedQty: params.qty, rejectedQty: 0, result: "PASS" } })
    await tx.purchaseOrderItem.update({ where: { id: params.purchaseOrderItemId }, data: { receivedQty: { increment: params.qty } } })
  })
}

async function settledPair<T>(a: Promise<T>, b: Promise<T>) {
  const results = await Promise.allSettled([a, b])
  return {
    fulfilled: results.filter((result) => result.status === "fulfilled").length,
    rejected: results.filter((result) => result.status === "rejected").length,
    results,
  }
}

async function main() {
  const ctx = await createBaseContext("A")
  let ctxB: BaseContext | null = null
  try {
    {
      const { lot } = await createLotStock(ctx, ctx.fgItem.id, 100, "RES-STOCK")
      const { order, item } = await createSalesOrder(ctx, 100, "RES")
      const pair = await settledPair(
        reserveShipment(ctx, { salesOrderId: order.id, salesOrderItemId: item.id, lotId: lot.id, qty: 60, suffix: "RES-A" }),
        reserveShipment(ctx, { salesOrderId: order.id, salesOrderItemId: item.id, lotId: lot.id, qty: 60, suffix: "RES-B" }),
      )
      const totalReserved = await prisma.shipmentItem.aggregate({ where: { salesOrderItemId: item.id, shipmentOrder: { tenantId: ctx.tenant.id, status: "PLANNED" } }, _sum: { qty: true } })
      ok(pair.fulfilled === 1 && pair.rejected === 1, "PLANNED 60 + 60 concurrent reservation allows only one winner")
      ok(Number(totalReserved._sum.qty ?? 0) <= 100, "PLANNED reservation total stays within physical inventory and sales order residual")
    }

    {
      const { lot, balance } = await createLotStock(ctx, ctx.fgItem.id, 100, "CONFIRM-STOCK")
      const { order, item } = await createSalesOrder(ctx, 100, "CONFIRM")
      const shipmentId = await reserveShipment(ctx, { salesOrderId: order.id, salesOrderItemId: item.id, lotId: lot.id, qty: 60, suffix: "CONFIRM" })
      const pair = await settledPair(confirmShipmentOnce(ctx, shipmentId), confirmShipmentOnce(ctx, shipmentId))
      const issueCount = await prisma.inventoryTransaction.count({ where: { tenantId: ctx.tenant.id, refType: "SHIPMENT_ITEM", txType: "ISSUE", itemId: ctx.fgItem.id, lotId: lot.id } })
      const freshBalance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } })
      const freshItem = await prisma.salesOrderItem.findUniqueOrThrow({ where: { id: item.id } })
      ok(pair.fulfilled === 1 && pair.rejected === 1, "same Shipment confirm concurrent calls apply exactly once")
      equal(issueCount, 1, "Shipment confirm creates one ISSUE transaction")
      equal(Number(freshBalance.qtyOnHand), 40, "Shipment confirm decrements physical inventory once")
      equal(Number(freshItem.shippedQty), 60, "Shipment confirm increments shippedQty once")
    }

    {
      const { workOrder } = await createWorkOrder(ctx, 100, "MAT")
      const { lot, balance } = await createLotStock(ctx, ctx.rawItem.id, 100, "MAT-STOCK")
      const pair = await settledPair(
        atomicIssue(ctx, { balanceId: balance.id, itemId: ctx.rawItem.id, lotId: lot.id, workOrderId: workOrder.id, qty: 70, refSuffix: "A" }),
        atomicIssue(ctx, { balanceId: balance.id, itemId: ctx.rawItem.id, lotId: lot.id, workOrderId: workOrder.id, qty: 70, refSuffix: "B" }),
      )
      const freshBalance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } })
      const issuedQty = await prisma.inventoryTransaction.aggregate({ where: { tenantId: ctx.tenant.id, refType: "WORK_ORDER", refId: workOrder.id, txType: "ISSUE", itemId: ctx.rawItem.id, lotId: lot.id }, _sum: { qty: true } })
      ok(pair.fulfilled === 1 && pair.rejected === 1, "material issue 70 + 70 against stock 100 allows only one winner")
      ok(Number(freshBalance.qtyOnHand) >= 0 && Number(freshBalance.qtyAvailable) >= 0, "material issue cannot make inventory negative")
      ok(Number(issuedQty._sum.qty ?? 0) <= 100, "material issue transactions do not exceed available stock")
    }

    {
      const { workOrder } = await createWorkOrder(ctx, 100, "FGR")
      await prisma.finishedGoodsReceipt.create({ data: { tenantId: ctx.tenant.id, siteId: ctx.site.id, workOrderId: workOrder.id, itemId: ctx.fgItem.id, warehouseId: ctx.warehouse.id, locationId: ctx.location.id, receiptQty: 60 } })
      const pair = await settledPair(
        receiveFinishedGoods(ctx, { workOrderId: workOrder.id, itemId: ctx.fgItem.id, qty: 40, suffix: "A" }),
        receiveFinishedGoods(ctx, { workOrderId: workOrder.id, itemId: ctx.fgItem.id, qty: 40, suffix: "B" }),
      )
      const totalReceipt = await prisma.finishedGoodsReceipt.aggregate({ where: { tenantId: ctx.tenant.id, workOrderId: workOrder.id }, _sum: { receiptQty: true } })
      ok(pair.fulfilled === 1 && pair.rejected === 1, "finished goods receipt 40 + 40 against pending 40 allows only one winner")
      ok(Number(totalReceipt._sum.receiptQty ?? 0) <= 100, "finished goods cumulative receipt stays within producible quantity")
    }

    {
      const { workOrder, operation } = await createWorkOrder(ctx, 100, "POP")
      await prisma.inventoryTransaction.create({ data: { tenantId: ctx.tenant.id, itemId: ctx.rawItem.id, txNo: txNo("POP-ISS"), txType: "ISSUE", qty: 20, refType: "WORK_ORDER", refId: workOrder.id } })
      const pair = await settledPair(recordProduction(ctx, { operationId: operation.id, qty: 15 }), recordProduction(ctx, { operationId: operation.id, qty: 15 }))
      const totalProduced = await prisma.productionResult.aggregate({ where: { workOrderOperationId: operation.id }, _sum: { goodQty: true } })
      ok(pair.fulfilled === 1 && pair.rejected === 1, "F10 material-backed production 15 + 15 against capacity 20 allows only one winner")
      ok(Number(totalProduced._sum.goodQty ?? 0) <= 20, "ProductionResult total stays within issued-material capacity")
    }

    {
      const plan = await prisma.productionPlan.create({ data: { tenantId: ctx.tenant.id, siteId: ctx.site.id, planNo: `${runId}-PLAN`, planType: "DAILY", startDate: new Date(), endDate: new Date(), status: "CONFIRMED" } })
      const planItem = await prisma.productionPlanItem.create({ data: { planId: plan.id, itemId: ctx.fgItem.id, bomId: ctx.bom.id, routingId: ctx.routing.id, plannedQty: 100 } })
      await createWorkOrder(ctx, 60, "ALLOC-EXISTING", planItem.id)
      const pair = await settledPair(
        allocateWorkOrder(ctx, { productionPlanItemId: planItem.id, qty: 40, suffix: "A" }),
        allocateWorkOrder(ctx, { productionPlanItemId: planItem.id, qty: 40, suffix: "B" }),
      )
      const totalAllocated = await prisma.workOrder.aggregate({ where: { tenantId: ctx.tenant.id, productionPlanItemId: planItem.id, status: { not: "CANCELLED" } }, _sum: { plannedQty: true } })
      ok(pair.fulfilled === 1 && pair.rejected === 1, "ProductionPlanItem remaining 40 rejects concurrent WO 40 + 40 over-allocation")
      equal(Number(totalAllocated._sum.plannedQty ?? 0), 100, "ProductionPlanItem cumulative WorkOrder plannedQty stays within plan")
    }

    {
      const { workOrder } = await createWorkOrder(ctx, 100, "LOT-A")
      const stockA = await createLotStock(ctx, ctx.rawItem.id, 100, "LOT-A")
      const stockB = await createLotStock(ctx, ctx.rawItem.id, 100, "LOT-B")
      const pair = await settledPair(
        atomicIssue(ctx, { balanceId: stockA.balance.id, itemId: ctx.rawItem.id, lotId: stockA.lot.id, workOrderId: workOrder.id, qty: 60, refSuffix: "LOT-A" }),
        atomicIssue(ctx, { balanceId: stockB.balance.id, itemId: ctx.rawItem.id, lotId: stockB.lot.id, workOrderId: workOrder.id, qty: 60, refSuffix: "LOT-B" }),
      )
      ok(pair.fulfilled === 2, "different LOT inventory mutations can both succeed independently")
    }

    {
      const woA = await createWorkOrder(ctx, 100, "INDEP-A")
      const woB = await createWorkOrder(ctx, 100, "INDEP-B")
      await prisma.inventoryTransaction.createMany({ data: [
        { tenantId: ctx.tenant.id, itemId: ctx.rawItem.id, txNo: txNo("INDEP-A"), txType: "ISSUE", qty: 20, refType: "WORK_ORDER", refId: woA.workOrder.id },
        { tenantId: ctx.tenant.id, itemId: ctx.rawItem.id, txNo: txNo("INDEP-B"), txType: "ISSUE", qty: 20, refType: "WORK_ORDER", refId: woB.workOrder.id },
      ] })
      const pair = await settledPair(recordProduction(ctx, { operationId: woA.operation.id, qty: 10 }), recordProduction(ctx, { operationId: woB.operation.id, qty: 10 }))
      ok(pair.fulfilled === 2, "different WorkOrder production mutations can both succeed independently")
    }

    {
      const { workOrder } = await createWorkOrder(ctx, 100, "ROLLBACK")
      const { lot, balance } = await createLotStock(ctx, ctx.rawItem.id, 30, "ROLLBACK")
      await assert.rejects(
        prisma.$transaction(async (tx) => {
          const updated = await tx.inventoryBalance.updateMany({ where: { id: balance.id, qtyOnHand: { gte: 20 }, qtyAvailable: { gte: 20 } }, data: { qtyOnHand: { decrement: 20 }, qtyAvailable: { decrement: 20 } } })
          assert.equal(updated.count, 1)
          await tx.inventoryTransaction.create({ data: { tenantId: ctx.tenant.id, itemId: ctx.rawItem.id, lotId: lot.id, fromLocationId: ctx.warehouse.id, txNo: txNo("ROLLBACK"), txType: "ISSUE", qty: 20, refType: "WORK_ORDER", refId: workOrder.id } })
          throw new Error("intentional rollback")
        }),
        /intentional rollback/,
      )
      const freshBalance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } })
      const txCount = await prisma.inventoryTransaction.count({ where: { tenantId: ctx.tenant.id, refId: workOrder.id, note: null } })
      equal(Number(freshBalance.qtyOnHand), 30, "transaction rollback restores inventory decrement")
      equal(txCount, 0, "transaction rollback removes partial InventoryTransaction")
    }

    {
      let attempts = 0
      const result = await withQuantityTransactionRetry(async () => {
        attempts += 1
        if (attempts === 1) throw new Error("deadlock detected")
        return "ok"
      })
      equal(result, "ok", "retryable deadlock is retried with bounded retry")
      equal(attempts, 2, "bounded retry does not retry more than needed")
      ok(isRetryableQuantityTransactionError(new Error("could not serialize access due to concurrent update")), "serialization failure is classified retryable")
    }

    {
      ctxB = await createBaseContext("B")
      const { lot: lotA } = await createLotStock(ctx, ctx.fgItem.id, 100, "TENANT-A")
      const { lot: lotB } = await createLotStock(ctxB, ctxB.fgItem.id, 100, "TENANT-B")
      const soA = await createSalesOrder(ctx, 100, "TENANT-A")
      const soB = await createSalesOrder(ctxB, 100, "TENANT-B")
      await reserveShipment(ctxB, { salesOrderId: soB.order.id, salesOrderItemId: soB.item.id, lotId: lotB.id, qty: 90, suffix: "TENANT-B" })
      await reserveShipment(ctx, { salesOrderId: soA.order.id, salesOrderItemId: soA.item.id, lotId: lotA.id, qty: 60, suffix: "TENANT-A" })
      const totalA = await prisma.shipmentItem.aggregate({ where: { salesOrderItemId: soA.item.id, shipmentOrder: { tenantId: ctx.tenant.id, status: "PLANNED" } }, _sum: { qty: true } })
      equal(Number(totalA._sum.qty ?? 0), 60, "tenant A reservation aggregate excludes tenant B reservation rows")
    }

    {
      const po = await prisma.purchaseOrder.create({ data: { tenantId: ctx.tenant.id, siteId: ctx.site.id, supplierId: ctx.supplier.id, orderNo: `${runId}-PO`, orderDate: new Date(), expectedDate: new Date(), status: "ORDERED", items: { create: [{ itemId: ctx.rawItem.id, qty: 100, unitPrice: 0, receivedQty: 60 }] } }, include: { items: true } })
      const pair = await settledPair(receivePurchase(ctx, { purchaseOrderItemId: po.items[0].id, qty: 40, suffix: "A" }), receivePurchase(ctx, { purchaseOrderItemId: po.items[0].id, qty: 40, suffix: "B" }))
      const freshPoItem = await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: po.items[0].id } })
      ok(pair.fulfilled === 1 && pair.rejected === 1, "purchase receipt 40 + 40 against pending 40 allows only one winner")
      equal(Number(freshPoItem.receivedQty), 100, "PurchaseOrderItem receivedQty stays within order quantity")
    }

    const sourceChecks = [
      ["src/lib/actions/shipment.actions.ts", /lockSalesOrderItemsForUpdate[\s\S]*lockInventoryBalancesForUpdate/, "shipment reservation locks SalesOrderItem and InventoryBalance before aggregate validation"],
      ["src/lib/actions/shipment.actions.ts", /const transitioned = await tx\.shipmentOrder\.updateMany[\s\S]*status: "PLANNED"[\s\S]*lockSalesOrderItemsForUpdate[\s\S]*qtyOnHand: \{ decrement: item\.qty \}/, "shipment confirm keeps conditional status claim plus atomic stock decrement"],
      ["src/lib/actions/material-issue.actions.ts", /lockWorkOrderForUpdate[\s\S]*inventoryBalance\.updateMany[\s\S]*qtyOnHand: \{ gte: item\.issueQty \}[\s\S]*qtyOnHand: \{ decrement: item\.issueQty \}/, "material issue uses WorkOrder lock and atomic conditional decrement"],
      ["src/lib/actions/finished-goods.actions.ts", /lockWorkOrderForUpdate[\s\S]*computeWipReceiptStatus[\s\S]*finishedGoodsReceipt\.create/, "finished goods receipt locks WorkOrder before receipt capacity calculation"],
      ["src/lib/actions/pop.actions.ts", /lockWorkOrderOperationForUpdate[\s\S]*getWorkOrderMaterialSufficiency\(tx[\s\S]*assertProductionQuantityWithinMaterialLimit/, "POP result locks WorkOrderOperation before F10 sufficiency validation"],
      ["src/lib/actions/work-order.actions.ts", /lockProductionPlanItemsForUpdate[\s\S]*assertProductionPlanItemCapacity[\s\S]*workOrder\.create/, "WorkOrder allocation locks ProductionPlanItem before F02 capacity validation"],
      ["src/lib/actions/receiving.actions.ts", /lockPurchaseOrderItemsForUpdate[\s\S]*lockedRemainingQty[\s\S]*receivingInspection\.create/, "purchase receipt locks PurchaseOrderItem before remaining quantity validation"],
      ["src/lib/quantity-concurrency.ts", /ORDER BY id[\s\S]*FOR UPDATE/, "row locks use deterministic id ordering"],
      ["src/lib/quantity-concurrency.ts", /DEFAULT_MAX_ATTEMPTS = 3[\s\S]*CONCURRENT_QUANTITY_CHANGE_MESSAGE/, "retry policy is bounded and masks internal retryable errors"],
    ] as const
    for (const [file, pattern, label] of sourceChecks) {
      ok(pattern.test(read(file)), label)
    }

    console.log(`\n${passed} inventory concurrency integrity checks passed.`)
  } finally {
    if (ctxB) await cleanupTenant(ctxB.tenant.id)
    await cleanupTenant(ctx.tenant.id)
    await prisma.$disconnect()
  }
}

main().catch(async (error) => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})

