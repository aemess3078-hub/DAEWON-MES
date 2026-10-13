"use server"

import { getTenantId, requireRole } from "@/lib/auth"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { prisma } from "@/lib/db/prisma"
import { PartnerStatus, PartnerType } from "@prisma/client"

const MAX_ROWS = 1000
const PARTNER_CODE_PATTERN = /^[A-Za-z0-9_-]{1,50}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BUSINESS_NUMBER_PATTERN = /^\d{3}-?\d{2}-?\d{5}$/

const COL_CODE = "거래처코드"
const COL_NAME = "거래처명"
const COL_TYPE = "거래처구분"
const COL_BUSINESS_NO = "사업자등록번호"
const COL_CEO = "대표자명"
const COL_PHONE = "전화번호"
const COL_EMAIL = "이메일"
const COL_EMAIL2 = "이메일2"
const COL_ADDRESS = "주소"
const COL_CONTACT_NAME = "담당자명"
const COL_CONTACT_PHONE = "담당자연락처"
const COL_STATUS = "사용여부"
const COL_REMARK = "비고"

const TYPE_LABELS: Record<string, PartnerType> = {
  CUSTOMER: "CUSTOMER",
  SUPPLIER: "SUPPLIER",
  BOTH: "BOTH",
  고객사: "CUSTOMER",
  거래처: "SUPPLIER",
  "고객/거래처": "BOTH",
  "고객사+거래처": "BOTH",
  "고객사 + 거래처": "BOTH",
}

export type RawPartnerExcelRow = Record<string, unknown>

export type PartnerRowError = {
  rowNum: number
  column: string
  message: string
}

export type ValidatedPartnerRow = {
  rowNum: number
  code: string
  name: string
  partnerType: PartnerType
  status: PartnerStatus
  businessNumber: string | null
  ceoName: string | null
  phone: string | null
  email: string | null
  email2: string | null
  address: string | null
  contactName: string | null
  contactPhone: string | null
  remark: string | null
}

export type PartnerValidationResult = {
  validRows: ValidatedPartnerRow[]
  errors: PartnerRowError[]
  totalRows: number
}

function str(value: unknown): string {
  return (value == null ? "" : String(value)).trim()
}

function optionalStr(value: unknown, maxLength: number): string | null {
  const text = str(value)
  return text ? text.slice(0, maxLength) : null
}

function resolvePartnerType(value: string): PartnerType | null {
  const normalized = value.toUpperCase()
  return TYPE_LABELS[value] ?? TYPE_LABELS[normalized] ?? null
}

const TYPE_KO: Record<PartnerType, string> = {
  CUSTOMER: "고객사",
  SUPPLIER: "거래처",
  BOTH: "고객사+거래처",
}

// BOTH는 양쪽 페이지 모두 허용, 그 외에는 페이지 타입과 일치해야 함
function isTypeCompatible(partnerType: PartnerType, fixedType?: PartnerType): boolean {
  if (!fixedType) return true
  if (partnerType === "BOTH") return true
  return partnerType === fixedType
}

function validateRowsSync(
  rawRows: RawPartnerExcelRow[],
  existingCodes: Set<string>,
  fixedType?: PartnerType
): PartnerValidationResult {
  if (rawRows.length > MAX_ROWS) {
    return {
      validRows: [],
      errors: [{ rowNum: 0, column: "파일", message: `최대 ${MAX_ROWS}행까지 업로드할 수 있습니다. 현재 ${rawRows.length}행입니다.` }],
      totalRows: rawRows.length,
    }
  }

  const errors: PartnerRowError[] = []
  const validRows: ValidatedPartnerRow[] = []
  const codesInFile = new Set<string>()

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i]
    const rowNum = i + 2
    const rowErrors: PartnerRowError[] = []

    const code = str(row[COL_CODE])
    const codeKey = code.toUpperCase()
    if (!code) {
      rowErrors.push({ rowNum, column: COL_CODE, message: "필수값이 누락되었습니다." })
    } else if (!PARTNER_CODE_PATTERN.test(code)) {
      rowErrors.push({ rowNum, column: COL_CODE, message: "영문, 숫자, 하이픈(-), 언더스코어(_)만 사용할 수 있으며 최대 50자입니다." })
    } else if (codesInFile.has(codeKey)) {
      rowErrors.push({ rowNum, column: COL_CODE, message: "파일 안에 중복된 거래처코드가 있습니다." })
    } else if (existingCodes.has(codeKey)) {
      rowErrors.push({ rowNum, column: COL_CODE, message: "이미 등록된 거래처코드입니다." })
    } else {
      codesInFile.add(codeKey)
    }

    const name = str(row[COL_NAME])
    if (!name) {
      rowErrors.push({ rowNum, column: COL_NAME, message: "필수값이 누락되었습니다." })
    } else if (name.length > 200) {
      rowErrors.push({ rowNum, column: COL_NAME, message: "200자를 초과할 수 없습니다." })
    }

    const partnerTypeRaw = str(row[COL_TYPE])
    const partnerType = resolvePartnerType(partnerTypeRaw)
    if (!partnerTypeRaw) {
      rowErrors.push({ rowNum, column: COL_TYPE, message: "필수값이 누락되었습니다." })
    } else if (!partnerType) {
      rowErrors.push({ rowNum, column: COL_TYPE, message: "고객사, 거래처, 고객/거래처 또는 CUSTOMER, SUPPLIER, BOTH만 입력할 수 있습니다." })
    } else if (!isTypeCompatible(partnerType, fixedType)) {
      rowErrors.push({
        rowNum,
        column: COL_TYPE,
        message: `${TYPE_KO[fixedType!]} 관리에서는 "${TYPE_KO[fixedType!]}" 또는 "고객사+거래처"만 등록할 수 있습니다. (입력값: ${TYPE_KO[partnerType]})`,
      })
    }

    const statusRaw = str(row[COL_STATUS]).toUpperCase()
    if (!statusRaw) {
      rowErrors.push({ rowNum, column: COL_STATUS, message: "필수값이 누락되었습니다. Y 또는 N을 입력하세요." })
    } else if (!["Y", "N"].includes(statusRaw)) {
      rowErrors.push({ rowNum, column: COL_STATUS, message: "Y 또는 N만 입력할 수 있습니다." })
    }

    const businessNumber = str(row[COL_BUSINESS_NO])
    if (businessNumber && !BUSINESS_NUMBER_PATTERN.test(businessNumber)) {
      rowErrors.push({ rowNum, column: COL_BUSINESS_NO, message: "사업자등록번호는 000-00-00000 또는 10자리 숫자 형식으로 입력하세요." })
    }

    const email = str(row[COL_EMAIL])
    if (email && !EMAIL_PATTERN.test(email)) {
      rowErrors.push({ rowNum, column: COL_EMAIL, message: "올바른 이메일 형식이 아닙니다." })
    }

    const email2 = str(row[COL_EMAIL2])
    if (email2 && !EMAIL_PATTERN.test(email2)) {
      rowErrors.push({ rowNum, column: COL_EMAIL2, message: "올바른 이메일 형식이 아닙니다." })
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      continue
    }

    validRows.push({
      rowNum,
      code,
      name,
      partnerType: partnerType!,
      status: statusRaw === "Y" ? "ACTIVE" : "INACTIVE",
      businessNumber: businessNumber || null,
      ceoName: optionalStr(row[COL_CEO], 100),
      phone: optionalStr(row[COL_PHONE], 50),
      email: email || null,
      email2: email2 || null,
      address: optionalStr(row[COL_ADDRESS], 300),
      contactName: optionalStr(row[COL_CONTACT_NAME], 100),
      contactPhone: optionalStr(row[COL_CONTACT_PHONE], 50),
      remark: optionalStr(row[COL_REMARK], 500),
    })
  }

  return { validRows, errors, totalRows: rawRows.length }
}

export async function validateBusinessPartnerExcelRows(
  rawRows: RawPartnerExcelRow[],
  fixedType?: PartnerType
): Promise<PartnerValidationResult> {
  const tenantId = await getTenantId()
  await requireRole("OPERATOR")
  await requireResourcePermission("PARTNER_MANAGEMENT", "CREATE")

  const existingPartners = await prisma.businessPartner.findMany({
    where: { tenantId },
    select: { code: true },
  })
  const existingCodes = new Set(existingPartners.map((partner) => partner.code.toUpperCase()))

  return validateRowsSync(rawRows, existingCodes, fixedType)
}

export async function importValidatedBusinessPartners(
  rows: ValidatedPartnerRow[],
  fixedType?: PartnerType
): Promise<{ success: true; importedCount: number } | { success: false; error: string }> {
  const tenantId = await getTenantId()
  const actor = await requireRole("OPERATOR")
  await requireResourcePermission("PARTNER_MANAGEMENT", "CREATE")

  if (rows.length === 0) return { success: false, error: "가져올 거래처가 없습니다." }
  if (rows.length > MAX_ROWS) return { success: false, error: `최대 ${MAX_ROWS}행까지 가져올 수 있습니다.` }

  const codes = rows.map((row) => row.code)
  const duplicateCodes = codes.filter((code, index) => codes.findIndex((other) => other.toUpperCase() === code.toUpperCase()) !== index)
  if (duplicateCodes.length > 0) {
    return { success: false, error: `파일 안에 중복된 거래처코드가 있습니다: ${Array.from(new Set(duplicateCodes)).join(", ")}` }
  }

  const existingPartners = await prisma.businessPartner.findMany({
    where: { tenantId },
    select: { code: true },
  })
  const codeSet = new Set(codes.map((code) => code.toUpperCase()))
  const existingDuplicateCodes = existingPartners
    .map((partner) => partner.code)
    .filter((code) => codeSet.has(code.toUpperCase()))
  if (existingDuplicateCodes.length > 0) {
    return { success: false, error: `이미 등록된 거래처코드가 있습니다: ${existingDuplicateCodes.join(", ")}` }
  }

  // 페이지 타입과 호환되지 않는 행 차단 (BOTH는 양쪽 허용)
  if (fixedType) {
    const incompatible = rows.filter((row) => !isTypeCompatible(row.partnerType, fixedType))
    if (incompatible.length > 0) {
      return {
        success: false,
        error: `${TYPE_KO[fixedType]} 관리에서는 "${TYPE_KO[fixedType]}" 또는 "고객사+거래처"만 등록할 수 있습니다: ${incompatible.map((row) => row.code).join(", ")}`,
      }
    }
  }

  const importedCodes: string[] = []

  try {
    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.businessPartner.create({
          data: {
            tenantId,
            code: row.code,
            name: row.name,
            partnerType: row.partnerType,
            status: row.status,
            businessNumber: row.businessNumber,
            ceoName: row.ceoName,
            phone: row.phone,
            email: row.email,
            email2: row.email2,
            address: row.address,
            contactName: row.contactName,
            contactPhone: row.contactPhone,
            remark: row.remark,
          },
        })
        importedCodes.push(row.code)
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "BusinessPartner",
          entityId: "BULK",
          action: "CREATE",
          afterData: {
            source: "EXCEL_UPLOAD",
            importedCount: rows.length,
            partnerCodes: importedCodes.slice(0, 20),
          },
          menuName: "거래처 관리",
        },
      })
    })

    return { success: true, importedCount: rows.length }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "거래처 등록 중 오류가 발생했습니다." }
  }
}
