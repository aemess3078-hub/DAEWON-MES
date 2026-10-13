"use server"

import { revalidatePath } from "next/cache"
import { getTenantId, requireRole } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { Prisma, ItemType } from "@prisma/client"
import { checkItemCategoryReferencesForBulk, requireBulkDeletePermission } from "./reference-check.server"
import { requireResourcePermission } from "@/lib/auth/role-permissions"

export type ItemCategoryWithCounts = Prisma.ItemCategoryGetPayload<{
  include: { _count: { select: { items: true; itemGroups: true } } }
}>

export async function getItemCategoriesForManagement(): Promise<ItemCategoryWithCounts[]> {
  const tenantId = await getTenantId()
  return prisma.itemCategory.findMany({
    where: { tenantId },
    include: {
      _count: { select: { items: true, itemGroups: true } },
    },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  })
}

export type ItemCategoryFormData = {
  code:         string
  name:         string
  itemType?:    string | null
  displayOrder?: number
}

export async function createItemCategory(data: ItemCategoryFormData) {
  await requireResourcePermission("ITEM", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const existing = await prisma.itemCategory.findFirst({
    where: { tenantId, code: data.code },
  })
  if (existing) throw new Error("DUPLICATE_CODE")

  const created = await prisma.itemCategory.create({
    data: {
      tenantId,
      code:         data.code,
      name:         data.name,
      itemType:     (data.itemType as ItemType) ?? null,
      displayOrder: data.displayOrder ?? 0,
    },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "ItemCategory",
      entityId: created.id,
      action: "CREATE",
      afterData: { code: created.code, name: created.name, itemType: created.itemType },
      menuName: "품목 카테고리 관리",
    },
  }).catch(() => {})
  return created
}

export async function updateItemCategory(id: string, data: ItemCategoryFormData) {
  await requireResourcePermission("ITEM", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const owned = await prisma.itemCategory.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("NOT_FOUND")

  const duplicate = await prisma.itemCategory.findFirst({
    where: { tenantId, code: data.code, NOT: { id } },
  })
  if (duplicate) throw new Error("DUPLICATE_CODE")

  const updated = await prisma.itemCategory.update({
    where: { id },
    data: {
      code:         data.code,
      name:         data.name,
      itemType:     (data.itemType as ItemType) ?? null,
      displayOrder: data.displayOrder ?? 0,
    },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "ItemCategory",
      entityId: id,
      action: "UPDATE",
      beforeData: { code: owned.code, name: owned.name, itemType: owned.itemType },
      afterData: { code: data.code, name: data.name, itemType: data.itemType ?? null },
      menuName: "품목 카테고리 관리",
    },
  }).catch(() => {})
  return updated
}

export async function deleteItemCategory(id: string) {
  await requireResourcePermission("ITEM", "DELETE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const owned = await prisma.itemCategory.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("NOT_FOUND")

  const [itemCount, groupCount] = await Promise.all([
    prisma.item.count({ where: { categoryId: id } }),
    prisma.itemGroup.count({ where: { categoryId: id } }),
  ])
  if (itemCount > 0) throw new Error("HAS_ITEMS")
  if (groupCount > 0) throw new Error("HAS_GROUPS")

  const result = await prisma.itemCategory.delete({ where: { id } })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "ItemCategory",
      entityId: id,
      action: "DELETE",
      beforeData: { code: owned.code, name: owned.name, itemType: owned.itemType },
      menuName: "품목 카테고리 관리",
    },
  }).catch(() => {})
  return result
}

export type ItemCategoryDeleteCandidate = {
  id: string
  code: string
  name: string
  canDelete: boolean
  reasons: string[]
}

/** 선택한 품목분류들의 삭제 가능 여부를 사전 확인한다(실제 삭제는 수행하지 않음). */
export async function bulkCheckItemCategoriesForDelete(ids: string[]): Promise<ItemCategoryDeleteCandidate[]> {
  await requireBulkDeletePermission()
  const tenantId = await getTenantId()
  if (ids.length === 0) return []

  const categories = await prisma.itemCategory.findMany({
    where: { id: { in: ids }, tenantId },
    select: { id: true, code: true, name: true },
  })

  const results = await Promise.all(
    categories.map(async (c) => {
      const { canDelete, reasons } = await checkItemCategoryReferencesForBulk(c.id, tenantId)
      return { id: c.id, code: c.code, name: c.name, canDelete, reasons }
    }),
  )

  const byId = new Map(results.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter((r): r is ItemCategoryDeleteCandidate => Boolean(r))
}

export type BulkDeleteItemCategoriesResult = {
  deleted: { id: string; code: string; name: string }[]
  blocked: { id: string; code: string; name: string; reasons: string[] }[]
  failed: { id: string; code: string; name: string; error: string }[]
}

/**
 * 선택한 품목분류 중 삭제 가능한 항목만 삭제한다.
 * race condition 방지를 위해 삭제 직전 항목별로 참조 여부를 다시 확인한다.
 */
export async function bulkDeleteItemCategories(ids: string[]): Promise<BulkDeleteItemCategoriesResult> {
  await requireResourcePermission("ITEM", "DELETE")
  const actor = await requireBulkDeletePermission()
  const tenantId = await getTenantId()
  if (ids.length === 0) return { deleted: [], blocked: [], failed: [] }

  const categories = await prisma.itemCategory.findMany({ where: { id: { in: ids }, tenantId } })

  const deleted: BulkDeleteItemCategoriesResult["deleted"] = []
  const blocked: BulkDeleteItemCategoriesResult["blocked"] = []
  const failed: BulkDeleteItemCategoriesResult["failed"] = []

  for (const c of categories) {
    const { canDelete, reasons } = await checkItemCategoryReferencesForBulk(c.id, tenantId)
    if (!canDelete) {
      blocked.push({ id: c.id, code: c.code, name: c.name, reasons })
      continue
    }
    try {
      await prisma.$transaction(async (tx) => {
        const result = await tx.itemCategory.deleteMany({ where: { id: c.id, tenantId } })
        if (result.count === 0) throw new Error("NOT_FOUND")
        await tx.auditLog.create({
          data: {
            tenantId,
            actorId: actor.id,
            actorLabel: actor.name,
            entityType: "ItemCategory",
            entityId: c.id,
            action: "DELETE",
            beforeData: { code: c.code, name: c.name, itemType: c.itemType },
            menuName: "품목 카테고리 관리",
          },
        })
      })
      deleted.push({ id: c.id, code: c.code, name: c.name })
    } catch {
      failed.push({ id: c.id, code: c.code, name: c.name, error: "DELETE_FAILED" })
    }
  }

  revalidatePath("/app/mes/master/item-categories")
  return { deleted, blocked, failed }
}
