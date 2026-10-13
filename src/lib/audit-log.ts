import { Prisma, type AuditAction, type AuditActorType } from "@prisma/client"
import type { CurrentUser } from "@/lib/auth"

type AuditDb = Pick<Prisma.TransactionClient, "auditLog"> | Pick<typeof import("@/lib/db/prisma").prisma, "auditLog">

type JsonRecord = Record<string, unknown>

const EXACT_SENSITIVE_KEYS = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "confirmPassword",
  "pin",
  "popPin",
  "secret",
  "token",
  "jwt",
  "cookie",
  "authorization",
])

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, "").toLowerCase()
  if (EXACT_SENSITIVE_KEYS.has(key) || EXACT_SENSITIVE_KEYS.has(normalized)) return true
  return (
    normalized.includes("passwordhash") ||
    normalized.includes("pinhash") ||
    normalized.includes("fingerprint") ||
    normalized.includes("accesstoken") ||
    normalized.includes("refreshtoken") ||
    normalized.includes("apikey") ||
    normalized.endsWith("secret")
  )
}

export function sanitizeAuditValue(value: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value
  if (depth > 6) return "[MaxDepth]"

  if (Array.isArray(value)) {
    const next = value.slice(0, 50).map((entry) => sanitizeAuditValue(entry, depth + 1))
    if (value.length > 50) next.push({ truncated: value.length - 50 })
    return next as Prisma.InputJsonArray
  }

  if (typeof value === "object") {
    const output: JsonRecord = {}
    for (const [key, entry] of Object.entries(value as JsonRecord)) {
      if (isSensitiveKey(key)) continue
      const sanitized = sanitizeAuditValue(entry, depth + 1)
      if (sanitized !== null) output[key] = sanitized
    }
    return output as Prisma.InputJsonObject
  }

  return String(value)
}

export function buildAuditChanges(
  beforeData: JsonRecord,
  afterData: JsonRecord,
  fields: string[] = Array.from(new Set([...Object.keys(beforeData), ...Object.keys(afterData)])),
): Prisma.InputJsonObject {
  const changes: JsonRecord = {}
  for (const field of fields) {
    const beforeValue = sanitizeAuditValue(beforeData[field])
    const afterValue = sanitizeAuditValue(afterData[field])
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes[field] = { before: beforeValue, after: afterValue }
    }
  }
  return changes as Prisma.InputJsonObject
}

export function summarizeAuditItems<T extends Record<string, unknown>>(
  items: T[] | undefined | null,
  fields: (keyof T)[],
): Prisma.InputJsonArray {
  return (items ?? []).slice(0, 50).map((item) => {
    const row: JsonRecord = {}
    for (const field of fields) row[String(field)] = sanitizeAuditValue(item[field])
    return row
  }) as Prisma.InputJsonArray
}

export async function recordAuditLog(
  db: AuditDb,
  params: {
    tenantId: string
    actor?: CurrentUser | null
    actorId?: string | null
    actorType?: AuditActorType
    actorLabel?: string | null
    entityType: string
    entityId: string
    action: AuditAction
    beforeData?: unknown
    afterData?: unknown
    menuName?: string | null
    ipAddress?: string | null
    userAgent?: string | null
  },
) {
  const beforeData =
    params.beforeData === undefined ? undefined : sanitizeAuditValue(params.beforeData) ?? Prisma.JsonNull
  const afterData =
    params.afterData === undefined ? undefined : sanitizeAuditValue(params.afterData) ?? Prisma.JsonNull

  await db.auditLog.create({
    data: {
      tenantId: params.tenantId,
      actorId: params.actorId ?? params.actor?.profileId ?? params.actor?.id ?? null,
      actorType: params.actorType ?? "USER",
      actorLabel: params.actorLabel ?? params.actor?.name ?? params.actor?.email ?? null,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      beforeData,
      afterData,
      menuName: params.menuName ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  })
}
