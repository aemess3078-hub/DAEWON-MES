"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId, getCurrentUserId } from "@/lib/auth"
import { isMissingDbObjectError } from "@/lib/db/prisma-error"
import { InspectionStage, InspectionResult } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { assertInspectionHistoryMutable, validateInspectionMutationContext } from "./quality-inspection-integrity.helpers"
import { requireResourcePermission } from "@/lib/auth/role-permissions"

export type InspectionStageRow = {
  id: string
  workOrderOperationId: string
  inspectionSpecId: string
  inspectorId: string
  lotId: string | null
  stage: InspectionStage
  result: InspectionResult | null
  inspectedQty: number
  inspectedAt: Date
  lot: { id: string; lotNo: string; status: string } | null
  workOrderOperation: {
    id: string
    workOrder: {
      id: string
      orderNo: string
      item: { id: string; code: string; name: string }
    }
    routingOperation: { id: string; name: string; seq: number }
    plannedQty: number
    completedQty: number
  }
  inspector: { id: string; name: string }
}

export async function getInspectionsByStage(stage?: InspectionStage): Promise<InspectionStageRow[]> {
  const tenantId = await getTenantId()
  const rows = await prisma.qualityInspection.findMany({
    where: {
      workOrderOperation: { workOrder: { tenantId } },
      ...(stage && { stage }),
    },
    include: {
      workOrderOperation: {
        include: {
          workOrder: {
            include: { item: { select: { id: true, code: true, name: true } } },
          },
          routingOperation: { select: { id: true, name: true, seq: true } },
        },
      },
      inspector: { select: { id: true, name: true } },
      lot: { select: { id: true, lotNo: true, status: true } },
    },
    orderBy: { inspectedAt: "desc" },
  }).catch((error) => {
    if (isMissingDbObjectError(error)) return []
    throw error
  })
  return rows.map((r) => ({
    ...r,
    inspectedQty: Number(r.inspectedQty),
    workOrderOperation: {
      ...r.workOrderOperation,
      plannedQty:   Number(r.workOrderOperation.plannedQty),
      completedQty: Number(r.workOrderOperation.completedQty),
      // workOrder.plannedQty (Decimal) 누출 방지 — 필요 필드만 명시 재구성
      workOrder: {
        id:      r.workOrderOperation.workOrder.id,
        orderNo: r.workOrderOperation.workOrder.orderNo,
        item:    r.workOrderOperation.workOrder.item,
      },
    },
  }))
}

export async function createStagedInspection(data: {
  workOrderOperationId: string
  inspectionSpecId: string
  stage: InspectionStage
  result: string
  inspectedQty: number
  lotId?: string | null
}) {
  await requireResourcePermission("QUALITY_INSPECTION", "CREATE")
  const tenantId = await getTenantId()
  const userId = await getCurrentUserId()

  const { validatedLotId } = await validateInspectionMutationContext(prisma, tenantId, {
    ...data,
    inspectorId: userId,
    result: data.result as InspectionResult,
    measurements: [],
    defectRecords: [],
  })

  await prisma.qualityInspection.create({
    data: {
      workOrderOperationId: data.workOrderOperationId,
      inspectionSpecId: data.inspectionSpecId,
      inspectorId: userId,
      lotId: validatedLotId,
      stage: data.stage,
      result: data.result as InspectionResult,
      inspectedQty: data.inspectedQty,
    },
  })
  revalidatePath("/app/mes/inspection-stages")
  revalidatePath("/app/mes/inspection")
  revalidatePath("/app/mes/final-inspection")
  revalidatePath("/app/mes/finished-goods-receipt")
}

export async function updateStagedInspection(
  inspectionId: string,
  data: {
    stage?: InspectionStage
    result?: string
    inspectedQty?: number
    inspectedAt?: Date
  }
) {
  await requireResourcePermission("QUALITY_INSPECTION", "UPDATE")
  const tenantId = await getTenantId()
  const userId = await getCurrentUserId()

  const existing = await prisma.qualityInspection.findFirst({
    where: {
      id: inspectionId,
      workOrderOperation: { workOrder: { tenantId } },
    },
    select: { id: true, stage: true, result: true, inspectedQty: true, inspectedAt: true },
  })
  if (!existing) throw new Error("검사 기록을 찾을 수 없거나 권한이 없습니다.")
  if (data.result !== undefined && data.result !== existing.result) {
    await assertInspectionHistoryMutable(prisma, inspectionId, tenantId)
  }

  const updated = await prisma.qualityInspection.update({
    where: { id: inspectionId },
    data: {
      ...(data.stage !== undefined && { stage: data.stage }),
      ...(data.result !== undefined && { result: data.result as InspectionResult }),
      ...(data.inspectedQty !== undefined && { inspectedQty: data.inspectedQty }),
      ...(data.inspectedAt !== undefined && { inspectedAt: data.inspectedAt }),
    },
    select: { id: true, stage: true, result: true, inspectedQty: true, inspectedAt: true },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: userId,
      entityType: "QualityInspection",
      entityId: inspectionId,
      action: "UPDATE",
      beforeData: {
        stage: existing.stage,
        result: existing.result,
        inspectedQty: String(existing.inspectedQty),
        inspectedAt: existing.inspectedAt.toISOString(),
      },
      afterData: {
        stage: updated.stage,
        result: updated.result,
        inspectedQty: String(updated.inspectedQty),
        inspectedAt: updated.inspectedAt.toISOString(),
      },
      menuName: "검사결과 관리",
    },
  })

  revalidatePath("/app/mes/inspection-stages")
  revalidatePath("/app/mes/inspection")
  revalidatePath("/app/mes/manufacturing-traceability")
  revalidatePath("/app/mes/final-inspection")
  revalidatePath("/app/mes/finished-goods-receipt")
}

export async function getWorkOrdersForInspection() {
  const tenantId = await getTenantId()
  const ops = await prisma.workOrderOperation.findMany({
    where: {
      workOrder: { tenantId, status: { in: ["RELEASED", "IN_PROGRESS", "COMPLETED"] } },
    },
    include: {
      workOrder: {
        include: { item: { select: { id: true, code: true, name: true } } },
      },
      routingOperation: { select: { id: true, name: true, seq: true } },
    },
    orderBy: { workOrder: { orderNo: "asc" } },
  })

  // Attach inspection spec for each routingOperation
  const specMap = new Map<string, { id: string }>()
  const routingOpIds = Array.from(new Set(ops.map((o) => o.routingOperationId)))
  if (routingOpIds.length > 0) {
    const specs = await prisma.inspectionSpec.findMany({
      where: { tenantId, routingOperationId: { in: routingOpIds }, status: "ACTIVE" },
      select: { id: true, itemId: true, routingOperationId: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    })
    specs.forEach((s) => {
      const key = `${s.itemId}:${s.routingOperationId}`
      if (!specMap.has(key)) specMap.set(key, { id: s.id })
    })
  }

  return ops.map((op) => ({
    ...op,
    plannedQty:       Number(op.plannedQty),
    completedQty:     Number(op.completedQty),
    // workOrder.plannedQty (Decimal) 누출 방지 — 필요 필드만 명시 재구성
    workOrder: {
      id:      op.workOrder.id,
      orderNo: op.workOrder.orderNo,
      item:    op.workOrder.item,
    },
    inspectionSpecs: specMap.has(`${op.workOrder.item.id}:${op.routingOperationId}`)
      ? [specMap.get(`${op.workOrder.item.id}:${op.routingOperationId}`)!]
      : [],
  }))
}

export async function getInspectionStageSummary() {
  const tenantId = await getTenantId()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const counts = await Promise.all([
    prisma.qualityInspection.count({
      where: { workOrderOperation: { workOrder: { tenantId } }, stage: "FIRST", inspectedAt: { gte: today } },
    }),
    prisma.qualityInspection.count({
      where: { workOrderOperation: { workOrder: { tenantId } }, stage: "MID", inspectedAt: { gte: today } },
    }),
    prisma.qualityInspection.count({
      where: { workOrderOperation: { workOrder: { tenantId } }, stage: "FINAL", inspectedAt: { gte: today } },
    }),
    prisma.qualityInspection.count({
      where: { workOrderOperation: { workOrder: { tenantId } }, result: "PASS", inspectedAt: { gte: today } },
    }),
    prisma.qualityInspection.count({
      where: { workOrderOperation: { workOrder: { tenantId } }, result: "FAIL", inspectedAt: { gte: today } },
    }),
  ]).catch((error) => {
    if (isMissingDbObjectError(error)) return [0, 0, 0, 0, 0]
    throw error
  })

  const [first, mid, final, passCount, failCount] = counts
  return { first, mid, final, passCount, failCount }
}
