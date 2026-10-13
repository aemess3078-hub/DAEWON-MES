import { Prisma } from "@prisma/client"
import { resolveCnsLotRule, type CnsItemRuleContext } from "./lot-rule-resolver"
import { kstDateParts } from "@/lib/business-numbering"

type SequenceMaxArgs = {
  tenantId: string
  stem: string
  numericSuffixDigits?: number
}

type LotLookupClient = {
  lot: object & {
    findMaxSequence?(args: SequenceMaxArgs): Promise<number>
  }
  $queryRaw?<T = unknown>(query: Prisma.Sql): Promise<T>
}

type WorkOrderLookupClient = {
  workOrder: object & {
    findMaxSequence?(args: SequenceMaxArgs): Promise<number>
  }
  $queryRaw?<T = unknown>(query: Prisma.Sql): Promise<T>
}

const MONTH_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const

export function getCnsMonthLetter(date: Date): string {
  return MONTH_LETTERS[kstDateParts(date).month - 1] ?? "A"
}

function getYear2(date: Date): string {
  return kstDateParts(date).year2
}

function getDay2(date: Date): string {
  return kstDateParts(date).dayText
}

export function escapeCnsNumberingRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function formatCnsMaterialReceiptLotNo(date: Date, seq: number): string {
  return `${getYear2(date)}${getCnsMonthLetter(date)}${getDay2(date)}-${seq}`
}

export function formatCnsProductionNumber(prefix: string, date: Date, seq: number): string {
  if (seq > 999) {
    throw new Error("CNS production sequence exceeded 999 for the selected prefix/month")
  }
  return `${prefix}${getYear2(date)}${getCnsMonthLetter(date)}${String(seq).padStart(3, "0")}`
}

function suffixRegex(stem: string, numericSuffixDigits?: number): string {
  const escapedStem = escapeCnsNumberingRegExp(stem)
  const suffix = numericSuffixDigits ? `\\d{${numericSuffixDigits}}` : "\\d+"
  return `^${escapedStem}${suffix}$`
}

async function queryMaxNumericSuffix(
  db: { $queryRaw?: <T = unknown>(query: Prisma.Sql) => Promise<T> },
  tableName: "Lot" | "WorkOrder",
  columnName: "lotNo" | "manufacturingNo",
  tenantId: string,
  stem: string,
  numericSuffixDigits?: number,
): Promise<number> {
  if (typeof db.$queryRaw !== "function") {
    throw new Error("번호 채번에는 DB numeric MAX query를 지원하는 Prisma client가 필요합니다.")
  }
  const column = Prisma.raw(`"${columnName}"`)
  const table = Prisma.raw(`"${tableName}"`)
  const rows = await db.$queryRaw<Array<{ maxSeq: number | null }>>(Prisma.sql`
    SELECT COALESCE(MAX(CAST(SUBSTRING(${column} FROM CAST(${stem.length + 1} AS integer)) AS INTEGER)), 0)::int AS "maxSeq"
    FROM ${table}
    WHERE "tenantId" = ${tenantId}
      AND ${column} LIKE ${`${stem}%`}
      AND ${column} ~ ${suffixRegex(stem, numericSuffixDigits)}
  `)
  return Number(rows[0]?.maxSeq ?? 0)
}

async function maxLotSequence(
  db: LotLookupClient,
  tenantId: string,
  stem: string,
  numericSuffixDigits?: number,
): Promise<number> {
  if (typeof db.lot.findMaxSequence === "function") {
    return db.lot.findMaxSequence({ tenantId, stem, numericSuffixDigits })
  }
  return queryMaxNumericSuffix(db, "Lot", "lotNo", tenantId, stem, numericSuffixDigits)
}

async function maxManufacturingSequence(
  db: WorkOrderLookupClient,
  tenantId: string,
  stem: string,
  numericSuffixDigits?: number,
): Promise<number> {
  if (typeof db.workOrder.findMaxSequence === "function") {
    return db.workOrder.findMaxSequence({ tenantId, stem, numericSuffixDigits })
  }
  return queryMaxNumericSuffix(db, "WorkOrder", "manufacturingNo", tenantId, stem, numericSuffixDigits)
}

export async function generateCnsMaterialReceiptLotNo(
  db: LotLookupClient,
  tenantId: string,
  context: CnsItemRuleContext,
  date = new Date(),
  sequenceOffset = 0,
): Promise<string> {
  const rule = resolveCnsLotRule(context, "MATERIAL_RECEIPT")
  if (rule.pattern === "MANUAL_SUPPLIER_LOT") {
    throw new Error("LOT 번호를 직접 입력해야 하는 품목입니다.")
  }
  if (rule.pattern === "PREFIX_YY_MONTH_LETTER_SEQ3") {
    const prefix = rule.prefix?.trim().toUpperCase()
    if (!prefix) {
      throw new Error("생산 Prefix형 LOT 발행에는 Prefix가 필요합니다.")
    }
    const stem = `${prefix}${getYear2(date)}${getCnsMonthLetter(date)}`
    const nextSeq = await maxLotSequence(db, tenantId, stem, 3) + 1 + sequenceOffset
    return formatCnsProductionNumber(prefix, date, nextSeq)
  }

  const stem = `${getYear2(date)}${getCnsMonthLetter(date)}${getDay2(date)}-`
  const nextSeq = await maxLotSequence(db, tenantId, stem) + 1 + sequenceOffset
  return formatCnsMaterialReceiptLotNo(date, nextSeq)
}

export async function generateCnsManufacturingNo(
  db: WorkOrderLookupClient,
  tenantId: string,
  context: CnsItemRuleContext,
  date = new Date(),
  sequenceOffset = 0,
): Promise<string> {
  const rule = resolveCnsLotRule(context, "PRODUCTION_MANUFACTURING_NO")
  if (rule.pattern === "MANUAL_SUPPLIER_LOT") {
    throw new Error("제조번호를 직접 입력해야 하는 품목입니다.")
  }
  if (rule.pattern === "YY_MONTH_LETTER_DD_SEQ") {
    const stem = `${getYear2(date)}${getCnsMonthLetter(date)}${getDay2(date)}-`
    const nextSeq = await maxManufacturingSequence(db, tenantId, stem) + 1 + sequenceOffset
    return formatCnsMaterialReceiptLotNo(date, nextSeq)
  }
  if (rule.source === "ITEM_SETTING" && !rule.prefix?.trim()) {
    throw new Error("생산 Prefix형 제조번호 발행에는 Prefix가 필요합니다.")
  }
  const prefix = rule.prefix?.trim().toUpperCase() || "C"
  const stem = `${prefix}${getYear2(date)}${getCnsMonthLetter(date)}`
  const nextSeq = await maxManufacturingSequence(db, tenantId, stem, 3) + 1 + sequenceOffset

  return formatCnsProductionNumber(prefix, date, nextSeq)
}

export async function generateCnsFinishedGoodsLotNo(
  db: LotLookupClient,
  tenantId: string,
  context: CnsItemRuleContext,
  date = new Date(),
  sequenceOffset = 0,
): Promise<string> {
  const rule = resolveCnsLotRule(context, "FINISHED_GOODS_RECEIPT")
  if (rule.pattern === "MANUAL_SUPPLIER_LOT") {
    throw new Error("LOT 번호를 직접 입력해야 하는 품목입니다.")
  }
  if (rule.pattern === "YY_MONTH_LETTER_DD_SEQ") {
    const stem = `${getYear2(date)}${getCnsMonthLetter(date)}${getDay2(date)}-`
    const nextSeq = await maxLotSequence(db, tenantId, stem) + 1 + sequenceOffset
    return formatCnsMaterialReceiptLotNo(date, nextSeq)
  }
  if (rule.source === "ITEM_SETTING" && !rule.prefix?.trim()) {
    throw new Error("생산 Prefix형 LOT 발행에는 Prefix가 필요합니다.")
  }
  const prefix = rule.prefix?.trim().toUpperCase() || "C"
  const stem = `${prefix}${getYear2(date)}${getCnsMonthLetter(date)}`
  const nextSeq = await maxLotSequence(db, tenantId, stem, 3) + 1 + sequenceOffset
  return formatCnsProductionNumber(prefix, date, nextSeq)
}
