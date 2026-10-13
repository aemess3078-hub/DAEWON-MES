"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId } from "@/lib/auth"
import { resolveActualProductionEquipment } from "@/lib/equipment-result-attribution"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

// ─── Types ────────────────────────────────────────────────────────────────────

export type EquipmentOutputRow = {
  equipmentId:    string
  equipmentCode:  string
  equipmentName:  string
  equipmentType:  string
  siteName:       string
  workCenterName: string
  goodQty:        number
  defectQty:      number
  reworkQty:      number
  totalQty:       number
  defectRate:     number   // 0–100 percentage
  workTimeMin:    number   // total minutes
  resultCount:    number
  latestAt:       string | null
}

export type PeriodType = "day" | "week" | "month" | "year" | "range"

export type EquipmentOutputFilter = {
  from: string       // YYYY-MM-DD (computed)
  to: string         // YYYY-MM-DD (computed)
  periodType: PeriodType
  periodDate: string   // YYYY-MM-DD — UI state for day/week
  periodMonth: string  // YYYY-MM   — UI state for month
  periodYear: string   // YYYY      — UI state for year
}

// ─── 설비별 생산실적 집계 ──────────────────────────────────────────────────────

export async function getEquipmentOutputStats(
  filter: Pick<EquipmentOutputFilter, "from" | "to">
): Promise<EquipmentOutputRow[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()

  const from = new Date(`${filter.from}T00:00:00.000`)
  const to   = new Date(`${filter.to}T23:59:59.999`)

  const results = await prisma.productionResult.findMany({
    where: {
      startedAt: { gte: from, lte: to },
      workOrderOperation: {
        workOrder: { tenantId },
      },
      OR: [
        { workOrderOperationAssignmentId: { not: null } },
        { workOrderOperation: { equipmentId: { not: null } } },
      ],
    },
    select: {
      id:        true,
      goodQty:   true,
      defectQty: true,
      reworkQty: true,
      startedAt: true,
      endedAt:   true,
      workOrderOperationAssignment: {
        select: {
          equipment: {
            select: {
              id:            true,
              code:          true,
              name:          true,
              equipmentType: true,
              site:       { select: { name: true } },
              workCenter: { select: { name: true } },
            },
          },
        },
      },
      workOrderOperation: {
        select: {
          equipment: {
            select: {
              id:            true,
              code:          true,
              name:          true,
              equipmentType: true,
              site:       { select: { name: true } },
              workCenter: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { startedAt: "desc" },
  })

  // ── 설비별로 그룹핑 ──────────────────────────────────────────────────────────
  const map = new Map<string, EquipmentOutputRow>()

  for (const r of results) {
    const eq = resolveActualProductionEquipment(r)
    if (!eq) continue

    const good    = Number(r.goodQty)
    const defect  = Number(r.defectQty)
    const rework  = Number(r.reworkQty)
    const workMin =
      r.startedAt && r.endedAt
        ? (r.endedAt.getTime() - r.startedAt.getTime()) / 60_000
        : 0
    const startedAtStr = r.startedAt?.toISOString() ?? null

    const existing = map.get(eq.id)
    if (existing) {
      existing.goodQty     += good
      existing.defectQty   += defect
      existing.reworkQty   += rework
      existing.totalQty    += good + defect + rework
      existing.workTimeMin += workMin
      existing.resultCount += 1
      if (startedAtStr && (!existing.latestAt || startedAtStr > existing.latestAt)) {
        existing.latestAt = startedAtStr
      }
    } else {
      map.set(eq.id, {
        equipmentId:    eq.id,
        equipmentCode:  eq.code,
        equipmentName:  eq.name,
        equipmentType:  eq.equipmentType,
        siteName:       eq.site.name,
        workCenterName: eq.workCenter.name,
        goodQty:        good,
        defectQty:      defect,
        reworkQty:      rework,
        totalQty:       good + defect + rework,
        defectRate:     0,
        workTimeMin:    workMin,
        resultCount:    1,
        latestAt:       startedAtStr,
      })
    }
  }

  // ── 불량률 계산 + 최근실적 기준 정렬 ──────────────────────────────────────────
  const rows = Array.from(map.values())

  for (const row of rows) {
    const denom = row.goodQty + row.defectQty + row.reworkQty
    row.defectRate = denom > 0 ? (row.defectQty / denom) * 100 : 0
  }

  rows.sort((a, b) => {
    if (!a.latestAt) return 1
    if (!b.latestAt) return -1
    return b.latestAt > a.latestAt ? 1 : b.latestAt < a.latestAt ? -1 : 0
  })

  return rows
}
