"use server"

import { getTenantId, requireRole } from "@/lib/auth"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { prisma } from "@/lib/db/prisma"
import { UOM } from "@prisma/client"

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const MAX_ROWS = 1000
const VALID_UOMS: string[] = ["EA", "KG", "G", "L", "ML", "M", "CM", "MM", "BOX", "SET"]
const ITEM_CODE_PATTERN = /^[가-힣a-zA-Z0-9_\-]{1,50}$/

// 엑셀 헤더명 → 파싱 키
const COL_CODE     = "품목코드"
const COL_NAME     = "품목명"
const COL_CATEGORY = "품목분류코드"
const COL_GROUP    = "품목군코드"
const COL_SPEC     = "규격"
const COL_UOM      = "단위"
const COL_LOT      = "LOT관리여부"
const COL_STATUS   = "사용여부"

// ─── 공개 타입 ────────────────────────────────────────────────────────────────

export type RawExcelRow = Record<string, unknown>

export type ItemRowError = {
  rowNum: number
  column: string
  message: string
}

export type ValidatedItemRow = {
  rowNum: number
  code: string
  name: string
  categoryId: string
  itemGroupId: string | null
  uom: UOM
  spec: string | null
  isLotTracked: boolean
  status: "ACTIVE" | "INACTIVE"
}

export type ItemValidationResult = {
  validRows: ValidatedItemRow[]
  errors: ItemRowError[]
  totalRows: number
}

// ─── 내부 유틸 ────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return (v == null ? "" : String(v)).trim()
}

// ─── validateItemExcelRows ────────────────────────────────────────────────────

export async function validateItemExcelRows(
  rawRows: RawExcelRow[]
): Promise<ItemValidationResult> {
  const tenantId = await getTenantId()
  await requireRole("OPERATOR")
  await requireResourcePermission("ITEM", "CREATE")

  if (rawRows.length > MAX_ROWS) {
    return {
      validRows: [],
      errors: [{ rowNum: 0, column: "파일", message: `최대 ${MAX_ROWS}행까지 업로드 가능합니다. (현재: ${rawRows.length}행)` }],
      totalRows: rawRows.length,
    }
  }

  // Pre-fetch 참조 데이터
  const [categories, groups, existingItems] = await Promise.all([
    prisma.itemCategory.findMany({
      where: { tenantId, itemType: { not: null } },
      select: { id: true, code: true, itemType: true },
    }),
    prisma.itemGroup.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, code: true, categoryId: true },
    }),
    prisma.item.findMany({
      where: { tenantId },
      select: { code: true },
    }),
  ])

  const categoryMap = new Map(categories.map((c) => [c.code.toUpperCase(), c]))
  const groupMap    = new Map(groups.map((g) => [g.code.toUpperCase(), g]))
  const existingSet = new Set(existingItems.map((i) => i.code.toUpperCase()))

  const errors: ItemRowError[]          = []
  const validRows: ValidatedItemRow[]   = []
  const codesInFile = new Set<string>()

  for (let i = 0; i < rawRows.length; i++) {
    const row    = rawRows[i]
    const rowNum = i + 2 // 엑셀 기준 행번호 (1=헤더, 데이터 2행~)
    const rowErr: ItemRowError[] = []

    // ── 품목코드 ──
    const code = str(row[COL_CODE])
    let codeOk = false
    if (!code) {
      rowErr.push({ rowNum, column: COL_CODE, message: "필수값이 누락되었습니다." })
    } else if (!ITEM_CODE_PATTERN.test(code)) {
      rowErr.push({ rowNum, column: COL_CODE, message: "한글, 영문, 숫자, 하이픈(-), 언더스코어(_)만 사용할 수 있습니다." })
    } else if (codesInFile.has(code.toUpperCase())) {
      rowErr.push({ rowNum, column: COL_CODE, message: "파일 내에 중복된 품목코드입니다." })
    } else if (existingSet.has(code.toUpperCase())) {
      rowErr.push({ rowNum, column: COL_CODE, message: "이미 등록된 품목코드입니다." })
    } else {
      codesInFile.add(code.toUpperCase())
      codeOk = true
    }

    // ── 품목명 ──
    const name = str(row[COL_NAME])
    if (!name) {
      rowErr.push({ rowNum, column: COL_NAME, message: "필수값이 누락되었습니다." })
    } else if (name.length > 200) {
      rowErr.push({ rowNum, column: COL_NAME, message: "200자를 초과할 수 없습니다." })
    }

    // ── 품목분류코드 ──
    const categoryCode = str(row[COL_CATEGORY])
    let categoryId: string | null = null
    if (!categoryCode) {
      rowErr.push({ rowNum, column: COL_CATEGORY, message: "필수값이 누락되었습니다." })
    } else {
      const cat = categoryMap.get(categoryCode.toUpperCase())
      if (!cat) {
        rowErr.push({ rowNum, column: COL_CATEGORY, message: `존재하지 않는 품목분류코드입니다. (입력값: ${categoryCode})` })
      } else {
        categoryId = cat.id
      }
    }

    // ── 품목군코드 (선택) ──
    const groupCode = str(row[COL_GROUP])
    let itemGroupId: string | null = null
    if (groupCode) {
      const grp = groupMap.get(groupCode.toUpperCase())
      if (!grp) {
        rowErr.push({ rowNum, column: COL_GROUP, message: `존재하지 않는 품목군코드입니다. (입력값: ${groupCode})` })
      } else if (categoryId && grp.categoryId !== categoryId) {
        rowErr.push({ rowNum, column: COL_GROUP, message: "입력한 품목분류에 속하지 않는 품목군입니다." })
      } else {
        itemGroupId = grp.id
      }
    }

    // ── 단위 ──
    const uomRaw = str(row[COL_UOM]).toUpperCase()
    if (!uomRaw) {
      rowErr.push({ rowNum, column: COL_UOM, message: "필수값이 누락되었습니다." })
    } else if (!VALID_UOMS.includes(uomRaw)) {
      rowErr.push({ rowNum, column: COL_UOM, message: `허용되지 않는 단위입니다. 허용값: ${VALID_UOMS.join(", ")}` })
    }

    // ── LOT관리여부 ──
    const lotRaw = str(row[COL_LOT]).toUpperCase()
    if (!lotRaw) {
      rowErr.push({ rowNum, column: COL_LOT, message: "필수값이 누락되었습니다. Y 또는 N을 입력하세요." })
    } else if (!["Y", "N"].includes(lotRaw)) {
      rowErr.push({ rowNum, column: COL_LOT, message: "Y 또는 N만 입력할 수 있습니다." })
    }

    // ── 사용여부 (선택, 기본 Y=ACTIVE) ──
    const statusRaw = str(row[COL_STATUS]).toUpperCase() || "Y"
    if (!["Y", "N"].includes(statusRaw)) {
      rowErr.push({ rowNum, column: COL_STATUS, message: "Y 또는 N만 입력할 수 있습니다." })
    }

    // ── 규격 (선택) ──
    const spec = str(row[COL_SPEC]) || null
    if (spec && spec.length > 200) {
      rowErr.push({ rowNum, column: COL_SPEC, message: "200자를 초과할 수 없습니다." })
    }

    if (rowErr.length > 0) {
      errors.push(...rowErr)
    } else if (codeOk && categoryId) {
      validRows.push({
        rowNum,
        code,
        name,
        categoryId,
        itemGroupId,
        uom:          uomRaw as UOM,
        spec,
        isLotTracked: lotRaw === "Y",
        status:       statusRaw === "Y" ? "ACTIVE" : "INACTIVE",
      })
    }
  }

  return { validRows, errors, totalRows: rawRows.length }
}

// ─── importValidatedItems ─────────────────────────────────────────────────────

export async function importValidatedItems(
  rows: ValidatedItemRow[]
): Promise<{ success: true; importedCount: number } | { success: false; error: string }> {
  const tenantId = await getTenantId()
  const actor    = await requireRole("OPERATOR")
  await requireResourcePermission("ITEM", "CREATE")

  if (rows.length === 0)        return { success: false, error: "가져올 행이 없습니다." }
  if (rows.length > MAX_ROWS)   return { success: false, error: `최대 ${MAX_ROWS}행까지 가져올 수 있습니다.` }

  // 서버 재검증 (클라이언트 preview 결과만 신뢰하지 않음)
  const codes       = rows.map((r) => r.code)
  const categoryIds = Array.from(new Set(rows.map((r) => r.categoryId)))

  const [existingItems, validCategories] = await Promise.all([
    prisma.item.findMany({
      where: { tenantId, code: { in: codes } },
      select: { code: true },
    }),
    prisma.itemCategory.findMany({
      where: { id: { in: categoryIds }, tenantId, itemType: { not: null } },
      select: { id: true, itemType: true },
    }),
  ])

  if (existingItems.length > 0) {
    const dupCodes = existingItems.map((i) => i.code).join(", ")
    return { success: false, error: `이미 등록된 품목코드가 있습니다: ${dupCodes}` }
  }

  const categoryMap = new Map(validCategories.map((c) => [c.id, c]))

  for (const row of rows) {
    if (!categoryMap.has(row.categoryId)) {
      return { success: false, error: `${row.rowNum}행: 유효하지 않은 품목분류입니다. 다시 검증해 주세요.` }
    }
  }

  // 트랜잭션 등록
  try {
    const importedCodes: string[] = []

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const cat = categoryMap.get(row.categoryId)!
        await tx.item.create({
          data: {
            tenantId,
            code:            row.code,
            name:            row.name,
            itemType:        cat.itemType!,
            categoryId:      row.categoryId,
            itemGroupId:     row.itemGroupId,
            uom:             row.uom,
            spec:            row.spec,
            isLotTracked:    row.isLotTracked,
            isSerialTracked: false,
            lotNumberingType: "DEFAULT",
            manualLotPolicy:  "ALLOWED",
            status:          row.status,
          },
        })
        importedCodes.push(row.code)
      }

      // AuditLog (코드는 최대 20개만 기록)
      await tx.auditLog.create({
        data: {
          tenantId,
          actorId:    actor.id,
          actorLabel: actor.name,
          entityType: "Item",
          entityId:   "BULK",
          action:     "CREATE",
          afterData: {
            source:        "EXCEL_UPLOAD",
            importedCount: rows.length,
            itemCodes:     importedCodes.slice(0, 20),
          },
          menuName: "품목정보",
        },
      })
    })

    return { success: true, importedCount: rows.length }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "등록 중 오류가 발생했습니다." }
  }
}
