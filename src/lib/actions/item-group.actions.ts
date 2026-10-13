"use server"

import { revalidatePath } from "next/cache"
import { getTenantId, requireRole } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { Prisma } from "@prisma/client"
import { checkItemGroupReferencesForBulk, requireBulkDeletePermission } from "./reference-check.server"
import { requireResourcePermission } from "@/lib/auth/role-permissions"

export type ItemGroupWithDetails = Prisma.ItemGroupGetPayload<{
  include: {
    category: true
    _count: { select: { items: true } }
  }
}>

export async function getItemGroupsForManagement(): Promise<ItemGroupWithDetails[]> {
  const tenantId = await getTenantId()
  return prisma.itemGroup.findMany({
    where: { tenantId },
    include: {
      category: true,
      _count: { select: { items: true } },
    },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  })
}

export type ItemGroupFormData = {
  categoryId:   string
  code:         string
  name:         string
  description?: string | null
  displayOrder?: number
  isActive:     boolean
}

export async function createItemGroup(data: ItemGroupFormData) {
  await requireResourcePermission("ITEM", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const [duplicate, ownedCategory] = await Promise.all([
    prisma.itemGroup.findFirst({ where: { tenantId, code: data.code } }),
    prisma.itemCategory.findFirst({ where: { id: data.categoryId, tenantId } }),
  ])
  if (duplicate) throw new Error("DUPLICATE_CODE")
  if (!ownedCategory) throw new Error("INVALID_CATEGORY")

  const created = await prisma.itemGroup.create({
    data: {
      tenantId,
      categoryId:   data.categoryId,
      code:         data.code,
      name:         data.name,
      description:  data.description ?? null,
      displayOrder: data.displayOrder ?? 0,
      isActive:     data.isActive,
    },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "ItemGroup",
      entityId: created.id,
      action: "CREATE",
      afterData: { code: created.code, name: created.name, isActive: created.isActive },
      menuName: "품목 그룹 관리",
    },
  }).catch(() => {})
  return created
}

export async function updateItemGroup(id: string, data: ItemGroupFormData) {
  await requireResourcePermission("ITEM", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const owned = await prisma.itemGroup.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("NOT_FOUND")

  const [duplicate, ownedCategory] = await Promise.all([
    prisma.itemGroup.findFirst({ where: { tenantId, code: data.code, NOT: { id } } }),
    prisma.itemCategory.findFirst({ where: { id: data.categoryId, tenantId } }),
  ])
  if (duplicate) throw new Error("DUPLICATE_CODE")
  if (!ownedCategory) throw new Error("INVALID_CATEGORY")

  const updated = await prisma.itemGroup.update({
    where: { id },
    data: {
      categoryId:   data.categoryId,
      code:         data.code,
      name:         data.name,
      description:  data.description ?? null,
      displayOrder: data.displayOrder ?? 0,
      isActive:     data.isActive,
    },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "ItemGroup",
      entityId: id,
      action: "UPDATE",
      beforeData: { code: owned.code, name: owned.name, isActive: owned.isActive },
      afterData: { code: data.code, name: data.name, isActive: data.isActive },
      menuName: "품목 그룹 관리",
    },
  }).catch(() => {})
  return updated
}

export async function deleteItemGroup(id: string) {
  await requireResourcePermission("ITEM", "DELETE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const owned = await prisma.itemGroup.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("NOT_FOUND")

  const itemCount = await prisma.item.count({ where: { itemGroupId: id } })
  if (itemCount > 0) throw new Error("HAS_ITEMS")

  const result = await prisma.itemGroup.delete({ where: { id } })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "ItemGroup",
      entityId: id,
      action: "DELETE",
      beforeData: { code: owned.code, name: owned.name, isActive: owned.isActive },
      menuName: "품목 그룹 관리",
    },
  }).catch(() => {})
  return result
}

export type ItemGroupDeleteCandidate = {
  id: string
  code: string
  name: string
  canDelete: boolean
  reasons: string[]
}

/** 선택한 품목군들의 삭제 가능 여부를 사전 확인한다(실제 삭제는 수행하지 않음). */
export async function bulkCheckItemGroupsForDelete(ids: string[]): Promise<ItemGroupDeleteCandidate[]> {
  await requireBulkDeletePermission()
  const tenantId = await getTenantId()
  if (ids.length === 0) return []

  const groups = await prisma.itemGroup.findMany({
    where: { id: { in: ids }, tenantId },
    select: { id: true, code: true, name: true },
  })

  const results = await Promise.all(
    groups.map(async (g) => {
      const { canDelete, reasons } = await checkItemGroupReferencesForBulk(g.id, tenantId)
      return { id: g.id, code: g.code, name: g.name, canDelete, reasons }
    }),
  )

  const byId = new Map(results.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter((r): r is ItemGroupDeleteCandidate => Boolean(r))
}

export type BulkDeleteItemGroupsResult = {
  deleted: { id: string; code: string; name: string }[]
  blocked: { id: string; code: string; name: string; reasons: string[] }[]
  failed: { id: string; code: string; name: string; error: string }[]
}

/**
 * 선택한 품목군 중 삭제 가능한 항목만 삭제한다.
 * race condition 방지를 위해 삭제 직전 항목별로 참조 여부를 다시 확인한다.
 */
export async function bulkDeleteItemGroups(ids: string[]): Promise<BulkDeleteItemGroupsResult> {
  await requireResourcePermission("ITEM", "DELETE")
  const actor = await requireBulkDeletePermission()
  const tenantId = await getTenantId()
  if (ids.length === 0) return { deleted: [], blocked: [], failed: [] }

  const groups = await prisma.itemGroup.findMany({ where: { id: { in: ids }, tenantId } })

  const deleted: BulkDeleteItemGroupsResult["deleted"] = []
  const blocked: BulkDeleteItemGroupsResult["blocked"] = []
  const failed: BulkDeleteItemGroupsResult["failed"] = []

  for (const g of groups) {
    const { canDelete, reasons } = await checkItemGroupReferencesForBulk(g.id, tenantId)
    if (!canDelete) {
      blocked.push({ id: g.id, code: g.code, name: g.name, reasons })
      continue
    }
    try {
      await prisma.$transaction(async (tx) => {
        const result = await tx.itemGroup.deleteMany({ where: { id: g.id, tenantId } })
        if (result.count === 0) throw new Error("NOT_FOUND")
        await tx.auditLog.create({
          data: {
            tenantId,
            actorId: actor.id,
            actorLabel: actor.name,
            entityType: "ItemGroup",
            entityId: g.id,
            action: "DELETE",
            beforeData: { code: g.code, name: g.name, isActive: g.isActive },
            menuName: "품목 그룹 관리",
          },
        })
      })
      deleted.push({ id: g.id, code: g.code, name: g.name })
    } catch {
      failed.push({ id: g.id, code: g.code, name: g.name, error: "DELETE_FAILED" })
    }
  }

  revalidatePath("/app/mes/master/item-groups")
  return { deleted, blocked, failed }
}
