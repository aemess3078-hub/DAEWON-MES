"use server"

import { getTenantId, requireRole } from "@/lib/auth"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { prisma } from "@/lib/db/prisma"
import { WorkCenterKind } from "@prisma/client"
import { revalidatePath } from "next/cache"

const MAX_ROWS = 1000
const CODE_PATTERN = /^[가-힣A-Za-z0-9_-]{1,50}$/

const COL_CODE = "작업센터코드"
const COL_NAME = "작업센터명"
const COL_KIND = "작업센터유형"
const COL_SITE_CODE = "사업장코드"
const COL_REMARK = "비고"

const KIND_LABELS: Record<string, WorkCenterKind> = {
  ASSEMBLY: "ASSEMBLY",
  MACHINING: "MACHINING",
  INSPECTION: "INSPECTION",
  PACKAGING: "PACKAGING",
  STORAGE: "STORAGE",
  조립: "ASSEMBLY",
  가공: "MACHINING",
  검사: "INSPECTION",
  포장: "PACKAGING",
  창고: "STORAGE",
}

export type RawWorkCenterExcelRow = Record<string, unknown>

export type WorkCenterRowError = {
  rowNum: number
  column: string
  message: string
}

export type ValidatedWorkCenterRow = {
  rowNum: number
  siteId: string
  siteCode: string
  siteName: string
  code: string
  name: string
  kind: WorkCenterKind
  remark: string | null
}

export type WorkCenterValidationResult = {
  validRows: ValidatedWorkCenterRow[]
  errors: WorkCenterRowError[]
  totalRows: number
}

type ExistingWorkCenter = {
  siteId: string
  code: string
}

type SiteRef = {
  id: string
  code: string
  name: string
}

function str(value: unknown): string {
  return (value == null ? "" : String(value)).trim()
}

function normalizeKey(value: string): string {
  return value.trim().toUpperCase()
}

function resolveKind(value: string): WorkCenterKind | null {
  return KIND_LABELS[value] ?? KIND_LABELS[value.toUpperCase()] ?? null
}

function validateRowsSync(
  rawRows: RawWorkCenterExcelRow[],
  sites: SiteRef[],
  existingWorkCenters: ExistingWorkCenter[],
): WorkCenterValidationResult {
  if (rawRows.length > MAX_ROWS) {
    return {
      validRows: [],
      errors: [{ rowNum: 0, column: "파일", message: `최대 ${MAX_ROWS}행까지 업로드할 수 있습니다. 현재 ${rawRows.length}행입니다.` }],
      totalRows: rawRows.length,
    }
  }

  const siteMap = new Map(sites.map((site) => [normalizeKey(site.code), site]))
  const existingSet = new Set(existingWorkCenters.map((wc) => `${wc.siteId}:${normalizeKey(wc.code)}`))
  const codesInFile = new Set<string>()
  const errors: WorkCenterRowError[] = []
  const validRows: ValidatedWorkCenterRow[] = []

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i]
    const rowNum = i + 2
    const rowErrors: WorkCenterRowError[] = []

    const siteCode = str(row[COL_SITE_CODE])
    const site = siteCode ? siteMap.get(normalizeKey(siteCode)) : null
    if (!siteCode) {
      rowErrors.push({ rowNum, column: COL_SITE_CODE, message: "필수값이 누락되었습니다." })
    } else if (!site) {
      rowErrors.push({ rowNum, column: COL_SITE_CODE, message: "존재하지 않는 사업장코드입니다." })
    }

    const code = str(row[COL_CODE])
    if (!code) {
      rowErrors.push({ rowNum, column: COL_CODE, message: "필수값이 누락되었습니다." })
    } else if (!CODE_PATTERN.test(code)) {
      rowErrors.push({ rowNum, column: COL_CODE, message: "한글, 영문, 숫자, 하이픈(-), 언더스코어(_)만 사용할 수 있으며 최대 50자입니다." })
    }

    if (site && code) {
      const codeKey = `${site.id}:${normalizeKey(code)}`
      if (codesInFile.has(codeKey)) {
        rowErrors.push({ rowNum, column: COL_CODE, message: "파일 안에 중복된 작업센터코드입니다." })
      } else if (existingSet.has(codeKey)) {
        rowErrors.push({ rowNum, column: COL_CODE, message: "이미 등록된 작업센터코드입니다." })
      } else {
        codesInFile.add(codeKey)
      }
    }

    const name = str(row[COL_NAME])
    if (!name) {
      rowErrors.push({ rowNum, column: COL_NAME, message: "필수값이 누락되었습니다." })
    } else if (name.length > 200) {
      rowErrors.push({ rowNum, column: COL_NAME, message: "200자를 초과할 수 없습니다." })
    }

    const kindRaw = str(row[COL_KIND])
    const kind = kindRaw ? resolveKind(kindRaw) : null
    if (!kindRaw) {
      rowErrors.push({ rowNum, column: COL_KIND, message: "필수값이 누락되었습니다." })
    } else if (!kind) {
      rowErrors.push({ rowNum, column: COL_KIND, message: "조립, 가공, 검사, 포장, 창고 또는 ASSEMBLY, MACHINING, INSPECTION, PACKAGING, STORAGE만 입력할 수 있습니다." })
    }

    const remark = str(row[COL_REMARK])
    if (remark.length > 500) {
      rowErrors.push({ rowNum, column: COL_REMARK, message: "500자를 초과할 수 없습니다." })
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      continue
    }

    validRows.push({
      rowNum,
      siteId: site!.id,
      siteCode: site!.code,
      siteName: site!.name,
      code,
      name,
      kind: kind!,
      remark: remark || null,
    })
  }

  return { validRows, errors, totalRows: rawRows.length }
}

async function getValidationRefs() {
  const tenantId = await getTenantId()
  const [sites, existingWorkCenters] = await Promise.all([
    prisma.site.findMany({
      where: { tenantId },
      select: { id: true, code: true, name: true },
    }),
    prisma.workCenter.findMany({
      where: { site: { tenantId } },
      select: { siteId: true, code: true },
    }),
  ])

  return { sites, existingWorkCenters }
}

export async function validateWorkCenterExcelRows(
  rawRows: RawWorkCenterExcelRow[],
): Promise<WorkCenterValidationResult> {
  await requireRole("OPERATOR")
  await requireResourcePermission("ROUTING", "CREATE")
  const refs = await getValidationRefs()
  return validateRowsSync(rawRows, refs.sites, refs.existingWorkCenters)
}

export async function importValidatedWorkCenters(
  rows: ValidatedWorkCenterRow[],
): Promise<{ success: true; importedCount: number } | { success: false; error: string }> {
  const actor = await requireRole("OPERATOR")
  await requireResourcePermission("ROUTING", "CREATE")
  const tenantId = await getTenantId()

  if (rows.length === 0) return { success: false, error: "가져올 작업센터가 없습니다." }
  if (rows.length > MAX_ROWS) return { success: false, error: `최대 ${MAX_ROWS}행까지 가져올 수 있습니다.` }

  const refs = await getValidationRefs()
  const recheck = validateRowsSync(
    rows.map((row) => ({
      [COL_SITE_CODE]: row.siteCode,
      [COL_CODE]: row.code,
      [COL_NAME]: row.name,
      [COL_KIND]: row.kind,
      [COL_REMARK]: row.remark ?? "",
    })),
    refs.sites,
    refs.existingWorkCenters,
  )

  if (recheck.errors.length > 0) {
    const firstError = recheck.errors[0]
    return { success: false, error: `${firstError.rowNum}행 / ${firstError.column}: ${firstError.message}` }
  }

  const importedCodes: string[] = []

  try {
    await prisma.$transaction(async (tx) => {
      for (const row of recheck.validRows) {
        await tx.workCenter.create({
          data: {
            siteId: row.siteId,
            code: row.code,
            name: row.name,
            kind: row.kind,
          },
        })
        importedCodes.push(row.code)
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "WorkCenter",
          entityId: "BULK",
          action: "CREATE",
          afterData: {
            source: "EXCEL_UPLOAD",
            importedCount: recheck.validRows.length,
            workCenterCodes: importedCodes.slice(0, 20),
          },
          menuName: "작업센터 관리",
        },
      })
    })

    revalidatePath("/app/mes/work-centers")
    return { success: true, importedCount: recheck.validRows.length }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "작업센터 등록 중 오류가 발생했습니다." }
  }
}
