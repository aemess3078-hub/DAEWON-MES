/**
 * LOT 조회·계통 추적·번호 규칙 조회 서버 액션의 인증/권한/tenant 격리 테스트 — 메모리 가짜 DB, 실제 PostgreSQL/브라우저 없음.
 *
 *  A. LOT 조회: getLots · getItemsForLot · getSitesForLot · searchLotByNo (1~10)
 *  B. 계통 추적: getLotForwardTrace · getLotBackwardTrace (11~16)
 *  C. 번호 규칙 조회: getRuleContextTokens · getContextCodeOptions (17~23)
 *
 * 권한 판정은 실제 role-permissions 모듈의 순수 함수(canReadMenuCode/hasResourcePermission)를 그대로 쓰고, 세션/권한 스냅샷만 가짜로 만든다.
 * 실제 DB 의 관계 필터(relation filter) 동작, 세션·권한 테이블 조회는 이 테스트로 검증되지 않는다(미검증 항목).
 */
import assert from "node:assert/strict"
import Module from "node:module"
import { join } from "node:path"
import { LOT_STATUS_ACTION_BASELINE_FINGERPRINT, between, fingerprint, listFiles, lotStatusActionBlock, readSource, stripComments } from "./test-support/source-invariants"

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
  // ── 데이터: t1(세션 tenant) 과 t2(다른 tenant) ────────────────────────────────
  const items: Row[] = [
    { id: "item-a", tenantId: "t1", code: "RM-A", name: "원자재 A", itemType: "RAW_MATERIAL", uom: "KG", categoryId: null, status: "ACTIVE" },
    { id: "item-fg", tenantId: "t1", code: "FG-1", name: "완제품 1", itemType: "FINISHED_GOOD", uom: "EA", categoryId: null, status: "ACTIVE" },
    { id: "item-off", tenantId: "t1", code: "RM-OFF", name: "비활성", itemType: "RAW_MATERIAL", uom: "KG", categoryId: null, status: "INACTIVE" },
    { id: "item-b", tenantId: "t2", code: "SECRET-B", name: "다른 tenant 품목", itemType: "RAW_MATERIAL", uom: "KG", categoryId: null, status: "ACTIVE" },
  ]
  const sites: Row[] = [
    { id: "site-1", tenantId: "t1", code: "S1", name: "본사공장" },
    { id: "site-2", tenantId: "t2", code: "S2", name: "다른 tenant 공장" },
  ]
  const mkLot = (id: string, tenantId: string, itemId: string, lotNo: string) => ({ id, tenantId, itemId, lotNo, status: "ACTIVE", manufactureDate: null, expiryDate: null, createdAt: new Date("2026-10-01") })
  const lots: Row[] = [
    mkLot("lot-a1", "t1", "item-a", "A-001"),
    mkLot("lot-a2", "t1", "item-fg", "A-002"),
    mkLot("lot-b0", "t2", "item-b", "B-000"),
    mkLot("lot-b1", "t2", "item-b", "B-001"),
    mkLot("lot-b2", "t2", "item-b", "B-002"),
  ]
  const balances: Row[] = [
    { id: "bal-a1", tenantId: "t1", lotId: "lot-a1", qtyOnHand: 100 },
    { id: "bal-a1-bad", tenantId: "t2", lotId: "lot-a1", qtyOnHand: 999 }, // 손상된 데이터: 다른 tenant 잔고가 t1 LOT 를 가리킴
    { id: "bal-b1", tenantId: "t2", lotId: "lot-b1", qtyOnHand: 5 },
  ]
  const genealogy: Row[] = [
    { id: "g1", parentLotId: "lot-a1", childLotId: "lot-a2", relationType: "OUTPUT", qty: 1 },
    { id: "g2", parentLotId: "lot-a2", childLotId: "lot-b1", relationType: "OUTPUT", qty: 1 }, // 손상된 데이터: t1 → t2 로 이어진 연결
    { id: "g3", parentLotId: "lot-b0", childLotId: "lot-a1", relationType: "INPUT", qty: 1 }, // 손상된 데이터: t2 → t1 로 이어진 연결
    { id: "g4", parentLotId: "lot-b1", childLotId: "lot-b2", relationType: "OUTPUT", qty: 1 },
  ]
  const tokensT1 = [
    { id: "1", type: "FIXED", value: "L" },
    { id: "2", type: "CONTEXT", key: "ITEM_CODE", fallback: "XX" },
    { id: "3", type: "CONTEXT", key: "LINE_CODE", codeGroupCode: "LINE" },
    { id: "4", type: "SEQ", digits: 3 },
  ]
  const tokensT2 = [
    { id: "1", type: "CONTEXT", key: "CLIENT_CODE", fallback: "SECRET-T2-FALLBACK", codeGroupCode: "LINE" },
    { id: "2", type: "SEQ", digits: 3 },
  ]
  const rules: Row[] = [
    { id: "rule-t1", tenantId: "t1", type: "LOT", isActive: true, tokens: tokensT1 },
    { id: "rule-t2", tenantId: "t2", type: "LOT", isActive: true, tokens: tokensT2 },
  ]
  const codeGroups: Row[] = [
    { id: "cg-t1", tenantId: "t1", groupCode: "LINE", isActive: true, codes: [{ code: "L1", name: "1라인" }, { code: "L2", name: "2라인" }] },
    { id: "cg-t2", tenantId: "t2", groupCode: "LINE", isActive: true, codes: [{ code: "SECRET", name: "다른 tenant 코드" }] },
  ]

  const calls = { lotFindMany: 0, lotFindFirst: 0, itemFindMany: 0, siteFindMany: 0, aggregate: 0, genealogyFind: 0, ruleFind: 0, groupFind: 0 }
  const lotWheres: Array<Record<string, unknown>> = []
  const aggregateWheres: Array<Record<string, unknown>> = []
  const genealogyWheres: Array<Record<string, unknown>> = []
  const itemWheres: Array<Record<string, unknown>> = []
  const siteWheres: Array<Record<string, unknown> | undefined> = []
  const ruleWheres: Array<Record<string, unknown>> = []
  const groupWheres: Array<Record<string, unknown>> = []

  const matches = (row: Row, where: Record<string, unknown> | undefined): boolean =>
    !where ||
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const o = v as Record<string, unknown>
        if ("contains" in o) return String(row[k] ?? "").includes(String(o.contains))
        if ("in" in o) return (o.in as unknown[]).includes(row[k])
      }
      return row[k] === v
    })
  const itemOf = (id: unknown) => items.find((i) => i.id === id)
  const lotOf = (id: unknown) => lots.find((l) => l.id === id)

  const fakePrisma = {
    lot: {
      findMany: async (a: { where?: Record<string, unknown>; include?: { inventoryBalances?: { where?: Record<string, unknown> } } }) => {
        calls.lotFindMany += 1
        lotWheres.push(a.where ?? {})
        return lots
          .filter((l) => matches(l, a.where))
          .map((l) => ({ ...l, item: itemOf(l.itemId), inventoryBalances: balances.filter((b) => b.lotId === l.id && matches(b, a.include?.inventoryBalances?.where)) }))
      },
      findFirst: async (a: { where: Record<string, unknown> }) => {
        calls.lotFindFirst += 1
        lotWheres.push(a.where)
        const l = lots.find((x) => matches(x, a.where))
        return l ? { ...l, item: itemOf(l.itemId) } : null
      },
    },
    inventoryBalance: {
      aggregate: async (a: { where: Record<string, unknown> }) => {
        calls.aggregate += 1
        aggregateWheres.push(a.where)
        const sum = balances.filter((b) => matches(b, a.where)).reduce((s, b) => s + Number(b.qtyOnHand), 0)
        return { _sum: { qtyOnHand: sum } }
      },
    },
    lotGenealogy: {
      findMany: async (a: { where: { parentLotId?: string; childLotId?: string; childLot?: { tenantId: string }; parentLot?: { tenantId: string } } }) => {
        calls.genealogyFind += 1
        genealogyWheres.push(a.where)
        return genealogy
          .filter((g) => (a.where.parentLotId === undefined || g.parentLotId === a.where.parentLotId) && (a.where.childLotId === undefined || g.childLotId === a.where.childLotId))
          .filter((g) => !a.where.childLot || lotOf(g.childLotId)?.tenantId === a.where.childLot.tenantId)
          .filter((g) => !a.where.parentLot || lotOf(g.parentLotId)?.tenantId === a.where.parentLot.tenantId)
          .map((g) => ({ ...g, childLot: lotOf(g.childLotId), parentLot: lotOf(g.parentLotId) }))
      },
    },
    item: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        calls.itemFindMany += 1
        itemWheres.push(a.where)
        return items.filter((i) => matches(i, a.where)).map(({ id, code, name, itemType, uom, categoryId }) => ({ id, code, name, itemType, uom, categoryId }))
      },
    },
    site: {
      findMany: async (a: { where?: Record<string, unknown> }) => {
        calls.siteFindMany += 1
        siteWheres.push(a.where)
        return sites.filter((s) => matches(s, a.where)).map(({ id, code, name }) => ({ id, code, name }))
      },
    },
    numberingRule: {
      findUnique: async (a: { where: { tenantId_type: { tenantId: string; type: string } } }) => {
        calls.ruleFind += 1
        ruleWheres.push(a.where.tenantId_type)
        return rules.find((r) => r.tenantId === a.where.tenantId_type.tenantId && r.type === a.where.tenantId_type.type) ?? null
      },
    },
    codeGroup: {
      findMany: async (a: { where: { tenantId: string; groupCode: { in: string[] }; isActive: boolean } }) => {
        calls.groupFind += 1
        groupWheres.push(a.where)
        return codeGroups.filter((g) => g.tenantId === a.where.tenantId && a.where.groupCode.in.includes(String(g.groupCode)) && g.isActive === a.where.isActive)
      },
    },
  }

  function inject(modulePath: string, exports: Record<string, unknown>) {
    const filename = require.resolve(modulePath)
    const mod = new Module(filename)
    mod.filename = filename
    mod.loaded = true
    mod.exports = exports
    require.cache[filename] = mod
  }
  type Session = { mode: "ok" | "anon"; tenantId: string; allAllowed: boolean; allowed: string[]; configured: string[] }
  const session: Session = { mode: "ok", tenantId: "t1", allAllowed: false, allowed: ["LOT:READ"], configured: ["LOT:READ"] }
  const setSession = (next: Partial<Session>) => Object.assign(session, { mode: "ok", tenantId: "t1", allAllowed: false, allowed: ["LOT:READ"], configured: ["LOT:READ"] }, next)
  const snapshot = () =>
    session.mode === "anon"
      ? null
      : { user: { tenantId: session.tenantId, id: "u1", profileId: "p1", name: "작업자" }, role: "OPERATOR", allAllowed: session.allAllowed, allowed: new Set(session.allowed), configured: new Set(session.configured) }

  inject("../src/lib/db/prisma", { prisma: fakePrisma })
  inject("next/cache", { revalidatePath: () => {} })
  // getTenantId 는 실제 구현처럼 세션이 없어도 DEFAULT_TENANT_ID 로 대체할 수 있다 — 조회 액션이 이 값을 쓰지 않아야 한다
  inject("../src/lib/auth", { getTenantId: async () => process.env.DEFAULT_TENANT_ID ?? session.tenantId, getCurrentUser: async () => null })
  inject("../src/lib/auth/daewon-scope.server", { assertDeveloperOnly: async () => {}, assertDaewonFeatureScope: async () => {} })
  // 권한 판정 함수(canReadMenuCode/hasResourcePermission)는 실제 모듈 것을 쓰고, 현재 사용자의 권한 스냅샷만 가짜로 대체한다
  const realPermissions = require("../src/lib/auth/role-permissions") as Record<string, unknown>
  inject("../src/lib/auth/role-permissions", { ...realPermissions, getCurrentPermissionSnapshot: async () => snapshot() })
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
    for (const list of [lotWheres, aggregateWheres, genealogyWheres, itemWheres, siteWheres, ruleWheres, groupWheres]) list.length = 0
  }
  const dbQueries = () => Object.values(calls).reduce((s, n) => s + n, 0)
  const DENIED = "이 기능을 사용할 권한이 없습니다."
  const ids = (nodes: Array<{ id: string }>) => nodes.map((n) => n.id).sort().join()
  const flatten = (node: { id: string; children?: unknown[] }): string[] => [node.id, ...((node.children ?? []) as Array<{ id: string; children?: unknown[] }>).flatMap(flatten)]

  // ═══ A. LOT 조회 ═══════════════════════════════════════════════════════════
  setSession({})
  reset()
  const list = await lotActions.getLots()
  ok(list.length === 2 && ids(list) === "lot-a1,lot-a2" && Object.keys(list[0]).sort().join() === "createdAt,expiryDate,id,item,itemId,lotNo,manufactureDate,qty,status,tenantId" && list.every((l) => l.item.code && typeof l.qty === "number"), "1 [정상 로그인 LOT 목록] 기존과 같은 응답 구조로 조회")
  ok(list.find((l) => l.id === "lot-a1")!.qty === 100, "1b 수량 합계는 같은 tenant 의 재고만 합산(다른 tenant 잔고 999 제외)")

  setSession({ mode: "anon" })
  reset()
  ok((await rejection(() => lotActions.getLots())) === "UNAUTHORIZED" && dbQueries() === 0, "2 [비로그인] LOT 목록 거부 — DB 조회 0건")

  setSession({ allowed: [], configured: ["LOT:READ"] }) // LOT READ 행이 설정되어 있지만 허용되지 않은 역할 = 화면도 못 연다
  reset()
  ok((await rejection(() => lotActions.getLots())) === DENIED && dbQueries() === 0, "3 [권한 없는 사용자] 거부 — DB 조회 0건")

  setSession({})
  reset()
  const onlyMine = await lotActions.getLots()
  ok(lotWheres[0].tenantId === "t1" && onlyMine.every((l) => l.tenantId === "t1"), "4 [현재 tenant 만] 조회 조건에 세션 tenant 반영, 결과도 모두 t1")
  ok(!ids(onlyMine).includes("lot-b") && !JSON.stringify(onlyMine).includes("SECRET"), "5 [다른 tenant 제외] 다른 tenant 의 LOT·품목 정보가 결과에 없다")

  setSession({})
  reset()
  const forwardOther = await rejection(() => lotActions.getLotForwardTrace("lot-b1"))
  const backwardOther = await rejection(() => lotActions.getLotBackwardTrace("lot-b1"))
  ok(forwardOther === "LOT not found: lot-b1" && backwardOther === "LOT not found: lot-b1" && calls.genealogyFind === 0 && calls.aggregate === 0, "6 [다른 tenant 의 LOT ID] 계통 추적 거부 — 관계·재고 조회까지 가지 않는다")
  reset()
  const forwardMissing = await rejection(() => lotActions.getLotForwardTrace("lot-nope"))
  ok(forwardMissing === "LOT not found: lot-nope" && forwardOther!.replace("lot-b1", "X") === forwardMissing.replace("lot-nope", "X"), "7 [존재하지 않는 LOT] 같은 형식의 오류 — 다른 tenant LOT 와 구분되지 않는다")

  setSession({})
  reset()
  const itemList = await lotActions.getItemsForLot()
  ok(itemWheres[0].tenantId === "t1" && itemWheres[0].status === "ACTIVE" && ids(itemList) === "item-a,item-fg" && !JSON.stringify(itemList).includes("SECRET"), "8 [품목] 세션 tenant 의 활성 품목만 — 다른 tenant 품목·비활성 품목 제외")
  const siteList = await lotActions.getSitesForLot()
  ok(siteWheres[0]?.tenantId === "t1" && ids(siteList) === "site-1" && !JSON.stringify(siteList).includes("다른 tenant"), "9 [사업장] 세션 tenant 의 사업장만")

  reset()
  const spoofSearch = await rejection(() => lotActions.searchLotByNo("B-", "t2"))
  const spoofRule = await rejection(() => numbering.getRuleContextTokens("t2", "LOT"))
  const spoofOptions = await rejection(() => numbering.getContextCodeOptions("t2", "LOT"))
  ok(spoofSearch === DENIED && spoofRule === DENIED && spoofOptions === DENIED && dbQueries() === 0, "10 [클라이언트 tenantId 조작] searchLotByNo·getRuleContextTokens·getContextCodeOptions 모두 세션과 다르면 거부 — DB 조회 0건")
  const found = await lotActions.searchLotByNo("A-00", "t1")
  const notMine = await lotActions.searchLotByNo("B-00", "t1")
  ok(found?.lotNo === "A-001" && notMine === null && lotWheres.at(-1)?.tenantId === "t1", "10b searchLotByNo 는 세션 tenant 안에서만 검색(다른 tenant LOT 번호로는 찾지 못한다)")
  setSession({ mode: "anon" })
  reset()
  ok((await rejection(() => lotActions.searchLotByNo("A-", "t1"))) === "UNAUTHORIZED" && (await rejection(() => lotActions.getItemsForLot())) === "UNAUTHORIZED" && (await rejection(() => lotActions.getSitesForLot())) === "UNAUTHORIZED" && dbQueries() === 0, "10c 비로그인은 검색·품목·사업장 후보 조회도 거부")

  // ═══ B. 계통 추적 ═══════════════════════════════════════════════════════════
  setSession({})
  reset()
  const fwd = await lotActions.getLotForwardTrace("lot-a1")
  ok(fwd.id === "lot-a1" && fwd.relationType === null && fwd.qty === 100 && fwd.children?.length === 1 && fwd.children[0].id === "lot-a2" && fwd.children[0].relationType === "OUTPUT" && Object.keys(fwd).sort().join() === "children,id,itemCode,itemName,lotNo,qty,relationType,status", "11 [정상 전방 추적] lot-a1 → lot-a2, 기존 응답 구조(id/lotNo/itemName/itemCode/status/qty/relationType/children) 유지")
  reset()
  const bwd = await lotActions.getLotBackwardTrace("lot-a2")
  ok(bwd.id === "lot-a2" && bwd.children?.length === 1 && bwd.children[0].id === "lot-a1" && bwd.children[0].relationType === "OUTPUT", "12 [정상 역방향 추적] lot-a2 ← lot-a1")
  ok(forwardOther !== null && backwardOther !== null && forwardOther === backwardOther, "13·14 [다른 tenant LOT 의 전방/역방향 추적 거부] 6번에서 두 방향 모두 같은 오류로 거부됨")
  reset()
  const fwd2 = await lotActions.getLotForwardTrace("lot-a1")
  const bwd2 = await lotActions.getLotBackwardTrace("lot-a1")
  const allIds = [...flatten(fwd2), ...flatten(bwd2)]
  ok(!allIds.some((id) => id.startsWith("lot-b")) && fwd2.children!.every((c) => (c.children ?? []).length === 0) && (bwd2.children ?? []).length === 0, "15 [관계 조회] 다른 tenant 로 이어진 손상된 연결(lot-a2→lot-b1, lot-b0→lot-a1)은 결과에 포함되지 않는다")
  ok(genealogyWheres.every((w) => (w.childLot as { tenantId: string } | undefined)?.tenantId === "t1" || (w.parentLot as { tenantId: string } | undefined)?.tenantId === "t1") && aggregateWheres.every((w) => w.tenantId === "t1") && lotWheres.every((w) => w.tenantId === "t1"), "15b 추적 중 모든 추가 조회(LOT·재고 합계·계통 연결)에 세션 tenant 범위가 걸려 있다")
  ok(JSON.stringify(fwd2) !== "" && !/SECRET|다른 tenant|lot-b/.test(JSON.stringify([fwd2, bwd2])) && forwardOther === backwardOther, "16 [정보 노출 방지] 추적 결과에 다른 tenant 정보가 없고, 접근 불가 LOT 의 오류는 존재하지 않는 LOT 와 같은 형식")
  setSession({ mode: "anon" })
  reset()
  ok((await rejection(() => lotActions.getLotForwardTrace("lot-a1"))) === "UNAUTHORIZED" && (await rejection(() => lotActions.getLotBackwardTrace("lot-a1"))) === "UNAUTHORIZED" && dbQueries() === 0, "16b 비로그인은 계통 추적 거부 — DB 조회 0건")
  setSession({ allowed: [], configured: ["LOT:READ"] })
  reset()
  ok((await rejection(() => lotActions.getLotForwardTrace("lot-a1"))) === DENIED && dbQueries() === 0, "16c 권한 없는 사용자는 계통 추적 거부")

  // ═══ C. 번호 규칙 조회 ═══════════════════════════════════════════════════════
  setSession({})
  reset()
  const tokens = await numbering.getRuleContextTokens("t1", "LOT")
  ok(tokens.length === 2 && tokens.map((t) => t.key).join() === "ITEM_CODE,LINE_CODE" && tokens[0].fallback === "XX" && tokens[1].codeGroupCode === "LINE" && ruleWheres.every((w) => w.tenantId === "t1") && !JSON.stringify(tokens).includes("SECRET"), "17 [정상 규칙 토큰 조회] 세션 tenant 규칙의 CONTEXT 토큰만 (다른 tenant 규칙의 토큰은 없다)")
  reset()
  const options = await numbering.getContextCodeOptions("t1", "LOT")
  ok(Object.keys(options).join() === "LINE_CODE" && options.LINE_CODE.map((c) => c.code).join() === "L1,L2" && groupWheres.every((w) => w.tenantId === "t1") && !JSON.stringify(options).includes("SECRET"), "18 [정상 코드 옵션 조회] 세션 tenant 의 공통코드만 (같은 groupCode 를 쓰는 다른 tenant 코드는 제외)")

  setSession({ mode: "anon" })
  reset()
  ok((await rejection(() => numbering.getRuleContextTokens("t1", "LOT"))) === "UNAUTHORIZED" && (await rejection(() => numbering.getContextCodeOptions("t1", "LOT"))) === "UNAUTHORIZED" && dbQueries() === 0, "19 [비로그인] 두 조회 모두 거부 — 규칙·공통코드 조회 0건")
  setSession({ allowed: [], configured: ["LOT:READ", "LOT:CREATE"] }) // 조회·등록 권한이 모두 없는 역할
  reset()
  ok((await rejection(() => numbering.getRuleContextTokens("t1", "LOT"))) === DENIED && (await rejection(() => numbering.getContextCodeOptions("t1", "LOT"))) === DENIED && dbQueries() === 0, "20 [권한 없는 사용자] 두 조회 모두 거부")
  setSession({})
  reset()
  ok(spoofRule === DENIED && spoofOptions === DENIED && (await rejection(() => numbering.getRuleContextTokens("t2", "LOT"))) === DENIED && calls.ruleFind === 0 && calls.groupFind === 0, "21 [다른 tenant 조회] 세션과 다른 tenantId 는 거부 — 다른 tenant 의 규칙·공통코드를 읽지 못한다")
  reset()
  const badTypes = [
    await rejection(() => numbering.getRuleContextTokens("t1", "WORK_ORDER" as never)),
    await rejection(() => numbering.getRuleContextTokens("t1", undefined as never)),
    await rejection(() => numbering.getContextCodeOptions("t1", "lot" as never)),
    await rejection(() => numbering.getContextCodeOptions("t1", { $ne: "LOT" } as never)),
  ]
  setSession({ mode: "anon" })
  const badTypeAnon = await rejection(() => numbering.getRuleContextTokens("t1", "WORK_ORDER" as never))
  ok(badTypes.every((m) => m === "지원하지 않는 번호 유형입니다.") && calls.ruleFind === 0 && calls.groupFind === 0 && badTypeAnon === "UNAUTHORIZED", "22 [잘못된 type] 거부, 조회 0건 · 인증이 type 검증보다 먼저")

  // 23. LOT 등록 시트 호출 호환성 + 화면 접근 규칙과의 일치
  const sheet = readSource("src/app/app/mes/lot/lot-form-sheet.tsx")
  ok(sheet.includes('getRuleContextTokens(tenantId, "LOT")') && sheet.includes('getContextCodeOptions(tenantId, "LOT")') && sheet.includes('generateLotNumberForItem(tenantId'), "23 [LOT 등록 시트 호출 호환성] 호출 형태(tenantId, \"LOT\")가 그대로")
  setSession({ allowed: ["LOT:CREATE"], configured: ["LOT:READ", "LOT:CREATE"] }) // 등록 권한은 있고 조회 권한은 없는 사용자
  reset()
  const createOnlyTokens = await numbering.getRuleContextTokens("t1", "LOT")
  const createOnlyItems = await lotActions.getItemsForLot()
  const createOnlySites = await lotActions.getSitesForLot()
  const createOnlyLots = await rejection(() => lotActions.getLots())
  ok(createOnlyTokens.length === 2 && createOnlyItems.length === 2 && createOnlySites.length === 1 && createOnlyLots === DENIED, "23b LOT 등록 권한만 있는 사용자는 등록 시트의 후보·규칙 조회를 쓸 수 있고, LOT 목록·추적은 조회 권한이 필요하다")
  setSession({ allowed: [], configured: [] }) // READ 행이 설정되지 않은 기존 역할 = LOT 화면을 열 수 있다(canReadMenuCode 의 호환 규칙)
  const legacy = await lotActions.getLots()
  ok(legacy.length === 2, "23c READ 행이 설정되지 않은 기존 역할도 LOT 화면과 같은 기준으로 조회할 수 있다(화면은 열리는데 조회 액션만 막히는 일이 없다)")
  setSession({ allAllowed: true, allowed: [], configured: [] }) // OWNER
  ok((await lotActions.getLots()).length === 2 && (await lotActions.getLotForwardTrace("lot-a1")).id === "lot-a1", "23d 소유자 역할은 모두 가능")

  // DEFAULT_TENANT_ID 우회 방지 + 구조
  setSession({ mode: "anon" })
  process.env.DEFAULT_TENANT_ID = "t1"
  reset()
  const bypass = [
    await rejection(() => lotActions.getLots()),
    await rejection(() => lotActions.getLotForwardTrace("lot-a1")),
    await rejection(() => lotActions.getItemsForLot()),
    await rejection(() => numbering.getRuleContextTokens("t1", "LOT")),
  ]
  delete process.env.DEFAULT_TENANT_ID
  const lotSrc = readSource("src/lib/actions/lot.actions.ts")
  const nrSrc = readSource("src/lib/actions/numbering-rule.actions.ts")
  const readFns = ["getLots", "getLotForwardTrace", "getLotBackwardTrace", "searchLotByNo", "getItemsForLot", "getSitesForLot"].map((name) => stripComments(between(lotSrc, `export async function ${name}`, "\n}\n") ?? ""))
  ok(bypass.every((m) => m === "UNAUTHORIZED") && dbQueries() === 0 && readFns.every((src) => src.length > 0 && !/getTenantId/.test(src) && /requireLot(Entry)?Reader\(\)/.test(src)), "24 [DEFAULT_TENANT_ID 우회 방지] 개발용 대체값이 있어도 비로그인 호출은 거부되고, 조회 액션은 getTenantId 를 쓰지 않으며 모두 접근 확인으로 시작한다")
  ok(readFns.every((src) => src.indexOf("requireLot") < src.indexOf("prisma.") || !src.includes("prisma.")) && !/findUnique/.test(readFns.join("\n")), "24b 모든 조회 액션에서 접근 확인이 DB 조회보다 앞서고 tenant 조건 없는 findUnique 가 없다")

  // 기존 기능 보호
  ok(fingerprint(lotStatusActionBlock(lotSrc) ?? "") === LOT_STATUS_ACTION_BASELINE_FINGERPRINT, "25 LOT 상태 변경 액션은 변경하지 않았다(지문 비교)")
  ok(["getNumberingRules", "upsertNumberingRule", "getCodeGroupsForBuilder"].every((name) => (between(nrSrc, `export async function ${name}`, "\n}\n") ?? "").includes("assertDeveloperOnly()")), "25b 개발자 전용 채번 관리 액션(getNumberingRules·upsertNumberingRule·getCodeGroupsForBuilder)은 이번에 변경하지 않았다 — 개발자 가드 유지")
  const pageSrc = readSource("src/app/app/mes/lot/page.tsx")
  ok(pageSrc.includes("getLots()") && pageSrc.includes("getItemsForLot()") && listFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && f !== "src/lib/actions/lot.actions.ts" && /getLotForwardTrace|getLotBackwardTrace|searchLotByNo|getSitesForLot/.test(readSource(f))).length === 0, "25c LOT 화면 호출(getLots·getItemsForLot) 형태 유지, 추적·검색·사업장 조회는 다른 화면의 호출처가 없다(영향 범위 없음)")

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
