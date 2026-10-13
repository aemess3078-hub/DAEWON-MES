/**
 * 수주 기반 MRP 서비스 (DB 읽기 전용)
 *
 *   Prisma(READ) → 어댑터(순수) → runOrderMrp(순수 엔진) → View 모델
 *
 * - 이 모듈은 `@/lib/db/prisma` 를 import 하지 않는다. DB 클라이언트는 주입(DI)받는다.
 *   (서버 액션 `mrp-order.actions.ts` 가 실제 prisma 를 주입, 테스트는 fake 를 주입)
 * - DB 쓰기 없음. 모든 조회는 tenantId 로 한정한다.
 * - 조회 수는 수요·자재 건수와 무관하다: 수주 1 + BOM 레벨 수(≤11) + 재고 1.
 */

import type { PrismaClient, SalesOrderStatus } from "@prisma/client"
import { isDateOnly } from "../mrp/period"
import {
  DEMAND_ORDER_STATUSES,
  runOrderMrpFromRows,
  type OrderMrpView,
  type SalesOrderItemRow,
} from "../mrp/order-mrp-adapter"
import { loadDefaultBomRows, loadStockRows } from "./mrp-loaders"

export type OrderMrpDb = Pick<PrismaClient, "salesOrderItem" | "bOM" | "inventoryBalance">

export type OrderMrpParams = {
  /** 납기 시작(포함), YYYY-MM-DD. 비우면 하한 없음 */
  from?: string | null
  /** 납기 종료(포함), YYYY-MM-DD. 비우면 상한 없음 */
  to?: string | null
  /** DRAFT(임시) 수주를 수요에 포함. 기본 false */
  includeDraft?: boolean
}

export type OrderMrpPayload = {
  view: OrderMrpView
  calculatedAt: string
  diagnostics: { queryCount: number; bomLevels: number }
}

export function normalizeOrderMrpParams(raw: unknown): {
  from: string | null
  to: string | null
  includeDraft: boolean
} {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>
  const read = (key: "from" | "to"): string | null => {
    const v = obj[key]
    if (v === undefined || v === null || v === "") return null
    if (typeof v !== "string" || !isDateOnly(v)) {
      throw new Error("조회 기간은 YYYY-MM-DD 형식이어야 합니다.")
    }
    return v
  }
  const from = read("from")
  const to = read("to")
  if (from !== null && to !== null && from > to) {
    throw new Error("시작일이 종료일보다 늦습니다.")
  }
  // tenantId 등 그 외 키는 의도적으로 무시한다(클라이언트 값을 신뢰하지 않음)
  return { from, to, includeDraft: obj.includeDraft === true }
}

export async function loadAndRunOrderMrp(
  db: OrderMrpDb,
  tenantId: string,
  params: { from: string | null; to: string | null; includeDraft: boolean },
  now: () => Date = () => new Date()
): Promise<OrderMrpPayload> {
  let queryCount = 0

  // 1) 수요: 현재 tenant 의 미취소·미종결 수주 라인 (배치 1회)
  const statuses: SalesOrderStatus[] = [...DEMAND_ORDER_STATUSES]
  if (params.includeDraft) statuses.push("DRAFT")
  queryCount += 1
  const demandRows = (await db.salesOrderItem.findMany({
    where: {
      salesOrder: { tenantId, status: { in: statuses } },
      item: { tenantId },
    },
    select: {
      id: true,
      qty: true,
      shippedQty: true,
      deliveryDate: true,
      itemId: true,
      item: { select: { id: true, code: true, name: true } },
      salesOrder: {
        select: {
          id: true,
          orderNo: true,
          status: true,
          deliveryDate: true,
          customer: { select: { name: true } },
        },
      },
    },
    orderBy: [{ salesOrder: { orderNo: "asc" } }, { id: "asc" }],
  })) as SalesOrderItemRow[]

  // 2) BOM: 레벨별 배치 조회 (ACTIVE + isDefault, tenant 한정) — 공용 로더
  const { bomRows, levels: bomLevels } = await loadDefaultBomRows(
    db,
    tenantId,
    demandRows.map((r) => r.itemId)
  )
  queryCount += bomLevels

  // 3) 재고: 구성품 전체를 한 번에 (tenant 한정, LOT 도 같은 tenant 일 때만) — 공용 로더
  const { stockRows, queried } = await loadStockRows(db, tenantId, bomRows)
  if (queried) queryCount += 1

  const view = runOrderMrpFromRows({
    tenantId,
    demandRows,
    bomRows,
    stockRows,
    params: { from: params.from, to: params.to, includeDraft: params.includeDraft },
  })

  return {
    view,
    calculatedAt: now().toISOString(),
    diagnostics: { queryCount, bomLevels },
  }
}

/**
 * 서버 액션 본체. 인증/권한(authorize)을 DB 접근보다 먼저 수행하고,
 * tenantId 는 인증된 사용자에서만 결정한다(요청 파라미터의 tenantId 는 무시).
 */
export async function executeOrderMrpRequest(
  deps: {
    authorize: () => Promise<{ tenantId: string }>
    db: OrderMrpDb
    now?: () => Date
  },
  rawParams: unknown
): Promise<OrderMrpPayload> {
  const user = await deps.authorize()
  const params = normalizeOrderMrpParams(rawParams)
  return loadAndRunOrderMrp(deps.db, user.tenantId, params, deps.now)
}
