"use server"

import { prisma } from "@/lib/db/prisma"
import { UserRole, PermissionAction } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { getTenantId, getCurrentUser, requireRole } from "@/lib/auth"
import { canAccessFullUserManagement } from "@/lib/developer"
import { recordAuditLog } from "@/lib/audit-log"

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
// nav-config.ts 실제 메뉴 기준으로 리소스를 관리한다.
// DB의 resource 코드와 화면 표시 label은 permission-matrix.tsx에서 분리한다.
// skipDuplicates 사용으로 기존 데이터 충돌 없이 신규 리소스만 추가된다.

const ALL_ACTIONS: PermissionAction[] = ["READ", "CREATE", "UPDATE", "DELETE", "APPROVE", "EXPORT"]

// 실제 메뉴 기준 전체 리소스 목록
const ALL_RESOURCES = [
  // 기준정보관리
  "ITEM", "BOM", "ROUTING", "EQUIPMENT", "INSPECTION_SPEC", "WORK_STANDARD", "PARTNER_MANAGEMENT",
  // 생산관리
  "PRODUCTION_PLAN", "WORK_ORDER", "WORK_RESULT",
  "SALES_ORDER", "SHIPMENT", "QUOTATION", "COSTING",
  "PROJECT_ORDER", "PROJECT_PRICE", "PROJECT_STAGE", "PROJECT_ISSUE",
  // 재고관리
  "INVENTORY", "INVENTORY_TXN", "PURCHASE_ORDER", "ITEM_PRICE", "MRP",
  // 품질관리
  "QUALITY_INSPECTION", "DEFECT_MANAGEMENT", "ECN",
  // 설비점검/수리
  "EQUIPMENT_REPAIR", "EQUIPMENT_MONITOR", "EQUIPMENT_CONNECTION", "TAG_MANAGEMENT",
  // 시스템/추적성
  "LOT", "COMMON_CODE", "AUDIT_LOG", "DASHBOARD", "REPORT",
  // 사용자관리
  "USER_MANAGEMENT",
  // 기존 호환 (DB에 이미 존재)
  "APPROVAL",
]

const MANAGER_PERMS: Record<string, PermissionAction[]> = {
  ITEM:               ["READ", "CREATE", "UPDATE"],
  BOM:                ["READ", "CREATE", "UPDATE"],
  ROUTING:            ["READ", "CREATE", "UPDATE"],
  EQUIPMENT:          ["READ", "CREATE", "UPDATE"],
  INSPECTION_SPEC:    ["READ", "CREATE", "UPDATE"],
  WORK_STANDARD:      ["READ", "CREATE", "UPDATE"],
  PARTNER_MANAGEMENT: ["READ", "CREATE", "UPDATE"],
  PRODUCTION_PLAN:    ["READ", "CREATE", "UPDATE"],
  WORK_ORDER:         ["READ", "CREATE", "UPDATE"],
  WORK_RESULT:        ["READ", "CREATE", "UPDATE", "EXPORT"],
  SALES_ORDER:        ["READ", "CREATE", "UPDATE", "DELETE"],
  SHIPMENT:           ["READ", "CREATE", "UPDATE", "DELETE"],
  QUOTATION:          ["READ", "CREATE", "UPDATE", "DELETE"],
  COSTING:            ["READ", "CREATE", "EXPORT"],
  INVENTORY:          ["READ", "CREATE", "UPDATE"],
  INVENTORY_TXN:      ["READ", "EXPORT"],
  PURCHASE_ORDER:     ["READ", "CREATE", "UPDATE"],
  ITEM_PRICE:         ["READ", "CREATE", "UPDATE"],
  MRP:                ["READ", "CREATE", "UPDATE"],
  PROJECT_ORDER:      ["READ", "CREATE", "UPDATE"],
  PROJECT_PRICE:      ["READ", "CREATE", "UPDATE"],
  PROJECT_STAGE:      ["READ", "CREATE", "UPDATE"],
  PROJECT_ISSUE:      ["READ", "CREATE", "UPDATE"],
  QUALITY_INSPECTION: ["READ", "CREATE", "UPDATE", "APPROVE"],
  DEFECT_MANAGEMENT:  ["READ", "CREATE", "UPDATE"],
  ECN:                ["READ", "CREATE", "UPDATE", "APPROVE"],
  EQUIPMENT_REPAIR:   ["READ", "CREATE", "UPDATE", "APPROVE"],
  EQUIPMENT_MONITOR:  ["READ"],
  EQUIPMENT_CONNECTION: ["READ", "CREATE", "UPDATE"],
  TAG_MANAGEMENT:     ["READ", "CREATE", "UPDATE"],
  LOT:                ["READ", "CREATE", "UPDATE"],
  COMMON_CODE:        ["READ"],
  DASHBOARD:          ["READ"],
  AUDIT_LOG:          ["READ"],
  USER_MANAGEMENT:    ["READ"],
  APPROVAL:           ["READ", "CREATE", "APPROVE"],
  REPORT:             ["READ", "EXPORT"],
}

const OPERATOR_PERMS: Record<string, PermissionAction[]> = {
  ITEM:               ["READ"],
  BOM:                ["READ"],
  ROUTING:            ["READ"],
  EQUIPMENT:          ["READ"],
  INSPECTION_SPEC:    ["READ"],
  WORK_STANDARD:      ["READ"],
  PARTNER_MANAGEMENT: ["READ"],
  PRODUCTION_PLAN:    ["READ"],
  WORK_ORDER:         ["READ", "UPDATE"],
  WORK_RESULT:        ["READ", "CREATE"],
  SALES_ORDER:        ["READ", "CREATE", "UPDATE"],
  SHIPMENT:           ["READ", "CREATE", "UPDATE"],
  QUOTATION:          ["READ", "CREATE", "UPDATE"],
  COSTING:            ["READ", "CREATE"],
  INVENTORY:          ["READ", "CREATE", "UPDATE"],
  INVENTORY_TXN:      ["READ"],
  PURCHASE_ORDER:     ["READ", "CREATE"],
  ITEM_PRICE:         ["READ"],
  MRP:                ["READ"],
  PROJECT_ORDER:      ["READ", "CREATE"],
  PROJECT_PRICE:      ["READ"],
  PROJECT_STAGE:      ["READ", "CREATE", "UPDATE"],
  PROJECT_ISSUE:      ["READ", "CREATE", "UPDATE"],
  QUALITY_INSPECTION: ["READ", "CREATE"],
  DEFECT_MANAGEMENT:  ["READ", "CREATE"],
  ECN:                ["READ", "CREATE"],
  EQUIPMENT_REPAIR:   ["READ", "CREATE"],
  EQUIPMENT_MONITOR:  ["READ"],
  EQUIPMENT_CONNECTION: ["READ"],
  TAG_MANAGEMENT:     ["READ"],
  LOT:                ["READ"],
  COMMON_CODE:        ["READ"],
  DASHBOARD:          ["READ"],
  APPROVAL:           ["READ", "CREATE"],
  REPORT:             ["READ"],
}

const VIEWER_RESOURCES = [
  "ITEM", "BOM", "ROUTING", "EQUIPMENT", "INSPECTION_SPEC", "WORK_STANDARD",
  "PARTNER_MANAGEMENT",
  "PRODUCTION_PLAN", "WORK_ORDER", "WORK_RESULT",
  "SALES_ORDER", "SHIPMENT", "QUOTATION", "COSTING",
  "PROJECT_ORDER", "PROJECT_PRICE", "PROJECT_STAGE", "PROJECT_ISSUE",
  "INVENTORY", "INVENTORY_TXN", "PURCHASE_ORDER", "ITEM_PRICE", "MRP",
  "QUALITY_INSPECTION", "DEFECT_MANAGEMENT", "ECN",
  "EQUIPMENT_REPAIR", "LOT",
  "EQUIPMENT_MONITOR", "DASHBOARD",
  "APPROVAL", "REPORT",
]

async function requireSameTenantPermissionAccess(tenantId: string) {
  const user = await requireRole("VIEWER")
  if (user.tenantId !== tenantId) throw new Error("FORBIDDEN")
  return user
}

function buildDefaultPermissionRows(tenantId: string) {
  type PermRow = { tenantId: string; role: UserRole; resource: string; action: PermissionAction; isAllowed: boolean }
  const rows: PermRow[] = []

  for (const role of ["OWNER", "ADMIN"] as UserRole[]) {
    for (const resource of ALL_RESOURCES) {
      for (const action of ALL_ACTIONS) {
        rows.push({ tenantId, role, resource, action, isAllowed: true })
      }
    }
  }

  for (const [resource, actions] of Object.entries(MANAGER_PERMS)) {
    for (const action of actions) {
      rows.push({ tenantId, role: "MANAGER", resource, action, isAllowed: true })
    }
  }

  for (const [resource, actions] of Object.entries(OPERATOR_PERMS)) {
    for (const action of actions) {
      rows.push({ tenantId, role: "OPERATOR", resource, action, isAllowed: true })
    }
  }

  for (const resource of VIEWER_RESOURCES) {
    rows.push({ tenantId, role: "VIEWER", resource, action: "READ", isAllowed: true })
  }

  return rows
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
