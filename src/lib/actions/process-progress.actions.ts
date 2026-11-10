"use server"

import { prisma } from "@/lib/db/prisma"
import { OperationStatus, WipMovementType, WipUnitStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireRole, getTenantId, requireTenantAccess } from "@/lib/auth"
import { startOperation } from "@/lib/actions/pop.actions"
import { assertDirectOperationStatusRequestAllowed } from "@/lib/operation-status-integrity"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { completeReworkInTx } from "@/lib/actions/rework-return.helpers"

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
  /** 합격 수량이 복귀하는 공정(재작업 발생 공정의 다음 공정). 최종공정 재작업이면 null(완료 재공에 복귀). */
  returnToOperation: { name: string; seq: number } | null
}

// ─── 공정진행 조회 ──────────────────────────────────────────────────────────────

export async function getOperationProgressList(
  tenantId: string
): Promise<OperationProgressRow[]> {
  await requireTenantAccess(tenantId)
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
  await requireTenantAccess(tenantId)
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
                select: { id: true, seq: true, routingOperation: { select: { name: true } } },
                orderBy: { seq: "asc" },
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
    const allOps = wipUnit.workOrderOperation.workOrder.operations
    const lastOperation = allOps[allOps.length - 1] ?? null
    const isFinalOperation = lastOperation?.id === wipUnit.workOrderOperationId
    const hasCompletedParent =
      wipUnit.parentWipUnit?.status === WipUnitStatus.COMPLETED &&
      wipUnit.parentWipUnit.workOrderOperationId === wipUnit.workOrderOperationId
    const reworkOpSeq = wipUnit.workOrderOperation.seq
    const nextOp = isFinalOperation ? null : allOps.find((op) => op.seq > reworkOpSeq) ?? null
    // 최종공정 재작업은 완료 root 에 복귀. 중간공정 재작업은 다음 공정부터 정상 흐름에 복귀(복귀 가능 여부는 종결 시 서버가 검증한다).
    const blockedReason = isFinalOperation
      ? hasCompletedParent
        ? null
        : "최종공정 완료 root WipUnit을 확인할 수 없습니다."
      : nextOp
        ? null
        : "복귀할 후속 공정을 찾을 수 없습니다."

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
      returnToOperation: nextOp ? { name: nextOp.routingOperation.name, seq: nextOp.seq } : null,
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
  await requireResourcePermission("WORK_RESULT", "UPDATE")
  try {
    await prisma.$transaction((tx) => completeReworkInTx(tx, input))
    revalidatePath("/app/mes/process-progress")
    revalidatePath("/app/mes/rework")
    revalidatePath("/app/mes/finished-goods-receipt")
    revalidatePath("/app/mes/manufacturing-traceability")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "오류가 발생했습니다." }
  }
}
