"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId, getCurrentUser, requireRole } from "@/lib/auth"
import { canAccessFullUserManagement, DEVELOPER_LOGIN_ID } from "@/lib/developer"
import { hashPassword, validatePassword, verifyPassword } from "@/lib/password"
import {
  assertValidPopPin,
  createPopPinFingerprint,
  preparePopPinForStorage,
} from "@/lib/auth/pop-pin"
import { UserRole, type AuditAction, type LoginEventType, type LoginFailReason, type Prisma } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { getErrorMessage } from "@/lib/utils"
import { requireResourcePermission } from "@/lib/auth/role-permissions"

async function requireFullUserManagementAccess() {
  const user = await getCurrentUser()
  if (!user) throw new Error('UNAUTHORIZED')
  if (!canAccessFullUserManagement(user)) throw new Error('FORBIDDEN')
  return user
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type TenantUserRow = {
  id: string           // TenantUser.id
  profileId: string    // Profile.id (= Supabase auth UUID)
  email: string
  name: string
  department: string | null
  jobTitle: string | null
  phone: string | null
  loginId: string | null
  role: UserRole
  isActive: boolean
  createdAt: Date
}

function isDemoSeedEmail(email: string) {
  return email.toLowerCase().endsWith("@demo-mes.internal")
}

// ─── 사용자 목록 조회 (DB 기준: profiles + TenantUser) ───────────────────────

export async function getTenantUsers(): Promise<TenantUserRow[]> {
  const tenantId = await getTenantId()
  await requireRole("VIEWER")

  // DB의 TenantUser + Profile 기준으로 조회 (Auth API 의존 제거)
  const tenantUsers = await prisma.tenantUser.findMany({
    where: { tenantId },
    include: {
      profile: {
        select: {
          id: true, email: true, name: true,
          department: true, phone: true, jobTitle: true,
          createdAt: true,
          userCredential: { select: { loginId: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  })

  // seed/demo 계정 및 유지보수용 개발자 계정 필터링 (로그인은 가능하나 고객사 목록에서 제외)
  const result: TenantUserRow[] = tenantUsers
    .filter((tu) => !isDemoSeedEmail(tu.profile.email))
    .filter((tu) => tu.profile.userCredential?.loginId !== DEVELOPER_LOGIN_ID)
    .map((tu) => ({
      id: tu.id,
      profileId: tu.profileId,
      email: tu.profile.email,
      name: tu.profile.name || tu.profile.email.split("@")[0] || "",
      department: tu.profile.department ?? null,
      jobTitle: tu.profile.jobTitle ?? null,
      phone: tu.profile.phone ?? null,
      loginId: tu.profile.userCredential?.loginId ?? null,
      role: tu.role,
      isActive: tu.isActive,
      createdAt: tu.createdAt,
    }))

  return result
}

// ─── 역할 변경 ────────────────────────────────────────────────────────────────

export async function updateUserRole(
  tenantUserId: string,
  newRole: UserRole
): Promise<{ success: boolean; error?: string }> {
  await requireResourcePermission("USER_MANAGEMENT", "UPDATE")
  try {
    const tenantId = await getTenantId()
    const actor = await requireRole("ADMIN")

    const tenantUser = await prisma.tenantUser.findFirst({
      where: { id: tenantUserId, tenantId },
      include: { profile: true },
    })
    if (!tenantUser) return { success: false, error: "사용자를 찾을 수 없습니다." }
    if (isDemoSeedEmail(tenantUser.profile.email)) {
      return { success: false, error: "Seed/demo 계정은 운영 UI에서 관리할 수 없습니다." }
    }

    // OWNER 계정은 OWNER/유지보수 계정만 변경할 수 있다(ADMIN 이 상위 역할 계정을 변경하지 못하도록).
    if (tenantUser.role === "OWNER" && !canAccessFullUserManagement(actor)) {
      return { success: false, error: "OWNER 계정은 OWNER 또는 유지보수 계정만 변경할 수 있습니다." }
    }
    if (tenantUser.profileId === actor.id && actor.role !== "OWNER") {
      return { success: false, error: "본인의 역할은 변경할 수 없습니다." }
    }
    // OWNER 부여 가능: 현재 OWNER 또는 내부 유지보수 계정(loginId='test').
    // 일반 ADMIN/MANAGER/OPERATOR/VIEWER는 OWNER 부여 불가.
    if (newRole === "OWNER" && !canAccessFullUserManagement(actor)) {
      return { success: false, error: "OWNER 역할 부여는 OWNER 또는 유지보수 계정만 가능합니다." }
    }
    if (tenantUser.role === "OWNER") {
      const ownerCount = await prisma.tenantUser.count({
        where: { tenantId, role: "OWNER", isActive: true },
      })
      if (ownerCount <= 1 && newRole !== "OWNER") {
        return { success: false, error: "마지막 OWNER의 역할은 변경할 수 없습니다." }
      }
    }

    const beforeRole = tenantUser.role
    await prisma.tenantUser.update({ where: { id: tenantUserId }, data: { role: newRole } })

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        entityType: "TenantUser",
        entityId: tenantUserId,
        action: "UPDATE",
        beforeData: { role: beforeRole, targetUserName: tenantUser.profile.name, targetUserEmail: tenantUser.profile.email },
        afterData: { role: newRole, targetUserName: tenantUser.profile.name, targetUserEmail: tenantUser.profile.email },
        menuName: "사용자/권한관리",
      },
    })

    revalidatePath("/app/mes/users")
    return { success: true }
  } catch (e) {
    return { success: false, error: getErrorMessage(e) }
  }
}

// ─── 비활성화 ─────────────────────────────────────────────────────────────────

export async function deactivateUser(tenantUserId: string): Promise<{ success: boolean; error?: string }> {
  await requireResourcePermission("USER_MANAGEMENT", "UPDATE")
  try {
    const tenantId = await getTenantId()
    const actor = await requireRole("ADMIN")

    const tenantUser = await prisma.tenantUser.findFirst({
      where: { id: tenantUserId, tenantId },
      include: { profile: true },
    })
    if (!tenantUser) return { success: false, error: "사용자를 찾을 수 없습니다." }
    if (isDemoSeedEmail(tenantUser.profile.email)) {
      return { success: false, error: "Seed/demo 계정은 운영 UI에서 관리할 수 없습니다." }
    }

    // OWNER 계정은 OWNER/유지보수 계정만 변경할 수 있다(ADMIN 이 상위 역할 계정을 변경하지 못하도록).
    if (tenantUser.role === "OWNER" && !canAccessFullUserManagement(actor)) {
      return { success: false, error: "OWNER 계정은 OWNER 또는 유지보수 계정만 변경할 수 있습니다." }
    }
    if (tenantUser.profileId === actor.id) {
      return { success: false, error: "본인 계정은 비활성화할 수 없습니다." }
    }
    if (tenantUser.role === "OWNER") {
      const ownerCount = await prisma.tenantUser.count({
        where: { tenantId, role: "OWNER", isActive: true },
      })
      if (ownerCount <= 1) {
        return { success: false, error: "마지막 OWNER 계정은 비활성화할 수 없습니다." }
      }
    }

    await prisma.tenantUser.update({ where: { id: tenantUserId }, data: { isActive: false } })

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        entityType: "TenantUser",
        entityId: tenantUserId,
        action: "UPDATE",
        beforeData: { isActive: true, targetUserName: tenantUser.profile.name, targetUserEmail: tenantUser.profile.email },
        afterData: { isActive: false, targetUserName: tenantUser.profile.name, targetUserEmail: tenantUser.profile.email },
        menuName: "사용자/권한관리",
      },
    })

    revalidatePath("/app/mes/users")
    return { success: true }
  } catch (e) {
    return { success: false, error: getErrorMessage(e) }
  }
}

// ─── 사용 이력 점검 (영구삭제 가능 여부) ──────────────────────────────────────
//  Profile에 연결된 업무/접속 이력을 모두 검사한다.
//  하나라도 있으면 hard delete 금지(이력 추적성 보존).
const HISTORY_RELATIONS = [
  "qualityInspections",
  "auditLogs",
  "approvalRequests",
  "approvals",
  "receivingInspections",
  "ecnRequested",
  "ecnApproved",
  "signupsApproved",
  "signupsRejected",
  "repairRequested",
  "repairAssigned",
  "dailyChecks",
  "loginHistories",
] as const

async function getProfileHistoryCounts(profileId: string) {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: {
      _count: {
        select: {
          qualityInspections: true,
          auditLogs: true,
          approvalRequests: true,
          approvals: true,
          receivingInspections: true,
          ecnRequested: true,
          ecnApproved: true,
          signupsApproved: true,
          signupsRejected: true,
          repairRequested: true,
          repairAssigned: true,
          dailyChecks: true,
          loginHistories: true,
          tenantUsers: true,
        },
      },
    },
  })
  return profile?._count ?? null
}

// ─── 영구삭제 (이력 없는 계정만) ──────────────────────────────────────────────

export async function deleteUserPermanently(
  tenantUserId: string
): Promise<{ success: boolean; error?: string }> {
  await requireResourcePermission("USER_MANAGEMENT", "DELETE")
  try {
    const tenantId = await getTenantId()
    const actor = await requireRole("ADMIN")

    const tenantUser = await prisma.tenantUser.findFirst({
      where: { id: tenantUserId, tenantId },
      include: { profile: true },
    })
    if (!tenantUser) return { success: false, error: "사용자를 찾을 수 없습니다." }
    if (isDemoSeedEmail(tenantUser.profile.email)) {
      return { success: false, error: "Seed/demo 계정은 운영 UI에서 관리할 수 없습니다." }
    }
    if (tenantUser.profileId === actor.id) {
      return { success: false, error: "본인 계정은 삭제할 수 없습니다." }
    }
    if (tenantUser.role === "OWNER") {
      return { success: false, error: "OWNER 계정은 영구삭제할 수 없습니다." }
    }

    const counts = await getProfileHistoryCounts(tenantUser.profileId)
    if (!counts) return { success: false, error: "사용자 프로필을 찾을 수 없습니다." }

    // 다른 사업장에도 소속된 공용 프로필이면 영구삭제 금지
    if (counts.tenantUsers > 1) {
      return {
        success: false,
        error: "다른 사업장에도 소속된 계정이라 영구삭제할 수 없습니다. 퇴사처리로 목록에서 숨길 수 있습니다.",
      }
    }

    const historyTotal = HISTORY_RELATIONS.reduce(
      (sum, key) => sum + (counts[key as keyof typeof counts] ?? 0),
      0,
    )
    if (historyTotal > 0) {
      return {
        success: false,
        error:
          "이 사용자는 생산/품질/재고/출하 또는 접속 이력이 있어 영구삭제할 수 없습니다. 퇴사처리로 목록에서 숨길 수 있습니다.",
      }
    }

    const { profileId, profile } = tenantUser
    // 삭제 후에는 Profile 정보를 읽을 수 없으므로 트랜잭션 전에 보존
    const targetEmail = profile.email
    const targetName = profile.name

    // 이력이 전혀 없는 계정만 도달 → 인증/멤버십/프로필 삭제 + 감사 로그를
    // 하나의 트랜잭션으로 묶는다. AuditLog 기록 실패 시 삭제 전체가 rollback되어
    // "계정은 사라졌는데 삭제 기록은 남지 않는" 감사 추적 누락을 방지한다.
    // actorId는 현재 관리자(actor.id)이므로 삭제 대상 Profile을 지워도 FK 충돌이 없다.
    await prisma.$transaction(async (tx) => {
      await tx.userCredential.deleteMany({ where: { profileId } })
      await tx.tenantUser.delete({ where: { id: tenantUserId } })
      await tx.profile.delete({ where: { id: profileId } })

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "Profile",
          entityId: profileId,
          action: "DELETE",
          beforeData: { email: targetEmail, name: targetName, tenantUserId },
          menuName: "사용자/권한관리",
        },
      })
    })

    revalidatePath("/app/mes/users")
    return { success: true }
  } catch (e) {
    return { success: false, error: getErrorMessage(e) }
  }
}

// ─── 페이지네이션 공통 타입 ────────────────────────────────────────────────────

export type PaginatedResult<T> = {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

// ─── 접속 기록 조회 (LoginHistory) ────────────────────────────────────────────

export type LoginHistoryRow = {
  id: string
  loginId: string
  name: string | null
  email: string | null
  eventType: LoginEventType
  failReason: LoginFailReason | null
  ipAddress: string | null
  userAgent: string | null
  isActiveUser: boolean | null   // null = 프로필 없음(미가입 시도)
  createdAt: string
}

export type LoginHistoryFilter = {
  search?: string
  event?: "ALL" | "SUCCESS" | "FAIL"
  days?: number          // 최근 N일, 0 = 직접 기간
  dateFrom?: string      // days===0 일 때 사용 (ISO date string)
  dateTo?: string        // days===0 일 때 사용 (ISO date string)
  page?: number          // 1-based, 기본 1
  pageSize?: number      // 20 | 50 | 100, 기본 20
}

function buildLoginHistoryWhere(
  tenantId: string,
  filter: Omit<LoginHistoryFilter, "page" | "pageSize">
): Prisma.LoginHistoryWhereInput {
  const where: Prisma.LoginHistoryWhereInput = { tenantId }

  if (filter.event === "SUCCESS") where.eventType = "LOGIN_SUCCESS"
  else if (filter.event === "FAIL") where.eventType = "LOGIN_FAIL"

  if (filter.days && filter.days > 0) {
    const from = new Date()
    from.setDate(from.getDate() - filter.days)
    where.createdAt = { gte: from }
  } else if (filter.days === 0 && (filter.dateFrom || filter.dateTo)) {
    const from = filter.dateFrom ? new Date(filter.dateFrom + "T00:00:00+09:00") : undefined
    const to = filter.dateTo ? new Date(filter.dateTo + "T23:59:59.999+09:00") : undefined
    where.createdAt = { gte: from, lte: to }
  }

  if (filter.search && filter.search.trim()) {
    const q = filter.search.trim()
    where.OR = [
      { loginId: { contains: q, mode: "insensitive" } },
      { profile: { name: { contains: q, mode: "insensitive" } } },
      { profile: { email: { contains: q, mode: "insensitive" } } },
    ]
  }

  return where
}

function mapLoginHistoryRow(
  r: {
    id: string
    loginId: string
    eventType: LoginEventType
    failReason: LoginFailReason | null
    ipAddress: string | null
    userAgent: string | null
    createdAt: Date
    profile: {
      name: string
      email: string
      tenantUsers: { isActive: boolean }[]
    } | null
  },
): LoginHistoryRow {
  return {
    id: r.id,
    loginId: r.loginId,
    name: r.profile?.name ?? null,
    email: r.profile?.email ?? null,
    eventType: r.eventType,
    failReason: r.failReason,
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    isActiveUser: r.profile ? (r.profile.tenantUsers[0]?.isActive ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  }
}

export async function getLoginHistory(
  filter: LoginHistoryFilter = {}
): Promise<PaginatedResult<LoginHistoryRow>> {
  const tenantId = await getTenantId()
  await requireFullUserManagementAccess()

  const page = Math.max(1, filter.page ?? 1)
  const pageSize = filter.pageSize && [20, 50, 100].includes(filter.pageSize) ? filter.pageSize : 20
  const where = buildLoginHistoryWhere(tenantId, filter)

  const include = {
    profile: {
      select: {
        name: true,
        email: true,
        tenantUsers: { where: { tenantId }, select: { isActive: true }, take: 1 },
      },
    },
  }

  const [total, rawRows] = await Promise.all([
    prisma.loginHistory.count({ where }),
    prisma.loginHistory.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return { rows: rawRows.map(mapLoginHistoryRow), total, page, pageSize }
}

export async function getLoginHistoryExport(
  filter: Omit<LoginHistoryFilter, "page" | "pageSize">
): Promise<LoginHistoryRow[]> {
  const tenantId = await getTenantId()
  await requireFullUserManagementAccess()

  const where = buildLoginHistoryWhere(tenantId, filter)

  const rows = await prisma.loginHistory.findMany({
    where,
    include: {
      profile: {
        select: {
          name: true,
          email: true,
          tenantUsers: { where: { tenantId }, select: { isActive: true }, take: 1 },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10000,
  })

  return rows.map(mapLoginHistoryRow)
}

// ─── 이용 로그 조회 (AuditLog) ────────────────────────────────────────────────

export type AuditLogRow = {
  id: string
  actorName: string | null
  actorLabel: string | null
  entityType: string
  entityId: string
  targetLabel: string        // 사람이 읽을 수 있는 작업 대상 설명
  action: AuditAction
  menuName: string | null
  ipAddress: string | null
  userAgent: string | null
  actedAt: string
  beforeData: Prisma.JsonValue | null
  afterData: Prisma.JsonValue | null
}

export type AuditLogFilter = {
  search?: string
  action?: AuditAction | "ALL"
  entityType?: string
  days?: number
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}

/**
 * AuditLog 한 행의 entityType / metadata를 바탕으로
 * 사람이 읽을 수 있는 작업 대상 레이블을 생성한다.
 *
 * 우선순위:
 *   1) beforeData / afterData 에 있는 이름·이메일 (삭제된 사용자도 표시 가능)
 *   2) 현재 DB에서 조회한 TenantUser / Profile 정보 (batch로 미리 조회)
 *   3) entityId 앞 8자리 + "확인 불가" fallback
 */
function buildTargetLabel(
  entityType: string,
  entityId: string,
  action: string,
  beforeData: Record<string, unknown> | null,
  afterData: Record<string, unknown> | null,
  tuMap: Map<string, { name: string; email: string }>,
  profileMap: Map<string, { name: string; email: string }>,
): string {
  const after = afterData ?? {}
  const before = beforeData ?? {}

  if (entityType === "TenantUser" || entityType === "Profile") {
    // 메타데이터에서 이름/이메일 우선 추출
    const emailFromMeta =
      (after.targetUserEmail as string | undefined) ??
      (after.email as string | undefined) ??
      (before.targetUserEmail as string | undefined) ??
      (before.email as string | undefined) ??
      null
    const nameFromMeta =
      (after.targetUserName as string | undefined) ??
      (after.name as string | undefined) ??
      (before.targetUserName as string | undefined) ??
      (before.name as string | undefined) ??
      null

    // DB 조회 fallback (메타데이터 없거나 구 로그인 경우)
    const dbInfo =
      entityType === "TenantUser" ? tuMap.get(entityId) : profileMap.get(entityId)

    const email = emailFromMeta ?? dbInfo?.email
    const name = nameFromMeta ?? dbInfo?.name

    if (!email && !name) {
      if (!entityId) return "대상 정보 없음"
      return `삭제된 사용자 (ID: ${entityId.slice(0, 8)}…)`
    }

    const displayName = name || email?.split("@")[0] || ""
    let label = displayName
    if (email && email !== displayName) label += ` / ${email}`

    // 역할 변경 주석
    if (action === "UPDATE") {
      const beforeRole = before.role as string | undefined
      const afterRole = after.role as string | undefined
      if (beforeRole && afterRole && beforeRole !== afterRole) {
        label += ` (${beforeRole} → ${afterRole})`
      }
      // 활성화/비활성화 주석
      const afterActive = after.isActive
      if (typeof afterActive === "boolean") {
        label += afterActive ? " [재활성화]" : " [비활성화]"
      }
    }
    if (action === "DELETE") {
      label += " [삭제됨]"
    }

    return label
  }

  // EngineeringChange (변경관리 ECN)
  if (entityType === "EngineeringChange") {
    const ecnNo =
      (after.ecnNo as string | undefined) ?? (before.ecnNo as string | undefined)
    if (ecnNo) return `ECN: ${ecnNo}`
    if (!entityId) return "—"
    return `변경요청 (ID: ${entityId.slice(0, 8)}…)`
  }

  // 기타 엔티티 — entityType + id 앞 8자리
  if (!entityId) return "—"
  return `${entityType} (ID: ${entityId.slice(0, 8)}…)`
}

function buildAuditLogWhere(
  tenantId: string,
  filter: Omit<AuditLogFilter, "page" | "pageSize">
): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = { tenantId }

  if (filter.action && filter.action !== "ALL") where.action = filter.action
  if (filter.entityType && filter.entityType.trim()) where.entityType = filter.entityType.trim()

  if (filter.days && filter.days > 0) {
    const from = new Date()
    from.setDate(from.getDate() - filter.days)
    where.actedAt = { gte: from }
  } else if (filter.days === 0 && (filter.dateFrom || filter.dateTo)) {
    const from = filter.dateFrom ? new Date(filter.dateFrom + "T00:00:00+09:00") : undefined
    const to = filter.dateTo ? new Date(filter.dateTo + "T23:59:59.999+09:00") : undefined
    where.actedAt = { gte: from, lte: to }
  }

  if (filter.search && filter.search.trim()) {
    const q = filter.search.trim()
    where.OR = [
      { entityId: { contains: q, mode: "insensitive" } },
      { entityType: { contains: q, mode: "insensitive" } },
      { actorLabel: { contains: q, mode: "insensitive" } },
      { menuName: { contains: q, mode: "insensitive" } },
      { actor: { name: { contains: q, mode: "insensitive" } } },
      { afterData: { path: ["targetUserEmail"], string_contains: q } },
      { afterData: { path: ["email"], string_contains: q } },
      { afterData: { path: ["targetUserName"], string_contains: q } },
      { beforeData: { path: ["targetUserEmail"], string_contains: q } },
      { beforeData: { path: ["targetUserName"], string_contains: q } },
    ]
  }

  return where
}

const AUDIT_LOG_SELECT = {
  id: true,
  actorLabel: true,
  entityType: true,
  entityId: true,
  action: true,
  menuName: true,
  ipAddress: true,
  userAgent: true,
  actedAt: true,
  beforeData: true,
  afterData: true,
  actor: { select: { name: true } },
} as const

async function enrichAuditLogRows(
  rows: Array<{
    id: string
    actorLabel: string | null
    entityType: string
    entityId: string
    action: AuditAction
    menuName: string | null
    ipAddress: string | null
    userAgent: string | null
    actedAt: Date
    beforeData: Prisma.JsonValue
    afterData: Prisma.JsonValue
    actor: { name: string } | null
  }>
): Promise<AuditLogRow[]> {
  const tuIds = Array.from(new Set(
    rows.filter((r) => r.entityType === "TenantUser").map((r) => r.entityId)
  ))
  const profileIds = Array.from(new Set(
    rows.filter((r) => r.entityType === "Profile").map((r) => r.entityId)
  ))

  const [tuRows, profileRows] = await Promise.all([
    tuIds.length > 0
      ? prisma.tenantUser.findMany({
          where: { id: { in: tuIds } },
          select: { id: true, profile: { select: { name: true, email: true } } },
        })
      : Promise.resolve([] as { id: string; profile: { name: string; email: string } }[]),
    profileIds.length > 0
      ? prisma.profile.findMany({
          where: { id: { in: profileIds } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([] as { id: string; name: string; email: string }[]),
  ])

  const tuMap = new Map<string, { name: string; email: string }>(
    tuRows.map((tu) => [tu.id, { name: tu.profile.name || "", email: tu.profile.email }])
  )
  const profileMap = new Map<string, { name: string; email: string }>(
    profileRows.map((p) => [p.id, { name: p.name || "", email: p.email }])
  )

  return rows.map((r) => {
    const before = r.beforeData as Record<string, unknown> | null
    const after = r.afterData as Record<string, unknown> | null
    return {
      id: r.id,
      actorName: r.actor?.name ?? null,
      actorLabel: r.actorLabel,
      entityType: r.entityType,
      entityId: r.entityId,
      targetLabel: buildTargetLabel(r.entityType, r.entityId, r.action, before, after, tuMap, profileMap),
      action: r.action,
      menuName: r.menuName,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      actedAt: r.actedAt.toISOString(),
      beforeData: r.beforeData,
      afterData: r.afterData,
    }
  })
}

export async function getAuditLogs(
  filter: AuditLogFilter = {}
): Promise<PaginatedResult<AuditLogRow>> {
  const user = await requireResourcePermission("AUDIT_LOG", "READ")
  const tenantId = user.tenantId

  const page = Math.max(1, filter.page ?? 1)
  const pageSize = filter.pageSize && [20, 50, 100].includes(filter.pageSize) ? filter.pageSize : 20
  const where = buildAuditLogWhere(tenantId, filter)

  const [total, rawRows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      select: AUDIT_LOG_SELECT,
      orderBy: { actedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  const rows = await enrichAuditLogRows(rawRows)
  return { rows, total, page, pageSize }
}

export async function getAuditLogsExport(
  filter: Omit<AuditLogFilter, "page" | "pageSize">
): Promise<AuditLogRow[]> {
  const user = await requireResourcePermission("AUDIT_LOG", "READ")
  const tenantId = user.tenantId

  const where = buildAuditLogWhere(tenantId, filter)

  const rawRows = await prisma.auditLog.findMany({
    where,
    select: AUDIT_LOG_SELECT,
    orderBy: { actedAt: "desc" },
    take: 10000,
  })

  return enrichAuditLogRows(rawRows)
}

// ─── 재활성화 ─────────────────────────────────────────────────────────────────

export async function reactivateUser(tenantUserId: string): Promise<{ success: boolean; error?: string }> {
  await requireResourcePermission("USER_MANAGEMENT", "UPDATE")
  try {
    const tenantId = await getTenantId()
    const actor = await requireRole("ADMIN")

    const tenantUser = await prisma.tenantUser.findFirst({
      where: { id: tenantUserId, tenantId },
      include: { profile: true },
    })
    if (!tenantUser) return { success: false, error: "사용자를 찾을 수 없습니다." }
    if (isDemoSeedEmail(tenantUser.profile.email)) {
      return { success: false, error: "Seed/demo 계정은 운영 UI에서 관리할 수 없습니다." }
    }

    // OWNER 계정은 OWNER/유지보수 계정만 변경할 수 있다(ADMIN 이 상위 역할 계정을 변경하지 못하도록).
    if (tenantUser.role === "OWNER" && !canAccessFullUserManagement(actor)) {
      return { success: false, error: "OWNER 계정은 OWNER 또는 유지보수 계정만 변경할 수 있습니다." }
    }
    await prisma.tenantUser.update({ where: { id: tenantUserId }, data: { isActive: true } })

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        entityType: "TenantUser",
        entityId: tenantUserId,
        action: "UPDATE",
        beforeData: { isActive: false, targetUserName: tenantUser.profile.name, targetUserEmail: tenantUser.profile.email },
        afterData: { isActive: true, targetUserName: tenantUser.profile.name, targetUserEmail: tenantUser.profile.email },
        menuName: "사용자/권한관리",
      },
    })

    revalidatePath("/app/mes/users")
    return { success: true }
  } catch (e) {
    return { success: false, error: getErrorMessage(e) }
  }
}

// ─── 비밀번호 초기화 (test/OWNER 전용) ────────────────────────────────────────

// 임시 비밀번호는 관리자가 직접 입력한다(코드에 고정값 없음). 평문은 저장/로그/감사로그에 남기지 않는다.
export async function resetUserPassword(
  tenantUserId: string,
  tempPassword: string
): Promise<{ success: boolean; error?: string }> {
  await requireResourcePermission("USER_MANAGEMENT", "UPDATE")
  try {
    const pwError = typeof tempPassword === "string" ? validatePassword(tempPassword) : "임시 비밀번호를 입력해 주세요."
    if (pwError) return { success: false, error: pwError }

    const tenantId = await getTenantId()
    const actor = await requireFullUserManagementAccess()

    const tenantUser = await prisma.tenantUser.findFirst({
      where: { id: tenantUserId, tenantId },
      include: { profile: { include: { userCredential: { select: { id: true, passwordHash: true } } } } },
    })
    if (!tenantUser) return { success: false, error: "사용자를 찾을 수 없습니다." }
    if (isDemoSeedEmail(tenantUser.profile.email)) {
      return { success: false, error: "Seed/demo 계정은 운영 UI에서 관리할 수 없습니다." }
    }
    if (tenantUser.profileId === actor.id) {
      return { success: false, error: "본인 계정의 비밀번호는 초기화할 수 없습니다." }
    }

    const credential = tenantUser.profile.userCredential
    if (!credential) return { success: false, error: "계정 인증 정보가 없습니다." }

    if (await verifyPassword(tempPassword, credential.passwordHash)) {
      return { success: false, error: "현재 비밀번호와 동일한 임시 비밀번호는 사용할 수 없습니다." }
    }

    const newHash = await hashPassword(tempPassword)

    await prisma.$transaction(async (tx) => {
      await tx.userCredential.update({
        where: { id: credential.id },
        data: {
          passwordHash: newHash,
          mustChangePw: true,
          isLocked: false,
          failCount: 0,
          lockedAt: null,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "UserCredential",
          entityId: credential.id,
          action: "UPDATE",
          beforeData: { targetUserName: tenantUser.profile.name, targetUserEmail: tenantUser.profile.email },
          afterData: {
            targetUserName: tenantUser.profile.name,
            targetUserEmail: tenantUser.profile.email,
            passwordReset: true,
            mustChangePw: true,
          },
          menuName: "사용자/권한관리",
        },
      })
    })

    revalidatePath("/app/mes/users")
    return { success: true }
  } catch (e) {
    return { success: false, error: getErrorMessage(e) }
  }
}

// ─── POP PIN 재설정 (test/OWNER 전용) ─────────────────────────────────────────

export async function resetUserPopPin(
  tenantUserId: string,
  newPin: string
): Promise<{ success: boolean; error?: string }> {
  await requireResourcePermission("USER_MANAGEMENT", "UPDATE")
  try {
    const tenantId = await getTenantId()
    const actor = await requireFullUserManagementAccess()

    const tenantUser = await prisma.tenantUser.findFirst({
      where: { id: tenantUserId, tenantId },
      include: {
        profile: {
          include: { userCredential: { select: { id: true, popPinFingerprint: true } } },
        },
      },
    })
    if (!tenantUser) return { success: false, error: "사용자를 찾을 수 없습니다." }
    if (isDemoSeedEmail(tenantUser.profile.email)) {
      return { success: false, error: "Seed/demo 계정은 운영 UI에서 관리할 수 없습니다." }
    }

    const credential = tenantUser.profile.userCredential
    if (!credential) return { success: false, error: "계정 인증 정보가 없습니다." }

    try {
      assertValidPopPin(newPin)
    } catch {
      return { success: false, error: "POP PIN은 4자리 숫자여야 합니다." }
    }

    let popPinForStorage: Awaited<ReturnType<typeof preparePopPinForStorage>>
    try {
      popPinForStorage = await preparePopPinForStorage(tenantId, newPin)
    } catch (e) {
      if (e instanceof Error && e.message === "POP_PIN_SECRET is required") {
        return { success: false, error: "POP PIN 설정이 준비되지 않았습니다. 서버 환경을 확인해 주세요." }
      }
      return { success: false, error: "PIN 처리 중 오류가 발생했습니다." }
    }

    if (credential.popPinFingerprint === popPinForStorage.popPinFingerprint) {
      return { success: false, error: "기존 PIN과 동일한 PIN은 사용할 수 없습니다." }
    }

    const [dupCredential, dupPending] = await Promise.all([
      prisma.userCredential.findFirst({
        where: {
          tenantId,
          popPinFingerprint: popPinForStorage.popPinFingerprint,
          id: { not: credential.id },
        },
        select: { id: true },
      }),
      prisma.signupRequest.findFirst({
        where: {
          tenantId,
          popPinFingerprint: popPinForStorage.popPinFingerprint,
          status: "PENDING",
        },
        select: { id: true },
      }),
    ])

    if (dupCredential || dupPending) {
      return { success: false, error: "이미 사용 중인 POP PIN입니다. 다른 PIN을 입력해 주세요." }
    }

    await prisma.$transaction(async (tx) => {
      await tx.userCredential.update({
        where: { id: credential.id },
        data: {
          popPinHash: popPinForStorage.popPinHash,
          popPinFingerprint: popPinForStorage.popPinFingerprint,
          popPinSetAt: popPinForStorage.popPinSetAt,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "UserCredential",
          entityId: credential.id,
          action: "UPDATE",
          beforeData: {
            targetUserName: tenantUser.profile.name,
            targetUserEmail: tenantUser.profile.email,
          },
          afterData: {
            targetUserName: tenantUser.profile.name,
            targetUserEmail: tenantUser.profile.email,
            popPinReset: true,
          },
          menuName: "사용자/권한관리",
        },
      })
    })

    revalidatePath("/app/mes/users")
    return { success: true }
  } catch (e) {
    return { success: false, error: getErrorMessage(e) }
  }
}
