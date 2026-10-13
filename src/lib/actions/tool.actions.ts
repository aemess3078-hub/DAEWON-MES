"use server"

import { prisma } from "@/lib/db/prisma"
import { requireRole, getTenantId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { getErrorMessage } from "@/lib/utils"
import type { EquipmentStatus } from "@prisma/client"
import { getRepairRequests, getDailyChecks } from "./equipment-management.actions"
import {
  TOOL_TYPES,
  normalizeToolCode,
  normalizeToolName,
  normalizeLifeLimit,
  normalizeUsageCount,
  buildToolStatusWhere,
  buildToolTypeWhere,
  serializeToolRow,
  type ToolEquipmentType,
  type ToolStatusFilter,
  type ToolRow,
} from "./tool.helpers"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

export type { ToolRow, ToolEquipmentType, ToolStatusFilter }

// ─── 청운커팅 사업계획서 "설비관리 > 공구관리" ──────────────────────────────
//
// 공구/치공구 전용 모델을 새로 만들지 않고 기존 Equipment(TOOL/JIG/FIXTURE
// 타입)를 재사용한다 — 실제 코드 감사 결과, EquipmentType에 이미 TOOL/JIG/
// FIXTURE가 존재하고, 기준정보 CRUD(mold.actions.ts, /app/mes/master/molds)와
// 설비수리이력(EquipmentRepairRequest)/설비점검이력(EquipmentDailyCheck)이 이미
// equipmentId 기준으로 동작해 공구에도 그대로 적용된다. 이 파일은 mold.actions.ts와
// 별개의 화면(사업계획서 "설비관리 > 공구관리")을 위한 것이라 완전히 새로
// 작성하지만, 수리/점검 이력 조회·등록은 새로 만들지 않고 equipment-management.actions.ts의
// 기존 함수(getRepairRequests/getDailyChecks/createRepairRequest/createDailyCheck)를
// 그대로 재사용한다(화면에서 직접 import해서 사용 — 이 파일에는 wrapper를 두지 않는다).
//
// 새로 필요한 것은 (1) 수명 관리 필드(Equipment.lifeLimit/currentUsage),
// (2) 공구-품목 다대다 연결(EquipmentAppliedItem), (3) 사용이력(EquipmentUsageHistory)
// 뿐이라 이 두 모델만 추가했다. tenantId/equipmentId/itemId/operatorId는 client가
// 보낸 값을 신뢰하지 않고 서버에서 항상 재검증한다.
//
// 삭제 권한은 mold.actions.ts(같은 Equipment 테이블을 다루는 기존 화면)가 이미
// OPERATOR까지 삭제를 허용하고 있어, 프로젝트 일관성을 위해 이 화면도 동일하게
// OPERATOR까지 허용한다(사업계획서의 "MANAGER 이상 삭제" 권장안보다 기존 repository
// convention을 우선 — STEP 14 지침에 따름).

const MENU_NAME = "공구관리"

function revalidateToolPaths() {
  revalidatePath("/app/mes/equipment-tools")
}

/** client가 보낸 equipmentId는 신뢰하지 않고, 현재 tenant 소속 + 공구관리 대상 타입인지 서버에서 재검증한다. */
async function assertToolInTenant(id: string, tenantId: string) {
  const tool = await prisma.equipment.findFirst({
    where: { id, tenantId, equipmentType: { in: [...TOOL_TYPES] } },
  })
  if (!tool) throw new Error("공구를 찾을 수 없습니다.")
  return tool
}

/** 적용품목으로 지정한 itemId들이 모두 현재 tenant 소속인지 서버에서 재검증한다. */
async function assertItemsInTenant(tenantId: string, itemIds: string[]) {
  if (itemIds.length === 0) return
  const count = await prisma.item.count({ where: { id: { in: itemIds }, tenantId } })
  if (count !== itemIds.length) {
    throw new Error("적용품목 중 일부를 찾을 수 없습니다.")
  }
}

/** 담당자/작업자 지정 시 현재 tenant의 활성 TenantUser에 속한 Profile만 허용한다(project-issue.actions.ts와 동일 패턴). */
async function assertTenantUserValid(tenantId: string, userId: string | null | undefined) {
  if (!userId) return
  const tenantUser = await prisma.tenantUser.findFirst({
    where: { profileId: userId, tenantId, isActive: true },
    select: { profileId: true },
  })
  if (!tenantUser) {
    throw new Error("사용자를 찾을 수 없습니다. 활성 상태인 사용자만 지정할 수 있습니다.")
  }
}

const TOOL_SELECT = {
  id: true,
  code: true,
  name: true,
  equipmentType: true,
  status: true,
  siteId: true,
  site: { select: { name: true } },
  workCenterId: true,
  workCenter: { select: { name: true } },
  lifeLimit: true,
  currentUsage: true,
  updatedAt: true,
  appliedItems: { select: { item: { select: { id: true, code: true, name: true } } } },
  usageHistories: { select: { usedAt: true }, orderBy: { usedAt: "desc" as const }, take: 1 },
} as const

// ─── 목록 조회 ────────────────────────────────────────────────────────────────

export type ToolFilter = {
  equipmentType?: ToolEquipmentType | "ALL"
  status?: ToolStatusFilter
  itemId?: string
  workCenterId?: string
}

export async function getToolList(filter: ToolFilter = {}): Promise<ToolRow[]> {
  await assertDaewonFeatureScope()
  await requireRole("VIEWER")
  const tenantId = await getTenantId()

  const tools = await prisma.equipment.findMany({
    where: {
      tenantId,
      equipmentType: { in: [...TOOL_TYPES] },
      ...buildToolTypeWhere(filter.equipmentType),
      ...buildToolStatusWhere(filter.status),
      ...(filter.workCenterId && { workCenterId: filter.workCenterId }),
      ...(filter.itemId && { appliedItems: { some: { itemId: filter.itemId } } }),
    },
    select: TOOL_SELECT,
    orderBy: [{ site: { name: "asc" } }, { code: "asc" }],
  })

  return tools.map(serializeToolRow)
}

export type ToolFilterOptions = {
  sites: { id: string; code: string; name: string }[]
  workCenters: { id: string; code: string; name: string; siteId: string }[]
  items: { id: string; code: string; name: string }[]
  operators: { id: string; name: string }[]
}

export async function getToolFilterOptions(): Promise<ToolFilterOptions> {
  await assertDaewonFeatureScope()
  await requireRole("VIEWER")
  const tenantId = await getTenantId()

  const [sites, workCenters, items, tenantUsers] = await Promise.all([
    prisma.site.findMany({ where: { tenantId }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    prisma.workCenter.findMany({
      where: { site: { tenantId } },
      select: { id: true, code: true, name: true, siteId: true },
      orderBy: { code: "asc" },
    }),
    prisma.item.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.tenantUser.findMany({
      where: { tenantId, isActive: true },
      select: { profileId: true, profile: { select: { name: true } } },
      orderBy: { profile: { name: "asc" } },
    }),
  ])

  return {
    sites,
    workCenters,
    items,
    operators: tenantUsers.map((u) => ({ id: u.profileId, name: u.profile.name })),
  }
}

// ─── 상세 조회 (기본정보 + 수명 + 사용/점검/수리 이력) ───────────────────────

export type ToolUsageHistoryRow = {
  id: string
  usedAt: string
  usageCount: number
  itemName: string | null
  workOrderNo: string | null
  productionResultId: string | null
  operationName: string | null
  actualEquipmentName: string | null
  productionQty: number | null
  operatorName: string | null
  note: string | null
  createdByName: string
  createdAt: string
}

export type ToolDetail = {
  tool: ToolRow
  usageHistories: ToolUsageHistoryRow[]
  repairRequests: Awaited<ReturnType<typeof getRepairRequests>>
  dailyChecks: Awaited<ReturnType<typeof getDailyChecks>>
}

export async function getToolDetail(id: string): Promise<ToolDetail | null> {
  await assertDaewonFeatureScope()
  await requireRole("VIEWER")
  const tenantId = await getTenantId()

  const record = await prisma.equipment.findFirst({
    where: { id, tenantId, equipmentType: { in: [...TOOL_TYPES] } },
    select: TOOL_SELECT,
  })
  if (!record) return null

  const [usageRecords, repairRequests, dailyChecks] = await Promise.all([
    prisma.equipmentUsageHistory.findMany({
      where: { equipmentId: id, tenantId },
      select: {
        id: true,
        usedAt: true,
        usageCount: true,
        note: true,
        createdAt: true,
        item: { select: { name: true } },
        workOrderOperation: { select: { workOrder: { select: { orderNo: true } }, routingOperation: { select: { name: true } } } },
        productionResult: { select: { id: true, goodQty: true, defectQty: true, reworkQty: true, workOrderOperationAssignment: { select: { equipment: { select: { name: true } } } } } },
        operator: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { usedAt: "desc" },
    }),
    // 기존 설비수리이력 기능(equipment-management.actions.ts)을 그대로 재사용한다.
    getRepairRequests({ equipmentId: id }),
    // 기존 설비점검이력 기능(equipment-management.actions.ts)을 그대로 재사용한다.
    getDailyChecks({ equipmentId: id }),
  ])

  const usageHistories: ToolUsageHistoryRow[] = usageRecords.map((u) => ({
    id: u.id,
    usedAt: u.usedAt.toISOString(),
    usageCount: u.usageCount,
    itemName: u.item?.name ?? null,
    workOrderNo: u.workOrderOperation?.workOrder.orderNo ?? null,
    productionResultId: u.productionResult?.id ?? null,
    operationName: u.workOrderOperation?.routingOperation.name ?? null,
    actualEquipmentName: u.productionResult?.workOrderOperationAssignment?.equipment.name ?? null,
    productionQty: u.productionResult ? Number(u.productionResult.goodQty) + Number(u.productionResult.defectQty) + Number(u.productionResult.reworkQty) : null,
    operatorName: u.operator?.name ?? null,
    note: u.note,
    createdByName: u.createdBy.name,
    createdAt: u.createdAt.toISOString(),
  }))

  return {
    tool: serializeToolRow(record),
    usageHistories,
    repairRequests,
    dailyChecks,
  }
}

// ─── 등록 ───────────────────────────────────────────────────────────────────

export type CreateToolInput = {
  code: string
  name: string
  equipmentType: ToolEquipmentType
  siteId: string
  workCenterId: string
  lifeLimit?: number | string | null
  itemIds?: string[]
}

export async function createTool(data: CreateToolInput): Promise<{ id: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const code = normalizeToolCode(data.code)
  const name = normalizeToolName(data.name)
  const lifeLimit = normalizeLifeLimit(data.lifeLimit)
  const itemIds = data.itemIds ?? []
  await assertItemsInTenant(tenantId, itemIds)

  const existing = await prisma.equipment.findUnique({
    where: { siteId_code: { siteId: data.siteId, code } },
  })
  if (existing) throw new Error(`공구번호 '${code}'가 이미 존재합니다.`)

  const created = await prisma.$transaction(async (tx) => {
    const tool = await tx.equipment.create({
      data: {
        tenantId,
        siteId: data.siteId,
        workCenterId: data.workCenterId,
        code,
        name,
        equipmentType: data.equipmentType,
        status: "ACTIVE",
        lifeLimit,
      },
    })
    if (itemIds.length > 0) {
      await tx.equipmentAppliedItem.createMany({
        data: itemIds.map((itemId) => ({ equipmentId: tool.id, itemId })),
      })
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "Equipment",
        entityId: tool.id,
        action: "CREATE",
        afterData: { code: tool.code, name: tool.name, equipmentType: tool.equipmentType, lifeLimit: tool.lifeLimit },
        menuName: MENU_NAME,
      },
    })
    return tool
  })

  revalidateToolPaths()
  return { id: created.id }
}

// ─── 수정 ───────────────────────────────────────────────────────────────────
//
// DISCARDED(폐기)는 되돌릴 수 없는 종료 상태로 취급한다 — 이미 DISCARDED인
// 공구를 다른 상태로 되돌리는 요청은 차단한다(§ EquipmentStatus 주석 참조).

export type UpdateToolInput = {
  name?: string
  workCenterId?: string
  lifeLimit?: number | string | null
  status?: EquipmentStatus
  itemIds?: string[]
}

export async function updateTool(id: string, data: UpdateToolInput) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const existing = await assertToolInTenant(id, tenantId)

  if (existing.status === "DISCARDED" && data.status && data.status !== "DISCARDED") {
    throw new Error("폐기된 공구는 다른 상태로 되돌릴 수 없습니다.")
  }

  const name = data.name !== undefined ? normalizeToolName(data.name) : undefined
  const lifeLimit = data.lifeLimit !== undefined ? normalizeLifeLimit(data.lifeLimit) : undefined
  const itemIds = data.itemIds

  if (itemIds !== undefined) {
    await assertItemsInTenant(tenantId, itemIds)
  }

  await prisma.$transaction(async (tx) => {
    await tx.equipment.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(data.workCenterId !== undefined && { workCenterId: data.workCenterId }),
        ...(lifeLimit !== undefined && { lifeLimit }),
        ...(data.status !== undefined && { status: data.status }),
      },
    })
    if (itemIds !== undefined) {
      await tx.equipmentAppliedItem.deleteMany({ where: { equipmentId: id } })
      if (itemIds.length > 0) {
        await tx.equipmentAppliedItem.createMany({
          data: itemIds.map((itemId) => ({ equipmentId: id, itemId })),
        })
      }
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "Equipment",
        entityId: id,
        action: "UPDATE",
        beforeData: { name: existing.name, workCenterId: existing.workCenterId, lifeLimit: existing.lifeLimit, status: existing.status },
        afterData: {
          name: name ?? existing.name,
          workCenterId: data.workCenterId ?? existing.workCenterId,
          lifeLimit: lifeLimit !== undefined ? lifeLimit : existing.lifeLimit,
          status: data.status ?? existing.status,
        },
        menuName: MENU_NAME,
      },
    })
  })

  revalidateToolPaths()
}

// ─── 삭제 ───────────────────────────────────────────────────────────────────
//
// 이력(사용/점검/수리) 또는 작업지시 배정이 있으면 물리 삭제를 차단하고
// DISCARDED(폐기) 상태 변경을 안내한다 — mold.actions.ts의 deleteMold와
// 동일한 정책(품질/생산 추적성 보존).

export async function deleteTool(id: string) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT", "DELETE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const existing = await assertToolInTenant(id, tenantId)

  const [usageCount, repairCount, checkCount, opCount] = await Promise.all([
    prisma.equipmentUsageHistory.count({ where: { equipmentId: id } }),
    prisma.equipmentRepairRequest.count({ where: { equipmentId: id } }),
    prisma.equipmentDailyCheck.count({ where: { equipmentId: id } }),
    prisma.workOrderOperation.count({ where: { equipmentId: id } }),
  ])

  const totalRefs = usageCount + repairCount + checkCount + opCount
  if (totalRefs > 0) {
    throw new Error(`연결된 이력이 ${totalRefs}건 있습니다. 삭제 대신 상태를 '폐기'로 변경해 주세요.`)
  }

  await prisma.$transaction(async (tx) => {
    await tx.equipmentAppliedItem.deleteMany({ where: { equipmentId: id } })
    const result = await tx.equipment.deleteMany({ where: { id, tenantId } })
    if (result.count === 0) throw new Error("공구를 찾을 수 없습니다.")
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "Equipment",
        entityId: id,
        action: "DELETE",
        beforeData: { code: existing.code, name: existing.name, equipmentType: existing.equipmentType, status: existing.status },
        menuName: MENU_NAME,
      },
    })
  })

  revalidateToolPaths()
}

// ─── 사용이력 등록 ────────────────────────────────────────────────────────────
//
// 등록과 동시에 같은 트랜잭션에서 Equipment.currentUsage를 누적한다. 생산실적
// 완료 시 자동 적산은 이번 PR 범위가 아니다(공구-공정 배정 구조가 아직 없음) —
// 지금은 수동 등록만 지원한다(§ EquipmentUsageHistory 모델 주석 참조).

export type CreateToolUsageHistoryInput = {
  equipmentId: string
  usedAt: string
  usageCount: number | string
  itemId?: string | null
  workOrderOperationId?: string | null
  operatorId?: string | null
  note?: string | null
}

export async function createToolUsageHistory(data: CreateToolUsageHistoryInput): Promise<{ id: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  await assertToolInTenant(data.equipmentId, tenantId)
  const usageCount = normalizeUsageCount(data.usageCount)

  const usedAt = new Date(data.usedAt)
  if (Number.isNaN(usedAt.getTime())) throw new Error("사용일시 형식이 올바르지 않습니다.")

  const itemId = data.itemId?.trim() || null
  if (itemId) await assertItemsInTenant(tenantId, [itemId])

  const operatorId = data.operatorId?.trim() || null
  await assertTenantUserValid(tenantId, operatorId)

  let workOrderOperationId = data.workOrderOperationId?.trim() || null
  if (workOrderOperationId) {
    const op = await prisma.workOrderOperation.findFirst({
      where: { id: workOrderOperationId, workOrder: { tenantId } },
      select: { id: true },
    })
    if (!op) throw new Error("작업지시 공정을 찾을 수 없습니다.")
  }

  const note = data.note?.trim() || null

  const created = await prisma.$transaction(async (tx) => {
    const usage = await tx.equipmentUsageHistory.create({
      data: {
        tenantId,
        equipmentId: data.equipmentId,
        usedAt,
        usageCount,
        itemId,
        workOrderOperationId,
        operatorId,
        note,
        createdById: actor.id,
      },
    })
    await tx.equipment.update({
      where: { id: data.equipmentId },
      data: { currentUsage: { increment: usageCount } },
    })
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "EquipmentUsageHistory",
        entityId: usage.id,
        action: "CREATE",
        afterData: { equipmentId: data.equipmentId, usedAt: usage.usedAt, usageCount },
        menuName: MENU_NAME,
      },
    })
    return usage
  })

  revalidateToolPaths()
  return { id: created.id }
}
