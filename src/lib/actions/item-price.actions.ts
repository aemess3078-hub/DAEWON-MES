"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId, requireRole } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

// ─── Query Functions ──────────────────────────────────────────────────────────

export async function getItemPrices(tenantId: string) {
  await assertDaewonFeatureScope()
  return prisma.itemPrice.findMany({
    where: { tenantId },
    include: { item: true, partner: true },
    orderBy: { createdAt: "desc" },
  })
}

export async function getAllPartners(tenantId: string) {
  await assertDaewonFeatureScope()
  return prisma.businessPartner.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
  })
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export type CreateItemPriceInput = {
  itemId: string
  partnerId: string
  priceType: string
  unitPrice: number
  currency: string
  effectiveFrom: Date
  effectiveTo?: Date
  note?: string
}

export async function createItemPrice(tenantId: string, data: CreateItemPriceInput) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("ITEM_PRICE", "CREATE")
  const actor = await requireRole("OPERATOR")
  const created = await prisma.itemPrice.create({
    data: { tenantId, ...data },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "ItemPrice",
      entityId: created.id,
      action: "CREATE",
      afterData: { itemId: data.itemId, partnerId: data.partnerId, priceType: data.priceType, unitPrice: data.unitPrice, currency: data.currency },
      menuName: "품목 가격 관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/item-prices")
}

export type UpdateItemPriceInput = {
  unitPrice?: number
  currency?: string
  effectiveFrom?: Date
  effectiveTo?: Date | null
  note?: string
}

export async function updateItemPrice(id: string, data: UpdateItemPriceInput) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("ITEM_PRICE", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.itemPrice.findUnique({ where: { id } })
  await prisma.itemPrice.update({ where: { id }, data })
  if (owned) {
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "ItemPrice",
        entityId: id,
        action: "UPDATE",
        beforeData: { unitPrice: Number(owned.unitPrice), currency: owned.currency },
        afterData: { unitPrice: data.unitPrice, currency: data.currency },
        menuName: "품목 가격 관리",
      },
    }).catch(() => {})
  }
  revalidatePath("/app/mes/item-prices")
}

export async function deleteItemPrice(id: string) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("ITEM_PRICE", "DELETE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.itemPrice.findUnique({ where: { id } })
  await prisma.itemPrice.delete({ where: { id } })
  if (owned) {
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "ItemPrice",
        entityId: id,
        action: "DELETE",
        beforeData: { itemId: owned.itemId, partnerId: owned.partnerId, priceType: owned.priceType, unitPrice: Number(owned.unitPrice), currency: owned.currency },
        menuName: "품목 가격 관리",
      },
    }).catch(() => {})
  }
  revalidatePath("/app/mes/item-prices")
}
