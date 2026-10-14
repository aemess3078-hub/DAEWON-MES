"use server"

import { PermissionAction } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { requireRole, getTenantId, type CurrentUser } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { getErrorMessage } from "@/lib/utils"
import { createAttachmentSignedUrl, deleteAttachmentFile } from "@/lib/storage/attachment-storage"
import {
  ATTACHMENT_ENTITY_TYPES,
  getAttachmentPermissionResource,
  isValidAttachmentEntityType,
  serializeAttachmentRow,
  type AttachmentEntityType,
  type AttachmentRow,
} from "./attachment.helpers"
import {
  getCurrentPermissionSnapshot,
  getResourcePermissionFlags,
  hasResourcePermission,
  requireResourcePermission,
  type ResourcePermissionFlags,
} from "@/lib/auth/role-permissions"
import { requireActor, requireReadActor, assertSessionTenant } from "@/lib/auth/action-guards"

export type { AttachmentRow, AttachmentEntityType }

const MENU_NAME = "첨부파일관리"
const ATTACHMENT_PARENT_DELETE_MESSAGE = "연결된 첨부파일이 있어 삭제할 수 없습니다."

type AttachmentPermissionAction = Extract<PermissionAction, "READ" | "CREATE" | "DELETE">
type AttachmentCountClient = { attachment: { count(args: { where: { tenantId: string; entityType: AttachmentEntityType; entityId: string } }): Promise<number> } }

function revalidateAttachmentPaths() {
  revalidatePath("/app/mes/attachments")
  revalidatePath("/app/mes/inspection")
  revalidatePath("/app/mes/quality/cause-analysis")
  revalidatePath("/app/mes/quality/corrective-action")
  revalidatePath("/app/mes/quality/recurrence-prevention")
  revalidatePath("/app/mes/equipment-repair")
}

function getRequiredAttachmentResource(entityType: string): string {
  const resource = getAttachmentPermissionResource(entityType)
  if (!resource) throw new Error("지원하지 않는 업무유형입니다.")
  return resource
}

export async function requireAttachmentEntityPermission(
  entityType: AttachmentEntityType,
  action: AttachmentPermissionAction,
  user?: CurrentUser | null
): Promise<CurrentUser> {
  return requireResourcePermission(getRequiredAttachmentResource(entityType), action, user)
}

export async function getAttachmentPermissionFlags(entityType: AttachmentEntityType): Promise<ResourcePermissionFlags> {
  await requireRole("VIEWER")
  const snapshot = await getCurrentPermissionSnapshot()
  return getResourcePermissionFlags(snapshot, getRequiredAttachmentResource(entityType))
}

async function getReadableAttachmentTypes(user?: CurrentUser | null): Promise<AttachmentEntityType[]> {
  const snapshot = await getCurrentPermissionSnapshot(user)
  return ATTACHMENT_ENTITY_TYPES.filter((entityType) =>
    hasResourcePermission(snapshot, getRequiredAttachmentResource(entityType), "READ")
  )
}

/**
 * entityType/entityId가 가리키는 실제 레코드가 현재 tenant 소속인지 서버에서
 * 재검증한다. API route(업로드)와 조회/다운로드/삭제 경로가 공유한다.
 */
export async function assertAttachmentEntityOwnership(
  entityType: AttachmentEntityType,
  entityId: string,
  tenantId: string
): Promise<void> {
  const sessionActor = await requireActor()
  assertSessionTenant(sessionActor, tenantId)
  if (entityType === "QUALITY_INSPECTION") {
    const row = await prisma.qualityInspection.findFirst({
      where: { id: entityId, workOrderOperation: { workOrder: { tenantId } } },
      select: { id: true },
    })
    if (!row) throw new Error("연결 대상(품질검사)을 찾을 수 없습니다.")
    return
  }
  if (entityType === "DEFECT_RECORD") {
    const row = await prisma.defectRecord.findFirst({
      where: { id: entityId, qualityInspection: { workOrderOperation: { workOrder: { tenantId } } } },
      select: { id: true },
    })
    if (!row) throw new Error("연결 대상(불량기록)을 찾을 수 없습니다.")
    return
  }
  if (entityType === "DEFECT_CAUSE_ANALYSIS") {
    const row = await prisma.defectCauseAnalysis.findFirst({ where: { id: entityId, tenantId }, select: { id: true } })
    if (!row) throw new Error("연결 대상(원인분석)을 찾을 수 없습니다.")
    return
  }
  if (entityType === "DEFECT_CORRECTIVE_ACTION") {
    const row = await prisma.defectCorrectiveAction.findFirst({ where: { id: entityId, tenantId }, select: { id: true } })
    if (!row) throw new Error("연결 대상(조치관리)을 찾을 수 없습니다.")
    return
  }
  if (entityType === "DEFECT_RECURRENCE_PREVENTION") {
    const row = await prisma.defectRecurrencePrevention.findFirst({ where: { id: entityId, tenantId }, select: { id: true } })
    if (!row) throw new Error("연결 대상(재발방지관리)을 찾을 수 없습니다.")
    return
  }
  if (entityType === "EQUIPMENT_REPAIR_REQUEST") {
    const row = await prisma.equipmentRepairRequest.findFirst({ where: { id: entityId, tenantId }, select: { id: true } })
    if (!row) throw new Error("연결 대상(설비수리요청)을 찾을 수 없습니다.")
    return
  }
  throw new Error("지원하지 않는 업무유형입니다.")
}

function workOrderLabel(workOrder: { orderNo: string; item: { code?: string | null; name: string } }) {
  const itemLabel = workOrder.item.code ? `[${workOrder.item.code}] ${workOrder.item.name}` : workOrder.item.name
  return `[${workOrder.orderNo}] ${itemLabel}`
}

async function buildEntityLabelMap(
  tenantId: string,
  rows: { entityType: string; entityId: string }[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const idsOf = (entityType: AttachmentEntityType) => Array.from(new Set(rows.filter((r) => r.entityType === entityType).map((r) => r.entityId)))

  const inspectionIds = idsOf("QUALITY_INSPECTION")
  const defectIds = idsOf("DEFECT_RECORD")
  const causeIds = idsOf("DEFECT_CAUSE_ANALYSIS")
  const correctiveIds = idsOf("DEFECT_CORRECTIVE_ACTION")
  const preventionIds = idsOf("DEFECT_RECURRENCE_PREVENTION")
  const repairIds = idsOf("EQUIPMENT_REPAIR_REQUEST")

  const workOrderSelect = { orderNo: true, item: { select: { code: true, name: true } } } as const
  const inspectionWorkOrderSelect = {
    workOrderOperation: { select: { workOrder: { select: workOrderSelect } } },
  } as const
  const defectWorkOrderSelect = {
    qualityInspection: { select: inspectionWorkOrderSelect },
  } as const

  const [inspections, defects, causes, correctives, preventions, repairs] = await Promise.all([
    inspectionIds.length
      ? prisma.qualityInspection.findMany({
          where: { id: { in: inspectionIds }, workOrderOperation: { workOrder: { tenantId } } },
          select: { id: true, stage: true, ...inspectionWorkOrderSelect },
        })
      : Promise.resolve([]),
    defectIds.length
      ? prisma.defectRecord.findMany({
          where: { id: { in: defectIds }, qualityInspection: { workOrderOperation: { workOrder: { tenantId } } } },
          select: { id: true, defectCode: { select: { code: true, name: true } }, ...defectWorkOrderSelect },
        })
      : Promise.resolve([]),
    causeIds.length
      ? prisma.defectCauseAnalysis.findMany({
          where: { id: { in: causeIds }, tenantId },
          select: { id: true, defectRecord: { select: defectWorkOrderSelect } },
        })
      : Promise.resolve([]),
    correctiveIds.length
      ? prisma.defectCorrectiveAction.findMany({
          where: { id: { in: correctiveIds }, tenantId },
          select: { id: true, defectRecord: { select: defectWorkOrderSelect } },
        })
      : Promise.resolve([]),
    preventionIds.length
      ? prisma.defectRecurrencePrevention.findMany({
          where: { id: { in: preventionIds }, tenantId },
          select: { id: true, defectRecord: { select: defectWorkOrderSelect } },
        })
      : Promise.resolve([]),
    repairIds.length
      ? prisma.equipmentRepairRequest.findMany({
          where: { id: { in: repairIds }, tenantId },
          select: { id: true, requestNo: true, title: true, equipment: { select: { code: true, name: true } } },
        })
      : Promise.resolve([]),
  ])

  for (const row of inspections) {
    map.set(row.id, `${workOrderLabel(row.workOrderOperation.workOrder)} · ${row.stage}`)
  }
  for (const row of defects) {
    map.set(row.id, `${workOrderLabel(row.qualityInspection.workOrderOperation.workOrder)} · [${row.defectCode.code}] ${row.defectCode.name}`)
  }
  for (const row of causes) {
    map.set(row.id, workOrderLabel(row.defectRecord.qualityInspection.workOrderOperation.workOrder))
  }
  for (const row of correctives) {
    map.set(row.id, workOrderLabel(row.defectRecord.qualityInspection.workOrderOperation.workOrder))
  }
  for (const row of preventions) {
    map.set(row.id, workOrderLabel(row.defectRecord.qualityInspection.workOrderOperation.workOrder))
  }
  for (const row of repairs) {
    map.set(row.id, `[${row.requestNo}] ${row.equipment.code}/${row.equipment.name} · ${row.title}`)
  }
  return map
}

export async function assertNoAttachmentsForEntity(
  db: AttachmentCountClient,
  tenantId: string,
  entityType: AttachmentEntityType,
  entityId: string
): Promise<void> {
  const sessionActor = await requireActor()
  assertSessionTenant(sessionActor, tenantId)
  const count = await db.attachment.count({ where: { tenantId, entityType, entityId } })
  if (count > 0) throw new Error(ATTACHMENT_PARENT_DELETE_MESSAGE)
}

export async function assertAttachmentDeleteAllowed(entityType: AttachmentEntityType, entityId: string, tenantId: string): Promise<void> {
  const sessionActor = await requireActor()
  assertSessionTenant(sessionActor, tenantId)
  if (entityType === "QUALITY_INSPECTION") {
    const count = await prisma.defectRecord.count({
      where: { qualityInspectionId: entityId, qualityInspection: { workOrderOperation: { workOrder: { tenantId } } } },
    })
    if (count > 0) throw new Error("불량 이력이 연결된 품질검사 첨부파일은 삭제할 수 없습니다.")
    return
  }

  if (entityType === "DEFECT_RECORD") {
    const [causes, actions, preventions] = await Promise.all([
      prisma.defectCauseAnalysis.count({ where: { defectRecordId: entityId, tenantId } }),
      prisma.defectCorrectiveAction.count({ where: { defectRecordId: entityId, tenantId } }),
      prisma.defectRecurrencePrevention.count({ where: { defectRecordId: entityId, tenantId } }),
    ])
    if (causes + actions + preventions > 0) throw new Error("후속 품질이력이 연결된 불량기록 첨부파일은 삭제할 수 없습니다.")
    return
  }

  if (entityType === "DEFECT_CAUSE_ANALYSIS") {
    const analysis = await prisma.defectCauseAnalysis.findFirst({ where: { id: entityId, tenantId }, select: { defectRecordId: true } })
    if (!analysis) throw new Error("연결 대상(원인분석)을 찾을 수 없습니다.")
    const [actions, preventions] = await Promise.all([
      prisma.defectCorrectiveAction.count({ where: { defectRecordId: analysis.defectRecordId, tenantId } }),
      prisma.defectRecurrencePrevention.count({ where: { defectRecordId: analysis.defectRecordId, tenantId } }),
    ])
    if (actions + preventions > 0) throw new Error("조치/재발방지 이력이 연결된 원인분석 첨부파일은 삭제할 수 없습니다.")
    return
  }

  if (entityType === "DEFECT_CORRECTIVE_ACTION") {
    const action = await prisma.defectCorrectiveAction.findFirst({ where: { id: entityId, tenantId }, select: { status: true } })
    if (!action) throw new Error("연결 대상(조치관리)을 찾을 수 없습니다.")
    if (action.status === "COMPLETED") throw new Error("완료된 조치관리 첨부파일은 삭제할 수 없습니다.")
    return
  }

  if (entityType === "DEFECT_RECURRENCE_PREVENTION") {
    const prevention = await prisma.defectRecurrencePrevention.findFirst({ where: { id: entityId, tenantId }, select: { status: true } })
    if (!prevention) throw new Error("연결 대상(재발방지관리)을 찾을 수 없습니다.")
    if (prevention.status === "COMPLETED") throw new Error("완료된 재발방지관리 첨부파일은 삭제할 수 없습니다.")
    return
  }

  if (entityType === "EQUIPMENT_REPAIR_REQUEST") {
    const repair = await prisma.equipmentRepairRequest.findFirst({ where: { id: entityId, tenantId }, select: { status: true, completedAt: true } })
    if (!repair) throw new Error("연결 대상(설비수리요청)을 찾을 수 없습니다.")
    if (repair.status === "COMPLETED" || repair.status === "CANCELLED" || repair.completedAt) {
      throw new Error("완료 또는 종결된 설비수리요청 첨부파일은 삭제할 수 없습니다.")
    }
  }
}

async function recordAttachmentStorageCleanupFailure(params: {
  tenantId: string
  actor: Pick<CurrentUser, "id" | "name">
  attachment: {
    id: string
    storagePath: string
    fileName: string
  }
  error: string
  auditLogCreate?: (args: Parameters<typeof prisma.auditLog.create>[0]) => Promise<unknown>
}): Promise<void> {
  const auditLogCreate = params.auditLogCreate ?? prisma.auditLog.create.bind(prisma.auditLog)
  try {
    await auditLogCreate({
      data: {
        tenantId: params.tenantId,
        actorId: params.actor.id,
        actorLabel: params.actor.name,
        entityType: "AttachmentStorageCleanup",
        entityId: params.attachment.id,
        action: "UPDATE",
        afterData: {
          storagePath: params.attachment.storagePath,
          fileName: params.attachment.fileName,
          cleanupStatus: "FAILED",
          error: params.error,
        },
        menuName: MENU_NAME,
      },
    })
  } catch (auditError) {
    console.error(
      `[attachment] storage cleanup audit failed after DB delete: ${params.attachment.storagePath}`,
      auditError
    )
  }
}

export type AttachmentFilter = {
  entityType?: AttachmentEntityType
  entityId?: string
  extension?: string
  from?: string
  to?: string
}

export async function getAttachments(filter: AttachmentFilter = {}): Promise<AttachmentRow[]> {
  const actor = await requireRole("VIEWER")
  const tenantId = await getTenantId()
  const snapshot = await getCurrentPermissionSnapshot(actor)

  let readableTypes: AttachmentEntityType[]
  if (filter.entityType) {
    if (!isValidAttachmentEntityType(filter.entityType)) throw new Error("지원하지 않는 업무유형입니다.")
    if (!hasResourcePermission(snapshot, getRequiredAttachmentResource(filter.entityType), "READ")) {
      throw new Error("이 기능을 사용할 권한이 없습니다.")
    }
    if (filter.entityId) await assertAttachmentEntityOwnership(filter.entityType, filter.entityId, tenantId)
    readableTypes = [filter.entityType]
  } else {
    readableTypes = await getReadableAttachmentTypes(actor)
    if (readableTypes.length === 0) return []
  }

  const records = await prisma.attachment.findMany({
    where: {
      tenantId,
      entityType: { in: readableTypes },
      ...(filter.entityId && { entityId: filter.entityId }),
      ...(filter.extension && { fileName: { endsWith: `.${filter.extension}`, mode: "insensitive" } }),
      ...(filter.from && { createdAt: { gte: new Date(`${filter.from}T00:00:00.000`) } }),
      ...(filter.to && { createdAt: { lte: new Date(`${filter.to}T23:59:59.999`) } }),
    },
    select: {
      id: true,
      entityType: true,
      entityId: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      description: true,
      uploadedById: true,
      uploadedBy: { select: { name: true } },
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  })

  const labelMap = await buildEntityLabelMap(tenantId, records)
  return records.map((record) => {
    const row = serializeAttachmentRow(record, labelMap)
    return {
      ...row,
      canDelete: isValidAttachmentEntityType(record.entityType)
        ? hasResourcePermission(snapshot, getRequiredAttachmentResource(record.entityType), "DELETE")
        : false,
    }
  })
}

export async function getAttachmentDownloadUrl(id: string): Promise<{ url: string; fileName: string }> {
  await requireRole("VIEWER")
  const tenantId = await getTenantId()

  const attachment = await prisma.attachment.findFirst({ where: { id, tenantId } })
  if (!attachment) throw new Error("첨부파일을 찾을 수 없습니다.")
  if (!isValidAttachmentEntityType(attachment.entityType)) throw new Error("지원하지 않는 업무유형입니다.")

  await requireAttachmentEntityPermission(attachment.entityType, "READ")
  await assertAttachmentEntityOwnership(attachment.entityType, attachment.entityId, tenantId)

  const url = await createAttachmentSignedUrl(attachment.storagePath, 60)
  return { url, fileName: attachment.fileName }
}

export async function deleteAttachment(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const attachment = await prisma.attachment.findFirst({ where: { id, tenantId } })
    if (!attachment) throw new Error("첨부파일을 찾을 수 없습니다.")
    if (!isValidAttachmentEntityType(attachment.entityType)) throw new Error("지원하지 않는 업무유형입니다.")

    await requireAttachmentEntityPermission(attachment.entityType, "DELETE", actor)
    await assertAttachmentEntityOwnership(attachment.entityType, attachment.entityId, tenantId)
    await assertAttachmentDeleteAllowed(attachment.entityType, attachment.entityId, tenantId)

    await prisma.$transaction(async (tx) => {
      const result = await tx.attachment.deleteMany({ where: { id, tenantId } })
      if (result.count === 0) throw new Error("첨부파일을 찾을 수 없습니다.")
      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "Attachment",
          entityId: id,
          action: "DELETE",
          beforeData: {
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            storagePath: attachment.storagePath,
            entityType: attachment.entityType,
            entityId: attachment.entityId,
          },
          menuName: MENU_NAME,
        },
      })
    })

    const storageResult = await deleteAttachmentFile(attachment.storagePath)
    if (!storageResult.ok) {
      await recordAttachmentStorageCleanupFailure({
        tenantId,
        actor,
        attachment,
        error: storageResult.error ?? "Storage cleanup failed",
      })
    }

    revalidateAttachmentPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}
