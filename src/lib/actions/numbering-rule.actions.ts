"use server"

import { prisma } from "@/lib/db/prisma"
import { revalidatePath } from "next/cache"
import type { Token, ContextKey } from "@/lib/types/numbering-rule"
import { isMissingDbObjectError } from "@/lib/db/prisma-error"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDeveloperOnly } from "@/lib/auth/daewon-scope.server"

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
  tenantId: string,
  type: "LOT" | "SERIAL"
): Promise<Array<{ key: ContextKey; fallback?: string; codeGroupCode?: string }>> {
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
  tenantId: string,
  type: "LOT" | "SERIAL"
): Promise<Record<string, { code: string; name: string }[]>> {
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

export async function generateNumber(
  tenantId: string,
  type: "LOT" | "SERIAL",
  context?: Partial<Record<ContextKey, string>>
): Promise<string> {
  // 시퀀스를 증가시키는 쓰기 동작 — LOT 등록 권한이 있는 사용자만
  await requireResourcePermission("LOT", "CREATE")
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
