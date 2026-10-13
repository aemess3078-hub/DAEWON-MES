"use server"

import { prisma } from "@/lib/db/prisma"
import { requireRole, getTenantId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { resolveKstDateRangeFilter } from "@/lib/date/kst"
import { getErrorMessage } from "@/lib/utils"
import {
  normalizePreventionContent,
  normalizeDueDate,
  normalizeVerificationContent,
  buildRecurrencePreventionStatusWhere,
  serializeDefectRecurrencePreventionRow,
  type RecurrencePreventionStatusFilter,
  type DefectRecurrencePreventionRow,
} from "./defect-recurrence-prevention.helpers"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

export type { DefectRecurrencePreventionRow }

// ─── 청운커팅 사업계획서 "품질검사 > 재발방지관리" ──────────────────────────
//
// 불량발생 → 원인분석(PR #55) → 조치관리(PR #66) → 재발방지관리 흐름의 마지막
// 구간을 담당한다. 원인분석/조치관리는 이 파일에서 참조만 하고 절대 수정하지
// 않는다. tenantId/defectRecordId/assigneeId/verifierId/preventionId는 client가
// 보낸 값을 신뢰하지 않고 서버에서 항상 재검증한다(defect-corrective-action.actions.ts와
// 동일 원칙).

const MENU_NAME = "재발방지관리"

function revalidateRecurrencePreventionPaths() {
  revalidatePath("/app/mes/quality/recurrence-prevention")
}

/** client가 보낸 defectRecordId는 신뢰하지 않고, 재발방지 등록 가능 여부(원인분석/완료된 조치 존재)를 서버에서 재검증한다. */
async function assertRecurrencePreventionPrerequisites(defectRecordId: string, tenantId: string) {
  const record = await prisma.defectRecord.findFirst({
    where: {
      id: defectRecordId,
      qualityInspection: { workOrderOperation: { workOrder: { tenantId } } },
    },
    select: {
      id: true,
      causeAnalysis: { select: { id: true } },
      correctiveActions: { select: { status: true } },
    },
  })
  if (!record) throw new Error("불량 기록을 찾을 수 없습니다.")
  if (!record.causeAnalysis) {
    throw new Error("원인분석이 등록되지 않은 불량입니다. 원인분석을 먼저 등록해 주세요.")
  }
  if (record.correctiveActions.length === 0) {
    throw new Error("등록된 조치가 없는 불량입니다. 조치관리에서 조치를 먼저 등록해 주세요.")
  }
  if (!record.correctiveActions.some((a) => a.status === "COMPLETED")) {
    throw new Error("완료된 조치가 없는 불량입니다. 조치가 완료된 이후 재발방지 대책을 등록할 수 있습니다.")
  }
}

/** 담당자/검증담당자 지정 시 현재 tenant의 활성 TenantUser에 속한 Profile만 허용한다(project-issue.actions.ts와 동일 패턴). */
async function assertTenantUserValid(tenantId: string, userId: string | null | undefined) {
  if (!userId) return
  const tenantUser = await prisma.tenantUser.findFirst({
    where: { profileId: userId, tenantId, isActive: true },
    select: { profileId: true },
  })
  if (!tenantUser) {
    throw new Error("사용자를 찾을 수 없습니다. 활성 상태인 사용자만 지정할 수 있습니다.")
  }
}

const RECURRENCE_PREVENTION_SELECT = {
  id: true,
  preventionContent: true,
  assigneeId: true,
  assignee: { select: { name: true } },
  dueDate: true,
  status: true,
  verificationContent: true,
  verificationResult: true,
  verifierId: true,
  verifier: { select: { name: true } },
  verifiedAt: true,
  completedAt: true,
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
  defectRecord: {
    select: {
      id: true,
      qty: true,
      severity: true,
      disposition: true,
      defectCode: { select: { code: true, name: true } },
      causeAnalysis: { select: { rootCause: true, analysisDetail: true } },
      correctiveActions: {
        select: { id: true, actionContent: true, status: true, completedAt: true },
        orderBy: { createdAt: "asc" },
      },
      qualityInspection: {
        select: {
          inspectedAt: true,
          stage: true,
          workOrderOperation: {
            select: {
              routingOperation: { select: { name: true } },
              workOrder: {
                select: {
                  orderNo: true,
                  manufacturingNo: true,
                  item: { select: { code: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const

// ─── 목록 조회 ────────────────────────────────────────────────────────────────

export type DefectRecurrencePreventionFilter = {
  from?: string // YYYY-MM-DD(KST) — 대상 불량의 검사일시 기준(원인분석/조치관리 화면과 동일 기준)
  to?: string
  itemId?: string
  routingOperationId?: string
  manufacturingNo?: string
  defectCodeId?: string
  assigneeId?: string
  verificationResult?: "ALL" | "EFFECTIVE" | "INEFFECTIVE"
  status?: RecurrencePreventionStatusFilter
}

async function getDefectRecurrencePreventionRecords(tenantId: string, filter: DefectRecurrencePreventionFilter) {
  const { fromDate, toDate } = resolveKstDateRangeFilter(30, filter.from, filter.to)

  const workOrderWhere: Record<string, unknown> = { tenantId }
  if (filter.itemId) workOrderWhere.itemId = filter.itemId
  if (filter.manufacturingNo?.trim()) workOrderWhere.manufacturingNo = filter.manufacturingNo.trim()

  const workOrderOperationWhere: Record<string, unknown> = { workOrder: workOrderWhere }
  if (filter.routingOperationId) workOrderOperationWhere.routingOperationId = filter.routingOperationId

  return prisma.defectRecurrencePrevention.findMany({
    where: {
      tenantId,
      defectRecord: {
        qualityInspection: {
          inspectedAt: { gte: fromDate, lte: toDate },
          workOrderOperation: workOrderOperationWhere,
        },
        ...(filter.defectCodeId && { defectCodeId: filter.defectCodeId }),
      },
      ...(filter.assigneeId && { assigneeId: filter.assigneeId }),
      ...(filter.verificationResult &&
        filter.verificationResult !== "ALL" && { verificationResult: filter.verificationResult }),
      ...buildRecurrencePreventionStatusWhere(filter.status),
    },
    select: RECURRENCE_PREVENTION_SELECT,
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
  })
}

export async function getDefectRecurrencePreventionList(
  filter: DefectRecurrencePreventionFilter = {}
): Promise<DefectRecurrencePreventionRow[]> {
  await assertDaewonFeatureScope()
  await requireRole("VIEWER")
  const tenantId = await getTenantId()
  const records = await getDefectRecurrencePreventionRecords(tenantId, filter)
  const now = new Date()
  const rows = records.map((r) => serializeDefectRecurrencePreventionRow(r, now))
  // "OVERDUE"는 DB status가 아니라 계산값이라, where절이 아닌 여기서 걸러낸다.
  if (filter.status === "OVERDUE") return rows.filter((r) => r.overdue)
  return rows
}

// ─── 필터 옵션 / 담당자·검증담당자 선택지 ────────────────────────────────────

export type DefectRecurrencePreventionFilterOptions = {
  items: { id: string; code: string; name: string }[]
  routingOperations: { id: string; name: string; seq: number; routingCode: string; routingName: string }[]
  defectCodes: { id: string; code: string; name: string }[]
  assignableUsers: { id: string; name: string }[]
}

export async function getDefectRecurrencePreventionFilterOptions(): Promise<DefectRecurrencePreventionFilterOptions> {
  await assertDaewonFeatureScope()
  await requireRole("VIEWER")
  const tenantId = await getTenantId()

  const [items, ops, defectCodes, tenantUsers] = await Promise.all([
    prisma.item.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.routingOperation.findMany({
      where: { routing: { tenantId } },
      select: { id: true, name: true, seq: true, routing: { select: { code: true, name: true } } },
      orderBy: [{ routing: { code: "asc" } }, { seq: "asc" }],
    }),
    prisma.defectCode.findMany({
      where: { tenantId },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.tenantUser.findMany({
      where: { tenantId, isActive: true },
      select: { profileId: true, profile: { select: { name: true } } },
      orderBy: { profile: { name: "asc" } },
    }),
  ])

  return {
    items,
    routingOperations: ops.map((op) => ({
      id: op.id,
      name: op.name,
      seq: op.seq,
      routingCode: op.routing.code,
      routingName: op.routing.name,
    })),
    defectCodes,
    assignableUsers: tenantUsers.map((u) => ({ id: u.profileId, name: u.profile.name })),
  }
}

// ─── 재발방지 등록 대상 불량 선택지 ───────────────────────────────────────────
//
// 원인분석이 등록되어 있고, 완료(COMPLETED)된 조치가 최소 1건 있는 DefectRecord만
// 대상으로 노출한다(§ assertRecurrencePreventionPrerequisites와 동일 정책 — 여기서
// 미리 걸러서 보여주고, 등록 시점에도 서버에서 다시 검증한다).

export type RecurrencePreventionDefectOption = {
  defectRecordId: string
  inspectedAt: string
  itemCode: string
  itemName: string
  routingOperationName: string
  orderNo: string
  manufacturingNo: string | null
  defectCode: string
  defectCodeName: string
  defectQty: number
  rootCause: string | null
  analysisDetail: string | null
  correctiveActions: { id: string; actionContent: string; status: string; completedAt: string | null }[]
}

export async function getRecurrencePreventionDefectOptions(
  filter: { from?: string; to?: string } = {}
): Promise<RecurrencePreventionDefectOption[]> {
  await assertDaewonFeatureScope()
  await requireRole("VIEWER")
  const tenantId = await getTenantId()
  const { fromDate, toDate } = resolveKstDateRangeFilter(30, filter.from, filter.to)

  const records = await prisma.defectRecord.findMany({
    where: {
      qualityInspection: {
        inspectedAt: { gte: fromDate, lte: toDate },
        workOrderOperation: { workOrder: { tenantId } },
      },
      causeAnalysis: { isNot: null },
      correctiveActions: { some: { status: "COMPLETED" } },
    },
    select: {
      id: true,
      qty: true,
      defectCode: { select: { code: true, name: true } },
      causeAnalysis: { select: { rootCause: true, analysisDetail: true } },
      correctiveActions: {
        select: { id: true, actionContent: true, status: true, completedAt: true },
        orderBy: { createdAt: "asc" },
      },
      qualityInspection: {
        select: {
          inspectedAt: true,
          workOrderOperation: {
            select: {
              routingOperation: { select: { name: true } },
              workOrder: {
                select: {
                  orderNo: true,
                  manufacturingNo: true,
                  item: { select: { code: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ qualityInspection: { inspectedAt: "desc" } }, { id: "asc" }],
  })

  return records.map((r) => {
    const woOp = r.qualityInspection.workOrderOperation
    return {
      defectRecordId: r.id,
      inspectedAt: r.qualityInspection.inspectedAt.toISOString(),
      itemCode: woOp.workOrder.item.code,
      itemName: woOp.workOrder.item.name,
      routingOperationName: woOp.routingOperation.name,
      orderNo: woOp.workOrder.orderNo,
      manufacturingNo: woOp.workOrder.manufacturingNo,
      defectCode: r.defectCode.code,
      defectCodeName: r.defectCode.name,
      defectQty: Number(r.qty),
      rootCause: r.causeAnalysis?.rootCause ?? null,
      analysisDetail: r.causeAnalysis?.analysisDetail ?? null,
      correctiveActions: r.correctiveActions.map((a) => ({
        id: a.id,
        actionContent: a.actionContent,
        status: a.status,
        completedAt: a.completedAt?.toISOString() ?? null,
      })),
    }
  })
}

// ─── 등록 ───────────────────────────────────────────────────────────────────

export type CreateDefectRecurrencePreventionInput = {
  defectRecordId: string
  preventionContent: string
  assigneeId?: string | null
  dueDate: string
}

export async function createDefectRecurrencePrevention(
  data: CreateDefectRecurrencePreventionInput
): Promise<{ id: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("DEFECT_MANAGEMENT", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const preventionContent = normalizePreventionContent(data.preventionContent)
  const dueDate = normalizeDueDate(data.dueDate)
  const assigneeId = data.assigneeId?.trim() || null

  await assertRecurrencePreventionPrerequisites(data.defectRecordId, tenantId)
  await assertTenantUserValid(tenantId, assigneeId)

  const created = await prisma.$transaction(async (tx) => {
    const prevention = await tx.defectRecurrencePrevention.create({
      data: {
        tenantId,
        defectRecordId: data.defectRecordId,
        preventionContent,
        assigneeId,
        dueDate,
        status: "OPEN",
        createdById: actor.id,
        updatedById: actor.id,
      },
    })
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "DefectRecurrencePrevention",
        entityId: prevention.id,
        action: "CREATE",
        afterData: {
          preventionContent: prevention.preventionContent,
          assigneeId: prevention.assigneeId,
          dueDate: prevention.dueDate,
          status: prevention.status,
        },
        menuName: MENU_NAME,
      },
    })
    return prevention
  })

  revalidateRecurrencePreventionPaths()
  return { id: created.id }
}

// ─── 수정 (재발방지 대책 / 담당자 / 완료예정일) ──────────────────────────────
//
// 상태·검증 자체는 이 함수로 바꾸지 않는다 — 상태전이/검증은 아래 전용
// 함수로만 처리한다(defect-corrective-action.actions.ts와 동일하게 책임을 분리).

export type UpdateDefectRecurrencePreventionInput = {
  preventionContent: string
  assigneeId?: string | null
  dueDate: string
}

export async function updateDefectRecurrencePrevention(id: string, data: UpdateDefectRecurrencePreventionInput) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("DEFECT_MANAGEMENT", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const existing = await prisma.defectRecurrencePrevention.findFirst({ where: { id, tenantId } })
  if (!existing) throw new Error("재발방지 이력을 찾을 수 없습니다.")

  const preventionContent = normalizePreventionContent(data.preventionContent)
  const dueDate = normalizeDueDate(data.dueDate)
  const assigneeId = data.assigneeId?.trim() || null
  await assertTenantUserValid(tenantId, assigneeId)

  await prisma.$transaction(async (tx) => {
    await tx.defectRecurrencePrevention.update({
      where: { id },
      data: { preventionContent, assigneeId, dueDate, updatedById: actor.id },
    })
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "DefectRecurrencePrevention",
        entityId: id,
        action: "UPDATE",
        beforeData: {
          preventionContent: existing.preventionContent,
          assigneeId: existing.assigneeId,
          dueDate: existing.dueDate,
        },
        afterData: { preventionContent, assigneeId, dueDate },
        menuName: MENU_NAME,
      },
    })
  })

  revalidateRecurrencePreventionPaths()
}

// ─── 상태전이: 대책 수행 시작 (OPEN → IN_PROGRESS) ───────────────────────────

export async function startDefectRecurrencePrevention(id: string): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("DEFECT_MANAGEMENT", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.defectRecurrencePrevention.findFirst({ where: { id, tenantId } })
    if (!current) throw new Error("재발방지 이력을 찾을 수 없습니다.")
    if (current.status !== "OPEN") throw new Error("등록 상태인 재발방지 대책만 수행을 시작할 수 있습니다.")

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.defectRecurrencePrevention.updateMany({
        where: { id: current.id, tenantId, status: "OPEN" },
        data: { status: "IN_PROGRESS", updatedById: actor.id },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "DefectRecurrencePrevention",
          entityId: current.id,
          action: "UPDATE",
          beforeData: { status: "OPEN" },
          afterData: { status: "IN_PROGRESS" },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateRecurrencePreventionPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 상태전이: 검증 요청 (IN_PROGRESS → VERIFYING) ───────────────────────────

export async function submitDefectRecurrencePreventionForVerification(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("DEFECT_MANAGEMENT", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.defectRecurrencePrevention.findFirst({ where: { id, tenantId } })
    if (!current) throw new Error("재발방지 이력을 찾을 수 없습니다.")
    if (current.status !== "IN_PROGRESS") throw new Error("대책 수행중인 건만 검증 요청할 수 있습니다.")

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.defectRecurrencePrevention.updateMany({
        where: { id: current.id, tenantId, status: "IN_PROGRESS" },
        data: { status: "VERIFYING", updatedById: actor.id },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "DefectRecurrencePrevention",
          entityId: current.id,
          action: "UPDATE",
          beforeData: { status: "IN_PROGRESS" },
          afterData: { status: "VERIFYING" },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateRecurrencePreventionPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 효과성 검증 (VERIFYING → COMPLETED | IN_PROGRESS) ───────────────────────
//
// EFFECTIVE면 CAPA 종료 조건(대책 수행 완료 + 효과성 검증 완료 + 결과 EFFECTIVE)을
// 만족하므로 COMPLETED로 전이하며 completedAt을 서버에서 자동 기록한다.
// INEFFECTIVE면 COMPLETED로 전이하지 않고 IN_PROGRESS로 되돌려 추가 대책을
// 수행하게 한다 — 검증 이력은 최신 1건만 이 row에 스냅샷으로 남는다.

export type VerifyDefectRecurrencePreventionInput = {
  verificationContent: string
  verificationResult: "EFFECTIVE" | "INEFFECTIVE"
  verifierId: string
}

export async function verifyDefectRecurrencePrevention(
  id: string,
  data: VerifyDefectRecurrencePreventionInput
): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("DEFECT_MANAGEMENT", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.defectRecurrencePrevention.findFirst({ where: { id, tenantId } })
    if (!current) throw new Error("재발방지 이력을 찾을 수 없습니다.")
    if (current.status !== "VERIFYING") throw new Error("검증 대기중인 재발방지 대책만 검증 처리할 수 있습니다.")

    const verificationContent = normalizeVerificationContent(data.verificationContent)
    if (data.verificationResult !== "EFFECTIVE" && data.verificationResult !== "INEFFECTIVE") {
      throw new Error("검증결과를 선택해 주세요.")
    }
    const verifierId = data.verifierId?.trim()
    if (!verifierId) {
      throw new Error("검증담당자를 선택해 주세요.")
    }
    await assertTenantUserValid(tenantId, verifierId)

    const nextStatus = data.verificationResult === "EFFECTIVE" ? "COMPLETED" : "IN_PROGRESS"

    await prisma.$transaction(async (tx) => {
      const verifiedAt = new Date()
      const completedAt = nextStatus === "COMPLETED" ? verifiedAt : null
      const claimed = await tx.defectRecurrencePrevention.updateMany({
        where: { id: current.id, tenantId, status: "VERIFYING" },
        data: {
          status: nextStatus,
          verificationContent,
          verificationResult: data.verificationResult,
          verifierId,
          verifiedAt,
          completedAt,
          updatedById: actor.id,
        },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "DefectRecurrencePrevention",
          entityId: current.id,
          action: "UPDATE",
          beforeData: { status: "VERIFYING" },
          afterData: {
            status: nextStatus,
            verificationContent,
            verificationResult: data.verificationResult,
            verifierId,
            verifiedAt,
            completedAt,
          },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateRecurrencePreventionPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}
