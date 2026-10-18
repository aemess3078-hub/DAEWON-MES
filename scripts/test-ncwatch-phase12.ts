/**
 * Phase 12 — NCWatch 설비 데이터 연동 서버측 회귀 테스트 (실제 DB 에 접속하지 않음).
 *
 * 실제 수신 라우트(status / heartbeat / report-daily)와 변환 로직(transform.ts)을 메모리 Fake Prisma 위에서
 * 그대로 실행해 인증 → NcwatchStatus → History → Mapping → EquipmentEvent → TagCurrentValue → TagSnapshot 흐름을 검증한다.
 * (운영 DB/Vercel 에 대한 검증이 아니다. 운영 검증은 docs/DAEWON-PHASE12-NCWATCH-INTEGRATION.md 의 절차로 별도 수행)
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import Module from "node:module"
import { join, sep } from "node:path"

const SRC = join(__dirname, "..", "src")

// ─── 메모리 Fake Prisma ───────────────────────────────────────────────────────
type Row = Record<string, any>
let seq = 0
const newId = () => `id-${++seq}`

const T: Record<string, Row[]> = {}
const counters = { tagCurrentUpsert: 0, tagSnapshotCreate: 0, eventCreate: 0, syncLogCreateMany: 0 }

function resetDb() {
  seq = 0
  for (const k of Object.keys(T)) delete T[k]
  for (const name of [
    "edgeGateway", "ncwatchStatus", "ncwatchStatusHistory", "ncwatchEquipmentMapping", "equipment", "equipmentEvent",
    "dataTag", "tagCurrentValue", "tagSnapshot", "ncwatchSyncLog", "ncwatchReportDaily",
  ]) T[name] = []
  for (const k of Object.keys(counters) as (keyof typeof counters)[]) counters[k] = 0
}
resetDb()

const byComposite = (where: Row, rows: Row[]) => {
  const [key, val] = Object.entries(where)[0]
  if (val && typeof val === "object" && !(val instanceof Date)) {
    return rows.find((r) => Object.entries(val as Row).every(([k, v]) => r[k]?.valueOf?.() === (v as any)?.valueOf?.()))
  }
  return rows.find((r) => r[key] === val)
}

const fakePrisma: any = {
  edgeGateway: {
    findUnique: async ({ where }: Row) => byComposite(where, T.edgeGateway) ?? null,
    update: async ({ where, data }: Row) => {
      const row = T.edgeGateway.find((r) => r.id === where.id)!
      Object.assign(row, data)
      return row
    },
  },
  ncwatchStatus: {
    findUnique: async ({ where }: Row) => byComposite(where, T.ncwatchStatus) ?? null,
    upsert: async ({ where, update, create }: Row) => {
      const row = byComposite(where, T.ncwatchStatus)
      if (row) return Object.assign(row, update)
      const created = { id: newId(), ...create }
      T.ncwatchStatus.push(created)
      return created
    },
  },
  ncwatchStatusHistory: {
    create: async ({ data }: Row) => { T.ncwatchStatusHistory.push({ id: newId(), ...data }); return data },
  },
  ncwatchEquipmentMapping: {
    findUnique: async ({ where }: Row) => {
      const row = byComposite(where, T.ncwatchEquipmentMapping)
      if (!row) return null
      return { ...row, equipment: T.equipment.find((e) => e.id === row.equipmentId) ?? null }
    },
  },
  equipmentEvent: {
    findFirst: async ({ where }: Row) => {
      const rows = T.equipmentEvent.filter((e) => e.equipmentId === where.equipmentId && e.endedAt === null)
      return rows.sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
    },
    update: async ({ where, data }: Row) => Object.assign(T.equipmentEvent.find((e) => e.id === where.id)!, data),
    create: async ({ data }: Row) => { counters.eventCreate++; const r = { id: newId(), endedAt: null, ...data }; T.equipmentEvent.push(r); return r },
  },
  dataTag: {
    findMany: async ({ where }: Row) =>
      T.dataTag
        .filter((t) => t.isActive && t.isEnabled && t.source === where.source && T.connection?.some((c) => c.id === t.connectionId && c.equipmentId === where.connection.equipmentId))
        .map((t) => ({ ...t, currentValue: T.tagCurrentValue.find((v) => v.tagId === t.id) ?? null })),
  },
  tagCurrentValue: {
    upsert: async ({ where, update, create }: Row) => {
      counters.tagCurrentUpsert++
      const row = T.tagCurrentValue.find((v) => v.tagId === where.tagId)
      if (row) return Object.assign(row, update)
      const created = { id: newId(), ...create }
      T.tagCurrentValue.push(created)
      return created
    },
  },
  tagSnapshot: {
    findFirst: async ({ where }: Row) => T.tagSnapshot.filter((s) => s.tagId === where.tagId).sort((a, b) => b.timestamp - a.timestamp)[0] ?? null,
    create: async ({ data }: Row) => { counters.tagSnapshotCreate++; T.tagSnapshot.push({ id: newId(), ...data }); return data },
  },
  ncwatchSyncLog: {
    createMany: async ({ data }: Row) => { counters.syncLogCreateMany++; T.ncwatchSyncLog.push(...data); return { count: data.length } },
  },
  ncwatchReportDaily: {
    upsert: async ({ where, update, create }: Row) => {
      const k = where.tenantId_machineName_reportDate
      const row = T.ncwatchReportDaily.find((r) => r.tenantId === k.tenantId && r.machineName === k.machineName && r.reportDate.getTime() === k.reportDate.getTime())
      if (row) return Object.assign(row, update)
      const created = { id: newId(), ...create }
      T.ncwatchReportDaily.push(created)
      return created
    },
  },
  $transaction: async (cb: any) => cb(fakePrisma),
}
T.connection = []

const origResolve = (Module as any)._resolveFilename
const origLoad = (Module as any)._load
;(Module as any)._resolveFilename = function (request: string, ...rest: any[]) {
  if (typeof request === "string" && request.startsWith("@/")) request = join(SRC, request.slice(2))
  return origResolve.call(this, request, ...rest)
}
;(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
  let resolved = ""
  try { resolved = (Module as any)._resolveFilename(request, parent, isMain) } catch { /* ignore */ }
  if (resolved.split(sep).join("/").endsWith("/src/lib/db/prisma.ts")) return { prisma: fakePrisma, default: fakePrisma }
  return origLoad.call(this, request, parent, isMain)
}

/* eslint-disable @typescript-eslint/no-var-requires */
const { NextRequest } = require("next/server")
const agentKey = require("../src/lib/ncwatch/agent-key")
const transform = require("../src/lib/ncwatch/transform")
const provision = require("../src/lib/ncwatch/provision")
const statusRoute = require("../src/app/api/lms/ncwatch/status/route")
const heartbeatRoute = require("../src/app/api/lms/ncwatch/heartbeat/route")
const dailyRoute = require("../src/app/api/lms/ncwatch/report-daily/route")
/* eslint-enable @typescript-eslint/no-var-requires */

let passed = 0
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); passed++; console.log(`  ✓ ${msg}`) }
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, `${msg} (실제: ${JSON.stringify(a)}, 기대: ${JSON.stringify(b)})`); passed++; console.log(`  ✓ ${msg}`) }
const section = (s: string) => console.log(`\n■ ${s}`)

const TENANT = "daewon-001"
const OTHER_TENANT = "other-tenant"
const SITE = "site-daewon-factory-001"
const KEY = agentKey.generateAgentKey()
const MACHINES = ["CNC-1", "CNC-8", "CNC-9", "MCT-6"]

function post(route: any, endpoint: string, body: unknown, key: string | null = KEY) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (key) headers["X-Agent-Key"] = key
  return route.POST(new NextRequest(`http://localhost${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) }))
}

function offline(machine: string, over: Row = {}) {
  return { machineName: machine, statusCode: 4, statusLabel: "OFFLINE", runCode: 0, modeCode: 0, messageCode: 202, programName: "O4596", partCount: 0, spindleSpeed: 0, ncwatchTs: "2026-10-18 11:39:21", ...over }
}

function seedProduction(opts: { mapCnc1?: boolean } = {}) {
  resetDb()
  T.connection = []
  T.edgeGateway.push({ id: "gw-1", tenantId: TENANT, siteId: SITE, apiKey: agentKey.hashAgentKey(KEY), status: "OFFLINE", lastHeartbeat: null })
  T.edgeGateway.push({ id: "gw-other", tenantId: OTHER_TENANT, siteId: "s2", apiKey: agentKey.hashAgentKey(agentKey.generateAgentKey()), status: "OFFLINE" })
  for (const m of MACHINES) {
    if (m === "CNC-1" && opts.mapCnc1 === false) continue
    const eqId = `eq-${m}`
    T.equipment.push({ id: eqId, tenantId: TENANT, siteId: SITE, code: m })
    T.ncwatchEquipmentMapping.push({ id: newId(), tenantId: TENANT, machineName: m, equipmentId: eqId, isActive: true })
    const connId = `conn-${m}`
    T.connection.push({ id: connId, equipmentId: eqId })
    for (const def of provision.NCWATCH_DEFAULT_TAGS) {
      T.dataTag.push({ id: `tag-${m}-${def.tagCode}`, connectionId: connId, tagCode: def.tagCode, isActive: true, isEnabled: true, source: "NCWATCH" })
    }
  }
}

async function main() {
  // ═════════════════════════════════════════════════════════════════════════
  section("시각 파싱 — 타임존 없는 NCWatch 시각은 KST")
  const iso = (s: string | null) => transform.parseNcwatchTs(s)?.toISOString() ?? null
  eq(iso("2026-10-18 11:39:21"), "2026-10-18T02:39:21.000Z", "초 단위 KST → UTC")
  eq(iso("2026-10-18T11:39:21.123"), "2026-10-18T02:39:21.000Z", "소수초(T 구분자)도 KST 로 해석 (이전엔 서버 UTC 로 9시간 어긋남)")
  eq(iso("2026/10/18 11:39"), "2026-10-18T02:39:00.000Z", "슬래시 구분·초 없음")
  eq(iso("2026-10-18T02:39:21.000Z"), "2026-10-18T02:39:21.000Z", "타임존이 붙은 값은 그대로")
  eq(iso("garbage"), null, "해석 불가 값은 null")
  eq(iso(null), null, "null 입력")

  section("SyncLog 반복 억제 / Gateway 표시 보조 함수")
  ok(transform.shouldWriteSyncLog("k-err", "ERROR", 0, 1000) && transform.shouldWriteSyncLog("k-err", "ERROR", 1, 1000), "오류는 항상 기록")
  ok(transform.shouldWriteSyncLog("k-ok", "OK", 10_000, 1000) === true, "정상 최초 1회 기록")
  ok(transform.shouldWriteSyncLog("k-ok", "OK", 10_500, 1000) === false, "간격 내 정상 반복은 생략")
  ok(transform.shouldWriteSyncLog("k-ok", "OK", 11_200, 1000) === true, "간격 경과 후 다시 기록")
  ok(provision.isGatewayHeartbeatStale(null), "하트비트 없으면 오프라인 표시")
  ok(!provision.isGatewayHeartbeatStale(new Date(Date.now() - 60_000)), "1분 전 하트비트는 온라인")
  ok(provision.isGatewayHeartbeatStale(new Date(Date.now() - 10 * 60_000)), "10분 전 하트비트는 오프라인 표시")

  section("기본 태그 정의 — 수신 필드와 일치")
  const tags = provision.NCWATCH_DEFAULT_TAGS as Row[]
  eq(new Set(tags.map((t) => t.tagCode)).size, tags.length, "tagCode 중복 없음")
  const src = readFileSync(join(SRC, "lib/ncwatch/transform.ts"), "utf8")
  ok(tags.every((t) => src.includes(`${t.tagCode}:`)), "모든 기본 태그가 transform FIELD_MAP 에 매핑됨")
  ok(!tags.some((t) => /production|result/i.test(t.tagCode)), "생산실적(ProductionResult)으로 이어지는 태그 없음 — PART_COUNT 는 참고값")
  ok(!/productionResult/.test(src), "transform 은 ProductionResult 를 생성하지 않는다")

  // ═════════════════════════════════════════════════════════════════════════
  section("인증 — X-Agent-Key")
  seedProduction()
  let res = await post(statusRoute, "/api/lms/ncwatch/status", { machines: [offline("CNC-8")] }, null)
  eq(res.status, 401, "키 없음 → 401")
  res = await post(statusRoute, "/api/lms/ncwatch/status", { machines: [offline("CNC-8")] }, "gw-api-key-demo-001")
  eq(res.status, 401, "데모 키 → 401")
  res = await post(statusRoute, "/api/lms/ncwatch/status", { machines: [offline("CNC-8")] }, agentKey.hashAgentKey(KEY))
  eq(res.status, 401, "저장된 해시값을 키로 제시 → 401")
  res = await post(heartbeatRoute, "/api/lms/ncwatch/heartbeat", { agentVersion: "3.0.0" }, "dwk_wrongwrongwrongwrongwrongwrong")
  eq(res.status, 401, "heartbeat 잘못된 키 → 401")
  eq(T.ncwatchStatus.length, 0, "인증 실패 시 아무것도 저장되지 않음")

  section("Heartbeat → Gateway ONLINE")
  res = await post(heartbeatRoute, "/api/lms/ncwatch/heartbeat", { agentVersion: "3.0.0", machineCount: 4, uptime: 12 })
  eq(res.status, 200, "heartbeat 200")
  eq(T.edgeGateway.find((g) => g.id === "gw-1")?.status, "ONLINE", "해당 Gateway 만 ONLINE")
  ok(T.edgeGateway.find((g) => g.id === "gw-1")?.lastHeartbeat instanceof Date, "lastHeartbeat 기록")
  eq(T.edgeGateway.find((g) => g.id === "gw-other")?.status, "OFFLINE", "다른 테넌트 Gateway 는 변경되지 않음")

  // ═════════════════════════════════════════════════════════════════════════
  section("STATUS 수신 — 4대 전원 OFFLINE (현장 실측값)")
  res = await post(statusRoute, "/api/lms/ncwatch/status", { machines: MACHINES.map((m) => offline(m)) })
  let json = await res.json()
  eq(res.status, 200, "status 200")
  eq([json.processed, json.unmapped, json.errors], [4, 0, 0], "4대 모두 처리(OK)")
  eq(T.ncwatchStatus.length, 4, "NcwatchStatus 4행(설비당 1행)")
  ok(T.ncwatchStatus.every((s) => s.tenantId === TENANT && s.siteId === SITE), "tenant/site 는 키로 확정된 값 사용")
  eq(T.ncwatchStatusHistory.length, 4, "최초 수신 시 이력 1건씩")
  eq(T.equipmentEvent.length, 4, "EquipmentEvent 최초 1건씩 (OFFLINE → STOP, 알람 아님)")
  ok(T.equipmentEvent.every((e) => e.eventType === "STOP" && e.message === "OFFLINE" && e.endedAt === null), "OFFLINE 은 STOP 이벤트(message=OFFLINE), 장애(ALARM)로 만들지 않음")
  ok(T.tagCurrentValue.length > 0 && T.tagCurrentValue.some((v) => v.tagId === "tag-CNC-1-STATUS" && v.value === "오프라인"), "TagCurrentValue: 상태 태그가 '오프라인' (CNC-1 포함)")
  const startedAt = T.equipmentEvent[0].startedAt as Date
  eq(startedAt.toISOString(), "2026-10-18T02:39:21.000Z", "이벤트 시작시각은 NCWatch 시각(KST)을 UTC 로 환산")

  section("중복 수신 — 중복 이벤트/이력/쓰기 방지")
  const before = { ...counters, history: T.ncwatchStatusHistory.length, events: T.equipmentEvent.length, snaps: T.tagSnapshot.length }
  res = await post(statusRoute, "/api/lms/ncwatch/status", { machines: MACHINES.map((m) => offline(m)) })
  eq((await res.json()).processed, 4, "같은 값 재전송도 정상 처리")
  eq(T.ncwatchStatusHistory.length, before.history, "상태 변화 없음 → 이력 추가 없음")
  eq(T.equipmentEvent.length, before.events, "상태 변화 없음 → 이벤트 추가 없음")
  eq(counters.tagCurrentUpsert, before.tagCurrentUpsert, "값·시각 동일 → TagCurrentValue 재기록 생략")
  eq(counters.tagSnapshotCreate, before.tagSnapshotCreate, "값·시각 동일 → 스냅샷 추가 없음")
  const recv0 = T.ncwatchStatus[0].receivedAt as Date
  ok(recv0 instanceof Date, "NcwatchStatus.receivedAt(마지막 수신시각) 갱신")

  section("상태 변경 — 가동/알람/복귀")
  res = await post(statusRoute, "/api/lms/ncwatch/status", { machines: [offline("MCT-6", { statusCode: 3, statusLabel: "START", runCode: 3, spindleSpeed: 3200, partCount: 5, ncwatchTs: "2026-10-18 13:00:00" })] })
  eq((await res.json()).processed, 1, "MCT-6 가동 수신")
  const mctEvents = T.equipmentEvent.filter((e) => e.equipmentId === "eq-MCT-6")
  eq(mctEvents.map((e) => e.eventType), ["STOP", "RUN"], "이전 STOP 닫히고 RUN 열림")
  ok(mctEvents[0].endedAt instanceof Date && typeof mctEvents[0].duration === "number", "이전 이벤트에 endedAt/duration 기록")
  eq(T.tagCurrentValue.find((v) => v.tagId === "tag-MCT-6-PART_COUNT")?.value, "5", "PART_COUNT 는 태그 참고값으로 저장")
  eq(T.tagCurrentValue.find((v) => v.tagId === "tag-MCT-6-SPINDLE_SPEED")?.value, "3200", "주축 회전수 태그")
  eq(T.ncwatchStatusHistory.filter((h) => h.machineName === "MCT-6").length, 2, "MCT-6 이력 2건(OFFLINE→START)")

  res = await post(statusRoute, "/api/lms/ncwatch/status", { machines: [offline("MCT-6", { statusCode: 5, statusLabel: "ALARM", alarmCode: "1234", alarmMessage: "SERVO ALARM", ncwatchTs: "2026-10-18 13:05:00" })] })
  await res.json()
  const alarm = T.equipmentEvent.filter((e) => e.equipmentId === "eq-MCT-6").at(-1)!
  eq([alarm.eventType, alarm.message], ["ALARM", "[1234] SERVO ALARM"], "알람 이벤트와 메시지")
  eq(T.equipmentEvent.filter((e) => e.equipmentId === "eq-MCT-6" && e.endedAt === null).length, 1, "열린 이벤트는 항상 1건")

  res = await post(statusRoute, "/api/lms/ncwatch/status", { machines: [offline("MCT-6", { statusCode: null, statusLabel: "UNKNOWN", ncwatchTs: "2026-10-18 13:06:00" })] })
  await res.json()
  eq(T.equipmentEvent.filter((e) => e.equipmentId === "eq-MCT-6").length, 3, "statusCode 를 알 수 없는 수신은 이벤트를 만들지 않음")

  section("미매핑 / 매핑 후 수신")
  seedProduction({ mapCnc1: false })
  res = await post(statusRoute, "/api/lms/ncwatch/status", { machines: MACHINES.map((m) => offline(m)) })
  json = await res.json()
  eq([json.processed, json.unmapped, json.errors], [3, 1, 0], "CNC-1 미매핑 → UNMAPPED (수집은 계속, 오류 아님)")
  eq(T.ncwatchStatus.some((s) => s.machineName === "CNC-1"), true, "미매핑 설비도 staging(NcwatchStatus)에 저장")
  eq(T.equipmentEvent.some((e) => e.equipmentId === "eq-CNC-1"), false, "미매핑 설비는 EquipmentEvent 를 만들지 않음")
  // 이후 매핑 생성 → Agent 재설치 없이 다음 수신부터 반영
  T.equipment.push({ id: "eq-CNC-1", tenantId: TENANT, siteId: SITE, code: "CNC-1" })
  T.ncwatchEquipmentMapping.push({ id: newId(), tenantId: TENANT, machineName: "CNC-1", equipmentId: "eq-CNC-1", isActive: true })
  T.connection.push({ id: "conn-CNC-1", equipmentId: "eq-CNC-1" })
  for (const def of provision.NCWATCH_DEFAULT_TAGS) T.dataTag.push({ id: `tag-CNC-1-${def.tagCode}`, connectionId: "conn-CNC-1", tagCode: def.tagCode, isActive: true, isEnabled: true, source: "NCWATCH" })
  res = await post(statusRoute, "/api/lms/ncwatch/status", { machines: [offline("CNC-1")] })
  eq((await res.json()).processed, 1, "매핑 생성 후 같은 Agent 설정으로 즉시 OK")
  eq(T.equipmentEvent.filter((e) => e.equipmentId === "eq-CNC-1").length, 1, "상태 변화가 없어도 열린 이벤트가 없으면 현재 상태 이벤트를 1회 생성")

  section("다른 테넌트 설비 매핑 방지")
  seedProduction()
  T.equipment.find((e) => e.id === "eq-CNC-8")!.tenantId = OTHER_TENANT
  res = await post(statusRoute, "/api/lms/ncwatch/status", { machines: [offline("CNC-8")] })
  json = await res.json()
  eq([json.processed, json.errors, json.machines[0].message], [0, 1, "INVALID_MAPPING"], "다른 테넌트 설비로의 매핑은 거부")

  section("SyncLog — 정상 반복은 줄이고 오류는 기록")
  seedProduction()
  for (let i = 0; i < 5; i++) await post(statusRoute, "/api/lms/ncwatch/status", { machines: MACHINES.map((m) => offline(m, { ncwatchTs: `2026-10-18 11:39:${10 + i}` })) })
  ok(counters.syncLogCreateMany <= 2, `정상 5회 수신 중 SyncLog 기록 호출 ${counters.syncLogCreateMany}회 (이전 구현: 5회 모두, 매번 설비 수+1행)`)

  // ═════════════════════════════════════════════════════════════════════════
  section("REPORT_DAILY 수신")
  seedProduction()
  res = await post(dailyRoute, "/api/lms/ncwatch/report-daily", { machines: [{ machineName: "CNC-8", reportDate: "2026-10-18", runTime: "01:00", runPct: 10.5, partCount: 3 }, { machineName: "CNC-9", reportDate: "bad-date" }] })
  json = await res.json()
  eq([res.status, json.processed, json.errors], [200, 1, 1], "정상 1건 저장, 날짜 형식 오류 1건은 오류로 분리")
  eq(T.ncwatchReportDaily[0].reportDate.toISOString(), "2026-10-18T00:00:00.000Z", "KST 날짜 문자열이 그대로 날짜로 저장")
  eq((await post(dailyRoute, "/api/lms/ncwatch/report-daily", { machines: [] })).status, 400, "빈 machines → 400")
  eq((await post(dailyRoute, "/api/lms/ncwatch/report-daily", { machines: [{ machineName: "x", reportDate: "2026-10-18" }] }, "bad-key-bad-key-bad-key")).status, 401, "report-daily 인증 실패 → 401")

  section("GET 요청은 405")
  eq(typeof statusRoute.GET, "undefined", "status 는 POST 만 구현")

  // ═════════════════════════════════════════════════════════════════════════
  section("정적 점검 — 키/비밀번호 하드코딩 없음")
  for (const f of ["lib/ncwatch/provision.ts", "lib/ncwatch/transform.ts", "app/api/lms/ncwatch/status/route.ts"]) {
    const text = readFileSync(join(SRC, f), "utf8")
    ok(!/dwk_[A-Za-z0-9_-]{20,}/.test(text) && !/gw-api-key-demo/.test(text), `${f}: 인증키 문자열 없음`)
  }
  const ops = readFileSync(join(__dirname, "ncwatch-ops.ts"), "utf8")
  ok(!/console\.log\([^)]*plainKey/.test(ops), "ncwatch-ops 는 평문 키를 콘솔에 출력하지 않는다")

  console.log(`\n통과 ${passed}건`)
}

main().catch((e) => {
  console.error("\n실패:", e && e.message ? e.message : e)
  process.exit(1)
})
