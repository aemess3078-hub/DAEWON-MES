"use server"

import { prisma } from "@/lib/db/prisma"
import { PlanStatus, PlanType, Prisma } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { getAvailableRoutingsForItem, validateRoutingForItem } from "@/lib/actions/routing.actions"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { reconcileProductionPlanItems } from "@/lib/production-plan-item-reconciliation"
import { evaluateProductionPlanWorkOrderCompletion } from "@/lib/production-plan-workorder-integrity"
import { buildAuditChanges, recordAuditLog, summarizeAuditItems } from "@/lib/audit-log"
import { cancelProductionPlanForTenant } from "@/lib/production-plan-cancel.server"
import { kstDateParts, withUniqueBusinessNumberRetry } from "@/lib/business-numbering"
import { lockProductionPlanItemsForUpdate, lockSalesOrderItemsForUpdate, withQuantityTransactionRetry } from "@/lib/quantity-concurrency"
import { PLAN_QTY_INVALID_MESSAGE, resolvePlanItemUpdate, type ProductionKindValue } from "@/lib/production-allocation"
import { allocationIncreaseViolationMessage, findProductionRequestViolation } from "@/lib/production-request"
import { formatScaledQuantity, toScaledQuantity } from "@/lib/quantity-scale"
import { keepProductionRequestTag } from "@/lib/production-request-tag"
import { NEW_PLAN_STATUS, PLAN_NOT_EDITABLE_MESSAGE, validatePlanStatusChange, validatePlanStatusForCreate, type PlanStatusValue } from "@/lib/production-plan-status"

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanWithDetails = {
  id: string
  tenantId: string
  siteId: string
  planNo: string
  planType: PlanType
  startDate: Date
  endDate: Date
  status: PlanStatus
  note: string | null
  createdAt: Date
  updatedAt: Date
  site: { id: string; code: string; name: string; type: string }
  items: {
    id: string
    planId: string
    itemId: string
    bomId: string | null
    routingId: string | null
    salesOrderItemId: string | null
    plannedQty: any // Decimal
    productionKind: ProductionKindValue
    allocatedQty: any // Decimal — 수주 충당 수량(계획 수량과 구분)
    extraReason: string | null
    extraApprovalStatus: string
    note: string | null
    item: { id: string; code: string; name: string; itemType: string }
    bom: { id: string; version: string } | null
    routing: { id: string; version: string } | null
    workOrders: { id: string; orderNo: string; status: string }[]
    salesOrderItem: {
      id: string
      qty: any
      unitPrice: any | null
      deliveryDate: Date | null
      note: string | null
      salesOrder: {
        id: string
        orderNo: string
        orderDate: Date
        deliveryDate: Date
        status: string
        customer: { id: string; code: string; name: string }
      }
    } | null
  }[]
}

export type PlanItemInput = {
  productionPlanItemId?: string | null
  salesOrderItemId?: string | null
  itemId: string
  bomId?: string | null
  routingId?: string | null
  plannedQty: number
  /** 수주 충당 수량(수주 연결된 줄만). 생략하면 기존 충당 수량을 유지하되 계획 수량보다 클 수 없다 */
  allocatedQty?: number | null
  /** 여유 생산 사유(계획 수량 > 충당 수량이면 필수). 생략하면 기존 사유 유지 */
  extraReason?: string | null
  note?: string | null
}

export type CreatePlanInput = {
  siteId: string
  planNo: string
  planType: PlanType
  startDate: string
  endDate: string
  /** 수정(updatePlan)에서만 의미가 있다. 등록(createPlan)은 값과 무관하게 서버가 CONFIRMED 로 저장한다. */
  status: PlanStatus
  note?: string | null
  items: PlanItemInput[]
}

/** 등록용 입력: 상태는 서버가 정하므로 생략할 수 있다(구 클라이언트가 보내는 초안·확정은 무시) */
export type CreatePlanRequest = Omit<CreatePlanInput, "status"> & { status?: PlanStatus }

// ─── Query Functions ──────────────────────────────────────────────────────────

export async function getProductionPlans(): Promise<PlanWithDetails[]> {
  const user = await requireResourcePermission("PRODUCTION_PLAN", "READ")

  return prisma.productionPlan.findMany({
    where: { tenantId: user.tenantId },
    include: {
      site: {
        select: { id: true, code: true, name: true, type: true },
      },
      items: {
        include: {
          item: {
            select: { id: true, code: true, name: true, itemType: true },
          },
          bom: {
            select: { id: true, version: true },
          },
          routing: {
            select: { id: true, version: true },
          },
          workOrders: {
            select: { id: true, orderNo: true, status: true },
          },
          salesOrderItem: {
            include: {
              salesOrder: {
                select: {
                  id: true,
                  orderNo: true,
                  orderDate: true,
                  deliveryDate: true,
                  status: true,
                  customer: { select: { id: true, code: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  }) as any
}

export async function getPlanById(id: string): Promise<PlanWithDetails | null> {
  const user = await requireResourcePermission("PRODUCTION_PLAN", "READ")

  return prisma.productionPlan.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      site: {
        select: { id: true, code: true, name: true, type: true },
      },
      items: {
        include: {
          item: {
            select: { id: true, code: true, name: true, itemType: true },
          },
          bom: {
            select: { id: true, version: true },
          },
          routing: {
            select: { id: true, version: true },
          },
          workOrders: {
            select: { id: true, orderNo: true, status: true },
          },
          salesOrderItem: {
            include: {
              salesOrder: {
                select: {
                  id: true,
                  orderNo: true,
                  orderDate: true,
                  deliveryDate: true,
                  status: true,
                  customer: { select: { id: true, code: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
  }) as any
}

export async function getSites() {
  const user = await requireResourcePermission("PRODUCTION_PLAN", "READ")

  return prisma.site.findMany({
    where: { tenantId: user.tenantId },
    select: { id: true, code: true, name: true, type: true },
    orderBy: { name: "asc" },
  })
}

export async function getItemsForPlan() {
  const user = await requireResourcePermission("PRODUCTION_PLAN", "READ")

  return prisma.item.findMany({
    where: { tenantId: user.tenantId, itemType: { in: ["FINISHED", "SEMI_FINISHED"] } },
    select: { id: true, code: true, name: true, itemType: true },
    orderBy: { code: "asc" },
  })
}

export async function getBomsForPlanItem(itemId: string) {
  const user = await requireResourcePermission("PRODUCTION_PLAN", "READ")

  return prisma.bOM.findMany({
    where: { tenantId: user.tenantId, itemId, status: "ACTIVE" },
    select: { id: true, version: true, isDefault: true },
    orderBy: { version: "asc" },
  })
}

// 범용(COMMON) + 품목전용(ITEM_SPECIFIC) 라우팅을 함께 조회한다 — routing.actions.ts의 공용 헬퍼 재사용.
export async function getRoutingsForPlanItem(itemId: string) {
  await requireResourcePermission("PRODUCTION_PLAN", "READ")

  return getAvailableRoutingsForItem(itemId)
}

// ─── Business Logic ───────────────────────────────────────────────────────────

export async function generatePlanNo(_tenantId: string, planType: PlanType): Promise<string> {
  const user = await requireResourcePermission("PRODUCTION_PLAN", "CREATE")
  const now = new Date()
  const parts = kstDateParts(now)
  const year = parts.year

  let baseNo: string

  if (planType === "DAILY") {
    const month = parts.monthText
    const day = parts.dayText
    baseNo = `PP-${year}-${month}${day}`
  } else if (planType === "WEEKLY") {
    // ISO 주차 계산
    const startOfYear = new Date(year, 0, 1)
    const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000))
    const weekNo = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7)
    baseNo = `PP-${year}-W${String(weekNo).padStart(2, "0")}`
  } else {
    // MONTHLY
    const month = parts.monthText
    baseNo = `PP-${year}-M${month}`
  }

  // 중복 체크 후 suffix 추가
  const existing = await prisma.productionPlan.findMany({
    where: {
      tenantId: user.tenantId,
      planNo: { startsWith: baseNo },
    },
    select: { planNo: true },
  })

  if (existing.length === 0) {
    return baseNo
  }

  // 이미 baseNo가 존재하면 suffix 붙이기
  const existingNos = new Set(existing.map((p) => p.planNo))
  let suffix = 2
  while (existingNos.has(`${baseNo}-${suffix}`)) {
    suffix++
  }
  return `${baseNo}-${suffix}`
}

async function generateProductionPlanNoForCreate(tenantId: string, planType: PlanType): Promise<string> {
  const parts = kstDateParts()
  const year = parts.year
  let baseNo: string
  if (planType === "DAILY") {
    baseNo = `PP-${year}-${parts.monthText}${parts.dayText}`
  } else if (planType === "WEEKLY") {
    const now = new Date()
    const startOfYear = new Date(year, 0, 1)
    const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000))
    const weekNo = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7)
    baseNo = `PP-${year}-W${String(weekNo).padStart(2, "0")}`
  } else {
    baseNo = `PP-${year}-M${parts.monthText}`
  }

  const existing = await prisma.productionPlan.findMany({
    where: { tenantId, planNo: { startsWith: baseNo } },
    select: { planNo: true },
  })
  const existingNos = new Set(existing.map((p) => p.planNo))
  if (!existingNos.has(baseNo)) return baseNo
  let suffix = 2
  while (existingNos.has(`${baseNo}-${suffix}`)) suffix++
  return `${baseNo}-${suffix}`
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createPlan(data: CreatePlanRequest, _tenantId: string) {
  const user = await requireResourcePermission("PRODUCTION_PLAN", "CREATE")
  const tenantId = user.tenantId
  // 상태는 서버가 결정한다: 신규 재고 생산계획은 등록 즉시 확정(작업지시 생성 가능). 요청의 status 는 무시한다.
  const { items, startDate, endDate, note, status: requestedStatus, ...headerFields } = data

  const createStatusError = validatePlanStatusForCreate(requestedStatus as PlanStatusValue | undefined)
  if (createStatusError) {
    throw new Error(createStatusError)
  }

  if (items.some((item) => item.productionPlanItemId || item.salesOrderItemId)) {
    throw new Error("신규 생산계획에 기존 품목 또는 수주 연결을 지정할 수 없습니다.")
  }

  for (const item of items) {
    const plannedScaled = toScaledQuantity(item.plannedQty)
    if (plannedScaled === null || plannedScaled <= BigInt(0)) throw new Error(PLAN_QTY_INVALID_MESSAGE)
    if (item.allocatedQty !== undefined && item.allocatedQty !== null && Number(item.allocatedQty) !== 0) {
      throw new Error("신규 생산계획은 수주와 연결되지 않은 재고 생산 계획입니다. 수주 충당은 수주관리의 생산의뢰로 등록해 주세요.")
    }
    if (item.routingId) {
      await validateRoutingForItem({ tenantId, itemId: item.itemId, routingId: item.routingId })
    }
  }

  await withUniqueBusinessNumberRetry(async () => {
    const planNo = await generateProductionPlanNoForCreate(tenantId, data.planType)
    await prisma.$transaction(async (tx) => {
    const created = await tx.productionPlan.create({
      data: {
        ...headerFields,
        planNo,
        tenantId,
        status: NEW_PLAN_STATUS as PlanStatus,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        note: note ?? null,
        items: {
          create: items.map((item) => ({
            itemId: item.itemId,
            bomId: item.bomId ?? null,
            routingId: item.routingId ?? null,
            plannedQty: item.plannedQty,
            productionKind: "STOCK" as const,
            allocatedQty: 0,
            note: item.note ?? null,
          })),
        },
      },
    })
    await recordAuditLog(tx, {
      tenantId,
      actor: user,
      entityType: "ProductionPlan",
        entityId: created.id,
        action: "CREATE",
        afterData: {
        planNo,
        planType: data.planType,
        status: NEW_PLAN_STATUS,
        itemCount: items.length,
        items: summarizeAuditItems(items, ["itemId", "bomId", "routingId", "plannedQty"]),
      },
      menuName: "생산계획",
    })
  })
  }, { fields: ["tenantId", "planNo"], message: "생산계획번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요." })

  revalidatePath("/app/mes/production-plan")
}

export async function updatePlan(id: string, data: CreatePlanInput) {
  const user = await requireResourcePermission("PRODUCTION_PLAN", "UPDATE")
  const tenantId = user.tenantId
  const { items, startDate, endDate, note, ...headerFields } = data

  if (headerFields.status === PlanStatus.CANCELLED) {
    throw new Error("생산계획 취소는 취소 기능을 이용해 주세요.")
  }

  for (const item of items) {
    const plannedScaled = toScaledQuantity(item.plannedQty)
    if (plannedScaled === null || plannedScaled <= BigInt(0)) throw new Error(PLAN_QTY_INVALID_MESSAGE)
    if (item.routingId) {
      await validateRoutingForItem({ tenantId, itemId: item.itemId, routingId: item.routingId })
    }
  }

  await withQuantityTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      const planForLock = await tx.productionPlan.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          items: { select: { id: true, salesOrderItemId: true } },
        },
      })

      if (!planForLock) {
        throw new Error("생산계획을 찾을 수 없습니다.")
      }

      // 잠금 순서: 수주 품목(충당 합계 판정 단위) → 생산계획 품목. 생산의뢰·출하·수주 수정도 수주 품목 잠금을 먼저 잡는다.
      await lockSalesOrderItemsForUpdate(
        tx,
        tenantId,
        planForLock.items.map((item) => item.salesOrderItemId)
      )

      await lockProductionPlanItemsForUpdate(
        tx,
        tenantId,
        planForLock.items.map((item) => item.id)
      )

      const existing = await tx.productionPlan.findFirst({
        where: { id, tenantId },
        select: {
          status: true,
          tenantId: true,
          note: true,
          items: {
            select: {
              id: true,
              itemId: true,
              salesOrderItemId: true,
              productionKind: true,
              allocatedQty: true,
              extraReason: true,
              plannedQty: true,
              workOrders: { select: { id: true, status: true, plannedQty: true } },
              salesOrderItem: {
                select: {
                  qty: true,
                  item: { select: { code: true } },
                  salesOrder: { select: { tenantId: true } },
                },
              },
            },
          },
        },
      })

      if (!existing) {
        throw new Error("생산계획을 찾을 수 없습니다.")
      }

      const blockedStatuses: PlanStatus[] = ["IN_PROGRESS", "COMPLETED", "CANCELLED"]
      if (blockedStatuses.includes(existing.status)) {
        throw new Error(PLAN_NOT_EDITABLE_MESSAGE(existing.status as PlanStatusValue))
      }

      const hasEffectiveWorkOrders = existing.items.some((row) => row.workOrders.some((w) => w.status !== "CANCELLED"))
      const statusError = validatePlanStatusChange(existing.status as PlanStatusValue, headerFields.status as PlanStatusValue, { hasEffectiveWorkOrders })
      if (statusError) {
        throw new Error(statusError)
      }

      const reconciliation = reconcileProductionPlanItems(
        existing.tenantId,
        existing.items.map((item) => ({
          id: item.id,
          itemId: item.itemId,
          salesOrderItemId: item.salesOrderItemId,
          salesOrderItemTenantId: item.salesOrderItem?.salesOrder.tenantId ?? null,
        })),
        items
      )

      for (const deleteId of reconciliation.deleteIds) {
        const doomed = existing.items.find((row) => row.id === deleteId)!
        if (doomed.salesOrderItemId) {
          throw new Error("수주와 연결된 생산계획 품목은 삭제할 수 없습니다. 수주 연결을 정리하려면 생산계획을 취소해 주세요.")
        }
        if (doomed.workOrders.some((w) => w.status !== "CANCELLED")) {
          throw new Error("작업지시가 연결된 생산계획 품목은 삭제할 수 없습니다. 작업지시를 먼저 정리해 주세요.")
        }
      }
      if (reconciliation.deleteIds.length > 0) {
        await tx.productionPlanItem.deleteMany({
          where: { planId: id, id: { in: reconciliation.deleteIds } },
        })
      }

      // 수정 줄의 계획 수량·충당 수량·유형·여유 사유를 정하고, 충당 수량이 늘어나는 줄은 수주 품목 합계(다른 계획 포함)를 검증한다.
      const resolved = new Map<string, ReturnType<typeof resolvePlanItemUpdate> & { ok: true }>()
      for (const productionPlanItemId of reconciliation.updateIds) {
        const item = items.find(
          (candidate) => candidate.productionPlanItemId?.trim() === productionPlanItemId
        )!
        const current = existing.items.find((row) => row.id === productionPlanItemId)!
        const result = resolvePlanItemUpdate({
          linked: current.salesOrderItemId != null,
          existing: {
            kind: current.productionKind,
            allocatedScaled: toScaledQuantity(String(current.allocatedQty)) ?? BigInt(0),
            extraReason: current.extraReason,
          },
          plannedQty: item.plannedQty,
          allocatedQty: item.allocatedQty,
          extraReason: item.extraReason,
        })
        if (!result.ok) {
          throw new Error(result.error)
        }
        resolved.set(productionPlanItemId, result)

        // 작업지시가 이미 있는 줄은 생산 유형·충당 수량을 바꾸지 않고, 계획 수량을 작업지시 수량 밑으로 줄이지 않는다
        const effectiveWos = current.workOrders.filter((w) => w.status !== "CANCELLED")
        if (effectiveWos.length > 0) {
          const woSum = effectiveWos.reduce((sum, w) => sum + (toScaledQuantity(String(w.plannedQty)) ?? BigInt(0)), BigInt(0))
          const currentAllocated = toScaledQuantity(String(current.allocatedQty)) ?? BigInt(0)
          if (result.kind !== current.productionKind || result.allocatedScaled !== currentAllocated) {
            throw new Error("작업지시가 생성된 생산계획 품목은 생산 유형과 수주 충당 수량을 변경할 수 없습니다.")
          }
          if (result.plannedScaled < woSum) {
            throw new Error(`계획 수량은 작업지시 수량 합계(${formatScaledQuantity(woSum)}) 이상이어야 합니다.`)
          }
        }

        if (result.allocationIncreased && current.salesOrderItemId && current.salesOrderItem) {
          const others = await tx.productionPlanItem.aggregate({
            where: {
              salesOrderItemId: current.salesOrderItemId,
              id: { not: productionPlanItemId },
              plan: { tenantId, status: { not: "CANCELLED" } },
            },
            _sum: { allocatedQty: true },
          })
          const violation = findProductionRequestViolation(
            [{ salesOrderItemId: current.salesOrderItemId, qtyScaled: result.allocatedScaled }],
            new Map([[current.salesOrderItemId, toScaledQuantity(String(current.salesOrderItem.qty)) ?? BigInt(0)]]),
            new Map([[current.salesOrderItemId, toScaledQuantity(String(others._sum.allocatedQty ?? 0)) ?? BigInt(0)]])
          )
          if (violation) {
            throw new Error(allocationIncreaseViolationMessage(current.salesOrderItem.item.code, violation))
          }
        }
      }

      for (const productionPlanItemId of reconciliation.updateIds) {
        const item = items.find(
          (candidate) => candidate.productionPlanItemId?.trim() === productionPlanItemId
        )!
        const result = resolved.get(productionPlanItemId)!
        const current = existing.items.find((row) => row.id === productionPlanItemId)!
        await tx.productionPlanItem.update({
          where: { id: productionPlanItemId },
          data: {
            itemId: item.itemId,
            bomId: item.bomId ?? null,
            routingId: item.routingId ?? null,
            plannedQty: formatScaledQuantity(result.plannedScaled),
            allocatedQty: formatScaledQuantity(result.allocatedScaled),
            productionKind: result.kind,
            extraReason: result.extraReason,
            // 승인 정책 미확정(1단계): 여유가 사라지면 승인 상태를 초기화하고, 그 외에는 기존 상태를 유지한다.
            ...(result.kind !== "ORDER_EXTRA" && current.productionKind === "ORDER_EXTRA"
              ? { extraApprovalStatus: "NOT_REQUIRED" as const, extraApprovedById: null, extraApprovedAt: null }
              : {}),
            note: item.note ?? null,
          },
        })
      }

      for (const itemIndex of reconciliation.createIndexes) {
        const item = items[itemIndex]
        await tx.productionPlanItem.create({
          data: {
            planId: id,
            itemId: item.itemId,
            bomId: item.bomId ?? null,
            routingId: item.routingId ?? null,
            plannedQty: item.plannedQty,
            productionKind: "STOCK",
            allocatedQty: 0,
            note: item.note ?? null,
            salesOrderItemId: null,
          },
        })
      }

      await tx.productionPlan.update({
        where: { id },
        data: {
          ...headerFields,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          // 생산의뢰 요청 ID 태그는 비고를 고쳐도 보존한다(요청 ID 멱등성 유지)
          note: keepProductionRequestTag(existing.note, note),
        },
      })
      await recordAuditLog(tx, {
        tenantId,
        actor: user,
        entityType: "ProductionPlan",
        entityId: id,
        action: "UPDATE",
        beforeData: {
          status: existing.status,
          itemCount: existing.items.length,
        },
        afterData: {
          changes: buildAuditChanges(existing as any, data as any, ["status"]),
          itemCount: items.length,
          reconciliation,
        },
        menuName: "생산계획",
      })
    })
  )

  revalidatePath("/app/mes/production-plan")
}

export async function cancelProductionPlan(id: string, reason: string) {
  const user = await requireResourcePermission("PRODUCTION_PLAN", "UPDATE")
  const result = await withQuantityTransactionRetry(() =>
    prisma.$transaction(async (tx) =>
      cancelProductionPlanForTenant({
        tx,
        planId: id,
        tenantId: user.tenantId,
        actor: user,
        reason,
      })
    )
  )

  revalidatePath("/app/mes/production-plan")
  revalidatePath("/app/mes/sales-orders")
  revalidatePath("/app/mes/sales/order-status")
  return result
}

export async function deletePlan(id: string) {
  const user = await requireResourcePermission("PRODUCTION_PLAN", "DELETE")
  const existing = await prisma.productionPlan.findFirst({
    where: { id, tenantId: user.tenantId },
    select: {
      status: true,
      items: { select: { _count: { select: { workOrders: true } } } },
    },
  })

  if (!existing) {
    throw new Error("생산계획을 찾을 수 없습니다.")
  }

  if (existing.status !== "DRAFT") {
    throw new Error(
      `'${existing.status}' 상태의 생산계획은 삭제할 수 없습니다. DRAFT 상태만 삭제 가능합니다.`
    )
  }

  if (existing.items.some((item) => item._count.workOrders > 0)) {
    throw new Error("연결된 작업지시가 있습니다. 작업지시를 먼저 확인/정리한 후 생산계획을 삭제하세요.")
  }

  await prisma.$transaction(async (tx) => {
    await tx.productionPlanItem.deleteMany({ where: { planId: id } })
    await tx.productionPlan.delete({ where: { id } })
    await recordAuditLog(tx, {
      tenantId: user.tenantId,
      actor: user,
      entityType: "ProductionPlan",
      entityId: id,
      action: "DELETE",
      beforeData: { status: existing.status },
      menuName: "생산계획",
    })
  })

  revalidatePath("/app/mes/production-plan")
}
