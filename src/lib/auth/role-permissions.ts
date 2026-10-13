import { PermissionAction, type UserRole } from "@prisma/client"

import { getCurrentUser, type CurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"

export const ROLE_PERMISSION_DENIED_MESSAGE = "이 기능을 사용할 권한이 없습니다."

const ATTACHMENT_MENU_CODES = new Set(["attachments"])
const ATTACHMENT_READ_RESOURCES = ["QUALITY_INSPECTION", "DEFECT_MANAGEMENT", "EQUIPMENT_REPAIR"] as const

const MENU_CODE_RESOURCE_MAP: Record<string, string> = {
  items: "ITEM",
  "item-categories": "ITEM",
  "item-groups": "ITEM",
  sites: "ITEM",
  locations: "ITEM",
  customers: "PARTNER_MANAGEMENT",
  vendors: "PARTNER_MANAGEMENT",
  bom: "BOM",
  routing: "ROUTING",
  "work-centers": "ROUTING",
  "downtime-reasons": "EQUIPMENT_REPAIR",
  equipment: "EQUIPMENT",
  molds: "EQUIPMENT",
  "equipment-tools": "EQUIPMENT",
  defects: "DEFECT_MANAGEMENT",
  "defect-stats": "DEFECT_MANAGEMENT",
  "cause-analysis": "DEFECT_MANAGEMENT",
  "corrective-action": "DEFECT_MANAGEMENT",
  "recurrence-prevention": "DEFECT_MANAGEMENT",
  "inspection-standards": "INSPECTION_SPEC",
  "work-standards": "WORK_STANDARD",
  "production-plan": "PRODUCTION_PLAN",
  "work-orders": "WORK_ORDER",
  "work-queue": "WORK_ORDER",
  "production-results": "WORK_RESULT",
  "production-progress": "WORK_RESULT",
  rework: "WORK_RESULT",
  "equipment-output": "WORK_RESULT",
  "finished-goods-receipt": "WORK_RESULT",
  inventory: "INVENTORY",
  stock: "INVENTORY",
  "material-receipt": "PURCHASE_ORDER",
  "material-issue": "PURCHASE_ORDER",
  "material-return": "PURCHASE_ORDER",
  "inventory-transactions": "INVENTORY_TXN",
  "wip-inventory": "INVENTORY",
  lot: "LOT",
  "lot-rules": "LOT",
  traceability: "LOT",
  "lot-history": "LOT",
  "manufacturing-traceability": "LOT",
  "common-codes": "COMMON_CODE",
  users: "USER_MANAGEMENT",
  "audit-log": "AUDIT_LOG",
  inspection: "QUALITY_INSPECTION",
  "inspection-stages": "QUALITY_INSPECTION",
  spc: "QUALITY_INSPECTION",
  ecn: "ECN",
  "equipment-repair": "EQUIPMENT_REPAIR",
  "equipment-check": "EQUIPMENT_REPAIR",
  "equipment-problems": "EQUIPMENT_REPAIR",
  "equipment-check-status": "EQUIPMENT_REPAIR",
  "equipment-statistics": "EQUIPMENT_REPAIR",
  "equipment-monitor": "EQUIPMENT_MONITOR",
  status: "EQUIPMENT_MONITOR",
  gateways: "EQUIPMENT_CONNECTION",
  "equipment-connections": "EQUIPMENT_CONNECTION",
  tags: "TAG_MANAGEMENT",
  "sales-orders": "SALES_ORDER",
  "order-status": "SALES_ORDER",
  shipments: "SHIPMENT",
  "delivery-status": "SHIPMENT",
  "purchase-orders": "PURCHASE_ORDER",
  outsourcing: "PURCHASE_ORDER",
  "item-prices": "ITEM_PRICE",
  mrp: "MRP",
  quotations: "QUOTATION",
  costing: "COSTING",
  "project-orders": "PROJECT_ORDER",
  "project-prices": "PROJECT_PRICE",
  "project-progress": "PROJECT_STAGE",
  "project-issues": "PROJECT_ISSUE",
  dashboard: "DASHBOARD",
  kpi: "DASHBOARD",
  "production-daily": "REPORT",
  quality: "REPORT",
  reports: "REPORT",
}

type PermissionSnapshot = {
  user: CurrentUser
  role: UserRole
  allAllowed: boolean
  allowed: Set<string>
  configured: Set<string>
}

export type ResourcePermissionFlags = {
  canRead: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  canApprove: boolean
  canExport: boolean
}

function permissionKey(resource: string, action: PermissionAction) {
  return `${resource}:${action}`
}

function toMenuCode(pathOrCode: string): string {
  const [pathname] = pathOrCode.split("?")
  const parts = pathname.split("/").filter(Boolean)
  return parts.at(-1) ?? pathname
}

export function getPermissionResourceForMenuCode(menuCode: string): string | null {
  return MENU_CODE_RESOURCE_MAP[menuCode] ?? null
}

export function getPermissionResourceForPath(pathname: string): string | null {
  return getPermissionResourceForMenuCode(toMenuCode(pathname))
}

async function getPermissionSnapshotFor(profileId: string, tenantId: string): Promise<PermissionSnapshot | null> {
  const [tenantUser, profile, credential] = await Promise.all([
    prisma.tenantUser.findFirst({
      where: { profileId, tenantId, isActive: true },
      select: { role: true, isActive: true },
    }),
    prisma.profile.findUnique({
      where: { id: profileId },
      select: { id: true, email: true, name: true },
    }),
    prisma.userCredential.findUnique({
      where: { profileId },
      select: { loginId: true, mustChangePw: true, isLocked: true },
    }),
  ])

  if (!tenantUser || !profile || !credential || credential.isLocked) return null

  const user: CurrentUser = {
    id: profileId,
    profileId,
    loginId: credential.loginId,
    email: profile.email,
    name: profile.name,
    tenantId,
    role: tenantUser.role,
    isActive: tenantUser.isActive,
    mustChangePw: credential.mustChangePw,
  }

  if (tenantUser.role === "OWNER") {
    return { user, role: tenantUser.role, allAllowed: true, allowed: new Set(), configured: new Set() }
  }

  const rows = await prisma.rolePermission.findMany({
    where: { tenantId, role: tenantUser.role },
    select: { resource: true, action: true, isAllowed: true },
  })

  return {
    user,
    role: tenantUser.role,
    allAllowed: false,
    allowed: new Set(rows.filter((row) => row.isAllowed).map((row) => permissionKey(row.resource, row.action))),
    configured: new Set(rows.map((row) => permissionKey(row.resource, row.action))),
  }
}

export async function getCurrentPermissionSnapshot(user?: CurrentUser | null): Promise<PermissionSnapshot | null> {
  const currentUser = user ?? (await getCurrentUser())
  if (!currentUser) return null
  return getPermissionSnapshotFor(currentUser.profileId, currentUser.tenantId)
}

export function hasResourcePermission(
  snapshot: PermissionSnapshot | null,
  resource: string,
  action: PermissionAction,
): boolean {
  if (!snapshot) return false
  if (snapshot.allAllowed) return true
  return snapshot.allowed.has(permissionKey(resource, action))
}

export async function hasCurrentUserResourcePermission(
  resource: string,
  action: PermissionAction,
  user?: CurrentUser | null,
): Promise<boolean> {
  const snapshot = await getCurrentPermissionSnapshot(user)
  return hasResourcePermission(snapshot, resource, action)
}

export async function requireResourcePermission(
  resource: string,
  action: PermissionAction,
  user?: CurrentUser | null,
): Promise<CurrentUser> {
  const snapshot = await getCurrentPermissionSnapshot(user)
  if (!snapshot) throw new Error("UNAUTHORIZED")
  if (!hasResourcePermission(snapshot, resource, action)) {
    throw new Error(ROLE_PERMISSION_DENIED_MESSAGE)
  }
  return snapshot.user
}

export async function getResourcePermissions(
  resource: string,
  user?: CurrentUser | null,
): Promise<ResourcePermissionFlags> {
  const snapshot = await getCurrentPermissionSnapshot(user)
  return getResourcePermissionFlags(snapshot, resource)
}

export function getResourcePermissionFlags(
  snapshot: PermissionSnapshot | null,
  resource: string,
): ResourcePermissionFlags {
  return {
    canRead: hasResourcePermission(snapshot, resource, "READ"),
    canCreate: hasResourcePermission(snapshot, resource, "CREATE"),
    canUpdate: hasResourcePermission(snapshot, resource, "UPDATE"),
    canDelete: hasResourcePermission(snapshot, resource, "DELETE"),
    canApprove: hasResourcePermission(snapshot, resource, "APPROVE"),
    canExport: hasResourcePermission(snapshot, resource, "EXPORT"),
  }
}

export function canReadMenuCode(snapshot: PermissionSnapshot | null, menuCode: string): boolean {
  if (ATTACHMENT_MENU_CODES.has(menuCode)) {
    return ATTACHMENT_READ_RESOURCES.some((resource) => hasResourcePermission(snapshot, resource, "READ"))
  }
  const resource = getPermissionResourceForMenuCode(menuCode)
  if (!resource) return true
  if (snapshot && !snapshot.allAllowed && !snapshot.configured.has(permissionKey(resource, "READ"))) return true
  return hasResourcePermission(snapshot, resource, "READ")
}

export function canReadPath(snapshot: PermissionSnapshot | null, pathname: string): boolean {
  const menuCode = toMenuCode(pathname)
  if (ATTACHMENT_MENU_CODES.has(menuCode)) {
    return canReadMenuCode(snapshot, menuCode)
  }
  const resource = getPermissionResourceForPath(pathname)
  if (!resource) return true
  if (snapshot && !snapshot.allAllowed && !snapshot.configured.has(permissionKey(resource, "READ"))) return true
  return hasResourcePermission(snapshot, resource, "READ")
}
