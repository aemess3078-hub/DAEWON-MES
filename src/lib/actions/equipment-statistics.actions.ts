"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId } from "@/lib/auth"
import { monitoringEligibleEquipmentWhere } from "@/lib/actions/equipment-monitoring.utils"
import { kstDateRangeToUtcBounds, kstDefaultDateRange, toKstDateKey } from "@/lib/date/kst"
import {
  actualProductionEquipmentWhere,
  resolveActualProductionEquipment,
} from "@/lib/equipment-result-attribution"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

// ─── Types ────────────────────────────────────────────────────────────────────

export type EquipStatFilter = {
  from: string // YYYY-MM-DD
  to: string
  equipmentId?: string
}

function parseDateRange(f: EquipStatFilter) {
  const { fromDate, toExclusiveDate } = kstDateRangeToUtcBounds(f.from, f.to)
  return { from: fromDate, toExclusive: toExclusiveDate }
}

function defaultDateRange(): { from: string; to: string } {
  return kstDefaultDateRange(30)
}

// ─── 1. 생산량 통계 ──────────────────────────────────────────────────────────

export type ProductionStats = {
  totalGoodQty: number
  totalDefectQty: number
  defectRate: number | null
  resultCount: number
  rows: Array<{
    date: string
    equipmentId: string
    equipmentCode: string
    equipmentName: string
    goodQty: number
    defectQty: number
  }>
}

async function fetchProductionStats(
  tenantId: string,
  f: EquipStatFilter
): Promise<ProductionStats> {
  const { from, toExclusive } = parseDateRange(f)

  const results = await prisma.productionResult.findMany({
    where: {
      startedAt: { gte: from, lt: toExclusive },
      workOrderOperation: {
        workOrder: { tenantId },
      },
      ...actualProductionEquipmentWhere(f.equipmentId),
    },
    select: {
      startedAt: true,
      goodQty: true,
      defectQty: true,
      workOrderOperationAssignment: {
        select: {
          equipment: { select: { id: true, code: true, name: true } },
        },
      },
      workOrderOperation: {
        select: {
          equipment: { select: { id: true, code: true, name: true } },
        },
      },
    },
  })

  const dayMap = new Map<
    string,
    {
      date: string
      equipmentId: string
      equipmentCode: string
      equipmentName: string
      goodQty: number
      defectQty: number
    }
  >()
  let totalGoodQty = 0
  let totalDefectQty = 0
  let resultCount = 0

  for (const r of results) {
    if (!r.startedAt) continue
    const equipment = resolveActualProductionEquipment(r)
    if (!equipment) continue
    const gq = Number(r.goodQty)
    const dq = Number(r.defectQty)
    totalGoodQty += gq
    totalDefectQty += dq
    resultCount++
    const date = toKstDateKey(r.startedAt)
    const key = `${date}|${equipment.id}`
    const e = dayMap.get(key) ?? {
      date,
      equipmentId: equipment.id,
      equipmentCode: equipment.code,
      equipmentName: equipment.name,
      goodQty: 0,
      defectQty: 0,
    }
    e.goodQty += gq
    e.defectQty += dq
    dayMap.set(key, e)
  }

  const totalProd = totalGoodQty + totalDefectQty
  const rows = Array.from(dayMap.values())
    .sort((a, b) => a.date.localeCompare(b.date) || a.equipmentCode.localeCompare(b.equipmentCode))
    .map((v) => ({
      ...v,
      goodQty: Math.round(v.goodQty * 10) / 10,
      defectQty: Math.round(v.defectQty * 10) / 10,
    }))

  return {
    totalGoodQty: Math.round(totalGoodQty * 10) / 10,
    totalDefectQty: Math.round(totalDefectQty * 10) / 10,
    defectRate: totalProd > 0 ? totalDefectQty / totalProd : null,
    resultCount,
    rows,
  }
}

// ─── 2. 에러 통계 ─────────────────────────────────────────────────────────────

export type ErrorStats = {
  total: number
  alarmCount: number
  warningCount: number
  rows: Array<{
    equipmentCode: string
    equipmentName: string
    alarmCount: number
    warningCount: number
  }>
}

async function fetchErrorStats(
  tenantId: string,
  f: EquipStatFilter
): Promise<ErrorStats> {
  const { from, toExclusive } = parseDateRange(f)

  const events = await prisma.equipmentEvent.findMany({
    where: {
      eventType: { in: ["ALARM", "WARNING"] },
      startedAt: { gte: from, lt: toExclusive },
      equipment: {
        tenantId,
        ...(f.equipmentId ? { id: f.equipmentId } : {}),
      },
    },
    select: {
      eventType: true,
      equipment: { select: { code: true, name: true } },
    },
  })

  const eqMap = new Map<
    string,
    { equipmentCode: string; equipmentName: string; alarmCount: number; warningCount: number }
  >()

  let alarmCount = 0
  let warningCount = 0

  for (const ev of events) {
    const key = ev.equipment.code
    const e = eqMap.get(key) ?? {
      equipmentCode: ev.equipment.code,
      equipmentName: ev.equipment.name,
      alarmCount: 0,
      warningCount: 0,
    }
    if (ev.eventType === "ALARM") {
      e.alarmCount++
      alarmCount++
    } else {
      e.warningCount++
      warningCount++
    }
    eqMap.set(key, e)
  }

  return {
    total: events.length,
    alarmCount,
    warningCount,
    rows: Array.from(eqMap.values()).sort((a, b) =>
      a.equipmentCode.localeCompare(b.equipmentCode)
    ),
  }
}

// ─── 3. 비가동 시간 통계 ──────────────────────────────────────────────────────

export type DowntimeStats = {
  totalMinutes: number
  eventCount: number
  rows: Array<{
    equipmentCode: string
    equipmentName: string
    stopMinutes: number
    maintenanceMinutes: number
    total: number
  }>
}

async function fetchDowntimeStats(
  tenantId: string,
  f: EquipStatFilter
): Promise<DowntimeStats> {
  const { from, toExclusive } = parseDateRange(f)

  const downtimeRecords = await prisma.equipmentDowntime.findMany({
    where: {
      startedAt: { gte: from, lt: toExclusive },
      equipment: {
        tenantId,
        ...(f.equipmentId ? { id: f.equipmentId } : {}),
      },
    },
    select: {
      eventType: true,
      startedAt: true,
      endedAt: true,
      equipment: { select: { code: true, name: true } },
    },
  })

  const eqMap = new Map<
    string,
    { equipmentCode: string; equipmentName: string; stopMinutes: number; maintenanceMinutes: number }
  >()

  let totalMinutes = 0

  for (const record of downtimeRecords) {
    const mins = record.endedAt
      ? (record.endedAt.getTime() - record.startedAt.getTime()) / 60_000
      : 0

    totalMinutes += mins
    const key = record.equipment.code
    const e = eqMap.get(key) ?? {
      equipmentCode: record.equipment.code,
      equipmentName: record.equipment.name,
      stopMinutes: 0,
      maintenanceMinutes: 0,
    }
    if (record.eventType === "STOP") e.stopMinutes += mins
    else e.maintenanceMinutes += mins
    eqMap.set(key, e)
  }

  return {
    totalMinutes: Math.round(totalMinutes),
    eventCount: downtimeRecords.length,
    rows: Array.from(eqMap.values())
      .map((e) => ({
        ...e,
        stopMinutes: Math.round(e.stopMinutes),
        maintenanceMinutes: Math.round(e.maintenanceMinutes),
        total: Math.round(e.stopMinutes + e.maintenanceMinutes),
      }))
      .sort((a, b) => b.total - a.total),
  }
}

// ─── 4. 작업시간 통계 ─────────────────────────────────────────────────────────

export type WorkTimeStats = {
  totalHours: number | null
  resultCount: number
  rows: Array<{
    date: string
    equipmentId: string
    equipmentCode: string
    equipmentName: string
    hours: number
    goodQty: number
  }>
}

async function fetchWorkTimeStats(
  tenantId: string,
  f: EquipStatFilter
): Promise<WorkTimeStats> {
  const { from, toExclusive } = parseDateRange(f)

  const results = await prisma.productionResult.findMany({
    where: {
      startedAt: { gte: from, lt: toExclusive },
      endedAt: { not: null },
      workOrderOperation: {
        workOrder: { tenantId },
      },
      ...actualProductionEquipmentWhere(f.equipmentId),
    },
    select: {
      startedAt: true,
      endedAt: true,
      goodQty: true,
      workOrderOperationAssignment: {
        select: {
          equipment: { select: { id: true, code: true, name: true } },
        },
      },
      workOrderOperation: {
        select: {
          equipment: { select: { id: true, code: true, name: true } },
        },
      },
    },
  })

  const dayMap = new Map<
    string,
    {
      date: string
      equipmentId: string
      equipmentCode: string
      equipmentName: string
      hours: number
      goodQty: number
    }
  >()
  let totalHours = 0
  let resultCount = 0

  for (const r of results) {
    if (!r.startedAt || !r.endedAt) continue
    const equipment = resolveActualProductionEquipment(r)
    if (!equipment) continue
    const h = (r.endedAt.getTime() - r.startedAt.getTime()) / 3_600_000
    totalHours += h
    resultCount++
    const date = toKstDateKey(r.startedAt)
    const key = `${date}|${equipment.id}`
    const e = dayMap.get(key) ?? {
      date,
      equipmentId: equipment.id,
      equipmentCode: equipment.code,
      equipmentName: equipment.name,
      hours: 0,
      goodQty: 0,
    }
    e.hours += h
    e.goodQty += Number(r.goodQty)
    dayMap.set(key, e)
  }

  const rows = Array.from(dayMap.values())
    .sort((a, b) => a.date.localeCompare(b.date) || a.equipmentCode.localeCompare(b.equipmentCode))
    .map((v) => ({
      ...v,
      hours: Math.round(v.hours * 10) / 10,
      goodQty: Math.round(v.goodQty * 10) / 10,
    }))

  return {
    totalHours: resultCount > 0 ? Math.round(totalHours * 10) / 10 : null,
    resultCount,
    rows,
  }
}

// ─── 5. 설비가동률 ────────────────────────────────────────────────────────────

export type AvailabilityStats = {
  avgRate: number | null
  equipmentCount: number
  rows: Array<{ code: string; name: string; runMinutes: number; rate: number | null }>
}

async function fetchAvailabilityStats(
  tenantId: string,
  f: EquipStatFilter
): Promise<AvailabilityStats> {
  const { from, toExclusive } = parseDateRange(f)
  const totalMinutes = (toExclusive.getTime() - from.getTime()) / 60_000

  const equipments = await prisma.equipment.findMany({
    where: {
      ...monitoringEligibleEquipmentWhere(tenantId),
      ...(f.equipmentId ? { id: f.equipmentId } : {}),
    },
    select: {
      code: true,
      name: true,
      events: {
        where: {
          eventType: "RUN",
          startedAt: { gte: from, lt: toExclusive },
        },
        select: { startedAt: true, endedAt: true, duration: true },
      },
    },
    orderBy: { code: "asc" },
  })

  if (equipments.length === 0) {
    return { avgRate: null, equipmentCount: 0, rows: [] }
  }

  const rows = equipments.map((eq) => {
    const runMinutes = eq.events.reduce((sum, ev) => {
      if (ev.duration != null) return sum + ev.duration / 60
      if (ev.startedAt && ev.endedAt)
        return sum + (ev.endedAt.getTime() - ev.startedAt.getTime()) / 60_000
      return sum
    }, 0)
    return {
      code: eq.code,
      name: eq.name,
      runMinutes: Math.round(runMinutes),
      rate: totalMinutes > 0 ? runMinutes / totalMinutes : null,
    }
  })

  const withEvents = rows.filter((r) => r.runMinutes > 0)
  const avgRate =
    withEvents.length > 0
      ? withEvents.reduce((s, r) => s + (r.rate ?? 0), 0) / withEvents.length
      : null

  return { avgRate, equipmentCount: equipments.length, rows }
}

// ─── 에러 이력 조회 (설비관리 > 에러보기) ────────────────────────────────────
//   fetchErrorStats()는 집계(통계) 용도이고,
//   getEquipmentErrorEvents()는 상세 이력 조회 용도이다.

export type ErrorEventRow = {
  id: string
  equipmentId: string
  equipmentCode: string
  equipmentName: string
  eventType: string          // "ALARM" | "WARNING"
  message: string | null
  startedAt: Date
  endedAt: Date | null
  durationSeconds: number | null
}

export type ErrorEventSummary = {
  total: number
  alarmCount: number
  warningCount: number
  activeCount: number        // endedAt is null (미해제)
  totalDurationSeconds: number
}

export type ErrorEventAppliedFilter = {
  from: string
  to: string
  equipmentId: string | undefined
}

export async function getEquipmentErrorEvents(
  fromOverride?: string,
  toOverride?: string,
  equipmentId?: string
): Promise<{
  events: ErrorEventRow[]
  summary: ErrorEventSummary
  appliedFilter: ErrorEventAppliedFilter
}> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const defaults = defaultDateRange()

  const from = fromOverride ?? defaults.from
  const to   = toOverride   ?? defaults.to

  const { fromDate, toExclusiveDate } = kstDateRangeToUtcBounds(from, to)

  const rawEvents = await prisma.equipmentEvent.findMany({
    where: {
      eventType: { in: ["ALARM", "WARNING"] },
      startedAt: { gte: fromDate, lt: toExclusiveDate },
      equipment: {
        tenantId,
        ...(equipmentId ? { id: equipmentId } : {}),
      },
    },
    select: {
      id:        true,
      eventType: true,
      message:   true,
      startedAt: true,
      endedAt:   true,
      duration:  true,
      equipment: { select: { id: true, code: true, name: true } },
    },
    orderBy: { startedAt: "desc" },
  })

  const events: ErrorEventRow[] = rawEvents.map((ev) => {
    const dur =
      ev.duration != null
        ? ev.duration
        : ev.endedAt != null
        ? Math.round(
            (ev.endedAt.getTime() - ev.startedAt.getTime()) / 1000
          )
        : null
    return {
      id:              ev.id,
      equipmentId:     ev.equipment.id,
      equipmentCode:   ev.equipment.code,
      equipmentName:   ev.equipment.name,
      eventType:       ev.eventType as string,
      message:         ev.message,
      startedAt:       ev.startedAt,
      endedAt:         ev.endedAt,
      durationSeconds: dur,
    }
  })

  const summary: ErrorEventSummary = {
    total:                events.length,
    alarmCount:           events.filter((e) => e.eventType === "ALARM").length,
    warningCount:         events.filter((e) => e.eventType === "WARNING").length,
    activeCount:          events.filter((e) => e.endedAt === null).length,
    totalDurationSeconds: events.reduce(
      (sum, e) => sum + (e.durationSeconds ?? 0),
      0
    ),
  }

  return {
    events,
    summary,
    appliedFilter: { from, to, equipmentId },
  }
}

// ─── 설비 목록 (필터용) ────────────────────────────────────────────────────────

export type EquipmentOption = { id: string; code: string; name: string }

export async function getEquipmentOptions(): Promise<EquipmentOption[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  return prisma.equipment.findMany({
    where: monitoringEligibleEquipmentWhere(tenantId),
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  })
}

// ─── 전체 통계 집계 ───────────────────────────────────────────────────────────

export type EquipmentStatisticsData = {
  filter: EquipStatFilter
  production: ProductionStats
  errors: ErrorStats
  downtime: DowntimeStats
  workTime: WorkTimeStats
  availability: AvailabilityStats
}

export async function getEquipmentStatisticsData(
  filterOverride?: Partial<EquipStatFilter>
): Promise<EquipmentStatisticsData> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const defaults = defaultDateRange()
  const filter: EquipStatFilter = {
    from: filterOverride?.from ?? defaults.from,
    to: filterOverride?.to ?? defaults.to,
    equipmentId: filterOverride?.equipmentId,
  }

  const [production, errors, downtime, workTime, availability] = await Promise.all([
    fetchProductionStats(tenantId, filter),
    fetchErrorStats(tenantId, filter),
    fetchDowntimeStats(tenantId, filter),
    fetchWorkTimeStats(tenantId, filter),
    fetchAvailabilityStats(tenantId, filter),
  ])

  return { filter, production, errors, downtime, workTime, availability }
}

// ─── 6. 설비 처리능력(CAPA) 분석 ─────────────────────────────────────────────

export type CapacityRow = {
  equipmentId: string
  equipmentCode: string
  equipmentName: string
  totalGoodQty: number
  workMinutes: number
  actualUPH: number | null
  stdUPH: number | null
  achievementRate: number | null
  isBottleneck: boolean
  resultCount: number
}

export type CapacityStats = {
  rows: CapacityRow[]
  totalEquipmentCount: number
  bottleneckCount: number
  avgAchievementRate: number | null
  avgUPH: number | null
  filter: EquipStatFilter
}

export async function getEquipmentCapacityStats(
  filterOverride?: Partial<EquipStatFilter>
): Promise<CapacityStats> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const defaults = defaultDateRange()
  const filter: EquipStatFilter = {
    from: filterOverride?.from ?? defaults.from,
    to: filterOverride?.to ?? defaults.to,
    equipmentId: filterOverride?.equipmentId,
  }
  const { from, toExclusive } = parseDateRange(filter)

  const results = await prisma.productionResult.findMany({
    where: {
      startedAt: { gte: from, lt: toExclusive },
      endedAt: { not: null },
      workOrderOperation: {
        workOrder: { tenantId },
      },
      ...actualProductionEquipmentWhere(filter.equipmentId),
    },
    select: {
      goodQty: true,
      startedAt: true,
      endedAt: true,
      workOrderOperationAssignment: {
        select: {
          equipment: { select: { id: true, code: true, name: true } },
        },
      },
      workOrderOperation: {
        select: {
          equipment: { select: { id: true, code: true, name: true } },
          routingOperation: { select: { standardTime: true } },
        },
      },
    },
  })

  type EqAgg = {
    equipmentId: string
    equipmentCode: string
    equipmentName: string
    totalGoodQty: number
    workMs: number
    stdTimeSecs: number[]
    resultCount: number
  }
  const eqMap = new Map<string, EqAgg>()

  for (const r of results) {
    const equipment = resolveActualProductionEquipment(r)
    if (!equipment) continue
    const key = equipment.id
    const e = eqMap.get(key) ?? {
      equipmentId: equipment.id,
      equipmentCode: equipment.code,
      equipmentName: equipment.name,
      totalGoodQty: 0,
      workMs: 0,
      stdTimeSecs: [],
      resultCount: 0,
    }
    e.totalGoodQty += Number(r.goodQty)
    if (r.startedAt && r.endedAt) {
      e.workMs += r.endedAt.getTime() - r.startedAt.getTime()
    }
    const st = Number(r.workOrderOperation.routingOperation.standardTime)
    if (st > 0) e.stdTimeSecs.push(st)
    e.resultCount++
    eqMap.set(key, e)
  }

  const rows: CapacityRow[] = Array.from(eqMap.values()).map((e) => {
    const workMinutes = Math.round(e.workMs / 60_000)
    const workHours = e.workMs / 3_600_000
    const actualUPH = workHours > 0 ? Math.round((e.totalGoodQty / workHours) * 10) / 10 : null
    const avgStdSecs =
      e.stdTimeSecs.length > 0
        ? e.stdTimeSecs.reduce((s, v) => s + v, 0) / e.stdTimeSecs.length
        : 0
    const stdUPH = avgStdSecs > 0 ? Math.round((3600 / avgStdSecs) * 10) / 10 : null
    const achievementRate =
      actualUPH !== null && stdUPH !== null && stdUPH > 0
        ? Math.round((actualUPH / stdUPH) * 1000) / 10
        : null
    return {
      equipmentId: e.equipmentId,
      equipmentCode: e.equipmentCode,
      equipmentName: e.equipmentName,
      totalGoodQty: Math.round(e.totalGoodQty * 10) / 10,
      workMinutes,
      actualUPH,
      stdUPH,
      achievementRate,
      isBottleneck: achievementRate !== null && achievementRate < 80,
      resultCount: e.resultCount,
    }
  })

  rows.sort((a, b) => (a.achievementRate ?? Infinity) - (b.achievementRate ?? Infinity))

  const withUPH = rows.filter((r) => r.actualUPH !== null)
  const withRate = rows.filter((r) => r.achievementRate !== null)

  return {
    rows,
    filter,
    totalEquipmentCount: rows.length,
    bottleneckCount: rows.filter((r) => r.isBottleneck).length,
    avgUPH:
      withUPH.length > 0
        ? Math.round((withUPH.reduce((s, r) => s + (r.actualUPH ?? 0), 0) / withUPH.length) * 10) / 10
        : null,
    avgAchievementRate:
      withRate.length > 0
        ? Math.round((withRate.reduce((s, r) => s + (r.achievementRate ?? 0), 0) / withRate.length) * 10) / 10
        : null,
  }
}
