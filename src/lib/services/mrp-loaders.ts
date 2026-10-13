/**
 * MRP 공용 DB 로더 (읽기 전용, DB 클라이언트 주입형)
 *
 * 수주기준 MRP(Phase 2)와 품목 시뮬레이션(Phase 4)이 같은 BOM/재고 조회 정책을 공유한다.
 *  - BOM  : tenant + status=ACTIVE + isDefault=true. 레벨별 배치 조회(최대 11레벨, N+1 없음)
 *  - 재고 : tenant 일치, LOT 도 같은 tenant 인 InventoryBalance 를 구성품 전체에 대해 1회 조회
 * 조회 수는 입력(수주/제품) 건수와 무관하다.
 */

import type { PrismaClient } from "@prisma/client"
import { selectDefaultBoms, type BomRow, type InventoryBalanceRow } from "../mrp/order-mrp-adapter"
import { SCHEDULED_RECEIPT_PO_STATUSES, type PurchaseOrderItemRow } from "../mrp/scheduled-receipt"

export type BomStockDb = Pick<PrismaClient, "bOM" | "inventoryBalance">

/** BOM 다단계 조회 상한(엔진 maxBomDepth 10 + 최상위 1) */
export const MAX_BOM_LEVELS = 11

export async function loadDefaultBomRows(
  db: Pick<PrismaClient, "bOM">,
  tenantId: string,
  rootItemIds: readonly string[]
): Promise<{ bomRows: BomRow[]; levels: number }> {
  const bomRows: BomRow[] = []
  const seen = new Set<string>()
  let frontier = Array.from(new Set(rootItemIds))
  let levels = 0
  while (frontier.length > 0 && levels < MAX_BOM_LEVELS) {
    frontier.forEach((id) => seen.add(id))
    levels += 1
    const rows = (await db.bOM.findMany({
      where: { tenantId, status: "ACTIVE", isDefault: true, itemId: { in: frontier } },
      select: {
        id: true,
        tenantId: true,
        itemId: true,
        version: true,
        status: true,
        isDefault: true,
        bomItems: {
          orderBy: { seq: "asc" },
          select: {
            componentItemId: true,
            seq: true,
            qtyPer: true,
            scrapRate: true,
            componentItem: {
              select: { code: true, name: true, spec: true, uom: true, itemType: true },
            },
          },
        },
      },
    })) as BomRow[]
    bomRows.push(...rows)
    const { selected } = selectDefaultBoms(rows, tenantId)
    const next = new Set<string>()
    selected.forEach((bom) => {
      for (const bi of bom.bomItems) {
        if (bi.componentItem.itemType === "SEMI_FINISHED" && !seen.has(bi.componentItemId)) {
          next.add(bi.componentItemId)
        }
      }
    })
    frontier = Array.from(next)
  }
  return { bomRows, levels }
}

/** 선택된 기본 BOM 의 모든 구성품 itemId (재고/예정입고 조회 대상) */
export function collectComponentItemIds(bomRows: readonly BomRow[], tenantId: string): string[] {
  const ids = new Set<string>()
  selectDefaultBoms(bomRows, tenantId).selected.forEach((bom) => {
    for (const bi of bom.bomItems) ids.add(bi.componentItemId)
  })
  return Array.from(ids)
}

/**
 * 예정입고 후보(확정 구매발주의 품목 행)를 구성품 전체에 대해 1회 조회한다(Phase 5B).
 *  - tenant 한정(발주 헤더와 품목 모두), 상태 ORDERED / PARTIAL_RECEIVED 만
 *  - 외주발주 제외·미입고 수량·예정일 판정은 순수 모듈(scheduled-receipt.ts)이 한다.
 *    (note 가 NULL 인 행이 SQL NOT/contains 에서 조용히 빠지는 문제를 피하기 위해 DB 조건에 넣지 않는다.)
 */
export async function loadScheduledReceiptRows(
  db: Pick<PrismaClient, "purchaseOrderItem">,
  tenantId: string,
  componentItemIds: readonly string[]
): Promise<{ rows: PurchaseOrderItemRow[]; queried: boolean }> {
  if (componentItemIds.length === 0) return { rows: [], queried: false }
  const rows = (await db.purchaseOrderItem.findMany({
    where: {
      itemId: { in: Array.from(new Set(componentItemIds)) },
      item: { tenantId },
      purchaseOrder: { tenantId, status: { in: [...SCHEDULED_RECEIPT_PO_STATUSES] } },
    },
    select: {
      id: true,
      itemId: true,
      qty: true,
      receivedQty: true,
      workOrderOperationId: true,
      purchaseOrder: {
        select: {
          id: true,
          tenantId: true,
          orderNo: true,
          status: true,
          expectedDate: true,
          note: true,
          supplier: { select: { id: true, name: true } },
        },
      },
    },
  })) as PurchaseOrderItemRow[]
  return { rows, queried: true }
}

/** 선택된 기본 BOM 의 모든 구성품 재고를 1회 조회한다(구성품이 없으면 쿼리 0회). */
export async function loadStockRows(
  db: Pick<PrismaClient, "inventoryBalance">,
  tenantId: string,
  bomRows: readonly BomRow[]
): Promise<{ stockRows: InventoryBalanceRow[]; queried: boolean }> {
  const componentIds = new Set<string>()
  selectDefaultBoms(bomRows, tenantId).selected.forEach((bom) => {
    for (const bi of bom.bomItems) componentIds.add(bi.componentItemId)
  })
  if (componentIds.size === 0) return { stockRows: [], queried: false }
  const stockRows = (await db.inventoryBalance.findMany({
    where: {
      tenantId,
      itemId: { in: Array.from(componentIds) },
      item: { tenantId },
      OR: [{ lotId: null }, { lot: { tenantId } }],
    },
    select: {
      itemId: true,
      qtyOnHand: true,
      qtyAvailable: true,
      qtyHold: true,
      lotId: true,
      lot: { select: { status: true } },
    },
  })) as InventoryBalanceRow[]
  return { stockRows, queried: true }
}

/**
 * 현재 유효한 구매단가(ItemPrice PURCHASE) 일괄 조회 — 발주제안용 (Phase 5C)
 *  - 선택 규칙은 기존 발주 화면(getItemPrice)과 같다: priceType=PURCHASE, effectiveFrom ≤ 기준시각,
 *    (effectiveTo 없음 또는 ≥ 기준시각), effectiveFrom 최신 1건. 공급업체(partnerId)가 같은 가격만 사용한다.
 *  - 쿼리 1회(품목 × 공급업체 조합 수와 무관). 결과 key = `${itemId}|${supplierId}`
 */
export async function loadCurrentPurchasePrices(
  db: Pick<PrismaClient, "itemPrice">,
  tenantId: string,
  itemIds: readonly string[],
  supplierIds: readonly string[],
  now: Date
): Promise<{ prices: Map<string, { unitPrice: number; currency: string; effectiveFrom: string }>; queried: boolean }> {
  const prices = new Map<string, { unitPrice: number; currency: string; effectiveFrom: string }>()
  if (itemIds.length === 0 || supplierIds.length === 0) return { prices, queried: false }
  const rows = await db.itemPrice.findMany({
    where: {
      tenantId,
      priceType: "PURCHASE",
      itemId: { in: Array.from(new Set(itemIds)) },
      partnerId: { in: Array.from(new Set(supplierIds)) },
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
    select: { itemId: true, partnerId: true, unitPrice: true, currency: true, effectiveFrom: true },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  })
  for (const r of rows) {
    const key = `${r.itemId}|${r.partnerId}`
    if (prices.has(key)) continue // 정렬상 첫 행 = 최신 유효 단가
    const unitPrice = Number(r.unitPrice)
    if (!Number.isFinite(unitPrice)) continue
    prices.set(key, {
      unitPrice,
      currency: r.currency,
      effectiveFrom: new Date(r.effectiveFrom).toISOString().slice(0, 10),
    })
  }
  return { prices, queried: true }
}

/**
 * DRAFT 구매발주의 미입고 수량(참고용) — MRP 예정입고/재고에는 가산하지 않는다(Phase 5B 정책: ORDERED/PARTIAL_RECEIVED 만).
 * 외주발주(OS- / [OUTSOURCING] / 공정 연결 행)는 제외한다.
 */
export async function loadDraftOpenQuantities(
  db: Pick<PrismaClient, "purchaseOrderItem">,
  tenantId: string,
  itemIds: readonly string[]
): Promise<{ byItem: Map<string, number>; queried: boolean }> {
  const byItem = new Map<string, number>()
  if (itemIds.length === 0) return { byItem, queried: false }
  const rows = await db.purchaseOrderItem.findMany({
    where: {
      itemId: { in: Array.from(new Set(itemIds)) },
      item: { tenantId },
      purchaseOrder: { tenantId, status: "DRAFT" },
    },
    select: {
      itemId: true,
      qty: true,
      receivedQty: true,
      workOrderOperationId: true,
      purchaseOrder: { select: { orderNo: true, note: true } },
    },
  })
  for (const r of rows) {
    const po = r.purchaseOrder
    if (po.orderNo.startsWith("OS-") || (po.note ?? "").includes("[OUTSOURCING]") || r.workOrderOperationId) continue
    const open = Math.max(0, Number(r.qty) - Number(r.receivedQty))
    if (open > 0) byItem.set(r.itemId, (byItem.get(r.itemId) ?? 0) + open)
  }
  return { byItem, queried: true }
}
