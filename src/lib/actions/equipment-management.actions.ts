"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId, getCurrentUser, getCurrentUserId } from "@/lib/auth"
import { isMissingDbObjectError } from "@/lib/db/prisma-error"
import {
  RepairRequestStatus,
  RepairPriority,
  CheckResult,
  EquipmentEventType,
  EquipmentDowntimeKind,
  PreventiveMaintenanceCycleUnit,
} from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { recordAuditLog } from "@/lib/audit-log"
import { assertNoAttachmentsForEntity } from "./attachment.actions"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProblemTypeRow = {
  id: string
  tenantId: string
  code: string
  name: string
  category: string | null
  description: string | null
  isActive: boolean
  createdAt: Date
  _count: { repairRequests: number }
}

export type RepairRequestRow = {
  id: string
  tenantId: string
  siteId: string
  equipmentId: string
  problemTypeId: string | null
  requestNo: string
  title: string
  description: string | null
  priority: RepairPriority
  status: RepairRequestStatus
  requestedBy: string
  assignedTo: string | null
  startedAt: Date | null
  completedAt: Date | null
  note: string | null
  createdAt: Date
  updatedAt: Date
  equipment: { id: string; code: string; name: string }
  problemType: { id: string; name: string } | null
  requester: { id: string; name: string }
  assignee: { id: string; name: string } | null
  site: { id: string; name: string }
}
export type EquipmentDowntimeRow = {
  id: string
  tenantId: string
  siteId: string
  equipmentId: string
  reasonId: string
  eventType: EquipmentEventType
  kind: EquipmentDowntimeKind
  startedAt: Date
  endedAt: Date | null
  note: string | null
  equipmentEventId: string | null
  repairRequestId: string | null
  createdAt: Date
  equipment: { id: string; code: string; name: string }
  reason: { id: string; code: string; name: string }
  repairRequest: { id: string; requestNo: string; title: string } | null
}

export type MaintenancePlanRow = {
  id: string
  tenantId: string
  siteId: string
  equipmentId: string
  title: string
  description: string | null
  cycleValue: number
  cycleUnit: PreventiveMaintenanceCycleUnit
  startDate: Date
  nextDueAt: Date
  lastCompletedAt: Date | null
  isActive: boolean
  createdAt: Date
  equipment: { id: string; code: string; name: string }
  histories: Array<{
    id: string
    scheduledAt: Date
    completedAt: Date
    result: CheckResult
    note: string | null
    performer: { id: string; name: string }
  }>
}

export type DailyCheckRow = {
  id: string
  tenantId: string
  siteId: string
  equipmentId: string
  checkDate: Date
  checkedBy: string
  result: CheckResult
  note: string | null
  items: any
  createdAt: Date
  equipment: { id: string; code: string; name: string }
  checker: { id: string; name: string }
  site: { id: string; name: string }
}
// ─── Problem Types ─────────────────────────────────────────────────────────────

export async function getProblemTypes(): Promise<ProblemTypeRow[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  try {
    return (await prisma.equipmentProblemType.findMany({
      where: { tenantId },
      include: { _count: { select: { repairRequests: true } } },
      orderBy: { code: "asc" },
    })) as any
  } catch (error) {
    if (isMissingDbObjectError(error)) return []
    throw error
  }
}

export async function createProblemType(data: {
  code: string
  name: string
  category?: string
  description?: string
}) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "CREATE")
  const actor = await getCurrentUser()
  if (!actor) throw new Error("UNAUTHORIZED")
  const tenantId = actor.tenantId
  await prisma.$transaction(async (tx) => {
    const created = await tx.equipmentProblemType.create({
      data: { tenantId, ...data },
    })
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "EquipmentProblemType",
      entityId: created.id,
      action: "CREATE",
      afterData: data,
      menuName: "설비보전",
    })
  })
  revalidatePath("/app/mes/equipment-problems")
}

export async function updateProblemType(
  id: string,
  data: { name?: string; category?: string; description?: string; isActive?: boolean }
) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "UPDATE")
  const actor = await getCurrentUser()
  if (!actor) throw new Error("UNAUTHORIZED")
  const tenantId = actor.tenantId
  await prisma.$transaction(async (tx) => {
    const before = await tx.equipmentProblemType.findUniqueOrThrow({ where: { id, tenantId } })
    await tx.equipmentProblemType.update({
      where: { id, tenantId },
      data,
    })
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "EquipmentProblemType",
      entityId: id,
      action: "UPDATE",
      beforeData: before,
      afterData: data,
      menuName: "설비보전",
    })
  })
  revalidatePath("/app/mes/equipment-problems")
}

export async function deleteProblemType(id: string) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "DELETE")
  const actor = await getCurrentUser()
  if (!actor) throw new Error("UNAUTHORIZED")
  const tenantId = actor.tenantId
  const repairCount = await prisma.equipmentRepairRequest.count({ where: { tenantId, problemTypeId: id } })
  if (repairCount > 0) {
    throw new Error(`수리요청 이력이 ${repairCount}건 있어 문제유형을 삭제할 수 없습니다. 비활성화로 관리해 주세요.`)
  }
  await prisma.$transaction(async (tx) => {
    const before = await tx.equipmentProblemType.findUniqueOrThrow({ where: { id, tenantId } })
    await tx.equipmentProblemType.delete({ where: { id, tenantId } })
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "EquipmentProblemType",
      entityId: id,
      action: "DELETE",
      beforeData: before,
      menuName: "설비보전",
    })
  })
  revalidatePath("/app/mes/equipment-problems")
}

// ─── Repair Requests ───────────────────────────────────────────────────────────

export async function getRepairRequests(filters?: {
  equipmentId?: string
  status?: RepairRequestStatus
  priority?: RepairPriority
}): Promise<RepairRequestRow[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  try {
    return (await prisma.equipmentRepairRequest.findMany({
      where: { tenantId, ...filters },
      include: {
        equipment: { select: { id: true, code: true, name: true } },
        problemType: { select: { id: true, name: true } },
        requester: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        site: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    })) as any
  } catch (error) {
    if (isMissingDbObjectError(error)) return []
    throw error
  }
}

export async function createRepairRequest(data: {
  equipmentId: string
  problemTypeId?: string
  title: string
  description?: string
  priority?: RepairPriority
}) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "CREATE")
  const actor = await getCurrentUser()
  if (!actor) throw new Error("UNAUTHORIZED")
  const tenantId = actor.tenantId
  const userId = await getCurrentUserId()

  const tenantUser = await prisma.tenantUser.findFirst({
    where: { tenantId, profileId: userId },
    include: { site: true },
  })
  const siteId = tenantUser?.siteId ?? (await prisma.site.findFirst({ where: { tenantId } }))?.id
  if (!siteId) throw new Error("사이트를 찾을 수 없습니다.")

  const count = await prisma.equipmentRepairRequest.count({ where: { tenantId } })
  const requestNo = `REP-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`

  await prisma.$transaction(async (tx) => {
    const created = await tx.equipmentRepairRequest.create({
      data: {
        tenantId,
        siteId,
        equipmentId: data.equipmentId,
        problemTypeId: data.problemTypeId ?? null,
        requestNo,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority ?? "MEDIUM",
        requestedBy: userId,
      },
    })
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "EquipmentRepairRequest",
      entityId: created.id,
      action: "CREATE",
      afterData: { requestNo, ...data },
      menuName: "설비보전",
    })
  })
  revalidatePath("/app/mes/equipment-repair")
}

export async function updateRepairStatus(
  id: string,
  status: RepairRequestStatus,
  extra?: { assignedTo?: string; note?: string }
) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "UPDATE")
  const actor = await getCurrentUser()
  if (!actor) throw new Error("UNAUTHORIZED")
  const tenantId = actor.tenantId
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    const before = await tx.equipmentRepairRequest.findUniqueOrThrow({ where: { id, tenantId } })
    await tx.equipmentRepairRequest.update({
      where: { id, tenantId },
      data: {
        status,
        ...(status === "IN_PROGRESS" && { startedAt: now }),
        ...(status === "COMPLETED" && { completedAt: now }),
        ...extra,
      },
    })
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "EquipmentRepairRequest",
      entityId: id,
      action: "UPDATE",
      beforeData: { status: before.status, assignedTo: before.assignedTo },
      afterData: { status, ...extra },
      menuName: "설비보전",
    })
  })
  revalidatePath("/app/mes/equipment-repair")
}

export async function updateRepairRequest(
  id: string,
  data: {
    title?: string
    description?: string
    priority?: RepairPriority
    problemTypeId?: string
    assignedTo?: string
    note?: string
  }
) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "UPDATE")
  const actor = await getCurrentUser()
  if (!actor) throw new Error("UNAUTHORIZED")
  const tenantId = actor.tenantId
  const current = await prisma.equipmentRepairRequest.findFirst({ where: { id, tenantId } })
  if (!current) throw new Error("수리요청을 찾을 수 없습니다.")
  if (current.status === "COMPLETED" || current.status === "CANCELLED") {
    throw new Error("완료 또는 취소된 수리요청은 수정할 수 없습니다.")
  }
  await prisma.$transaction(async (tx) => {
    await tx.equipmentRepairRequest.update({
      where: { id, tenantId },
      data,
    })
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "EquipmentRepairRequest",
      entityId: id,
      action: "UPDATE",
      beforeData: current,
      afterData: data,
      menuName: "설비보전",
    })
  })
  revalidatePath("/app/mes/equipment-repair")
}

export async function deleteRepairRequest(id: string) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "DELETE")
  const actor = await getCurrentUser()
  if (!actor) throw new Error("UNAUTHORIZED")
  const tenantId = actor.tenantId
  const current = await prisma.equipmentRepairRequest.findFirst({
    where: { id, tenantId },
  })
  if (!current) throw new Error("수리요청을 찾을 수 없습니다.")
  if (current.status !== "OPEN" || current.startedAt || current.completedAt) {
    throw new Error("처리 이력이 없는 OPEN 상태의 수리요청만 삭제할 수 있습니다. 진행/완료/취소 이력은 보존됩니다.")
  }
  await prisma.$transaction(async (tx) => {
    await assertNoAttachmentsForEntity(tx, tenantId, "EQUIPMENT_REPAIR_REQUEST", id)
    await tx.equipmentRepairRequest.delete({ where: { id, tenantId } })
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "EquipmentRepairRequest",
      entityId: id,
      action: "DELETE",
      beforeData: current,
      menuName: "설비보전",
    })
  })
  revalidatePath("/app/mes/equipment-repair")
}

// ─── Daily Checks ──────────────────────────────────────────────────────────────

export async function getDailyChecks(filters?: {
  equipmentId?: string
  from?: Date
  to?: Date
}): Promise<DailyCheckRow[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  try {
    return (await prisma.equipmentDailyCheck.findMany({
      where: {
        tenantId,
        ...(filters?.equipmentId && { equipmentId: filters.equipmentId }),
        ...(filters?.from && { checkDate: { gte: filters.from } }),
        ...(filters?.to && { checkDate: { lte: filters.to } }),
      },
      include: {
        equipment: { select: { id: true, code: true, name: true } },
        checker: { select: { id: true, name: true } },
        site: { select: { id: true, name: true } },
      },
      orderBy: { checkDate: "desc" },
    })) as any
  } catch (error) {
    if (isMissingDbObjectError(error)) return []
    throw error
  }
}

export async function createDailyCheck(data: {
  equipmentId: string
  checkDate: Date
  result: CheckResult
  note?: string
  items?: Record<string, string>
}) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "CREATE")
  const tenantId = await getTenantId()
  const userId = await getCurrentUserId()

  const tenantUser = await prisma.tenantUser.findFirst({
    where: { tenantId, profileId: userId },
  })
  const siteId = tenantUser?.siteId ?? (await prisma.site.findFirst({ where: { tenantId } }))?.id
  if (!siteId) throw new Error("사이트를 찾을 수 없습니다.")

  await prisma.equipmentDailyCheck.upsert({
    where: {
      equipmentId_checkDate: {
        equipmentId: data.equipmentId,
        checkDate: data.checkDate,
      },
    },
    update: {
      result: data.result,
      note: data.note ?? null,
      items: data.items ?? undefined,
      checkedBy: userId,
    },
    create: {
      tenantId,
      siteId,
      equipmentId: data.equipmentId,
      checkDate: data.checkDate,
      checkedBy: userId,
      result: data.result,
      note: data.note ?? null,
      items: data.items ?? undefined,
    },
  })
  revalidatePath("/app/mes/equipment-check")
}

// ─── Equipment list helper ────────────────────────────────────────────────────

export async function getEquipmentsForLMS() {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  return prisma.equipment.findMany({
    where: { tenantId },
    include: { workCenter: { select: { name: true } } },
    orderBy: { code: "asc" },
  })
}

export async function getProfilesForLMS() {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const users = await prisma.tenantUser.findMany({
    where: { tenantId, isActive: true },
    include: { profile: true },
  })
  return users.map((u) => ({ id: u.profileId, name: u.profile.name }))
}

// ─── Daily Check Status (read-only, serializable) ────────────────────────────

export type DailyCheckStatusRow = {
  id: string
  checkDate: string         // YYYY-MM-DD
  equipmentCode: string
  equipmentName: string
  siteName: string
  checkerName: string
  result: CheckResult
  note: string | null
}

export type DailyCheckStatusSummary = {
  total: number
  passCount: number
  failCount: number
  naCount: number
}

export type DailyCheckStatusData = {
  summary: DailyCheckStatusSummary
  rows: DailyCheckStatusRow[]
}

export async function getDailyCheckStatusData(filter: {
  from: string  // YYYY-MM-DD
  to: string
  equipmentId?: string
  result?: CheckResult
}): Promise<DailyCheckStatusData> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const from = new Date(filter.from)
  const to = new Date(filter.to)

  let checks: any[]
  try {
    checks = await prisma.equipmentDailyCheck.findMany({
      where: {
        tenantId,
        checkDate: { gte: from, lte: to },
        ...(filter.equipmentId ? { equipmentId: filter.equipmentId } : {}),
        ...(filter.result ? { result: filter.result } : {}),
      },
      select: {
        id: true,
        checkDate: true,
        result: true,
        note: true,
        equipment: { select: { code: true, name: true } },
        site: { select: { name: true } },
        checker: { select: { name: true } },
      },
      orderBy: { checkDate: "desc" },
    })
  } catch (error) {
    if (!isMissingDbObjectError(error)) throw error
    checks = []
  }

  const rows: DailyCheckStatusRow[] = checks.map((c) => {
    const d = c.checkDate
    const checkDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
    return {
      id: c.id,
      checkDate,
      equipmentCode: c.equipment.code,
      equipmentName: c.equipment.name,
      siteName: c.site.name,
      checkerName: c.checker.name,
      result: c.result,
      note: c.note,
    }
  })

  return {
    summary: {
      total: rows.length,
      passCount: rows.filter((r) => r.result === "PASS").length,
      failCount: rows.filter((r) => r.result === "FAIL").length,
      naCount: rows.filter((r) => r.result === "NA").length,
    },
    rows,
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function getRepairStats() {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  try {
    const [open, inProgress, completed, critical] = await Promise.all([
      prisma.equipmentRepairRequest.count({ where: { tenantId, status: "OPEN" } }),
      prisma.equipmentRepairRequest.count({ where: { tenantId, status: "IN_PROGRESS" } }),
      prisma.equipmentRepairRequest.count({ where: { tenantId, status: "COMPLETED" } }),
      prisma.equipmentRepairRequest.count({ where: { tenantId, priority: "CRITICAL", status: { not: "COMPLETED" } } }),
    ])
    return { open, inProgress, completed, critical }
  } catch (error) {
    if (isMissingDbObjectError(error)) return { open: 0, inProgress: 0, completed: 0, critical: 0 }
    throw error
  }
}

// ─── Downtime records ─────────────────────────────────────────────────────────

const DOWNTIME_REASON_GROUP_CODE = "DOWNTIME_REASON"
const EQUIPMENT_MAINTENANCE_PATH = "/app/mes/equipment-check"
const EQUIPMENT_REPAIR_PATH = "/app/mes/equipment-repair"
const EQUIPMENT_STATISTICS_PATH = "/app/mes/equipment-statistics"
const DOWNTIME_REASON_PATH = "/app/mes/master/downtime-reasons"

function secondsBetween(startedAt: Date, endedAt: Date): number {
  return Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
}

function assertValidDowntimeEventType(eventType: EquipmentEventType) {
  if (eventType !== "STOP" && eventType !== "MAINTENANCE") {
    throw new Error("비가동 이력은 STOP 또는 MAINTENANCE 이벤트만 연결할 수 있습니다.")
  }
}

function assertValidRange(startedAt: Date, endedAt?: Date | null) {
  if (Number.isNaN(startedAt.getTime())) throw new Error("시작일시가 올바르지 않습니다.")
  if (endedAt && Number.isNaN(endedAt.getTime())) throw new Error("종료일시가 올바르지 않습니다.")
  if (endedAt && endedAt <= startedAt) throw new Error("종료일시는 시작일시보다 늦어야 합니다.")
}

async function getDefaultSiteId(tenantId: string, userId: string): Promise<string> {
  const tenantUser = await prisma.tenantUser.findFirst({ where: { tenantId, profileId: userId } })
  const siteId = tenantUser?.siteId ?? (await prisma.site.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" } }))?.id
  if (!siteId) throw new Error("사이트를 찾을 수 없습니다.")
  return siteId
}

async function requireDowntimeReason(tenantId: string, reasonId: string) {
  const reason = await prisma.commonCode.findFirst({
    where: {
      id: reasonId,
      isActive: true,
      group: { tenantId, groupCode: DOWNTIME_REASON_GROUP_CODE, isActive: true },
    },
    select: { id: true, code: true, name: true },
  })
  if (!reason) throw new Error("사용 가능한 비가동 사유를 찾을 수 없습니다.")
  return reason
}

async function assertNoDowntimeOverlap(input: {
  tenantId: string
  equipmentId: string
  startedAt: Date
  endedAt: Date | null
  excludeId?: string
}) {
  const overlap = await prisma.equipmentDowntime.findFirst({
    where: {
      tenantId: input.tenantId,
      equipmentId: input.equipmentId,
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      AND: [
        { startedAt: { lt: input.endedAt ?? new Date("9999-12-31T23:59:59.999Z") } },
        { OR: [{ endedAt: null }, { endedAt: { gt: input.startedAt } }] },
      ],
    },
    select: { id: true },
  })
  if (overlap) throw new Error("같은 설비에 겹치는 비가동 이력이 이미 있습니다.")
}

export async function getEquipmentDowntimeRecords(filters?: {
  equipmentId?: string
  from?: Date
  to?: Date
}): Promise<EquipmentDowntimeRow[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  try {
    return (await prisma.equipmentDowntime.findMany({
      where: {
        tenantId,
        ...(filters?.equipmentId ? { equipmentId: filters.equipmentId } : {}),
        ...(filters?.from || filters?.to
          ? { startedAt: { ...(filters?.from ? { gte: filters.from } : {}), ...(filters?.to ? { lte: filters.to } : {}) } }
          : {}),
      },
      include: {
        equipment: { select: { id: true, code: true, name: true } },
        reason: { select: { id: true, code: true, name: true } },
        repairRequest: { select: { id: true, requestNo: true, title: true } },
      },
      orderBy: { startedAt: "desc" },
    })) as any
  } catch (error) {
    if (isMissingDbObjectError(error)) return []
    throw error
  }
}

export async function createEquipmentDowntime(data: {
  equipmentId: string
  reasonId: string
  eventType?: EquipmentEventType
  kind?: EquipmentDowntimeKind
  startedAt: Date
  endedAt?: Date | null
  repairRequestId?: string | null
  note?: string | null
}) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "CREATE")
  const actor = await getCurrentUser()
  if (!actor) throw new Error("UNAUTHORIZED")
  const tenantId = actor.tenantId
  const userId = await getCurrentUserId()
  const eventType = data.eventType ?? "STOP"
  const kind = data.kind ?? (eventType === "MAINTENANCE" ? "PLANNED" : "UNPLANNED")
  const startedAt = new Date(data.startedAt)
  const endedAt = data.endedAt ? new Date(data.endedAt) : null
  assertValidDowntimeEventType(eventType)
  assertValidRange(startedAt, endedAt)

  const [equipment, reason] = await Promise.all([
    prisma.equipment.findFirst({ where: { id: data.equipmentId, tenantId }, select: { id: true, code: true, name: true } }),
    requireDowntimeReason(tenantId, data.reasonId),
  ])
  if (!equipment) throw new Error("설비를 찾을 수 없습니다.")

  let repairRequest: { id: string; requestNo: string } | null = null
  if (data.repairRequestId) {
    repairRequest = await prisma.equipmentRepairRequest.findFirst({
      where: { id: data.repairRequestId, tenantId, equipmentId: data.equipmentId },
      select: { id: true, requestNo: true },
    })
    if (!repairRequest) throw new Error("같은 설비의 수리요청을 찾을 수 없습니다.")
  }

  const siteId = await getDefaultSiteId(tenantId, userId)
  await assertNoDowntimeOverlap({ tenantId, equipmentId: data.equipmentId, startedAt, endedAt })

  await prisma.$transaction(async (tx) => {
    const event = await tx.equipmentEvent.create({
      data: {
        equipmentId: data.equipmentId,
        eventType,
        message: reason.name,
        startedAt,
        endedAt,
        duration: endedAt ? secondsBetween(startedAt, endedAt) : null,
      },
    })
    const created = await tx.equipmentDowntime.create({
      data: {
        tenantId,
        siteId,
        equipmentId: data.equipmentId,
        reasonId: data.reasonId,
        eventType,
        kind,
        startedAt,
        endedAt,
        note: data.note ?? null,
        equipmentEventId: event.id,
        repairRequestId: data.repairRequestId ?? null,
        createdById: userId,
      },
    })
    if (!endedAt) {
      await tx.equipment.update({
        where: { id: data.equipmentId },
        data: { status: eventType === "MAINTENANCE" ? "MAINTENANCE" : "INACTIVE" },
      })
    }
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "EquipmentDowntime",
      entityId: created.id,
      action: "CREATE",
      afterData: { equipment, reason, repairRequest, eventType, kind, startedAt, endedAt, note: data.note ?? null },
      menuName: "설비 비가동",
    })
  })
  revalidatePath(EQUIPMENT_REPAIR_PATH)
  revalidatePath(EQUIPMENT_STATISTICS_PATH)
  revalidatePath(DOWNTIME_REASON_PATH)
}

export async function endEquipmentDowntime(id: string, endedAtInput?: Date | null) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "UPDATE")
  const actor = await getCurrentUser()
  if (!actor) throw new Error("UNAUTHORIZED")
  const tenantId = actor.tenantId
  const endedAt = endedAtInput ? new Date(endedAtInput) : new Date()

  const current = await prisma.equipmentDowntime.findFirst({
    where: { id, tenantId },
    include: { equipment: { select: { id: true, code: true, name: true } }, reason: { select: { id: true, code: true, name: true } } },
  })
  if (!current) throw new Error("비가동 이력을 찾을 수 없습니다.")
  if (current.endedAt) throw new Error("이미 종료된 비가동 이력입니다.")
  assertValidRange(current.startedAt, endedAt)

  await prisma.$transaction(async (tx) => {
    const updated = await tx.equipmentDowntime.update({ where: { id }, data: { endedAt } })
    if (current.equipmentEventId) {
      await tx.equipmentEvent.update({
        where: { id: current.equipmentEventId },
        data: { endedAt, duration: secondsBetween(current.startedAt, endedAt) },
      })
    }
    const activeSibling = await tx.equipmentDowntime.count({
      where: { tenantId, equipmentId: current.equipmentId, id: { not: id }, endedAt: null },
    })
    if (activeSibling === 0) {
      await tx.equipment.update({ where: { id: current.equipmentId }, data: { status: "ACTIVE" } })
    }
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "EquipmentDowntime",
      entityId: id,
      action: "UPDATE",
      beforeData: { endedAt: current.endedAt },
      afterData: { endedAt: updated.endedAt, durationSeconds: secondsBetween(current.startedAt, endedAt) },
      menuName: "설비 비가동",
    })
  })
  revalidatePath(EQUIPMENT_REPAIR_PATH)
  revalidatePath(EQUIPMENT_STATISTICS_PATH)
}

// ─── Preventive maintenance ──────────────────────────────────────────────────

function addMaintenanceCycle(base: Date, cycleValue: number, cycleUnit: PreventiveMaintenanceCycleUnit): Date {
  const next = new Date(base)
  if (cycleUnit === "DAY") next.setDate(next.getDate() + cycleValue)
  else if (cycleUnit === "WEEK") next.setDate(next.getDate() + cycleValue * 7)
  else next.setMonth(next.getMonth() + cycleValue)
  return next
}

function normalizeDateInput(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error("일시 값이 올바르지 않습니다.")
  return date
}

export async function getMaintenancePlans(): Promise<MaintenancePlanRow[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  try {
    return (await prisma.equipmentMaintenancePlan.findMany({
      where: { tenantId },
      include: {
        equipment: { select: { id: true, code: true, name: true } },
        histories: {
          orderBy: { completedAt: "desc" },
          take: 5,
          select: { id: true, scheduledAt: true, completedAt: true, result: true, note: true, performer: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ isActive: "desc" }, { nextDueAt: "asc" }],
    })) as any
  } catch (error) {
    if (isMissingDbObjectError(error)) return []
    throw error
  }
}

export async function createMaintenancePlan(data: {
  equipmentId: string
  title: string
  description?: string | null
  cycleValue: number
  cycleUnit: PreventiveMaintenanceCycleUnit
  startDate: Date | string
  nextDueAt?: Date | string | null
}) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "CREATE")
  const actor = await getCurrentUser()
  if (!actor) throw new Error("UNAUTHORIZED")
  const tenantId = actor.tenantId
  const userId = await getCurrentUserId()
  if (!Number.isInteger(data.cycleValue) || data.cycleValue <= 0) throw new Error("점검 주기는 1 이상이어야 합니다.")
  const startDate = normalizeDateInput(data.startDate)
  const nextDueAt = data.nextDueAt ? normalizeDateInput(data.nextDueAt) : startDate
  const equipment = await prisma.equipment.findFirst({ where: { id: data.equipmentId, tenantId }, select: { id: true, code: true, name: true } })
  if (!equipment) throw new Error("설비를 찾을 수 없습니다.")
  const siteId = await getDefaultSiteId(tenantId, userId)

  await prisma.$transaction(async (tx) => {
    const created = await tx.equipmentMaintenancePlan.create({
      data: { tenantId, siteId, equipmentId: data.equipmentId, title: data.title, description: data.description ?? null, cycleValue: data.cycleValue, cycleUnit: data.cycleUnit, startDate, nextDueAt, createdById: userId },
    })
    await recordAuditLog(tx, { tenantId, actor, entityType: "EquipmentMaintenancePlan", entityId: created.id, action: "CREATE", afterData: { ...data, startDate, nextDueAt, equipment }, menuName: "예방점검" })
  })
  revalidatePath(EQUIPMENT_MAINTENANCE_PATH)
}

export async function updateMaintenancePlan(
  id: string,
  data: Partial<{ title: string; description: string | null; cycleValue: number; cycleUnit: PreventiveMaintenanceCycleUnit; nextDueAt: Date | string; isActive: boolean }>,
) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "UPDATE")
  const actor = await getCurrentUser()
  if (!actor) throw new Error("UNAUTHORIZED")
  const tenantId = actor.tenantId
  if (data.cycleValue !== undefined && (!Number.isInteger(data.cycleValue) || data.cycleValue <= 0)) throw new Error("점검 주기는 1 이상이어야 합니다.")
  const before = await prisma.equipmentMaintenancePlan.findFirst({ where: { id, tenantId } })
  if (!before) throw new Error("예방점검 계획을 찾을 수 없습니다.")
  const updateData = { ...data, ...(data.nextDueAt ? { nextDueAt: normalizeDateInput(data.nextDueAt) } : {}) }
  await prisma.$transaction(async (tx) => {
    await tx.equipmentMaintenancePlan.update({ where: { id }, data: updateData })
    await recordAuditLog(tx, { tenantId, actor, entityType: "EquipmentMaintenancePlan", entityId: id, action: "UPDATE", beforeData: before, afterData: updateData, menuName: "예방점검" })
  })
  revalidatePath(EQUIPMENT_MAINTENANCE_PATH)
}

export async function deleteMaintenancePlan(id: string) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "DELETE")
  const actor = await getCurrentUser()
  if (!actor) throw new Error("UNAUTHORIZED")
  const tenantId = actor.tenantId
  const before = await prisma.equipmentMaintenancePlan.findFirst({ where: { id, tenantId }, include: { _count: { select: { histories: true } } } })
  if (!before) throw new Error("예방점검 계획을 찾을 수 없습니다.")
  if (before._count.histories > 0) throw new Error("실시 이력이 있는 예방점검 계획은 삭제할 수 없습니다. 비활성화로 관리해 주세요.")
  await prisma.$transaction(async (tx) => {
    await tx.equipmentMaintenancePlan.delete({ where: { id } })
    await recordAuditLog(tx, { tenantId, actor, entityType: "EquipmentMaintenancePlan", entityId: id, action: "DELETE", beforeData: before, menuName: "예방점검" })
  })
  revalidatePath(EQUIPMENT_MAINTENANCE_PATH)
}

export async function completeMaintenancePlan(id: string, data?: { completedAt?: Date | string; result?: CheckResult; note?: string | null }) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "UPDATE")
  const actor = await getCurrentUser()
  if (!actor) throw new Error("UNAUTHORIZED")
  const tenantId = actor.tenantId
  const userId = await getCurrentUserId()
  const completedAt = data?.completedAt ? normalizeDateInput(data.completedAt) : new Date()
  const plan = await prisma.equipmentMaintenancePlan.findFirst({ where: { id, tenantId }, include: { equipment: { select: { id: true, code: true, name: true } } } })
  if (!plan) throw new Error("예방점검 계획을 찾을 수 없습니다.")
  if (!plan.isActive) throw new Error("비활성 예방점검 계획은 완료 처리할 수 없습니다.")
  if (completedAt < plan.nextDueAt) throw new Error("예정일 이전에는 해당 회차를 완료 처리할 수 없습니다.")

  const scheduledAt = plan.nextDueAt
  const nextDueAt = addMaintenanceCycle(completedAt, plan.cycleValue, plan.cycleUnit)
  await prisma.$transaction(async (tx) => {
    const alreadyCompleted = await tx.equipmentMaintenanceHistory.findUnique({ where: { planId_scheduledAt: { planId: id, scheduledAt } }, select: { id: true } })
    if (alreadyCompleted) throw new Error("이미 완료된 예방점검 회차입니다.")
    const history = await tx.equipmentMaintenanceHistory.create({
      data: { tenantId, siteId: plan.siteId, equipmentId: plan.equipmentId, planId: id, scheduledAt, completedAt, result: data?.result ?? "PASS", note: data?.note ?? null, performedBy: userId },
    })
    await tx.equipmentMaintenancePlan.update({ where: { id }, data: { lastCompletedAt: completedAt, nextDueAt } })
    await recordAuditLog(tx, { tenantId, actor, entityType: "EquipmentMaintenanceHistory", entityId: history.id, action: "CREATE", afterData: { planId: id, equipment: plan.equipment, scheduledAt, completedAt, nextDueAt, result: data?.result ?? "PASS" }, menuName: "예방점검" })
    await recordAuditLog(tx, { tenantId, actor, entityType: "EquipmentMaintenancePlan", entityId: id, action: "UPDATE", beforeData: { nextDueAt: plan.nextDueAt, lastCompletedAt: plan.lastCompletedAt }, afterData: { nextDueAt, lastCompletedAt: completedAt }, menuName: "예방점검" })
  })
  revalidatePath(EQUIPMENT_MAINTENANCE_PATH)
}
