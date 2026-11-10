import { Prisma } from "@prisma/client"
import { CONTEXT_KEY_LABELS, type ContextKey, type Token } from "@/lib/types/numbering-rule"
import { escapeCnsNumberingRegExp } from "./lot-number-generator"
import {
  buildLotRuleTemplate,
  formatLotRuleNo,
  parseLotRuleTokens,
  type LotRuleTemplate,
  type TenantLotRuleContext,
} from "./tenant-lot-rule"

/**
 * 번호 규칙 관리(NumberingRule, type=SERIAL — 화면 표기 '제조번호 규칙')에 저장한 토큰 규칙으로 작업지시 제조번호를 발행한다.
 *
 * - 토큰 조합·순번 계산 방식은 LOT 규칙(tenant-lot-rule.ts)과 같은 엔진을 재사용한다. LOT 규칙·LOT 원장은 건드리지 않는다.
 * - 순번은 카운터 테이블이 아니라 "이미 발행된 제조번호"(WorkOrder.manufacturingNo)에서 계산한다.
 *   그래서 직접 입력한 번호나 규칙이 바뀌기 전에 발행된 번호와도 같은 번호를 만들지 않는다(같은 stem/suffix 패턴일 때만 순번 이어짐).
 * - 충돌 방지: (tenant, manufacturingNo) unique 제약 + 호출 측 재시도(sequenceOffset). serialize 옵션이면 트랜잭션 안에서 advisory lock.
 * - 이미 발행된 제조번호는 규칙이 바뀌어도 수정하지 않는다(이 모듈은 읽기만 한다).
 */

export const MFG_RULE_NOT_CONFIGURED_MESSAGE =
  "제조번호 규칙이 설정되지 않았거나 사용 중지 상태입니다. 번호 규칙 관리에서 제조번호 규칙을 저장·활성화하거나 제조번호를 직접 입력해 주세요."
/** 재고생산(STOCK) 제조번호에서 고객코드 변수에 자동 적용하는 값. */
export const MFG_STOCK_CLIENT_CODE = "STK"
export const MFG_ORDER_CLIENT_REQUIRED_MESSAGE =
  "수주생산 제조번호에 고객코드가 필요하지만 연결된 수주의 고객 정보를 찾을 수 없어 자동 발행할 수 없습니다. 수주의 고객 정보를 확인하거나 제조번호를 직접 입력해 주세요."
export const MFG_RULE_INVALID_MESSAGE =
  "저장된 제조번호 규칙에 순번 토큰이 정확히 하나 있어야 합니다. 번호 규칙 관리에서 규칙을 확인해 주세요."

/**
 * 작업지시 등록 시 서버가 실제 데이터로 채울 수 있는 변수.
 *  - ITEM_CODE / ITEM_TYPE : 작업지시 품목
 *  - CLIENT_CODE           : 작업지시에 연결된 생산계획 품목 → 수주 품목 → 수주 → 고객(거래처) 코드. 재고 생산 등 수주 연결이 없으면 값이 없다.
 * 그 외(LINE_CODE / PROD_CODE / SHIFT)는 작업지시 등록에서 받는 데이터가 없으므로 규칙의 기본값(fallback)으로만 채워진다.
 */
export const MFG_DATA_BACKED_KEYS: readonly ContextKey[] = ["ITEM_CODE", "ITEM_TYPE", "CLIENT_CODE"]

const MISSING_REASON: Record<ContextKey, string> = {
  CLIENT_CODE: "연결된 생산계획·수주에서 고객코드를 찾을 수 없음(재고 생산 등 수주 연결 없음)",
  ITEM_CODE: "품목코드를 확인할 수 없음",
  ITEM_TYPE: "품목유형을 확인할 수 없음",
  LINE_CODE: "작업지시 등록 시 입력받지 않는 값",
  PROD_CODE: "작업지시 등록 시 입력받지 않는 값",
  SHIFT: "작업지시 등록 시 입력받지 않는 값",
}

function contextValue(token: Extract<Token, { type: "CONTEXT" }>, ctx: TenantLotRuleContext): string {
  const data =
    token.key === "ITEM_CODE" ? ctx.itemCode
    : token.key === "ITEM_TYPE" ? ctx.itemType
    : ctx.extra?.[token.key]
  // ITEM_CODE 는 buildLotRuleTemplate 도 기본값을 쓰지 않는다(품목코드는 반드시 실제 값).
  if (token.key === "ITEM_CODE") return data?.trim() ?? ""
  return data?.trim() || token.fallback?.trim() || ""
}

/** 규칙의 변수 중 실제 값도 기본값도 없는 것의 목록(안내 메시지용). */
export function findMissingManufacturingContext(tokens: Token[], ctx: TenantLotRuleContext): ContextKey[] {
  const missing: ContextKey[] = []
  for (const t of tokens) {
    if (t.type !== "CONTEXT" || missing.includes(t.key)) continue
    if (!contextValue(t, ctx)) missing.push(t.key)
  }
  return missing
}

export function missingManufacturingContextMessage(keys: ContextKey[]): string {
  const detail = keys.map((k) => `${CONTEXT_KEY_LABELS[k]}(${MISSING_REASON[k]})`).join(", ")
  return `제조번호를 자동 발행할 수 없습니다. 값이 없는 변수: ${detail}. 번호 규칙 관리에서 해당 변수에 기본값을 설정하거나 제조번호를 직접 입력해 주세요.`
}

/**
 * 저장 시 검증: 순번 토큰 1개 + 작업지시에서 값을 얻을 방법이 없는 변수(라인코드·생산코드·교대)는 기본값이 있어야 한다.
 * (고객코드는 수주 연결 여부에 따라 달라지므로 저장은 허용하고, 발행 시 값이 없으면 변수명을 짚어 안내한다.)
 * 문제가 있으면 안내 메시지를, 없으면 null 을 돌려준다.
 */
export function validateManufacturingRuleForSave(raw: unknown): string | null {
  let tokens: Token[]
  try {
    tokens = parseManufacturingRuleTokens(raw)
  } catch (error) {
    return error instanceof Error ? error.message : MFG_RULE_INVALID_MESSAGE
  }
  const unsupplied = tokens.filter(
    (t): t is Extract<Token, { type: "CONTEXT" }> =>
      t.type === "CONTEXT" && !MFG_DATA_BACKED_KEYS.includes(t.key) && !t.fallback?.trim(),
  )
  if (unsupplied.length > 0) {
    const names = Array.from(new Set(unsupplied.map((t) => CONTEXT_KEY_LABELS[t.key]))).join(", ")
    return `제조번호 규칙을 저장할 수 없습니다. ${names} 변수는 작업지시 등록에서 값을 받지 않으므로 기본값(직접 입력)을 설정해야 합니다(공통코드 연결을 해제하고 기본값을 입력해 주세요).`
  }
  return null
}

type RuleDb = {
  numberingRule: {
    findUnique(args: { where: { tenantId_type: { tenantId: string; type: "SERIAL" } } }): Promise<{ id: string; tokens: unknown; isActive: boolean } | null>
  }
}
type SequenceDb = {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>
  $executeRaw?(query: Prisma.Sql): Promise<number>
}

/** 저장 전·발행 전 규칙 검증: 알 수 없는 토큰이 없고 순번(SEQ) 토큰이 정확히 하나. */
export function parseManufacturingRuleTokens(raw: unknown): Token[] {
  try {
    return parseLotRuleTokens(raw)
  } catch {
    throw new Error(MFG_RULE_INVALID_MESSAGE)
  }
}

export async function loadActiveManufacturingRule(db: RuleDb, tenantId: string): Promise<{ id: string; tokens: Token[] } | null> {
  const rule = await db.numberingRule.findUnique({ where: { tenantId_type: { tenantId, type: "SERIAL" } } })
  if (!rule || !rule.isActive) return null
  return { id: rule.id, tokens: parseManufacturingRuleTokens(rule.tokens) }
}

/** 같은 stem/suffix 계열로 이미 발행된 가장 큰 순번. */
export async function maxIssuedManufacturingSequence(db: SequenceDb, tenantId: string, t: LotRuleTemplate): Promise<number> {
  const pattern = `^${escapeCnsNumberingRegExp(t.stem)}(\\d{${t.digits}})${escapeCnsNumberingRegExp(t.suffix)}$`
  const like = `${t.stem}%${t.suffix}`
  const rows = await db.$queryRaw<Array<{ maxSeq: number | null }>>(Prisma.sql`
    SELECT COALESCE(MAX(CAST((regexp_match("manufacturingNo", ${pattern}))[1] AS INTEGER)), 0)::int AS "maxSeq"
    FROM "WorkOrder"
    WHERE "tenantId" = ${tenantId} AND "manufacturingNo" LIKE ${like} AND "manufacturingNo" ~ ${pattern}
  `)
  return Number(rows[0]?.maxSeq ?? 0)
}

/** 다음 제조번호 계산(기록은 호출한 쪽의 작업지시 생성이 한다). */
export async function computeNextTenantManufacturingNo(
  db: RuleDb & SequenceDb,
  tenantId: string,
  context: TenantLotRuleContext,
  date: Date = new Date(),
  sequenceOffset = 0,
  options: { serialize?: boolean; requireRealContextKeys?: ContextKey[] } = {},
): Promise<string> {
  const rule = await loadActiveManufacturingRule(db, tenantId)
  if (!rule) throw new Error(MFG_RULE_NOT_CONFIGURED_MESSAGE)
  // 값도 기본값도 없는 변수는 어떤 것이 빠졌는지 짚어서 안내한다.
  // 수주생산(ORDER/ORDER_EXTRA)의 고객코드처럼 규칙 기본값으로 대체하면 안 되는 변수는 실제 값이 반드시 있어야 한다.
  for (const key of options.requireRealContextKeys ?? []) {
    const used = rule.tokens.some((t) => t.type === "CONTEXT" && t.key === key)
    if (used && !context.extra?.[key]?.trim()) {
      throw new Error(key === "CLIENT_CODE" ? MFG_ORDER_CLIENT_REQUIRED_MESSAGE : missingManufacturingContextMessage([key]))
    }
  }
  const missing = findMissingManufacturingContext(rule.tokens, context)
  if (missing.length > 0) throw new Error(missingManufacturingContextMessage(missing))
  let template: LotRuleTemplate
  try {
    template = buildLotRuleTemplate(rule.tokens, context, date)
  } catch {
    throw new Error(MFG_RULE_INVALID_MESSAGE)
  }
  if (options.serialize && typeof db.$executeRaw === "function") {
    await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`mfgno:${tenantId}:${template.stem}|${template.suffix}`}))`)
  }
  const next = (await maxIssuedManufacturingSequence(db, tenantId, template)) + 1 + sequenceOffset
  try {
    return formatLotRuleNo(template, next)
  } catch {
    throw new Error(`제조번호 순번이 규칙의 자릿수(${template.digits}자리)를 초과했습니다. 번호 규칙 관리에서 순번 자릿수를 늘려 주세요.`)
  }
}
