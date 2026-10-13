"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId } from "@/lib/auth"
import { isMissingDbObjectError } from "@/lib/db/prisma-error"
import {
  kstDateRangeToUtcBounds,
  kstDefaultDateRange,
  toKstDateKey,
} from "@/lib/date/kst"
import {
  InspectionStage,
  InspectionResult,
  DefectCategory,
  DefectSeverity,
} from "@prisma/client"

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export type DefectStatsFilter = {
  from?: string // ISO date (YYYY-MM-DD)
  to?: string
  itemId?: string
  routingOperationId?: string
  manufacturingNo?: string
  stage?: InspectionStage
}

export type DefectStatsSummary = {
  inspectionCount: number
  inspectedQty: number
  passQty: number
  failQty: number
  defectQty: number
  defectRate: number // 0~1
}

export type DefectStatsDailyPoint = {
  date: string // YYYY-MM-DD
  inspectedQty: number
  defectQty: number
  defectRate: number
}

export type DefectStatsByType = {
  defectCodeId: string
  code: string
  name: string
  category: DefectCategory
  qty: number
  percentage: number // 0~1 (전체 불량 중 비중)
}

export type DefectStatsByItem = {
  itemId: string
  code: string
  name: string
  inspectedQty: number
  defectQty: number
  defectRate: number
}

export type DefectStatsByOperation = {
  routingOperationId: string
  routingOperationName: string
  seq: number
  inspectedQty: number
  defectQty: number
  defectRate: number
}

export type DefectStatsRow = {
  id: string
  inspectedAt: string // ISO
  manufacturingNo: string | null
  orderNo: string
  itemCode: string
  itemName: string
  routingOperationName: string
  routingOperationSeq: number
  stage: InspectionStage
  result: InspectionResult | null
  inspectedQty: number
  defectQty: number
  defectLabels: string[] // 불량코드 표시용 ("[CODE] 이름")
  inspectorName: string
}

export type DefectStatsResult = {
  summary: DefectStatsSummary
  daily: DefectStatsDailyPoint[]
  byType: DefectStatsByType[]
  byItem: DefectStatsByItem[]
  byOperation: DefectStatsByOperation[]
  rows: DefectStatsRow[]
  truncated: boolean // rows가 limit에 걸려 잘렸는지
}

export type DefectStatsFilterOptions = {
  items: { id: string; code: string; name: string }[]
  routingOperations: {
    id: string
    name: string
    seq: number
    routingCode: string
    routingName: string
  }[]
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

const ROW_LIMIT = 500

function emptyDefectStats(): DefectStatsResult {
  return {
    summary: {
      inspectionCount: 0,
      inspectedQty: 0,
      passQty: 0,
      failQty: 0,
      defectQty: 0,
      defectRate: 0,
    },
    daily: [],
    byType: [],
    byItem: [],
    byOperation: [],
    rows: [],
    truncated: false,
  }
}

function toDateOnly(d: Date): string {
  return toKstDateKey(d)
}

function parseDateRange(filter: DefectStatsFilter): { from: Date; toExclusive: Date } {
  const fallback = kstDefaultDateRange(30)
  const fromKey = filter.from ?? fallback.from
  const toKey = filter.to ?? fallback.to
  const { fromDate, toExclusiveDate } = kstDateRangeToUtcBounds(fromKey, toKey)
  return { from: fromDate, toExclusive: toExclusiveDate }
}

// ─── 메인 통계 조회 ───────────────────────────────────────────────────────────

export async function getDefectStats(
  filter: DefectStatsFilter = {}
): Promise<DefectStatsResult> {
  const tenantId = await getTenantId()
  const { from, toExclusive } = parseDateRange(filter)

  const inspections = await prisma.qualityInspection.findMany({
    where: {
      inspectedAt: { gte: from, lt: toExclusive },
      ...(filter.stage && { stage: filter.stage }),
      workOrderOperation: {
        ...(filter.routingOperationId && {
          routingOperationId: filter.routingOperationId,
        }),
        workOrder: {
          tenantId,
          ...(filter.itemId && { itemId: filter.itemId }),
          ...(filter.manufacturingNo && {
            manufacturingNo: filter.manufacturingNo,
          }),
        },
      },
    },
    include: {
      workOrderOperation: {
        include: {
          workOrder: {
            select: {
              id: true,
              orderNo: true,
              manufacturingNo: true,
              item: { select: { id: true, code: true, name: true } },
            },
          },
          routingOperation: { select: { id: true, name: true, seq: true } },
        },
      },
      inspector: { select: { id: true, name: true } },
      defectRecords: {
        include: {
          defectCode: {
            select: { id: true, code: true, name: true, defectCategory: true },
          },
        },
      },
    },
    orderBy: { inspectedAt: "desc" },
    take: ROW_LIMIT + 1, // truncated 여부 판단용
  }).catch((error) => {
    if (isMissingDbObjectError(error)) return null
    throw error
  })

  if (!inspections) return emptyDefectStats()

  const truncated = inspections.length > ROW_LIMIT
  const sliced = truncated ? inspections.slice(0, ROW_LIMIT) : inspections

  // ─── Summary ─────────────────────────────────────────────────────────────
  let inspectedQtySum = 0
  let passQtySum = 0
  let failQtySum = 0
  let defectQtySum = 0

  // ─── 일자별 / 불량유형 / 품목 / 공정 집계 ─────────────────────────────
  const dailyMap = new Map<
    string,
    { inspectedQty: number; defectQty: number }
  >()
  const byTypeMap = new Map<
    string,
    {
      defectCodeId: string
      code: string
      name: string
      category: DefectCategory
      qty: number
    }
  >()
  const byItemMap = new Map<
    string,
    {
      itemId: string
      code: string
      name: string
      inspectedQty: number
      defectQty: number
    }
  >()
  const byOperationMap = new Map<
    string,
    {
      routingOperationId: string
      routingOperationName: string
      seq: number
      inspectedQty: number
      defectQty: number
    }
  >()

  const rows: DefectStatsRow[] = []

  for (const insp of sliced) {
    const inspectedQty = Number(insp.inspectedQty)
    const defectQty = insp.defectRecords.reduce(
      (sum, dr) => sum + Number(dr.qty),
      0
    )

    inspectedQtySum += inspectedQty
    if (insp.result === "PASS") passQtySum += inspectedQty
    if (insp.result === "FAIL") failQtySum += inspectedQty
    defectQtySum += defectQty

    // daily
    const dateKey = toDateOnly(insp.inspectedAt)
    const dailyEntry = dailyMap.get(dateKey) ?? {
      inspectedQty: 0,
      defectQty: 0,
    }
    dailyEntry.inspectedQty += inspectedQty
    dailyEntry.defectQty += defectQty
    dailyMap.set(dateKey, dailyEntry)

    // by item
    const item = insp.workOrderOperation.workOrder.item
    const itemEntry = byItemMap.get(item.id) ?? {
      itemId: item.id,
      code: item.code,
      name: item.name,
      inspectedQty: 0,
      defectQty: 0,
    }
    itemEntry.inspectedQty += inspectedQty
    itemEntry.defectQty += defectQty
    byItemMap.set(item.id, itemEntry)

    // by operation
    const op = insp.workOrderOperation.routingOperation
    const opEntry = byOperationMap.get(op.id) ?? {
      routingOperationId: op.id,
      routingOperationName: op.name,
      seq: op.seq,
      inspectedQty: 0,
      defectQty: 0,
    }
    opEntry.inspectedQty += inspectedQty
    opEntry.defectQty += defectQty
    byOperationMap.set(op.id, opEntry)

    // by defect type
    for (const dr of insp.defectRecords) {
      const dc = dr.defectCode
      const typeEntry = byTypeMap.get(dc.id) ?? {
        defectCodeId: dc.id,
        code: dc.code,
        name: dc.name,
        category: dc.defectCategory,
        qty: 0,
      }
      typeEntry.qty += Number(dr.qty)
      byTypeMap.set(dc.id, typeEntry)
    }

    // detail row
    rows.push({
      id: insp.id,
      inspectedAt: insp.inspectedAt.toISOString(),
      manufacturingNo: insp.workOrderOperation.workOrder.manufacturingNo,
      orderNo: insp.workOrderOperation.workOrder.orderNo,
      itemCode: item.code,
      itemName: item.name,
      routingOperationName: op.name,
      routingOperationSeq: op.seq,
      stage: insp.stage,
      result: insp.result,
      inspectedQty,
      defectQty,
      defectLabels: insp.defectRecords.map(
        (dr) => `[${dr.defectCode.code}] ${dr.defectCode.name}`
      ),
      inspectorName: insp.inspector.name,
    })
  }

  const defectRate = inspectedQtySum > 0 ? defectQtySum / inspectedQtySum : 0

  // ─── daily: 정렬 + 비율 계산 ──────────────────────────────────────────
  const daily: DefectStatsDailyPoint[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      inspectedQty: v.inspectedQty,
      defectQty: v.defectQty,
      defectRate: v.inspectedQty > 0 ? v.defectQty / v.inspectedQty : 0,
    }))

  // ─── byType: 비중 ─────────────────────────────────────────────────────
  const totalDefectForType = Array.from(byTypeMap.values()).reduce(
    (s, t) => s + t.qty,
    0
  )
  const byType: DefectStatsByType[] = Array.from(byTypeMap.values())
    .map((t) => ({
      defectCodeId: t.defectCodeId,
      code: t.code,
      name: t.name,
      category: t.category,
      qty: t.qty,
      percentage: totalDefectForType > 0 ? t.qty / totalDefectForType : 0,
    }))
    .sort((a, b) => b.qty - a.qty)

  // ─── byItem: 비율 ────────────────────────────────────────────────────
  const byItem: DefectStatsByItem[] = Array.from(byItemMap.values())
    .map((it) => ({
      itemId: it.itemId,
      code: it.code,
      name: it.name,
      inspectedQty: it.inspectedQty,
      defectQty: it.defectQty,
      defectRate: it.inspectedQty > 0 ? it.defectQty / it.inspectedQty : 0,
    }))
    .sort((a, b) => b.defectRate - a.defectRate)

  // ─── byOperation: 비율 ────────────────────────────────────────────────
  const byOperation: DefectStatsByOperation[] = Array.from(
    byOperationMap.values()
  )
    .map((op) => ({
      routingOperationId: op.routingOperationId,
      routingOperationName: op.routingOperationName,
      seq: op.seq,
      inspectedQty: op.inspectedQty,
      defectQty: op.defectQty,
      defectRate: op.inspectedQty > 0 ? op.defectQty / op.inspectedQty : 0,
    }))
    .sort((a, b) => a.seq - b.seq)

  return {
    summary: {
      inspectionCount: sliced.length,
      inspectedQty: inspectedQtySum,
      passQty: passQtySum,
      failQty: failQtySum,
      defectQty: defectQtySum,
      defectRate,
    },
    daily,
    byType,
    byItem,
    byOperation,
    rows,
    truncated,
  }
}

// ─── 필터 옵션 ────────────────────────────────────────────────────────────────

export async function getDefectStatsFilterOptions(): Promise<DefectStatsFilterOptions> {
  const tenantId = await getTenantId()

  const [items, ops] = await Promise.all([
    prisma.item.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.routingOperation.findMany({
      where: { routing: { tenantId } },
      select: {
        id: true,
        name: true,
        seq: true,
        routing: { select: { code: true, name: true } },
      },
      orderBy: [{ routing: { code: "asc" } }, { seq: "asc" }],
    }),
  ])

  return {
    items,
    routingOperations: ops.map((op) => ({
      id: op.id,
      name: op.name,
      seq: op.seq,
      routingCode: op.routing.code,
      routingName: op.routing.name,
    })),
  }
}

// 사용처에서 import용 — 심각도 표시(필요 시)
export type { DefectSeverity }
