"use server"

import { LotGenealogyRelation } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { requireRole } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { createFinishedGoodsLot } from "./finished-goods-lot.helpers"
import { resolveFinishedGoodsReceiptDestination } from "./finished-goods-location.helpers"
import { createLotGenealogyLink } from "./lot-genealogy.helpers"
import {
  WIP_RECEIPT_BLOCK_REASONS,
  computeWipReceiptStatus,
} from "./wip-receipt.helpers"
import {
  assertWorkOrderLotQualityReleaseAllowed,
  assertWorkOrderQualityReleaseAllowed,
  getWorkOrderQualityReleaseStatus,
  type QualityReleaseStatus,
} from "./quality-release-gate.helpers"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import {
  lockWorkOrderForUpdate,
  withQuantityTransactionRetry,
} from "@/lib/quantity-concurrency"
import { recordAuditLog } from "@/lib/audit-log"

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkOrderForReceipt = {
  id: string
  orderNo: string
  manufacturingNo: string | null
  status: string
  dueDate: Date | null
  plannedQty: number
  item: { id: string; code: string; name: string; uom: string; itemType: string | null }
  site: { id: string; name: string }
  totalGoodQty: number
  receiptBasisQty: number
  totalReceiptQty: number
  pendingQty: number
  isWipTracked: boolean
  receiptBlockedReason: string | null
  qualityRelease: QualityReleaseStatus
  // WipUnit 진행 상태 — 입고 가능 여부 판단 보조용. null 이면 WIP 추적 없는 레거시 작업지시.
  wipUnitStatus: string | null
  receipts: {
    id: string
    receiptQty: number
    receiptAt: Date
    lotNo: string | null
    warehouse: { id: string; name: string }
    location: { id: string; name: string }
  }[]
}

export type WarehouseWithLocations = {
  id: string
  siteId: string
  code: string
  name: string
}

export type CreateReceiptInput = {
  workOrderId: string
  itemId: string
  siteId: string
  warehouseId: string
  receiptQty: number
  lotId?: string | null
}

type ReceiptQuantitySource = {
  operations: {
    id: string
    seq: number
    completedQty: unknown
    productionResults: { id: string; goodQty: unknown; reworkQty: unknown }[]
  }[]
  finishedGoodsReceipts: { receiptQty: unknown }[]
  wipUnits: {
    id: string
    workOrderOperationId: string
    parentWipUnitId: string | null
    sourceProductionResultId: string | null
    qty: unknown
    status: string
    movements: { movementType: string; relatedWipUnitId: string | null }[]
    relatedMovements: { id: string }[]
  }[]
}

// WipUnit 추적 작업지시는 computeWipReceiptStatus 결과를 그대로 사용.
// 레거시(WipUnit 없는) 작업지시는 최종공정 양품 합계를 기준 수량으로 fallback.
function calculateReceiptQuantity(source: ReceiptQuantitySource) {
  const status = computeWipReceiptStatus(source)
  const totalGoodQty = source.operations.reduce(
    (sum, operation) =>
      sum +
      operation.productionResults.reduce(
        (subtotal, result) => subtotal + Number(result.goodQty),
        0,
      ),
    0,
  )
  const lastOperation = source.operations.reduce<typeof source.operations[number] | null>(
    (latest, operation) => (!latest || operation.seq > latest.seq ? operation : latest),
    null,
  )
  const legacyFinalOperationGoodQty =
    lastOperation?.productionResults.reduce(
      (sum, result) => sum + Number(result.goodQty),
      0,
    ) ?? 0
  const receiptBasisQty = status.isWipTracked
    ? status.completedRootQty
    : legacyFinalOperationGoodQty
  const pendingQty = status.blocked
    ? 0
    : Math.max(0, receiptBasisQty - status.totalReceiptQty)

  return {
    totalGoodQty,
    receiptBasisQty,
    totalReceiptQty: status.totalReceiptQty,
    pendingQty,
    isWipTracked: status.isWipTracked,
    receiptBlockedReason: status.blockReasonError,
    rootWipUnits: source.wipUnits.filter(
      (unit) =>
        unit.parentWipUnitId == null && unit.sourceProductionResultId == null,
    ),
    completedRootWipUnits: status.completedRootWipUnits,
    finalOperationId: status.finalOperationId,
  }
}

// ─── COMPLETED WorkOrder 목록 조회 ──────────────────────────────────────────

export async function getWorkOrdersForReceipt(
  tenantId: string
): Promise<WorkOrderForReceipt[]> {
  const workOrders = await prisma.workOrder.findMany({
    where: { tenantId, status: "COMPLETED" },
    include: {
      item: { select: { id: true, code: true, name: true, uom: true, itemType: true } },
      site: { select: { id: true, name: true } },
      operations: {
        include: {
          productionResults: {
            select: { id: true, goodQty: true, reworkQty: true },
          },
        },
        orderBy: { seq: "desc" },
      },
      finishedGoodsReceipts: {
        include: {
          warehouse: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          lot: { select: { id: true, lotNo: true } },
        },
        orderBy: { receiptAt: "desc" },
      },
      wipUnits: {
        where: {
          OR: [
            { parentWipUnitId: null, sourceProductionResultId: null },
            { parentWipUnitId: { not: null }, status: "REWORK" },
            { relatedMovements: { some: { movementType: "REWORK" } } },
          ],
        },
        select: {
          id: true,
          workOrderOperationId: true,
          parentWipUnitId: true,
          sourceProductionResultId: true,
          qty: true,
          status: true,
          movements: {
            where: { movementType: "REWORK" },
            select: { movementType: true, relatedWipUnitId: true },
          },
          relatedMovements: {
            where: { movementType: "REWORK" },
            select: { id: true },
          },
        },
        orderBy: [{ updatedAt: "desc" }],
      },
    },
    orderBy: { updatedAt: "desc" },
  })

  return Promise.all(workOrders.map(async (wo) => {
    const receiptQuantity = calculateReceiptQuantity(wo)
    const latestRootWipUnit = receiptQuantity.rootWipUnits[0] ?? null

    const qualityRelease = await getWorkOrderQualityReleaseStatus(prisma, {
      tenantId,
      workOrderId: wo.id,
    })

    return {
      id: wo.id,
      orderNo: wo.orderNo,
      manufacturingNo: wo.manufacturingNo,
      status: wo.status,
      dueDate: wo.dueDate,
      plannedQty: Number(wo.plannedQty),
      item: wo.item,
      site: wo.site,
      totalGoodQty: receiptQuantity.totalGoodQty,
      receiptBasisQty: receiptQuantity.receiptBasisQty,
      totalReceiptQty: receiptQuantity.totalReceiptQty,
      pendingQty: receiptQuantity.pendingQty,
      isWipTracked: receiptQuantity.isWipTracked,
      receiptBlockedReason: receiptQuantity.receiptBlockedReason,
      qualityRelease,
      wipUnitStatus: latestRootWipUnit?.status ?? null,
      receipts: wo.finishedGoodsReceipts.map((r) => ({
        id: r.id,
        receiptQty: Number(r.receiptQty),
        receiptAt: r.receiptAt,
        lotNo: r.lot?.lotNo ?? null,
        warehouse: r.warehouse,
        location: r.location,
      })),
    }
  }))
}

// ─── 완제품 입고 로케이션 목록 (Warehouse) ─────────────────────────────────

export async function getFinishedGoodsWarehouses(
  tenantId: string
): Promise<WarehouseWithLocations[]> {
  const warehouses = await prisma.warehouse.findMany({
    where: { tenantId },
    select: { id: true, siteId: true, code: true, name: true },
    orderBy: { name: "asc" },
  })

  return warehouses.map((wh) => ({
    id: wh.id,
    siteId: wh.siteId,
    code: wh.code,
    name: wh.name,
  }))
}

// ─── 완제품 입고 처리 ─────────────────────────────────────────────────────────

async function generateReceiptTxNo(tenantId: string): Promise<string> {
  const now = new Date()
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, "")
  const hhmmssSSS = now.toISOString().slice(11, 23).replace(/[:.]/g, "")
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0")
  return `RCP-${yyyymmdd}-${hhmmssSSS}-${random}`
}

function isPrismaTransactionTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes("Transaction already closed") ||
    message.includes("timeout for this transaction") ||
    message.includes("Transaction API error") ||
    message.includes("P2028")
  )
}

export async function createFinishedGoodsReceiptAction(
  data: CreateReceiptInput,
  requestedTenantId?: string
): Promise<{ ok: boolean; error?: string; lotNo?: string }> {
  await requireResourcePermission("WORK_RESULT", "CREATE")
  try {
    let currentUser: Awaited<ReturnType<typeof requireRole>>
    try {
      currentUser = await requireRole("OPERATOR")
    } catch {
      throw new Error("권한이 없습니다.")
    }

    const tenantId = currentUser.tenantId
    if (requestedTenantId && requestedTenantId !== tenantId) {
      throw new Error("권한이 없습니다.")
    }

    let createdLotNo: string | null = null
    const txNo = await generateReceiptTxNo(tenantId)

    await withQuantityTransactionRetry(() => prisma.$transaction(async (tx) => {
      await lockWorkOrderForUpdate(tx, tenantId, data.workOrderId)

      // 1. WorkOrder 재조회 (입고 가능 수량 / WipUnit 상태 / 완제품 LOT 발번 정보)
      const workOrder = await tx.workOrder.findFirst({
        where: { id: data.workOrderId, tenantId },
        include: {
          operations: {
            select: {
              id: true,
              seq: true,
              completedQty: true,
              productionResults: { select: { id: true, goodQty: true, reworkQty: true } },
            },
          },
          finishedGoodsReceipts: { select: { receiptQty: true } },
          wipUnits: {
            where: {
              OR: [
                { parentWipUnitId: null, sourceProductionResultId: null },
                { parentWipUnitId: { not: null }, status: "REWORK" },
                { relatedMovements: { some: { movementType: "REWORK" } } },
              ],
            },
            select: {
              id: true,
              workOrderOperationId: true,
              parentWipUnitId: true,
              sourceProductionResultId: true,
              qty: true,
              status: true,
              lotId: true,
              movements: {
                where: { movementType: "REWORK" },
                select: { movementType: true, relatedWipUnitId: true },
              },
              relatedMovements: {
                where: { movementType: "REWORK" },
                select: { id: true },
              },
            },
            orderBy: [{ updatedAt: "desc" }],
          },
        },
      })

      if (!workOrder) {
        throw new Error("작업지시를 찾을 수 없습니다.")
      }
      if (workOrder.itemId !== data.itemId) {
        throw new Error("작업지시 품목과 입고 품목이 일치하지 않습니다.")
      }
      if (workOrder.siteId !== data.siteId) {
        throw new Error("입고 창고가 올바르지 않습니다.")
      }

      let selectedLot: { id: string; lotNo: string; itemId: string; status: string } | null = null
      if (data.lotId) {
        selectedLot = await tx.lot.findFirst({
          where: { id: data.lotId, tenantId },
          select: { id: true, lotNo: true, itemId: true, status: true },
        })
        if (!selectedLot) throw new Error("입고 대상 LOT를 찾을 수 없습니다.")
        if (selectedLot.itemId !== workOrder.itemId) {
          throw new Error("입고 대상 LOT 품목이 작업지시 품목과 일치하지 않습니다.")
        }
        if (selectedLot.status !== "ACTIVE") {
          throw new Error("활성 LOT만 입고 대상으로 선택할 수 있습니다.")
        }
        await assertWorkOrderLotQualityReleaseAllowed(tx, {
          tenantId,
          workOrderId: workOrder.id,
          lotId: selectedLot.id,
          target: "RECEIPT",
        })
      } else {
        await assertWorkOrderQualityReleaseAllowed(tx, {
          tenantId,
          workOrderId: workOrder.id,
          target: "RECEIPT",
        })
      }

      const { warehouse, location } = await resolveFinishedGoodsReceiptDestination(tx, {
        warehouseId: data.warehouseId,
        tenantId,
        siteId: workOrder.siteId,
      })

      // 품목 유형 조회 — 반제품(SEMI_FINISHED) 여부에 따라 LOT 발번 prefix 결정
      const itemRecord = await tx.item.findUnique({
        where: { id: data.itemId },
        select: { itemType: true },
      })
      const isSemiFinished = itemRecord?.itemType === "SEMI_FINISHED"

      // 2. WipUnit 기반 입고 검증
      //    - 완제품입고 대상은 ROOT && status=COMPLETED && 최종공정 도달 WipUnit 만
      //    - SCRAP_CHILD / REWORK_CHILD / SCRAPPED / REWORK / IN_PROCESS / WAITING /
      //      parent 있는 child 는 자연스럽게 제외됨 (completedRootWipUnits 필터)
      const receiptQuantity = calculateReceiptQuantity(workOrder)
      // lotId 갱신을 위해 트랜잭션 쿼리에서 직접 로드한 완료 root 를 사용 (lotId 필드 포함)
      const completedRootWipUnit =
        workOrder.wipUnits.find(
          (wipUnit) =>
            wipUnit.parentWipUnitId == null &&
            wipUnit.sourceProductionResultId == null &&
            wipUnit.status === "COMPLETED" &&
            wipUnit.workOrderOperationId === receiptQuantity.finalOperationId,
        ) ?? null
      if (!receiptQuantity.isWipTracked) {
        // 레거시: WipUnit 미생성 작업지시 — 최종공정 양품 합계 기준으로 fallback 진행
        console.warn(
          `[finished-goods] WipUnit not found for workOrderId=${workOrder.id} — 레거시 작업지시로 간주하고 입고 진행`,
        )
      }

      // 3. 보류 사유 차단 (rework/legacy/inconsistent)
      if (receiptQuantity.receiptBlockedReason) {
        throw new Error(receiptQuantity.receiptBlockedReason)
      }

      // 4. WIP 추적 작업지시인데 COMPLETED root 가 1건도 없으면 입고 대상 없음
      if (receiptQuantity.isWipTracked && !completedRootWipUnit) {
        throw new Error(WIP_RECEIPT_BLOCK_REASONS.NO_COMPLETED_ROOT_ERROR)
      }

      // 5. pendingQty 재계산 — UI max 신뢰하지 않고 동일 산정식으로 서버에서 다시 검증
      const pendingQty = receiptQuantity.pendingQty
      if (data.receiptQty <= 0) {
        throw new Error("입고 수량은 0보다 커야 합니다.")
      }
      if (pendingQty <= 0) {
        throw new Error(WIP_RECEIPT_BLOCK_REASONS.FULLY_RECEIVED_ERROR)
      }
      if (data.receiptQty > pendingQty) {
        throw new Error(
          `${WIP_RECEIPT_BLOCK_REASONS.NO_AVAILABLE_QTY_ERROR} (요청 ${data.receiptQty} / 가능 ${pendingQty})`,
        )
      }

      // 6. LOT 발번 — WorkOrder.manufacturingNo를 우선 사용하고,
      //    제조번호가 없는 예외 상황에서는 CNS resolver로 발번한다.
      const lot = selectedLot ?? await createFinishedGoodsLot(tx, {
        tenantId,
        workOrder: {
          orderNo: workOrder.orderNo,
          manufacturingNo: workOrder.manufacturingNo,
          itemId: workOrder.itemId,
        },
        isSemiFinished,
      })
      createdLotNo = lot.lotNo

      // 7. WipUnit.lotId 갱신 — 최초 LOT 만 연결 (다회차는 FinishedGoodsReceipt 로 추적).
      //    WipUnit 1건에는 단일 lotId 만 표현 가능하므로, 다회차 LOT 는 추적성 화면에서
      //    finishedGoodsReceipts 배열로 확인한다.
      if (completedRootWipUnit && completedRootWipUnit.lotId == null) {
        await tx.wipUnit.update({
          where: { id: completedRootWipUnit.id },
          data: { lotId: lot.id },
        })
      }

      // 7-B. LotGenealogy: 투입 LOT → 생성 LOT INPUT 연결
      //      FINISHED 입고: 투입 반제품 LOT → FG LOT (Phase 4-B-3)
      //      SEMI_FINISHED 입고: 투입 원자재 LOT → SF LOT (Phase 4-B-4)
      //      WorkOrderMaterialLot.inventoryTransaction.lotId 경로로 Lot ID 확보.
      {
        const filterItemType = isSemiFinished ? "RAW_MATERIAL" : "SEMI_FINISHED"
        const materialLotRecords = await tx.workOrderMaterialLot.findMany({
          where: { tenantId, workOrderId: data.workOrderId },
          include: {
            materialItem: { select: { itemType: true } },
            inventoryTransaction: { select: { lotId: true } },
          },
        })
        for (const ml of materialLotRecords) {
          if (ml.materialItem.itemType !== filterItemType) continue
          const parentLotId = ml.inventoryTransaction?.lotId
          if (!parentLotId) continue
          await createLotGenealogyLink(tx, {
            tenantId,
            parentLotId,
            childLotId: lot.id,
            relationType: LotGenealogyRelation.INPUT,
            qty: Number(ml.qty),
          })
        }
      }

      // 8. FinishedGoodsReceipt 생성 (lotId 연결)
      const receipt = await tx.finishedGoodsReceipt.create({
        data: {
          tenantId,
          siteId: data.siteId,
          workOrderId: data.workOrderId,
          itemId: data.itemId,
          lotId: lot.id,
          warehouseId: warehouse.id,
          locationId: location.id,
          receiptQty: data.receiptQty,
          receiptAt: new Date(),
        },
      })

      // 9. InventoryTransaction (RECEIPT) 생성 — lotId 연결
      //    NOTE: 기존 코드가 toLocationId 에 warehouseId 를 넣어왔다 (schema 관계상 Warehouse 매핑).
      //    명명 혼란이 있으나 이번 Phase 에서는 호환성 유지 위해 동일 동작 유지.
      await tx.inventoryTransaction.create({
        data: {
          tenantId,
          itemId: data.itemId,
          lotId: lot.id,
          toLocationId: warehouse.id,
          txNo,
          txType: "RECEIPT",
          qty: data.receiptQty,
          refType: "WORK_ORDER",
          refId: data.workOrderId,
          note: isSemiFinished ? "반제품 입고 처리" : "완제품 입고 처리",
          txAt: new Date(),
        },
      })

      // 10. InventoryBalance — lotId 포함 키로 upsert. 새 LOT 이면 신규 row 생성.
      const existing = await tx.inventoryBalance.findFirst({
        where: {
          tenantId,
          siteId: data.siteId,
          warehouseId: warehouse.id,
          itemId: data.itemId,
          lotId: lot.id,
        },
      })

      if (existing) {
        await tx.inventoryBalance.update({
          where: { id: existing.id },
          data: {
            qtyOnHand: { increment: data.receiptQty },
            qtyAvailable: { increment: data.receiptQty },
          },
        })
      } else {
        await tx.inventoryBalance.create({
          data: {
            tenantId,
            siteId: data.siteId,
            warehouseId: warehouse.id,
            itemId: data.itemId,
            lotId: lot.id,
            qtyOnHand: data.receiptQty,
            qtyAvailable: data.receiptQty,
            qtyHold: 0,
          },
        })
      }
      await recordAuditLog(tx, {
        tenantId,
        actor: currentUser,
        entityType: "FinishedGoodsReceipt",
        entityId: receipt.id,
        action: "CREATE",
        afterData: {
          workOrderId: data.workOrderId,
          itemId: data.itemId,
          lotId: lot.id,
          lotNo: lot.lotNo,
          warehouseId: warehouse.id,
          locationId: location.id,
          receiptQty: data.receiptQty,
          txNo,
        },
        menuName: "완제품입고",
      })
    }, {
      maxWait: 10000,
      timeout: 15000,
    }))

    revalidatePath("/app/mes/finished-goods-receipt")
    revalidatePath("/app/mes/inventory")
    revalidatePath("/app/mes/inventory-transactions")
    revalidatePath("/app/mes/manufacturing-traceability")
    return { ok: true, lotNo: createdLotNo ?? undefined }
  } catch (e) {
    if (isPrismaTransactionTimeoutError(e)) {
      console.error("[finished-goods] createFinishedGoodsReceiptAction transaction timeout", e)
      return {
        ok: false,
        error: "입고 처리 시간이 초과되었습니다. 중복 입고 방지를 위해 입고 이력을 확인한 뒤 다시 시도해 주세요.",
      }
    }
    return { ok: false, error: e instanceof Error ? e.message : "오류가 발생했습니다." }
  }
}
