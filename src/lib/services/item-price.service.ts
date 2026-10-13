/**
 * 품목 단가(ItemPrice) 코어 (DB 클라이언트 주입형)
 *
 * Phase 5A 선행 FIX — tenant 경계
 *  - tenantId 는 authorize() 가 돌려준 인증 사용자에서만 결정한다. 클라이언트가 보낸 값(data.tenantId 포함)은 쓰지 않는다.
 *  - itemId / partnerId 는 현재 tenant 소유인지 서버에서 검증한다.
 *  - update / delete 는 id 만으로 접근하지 않고 where 에 tenantId 를 포함한다.
 *  - 타 tenant 참조/존재하지 않는 id 는 구분 없이 같은 일반 오류(존재 여부 비노출) + DB write 0.
 *  - 기존 정상 CRUD 동작(필드/감사로그/메뉴명)은 유지한다.
 */

import type { PrismaClient } from "@prisma/client"

export type ItemPriceDb = Pick<PrismaClient, "itemPrice" | "item" | "businessPartner" | "auditLog">

export type ItemPriceActor = { id: string; name?: string | null; tenantId: string }

export const INVALID_ITEM_PRICE_REFERENCE = "유효하지 않은 참조입니다."

export type CreateItemPriceCoreInput = {
  itemId: string
  partnerId: string
  priceType: string
  unitPrice: number
  currency: string
  effectiveFrom: Date
  effectiveTo?: Date
  note?: string
}

export type UpdateItemPriceCoreInput = {
  unitPrice?: number
  currency?: string
  effectiveFrom?: Date
  effectiveTo?: Date | null
  note?: string
}

const MENU_NAME = "품목 가격 관리"

type Deps = { authorize: () => Promise<ItemPriceActor>; db: ItemPriceDb }
type ReadDeps = { authorizeTenant: () => Promise<string>; db: ItemPriceDb }

export async function listItemPricesCore(deps: ReadDeps) {
  const tenantId = await deps.authorizeTenant()
  return deps.db.itemPrice.findMany({
    where: { tenantId },
    include: { item: true, partner: true },
    orderBy: { createdAt: "desc" },
  })
}

export async function listPartnersForPricesCore(deps: ReadDeps) {
  const tenantId = await deps.authorizeTenant()
  return deps.db.businessPartner.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
  })
}

export async function createItemPriceCore(deps: Deps, data: CreateItemPriceCoreInput): Promise<void> {
  // 권한 실패(throw)는 DB 접근 전에 발생한다
  const actor = await deps.authorize()
  const { db } = deps
  const tenantId = actor.tenantId

  const [item, partner] = await Promise.all([
    db.item.findFirst({ where: { id: String(data?.itemId ?? ""), tenantId }, select: { id: true } }),
    db.businessPartner.findFirst({ where: { id: String(data?.partnerId ?? ""), tenantId }, select: { id: true } }),
  ])
  if (!item || !partner) throw new Error(INVALID_ITEM_PRICE_REFERENCE)

  // 필드를 명시적으로 고른다 — 입력 객체를 그대로 펼치면 클라이언트가 보낸 tenantId 가 덮어쓸 수 있다.
  const created = await db.itemPrice.create({
    data: {
      tenantId,
      itemId: item.id,
      partnerId: partner.id,
      priceType: data.priceType,
      unitPrice: data.unitPrice,
      currency: data.currency,
      effectiveFrom: data.effectiveFrom,
      effectiveTo: data.effectiveTo,
      note: data.note,
    },
  })
  await db.auditLog
    .create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name ?? null,
        entityType: "ItemPrice",
        entityId: created.id,
        action: "CREATE",
        afterData: {
          itemId: item.id,
          partnerId: partner.id,
          priceType: data.priceType,
          unitPrice: data.unitPrice,
          currency: data.currency,
        },
        menuName: MENU_NAME,
      },
    })
    .catch(() => {})
}

export async function updateItemPriceCore(deps: Deps, id: string, data: UpdateItemPriceCoreInput): Promise<void> {
  const actor = await deps.authorize()
  const { db } = deps
  const tenantId = actor.tenantId

  const owned = await db.itemPrice.findFirst({ where: { id: String(id ?? ""), tenantId } })
  if (!owned) throw new Error(INVALID_ITEM_PRICE_REFERENCE)

  // 수정 가능한 필드만 전달한다(itemId/partnerId/tenantId 변경 불가).
  const patch: Record<string, unknown> = {}
  if (data.unitPrice !== undefined) patch.unitPrice = data.unitPrice
  if (data.currency !== undefined) patch.currency = data.currency
  if (data.effectiveFrom !== undefined) patch.effectiveFrom = data.effectiveFrom
  if (data.effectiveTo !== undefined) patch.effectiveTo = data.effectiveTo
  if (data.note !== undefined) patch.note = data.note

  const result = await db.itemPrice.updateMany({ where: { id: owned.id, tenantId }, data: patch })
  if (result.count !== 1) throw new Error(INVALID_ITEM_PRICE_REFERENCE)

  await db.auditLog
    .create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name ?? null,
        entityType: "ItemPrice",
        entityId: owned.id,
        action: "UPDATE",
        beforeData: { unitPrice: Number(owned.unitPrice), currency: owned.currency },
        afterData: { unitPrice: data.unitPrice, currency: data.currency },
        menuName: MENU_NAME,
      },
    })
    .catch(() => {})
}

export async function deleteItemPriceCore(deps: Deps, id: string): Promise<void> {
  const actor = await deps.authorize()
  const { db } = deps
  const tenantId = actor.tenantId

  const owned = await db.itemPrice.findFirst({ where: { id: String(id ?? ""), tenantId } })
  if (!owned) throw new Error(INVALID_ITEM_PRICE_REFERENCE)

  const result = await db.itemPrice.deleteMany({ where: { id: owned.id, tenantId } })
  if (result.count !== 1) throw new Error(INVALID_ITEM_PRICE_REFERENCE)

  await db.auditLog
    .create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name ?? null,
        entityType: "ItemPrice",
        entityId: owned.id,
        action: "DELETE",
        beforeData: {
          itemId: owned.itemId,
          partnerId: owned.partnerId,
          priceType: owned.priceType,
          unitPrice: Number(owned.unitPrice),
          currency: owned.currency,
        },
        menuName: MENU_NAME,
      },
    })
    .catch(() => {})
}
