import { Prisma } from "@prisma/client"
import { kstDateParts } from "@/lib/business-numbering"
import type { ContextKey, Token } from "@/lib/types/numbering-rule"
import { escapeCnsNumberingRegExp } from "./lot-number-generator"

/**
 * 번호 규칙 관리(NumberingRule, type=LOT)에서 저장한 토큰 규칙으로 LOT 번호를 발행한다.
 *
 * - 규칙은 코드에 두지 않는다. 저장된 토큰 순서(품목코드·날짜·구분자·순번 …)를 그대로 따른다.
 * - 순번은 NumberingSequence 카운터가 아니라 "이미 발행된 번호"(Lot ∪ LotNumberReservation 의 모든 행)에서 계산한다.
 *   순번 토큰 앞의 토큰들이 만든 문자열(stem)이 같은 번호끼리 하나의 순번 계열이므로, 품목코드·연월이 stem 에 들어 있으면
 *   품목별·월별로 순번이 001 부터 다시 시작한다. 입고(예약/확정), 완제품 입고, LOT 등록 화면이 같은 원장을 보기 때문에
 *   서로 다른 경로가 같은 번호를 발행하지 않고, 미리보기만으로 순번이 소비되지도 않는다.
 * - 날짜는 KST 기준이다.
 */

export const LOT_RULE_NOT_CONFIGURED_MESSAGE =
  "LOT 번호 규칙이 설정되지 않았거나 사용 중지 상태입니다. 번호 규칙 관리에서 LOT 규칙을 저장·활성화하거나 LOT 번호를 직접 입력해 주세요."
export const LOT_RULE_INVALID_MESSAGE =
  "저장된 LOT 번호 규칙에 순번 토큰이 정확히 하나 있어야 합니다. 번호 규칙 관리에서 규칙을 확인해 주세요."
export const LOT_RULE_ITEM_CODE_MISSING_MESSAGE = "품목 코드를 확인할 수 없어 LOT 번호를 자동 발행할 수 없습니다."
export const LOT_RULE_CONTEXT_MISSING_MESSAGE = "LOT 번호 규칙에 필요한 값을 이 화면에서 알 수 없어 자동 발행할 수 없습니다. 번호 규칙을 확인하거나 LOT 번호를 직접 입력해 주세요."
export const LOT_RULE_ITEM_POLICY_UNSUPPORTED_MESSAGE =
  "이 품목의 LOT 번호 방식 설정은 이 사업장에서 지원하지 않습니다. 품목의 LOT 정책을 확인하거나 LOT 번호를 직접 입력해 주세요."
export const LOT_RULE_MANUAL_ITEM_MESSAGE = "LOT 번호를 직접 입력해야 하는 품목입니다."
const MAX_SEQ_DIGITS_FOR_QUERY = 9

export type TenantLotRuleContext = {
  itemCode?: string | null
  itemType?: string | null
  lotNumberingType?: string | null
  /** LOT 등록 화면처럼 사용자가 입력하는 값(라인코드 등). ITEM_CODE/ITEM_TYPE 은 서버 품목값이 우선한다. */
  extra?: Partial<Record<ContextKey, string>>
}

export type TenantLotRule = { id: string; tokens: Token[] }

type RuleDb = {
  numberingRule: { findUnique(args: { where: { tenantId_type: { tenantId: string; type: "LOT" } } }): Promise<{ id: string; tokens: unknown; isActive: boolean } | null> }
}
type SequenceDb = {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>
  $executeRaw?(query: Prisma.Sql): Promise<number>
}

function isToken(value: unknown): value is Token {
  if (!value || typeof value !== "object") return false
  const t = value as Record<string, unknown>
  switch (t.type) {
    case "DATE": return typeof t.format === "string"
    case "FIXED":
    case "SEPARATOR": return typeof t.value === "string"
    case "CONTEXT": return typeof t.key === "string"
    case "SEQ": return typeof t.digits === "number" && Number.isInteger(t.digits) && t.digits >= 1 && t.digits <= MAX_SEQ_DIGITS_FOR_QUERY
    default: return false
  }
}

/** 저장된 토큰 배열 검증: 알 수 없는 토큰이 없고, 순번(SEQ) 토큰이 정확히 하나여야 한다. */
export function parseLotRuleTokens(raw: unknown): Token[] {
  if (!Array.isArray(raw) || !raw.every(isToken)) throw new Error(LOT_RULE_INVALID_MESSAGE)
  const tokens = raw as Token[]
  if (tokens.filter((t) => t.type === "SEQ").length !== 1) throw new Error(LOT_RULE_INVALID_MESSAGE)
  return tokens
}

/** 활성 LOT 규칙 조회. 없거나 비활성이면 null. 저장된 값이 깨져 있으면 예외. */
export async function loadActiveLotRule(db: RuleDb, tenantId: string): Promise<TenantLotRule | null> {
  const rule = await db.numberingRule.findUnique({ where: { tenantId_type: { tenantId, type: "LOT" } } })
  if (!rule || !rule.isActive) return null
  return { id: rule.id, tokens: parseLotRuleTokens(rule.tokens) }
}

function resolveDateToken(format: string, date: Date): string {
  const p = kstDateParts(date)
  const startOfYear = Date.UTC(p.year, 0, 1)
  const julianDay = Math.floor((Date.UTC(p.year, p.month - 1, p.day) - startOfYear) / 86400000) + 1
  switch (format) {
    case "YYYY": return String(p.year)
    case "YY": return p.year2
    case "MM": return p.monthText
    case "DD": return p.dayText
    case "JULIAN": return String(julianDay).padStart(3, "0")
    case "WEEK": return `W${String(Math.ceil((julianDay + new Date(startOfYear).getUTCDay()) / 7)).padStart(2, "0")}`
    default: throw new Error(LOT_RULE_INVALID_MESSAGE)
  }
}

function resolveContextValue(token: Extract<Token, { type: "CONTEXT" }>, ctx: TenantLotRuleContext): string {
  if (token.key === "ITEM_CODE") {
    const code = ctx.itemCode?.trim() || ctx.extra?.ITEM_CODE?.trim()
    if (!code) throw new Error(LOT_RULE_ITEM_CODE_MISSING_MESSAGE)
    return code
  }
  const serverValue = token.key === "ITEM_TYPE" ? ctx.itemType?.trim() : undefined
  const value = serverValue || ctx.extra?.[token.key]?.trim() || token.fallback?.trim()
  if (!value) throw new Error(LOT_RULE_CONTEXT_MISSING_MESSAGE)
  return value
}

export type LotRuleTemplate = { stem: string; digits: number; suffix: string }

/** 순번 토큰을 기준으로 앞(stem)·뒤(suffix) 고정 문자열을 만든다. */
export function buildLotRuleTemplate(tokens: Token[], ctx: TenantLotRuleContext, date: Date): LotRuleTemplate {
  let stem = ""
  let suffix = ""
  let digits = 0
  let seen = false
  for (const token of tokens) {
    if (token.type === "SEQ") { seen = true; digits = token.digits; continue }
    let part: string
    switch (token.type) {
      case "DATE": part = resolveDateToken(token.format, date); break
      case "FIXED":
      case "SEPARATOR": part = token.value; break
      case "CONTEXT": part = resolveContextValue(token, ctx); break
    }
    if (seen) suffix += part
    else stem += part
  }
  if (!seen) throw new Error(LOT_RULE_INVALID_MESSAGE)
  return { stem, digits, suffix }
}

export function formatLotRuleNo(template: LotRuleTemplate, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new Error("LOT 순번 계산에 실패했습니다.")
  if (seq >= 10 ** template.digits) {
    throw new Error(`LOT 순번이 규칙의 자릿수(${template.digits}자리)를 초과했습니다. 번호 규칙 관리에서 순번 자릿수를 늘려 주세요.`)
  }
  return `${template.stem}${String(seq).padStart(template.digits, "0")}${template.suffix}`
}

function lotNoPattern(t: LotRuleTemplate): string {
  return `^${escapeCnsNumberingRegExp(t.stem)}(\\d{${t.digits}})${escapeCnsNumberingRegExp(t.suffix)}$`
}

/** 같은 stem/suffix 계열로 이미 발행된 가장 큰 순번(Lot ∪ LotNumberReservation 의 모든 상태). */
export async function maxIssuedLotSequence(db: SequenceDb, tenantId: string, t: LotRuleTemplate): Promise<number> {
  const pattern = lotNoPattern(t)
  const like = `${t.stem}%${t.suffix}`
  const rows = await db.$queryRaw<Array<{ maxSeq: number | null }>>(Prisma.sql`
    SELECT COALESCE(MAX(seq), 0)::int AS "maxSeq"
    FROM (
      SELECT CAST((regexp_match("lotNo", ${pattern}))[1] AS INTEGER) AS seq
      FROM "Lot"
      WHERE "tenantId" = ${tenantId} AND "lotNo" LIKE ${like} AND "lotNo" ~ ${pattern}
      UNION ALL
      SELECT CAST((regexp_match("lotNo", ${pattern}))[1] AS INTEGER) AS seq
      FROM "LotNumberReservation"
      WHERE "tenantId" = ${tenantId} AND "lotNo" LIKE ${like} AND "lotNo" ~ ${pattern}
    ) numbered
  `)
  return Number(rows[0]?.maxSeq ?? 0)
}

/**
 * 다음 LOT 번호를 계산한다(발행 원장에 기록하지는 않는다 — 기록은 호출한 쪽의 예약/입고/Lot 생성이 한다).
 * 충돌 처리: 기본은 (tenant, lotNo) unique 제약 + 호출한 쪽의 재시도(sequenceOffset)다 — 입고 AUTO 는 트랜잭션 전체를,
 * 예약은 예약 행 생성만 재시도한다. 긴 트랜잭션을 오래 붙잡지 않도록 기본에서는 잠금을 쓰지 않는다.
 * options.serialize 는 unique 충돌 시 같은 트랜잭션 안에서 재시도할 수 없는 호출(완제품 LOT: Postgres 는 오류가 난 트랜잭션을
 * 계속 쓸 수 없다)용으로, 트랜잭션 클라이언트에서 (tenant, stem) 단위 advisory lock 을 커밋까지 유지해 계산을 직렬화한다.
 */
export async function computeNextTenantRuleLotNo(
  db: RuleDb & SequenceDb,
  tenantId: string,
  context: TenantLotRuleContext,
  date: Date = new Date(),
  sequenceOffset = 0,
  options: { serialize?: boolean } = {},
): Promise<string> {
  const lotNumberingType = context.lotNumberingType?.trim().toUpperCase()
  if (lotNumberingType === "MANUAL") throw new Error(LOT_RULE_MANUAL_ITEM_MESSAGE)
  // RAW_DATE_SEQ / PREFIX_MONTH_SEQ 는 CNS 전용 방식이다. 대원정밀에는 CNS 규칙을 적용하지 않는다.
  if (lotNumberingType && lotNumberingType !== "DEFAULT") throw new Error(LOT_RULE_ITEM_POLICY_UNSUPPORTED_MESSAGE)
  const rule = await loadActiveLotRule(db, tenantId)
  if (!rule) throw new Error(LOT_RULE_NOT_CONFIGURED_MESSAGE)
  const template = buildLotRuleTemplate(rule.tokens, context, date)
  if (options.serialize && typeof db.$executeRaw === "function") {
    await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`lotno:${tenantId}:${template.stem}|${template.suffix}`}))`)
  }
  const next = (await maxIssuedLotSequence(db, tenantId, template)) + 1 + sequenceOffset
  return formatLotRuleNo(template, next)
}
