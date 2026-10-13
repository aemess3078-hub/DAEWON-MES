"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId, requireRole } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"
import {
  createItemPriceCore,
  deleteItemPriceCore,
  listItemPricesCore,
  listPartnersForPricesCore,
  updateItemPriceCore,
  type ItemPriceActor,
} from "@/lib/services/item-price.service"

// tenantId 는 인증 세션에서만 결정한다. 클라이언트가 보낸 tenantId 는 받지 않는다(서비스 코어 참고).

async function authorizeTenant(): Promise<string> {
  await assertDaewonFeatureScope()
  return getTenantId()
}

async function authorizeMutation(action: "CREATE" | "UPDATE" | "DELETE"): Promise<ItemPriceActor> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("ITEM_PRICE", action)
  const actor = await requireRole("OPERATOR")
  return { id: actor.id, name: actor.name, tenantId: actor.tenantId }
}

// ─── Query Functions ──────────────────────────────────────────────────────────

export async function getItemPrices() {
  return listItemPricesCore({ authorizeTenant, db: prisma })
}

export async function getAllPartners() {
  return listPartnersForPricesCore({ authorizeTenant, db: prisma })
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

export async function createItemPrice(data: CreateItemPriceInput) {
  await createItemPriceCore({ authorize: () => authorizeMutation("CREATE"), db: prisma }, data)
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
  await updateItemPriceCore({ authorize: () => authorizeMutation("UPDATE"), db: prisma }, id, data)
  revalidatePath("/app/mes/item-prices")
}

export async function deleteItemPrice(id: string) {
  await deleteItemPriceCore({ authorize: () => authorizeMutation("DELETE"), db: prisma }, id)
  revalidatePath("/app/mes/item-prices")
}
