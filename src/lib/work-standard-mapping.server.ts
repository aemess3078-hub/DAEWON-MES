import { recordAuditLog } from "@/lib/audit-log"
import type { CurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { validateRoutingForItemContext } from "@/lib/routing-validation.server"
import { DocType, Prisma } from "@prisma/client"

type WorkStandardMappingDb = Prisma.TransactionClient | typeof prisma

export const WORK_STANDARD_MAPPING_MENU_NAME = "작업표준서관리"

export const workStandardMappingInclude = {
  document: true,
  item: true,
  routingOperation: { include: { routing: true } },
} satisfies Prisma.WorkStandardMappingInclude

export type WorkStandardMappingForAudit = Prisma.WorkStandardMappingGetPayload<{
  include: typeof workStandardMappingInclude
}>

export function normalizeWorkStandardDisplayOrder(value: unknown): number {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return 0
  return Math.trunc(n)
}

export function toWorkStandardMappingAuditData(mapping: WorkStandardMappingForAudit) {
  return {
    document: {
      id: mapping.documentId,
      code: mapping.document.code,
      name: mapping.document.name,
    },
    item: {
      id: mapping.itemId,
      code: mapping.item.code,
      name: mapping.item.name,
    },
    routingOperation: {
      id: mapping.routingOperationId,
      code: mapping.routingOperation.operationCode,
      name: mapping.routingOperation.name,
      routingId: mapping.routingOperation.routingId,
      routingCode: mapping.routingOperation.routing.code,
      routingName: mapping.routingOperation.routing.name,
      routingVersion: mapping.routingOperation.routing.version,
    },
    isActive: mapping.isActive,
    displayOrder: mapping.displayOrder,
  }
}

export async function validateWorkStandardMappingTargets(
  db: WorkStandardMappingDb,
  params: {
    tenantId: string
    documentId: string
    itemId: string
    routingOperationId: string
  }
) {
  const [document, item, routingOperation] = await Promise.all([
    db.document.findFirst({
      where: { id: params.documentId, tenantId: params.tenantId },
      select: { id: true, docType: true, fileUrl: true },
    }),
    db.item.findFirst({
      where: { id: params.itemId, tenantId: params.tenantId },
      select: { id: true },
    }),
    db.routingOperation.findFirst({
      where: {
        id: params.routingOperationId,
        routing: { tenantId: params.tenantId },
      },
      select: {
        id: true,
        routingId: true,
      },
    }),
  ])

  if (!document) throw new Error("문서를 찾을 수 없습니다.")
  if (document.docType !== DocType.SOP) throw new Error("SOP 문서만 POP 작업표준서로 매핑할 수 있습니다.")
  if (!document.fileUrl?.trim()) throw new Error("파일 URL이 있는 SOP만 POP에 표시할 수 있습니다.")
  if (!item) throw new Error("품목을 찾을 수 없습니다.")
  if (!routingOperation) throw new Error("라우팅 공정을 찾을 수 없습니다.")

  await validateRoutingForItemContext(db, {
    tenantId: params.tenantId,
    itemId: params.itemId,
    routingId: routingOperation.routingId,
  })
}

export async function assertWorkStandardDocumentTypeChangeAllowed(
  db: WorkStandardMappingDb,
  params: {
    tenantId: string
    documentId: string
    nextDocType: DocType
  }
) {
  if (params.nextDocType === DocType.SOP) return
  const count = await db.workStandardMapping.count({
    where: { tenantId: params.tenantId, documentId: params.documentId },
  })
  if (count > 0) {
    throw new Error("POP 작업표준서 매핑이 있는 문서는 SOP 외 유형으로 변경할 수 없습니다.")
  }
}

export async function assertWorkStandardDocumentDeleteAllowed(
  db: WorkStandardMappingDb,
  params: {
    tenantId: string
    documentId: string
  }
) {
  const count = await db.workStandardMapping.count({
    where: { tenantId: params.tenantId, documentId: params.documentId },
  })
  if (count > 0) {
    throw new Error(`POP 작업표준서 매핑이 ${count}건 있습니다. 매핑 해제 후 삭제하세요.`)
  }
}

export async function createWorkStandardMappingForTenant(
  db: WorkStandardMappingDb,
  params: {
    tenantId: string
    actor: CurrentUser | null
    documentId: string
    itemId: string
    routingOperationId: string
    displayOrder?: number
  }
) {
  await validateWorkStandardMappingTargets(db, params)

  try {
    const created = await db.workStandardMapping.create({
      data: {
        tenantId: params.tenantId,
        documentId: params.documentId,
        itemId: params.itemId,
        routingOperationId: params.routingOperationId,
        displayOrder: normalizeWorkStandardDisplayOrder(params.displayOrder),
      },
      include: workStandardMappingInclude,
    })

    await recordAuditLog(db, {
      tenantId: params.tenantId,
      actor: params.actor,
      entityType: "WorkStandardMapping",
      entityId: created.id,
      action: "CREATE",
      afterData: toWorkStandardMappingAuditData(created),
      menuName: WORK_STANDARD_MAPPING_MENU_NAME,
    })

    return created
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Error("이미 같은 SOP/품목/공정 매핑이 존재합니다.")
    }
    throw e
  }
}

export async function updateWorkStandardMappingForTenant(
  db: WorkStandardMappingDb,
  params: {
    tenantId: string
    actor: CurrentUser | null
    id: string
    isActive: boolean
    displayOrder?: number
  }
) {
  const before = await db.workStandardMapping.findFirst({
    where: { id: params.id, tenantId: params.tenantId },
    include: workStandardMappingInclude,
  })
  if (!before) throw new Error("작업표준서 매핑을 찾을 수 없습니다.")

  const updated = await db.workStandardMapping.update({
    where: { id: params.id },
    data: {
      isActive: Boolean(params.isActive),
      displayOrder: normalizeWorkStandardDisplayOrder(params.displayOrder),
    },
    include: workStandardMappingInclude,
  })

  await recordAuditLog(db, {
    tenantId: params.tenantId,
    actor: params.actor,
    entityType: "WorkStandardMapping",
    entityId: updated.id,
    action: "UPDATE",
    beforeData: toWorkStandardMappingAuditData(before),
    afterData: toWorkStandardMappingAuditData(updated),
    menuName: WORK_STANDARD_MAPPING_MENU_NAME,
  })

  return updated
}

export async function deleteWorkStandardMappingForTenant(
  db: WorkStandardMappingDb,
  params: {
    tenantId: string
    actor: CurrentUser | null
    id: string
  }
) {
  const before = await db.workStandardMapping.findFirst({
    where: { id: params.id, tenantId: params.tenantId },
    include: workStandardMappingInclude,
  })
  if (!before) throw new Error("작업표준서 매핑을 찾을 수 없습니다.")

  await db.workStandardMapping.delete({ where: { id: params.id } })

  await recordAuditLog(db, {
    tenantId: params.tenantId,
    actor: params.actor,
    entityType: "WorkStandardMapping",
    entityId: before.id,
    action: "DELETE",
    beforeData: toWorkStandardMappingAuditData(before),
    menuName: WORK_STANDARD_MAPPING_MENU_NAME,
  })

  return before
}
