"use server"

import { getTenantId, requireRole } from "@/lib/auth"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { prisma } from "@/lib/db/prisma"
import { RoutingStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"

const MAX_ROWS = 1000

const COL_ITEM = "품목코드"
const COL_CODE = "라우팅코드"
const COL_NAME = "라우팅명"
const COL_VERSION = "버전"
const COL_STATUS = "사용여부"
const COL_SEQ = "공정순서"
const COL_OP_CODE = "공정코드"
const COL_OP_NAME = "공정명"
const COL_STD_TIME = "표준시간(분)"

export type RawRoutingExcelRow = Record<string, unknown>

export type RoutingRowError = {
  rowNum: number
  column: string
  message: string
}

export type ValidatedRoutingOperation = {
  seq: number
  operationCode: string
  operationName: string
  workCenterId: string
  workCenterCode: string
  workCenterName: string
  standardTime: number
}

export type ValidatedRoutingGroup = {
  key: string // routingCode.toUpperCase()
  routingCode: string
  routingName: string
  version: string
  status: RoutingStatus
  itemCode: string
  itemId: string
  operations: ValidatedRoutingOperation[]
}

export type RoutingValidationResult = {
  validGroups: ValidatedRoutingGroup[]
  errors: RoutingRowError[]
  totalRows: number
}

export type RoutingExportRow = {
  itemCode: string
  itemName: string
  routingCode: string
  routingName: string
  version: string
  statusLabel: string
  seq: number
  operationCode: string
  operationName: string
  workCenterCode: string
  workCenterName: string
  standardTime: number
}

function str(value: unknown): string {
  return (value == null ? "" : String(value)).trim()
}

function parsePositiveInt(value: unknown): number | null {
  const text = str(value)
  if (!text) return null
  const n = Number(text)
  if (isNaN(n) || !Number.isInteger(n) || n <= 0) return null
  return n
}

function parseNonNegativeDecimal(value: unknown): number | null {
  const text = str(value)
  if (!text) return 0
  const n = Number(text)
  if (isNaN(n) || n < 0) return null
  return n
}

export async function validateRoutingExcelRows(
  rawRows: RawRoutingExcelRow[]
): Promise<RoutingValidationResult> {
  const tenantId = await getTenantId()
  await requireRole("OPERATOR")
  await requireResourcePermission("ROUTING", "CREATE")

  if (rawRows.length > MAX_ROWS) {
    return {
      validGroups: [],
      errors: [{ rowNum: 0, column: "파일", message: `최대 ${MAX_ROWS}행까지 업로드할 수 있습니다. 현재 ${rawRows.length}행입니다.` }],
      totalRows: rawRows.length,
    }
  }

  const validItems = await prisma.item.findMany({
    where: { tenantId, itemType: { in: ["FINISHED", "SEMI_FINISHED"] } },
    select: { id: true, code: true, name: true },
  })
  const itemByCode = new Map(validItems.map((item) => [item.code.toUpperCase(), item]))

  const workCenters = await prisma.workCenter.findMany({
    where: { site: { tenantId } },
    select: { id: true, code: true, name: true },
  })
  const wcByCode = new Map(workCenters.map((wc) => [wc.code.toUpperCase(), wc]))

  const existingRoutings = await prisma.routing.findMany({
    where: { tenantId },
    select: { code: true },
  })
  const existingCodes = new Set(existingRoutings.map((r) => r.code.toUpperCase()))

  const errors: RoutingRowError[] = []

  type RowData = {
    itemCode: string
    routingCode: string
    routingName: string
    version: string
    statusRaw: string
    seq: number
    operationCode: string
    operationName: string
    workCenterId: string
    workCenterCode: string
    workCenterName: string
    standardTime: number
  }

  // Phase 1: row-level validation
  const rowDataArr: (RowData | null)[] = []

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i]
    const rowNum = i + 2
    const rowErrors: RoutingRowError[] = []

    const itemCode = str(row[COL_ITEM])
    const routingCode = str(row[COL_CODE])
    const routingName = str(row[COL_NAME])
    const version = str(row[COL_VERSION])
    const statusRaw = str(row[COL_STATUS]).toUpperCase()
    const seqRaw = row[COL_SEQ]
    const opCodeRaw = str(row[COL_OP_CODE])
    const opNameRaw = str(row[COL_OP_NAME])
    const stdTimeRaw = row[COL_STD_TIME]

    // 품목코드
    if (!itemCode) {
      rowErrors.push({ rowNum, column: COL_ITEM, message: "필수값이 누락되었습니다." })
    } else if (!itemByCode.has(itemCode.toUpperCase())) {
      rowErrors.push({ rowNum, column: COL_ITEM, message: `존재하지 않는 품목코드입니다: ${itemCode}` })
    }

    // 라우팅코드
    if (!routingCode) {
      rowErrors.push({ rowNum, column: COL_CODE, message: "필수값이 누락되었습니다." })
    }

    // 라우팅명
    if (!routingName) {
      rowErrors.push({ rowNum, column: COL_NAME, message: "필수값이 누락되었습니다." })
    }

    // 버전
    if (!version) {
      rowErrors.push({ rowNum, column: COL_VERSION, message: "필수값이 누락되었습니다." })
    }

    // 사용여부
    if (!statusRaw) {
      rowErrors.push({ rowNum, column: COL_STATUS, message: "필수값이 누락되었습니다. Y 또는 N을 입력하세요." })
    } else if (!["Y", "N"].includes(statusRaw)) {
      rowErrors.push({ rowNum, column: COL_STATUS, message: "Y 또는 N만 입력할 수 있습니다." })
    }

    // 공정순서
    const seqStr = str(seqRaw)
    const seq = parsePositiveInt(seqRaw)
    if (!seqStr) {
      rowErrors.push({ rowNum, column: COL_SEQ, message: "필수값이 누락되었습니다." })
    } else if (seq === null) {
      rowErrors.push({ rowNum, column: COL_SEQ, message: "0보다 큰 정수여야 합니다." })
    }

    // 공정코드
    let workCenterId = ""
    let workCenterCode = ""
    let workCenterName = ""
    let resolvedOpName = opNameRaw
    if (!opCodeRaw) {
      rowErrors.push({ rowNum, column: COL_OP_CODE, message: "필수값이 누락되었습니다." })
    } else {
      const wc = wcByCode.get(opCodeRaw.toUpperCase())
      if (!wc) {
        rowErrors.push({ rowNum, column: COL_OP_CODE, message: `존재하지 않는 공정코드입니다: ${opCodeRaw}` })
      } else {
        workCenterId = wc.id
        workCenterCode = wc.code
        workCenterName = wc.name
        if (!resolvedOpName) resolvedOpName = wc.name
      }
    }

    // 표준시간
    const standardTime = parseNonNegativeDecimal(stdTimeRaw)
    if (standardTime === null) {
      rowErrors.push({ rowNum, column: COL_STD_TIME, message: "표준시간은 0 이상의 숫자여야 합니다." })
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      rowDataArr.push(null)
    } else {
      rowDataArr.push({
        itemCode,
        routingCode,
        routingName,
        version,
        statusRaw,
        seq: seq!,
        operationCode: opCodeRaw,
        operationName: resolvedOpName || opCodeRaw,
        workCenterId,
        workCenterCode,
        workCenterName,
        standardTime: standardTime!,
      })
    }
  }

  // Phase 2: group-level validation
  type GroupState = {
    routingCode: string
    routingName: string
    version: string
    statusRaw: string
    itemCode: string
    itemId: string
    seqs: Set<number>
    operations: ValidatedRoutingOperation[]
    hasError: boolean
  }

  const groups = new Map<string, GroupState>()
  const groupErrors: RoutingRowError[] = []

  for (let i = 0; i < rawRows.length; i++) {
    const rowNum = i + 2
    const data = rowDataArr[i]
    if (!data) continue

    const groupKey = data.routingCode.toUpperCase()

    if (!groups.has(groupKey)) {
      if (existingCodes.has(groupKey)) {
        groupErrors.push({ rowNum, column: COL_CODE, message: `이미 등록된 라우팅코드입니다: ${data.routingCode}` })
        const item = itemByCode.get(data.itemCode.toUpperCase())
        groups.set(groupKey, {
          routingCode: data.routingCode, routingName: data.routingName,
          version: data.version, statusRaw: data.statusRaw,
          itemCode: data.itemCode, itemId: item?.id ?? "",
          seqs: new Set(), operations: [], hasError: true,
        })
        continue
      }
      const item = itemByCode.get(data.itemCode.toUpperCase())!
      groups.set(groupKey, {
        routingCode: data.routingCode, routingName: data.routingName,
        version: data.version, statusRaw: data.statusRaw,
        itemCode: data.itemCode, itemId: item.id,
        seqs: new Set(), operations: [], hasError: false,
      })
    }

    const group = groups.get(groupKey)!
    if (group.hasError) continue

    // 품목코드 일치
    if (data.itemCode.toUpperCase() !== group.itemCode.toUpperCase()) {
      groupErrors.push({ rowNum, column: COL_ITEM, message: `같은 라우팅 내 품목코드가 일치하지 않습니다. (기준: '${group.itemCode}')` })
      group.hasError = true
      continue
    }

    // 라우팅명 일치
    if (data.routingName !== group.routingName) {
      groupErrors.push({ rowNum, column: COL_NAME, message: `같은 라우팅 내 라우팅명이 일치하지 않습니다. (기준: '${group.routingName}')` })
      group.hasError = true
      continue
    }

    // 버전 일치
    if (data.version !== group.version) {
      groupErrors.push({ rowNum, column: COL_VERSION, message: `같은 라우팅 내 버전이 일치하지 않습니다. (기준: '${group.version}')` })
      group.hasError = true
      continue
    }

    // 사용여부 일치
    if (data.statusRaw !== group.statusRaw) {
      groupErrors.push({ rowNum, column: COL_STATUS, message: `같은 라우팅 내 사용여부가 일치하지 않습니다.` })
      group.hasError = true
      continue
    }

    // 공정순서 중복
    if (group.seqs.has(data.seq)) {
      groupErrors.push({ rowNum, column: COL_SEQ, message: `같은 라우팅 내에서 중복된 공정순서입니다: ${data.seq}` })
      group.hasError = true
      continue
    }
    group.seqs.add(data.seq)

    group.operations.push({
      seq: data.seq,
      operationCode: data.operationCode,
      operationName: data.operationName,
      workCenterId: data.workCenterId,
      workCenterCode: data.workCenterCode,
      workCenterName: data.workCenterName,
      standardTime: data.standardTime,
    })
  }

  errors.push(...groupErrors)

  const validGroups: ValidatedRoutingGroup[] = []
  Array.from(groups.entries()).forEach(([key, group]) => {
    if (!group.hasError && group.operations.length > 0) {
      const sortedOps = [...group.operations].sort((a, b) => a.seq - b.seq)
      validGroups.push({
        key,
        routingCode: group.routingCode,
        routingName: group.routingName,
        version: group.version,
        status: group.statusRaw === "Y" ? RoutingStatus.ACTIVE : RoutingStatus.INACTIVE,
        itemCode: group.itemCode,
        itemId: group.itemId,
        operations: sortedOps,
      })
    }
  })

  return { validGroups, errors, totalRows: rawRows.length }
}

export async function importValidatedRoutings(
  groups: ValidatedRoutingGroup[]
): Promise<{ success: true; importedRoutingCount: number; importedOperationCount: number } | { success: false; error: string }> {
  const tenantId = await getTenantId()
  const actor = await requireRole("OPERATOR")
  await requireResourcePermission("ROUTING", "CREATE")

  if (groups.length === 0) return { success: false, error: "가져올 라우팅이 없습니다." }

  // Re-validate DB conflicts (race condition protection)
  const existingRoutings = await prisma.routing.findMany({
    where: { tenantId },
    select: { code: true },
  })
  const existingCodeSet = new Set(existingRoutings.map((r) => r.code.toUpperCase()))
  const conflicts = groups.filter((g) => existingCodeSet.has(g.routingCode.toUpperCase()))
  if (conflicts.length > 0) {
    return { success: false, error: `이미 등록된 라우팅코드가 있습니다: ${conflicts.map((g) => g.routingCode).join(", ")}` }
  }

  let importedOperationCount = 0
  const routingKeys: string[] = []

  try {
    await prisma.$transaction(async (tx) => {
      for (const group of groups) {
        const routing = await tx.routing.create({
          data: {
            tenantId,
            code: group.routingCode,
            name: group.routingName,
            version: group.version,
            status: group.status,
            operations: {
              create: group.operations.map((op) => ({
                seq: op.seq,
                operationCode: op.operationCode,
                name: op.operationName,
                workCenterId: op.workCenterId,
                standardTime: op.standardTime,
              })),
            },
          },
        })

        await tx.itemRouting.create({
          data: {
            tenantId,
            itemId: group.itemId,
            routingId: routing.id,
            isDefault: false,
          },
        })

        importedOperationCount += group.operations.length
        routingKeys.push(`${group.itemCode}@${group.version}`)
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "Routing",
          entityId: "BULK",
          action: "CREATE",
          afterData: {
            source: "EXCEL_UPLOAD",
            importedRoutingCount: groups.length,
            importedOperationCount,
            routingKeys: routingKeys.slice(0, 20),
          },
          menuName: "공정라우팅관리",
        },
      })
    })

    revalidatePath("/app/mes/routing")
    return { success: true, importedRoutingCount: groups.length, importedOperationCount }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "라우팅 등록 중 오류가 발생했습니다." }
  }
}

export async function getRoutingExportData(): Promise<RoutingExportRow[]> {
  await requireResourcePermission("ROUTING", "READ")
  const tenantId = await getTenantId()

  const routings = await prisma.routing.findMany({
    where: { tenantId },
    include: {
      items: {
        include: { item: { select: { code: true, name: true } } },
        take: 1,
      },
      operations: {
        include: { workCenter: { select: { code: true, name: true } } },
        orderBy: { seq: "asc" },
      },
    },
    orderBy: [{ code: "asc" }, { version: "asc" }],
  })

  const rows: RoutingExportRow[] = []
  for (const routing of routings) {
    const primaryItem = routing.items[0]
    for (const op of routing.operations) {
      rows.push({
        itemCode: primaryItem?.item.code ?? "",
        itemName: primaryItem?.item.name ?? "",
        routingCode: routing.code,
        routingName: routing.name,
        version: routing.version,
        statusLabel: routing.status === "ACTIVE" ? "Y" : "N",
        seq: op.seq,
        operationCode: op.operationCode,
        operationName: op.name,
        workCenterCode: op.workCenter.code,
        workCenterName: op.workCenter.name,
        standardTime: Number(op.standardTime),
      })
    }
  }
  return rows
}
