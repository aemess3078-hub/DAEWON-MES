"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId } from "@/lib/auth"
import { isMissingDbObjectError } from "@/lib/db/prisma-error"
import { monitoringEligibleEquipmentWhere } from "@/lib/actions/equipment-monitoring.utils"

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnalysisPeriod = "today" | "week" | "month"

// ─── 타임라인 Types ────────────────────────────────────────────────────────────

export type TimelineEvent = {
  eventType: string
  startedAt: Date
  endedAt: Date | null
}

export type EquipmentTimeline = {
  equipmentId: string
  equipmentCode: string
  equipmentName: string
  events: TimelineEvent[]
}

export type TimelineData = {
  dayStart: Date
  dayEnd: Date
  now: Date
  equipments: EquipmentTimeline[]
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

// 서버(UTC) 기준이 아니라 KST 달력 날짜로 범위를 잡는다.
// NcwatchReportDaily.reportDate 는 KST 날짜를 UTC 자정으로 저장하므로
// from/to 도 KST 날짜의 UTC 자정으로 맞춰야 매칭된다.
function getDateRange(period: AnalysisPeriod): { from: Date; to: Date; label: string } {
  const todayKst = new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10)
  const todayStart = new Date(todayKst + "T00:00:00.000Z")
  const to = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1)

  if (period === "today") {
    return { from: todayStart, to, label: "오늘" }
  }
  if (period === "week") {
    const from = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000)
    return { from, to, label: "최근 7일" }
  }
  // month — KST 기준 이번 달 1일
  const y = Number(todayKst.slice(0, 4))
  const m = Number(todayKst.slice(5, 7))
  return { from: new Date(Date.UTC(y, m - 1, 1)), to, label: "이번 달" }
}

// "HH:MM:SS" → minutes
function parseTimeToMinutes(t: string | null | undefined): number {
  if (!t) return 0
  const parts = t.split(":").map(Number)
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
}

function fmtMins(mins: number): number {
  return Math.round(mins)
}

export type EquipmentAnalysisRow = {
  equipmentId: string
  equipmentCode: string
  equipmentName: string
  runMinutes: number
  stopMinutes: number
  manualMinutes: number
  alarmMinutes: number
  offlineMinutes: number
  totalMinutes: number
  runRate: number | null    // 0–100 (%)
  alarmRate: number | null  // 0–100 (%)
  alarmCount: number
  lastAlarmAt: Date | null   // 가장 최근 알람 발생시각
  source: "ncwatch" | "event" | "none"
}

export type EquipmentAnalysisData = {
  period: AnalysisPeriod
  periodLabel: string
  rows: EquipmentAnalysisRow[]
  hasNcwatchData: boolean
}

export async function getEquipmentAnalysisData(
  period: AnalysisPeriod = "today"
): Promise<EquipmentAnalysisData> {
  const tenantId = await getTenantId()
  const { from, to, label } = getDateRange(period)
  // from/to 는 reportDate(=KST 날짜의 UTC 자정) 매칭용.
  // EquipmentEvent.startedAt 은 실제 시각이므로 KST 달력일의 실제 UTC 구간으로 9h 당겨 조회한다.
  const eventFrom = new Date(from.getTime() - KST_OFFSET_MS)
  const eventTo = new Date(to.getTime() - KST_OFFSET_MS)

  try {
    // 1. 설비 목록 + NCWatch 매핑 (protocol 컬럼 미접근 — enum 역직렬화 위험 없음)
    const equipments = await prisma.equipment.findMany({
      where: monitoringEligibleEquipmentWhere(tenantId),
      select: {
        id: true,
        code: true,
        name: true,
        ncwatchMappings: {
          where: { isActive: true },
          select: { machineName: true },
          take: 1,
        },
      },
      orderBy: { code: "asc" },
    })

    if (equipments.length === 0) {
      return { period, periodLabel: label, rows: [], hasNcwatchData: false }
    }

    const equipmentIds = equipments.map((e) => e.id)

    // machineName → equipment 역참조
    const machineToEq = new Map<string, { id: string; code: string; name: string }>()
    for (const eq of equipments) {
      const m = eq.ncwatchMappings[0]
      if (m?.machineName) machineToEq.set(m.machineName, { id: eq.id, code: eq.code, name: eq.name })
    }

    // 2. NcwatchReportDaily 집계 (없으면 조용히 skip)
    let hasNcwatchData = false
    const ncwatchMap = new Map<
      string,
      {
        run: number
        stop: number
        manual: number
        alarm: number
        offline: number
        runPctSum: number
        runPctCount: number
        alarmPctSum: number
        alarmPctCount: number
      }
    >()

    if (machineToEq.size > 0) {
      try {
        const reports = await prisma.ncwatchReportDaily.findMany({
          where: {
            tenantId,
            machineName: { in: Array.from(machineToEq.keys()) },
            reportDate: { gte: from, lte: to },
          },
          select: {
            machineName: true,
            runTime: true,
            runPct: true,
            stopTime: true,
            manualTime: true,
            alarmTime: true,
            alarmPct: true,
            offlineTime: true,
          },
        })
        for (const r of reports) {
          const cur = ncwatchMap.get(r.machineName) ?? {
            run: 0,
            stop: 0,
            manual: 0,
            alarm: 0,
            offline: 0,
            runPctSum: 0,
            runPctCount: 0,
            alarmPctSum: 0,
            alarmPctCount: 0,
          }
          cur.run    += parseTimeToMinutes(r.runTime)
          cur.stop   += parseTimeToMinutes(r.stopTime)
          cur.manual += parseTimeToMinutes(r.manualTime)
          cur.alarm  += parseTimeToMinutes(r.alarmTime)
          cur.offline += parseTimeToMinutes(r.offlineTime)
          if (r.runPct != null) {
            cur.runPctSum += Number(r.runPct)
            cur.runPctCount++
          }
          if (r.alarmPct != null) {
            cur.alarmPctSum += Number(r.alarmPct)
            cur.alarmPctCount++
          }
          ncwatchMap.set(r.machineName, cur)
        }
        hasNcwatchData = reports.length > 0
      } catch {
        // 테이블 미존재 등 — 폴백 진행
      }
    }

    // 3. EquipmentEvent 알람 횟수/시간 (기간 내)
    const alarmEvents = await prisma.equipmentEvent.findMany({
      where: {
        equipmentId: { in: equipmentIds },
        eventType: "ALARM",
        startedAt: { gte: eventFrom, lte: eventTo },
      },
      select: {
        equipmentId: true,
        duration: true,
        startedAt: true,
        endedAt: true,
      },
    })

    const nowMs = Date.now()
    const alarmMap = new Map<string, { count: number; minutes: number; lastAt: Date | null }>()
    for (const ev of alarmEvents) {
      const cur = alarmMap.get(ev.equipmentId) ?? { count: 0, minutes: 0, lastAt: null }
      cur.count++
      if (ev.duration != null) cur.minutes += ev.duration / 60
      else if (ev.endedAt) cur.minutes += (ev.endedAt.getTime() - ev.startedAt.getTime()) / 60_000
      else cur.minutes += (nowMs - ev.startedAt.getTime()) / 60_000 // 진행 중 알람
      if (!cur.lastAt || ev.startedAt > cur.lastAt) cur.lastAt = ev.startedAt // 가장 최근 알람 발생시각
      alarmMap.set(ev.equipmentId, cur)
    }

    // 3-2. EquipmentEvent 정지시간 (일간 리포트는 정지시간을 안 보내므로 이벤트로 집계)
    const stopEvents = await prisma.equipmentEvent.findMany({
      where: {
        equipmentId: { in: equipmentIds },
        eventType: "STOP",
        startedAt: { gte: eventFrom, lte: eventTo },
      },
      select: { equipmentId: true, duration: true, startedAt: true, endedAt: true },
    })
    const stopMap = new Map<string, number>()
    for (const ev of stopEvents) {
      const mins =
        ev.duration != null ? ev.duration / 60
        : ev.endedAt ? (ev.endedAt.getTime() - ev.startedAt.getTime()) / 60_000
        : (nowMs - ev.startedAt.getTime()) / 60_000
      stopMap.set(ev.equipmentId, (stopMap.get(ev.equipmentId) ?? 0) + mins)
    }

    // 4. NCWatch 데이터가 없을 때 EquipmentEvent RUN 기반 폴백
    const eventRunMap = new Map<string, number>()
    if (!hasNcwatchData) {
      const runEvents = await prisma.equipmentEvent.findMany({
        where: {
          equipmentId: { in: equipmentIds },
          eventType: "RUN",
          startedAt: { gte: eventFrom, lte: eventTo },
        },
        select: {
          equipmentId: true,
          duration: true,
          startedAt: true,
          endedAt: true,
        },
      })
      for (const ev of runEvents) {
        const mins =
          ev.duration != null
            ? ev.duration / 60
            : ev.endedAt && ev.startedAt
            ? (ev.endedAt.getTime() - ev.startedAt.getTime()) / 60_000
            : 0
        eventRunMap.set(ev.equipmentId, (eventRunMap.get(ev.equipmentId) ?? 0) + mins)
      }
    }

    // 5. 결과 조립
    const totalPeriodMins = (to.getTime() - from.getTime()) / 60_000
    const rows: EquipmentAnalysisRow[] = equipments.map((eq) => {
      const mapping = eq.ncwatchMappings[0]
      const ncwatch = mapping ? ncwatchMap.get(mapping.machineName) : null
      const alarm = alarmMap.get(eq.id) ?? { count: 0, minutes: 0, lastAt: null }
      const stopMins = stopMap.get(eq.id) ?? 0

      if (ncwatch) {
        // 정지/알람 시간은 일간 리포트에 없으므로 이벤트 집계값을 우선 사용한다.
        const stop  = ncwatch.stop  > 0 ? ncwatch.stop  : stopMins
        const alarmMins = ncwatch.alarm > 0 ? ncwatch.alarm : alarm.minutes
        const total = ncwatch.run + stop + ncwatch.manual + alarmMins + ncwatch.offline
        const runRate =
          ncwatch.runPctCount > 0
            ? Math.round((ncwatch.runPctSum / ncwatch.runPctCount) * 100) / 100
            : total > 0 ? Math.round((ncwatch.run / total) * 1000) / 10 : null
        const alarmRate =
          ncwatch.alarmPctCount > 0
            ? Math.round((ncwatch.alarmPctSum / ncwatch.alarmPctCount) * 100) / 100
            : total > 0 ? Math.round((alarmMins / total) * 1000) / 10 : null
        return {
          equipmentId: eq.id,
          equipmentCode: eq.code,
          equipmentName: eq.name,
          runMinutes:     fmtMins(ncwatch.run),
          stopMinutes:    fmtMins(stop),
          manualMinutes:  fmtMins(ncwatch.manual),
          alarmMinutes:   fmtMins(alarmMins),
          offlineMinutes: fmtMins(ncwatch.offline),
          totalMinutes:   fmtMins(total),
          runRate,
          alarmRate,
          alarmCount: alarm.count,
          lastAlarmAt: alarm.lastAt,
          source: "ncwatch",
        }
      }

      const runMins = eventRunMap.get(eq.id) ?? 0
      if (runMins === 0 && alarm.count === 0) {
        return {
          equipmentId: eq.id,
          equipmentCode: eq.code,
          equipmentName: eq.name,
          runMinutes: 0, stopMinutes: 0, manualMinutes: 0, alarmMinutes: 0, offlineMinutes: 0,
          totalMinutes: 0,
          runRate: null, alarmRate: null,
          alarmCount: 0,
          lastAlarmAt: null,
          source: "none",
        }
      }

      return {
        equipmentId: eq.id,
        equipmentCode: eq.code,
        equipmentName: eq.name,
        runMinutes:     fmtMins(runMins),
        stopMinutes:    fmtMins(stopMins),
        manualMinutes:  0,
        alarmMinutes:   fmtMins(alarm.minutes),
        offlineMinutes: 0,
        totalMinutes:   fmtMins(totalPeriodMins),
        runRate:   totalPeriodMins > 0 ? Math.round((runMins / totalPeriodMins) * 1000) / 10 : null,
        alarmRate: totalPeriodMins > 0 ? Math.round((alarm.minutes / totalPeriodMins) * 1000) / 10 : null,
        alarmCount: alarm.count,
        lastAlarmAt: alarm.lastAt,
        source: "event",
      }
    })

    return { period, periodLabel: label, rows, hasNcwatchData }
  } catch (error) {
    if (isMissingDbObjectError(error)) {
      return { period, periodLabel: label, rows: [], hasNcwatchData: false }
    }
    throw error
  }
}

// ─── 24h 가동 타임라인 ─────────────────────────────────────────────────────────
// 오늘 00:00 ~ 현재까지의 EquipmentEvent를 설비별로 집계.
// 어제 시작되어 아직 닫히지 않은 이벤트도 포함 (오늘 00:00 기점으로 클램프).
// protocol 컬럼 미접근 — NCWATCH_AGENT enum 역직렬화 위험 없음.

export async function getEquipmentTimelineData(): Promise<TimelineData> {
  const tenantId = await getTenantId()
  const now = new Date()
  // KST 자정을 실제 UTC 인스턴트로 환산 (이벤트 startedAt 은 실제 시각이므로)
  const todayKst = new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10)
  const dayStart = new Date(todayKst + "T00:00:00+09:00")
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000) // 고정 24h 축

  try {
    const equipments = await prisma.equipment.findMany({
      where: monitoringEligibleEquipmentWhere(tenantId),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    })

    if (equipments.length === 0) {
      return { dayStart, dayEnd, now, equipments: [] }
    }

    const equipmentIds = equipments.map((e) => e.id)

    // 오늘 기준 이벤트:
    //   - 오늘 시작된 것
    //   - 아직 닫히지 않은 것 (전날 시작 포함)
    //   - 오늘 닫힌 것 (전날 시작 포함)
    const events = await prisma.equipmentEvent.findMany({
      where: {
        equipmentId: { in: equipmentIds },
        OR: [
          { startedAt: { gte: dayStart } },
          { endedAt: null },
          { endedAt: { gte: dayStart } },
        ],
      },
      select: {
        equipmentId: true,
        eventType:   true,
        startedAt:   true,
        endedAt:     true,
      },
      orderBy: { startedAt: "asc" },
    })

    const eqEventMap = new Map<string, TimelineEvent[]>()
    for (const ev of events) {
      const list = eqEventMap.get(ev.equipmentId) ?? []
      list.push({
        eventType: ev.eventType as string,
        startedAt: ev.startedAt,
        endedAt:   ev.endedAt,
      })
      eqEventMap.set(ev.equipmentId, list)
    }

    return {
      dayStart,
      dayEnd,
      now,
      equipments: equipments.map((eq) => ({
        equipmentId:   eq.id,
        equipmentCode: eq.code,
        equipmentName: eq.name,
        events:        eqEventMap.get(eq.id) ?? [],
      })),
    }
  } catch (error) {
    if (isMissingDbObjectError(error)) {
      return { dayStart, dayEnd, now, equipments: [] }
    }
    throw error
  }
}
