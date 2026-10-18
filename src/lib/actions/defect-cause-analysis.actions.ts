"use server"

import { prisma } from "@/lib/db/prisma"
import { requireRole, getTenantId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { resolveKstDateRangeFilter } from "@/lib/date/kst"
import {
  normalizeRootCause,
  normalizeAnalysisDetail,
  buildAnalysisStatusWhere,
  serializeDefectCauseAnalysisRow,
  type AnalysisStatusFilter,
  type DefectCauseAnalysisRow,
} from "./defect-cause-analysis.helpers"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { requireReadActor } from "@/lib/auth/action-guards"

export type { DefectCauseAnalysisRow }

// ─── 목록 조회 ────────────────────────────────────────────────────────────────

export type DefectCauseAnalysisFilter = {
  from?: string // YYYY-MM-DD(KST)
  to?: string
  itemId?: string
  routingOperationId?: string
  manufacturingNo?: string
  defectCodeId?: string
  analysisStatus?: AnalysisStatusFilter
}

async function getDefectCauseAnalysisRecords(tenantId: string, filter: DefectCauseAnalysisFilter) {
  const { fromDate, toDate } = resolveKstDateRangeFilter(30, filter.from, filter.to)

  const workOrderWhere: Record<string, unknown> = { tenantId }
  if (filter.itemId) workOrderWhere.itemId = filter.itemId
  if (filter.manufacturingNo?.trim()) workOrderWhere.manufacturingNo = filter.manufacturingNo.trim()

  const workOrderOperationWhere: Record<string, unknown> = { workOrder: workOrderWhere }
  if (filter.routingOperationId) workOrderOperationWhere.routingOperationId = filter.routingOperationId

  return prisma.defectRecord.findMany({
    where: {
      qualityInspection: {
        inspectedAt: { gte: fromDate, lte: toDate },
        workOrderOperation: workOrderOperationWhere,
      },
      ...(filter.defectCodeId && { defectCodeId: filter.defectCodeId }),
      ...buildAnalysisStatusWhere(filter.analysisStatus),
    },
    select: {
      id: true,
      qty: true,
      severity: true,
      disposition: true,
      defectCode: { select: { id: true, code: true, name: true } },
      qualityInspection: {
        select: {
          id: true,
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
      causeAnalysis: {
        select: {
          id: true,
          rootCause: true,
          analysisDetail: true,
          updatedAt: true,
          updatedBy: { select: { name: true } },
        },
      },
    },
    orderBy: [{ qualityInspection: { inspectedAt: "desc" } }, { id: "asc" }],
  })
}

export async function getDefectCauseAnalysisList(
  filter: DefectCauseAnalysisFilter = {}
): Promise<DefectCauseAnalysisRow[]> {
  await requireReadActor(["DEFECT_MANAGEMENT", "QUALITY_INSPECTION"])
  await requireRole("VIEWER")
  const tenantId = await getTenantId()
  const records = await getDefectCauseAnalysisRecords(tenantId, filter)
  return records.map(serializeDefectCauseAnalysisRow)
}

// ─── 필터 옵션 ────────────────────────────────────────────────────────────────

export type DefectCauseAnalysisFilterOptions = {
  items: { id: string; code: string; name: string }[]
  routingOperations: { id: string; name: string; seq: number; routingCode: string; routingName: string }[]
  defectCodes: { id: string; code: string; name: string }[]
}

export async function getDefectCauseAnalysisFilterOptions(): Promise<DefectCauseAnalysisFilterOptions> {
  await requireReadActor(["DEFECT_MANAGEMENT", "QUALITY_INSPECTION"])
  await requireRole("VIEWER")
  const tenantId = await getTenantId()

  const [items, ops, defectCodes] = await Promise.all([
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
  }
}

// ─── 등록/수정 ────────────────────────────────────────────────────────────────

/** client가 보낸 defectRecordId는 신뢰하지 않고, 현재 tenant 소속인지 서버에서 재검증한다. */
async function assertDefectRecordInTenant(defectRecordId: string, tenantId: string) {
  const record = await prisma.defectRecord.findFirst({
    where: {
      id: defectRecordId,
      qualityInspection: { workOrderOperation: { workOrder: { tenantId } } },
    },
    select: { id: true },
  })
  if (!record) throw new Error("불량 기록을 찾을 수 없습니다.")
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002"
}

export type CreateDefectCauseAnalysisInput = {
  defectRecordId: string
  rootCause: string
  analysisDetail?: string | null
}

export async function createDefectCauseAnalysis(
  data: CreateDefectCauseAnalysisInput
): Promise<{ id: string }> {
  await requireResourcePermission("DEFECT_MANAGEMENT", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const rootCause = normalizeRootCause(data.rootCause)
  const analysisDetail = normalizeAnalysisDetail(data.analysisDetail)

  await assertDefectRecordInTenant(data.defectRecordId, tenantId)

  const created = await prisma
    .$transaction(async (tx) => {
      const analysis = await tx.defectCauseAnalysis.create({
        data: {
          tenantId,
          defectRecordId: data.defectRecordId,
          rootCause,
          analysisDetail,
          createdById: actor.id,
          updatedById: actor.id,
        },
      })
      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "DefectCauseAnalysis",
          entityId: analysis.id,
          action: "CREATE",
          afterData: { rootCause: analysis.rootCause, analysisDetail: analysis.analysisDetail },
          menuName: "원인분석",
        },
      })
      return analysis
    })
    .catch((error) => {
      if (isUniqueConstraintError(error)) {
        throw new Error("이미 원인분석이 등록된 불량입니다.")
      }
      throw error
    })

  revalidatePath("/app/mes/quality/cause-analysis")
  return { id: created.id }
}

export type UpdateDefectCauseAnalysisInput = {
  rootCause: string
  analysisDetail?: string | null
}

export async function updateDefectCauseAnalysis(id: string, data: UpdateDefectCauseAnalysisInput) {
  await requireResourcePermission("DEFECT_MANAGEMENT", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const existing = await prisma.defectCauseAnalysis.findFirst({ where: { id, tenantId } })
  if (!existing) throw new Error("원인분석을 찾을 수 없습니다.")

  const rootCause = normalizeRootCause(data.rootCause)
  const analysisDetail = normalizeAnalysisDetail(data.analysisDetail)

  await prisma.$transaction(async (tx) => {
    await tx.defectCauseAnalysis.update({
      where: { id },
      data: { rootCause, analysisDetail, updatedById: actor.id },
    })
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "DefectCauseAnalysis",
        entityId: id,
        action: "UPDATE",
        beforeData: { rootCause: existing.rootCause, analysisDetail: existing.analysisDetail },
        afterData: { rootCause, analysisDetail },
        menuName: "원인분석",
      },
    })
  })

  revalidatePath("/app/mes/quality/cause-analysis")
}
