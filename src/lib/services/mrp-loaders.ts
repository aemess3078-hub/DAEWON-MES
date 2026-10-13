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
