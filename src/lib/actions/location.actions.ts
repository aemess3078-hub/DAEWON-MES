"use server"

import { getTenantId, requireRole } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { revalidatePath } from "next/cache"
import { checkWarehouseReferencesForBulk, requireBulkDeletePermission } from "./reference-check.server"
import { requireResourcePermission } from "@/lib/auth/role-permissions"

export type LocationWithSite = {
  id: string
  tenantId: string
  siteId: string
  code: string
  name: string
  zone: string | null
  site: { id: string; code: string; name: string }
}

export async function getLocations(): Promise<LocationWithSite[]> {
  const tenantId = await getTenantId()
  return prisma.warehouse.findMany({
    where: { tenantId },
    include: { site: { select: { id: true, code: true, name: true } } },
    orderBy: [{ siteId: "asc" }, { code: "asc" }],
  }) as any
}

export async function getSitesForLocation() {
  const tenantId = await getTenantId()
  return prisma.site.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })
}

export type CreateLocationInput = {
  siteId: string
  code: string
  name: string
  zone?: string
}

export async function createLocation(data: CreateLocationInput) {
  await requireResourcePermission("ITEM", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const { zone, ...rest } = data
  const created = await prisma.warehouse.create({
    data: { ...rest, zone: zone || null, tenantId },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Warehouse",
      entityId: created.id,
      action: "CREATE",
      afterData: { code: created.code, name: created.name, zone: created.zone, siteId: created.siteId },
      menuName: "창고/로케이션 관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/locations")
}

export async function updateLocation(id: string, data: Omit<CreateLocationInput, "siteId">) {
  await requireResourcePermission("ITEM", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.warehouse.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("NOT_FOUND")

  const { zone, ...rest } = data
  await prisma.warehouse.update({
    where: { id },
    data: { ...rest, zone: zone || null },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Warehouse",
      entityId: id,
      action: "UPDATE",
      beforeData: { code: owned.code, name: owned.name, zone: owned.zone },
      afterData: { code: data.code, name: data.name, zone: zone || null },
      menuName: "창고/로케이션 관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/locations")
}

export async function deleteLocation(id: string) {
  await requireResourcePermission("ITEM", "DELETE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.warehouse.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("NOT_FOUND")

  const reference = await checkWarehouseReferencesForBulk(id, tenantId)
  if (!reference.canDelete) {
    throw new Error(`사용 이력이 있어 삭제할 수 없습니다: ${reference.reasons.join(", ")}`)
  }
  await prisma.warehouse.deleteMany({ where: { id, tenantId } })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Warehouse",
      entityId: id,
      action: "DELETE",
      beforeData: { code: owned.code, name: owned.name, zone: owned.zone, siteId: owned.siteId },
      menuName: "창고/로케이션 관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/locations")
}

export type LocationDeleteCandidate = {
  id: string
  code: string
  name: string
  canDelete: boolean
  reasons: string[]
}

/** 선택한 로케이션(창고)들의 삭제 가능 여부를 사전 확인한다(실제 삭제는 수행하지 않음). */
export async function bulkCheckLocationsForDelete(ids: string[]): Promise<LocationDeleteCandidate[]> {
  await requireBulkDeletePermission()
  const tenantId = await getTenantId()
  if (ids.length === 0) return []

  const warehouses = await prisma.warehouse.findMany({
    where: { id: { in: ids }, tenantId },
    select: { id: true, code: true, name: true },
  })

  const results = await Promise.all(
    warehouses.map(async (w) => {
      const { canDelete, reasons } = await checkWarehouseReferencesForBulk(w.id, tenantId)
      return { id: w.id, code: w.code, name: w.name, canDelete, reasons }
    }),
  )

  const byId = new Map(results.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter((r): r is LocationDeleteCandidate => Boolean(r))
}

export type BulkDeleteLocationsResult = {
  deleted: { id: string; code: string; name: string }[]
  blocked: { id: string; code: string; name: string; reasons: string[] }[]
  failed: { id: string; code: string; name: string; error: string }[]
}

/**
 * 선택한 로케이션(창고) 중 삭제 가능한 항목만 삭제한다.
 * race condition 방지를 위해 삭제 직전 항목별로 참조 여부를 다시 확인한다.
 */
export async function bulkDeleteLocations(ids: string[]): Promise<BulkDeleteLocationsResult> {
  await requireResourcePermission("ITEM", "DELETE")
  const actor = await requireBulkDeletePermission()
  const tenantId = await getTenantId()
  if (ids.length === 0) return { deleted: [], blocked: [], failed: [] }

  const warehouses = await prisma.warehouse.findMany({ where: { id: { in: ids }, tenantId } })

  const deleted: BulkDeleteLocationsResult["deleted"] = []
  const blocked: BulkDeleteLocationsResult["blocked"] = []
  const failed: BulkDeleteLocationsResult["failed"] = []

  for (const w of warehouses) {
    const { canDelete, reasons } = await checkWarehouseReferencesForBulk(w.id, tenantId)
    if (!canDelete) {
      blocked.push({ id: w.id, code: w.code, name: w.name, reasons })
      continue
    }
    try {
      await prisma.$transaction(async (tx) => {
        const result = await tx.warehouse.deleteMany({ where: { id: w.id, tenantId } })
        if (result.count === 0) throw new Error("NOT_FOUND")
        await tx.auditLog.create({
          data: {
            tenantId,
            actorId: actor.id,
            actorLabel: actor.name,
            entityType: "Warehouse",
            entityId: w.id,
            action: "DELETE",
            beforeData: { code: w.code, name: w.name, zone: w.zone, siteId: w.siteId },
            menuName: "창고/로케이션 관리",
          },
        })
      })
      deleted.push({ id: w.id, code: w.code, name: w.name })
    } catch {
      failed.push({ id: w.id, code: w.code, name: w.name, error: "DELETE_FAILED" })
    }
  }

  revalidatePath("/app/mes/locations")
  return { deleted, blocked, failed }
}
