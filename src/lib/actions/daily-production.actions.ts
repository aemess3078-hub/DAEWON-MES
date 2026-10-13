"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId } from "@/lib/auth"

// ─── Types ────────────────────────────────────────────────────────────────────

export type DailyProductionSummary = {
  date:        string   // YYYY-MM-DD (KST)
  goodQty:     number
  defectQty:   number
  reworkQty:   number
  totalQty:    number   // good + defect + rework
  defectRate:  number   // 0–100 percentage
  resultCount: number   // 생산실적 건수
  latestAt:    string | null
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

// KST 달력 기준 '오늘' 범위를 실제 UTC instant 로 계산한다.
// ProductionResult.startedAt 은 실제 시각(UTC)이므로 KST 자정의 UTC instant 로 맞춘다.
function getTodayRangeKst(): { date: string; from: Date; to: Date } {
  const date = new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10)
  const from = new Date(`${date}T00:00:00+09:00`)
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1)
  return { date, from, to }
}

// ─── 일일 생산현황 요약 (KST 오늘) ──────────────────────────────────────────────

export async function getDailyProductionSummary(): Promise<DailyProductionSummary> {
  const tenantId = await getTenantId()
  const { date, from, to } = getTodayRangeKst()

  const results = await prisma.productionResult.findMany({
    where: {
      startedAt: { gte: from, lte: to },
      workOrderOperation: {
        workOrder: { tenantId },
      },
    },
    select: {
      goodQty:   true,
      defectQty: true,
      reworkQty: true,
      startedAt: true,
    },
  })

  let goodQty = 0
  let defectQty = 0
  let reworkQty = 0
  let latestAt: string | null = null

  for (const r of results) {
    goodQty   += Number(r.goodQty)
    defectQty += Number(r.defectQty)
    reworkQty += Number(r.reworkQty)
    const startedAtStr = r.startedAt?.toISOString() ?? null
    if (startedAtStr && (!latestAt || startedAtStr > latestAt)) {
      latestAt = startedAtStr
    }
  }

  const totalQty = goodQty + defectQty + reworkQty
  const defectRate = totalQty > 0 ? (defectQty / totalQty) * 100 : 0

  return {
    date,
    goodQty,
    defectQty,
    reworkQty,
    totalQty,
    defectRate,
    resultCount: results.length,
    latestAt,
  }
}
