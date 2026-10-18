import { EquipmentEventType } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import type { MachineStatusPayload } from "./types"

// ─── 설정 ────────────────────────────────────────────────────────────────────
function envMs(name: string, def: number, min: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)   // 빈 문자열/비숫자는 기본값
  return Number.isFinite(n) && n >= min ? n : def
}
// 값이 같을 때의 정기 스냅샷 간격. 기본 15분. NCWATCH_SNAPSHOT_INTERVAL_MS 로 조정 가능(최소 1초).
export const SNAPSHOT_INTERVAL_MS = envMs("NCWATCH_SNAPSHOT_INTERVAL_MS", 15 * 60 * 1000, 1000)
// 변동 태그(위치·회전수 등)의 변경 스냅샷 최소 간격. 기본 0 = 제한 없음(변경 즉시 저장).
export const SNAPSHOT_VOLATILE_MIN_INTERVAL_MS = envMs("NCWATCH_SNAPSHOT_VOLATILE_MIN_INTERVAL_MS", 0, 0)

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
  // "2026-10-18 11:39:21", "2026-10-18T11:39:21.123", "2026/10/18 11:39" 등 타임존 없는 값
  const localMatch = trimmed.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?$/
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
  // 상태코드를 알 수 없는 수신(컬럼 비어있음 등)은 임의로 STOP 으로 간주하지 않는다.
  if (m.statusCode == null) return

  const statusCode   = m.statusCode
  const newEventType = mapStatusCodeToEventType(statusCode)
  const prevEventType =
    prevStatusCode !== null ? mapStatusCodeToEventType(prevStatusCode) : null

  // 이벤트 타입이 바뀌지 않았으면 skip.
  // 단, 매핑이 상태 수신보다 늦게 만들어진 경우(열린 이벤트가 하나도 없음)에는 현재 상태 이벤트를 1회 연다.
  if (newEventType === prevEventType) {
    const hasOpen = await prisma.equipmentEvent.findFirst({
      where:  { equipmentId, endedAt: null },
      select: { id: true },
    })
    if (hasOpen) return
  }

  const now       = new Date()
  const startedAt = parseNcwatchTs(m.ncwatchTs) ?? now

  // 기존 열린 이벤트 닫기 + 새 이벤트 열기 (단일 트랜잭션)
  await prisma.$transaction(async (tx) => {
    const openEvent = await tx.equipmentEvent.findFirst({
      where:   { equipmentId, endedAt: null },
      orderBy: { startedAt: "desc" },
      select:  { id: true, startedAt: true, eventType: true },
    })

    // 동시 수신 등으로 이미 같은 타입의 이벤트가 열려 있으면 중복 생성하지 않는다.
    if (openEvent && openEvent.eventType === newEventType) return

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
// TagSnapshot 저장 정책은 아래 "TagSnapshot 저장 정책" 참조.
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

// ─── TagSnapshot 저장 정책 ───────────────────────────────────────────────────
// TagCurrentValue 는 매 수신마다 갱신하고(마지막 수신 시각), TagSnapshot 은 "이력"이므로 아래 경우에만 저장한다.
//   1) 최초 수신(현재값 없음)
//   2) 값이 직전 값과 달라졌을 때 — 즉시 저장 (NCWatch 원본 TIMESTAMP 만 달라진 것은 값 변경이 아니다)
//   3) 값이 같아도 마지막 스냅샷으로부터 SNAPSHOT_INTERVAL_MS(기본 15분) 이상 지났을 때 — 정기 스냅샷
// 선택 정책(기본 꺼짐): 위치·회전수처럼 가동 중 매 주기 바뀌는 "변동 태그"는 NCWATCH_SNAPSHOT_VOLATILE_MIN_INTERVAL_MS
// (예: 60000) 이상 간격으로만 변경 스냅샷을 저장한다. 0 이면 변경 즉시 저장(기본).
// 시각 비교는 모두 NCWatch 데이터 시각(receivedAt) 기준이며, 시계가 거꾸로 가면 저장하지 않는다.

/** 가동 중 거의 매 주기 값이 바뀌는 태그. 선택 정책의 대상. */
export const VOLATILE_TAG_CODES: ReadonlySet<string> = new Set([
  "POS_X", "POS_Y", "POS_Z", "SPINDLE_SPEED", "FEED_RATE", "RATIO", "BLOCK_NUMBER",
])
/** 값이 없어지는 것이 곧 "해제"인 태그 (알람 해제 시 NCWatch 는 알람 필드를 비운다). */
const CLEARABLE_TAG_CODES: ReadonlySet<string> = new Set(["ALARM_CODE", "ALARM_MESSAGE"])

export function decideSnapshot(input: {
  hasCurrent:    boolean
  changed:       boolean
  volatile:      boolean
  lastSnapAtMs:  number | null   // 마지막 스냅샷 시각(데이터 시각), 없으면 null
  receivedAtMs:  number
  heartbeatMs:   number          // 정기 스냅샷 간격
  volatileMinMs: number          // 변동 태그 변경 스냅샷 최소 간격 (0 = 제한 없음)
}): boolean {
  const { hasCurrent, changed, volatile, lastSnapAtMs, receivedAtMs, heartbeatMs, volatileMinMs } = input
  if (!hasCurrent) return true                                   // 최초 수신
  if (changed) {
    if (!volatile || volatileMinMs <= 0) return true             // 값 변경 → 즉시
    return lastSnapAtMs === null || receivedAtMs - lastSnapAtMs >= volatileMinMs
  }
  return lastSnapAtMs === null || receivedAtMs - lastSnapAtMs >= heartbeatMs   // 정기 스냅샷
}

/** 판정에 마지막 스냅샷 시각이 필요한가? (필요 없는 경우 DB 조회를 하지 않는다) */
function needsLastSnapshot(hasCurrent: boolean, changed: boolean, volatile: boolean, volatileMinMs: number): boolean {
  if (!hasCurrent) return false
  if (!changed) return true
  return volatile && volatileMinMs > 0
}

// 태그별 마지막 스냅샷 시각 캐시(서버리스 인스턴스 메모리, 최선 노력).
// 캐시는 실제보다 오래된 값일 수는 있어도 새로운 값일 수는 없으므로 "저장해야 할 스냅샷을 건너뛰는" 일은 없고,
// 저장 시점이 되었다고 판단되면 항상 DB 의 실제 마지막 시각을 한 번 더 확인해 다른 인스턴스와의 중복 저장을 막는다.
const NEVER = -1
const lastSnapshotAtCache = new Map<string, number>()
const SNAPSHOT_CACHE_MAX = 5000
export function resetSnapshotCache(): void {
  lastSnapshotAtCache.clear()
}

export async function syncTagValues(
  equipmentId:      string,
  m:                MachineStatusPayload,
  snapshotInterval: number = SNAPSHOT_INTERVAL_MS,
  volatileMinMs:    number = SNAPSHOT_VOLATILE_MIN_INTERVAL_MS
): Promise<void> {
  // 이 equipment의 NCWatch 연결에 속한 활성+동기화가능 태그 조회 (현재값 포함, 1회)
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

  const receivedAt   = parseNcwatchTs(m.ncwatchTs) ?? new Date()
  const receivedAtMs = receivedAt.getTime()

  type Plan = {
    tagId: string; value: string; numericValue: number | null
    hasCurrent: boolean; changed: boolean; volatile: boolean
  }
  const plans: Plan[] = []

  for (const tag of tags) {
    const payloadField = FIELD_MAP[tag.tagCode]
    if (!payloadField) continue

    const rawValue = m[payloadField]
    let value: string
    let numericValue: number | null

    if (rawValue == null) {
      // 알람 해제: NCWatch 가 알람 필드를 비우면 이전에 남아 있던 알람 값을 빈 값으로 갱신한다(없던 값은 그대로 둔다).
      if (CLEARABLE_TAG_CODES.has(tag.tagCode) && tag.currentValue && tag.currentValue.value !== "") {
        value = ""
        numericValue = null
      } else {
        continue
      }
    } else {
      // 일부 태그는 코드값을 사람이 읽는 라벨로 변환해 표기
      if (tag.tagCode === "STATUS" && m.statusCode != null) {
        value = STATUS_LABEL_KO[m.statusCode] ?? String(rawValue)
      } else if (tag.tagCode === "MODE" && m.modeCode != null) {
        value = MODE_LABEL[m.modeCode] ?? String(rawValue)
      } else {
        value = String(rawValue)
      }
      const numericVal = Number(rawValue)
      numericValue = isFinite(numericVal) ? numericVal : null

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
    }

    // 값·시각이 직전 저장분과 완전히 같으면 동일 행 재기록과 스냅샷 판단을 모두 생략한다.
    if (
      tag.currentValue &&
      tag.currentValue.value === value &&
      tag.currentValue.timestamp.getTime() === receivedAtMs
    ) {
      continue
    }

    plans.push({
      tagId:      tag.id,
      value,
      numericValue,
      hasCurrent: Boolean(tag.currentValue),
      // 값 비교는 문자열 값만 사용한다 — NCWatch 원본 TIMESTAMP/ALIVECOUNT 등은 값 변경이 아니다.
      changed:    !tag.currentValue || tag.currentValue.value !== value,
      volatile:   VOLATILE_TAG_CODES.has(tag.tagCode),
    })
  }

  if (plans.length === 0) return

  const decide = (p: Plan, lastSnapAtMs: number | null) =>
    decideSnapshot({
      hasCurrent: p.hasCurrent, changed: p.changed, volatile: p.volatile,
      lastSnapAtMs, receivedAtMs, heartbeatMs: snapshotInterval, volatileMinMs,
    })

  // 1단계: 마지막 스냅샷 시각이 필요한 태그 중, 캐시로 "아직 이르다"고 확정되지 않은 것만 DB 에서 한 번에 확인한다.
  const verify: string[] = []
  for (const p of plans) {
    if (!needsLastSnapshot(p.hasCurrent, p.changed, p.volatile, volatileMinMs)) continue
    const c = lastSnapshotAtCache.get(p.tagId)
    if (c === undefined) { verify.push(p.tagId); continue }
    if (decide(p, c === NEVER ? null : c)) verify.push(p.tagId)   // 저장할 때가 된 것 → 실제값 확인
  }
  if (verify.length > 0) {
    const rows = await prisma.tagSnapshot.groupBy({
      by:    ["tagId"],
      where: { tagId: { in: verify } },
      _max:  { timestamp: true },
    })
    if (lastSnapshotAtCache.size > SNAPSHOT_CACHE_MAX) lastSnapshotAtCache.clear()
    const found = new Map(rows.map((r) => [r.tagId, r._max.timestamp?.getTime() ?? NEVER]))
    for (const id of verify) lastSnapshotAtCache.set(id, found.get(id) ?? NEVER)
  }

  // 2단계: 현재값은 항상 갱신, 스냅샷은 정책에 맞는 것만 한 번에 저장
  const toSnapshot: { tagId: string; value: string; quality: string; timestamp: Date }[] = []
  for (const p of plans) {
    const c = needsLastSnapshot(p.hasCurrent, p.changed, p.volatile, volatileMinMs) ? lastSnapshotAtCache.get(p.tagId) : undefined
    const lastSnapAtMs = c === undefined || c === NEVER ? null : c
    if (decide(p, lastSnapAtMs)) toSnapshot.push({ tagId: p.tagId, value: p.value, quality: "GOOD", timestamp: receivedAt })
  }

  await Promise.all(
    plans.map((p) =>
      prisma.tagCurrentValue.upsert({
        where:  { tagId: p.tagId },
        update: { value: p.value, numericValue: p.numericValue, quality: "GOOD", timestamp: receivedAt },
        create: { tagId: p.tagId, value: p.value, numericValue: p.numericValue, quality: "GOOD", timestamp: receivedAt },
      })
    )
  )

  if (toSnapshot.length > 0) {
    await prisma.tagSnapshot.createMany({ data: toSnapshot })
    if (lastSnapshotAtCache.size > SNAPSHOT_CACHE_MAX) lastSnapshotAtCache.clear()
    for (const s of toSnapshot) lastSnapshotAtCache.set(s.tagId, receivedAtMs)
  }
}

// ─── NcwatchSyncLog 기록 ─────────────────────────────────────────────────────
// 10초 주기 수신마다 기계 수+1 행을 쌓으면 하루 4만 행 이상이 된다.
// 오류는 항상 기록하고, 같은 결과(OK/UNMAPPED)의 반복은 간격(기본 5분)마다 한 번만 기록한다.
// (서버리스 인스턴스별 메모리 기준의 최선 노력 제한 — 인스턴스가 바뀌면 한 번 더 기록될 수 있다.)
const SYNC_LOG_REPEAT_INTERVAL_MS = parseInt(
  process.env.NCWATCH_SYNCLOG_REPEAT_INTERVAL_MS ?? "300000"
)
const lastSyncLogAt = new Map<string, number>()

export function shouldWriteSyncLog(
  key: string,
  result: string,
  now: number,
  intervalMs: number = SYNC_LOG_REPEAT_INTERVAL_MS
): boolean {
  if (result === "ERROR") return true
  const last = lastSyncLogAt.get(key)
  if (last !== undefined && now - last < intervalMs) return false
  lastSyncLogAt.set(key, now)
  return true
}

export async function writeSyncLog(
  tenantId:     string,
  endpoint:     string,
  allResults:   { machineName: string; result: string; message?: string }[],
): Promise<void> {
  const now     = Date.now()
  const results = allResults.filter((r) =>
    shouldWriteSyncLog(`${tenantId}|${endpoint}|${r.machineName}|${r.result}`, r.result, now)
  )
  if (results.length === 0) return
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
