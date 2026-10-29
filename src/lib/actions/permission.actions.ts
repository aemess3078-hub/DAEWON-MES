"use server"

import { prisma } from "@/lib/db/prisma"
import { UserRole, PermissionAction } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { getTenantId, getCurrentUser, requireRole } from "@/lib/auth"
import { canAccessFullUserManagement } from "@/lib/developer"
import { recordAuditLog } from "@/lib/audit-log"
import { buildDefaultPermissionRows } from "@/lib/auth/permission-catalog"

async function requireFullUserManagementAccess() {
  const user = await getCurrentUser()
  if (!user) throw new Error('UNAUTHORIZED')
  if (!canAccessFullUserManagement(user)) throw new Error('FORBIDDEN')
  return user
}

export type PermissionRecord = {
  id: string
  tenantId: string
  role: UserRole
  resource: string
  action: PermissionAction
  isAllowed: boolean
}

// ─── 기본 권한 카탈로그 ───────────────────────────────────────────────────────
// 기본값의 유일한 정의는 src/lib/auth/permission-catalog.ts 이다(seed 스크립트와 공용).
// createMany({ skipDuplicates: true }) 로만 저장하므로 이미 저장된 설정은 덮어쓰지 않는다.

async function requireSameTenantPermissionAccess(tenantId: string) {
  const user = await requireRole("VIEWER")
  if (user.tenantId !== tenantId) throw new Error("FORBIDDEN")
  return user
}

// 1. 전체 권한 조회
export async function getPermissions(tenantId: string): Promise<PermissionRecord[]> {
  await requireSameTenantPermissionAccess(tenantId)

  return prisma.rolePermission.findMany({
    where: { tenantId },
    orderBy: [{ resource: "asc" }, { role: "asc" }, { action: "asc" }],
  })
}

// 2. 권한 매트릭스 변환
// 반환: { [resource]: { [role]: { [action]: { id: string, isAllowed: boolean } } } }
export type PermissionMatrix = Record<
  string,
  Partial<Record<UserRole, Partial<Record<PermissionAction, { id: string; isAllowed: boolean }>>>>
>

export async function getPermissionMatrix(tenantId: string): Promise<PermissionMatrix> {
  const permissions = await getPermissions(tenantId)
  const matrix: PermissionMatrix = {}

  for (const perm of permissions) {
    if (!matrix[perm.resource]) matrix[perm.resource] = {}
    if (!matrix[perm.resource][perm.role]) matrix[perm.resource][perm.role] = {}
    const rolePermissions = matrix[perm.resource][perm.role]
    if (!rolePermissions) continue

    rolePermissions[perm.action] = {
      id: perm.id,
      isAllowed: perm.isAllowed,
    }
  }

  return matrix
}

// 2-a. 권한 매트릭스 조회 + 없으면 기본값 자동 삽입 (운영 환경용)
// 업무 더미 데이터 없이 권한 정의만 초기화한다.
export async function ensurePermissionMatrix(tenantId: string): Promise<PermissionMatrix> {
  const user = await requireSameTenantPermissionAccess(tenantId)

  try {
    // skipDuplicates=true로 항상 실행 → 누락 role 행만 추가, 기존 행 유지.
    // count 게이트 없이 실행해야 OWNER/ADMIN만 있고 MANAGER/OPERATOR/VIEWER가
    // 없는 부분 삽입 상태를 자동으로 보정할 수 있다.
    const rows = buildDefaultPermissionRows(user.tenantId)
    await prisma.rolePermission.createMany({ data: rows, skipDuplicates: true })
  } catch (e) {
    // 자동 초기화 실패는 치명적이지 않다. 기존 데이터만이라도 표시한다.
    console.error("[ensurePermissionMatrix] 자동 초기화 실패:", e)
  }

  return getPermissionMatrix(tenantId)
}

// 3. 단건 토글
export async function updatePermission(id: string, isAllowed: boolean) {
  const actor = await requireFullUserManagementAccess()

  // 오너 권한은 수정 불가
  const perm = await prisma.rolePermission.findFirst({ where: { id, tenantId: actor.tenantId } })
  if (!perm) throw new Error("권한 레코드를 찾을 수 없습니다.")
  if (perm.role === "OWNER") throw new Error("OWNER 권한은 수정할 수 없습니다.")

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.update({ where: { id }, data: { isAllowed } })
    await recordAuditLog(tx, {
      tenantId: actor.tenantId,
      actor,
      entityType: "RolePermission",
      entityId: id,
      action: "UPDATE",
      beforeData: {
        role: perm.role,
        resource: perm.resource,
        action: perm.action,
        isAllowed: perm.isAllowed,
      },
      afterData: {
        role: perm.role,
        resource: perm.resource,
        action: perm.action,
        isAllowed,
      },
      menuName: "권한관리",
    })
  })
  revalidatePath("/app/mes/users")
}

// 4. 일괄 업데이트
export async function bulkUpdatePermissions(
  updates: { id: string; isAllowed: boolean }[]
) {
  const actor = await requireFullUserManagementAccess()
  if (updates.length === 0) return

  const ids = updates.map((update) => update.id)
  const permissions = await prisma.rolePermission.findMany({
    where: { id: { in: ids }, tenantId: actor.tenantId },
    select: { id: true, role: true, resource: true, action: true, isAllowed: true },
  })

  if (permissions.length !== new Set(ids).size) {
    throw new Error("권한 레코드를 찾을 수 없습니다.")
  }
  if (permissions.some((perm) => perm.role === "OWNER")) {
    throw new Error("OWNER 권한은 수정할 수 없습니다.")
  }

  const updateMap = new Map(updates.map((update) => [update.id, update.isAllowed]))
  await prisma.$transaction(async (tx) => {
    for (const { id, isAllowed } of updates) {
      await tx.rolePermission.updateMany({
        where: { id, tenantId: actor.tenantId },
        data: { isAllowed },
      })
    }
    await recordAuditLog(tx, {
      tenantId: actor.tenantId,
      actor,
      entityType: "RolePermission",
      entityId: "bulk-update",
      action: "UPDATE",
      beforeData: {
        count: permissions.length,
        permissions: permissions.map((perm) => ({
          id: perm.id,
          role: perm.role,
          resource: perm.resource,
          action: perm.action,
          isAllowed: perm.isAllowed,
        })),
      },
      afterData: {
        count: permissions.length,
        permissions: permissions.map((perm) => ({
          id: perm.id,
          role: perm.role,
          resource: perm.resource,
          action: perm.action,
          isAllowed: updateMap.get(perm.id),
        })),
      },
      menuName: "권한관리",
    })
  })
  revalidatePath("/app/mes/users")
}

// 5. 사용자의 특정 리소스+액션 권한 확인
export async function checkPermission(
  tenantId: string,
  role: UserRole,
  resource: string,
  action: PermissionAction
): Promise<boolean> {
  const user = await getCurrentUser()
  if (!user || user.tenantId !== tenantId) return false
  if (user.role !== role && !canAccessFullUserManagement(user)) return false
  if (role === "OWNER") return true

  const perm = await prisma.rolePermission.findFirst({
    where: { tenantId, role, resource, action },
  })
  return perm?.isAllowed ?? false
}
