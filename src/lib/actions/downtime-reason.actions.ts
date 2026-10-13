"use server"

import { getTenantId, requireRole } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { revalidatePath } from "next/cache"
import { checkDowntimeReasonReferencesForBulk, requireBulkDeletePermission } from "./reference-check.server"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

const GROUP_CODE = "DOWNTIME_REASON"
const REVALIDATE  = "/app/mes/master/downtime-reasons"

export type DowntimeReason = {
  id:           string
  code:         string
  name:         string
  description:  string | null
  displayOrder: number
  isActive:     boolean
  createdAt:    Date
  updatedAt:    Date
}

// CodeGroup이 없으면 upsert로 생성 후 groupId 반환
async function ensureGroup(tenantId: string): Promise<string> {
  const group = await prisma.codeGroup.upsert({
    where:  { tenantId_groupCode: { tenantId, groupCode: GROUP_CODE } },
    create: {
      tenantId,
      groupCode:   GROUP_CODE,
      groupName:   "비가동사유",
      description: "설비 비가동 발생 시 사용할 사유 기준정보",
      isSystem:    true,
      isActive:    true,
    },
    update: {},
  })
  return group.id
}

export async function getDowntimeReasons(): Promise<DowntimeReason[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const group = await prisma.codeGroup.findUnique({
    where:   { tenantId_groupCode: { tenantId, groupCode: GROUP_CODE } },
    include: { codes: { orderBy: { displayOrder: "asc" } } },
  })
  return (group?.codes ?? []).map((c) => ({
    id:           c.id,
    code:         c.code,
    name:         c.name,
    description:  c.description,
    displayOrder: c.displayOrder,
    isActive:     c.isActive,
    createdAt:    c.createdAt,
    updatedAt:    c.updatedAt,
  }))
}

export type DowntimeReasonInput = {
  code:          string
  name:          string
  description?:  string | null
  displayOrder?: number
  isActive?:     boolean
}

export async function createDowntimeReason(data: DowntimeReasonInput) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const groupId  = await ensureGroup(tenantId)

  const dup = await prisma.commonCode.findFirst({ where: { groupId, code: data.code } })
  if (dup) throw new Error("DUPLICATE_CODE")

  const created = await prisma.commonCode.create({
    data: {
      groupId,
      code:         data.code,
      name:         data.name,
      description:  data.description ?? null,
      displayOrder: data.displayOrder ?? 0,
      isActive:     data.isActive ?? true,
    },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "CommonCode",
      entityId: created.id,
      action: "CREATE",
      afterData: { code: created.code, name: created.name, group: GROUP_CODE },
      menuName: "비가동 사유 관리",
    },
  }).catch(() => {})
  revalidatePath(REVALIDATE)
}

export async function updateDowntimeReason(
  id:   string,
  data: Partial<Omit<DowntimeReasonInput, "code">>,
) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const groupId  = await ensureGroup(tenantId)

  const owned = await prisma.commonCode.findFirst({ where: { id, groupId } })
  if (!owned) throw new Error("NOT_FOUND")

  await prisma.commonCode.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "CommonCode",
      entityId: id,
      action: "UPDATE",
      beforeData: { code: owned.code, name: owned.name, isActive: owned.isActive },
      afterData: { code: owned.code, name: data.name ?? owned.name, isActive: data.isActive ?? owned.isActive },
      menuName: "비가동 사유 관리",
    },
  }).catch(() => {})
  revalidatePath(REVALIDATE)
}

export async function toggleDowntimeReasonActive(id: string, isActive: boolean) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const groupId  = await ensureGroup(tenantId)

  const owned = await prisma.commonCode.findFirst({ where: { id, groupId } })
  if (!owned) throw new Error("NOT_FOUND")

  await prisma.commonCode.update({ where: { id }, data: { isActive } })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "CommonCode",
      entityId: id,
      action: "UPDATE",
      beforeData: { code: owned.code, name: owned.name, isActive: owned.isActive },
      afterData: { code: owned.code, name: owned.name, isActive },
      menuName: "비가동 사유 관리",
    },
  }).catch(() => {})
  revalidatePath(REVALIDATE)
}

export type DowntimeReasonDeleteCandidate = {
  id: string
  code: string
  name: string
  canDelete: boolean
  reasons: string[]
}

/** 선택한 비가동사유들의 삭제 가능 여부를 사전 확인한다(실제 삭제는 수행하지 않음). */
export async function bulkCheckDowntimeReasonsForDelete(ids: string[]): Promise<DowntimeReasonDeleteCandidate[]> {
  await assertDaewonFeatureScope()
  await requireBulkDeletePermission()
  const tenantId = await getTenantId()
  if (ids.length === 0) return []
  const groupId = await ensureGroup(tenantId)

  const reasons = await prisma.commonCode.findMany({
    where: { id: { in: ids }, groupId },
    select: { id: true, code: true, name: true },
  })

  const results = await Promise.all(
    reasons.map(async (r) => {
      const { canDelete, reasons: blockReasons } = await checkDowntimeReasonReferencesForBulk(r.id)
      return { id: r.id, code: r.code, name: r.name, canDelete, reasons: blockReasons }
    }),
  )

  const byId = new Map(results.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter((r): r is DowntimeReasonDeleteCandidate => Boolean(r))
}

export type BulkDeleteDowntimeReasonsResult = {
  deleted: { id: string; code: string; name: string }[]
  blocked: { id: string; code: string; name: string; reasons: string[] }[]
  failed: { id: string; code: string; name: string; error: string }[]
}

/**
 * 선택한 비가동사유 중 삭제 가능한 항목만 삭제한다.
 * race condition 방지를 위해 삭제 직전 항목별로 참조 여부를 다시 확인한다.
 */
export async function bulkDeleteDowntimeReasons(ids: string[]): Promise<BulkDeleteDowntimeReasonsResult> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT_REPAIR", "DELETE")
  const actor = await requireBulkDeletePermission()
  const tenantId = await getTenantId()
  if (ids.length === 0) return { deleted: [], blocked: [], failed: [] }
  const groupId = await ensureGroup(tenantId)

  const reasons = await prisma.commonCode.findMany({ where: { id: { in: ids }, groupId } })

  const deleted: BulkDeleteDowntimeReasonsResult["deleted"] = []
  const blocked: BulkDeleteDowntimeReasonsResult["blocked"] = []
  const failed: BulkDeleteDowntimeReasonsResult["failed"] = []

  for (const r of reasons) {
    const { canDelete, reasons: blockReasons } = await checkDowntimeReasonReferencesForBulk(r.id)
    if (!canDelete) {
      blocked.push({ id: r.id, code: r.code, name: r.name, reasons: blockReasons })
      continue
    }
    try {
      await prisma.$transaction(async (tx) => {
        const result = await tx.commonCode.deleteMany({ where: { id: r.id, groupId } })
        if (result.count === 0) throw new Error("NOT_FOUND")
        await tx.auditLog.create({
          data: {
            tenantId,
            actorId: actor.id,
            actorLabel: actor.name,
            entityType: "CommonCode",
            entityId: r.id,
            action: "DELETE",
            beforeData: { code: r.code, name: r.name, isActive: r.isActive },
            menuName: "비가동 사유 관리",
          },
        })
      })
      deleted.push({ id: r.id, code: r.code, name: r.name })
    } catch {
      failed.push({ id: r.id, code: r.code, name: r.name, error: "DELETE_FAILED" })
    }
  }

  revalidatePath(REVALIDATE)
  return { deleted, blocked, failed }
}
