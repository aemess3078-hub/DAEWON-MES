/**
 * 대원정밀 LOT 자동 채번(번호 규칙 관리의 저장 규칙) 단위 테스트 — 메모리 가짜 DB, 실제 PostgreSQL/네트워크 없음.
 * 실제 DB 검증은 scripts/db-it/09-lot-rule.ts, MRP AI 제거의 실제 DB 검증은 scripts/db-it/10-mrp-regression.ts.
 *
 *  R. 저장 토큰 순서대로 번호 생성(하드코딩 아님) · 날짜/구분자/품목코드 · KST · 순번 자릿수
 *  V. 규칙 검증(순번 토큰 1개) · 규칙 없음/비활성 안내 · 품목 정책(MANUAL/CNS 전용) · 품목코드 누락
 *  S. 순번 계산이 발행 원장(Lot ∪ LotNumberReservation)에서 이뤄지고 미리보기가 상태를 바꾸지 않음
 *  G. CNS 규칙 보호 · 제조번호 미적용 · 호출 구조(소스) · MRP AI 제거(소스)
 */
import assert from "node:assert/strict"
import Module from "node:module"
import { existsSync } from "node:fs"
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
const rejection = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try {
    await fn()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

async function main() {
  const lib = require("../src/lib/lot-numbering/tenant-lot-rule") as typeof import("../src/lib/lot-numbering/tenant-lot-rule")
  type Token = import("../src/lib/types/numbering-rule").Token
  const T = {
    item: { id: "i", type: "CONTEXT", key: "ITEM_CODE" } as Token,
    yy: { id: "y", type: "DATE", format: "YY" } as Token,
    mm: { id: "m", type: "DATE", format: "MM" } as Token,
    dash: { id: "d", type: "SEPARATOR", value: "-" } as Token,
    seq3: { id: "s", type: "SEQ", digits: 3 } as Token,
  }
  const OCT = new Date("2026-10-28T03:00:00Z") // KST 2026-10-28
  const ctx = { itemCode: "DW-7", itemType: "RAW_MATERIAL", lotNumberingType: "DEFAULT" }

  // ── R. 토큰 순서대로 생성 ───────────────────────────────────────────────────
  const std = lib.buildLotRuleTemplate([T.item, T.yy, T.mm, T.dash, T.seq3], ctx, OCT)
  ok(lib.formatLotRuleNo(std, 1) === "DW-72610-001", "R1 사용자 규칙(품목코드+YY+MM+-+순번3) → DW-72610-001 (요구사항 예시)")
  ok(std.stem === "DW-72610-" && std.digits === 3 && std.suffix === "", "R1b stem/순번 자릿수/접미 분해")
  const reordered = lib.buildLotRuleTemplate([T.yy, T.mm, T.dash, T.item, T.dash, T.seq3], ctx, OCT)
  ok(lib.formatLotRuleNo(reordered, 12) === "2610-DW-7-012", "R2 토큰 순서를 바꾸면 결과도 바뀐다 — 규칙 하드코딩 아님")
  const withFixed = lib.buildLotRuleTemplate([{ id: "f", type: "FIXED", value: "L" } as Token, T.yy, T.seq3, { id: "x", type: "FIXED", value: "Z" } as Token], ctx, OCT)
  ok(lib.formatLotRuleNo(withFixed, 5) === "L26005Z" && withFixed.suffix === "Z", "R3 순번 뒤 고정 접미(Z)도 규칙대로")
  const dates = lib.buildLotRuleTemplate(
    [{ id: "a", type: "DATE", format: "YYYY" } as Token, { id: "b", type: "DATE", format: "JULIAN" } as Token, { id: "c", type: "DATE", format: "DD" } as Token, { id: "d", type: "DATE", format: "WEEK" } as Token, T.seq3],
    ctx,
    OCT,
  )
  ok(dates.stem === "202630128W44", `R4 YYYY/JULIAN/DD/WEEK 날짜 토큰(${dates.stem})`)
  const kstEdge = lib.buildLotRuleTemplate([T.yy, T.mm, T.seq3], ctx, new Date("2026-10-31T16:00:00Z")) // UTC 10월 31일 16시 = KST 11월 1일 01시
  ok(kstEdge.stem === "2611", "R5 날짜는 KST 기준(UTC 10/31 16시 → KST 11월)")
  const yearEdge = lib.buildLotRuleTemplate([T.yy, T.mm, T.seq3], ctx, new Date("2026-12-31T15:30:00Z"))
  ok(yearEdge.stem === "2701", "R5b 연말 경계(UTC 12/31 15:30 → KST 2027년 1월)")
  ok((await rejection(async () => lib.formatLotRuleNo(std, 1000)))?.includes("자릿수(3자리)를 초과") === true, "R6 순번이 자릿수를 넘으면 번호를 바꾸지 않고 안내 오류")
  const ctxToken = lib.buildLotRuleTemplate([T.item, { id: "l", type: "CONTEXT", key: "LINE_CODE", fallback: "L1" } as Token, T.seq3], ctx, OCT)
  ok(ctxToken.stem === "DW-7L1", "R7 서버에서 알 수 없는 컨텍스트는 규칙의 fallback 사용")
  const ctxOverride = lib.buildLotRuleTemplate([T.item, { id: "l", type: "CONTEXT", key: "LINE_CODE", fallback: "L1" } as Token, T.seq3], { ...ctx, extra: { LINE_CODE: "L9", ITEM_CODE: "HACK" } }, OCT)
  ok(ctxOverride.stem === "DW-7L9", "R7b 사용자 입력 컨텍스트(LINE_CODE)는 반영, ITEM_CODE 는 서버 품목값이 우선(클라이언트 값 무시)")

  // ── V. 검증/안내 ──────────────────────────────────────────────────────────────
  ok((await rejection(async () => lib.buildLotRuleTemplate([T.item, T.yy], ctx, OCT))) === lib.LOT_RULE_INVALID_MESSAGE, "V1 순번 토큰이 없는 규칙은 거부")
  ok((await rejection(async () => lib.parseLotRuleTokens([T.item, T.seq3, T.seq3]))) === lib.LOT_RULE_INVALID_MESSAGE, "V1b 순번 토큰이 둘 이상인 규칙도 거부")
  ok((await rejection(async () => lib.parseLotRuleTokens([{ type: "BOGUS" }, T.seq3]))) === lib.LOT_RULE_INVALID_MESSAGE && (await rejection(async () => lib.parseLotRuleTokens("x"))) === lib.LOT_RULE_INVALID_MESSAGE, "V1c 알 수 없는 토큰/배열이 아닌 값은 거부")
  ok((await rejection(async () => lib.buildLotRuleTemplate([T.item, T.seq3], { itemCode: " " }, OCT))) === lib.LOT_RULE_ITEM_CODE_MISSING_MESSAGE, "V2 품목코드를 알 수 없으면 {ITEM_CODE} 를 남기지 않고 오류")
  ok((await rejection(async () => lib.buildLotRuleTemplate([{ id: "l", type: "CONTEXT", key: "SHIFT" } as Token, T.seq3], ctx, OCT))) === lib.LOT_RULE_CONTEXT_MISSING_MESSAGE, "V2b fallback 도 없는 컨텍스트는 오류")

  const calls: string[] = []
  const makeDb = (rule: { id: string; isActive: boolean; tokens: unknown } | null, maxSeq = 0) => ({
    numberingRule: { findUnique: async (a: { where: { tenantId_type: { tenantId: string; type: string } } }) => (calls.push(`rule:${a.where.tenantId_type.tenantId}/${a.where.tenantId_type.type}`), rule) },
    $queryRaw: async (q: { sql?: string; strings?: string[]; values?: unknown[] }) => (calls.push(`seq:${(q.values ?? []).join("|")}`), [{ maxSeq }]),
    $executeRaw: async () => (calls.push("lock"), 0),
  })
  const active = { id: "r", isActive: true, tokens: [T.item, T.yy, T.mm, T.dash, T.seq3] }
  const next = (db: ReturnType<typeof makeDb>, c: Parameters<typeof lib.computeNextTenantRuleLotNo>[2] = ctx, offset = 0, opts = {}) =>
    lib.computeNextTenantRuleLotNo(db as never, "daewon-001", c, OCT, offset, opts)

  ok((await rejection(() => next(makeDb(null)))) === lib.LOT_RULE_NOT_CONFIGURED_MESSAGE, "V3 규칙 없음 → 명확한 안내")
  ok((await rejection(() => next(makeDb({ ...active, isActive: false })))) === lib.LOT_RULE_NOT_CONFIGURED_MESSAGE, "V3b 비활성 규칙 → 같은 안내")
  ok((await rejection(() => next(makeDb(active), { ...ctx, lotNumberingType: "MANUAL" }))) === lib.LOT_RULE_MANUAL_ITEM_MESSAGE, "V4 MANUAL 품목은 자동 발행하지 않음(직접 입력 안내)")
  ok((await rejection(() => next(makeDb(active), { ...ctx, lotNumberingType: "RAW_DATE_SEQ" })))?.includes("지원하지 않습니다") === true, "V4b CNS 전용 방식(RAW_DATE_SEQ) 품목 설정은 CNS 규칙을 쓰지 않고 안내 오류")
  ok((await rejection(() => next(makeDb(active), { ...ctx, lotNumberingType: "PREFIX_MONTH_SEQ" })))?.includes("지원하지 않습니다") === true, "V4c PREFIX_MONTH_SEQ 도 동일")

  // ── S. 발행 원장 기반 순번 ────────────────────────────────────────────────────
  calls.length = 0
  const n1 = await next(makeDb(active, 0))
  ok(n1 === "DW-72610-001" && calls[0] === "rule:daewon-001/LOT" && calls.some((c) => c.startsWith("seq:")), "S1 최대 순번 0 → 001, 규칙은 tenant 조건으로 조회")
  ok((await next(makeDb(active, 41))) === "DW-72610-042", "S2 최대 순번 41 → 042")
  ok((await next(makeDb(active, 41), ctx, 2)) === "DW-72610-044", "S3 충돌 재시도 오프셋(+2) → 044")
  ok((await next(makeDb(active, 7), { ...ctx, itemCode: "RM-X" })) === "RM-X2610-008", "S4 다른 품목은 자기 품목코드 stem 으로 별도 계열")
  calls.length = 0
  await next(makeDb(active, 0))
  ok(!calls.includes("lock"), "S5 기본은 잠금 없이 계산(입고 AUTO/예약은 unique 충돌 재시도 사용)")
  calls.length = 0
  await next(makeDb(active, 0), ctx, 0, { serialize: true })
  ok(calls[calls.length - 1]?.startsWith("seq:") && calls.includes("lock") && calls.indexOf("lock") < calls.findIndex((c) => c.startsWith("seq:")), "S6 serialize 옵션(완제품 LOT)은 순번 조회 전에 advisory lock")
  const sqlSeen: string[] = []
  const spyDb = { ...makeDb(active, 0), $queryRaw: async (q: { sql: string; values: unknown[] }) => (sqlSeen.push(q.sql), [{ maxSeq: 0 }]) }
  await next(spyDb as never)
  ok(/FROM "Lot"/.test(sqlSeen[0]) && /FROM "LotNumberReservation"/.test(sqlSeen[0]) && /UNION ALL/.test(sqlSeen[0]) && /"tenantId" = /.test(sqlSeen[0]), "S7 순번은 Lot ∪ LotNumberReservation(모든 상태) 에서 tenant 조건으로 계산 — 예약/발행 번호와 겹치지 않음")
  const special = lib.buildLotRuleTemplate([T.item, T.seq3], { itemCode: "A.B+C(1)" }, OCT)
  ok(special.stem === "A.B+C(1)", "S8 특수문자 품목코드도 stem 그대로(정규식 이스케이프는 조회 시 처리)")

  // ── G. 보호/구조(소스) ─────────────────────────────────────────────────────────
  const resolver = readSource("src/lib/lot-numbering/lot-rule-resolver.ts")
  ok(/assertCnsLotRuleAllowed\(\)/.test(resolver), "G1 CNS 규칙 해석(resolveCnsLotRule)은 여전히 대원정밀에서 차단")
  const prevBrand = process.env.NEXT_PUBLIC_BRAND
  delete process.env.NEXT_PUBLIC_BRAND
  const guard = require("../src/lib/lot-numbering/lot-brand-guard") as typeof import("../src/lib/lot-numbering/lot-brand-guard")
  const gen = require("../src/lib/lot-numbering/lot-number-generator") as typeof import("../src/lib/lot-numbering/lot-number-generator")
  ok(!guard.isCnsLotRuleAllowed() && (await rejection(() => gen.generateCnsMaterialReceiptLotNo({ lot: {}, $queryRaw: async () => [{ maxSeq: 0 }] } as never, "t", { lotNumberingType: "DEFAULT" }))) === guard.DAEWON_LOT_RULE_NOT_CONFIGURED_MESSAGE, "G1b 브랜드 미설정(대원정밀)에서 CNS 생성기는 번호를 만들지 않는다 — NEXT_PUBLIC_BRAND 를 바꿔 우회하지 않음")
  const mfg = await rejection(() => gen.generateCnsManufacturingNo({ workOrder: {}, $queryRaw: async () => [{ maxSeq: 0 }] } as never, "t", { lotNumberingType: "DEFAULT" }))
  ok(mfg === guard.DAEWON_LOT_RULE_NOT_CONFIGURED_MESSAGE, "G2 제조번호 자동 채번은 계속 차단 — LOT 규칙을 제조번호에 적용하지 않음")
  if (prevBrand === undefined) delete process.env.NEXT_PUBLIC_BRAND
  else process.env.NEXT_PUBLIC_BRAND = prevBrand
  const wo = stripComments(readSource("src/lib/actions/work-order.actions.ts"))
  ok(!/tenant-lot-rule|computeNextTenantRuleLotNo/.test(wo), "G2b 작업지시(제조번호) 액션은 LOT 규칙 모듈을 사용하지 않는다")
  const policy = readSource("src/lib/lot-numbering/manufacturing-no-policy.ts")
  ok(/DAEWON_MANUFACTURING_NO_RULE_NOT_CONFIGURED_MESSAGE/.test(policy) && !/ERROR", message: DAEWON_LOT_RULE_NOT_CONFIGURED_MESSAGE/.test(policy), "G2c 제조번호 미확정 안내는 LOT 규칙 안내와 별개 문구")
  const reservation = stripComments(readSource("src/lib/lot-numbering/lot-reservation.ts"))
  ok(/!isCnsLotRuleAllowed\(\)\)\s*\{\s*return computeNextTenantRuleLotNo\(/.test(reservation), "G3 입고(AUTO)·예약·LOT 발행의 공통 진입점이 대원정밀에서 저장 규칙 발행으로 분기")
  const fgh = stripComments(readSource("src/lib/actions/finished-goods-lot.helpers.ts"))
  ok(/isCnsLotRuleAllowed\(\)[\s\S]*?generateCnsFinishedGoodsLotNo[\s\S]*?computeNextTenantRuleLotNo\([\s\S]*?serialize: true/.test(fgh), "G4 완제품 LOT(제조번호 없음)는 대원정밀에서 저장 규칙 + 직렬화로 발행, 제조번호가 있으면 기존 제조번호 기반 유지")
  ok(/manufacturingNo\s*\?\s*await nextSequentialLotNo/.test(fgh) || /manufacturingNo\s*\n?\s*\?\s*await nextSequentialLotNo/.test(fgh), "G4b 제조번호 기반 완제품 LOT 경로 보존")
  const nr = stripComments(readSource("src/lib/actions/numbering-rule.actions.ts"))
  const genNum = between(nr, "export async function generateNumber", "\n}\n") ?? ""
  ok(genNum.indexOf("numberingRule.findUnique") < genNum.indexOf("computeNextTenantRuleLotNo") && genNum.indexOf("computeNextTenantRuleLotNo") < genNum.indexOf("numberingSequence.upsert"), "G5 LOT 등록 화면 채번(generateNumber)은 대원정밀에서 발행 원장 기반으로 분기하고 NumberingSequence 카운터를 건드리지 않는다")
  ok(/if \(type === "LOT"\) parseLotRuleTokens\(tokens\)/.test(nr), "G6 LOT 규칙 저장 시 순번 토큰 검증")

  // MRP AI
  ok(!existsSync(join(process.cwd(), "src/app/app/mes/mrp/ai-suggestion-panel.tsx")) && !existsSync(join(process.cwd(), "src/lib/services/mrp-ai.service.ts")), "A1 MRP AI 패널·서비스 파일 제거")
  const mrpAct = stripComments(readSource("src/lib/actions/mrp.actions.ts"))
  ok(!/getAISuggestion|suggestOptimalOrder|openai/i.test(mrpAct), "A2 MRP 서버 액션에 AI 호출 경로 없음(UI 숨김이 아니라 서버에서 제거)")
  const mrpUi = listFiles("src/app/app/mes/mrp").filter((f) => /\.tsx?$/.test(f))
  ok(mrpUi.length > 5 && mrpUi.every((f) => !/AISuggestion|ai-suggestion|AI 발주|AI 분석|openai/i.test(readSource(f))), `A3 MRP 화면(${mrpUi.length}개 파일)에 AI 제안/분석 UI·참조 없음`)
  ok(existsSync(join(process.cwd(), "src/lib/services/openai.service.ts")), "A4 공통 OpenAI 모듈(openai.service.ts)은 다른 업무용으로 보존")
  ok(/createPurchaseOrdersFromMRP/.test(mrpAct) && /runMRP/.test(mrpAct) && /getPlansForMRP/.test(mrpAct), "A5 기존 MRP 서버 액션(runMRP/getPlansForMRP/createPurchaseOrdersFromMRP) 유지")

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
