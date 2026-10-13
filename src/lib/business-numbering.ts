import { Prisma } from "@prisma/client"
import { toKstDateKey } from "@/lib/date/kst"

export const BUSINESS_NUMBER_MAX_ATTEMPTS = 5

export function kstDateParts(date: Date = new Date()) {
  const dateKey = toKstDateKey(date)
  const [yearText, monthText, dayText] = dateKey.split("-")
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  return {
    dateKey,
    year,
    year2: String(year % 100).padStart(2, "0"),
    month,
    monthText,
    day,
    dayText,
    yyyymmdd: `${yearText}${monthText}${dayText}`,
  }
}

export function kstMonthLetter(date: Date = new Date()): string {
  const { month } = kstDateParts(date)
  return String.fromCharCode("A".charCodeAt(0) + month - 1)
}

export function parseTrailingSequence(value: string | null | undefined, prefix: string): number {
  if (!value?.startsWith(prefix)) return 0
  const suffix = value.slice(prefix.length)
  const match = suffix.match(/^(\d+)/)
  if (!match) return 0
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export type UniqueConstraintTarget = string[] | string[][]

function normalizeUniqueConstraintTargets(fields?: UniqueConstraintTarget): string[][] | null {
  if (!fields || fields.length === 0) return null
  if (Array.isArray(fields[0])) return fields as string[][]
  return [fields as string[]]
}

function sameUniqueConstraintTarget(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((field) => right.includes(field))
}

export function isUniqueConstraintError(error: unknown, fields?: UniqueConstraintTarget): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false
  }
  const targets = normalizeUniqueConstraintTargets(fields)
  if (!targets) return true
  const target = (error.meta as { target?: unknown } | undefined)?.target
  const targetFields = Array.isArray(target)
    ? target.map(String)
    : typeof target === "string"
      ? [target]
      : []
  if (targetFields.length === 0) return true
  return targets.some((allowedTarget) => sameUniqueConstraintTarget(allowedTarget, targetFields))
}

export async function withUniqueBusinessNumberRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    fields: UniqueConstraintTarget
    maxAttempts?: number
    message?: string
  }
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? BUSINESS_NUMBER_MAX_ATTEMPTS
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      if (!isUniqueConstraintError(error, options.fields) || attempt >= maxAttempts - 1) {
        break
      }
    }
  }

  if (lastError && isUniqueConstraintError(lastError, options.fields)) {
    throw new Error(options.message ?? "업무번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요.")
  }
  throw lastError
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
