"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId, requireRole } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { checkDowntimeReasonReferencesForBulk } from "./reference-check.server"
import { assertDeveloperOnly } from "@/lib/auth/daewon-scope.server"

const DOWNTIME_REASON_GROUP_CODE = "DOWNTIME_REASON"

// 타입 정의
export type CodeGroupWithCodes = {
  id: string
  tenantId: string
  groupCode: string
  groupName: string
  description: string | null
  isSystem: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  codes: {
    id: string
    groupId: string
    code: string
    name: string
    description: string | null
    displayOrder: number
    isActive: boolean
    extra: unknown
    createdAt: Date
    updatedAt: Date
  }[]
}

async function getOwnedCodeGroup(id: string, tenantId: string) {
  return prisma.codeGroup.findFirst({
    where: { id, tenantId },
    include: { codes: { orderBy: { displayOrder: "asc" } } },
  })
}

async function getOwnedCommonCode(id: string, tenantId: string) {
  return prisma.commonCode.findFirst({
    where: { id, group: { tenantId } },
    include: { group: { select: { groupCode: true, tenantId: true } } },
  })
}

async function assertDowntimeReasonDeleteAllowed(codeId: string) {
  const reference = await checkDowntimeReasonReferencesForBulk(codeId)
  if (!reference.canDelete) {
    throw new Error(`사용 이력이 있어 삭제할 수 없습니다: ${reference.reasons.join(", ")}`)
  }
}

async function assertDowntimeReasonIdentityChangeAllowed(
  current: { id: string; code: string; name: string; group: { groupCode: string } },
  data: { code?: string; name?: string }
) {
  if (current.group.groupCode !== DOWNTIME_REASON_GROUP_CODE) return
  const codeChanged = data.code !== undefined && data.code !== current.code
  const nameChanged = data.name !== undefined && data.name !== current.name
  if (!codeChanged && !nameChanged) return

  const reference = await checkDowntimeReasonReferencesForBulk(current.id)
  if (!reference.canDelete) {
    throw new Error(`비가동 이력에서 사용 중인 사유의 코드/명칭은 변경할 수 없습니다: ${reference.reasons.join(", ")}`)
  }
}

// 1. 전체 CodeGroup + codes 조회
export async function getCodeGroups(): Promise<CodeGroupWithCodes[]> {
  await assertDeveloperOnly()
  const tenantId = await getTenantId()
  return prisma.codeGroup.findMany({
    where: { tenantId },
    include: { codes: { orderBy: { displayOrder: "asc" } } },
    orderBy: { groupCode: "asc" },
  })
}

// 2. 단건 조회
export async function getCodeGroupById(id: string): Promise<CodeGroupWithCodes | null> {
  await assertDeveloperOnly()
  const tenantId = await getTenantId()
  return getOwnedCodeGroup(id, tenantId)
}

// CodeGroup 입력 타입
export type CreateCodeGroupInput = {
  groupCode: string
  groupName: string
  description?: string | null
  isActive?: boolean
}

// 3. 그룹 생성
export async function createCodeGroup(data: CreateCodeGroupInput, tenantId: string) {
  await assertDeveloperOnly()
  await requireResourcePermission("COMMON_CODE", "CREATE")
  const actor = await requireRole("OPERATOR")
  if (actor.tenantId !== tenantId) throw new Error("FORBIDDEN")
  const created = await prisma.codeGroup.create({
    data: { ...data, tenantId },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "CodeGroup",
      entityId: created.id,
      action: "CREATE",
      afterData: { groupCode: created.groupCode, groupName: created.groupName },
      menuName: "코드관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/common-codes")
}

// 4. 그룹 수정
export async function updateCodeGroup(id: string, data: Partial<CreateCodeGroupInput>) {
  await assertDeveloperOnly()
  await requireResourcePermission("COMMON_CODE", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await getOwnedCodeGroup(id, tenantId)
  if (!owned) throw new Error("NOT_FOUND")
  await prisma.codeGroup.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "CodeGroup",
      entityId: id,
      action: "UPDATE",
      beforeData: { groupCode: owned.groupCode, groupName: owned.groupName, isActive: owned.isActive },
      afterData: { groupCode: data.groupCode ?? owned.groupCode, groupName: data.groupName ?? owned.groupName, isActive: data.isActive ?? owned.isActive },
      menuName: "코드관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/common-codes")
}

// 5. 그룹 삭제 (isSystem=true면 불가)
export async function deleteCodeGroup(id: string) {
  await assertDeveloperOnly()
  await requireResourcePermission("COMMON_CODE", "DELETE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const group = await getOwnedCodeGroup(id, tenantId)
  if (!group) throw new Error("NOT_FOUND")
  if (group.isSystem) throw new Error("시스템 코드 그룹은 삭제할 수 없습니다")
  if (group.groupCode === DOWNTIME_REASON_GROUP_CODE) {
    for (const code of group.codes) {
      await assertDowntimeReasonDeleteAllowed(code.id)
    }
  }
  await prisma.commonCode.deleteMany({ where: { groupId: id, group: { tenantId } } })
  await prisma.codeGroup.deleteMany({ where: { id, tenantId } })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "CodeGroup",
      entityId: id,
      action: "DELETE",
      beforeData: { groupCode: group.groupCode, groupName: group.groupName },
      menuName: "코드관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/common-codes")
}

// CommonCode 입력 타입
export type CreateCommonCodeInput = {
  groupId: string
  code: string
  name: string
  description?: string | null
  displayOrder?: number
  isActive?: boolean
  extra?: import("@prisma/client").Prisma.NullableJsonNullValueInput | import("@prisma/client").Prisma.InputJsonValue
}

// 6. 코드 생성
export async function createCommonCode(data: CreateCommonCodeInput) {
  await assertDeveloperOnly()
  await requireResourcePermission("COMMON_CODE", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const group = await prisma.codeGroup.findFirst({ where: { id: data.groupId, tenantId } })
  if (!group) throw new Error("NOT_FOUND")
  const created = await prisma.commonCode.create({ data })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "CommonCode",
      entityId: created.id,
      action: "CREATE",
      afterData: { code: created.code, name: created.name, groupId: created.groupId },
      menuName: "코드관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/common-codes")
}

// 7. 코드 수정
export async function updateCommonCode(
  id: string,
  data: Partial<Omit<CreateCommonCodeInput, "groupId">>
) {
  await assertDeveloperOnly()
  await requireResourcePermission("COMMON_CODE", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await getOwnedCommonCode(id, tenantId)
  if (!owned) throw new Error("NOT_FOUND")
  await assertDowntimeReasonIdentityChangeAllowed(owned, data)
  await prisma.commonCode.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "CommonCode",
      entityId: id,
      action: "UPDATE",
      beforeData: { code: owned.code, name: owned.name, isActive: owned.isActive },
      afterData: { code: data.code ?? owned.code, name: data.name ?? owned.name, isActive: data.isActive ?? owned.isActive },
      menuName: "코드관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/common-codes")
}

// 8. 코드 삭제
export async function deleteCommonCode(id: string) {
  await assertDeveloperOnly()
  await requireResourcePermission("COMMON_CODE", "DELETE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await getOwnedCommonCode(id, tenantId)
  if (!owned) throw new Error("NOT_FOUND")
  if (owned.group.groupCode === DOWNTIME_REASON_GROUP_CODE) {
    await assertDowntimeReasonDeleteAllowed(id)
  }
  await prisma.commonCode.deleteMany({ where: { id, group: { tenantId } } })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "CommonCode",
      entityId: id,
      action: "DELETE",
      beforeData: { code: owned.code, name: owned.name, groupId: owned.groupId },
      menuName: "코드관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/common-codes")
}

// 9. 코드 활성/비활성 토글
export async function toggleCodeActive(id: string, isActive: boolean) {
  await assertDeveloperOnly()
  await requireResourcePermission("COMMON_CODE", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await getOwnedCommonCode(id, tenantId)
  if (!owned) throw new Error("NOT_FOUND")
  await prisma.commonCode.update({ where: { id }, data: { isActive } })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "CommonCode",
      entityId: id,
      action: "UPDATE",
      beforeData: { code: owned.code, name: owned.name, isActive: owned.isActive },
      afterData: { code: owned.code, name: owned.name, isActive },
      menuName: "코드관리",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/common-codes")
}
