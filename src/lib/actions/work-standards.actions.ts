"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId, requireRole } from "@/lib/auth"
import { DocType } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import {
  resolveWorkStandardFileUrls,
  WORK_STANDARD_WEB_URL_TTL_SECONDS,
} from "@/lib/storage/work-standard-storage"
import {
  assertWorkStandardDocumentDeleteAllowed,
  assertWorkStandardDocumentTypeChangeAllowed,
  createWorkStandardMappingForTenant,
  deleteWorkStandardMappingForTenant,
  updateWorkStandardMappingForTenant,
  workStandardMappingInclude,
  type WorkStandardMappingForAudit,
} from "@/lib/work-standard-mapping.server"

const REVALIDATE_PATH = "/app/mes/quality/work-standards"

// ─── Types ────────────────────────────────────────────────────────────────────

export type DocTypeValue = "SOP" | "DRAWING" | "SPEC" | "CERTIFICATE" | "OTHER"

export type WorkStandardMappingRow = {
  id: string
  documentId: string
  itemId: string
  itemCode: string
  itemName: string
  routingOperationId: string
  operationCode: string
  operationName: string
  routingId: string
  routingCode: string
  routingName: string
  routingVersion: string
  isActive: boolean
  displayOrder: number
}

export type WorkStandardItemOption = {
  id: string
  code: string
  name: string
}

export type WorkStandardOperationOption = {
  id: string
  operationCode: string
  operationName: string
  seq: number
  routingId: string
  routingCode: string
  routingName: string
  routingVersion: string
  routingScope: string
}

export type WorkStandardRow = {
  id: string
  code: string
  name: string
  docType: DocTypeValue
  /** DB 에 저장된 원본 값(저장소 참조 또는 외부 링크). 편집 폼의 저장값으로만 사용한다. */
  fileUrl: string | null
  /** 화면에서 열 때 쓰는 URL(저장소 파일은 만료되는 signed URL). 저장하지 말 것. */
  fileHref: string | null
  linkCount: number
  mappingCount: number
  mappings: WorkStandardMappingRow[]
}

export type WorkStandardsSummary = {
  total: number
  sop: number
  withUrl: number
  withoutUrl: number
}

export type WorkStandardsData = {
  summary: WorkStandardsSummary
  rows: WorkStandardRow[]
  items: WorkStandardItemOption[]
}

function toMappingRow(mapping: WorkStandardMappingForAudit): WorkStandardMappingRow {
  return {
    id: mapping.id,
    documentId: mapping.documentId,
    itemId: mapping.itemId,
    itemCode: mapping.item.code,
    itemName: mapping.item.name,
    routingOperationId: mapping.routingOperationId,
    operationCode: mapping.routingOperation.operationCode,
    operationName: mapping.routingOperation.name,
    routingId: mapping.routingOperation.routingId,
    routingCode: mapping.routingOperation.routing.code,
    routingName: mapping.routingOperation.routing.name,
    routingVersion: mapping.routingOperation.routing.version,
    isActive: mapping.isActive,
    displayOrder: mapping.displayOrder,
  }
}

// ─── 조회 ─────────────────────────────────────────────────────────────────────

export async function getWorkStandards(): Promise<WorkStandardsData> {
  await requireResourcePermission("WORK_STANDARD", "READ")
  const tenantId = await getTenantId()

  const [documents, items] = await Promise.all([
    prisma.document.findMany({
      where: { tenantId },
      include: {
        _count: { select: { documentLinks: true, workStandardMappings: true } },
        workStandardMappings: {
          include: workStandardMappingInclude,
          orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
        },
      },
      orderBy: { code: "asc" },
    }),
    prisma.item.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ])

  const fileHrefs = await resolveWorkStandardFileUrls(
    documents.map((d) => d.fileUrl),
    WORK_STANDARD_WEB_URL_TTL_SECONDS,
  )

  const rows: WorkStandardRow[] = documents.map((d, i) => ({
    id: d.id,
    code: d.code,
    name: d.name,
    docType: d.docType as DocTypeValue,
    fileUrl: d.fileUrl,
    fileHref: fileHrefs[i],
    linkCount: d._count.documentLinks,
    mappingCount: d._count.workStandardMappings,
    mappings: d.workStandardMappings.map(toMappingRow),
  }))

  return {
    summary: {
      total: rows.length,
      sop: rows.filter((r) => r.docType === "SOP").length,
      withUrl: rows.filter((r) => !!r.fileUrl).length,
      withoutUrl: rows.filter((r) => !r.fileUrl).length,
    },
    rows,
    items,
  }
}

export async function getWorkStandardRoutingOperationOptions(
  itemId: string
): Promise<WorkStandardOperationOption[]> {
  await requireResourcePermission("WORK_STANDARD", "READ")
  const tenantId = await getTenantId()

  const item = await prisma.item.findFirst({
    where: { id: itemId, tenantId },
    select: { id: true },
  })
  if (!item) throw new Error("품목을 찾을 수 없습니다.")

  const routings = await prisma.routing.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      OR: [
        { scope: "COMMON" },
        { scope: "ITEM_SPECIFIC", items: { some: { itemId } } },
      ],
    },
    include: {
      operations: { orderBy: { seq: "asc" } },
    },
    orderBy: [{ code: "asc" }, { version: "asc" }],
  })

  return routings.flatMap((routing) =>
    routing.operations.map((operation) => ({
      id: operation.id,
      operationCode: operation.operationCode,
      operationName: operation.name,
      seq: operation.seq,
      routingId: routing.id,
      routingCode: routing.code,
      routingName: routing.name,
      routingVersion: routing.version,
      routingScope: routing.scope,
    }))
  )
}

// ─── 등록 ─────────────────────────────────────────────────────────────────────

export async function createWorkStandard(data: {
  code: string
  name: string
  docType: string
  fileUrl?: string
}) {
  await requireResourcePermission("WORK_STANDARD", "CREATE")
  await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  if (!data.code.trim()) throw new Error("문서코드를 입력하세요.")
  if (!data.name.trim()) throw new Error("표준서명을 입력하세요.")

  const existing = await prisma.document.findUnique({
    where: { tenantId_code: { tenantId, code: data.code.trim() } },
  })
  if (existing) throw new Error(`문서코드 '${data.code}'가 이미 존재합니다.`)

  await prisma.document.create({
    data: {
      tenantId,
      code: data.code.trim(),
      name: data.name.trim(),
      docType: data.docType as DocType,
      fileUrl: data.fileUrl?.trim() || null,
    },
  })
  revalidatePath(REVALIDATE_PATH)
}

export async function createWorkStandardMapping(data: {
  documentId: string
  itemId: string
  routingOperationId: string
  displayOrder?: number
}) {
  await requireResourcePermission("WORK_STANDARD", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  await prisma.$transaction((tx) =>
    createWorkStandardMappingForTenant(tx, {
      tenantId,
      actor,
      documentId: data.documentId,
      itemId: data.itemId,
      routingOperationId: data.routingOperationId,
      displayOrder: data.displayOrder,
    })
  )

  revalidatePath(REVALIDATE_PATH)
}

// ─── 수정 ─────────────────────────────────────────────────────────────────────

export async function updateWorkStandard(
  id: string,
  data: {
    name: string
    docType: string
    fileUrl?: string
  }
) {
  await requireResourcePermission("WORK_STANDARD", "UPDATE")
  await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  if (!data.name.trim()) throw new Error("표준서명을 입력하세요.")

  const owned = await prisma.document.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("문서를 찾을 수 없습니다.")

  const nextDocType = data.docType as DocType
  await assertWorkStandardDocumentTypeChangeAllowed(prisma, {
    tenantId,
    documentId: id,
    nextDocType,
  })

  await prisma.document.update({
    where: { id },
    data: {
      name: data.name.trim(),
      docType: nextDocType,
      fileUrl: data.fileUrl?.trim() || null,
    },
  })
  revalidatePath(REVALIDATE_PATH)
}

export async function updateWorkStandardMapping(
  id: string,
  data: {
    isActive: boolean
    displayOrder?: number
  }
) {
  await requireResourcePermission("WORK_STANDARD", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  await prisma.$transaction((tx) =>
    updateWorkStandardMappingForTenant(tx, {
      tenantId,
      actor,
      id,
      isActive: data.isActive,
      displayOrder: data.displayOrder,
    })
  )

  revalidatePath(REVALIDATE_PATH)
}

// ─── 삭제 ─────────────────────────────────────────────────────────────────────
// DocumentLink 또는 POP 작업표준서 매핑 참조가 있으면 삭제 거부 (hard delete 전 안전 확인)

export async function deleteWorkStandard(id: string) {
  await requireResourcePermission("WORK_STANDARD", "DELETE")
  await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const owned = await prisma.document.findFirst({
    where: { id, tenantId },
    include: { _count: { select: { documentLinks: true } } },
  })
  if (!owned) throw new Error("문서를 찾을 수 없습니다.")

  if (owned._count.documentLinks > 0) {
    throw new Error(
      `연결된 항목이 ${owned._count.documentLinks}건 있습니다. 연결 해제 후 삭제하세요.`
    )
  }
  await assertWorkStandardDocumentDeleteAllowed(prisma, { tenantId, documentId: id })

  await prisma.document.delete({ where: { id } })
  revalidatePath(REVALIDATE_PATH)
}

export async function deleteWorkStandardMapping(id: string) {
  await requireResourcePermission("WORK_STANDARD", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  await prisma.$transaction((tx) =>
    deleteWorkStandardMappingForTenant(tx, {
      tenantId,
      actor,
      id,
    })
  )

  revalidatePath(REVALIDATE_PATH)
}
