"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db/prisma"
import { requireRole } from "@/lib/auth"
import {
  hasCurrentUserResourcePermission,
  requireResourcePermission,
} from "@/lib/auth/role-permissions"
import {
  createItemSupplier as createItemSupplierCore,
  listItemSuppliers as listItemSuppliersCore,
  removeItemSupplier as removeItemSupplierCore,
  searchSupplierCandidates as searchSupplierCandidatesCore,
  setDefaultItemSupplier as setDefaultItemSupplierCore,
  setItemSupplierActive as setItemSupplierActiveCore,
  updateItemSupplier as updateItemSupplierCore,
  type ItemSupplierActor,
  type ItemSupplierInput,
  type ItemSupplierPatch,
  type ItemSupplierResult,
  type ItemSupplierView,
  type SupplierCandidate,
} from "@/lib/services/item-supplier.service"

/**
 * 품목별 공급업체 관리 (Phase 5A)
 *
 * 권한(새 RolePermission resource 를 만들지 않고 품목 기준정보 권한을 재사용한다)
 *  - 조회:                ITEM READ   (+ 단가 표시는 ITEM_PRICE READ 가 있을 때만)
 *  - 등록/수정/기본지정/활성전환: ITEM UPDATE (+ role OPERATOR 이상)
 *  - 공급업체 후보 검색:     ITEM UPDATE + PARTNER_MANAGEMENT READ (거래처 조회 정책과 충돌하지 않도록)
 *  - 물리 삭제:            ITEM DELETE (MANAGER 는 비활성화만 가능)
 * tenantId 는 인증 컨텍스트에서만 결정하며 입력으로 받지 않는다.
 */

async function authorizeRead(): Promise<{ tenantId: string }> {
  const user = await requireResourcePermission("ITEM", "READ")
  return { tenantId: user.tenantId }
}

async function authorizeUpdate(): Promise<ItemSupplierActor> {
  const user = await requireResourcePermission("ITEM", "UPDATE")
  const actor = await requireRole("OPERATOR", user)
  return { id: actor.id, name: actor.name, tenantId: actor.tenantId }
}

async function authorizeCandidateSearch(): Promise<ItemSupplierActor> {
  const actor = await authorizeUpdate()
  await requireResourcePermission("PARTNER_MANAGEMENT", "READ")
  return actor
}

async function authorizeDelete(): Promise<ItemSupplierActor> {
  const user = await requireResourcePermission("ITEM", "DELETE")
  const actor = await requireRole("OPERATOR", user)
  return { id: actor.id, name: actor.name, tenantId: actor.tenantId }
}

function afterMutation<T>(result: ItemSupplierResult<T>): ItemSupplierResult<T> {
  if (result.success) revalidatePath("/app/mes/items")
  return result
}

export async function getItemSuppliers(itemId: string): Promise<ItemSupplierResult<ItemSupplierView[]>> {
  const includePrices = await hasCurrentUserResourcePermission("ITEM_PRICE", "READ")
  return listItemSuppliersCore({ authorize: authorizeRead, db: prisma, includePrices }, itemId)
}

export async function searchItemSupplierCandidates(
  itemId: string,
  query: string
): Promise<ItemSupplierResult<SupplierCandidate[]>> {
  return searchSupplierCandidatesCore({ authorize: authorizeCandidateSearch, db: prisma }, itemId, query)
}

export async function addItemSupplier(
  itemId: string,
  input: ItemSupplierInput
): Promise<ItemSupplierResult<{ id: string }>> {
  return afterMutation(await createItemSupplierCore({ authorize: authorizeUpdate, db: prisma }, itemId, input))
}

export async function updateItemSupplierConditions(
  relationId: string,
  patch: ItemSupplierPatch
): Promise<ItemSupplierResult<undefined>> {
  return afterMutation(await updateItemSupplierCore({ authorize: authorizeUpdate, db: prisma }, relationId, patch))
}

export async function setDefaultItemSupplier(relationId: string): Promise<ItemSupplierResult<undefined>> {
  return afterMutation(await setDefaultItemSupplierCore({ authorize: authorizeUpdate, db: prisma }, relationId))
}

export async function setItemSupplierActive(
  relationId: string,
  isActive: boolean
): Promise<ItemSupplierResult<undefined>> {
  return afterMutation(await setItemSupplierActiveCore({ authorize: authorizeUpdate, db: prisma }, relationId, isActive))
}

export async function removeItemSupplier(relationId: string): Promise<ItemSupplierResult<undefined>> {
  return afterMutation(await removeItemSupplierCore({ authorize: authorizeDelete, db: prisma }, relationId))
}
