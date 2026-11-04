"use server"

import { getTenantId, requireRole } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { WorkCenterKind } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { checkWorkCenterReferencesForBulk } from "./reference-check.server"

export type WorkCenterWithDetails = {
  id: string
  siteId: string
  code: string
  name: string
  kind: WorkCenterKind
  createdAt: Date
  updatedAt: Date
  site: { id: string; code: string; name: string }
  _count: { routingOperations: number }
}

export async function getWorkCentersWithDetails(): Promise<WorkCenterWithDetails[]> {
  const tenantId = await getTenantId()
  return prisma.workCenter.findMany({
    where: { site: { tenantId } },
    include: {
      site: true,
      _count: { select: { routingOperations: true } },
    },
    orderBy: { code: "asc" },
  }) as any
}

export async function getSitesForWorkCenter() {
  const tenantId = await getTenantId()
  return prisma.site.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })
}

export type CreateWorkCenterInput = {
  siteId: string
  code: string
  name: string
  kind: WorkCenterKind
}

export async function createWorkCenter(data: CreateWorkCenterInput) {
  await requireResourcePermission("ROUTING", "CREATE")
  const user = await requireRole("OPERATOR")
  // 작업장은 사업장(Site)에 속하고 Site 가 테넌트를 결정한다 → 클라이언트가 보낸 siteId 가 내 테넌트의 사업장인지 확인한다.
  const site = await prisma.site.findFirst({ where: { id: data.siteId, tenantId: user.tenantId }, select: { id: true } })
  if (!site) throw new Error("NOT_FOUND")
  await prisma.workCenter.create({ data })
  revalidatePath("/app/mes/work-centers")
}

export async function updateWorkCenter(id: string, data: Omit<CreateWorkCenterInput, "siteId">) {
  await requireResourcePermission("ROUTING", "UPDATE")
  await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.workCenter.findFirst({
    where: { id, site: { tenantId } },
  })
  if (!owned) throw new Error("NOT_FOUND")

  await prisma.workCenter.update({ where: { id }, data })
  revalidatePath("/app/mes/work-centers")
}

export async function deleteWorkCenter(id: string) {
  await requireResourcePermission("ROUTING", "DELETE")
  await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.workCenter.findFirst({
    where: { id, site: { tenantId } },
  })
  if (!owned) throw new Error("NOT_FOUND")

  const reference = await checkWorkCenterReferencesForBulk(id, tenantId)
  if (!reference.canDelete) throw new Error(`사용 이력이 있어 삭제할 수 없습니다: ${reference.reasons.join(", ")}`)

  await prisma.workCenter.deleteMany({ where: { id, site: { tenantId } } })
  revalidatePath("/app/mes/work-centers")
}
