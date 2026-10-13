"use server"

import { getTenantId, requireRole } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { SiteType } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"

export type SiteWithLocations = {
  id: string
  tenantId: string
  code: string
  name: string
  type: SiteType
  createdAt: Date
  updatedAt: Date
  warehouses: {
    id: string
    code: string
    name: string
    zone: string | null
  }[]
}

export type SiteRow = {
  id: string
  tenantId: string
  code: string
  name: string
  type: SiteType
  createdAt: Date
  updatedAt: Date
  _count: { warehouses: number }
}

export async function getSites(): Promise<SiteRow[]> {
  const tenantId = await getTenantId()
  return prisma.site.findMany({
    where: { tenantId },
    include: { _count: { select: { warehouses: true } } },
    orderBy: { code: "asc" },
  }) as any
}

export async function getSitesSimple() {
  const tenantId = await getTenantId()
  return prisma.site.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })
}

export async function getSiteWithLocations(siteId: string): Promise<SiteWithLocations | null> {
  const tenantId = await getTenantId()
  return prisma.site.findFirst({
    where: { id: siteId, tenantId },
    include: {
      warehouses: {
        select: { id: true, code: true, name: true, zone: true },
        orderBy: { code: "asc" },
      },
    },
  }) as any
}

export type CreateSiteInput = {
  code: string
  name: string
  type?: SiteType
}

export async function createSite(data: CreateSiteInput) {
  await requireResourcePermission("ITEM", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const site = await prisma.site.create({
    data: {
      code: data.code,
      name: data.name,
      type: data.type ?? SiteType.FACTORY,
      tenantId,
    },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Site",
      entityId: site.id,
      action: "CREATE",
      afterData: { code: site.code, name: site.name, type: site.type },
      menuName: "사업장 관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/sites")
}

export async function updateSite(id: string, data: CreateSiteInput) {
  await requireResourcePermission("ITEM", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.site.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("NOT_FOUND")

  await prisma.site.update({
    where: { id },
    data: { code: data.code, name: data.name, type: data.type ?? SiteType.FACTORY },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Site",
      entityId: id,
      action: "UPDATE",
      beforeData: { code: owned.code, name: owned.name, type: owned.type },
      afterData: { code: data.code, name: data.name, type: data.type ?? SiteType.FACTORY },
      menuName: "사업장 관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/sites")
}

export async function deleteSite(id: string) {
  await requireResourcePermission("ITEM", "DELETE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.site.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("NOT_FOUND")

  const warehouseCount = await prisma.warehouse.count({ where: { siteId: id } })
  if (warehouseCount > 0) {
    throw new Error(`이 사이트에 로케이션이 ${warehouseCount}건 있습니다. 로케이션을 먼저 삭제해주세요.`)
  }
  const userCount = await prisma.tenantUser.count({ where: { siteId: id } })
  if (userCount > 0) {
    throw new Error(`이 사이트에 배정된 사용자가 ${userCount}명 있습니다. 사용자 배정을 먼저 해제해주세요.`)
  }
  await prisma.site.delete({ where: { id } })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Site",
      entityId: id,
      action: "DELETE",
      beforeData: { code: owned.code, name: owned.name, type: owned.type },
      menuName: "사업장 관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/sites")
}
