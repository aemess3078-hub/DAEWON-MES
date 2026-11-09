/**
 * 제조번호 규칙(번호 규칙 관리 SERIAL → 화면 '제조번호 규칙') 발행 로직 단위 테스트 — DB 없이 가짜 db 로 검증.
 * 실행: npm run test:manufacturing-no-rule
 */
import assert from "node:assert/strict"
import Module from "node:module"
import { join } from "node:path"

// "@/..." 별칭 해석(다른 단위 테스트와 같은 방식)
const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require("../src/lib/lot-numbering/tenant-manufacturing-rule") as typeof import("../src/lib/lot-numbering/tenant-manufacturing-rule")
const { computeNextTenantManufacturingNo, MFG_RULE_NOT_CONFIGURED_MESSAGE, MFG_RULE_INVALID_MESSAGE, parseManufacturingRuleTokens } = mod

let pass = 0
const ok = (cond: unknown, name: string) => {
  assert.ok(cond, name)
  pass += 1
  console.log(`PASS ${name}`)
}

const tokens = [
  { id: "1", type: "FIXED", value: "MFG" },
  { id: "2", type: "SEPARATOR", value: "-" },
  { id: "3", type: "DATE", format: "YY" },
  { id: "4", type: "SEPARATOR", value: "-" },
  { id: "5", type: "SEQ", digits: 4 },
]
const yy = String(new Date().getFullYear()).slice(2)

function fakeDb(rule: unknown, maxSeq: number) {
  const calls: string[] = []
  return {
    calls,
    numberingRule: { findUnique: async () => rule as never },
    $queryRaw: async () => [{ maxSeq }] as never,
    $executeRaw: async () => {
      calls.push("lock")
      return 1
    },
  }
}

async function rejects(fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (e) {
    return (e as Error).message
  }
  return null
}

async function main() {
  const date = new Date()
  const db = fakeDb({ id: "r", tokens, isActive: true }, 0)
  ok((await computeNextTenantManufacturingNo(db, "t", { itemCode: "A" }, date)) === `MFG-${yy}-0001`, "M1 규칙대로 첫 번호 발행")
  const db2 = fakeDb({ id: "r", tokens, isActive: true }, 41)
  ok((await computeNextTenantManufacturingNo(db2, "t", { itemCode: "A" }, date)) === `MFG-${yy}-0042`, "M2 기존 최대 순번 다음 번호")
  ok((await computeNextTenantManufacturingNo(db2, "t", { itemCode: "A" }, date, 2)) === `MFG-${yy}-0044`, "M3 충돌 재시도 offset 반영")
  const db3 = fakeDb({ id: "r", tokens, isActive: true }, 0)
  await computeNextTenantManufacturingNo(db3, "t", {}, date, 0, { serialize: true })
  ok(db3.calls.includes("lock"), "M4 serialize 옵션이면 advisory lock 사용")
  ok((await rejects(() => computeNextTenantManufacturingNo(fakeDb(null, 0), "t", {}, date))) === MFG_RULE_NOT_CONFIGURED_MESSAGE, "M5 규칙 없음 → 안내 오류(임의 번호 없음)")
  ok((await rejects(() => computeNextTenantManufacturingNo(fakeDb({ id: "r", tokens, isActive: false }, 0), "t", {}, date))) === MFG_RULE_NOT_CONFIGURED_MESSAGE, "M6 비활성 규칙 → 안내 오류")
  ok((await rejects(() => computeNextTenantManufacturingNo(fakeDb({ id: "r", tokens: tokens.slice(0, 4), isActive: true }, 0), "t", {}, date))) === MFG_RULE_INVALID_MESSAGE, "M7 순번 토큰 없는 규칙 거부")
  ok((await rejects(() => computeNextTenantManufacturingNo(fakeDb({ id: "r", tokens, isActive: true }, 9999), "t", {}, date)))?.includes("자릿수"), "M8 자릿수 초과 안내")
  let threw = false
  try {
    parseManufacturingRuleTokens([...tokens, { id: "9", type: "SEQ", digits: 3 }])
  } catch {
    threw = true
  }
  ok(threw, "M9 순번 토큰 2개 거부(저장 검증)")
  const itemTokens = [{ id: "1", type: "CONTEXT", key: "ITEM_CODE" }, { id: "2", type: "SEPARATOR", value: "-" }, { id: "3", type: "SEQ", digits: 3 }]
  ok((await computeNextTenantManufacturingNo(fakeDb({ id: "r", tokens: itemTokens, isActive: true }, 4), "t", { itemCode: "BRK01" }, date)) === "BRK01-005", "M10 품목코드 토큰 사용")
  console.log(`\n${pass} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
