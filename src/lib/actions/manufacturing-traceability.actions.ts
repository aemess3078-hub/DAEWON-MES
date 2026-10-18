"use server"

import { prisma } from "@/lib/db/prisma"
import { getLotGenealogyForTraceability, type LotGenealogyNode } from "./lot-genealogy.helpers"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"
import { requireActor, assertSessionTenant } from "@/lib/auth/action-guards"

// ─── 의료기기 제조번호 추적성 ────────────────────────────────────────────────
//
// 제조번호(manufacturingNo) 기준으로
//   - 작업지시
//   - 품목
//   - 투입 원자재 LOT
//   - 공정 진행 이력
//   - 검사 결과
//   - 포장 / 완제품 입고
//   - 출고
// 를 하나의 트리로 묶어 반환한다.
//
// 아직 데이터가 없는 구간은 null 또는 빈 배열로 반환하여
// 추적성 화면이 한결같은 구조로 데이터를 다룰 수 있도록 한다.

export type TraceabilityMaterialLot = {
  materialItemId: string
  materialCode: string | null
  materialName: string | null
  materialSpec: string | null
  lotNo: string
  qty: number
  unit: string | null
  issuedAt: string
}

export type TraceabilityProcessHistory = {
  operationId: string
  seq: number
  processName: string
  status: string
  startedAt: string | null
  completedAt: string | null
  workerName: string | null
  goodQty: number
  defectQty: number
  note: string | null
}

export type TraceabilityInspection = {
  id: string
  processName: string
  stage: string
  result: string | null
  inspectedQty: number
  defectQty: number
  inspectedAt: string
  inspectorName: string | null
}

export type TraceabilityPackaging = {
  warehouseName: string | null
  locationName: string | null
  receiptQty: number
  receiptAt: string
} | null

export type TraceabilityFinishedGoodsReceipt = {
  id: string
  receiptAt: string
  itemCode: string
  itemName: string
  lotId: string | null
  lotNo: string | null
  receiptQty: number
  warehouseName: string | null
  locationName: string | null
  inventoryTransactionNo: string | null
}

export type TraceabilityShipment = {
  shipmentId: string
  shipmentNo: string
  shipmentStatus: string
  status: string
  plannedDate: string
  shippedDate: string | null
  salesOrderNo: string | null
  customerName: string | null
  itemCode: string
  itemName: string
  lotId: string | null
  lotNo: string | null
  qty: number
  warehouseName: string | null
  inventoryTransactionNo: string | null
}

export type TraceabilityWipMovement = {
  id: string
  wipUnitId: string
  relatedWipUnitId: string | null
  movementType: string
  qty: number
  sourceType: string | null
  sourceId: string | null
  note: string | null
  createdAt: string
  fromOperationId: string | null
  toOperationId: string | null
  fromOperationName: string | null
  toOperationName: string | null
  fromOperationSeq: number | null
  toOperationSeq: number | null
  fromWorkCenterName: string | null
  toWorkCenterName: string | null
  fromPartnerName: string | null
  toPartnerName: string | null
}

export type TraceabilityLotGenealogyNode = {
  lotId: string
  lotNo: string
  itemCode: string
  itemName: string
  itemType: string | null
  relationType: string | null
  qty: number | null
  parents: TraceabilityLotGenealogyNode[]
}

export type ManufacturingTraceability = {
  manufacturingNo: string
  workOrder: {
    id: string
    orderNo: string
    status: string
    plannedQty: number
    item: {
      id: string
      code: string
      name: string
      spec: string | null
      uom: string
    }
  } | null
  materialLots: TraceabilityMaterialLot[]
  processHistory: TraceabilityProcessHistory[]
  inspections: TraceabilityInspection[]
  // @deprecated — finishedGoodsReceipts 배열을 사용하세요. 호환성 위해 마지막 1건 유지.
  packaging: TraceabilityPackaging
  // @deprecated — finishedGoodsReceipts 배열을 사용하세요. 호환성 위해 마지막 1건 유지.
  finishedGoodsReceipt: TraceabilityPackaging
  finishedGoodsReceipts: TraceabilityFinishedGoodsReceipt[]
  shipments: TraceabilityShipment[]
  wipMovements: TraceabilityWipMovement[]
  lotGenealogyTrees?: TraceabilityLotGenealogyNode[]
}

function toLotGenealogyNode(node: LotGenealogyNode): TraceabilityLotGenealogyNode {
  return {
    lotId: node.lot.id,
    lotNo: node.lot.lotNo,
    itemCode: node.lot.item.code,
    itemName: node.lot.item.name,
    itemType: node.lot.item.itemType,
    relationType: node.relationType as string | null,
    qty: node.qty,
    parents: node.parents.map(toLotGenealogyNode),
  }
}

export async function getManufacturingTraceability(
  manufacturingNo: string,
  tenantId: string,
): Promise<ManufacturingTraceability | null> {
  await assertDaewonFeatureScope()
  assertSessionTenant(await requireActor(), tenantId)
  const trimmed = manufacturingNo.trim()
  if (!trimmed) return null

  const workOrder = await prisma.workOrder.findFirst({
    where: { tenantId, manufacturingNo: trimmed },
    include: {
      item: {
        select: { id: true, code: true, name: true, spec: true, uom: true },
      },
      operations: {
        orderBy: { seq: "asc" },
        include: {
          routingOperation: { select: { name: true } },
          productionResults: {
            orderBy: { startedAt: "asc" },
            select: {
              startedAt: true,
              endedAt: true,
              goodQty: true,
              defectQty: true,
            },
          },
          qualityInspections: {
            orderBy: { inspectedAt: "asc" },
            include: {
              inspectionSpec: {
                include: {
                  routingOperation: { select: { name: true } },
                },
              },
              inspector: { select: { name: true } },
              defectRecords: { select: { qty: true } },
            },
          },
        },
      },
      finishedGoodsReceipts: {
        orderBy: { receiptAt: "asc" },
        include: {
          warehouse: { select: { name: true } },
          location: { select: { name: true } },
          item: { select: { code: true, name: true } },
          lot: { select: { id: true, lotNo: true } },
        },
      },
    },
  })

  if (!workOrder) {
    return {
      manufacturingNo: trimmed,
      workOrder: null,
      materialLots: [],
      processHistory: [],
      inspections: [],
      packaging: null,
      finishedGoodsReceipt: null,
      finishedGoodsReceipts: [],
      shipments: [],
      wipMovements: [],
      lotGenealogyTrees: [],
    }
  }

  // 투입 원자재 LOT
  const materialLotRows = await prisma.workOrderMaterialLot.findMany({
    where: { tenantId, workOrderId: workOrder.id },
    include: {
      materialItem: {
        select: { id: true, code: true, name: true, spec: true },
      },
    },
    orderBy: { issuedAt: "asc" },
  })

  const materialLots: TraceabilityMaterialLot[] = materialLotRows.map((row) => ({
    materialItemId: row.materialItemId,
    materialCode: row.materialItem?.code ?? null,
    materialName: row.materialItem?.name ?? null,
    materialSpec: row.materialItem?.spec ?? null,
    lotNo: row.materialLotNo,
    qty: Number(row.qty),
    unit: row.unit,
    issuedAt: row.issuedAt.toISOString(),
  }))

  // 공정 진행 이력
  const processHistory: TraceabilityProcessHistory[] = workOrder.operations.map((op) => {
    const totalGood = op.productionResults.reduce(
      (s, r) => s + Number(r.goodQty),
      0,
    )
    const totalDefect = op.productionResults.reduce(
      (s, r) => s + Number(r.defectQty),
      0,
    )
    const startedAt = op.productionResults.find((r) => r.startedAt)?.startedAt ?? null
    const completedAt = [...op.productionResults]
      .reverse()
      .find((r) => r.endedAt)?.endedAt ?? null

    return {
      operationId: op.id,
      seq: op.seq,
      processName: op.routingOperation.name,
      status: op.status,
      startedAt: startedAt?.toISOString() ?? null,
      completedAt: completedAt?.toISOString() ?? null,
      workerName: null,
      goodQty: totalGood,
      defectQty: totalDefect,
      note: null,
    }
  })

  // 검사 결과 (모든 공정 검사 합산)
  const inspections: TraceabilityInspection[] = workOrder.operations.flatMap((op) =>
    op.qualityInspections.map((qi) => ({
      id: qi.id,
      processName: qi.inspectionSpec.routingOperation.name,
      stage: qi.stage,
      result: qi.result,
      inspectedQty: Number(qi.inspectedQty),
      defectQty: qi.defectRecords.reduce((sum, record) => sum + Number(record.qty), 0),
      inspectedAt: qi.inspectedAt.toISOString(),
      inspectorName: qi.inspector?.name ?? null,
    })),
  )

  // 완제품 입고 (= 포장/입고 정보의 출처) — 최근 1건을 대표값으로 (deprecated 호환)
  const latestReceipt = workOrder.finishedGoodsReceipts[workOrder.finishedGoodsReceipts.length - 1]
  const packagingInfo: TraceabilityPackaging = latestReceipt
    ? {
        warehouseName: latestReceipt.warehouse?.name ?? null,
        locationName: latestReceipt.location?.name ?? null,
        receiptQty: Number(latestReceipt.receiptQty),
        receiptAt: latestReceipt.receiptAt.toISOString(),
      }
    : null

  // 완제품 입고 다건 — 각 입고건의 InventoryTransaction(RECEIPT, refType=WORK_ORDER) 번호 매칭
  let receiptInventoryTxByLotId = new Map<string, string>()
  const receiptLotIds = workOrder.finishedGoodsReceipts
    .map((r) => r.lotId)
    .filter((id): id is string => id != null)
  if (receiptLotIds.length > 0) {
    const receiptTxs = await prisma.inventoryTransaction.findMany({
      where: {
        tenantId,
        txType: "RECEIPT",
        refType: "WORK_ORDER",
        refId: workOrder.id,
        lotId: { in: receiptLotIds },
      },
      select: { lotId: true, txNo: true, txAt: true },
      orderBy: { txAt: "asc" },
    })
    // lotId 당 첫 입고 트랜잭션 번호 채택 (1건 입고 = 1 LOT 발번 정책 기준)
    receiptInventoryTxByLotId = new Map(
      receiptTxs
        .filter((t): t is typeof t & { lotId: string } => t.lotId != null)
        .map((t) => [t.lotId, t.txNo]),
    )
  }

  const finishedGoodsReceiptsList: TraceabilityFinishedGoodsReceipt[] =
    workOrder.finishedGoodsReceipts.map((r) => ({
      id: r.id,
      receiptAt: r.receiptAt.toISOString(),
      itemCode: r.item.code,
      itemName: r.item.name,
      lotId: r.lot?.id ?? null,
      lotNo: r.lot?.lotNo ?? null,
      receiptQty: Number(r.receiptQty),
      warehouseName: r.warehouse?.name ?? null,
      locationName: r.location?.name ?? null,
      inventoryTransactionNo: r.lot?.id
        ? receiptInventoryTxByLotId.get(r.lot.id) ?? null
        : null,
    }))

  // 출고: 같은 LOT가 출고된 ShipmentItem 검색
  // 작업지시의 완제품 입고 LOT를 거쳐 추적
  const finishedLotIds = workOrder.finishedGoodsReceipts
    .map((r) => r.lotId)
    .filter((id): id is string => id != null)

  let shipments: TraceabilityShipment[] = []
  if (finishedLotIds.length > 0) {
    const shipmentItems = await prisma.shipmentItem.findMany({
      where: {
        lotId: { in: finishedLotIds },
        shipmentOrder: { tenantId },
      },
      include: {
        shipmentOrder: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
            plannedDate: true,
            shippedDate: true,
            warehouse: { select: { name: true } },
            salesOrder: {
              select: {
                orderNo: true,
                customer: { select: { name: true } },
              },
            },
          },
        },
        item: { select: { code: true, name: true } },
        lot: { select: { id: true, lotNo: true } },
      },
      orderBy: { shipmentOrder: { plannedDate: "asc" } },
    })

    const shipmentItemIds = shipmentItems.map((si) => si.id)
    const shipmentTxs = shipmentItemIds.length > 0
      ? await prisma.inventoryTransaction.findMany({
          where: {
            tenantId,
            txType: "ISSUE",
            refType: "SHIPMENT_ITEM",
            refId: { in: shipmentItemIds },
          },
          select: { refId: true, lotId: true, txNo: true },
        })
      : []
    const shipmentTxByItemId = new Map(
      shipmentTxs.map((tx) => [`${tx.refId}:${tx.lotId ?? "NO_LOT"}`, tx.txNo]),
    )

    shipments = shipmentItems.map((si) => ({
      shipmentId: si.shipmentOrder.id,
      shipmentNo: si.shipmentOrder.shipmentNo,
      shipmentStatus: si.shipmentOrder.status,
      status: si.shipmentOrder.status,
      plannedDate: si.shipmentOrder.plannedDate.toISOString(),
      shippedDate: si.shipmentOrder.shippedDate?.toISOString() ?? null,
      salesOrderNo: si.shipmentOrder.salesOrder.orderNo,
      customerName: si.shipmentOrder.salesOrder.customer.name,
      itemCode: si.item.code,
      itemName: si.item.name,
      lotId: si.lot?.id ?? null,
      lotNo: si.lot?.lotNo ?? null,
      qty: Number(si.qty),
      warehouseName: si.shipmentOrder.warehouse?.name ?? null,
      inventoryTransactionNo: shipmentTxByItemId.get(`${si.id}:${si.lotId ?? "NO_LOT"}`) ?? null,
    }))
  }

  // 재공(WIP) 이동 이력 — 작업지시에 속한 WipUnit의 WipMovement 평탄화
  const wipUnits = await prisma.wipUnit.findMany({
    where: { tenantId, workOrderId: workOrder.id },
    include: {
      movements: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          fromOperation: {
            include: { routingOperation: { select: { name: true } } },
          },
          toOperation: {
            include: { routingOperation: { select: { name: true } } },
          },
          fromWorkCenter: { select: { name: true } },
          toWorkCenter: { select: { name: true } },
          fromPartner: { select: { name: true } },
          toPartner: { select: { name: true } },
        },
      },
    },
  })

  const wipMovements: TraceabilityWipMovement[] = wipUnits
    .flatMap((wu) =>
      wu.movements.map((m) => ({
        id: m.id,
        wipUnitId: m.wipUnitId,
        relatedWipUnitId: m.relatedWipUnitId,
        movementType: m.movementType,
        qty: Number(m.qty),
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        note: m.note,
        createdAt: m.createdAt.toISOString(),
        fromOperationId: m.fromOperationId,
        toOperationId: m.toOperationId,
        fromOperationName: m.fromOperation?.routingOperation.name ?? null,
        toOperationName: m.toOperation?.routingOperation.name ?? null,
        fromOperationSeq: m.fromOperation?.seq ?? null,
        toOperationSeq: m.toOperation?.seq ?? null,
        fromWorkCenterName: m.fromWorkCenter?.name ?? null,
        toWorkCenterName: m.toWorkCenter?.name ?? null,
        fromPartnerName: m.fromPartner?.name ?? null,
        toPartnerName: m.toPartner?.name ?? null,
      })),
    )
    .sort((a, b) => {
      const dateCompare = a.createdAt.localeCompare(b.createdAt)
      if (dateCompare !== 0) return dateCompare
      return a.id.localeCompare(b.id)
    })

  // LOT 계보 — 완제품 LOT 기준 upstream INPUT 계층 조회 (입고 LOT별)
  const lotGenealogyTrees: TraceabilityLotGenealogyNode[] = []
  const seenLotIds = new Set<string>()
  for (const receipt of workOrder.finishedGoodsReceipts) {
    const lotId = receipt.lot?.id
    if (!lotId || seenLotIds.has(lotId)) continue
    seenLotIds.add(lotId)
    const tree = await getLotGenealogyForTraceability(lotId, tenantId)
    if (tree) lotGenealogyTrees.push(toLotGenealogyNode(tree))
  }

  return {
    manufacturingNo: trimmed,
    workOrder: {
      id: workOrder.id,
      orderNo: workOrder.orderNo,
      status: workOrder.status,
      plannedQty: Number(workOrder.plannedQty),
      item: {
        id: workOrder.item.id,
        code: workOrder.item.code,
        name: workOrder.item.name,
        spec: workOrder.item.spec,
        uom: workOrder.item.uom,
      },
    },
    materialLots,
    processHistory,
    inspections,
    packaging: packagingInfo,
    finishedGoodsReceipt: packagingInfo,
    finishedGoodsReceipts: finishedGoodsReceiptsList,
    shipments,
    wipMovements,
    lotGenealogyTrees,
  }
}

// 제조번호 자동완성 / 목록 조회용 (옵션)
export async function listManufacturingNos(
  tenantId: string,
  search?: string,
): Promise<{ manufacturingNo: string; orderNo: string; itemName: string }[]> {
  await assertDaewonFeatureScope()
  assertSessionTenant(await requireActor(), tenantId)
  const rows = await prisma.workOrder.findMany({
    where: {
      tenantId,
      manufacturingNo: search
        ? { contains: search, mode: "insensitive" }
        : { not: null },
    },
    select: {
      manufacturingNo: true,
      orderNo: true,
      item: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  return rows
    .filter((r): r is typeof r & { manufacturingNo: string } => r.manufacturingNo != null)
    .map((r) => ({
      manufacturingNo: r.manufacturingNo,
      orderNo: r.orderNo,
      itemName: r.item.name,
    }))
}
