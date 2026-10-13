"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId } from "@/lib/auth"
import { isMissingDbObjectError, isSchemaCompatibilityError } from "@/lib/db/prisma-error"
import { Prisma } from "@prisma/client"
import { monitoringEligibleEquipmentWhere } from "@/lib/actions/equipment-monitoring.utils"

// reportDate는 Agent가 한국 날짜 문자열("YYYY-MM-DD")을 UTC midnight으로 저장한다.
// Vercel 서버는 UTC이므로 setHours(0,0,0,0)은 UTC 기준이 돼 KST 날짜와 어긋난다.
// KST 날짜 문자열로 정확한 reportDate를 구한다.
function getKSTReportDate(): Date {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000
  const kstDateStr = new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10)
  return new Date(kstDateStr + "T00:00:00.000Z")
}

export type EquipmentMonitorRow = {
  id: string
  code: string
  name: string
  equipmentType: string
  status: string
  workCenter: { name: string }
  latestEvent: { eventType: string; startedAt: Date; endedAt: Date | null } | null
  openRepairs: number
  lastCheckResult: string | null
  ncwatchTodayPartCount: number | null
  recentTags: {
    tagCode: string
    displayName: string
    unit: string | null
    latestValue: string | null
    timestamp: Date | null
  }[]
}

type LatestTagValue = {
  value: string | null
  timestamp: Date | null
}

type LatestEquipmentEvent = EquipmentMonitorRow["latestEvent"]

function parseNcwatchTimeToMinutes(value: string | null | undefined): number {
  if (!value) return 0
  const [hours = 0, minutes = 0, seconds = 0] = value.split(":").map(Number)
  return hours * 60 + minutes + seconds / 60
}

function normalizePercent(value: unknown): number | null {
  if (value == null) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.max(0, Math.min(100, numeric))
}

async function getLatestSnapshotFallbacks(tagIds: string[]): Promise<Map<string, LatestTagValue>> {
  if (tagIds.length === 0) return new Map()

  const latestSnapshots = await prisma.$queryRaw<Array<{ tagId: string; value: string | null; timestamp: Date }>>(
    Prisma.sql`
      SELECT DISTINCT ON ("tagId") "tagId", "value", "timestamp"
      FROM "TagSnapshot"
      WHERE "tagId" IN (${Prisma.join(tagIds)})
      ORDER BY "tagId", "timestamp" DESC
    `,
  )
  const values = new Map<string, LatestTagValue>()
  for (const snapshot of latestSnapshots) {
    values.set(snapshot.tagId, snapshot)
  }
  return values
}

async function getLatestEquipmentEvents(equipmentIds: string[]): Promise<Map<string, LatestEquipmentEvent>> {
  if (equipmentIds.length === 0) return new Map()

  const latestEvents = await prisma.$queryRaw<
    Array<{
      equipmentId: string
      eventType: string
      startedAt: Date
      endedAt: Date | null
    }>
  >(
    Prisma.sql`
      SELECT DISTINCT ON ("equipmentId") "equipmentId", "eventType", "startedAt", "endedAt"
      FROM "EquipmentEvent"
      WHERE "equipmentId" IN (${Prisma.join(equipmentIds)})
      ORDER BY "equipmentId", "startedAt" DESC
    `,
  )
  const values = new Map<string, LatestEquipmentEvent>()
  for (const equipmentId of equipmentIds) values.set(equipmentId, null)
  for (const event of latestEvents) values.set(event.equipmentId, event)
  return values
}

async function getNcwatchAvailabilityRates(
  tenantId: string,
  equipmentIds: string[],
  reportFrom: Date,
  reportTo: Date,
): Promise<Map<string, number> | null> {
  if (equipmentIds.length === 0) return new Map()

  try {
    const mappings = await prisma.ncwatchEquipmentMapping.findMany({
      where: {
        tenantId,
        isActive: true,
        equipmentId: { in: equipmentIds },
      },
      select: {
        equipmentId: true,
        machineName: true,
      },
    })

    const machineNames = Array.from(new Set(mappings.map((mapping) => mapping.machineName)))
    if (machineNames.length === 0) return new Map()

    const reports = await prisma.ncwatchReportDaily.findMany({
      where: {
        tenantId,
        machineName: { in: machineNames },
        reportDate: { gte: reportFrom, lte: reportTo },
      },
      select: {
        machineName: true,
        runTime: true,
        stopTime: true,
        manualTime: true,
        alarmTime: true,
        offlineTime: true,
        runPct: true,
        receivedAt: true,
      },
      orderBy: { receivedAt: "desc" },
    })

    const latestReportByMachine = new Map<string, (typeof reports)[number]>()
    for (const report of reports) {
      if (!latestReportByMachine.has(report.machineName)) {
        latestReportByMachine.set(report.machineName, report)
      }
    }

    const rates = new Map<string, number>()
    for (const mapping of mappings) {
      if (!mapping.equipmentId) continue
      const report = latestReportByMachine.get(mapping.machineName)
      if (!report) continue

      const runMinutes = parseNcwatchTimeToMinutes(report.runTime)
      const totalMinutes =
        runMinutes +
        parseNcwatchTimeToMinutes(report.stopTime) +
        parseNcwatchTimeToMinutes(report.manualTime) +
        parseNcwatchTimeToMinutes(report.alarmTime) +
        parseNcwatchTimeToMinutes(report.offlineTime)

      const rate =
        normalizePercent(report.runPct) ??
        (totalMinutes > 0 ? (runMinutes / totalMinutes) * 100 : null)

      if (rate != null) {
        rates.set(mapping.equipmentId, rate)
      }
    }

    return rates
  } catch (error) {
    if (isMissingDbObjectError(error) || isSchemaCompatibilityError(error)) return null
    throw error
  }
}

async function getNcwatchTodayPartCounts(
  tenantId: string,
  equipmentIds: string[],
  reportFrom: Date,
  reportTo: Date,
): Promise<Map<string, number> | null> {
  if (equipmentIds.length === 0) return new Map()

  try {
    const mappings = await prisma.ncwatchEquipmentMapping.findMany({
      where: {
        tenantId,
        isActive: true,
        equipmentId: { in: equipmentIds },
      },
      select: {
        equipmentId: true,
        machineName: true,
      },
    })

    const machineNames = Array.from(new Set(mappings.map((mapping) => mapping.machineName)))
    if (machineNames.length === 0) return new Map()

    const reports = await prisma.ncwatchReportDaily.findMany({
      where: {
        tenantId,
        machineName: { in: machineNames },
        reportDate: { gte: reportFrom, lte: reportTo },
      },
      select: {
        machineName: true,
        partCount: true,
        receivedAt: true,
      },
      orderBy: { receivedAt: "desc" },
    })

    const latestPartCountByMachine = new Map<string, number>()
    for (const report of reports) {
      if (report.partCount == null || latestPartCountByMachine.has(report.machineName)) continue
      latestPartCountByMachine.set(report.machineName, report.partCount)
    }

    const counts = new Map<string, number>()
    for (const mapping of mappings) {
      if (!mapping.equipmentId) continue
      const partCount = latestPartCountByMachine.get(mapping.machineName)
      if (partCount != null) counts.set(mapping.equipmentId, partCount)
    }

    return counts
  } catch (error) {
    if (isMissingDbObjectError(error) || isSchemaCompatibilityError(error)) return null
    throw error
  }
}

export async function getEquipmentMonitorData(): Promise<EquipmentMonitorRow[]> {
  const tenantId = await getTenantId()
  const today = getKSTReportDate()
  const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)

  try {
    const equipments = await prisma.equipment.findMany({
      where: monitoringEligibleEquipmentWhere(tenantId),
      include: {
        workCenter: { select: { name: true } },
        events: {
          orderBy: { startedAt: "desc" },
          take: 1,
        },
        connections: {
          where: { isActive: true },
          include: {
            tags: {
              where: { isActive: true, isEnabled: true, isVisible: true },
              orderBy: [{ displayOrder: "asc" }, { tagCode: "asc" }],
              include: {
                snapshots: {
                  orderBy: { timestamp: "desc" },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: { code: "asc" },
    })
    const todayPartCounts = await getNcwatchTodayPartCounts(
      tenantId,
      equipments.map((equipment) => equipment.id),
      today,
      todayEnd,
    )

    return equipments.map((eq) => {
      const tags = eq.connections
        .flatMap((connection) => connection.tags)
        .sort((a, b) => {
          const orderDiff = a.displayOrder - b.displayOrder
          return orderDiff !== 0 ? orderDiff : a.tagCode.localeCompare(b.tagCode)
        })

      return {
        id: eq.id,
        code: eq.code,
        name: eq.name,
        equipmentType: eq.equipmentType,
        status: eq.status,
        workCenter: eq.workCenter,
        latestEvent: eq.events[0] ?? null,
        openRepairs: 0,
        lastCheckResult: null,
        ncwatchTodayPartCount: todayPartCounts?.get(eq.id) ?? null,
        recentTags: tags.map((tag) => ({
          tagCode: tag.tagCode,
          displayName: tag.displayName,
          unit: tag.unit,
          latestValue: tag.snapshots[0]?.value ?? null,
          timestamp: tag.snapshots[0]?.timestamp ?? null,
        })),
      }
    })
  } catch (error) {
    if (isSchemaCompatibilityError(error)) {
      // connection 전체 객체(protocol 포함) 대신 select로 필요한 필드만 지정.
      // protocol 을 조회하지 않으면 NCWATCH_AGENT 값 역직렬화 실패를 피할 수 있다.
      const equipments = await prisma.equipment.findMany({
        where: monitoringEligibleEquipmentWhere(tenantId),
        include: {
          workCenter: { select: { name: true } },
          events: {
            orderBy: { startedAt: "desc" },
            take: 1,
          },
          connections: {
            where: { isActive: true },
            select: {
              tags: {
                where: { isActive: true },
                orderBy: { tagCode: "asc" },
                select: {
                  tagCode:     true,
                  displayName: true,
                  unit:        true,
                  snapshots: {
                    orderBy: { timestamp: "desc" },
                    take: 1,
                    select: { value: true, timestamp: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { code: "asc" },
      })

      return equipments.map((eq) => {
        const tags = eq.connections
          .flatMap((connection) => connection.tags)
          .sort((a, b) => a.tagCode.localeCompare(b.tagCode))

        return {
          id: eq.id,
          code: eq.code,
          name: eq.name,
          equipmentType: eq.equipmentType,
          status: eq.status,
          workCenter: eq.workCenter,
          latestEvent: eq.events[0] ?? null,
          openRepairs: 0,
          lastCheckResult: null,
          ncwatchTodayPartCount: null,
          recentTags: tags.map((tag) => ({
            tagCode: tag.tagCode,
            displayName: tag.displayName,
            unit: tag.unit,
            latestValue: tag.snapshots[0]?.value ?? null,
            timestamp: tag.snapshots[0]?.timestamp ?? null,
          })),
        }
      })
    }
    if (isMissingDbObjectError(error)) return []
    throw error
  }
}

// ─── 경량 조회 (모니터링/키오스크 폴링 전용) ──────────────────────────────────
// getEquipmentMonitorData와 동일한 EquipmentMonitorRow 형태를 반환하되,
// include(전체 컬럼) 대신 select로 화면 표시에 필요한 컬럼만 가져와 Supabase egress를
// 줄인다. 30초 폴링으로 반복 호출되므로 반환 페이로드를 최소화하는 것이 목적이다.
// (표시 항목은 동일 — recentTags 전체/좌표/파일명/알람/최종 수신시간 모두 유지)
export async function getEquipmentMonitorLive(): Promise<EquipmentMonitorRow[]> {
  const tenantId = await getTenantId()
  const today = getKSTReportDate()
  const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)

  try {
    const equipments = await prisma.equipment.findMany({
      where: monitoringEligibleEquipmentWhere(tenantId),
      select: {
        id: true,
        code: true,
        name: true,
        equipmentType: true,
        status: true,
        workCenter: { select: { name: true } },
        connections: {
          where: { isActive: true },
          select: {
            tags: {
              where: { isActive: true, isEnabled: true, isVisible: true },
              orderBy: [{ displayOrder: "asc" }, { tagCode: "asc" }],
              select: {
                id: true,
                tagCode: true,
                displayName: true,
                unit: true,
                displayOrder: true,
                currentValue: { select: { value: true, timestamp: true } },
              },
            },
          },
        },
      },
      orderBy: { code: "asc" },
    })
    const equipmentIds = equipments.map((equipment) => equipment.id)

    const missingCurrentValueTagIds = equipments
      .flatMap((equipment) => equipment.connections)
      .flatMap((connection) => connection.tags)
      .filter((tag) => !tag.currentValue)
      .map((tag) => tag.id)

    const [todayPartCounts, snapshotFallbacks, latestEventByEquipmentId] = await Promise.all([
      getNcwatchTodayPartCounts(
        tenantId,
        equipmentIds,
        today,
        todayEnd,
      ),
      getLatestSnapshotFallbacks(missingCurrentValueTagIds),
      getLatestEquipmentEvents(equipmentIds),
    ])

    return equipments.map((eq) => {
      const tags = eq.connections
        .flatMap((connection) => connection.tags)
        .sort((a, b) => {
          const orderDiff = a.displayOrder - b.displayOrder
          return orderDiff !== 0 ? orderDiff : a.tagCode.localeCompare(b.tagCode)
        })

      return {
        id: eq.id,
        code: eq.code,
        name: eq.name,
        equipmentType: eq.equipmentType,
        status: eq.status,
        workCenter: eq.workCenter,
        latestEvent: latestEventByEquipmentId.get(eq.id) ?? null,
        openRepairs: 0,
        lastCheckResult: null,
        ncwatchTodayPartCount: todayPartCounts?.get(eq.id) ?? null,
        recentTags: tags.map((tag) => ({
          tagCode: tag.tagCode,
          displayName: tag.displayName,
          unit: tag.unit,
          latestValue: tag.currentValue?.value ?? snapshotFallbacks.get(tag.id)?.value ?? null,
          timestamp: tag.currentValue?.timestamp ?? snapshotFallbacks.get(tag.id)?.timestamp ?? null,
        })),
      }
    })
  } catch (error) {
    // 안전망: 스키마 호환성/누락 오류 시 검증된 기존 경로로 위임해 표시 데이터 누락을 방지한다.
    if (isSchemaCompatibilityError(error) || isMissingDbObjectError(error)) {
      return getEquipmentMonitorData()
    }
    throw error
  }
}

export async function getProductionKPIs() {
  const tenantId = await getTenantId()
  const today = getKSTReportDate()
  const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)

  try {
    const [activeWorkOrders, todayResults, equipments] =
      await Promise.all([
        prisma.workOrder.count({
          where: { tenantId, status: { in: ["RELEASED", "IN_PROGRESS"] } },
        }),
        prisma.productionResult.aggregate({
          where: {
            workOrderOperation: { workOrder: { tenantId } },
            endedAt: { gte: today },
          },
          _sum: { goodQty: true, defectQty: true },
        }),
        prisma.equipment.findMany({
          where: monitoringEligibleEquipmentWhere(tenantId),
          select: { id: true, status: true },
        }),
      ])

    const goodQty = Number(todayResults._sum?.goodQty ?? 0)
    const defectQty = Number(todayResults._sum?.defectQty ?? 0)
    const totalQty = goodQty + defectQty
    const ncwatchRates = await getNcwatchAvailabilityRates(
      tenantId,
      equipments.map((equipment) => equipment.id),
      today,
      todayEnd,
    )
    const ncwatchRateValues = Array.from(ncwatchRates?.values() ?? [])
    const legacyAvailabilityTotal = equipments.reduce(
      (sum, equipment) => sum + (equipment.status === "ACTIVE" ? 100 : 0),
      0,
    )

    return {
      activeWorkOrders,
      todayGoodQty: goodQty,
      todayDefectQty: defectQty,
      defectRate: totalQty > 0 ? ((defectQty / totalQty) * 100).toFixed(1) : "0.0",
      openRepairs: 0,
      failedChecks: 0,
      equipmentAvailability:
        ncwatchRateValues.length > 0
          ? (ncwatchRateValues.reduce((sum, rate) => sum + rate, 0) / ncwatchRateValues.length).toFixed(1)
          : equipments.length > 0 ? (legacyAvailabilityTotal / equipments.length).toFixed(1) : "0.0",
    }
  } catch (error) {
    if (!isMissingDbObjectError(error)) throw error
    return {
      activeWorkOrders: 0,
      todayGoodQty: 0,
      todayDefectQty: 0,
      defectRate: "0.0",
      openRepairs: 0,
      failedChecks: 0,
      equipmentAvailability: "0.0",
    }
  }
}
