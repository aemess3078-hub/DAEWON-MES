"use server"

import { revalidatePath } from "next/cache"
import { getTenantId, requireRole, getCurrentUser, type CurrentUser } from "@/lib/auth"
import { isDeveloperUser } from "@/lib/developer"
import { prisma } from "@/lib/db/prisma"
import { Prisma, ItemStatus, UOM, LotNumberingType, ManualLotPolicy } from "@prisma/client"
import { ItemFormValues } from "@/app/app/mes/items/item-form-schema"
import { checkItemReferencesForBulk } from "./reference-check.server"
import { requireResourcePermission } from "@/lib/auth/role-permissions"

/** 선택 일괄삭제 권한: ADMIN 이상, 또는 role 계층과 무관한 개발자 계정(loginId='test'). */
async function requireBulkDeletePermission(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error("UNAUTHORIZED")
  if (isDeveloperUser(user)) return user
  return requireRole("ADMIN", user)
}

export type ItemWithDetails = Prisma.ItemGetPayload<{
  include: {
    category: true
    itemGroup: true
    defaultWarehouse: { select: { id: true; code: true; name: true; siteId: true } }
  }
}>

// backward-compat alias
export type ItemWithCategory = ItemWithDetails

export type WarehouseForItemForm = {
  id: string
  code: string
  name: string
  siteId: string
  siteName: string
}

export async function getItems(): Promise<ItemWithDetails[]> {
  const tenantId = await getTenantId()
  return prisma.item.findMany({
    where: { tenantId },
    include: {
      category: true,
      itemGroup: true,
      defaultWarehouse: { select: { id: true, code: true, name: true, siteId: true } },
    },
    orderBy: { code: "asc" },
  })
}

export async function getWarehousesForItemForm(): Promise<WarehouseForItemForm[]> {
  const tenantId = await getTenantId()
  const warehouses = await prisma.warehouse.findMany({
    where: { tenantId },
    select: {
      id: true,
      code: true,
      name: true,
      siteId: true,
      site: { select: { name: true } },
    },
    orderBy: [{ site: { name: "asc" } }, { name: "asc" }],
  })
  return warehouses.map((w) => ({
    id: w.id,
    code: w.code,
    name: w.name,
    siteId: w.siteId,
    siteName: w.site.name,
  }))
}

async function resolveDefaultWarehouseId(
  tenantId: string,
  defaultWarehouseId: string | null | undefined,
): Promise<string | null> {
  if (!defaultWarehouseId) return null
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: defaultWarehouseId, tenantId },
    select: { id: true },
  })
  if (!warehouse) throw new Error("INVALID_WAREHOUSE")
  return warehouse.id
}

function resolveLotNumberingSettings(data: ItemFormValues): {
  lotNumberingType: LotNumberingType
  lotPrefix: string | null
  manualLotPolicy: ManualLotPolicy
} {
  if (!data.isLotTracked) {
    return {
      lotNumberingType: "DEFAULT",
      lotPrefix: null,
      manualLotPolicy: "ALLOWED",
    }
  }

  const lotNumberingType = (data.lotNumberingType ?? "DEFAULT") as LotNumberingType
  const requestedManualLotPolicy = (data.manualLotPolicy ?? "ALLOWED") as ManualLotPolicy
  const manualLotPolicy = lotNumberingType === "MANUAL" ? "REQUIRED" : requestedManualLotPolicy
  const lotPrefix = data.lotPrefix?.trim().toUpperCase() || null

  if (lotNumberingType === "PREFIX_MONTH_SEQ") {
    if (!lotPrefix) throw new Error("LOT_PREFIX_REQUIRED")
    if (!/^[A-Z0-9]+$/.test(lotPrefix)) throw new Error("INVALID_LOT_PREFIX")
  }

  return {
    lotNumberingType,
    lotPrefix: lotNumberingType === "PREFIX_MONTH_SEQ" ? lotPrefix : null,
    manualLotPolicy,
  }
}

export async function getItemCategories() {
  const tenantId = await getTenantId()
  return prisma.itemCategory.findMany({
    where: { tenantId, itemType: { not: null } },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  })
}

export async function getItemGroupsForForm() {
  const tenantId = await getTenantId()
  return prisma.itemGroup.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, code: true, name: true, categoryId: true },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  })
}

async function resolveCategoryAndValidateGroup(
  tenantId: string,
  categoryId: string,
  itemGroupId: string | null | undefined,
) {
  const category = await prisma.itemCategory.findFirst({
    where: { id: categoryId, tenantId },
  })
  if (!category) throw new Error("INVALID_CATEGORY")
  if (!category.itemType) throw new Error("CATEGORY_NO_TYPE")

  if (itemGroupId) {
    const group = await prisma.itemGroup.findFirst({
      where: { id: itemGroupId, tenantId },
    })
    if (!group) throw new Error("INVALID_GROUP")
    if (group.categoryId !== categoryId) throw new Error("GROUP_CATEGORY_MISMATCH")
  }

  return category.itemType
}

export async function createItem(data: ItemFormValues) {
  await requireResourcePermission("ITEM", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const existing = await prisma.item.findFirst({ where: { tenantId, code: data.code } })
  if (existing) throw new Error("DUPLICATE_CODE")

  const resolvedItemType = await resolveCategoryAndValidateGroup(
    tenantId,
    data.categoryId,
    data.itemGroupId,
  )
  const resolvedDefaultWarehouseId = await resolveDefaultWarehouseId(
    tenantId,
    data.defaultWarehouseId,
  )
  const lotNumberingSettings = resolveLotNumberingSettings(data)

  const item = await prisma.item.create({
    data: {
      tenantId,
      code:            data.code,
      name:            data.name,
      itemType:        resolvedItemType,
      categoryId:      data.categoryId,
      itemGroupId:     data.itemGroupId ?? null,
      uom:             data.uom as UOM,
      spec:            data.spec ?? null,
      isLotTracked:    data.isLotTracked,
      isSerialTracked: data.isSerialTracked,
      ...lotNumberingSettings,
      status:          data.status as ItemStatus,
      defaultWarehouseId: resolvedDefaultWarehouseId,
    },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Item",
      entityId: item.id,
      action: "CREATE",
      afterData: { code: item.code, name: item.name, itemType: item.itemType, status: item.status },
      menuName: "품목정보",
    },
  }).catch(() => {})
  return item
}

export async function updateItem(id: string, data: ItemFormValues) {
  await requireResourcePermission("ITEM", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const owned = await prisma.item.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("NOT_FOUND")

  const duplicate = await prisma.item.findFirst({
    where: { tenantId, code: data.code, NOT: { id } },
  })
  if (duplicate) throw new Error("DUPLICATE_CODE")

  const resolvedItemType = await resolveCategoryAndValidateGroup(
    tenantId,
    data.categoryId,
    data.itemGroupId,
  )
  const resolvedDefaultWarehouseId = await resolveDefaultWarehouseId(
    tenantId,
    data.defaultWarehouseId,
  )
  const lotNumberingSettings = resolveLotNumberingSettings(data)

  const updated = await prisma.item.update({
    where: { id },
    data: {
      code:            data.code,
      name:            data.name,
      itemType:        resolvedItemType,
      categoryId:      data.categoryId,
      itemGroupId:     data.itemGroupId ?? null,
      uom:             data.uom as UOM,
      spec:            data.spec ?? null,
      isLotTracked:    data.isLotTracked,
      isSerialTracked: data.isSerialTracked,
      ...lotNumberingSettings,
      status:          data.status as ItemStatus,
      defaultWarehouseId: resolvedDefaultWarehouseId,
    },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Item",
      entityId: id,
      action: "UPDATE",
      beforeData: { code: owned.code, name: owned.name, status: owned.status },
      afterData: { code: data.code, name: data.name, status: data.status },
      menuName: "품목정보",
    },
  }).catch(() => {})
  return updated
}

export type ItemReferenceCount = {
  bom: number
  bomComponent: number
  routing: number
  workOrder: number
  inventory: number
  salesOrder: number
  wipUnit: number
  txHistory: number
  workStandardMapping: number
}

/** 품목 삭제 전 참조 건수 조회 (dry-run). DB를 수정하지 않는다. */
export async function checkItemReferences(id: string): Promise<ItemReferenceCount> {
  const tenantId = await getTenantId()
  const [bom, bomComponent, routing, workOrder, inventory, salesOrder, wipUnit, txHistory, workStandardMapping] =
    await Promise.all([
      prisma.bOM.count({ where: { itemId: id, tenantId } }),
      prisma.bOMItem.count({ where: { componentItemId: id } }),
      prisma.itemRouting.count({ where: { itemId: id } }),
      prisma.workOrder.count({ where: { itemId: id, tenantId } }),
      prisma.inventoryBalance.count({
        where: { itemId: id, tenantId, OR: [{ qtyOnHand: { gt: 0 } }, { qtyHold: { gt: 0 } }] },
      }),
      prisma.salesOrderItem.count({ where: { itemId: id } }),
      prisma.wipUnit.count({ where: { itemId: id, tenantId } }),
      prisma.inventoryTransaction.count({ where: { itemId: id, tenantId } }),
      prisma.workStandardMapping.count({ where: { itemId: id, tenantId } }),
    ])
  return { bom, bomComponent, routing, workOrder, inventory, salesOrder, wipUnit, txHistory, workStandardMapping }
}

export async function deleteItem(id: string) {
  await requireResourcePermission("ITEM", "DELETE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.item.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("NOT_FOUND")

  // 참조 데이터 존재 시 삭제 차단
  const refs = await checkItemReferences(id)
  const blockers: string[] = []
  if (refs.bom > 0)          blockers.push(`BOM ${refs.bom}건`)
  if (refs.bomComponent > 0) blockers.push(`BOM 자재 ${refs.bomComponent}건`)
  if (refs.routing > 0)      blockers.push(`라우팅 ${refs.routing}건`)
  if (refs.workOrder > 0)    blockers.push(`작업지시 ${refs.workOrder}건`)
  if (refs.inventory > 0)    blockers.push(`재고 잔량 ${refs.inventory}건`)
  if (refs.salesOrder > 0)   blockers.push(`수주 ${refs.salesOrder}건`)
  if (refs.wipUnit > 0)      blockers.push(`WIP 이력 ${refs.wipUnit}건`)
  if (refs.txHistory > 0)    blockers.push(`입출고 이력 ${refs.txHistory}건`)
  if (refs.workStandardMapping > 0) blockers.push(`작업표준서 매핑 ${refs.workStandardMapping}건`)

  if (blockers.length > 0) {
    throw new Error(`ITEM_IN_USE:${blockers.join(", ")}`)
  }

  const result = await prisma.item.deleteMany({ where: { id, tenantId } })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "Item",
      entityId: id,
      action: "DELETE",
      beforeData: { code: owned.code, name: owned.name, status: owned.status },
      menuName: "품목정보",
    },
  }).catch(() => {})
  return result
}

export type ItemDeleteCandidate = {
  id: string
  code: string
  name: string
  canDelete: boolean
  reasons: string[]
}

/** 선택한 품목들의 삭제 가능 여부를 사전 확인한다(실제 삭제는 수행하지 않음). */
export async function bulkCheckItemsForDelete(ids: string[]): Promise<ItemDeleteCandidate[]> {
  await requireBulkDeletePermission()
  const tenantId = await getTenantId()
  if (ids.length === 0) return []

  const items = await prisma.item.findMany({
    where: { id: { in: ids }, tenantId },
    select: { id: true, code: true, name: true },
  })

  const results = await Promise.all(
    items.map(async (item) => {
      const { canDelete, reasons } = await checkItemReferencesForBulk(item.id, tenantId)
      return { id: item.id, code: item.code, name: item.name, canDelete, reasons }
    }),
  )

  const byId = new Map(results.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter((r): r is ItemDeleteCandidate => Boolean(r))
}

export type BulkDeleteItemsResult = {
  deleted: { id: string; code: string; name: string }[]
  blocked: { id: string; code: string; name: string; reasons: string[] }[]
  failed: { id: string; code: string; name: string; error: string }[]
}

/**
 * 선택한 품목 중 삭제 가능한 항목만 삭제한다.
 * race condition 방지를 위해 삭제 직전 품목별로 참조 여부를 다시 확인한다.
 */
export async function bulkDeleteItems(ids: string[]): Promise<BulkDeleteItemsResult> {
  await requireResourcePermission("ITEM", "DELETE")
  const actor = await requireBulkDeletePermission()
  const tenantId = await getTenantId()
  if (ids.length === 0) return { deleted: [], blocked: [], failed: [] }

  const items = await prisma.item.findMany({ where: { id: { in: ids }, tenantId } })

  const deleted: BulkDeleteItemsResult["deleted"] = []
  const blocked: BulkDeleteItemsResult["blocked"] = []
  const failed: BulkDeleteItemsResult["failed"] = []

  for (const item of items) {
    const { canDelete, reasons } = await checkItemReferencesForBulk(item.id, tenantId)
    if (!canDelete) {
      blocked.push({ id: item.id, code: item.code, name: item.name, reasons })
      continue
    }
    try {
      await prisma.$transaction(async (tx) => {
        const result = await tx.item.deleteMany({ where: { id: item.id, tenantId } })
        if (result.count === 0) throw new Error("NOT_FOUND")
        await tx.auditLog.create({
          data: {
            tenantId,
            actorId: actor.id,
            actorLabel: actor.name,
            entityType: "Item",
            entityId: item.id,
            action: "DELETE",
            beforeData: { code: item.code, name: item.name, status: item.status },
            menuName: "품목정보",
          },
        })
      })
      deleted.push({ id: item.id, code: item.code, name: item.name })
    } catch {
      failed.push({ id: item.id, code: item.code, name: item.name, error: "DELETE_FAILED" })
    }
  }

  revalidatePath("/app/mes/items")
  return { deleted, blocked, failed }
}
