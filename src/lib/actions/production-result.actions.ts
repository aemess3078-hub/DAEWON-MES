"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId } from "@/lib/auth"
import { calculateWorkDurationMinutes } from "@/lib/pop-worktime-operator"
import { resolveActualProductionEquipment } from "@/lib/equipment-result-attribution"

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProductionResultWithDetails = {
  id: string
  workOrderOperationId: string
  goodQty: number
  defectQty: number
  reworkQty: number
  startedAt: string | null
  endedAt: string | null
  workDurationMinutes: number | null
  operator: { id: string; name: string } | null
  equipment: {
    id: string
    code: string
    name: string
  } | null
  workOrderOperation: {
    id: string
    seq: number
    status: string
    plannedQty: number
    completedQty: number
    workOrder: {
      id: string
      orderNo: string
      manufacturingNo: string | null
      item: {
        id: string
        code: string
        name: string
        uom: string
      }
    }
    routingOperation: {
      id: string
      name: string
      seq: number
      workCenter: {
        id: string
        name: string
      }
    }
  }
}


export type ProductionResultFilters = {
  orderNo?: string
  startDate?: Date
  endDate?: Date
  endDateExclusive?: Date
  itemId?: string
  siteId?: string
  routingOperationId?: string
}

// ─── 1. 실적 전체 조회 ─────────────────────────────────────────────────────────

export async function getProductionResults(
  filters?: ProductionResultFilters
): Promise<ProductionResultWithDetails[]> {
  const tenantId = await getTenantId()

  const results = await prisma.productionResult.findMany({
    where: {
      workOrderOperation: {
        ...(filters?.routingOperationId
          ? { routingOperationId: filters.routingOperationId }
          : {}),
        workOrder: {
          tenantId,
          ...(filters?.orderNo
            ? {
                orderNo: {
                  contains: filters.orderNo,
                  mode: "insensitive",
                },
              }
            : {}),
          ...(filters?.itemId ? { itemId: filters.itemId } : {}),
          ...(filters?.siteId ? { siteId: filters.siteId } : {}),
        },
      },
      ...(filters?.startDate || filters?.endDate || filters?.endDateExclusive
        ? {
            startedAt: {
              ...(filters.startDate ? { gte: filters.startDate } : {}),
              ...(filters.endDate ? { lte: filters.endDate } : {}),
              ...(filters.endDateExclusive ? { lt: filters.endDateExclusive } : {}),
            },
          }
        : {}),
    },
    include: {
      operator: { select: { id: true, name: true } },
      workOrderOperationAssignment: {
        select: {
          equipment: {
            select: { id: true, code: true, name: true },
          },
        },
      },
      workOrderOperation: {
        include: {
          equipment: {
            select: { id: true, code: true, name: true },
          },
          workOrder: {
            include: {
              item: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  uom: true,
                },
              },
            },
          },
          routingOperation: {
            include: {
              workCenter: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { startedAt: "desc" },
  })

  return results.map((r) => {
    const equipment = resolveActualProductionEquipment(r)

    return {
      id: r.id,
      workOrderOperationId: r.workOrderOperationId,
      goodQty: Number(r.goodQty),
      defectQty: Number(r.defectQty),
      reworkQty: Number(r.reworkQty),
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
      workDurationMinutes: calculateWorkDurationMinutes(r.startedAt, r.endedAt),
      operator: r.operator,
      equipment,
      workOrderOperation: {
        id: r.workOrderOperation.id,
        seq: r.workOrderOperation.seq,
        status: r.workOrderOperation.status,
        plannedQty: Number(r.workOrderOperation.plannedQty),
        completedQty: Number(r.workOrderOperation.completedQty),
        workOrder: {
          id: r.workOrderOperation.workOrder.id,
          orderNo: r.workOrderOperation.workOrder.orderNo,
          manufacturingNo: r.workOrderOperation.workOrder.manufacturingNo,
          item: r.workOrderOperation.workOrder.item,
        },
        routingOperation: {
          id: r.workOrderOperation.routingOperation.id,
          name: r.workOrderOperation.routingOperation.name,
          seq: r.workOrderOperation.routingOperation.seq,
          workCenter: r.workOrderOperation.routingOperation.workCenter,
        },
      },
    }
  })
}

