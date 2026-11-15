"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId } from "@/lib/auth"
import { aggregateDefectStats } from "@/lib/quality/defect-stats-aggregate"
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

  // ─── 상세 목록(최신 ROW_LIMIT 건) ──────────────────────────────────────────
  const rows: DefectStatsRow[] = sliced.map((insp) => {
    const item = insp.workOrderOperation.workOrder.item
    const op = insp.workOrderOperation.routingOperation
    return {
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
      inspectedQty: Number(insp.inspectedQty),
      defectQty: insp.defectRecords.reduce((sum, dr) => sum + Number(dr.qty), 0),
      defectLabels: insp.defectRecords.map((dr) => `[${dr.defectCode.code}] ${dr.defectCode.name}`),
      inspectorName: insp.inspector.name,
    }
  })

  // ─── 요약·차트 집계: 목록 제한과 무관하게 필터 조건 전체를 DB 에서 집계 ─────────
  const agg = await aggregateDefectStats(prisma, {
    tenantId,
    from,
    toExclusive,
    stage: filter.stage,
    routingOperationId: filter.routingOperationId,
    itemId: filter.itemId,
    manufacturingNo: filter.manufacturingNo,
  })
  const rate = (defect: number, inspected: number) => (inspected > 0 ? defect / inspected : 0)

  const daily: DefectStatsDailyPoint[] = agg.daily.map((v) => ({
    date: v.date,
    inspectedQty: v.inspectedQty,
    defectQty: v.defectQty,
    defectRate: rate(v.defectQty, v.inspectedQty),
  }))

  const totalDefectForType = agg.byType.reduce((s, t) => s + t.qty, 0)
  const byType: DefectStatsByType[] = agg.byType
    .map((t) => ({
      defectCodeId: t.defectCodeId,
      code: t.code,
      name: t.name,
      category: t.category as DefectCategory,
      qty: t.qty,
      percentage: totalDefectForType > 0 ? t.qty / totalDefectForType : 0,
    }))
    .sort((a, b) => b.qty - a.qty)

  const byItem: DefectStatsByItem[] = agg.byItem
    .map((it) => ({
      itemId: it.itemId,
      code: it.code,
      name: it.name,
      inspectedQty: it.inspectedQty,
      defectQty: it.defectQty,
      defectRate: rate(it.defectQty, it.inspectedQty),
    }))
    .sort((a, b) => b.defectRate - a.defectRate)

  const byOperation: DefectStatsByOperation[] = agg.byOperation
    .map((op) => ({
      routingOperationId: op.routingOperationId,
      routingOperationName: op.name,
      seq: op.seq,
      inspectedQty: op.inspectedQty,
      defectQty: op.defectQty,
      defectRate: rate(op.defectQty, op.inspectedQty),
    }))
    .sort((a, b) => a.seq - b.seq)

  return {
    summary: {
      inspectionCount: agg.summary.inspectionCount,
      inspectedQty: agg.summary.inspectedQty,
      passQty: agg.summary.passQty,
      failQty: agg.summary.failQty,
      defectQty: agg.summary.defectQty,
      defectRate: rate(agg.summary.defectQty, agg.summary.inspectedQty),
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
