"use server"

/**
 * 자재 출고이력 조회(읽기 전용).
 *
 * 기준: 수불 원장(InventoryTransaction)의 작업지시 참조(refType=WORK_ORDER) 기록 중 출고(ISSUE)와 작업지시 반납(RETURN).
 * 작업지시 상태와 무관하다 — 완료·취소된 작업지시의 과거 출고도 그대로 조회된다.
 *
 * 취소/반납 표시: 이 시스템에는 출고를 "취소"하는 별도 기능이 없고 반납은 RETURN 수불(재고 +)로 남는다.
 * RETURN 은 특정 출고 건과 직접 연결되어 있지 않으므로(refId = 작업지시), 출고 행에는 같은 작업지시·품목·LOT 의 반납 누계를
 * "반납수량"으로 보여 주고(출고수량 이상이면 전량 반납, 일부면 일부 반납), 반납 행은 구분 "반납"으로 따로 표시해
 * 정상 출고와 섞이지 않게 한다.
 *
 * 인증: 자재출고현황과 같은 권한(requireMaterialIssueReader — PURCHASE_ORDER READ + 세션 tenant 일치). 아무것도 쓰지 않는다.
 */

import { prisma } from "@/lib/db/prisma"
import { requireMaterialIssueReader } from "@/lib/material-issue/lot-read-access"
import {
  findIssueHistoryPage,
  kstDayRangeUtc,
  normalizeIssueDate,
  normalizeIssuePage,
  parseIssueSearchTerms,
} from "@/lib/material-issue/issue-search"
import {
  ISSUE_HISTORY_PAGE_SIZE,
  resolveReturnState,
  type MaterialIssueHistoryKind,
  type MaterialIssueHistoryState,
} from "@/lib/material-issue/issue-history"

export type MaterialIssueHistoryRow = {
  id: string
  txAt: string
  txNo: string
  kind: MaterialIssueHistoryKind
  state: MaterialIssueHistoryState
  workOrder: { id: string; orderNo: string; status: string; manufacturingNo: string | null }
  item: { id: string; code: string; name: string; uom: string }
  lotNo: string | null
  qty: number
  /** 출고 행: 같은 작업지시·품목·LOT 의 반납 누계(없으면 0). 반납 행은 0. */
  returnedQty: number
  warehouse: { id: string; code: string; name: string } | null
}

export type MaterialIssueHistoryPage = {
  rows: MaterialIssueHistoryRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  query: string
  from: string | null
  to: string | null
  warehouseId: string | null
}

export type MaterialIssueHistoryInput = { q?: string; from?: string; to?: string; warehouseId?: string; page?: number }

export async function getMaterialIssueHistory(
  clientTenantId: string,
  input: MaterialIssueHistoryInput = {},
): Promise<MaterialIssueHistoryPage> {
  const { tenantId } = await requireMaterialIssueReader(clientTenantId)
  const terms = parseIssueSearchTerms(input.q)
  const from = normalizeIssueDate(input.from)
  const to = normalizeIssueDate(input.to)
  const warehouseId = typeof input.warehouseId === "string" && input.warehouseId.trim() && input.warehouseId.length <= 64 ? input.warehouseId.trim() : null
  const { fromUtc, toUtcExclusive } = kstDayRangeUtc(from, to)

  const found = await findIssueHistoryPage(prisma, {
    tenantId,
    terms,
    fromUtc,
    toUtcExclusive,
    warehouseId,
    page: normalizeIssuePage(input.page),
    pageSize: ISSUE_HISTORY_PAGE_SIZE,
  })

  const base = { total: found.total, page: found.page, pageSize: ISSUE_HISTORY_PAGE_SIZE, totalPages: found.totalPages, query: terms.join(" "), from, to, warehouseId }
  if (found.ids.length === 0) return { rows: [], ...base }

  const txs = await prisma.inventoryTransaction.findMany({
    where: { tenantId, id: { in: found.ids } },
    select: {
      id: true,
      txNo: true,
      txType: true,
      qty: true,
      txAt: true,
      refId: true,
      itemId: true,
      lotId: true,
      item: { select: { id: true, code: true, name: true, uom: true } },
      lot: { select: { lotNo: true } },
      fromLocation: { select: { id: true, code: true, name: true } },
      toLocation: { select: { id: true, code: true, name: true } },
    },
  })
  const workOrderIds = Array.from(new Set(txs.map((t) => t.refId).filter((id): id is string => !!id)))
  const [workOrders, returns] = await Promise.all([
    prisma.workOrder.findMany({ where: { tenantId, id: { in: workOrderIds } }, select: { id: true, orderNo: true, status: true, manufacturingNo: true } }),
    prisma.inventoryTransaction.groupBy({
      by: ["refId", "itemId", "lotId"],
      where: { tenantId, refType: "WORK_ORDER", txType: "RETURN", refId: { in: workOrderIds } },
      _sum: { qty: true },
    }),
  ])
  const woById = new Map(workOrders.map((w) => [w.id, w]))
  const returnedKey = (woId: string | null, itemId: string, lotId: string | null) => `${woId}|${itemId}|${lotId ?? ""}`
  const returnedBy = new Map(returns.map((r) => [returnedKey(r.refId, r.itemId, r.lotId), Number(r._sum.qty ?? 0)]))
  const txById = new Map(txs.map((t) => [t.id, t]))

  const rows: MaterialIssueHistoryRow[] = []
  for (const id of found.ids) {
    const t = txById.get(id)
    const wo = t?.refId ? woById.get(t.refId) : undefined
    if (!t || !wo) continue
    const kind: MaterialIssueHistoryKind = String(t.txType) === "RETURN" ? "RETURN" : "ISSUE"
    const qty = Number(t.qty)
    const returnedQty = kind === "ISSUE" ? returnedBy.get(returnedKey(t.refId, t.itemId, t.lotId)) ?? 0 : 0
    const warehouse = kind === "ISSUE" ? t.fromLocation : t.toLocation
    rows.push({
      id: t.id,
      txAt: t.txAt.toISOString(),
      txNo: t.txNo,
      kind,
      state: resolveReturnState(kind, qty, returnedQty),
      workOrder: { id: wo.id, orderNo: wo.orderNo, status: String(wo.status), manufacturingNo: wo.manufacturingNo },
      item: t.item,
      lotNo: t.lot?.lotNo ?? null,
      qty,
      returnedQty,
      warehouse: warehouse ? { id: warehouse.id, code: warehouse.code, name: warehouse.name } : null,
    })
  }
  return { rows, ...base }
}

/** 출고창고 필터 선택지(해당 tenant 의 창고). */
export async function getMaterialIssueHistoryWarehouses(clientTenantId: string): Promise<Array<{ id: string; code: string; name: string }>> {
  const { tenantId } = await requireMaterialIssueReader(clientTenantId)
  return prisma.warehouse.findMany({ where: { tenantId }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } })
}
