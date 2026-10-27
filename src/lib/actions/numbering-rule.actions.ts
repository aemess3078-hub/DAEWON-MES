"use server"

import { prisma } from "@/lib/db/prisma"
import { revalidatePath } from "next/cache"
import type { Token, ContextKey } from "@/lib/types/numbering-rule"
import { isMissingDbObjectError } from "@/lib/db/prisma-error"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDeveloperOnly } from "@/lib/auth/daewon-scope.server"
import { assertSessionTenant, requireLotEntryReader } from "@/lib/lot-numbering/lot-session-access"

/** 번호 규칙 type 검증(지원: LOT, SERIAL). */
function assertNumberingType(type: unknown): void {
  if (type !== "LOT" && type !== "SERIAL") throw new Error("지원하지 않는 번호 유형입니다.")
}

// ─── 규칙 조회 ────────────────────────────────────────────────────────────────

export async function getNumberingRules(tenantId: string) {
  await assertDeveloperOnly()
  let rules: any[]
  try {
    rules = await prisma.numberingRule.findMany({
      where: { tenantId },
    })
  } catch (error) {
    if (!isMissingDbObjectError(error)) throw error
    rules = []
  }
  return {
    LOT: rules.find((r) => r.type === "LOT") ?? null,
    SERIAL: rules.find((r) => r.type === "SERIAL") ?? null,
  }
}

// ─── 규칙 저장 (upsert) ───────────────────────────────────────────────────────

export async function upsertNumberingRule(
  tenantId: string,
  type: "LOT" | "SERIAL",
  tokens: Token[]
) {
  await assertDeveloperOnly()
  await requireResourcePermission("LOT", "UPDATE")
  await prisma.numberingRule.upsert({
    where: { tenantId_type: { tenantId, type } },
    update: { tokens: tokens as any },
    create: { tenantId, type, tokens: tokens as any },
  })
  revalidatePath("/app/mes/lot-rules")
}

// ─── 빌더용 공통코드 그룹 목록 ───────────────────────────────────────────────

export async function getCodeGroupsForBuilder(tenantId: string) {
  await assertDeveloperOnly()
  return prisma.codeGroup.findMany({
    where: { tenantId, isActive: true },
    select: { groupCode: true, groupName: true },
    orderBy: { groupCode: "asc" },
  })
}

// ─── 컨텍스트 토큰 목록 조회 ─────────────────────────────────────────────────

export async function getRuleContextTokens(
  clientTenantId: string,
  type: "LOT" | "SERIAL"
): Promise<Array<{ key: ContextKey; fallback?: string; codeGroupCode?: string }>> {
  // LOT 등록 시트의 자동 채번 단계 — 로그인 · LOT 조회/등록 권한 확인, tenant 는 세션 값(클라이언트 값은 일치 여부만 확인).
  // 개발자 전용 가드는 일반 LOT 사용자의 등록을 막으므로 쓰지 않는다. 조회만 하며 시퀀스는 건드리지 않는다.
  const { tenantId } = await requireLotEntryReader()
  assertSessionTenant(clientTenantId, tenantId)
  assertNumberingType(type)
  let rule
  try {
    rule = await prisma.numberingRule.findUnique({
      where: { tenantId_type: { tenantId, type } },
    })
  } catch (error) {
    if (isMissingDbObjectError(error)) return []
    throw error
  }
  if (!rule) return []
  const tokens = rule.tokens as Token[]
  return tokens
    .filter((t): t is Extract<Token, { type: "CONTEXT" }> => t.type === "CONTEXT")
    .map((t) => ({ key: t.key, fallback: t.fallback, codeGroupCode: t.codeGroupCode }))
}

// ─── LOT 등록용 컨텍스트 코드 옵션 조회 ──────────────────────────────────────

export async function getContextCodeOptions(
  clientTenantId: string,
  type: "LOT" | "SERIAL"
): Promise<Record<string, { code: string; name: string }[]>> {
  // getRuleContextTokens 와 같은 확인(로그인 · LOT 조회/등록 권한 · 세션 tenant). 규칙과 공통코드는 세션 tenant 의 것만 조회한다.
  const { tenantId } = await requireLotEntryReader()
  assertSessionTenant(clientTenantId, tenantId)
  assertNumberingType(type)
  let rule
  try {
    rule = await prisma.numberingRule.findUnique({
      where: { tenantId_type: { tenantId, type } },
    })
  } catch (error) {
    if (isMissingDbObjectError(error)) return {}
    throw error
  }
  if (!rule) return {}

  const tokens = rule.tokens as Token[]
  const contextTokens = tokens.filter(
    (t): t is Extract<Token, { type: "CONTEXT" }> => t.type === "CONTEXT" && !!t.codeGroupCode
  )
  if (contextTokens.length === 0) return {}

  const groupCodes = Array.from(new Set(contextTokens.map((t) => t.codeGroupCode!)))
  const groups = await prisma.codeGroup.findMany({
    where: { tenantId, groupCode: { in: groupCodes }, isActive: true },
    include: {
      codes: {
        where: { isActive: true },
        orderBy: { displayOrder: "asc" },
        select: { code: true, name: true },
      },
    },
  })

  const result: Record<string, { code: string; name: string }[]> = {}
  for (const token of contextTokens) {
    const group = groups.find((g) => g.groupCode === token.codeGroupCode)
    if (group) result[token.key] = group.codes
  }
  return result
}

// ─── 날짜 토큰 해석 ───────────────────────────────────────────────────────────

function resolveDateToken(format: string, date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const startOfYear = new Date(year, 0, 1)
  const julianDay = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000) + 1
  const weekNum = Math.ceil((julianDay + startOfYear.getDay()) / 7)
  switch (format) {
    case "YYYY":
      return String(year)
    case "YY":
      return String(year).slice(2)
    case "MM":
      return month
    case "DD":
      return day
    case "JULIAN":
      return String(julianDay).padStart(3, "0")
    case "WEEK":
      return `W${String(weekNum).padStart(2, "0")}`
    default:
      return ""
  }
}

// ─── 번호 생성 ────────────────────────────────────────────────────────────────

const CONTEXT_KEYS: readonly string[] = ["LINE_CODE", "PROD_CODE", "CLIENT_CODE", "ITEM_CODE", "ITEM_TYPE", "SHIFT"]
const MAX_CONTEXT_VALUE_LENGTH = 100

/**
 * 번호 생성 context 검증: 알려진 키만, 값은 문자열(길이 제한). 비어 있는(undefined/null) 값은 없는 것으로 본다.
 * context 는 번호 토큰(CONTEXT)을 채우는 표시용 문자열일 뿐 tenant·규칙·시퀀스를 고르는 데 쓰이지 않는다 — 식별자(id)를 담지 않는다.
 */
function sanitizeNumberContext(context: unknown): Partial<Record<ContextKey, string>> | undefined {
  if (context === undefined || context === null) return undefined
  if (typeof context !== "object" || Array.isArray(context)) throw new Error("번호 생성 정보가 올바르지 않습니다.")
  const result: Partial<Record<ContextKey, string>> = {}
  for (const [key, value] of Object.entries(context as Record<string, unknown>)) {
    if (value === undefined || value === null) continue
    if (!CONTEXT_KEYS.includes(key) || typeof value !== "string" || value.length > MAX_CONTEXT_VALUE_LENGTH) {
      throw new Error("번호 생성 정보가 올바르지 않습니다.")
    }
    result[key as ContextKey] = value
  }
  return result
}

export async function generateNumber(
  clientTenantId: string,
  type: "LOT" | "SERIAL",
  rawContext?: Partial<Record<ContextKey, string>>
): Promise<string> {
  // 시퀀스를 증가시키는 쓰기 동작 — LOT 등록 권한이 있는 사용자만(기존 정책 유지: LOT/SERIAL 모두 LOT CREATE).
  // 현재 호출처는 LOT 등록 시트(type "LOT")뿐이다. SERIAL 은 호출처가 없고 권한 정책이 별도로 확정되지 않아 기존 권한을 그대로 적용한다.
  const actor = await requireResourcePermission("LOT", "CREATE")
  // tenant 는 세션 값만 쓰고(getTenantId 의 개발용 대체값은 쓰지 않는다), 클라이언트가 보낸 tenantId 가 다르면 거부한다.
  if (typeof clientTenantId !== "string" || clientTenantId !== actor.tenantId) throw new Error("이 기능을 사용할 권한이 없습니다.")
  const tenantId = actor.tenantId
  // 규칙 조회와 시퀀스 증가 전에 모든 입력 검증을 끝낸다(거부된 요청은 시퀀스를 올리지 않는다).
  if (type !== "LOT" && type !== "SERIAL") throw new Error("지원하지 않는 번호 유형입니다.")
  const context = sanitizeNumberContext(rawContext)
  let rule
  try {
    rule = await prisma.numberingRule.findUnique({
      where: { tenantId_type: { tenantId, type } },
    })
  } catch (error) {
    if (!isMissingDbObjectError(error)) throw error
    rule = null
  }

  if (!rule || !rule.isActive) {
    // 규칙 없을 때 기본 생성
    const today = new Date()
    const prefix = type === "LOT" ? "LOT" : "SN"
    const date = today.toISOString().slice(0, 10).replace(/-/g, "")
    const count = await prisma.lot.count({
      where: { tenantId, lotNo: { startsWith: `${prefix}-${date}` } },
    })
    return `${prefix}-${date}-${String(count + 1).padStart(4, "0")}`
  }

  const tokens = rule.tokens as Token[]
  const today = new Date()

  const hasDay = tokens.some(
    (t) => t.type === "DATE" && (t.format === "DD" || t.format === "JULIAN")
  )
  const hasMonth = tokens.some((t) => t.type === "DATE" && t.format === "MM")
  const hasYear = tokens.some(
    (t) => t.type === "DATE" && (t.format === "YYYY" || t.format === "YY")
  )

  let periodKey: string
  if (hasDay) {
    periodKey = today.toISOString().slice(0, 10).replace(/-/g, "")
  } else if (hasMonth) {
    periodKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}`
  } else if (hasYear) {
    periodKey = String(today.getFullYear())
  } else {
    periodKey = "ALL"
  }

  const seqRecord = await prisma.$transaction(async (tx) => {
    return tx.numberingSequence.upsert({
      where: { ruleId_periodKey: { ruleId: rule.id, periodKey } },
      update: { current: { increment: 1 } },
      create: { ruleId: rule.id, periodKey, current: 1 },
    })
  })

  const parts: string[] = []
  for (const token of tokens) {
    switch (token.type) {
      case "DATE":
        parts.push(resolveDateToken(token.format, today))
        break
      case "FIXED":
        parts.push(token.value)
        break
      case "SEPARATOR":
        parts.push(token.value)
        break
      case "CONTEXT": {
        const val = context?.[token.key]
        parts.push(val ?? token.fallback ?? "")
        break
      }
      case "SEQ":
        parts.push(String(seqRecord.current).padStart(token.digits, "0"))
        break
    }
  }

  return parts.join("")
}
