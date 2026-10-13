"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId, requireRole } from "@/lib/auth"
import { EquipmentStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { checkMoldReferencesForBulk, requireBulkDeletePermission } from "./reference-check.server"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

const REVALIDATE_PATH = "/app/mes/master/molds"

// 금형/치공구 대상 타입만 (MACHINE/VEHICLE 제외)
const MOLD_TYPES = ["TOOL", "JIG", "FIXTURE"] as const
export type MoldEquipmentType = "TOOL" | "JIG" | "FIXTURE"

// ─── Types ────────────────────────────────────────────────────────────────────

export type MoldRow = {
  id: string
  code: string
  name: string
  equipmentType: MoldEquipmentType
  siteName: string
  workCenterName: string
  status: EquipmentStatus
  updatedAt: string
}

export type MoldSummary = {
  total: number
  active: number
  inactive: number
  maintenance: number
}

export type MoldsData = {
  summary: MoldSummary
  rows: MoldRow[]
}

// ─── 조회 ─────────────────────────────────────────────────────────────────────

export async function getMoldsData(): Promise<MoldsData> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()

  const equipments = await prisma.equipment.findMany({
    where: { tenantId, equipmentType: { in: [...MOLD_TYPES] } },
    include: {
      site: { select: { name: true } },
      workCenter: { select: { name: true } },
    },
    orderBy: [{ site: { name: "asc" } }, { code: "asc" }],
  })

  const rows: MoldRow[] = equipments.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
    equipmentType: e.equipmentType as MoldEquipmentType,
    siteName: e.site.name,
    workCenterName: e.workCenter.name,
    status: e.status,
    updatedAt: e.updatedAt.toISOString(),
  }))

  return {
    summary: {
      total: rows.length,
      active: rows.filter((r) => r.status === "ACTIVE").length,
      inactive: rows.filter((r) => r.status === "INACTIVE").length,
      maintenance: rows.filter((r) => r.status === "MAINTENANCE").length,
    },
    rows,
  }
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

export async function getSitesForMold() {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  return prisma.site.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })
}

export async function getWorkCentersForMold(siteId?: string) {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  return prisma.workCenter.findMany({
    where: { site: { tenantId }, ...(siteId ? { siteId } : {}) },
    select: { id: true, code: true, name: true, siteId: true },
    orderBy: { code: "asc" },
  })
}

// ─── 등록 ─────────────────────────────────────────────────────────────────────

export async function createMold(data: {
  siteId: string
  workCenterId: string
  code: string
  name: string
  equipmentType: MoldEquipmentType
  status?: EquipmentStatus
}) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const existing = await prisma.equipment.findUnique({
    where: { siteId_code: { siteId: data.siteId, code: data.code } },
  })
  if (existing) throw new Error(`코드 '${data.code}'가 이미 존재합니다.`)

  const created = await prisma.equipment.create({
    data: {
      tenantId,
      siteId: data.siteId,
      workCenterId: data.workCenterId,
      code: data.code,
      name: data.name,
      equipmentType: data.equipmentType,
      status: data.status ?? "ACTIVE",
    },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Equipment",
      entityId: created.id,
      action: "CREATE",
      afterData: { code: created.code, name: created.name, equipmentType: created.equipmentType, status: created.status },
      menuName: "금형/치공구 관리",
    },
  }).catch(() => {})
  revalidatePath(REVALIDATE_PATH)
}

// ─── 수정 ─────────────────────────────────────────────────────────────────────

export async function updateMold(
  id: string,
  data: {
    workCenterId?: string
    name?: string
    equipmentType?: MoldEquipmentType
    status?: EquipmentStatus
  }
) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const owned = await prisma.equipment.findFirst({
    where: { id, tenantId, equipmentType: { in: [...MOLD_TYPES] } },
  })
  if (!owned) throw new Error("금형/치공구를 찾을 수 없습니다.")

  await prisma.equipment.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Equipment",
      entityId: id,
      action: "UPDATE",
      beforeData: { code: owned.code, name: owned.name, equipmentType: owned.equipmentType, status: owned.status },
      afterData: { code: owned.code, name: data.name ?? owned.name, equipmentType: data.equipmentType ?? owned.equipmentType, status: data.status ?? owned.status },
      menuName: "금형/치공구 관리",
    },
  }).catch(() => {})
  revalidatePath(REVALIDATE_PATH)
}

// ─── 삭제/비활성화 ─────────────────────────────────────────────────────────────
// 이력이 있으면 hard delete 차단 → 삭제 대신 INACTIVE 상태 변경 권유

export async function deleteMold(id: string) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT", "DELETE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const owned = await prisma.equipment.findFirst({
    where: { id, tenantId, equipmentType: { in: [...MOLD_TYPES] } },
  })
  if (!owned) throw new Error("금형/치공구를 찾을 수 없습니다.")

  const [repairCount, checkCount, opCount] = await Promise.all([
    prisma.equipmentRepairRequest.count({ where: { equipmentId: id } }),
    prisma.equipmentDailyCheck.count({ where: { equipmentId: id } }),
    prisma.workOrderOperation.count({ where: { equipmentId: id } }),
  ])

  const totalRefs = repairCount + checkCount + opCount
  if (totalRefs > 0) {
    throw new Error(
      `연결된 이력이 ${totalRefs}건 있습니다. 삭제 대신 상태를 '보관중'으로 변경해 주세요.`
    )
  }

  await prisma.equipment.delete({ where: { id } })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Equipment",
      entityId: id,
      action: "DELETE",
      beforeData: { code: owned.code, name: owned.name, equipmentType: owned.equipmentType, status: owned.status },
      menuName: "금형/치공구 관리",
    },
  }).catch(() => {})
  revalidatePath(REVALIDATE_PATH)
}

export type MoldDeleteCandidate = {
  id: string
  code: string
  name: string
  canDelete: boolean
  reasons: string[]
}

/** 선택한 금형/치공구들의 삭제 가능 여부를 사전 확인한다(실제 삭제는 수행하지 않음). */
export async function bulkCheckMoldsForDelete(ids: string[]): Promise<MoldDeleteCandidate[]> {
  await assertDaewonFeatureScope()
  await requireBulkDeletePermission()
  const tenantId = await getTenantId()
  if (ids.length === 0) return []

  const molds = await prisma.equipment.findMany({
    where: { id: { in: ids }, tenantId, equipmentType: { in: [...MOLD_TYPES] } },
    select: { id: true, code: true, name: true },
  })

  const results = await Promise.all(
    molds.map(async (m) => {
      const { canDelete, reasons } = await checkMoldReferencesForBulk(m.id, tenantId)
      return { id: m.id, code: m.code, name: m.name, canDelete, reasons }
    }),
  )

  const byId = new Map(results.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter((r): r is MoldDeleteCandidate => Boolean(r))
}

export type BulkDeleteMoldsResult = {
  deleted: { id: string; code: string; name: string }[]
  blocked: { id: string; code: string; name: string; reasons: string[] }[]
  failed: { id: string; code: string; name: string; error: string }[]
}

/**
 * 선택한 금형/치공구 중 삭제 가능한 항목만 삭제한다.
 * race condition 방지를 위해 삭제 직전 항목별로 참조 여부를 다시 확인한다.
 */
export async function bulkDeleteMolds(ids: string[]): Promise<BulkDeleteMoldsResult> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("EQUIPMENT", "DELETE")
  const actor = await requireBulkDeletePermission()
  const tenantId = await getTenantId()
  if (ids.length === 0) return { deleted: [], blocked: [], failed: [] }

  const molds = await prisma.equipment.findMany({
    where: { id: { in: ids }, tenantId, equipmentType: { in: [...MOLD_TYPES] } },
  })

  const deleted: BulkDeleteMoldsResult["deleted"] = []
  const blocked: BulkDeleteMoldsResult["blocked"] = []
  const failed: BulkDeleteMoldsResult["failed"] = []

  for (const m of molds) {
    const { canDelete, reasons } = await checkMoldReferencesForBulk(m.id, tenantId)
    if (!canDelete) {
      blocked.push({ id: m.id, code: m.code, name: m.name, reasons })
      continue
    }
    try {
      await prisma.$transaction(async (tx) => {
        const result = await tx.equipment.deleteMany({ where: { id: m.id, tenantId } })
        if (result.count === 0) throw new Error("NOT_FOUND")
        await tx.auditLog.create({
          data: {
            tenantId,
            actorId: actor.id,
            actorLabel: actor.name,
            entityType: "Equipment",
            entityId: m.id,
            action: "DELETE",
            beforeData: { code: m.code, name: m.name, equipmentType: m.equipmentType, status: m.status },
            menuName: "금형/치공구 관리",
          },
        })
      })
      deleted.push({ id: m.id, code: m.code, name: m.name })
    } catch {
      failed.push({ id: m.id, code: m.code, name: m.name, error: "DELETE_FAILED" })
    }
  }

  revalidatePath(REVALIDATE_PATH)
  return { deleted, blocked, failed }
}
