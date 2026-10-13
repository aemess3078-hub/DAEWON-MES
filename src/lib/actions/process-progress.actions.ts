"use server"

import { prisma } from "@/lib/db/prisma"
import { OperationStatus, WipMovementType, WipUnitStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireRole, getTenantId } from "@/lib/auth"
import { startOperation } from "@/lib/actions/pop.actions"
import { assertDirectOperationStatusRequestAllowed } from "@/lib/operation-status-integrity"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

// ─── Types ────────────────────────────────────────────────────────────────────

export type OperationProgressRow = {
  id: string
  seq: number
  status: OperationStatus
  plannedQty: number
  completedQty: number
  workOrder: {
    id: string
    orderNo: string
    status: string
    dueDate: Date | null
    item: { id: string; code: string; name: string }
  }
  routingOperation: {
    id: string
    name: string
    seq: number
    workCenter: { id: string; name: string } | null
  }
  equipment: { id: string; code: string; name: string } | null
  productionResults: {
    id: string
    goodQty: number
    defectQty: number
    reworkQty: number
    startedAt: Date | null
    endedAt: Date | null
  }[]
  totalGoodQty: number
  totalDefectQty: number
  totalReworkQty: number
}

export type ReworkRow = {
  id: string // rework WipUnit.id
  manufacturingNo: string | null
  workOrderOperationId: string
  reworkQty: number
  defectQty: number
  startedAt: Date | null
  canComplete: boolean
  blockedReason: string | null
  parentWipUnit: {
    id: string
    qty: number
    status: WipUnitStatus
  } | null
  workOrder: {
    id: string
    orderNo: string
    item: { id: string; code: string; name: string }
  }
  routingOperation: {
    name: string
    seq: number
    workCenter: { name: string } | null
  }
}

// ─── 공정진행 조회 ──────────────────────────────────────────────────────────────

export async function getOperationProgressList(
  tenantId: string
): Promise<OperationProgressRow[]> {
  const operations = await prisma.workOrderOperation.findMany({
    where: {
      workOrder: {
        tenantId,
        status: { in: ["RELEASED", "IN_PROGRESS", "COMPLETED"] },
      },
    },
    include: {
      workOrder: {
        include: {
          item: { select: { id: true, code: true, name: true } },
        },
      },
      routingOperation: {
        include: {
          workCenter: { select: { id: true, name: true } },
        },
      },
      equipment: { select: { id: true, code: true, name: true } },
      productionResults: {
        orderBy: { startedAt: "asc" },
      },
    },
    orderBy: [
      { workOrder: { dueDate: "asc" } },
      { workOrder: { orderNo: "asc" } },
      { seq: "asc" },
    ],
  })

  return operations.map((op) => {
    const totalGoodQty = op.productionResults.reduce(
      (s, r) => s + Number(r.goodQty),
      0
    )
    const totalDefectQty = op.productionResults.reduce(
      (s, r) => s + Number(r.defectQty),
      0
    )
    const totalReworkQty = op.productionResults.reduce(
      (s, r) => s + Number(r.reworkQty),
      0
    )
    return {
      id: op.id,
      seq: op.seq,
      status: op.status,
      plannedQty: Number(op.plannedQty),
      completedQty: Number(op.completedQty),
      workOrder: {
        id: op.workOrder.id,
        orderNo: op.workOrder.orderNo,
        status: op.workOrder.status,
        dueDate: op.workOrder.dueDate,
        item: op.workOrder.item,
      },
      routingOperation: {
        id: op.routingOperation.id,
        name: op.routingOperation.name,
        seq: op.routingOperation.seq,
        workCenter: op.routingOperation.workCenter,
      },
      equipment: op.equipment,
      productionResults: op.productionResults.map((r) => ({
        id: r.id,
        goodQty: Number(r.goodQty),
        defectQty: Number(r.defectQty),
        reworkQty: Number(r.reworkQty),
        startedAt: r.startedAt,
        endedAt: r.endedAt,
      })),
      totalGoodQty,
      totalDefectQty,
      totalReworkQty,
    }
  })
}

// ─── 재작업 대기 목록 조회 ───────────────────────────────────────────────────────

export async function getReworkPendingList(
  tenantId: string
): Promise<ReworkRow[]> {
  await assertDaewonFeatureScope()
  const reworkWipUnits = await prisma.wipUnit.findMany({
    where: {
      tenantId,
      status: WipUnitStatus.REWORK,
      parentWipUnitId: { not: null },
      sourceProductionResultId: { not: null },
    },
    include: {
      sourceProductionResult: {
        select: {
          defectQty: true,
          startedAt: true,
        },
      },
      parentWipUnit: {
        select: {
          id: true,
          qty: true,
          status: true,
          workOrderOperationId: true,
        },
      },
      workOrderOperation: {
        include: {
          workOrder: {
            select: {
              id: true,
              orderNo: true,
              item: { select: { id: true, code: true, name: true } },
              operations: {
                select: { id: true, seq: true },
                orderBy: { seq: "desc" },
                take: 1,
              },
            },
          },
          routingOperation: {
            include: {
              workCenter: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return reworkWipUnits.map((wipUnit) => {
    const lastOperation = wipUnit.workOrderOperation.workOrder.operations[0] ?? null
    const isFinalOperation = lastOperation?.id === wipUnit.workOrderOperationId
    const hasCompletedParent =
      wipUnit.parentWipUnit?.status === WipUnitStatus.COMPLETED &&
      wipUnit.parentWipUnit.workOrderOperationId === wipUnit.workOrderOperationId
    const blockedReason = !isFinalOperation
      ? "중간공정 재작업은 후속 routing 반영 전까지 완료할 수 없습니다."
      : !hasCompletedParent
        ? "최종공정 완료 root WipUnit을 확인할 수 없습니다."
        : null

    return {
      id: wipUnit.id,
      manufacturingNo: wipUnit.manufacturingNo,
      workOrderOperationId: wipUnit.workOrderOperationId,
      reworkQty: Number(wipUnit.qty),
      defectQty: Number(wipUnit.sourceProductionResult?.defectQty ?? 0),
      startedAt: wipUnit.sourceProductionResult?.startedAt ?? wipUnit.createdAt,
      canComplete: blockedReason == null,
      blockedReason,
      parentWipUnit: wipUnit.parentWipUnit
        ? {
            id: wipUnit.parentWipUnit.id,
            qty: Number(wipUnit.parentWipUnit.qty),
            status: wipUnit.parentWipUnit.status,
          }
        : null,
      workOrder: {
        id: wipUnit.workOrderOperation.workOrder.id,
        orderNo: wipUnit.workOrderOperation.workOrder.orderNo,
        item: wipUnit.workOrderOperation.workOrder.item,
      },
      routingOperation: {
        name: wipUnit.workOrderOperation.routingOperation.name,
        seq: wipUnit.workOrderOperation.routingOperation.seq,
        workCenter: wipUnit.workOrderOperation.routingOperation.workCenter,
      },
    }
  })
}

// ─── 공정 상태 변경 ─────────────────────────────────────────────────────────────

export async function updateOperationStatusAction(
  operationId: string,
  status: OperationStatus
): Promise<{ ok: boolean; error?: string }> {
  await requireResourcePermission("WORK_RESULT", "UPDATE")
  try {
    await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const op = await prisma.workOrderOperation.findFirst({
      where: { id: operationId, workOrder: { tenantId } },
      select: {
        status: true,
      },
    })
    if (!op) return { ok: false, error: "공정을 찾을 수 없습니다." }

    assertDirectOperationStatusRequestAllowed(op.status, status)
    const result = await startOperation(operationId)
    if (!result.success) return { ok: false, error: result.error }

    revalidatePath("/app/mes/process-progress")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "오류가 발생했습니다." }
  }
}

// ─── 공정부적합 처리 (재작업수량 설정) ────────────────────────────────────────────

export async function dispositionDefects(
  productionResultId: string,
  reworkQty: number
): Promise<{ ok: boolean; error?: string }> {
  await requireResourcePermission("DEFECT_MANAGEMENT", "CREATE")
  const tenantId = await getTenantId()
  try {
    await prisma.$transaction(async (tx) => {
      const productionResult = await tx.productionResult.findFirst({
        where: { id: productionResultId, workOrderOperation: { workOrder: { tenantId } } },
        select: { defectQty: true, reworkQty: true },
      })
      if (!productionResult) {
        throw new Error("생산실적을 찾을 수 없습니다.")
      }

      const defectQty = Number(productionResult.defectQty)
      if (!Number.isFinite(reworkQty) || reworkQty < 0 || reworkQty > defectQty) {
        throw new Error(`재작업 수량은 0 ~ ${defectQty} 범위여야 합니다.`)
      }

      if (reworkQty === Number(productionResult.reworkQty)) return

      const scrappedChildWipUnit = await tx.wipUnit.findFirst({
        where: {
          sourceProductionResultId: productionResultId,
          parentWipUnitId: { not: null },
          status: WipUnitStatus.SCRAPPED,
        },
        select: { id: true },
      })
      if (scrappedChildWipUnit) {
        throw new Error(
          "이미 SCRAPPED WipUnit으로 분리된 불량 실적은 재작업으로 재분류할 수 없습니다."
        )
      }

      await tx.productionResult.update({
        where: { id: productionResultId },
        data: { reworkQty },
      })
    })
    revalidatePath("/app/mes/process-progress")
    revalidatePath("/app/mes/rework")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "오류가 발생했습니다." }
  }
}

// ─── 최종공정 재작업 WIP 일괄 종결 ───────────────────────────────────────────────

export type CompleteReworkInput = {
  reworkWipUnitId: string
  mergedQty: number
  scrapQty: number
}

export async function completeRework(
  input: CompleteReworkInput
): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("WORK_RESULT", "UPDATE")
  try {
    await prisma.$transaction(async (tx) => {
      const { reworkWipUnitId, mergedQty, scrapQty } = input
      if (
        !Number.isFinite(mergedQty) ||
        !Number.isFinite(scrapQty) ||
        mergedQty < 0 ||
        scrapQty < 0 ||
        mergedQty + scrapQty <= 0
      ) {
        throw new Error("복귀 수량과 폐기 수량을 올바르게 입력하세요.")
      }

      const child = await tx.wipUnit.findUnique({
        where: { id: reworkWipUnitId },
        include: {
          parentWipUnit: {
            select: {
              id: true,
              qty: true,
              status: true,
              parentWipUnitId: true,
              workOrderOperationId: true,
              currentWorkCenterId: true,
            },
          },
          workOrderOperation: {
            select: {
              id: true,
              workOrder: {
                select: {
                  operations: {
                    select: { id: true, seq: true },
                    orderBy: { seq: "desc" },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      })
      if (
        !child ||
        child.status !== WipUnitStatus.REWORK ||
        child.parentWipUnitId == null ||
        child.sourceProductionResultId == null
      ) {
        throw new Error("처리 가능한 REWORK WipUnit을 찾을 수 없습니다.")
      }

      const existingCompletion = await tx.wipMovement.findFirst({
        where: {
          sourceType: "ReworkCompletion",
          sourceId: child.id,
        },
        select: { id: true },
      })
      if (existingCompletion) {
        throw new Error("이미 종결 처리된 REWORK WipUnit입니다.")
      }

      const childQty = Number(child.qty)
      if (Math.abs(mergedQty + scrapQty - childQty) > 0.000001) {
        throw new Error(
          `복귀 수량과 폐기 수량의 합계는 재작업 수량(${childQty})과 같아야 합니다.`
        )
      }

      const lastOperation = child.workOrderOperation.workOrder.operations[0] ?? null
      if (!lastOperation || lastOperation.id !== child.workOrderOperationId) {
        throw new Error("중간공정 REWORK WipUnit은 후속 routing 반영 전까지 종결할 수 없습니다.")
      }

      const parent = child.parentWipUnit
      if (
        !parent ||
        parent.parentWipUnitId != null ||
        parent.status !== WipUnitStatus.COMPLETED ||
        parent.workOrderOperationId !== child.workOrderOperationId
      ) {
        throw new Error("최종공정 완료 root WipUnit에만 재작업 수량을 복귀할 수 있습니다.")
      }

      const childStatus =
        mergedQty > 0 ? WipUnitStatus.COMPLETED : WipUnitStatus.SCRAPPED
      const claimed = await tx.wipUnit.updateMany({
        where: { id: child.id, status: WipUnitStatus.REWORK },
        data: { status: childStatus },
      })
      if (claimed.count !== 1) {
        throw new Error("이미 처리 중이거나 종결된 REWORK WipUnit입니다.")
      }

      if (mergedQty > 0) {
        await tx.wipUnit.update({
          where: { id: parent.id },
          data: { qty: { increment: mergedQty } },
        })
      }

      const movements = []
      if (mergedQty > 0) {
        movements.push({
          tenantId: child.tenantId,
          siteId: child.siteId,
          wipUnitId: parent.id,
          relatedWipUnitId: child.id,
          movementType: WipMovementType.MERGE,
          fromOperationId: child.workOrderOperationId,
          toOperationId: parent.workOrderOperationId,
          fromWorkCenterId: child.currentWorkCenterId,
          toWorkCenterId: parent.currentWorkCenterId,
          qty: mergedQty,
          sourceType: "ReworkCompletion",
          sourceId: child.id,
          note: `재작업 양품 복귀: ${mergedQty}`,
        })
      }
      if (scrapQty > 0) {
        movements.push({
          tenantId: child.tenantId,
          siteId: child.siteId,
          wipUnitId: child.id,
          relatedWipUnitId: parent.id,
          movementType: WipMovementType.SCRAP,
          fromOperationId: child.workOrderOperationId,
          toOperationId: child.workOrderOperationId,
          fromWorkCenterId: child.currentWorkCenterId,
          toWorkCenterId: child.currentWorkCenterId,
          qty: scrapQty,
          sourceType: "ReworkCompletion",
          sourceId: child.id,
          note: `재작업 후 폐기: ${scrapQty}`,
        })
      }
      await tx.wipMovement.createMany({
        data: movements,
      })
    })
    revalidatePath("/app/mes/process-progress")
    revalidatePath("/app/mes/rework")
    revalidatePath("/app/mes/finished-goods-receipt")
    revalidatePath("/app/mes/manufacturing-traceability")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "오류가 발생했습니다." }
  }
}
