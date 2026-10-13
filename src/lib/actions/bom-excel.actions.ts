"use server"

import { getTenantId, requireRole } from "@/lib/auth"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { prisma } from "@/lib/db/prisma"
import { BOMStatus } from "@prisma/client"
import { decideImportDefaultFlags } from "@/lib/bom-default-policy"
import { revalidatePath } from "next/cache"

const MAX_ROWS = 1000

const COL_PARENT = "완제품코드"
const COL_BOM_NAME = "BOM명"
const COL_VERSION = "버전"
const COL_STATUS = "사용여부"
const COL_COMPONENT = "원자재코드"
const COL_QTY = "소요수량"
const COL_UNIT = "단위"
const COL_SCRAP = "로스율"

export type RawBomExcelRow = Record<string, unknown>

export type BomRowError = {
  rowNum: number
  column: string
  message: string
}

export type ValidatedBomGroupItem = {
  componentCode: string
  componentName: string
  componentItemId: string
  seq: number
  qtyPer: number
  scrapRate: number // 0-1 in DB (converted from 0-100% in Excel)
}

export type ValidatedBomGroup = {
  key: string // "완제품코드(upper)@버전"
  parentCode: string
  parentName: string
  parentItemId: string
  version: string
  status: BOMStatus
  bomName: string
  items: ValidatedBomGroupItem[]
}

export type BomValidationResult = {
  validGroups: ValidatedBomGroup[]
  errors: BomRowError[]
  totalRows: number
}

export type BomExportRow = {
  parentCode: string
  parentName: string
  version: string
  statusLabel: string
  componentCode: string
  componentName: string
  qtyPer: number
  uom: string
  scrapRatePct: number // 0-100 for Excel display
}

function str(value: unknown): string {
  return (value == null ? "" : String(value)).trim()
}

function parsePositiveDecimal(value: unknown): number | null {
  const text = str(value)
  if (!text) return null
  const n = Number(text)
  if (isNaN(n) || n <= 0) return null
  return n
}

// Returns percentage value (0-100) or null for invalid, 0 for empty
function parseScrapRatePct(value: unknown): number | null {
  const text = str(value)
  if (!text) return 0
  const n = Number(text)
  if (isNaN(n) || n < 0 || n > 100) return null
  return n
}

export async function validateBomExcelRows(
  rawRows: RawBomExcelRow[]
): Promise<BomValidationResult> {
  const tenantId = await getTenantId()
  await requireRole("OPERATOR")
  await requireResourcePermission("BOM", "CREATE")

  if (rawRows.length > MAX_ROWS) {
    return {
      validGroups: [],
      errors: [{ rowNum: 0, column: "파일", message: `최대 ${MAX_ROWS}행까지 업로드할 수 있습니다. 현재 ${rawRows.length}행입니다.` }],
      totalRows: rawRows.length,
    }
  }

  const allItems = await prisma.item.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true, itemType: true, uom: true },
  })
  const itemByCode = new Map(allItems.map((item) => [item.code.toUpperCase(), item]))

  const existingBoms = await prisma.bOM.findMany({
    where: { tenantId },
    include: { item: { select: { code: true } } },
  })
  const existingBomKeys = new Set(existingBoms.map((b) => `${b.item.code.toUpperCase()}@${b.version}`))

  const errors: BomRowError[] = []

  type RowData = {
    parentCode: string
    bomName: string
    version: string
    statusRaw: string
    componentCode: string
    qtyPer: number
    scrapRatePct: number
  }

  // Phase 1: row-level validation
  const rowDataArr: (RowData | null)[] = []

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i]
    const rowNum = i + 2
    const rowErrors: BomRowError[] = []

    const parentCode = str(row[COL_PARENT])
    const bomName = str(row[COL_BOM_NAME])
    const version = str(row[COL_VERSION])
    const statusRaw = str(row[COL_STATUS]).toUpperCase()
    const componentCode = str(row[COL_COMPONENT])
    const qtyRaw = row[COL_QTY]
    const unitRaw = str(row[COL_UNIT]).toUpperCase()
    const scrapRaw = row[COL_SCRAP]

    let parentValid = false
    if (!parentCode) {
      rowErrors.push({ rowNum, column: COL_PARENT, message: "필수값이 누락되었습니다." })
    } else {
      const parentItem = itemByCode.get(parentCode.toUpperCase())
      if (!parentItem) {
        rowErrors.push({ rowNum, column: COL_PARENT, message: `등록된 품목이 아닙니다: ${parentCode}` })
      } else if (parentItem.itemType !== "FINISHED" && parentItem.itemType !== "SEMI_FINISHED") {
        rowErrors.push({ rowNum, column: COL_PARENT, message: "완제품 또는 반제품만 BOM 상위 품목으로 허용됩니다." })
      } else {
        parentValid = true
      }
    }

    if (!bomName) {
      rowErrors.push({ rowNum, column: COL_BOM_NAME, message: "필수값이 누락되었습니다." })
    }

    if (!version) {
      rowErrors.push({ rowNum, column: COL_VERSION, message: "필수값이 누락되었습니다." })
    }

    if (!statusRaw) {
      rowErrors.push({ rowNum, column: COL_STATUS, message: "필수값이 누락되었습니다. Y 또는 N을 입력하세요." })
    } else if (!["Y", "N"].includes(statusRaw)) {
      rowErrors.push({ rowNum, column: COL_STATUS, message: "Y 또는 N만 입력할 수 있습니다." })
    }

    let componentItemValid = false
    let componentItemUom = ""
    if (!componentCode) {
      rowErrors.push({ rowNum, column: COL_COMPONENT, message: "필수값이 누락되었습니다." })
    } else {
      const compItem = itemByCode.get(componentCode.toUpperCase())
      if (!compItem) {
        rowErrors.push({ rowNum, column: COL_COMPONENT, message: `등록된 품목이 아닙니다: ${componentCode}` })
      } else if (!["RAW_MATERIAL", "SEMI_FINISHED", "CONSUMABLE"].includes(compItem.itemType)) {
        rowErrors.push({ rowNum, column: COL_COMPONENT, message: "원자재, 반제품, 소모품만 자재로 사용할 수 있습니다." })
      } else if (parentValid && componentCode.toUpperCase() === parentCode.toUpperCase()) {
        rowErrors.push({ rowNum, column: COL_COMPONENT, message: "상위 품목과 자재 품목이 동일할 수 없습니다." })
      } else {
        componentItemValid = true
        componentItemUom = compItem.uom
      }
    }

    const qtyStr = str(qtyRaw)
    const qtyPer = parsePositiveDecimal(qtyRaw)
    if (!qtyStr) {
      rowErrors.push({ rowNum, column: COL_QTY, message: "필수값이 누락되었습니다." })
    } else if (qtyPer === null) {
      rowErrors.push({ rowNum, column: COL_QTY, message: "소요수량은 0보다 큰 숫자여야 합니다." })
    }

    if (!unitRaw) {
      rowErrors.push({ rowNum, column: COL_UNIT, message: "필수값이 누락되었습니다." })
    } else if (componentItemValid && componentItemUom && componentItemUom !== unitRaw) {
      rowErrors.push({ rowNum, column: COL_UNIT, message: `단위가 품목 기준단위(${componentItemUom})와 일치하지 않습니다.` })
    }

    const scrapRatePct = parseScrapRatePct(scrapRaw)
    if (scrapRatePct === null) {
      rowErrors.push({ rowNum, column: COL_SCRAP, message: "로스율은 0~100 사이의 숫자여야 합니다." })
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      rowDataArr.push(null)
    } else {
      rowDataArr.push({
        parentCode,
        bomName,
        version,
        statusRaw,
        componentCode,
        qtyPer: qtyPer!,
        scrapRatePct: scrapRatePct!,
      })
    }
  }

  // Phase 2: group-level validation
  type GroupState = {
    parentCode: string
    parentName: string
    parentItemId: string
    version: string
    bomName: string
    statusRaw: string
    componentCodes: Set<string>
    items: ValidatedBomGroupItem[]
    hasError: boolean
  }

  const groups = new Map<string, GroupState>()
  const groupErrors: BomRowError[] = []

  for (let i = 0; i < rawRows.length; i++) {
    const rowNum = i + 2
    const data = rowDataArr[i]
    if (!data) continue

    const groupKey = `${data.parentCode.toUpperCase()}@${data.version}`

    if (!groups.has(groupKey)) {
      if (existingBomKeys.has(groupKey)) {
        groupErrors.push({ rowNum, column: COL_VERSION, message: `이미 등록된 BOM입니다: ${data.parentCode} 버전 ${data.version}` })
        const parentItem = itemByCode.get(data.parentCode.toUpperCase())!
        groups.set(groupKey, {
          parentCode: data.parentCode, parentName: parentItem.name, parentItemId: parentItem.id,
          version: data.version, bomName: data.bomName, statusRaw: data.statusRaw,
          componentCodes: new Set(), items: [], hasError: true,
        })
        continue
      }
      const parentItem = itemByCode.get(data.parentCode.toUpperCase())!
      groups.set(groupKey, {
        parentCode: data.parentCode, parentName: parentItem.name, parentItemId: parentItem.id,
        version: data.version, bomName: data.bomName, statusRaw: data.statusRaw,
        componentCodes: new Set(), items: [], hasError: false,
      })
    }

    const group = groups.get(groupKey)!
    if (group.hasError) continue

    if (data.bomName !== group.bomName) {
      groupErrors.push({ rowNum, column: COL_BOM_NAME, message: `같은 BOM 내 BOM명이 일치하지 않습니다. (기준: '${group.bomName}')` })
      group.hasError = true
      continue
    }

    if (data.statusRaw !== group.statusRaw) {
      groupErrors.push({ rowNum, column: COL_STATUS, message: `같은 BOM 내 사용여부가 일치하지 않습니다.` })
      group.hasError = true
      continue
    }

    const compKey = data.componentCode.toUpperCase()
    if (group.componentCodes.has(compKey)) {
      groupErrors.push({ rowNum, column: COL_COMPONENT, message: `같은 BOM 내 중복된 원자재코드입니다: ${data.componentCode}` })
      group.hasError = true
      continue
    }
    group.componentCodes.add(compKey)

    const componentItem = itemByCode.get(compKey)!
    group.items.push({
      componentCode: data.componentCode,
      componentName: componentItem.name,
      componentItemId: componentItem.id,
      seq: group.items.length + 1,
      qtyPer: data.qtyPer,
      scrapRate: data.scrapRatePct / 100,
    })
  }

  errors.push(...groupErrors)

  const validGroups: ValidatedBomGroup[] = []
  Array.from(groups.entries()).forEach(([key, group]) => {
    if (!group.hasError && group.items.length > 0) {
      validGroups.push({
        key,
        parentCode: group.parentCode,
        parentName: group.parentName,
        parentItemId: group.parentItemId,
        version: group.version,
        status: group.statusRaw === "Y" ? BOMStatus.ACTIVE : BOMStatus.INACTIVE,
        bomName: group.bomName,
        items: group.items,
      })
    }
  })

  return { validGroups, errors, totalRows: rawRows.length }
}

export async function importValidatedBoms(
  groups: ValidatedBomGroup[]
): Promise<
  | { success: true; importedBomCount: number; importedItemCount: number; defaultAssignedCount: number }
  | { success: false; error: string }
> {
  const tenantId = await getTenantId()
  const actor = await requireRole("OPERATOR")
  await requireResourcePermission("BOM", "CREATE")

  if (groups.length === 0) return { success: false, error: "가져올 BOM이 없습니다." }

  // Re-validate DB conflicts (race condition protection)
  const parentItemIds = groups.map((g) => g.parentItemId)
  const existingBoms = await prisma.bOM.findMany({
    where: { tenantId, itemId: { in: parentItemIds } },
    include: { item: { select: { code: true } } },
  })
  const existingKeys = new Set(existingBoms.map((b) => `${b.item.code.toUpperCase()}@${b.version}`))
  const conflicts = groups.filter((g) => existingKeys.has(g.key))
  if (conflicts.length > 0) {
    return { success: false, error: `이미 등록된 BOM이 있습니다: ${conflicts.map((g) => `${g.parentCode} v${g.version}`).join(", ")}` }
  }

  let importedItemCount = 0
  let defaultAssignedCount = 0
  const bomKeys: string[] = []

  try {
    await prisma.$transaction(async (tx) => {
      // MRP 는 tenant 일치 + ACTIVE + isDefault 인 BOM 만 사용한다.
      // 이미 ACTIVE Default 가 있는 품목에는 Default 를 추가로 만들지 않는다(중복 Default 방지).
      const existingDefaults = await tx.bOM.findMany({
        where: { tenantId, status: BOMStatus.ACTIVE, isDefault: true, itemId: { in: parentItemIds } },
        select: { itemId: true },
      })
      const defaultFlags = decideImportDefaultFlags(
        groups.map((g) => ({ key: g.key, parentItemId: g.parentItemId, status: g.status })),
        new Set(existingDefaults.map((b) => b.itemId))
      )
      for (const group of groups) {
        const isDefault = defaultFlags.get(group.key) === true
        if (isDefault) defaultAssignedCount += 1
        await tx.bOM.create({
          data: {
            tenantId,
            itemId: group.parentItemId,
            version: group.version,
            isDefault,
            status: group.status,
            bomItems: {
              create: group.items.map((item) => ({
                componentItemId: item.componentItemId,
                seq: item.seq,
                qtyPer: item.qtyPer,
                scrapRate: item.scrapRate,
              })),
            },
          },
        })
        importedItemCount += group.items.length
        bomKeys.push(group.key)
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "BOM",
          entityId: "BULK",
          action: "CREATE",
          afterData: {
            source: "EXCEL_UPLOAD",
            importedBomCount: groups.length,
            importedItemCount,
            defaultAssignedCount,
            bomKeys: bomKeys.slice(0, 20),
          },
          menuName: "BOM",
        },
      })
    })

    revalidatePath("/app/mes/bom")
    return { success: true, importedBomCount: groups.length, importedItemCount, defaultAssignedCount }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "BOM 등록 중 오류가 발생했습니다." }
  }
}

export async function getBomExportData(): Promise<BomExportRow[]> {
  await requireResourcePermission("BOM", "READ")
  const tenantId = await getTenantId()

  const boms = await prisma.bOM.findMany({
    where: { tenantId },
    include: {
      item: { select: { code: true, name: true } },
      bomItems: {
        include: { componentItem: { select: { code: true, name: true, uom: true } } },
        orderBy: { seq: "asc" },
      },
    },
    orderBy: [{ item: { code: "asc" } }, { version: "asc" }],
  })

  const rows: BomExportRow[] = []
  for (const bom of boms) {
    for (const bi of bom.bomItems) {
      rows.push({
        parentCode: bom.item.code,
        parentName: bom.item.name,
        version: bom.version,
        statusLabel: bom.status === "ACTIVE" ? "Y" : "N",
        componentCode: bi.componentItem.code,
        componentName: bi.componentItem.name,
        qtyPer: Number(bi.qtyPer),
        uom: bi.componentItem.uom,
        scrapRatePct: Math.round(Number(bi.scrapRate) * 10000) / 100,
      })
    }
  }
  return rows
}
