import { Prisma } from "@prisma/client"
import type { Token } from "@/lib/types/numbering-rule"
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
export const MFG_RULE_INVALID_MESSAGE =
  "저장된 제조번호 규칙에 순번 토큰이 정확히 하나 있어야 합니다. 번호 규칙 관리에서 규칙을 확인해 주세요."

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
  options: { serialize?: boolean } = {},
): Promise<string> {
  const rule = await loadActiveManufacturingRule(db, tenantId)
  if (!rule) throw new Error(MFG_RULE_NOT_CONFIGURED_MESSAGE)
  let template: LotRuleTemplate
  try {
    template = buildLotRuleTemplate(rule.tokens, context, date)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    throw new Error(message.includes("품목 코드") ? message.replace("LOT 번호", "제조번호") : "제조번호 규칙에 필요한 값을 알 수 없어 자동 발행할 수 없습니다. 번호 규칙을 확인하거나 제조번호를 직접 입력해 주세요.")
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
