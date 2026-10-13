import { EquipmentEventType } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import type { MachineStatusPayload } from "./types"

// ─── 설정 ────────────────────────────────────────────────────────────────────
// 기본 60초. NCWATCH_SNAPSHOT_INTERVAL_MS 환경변수로 조정 가능.
export const SNAPSHOT_INTERVAL_MS = parseInt(
  process.env.NCWATCH_SNAPSHOT_INTERVAL_MS ?? "60000"
)

// ─── NCWatch statusCode → EquipmentEventType ────────────────────────────────
// mapper.js 기준: 3=START→RUN, 5=ALARM→ALARM, 나머지→STOP
function mapStatusCodeToEventType(statusCode: number): EquipmentEventType {
  if (statusCode === 3) return EquipmentEventType.RUN
  if (statusCode === 5) return EquipmentEventType.ALARM
  return EquipmentEventType.STOP
}

function buildEventMessage(m: MachineStatusPayload): string | null {
  if (m.alarmCode && m.alarmMessage) return `[${m.alarmCode}] ${m.alarmMessage}`
  if (m.alarmMessage) return m.alarmMessage
  if ((m.statusCode ?? 1) === 4) return "OFFLINE"
  return null
}

// ncwatchTs 파싱: 타임존 없는 NCWatch 시간은 KST(Asia/Seoul) 로 간주한다.
export function parseNcwatchTs(ts: string | null | undefined): Date | null {
  if (!ts) return null
  const trimmed = ts.trim()
  const localMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  )

  if (localMatch) {
    const [, year, month, day, hour, minute, second = "0"] = localMatch
    const utcMs = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - 9,
      Number(minute),
      Number(second)
    )
    const d = new Date(utcMs)
    return isNaN(d.getTime()) ? null : d
  }

  const d = new Date(trimmed)
  return isNaN(d.getTime()) ? null : d
}

// ─── EquipmentEvent 동기화 ───────────────────────────────────────────────────
// statusCode가 바뀔 때만 이벤트를 생성한다.
// 이전 열린 이벤트를 닫고(endedAt + duration) 새 이벤트를 연다.
export async function syncEquipmentEvent(
  equipmentId:   string,
  m:             MachineStatusPayload,
  prevStatusCode: number | null
): Promise<void> {
  const statusCode   = m.statusCode ?? 1
  const newEventType = mapStatusCodeToEventType(statusCode)
  const prevEventType =
    prevStatusCode !== null ? mapStatusCodeToEventType(prevStatusCode) : null

  // 이벤트 타입이 바뀌지 않았으면 skip
  if (newEventType === prevEventType) return

  const now       = new Date()
  const startedAt = parseNcwatchTs(m.ncwatchTs) ?? now

  // 기존 열린 이벤트 닫기 + 새 이벤트 열기 (단일 트랜잭션)
  await prisma.$transaction(async (tx) => {
    const openEvent = await tx.equipmentEvent.findFirst({
      where:   { equipmentId, endedAt: null },
      orderBy: { startedAt: "desc" },
      select:  { id: true, startedAt: true },
    })

    if (openEvent) {
      const durationSec = Math.round(
        (now.getTime() - openEvent.startedAt.getTime()) / 1000
      )
      await tx.equipmentEvent.update({
        where: { id: openEvent.id },
        data:  { endedAt: now, duration: durationSec },
      })
    }

    await tx.equipmentEvent.create({
      data: {
        equipmentId,
        eventType: newEventType,
        message:   buildEventMessage(m),
        startedAt,
      },
    })
  })
}

// ─── TagCurrentValue + TagSnapshot 동기화 ───────────────────────────────────
// isActive=true, isEnabled=true, source='NCWATCH' 태그만 처리.
//
// TagCurrentValue: 매 수신마다 upsert (파라미터보기 "마지막 수신" 시각 반영)
// TagSnapshot 삽입 조건:
//   1) 값이 이전 스냅샷과 다를 때
//   2) 값이 같아도 마지막 스냅샷으로부터 SNAPSHOT_INTERVAL_MS 이상 경과했을 때
//
// NCWatch 필드명 → tagCode 매핑 (태그사전 Phase 4에서 자동 생성되는 tagCode 기준)
const FIELD_MAP: Record<string, keyof MachineStatusPayload> = {
  STATUS:         "statusLabel",
  PROGRAM_NAME:   "programName",
  O_NUMBER:       "oNumber",
  MODE:           "modeCode",
  SPINDLE_SPEED:  "spindleSpeed",
  FEED_RATE:      "feedRate",
  RATIO:          "ratio",
  BLOCK_NUMBER:   "blockNumber",
  POS_X:          "positionX",
  POS_Y:          "positionY",
  POS_Z:          "positionZ",
  TOOL_NO:        "toolNo",
  PART_COUNT:     "partCount",   // Q3: 태그/참고값으로만 저장 (ProductionResult 미생성)
  ALARM_CODE:     "alarmCode",
  ALARM_MESSAGE:  "alarmMessage",
}

// 운전 상태 코드 → 한글 라벨 (statusCode 기준 — agent의 영어 라벨과 무관하게 일관 표기)
// mapper.js STATUS_MAP: 0 READY, 1 STOP, 2 PAUSE, 3 START, 4 OFFLINE, 5 ALARM, 6 MANUAL
const STATUS_LABEL_KO: Record<number, string> = {
  0: "대기",
  1: "정지",
  2: "일시정지",
  3: "가동",
  4: "오프라인",
  5: "알람",
  6: "수동",
}

// 운전 모드 코드 → 라벨 (mapper.js MODE_MAP 기준, CNC 표준 약어 유지)
const MODE_LABEL: Record<number, string> = {
  0: "MDI",
  1: "MEM",
  3: "EDIT",
  4: "HND",
  5: "JOG",
  9: "REG",
  10: "REMOTE",
}

export async function syncTagValues(
  equipmentId:      string,
  m:                MachineStatusPayload,
  snapshotInterval: number = SNAPSHOT_INTERVAL_MS
): Promise<void> {
  // 이 equipment의 NCWatch 연결에 속한 활성+동기화가능 태그 조회
  const tags = await prisma.dataTag.findMany({
    where: {
      isActive:  true,
      isEnabled: true,
      source:    "NCWATCH",
      connection: {
        isActive:    true,
        equipmentId,
        protocol:    "NCWATCH_AGENT",
      },
    },
    select: {
      id:          true,
      tagCode:     true,
      currentValue: {
        select: { value: true, timestamp: true },
      },
    },
  })

  if (tags.length === 0) return

  const receivedAt = parseNcwatchTs(m.ncwatchTs) ?? new Date()

  // 병렬로 처리 (태그 수가 많지 않음)
  await Promise.all(
    tags.map(async (tag) => {
      const payloadField = FIELD_MAP[tag.tagCode]
      if (!payloadField) return

      const rawValue = m[payloadField]
      if (rawValue == null) return

      // 일부 태그는 코드값을 사람이 읽는 라벨로 변환해 표기
      let value: string
      if (tag.tagCode === "STATUS" && m.statusCode != null) {
        value = STATUS_LABEL_KO[m.statusCode] ?? String(rawValue)
      } else if (tag.tagCode === "MODE" && m.modeCode != null) {
        value = MODE_LABEL[m.modeCode] ?? String(rawValue)
      } else {
        value = String(rawValue)
      }
      const numericVal  = Number(rawValue)
      let numericValue = isFinite(numericVal) ? numericVal : null

      // 주축 회전수는 실시간 실제값이라 가동 중에도 급속이송/복귀 순간 0으로 떨어진다.
      // 가동(RUN=3) 중 순간 0은 직전 비0 회전수를 유지해 표시를 안정화한다.
      // (정지/알람/오프라인 등 가동이 아니면 실제값 그대로 — 진짜 멈춤은 0으로 표시)
      if (tag.tagCode === "SPINDLE_SPEED" && m.statusCode === 3 && numericValue === 0) {
        const prevNum = tag.currentValue ? Number(tag.currentValue.value) : NaN
        if (isFinite(prevNum) && prevNum > 0) {
          value = tag.currentValue!.value
          numericValue = prevNum
        }
      }

      // TagCurrentValue upsert (항상 최신 수신값+시각 유지)
      await prisma.tagCurrentValue.upsert({
        where:  { tagId: tag.id },
        update: { value, numericValue, quality: "GOOD", timestamp: receivedAt },
        create: { tagId: tag.id, value, numericValue, quality: "GOOD", timestamp: receivedAt },
      })

      // TagSnapshot 삽입 여부 결정 — 직전 스냅샷 "1건"만 조회한다.
      // (기존: tagIds 전체에 대한 distinct + orderBy 무제한 findMany → 이력이 누적될수록
      //  TagSnapshot 대량 row가 매 수신(에이전트 10초 주기)마다 DB→서버로 전송되어 egress 폭증.
      //  태그별 take:1(findFirst) 조회로 바꿔 반환 row를 태그당 1건으로 제한한다. 판정 로직은 동일.)
      const lastSnap = await prisma.tagSnapshot.findFirst({
        where:   { tagId: tag.id },
        orderBy: { timestamp: "desc" },
        select:  { value: true, timestamp: true },
      })
      const shouldSnapshot =
        !lastSnap ||                                                        // 최초 수신
        lastSnap.value !== value ||                                         // 값 변경
        receivedAt.getTime() - lastSnap.timestamp.getTime() >= snapshotInterval  // 주기 경과

      if (shouldSnapshot) {
        await prisma.tagSnapshot.create({
          data: { tagId: tag.id, value, quality: "GOOD", timestamp: receivedAt },
        })
      }
    })
  )
}

// ─── NcwatchSyncLog 기록 ─────────────────────────────────────────────────────
export async function writeSyncLog(
  tenantId:     string,
  endpoint:     string,
  results:      { machineName: string; result: string; message?: string }[],
): Promise<void> {
  const hasError    = results.some((r) => r.result === "ERROR")
  const allUnmapped = results.every((r) => r.result === "UNMAPPED")
  const overallResult = hasError ? "ERROR" : allUnmapped ? "UNMAPPED" : "OK"

  await prisma.ncwatchSyncLog.createMany({
    data: [
      {
        tenantId,
        endpoint,
        result:       overallResult,
        message:      hasError
          ? results.find((r) => r.result === "ERROR")?.message ?? null
          : null,
        payloadCount: results.length,
      },
      ...results.map((r) => ({
        tenantId,
        machineName:  r.machineName,
        endpoint,
        result:       r.result,
        message:      r.message ?? null,
        payloadCount: 1,
      })),
    ],
  })
}
