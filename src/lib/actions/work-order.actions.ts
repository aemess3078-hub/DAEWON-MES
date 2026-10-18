"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId, requireRole } from "@/lib/auth"
import { generateCnsManufacturingNo } from "@/lib/lot-numbering/lot-number-generator"
import type { CnsItemRuleContext } from "@/lib/lot-numbering/lot-rule-resolver"
import { failureResult, UserFacingError, type ActionResult } from "@/lib/errors/user-error"
import { isCnsLotRuleAllowed } from "@/lib/lot-numbering/lot-brand-guard"
import { decideManufacturingNo } from "@/lib/lot-numbering/manufacturing-no-policy"
import { WorkOrderStatus, OperationStatus, Prisma } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { computeWipReceiptStatus } from "./wip-receipt.helpers"
import {
  syncProductionPlanStatusForWorkOrder,
  syncProductionPlanStatusFromWorkOrders,
} from "@/lib/production-plan-sync"
import { validateRoutingForItem } from "@/lib/actions/routing.actions"
import {
  assertProductionPlanItemCapacity,
  formatProductionPlanQuantity,
  summarizeProductionPlanItemAllocation,
} from "@/lib/production-plan-workorder-integrity"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import {
  lockProductionPlanItemsForUpdate,
  lockWorkOrderForUpdate,
  withQuantityTransactionRetry,
} from "@/lib/quantity-concurrency"
import { recordAuditLog, summarizeAuditItems } from "@/lib/audit-log"
import { isUniqueConstraintError, kstDateParts, withUniqueBusinessNumberRetry } from "@/lib/business-numbering"

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkOrderWithDetails = {
  id: string
  tenantId: string
  siteId: string
  itemId: string
  bomId: string
  routingId: string
  orderNo: string
  manufacturingNo: string | null
  plannedQty: number
  status: WorkOrderStatus
  dueDate: string | null
  productionPlanItemId: string | null
  createdAt: string
  updatedAt: string
  item: { id: string; code: string; name: string; itemType: string }
  bom: { id: string; version: string; item: { name: string } }
  routing: { id: string; code: string; name: string; version: string }
  site: { id: string; code: string; name: string }
  productionPlanItem: any | null
  operations: {
    id: string
    workOrderId: string
    routingOperationId: string
    equipmentId: string | null
    seq: number
    status: OperationStatus
    plannedQty: number
    completedQty: number
    routingOperation: { id: string; name: string; seq: number }
    equipment: { id: string; code: string; name: string } | null
    assignments: {
      id: string
      equipmentId: string
      assignedQty: number
      completedQty: number
      status: OperationStatus
      seq: number
      equipment: { id: string; code: string; name: string; workCenterId: string }
    }[]
    productionResults: {
      id: string
      startedAt: string | null
      endedAt: string | null
    }[]
  }[]
  materialLots: {
    id: string
    manufacturingNo: string | null
    materialLotNo: string
    qty: number
    unit: string | null
    issuedAt: string
    materialItem: { id: string; code: string; name: string; spec: string | null; uom: string }
  }[]
}

const workOrderInclude = {
  item: {
    select: { id: true, code: true, name: true, itemType: true },
  },
  bom: {
    select: {
      id: true,
      version: true,
      item: { select: { name: true } },
    },
  },
  routing: {
    select: {
      id: true,
      code: true,
      name: true,
      version: true,
    },
  },
  site: {
    select: { id: true, code: true, name: true },
  },
  productionPlanItem: true,
  operations: {
    include: {
      routingOperation: {
        select: { id: true, name: true, seq: true },
      },
      equipment: {
        select: { id: true, code: true, name: true },
      },
      assignments: {
        include: {
          equipment: {
            select: { id: true, code: true, name: true, workCenterId: true },
          },
        },
        orderBy: { seq: "asc" },
      },
      productionResults: {
        select: { id: true, startedAt: true, endedAt: true },
        orderBy: { startedAt: "asc" },
      },
    },
    orderBy: { seq: "asc" },
  },
  materialLots: {
    include: {
      materialItem: {
        select: { id: true, code: true, name: true, spec: true, uom: true },
      },
    },
    orderBy: { issuedAt: "asc" },
  },
} satisfies Prisma.WorkOrderInclude

type WorkOrderPayload = Prisma.WorkOrderGetPayload<{ include: typeof workOrderInclude }>

function serializeWorkOrder(workOrder: WorkOrderPayload): WorkOrderWithDetails {
  return {
    ...workOrder,
    plannedQty: Number(workOrder.plannedQty),
    dueDate: workOrder.dueDate?.toISOString() ?? null,
    createdAt: workOrder.createdAt.toISOString(),
    updatedAt: workOrder.updatedAt.toISOString(),
    operations: workOrder.operations.map((operation) => ({
      ...operation,
      plannedQty: Number(operation.plannedQty),
      completedQty: Number(operation.completedQty),
      assignments: operation.assignments.map((assignment) => ({
        ...assignment,
        assignedQty: Number(assignment.assignedQty),
        completedQty: Number(assignment.completedQty),
      })),
      productionResults: operation.productionResults.map((result) => ({
        ...result,
        startedAt: result.startedAt?.toISOString() ?? null,
        endedAt: result.endedAt?.toISOString() ?? null,
      })),
    })),
    materialLots: workOrder.materialLots.map((lot) => ({
      ...lot,
      qty: Number(lot.qty),
      issuedAt: lot.issuedAt.toISOString(),
    })),
  }
}

export type WorkOrderOperationInput = {
  routingOperationId: string
  equipmentId?: string | null
  seq: number
  plannedQty: number
  assignments?: {
    equipmentId: string
    assignedQty: number
  }[]
}

export type CreateWorkOrderInput = {
  siteId: string
  itemId: string
  bomId: string
  routingId: string
  orderNo: string
  manufacturingNo?: string | null
  plannedQty: number
  status: WorkOrderStatus
  dueDate?: string | null
  productionPlanItemId?: string | null
  operations: WorkOrderOperationInput[]
}

export type ProductionPlanItemForWorkOrder = {
  id: string
  itemId: string
  bomId: string | null
  routingId: string | null
  plannedQty: number
  assignedQty: number
  remainingQty: number
  item: { id: string; code: string; name: string }
  bom: { id: string; version: string } | null
  routing: { id: string; version: string } | null
  plan: {
    id: string
    planNo: string
    siteId: string
    endDate: string
    site: { id: string; code: string; name: string }
  }
}

// ─── Query Functions ──────────────────────────────────────────────────────────

export async function getWorkOrders(): Promise<WorkOrderWithDetails[]> {
  const workOrders = await prisma.workOrder.findMany({
    include: workOrderInclude,
    orderBy: [{ createdAt: "desc" }],
  })

  return workOrders.map(serializeWorkOrder)
}

export type WipInventoryRow = Awaited<ReturnType<typeof getWipInventoryRows>>[number]

export async function getWipInventoryRows(tenantId: string) {
  const workOrders = await prisma.workOrder.findMany({
    where: {
      tenantId,
      status: { in: ["RELEASED", "IN_PROGRESS", "COMPLETED"] },
      wipUnits: { some: {} },
    },
    select: {
      id: true,
      orderNo: true,
      manufacturingNo: true,
      status: true,
      plannedQty: true,
      dueDate: true,
      createdAt: true,
      item: {
        select: {
          id: true,
          code: true,
          name: true,
          uom: true,
        },
      },
      operations: {
        select: {
          id: true,
          seq: true,
          status: true,
          plannedQty: true,
          completedQty: true,
          productionResults: {
            select: { id: true, reworkQty: true },
          },
          routingOperation: {
            select: {
              id: true,
              seq: true,
              operationCode: true,
              name: true,
              workCenter: {
                select: { id: true, code: true, name: true },
              },
            },
          },
        },
        orderBy: { seq: "asc" },
      },
      finishedGoodsReceipts: {
        select: { receiptQty: true },
      },
      wipUnits: {
        select: {
          id: true,
          qty: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          parentWipUnitId: true,
          sourceProductionResultId: true,
          workOrderOperationId: true,
          parentWipUnit: {
            select: { id: true, qty: true, status: true },
          },
          sourceProductionResult: {
            select: { id: true, defectQty: true, reworkQty: true },
          },
          workOrderOperation: {
            select: {
              id: true,
              seq: true,
              status: true,
              plannedQty: true,
              completedQty: true,
              equipment: {
                select: { id: true, code: true, name: true },
              },
              routingOperation: {
                select: {
                  id: true,
                  seq: true,
                  operationCode: true,
                  name: true,
                  workCenter: {
                    select: { id: true, code: true, name: true },
                  },
                },
              },
            },
          },
          currentWorkCenter: {
            select: { id: true, code: true, name: true },
          },
          currentWarehouse: {
            select: { id: true, code: true, name: true },
          },
          currentLocation: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          movements: {
            select: {
              movementType: true,
              relatedWipUnitId: true,
              qty: true,
              note: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
          },
          relatedMovements: {
            where: { movementType: "REWORK" },
            select: { id: true },
          },
        },
        orderBy: [{ parentWipUnitId: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: [
      { dueDate: "asc" },
      { orderNo: "asc" },
    ],
  })

  return workOrders.flatMap((workOrder) => {
    const finalOperation = workOrder.operations.at(-1) ?? null
    // 입고 가능 수량 / 보류 사유는 wip-receipt 공용 헬퍼로 계산해
    // 완제품입고 검증 로직과 항상 동일한 기준을 사용한다.
    const wipReceipt = computeWipReceiptStatus(workOrder)
    const completedFinalRootQty = wipReceipt.completedRootQty
    const totalReceiptQty = wipReceipt.totalReceiptQty
    const availableReceiptQty = wipReceipt.availableReceiptQty
    const receiptBlockedReason = wipReceipt.blockReasonDisplay
    const sortedWipUnits = [...workOrder.wipUnits].sort((left, right) => {
      const leftIsRoot =
        left.parentWipUnitId == null && left.sourceProductionResultId == null
      const rightIsRoot =
        right.parentWipUnitId == null && right.sourceProductionResultId == null
      if (leftIsRoot !== rightIsRoot) return leftIsRoot ? -1 : 1
      return left.createdAt.getTime() - right.createdAt.getTime()
    })

    return sortedWipUnits.map((unit) => {
      const isRoot =
        unit.parentWipUnitId == null && unit.sourceProductionResultId == null
      const isReworkChild =
        !isRoot &&
        (unit.relatedMovements.length > 0 ||
          Number(unit.sourceProductionResult?.reworkQty ?? 0) > 0)
      const unitType = isRoot
        ? "ROOT"
        : isReworkChild
          ? "REWORK_CHILD"
          : unit.status === "SCRAPPED"
            ? "SCRAP_CHILD"
            : "CHILD"
      const isFinalCompletedRoot =
        isRoot &&
        unit.status === "COMPLETED" &&
        unit.workOrderOperationId === finalOperation?.id
      const receiptStatus = !isRoot
        ? "NOT_APPLICABLE"
        : !isFinalCompletedRoot
          ? "NOT_READY"
          : receiptBlockedReason
            ? "ON_HOLD"
            : availableReceiptQty > 0
              ? "AVAILABLE"
              : "RECEIVED"

      return {
        id: unit.id,
        unitType,
        qty: Number(unit.qty),
        wipStatus: unit.status,
        parentWipUnit: unit.parentWipUnit
          ? {
              id: unit.parentWipUnit.id,
              qty: Number(unit.parentWipUnit.qty),
              status: unit.parentWipUnit.status,
            }
          : null,
        sourceProductionResult: unit.sourceProductionResult
          ? {
              id: unit.sourceProductionResult.id,
              defectQty: Number(unit.sourceProductionResult.defectQty),
              reworkQty: Number(unit.sourceProductionResult.reworkQty),
            }
          : null,
        currentWorkCenter: unit.currentWorkCenter,
        currentWarehouse: unit.currentWarehouse,
        currentLocation: unit.currentLocation,
        latestMovement: unit.movements[0]
          ? {
              ...unit.movements[0],
              qty: Number(unit.movements[0].qty),
            }
          : null,
        receiptStatus,
        receiptBlockedReason: isRoot ? receiptBlockedReason : null,
        completedFinalRootQty,
        totalReceiptQty,
        availableReceiptQty,
        workOrder: {
          id: workOrder.id,
          orderNo: workOrder.orderNo,
          manufacturingNo: workOrder.manufacturingNo,
          status: workOrder.status,
          plannedQty: Number(workOrder.plannedQty),
          dueDate: workOrder.dueDate,
          createdAt: workOrder.createdAt,
          item: workOrder.item,
        },
        operation: {
          id: unit.workOrderOperation.id,
          seq: unit.workOrderOperation.seq,
          status: unit.workOrderOperation.status,
          plannedQty: Number(unit.workOrderOperation.plannedQty),
          completedQty: Number(unit.workOrderOperation.completedQty),
          routingOperation: unit.workOrderOperation.routingOperation,
          equipment: unit.workOrderOperation.equipment,
        },
      }
    })
  })
}

export async function getWorkOrderById(id: string): Promise<WorkOrderWithDetails | null> {
  const workOrder = await prisma.workOrder.findUnique({
    where: { id },
    include: workOrderInclude,
  })

  return workOrder ? serializeWorkOrder(workOrder) : null
}

export async function getSites() {
  return prisma.site.findMany({
    select: { id: true, code: true, name: true, type: true },
    orderBy: { name: "asc" },
  })
}

export async function getItemsForWorkOrder() {
  return prisma.item.findMany({
    where: { itemType: { in: ["FINISHED", "SEMI_FINISHED"] } },
    select: { id: true, code: true, name: true, itemType: true },
    orderBy: { code: "asc" },
  })
}

export async function getBomsForItem(itemId: string) {
  return prisma.bOM.findMany({
    where: { itemId, status: "ACTIVE" },
    select: { id: true, version: true, isDefault: true },
    orderBy: { version: "asc" },
  })
}

// 범용(COMMON) + 품목전용(ITEM_SPECIFIC) 라우팅을 함께 조회한다. 작업지시 화면은 공정 자동 채움을
// 위해 operations까지 필요해 routing.actions.ts의 getAvailableRoutingsForItem(요약본)과 별도로 둔다.
export async function getRoutingsForItem(itemId: string) {
  const tenantId = await getTenantId()
  const operationsInclude = {
    orderBy: { seq: "asc" as const },
    include: { workCenter: { select: { id: true, code: true, name: true } } },
  }

  const [itemSpecific, common] = await Promise.all([
    prisma.itemRouting.findMany({
      where: { itemId, routing: { tenantId, status: "ACTIVE", scope: "ITEM_SPECIFIC" } },
      include: {
        routing: { include: { operations: operationsInclude } },
      },
      orderBy: { routing: { version: "asc" } },
    }),
    prisma.routing.findMany({
      where: { tenantId, status: "ACTIVE", scope: "COMMON" },
      include: { operations: operationsInclude },
      orderBy: { version: "asc" },
    }),
  ])

  return [
    ...itemSpecific.map((ir) => ({
      id: ir.routing.id,
      code: ir.routing.code,
      name: ir.routing.name,
      version: ir.routing.version,
      isDefault: ir.isDefault,
      scope: "ITEM_SPECIFIC" as const,
      operations: ir.routing.operations,
    })),
    ...common.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      version: r.version,
      isDefault: false,
      scope: "COMMON" as const,
      operations: r.operations,
    })),
  ]
}

export async function getEquipments() {
  return prisma.equipment.findMany({
    select: { id: true, code: true, name: true, equipmentType: true, workCenterId: true },
    orderBy: { code: "asc" },
  })
}

export async function getConfirmedProductionPlanItemsForWorkOrder(
  tenantId: string
): Promise<ProductionPlanItemForWorkOrder[]> {
  const rows = await prisma.productionPlanItem.findMany({
    where: {
      plan: {
        tenantId,
        status: { in: ["CONFIRMED", "IN_PROGRESS"] },
      },
    },
    select: {
      id: true,
      itemId: true,
      bomId: true,
      routingId: true,
      plannedQty: true,
      workOrders: {
        select: { id: true, plannedQty: true, status: true },
      },
      item: { select: { id: true, code: true, name: true } },
      bom: { select: { id: true, version: true } },
      routing: { select: { id: true, version: true } },
      plan: {
        select: {
          id: true,
          planNo: true,
          siteId: true,
          endDate: true,
          site: { select: { id: true, code: true, name: true } },
        },
      },
    },
    orderBy: [
      { plan: { endDate: "asc" } },
      { plan: { planNo: "asc" } },
      { item: { code: "asc" } },
    ],
  })

  return rows.map((row) => {
    const { workOrders, ...planItem } = row
    const allocation = summarizeProductionPlanItemAllocation(
      row.plannedQty,
      workOrders
    )
    return {
      ...planItem,
      plannedQty: Number(row.plannedQty),
      assignedQty: Number(formatProductionPlanQuantity(allocation.assignedQty)),
      remainingQty: Number(formatProductionPlanQuantity(allocation.remainingQty)),
      plan: {
        ...row.plan,
        endDate: row.plan.endDate.toISOString(),
      },
    }
  })
}

type ValidatedWorkOrderOperationInput = Omit<WorkOrderOperationInput, "assignments"> & {
  assignments: {
    equipmentId: string
    assignedQty: number
    seq: number
    scaledAssignedQty: bigint
  }[]
}

const QTY_DECIMAL_SCALE = 6
const ZERO_QTY = BigInt(0)
const QTY_SCALE_MULTIPLIER = BigInt("1000000")

function toScaledQty(value: number | string | Prisma.Decimal, fieldName = "수량"): bigint {
  const raw = value?.toString().trim()
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`${fieldName}은 0보다 큰 숫자여야 합니다.`)
  }

  const [integerPart, decimalPart = ""] = raw.split(".")
  if (decimalPart.length > QTY_DECIMAL_SCALE) {
    throw new Error(`${fieldName}은 소수점 ${QTY_DECIMAL_SCALE}자리까지만 입력할 수 있습니다.`)
  }

  const scaled =
    BigInt(integerPart) * QTY_SCALE_MULTIPLIER +
    BigInt(decimalPart.padEnd(QTY_DECIMAL_SCALE, "0"))

  if (scaled <= ZERO_QTY) {
    throw new Error(`${fieldName}은 0보다 커야 합니다.`)
  }

  return scaled
}

function sumScaledQty(values: bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, ZERO_QTY)
}

function compareScaledQty(left: bigint, right: bigint): 0 | 1 | -1 {
  if (left === right) return 0
  return left > right ? 1 : -1
}

function formatScaledQty(value: bigint): string {
  const sign = value < ZERO_QTY ? "-" : ""
  const absolute = value < ZERO_QTY ? -value : value
  const integerPart = absolute / QTY_SCALE_MULTIPLIER
  const decimalPart = (absolute % QTY_SCALE_MULTIPLIER)
    .toString()
    .padStart(QTY_DECIMAL_SCALE, "0")
    .replace(/0+$/, "")

  return `${sign}${integerPart.toString()}${decimalPart ? `.${decimalPart}` : ""}`
}

async function validateWorkOrderOperationAssignments(
  operations: WorkOrderOperationInput[],
  tenantId: string
): Promise<ValidatedWorkOrderOperationInput[]> {
  const routingOperationIds = Array.from(
    new Set(operations.map((op) => op.routingOperationId).filter(Boolean))
  )
  const equipmentIds = Array.from(
    new Set(
      operations.flatMap((op) => [
        ...(op.equipmentId ? [op.equipmentId] : []),
        ...((op.assignments ?? []).map((assignment) => assignment.equipmentId).filter(Boolean)),
      ])
    )
  )

  const [routingOperations, equipments] = await Promise.all([
    prisma.routingOperation.findMany({
      where: { id: { in: routingOperationIds } },
      select: { id: true, workCenterId: true },
    }),
    equipmentIds.length > 0
      ? prisma.equipment.findMany({
          where: { id: { in: equipmentIds } },
          select: { id: true, tenantId: true, workCenterId: true },
        })
      : Promise.resolve([]),
  ])

  const routingOperationById = new Map(
    routingOperations.map((operation) => [operation.id, operation])
  )
  const equipmentById = new Map(equipments.map((equipment) => [equipment.id, equipment]))

  return operations.map((operation) => {
    const routingOperation = routingOperationById.get(operation.routingOperationId)
    if (!routingOperation) {
      throw new Error("공정 정보를 찾을 수 없습니다.")
    }

    const plannedQty = toScaledQty(operation.plannedQty, `공정 ${operation.seq} 계획수량`)

    const assignments = (operation.assignments ?? [])
      .filter((assignment) => assignment.equipmentId)
      .map((assignment, assignmentIndex) => ({
        equipmentId: assignment.equipmentId,
        assignedQty: Number(assignment.assignedQty),
        scaledAssignedQty: toScaledQty(
          assignment.assignedQty,
          `공정 ${operation.seq} 설비 배정수량`
        ),
        seq: assignmentIndex + 1,
      }))

    if (assignments.length === 0) {
      if (operation.equipmentId) {
        const equipment = equipmentById.get(operation.equipmentId)
        if (!equipment || equipment.tenantId !== tenantId) {
          throw new Error("선택한 설비를 찾을 수 없습니다.")
        }
        if (equipment.workCenterId !== routingOperation.workCenterId) {
          throw new Error("공정의 작업장과 설비의 작업장이 일치하지 않습니다.")
        }
      }
      return { ...operation, assignments: [] }
    }

    const selectedEquipmentIds = new Set<string>()

    for (const assignment of assignments) {
      if (selectedEquipmentIds.has(assignment.equipmentId)) {
        throw new Error("같은 공정 안에서 동일한 설비를 중복 배정할 수 없습니다.")
      }
      selectedEquipmentIds.add(assignment.equipmentId)

      const equipment = equipmentById.get(assignment.equipmentId)
      if (!equipment || equipment.tenantId !== tenantId) {
        throw new Error("선택한 설비를 찾을 수 없습니다.")
      }
      if (equipment.workCenterId !== routingOperation.workCenterId) {
        throw new Error("공정의 작업장과 설비의 작업장이 일치하지 않습니다.")
      }
    }

    const assignedTotal = sumScaledQty(assignments.map((assignment) => assignment.scaledAssignedQty))
    const comparison = compareScaledQty(assignedTotal, plannedQty)
    if (comparison !== 0) {
      const difference =
        comparison > 0 ? assignedTotal - plannedQty : plannedQty - assignedTotal
      const direction = comparison > 0 ? "초과" : "부족"
      throw new Error(
        `공정 ${operation.seq} 설비 배정수량 합계가 계획수량과 일치하지 않습니다. (${formatScaledQty(difference)} ${direction})`
      )
    }

    return {
      ...operation,
      equipmentId: assignments[0]?.equipmentId ?? operation.equipmentId ?? null,
      assignments,
    }
  })
}

// ─── Business Logic ───────────────────────────────────────────────────────────

export async function generateOrderNo(tenantId: string): Promise<string> {
  const { year } = kstDateParts()
  const prefix = `WO-${year}-`

  const latest = await prisma.workOrder.findFirst({
    where: {
      tenantId,
      orderNo: { startsWith: prefix },
    },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  })

  let nextSeq = 1
  if (latest) {
    const parts = latest.orderNo.split("-")
    const lastSeq = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(lastSeq)) {
      nextSeq = lastSeq + 1
    }
  }

  return `${prefix}${String(nextSeq).padStart(3, "0")}`
}

// 제조번호 자동 생성: CNS prefix + YY + month letter(A-L) + 3-digit sequence.
async function getCnsItemRuleContext(
  tenantId: string,
  itemId?: string | null,
): Promise<CnsItemRuleContext> {
  if (!itemId) return {}

  const item = await prisma.item.findFirst({
    where: { id: itemId, tenantId },
    select: {
      code: true,
      itemType: true,
      lotNumberingType: true,
      lotPrefix: true,
      manualLotPolicy: true,
      itemGroup: { select: { code: true } },
      category: { select: { code: true } },
    },
  })

  return {
    itemCode: item?.code,
    itemGroupCode: item?.itemGroup?.code,
    itemCategoryCode: item?.category?.code,
    itemType: item?.itemType,
    lotNumberingType: item?.lotNumberingType,
    lotPrefix: item?.lotPrefix,
    manualLotPolicy: item?.manualLotPolicy,
  }
}

async function validateManualManufacturingNoPolicy(
  tenantId: string,
  itemId: string,
  manufacturingNo: string | null,
  options: { blankMeansAuto: boolean },
) {
  const item = await prisma.item.findFirst({
    where: { id: itemId, tenantId },
    select: { lotNumberingType: true, manualLotPolicy: true },
  })
  if (!item) throw new Error("INVALID_ITEM")
  // 품목 정책(lotNumberingType x manualLotPolicy) 조합 판정. 대원정밀은 자동 채번이 불가능하므로
  // 처리할 수 없는 조합은 명확한 안내 메시지로 거절한다(채번 규칙/품목 정책은 변경하지 않는다).
  const decision = decideManufacturingNo({
    lotNumberingType: item.lotNumberingType,
    manualLotPolicy: item.manualLotPolicy,
    input: manufacturingNo,
    autoAllowed: isCnsLotRuleAllowed(),
    blankMeansAuto: options.blankMeansAuto,
  })
  if (decision.kind === "ERROR") throw new UserFacingError(decision.message)
  return item.manualLotPolicy === "DISABLED"
}

export async function generateManufacturingNo(
  tenantId: string,
  itemId?: string | null,
  sequenceOffset = 0,
): Promise<string> {
  const itemContext = await getCnsItemRuleContext(tenantId, itemId)
  return generateCnsManufacturingNo(prisma, tenantId, itemContext, new Date(), sequenceOffset)
}

async function validateProductionPlanItemForWorkOrder(
  db: Pick<Prisma.TransactionClient, "productionPlanItem">,
  productionPlanItemId: string | null | undefined,
  data: Pick<CreateWorkOrderInput, "itemId" | "bomId" | "routingId" | "plannedQty" | "status">,
  tenantId: string,
  options: { excludeWorkOrderId?: string } = {}
) {
  if (!productionPlanItemId) return

  const planItem = await db.productionPlanItem.findFirst({
    where: {
      id: productionPlanItemId,
      plan: {
        tenantId,
        status: { in: ["CONFIRMED", "IN_PROGRESS"] },
      },
    },
    select: {
      itemId: true,
      bomId: true,
      routingId: true,
      plannedQty: true,
      workOrders: {
        select: { id: true, plannedQty: true, status: true },
      },
    },
  })

  if (!planItem) {
    throw new Error("확정된 생산계획 품목만 작업지시에 연결할 수 있습니다.")
  }
  if (planItem.itemId !== data.itemId) {
    throw new Error("생산계획 품목과 작업지시 품목이 일치하지 않습니다.")
  }
  if (planItem.bomId && planItem.bomId !== data.bomId) {
    throw new Error("생산계획 품목의 BOM과 작업지시 BOM이 일치하지 않습니다.")
  }
  if (planItem.routingId && planItem.routingId !== data.routingId) {
    throw new Error("생산계획 품목의 라우팅과 작업지시 라우팅이 일치하지 않습니다.")
  }
  if (data.status !== "CANCELLED") {
    assertProductionPlanItemCapacity({
      plannedQty: planItem.plannedQty,
      workOrders: planItem.workOrders,
      requestedQty: data.plannedQty,
      excludeWorkOrderId: options.excludeWorkOrderId,
    })
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createWorkOrder(data: CreateWorkOrderInput, tenantId: string): Promise<ActionResult> {
  try {
    await requireResourcePermission("WORK_ORDER", "CREATE")
    const user = await requireRole("OPERATOR")
    if (tenantId !== user.tenantId) throw new Error("FORBIDDEN")
    const { operations, dueDate, manufacturingNo, ...headerFields } = data
    await validateRoutingForItem({ tenantId, itemId: headerFields.itemId, routingId: headerFields.routingId })
    const validatedOperations = await validateWorkOrderOperationAssignments(operations, tenantId)

    // 제조번호: 수동 입력 우선, 미입력 시 자동 생성 (MFG-YYYYMMDD-NNN)
    const trimmed = manufacturingNo?.trim()
    const manualDisabled = await validateManualManufacturingNoPolicy(
      tenantId,
      headerFields.itemId,
      trimmed && trimmed.length > 0 ? trimmed : null,
      { blankMeansAuto: true },
    )
    const useManualManufacturingNo = !!trimmed && trimmed.length > 0 && !manualDisabled

    const retryTargets = useManualManufacturingNo
      ? [["tenantId", "orderNo"]]
      : [["tenantId", "orderNo"], ["tenantId", "manufacturingNo"]]

    try {
      await withUniqueBusinessNumberRetry(async (attempt) => {
        const orderNo = await generateOrderNo(tenantId)
        const finalManufacturingNo = useManualManufacturingNo
          ? trimmed!
          : await generateManufacturingNo(tenantId, headerFields.itemId, attempt)

        await withQuantityTransactionRetry(() => prisma.$transaction(async (tx) => {
          await lockProductionPlanItemsForUpdate(tx, tenantId, [headerFields.productionPlanItemId])
          await validateProductionPlanItemForWorkOrder(
            tx,
            headerFields.productionPlanItemId,
            headerFields,
            tenantId
          )

          const workOrder = await tx.workOrder.create({
            data: {
              ...headerFields,
              orderNo,
              tenantId,
              manufacturingNo: finalManufacturingNo,
              dueDate: dueDate ? new Date(dueDate) : null,
              operations: {
                create: validatedOperations.map((op) => ({
                  routingOperationId: op.routingOperationId,
                  equipmentId: op.equipmentId ?? null,
                  seq: op.seq,
                  plannedQty: op.plannedQty,
                  assignments:
                    op.assignments.length > 0
                      ? {
                          create: op.assignments.map((assignment) => ({
                            tenantId,
                            equipmentId: assignment.equipmentId,
                            assignedQty: assignment.assignedQty,
                            seq: assignment.seq,
                          })),
                        }
                      : undefined,
                })),
              },
            },
            select: { id: true },
          })

          await syncProductionPlanStatusForWorkOrder(tx, workOrder.id, tenantId)
          await recordAuditLog(tx, {
            tenantId,
            actor: user,
            entityType: "WorkOrder",
            entityId: workOrder.id,
            action: "CREATE",
            afterData: {
              orderNo,
              manufacturingNo: finalManufacturingNo,
              itemId: headerFields.itemId,
              plannedQty: headerFields.plannedQty,
              productionPlanItemId: headerFields.productionPlanItemId,
              operations: summarizeAuditItems(validatedOperations, ["routingOperationId", "equipmentId", "seq", "plannedQty"]),
            },
            menuName: "작업지시",
          })
        }))
      }, { fields: retryTargets, message: "작업지시번호 또는 제조번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요." })
    } catch (error) {
      if (useManualManufacturingNo && isUniqueConstraintError(error, ["tenantId", "manufacturingNo"])) {
        throw new Error("이미 사용 중인 제조번호입니다.")
      }
      throw error
    }

    revalidatePath("/app/mes/work-orders")
    revalidatePath("/app/mes/production-plan")
    return { success: true }
  } catch (error) {
    return failureResult("createWorkOrder", error, { duplicateMessage: "작업지시번호 또는 제조번호가 중복되었습니다. 다시 시도해 주세요." })
  }
}

export async function updateWorkOrder(id: string, data: CreateWorkOrderInput) {
  await requireResourcePermission("WORK_ORDER", "UPDATE")
  const user = await requireRole("OPERATOR")
  const existing = await prisma.workOrder.findUnique({
    where: { id },
    select: {
      status: true,
      tenantId: true,
      productionPlanItemId: true,
      productionPlanItem: { select: { planId: true } },
    },
  })

  if (!existing) {
    throw new Error("작업지시를 찾을 수 없습니다.")
  }

  const blockedStatuses: WorkOrderStatus[] = ["IN_PROGRESS", "COMPLETED", "CANCELLED"]
  if (blockedStatuses.includes(existing.status)) {
    throw new Error(
      `'${existing.status}' 상태의 작업지시는 수정할 수 없습니다.`
    )
  }

  if (existing.tenantId !== user.tenantId) throw new Error("FORBIDDEN")

  const { operations, dueDate, manufacturingNo, ...headerFields } = data
  await validateRoutingForItem({ tenantId: existing.tenantId, itemId: headerFields.itemId, routingId: headerFields.routingId })
  const validatedOperations = await validateWorkOrderOperationAssignments(
    operations,
    existing.tenantId
  )
  const trimmed = manufacturingNo?.trim()
  const manualDisabled = await validateManualManufacturingNoPolicy(
    existing.tenantId,
    headerFields.itemId,
    trimmed && trimmed.length > 0 ? trimmed : null,
    { blankMeansAuto: false },
  )
  const nextManufacturingNo = trimmed && trimmed.length > 0
    ? (manualDisabled ? await generateManufacturingNo(existing.tenantId, headerFields.itemId) : trimmed)
    : null

  await withQuantityTransactionRetry(() => prisma.$transaction(async (tx) => {
    await lockWorkOrderForUpdate(tx, existing.tenantId, id)
    const lockedExisting = await tx.workOrder.findUnique({
      where: { id },
      select: {
        status: true,
        tenantId: true,
        productionPlanItemId: true,
        productionPlanItem: { select: { planId: true } },
      },
    })
    if (!lockedExisting) {
      throw new Error("작업지시를 찾을 수 없습니다.")
    }
    if (lockedExisting.tenantId !== existing.tenantId) throw new Error("FORBIDDEN")
    if (blockedStatuses.includes(lockedExisting.status)) {
      throw new Error(
        `'${lockedExisting.status}' 상태의 작업지시는 수정할 수 없습니다.`
      )
    }

    await lockProductionPlanItemsForUpdate(tx, existing.tenantId, [
      lockedExisting.productionPlanItemId,
      headerFields.productionPlanItemId,
    ])
    await validateProductionPlanItemForWorkOrder(
      tx,
      headerFields.productionPlanItemId,
      headerFields,
      existing.tenantId,
      { excludeWorkOrderId: id }
    )

    await tx.workOrderOperation.deleteMany({ where: { workOrderId: id } })
    await tx.workOrder.update({
      where: { id },
      data: {
        ...headerFields,
        manufacturingNo: nextManufacturingNo,
        dueDate: dueDate ? new Date(dueDate) : null,
        operations: {
          create: validatedOperations.map((op) => ({
            routingOperationId: op.routingOperationId,
            equipmentId: op.equipmentId ?? null,
            seq: op.seq,
            plannedQty: op.plannedQty,
            assignments:
              op.assignments.length > 0
                ? {
                    create: op.assignments.map((assignment) => ({
                      tenantId: existing.tenantId,
                      equipmentId: assignment.equipmentId,
                      assignedQty: assignment.assignedQty,
                      seq: assignment.seq,
                    })),
                  }
                : undefined,
          })),
        },
      },
    })
    await syncProductionPlanStatusForWorkOrder(tx, id, existing.tenantId)
    if (
      lockedExisting.productionPlanItem?.planId &&
      lockedExisting.productionPlanItemId !== headerFields.productionPlanItemId
    ) {
      await syncProductionPlanStatusFromWorkOrders(
        tx,
        lockedExisting.productionPlanItem.planId,
        existing.tenantId
      )
    }
    await recordAuditLog(tx, {
      tenantId: existing.tenantId,
      actor: user,
      entityType: "WorkOrder",
      entityId: id,
      action: "UPDATE",
      beforeData: lockedExisting,
      afterData: {
        orderNo: headerFields.orderNo,
        manufacturingNo: nextManufacturingNo,
        itemId: headerFields.itemId,
        plannedQty: headerFields.plannedQty,
        productionPlanItemId: headerFields.productionPlanItemId,
        operationCount: validatedOperations.length,
      },
      menuName: "작업지시",
    })
  }))

  revalidatePath("/app/mes/work-orders")
  revalidatePath("/app/mes/production-plan")
}

export async function releaseWorkOrder(id: string): Promise<{ success: boolean; error?: string }> {
  await requireResourcePermission("WORK_ORDER", "UPDATE")
  try {
    const user = await requireRole("OPERATOR")
    const existing = await prisma.workOrder.findFirst({
      where: { id, tenantId: user.tenantId },
      select: {
        status: true,
        tenantId: true,
        _count: {
          select: { operations: true },
        },
      },
    })
    if (!existing) return { success: false, error: "작업지시를 찾을 수 없습니다." }
    if (existing.status !== "DRAFT") {
      return { success: false, error: "초안(DRAFT) 상태의 작업지시만 릴리즈할 수 있습니다." }
    }
    if (existing._count.operations === 0) {
      return { success: false, error: "공정이 없는 작업지시는 작업대기로 전환할 수 없습니다." }
    }
    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id },
        data: { status: "RELEASED" },
      })
      await syncProductionPlanStatusForWorkOrder(tx, id, existing.tenantId)
      await recordAuditLog(tx, {
        tenantId: existing.tenantId,
        actor: user,
        entityType: "WorkOrder",
        entityId: id,
        action: "UPDATE",
        beforeData: { status: existing.status },
        afterData: { status: "RELEASED" },
        menuName: "작업지시",
      })
    })
    revalidatePath("/app/mes/work-orders")
    revalidatePath("/app/mes/production-plan")
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "오류가 발생했습니다." }
  }
}

export async function deleteWorkOrder(id: string) {
  await requireResourcePermission("WORK_ORDER", "DELETE")
  const user = await requireRole("OPERATOR")
  const existing = await prisma.workOrder.findFirst({
    where: { id, tenantId: user.tenantId },
    select: {
      status: true,
      tenantId: true,
      productionPlanItem: { select: { planId: true } },
    },
  })

  if (!existing) {
    throw new Error("작업지시를 찾을 수 없습니다.")
  }

  const allowedStatuses: WorkOrderStatus[] = ["DRAFT", "RELEASED"]
  if (!allowedStatuses.includes(existing.status)) {
    throw new Error(
      `'${existing.status}' 상태의 작업지시는 삭제할 수 없습니다. DRAFT 또는 RELEASED 상태만 삭제 가능합니다.`
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.workOrderOperation.deleteMany({ where: { workOrderId: id } })
    await tx.workOrder.delete({ where: { id } })
    if (existing.productionPlanItem?.planId) {
      await syncProductionPlanStatusFromWorkOrders(
        tx,
        existing.productionPlanItem.planId,
        existing.tenantId
      )
    }
    await recordAuditLog(tx, {
      tenantId: existing.tenantId,
      actor: user,
      entityType: "WorkOrder",
      entityId: id,
      action: "DELETE",
      beforeData: existing,
      menuName: "작업지시",
    })
  })

  revalidatePath("/app/mes/work-orders")
  revalidatePath("/app/mes/production-plan")
}
