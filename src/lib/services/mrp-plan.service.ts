/**
 * 생산계획 기반 MRP 코어 (DB 클라이언트 주입형)
 *
 * 계산 알고리즘은 기존 `mrp.service.ts calculateMRP` 와 동일하다(로직 변경 없음).
 * 보안 hardening 으로 달라진 점은 모든 조회에 tenantId 조건이 들어갔다는 것뿐이다.
 *   - ProductionPlan : id + tenantId
 *   - BOM            : itemId + isDefault + tenantId
 *   - InventoryBalance: itemId + tenantId
 *   - PurchaseOrderItem: itemId + purchaseOrder.tenantId
 *
 * `@/lib/db/prisma` 를 import 하지 않으므로 테스트에서 fake DB 를 주입할 수 있다.
 */

import type { PrismaClient } from "@prisma/client"

export type MRPItem = {
  itemId: string
  itemCode: string
  itemName: string
  uom: string
  grossRequirement: number
  currentStock: number
  availableStock: number
  onOrder: number
  netRequirement: number
  suggestedOrderQty: number
  status: "SUFFICIENT" | "SHORTAGE" | "CRITICAL"
}

export type MRPResult = {
  planId: string
  planNo: string
  items: MRPItem[]
  calculatedAt: Date
  totalShortageItems: number
  totalSufficientItems: number
  totalCriticalItems: number
}

export type PlanMrpDb = Pick<
  PrismaClient,
  "productionPlan" | "bOM" | "inventoryBalance" | "purchaseOrderItem"
>

type ComponentAccumulator = Map<
  string,
  { itemId: string; itemCode: string; itemName: string; uom: string; qty: number }
>

/**
 * BOM 다단계 재귀 전개 (최대 10레벨, 순환 참조 방지)
 * - componentItem 관계를 통해 자재 정보 직접 접근
 * - SEMI_FINISHED 품목은 재귀 전개
 */
async function explodeBOM(
  db: PlanMrpDb,
  tenantId: string,
  itemId: string,
  quantity: number,
  visited: Set<string>,
  depth: number
): Promise<ComponentAccumulator> {
  const result: ComponentAccumulator = new Map()

  if (depth > 10 || visited.has(itemId)) return result
  visited.add(itemId)

  const bom = await db.bOM.findFirst({
    where: { itemId, isDefault: true, tenantId },
    include: {
      bomItems: {
        include: {
          componentItem: true,
        },
      },
    },
  })

  if (!bom) return result

  for (const bomItem of bom.bomItems) {
    const qtyPer = Number(bomItem.qtyPer)
    const scrapRate = Number(bomItem.scrapRate ?? 0)
    const requiredQty = quantity * qtyPer * (1 + scrapRate)

    const compItemId = bomItem.componentItemId
    const compItem = bomItem.componentItem

    if (!compItem) continue

    const existing = result.get(compItemId)
    if (existing) {
      existing.qty += requiredQty
    } else {
      result.set(compItemId, {
        itemId: compItemId,
        itemCode: compItem.code,
        itemName: compItem.name,
        uom: compItem.uom,
        qty: requiredQty,
      })
    }

    // SEMI_FINISHED 품목은 재귀 전개
    if (compItem.itemType === "SEMI_FINISHED") {
      const subItems = await explodeBOM(db, tenantId, compItemId, requiredQty, new Set(visited), depth + 1)
      for (const [subId, subItem] of Array.from(subItems.entries())) {
        const ex = result.get(subId)
        if (ex) {
          ex.qty += subItem.qty
        } else {
          result.set(subId, { ...subItem })
        }
      }
    }
  }

  return result
}

/** tenantId 는 반드시 인증 컨텍스트에서 가져온 값이어야 한다(호출자 책임 — 액션이 보장). */
export async function calculatePlanMrp(
  db: PlanMrpDb,
  planId: string,
  tenantId: string
): Promise<MRPResult> {
  const plan = await db.productionPlan.findFirst({
    where: { id: planId, tenantId },
    include: {
      items: {
        include: {
          item: true,
        },
      },
    },
  })
  // 존재하지 않는 계획과 다른 tenant 의 계획을 구분하지 않는다(존재 여부 비노출)
  if (!plan) throw new Error("생산계획을 찾을 수 없습니다.")

  // 총소요량 집계 Map: itemId → { qty, item info }
  const totalRequirements: ComponentAccumulator = new Map()

  for (const planItem of plan.items) {
    const plannedQty = Number(planItem.plannedQty)
    const visited = new Set<string>()

    const items = await explodeBOM(db, tenantId, planItem.itemId, plannedQty, visited, 0)

    for (const [id, item] of Array.from(items.entries())) {
      const ex = totalRequirements.get(id)
      if (ex) {
        ex.qty += item.qty
      } else {
        totalRequirements.set(id, { ...item })
      }
    }
  }

  if (totalRequirements.size === 0) {
    return {
      planId,
      planNo: plan.planNo,
      items: [],
      calculatedAt: new Date(),
      totalShortageItems: 0,
      totalSufficientItems: 0,
      totalCriticalItems: 0,
    }
  }

  const mrpItems: MRPItem[] = []

  for (const [itemId, req] of Array.from(totalRequirements.entries())) {
    // 재고 집계
    const stockAgg = await db.inventoryBalance.aggregate({
      where: { itemId, tenantId },
      _sum: { qtyOnHand: true, qtyAvailable: true },
    })
    const currentStock = Number(stockAgg._sum.qtyOnHand ?? 0)
    const availableStock = Number(stockAgg._sum.qtyAvailable ?? 0)

    // 발주중 수량 조회 (ORDERED 또는 PARTIAL_RECEIVED 상태의 미입고 잔량)
    let onOrder = 0
    try {
      const poItems = await db.purchaseOrderItem.findMany({
        where: {
          itemId,
          purchaseOrder: {
            tenantId,
            status: { in: ["ORDERED", "PARTIAL_RECEIVED"] },
          },
        },
        select: { qty: true, receivedQty: true },
      })
      onOrder = poItems.reduce(
        (sum, poi) => sum + Math.max(0, Number(poi.qty) - Number(poi.receivedQty)),
        0
      )
    } catch {
      // PurchaseOrder 모델이 없는 환경에서는 무시
    }

    const netRequirement = req.qty - availableStock - onOrder
    const suggestedOrderQty = Math.max(0, netRequirement)

    let status: "SUFFICIENT" | "SHORTAGE" | "CRITICAL"
    if (netRequirement <= 0) {
      status = "SUFFICIENT"
    } else if (netRequirement < req.qty * 0.5) {
      status = "SHORTAGE"
    } else {
      status = "CRITICAL"
    }

    mrpItems.push({
      itemId,
      itemCode: req.itemCode,
      itemName: req.itemName,
      uom: req.uom,
      grossRequirement: req.qty,
      currentStock,
      availableStock,
      onOrder,
      netRequirement,
      suggestedOrderQty,
      status,
    })
  }

  // CRITICAL → SHORTAGE → SUFFICIENT 정렬
  mrpItems.sort((a, b) => {
    const order: Record<string, number> = { CRITICAL: 0, SHORTAGE: 1, SUFFICIENT: 2 }
    return order[a.status] - order[b.status]
  })

  return {
    planId,
    planNo: plan.planNo,
    items: mrpItems,
    calculatedAt: new Date(),
    totalCriticalItems: mrpItems.filter((i) => i.status === "CRITICAL").length,
    totalShortageItems: mrpItems.filter((i) => i.status === "SHORTAGE").length,
    totalSufficientItems: mrpItems.filter((i) => i.status === "SUFFICIENT").length,
  }
}

/**
 * 서버 액션 본체. 인증/권한(authorize)을 DB 접근보다 먼저 수행하고
 * tenantId 는 인증된 사용자에서만 결정한다.
 */
export async function executeRunMrpRequest(
  deps: { authorize: () => Promise<{ tenantId: string }>; db: PlanMrpDb },
  planId: string
): Promise<MRPResult> {
  const user = await deps.authorize()
  if (typeof planId !== "string" || planId.length === 0) {
    throw new Error("생산계획을 찾을 수 없습니다.")
  }
  return calculatePlanMrp(deps.db, planId, user.tenantId)
}
