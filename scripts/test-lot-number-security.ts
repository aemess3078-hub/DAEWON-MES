/**
 * LOT 채번 조회 서버 액션(generateLotNo) 인증·권한·tenant 검증 테스트 — 메모리 가짜 DB, 실제 PostgreSQL/브라우저 없음.
 *
 *  1. 정상 로그인 사용자 조회 + 기존 채번 결과 유지(생성기 직접 호출 결과와 동일)
 *  2. 비로그인 거부 / 3. 권한 없는 사용자 거부 / 4. 다른 tenantId 거부
 *  5. 다른 tenant 소속 itemId 거부 / 6. 존재하지 않는 itemId — 두 경우 응답 동일
 *  7. 대원정밀 자동 채번 미확정 정책 유지
 *  8. LOT 등록 화면(호출) 호환성 / 9. DEFAULT_TENANT_ID 우회 방지 / 10. 불필요한 정보 노출 방지
 *
 * 실제 DB 의 품목 조회 쿼리, 세션/권한 테이블 조회는 이 테스트로 검증되지 않는다(미검증 항목).
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
    { id: "item-a", tenantId: "t1", code: "RM-A", itemType: "RAW_MATERIAL", lotNumberingType: "RAW_DATE_SEQ", lotPrefix: null, manualLotPolicy: null, itemGroup: { code: "G1" }, category: { code: "C1" } },
    { id: "item-manual", tenantId: "t1", code: "RM-M", itemType: "RAW_MATERIAL", lotNumberingType: "MANUAL", lotPrefix: null, manualLotPolicy: null, itemGroup: null, category: null },
    { id: "item-t2", tenantId: "t2", code: "SECRET-T2", itemType: "RAW_MATERIAL", lotNumberingType: "RAW_DATE_SEQ", lotPrefix: null, manualLotPolicy: null, itemGroup: null, category: null },
  ]
  const auth: { mode: "ok" | "anon"; tenantId: string; allowed: Set<string> } = { mode: "ok", tenantId: "t1", allowed: new Set(["LOT:CREATE"]) }
  const setAuth = (mode: "ok" | "anon", tenantId = "t1", allowed: string[] = ["LOT:CREATE"]) => {
    auth.mode = mode
    auth.tenantId = tenantId
    auth.allowed = new Set(allowed)
  }
  const calls = { itemFind: 0, sequenceQuery: 0 }
  const itemWheres: Array<Record<string, unknown>> = []

  const fakePrisma = {
    item: {
      findFirst: async (a: { where: Record<string, unknown> }) => {
        calls.itemFind += 1
        itemWheres.push(a.where)
        return items.find((it) => Object.entries(a.where).every(([k, v]) => it[k] === v)) ?? null
      },
      findUnique: async () => {
        throw new Error("generateLotNo 는 tenant 조건 없는 findUnique 를 쓰지 않는다")
      },
    },
    // 채번 순번 조회(Prisma.sql 객체로 호출됨): 오늘 이 접두사의 최대 순번이 2 라고 가정한다
    $queryRaw: async () => {
      calls.sequenceQuery += 1
      return [{ maxSeq: 2 }]
    },
    lot: {},
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
  inject("next/cache", { revalidatePath: () => {} })
  inject("../src/lib/auth/role-permissions", {
    requireResourcePermission: async (resource: string, action: string) => {
      if (auth.mode === "anon") throw new Error("UNAUTHORIZED")
      if (!auth.allowed.has(`${resource}:${action}`)) throw new Error("이 기능을 사용할 권한이 없습니다.")
      return actor()
    },
  })
  // getTenantId 는 실제 구현처럼 세션이 없어도 DEFAULT_TENANT_ID 로 대체할 수 있다 — generateLotNo 가 이 값을 쓰지 않아야 한다
  inject("../src/lib/auth", {
    getTenantId: async () => process.env.DEFAULT_TENANT_ID ?? auth.tenantId,
    getCurrentUser: async () => (auth.mode === "anon" ? null : actor()),
  })
  const lotActions = require("../src/lib/actions/lot.actions") as typeof import("../src/lib/actions/lot.actions")
  const generator = require("../src/lib/lot-numbering/lot-number-generator") as typeof import("../src/lib/lot-numbering/lot-number-generator")

  const rejection = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
      await fn()
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  const withBrand = async <T,>(brand: string | undefined, fn: () => Promise<T>): Promise<T> => {
    const previous = process.env.NEXT_PUBLIC_BRAND
    if (brand === undefined) delete process.env.NEXT_PUBLIC_BRAND
    else process.env.NEXT_PUBLIC_BRAND = brand
    try {
      return await fn()
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_BRAND
      else process.env.NEXT_PUBLIC_BRAND = previous
    }
  }
  const reset = () => {
    calls.itemFind = 0
    calls.sequenceQuery = 0
    itemWheres.length = 0
  }
  const DENIED = "이 기능을 사용할 권한이 없습니다."
  const NOT_FOUND = "품목을 찾을 수 없습니다."

  // 1·7. 정상 사용자 + 기존 채번 결과 유지
  setAuth("ok")
  reset()
  const ctx = { itemCode: "RM-A", itemGroupCode: "G1", itemCategoryCode: "C1", itemType: "RAW_MATERIAL", lotNumberingType: "RAW_DATE_SEQ", lotPrefix: null, manualLotPolicy: null }
  const viaAction = await withBrand("newmes", () => lotActions.generateLotNo("item-a", "t1"))
  const direct = await withBrand("newmes", () => generator.generateCnsMaterialReceiptLotNo(fakePrisma as never, "t1", ctx as never))
  ok(typeof viaAction === "string" && viaAction.length > 0 && viaAction === direct, `1 [정상 로그인 사용자] LOT 번호 조회 성공(${viaAction}) · 7 기존 채번 결과 유지 — 생성기를 같은 입력으로 직접 호출한 결과와 동일`)
  ok(calls.itemFind === 1 && itemWheres[0].tenantId === "t1" && itemWheres[0].id === "item-a", "1b 품목 조회는 세션 tenant 조건(id + tenantId)으로 실행")

  // 2. 비로그인
  setAuth("anon")
  reset()
  const anon = await rejection(() => withBrand("newmes", () => lotActions.generateLotNo("item-a", "t1")))
  ok(anon === "UNAUTHORIZED" && calls.itemFind === 0 && calls.sequenceQuery === 0, "2 [비로그인] 거부(UNAUTHORIZED) — 품목 조회·채번 순번 조회 미실행")

  // 3. 권한 없음 (LOT READ 만 있고 CREATE 없음)
  setAuth("ok", "t1", ["LOT:READ", "INVENTORY:CREATE"])
  reset()
  const denied = await rejection(() => withBrand("newmes", () => lotActions.generateLotNo("item-a", "t1")))
  ok(denied === DENIED && calls.itemFind === 0 && calls.sequenceQuery === 0, "3 [권한 없는 사용자] LOT 등록(CREATE) 권한이 없으면 거부 — 조회 미실행")

  // 4. 다른 tenantId
  setAuth("ok", "t1")
  reset()
  const spoof1 = await rejection(() => withBrand("newmes", () => lotActions.generateLotNo("item-a", "t2")))
  setAuth("ok", "t2")
  const spoof2 = await rejection(() => withBrand("newmes", () => lotActions.generateLotNo("item-a", "t1")))
  ok(spoof1 === DENIED && spoof2 === DENIED && calls.itemFind === 0 && calls.sequenceQuery === 0, "4 [다른 tenantId] 세션과 다른 tenantId 는 권한 없음과 같은 문구로 거부 — 품목·순번 조회 미실행")

  // 5·6. 다른 tenant 품목 / 존재하지 않는 품목
  setAuth("ok", "t1")
  reset()
  const otherTenantItem = await rejection(() => withBrand("newmes", () => lotActions.generateLotNo("item-t2", "t1")))
  const sequenceAfterOther = calls.sequenceQuery
  const missingItem = await rejection(() => withBrand("newmes", () => lotActions.generateLotNo("item-nope", "t1")))
  const emptyItem = await rejection(() => withBrand("newmes", () => lotActions.generateLotNo("", "t1")))
  const nonStringItem = await rejection(() => withBrand("newmes", () => lotActions.generateLotNo(null as never, "t1")))
  ok(otherTenantItem === NOT_FOUND && sequenceAfterOther === 0, "5 [다른 tenant 소속 itemId] 거부 — 채번 순번 조회까지 가지 않고 다른 tenant 의 채번 상태가 노출되지 않는다")
  ok(missingItem === NOT_FOUND && emptyItem === NOT_FOUND && nonStringItem === NOT_FOUND && calls.sequenceQuery === 0, "6 [존재하지 않는/잘못된 itemId] 같은 '품목을 찾을 수 없습니다.' 로 거부(이전에는 빈 컨텍스트로 번호를 만들었다)")
  ok(otherTenantItem === missingItem, "6b 다른 tenant 품목과 존재하지 않는 품목의 응답이 완전히 같다 — 품목 존재 여부 비노출")

  // 7. 대원정밀 자동 채번 미확정 정책 유지
  const policyViaAction = await rejection(() => withBrand(undefined, () => lotActions.generateLotNo("item-a", "t1")))
  const policyDirect = await rejection(() => withBrand(undefined, () => generator.generateCnsMaterialReceiptLotNo(fakePrisma as never, "t1", ctx as never)))
  ok(policyViaAction !== null && policyViaAction === policyDirect && policyViaAction.includes("LOT 채번 규칙이 설정되지 않았습니다"), "7b 대원정밀 자동 채번 규칙 미확정 정책은 그대로(인증 통과 후 기존 정책 오류가 그대로 나온다)")
  const manualViaAction = await rejection(() => withBrand(undefined, () => lotActions.generateLotNo("item-manual", "t1")))
  const manualDirect = await rejection(() => withBrand(undefined, () => generator.generateCnsMaterialReceiptLotNo(fakePrisma as never, "t1", { ...ctx, itemCode: "RM-M", itemGroupCode: undefined, itemCategoryCode: undefined, lotNumberingType: "MANUAL" } as never)))
  ok(manualViaAction === manualDirect, "7c 수동 입력 품목(MANUAL)의 기존 동작도 생성기 직접 호출과 동일")

  // 8. LOT 등록 화면 호환성
  const sheet = readSource("src/app/app/mes/lot/lot-form-sheet.tsx")
  const callSites = listFiles("src")
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .flatMap((file) => Array.from(stripComments(readSource(file)).matchAll(/generateLotNo\(([^)]*)\)/g)).map((m) => ({ file, args: m[1] })))
    .filter((c) => c.file !== "src/lib/actions/lot.actions.ts")
  ok(lotActions.generateLotNo.length === 2 && sheet.includes('import { createLot, generateLotNo } from "@/lib/actions/lot.actions"') && callSites.every((c) => c.args.split(",").length === 2), "8 [LOT 등록 화면 호환성] 함수 시그니처(itemId, tenantId)·import 유지, 호출이 있다면 인자 2개 형태 그대로")
  ok(sheet.includes('generateNumber(tenantId, "LOT"') && sheet.includes("createLot(") && callSites.length === 0, "8b LOT 등록 시트의 실제 번호 생성/등록 흐름(generateNumber · createLot)은 변경 없음 — generateLotNo 는 현재 import 만 있고 호출되지 않는다")

  // 9. DEFAULT_TENANT_ID 우회 방지
  setAuth("anon", "t1")
  process.env.DEFAULT_TENANT_ID = "t1"
  reset()
  const bypass = await rejection(() => withBrand("newmes", () => lotActions.generateLotNo("item-a", "t1")))
  delete process.env.DEFAULT_TENANT_ID
  const lotSrc = readSource("src/lib/actions/lot.actions.ts")
  const fnSrc = stripComments(between(lotSrc, "export async function generateLotNo", "// ─── 재귀 정추적 헬퍼") ?? "")
  ok(bypass === "UNAUTHORIZED" && calls.itemFind === 0 && !/getTenantId/.test(fnSrc), "9 [DEFAULT_TENANT_ID] 개발용 대체값이 설정되어 있어도 비로그인 호출은 거부되고, 함수는 getTenantId 를 쓰지 않는다")

  // 10. 불필요한 정보 노출 방지
  const messages = [anon, denied, spoof1, spoof2, otherTenantItem, missingItem].map(String)
  ok(messages.every((m) => !/t2|SECRET-T2|item-t2|item-nope|RM-/.test(m)) && fnSrc.indexOf('requireResourcePermission("LOT", "CREATE")') < fnSrc.indexOf("prisma.item.findFirst") && !fnSrc.includes("findUnique"), "10 [정보 노출 방지] 모든 거부 응답에 tenant·품목 식별자가 없고, 어떤 조회보다 먼저 인증/권한을 확인하며 tenant 조건 없는 품목 조회가 없다")

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
