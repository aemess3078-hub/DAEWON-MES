"use server"

import { getTenantId, requireRole } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { RoutingScope, RoutingStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { getRoutingOperationReferences, type RoutingOperationReferenceSummary } from "@/lib/routing-references.server"
import { validateRoutingForItemContext } from "@/lib/routing-validation.server"

export type RoutingWithDetails = {
  id: string
  tenantId: string
  code: string
  name: string
  version: string
  status: RoutingStatus
  scope: RoutingScope
  createdAt: Date
  updatedAt: Date
  items: {
    id: string
    itemId: string
    isDefault: boolean
    item: {
      id: string
      code: string
      name: string
      itemType: string
      category: { id: string; name: string } | null
    }
  }[]
  operations: {
    id: string
    routingId: string
    seq: number
    operationCode: string
    name: string
    workCenterId: string
    standardTime: any
    workCenter: { id: string; code: string; name: string }
  }[]
}

export async function getRoutings(): Promise<RoutingWithDetails[]> {
  const tenantId = await getTenantId()
  return prisma.routing.findMany({
    where: { tenantId },
    include: {
      items: {
        include: { item: { include: { category: true } } },
      },
      operations: {
        include: { workCenter: true },
        orderBy: { seq: "asc" },
      },
    },
    orderBy: [{ code: "asc" }, { version: "asc" }],
  }) as any
}

export async function getRoutingById(id: string): Promise<RoutingWithDetails | null> {
  const tenantId = await getTenantId()
  return prisma.routing.findFirst({
    where: { id, tenantId },
    include: {
      items: {
        include: { item: { include: { category: true } } },
      },
      operations: {
        include: { workCenter: true },
        orderBy: { seq: "asc" },
      },
    },
  }) as any
}

export async function getItemsForRouting() {
  const tenantId = await getTenantId()
  return prisma.item.findMany({
    where: { tenantId, itemType: { in: ["FINISHED", "SEMI_FINISHED"] } },
    select: { id: true, code: true, name: true, itemType: true },
    orderBy: { code: "asc" },
  })
}

export async function getWorkCenters() {
  const tenantId = await getTenantId()
  return prisma.workCenter.findMany({
    where: { site: { tenantId } },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  })
}

// ─── 품목 기준 사용 가능 라우팅(범용 + 품목전용) 조회 ────────────────────────────
// production-plan.actions.ts / work-order.actions.ts에서 재사용한다.

export type RoutingCandidate = {
  id: string
  code: string
  name: string
  version: string
  isDefault: boolean
  scope: RoutingScope
}

export async function getAvailableRoutingsForItem(itemId: string): Promise<RoutingCandidate[]> {
  const tenantId = await getTenantId()
  const [itemSpecific, common] = await Promise.all([
    prisma.itemRouting.findMany({
      where: { itemId, routing: { tenantId, status: "ACTIVE", scope: "ITEM_SPECIFIC" } },
      select: {
        isDefault: true,
        routing: { select: { id: true, code: true, name: true, version: true } },
      },
      orderBy: { routing: { version: "asc" } },
    }),
    prisma.routing.findMany({
      where: { tenantId, status: "ACTIVE", scope: "COMMON" },
      select: { id: true, code: true, name: true, version: true },
      orderBy: { version: "asc" },
    }),
  ])

  return [
    ...itemSpecific.map((ir) => ({ ...ir.routing, isDefault: ir.isDefault, scope: "ITEM_SPECIFIC" as const })),
    ...common.map((r) => ({ ...r, isDefault: false, scope: "COMMON" as const })),
  ]
}

/**
 * 생산계획/작업지시 등에서 선택된 routingId가 해당 itemId에 실제로 허용되는지 서버에서 검증한다.
 * UI에서 이미 필터링해 보여주더라도, 클라이언트 요청을 신뢰하지 않고 항상 이 검증을 통과해야 한다.
 * 허용 조건: 같은 tenant 소유 + ACTIVE 상태 + (scope=COMMON 이거나 ItemRouting으로 연결됨).
 */
export async function validateRoutingForItem(params: {
  tenantId: string
  itemId: string
  routingId: string
}): Promise<void> {
  await validateRoutingForItemContext(prisma, params)
}

export type RoutingOperationInput = {
  seq: number
  operationCode: string
  name: string
  workCenterId: string
  standardTime: number
}

export type CreateRoutingInput = {
  code: string
  name: string
  version: string
  status: RoutingStatus
  scope: RoutingScope
  // COMMON이면 무시된다(품목 연결을 만들지 않음). ITEM_SPECIFIC이면 최소 1개 필요.
  itemIds: string[]
  isDefault: boolean
  operations: RoutingOperationInput[]
}

function normalizeItemIds(itemIds: string[]): string[] {
  return Array.from(new Set(itemIds.map((id) => id.trim()).filter(Boolean)))
}

async function assertItemsOwnedAndEligible(tenantId: string, itemIds: string[]) {
  if (itemIds.length === 0) return
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true, itemType: true },
  })
  if (items.length !== itemIds.length) {
    throw new Error("선택한 품목 중 존재하지 않거나 접근 권한이 없는 품목이 있습니다.")
  }
  const invalid = items.some((i) => i.itemType !== "FINISHED" && i.itemType !== "SEMI_FINISHED")
  if (invalid) {
    throw new Error("라우팅은 완제품 또는 반제품에만 연결할 수 있습니다.")
  }
}

export async function createRouting(data: CreateRoutingInput, _tenantId?: string) {
  await requireResourcePermission("ROUTING", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const { operations, itemIds, isDefault, scope, ...routingFields } = data

  const normalizedItemIds = scope === "COMMON" ? [] : normalizeItemIds(itemIds)
  if (scope === "ITEM_SPECIFIC" && normalizedItemIds.length === 0) {
    throw new Error("품목 전용 라우팅은 최소 1개 이상의 품목을 선택해야 합니다.")
  }
  await assertItemsOwnedAndEligible(tenantId, normalizedItemIds)
  const finalIsDefault = scope === "COMMON" ? false : isDefault

  let createdId = ""
  await prisma.$transaction(async (tx) => {
    const routing = await tx.routing.create({
      data: {
        ...routingFields,
        scope,
        tenantId,
        operations: {
          create: operations.map((op) => ({
            seq: op.seq,
            operationCode: op.operationCode,
            name: op.name,
            workCenterId: op.workCenterId,
            standardTime: op.standardTime,
          })),
        },
      },
    })
    createdId = routing.id

    if (scope === "ITEM_SPECIFIC" && normalizedItemIds.length > 0) {
      if (finalIsDefault) {
        await tx.itemRouting.updateMany({
          where: { itemId: { in: normalizedItemIds } },
          data: { isDefault: false },
        })
      }
      await tx.itemRouting.createMany({
        data: normalizedItemIds.map((itemId) => ({
          tenantId,
          itemId,
          routingId: routing.id,
          isDefault: finalIsDefault,
        })),
      })
    }
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Routing",
      entityId: createdId,
      action: "CREATE",
      afterData: {
        code: data.code,
        name: data.name,
        version: data.version,
        status: data.status,
        scope,
        itemIds: normalizedItemIds,
        itemCount: normalizedItemIds.length,
        isDefault: finalIsDefault,
        operationCount: operations.length,
      },
      menuName: "공정라우팅관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/routing")
}

export async function updateRouting(id: string, data: CreateRoutingInput) {
  await requireResourcePermission("ROUTING", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.routing.findFirst({
    where: { id, tenantId },
    include: {
      items: { select: { itemId: true } },
      operations: { orderBy: { seq: "asc" } },
    },
  })
  if (!owned) throw new Error("NOT_FOUND")

  const { operations, itemIds, isDefault, scope, ...routingFields } = data
  const { code, name, version, status } = routingFields

  const normalizedItemIds = scope === "COMMON" ? [] : normalizeItemIds(itemIds)
  if (scope === "ITEM_SPECIFIC" && normalizedItemIds.length === 0) {
    throw new Error("품목 전용 라우팅은 최소 1개 이상의 품목을 선택해야 합니다.")
  }
  await assertItemsOwnedAndEligible(tenantId, normalizedItemIds)
  const finalIsDefault = scope === "COMMON" ? false : isDefault
  const beforeItemIds = owned.items.map((i) => i.itemId)
  const beforeScope = owned.scope

  // 공정(RoutingOperation) 자체가 실제로 변경됐는지 먼저 판정한다.
  // 변경이 없으면(이름/상태/scope/품목 연결만 수정) RoutingOperation은 절대 건드리지 않는다 —
  // 이미 WorkOrderOperation/InspectionSpec/EquipmentOperationMap이 참조 중이어도 안전하게 수정 가능해야 하기 때문.
  const operationsChanged = !operationsEqual(owned.operations, operations)

  if (operationsChanged) {
    const routingOperationIds = owned.operations.map((op) => op.id)
    const refs = await getRoutingOperationReferences(prisma, routingOperationIds)
    if (
      refs.workOrderOperationCount > 0 ||
      refs.inspectionSpecCount > 0 ||
      refs.equipmentMapCount > 0 ||
      refs.workStandardMappingCount > 0
    ) {
      throw new Error(
        "이미 작업지시 또는 검사·설비 설정에서 사용 중인 라우팅의 공정 목록은 직접 수정할 수 없습니다.\n" +
        "기존 라우팅을 비활성화하고 새 버전을 등록해주세요.\n\n" +
        "참조 현황:\n" +
        `- 작업지시 공정: ${refs.workOrderOperationCount}건\n` +
        `- 검사기준: ${refs.inspectionSpecCount}건\n` +
        `- 설비 연결: ${refs.equipmentMapCount}건\n` +
        `- 작업표준서 매핑: ${refs.workStandardMappingCount}건`
      )
    }
  }

  await prisma.$transaction(async (tx) => {
    if (operationsChanged) {
      await tx.routingOperation.deleteMany({ where: { routingId: id } })
    }
    await tx.routing.update({
      where: { id },
      data: {
        code,
        name,
        version,
        status,
        scope,
        ...(operationsChanged
          ? {
              operations: {
                create: operations.map((op) => ({
                  seq: op.seq,
                  operationCode: op.operationCode,
                  name: op.name,
                  workCenterId: op.workCenterId,
                  standardTime: op.standardTime,
                })),
              },
            }
          : {}),
      },
    })

    if (scope === "COMMON") {
      // ITEM_SPECIFIC -> COMMON 전환(또는 COMMON 유지): 기존 품목 연결을 전부 제거한다.
      // 이미 생성된 ProductionPlanItem/WorkOrder의 routingId는 Routing.id를 직접 참조하므로 영향받지 않는다.
      if (beforeItemIds.length > 0) {
        await tx.itemRouting.deleteMany({ where: { routingId: id } })
      }
    } else {
      // 선택된 itemIds를 최종 상태로 동기화(제거된 연결만 삭제, 새 연결만 추가, 유지되는 연결은 isDefault만 갱신)
      const toRemove = beforeItemIds.filter((itemId) => !normalizedItemIds.includes(itemId))
      const toAdd = normalizedItemIds.filter((itemId) => !beforeItemIds.includes(itemId))
      const toKeep = normalizedItemIds.filter((itemId) => beforeItemIds.includes(itemId))

      if (toRemove.length > 0) {
        await tx.itemRouting.deleteMany({ where: { routingId: id, itemId: { in: toRemove } } })
      }
      if (finalIsDefault && normalizedItemIds.length > 0) {
        // 선택된 각 품목의 "다른" 라우팅에 걸린 기존 기본 라우팅을 해제(품목당 기본 라우팅 최대 1개)
        await tx.itemRouting.updateMany({
          where: { itemId: { in: normalizedItemIds }, routingId: { not: id } },
          data: { isDefault: false },
        })
      }
      if (toAdd.length > 0) {
        await tx.itemRouting.createMany({
          data: toAdd.map((itemId) => ({ tenantId, itemId, routingId: id, isDefault: finalIsDefault })),
        })
      }
      if (toKeep.length > 0) {
        await tx.itemRouting.updateMany({
          where: { routingId: id, itemId: { in: toKeep } },
          data: { isDefault: finalIsDefault },
        })
      }
    }
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Routing",
      entityId: id,
      action: "UPDATE",
      beforeData: {
        code: owned.code,
        name: owned.name,
        version: owned.version,
        status: owned.status,
        scope: beforeScope,
        itemIds: beforeItemIds,
        itemCount: beforeItemIds.length,
      },
      afterData: {
        code,
        name,
        version,
        status,
        scope,
        itemIds: normalizedItemIds,
        itemCount: normalizedItemIds.length,
        isDefault: finalIsDefault,
        operationCount: operations.length,
        operationsChanged,
        scopeChanged: beforeScope !== scope,
      },
      menuName: "공정라우팅관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/routing")
}

// 기존 RoutingOperation과 새로 제출된 operations가 실질적으로 동일한지 판정한다.
// 동일하면 updateRouting은 RoutingOperation을 건드리지 않는다(FK로 참조 중이어도 안전하게 다른 필드만 수정 가능).
function operationsEqual(
  existing: { seq: number; operationCode: string; name: string; workCenterId: string; standardTime: unknown }[],
  incoming: RoutingOperationInput[]
): boolean {
  if (existing.length !== incoming.length) return false
  const sortedExisting = [...existing].sort((a, b) => a.seq - b.seq)
  const sortedIncoming = [...incoming].sort((a, b) => a.seq - b.seq)
  return sortedExisting.every((op, i) => {
    const next = sortedIncoming[i]
    return (
      op.seq === next.seq &&
      op.operationCode === next.operationCode &&
      op.name === next.name &&
      op.workCenterId === next.workCenterId &&
      Number(op.standardTime) === Number(next.standardTime)
    )
  })
}

export type RoutingUsageSummary = {
  productionPlanItemCount: number
  workOrderCount: number
  workOrderOperationCount: number
  inspectionSpecCount: number
  equipmentMapCount: number
  workStandardMappingCount: number
}

export async function getRoutingUsageSummary(id: string): Promise<RoutingUsageSummary> {
  const tenantId = await getTenantId()
  const owned = await prisma.routing.findFirst({ where: { id, tenantId }, select: { id: true } })
  if (!owned) throw new Error("NOT_FOUND")

  const routingOperations = await prisma.routingOperation.findMany({
    where: { routingId: id },
    select: { id: true },
  })
  const routingOperationIds = routingOperations.map((op) => op.id)

  const [productionPlanItemCount, workOrderCount, operationRefs] = await Promise.all([
    prisma.productionPlanItem.count({ where: { routingId: id } }),
    prisma.workOrder.count({ where: { routingId: id } }),
    getRoutingOperationReferences(prisma, routingOperationIds),
  ])

  return { productionPlanItemCount, workOrderCount, ...operationRefs }
}

export async function deleteRouting(id: string) {
  await requireResourcePermission("ROUTING", "DELETE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.routing.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("NOT_FOUND")

  const usage = await getRoutingUsageSummary(id)
  if (usage.productionPlanItemCount > 0 || usage.workOrderCount > 0) {
    throw new Error(
      `이 라우팅은 생산계획 ${usage.productionPlanItemCount}건, 작업지시 ${usage.workOrderCount}건에서 사용 중이라 삭제할 수 없습니다. ` +
      `사용을 중단하려면 상태를 '비활성'으로 변경하세요.`
    )
  }
  if (
    usage.workOrderOperationCount > 0 ||
    usage.inspectionSpecCount > 0 ||
    usage.equipmentMapCount > 0 ||
    usage.workStandardMappingCount > 0
  ) {
    throw new Error(
      `이 라우팅의 공정은 작업지시 실적 ${usage.workOrderOperationCount}건, 검사기준 ${usage.inspectionSpecCount}건, ` +
      `설비매핑 ${usage.equipmentMapCount}건, 작업표준서 매핑 ${usage.workStandardMappingCount}건에서 참조 중이라 삭제할 수 없습니다. ` +
      `사용을 중단하려면 상태를 '비활성'으로 변경하세요.`
    )
  }

  await prisma.$transaction([
    prisma.itemRouting.deleteMany({ where: { routingId: id } }),
    prisma.routingOperation.deleteMany({ where: { routingId: id } }),
    prisma.routing.delete({ where: { id } }),
  ])
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Routing",
      entityId: id,
      action: "DELETE",
      beforeData: { code: owned.code, name: owned.name, version: owned.version, status: owned.status, scope: owned.scope },
      menuName: "공정라우팅관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/routing")
}
