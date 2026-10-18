/**
 * 모니터링 최신 스냅샷 조회 회귀 테스트 (운영 DB 접속 없음).
 *
 * getEquipmentMonitorData / getEquipmentMonitorLive 가 TagSnapshot 의 "전체 이력"이 아니라
 * 태그당 최신 1건만 DB 에서 가져오는지, 테넌트가 격리되는지, 다중 접속에서도 호출량이 일정한지 검증한다.
 * (실제 PostgreSQL 실행 계획·행 수 실측은 docs/DAEWON-NCWATCH-SNAPSHOT-POLICY.md 의 "모니터링 조회" 절 참조)
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import Module from "node:module"
import { join, sep } from "node:path"

const SRC = join(__dirname, "..", "src")
type Row = Record<string, any>

// ─── 가짜 DB ─────────────────────────────────────────────────────────────────
type Tag = { id: string; tagCode: string; displayName: string; unit: string | null; displayOrder: number }
const db = {
  equipments: [] as { id: string; tenantId: string; code: string; tags: Tag[] }[],
  currentValues: new Map<string, { value: string; timestamp: Date }>(),
  lastSnapshot: new Map<string, { value: string; timestamp: Date }>(), // 태그별 "최신" (대량 이력 중 마지막)
  snapshotRows: 0,                                                       // 누적 이력 행 수(수만~수백만)
}
let currentTenant = "tenant-A"
let failFirstFindMany = false
const calls = { snapshotQueries: 0, snapshotRowsReturned: 0, snapshotSqls: [] as string[], snapshotTagIds: [] as string[][], findMany: [] as Row[] }
function resetCalls() {
  calls.snapshotQueries = 0; calls.snapshotRowsReturned = 0; calls.snapshotSqls = []; calls.snapshotTagIds = []; calls.findMany = []
}

function buildTenant(tenantId: string, eqCodes: string[]) {
  for (const code of eqCodes) {
    const tags: Tag[] = ["STATUS", "PROGRAM_NAME", "MODE", "SPINDLE_SPEED", "FEED_RATE", "PART_COUNT", "TOOL_NO", "RATIO", "BLOCK_NUMBER", "O_NUMBER", "ALARM_MESSAGE", "POS_X", "POS_Y", "POS_Z"].map(
      (tagCode, i) => ({ id: `${tenantId}-${code}-${tagCode}`, tagCode, displayName: tagCode, unit: null, displayOrder: i })
    )
    db.equipments.push({ id: `${tenantId}-${code}`, tenantId, code, tags })
  }
}

const fakePrisma: any = {
  equipment: {
    findMany: async (args: Row) => {
      calls.findMany.push(args)
      if (failFirstFindMany) { failFirstFindMany = false; throw Object.assign(new Error("column missing"), { code: "P2022" }) }
      const tenantId = args.where?.tenantId
      assert.ok(tenantId, "equipment 조회에는 항상 tenantId 조건이 있어야 한다")
      return db.equipments
        .filter((e) => e.tenantId === tenantId)
        .map((e) => ({
          id: e.id, code: e.code, name: e.code, equipmentType: "MACHINE", status: "ACTIVE",
          workCenter: { name: "가공" },
          events: [],
          connections: [{
            tags: e.tags.map((t) => ({ ...t, currentValue: db.currentValues.get(t.id) ?? null })),
          }],
        }))
    },
  },
  ncwatchEquipmentMapping: { findMany: async () => [] },
  ncwatchReportDaily: { findMany: async () => [] },
  $queryRaw: async (sql: any) => {
    const text: string = sql.sql ?? String(sql)
    if (text.includes('"TagSnapshot"')) {
      calls.snapshotQueries++
      calls.snapshotSqls.push(text)
      const ids: string[] = sql.values.flat()
      calls.snapshotTagIds.push(ids)
      // SQL 의미(LATERAL … LIMIT 1)를 그대로 흉내: 태그당 최신 1행만 돌려준다. 이력 총량(snapshotRows)과 무관.
      const rows = ids.filter((id) => db.lastSnapshot.has(id)).map((id) => ({ tagId: id, ...db.lastSnapshot.get(id)! }))
      calls.snapshotRowsReturned += rows.length
      return rows
    }
    if (text.includes('"EquipmentEvent"')) return []
    return []
  },
}

const origResolve = (Module as any)._resolveFilename
const origLoad = (Module as any)._load
;(Module as any)._resolveFilename = function (request: string, ...rest: any[]) {
  if (typeof request === "string" && request.startsWith("@/")) request = join(SRC, request.slice(2))
  return origResolve.call(this, request, ...rest)
}
;(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
  let resolved = ""
  try { resolved = (Module as any)._resolveFilename(request, parent, isMain) } catch { /* ignore */ }
  const norm = resolved.split(sep).join("/")
  if (norm.endsWith("/src/lib/db/prisma.ts")) return { prisma: fakePrisma, default: fakePrisma }
  if (norm.endsWith("/src/lib/auth.ts")) return { getTenantId: async () => currentTenant }
  return origLoad.call(this, request, parent, isMain)
}

/* eslint-disable @typescript-eslint/no-var-requires */
const monitor = require("../src/lib/actions/equipment-monitor.actions")
const utils = require("../src/lib/actions/equipment-monitoring.utils")
/* eslint-enable @typescript-eslint/no-var-requires */

let passed = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); passed++; console.log(`  ✓ ${m}`) }
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, `${m} (실제: ${JSON.stringify(a)}, 기대: ${JSON.stringify(b)})`); passed++; console.log(`  ✓ ${m}`) }
const section = (s: string) => console.log(`\n■ ${s}`)

async function main() {
  const monitorSrc = readFileSync(join(SRC, "lib/actions/equipment-monitor.actions.ts"), "utf8")
  const utilsSrc = readFileSync(join(SRC, "lib/actions/equipment-monitoring.utils.ts"), "utf8")

  section("정적 점검 — 전체 이력을 가져오는 패턴 제거")
  ok(!/snapshots\s*:\s*\{/.test(monitorSrc), "중첩 snapshots(take:1) 조회가 남아 있지 않다 (LIMIT 없는 SQL 의 원인)")
  ok(!/DISTINCT ON \("tagId"\)[\s\S]{0,200}FROM "TagSnapshot"/.test(monitorSrc), "TagSnapshot 에 대한 DISTINCT ON(이력 전체 스캔) 폴백이 없다")
  ok(/CROSS JOIN LATERAL/.test(utilsSrc) && /ORDER BY "timestamp" DESC\s+LIMIT 1/.test(utilsSrc), "최신 스냅샷은 태그별 LATERAL + ORDER BY timestamp DESC LIMIT 1")
  ok(!/"tagId"\s+IN\s*\(/.test(utilsSrc.replace(/\/\/.*$/gm, "")), "IN (…) 로 이력 전체를 읽는 조회가 없다")

  // 테넌트 A: 설비 4대 × 14태그, 테넌트 B: 설비 2대
  buildTenant("tenant-A", ["CNC-1", "CNC-8", "CNC-9", "MCT-6"])
  buildTenant("tenant-B", ["B-1", "B-2"])
  const A_TAGS = db.equipments.filter((e) => e.tenantId === "tenant-A").flatMap((e) => e.tags.map((t) => t.id))
  const B_TAGS = db.equipments.filter((e) => e.tenantId === "tenant-B").flatMap((e) => e.tags.map((t) => t.id))
  // 대량 누적: 태그마다 "최신" 값만 보관하되 총 이력은 1,000,000건 이상이라고 가정
  db.snapshotRows = 1_200_000
  for (const id of [...A_TAGS, ...B_TAGS]) db.lastSnapshot.set(id, { value: `latest:${id}`, timestamp: new Date("2026-10-18T06:00:00Z") })

  section("대량 스냅샷(1,200,000건 가정)에서 최신값만 조회 — getEquipmentMonitorData")
  currentTenant = "tenant-A"; resetCalls()
  const rows = await monitor.getEquipmentMonitorData()
  eq(rows.length, 4, "테넌트 A 설비 4대")
  eq(calls.snapshotQueries, 1, "스냅샷 조회는 1회")
  eq(calls.snapshotRowsReturned, A_TAGS.length, `DB 에서 앱으로 오는 스냅샷 행 수 = 태그 수(${A_TAGS.length}) — 이력 총량(${db.snapshotRows.toLocaleString()})과 무관`)
  ok(rows.every((r: Row) => r.recentTags.every((t: Row) => t.latestValue === `latest:${r.id}-${t.tagCode}`)), "각 태그의 표시값 = 해당 태그의 최신 스냅샷")
  ok(calls.findMany[0]?.include?.connections?.include?.tags?.include?.snapshots === undefined, "equipment 조회에 snapshots 중첩 include 없음")
  ok(/LATERAL/.test(calls.snapshotSqls[0]) && /LIMIT 1/.test(calls.snapshotSqls[0]), "실행 SQL 에 LATERAL + LIMIT 1")

  section("스키마 호환 경로(폴백)에서도 동일")
  failFirstFindMany = true; resetCalls()
  const compat = await monitor.getEquipmentMonitorData()
  eq([compat.length, calls.snapshotQueries, calls.snapshotRowsReturned], [4, 1, A_TAGS.length], "호환 경로: 설비 4대, 스냅샷 조회 1회, 행 수 = 태그 수")
  ok(compat[0].recentTags.every((t: Row) => String(t.latestValue).startsWith("latest:")), "호환 경로 표시값 정상")

  section("현재값이 없는 태그의 폴백 — getEquipmentMonitorLive")
  currentTenant = "tenant-A"; resetCalls()
  db.currentValues.clear()
  for (const id of A_TAGS) if (!id.endsWith("-ALARM_MESSAGE") && !id.endsWith("-POS_Z")) db.currentValues.set(id, { value: `current:${id}`, timestamp: new Date("2026-10-18T06:01:00Z") })
  const live = await monitor.getEquipmentMonitorLive()
  const missing = A_TAGS.filter((id) => !db.currentValues.has(id))
  eq(calls.snapshotTagIds[0]?.sort(), [...missing].sort(), "현재값이 없는 태그만 스냅샷 조회 대상")
  eq(calls.snapshotRowsReturned, missing.length, "반환 행 수 = 현재값 없는 태그 수")
  const e0 = live.find((r: Row) => r.code === "CNC-1")
  eq([e0.recentTags.find((t: Row) => t.tagCode === "STATUS").latestValue, e0.recentTags.find((t: Row) => t.tagCode === "POS_Z").latestValue],
    ["current:tenant-A-CNC-1-STATUS", "latest:tenant-A-CNC-1-POS_Z"], "현재값이 있으면 현재값, 없으면 최신 스냅샷")
  db.currentValues.clear(); resetCalls()
  await monitor.getEquipmentMonitorLive()
  eq(calls.snapshotQueries, 1, "현재값이 전혀 없어도(최초 연결 직후) 스냅샷 조회는 1회, 태그당 1행")
  for (const id of A_TAGS) db.currentValues.set(id, { value: "v", timestamp: new Date() }); resetCalls()
  await monitor.getEquipmentMonitorLive()
  eq(calls.snapshotQueries, 0, "모든 태그에 현재값이 있으면 스냅샷 조회 0회")
  eq(await utils.fetchLatestSnapshotsByTag({ $queryRaw: async () => { throw new Error("호출되면 안 됨") } }, []), new Map(), "태그가 없으면 DB 조회 없음")

  section("다중 사용자 — 30초 폴링 동시 20명")
  db.currentValues.clear(); resetCalls(); currentTenant = "tenant-A"
  await Promise.all(Array.from({ length: 20 }, () => monitor.getEquipmentMonitorData()))
  eq([calls.snapshotQueries, calls.snapshotRowsReturned], [20, 20 * A_TAGS.length], "20명 동시 접속: 호출당 스냅샷 쿼리 1회·행 수 = 태그 수 (이력 크기에 비례하지 않음)")
  ok(calls.snapshotTagIds.every((ids) => ids.length === A_TAGS.length), "호출마다 같은 크기의 입력(태그 ID)만 사용")

  section("테넌트 격리")
  currentTenant = "tenant-B"; resetCalls()
  const b = await monitor.getEquipmentMonitorData()
  eq(b.map((r: Row) => r.code).sort(), ["B-1", "B-2"], "테넌트 B 는 자기 설비만 조회")
  ok(calls.snapshotTagIds[0].every((id) => B_TAGS.includes(id)) && !calls.snapshotTagIds[0].some((id) => A_TAGS.includes(id)), "스냅샷 조회에 쓰인 태그 ID 는 모두 테넌트 B 소속")
  ok(JSON.stringify(b).indexOf("tenant-A") === -1, "응답에 테넌트 A 데이터가 없음")
  eq(calls.findMany[0].where.tenantId, "tenant-B", "설비 조회 조건에 테넌트 ID")

  console.log(`\n통과 ${passed}건`)
}

main().catch((e) => {
  console.error("\n실패:", e && e.message ? e.message : e)
  process.exit(1)
})
