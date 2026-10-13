import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { verifyAgentKey } from "@/lib/ncwatch/auth"
import { writeSyncLog } from "@/lib/ncwatch/transform"
import type { MachineReportPayload, MachineResult } from "@/lib/ncwatch/types"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  // ── 1. 인증 ──────────────────────────────────────────────────────────────
  const auth = await verifyAgentKey(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { tenantId } = auth

  // ── 2. payload 파싱 ───────────────────────────────────────────────────────
  let body: { machines?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!Array.isArray(body.machines) || body.machines.length === 0) {
    return NextResponse.json(
      { error: "machines 배열이 필요합니다" },
      { status: 400 }
    )
  }

  const machines = body.machines as MachineReportPayload[]
  const results: MachineResult[] = []

  // ── 3. 기계별 처리 ───────────────────────────────────────────────────────
  for (const m of machines) {
    if (!m.machineName || !m.reportDate) {
      results.push({
        machineName: m.machineName ?? "(unknown)",
        result: "ERROR",
        equipmentId: null,
        message: "machineName 또는 reportDate 누락",
      })
      continue
    }

    // "YYYY-MM-DD" → Date (midnight UTC)
    const reportDate = new Date(m.reportDate + "T00:00:00.000Z")
    if (isNaN(reportDate.getTime())) {
      results.push({
        machineName: m.machineName,
        result: "ERROR",
        equipmentId: null,
        message: `reportDate 형식 오류: ${m.reportDate}`,
      })
      continue
    }

    try {
      await prisma.ncwatchReportDaily.upsert({
        where: {
          tenantId_machineName_reportDate: {
            tenantId,
            machineName: m.machineName,
            reportDate,
          },
        },
        update: {
          runTime:     m.runTime     ?? null,
          runPct:      m.runPct      ?? null,
          partCount:   m.partCount   ?? null,
          stopTime:    m.stopTime    ?? null,
          stopPct:     m.stopPct     ?? null,
          manualPct:   m.manualPct   ?? null,
          alarmPct:    m.alarmPct    ?? null,
          offlinePct:  m.offlinePct  ?? null,
          manualTime:  m.manualTime  ?? null,
          alarmTime:   m.alarmTime   ?? null,
          offlineTime: m.offlineTime ?? null,
          rawPayload:  m as object,
        },
        create: {
          tenantId,
          machineName:  m.machineName,
          reportDate,
          runTime:      m.runTime     ?? null,
          runPct:       m.runPct      ?? null,
          partCount:    m.partCount   ?? null,
          stopTime:     m.stopTime    ?? null,
          stopPct:      m.stopPct     ?? null,
          manualPct:    m.manualPct   ?? null,
          alarmPct:     m.alarmPct    ?? null,
          offlinePct:   m.offlinePct  ?? null,
          manualTime:   m.manualTime  ?? null,
          alarmTime:    m.alarmTime   ?? null,
          offlineTime:  m.offlineTime ?? null,
          rawPayload:   m as object,
        },
      })

      // 매핑 여부 확인 (응답 정보용, 변환 없음)
      const mapping = await prisma.ncwatchEquipmentMapping.findUnique({
        where:  { tenantId_machineName: { tenantId, machineName: m.machineName } },
        select: { equipmentId: true },
      })

      results.push({
        machineName: m.machineName,
        result:      mapping?.equipmentId ? "OK" : "UNMAPPED",
        equipmentId: mapping?.equipmentId ?? null,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({ machineName: m.machineName, result: "ERROR", equipmentId: null, message })
    }
  }

  // ── 4. SyncLog 기록 ───────────────────────────────────────────────────────
  await writeSyncLog(tenantId, "report-daily", results).catch(() => {})

  return NextResponse.json({
    ok:        true,
    processed: results.filter((r) => r.result === "OK").length,
    unmapped:  results.filter((r) => r.result === "UNMAPPED").length,
    errors:    results.filter((r) => r.result === "ERROR").length,
    machines:  results,
  })
}
