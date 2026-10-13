"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId } from "@/lib/auth"
import { actualProductionEquipmentWhere } from "@/lib/equipment-result-attribution"
import { kstDateRangeToUtcBounds, kstDefaultDateRange, toKstDateKey } from "@/lib/date/kst"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

// ─── 공통 ─────────────────────────────────────────────────────────────────────

export type KpiFilter = {
  from: string // YYYY-MM-DD
  to: string
  itemId?: string
  equipmentIds?: string[]
}

export type KpiFilterOptions = {
  items: { id: string; code: string; name: string }[]
  equipments: { id: string; code: string; name: string }[]
}

export async function getKpiFilterOptions(): Promise<KpiFilterOptions> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const [items, equipments] = await Promise.all([
    prisma.item.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.equipment.findMany({
      where: { tenantId },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])
  return { items, equipments }
}

function parseDateRange(f: KpiFilter) {
  const { fromDate, toExclusiveDate } = kstDateRangeToUtcBounds(f.from, f.to)
  return { from: fromDate, toExclusive: toExclusiveDate }
}

function defaultKpiDateRange(): KpiFilter {
  return kstDefaultDateRange(30)
}

// ─── 1. 제조리드타임 ──────────────────────────────────────────────────────────
// 완료된 작업지시의 createdAt → 완료일(completedAt) 기간.
// completedAt은 실제 생산 종료일(마지막 ProductionResult.endedAt)을 우선 사용하고,
// 생산실적이 없는 작업지시만 updatedAt으로 폴백한다. updatedAt은 담당자가 다른
// 항목을 나중에 한 번만 고쳐도 갱신되는 시스템 필드라 "완료일"의 근거로 쓰기
// 취약하다 — 실제 업무 완료 시점을 나타내는 생산 데이터를 우선한다.

export type ManufacturingLeadTimeKpi = {
  avgDays: number | null
  orderCount: number
  rows: Array<{
    orderNo: string
    itemName: string
    createdAt: string
    completedAt: string
    leadTimeDays: number
  }>
}

async function fetchManufacturingLeadTime(
  tenantId: string,
  f: KpiFilter
): Promise<ManufacturingLeadTimeKpi> {
  const { from, toExclusive } = parseDateRange(f)

  const orders = await prisma.workOrder.findMany({
    where: {
      tenantId,
      status: "COMPLETED",
      ...(f.itemId && { itemId: f.itemId }),
    },
    select: {
      orderNo: true,
      createdAt: true,
      updatedAt: true,
      item: { select: { name: true } },
      operations: {
        select: {
          productionResults: { select: { endedAt: true } },
        },
      },
    },
  })

  const rows = orders
    .map((wo) => {
      const productionEndTimes = wo.operations
        .flatMap((op) => op.productionResults)
        .map((pr) => pr.endedAt)
        .filter((d): d is Date => d != null)
      const completedAt =
        productionEndTimes.length > 0
          ? new Date(Math.max(...productionEndTimes.map((d) => d.getTime())))
          : wo.updatedAt

      return {
        orderNo: wo.orderNo,
        itemName: wo.item.name,
        createdAt: wo.createdAt,
        completedAt,
        leadTimeDays:
          Math.round(
            ((completedAt.getTime() - wo.createdAt.getTime()) / 86_400_000) * 10
          ) / 10,
      }
    })
    .filter((r) => r.completedAt >= from && r.completedAt < toExclusive)
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
    .slice(0, 20)
    .map((r) => ({
      orderNo: r.orderNo,
      itemName: r.itemName,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt.toISOString(),
      leadTimeDays: r.leadTimeDays,
    }))

  const avgDays =
    rows.length > 0
      ? Math.round(
          (rows.reduce((s, r) => s + r.leadTimeDays, 0) / rows.length) * 10
        ) / 10
      : null

  return { avgDays, orderCount: rows.length, rows }
}

// ─── 2. 품질불량률 ────────────────────────────────────────────────────────────

export type DefectRateKpi = {
  defectRate: number | null // 0–1
  inspectedQty: number
  defectQty: number
  inspectionCount: number
  topDefects: Array<{ name: string; qty: number; pct: number }>
}

async function fetchDefectRate(
  tenantId: string,
  f: KpiFilter
): Promise<DefectRateKpi> {
  const { from, toExclusive } = parseDateRange(f)

  const inspections = await prisma.qualityInspection.findMany({
    where: {
      inspectedAt: { gte: from, lt: toExclusive },
      workOrderOperation: {
        workOrder: { tenantId, ...(f.itemId && { itemId: f.itemId }) },
      },
    },
    select: {
      inspectedQty: true,
      defectRecords: {
        select: {
          qty: true,
          defectCode: { select: { name: true } },
        },
      },
    },
  })

  let inspectedQty = 0
  let defectQty = 0
  const typeMap = new Map<string, number>()

  for (const insp of inspections) {
    inspectedQty += Number(insp.inspectedQty)
    for (const dr of insp.defectRecords) {
      const q = Number(dr.qty)
      defectQty += q
      typeMap.set(dr.defectCode.name, (typeMap.get(dr.defectCode.name) ?? 0) + q)
    }
  }

  const defectRate = inspectedQty > 0 ? defectQty / inspectedQty : null

  const topDefects = Array.from(typeMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qty]) => ({
      name,
      qty,
      pct: defectQty > 0 ? Math.round((qty / defectQty) * 1000) / 10 : 0,
    }))

  return { defectRate, inspectedQty, defectQty, inspectionCount: inspections.length, topDefects }
}

// ─── 3. 작업공수 ──────────────────────────────────────────────────────────────
// ProductionResult의 startedAt/endedAt 기반 실제 작업 시간 합산

export type LaborEffortKpi = {
  totalHours: number | null
  resultCount: number
  rows: Array<{ date: string; hours: number; goodQty: number }>
}

async function fetchLaborEffort(
  tenantId: string,
  f: KpiFilter
): Promise<LaborEffortKpi> {
  const { from, toExclusive } = parseDateRange(f)

  const results = await prisma.productionResult.findMany({
    where: {
      startedAt: { gte: from, lt: toExclusive },
      endedAt: { not: null },
      workOrderOperation: {
        workOrder: { tenantId, ...(f.itemId && { itemId: f.itemId }) },
      },
      ...actualProductionEquipmentWhere(f.equipmentIds),
    },
    select: { startedAt: true, endedAt: true, goodQty: true },
  })

  const dayMap = new Map<string, { hours: number; goodQty: number }>()
  let totalHours = 0

  for (const r of results) {
    if (!r.startedAt || !r.endedAt) continue
    const h = (r.endedAt.getTime() - r.startedAt.getTime()) / 3_600_000
    totalHours += h
    const date = toKstDateKey(r.startedAt)
    const e = dayMap.get(date) ?? { hours: 0, goodQty: 0 }
    e.hours += h
    e.goodQty += Number(r.goodQty)
    dayMap.set(date, e)
  }

  const rows = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      hours: Math.round(v.hours * 10) / 10,
      goodQty: Math.round(v.goodQty),
    }))

  return {
    totalHours: results.length > 0 ? Math.round(totalHours * 10) / 10 : null,
    resultCount: results.length,
    rows,
  }
}

// ─── 4. 수주/납품리드타임 ─────────────────────────────────────────────────────
// 납품 완료 건의 수주일 → 납품일 기간

export type DeliveryLeadTimeKpi = {
  avgDays: number | null
  count: number
  rows: Array<{
    shipmentNo: string
    orderDate: string
    deliveredDate: string
    leadTimeDays: number
  }>
}

async function fetchDeliveryLeadTime(
  tenantId: string,
  f: KpiFilter
): Promise<DeliveryLeadTimeKpi> {
  const { from, toExclusive } = parseDateRange(f)

  const shipments = await prisma.shipmentOrder.findMany({
    where: {
      tenantId,
      status: "DELIVERED",
      deliveredDate: { gte: from, lt: toExclusive },
    },
    select: {
      shipmentNo: true,
      deliveredDate: true,
      salesOrder: { select: { orderDate: true } },
    },
    orderBy: { deliveredDate: "desc" },
    take: 20,
  })

  const rows = shipments
    .filter((s): s is typeof s & { deliveredDate: Date } => s.deliveredDate != null)
    .map((s) => ({
      shipmentNo: s.shipmentNo,
      orderDate: s.salesOrder.orderDate.toISOString(),
      deliveredDate: s.deliveredDate.toISOString(),
      leadTimeDays:
        Math.round(
          ((s.deliveredDate.getTime() - s.salesOrder.orderDate.getTime()) / 86_400_000) * 10
        ) / 10,
    }))

  const avgDays =
    rows.length > 0
      ? Math.round((rows.reduce((s, r) => s + r.leadTimeDays, 0) / rows.length) * 10) / 10
      : null

  return { avgDays, count: rows.length, rows }
}

// ─── 5. 전력사용량 ────────────────────────────────────────────────────────────
// 전력 전용 태그/테이블 없음 — 연동 필요

export type PowerUsageKpi = {
  available: boolean
  reason: string
}

// ─── 6. UPH (Units Per Hour) ─────────────────────────────────────────────────
// goodQty / 실제 작업시간(h)

export type UphKpi = {
  avgUph: number | null
  totalGoodQty: number
  totalHours: number
  rows: Array<{
    date: string
    itemId: string
    itemCode: string
    itemName: string
    goodQty: number
    hours: number
    uph: number | null
  }>
}

async function fetchUph(tenantId: string, f: KpiFilter): Promise<UphKpi> {
  const { from, toExclusive } = parseDateRange(f)

  const results = await prisma.productionResult.findMany({
    where: {
      startedAt: { gte: from, lt: toExclusive },
      endedAt: { not: null },
      workOrderOperation: {
        workOrder: { tenantId, ...(f.itemId && { itemId: f.itemId }) },
      },
      ...actualProductionEquipmentWhere(f.equipmentIds),
    },
    select: {
      startedAt: true,
      endedAt: true,
      goodQty: true,
      workOrderOperation: {
        select: { workOrder: { select: { item: { select: { id: true, code: true, name: true } } } } },
      },
    },
  })

  // 상세 rows는 날짜+품목 단위로 집계한다 (상단 총계와는 독립적으로 계산 —
  // avgUph 는 아래에서 raw SUM(goodQty)/SUM(hours) 로만 산출하고, rows 는
  // 표시용으로만 사용한다).
  const rowMap = new Map<
    string,
    { date: string; itemId: string; itemCode: string; itemName: string; goodQty: number; hours: number }
  >()
  let totalGoodQty = 0
  let totalHours = 0

  for (const r of results) {
    if (!r.startedAt || !r.endedAt) continue
    const h = (r.endedAt.getTime() - r.startedAt.getTime()) / 3_600_000
    const gq = Number(r.goodQty)
    totalGoodQty += gq
    totalHours += h
    const date = toKstDateKey(r.startedAt)
    const item = r.workOrderOperation.workOrder.item
    const key = `${date}|${item.id}`
    const e = rowMap.get(key) ?? {
      date,
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      goodQty: 0,
      hours: 0,
    }
    e.goodQty += gq
    e.hours += h
    rowMap.set(key, e)
  }

  const rows = Array.from(rowMap.values())
    .sort((a, b) => a.date.localeCompare(b.date) || a.itemCode.localeCompare(b.itemCode))
    .map((v) => ({
      date: v.date,
      itemId: v.itemId,
      itemCode: v.itemCode,
      itemName: v.itemName,
      goodQty: Math.round(v.goodQty),
      hours: Math.round(v.hours * 10) / 10,
      uph: v.hours > 0 ? Math.round((v.goodQty / v.hours) * 10) / 10 : null,
    }))

  return {
    avgUph: totalHours > 0 ? Math.round((totalGoodQty / totalHours) * 10) / 10 : null,
    totalGoodQty: Math.round(totalGoodQty),
    totalHours: Math.round(totalHours * 10) / 10,
    rows,
  }
}

// ─── 7. 설비가동률 ────────────────────────────────────────────────────────────
// EquipmentEvent RUN 이벤트 기간의 합 / 조회 기간 전체

export type EquipmentAvailabilityKpi = {
  avgRate: number | null // 0–1
  equipmentCount: number
  rows: Array<{
    code: string
    name: string
    runMinutes: number
    rate: number | null
  }>
}

async function fetchEquipmentAvailability(
  tenantId: string,
  f: KpiFilter
): Promise<EquipmentAvailabilityKpi> {
  const { from, toExclusive } = parseDateRange(f)
  const totalMinutes = (toExclusive.getTime() - from.getTime()) / 60_000

  const equipments = await prisma.equipment.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      ...(f.equipmentIds?.length && { id: { in: f.equipmentIds } }),
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

// ─── 전체 KPI 집계 ────────────────────────────────────────────────────────────

export type KpiDashboardData = {
  filter: KpiFilter
  manufacturingLeadTime: ManufacturingLeadTimeKpi
  defectRate: DefectRateKpi
  laborEffort: LaborEffortKpi
  deliveryLeadTime: DeliveryLeadTimeKpi
  powerUsage: PowerUsageKpi
  uph: UphKpi
  equipmentAvailability: EquipmentAvailabilityKpi
}

export async function getKpiDashboardData(
  filterOverride?: Partial<KpiFilter>
): Promise<KpiDashboardData> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const defaults = defaultKpiDateRange()
  const filter: KpiFilter = {
    from: filterOverride?.from ?? defaults.from,
    to: filterOverride?.to ?? defaults.to,
    itemId: filterOverride?.itemId,
    equipmentIds: filterOverride?.equipmentIds,
  }

  const [mlt, dr, le, dlt, uph, ea] = await Promise.all([
    fetchManufacturingLeadTime(tenantId, filter),
    fetchDefectRate(tenantId, filter),
    fetchLaborEffort(tenantId, filter),
    fetchDeliveryLeadTime(tenantId, filter),
    fetchUph(tenantId, filter),
    fetchEquipmentAvailability(tenantId, filter),
  ])

  return {
    filter,
    manufacturingLeadTime: mlt,
    defectRate: dr,
    laborEffort: le,
    deliveryLeadTime: dlt,
    powerUsage: { available: false, reason: "전력 데이터 연동 필요" },
    uph,
    equipmentAvailability: ea,
  }
}
