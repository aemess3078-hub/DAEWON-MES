/**
 * 품목별 What-if 시뮬레이션 서비스 (DB 읽기 전용 · 클라이언트 주입형)
 *
 *   요청 검증 → 제품 tenant 소유 배치 검증 → 기본 BOM 배치 조회 → 재고 배치 조회
 *     → (순수) 가상 Demand → runOrderMrp → SimulationView
 *
 * - DB 쓰기 없음: 이 모듈은 findMany / count 만 호출한다(SalesOrder/ProductionPlan/WorkOrder/예약/발주 미접근).
 * - tenantId 는 authorize() 결과에서만 결정하며 요청 본문의 tenantId 는 무시한다.
 * - 쿼리 수는 입력 제품 수와 무관하다: 제품 1 + BOM 레벨 수 + 재고 1.
 */

import type { PrismaClient } from "@prisma/client"
import {
  normalizeSimulationRequest,
  prepareSimulationInput,
  runSimulationFromRows,
  type SimulationItemRow,
  type SimulationView,
} from "../mrp/simulation-adapter"
import { loadDefaultBomRows, loadStockRows } from "./mrp-loaders"

export type SimulationDb = Pick<PrismaClient, "item" | "bOM" | "inventoryBalance">

export type SimulationPayload = {
  view: SimulationView
  calculatedAt: string
  diagnostics: { queryCount: number; bomLevels: number }
}

export async function loadAndRunSimulation(
  db: SimulationDb,
  tenantId: string,
  rawRows: ReturnType<typeof normalizeSimulationRequest>,
  now: () => Date = () => new Date()
): Promise<SimulationPayload> {
  const prepared = prepareSimulationInput(rawRows)
  let queryCount = 0

  // 1) 제품 소유 검증 (배치 1회). 수량 오류 행의 제품도 함께 조회해 이름을 표시한다.
  const idSet = new Set<string>(prepared.merged.map((m) => m.itemId))
  prepared.invalid.forEach((e) => {
    if (e.itemId) idSet.add(e.itemId)
  })
  let itemRows: SimulationItemRow[] = []
  if (idSet.size > 0) {
    queryCount += 1
    itemRows = (await db.item.findMany({
      where: { tenantId, id: { in: Array.from(idSet) } },
      select: { id: true, code: true, name: true, uom: true, itemType: true },
    })) as SimulationItemRow[]
  }

  // 2) 기본 BOM (생산 대상 제품만, 레벨별 배치)
  const ownedProducts = prepared.merged
    .map((m) => m.itemId)
    .filter((id) => itemRows.some((r) => r.id === id && (r.itemType === "FINISHED" || r.itemType === "SEMI_FINISHED")))
  let bomRows: Awaited<ReturnType<typeof loadDefaultBomRows>>["bomRows"] = []
  let bomLevels = 0
  if (ownedProducts.length > 0) {
    const loaded = await loadDefaultBomRows(db, tenantId, ownedProducts)
    bomRows = loaded.bomRows
    bomLevels = loaded.levels
    queryCount += bomLevels
  }

  // 3) 재고 (구성품 전체 1회)
  const { stockRows, queried } = await loadStockRows(db, tenantId, bomRows)
  if (queried) queryCount += 1

  const view = runSimulationFromRows({ tenantId, prepared, itemRows, bomRows, stockRows })
  return { view, calculatedAt: now().toISOString(), diagnostics: { queryCount, bomLevels } }
}

/** 서버 액션 본체: 권한(authorize)을 DB 접근보다 먼저 수행하고 tenant 는 인증 사용자에서만 결정한다. */
export async function executeSimulationRequest(
  deps: { authorize: () => Promise<{ tenantId: string }>; db: SimulationDb; now?: () => Date },
  rawRequest: unknown
): Promise<SimulationPayload> {
  const user = await deps.authorize()
  const rows = normalizeSimulationRequest(rawRequest)
  return loadAndRunSimulation(deps.db, user.tenantId, rows, deps.now)
}

// ─── 제품 검색 ───────────────────────────────────────────────────────────────

export type SimulationProductSearchRow = {
  id: string
  code: string
  name: string
  uom: string
  itemType: string
  /** OK = ACTIVE 기본 BOM 1개, MISSING = 없음, MULTIPLE = 2개 이상(데이터 오류) */
  bomState: "OK" | "MISSING" | "MULTIPLE"
}

export type SimulationProductSearchResult = {
  items: SimulationProductSearchRow[]
  /** 생산 대상 품목이 tenant 에 하나라도 있는지 (Empty State 구분용) */
  hasAnyProduct: boolean
}

const SEARCH_LIMIT = 20
const SEARCH_MAX_QUERY = 50

export type ProductSearchDb = Pick<PrismaClient, "item" | "bOM">

export async function executeProductSearchRequest(
  deps: { authorize: () => Promise<{ tenantId: string }>; db: ProductSearchDb },
  rawQuery: unknown
): Promise<SimulationProductSearchResult> {
  const { tenantId } = await deps.authorize()
  const q = typeof rawQuery === "string" ? rawQuery.trim().slice(0, SEARCH_MAX_QUERY) : ""
  const base = {
    tenantId,
    status: "ACTIVE" as const,
    itemType: { in: ["FINISHED" as const, "SEMI_FINISHED" as const] },
  }
  const rows = await deps.db.item.findMany({
    where: q
      ? { ...base, OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }
      : base,
    select: { id: true, code: true, name: true, uom: true, itemType: true },
    orderBy: { code: "asc" },
    take: SEARCH_LIMIT,
  })

  let hasAnyProduct = rows.length > 0
  if (!hasAnyProduct && q) {
    hasAnyProduct = (await deps.db.item.count({ where: base })) > 0
  }
  if (rows.length === 0) return { items: [], hasAnyProduct }

  const boms = await deps.db.bOM.findMany({
    where: { tenantId, status: "ACTIVE", isDefault: true, itemId: { in: rows.map((r) => r.id) } },
    select: { itemId: true },
  })
  const count = new Map<string, number>()
  boms.forEach((b) => count.set(b.itemId, (count.get(b.itemId) ?? 0) + 1))
  return {
    hasAnyProduct,
    items: rows.map((r) => {
      const n = count.get(r.id) ?? 0
      return { ...r, bomState: n === 1 ? "OK" : n === 0 ? "MISSING" : "MULTIPLE" }
    }),
  }
}
