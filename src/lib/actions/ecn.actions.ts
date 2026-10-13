"use server"

import { prisma } from "@/lib/db/prisma"
import { ECNStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { getCurrentUser, requireRole, type CurrentUser } from "@/lib/auth"
import { isMissingDbObjectError } from "@/lib/db/prisma-error"
import { requireResourcePermission } from "@/lib/auth/role-permissions"

export type ECNDetail = {
  id: string
  engineeringChangeId: string
  changeTarget: string
  actionType: string
  beforeValue: any
  afterValue: any
  description: string | null
}

export type ECNWithDetails = {
  id: string
  tenantId: string
  ecnNo: string
  title: string
  reason: string
  changeType: string
  targetItemId: string
  status: ECNStatus
  requestedBy: string
  approvedBy: string | null
  requestedAt: Date
  approvedAt: Date | null
  implementedAt: Date | null
  note: string | null
  createdAt: Date
  updatedAt: Date
  item: { id: string; code: string; name: string; itemType: string }
  requester: { id: string; name: string; email: string }
  approver: { id: string; name: string; email: string } | null
  details: ECNDetail[]
}

const ECN_INCLUDE = {
  item: { select: { id: true, code: true, name: true, itemType: true } },
  requester: { select: { id: true, name: true, email: true } },
  approver: { select: { id: true, name: true, email: true } },
  details: true,
} as const

const MANAGER_ROLES = new Set(["OWNER", "ADMIN", "MANAGER"])
const OPERATOR_DELETE_STATUSES: ECNStatus[] = ["DRAFT", "SUBMITTED", "REVIEWING"]
const OPERATOR_UPDATE_STATUSES: ECNStatus[] = ["DRAFT", "SUBMITTED"]

function isManagerRole(user: CurrentUser) {
  return MANAGER_ROLES.has(user.role)
}

async function requireECNUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error("인증이 필요합니다.")
  return user
}

function assertSameTenant(ecn: { tenantId: string }, user: CurrentUser) {
  if (ecn.tenantId !== user.tenantId) {
    throw new Error("권한이 없습니다.")
  }
}

function assertOwner(ecn: { requestedBy: string }, user: CurrentUser, message: string) {
  if (ecn.requestedBy !== user.profileId) {
    throw new Error(message)
  }
}

async function generateECNNo(tenantId: string): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `ECN-${year}-`
  const last = await prisma.engineeringChange.findFirst({
    where: { tenantId, ecnNo: { startsWith: prefix } },
    orderBy: { ecnNo: "desc" },
    select: { ecnNo: true },
  })
  const seq = last ? (parseInt(last.ecnNo.split("-")[2] ?? "0", 10) || 0) + 1 : 1
  return `${prefix}${String(seq).padStart(3, "0")}`
}

/**
 * 변경관리 목록 조회
 * - ADMIN/MANAGER/OWNER: 같은 tenant의 전체 ECN 조회
 * - OPERATOR/VIEWER: 본인이 요청한 ECN만 조회
 */
export async function getECNs(
  tenantId: string,
  profileId: string,
  isAdmin: boolean,
): Promise<ECNWithDetails[]> {
  try {
    const results = await prisma.engineeringChange.findMany({
      where: {
        tenantId,
        ...(isAdmin ? {} : { requestedBy: profileId }),
      },
      include: ECN_INCLUDE,
      orderBy: { createdAt: "desc" },
    })
    return results as any
  } catch (error) {
    if (isMissingDbObjectError(error)) return []
    throw error
  }
}

export async function getECNById(id: string): Promise<ECNWithDetails | null> {
  const result = await prisma.engineeringChange.findUnique({
    where: { id },
    include: ECN_INCLUDE,
  })
  return result as any
}

export async function getItemsForECN(tenantId: string) {
  try {
    return await prisma.item.findMany({
      where: { tenantId, itemType: { in: ["FINISHED", "SEMI_FINISHED"] }, status: "ACTIVE" },
      select: { id: true, code: true, name: true, itemType: true },
      orderBy: { name: "asc" },
    })
  } catch (error) {
    if (isMissingDbObjectError(error)) return []
    throw error
  }
}

export async function getCurrentBOM(itemId: string) {
  return prisma.bOM.findFirst({
    where: { itemId, status: "ACTIVE" },
    include: {
      bomItems: {
        include: { componentItem: { select: { id: true, code: true, name: true, uom: true } } },
        orderBy: { seq: "asc" },
      },
    },
  })
}

export async function getCurrentRouting(itemId: string) {
  const itemRouting = await prisma.itemRouting.findFirst({
    where: {
      itemId,
      isDefault: true,
      routing: { status: "ACTIVE" },
    },
    include: {
      routing: {
        include: {
          operations: {
            include: { workCenter: { select: { id: true, code: true, name: true } } },
            orderBy: { seq: "asc" },
          },
        },
      },
    },
  })
  return itemRouting?.routing ?? null
}

export type ECNDetailInput = {
  changeTarget: string
  actionType: string
  beforeValue?: any
  afterValue?: any
  description?: string
}

export type CreateECNInput = {
  title: string
  reason: string
  changeType: string
  targetItemId: string
  note?: string
  details: ECNDetailInput[]
}

export async function createECN(data: CreateECNInput, tenantId: string, requestedBy: string) {
  await requireResourcePermission("ECN", "CREATE")
  const user = await requireRole("OPERATOR")
  if (tenantId !== user.tenantId || requestedBy !== user.profileId) {
    throw new Error("권한이 없습니다.")
  }

  const ecnNo = await generateECNNo(tenantId)
  await prisma.engineeringChange.create({
    data: {
      tenantId,
      ecnNo,
      title: data.title,
      reason: data.reason,
      changeType: data.changeType,
      targetItemId: data.targetItemId,
      status: "DRAFT",
      requestedBy,
      note: data.note,
      details: {
        create: data.details.map((d) => ({
          changeTarget: d.changeTarget,
          actionType: d.actionType,
          beforeValue: d.beforeValue,
          afterValue: d.afterValue,
          description: d.description,
        })),
      },
    },
  })
  revalidatePath("/app/mes/ecn")
}

export async function updateECN(id: string, data: CreateECNInput) {
  await requireResourcePermission("ECN", "UPDATE")
  const user = await requireECNUser()
  const current = await prisma.engineeringChange.findUniqueOrThrow({ where: { id } })
  assertSameTenant(current, user)

  if (!isManagerRole(user)) {
    if (user.role === "VIEWER") throw new Error("권한이 없습니다.")
    assertOwner(current, user, "본인이 작성한 변경요청만 수정할 수 있습니다.")
    if (!OPERATOR_UPDATE_STATUSES.includes(current.status)) {
      throw new Error("이미 처리된 변경요청은 수정할 수 없습니다.")
    }
  }

  await prisma.$transaction([
    prisma.engineeringChangeDetail.deleteMany({ where: { engineeringChangeId: id } }),
    prisma.engineeringChange.update({
      where: { id },
      data: {
        title: data.title,
        reason: data.reason,
        changeType: data.changeType,
        targetItemId: data.targetItemId,
        note: data.note,
        details: {
          create: data.details.map((d) => ({
            changeTarget: d.changeTarget,
            actionType: d.actionType,
            beforeValue: d.beforeValue,
            afterValue: d.afterValue,
            description: d.description,
          })),
        },
      },
    }),
  ])
  revalidatePath("/app/mes/ecn")
}

export async function deleteECN(id: string) {
  await requireResourcePermission("ECN", "DELETE")
  const user = await requireECNUser()
  const current = await prisma.engineeringChange.findUniqueOrThrow({ where: { id } })
  assertSameTenant(current, user)

  if (!isManagerRole(user)) {
    if (user.role === "VIEWER") throw new Error("권한이 없습니다.")
    assertOwner(current, user, "본인이 작성한 변경요청만 삭제할 수 있습니다.")
    if (!OPERATOR_DELETE_STATUSES.includes(current.status)) {
      throw new Error("이미 처리된 변경요청은 삭제할 수 없습니다.")
    }
  }

  await prisma.$transaction([
    prisma.engineeringChangeDetail.deleteMany({ where: { engineeringChangeId: id } }),
    prisma.engineeringChange.delete({ where: { id } }),
  ])
  revalidatePath("/app/mes/ecn")
}

export async function submitECN(id: string) {
  await requireResourcePermission("ECN", "UPDATE")
  const user = await requireECNUser()
  const current = await prisma.engineeringChange.findUniqueOrThrow({ where: { id } })
  assertSameTenant(current, user)

  if (!isManagerRole(user)) {
    if (user.role === "VIEWER") throw new Error("권한이 없습니다.")
    assertOwner(current, user, "본인이 작성한 변경요청만 제출할 수 있습니다.")
  }
  if (current.status !== "DRAFT") {
    throw new Error("이미 제출 또는 처리된 변경요청은 다시 제출할 수 없습니다.")
  }

  await prisma.engineeringChange.update({
    where: { id },
    data: { status: "SUBMITTED" },
  })
  revalidatePath("/app/mes/ecn")
}

export async function approveECN(id: string, approvedBy: string) {
  await requireResourcePermission("ECN", "APPROVE")
  void approvedBy
  const user = await requireRole("MANAGER")
  const current = await prisma.engineeringChange.findUniqueOrThrow({ where: { id } })
  assertSameTenant(current, user)

  if (!["SUBMITTED", "REVIEWING"].includes(current.status)) {
    throw new Error("제출 또는 검토 상태의 변경요청만 승인할 수 있습니다.")
  }
  await prisma.engineeringChange.update({
    where: { id },
    data: { status: "APPROVED", approvedBy: user.profileId, approvedAt: new Date() },
  })
  revalidatePath("/app/mes/ecn")
}

export async function rejectECN(id: string, approvedBy: string) {
  await requireResourcePermission("ECN", "APPROVE")
  void approvedBy
  const user = await requireRole("MANAGER")
  const current = await prisma.engineeringChange.findUniqueOrThrow({ where: { id } })
  assertSameTenant(current, user)

  if (!["SUBMITTED", "REVIEWING"].includes(current.status)) {
    throw new Error("제출 또는 검토 상태의 변경요청만 반려할 수 있습니다.")
  }
  await prisma.engineeringChange.update({
    where: { id },
    data: { status: "REJECTED", approvedBy: user.profileId, approvedAt: new Date() },
  })
  revalidatePath("/app/mes/ecn")
}

export async function implementECN(id: string) {
  await requireResourcePermission("ECN", "UPDATE")
  const user = await requireRole("ADMIN")
  const current = await prisma.engineeringChange.findUniqueOrThrow({ where: { id } })
  assertSameTenant(current, user)
  await implementECNLegacy(id)
}

async function implementECNLegacy(id: string) {
  await requireRole("ADMIN")
  const ecn = await prisma.engineeringChange.findUniqueOrThrow({
    where: { id },
    include: { details: true },
  })
  if (ecn.status !== "APPROVED") {
    throw new Error("승인(APPROVED) 상태의 ECN만 적용할 수 있습니다")
  }

  await prisma.$transaction(async (tx) => {
    if (ecn.changeType === "BOM" || ecn.changeType === "BOTH") {
      const currentBOM = await tx.bOM.findFirst({
        where: { itemId: ecn.targetItemId, status: "ACTIVE" },
        include: { bomItems: true },
      })
      if (currentBOM) {
        await tx.bOM.update({ where: { id: currentBOM.id }, data: { status: "INACTIVE" } })
        const versionNum = parseFloat(currentBOM.version) || 1
        const newVersion = (versionNum + 1).toFixed(1)

        const afterValueDetails = ecn.details.filter(
          (d) => d.changeTarget === "BOM_ITEM" && d.afterValue
        )
        let newBomItems: any[]
        if (afterValueDetails.length > 0) {
          newBomItems = afterValueDetails.map((d: any, idx: number) => ({
            componentItemId: d.afterValue.componentItemId ?? currentBOM.bomItems[idx]?.componentItemId,
            seq: d.afterValue.seq ?? idx + 1,
            qtyPer: d.afterValue.qtyPer ?? 1,
            scrapRate: d.afterValue.scrapRate ?? 0,
          }))
        } else {
          newBomItems = currentBOM.bomItems.map((bi) => ({
            componentItemId: bi.componentItemId,
            seq: bi.seq,
            qtyPer: bi.qtyPer,
            scrapRate: bi.scrapRate,
          }))
        }

        await tx.bOM.create({
          data: {
            tenantId: ecn.tenantId,
            itemId: ecn.targetItemId,
            version: newVersion,
            isDefault: true,
            status: "ACTIVE",
            bomItems: { create: newBomItems },
          },
        })
      }
    }

    if (ecn.changeType === "ROUTING" || ecn.changeType === "BOTH") {
      const currentItemRouting = await tx.itemRouting.findFirst({
        where: {
          itemId: ecn.targetItemId,
          isDefault: true,
          routing: { status: "ACTIVE" },
        },
        include: { routing: { include: { operations: true } } },
      })
      if (currentItemRouting) {
        const currentRouting = currentItemRouting.routing
        await tx.routing.update({ where: { id: currentRouting.id }, data: { status: "INACTIVE" } })
        const versionNum = parseFloat(currentRouting.version) || 1
        const newVersion = (versionNum + 1).toFixed(1)

        const newOps = currentRouting.operations.map((op) => ({
          seq: op.seq,
          operationCode: op.operationCode,
          name: op.name,
          workCenterId: op.workCenterId,
          standardTime: op.standardTime,
        }))

        const newRouting = await tx.routing.create({
          data: {
            tenantId: ecn.tenantId,
            code: currentRouting.code + '-V' + newVersion.replace('.', ''),
            name: currentRouting.name,
            version: newVersion,
            status: "ACTIVE",
            operations: { create: newOps },
          },
        })

        // 기존 ItemRouting 비활성화 후 신규 ItemRouting 생성
        await tx.itemRouting.update({
          where: { id: currentItemRouting.id },
          data: { isDefault: false },
        })
        await tx.itemRouting.create({
          data: {
            tenantId: ecn.tenantId,
            itemId: ecn.targetItemId,
            routingId: newRouting.id,
            isDefault: true,
          },
        })
      }
    }

    await tx.engineeringChange.update({
      where: { id },
      data: { status: "IMPLEMENTED", implementedAt: new Date() },
    })

    // AuditLog: 실제 스키마 필드명 사용
    // actorId, entityType, entityId, action(AuditAction enum), afterData
    await tx.auditLog.create({
      data: {
        tenantId: ecn.tenantId,
        actorId: ecn.requestedBy,
        actorType: "USER",
        entityType: "EngineeringChange",
        entityId: id,
        action: "UPDATE",
        afterData: { ecnNo: ecn.ecnNo, changeType: ecn.changeType, status: "IMPLEMENTED" },
        menuName: "변경관리(ECN)",
      },
    })
  })

  revalidatePath("/app/mes/ecn")
}
