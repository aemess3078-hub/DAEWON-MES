"use server"

import { prisma } from "@/lib/db/prisma"
import { requireResourcePermission } from "@/lib/auth/role-permissions"

function toNumber(value: unknown): number {
  return Number(value ?? 0)
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

export type LotLineageResult = Awaited<ReturnType<typeof getLotLineageByNo>>

export async function getLotLineageByNo(lotNo: string, tenantId: string) {
  await requireResourcePermission("LOT", "READ")
  const query = lotNo.trim()
  if (!query) return null

  const lot = await prisma.lot.findFirst({
    where: { tenantId, lotNo: { contains: query } },
    include: { item: { select: { id: true, code: true, name: true, itemType: true, uom: true, isLotTracked: true } } },
    orderBy: { lotNo: "asc" },
  })
  if (!lot) return null

  const [balances, parentLinks, childLinks, directMaterialIssues, receipts, shipments, directWipUnits, inspections, inventoryTransactions] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where: { tenantId, lotId: lot.id },
      include: { warehouse: { select: { id: true, code: true, name: true } }, site: { select: { id: true, code: true, name: true } } },
      orderBy: [{ warehouse: { code: "asc" } }],
    }),
    prisma.lotGenealogy.findMany({
      where: { childLot: { tenantId, id: lot.id } },
      include: { parentLot: { include: { item: { select: { id: true, code: true, name: true, itemType: true, uom: true, isLotTracked: true } } } } },
      orderBy: [{ parentLot: { lotNo: "asc" } }],
    }),
    prisma.lotGenealogy.findMany({
      where: { parentLot: { tenantId, id: lot.id } },
      include: { childLot: { include: { item: { select: { id: true, code: true, name: true, itemType: true, uom: true, isLotTracked: true } } } } },
      orderBy: [{ childLot: { lotNo: "asc" } }],
    }),
    prisma.workOrderMaterialLot.findMany({
      where: { tenantId, inventoryTransaction: { lotId: lot.id } },
      include: {
        materialItem: { select: { id: true, code: true, name: true, itemType: true, uom: true } },
        inventoryTransaction: { select: { id: true, txNo: true, txType: true, qty: true, txAt: true, lotId: true } },
        workOrder: { include: { item: { select: { id: true, code: true, name: true, itemType: true, uom: true } }, site: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: { issuedAt: "desc" },
    }),
    prisma.finishedGoodsReceipt.findMany({
      where: { tenantId, lotId: lot.id },
      include: {
        workOrder: { include: { item: { select: { id: true, code: true, name: true, itemType: true, uom: true } }, site: { select: { id: true, code: true, name: true } } } },
        warehouse: { select: { id: true, code: true, name: true } },
        location: { select: { id: true, code: true, name: true } },
      },
      orderBy: { receiptAt: "desc" },
    }),
    prisma.shipmentItem.findMany({
      where: { lotId: lot.id, shipmentOrder: { tenantId } },
      include: {
        shipmentOrder: {
          include: {
            salesOrder: { include: { customer: { select: { id: true, code: true, name: true } } } },
            warehouse: { select: { id: true, code: true, name: true } },
          },
        },
        salesOrderItem: { include: { salesOrder: { select: { id: true, orderNo: true } } } },
      },
      orderBy: { shipmentOrder: { plannedDate: "desc" } },
    }),
    prisma.wipUnit.findMany({
      where: { tenantId, lotId: lot.id },
      include: {
        workOrder: { select: { id: true, orderNo: true, manufacturingNo: true } },
        workOrderOperation: { include: { routingOperation: { include: { workCenter: { select: { id: true, code: true, name: true } } } } } },
        currentWorkCenter: { select: { id: true, code: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.qualityInspection.findMany({
      where: { lotId: lot.id, workOrderOperation: { workOrder: { tenantId } } },
      include: {
        inspectionSpec: { select: { id: true, version: true } },
        inspector: { select: { id: true, name: true } },
        workOrderOperation: { include: { workOrder: { select: { id: true, orderNo: true, manufacturingNo: true } }, routingOperation: { select: { id: true, seq: true, name: true } } } },
        measurements: { orderBy: [{ inspectionItemId: "asc" }, { sampleNo: "asc" }] },
        defectRecords: {
          include: {
            defectCode: { select: { id: true, code: true, name: true } },
            causeAnalysis: true,
            correctiveActions: true,
            recurrencePreventions: true,
          },
        },
      },
      orderBy: { inspectedAt: "desc" },
    }),
    prisma.inventoryTransaction.findMany({
      where: { tenantId, lotId: lot.id },
      select: { id: true, txNo: true, txType: true, qty: true, refType: true, refId: true, txAt: true, note: true },
      orderBy: { txAt: "desc" },
    }),
  ])

  const relatedWorkOrderIds = unique([
    ...directMaterialIssues.map((issue) => issue.workOrderId),
    ...receipts.map((receipt) => receipt.workOrderId),
    ...directWipUnits.map((unit) => unit.workOrderId),
  ])

  const workOrders = relatedWorkOrderIds.length > 0
    ? await prisma.workOrder.findMany({
        where: { tenantId, id: { in: relatedWorkOrderIds } },
        include: {
          item: { select: { id: true, code: true, name: true, itemType: true, uom: true } },
          site: { select: { id: true, code: true, name: true } },
          operations: {
            include: {
              routingOperation: { include: { workCenter: { select: { id: true, code: true, name: true } } } },
              equipment: { select: { id: true, code: true, name: true } },
              assignments: { include: { equipment: { select: { id: true, code: true, name: true } } }, orderBy: [{ seq: "asc" }] },
              productionResults: {
                include: { operator: { select: { id: true, name: true } }, workOrderOperationAssignment: { include: { equipment: { select: { id: true, code: true, name: true } } } } },
                orderBy: [{ endedAt: "asc" }, { startedAt: "asc" }],
              },
            },
            orderBy: [{ seq: "asc" }],
          },
        },
        orderBy: { orderNo: "asc" },
      })
    : []

  const legacyWorkOrderInspections = inspections.length === 0 && relatedWorkOrderIds.length > 0
    ? await prisma.qualityInspection.findMany({
        where: {
          lotId: null,
          workOrderOperation: { workOrder: { tenantId, id: { in: relatedWorkOrderIds } } },
        },
        include: {
          inspectionSpec: { select: { id: true, version: true } },
          inspector: { select: { id: true, name: true } },
          workOrderOperation: { include: { workOrder: { select: { id: true, orderNo: true, manufacturingNo: true } }, routingOperation: { select: { id: true, seq: true, name: true } } } },
        },
        orderBy: { inspectedAt: "desc" },
      })
    : []
  const directWipUnitIds = directWipUnits.map((unit) => unit.id)
  const outsourcingMovements = directWipUnitIds.length > 0
    ? await prisma.wipMovement.findMany({
        where: {
          tenantId,
          wipUnitId: { in: directWipUnitIds },
          OR: [
            { movementType: { in: ["OUTSOURCED", "RETURNED"] } },
            { sourceType: "OutsourcingInspection" },
          ],
        },
        include: {
          wipUnit: {
            include: {
              workOrder: { select: { id: true, orderNo: true, manufacturingNo: true } },
              workOrderOperation: {
                include: { routingOperation: { select: { id: true, seq: true, name: true } } },
              },
            },
          },
          fromPartner: { select: { id: true, code: true, name: true } },
          toPartner: { select: { id: true, code: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : []
  const outsourcingOrderItemIds = unique(
    outsourcingMovements.map((movement) =>
      movement.sourceType === "PurchaseOrderItem" || movement.sourceType === "OutsourcingInspection"
        ? movement.sourceId
        : null,
    ),
  )
  const outsourcingOrderItems = outsourcingOrderItemIds.length > 0
    ? await prisma.purchaseOrderItem.findMany({
        where: { id: { in: outsourcingOrderItemIds }, purchaseOrder: { tenantId } },
        include: {
          purchaseOrder: {
            select: {
              id: true,
              orderNo: true,
              supplier: { select: { id: true, code: true, name: true } },
            },
          },
          workOrderOperation: {
            include: {
              workOrder: { select: { id: true, orderNo: true, manufacturingNo: true } },
              routingOperation: { select: { id: true, seq: true, name: true } },
            },
          },
        },
      })
    : []
  const outsourcingOrderItemById = new Map(outsourcingOrderItems.map((item) => [item.id, item]))

  return {
    lot: {
      id: lot.id,
      lotNo: lot.lotNo,
      status: lot.status,
      manufactureDate: lot.manufactureDate?.toISOString() ?? null,
      expiryDate: lot.expiryDate?.toISOString() ?? null,
      item: lot.item,
      isTraceTarget: lot.item.isLotTracked,
    },
    inventory: {
      qtyOnHand: balances.reduce((sum, balance) => sum + toNumber(balance.qtyOnHand), 0),
      qtyAvailable: balances.reduce((sum, balance) => sum + toNumber(balance.qtyAvailable), 0),
      balances: balances.map((balance) => ({
        id: balance.id,
        warehouse: balance.warehouse,
        site: balance.site,
        qtyOnHand: toNumber(balance.qtyOnHand),
        qtyAvailable: toNumber(balance.qtyAvailable),
        qtyHold: toNumber(balance.qtyHold),
      })),
    },
    parentLots: parentLinks.map((link) => ({
      id: link.parentLot.id,
      lotNo: link.parentLot.lotNo,
      relationType: link.relationType,
      qty: toNumber(link.qty),
      item: link.parentLot.item,
    })),
    childLots: childLinks.map((link) => ({
      id: link.childLot.id,
      lotNo: link.childLot.lotNo,
      relationType: link.relationType,
      qty: toNumber(link.qty),
      item: link.childLot.item,
    })),
    materialIssues: directMaterialIssues.map((issue) => ({
      id: issue.id,
      materialLotNo: issue.materialLotNo,
      qty: toNumber(issue.qty),
      issuedAt: issue.issuedAt.toISOString(),
      materialItem: issue.materialItem,
      transaction: issue.inventoryTransaction ? {
        id: issue.inventoryTransaction.id,
        txNo: issue.inventoryTransaction.txNo,
        txType: issue.inventoryTransaction.txType,
        qty: toNumber(issue.inventoryTransaction.qty),
        txAt: issue.inventoryTransaction.txAt.toISOString(),
      } : null,
      workOrder: {
        id: issue.workOrder.id,
        orderNo: issue.workOrder.orderNo,
        manufacturingNo: issue.workOrder.manufacturingNo,
        status: issue.workOrder.status,
        item: issue.workOrder.item,
        site: issue.workOrder.site,
      },
    })),
    workOrders: workOrders.map((workOrder) => ({
      id: workOrder.id,
      orderNo: workOrder.orderNo,
      manufacturingNo: workOrder.manufacturingNo,
      status: workOrder.status,
      plannedQty: toNumber(workOrder.plannedQty),
      item: workOrder.item,
      site: workOrder.site,
      operations: workOrder.operations.map((operation) => ({
        id: operation.id,
        seq: operation.seq,
        status: operation.status,
        plannedQty: toNumber(operation.plannedQty),
        completedQty: toNumber(operation.completedQty),
        routingOperation: {
          id: operation.routingOperation.id,
          seq: operation.routingOperation.seq,
          name: operation.routingOperation.name,
          workCenter: operation.routingOperation.workCenter,
        },
        equipment: operation.equipment,
        assignments: operation.assignments.map((assignment) => ({
          id: assignment.id,
          seq: assignment.seq,
          status: assignment.status,
          assignedQty: toNumber(assignment.assignedQty),
          completedQty: toNumber(assignment.completedQty),
          equipment: assignment.equipment,
        })),
        productionResults: operation.productionResults.map((result) => ({
          id: result.id,
          goodQty: toNumber(result.goodQty),
          defectQty: toNumber(result.defectQty),
          reworkQty: toNumber(result.reworkQty),
          startedAt: result.startedAt?.toISOString() ?? null,
          endedAt: result.endedAt?.toISOString() ?? null,
          operator: result.operator,
          equipment: result.workOrderOperationAssignment?.equipment ?? operation.equipment,
        })),
      })),
    })),
    wipUnits: directWipUnits.map((unit) => ({
      id: unit.id,
      qty: toNumber(unit.qty),
      status: unit.status,
      manufacturingNo: unit.manufacturingNo,
      workOrder: unit.workOrder,
      operation: {
        id: unit.workOrderOperation.id,
        seq: unit.workOrderOperation.seq,
        name: unit.workOrderOperation.routingOperation.name,
        workCenter: unit.workOrderOperation.routingOperation.workCenter,
      },
      currentWorkCenter: unit.currentWorkCenter,
    })),
    outsourcingHistory: outsourcingMovements.map((movement) => {
      const orderItem = movement.sourceId ? outsourcingOrderItemById.get(movement.sourceId) ?? null : null
      return {
        id: movement.id,
        movementType: movement.movementType,
        sourceType: movement.sourceType,
        sourceId: movement.sourceId,
        qty: toNumber(movement.qty),
        createdAt: movement.createdAt.toISOString(),
        partner: movement.toPartner ?? movement.fromPartner ?? orderItem?.purchaseOrder.supplier ?? null,
        purchaseOrder: orderItem?.purchaseOrder
          ? { id: orderItem.purchaseOrder.id, orderNo: orderItem.purchaseOrder.orderNo }
          : null,
        workOrder: orderItem?.workOrderOperation?.workOrder ?? movement.wipUnit.workOrder,
        operation: orderItem?.workOrderOperation
          ? {
              id: orderItem.workOrderOperation.id,
              seq: orderItem.workOrderOperation.seq,
              name: orderItem.workOrderOperation.routingOperation.name,
            }
          : {
              id: movement.wipUnit.workOrderOperation.id,
              seq: movement.wipUnit.workOrderOperation.seq,
              name: movement.wipUnit.workOrderOperation.routingOperation.name,
            },
      }
    }),
    inspections: inspections.map((inspection) => ({
      id: inspection.id,
      stage: inspection.stage,
      result: inspection.result,
      inspectedQty: toNumber(inspection.inspectedQty),
      inspectedAt: inspection.inspectedAt.toISOString(),
      inspectionSpec: inspection.inspectionSpec,
      inspector: inspection.inspector,
      workOrder: inspection.workOrderOperation.workOrder,
      operation: inspection.workOrderOperation.routingOperation,
      measurements: inspection.measurements.map((measurement) => ({
        id: measurement.id,
        itemName: measurement.itemNameSnapshot,
        sampleNo: measurement.sampleNo,
        numericValue: measurement.numericValue == null ? null : toNumber(measurement.numericValue),
        textValue: measurement.textValue,
        booleanValue: measurement.booleanValue,
        judgement: measurement.judgement,
        lowerLimit: measurement.lowerLimitSnapshot == null ? null : toNumber(measurement.lowerLimitSnapshot),
        upperLimit: measurement.upperLimitSnapshot == null ? null : toNumber(measurement.upperLimitSnapshot),
        unit: measurement.unitSnapshot,
      })),
      defects: inspection.defectRecords.map((defect) => ({
        id: defect.id,
        qty: toNumber(defect.qty),
        severity: defect.severity,
        disposition: defect.disposition,
        defectCode: defect.defectCode,
        causeAnalysis: defect.causeAnalysis ? { id: defect.causeAnalysis.id, rootCause: defect.causeAnalysis.rootCause } : null,
        correctiveActions: defect.correctiveActions.map((action) => ({ id: action.id, status: action.status, actionContent: action.actionContent })),
        recurrencePreventions: defect.recurrencePreventions.map((prevention) => ({ id: prevention.id, status: prevention.status, preventionContent: prevention.preventionContent })),
      })),
    })),
    legacyWorkOrderInspections: legacyWorkOrderInspections.map((inspection) => ({
      id: inspection.id,
      stage: inspection.stage,
      result: inspection.result,
      inspectedQty: toNumber(inspection.inspectedQty),
      inspectedAt: inspection.inspectedAt.toISOString(),
      inspectionSpec: inspection.inspectionSpec,
      inspector: inspection.inspector,
      workOrder: inspection.workOrderOperation.workOrder,
      operation: inspection.workOrderOperation.routingOperation,
      attribution: "WORK_ORDER_SCOPE" as const,
    })),
    receipts: receipts.map((receipt) => ({
      id: receipt.id,
      receiptQty: toNumber(receipt.receiptQty),
      receiptAt: receipt.receiptAt.toISOString(),
      workOrder: { id: receipt.workOrder.id, orderNo: receipt.workOrder.orderNo, manufacturingNo: receipt.workOrder.manufacturingNo },
      warehouse: receipt.warehouse,
      location: receipt.location,
    })),
    shipments: shipments.map((item) => ({
      id: item.id,
      qty: toNumber(item.qty),
      shipmentOrder: {
        id: item.shipmentOrder.id,
        shipmentNo: item.shipmentOrder.shipmentNo,
        status: item.shipmentOrder.status,
        plannedDate: item.shipmentOrder.plannedDate.toISOString(),
        shippedDate: item.shipmentOrder.shippedDate?.toISOString() ?? null,
        warehouse: item.shipmentOrder.warehouse,
        salesOrder: {
          id: item.shipmentOrder.salesOrder.id,
          orderNo: item.shipmentOrder.salesOrder.orderNo,
          customer: item.shipmentOrder.salesOrder.customer,
        },
      },
    })),
    inventoryTransactions: inventoryTransactions.map((tx) => ({
      id: tx.id,
      txNo: tx.txNo,
      txType: tx.txType,
      qty: toNumber(tx.qty),
      refType: tx.refType,
      refId: tx.refId,
      note: tx.note,
      txAt: tx.txAt.toISOString(),
    })),
  }
}
