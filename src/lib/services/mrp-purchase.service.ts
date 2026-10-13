/**
 * MRP 결과 → 구매발주(DRAFT) 생성 코어 (DB 클라이언트 주입형)
 *
 * 보안 원칙
 *  - tenantId 는 authorize() 가 돌려준 인증 사용자에서만 결정한다. 클라이언트 값은 받지 않는다.
 *  - 클라이언트가 보낸 itemId / siteId 는 현재 tenant 소유인지 서버에서 검증한다.
 *    하나라도 소유가 아니면 DB 쓰기 0건으로 일반적인 오류만 반환한다(다른 tenant 데이터 존재 여부 비노출).
 *  - 공급사는 클라이언트가 지정하지 않고 현재 tenant 의 첫 SUPPLIER/BOTH 를 사용한다(기존 동작 유지).
 */

import type { PrismaClient } from "@prisma/client"

export type MrpPurchaseDb = Pick<PrismaClient, "businessPartner" | "site" | "item" | "purchaseOrder">

export type MrpPurchaseResult = { success: boolean; orderNo?: string; error?: string }

const INVALID_REFERENCE = "유효하지 않은 참조가 포함되어 있습니다."

export async function createPurchaseOrdersFromMrp(
  deps: {
    authorize: () => Promise<{ tenantId: string }>
    db: MrpPurchaseDb
    /** 테스트용 시각 주입. 기본 Date.now */
    nowMs?: () => number
  },
  items: ReadonlyArray<{ itemId: string; qty: number }>,
  siteId: string | null | undefined
): Promise<MrpPurchaseResult> {
  // 권한 실패(throw)는 DB 접근 전에 발생한다
  const { tenantId } = await deps.authorize()
  const { db } = deps
  const nowMs = deps.nowMs ?? Date.now

  try {
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false, error: "발주할 자재가 없습니다." }
    }
    for (const it of items) {
      if (typeof it?.itemId !== "string" || it.itemId.length === 0 || !Number.isFinite(it.qty) || !(it.qty > 0)) {
        return { success: false, error: "발주 수량 또는 품목 정보가 올바르지 않습니다." }
      }
    }

    // 품목 소유 검증 (배치 1회)
    const itemIds = Array.from(new Set(items.map((i) => i.itemId)))
    const ownedItems = await db.item.findMany({
      where: { tenantId, id: { in: itemIds } },
      select: { id: true },
    })
    if (ownedItems.length !== itemIds.length) {
      return { success: false, error: INVALID_REFERENCE }
    }

    // 공급사 자동 선택: 현재 tenant 의 첫 번째 SUPPLIER
    const defaultSupplier = await db.businessPartner.findFirst({
      where: { tenantId, partnerType: { in: ["SUPPLIER", "BOTH"] } },
    })
    if (!defaultSupplier) {
      return { success: false, error: "등록된 공급사가 없습니다." }
    }

    // 사이트: 값이 있으면 반드시 현재 tenant 소유여야 한다(다른 tenant 값을 조용히 대체하지 않는다).
    let resolvedSiteId: string
    if (siteId) {
      const owned = await db.site.findFirst({ where: { id: siteId, tenantId } })
      if (!owned) return { success: false, error: INVALID_REFERENCE }
      resolvedSiteId = owned.id
    } else {
      const firstSite = await db.site.findFirst({ where: { tenantId } })
      if (!firstSite) {
        return { success: false, error: "등록된 공장(사이트)이 없습니다." }
      }
      resolvedSiteId = firstSite.id
    }

    const now = nowMs()
    const orderNo = `PO-MRP-${now}`

    await db.purchaseOrder.create({
      data: {
        tenantId,
        siteId: resolvedSiteId,
        supplierId: defaultSupplier.id,
        orderNo,
        orderDate: new Date(now),
        expectedDate: new Date(now + 14 * 24 * 60 * 60 * 1000), // 2주 후
        status: "DRAFT",
        currency: "KRW",
        note: "MRP 자동 생성 발주",
        items: {
          create: items.map((item) => ({
            itemId: item.itemId,
            qty: item.qty,
            unitPrice: 0,
            stockAtOrder: 0,
          })),
        },
      },
    })

    return { success: true, orderNo }
  } catch (e) {
    // 내부 오류 상세(Prisma 메시지 등)를 클라이언트에 그대로 노출하지 않는다
    console.error("[createPurchaseOrdersFromMrp] failed:", e)
    return { success: false, error: "발주 생성에 실패했습니다." }
  }
}
