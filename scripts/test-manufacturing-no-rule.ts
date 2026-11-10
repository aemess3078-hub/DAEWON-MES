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
const { computeNextTenantManufacturingNo, MFG_RULE_NOT_CONFIGURED_MESSAGE, MFG_RULE_INVALID_MESSAGE, parseManufacturingRuleTokens, validateManufacturingRuleForSave } = mod

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
  // ─── 변수 연동 ────────────────────────────────────────────────────────
  const clientTokens = [
    { id: "1", type: "CONTEXT", key: "CLIENT_CODE" }, { id: "2", type: "SEPARATOR", value: "-" },
    { id: "3", type: "CONTEXT", key: "ITEM_CODE" }, { id: "4", type: "SEPARATOR", value: "-" },
    { id: "5", type: "DATE", format: "YY" }, { id: "6", type: "SEQ", digits: 3 },
  ]
  const cdb = () => fakeDb({ id: "r", tokens: clientTokens, isActive: true }, 0)
  ok((await computeNextTenantManufacturingNo(cdb(), "t", { itemCode: "BRK01", extra: { CLIENT_CODE: "ACME" } }, date)) === `ACME-BRK01-${yy}001`, "V1 고객코드+품목코드+날짜+순번 조합 발행")
  const noClient = await rejects(() => computeNextTenantManufacturingNo(cdb(), "t", { itemCode: "BRK01" }, date))
  ok(noClient?.includes("고객코드") && !noClient.includes("품목코드(") && noClient.includes("기본값"), "V2 고객코드 없음 → 누락 변수(고객코드)를 짚은 안내")
  const fbTokens = clientTokens.map((t) => (t.type === "CONTEXT" && t.key === "CLIENT_CODE" ? { ...t, fallback: "GEN" } : t))
  ok((await computeNextTenantManufacturingNo(fakeDb({ id: "r", tokens: fbTokens, isActive: true }, 0), "t", { itemCode: "BRK01" }, date)) === `GEN-BRK01-${yy}001`, "V3 값 없으면 규칙 기본값(fallback) 적용")
  ok((await computeNextTenantManufacturingNo(fakeDb({ id: "r", tokens: fbTokens, isActive: true }, 0), "t", { itemCode: "BRK01", extra: { CLIENT_CODE: "ACME" } }, date)) === `ACME-BRK01-${yy}001`, "V4 실제 값이 기본값보다 우선")
  const multi = [{ id: "1", type: "CONTEXT", key: "LINE_CODE" }, { id: "2", type: "CONTEXT", key: "SHIFT" }, { id: "3", type: "SEQ", digits: 3 }]
  const multiMsg = await rejects(() => computeNextTenantManufacturingNo(fakeDb({ id: "r", tokens: multi, isActive: true }, 0), "t", { itemCode: "A" }, date))
  ok(multiMsg?.includes("라인코드") && multiMsg.includes("교대"), "V5 여러 변수 누락 시 모두 나열")
  const noItem = await rejects(() => computeNextTenantManufacturingNo(fakeDb({ id: "r", tokens: [{ id: "1", type: "CONTEXT", key: "ITEM_CODE" }, { id: "2", type: "SEQ", digits: 3 }], isActive: true }, 0), "t", {}, date))
  ok(noItem?.includes("품목코드"), "V6 품목코드 없음 안내")
  ok(validateManufacturingRuleForSave(clientTokens) === null, "V7 고객코드·품목코드 규칙은 저장 허용")
  ok(validateManufacturingRuleForSave(multi)?.includes("라인코드, 교대"), "V8 값을 받을 수 없는 변수에 기본값 없으면 저장 거부")
  ok(validateManufacturingRuleForSave(multi.map((t) => (t.type === "CONTEXT" ? { ...t, fallback: "X" } : t))) === null, "V9 기본값을 주면 저장 허용")
  ok(validateManufacturingRuleForSave(tokens.slice(0, 4)) === MFG_RULE_INVALID_MESSAGE, "V10 순번 없는 규칙 저장 거부")
  // ─── ISSUE-009: 수주생산 고객코드는 기본값으로 대체 금지, 재고생산은 STK ─────────────────────
  const strict = { requireRealContextKeys: ["CLIENT_CODE" as const] }
  const strictMsg = await rejects(() => computeNextTenantManufacturingNo(fakeDb({ id: "r", tokens: fbTokens, isActive: true }, 0), "t", { itemCode: "BRK01" }, date, 0, strict))
  ok(strictMsg === mod.MFG_ORDER_CLIENT_REQUIRED_MESSAGE, "S1 수주생산 고객 누락 → fallback 이 있어도 대체하지 않고 오류")
  ok((await computeNextTenantManufacturingNo(fakeDb({ id: "r", tokens: fbTokens, isActive: true }, 0), "t", { itemCode: "BRK01", extra: { CLIENT_CODE: "ACME" } }, date, 0, strict)) === `ACME-BRK01-${yy}001`, "S2 수주생산 고객코드 있으면 정상 발행")
  ok((await computeNextTenantManufacturingNo(fakeDb({ id: "r", tokens: clientTokens, isActive: true }, 0), "t", { itemCode: "BRK01", extra: { CLIENT_CODE: mod.MFG_STOCK_CLIENT_CODE } }, date)) === `STK-BRK01-${yy}001`, "S3 재고생산 STK 적용")
  ok((await computeNextTenantManufacturingNo(fakeDb({ id: "r", tokens: itemTokens, isActive: true }, 0), "t", { itemCode: "BRK01" }, date, 0, strict)) === "BRK01-001", "S4 규칙에 고객코드가 없으면 strict 여도 기존대로 발행")
  console.log(`\n${pass} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
