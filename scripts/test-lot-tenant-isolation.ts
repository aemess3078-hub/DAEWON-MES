/**
 * LOT 생성(createLot)·공통 번호 생성(generateNumber) tenant 격리 테스트 — 메모리 가짜 DB, 실제 PostgreSQL/브라우저 없음.
 *
 *  L. createLot: 정상 · 비로그인 · 권한 없음 · 다른 tenantId · 다른 tenant 품목 · 없는 품목 · data 위조 · 정상 결과 유지 · 잘못된 요청의 DB 쓰기 0건
 *  N. generateNumber: 정상 · 비로그인 · 권한 없음 · 다른 tenantId · 지원하지 않는 type · context 우회 · 시퀀스 미증가 · 번호 형식 · 호출처 호환성 · 다른 업무 영향 없음
 *
 * 실제 DB 의 품목/규칙 조회, 시퀀스 upsert 의 동시성, 세션·권한 테이블은 이 테스트로 검증되지 않는다(미검증 항목).
 */
import assert from "node:assert/strict"
import Module from "node:module"
import { join } from "node:path"
import { between, listFiles, readSource, stripComments } from "./test-support/source-invariants"

const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}

async function main() {
  type Row = Record<string, unknown>
  const items: Row[] = [
    { id: "item-a", tenantId: "t1", code: "RM-A" },
    { id: "item-t2", tenantId: "t2", code: "SECRET-T2" },
  ]
  const tokensT1 = [
    { id: "1", type: "FIXED", value: "L" },
    { id: "2", type: "SEPARATOR", value: "-" },
    { id: "3", type: "CONTEXT", key: "ITEM_CODE", fallback: "XX" },
    { id: "4", type: "SEQ", digits: 3 },
  ]
  const tokensT2 = [
    { id: "1", type: "FIXED", value: "T2-" },
    { id: "2", type: "SEQ", digits: 3 },
  ]
  const rules: Row[] = [
    { id: "rule-t1", tenantId: "t1", type: "LOT", isActive: true, tokens: tokensT1 },
    { id: "rule-t2", tenantId: "t2", type: "LOT", isActive: true, tokens: tokensT2 },
  ]
  const sequences = new Map<string, number>()
  const lots: Row[] = []
  const calls = { itemFind: 0, lotFind: 0, lotCreate: 0, lotCount: 0, ruleFind: 0, seqUpsert: 0, revalidate: 0 }
  const createdData: Array<Record<string, unknown>> = []
  const itemWheres: Array<Record<string, unknown>> = []
  const ruleWheres: Array<Record<string, unknown>> = []
  const lotCountWheres: Array<Record<string, unknown>> = []

  const auth: { mode: "ok" | "anon"; tenantId: string; allowed: Set<string> } = { mode: "ok", tenantId: "t1", allowed: new Set(["LOT:CREATE"]) }
  const setAuth = (mode: "ok" | "anon", tenantId = "t1", allowed: string[] = ["LOT:CREATE"]) => {
    auth.mode = mode
    auth.tenantId = tenantId
    auth.allowed = new Set(allowed)
  }

  const txClient = {
    numberingSequence: {
      upsert: async (a: { where: { ruleId_periodKey: { ruleId: string; periodKey: string } }; update: unknown; create: { current: number } }) => {
        calls.seqUpsert += 1
        const key = `${a.where.ruleId_periodKey.ruleId}|${a.where.ruleId_periodKey.periodKey}`
        const next = (sequences.get(key) ?? 0) + 1
        sequences.set(key, next)
        return { current: next }
      },
    },
  }
  const fakePrisma = {
    item: {
      findFirst: async (a: { where: Record<string, unknown> }) => {
        calls.itemFind += 1
        itemWheres.push(a.where)
        return items.find((it) => Object.entries(a.where).every(([k, v]) => it[k] === v)) ?? null
      },
    },
    lot: {
      findFirst: async (a: { where: Record<string, unknown> }) => {
        calls.lotFind += 1
        return lots.find((l) => Object.entries(a.where).every(([k, v]) => l[k] === v)) ?? null
      },
      create: async (a: { data: Record<string, unknown> }) => {
        calls.lotCreate += 1
        createdData.push(a.data)
        lots.push({ ...a.data })
        return a.data
      },
      count: async (a: { where: Record<string, unknown> }) => {
        calls.lotCount += 1
        lotCountWheres.push(a.where)
        return 0
      },
    },
    numberingRule: {
      findUnique: async (a: { where: { tenantId_type: { tenantId: string; type: string } } }) => {
        calls.ruleFind += 1
        ruleWheres.push(a.where.tenantId_type)
        return rules.find((r) => r.tenantId === a.where.tenantId_type.tenantId && r.type === a.where.tenantId_type.type) ?? null
      },
    },
    $transaction: async <T,>(fn: (tx: typeof txClient) => Promise<T>) => fn(txClient),
  }
  function inject(modulePath: string, exports: Record<string, unknown>) {
    const filename = require.resolve(modulePath)
    const mod = new Module(filename)
    mod.filename = filename
    mod.loaded = true
    mod.exports = exports
    require.cache[filename] = mod
  }
  const actor = () => ({ tenantId: auth.tenantId, id: "user-1", name: "작업자", profileId: "p1" })
  inject("../src/lib/db/prisma", { prisma: fakePrisma })
  inject("next/cache", { revalidatePath: () => void (calls.revalidate += 1) })
  inject("../src/lib/auth/role-permissions", {
    requireResourcePermission: async (resource: string, action: string) => {
      if (auth.mode === "anon") throw new Error("UNAUTHORIZED")
      if (!auth.allowed.has(`${resource}:${action}`)) throw new Error("이 기능을 사용할 권한이 없습니다.")
      return actor()
    },
  })
  // getTenantId 는 실제 구현처럼 세션이 없어도 DEFAULT_TENANT_ID 로 대체할 수 있다 — 두 액션이 이 값을 쓰지 않아야 한다
  inject("../src/lib/auth", {
    getTenantId: async () => process.env.DEFAULT_TENANT_ID ?? auth.tenantId,
    getCurrentUser: async () => (auth.mode === "anon" ? null : actor()),
  })
  inject("../src/lib/auth/daewon-scope.server", { assertDeveloperOnly: async () => {}, assertDaewonFeatureScope: async () => {} })
  const lotActions = require("../src/lib/actions/lot.actions") as typeof import("../src/lib/actions/lot.actions")
  const numbering = require("../src/lib/actions/numbering-rule.actions") as typeof import("../src/lib/actions/numbering-rule.actions")

  const rejection = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
      await fn()
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  const reset = () => {
    for (const k of Object.keys(calls) as Array<keyof typeof calls>) calls[k] = 0
    createdData.length = 0
    itemWheres.length = 0
    ruleWheres.length = 0
    lotCountWheres.length = 0
    lots.length = 0
    sequences.clear()
  }
  const noDbActivity = () => calls.itemFind === 0 && calls.lotFind === 0 && calls.lotCreate === 0 && calls.ruleFind === 0 && calls.seqUpsert === 0 && calls.lotCount === 0
  const DENIED = "이 기능을 사용할 권한이 없습니다."
  const NOT_FOUND = "품목을 찾을 수 없습니다."
  const valid = { itemId: "item-a", lotNo: "LOT-OK-1", qty: 10, manufactureDate: "2026-10-01", expiryDate: "2027-10-01" }

  // ═══ L. createLot ═══════════════════════════════════════════════════════════
  setAuth("ok")
  reset()
  const created = await lotActions.createLot(valid, "t1")
  ok(created === undefined && calls.lotCreate === 1 && createdData[0].tenantId === "t1" && createdData[0].itemId === "item-a" && createdData[0].lotNo === "LOT-OK-1" && createdData[0].status === "ACTIVE", "L1 [정상 로그인 사용자] LOT 생성 — 세션 tenant 로 1건 생성, 기존과 같은 반환(없음)")
  ok(itemWheres[0].tenantId === "t1" && itemWheres[0].id === "item-a" && calls.revalidate === 1, "L1b 품목은 세션 tenant 조건으로 확인하고 LOT 화면 캐시를 갱신")

  setAuth("anon")
  reset()
  const anon = await rejection(() => lotActions.createLot(valid, "t1"))
  ok(anon === "UNAUTHORIZED" && noDbActivity(), "L2 [비로그인] 거부 — DB 조회·쓰기 0건")

  setAuth("ok", "t1", ["LOT:READ", "LOT:UPDATE"])
  reset()
  const denied = await rejection(() => lotActions.createLot(valid, "t1"))
  ok(denied === DENIED && noDbActivity(), "L3 [CREATE 권한 없는 사용자] 거부 — DB 조회·쓰기 0건")

  setAuth("ok", "t1")
  reset()
  const spoofA = await rejection(() => lotActions.createLot(valid, "t2"))
  setAuth("ok", "t2")
  const spoofB = await rejection(() => lotActions.createLot(valid, "t1"))
  ok(spoofA === DENIED && spoofB === DENIED && noDbActivity(), "L4 [다른 tenantId 전달] 세션과 다르면 권한 오류로 거부 — DB 조회·쓰기 0건 (다른 tenant 에 LOT 를 만들 수 없다)")

  setAuth("ok", "t1")
  reset()
  const otherTenantItem = await rejection(() => lotActions.createLot({ ...valid, itemId: "item-t2" }, "t1"))
  ok(otherTenantItem === NOT_FOUND && calls.lotCreate === 0 && calls.lotFind === 0, "L5 [다른 tenant 품목으로 LOT 생성] 거부 — 중복 검사·생성까지 가지 않는다")

  const missingItem = await rejection(() => lotActions.createLot({ ...valid, itemId: "item-nope" }, "t1"))
  const emptyItem = await rejection(() => lotActions.createLot({ ...valid, itemId: "" }, "t1"))
  const nonStringItem = await rejection(() => lotActions.createLot({ ...valid, itemId: null as never }, "t1"))
  const noData = await rejection(() => lotActions.createLot(null as never, "t1"))
  ok(missingItem === NOT_FOUND && emptyItem === NOT_FOUND && nonStringItem === NOT_FOUND && calls.lotCreate === 0, "L6 [존재하지 않는/잘못된 품목] 거부")
  ok(otherTenantItem === missingItem && !/t2|SECRET|item-/.test(String(otherTenantItem)), "L6b 다른 tenant 품목과 존재하지 않는 품목의 응답이 완전히 같고 식별자가 없다 — 존재 여부 비노출")
  ok(noData === "LOT번호를 입력하세요" && calls.lotCreate === 0, "L6c data 가 없으면 입력 오류로 거부")

  // data 위조: tenantId/status/id/관계 연결값은 저장되지 않는다
  reset()
  const tampered = { ...valid, tenantId: "t2", status: "QUARANTINE", id: "forged-id", item: { connect: { id: "item-t2" } }, createdAt: "2000-01-01" } as never
  await lotActions.createLot(tampered, "t1")
  const keys = Object.keys(createdData[0]).sort().join()
  ok(calls.lotCreate === 1 && createdData[0].tenantId === "t1" && createdData[0].status === "ACTIVE" && keys === "expiryDate,itemId,lotNo,manufactureDate,status,tenantId", "L7 [data 내부 tenant 조작] data 의 tenantId·status·id·관계 연결값은 무시되고, 저장 필드는 서버가 정한 6개뿐이며 tenant 는 세션 값")
  setAuth("ok", "t1")
  const tamperedOtherItem = await rejection(() => lotActions.createLot({ ...valid, lotNo: "LOT-OK-2", itemId: "item-t2", tenantId: "t2" } as never, "t1"))
  ok(tamperedOtherItem === NOT_FOUND, "L7b data.tenantId 를 t2 로 바꾸고 t2 품목을 보내도 세션 tenant(t1) 기준으로 거부")

  // 정상 결과 유지
  reset()
  await lotActions.createLot({ itemId: "item-a", lotNo: " LOT 공백 ", qty: 1 }, "t1")
  ok(createdData[0].lotNo === " LOT 공백 " && createdData[0].manufactureDate === null && createdData[0].expiryDate === null, "L8 [정상 결과 유지] LOT 번호는 입력값 그대로 저장, 날짜가 없으면 null")
  reset()
  await lotActions.createLot(valid, "t1")
  ok((createdData[0].manufactureDate as Date).toISOString().startsWith("2026-10-01") && (createdData[0].expiryDate as Date).toISOString().startsWith("2027-10-01"), "L8b 날짜는 기존처럼 Date 로 저장")
  const dup = await rejection(() => lotActions.createLot(valid, "t1"))
  ok(dup === "LOT번호 'LOT-OK-1'는 이미 존재합니다." && calls.lotCreate === 1, "L8c 중복 LOT 번호 거부 문구·동작 유지(생성은 첫 1건뿐)")

  // 잘못된 요청 → DB 쓰기 0건
  reset()
  const bad = [
    await rejection(() => lotActions.createLot({ ...valid, lotNo: "" }, "t1")),
    await rejection(() => lotActions.createLot({ ...valid, lotNo: "   " }, "t1")),
    await rejection(() => lotActions.createLot({ ...valid, lotNo: "L".repeat(129) }, "t1")),
    await rejection(() => lotActions.createLot({ ...valid, lotNo: 123 as never }, "t1")),
    await rejection(() => lotActions.createLot({ ...valid, expiryDate: "not-a-date" }, "t1")),
    await rejection(() => lotActions.createLot({ ...valid, manufactureDate: { $gt: 1 } as never }, "t1")),
  ]
  ok(bad.every((m) => m !== null) && calls.lotCreate === 0 && calls.itemFind === 0, "L9 [잘못된 요청] 빈/공백/너무 긴/문자가 아닌 LOT 번호, 해석할 수 없는 날짜는 모두 DB 조회·쓰기 전에 거부 — 생성 0건")

  // DEFAULT_TENANT_ID 우회
  setAuth("anon")
  process.env.DEFAULT_TENANT_ID = "t1"
  reset()
  const bypassLot = await rejection(() => lotActions.createLot(valid, "t1"))
  delete process.env.DEFAULT_TENANT_ID
  const lotSrc = readSource("src/lib/actions/lot.actions.ts")
  const createSrc = stripComments(between(lotSrc, "export async function createLot", "// ─── LOT 상태 변경") ?? "")
  ok(bypassLot === "UNAUTHORIZED" && noDbActivity() && !/getTenantId/.test(createSrc), "L10 [DEFAULT_TENANT_ID] 개발용 대체값이 있어도 비로그인 호출은 거부되고 createLot 은 getTenantId 를 쓰지 않는다")
  ok(createSrc.indexOf('requireResourcePermission("LOT", "CREATE")') < createSrc.indexOf("prisma.") && createSrc.indexOf("prisma.item.findFirst") < createSrc.indexOf("prisma.lot.create") && !createSrc.includes("...data"), "L11 소스: 권한 확인이 모든 DB 접근보다 앞서고, 품목 소속 확인 후에만 생성하며, data 를 통째로 펼치지 않는다")

  // ═══ N. generateNumber ══════════════════════════════════════════════════════
  const periodKey = "ALL"
  setAuth("ok")
  reset()
  const n1 = await numbering.generateNumber("t1", "LOT", { ITEM_CODE: "RM-A", ITEM_TYPE: "RAW_MATERIAL" })
  const n2 = await numbering.generateNumber("t1", "LOT", { ITEM_CODE: "RM-A" })
  ok(n1 === "L-RM-A001" && n2 === "L-RM-A002" && sequences.get(`rule-t1|${periodKey}`) === 2, "N1 [정상 채번] 규칙대로 번호 생성(L-RM-A001, 002) · 시퀀스 1씩 증가 · 다른 tenant 규칙의 시퀀스는 그대로")
  ok(ruleWheres.every((w) => w.tenantId === "t1") && !sequences.has(`rule-t2|${periodKey}`), "N1b 규칙 조회는 세션 tenant 로만 실행")

  setAuth("anon")
  reset()
  const nAnon = await rejection(() => numbering.generateNumber("t1", "LOT", { ITEM_CODE: "RM-A" }))
  ok(nAnon === "UNAUTHORIZED" && noDbActivity() && sequences.size === 0, "N2 [비로그인] 거부 — 규칙 조회·시퀀스 증가 없음")

  setAuth("ok", "t1", ["LOT:READ", "LOT:UPDATE", "PURCHASE_ORDER:CREATE"])
  reset()
  const nDenied = await rejection(() => numbering.generateNumber("t1", "LOT", {}))
  ok(nDenied === DENIED && noDbActivity() && sequences.size === 0, "N3 [권한 없는 사용자] LOT CREATE 가 없으면 다른 업무 권한이 있어도 거부 — 시퀀스 증가 없음")

  setAuth("ok", "t1")
  reset()
  const nSpoof1 = await rejection(() => numbering.generateNumber("t2", "LOT", {}))
  setAuth("ok", "t2")
  const nSpoof2 = await rejection(() => numbering.generateNumber("t1", "LOT", {}))
  ok(nSpoof1 === DENIED && nSpoof2 === DENIED && noDbActivity() && sequences.size === 0, "N4 [다른 tenantId] 세션과 다르면 권한 오류로 거부 — 다른 tenant 의 규칙 조회·시퀀스 증가 없음")

  setAuth("ok", "t1")
  reset()
  const badTypes = [
    await rejection(() => numbering.generateNumber("t1", "WORK_ORDER" as never, {})),
    await rejection(() => numbering.generateNumber("t1", "lot" as never, {})),
    await rejection(() => numbering.generateNumber("t1", "" as never, {})),
    await rejection(() => numbering.generateNumber("t1", undefined as never, {})),
    await rejection(() => numbering.generateNumber("t1", { $ne: "LOT" } as never, {})),
  ]
  ok(badTypes.every((m) => m === "지원하지 않는 번호 유형입니다.") && calls.ruleFind === 0 && calls.seqUpsert === 0 && sequences.size === 0, "N5 [지원하지 않는 type] 거부 — 규칙 조회·시퀀스 증가 없음")

  reset()
  const ctxBad = [
    await rejection(() => numbering.generateNumber("t1", "LOT", { tenantId: "t2", ruleId: "rule-t2" } as never)),
    await rejection(() => numbering.generateNumber("t1", "LOT", { ITEM_CODE: 5 } as never)),
    await rejection(() => numbering.generateNumber("t1", "LOT", { ITEM_CODE: "x".repeat(101) })),
    await rejection(() => numbering.generateNumber("t1", "LOT", ["ITEM_CODE"] as never)),
    await rejection(() => numbering.generateNumber("t1", "LOT", "ITEM_CODE" as never)),
  ]
  ok(ctxBad.every((m) => m === "번호 생성 정보가 올바르지 않습니다.") && calls.ruleFind === 0 && calls.seqUpsert === 0 && sequences.size === 0, "N6 [context 를 이용한 우회] tenant/규칙 식별자 같은 알 수 없는 키, 문자열이 아닌 값, 과도한 길이, 배열/문자열 context 는 거부 — 시퀀스 증가 없음")
  const withUndefined = await numbering.generateNumber("t1", "LOT", { ITEM_CODE: undefined, ITEM_TYPE: "RAW" } as never)
  ok(withUndefined === "L-XX001" && ruleWheres.every((w) => w.tenantId === "t1"), "N6b 값이 비어 있는 키는 없는 것으로 보고(기존 fallback 동작 유지), 규칙은 항상 세션 tenant 것을 쓴다")

  // 번호 형식 유지: 규칙 없는 tenant 의 기본 형식, SERIAL
  setAuth("ok", "t1")
  reset()
  rules.splice(0, rules.length) // 규칙이 하나도 없는 경우
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const defLot = await numbering.generateNumber("t1", "LOT")
  const defSerial = await numbering.generateNumber("t1", "SERIAL", undefined)
  ok(defLot === `LOT-${dateStr}-0001` && defSerial === `SN-${dateStr}-0001` && lotCountWheres.every((w) => w.tenantId === "t1"), "N8 [번호 형식 유지] 규칙이 없으면 LOT-YYYYMMDD-0001 / SN-YYYYMMDD-0001 기본 형식, 순번 조회는 세션 tenant 기준 · SERIAL 도 기존 권한(LOT CREATE)으로 동작")
  rules.push({ id: "rule-t1", tenantId: "t1", type: "LOT", isActive: true, tokens: tokensT1 }, { id: "rule-t2", tenantId: "t2", type: "LOT", isActive: true, tokens: tokensT2 })

  // 호출처 호환성 / 다른 업무
  const importers = listFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && f !== "src/lib/actions/numbering-rule.actions.ts" && readSource(f).includes("numbering-rule.actions"))
  const callSites = importers.flatMap((f) => Array.from(stripComments(readSource(f)).matchAll(/generateNumber\(([^)]*)\)/g)).map((m) => ({ f, args: m[1] })))
  ok(importers.sort().join() === "src/app/app/mes/lot-rules/numbering-rule-builder.tsx,src/app/app/mes/lot-rules/page.tsx,src/app/app/mes/lot/lot-form-sheet.tsx", "N9 [호출처] 번호 규칙 액션을 쓰는 파일은 LOT 등록 시트와 번호 규칙 관리 화면 2곳뿐")
  ok(callSites.length === 2 && callSites.every((c) => c.f === "src/app/app/mes/lot/lot-form-sheet.tsx" && /^tenantId, "LOT", (autoContext|context)$/.test(c.args.trim())), "N9b generateNumber 호출은 LOT 등록 시트의 2곳(type \"LOT\", ITEM_CODE/ITEM_TYPE 등 문자열 context)이고 호출 형태가 그대로다 — 서명 변경 없음")
  const others = ["src/lib/actions/work-order.actions.ts", "src/lib/actions/purchase-order.actions.ts", "src/lib/actions/receiving.actions.ts", "src/lib/actions/finished-goods.actions.ts", "src/lib/actions/shipment.actions.ts"].filter((f) => listFiles(f).length > 0)
  ok(others.length >= 3 && others.every((f) => !readSource(f).includes("numbering-rule.actions") && !/generateNumber\(/.test(stripComments(readSource(f)))), `N10 [다른 업무의 채번] 작업지시·발주·입고·완제품·출하(${others.length}개 확인)는 generateNumber 를 쓰지 않아 이번 변경의 영향이 없다`)

  // 소스 구조: 모든 검증이 시퀀스 증가보다 앞선다
  const nrSrc = readSource("src/lib/actions/numbering-rule.actions.ts")
  const genSrc = stripComments(between(nrSrc, "export async function generateNumber", "\n}\n") ?? "")
  ok(genSrc.indexOf('requireResourcePermission("LOT", "CREATE")') < genSrc.indexOf("clientTenantId !== actor.tenantId") && genSrc.indexOf("clientTenantId !== actor.tenantId") < genSrc.indexOf("sanitizeNumberContext(rawContext)") && genSrc.indexOf("sanitizeNumberContext(rawContext)") < genSrc.indexOf("numberingRule.findUnique") && genSrc.indexOf("numberingRule.findUnique") < genSrc.indexOf("numberingSequence.upsert") && !/getTenantId/.test(genSrc), "N11 소스: 권한 → tenant 대조 → type·context 검증 → 규칙 조회 → 시퀀스 증가 순서이고 getTenantId 를 쓰지 않는다")

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
