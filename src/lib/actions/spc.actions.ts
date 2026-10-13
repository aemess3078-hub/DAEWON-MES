"use server"

import { prisma } from "@/lib/db/prisma"
import { requireRole, getTenantId } from "@/lib/auth"
import { InspectionInputType } from "@prisma/client"
import { revalidatePath } from "next/cache"
import {
  mean,
  sampleStandardDeviation,
  calculateIMRLimits,
  calculateProcessCapability,
  buildHistogram,
  type IMRResult,
  type ProcessCapabilityResult,
  type HistogramBin,
} from "@/lib/spc-calculations"
import {
  kstDateKeyToUtcStart,
  kstDateKeyToUtcEnd,
  isValidKstDateRange,
  kstDefaultDateRange,
} from "@/lib/date/kst"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

// ─── SPC Profile CRUD ────────────────────────────────────────────────────────

export type SpcProfileRow = {
  id: string
  name: string
  controlChartType: "I_MR"
  isActive: boolean
  inspectionItemId: string
  inspectionItemName: string
  unit: string | null
  lowerLimit: number | null
  upperLimit: number | null
  itemCode: string
  itemName: string
  routingOperationName: string
  specVersion: string
  createdByName: string
  updatedByName: string
  createdAt: string
  updatedAt: string
}

async function getSpcProfileRecords(tenantId: string) {
  return prisma.spcProfile.findMany({
    where: { tenantId },
    include: {
      inspectionItem: {
        include: {
          inspectionSpec: {
            include: {
              item: { select: { code: true, name: true } },
              routingOperation: { select: { name: true } },
            },
          },
        },
      },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  })
}

function serializeSpcProfile(
  profile: Awaited<ReturnType<typeof getSpcProfileRecords>>[number]
): SpcProfileRow {
  const item = profile.inspectionItem
  const spec = item.inspectionSpec
  return {
    id: profile.id,
    name: profile.name,
    controlChartType: profile.controlChartType,
    isActive: profile.isActive,
    inspectionItemId: item.id,
    inspectionItemName: item.name,
    unit: item.unit,
    lowerLimit: item.lowerLimit == null ? null : Number(item.lowerLimit),
    upperLimit: item.upperLimit == null ? null : Number(item.upperLimit),
    itemCode: spec.item.code,
    itemName: spec.item.name,
    routingOperationName: spec.routingOperation.name,
    specVersion: spec.version,
    createdByName: profile.createdBy.name,
    updatedByName: profile.updatedBy.name,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  }
}

export async function getSpcProfiles(): Promise<SpcProfileRow[]> {
  await assertDaewonFeatureScope()
  await requireRole("VIEWER")
  const tenantId = await getTenantId()
  const records = await getSpcProfileRecords(tenantId)
  return records.map(serializeSpcProfile)
}

export type SpcProfileTargetItem = {
  inspectionItemId: string
  inspectionItemName: string
  unit: string | null
}

export type SpcProfileTargetSpec = {
  inspectionSpecId: string
  itemCode: string
  itemName: string
  routingOperationName: string
  version: string
  items: SpcProfileTargetItem[]
}

/**
 * Profile 등록 화면의 "품목 → 공정 → 검사항목" 선택지.
 * NUMERIC 입력유형 검사항목만 SPC 대상으로 노출한다.
 */
export async function getSpcProfileTargets(): Promise<SpcProfileTargetSpec[]> {
  await assertDaewonFeatureScope()
  await requireRole("VIEWER")
  const tenantId = await getTenantId()

  const specs = await prisma.inspectionSpec.findMany({
    where: { tenantId },
    include: {
      item: { select: { code: true, name: true } },
      routingOperation: { select: { name: true } },
      inspectionItems: {
        where: { inputType: InspectionInputType.NUMERIC },
        orderBy: { seq: "asc" },
        select: { id: true, name: true, unit: true },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return specs
    .filter((spec) => spec.inspectionItems.length > 0)
    .map((spec) => ({
      inspectionSpecId: spec.id,
      itemCode: spec.item.code,
      itemName: spec.item.name,
      routingOperationName: spec.routingOperation.name,
      version: spec.version,
      items: spec.inspectionItems.map((item) => ({
        inspectionItemId: item.id,
        inspectionItemName: item.name,
        unit: item.unit,
      })),
    }))
}

export type CreateSpcProfileInput = {
  name: string
  inspectionItemId: string
}

/** client가 보낸 inspectionItemId는 신뢰하지 않고, tenant 소속 + NUMERIC 여부를 서버에서 재검증한다. */
async function assertNumericInspectionItemInTenant(inspectionItemId: string, tenantId: string) {
  const item = await prisma.inspectionItem.findFirst({
    where: { id: inspectionItemId, inspectionSpec: { tenantId } },
    select: { id: true, inputType: true },
  })
  if (!item) throw new Error("검사항목을 찾을 수 없습니다.")
  if (item.inputType !== InspectionInputType.NUMERIC) {
    throw new Error("SPC Profile은 NUMERIC 입력유형 검사항목에만 등록할 수 있습니다.")
  }
}

export async function createSpcProfile(data: CreateSpcProfileInput): Promise<{ id: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("QUALITY_INSPECTION", "CREATE")
  const actor = await requireRole("MANAGER")
  const tenantId = await getTenantId()
  const name = data.name.trim()
  if (!name) throw new Error("Profile명을 입력해 주세요.")

  await assertNumericInspectionItemInTenant(data.inspectionItemId, tenantId)

  const created = await prisma.$transaction(async (tx) => {
    const profile = await tx.spcProfile.create({
      data: {
        tenantId,
        inspectionItemId: data.inspectionItemId,
        name,
        createdById: actor.id,
        updatedById: actor.id,
      },
    })
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "SpcProfile",
        entityId: profile.id,
        action: "CREATE",
        afterData: { name: profile.name, inspectionItemId: profile.inspectionItemId },
        menuName: "SPC 통계분석",
      },
    })
    return profile
  }).catch((error) => {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002") {
      throw new Error("동일한 검사항목에 같은 이름의 SPC Profile이 이미 존재합니다.")
    }
    throw error
  })

  revalidatePath("/app/mes/spc")
  return { id: created.id }
}

export type UpdateSpcProfileInput = {
  name?: string
  isActive?: boolean
}

export async function updateSpcProfile(id: string, data: UpdateSpcProfileInput) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("QUALITY_INSPECTION", "UPDATE")
  const actor = await requireRole("MANAGER")
  const tenantId = await getTenantId()

  const existing = await prisma.spcProfile.findFirst({ where: { id, tenantId } })
  if (!existing) throw new Error("SPC Profile을 찾을 수 없습니다.")

  const name = data.name !== undefined ? data.name.trim() : undefined
  if (name !== undefined && !name) throw new Error("Profile명을 입력해 주세요.")

  await prisma.$transaction(async (tx) => {
    await tx.spcProfile.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        updatedById: actor.id,
      },
    })
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "SpcProfile",
        entityId: id,
        action: "UPDATE",
        beforeData: { name: existing.name, isActive: existing.isActive },
        afterData: { name: name ?? existing.name, isActive: data.isActive ?? existing.isActive },
        menuName: "SPC 통계분석",
      },
    })
  }).catch((error) => {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002") {
      throw new Error("동일한 검사항목에 같은 이름의 SPC Profile이 이미 존재합니다.")
    }
    throw error
  })

  revalidatePath("/app/mes/spc")
}

export async function deleteSpcProfile(id: string) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("QUALITY_INSPECTION", "DELETE")
  const actor = await requireRole("MANAGER")
  const tenantId = await getTenantId()

  const existing = await prisma.spcProfile.findFirst({ where: { id, tenantId } })
  if (!existing) throw new Error("SPC Profile을 찾을 수 없습니다.")

  await prisma.$transaction(async (tx) => {
    await tx.spcProfile.delete({ where: { id } })
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "SpcProfile",
        entityId: id,
        action: "DELETE",
        beforeData: { name: existing.name },
        menuName: "SPC 통계분석",
      },
    })
  })

  revalidatePath("/app/mes/spc")
}

// ─── 분석 필터 옵션 ───────────────────────────────────────────────────────────

export type SpcFilterOptions = {
  sites: { id: string; name: string }[]
  equipments: { id: string; name: string }[]
}

export async function getSpcFilterOptions(): Promise<SpcFilterOptions> {
  await assertDaewonFeatureScope()
  await requireRole("VIEWER")
  const tenantId = await getTenantId()
  const [sites, equipments] = await Promise.all([
    prisma.site.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.equipment.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ])
  return { sites, equipments }
}

// ─── SPC 분석 ─────────────────────────────────────────────────────────────────

export type SpcAnalysisFilter = {
  spcProfileId: string
  from?: string // YYYY-MM-DD
  to?: string
  siteId?: string
  manufacturingNo?: string
  equipmentId?: string
}

export type SpcMeasurementRow = {
  id: string
  measuredAt: string
  itemCode: string
  itemName: string
  routingOperationName: string
  orderNo: string
  manufacturingNo: string | null
  equipmentName: string | null
  inspectionItemName: string
  sampleNo: number
  numericValue: number
  unit: string | null
  lowerLimit: number | null
  upperLimit: number | null
  judgement: "PASS" | "FAIL" | null
}

export type SpcAnalysisResult = {
  n: number
  specStatus: "CONSISTENT" | "MIXED_SPEC_LIMITS" | "NO_DATA"
  unit: string | null
  lowerLimit: number | null
  upperLimit: number | null
  kpi: {
    mean: number | null
    stdDev: number | null
    specViolationCount: number
    specViolationRate: number | null
  }
  imr: IMRResult
  /** MIXED_SPEC_LIMITS일 때는 null — Cp/Cpk 계산을 중단한다(mean/stdDev는 kpi에서 별도 제공). */
  capability: ProcessCapabilityResult | null
  histogram: HistogramBin[]
  rows: SpcMeasurementRow[]
}

function emptySpcAnalysis(): SpcAnalysisResult {
  return {
    n: 0,
    specStatus: "NO_DATA",
    unit: null,
    lowerLimit: null,
    upperLimit: null,
    kpi: { mean: null, stdDev: null, specViolationCount: 0, specViolationRate: null },
    imr: { status: "INSUFFICIENT_DATA", n: 0 },
    capability: { status: "DATA_INSUFFICIENT", n: 0 },
    histogram: [],
    rows: [],
  }
}

/**
 * 조회기간(KST 달력일)을 검증하고 UTC instant 경계로 변환한다.
 * Vercel 서버는 UTC로 동작하므로 "YYYY-MM-DDT00:00:00.000"처럼 offset 없이
 * 파싱하면 서버 타임존(UTC) 기준으로 해석돼 KST 대비 9시간 어긋난다 — 반드시
 * kstDateKeyToUtcStart/End로 KST 00:00:00.000~23:59:59.999를 명시 변환한다.
 * 형식이 잘못됐거나 from>to면(악의적 쿼리스트링 포함) 조용히 기본 30일 범위로
 * 대체한다 — Prisma에 Invalid Date가 전달되어 페이지 렌더 중 500이 나는 것을 막는다.
 */
function resolveKstDateRange(from?: string, to?: string): { fromDate: Date; toDate: Date; from: string; to: string } {
  const fallback = kstDefaultDateRange(30)
  const fromKey = from?.trim()
  const toKey = to?.trim()

  const bothValid = !!fromKey && !!toKey && isValidKstDateRange(fromKey, toKey)
  const resolved = bothValid ? { from: fromKey!, to: toKey! } : fallback

  return {
    from: resolved.from,
    to: resolved.to,
    fromDate: kstDateKeyToUtcStart(resolved.from),
    toDate: kstDateKeyToUtcEnd(resolved.to),
  }
}

export async function getSpcAnalysis(filter: SpcAnalysisFilter): Promise<SpcAnalysisResult> {
  await assertDaewonFeatureScope()
  await requireRole("VIEWER")
  const tenantId = await getTenantId()
  if (!filter.spcProfileId) return emptySpcAnalysis()

  const profile = await prisma.spcProfile.findFirst({
    where: { id: filter.spcProfileId, tenantId },
    select: { inspectionItemId: true },
  })
  if (!profile) return emptySpcAnalysis()

  const { fromDate, toDate } = resolveKstDateRange(filter.from, filter.to)

  const workOrderOperationWhere: Record<string, unknown> = {}
  if (filter.equipmentId) workOrderOperationWhere.equipmentId = filter.equipmentId
  const workOrderWhere: Record<string, unknown> = {}
  if (filter.siteId) workOrderWhere.siteId = filter.siteId
  if (filter.manufacturingNo?.trim()) workOrderWhere.manufacturingNo = filter.manufacturingNo.trim()
  if (Object.keys(workOrderWhere).length > 0) workOrderOperationWhere.workOrder = workOrderWhere

  const measurements = await prisma.inspectionMeasurement.findMany({
    where: {
      tenantId,
      inspectionItemId: profile.inspectionItemId,
      numericValue: { not: null },
      measuredAt: { gte: fromDate, lte: toDate },
      ...(Object.keys(workOrderOperationWhere).length > 0 && {
        qualityInspection: { workOrderOperation: workOrderOperationWhere },
      }),
    },
    select: {
      id: true,
      measuredAt: true,
      sampleNo: true,
      numericValue: true,
      lowerLimitSnapshot: true,
      upperLimitSnapshot: true,
      unitSnapshot: true,
      itemNameSnapshot: true,
      judgement: true,
      qualityInspectionId: true,
      qualityInspection: {
        select: {
          workOrderOperation: {
            select: {
              equipment: { select: { name: true } },
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
    orderBy: [
      { measuredAt: "asc" },
      { qualityInspectionId: "asc" },
      { sampleNo: "asc" },
      { id: "asc" },
    ],
  })

  if (measurements.length === 0) return emptySpcAnalysis()

  // ─── snapshot 규격 일관성 확인(혼합 시 계산 중단, 표시만) ─────────────────
  const specKeySet = new Set(
    measurements.map((m) => `${m.lowerLimitSnapshot?.toString() ?? "null"}|${m.upperLimitSnapshot?.toString() ?? "null"}`)
  )
  const specStatus: SpcAnalysisResult["specStatus"] = specKeySet.size > 1 ? "MIXED_SPEC_LIMITS" : "CONSISTENT"

  const first = measurements[0]
  const lowerLimit = specStatus === "CONSISTENT" && first.lowerLimitSnapshot != null ? Number(first.lowerLimitSnapshot) : null
  const upperLimit = specStatus === "CONSISTENT" && first.upperLimitSnapshot != null ? Number(first.upperLimitSnapshot) : null
  const unit = first.unitSnapshot

  const values = measurements.map((m) => Number(m.numericValue))
  const failCount = measurements.filter((m) => m.judgement === "FAIL").length

  const rows: SpcMeasurementRow[] = measurements.map((m) => {
    const woOp = m.qualityInspection.workOrderOperation
    return {
      id: m.id,
      measuredAt: m.measuredAt.toISOString(),
      itemCode: woOp.workOrder.item.code,
      itemName: woOp.workOrder.item.name,
      routingOperationName: woOp.routingOperation.name,
      orderNo: woOp.workOrder.orderNo,
      manufacturingNo: woOp.workOrder.manufacturingNo,
      equipmentName: woOp.equipment?.name ?? null,
      inspectionItemName: m.itemNameSnapshot,
      sampleNo: m.sampleNo,
      numericValue: Number(m.numericValue),
      unit: m.unitSnapshot,
      lowerLimit: m.lowerLimitSnapshot == null ? null : Number(m.lowerLimitSnapshot),
      upperLimit: m.upperLimitSnapshot == null ? null : Number(m.upperLimitSnapshot),
      judgement: m.judgement,
    }
  })

  // capability(Cp/Cpk)는 규격 snapshot이 섞이면 중단하지만, mean/stdDev는
  // 규격과 무관한 순수 측정값 통계이므로 항상 별도로 계산해 KPI에 제공한다.
  const capability =
    specStatus === "MIXED_SPEC_LIMITS" ? null : calculateProcessCapability(values, lowerLimit, upperLimit)
  const meanValue = mean(values)
  const stdDevValue = values.length >= 2 ? sampleStandardDeviation(values) : null

  return {
    n: values.length,
    specStatus,
    unit,
    lowerLimit,
    upperLimit,
    kpi: {
      mean: meanValue,
      stdDev: stdDevValue,
      specViolationCount: failCount,
      specViolationRate: values.length > 0 ? failCount / values.length : null,
    },
    imr: calculateIMRLimits(values),
    capability,
    histogram: buildHistogram(values),
    rows,
  }
}
