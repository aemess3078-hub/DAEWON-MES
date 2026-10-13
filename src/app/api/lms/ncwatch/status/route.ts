import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { verifyAgentKey } from "@/lib/ncwatch/auth"
import { parseNcwatchTs, syncEquipmentEvent, syncTagValues, writeSyncLog } from "@/lib/ncwatch/transform"
import type { MachineStatusPayload, MachineResult } from "@/lib/ncwatch/types"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  // ── 1. 인증 ──────────────────────────────────────────────────────────────
  const auth = await verifyAgentKey(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { tenantId, siteId } = auth

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

  const machines = body.machines as MachineStatusPayload[]
  const results: MachineResult[] = []

  // ── 3. 기계별 처리 ───────────────────────────────────────────────────────
  for (const m of machines) {
    if (!m.machineName) {
      results.push({ machineName: "(unknown)", result: "ERROR", equipmentId: null, message: "machineName 누락" })
      continue
    }

    try {
      // 3-1. 기존 상태 조회 (statusCode 변경 감지 + history insert 여부 결정)
      const prev = await prisma.ncwatchStatus.findUnique({
        where:  { tenantId_machineName: { tenantId, machineName: m.machineName } },
        select: { statusCode: true },
      })
      const prevStatusCode = prev?.statusCode ?? null

      // 3-2. ncwatch_status upsert (기계당 1행, 항상 최신값)
      await prisma.ncwatchStatus.upsert({
        where: { tenantId_machineName: { tenantId, machineName: m.machineName } },
        update: {
          statusCode:   m.statusCode  ?? null,
          statusLabel:  m.statusLabel ?? null,
          runCode:      m.runCode     ?? null,
          modeCode:     m.modeCode    ?? null,
          messageCode:  m.messageCode ?? null,
          programName:  m.programName ?? null,
          oNumber:      m.oNumber     ?? null,
          spindleSpeed: m.spindleSpeed ?? null,
          feedRate:     m.feedRate    ?? null,
          positionX:    m.positionX   ?? null,
          positionY:    m.positionY   ?? null,
          positionZ:    m.positionZ   ?? null,
          toolNo:       m.toolNo      ?? null,
          partCount:    m.partCount   ?? null,
          blockNumber:  m.blockNumber ?? null,
          blockTot:     m.blockTot    ?? null,
          ratio:        m.ratio       ?? null,
          alarmCode:    m.alarmCode   ?? null,
          alarmMessage: m.alarmMessage ?? null,
          aliveCount:   m.aliveCount  ?? null,
          ncwatchTs:    m.ncwatchTs   ?? null,
          rawPayload:   m as object,
          siteId:       siteId        ?? null,
          receivedAt:   new Date(),   // 매 수신마다 갱신 (마지막 수신 시각)
        },
        create: {
          tenantId,
          siteId:       siteId        ?? null,
          machineName:  m.machineName,
          statusCode:   m.statusCode  ?? null,
          statusLabel:  m.statusLabel ?? null,
          runCode:      m.runCode     ?? null,
          modeCode:     m.modeCode    ?? null,
          messageCode:  m.messageCode ?? null,
          programName:  m.programName ?? null,
          oNumber:      m.oNumber     ?? null,
          spindleSpeed: m.spindleSpeed ?? null,
          feedRate:     m.feedRate    ?? null,
          positionX:    m.positionX   ?? null,
          positionY:    m.positionY   ?? null,
          positionZ:    m.positionZ   ?? null,
          toolNo:       m.toolNo      ?? null,
          partCount:    m.partCount   ?? null,
          blockNumber:  m.blockNumber ?? null,
          blockTot:     m.blockTot    ?? null,
          ratio:        m.ratio       ?? null,
          alarmCode:    m.alarmCode   ?? null,
          alarmMessage: m.alarmMessage ?? null,
          aliveCount:   m.aliveCount  ?? null,
          ncwatchTs:    m.ncwatchTs   ?? null,
          rawPayload:   m as object,
        },
      })

      // 3-3. ncwatch_status_history insert (최초 수신 또는 statusCode 변경 시)
      if (prevStatusCode !== (m.statusCode ?? null)) {
        const changedAt = parseNcwatchTs(m.ncwatchTs) ?? new Date()
        if (!isNaN(changedAt.getTime())) {
          await prisma.ncwatchStatusHistory.create({
            data: {
              tenantId,
              machineName:  m.machineName,
              statusCode:   m.statusCode  ?? null,
              statusLabel:  m.statusLabel ?? null,
              partCount:    m.partCount   ?? null,
              spindleSpeed: m.spindleSpeed ?? null,
              alarmMessage: m.alarmMessage ?? null,
              changedAt,
            },
          })
        }
      }

      // 3-4. 매핑 조회
      const mapping = await prisma.ncwatchEquipmentMapping.findUnique({
        where: { tenantId_machineName: { tenantId, machineName: m.machineName } },
        select: {
          equipmentId: true,
          isActive: true,
          equipment: { select: { tenantId: true } },
        },
      })

      if (!mapping?.equipmentId || !mapping.isActive) {
        // 미매핑 또는 비활성 매핑 → staging만 저장
        results.push({ machineName: m.machineName, result: "UNMAPPED", equipmentId: null })
        continue
      }

      const { equipmentId } = mapping
      if (!mapping.equipment || mapping.equipment.tenantId !== tenantId) {
        results.push({
          machineName: m.machineName,
          result: "ERROR",
          equipmentId,
          message: "INVALID_MAPPING",
        })
        continue
      }

      // 3-5. native 모델 변환 (병렬 실행)
      await Promise.all([
        syncEquipmentEvent(equipmentId, m, prevStatusCode),
        syncTagValues(equipmentId, m),
      ])

      results.push({ machineName: m.machineName, result: "OK", equipmentId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({ machineName: m.machineName, result: "ERROR", equipmentId: null, message })
    }
  }

  // ── 4. SyncLog 기록 ───────────────────────────────────────────────────────
  await writeSyncLog(tenantId, "status", results).catch(() => {})

  // ── 5. 응답 ──────────────────────────────────────────────────────────────
  return NextResponse.json({
    ok:        true,
    processed: results.filter((r) => r.result === "OK").length,
    unmapped:  results.filter((r) => r.result === "UNMAPPED").length,
    errors:    results.filter((r) => r.result === "ERROR").length,
    machines:  results,
  })
}
