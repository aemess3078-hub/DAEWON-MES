"use server"

import { Prisma, type PermissionAction } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { CurrentUser } from "@/lib/auth"
import {
  ROLE_PERMISSION_DENIED_MESSAGE,
  canReadMenuCode,
  getCurrentPermissionSnapshot,
  getResourcePermissionFlags,
  requireResourcePermission,
} from "@/lib/auth/role-permissions"
import { recordAuditLog } from "@/lib/audit-log"
import { prisma } from "@/lib/db/prisma"
import {
  USAGE_STATUS_LABELS,
  computeNextCalibrationDate,
  dateKeyToDate,
  dateToKey,
  isValidDateKey,
  normalizeManagementNo,
  summarizeCalibrations,
  todayDateKey,
  type CalibrationRecordLike,
  type InstrumentUsageStatusValue,
} from "@/lib/instrument-calibration"
import {
  buildImportPlan,
  classifyImportPlan,
  summarizeImportPlan,
  type ImportIssue,
  type ImportPlanSummary,
  type PlannedCalibration,
  type PlannedInstrument,
} from "@/lib/instrument-calibration-import"
import {
  CALIBRATION_EXPORT_HEADER,
  INSTRUMENT_EXPORT_HEADER,
  buildViewRows,
  filterCalibrationRows,
  filterInstrumentRows,
  toCalibrationExportRows,
  toInstrumentExportRows,
  type ActionResult,
  type CalibrationFilters,
  type CalibrationRow,
  type ExportCell,
  type InstrumentFilters,
  type InstrumentRow,
  type RawCalibration,
  type RawInstrument,
} from "@/lib/instrument-calibration-view"

// ─── 공통 ─────────────────────────────────────────────────────────────────────

const RESOURCE = "INSTRUMENT_CALIBRATION"
const MENU_NAME = "계측기 검교정관리"
const PAGE_PATH = "/app/mes/quality/calibration"

/** 사용자에게 그대로 보여줄 수 있는 오류 */
class UserFacingError extends Error {}

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message }
}

function toFailure(error: unknown): { ok: false; error: string } {
  if (error instanceof UserFacingError) return fail(error.message)
  if (error instanceof z.ZodError) return fail(error.issues[0]?.message ?? "입력값이 올바르지 않습니다.")
  if (error instanceof Error) {
    if (error.message === ROLE_PERMISSION_DENIED_MESSAGE) return fail(ROLE_PERMISSION_DENIED_MESSAGE)
    if (error.message === "UNAUTHORIZED") return fail("로그인이 필요합니다. 다시 로그인해 주세요.")
    if (error.message === "FORBIDDEN") return fail(ROLE_PERMISSION_DENIED_MESSAGE)
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return fail("이미 등록된 값과 중복됩니다. 관리번호/성적서번호를 확인해 주세요.")
    if (error.code === "P2021" || error.code === "P2022") {
      return fail("계측기 검교정 테이블이 아직 준비되지 않았습니다. DB 마이그레이션 적용 후 다시 시도해 주세요.")
    }
  }
  console.error("[instrument-calibration]", error)
  return fail("처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.")
}

async function requirePermission(action: PermissionAction): Promise<CurrentUser> {
  return requireResourcePermission(RESOURCE, action)
}

/** 조회 권한: 메뉴 접근 정책(canReadMenuCode)과 동일 — 권한이 구성된 역할은 READ 허용 필요 */
async function requireRead(): Promise<CurrentUser> {
  const snapshot = await getCurrentPermissionSnapshot()
  if (!snapshot) throw new Error("UNAUTHORIZED")
  if (!canReadMenuCode(snapshot, "calibration")) throw new Error(ROLE_PERMISSION_DENIED_MESSAGE)
  return snapshot.user
}

function text(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim()
  return trimmed ? trimmed.slice(0, max) : null
}

const optionalText = (max: number) =>
  z
    .string()
    .max(max, `${max}자를 초과할 수 없습니다.`)
    .nullish()
    .transform((v) => text(v, max))

const dateKeySchema = z
  .string()
  .refine((v) => isValidDateKey(v), "날짜 형식(YYYY-MM-DD)이 올바르지 않습니다.")

const optionalDateKey = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isValidDateKey(v), "날짜 형식(YYYY-MM-DD)이 올바르지 않습니다.")

type Tx = Prisma.TransactionClient

// ─── 조회 ─────────────────────────────────────────────────────────────────────

const instrumentInclude = {
  manager: { select: { name: true } },
  calibrations: { include: { manager: { select: { name: true } } } },
} satisfies Prisma.MeasuringInstrumentInclude

type InstrumentWithRelations = Prisma.MeasuringInstrumentGetPayload<{ include: typeof instrumentInclude }>

function toRawCalibration(c: InstrumentWithRelations["calibrations"][number]): RawCalibration {
  return {
    id: c.id,
    progressStatus: c.progressStatus,
    plannedDate: dateToKey(c.plannedDate),
    calibrationDate: dateToKey(c.calibrationDate),
    agency: c.calibrationAgency,
    certificateNo: c.certificateNo,
    result: c.result,
    nextCalibrationDate: dateToKey(c.nextCalibrationDate),
    nextDateOverridden: c.nextDateOverridden,
    nextDateChangeReason: c.nextDateChangeReason,
    cost: c.calibrationCost === null ? null : Number(c.calibrationCost),
    managerId: c.managerId,
    managerName: c.manager?.name ?? null,
    remarks: c.remarks,
    source: c.source,
    sourceRef: c.sourceRef,
    cancelledAt: c.cancelledAt ? c.cancelledAt.toISOString() : null,
    cancelReason: c.cancelReason,
    createdAtMs: c.createdAt.getTime(),
  }
}

function toRawInstrument(i: InstrumentWithRelations): RawInstrument {
  return {
    id: i.id,
    managementNo: i.managementNo,
    name: i.name,
    category: i.category,
    specification: i.specification,
    serialNo: i.serialNo,
    manufacturer: i.manufacturer,
    calibrationRequired: i.calibrationRequired,
    calibrationIntervalMonths: i.calibrationIntervalMonths,
    department: i.department,
    location: i.location,
    managerId: i.managerId,
    managerName: i.manager?.name ?? null,
    usageStatus: i.usageStatus,
    lastCalibrationDate: dateToKey(i.lastCalibrationDate),
    nextCalibrationDate: dateToKey(i.nextCalibrationDate),
    currentCalibrationId: i.currentCalibrationId,
    remarks: i.remarks,
    source: i.source,
    sourceRef: i.sourceRef,
    calibrations: i.calibrations.map(toRawCalibration),
  }
}

async function loadViewRows(tenantId: string) {
  const instruments = await prisma.measuringInstrument.findMany({
    where: { tenantId, deletedAt: null },
    include: instrumentInclude,
  })
  return buildViewRows(instruments.map(toRawInstrument), todayDateKey())
}

export type CalibrationOverview = {
  asOf: string
  instruments: InstrumentRow[]
  calibrations: CalibrationRow[]
  profiles: Array<{ id: string; name: string }>
  permissions: { canCreate: boolean; canUpdate: boolean; canDelete: boolean; canExport: boolean }
}

export async function getCalibrationOverview(): Promise<ActionResult<CalibrationOverview>> {
  try {
    const user = await requireRead()
    const snapshot = await getCurrentPermissionSnapshot(user)
    const flags = getResourcePermissionFlags(snapshot, RESOURCE)
    const [rows, tenantUsers] = await Promise.all([
      loadViewRows(user.tenantId),
      prisma.tenantUser.findMany({
        where: { tenantId: user.tenantId, isActive: true },
        select: { profile: { select: { id: true, name: true } } },
      }),
    ])
    const profiles = tenantUsers
      .map((tu) => tu.profile)
      .sort((a, b) => a.name.localeCompare(b.name, "ko"))
    return {
      ok: true,
      data: {
        asOf: todayDateKey(),
        instruments: rows.instruments,
        calibrations: rows.calibrations,
        profiles,
        permissions: {
          canCreate: flags.canCreate,
          canUpdate: flags.canUpdate,
          canDelete: flags.canDelete,
          canExport: flags.canExport,
        },
      },
    }
  } catch (error) {
    return toFailure(error)
  }
}

export type StatusHistoryRow = {
  id: string
  previousStatus: InstrumentUsageStatusValue | null
  newStatus: InstrumentUsageStatusValue
  reason: string
  changedByName: string
  changedAt: string
}

export type ChangeLogRow = {
  id: string
  actedAt: string
  actor: string
  target: string
  action: string
  changedFields: string[]
  reason: string
}

export type InstrumentDetailExtras = {
  statusHistory: StatusHistoryRow[]
  changeLog: ChangeLogRow[]
}

const FIELD_LABELS: Record<string, string> = {
  name: "계측기명",
  category: "분류",
  specification: "규격",
  serialNo: "Serial No",
  manufacturer: "제조사",
  calibrationRequired: "교정대상",
  calibrationIntervalMonths: "교정주기",
  department: "사용부서",
  location: "사용장소",
  managerId: "관리책임자",
  usageStatus: "사용상태",
  remarks: "비고",
  calibrationDate: "교정실시일",
  calibrationAgency: "교정기관",
  certificateNo: "성적서번호",
  result: "교정결과",
  nextCalibrationDate: "차기교정일",
  nextDateChangeReason: "차기교정일 수정사유",
  calibrationCost: "교정비용",
  cancelledAt: "취소",
  progressStatus: "진행상태",
  plannedDate: "예정일",
}

export async function getInstrumentDetailExtras(instrumentId: string): Promise<ActionResult<InstrumentDetailExtras>> {
  try {
    const user = await requireRead()
    const instrument = await prisma.measuringInstrument.findFirst({
      where: { id: instrumentId, tenantId: user.tenantId },
      select: { id: true, calibrations: { select: { id: true } } },
    })
    if (!instrument) return fail("계측기를 찾을 수 없습니다.")

    const calibrationIds = instrument.calibrations.map((c) => c.id)
    const [histories, logs] = await Promise.all([
      prisma.instrumentStatusHistory.findMany({
        where: { tenantId: user.tenantId, instrumentId },
        orderBy: { changedAt: "desc" },
        take: 50,
      }),
      prisma.auditLog.findMany({
        where: {
          tenantId: user.tenantId,
          OR: [
            { entityType: "MeasuringInstrument", entityId: instrumentId },
            { entityType: "InstrumentCalibration", entityId: { in: calibrationIds } },
          ],
        },
        orderBy: { actedAt: "desc" },
        take: 50,
      }),
    ])

    const changerIds = Array.from(new Set(histories.map((h) => h.changedById).filter((v): v is string => Boolean(v))))
    const changers = changerIds.length
      ? await prisma.profile.findMany({ where: { id: { in: changerIds } }, select: { id: true, name: true } })
      : []
    const nameById = new Map(changers.map((p) => [p.id, p.name]))

    return {
      ok: true,
      data: {
        statusHistory: histories.map((h) => ({
          id: h.id,
          previousStatus: h.previousStatus,
          newStatus: h.newStatus,
          reason: h.reason ?? "",
          changedByName: h.changedById ? (nameById.get(h.changedById) ?? "") : "",
          changedAt: h.changedAt.toISOString(),
        })),
        changeLog: logs.map((log) => {
          const after = (log.afterData ?? {}) as Record<string, unknown>
          const before = (log.beforeData ?? {}) as Record<string, unknown>
          const keys = Object.keys(after).filter((k) => k in FIELD_LABELS && JSON.stringify(after[k]) !== JSON.stringify(before[k]))
          return {
            id: log.id,
            actedAt: log.actedAt.toISOString(),
            actor: log.actorLabel ?? "",
            target: log.entityType === "InstrumentCalibration" ? "교정이력" : "계측기",
            action: log.action,
            changedFields: keys.map((k) => FIELD_LABELS[k]),
            reason: typeof after.reason === "string" ? after.reason : "",
          }
        }),
      },
    }
  } catch (error) {
    return toFailure(error)
  }
}

// ─── 계측기 등록/수정/상태/삭제 ───────────────────────────────────────────────

const MANAGEMENT_NO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,49}$/

const usageStatusSchema = z.enum(["AVAILABLE", "SUSPENDED", "ON_HOLD", "DISPOSED"])

const instrumentFieldsSchema = z.object({
  name: z.string().trim().min(1, "계측기명을 입력해 주세요.").max(200, "계측기명은 200자를 초과할 수 없습니다."),
  category: optionalText(100),
  specification: optionalText(200),
  serialNo: optionalText(100),
  manufacturer: optionalText(100),
  calibrationRequired: z.boolean(),
  calibrationIntervalMonths: z
    .number()
    .int("교정주기는 정수(개월)로 입력해 주세요.")
    .min(1, "교정주기는 1개월 이상이어야 합니다.")
    .max(360, "교정주기는 360개월 이하여야 합니다.")
    .nullish()
    .transform((v) => v ?? null),
  department: optionalText(100),
  location: optionalText(100),
  managerId: z.string().nullish().transform((v) => v || null),
  remarks: optionalText(500),
})

const createInstrumentSchema = instrumentFieldsSchema.extend({
  managementNo: z
    .string()
    .trim()
    .regex(MANAGEMENT_NO_PATTERN, "관리번호는 영문·숫자·-·_·. 만 사용할 수 있습니다(최대 50자)."),
  usageStatus: usageStatusSchema.default("AVAILABLE"),
})

const updateInstrumentSchema = instrumentFieldsSchema.extend({
  usageStatus: usageStatusSchema,
  statusReason: optionalText(300),
})

export type InstrumentInput = z.input<typeof createInstrumentSchema>
export type InstrumentUpdateInput = z.input<typeof updateInstrumentSchema>

async function assertManager(tx: Tx | typeof prisma, tenantId: string, managerId: string | null) {
  if (!managerId) return
  const member = await tx.tenantUser.findFirst({ where: { tenantId, profileId: managerId, isActive: true }, select: { id: true } })
  if (!member) throw new UserFacingError("선택한 담당자를 찾을 수 없습니다.")
}

function auditSnapshot(i: {
  managementNo?: string
  name: string
  category: string | null
  specification: string | null
  serialNo: string | null
  manufacturer: string | null
  calibrationRequired: boolean
  calibrationIntervalMonths: number | null
  department: string | null
  location: string | null
  managerId: string | null
  usageStatus: string
  remarks: string | null
}) {
  return {
    managementNo: i.managementNo,
    name: i.name,
    category: i.category,
    specification: i.specification,
    serialNo: i.serialNo,
    manufacturer: i.manufacturer,
    calibrationRequired: i.calibrationRequired,
    calibrationIntervalMonths: i.calibrationIntervalMonths,
    department: i.department,
    location: i.location,
    managerId: i.managerId,
    usageStatus: i.usageStatus,
    remarks: i.remarks,
  }
}

async function addStatusHistory(
  tx: Tx,
  params: {
    tenantId: string
    instrumentId: string
    previous: InstrumentUsageStatusValue | null
    next: InstrumentUsageStatusValue
    reason: string | null
    actorId: string | null
  },
) {
  await tx.instrumentStatusHistory.create({
    data: {
      tenantId: params.tenantId,
      instrumentId: params.instrumentId,
      previousStatus: params.previous,
      newStatus: params.next,
      reason: params.reason,
      changedById: params.actorId,
    },
  })
}

export async function createInstrument(input: InstrumentInput): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission("CREATE")
    const data = createInstrumentSchema.parse(input)
    if (data.usageStatus === "DISPOSED") await requirePermission("DELETE")

    const duplicate = await prisma.measuringInstrument.findFirst({
      where: { tenantId: actor.tenantId, managementNo: { equals: data.managementNo, mode: "insensitive" } },
      select: { managementNo: true, deletedAt: true },
    })
    if (duplicate) {
      throw new UserFacingError(
        duplicate.deletedAt
          ? `관리번호 '${duplicate.managementNo}'은(는) 삭제 처리된 계측기가 사용하던 번호입니다. 다른 번호를 사용해 주세요.`
          : `관리번호 '${duplicate.managementNo}'은(는) 이미 등록되어 있습니다.`,
      )
    }

    const created = await prisma.$transaction(async (tx) => {
      await assertManager(tx, actor.tenantId, data.managerId)
      const row = await tx.measuringInstrument.create({
        data: {
          tenantId: actor.tenantId,
          managementNo: data.managementNo,
          name: data.name,
          category: data.category,
          specification: data.specification,
          serialNo: data.serialNo,
          manufacturer: data.manufacturer,
          calibrationRequired: data.calibrationRequired,
          calibrationIntervalMonths: data.calibrationRequired ? data.calibrationIntervalMonths : null,
          department: data.department,
          location: data.location,
          managerId: data.managerId,
          usageStatus: data.usageStatus,
          remarks: data.remarks,
          source: "MANUAL",
          createdById: actor.profileId,
        },
      })
      await addStatusHistory(tx, {
        tenantId: actor.tenantId,
        instrumentId: row.id,
        previous: null,
        next: row.usageStatus,
        reason: "신규 등록",
        actorId: actor.profileId,
      })
      await recordAuditLog(tx, {
        tenantId: actor.tenantId,
        actor,
        entityType: "MeasuringInstrument",
        entityId: row.id,
        action: "CREATE",
        afterData: auditSnapshot(row),
        menuName: MENU_NAME,
      })
      return row
    })

    revalidatePath(PAGE_PATH)
    return { ok: true, data: { id: created.id } }
  } catch (error) {
    return toFailure(error)
  }
}

export async function updateInstrument(id: string, input: InstrumentUpdateInput): Promise<ActionResult> {
  try {
    const actor = await requirePermission("UPDATE")
    const data = updateInstrumentSchema.parse(input)

    await prisma.$transaction(async (tx) => {
      const before = await tx.measuringInstrument.findFirst({ where: { id, tenantId: actor.tenantId, deletedAt: null } })
      if (!before) throw new UserFacingError("계측기를 찾을 수 없습니다.")
      await assertManager(tx, actor.tenantId, data.managerId)

      const statusChanged = before.usageStatus !== data.usageStatus
      if (statusChanged) {
        // 폐기 처리 및 폐기 해제는 삭제 권한(관리자)이 필요하다.
        if (data.usageStatus === "DISPOSED" || before.usageStatus === "DISPOSED") await requirePermission("DELETE")
        if (!data.statusReason) throw new UserFacingError("사용상태를 변경하는 경우 변경 사유를 입력해 주세요.")
      }

      const updated = await tx.measuringInstrument.update({
        where: { id },
        data: {
          name: data.name,
          category: data.category,
          specification: data.specification,
          serialNo: data.serialNo,
          manufacturer: data.manufacturer,
          calibrationRequired: data.calibrationRequired,
          calibrationIntervalMonths: data.calibrationRequired ? data.calibrationIntervalMonths : null,
          department: data.department,
          location: data.location,
          managerId: data.managerId,
          usageStatus: data.usageStatus,
          remarks: data.remarks,
        },
      })
      if (statusChanged) {
        await addStatusHistory(tx, {
          tenantId: actor.tenantId,
          instrumentId: id,
          previous: before.usageStatus,
          next: data.usageStatus,
          reason: data.statusReason,
          actorId: actor.profileId,
        })
      }
      await recordAuditLog(tx, {
        tenantId: actor.tenantId,
        actor,
        entityType: "MeasuringInstrument",
        entityId: id,
        action: "UPDATE",
        beforeData: auditSnapshot(before),
        afterData: { ...auditSnapshot(updated), reason: data.statusReason },
        menuName: MENU_NAME,
      })
    })

    revalidatePath(PAGE_PATH)
    return { ok: true, data: undefined }
  } catch (error) {
    return toFailure(error)
  }
}

/** 소프트 삭제. 교정이력이 있는 계측기는 삭제할 수 없고 폐기 처리해야 한다(이력 보존). */
export async function deleteInstrument(id: string, reason: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission("DELETE")
    const trimmed = text(reason, 300)
    if (!trimmed) throw new UserFacingError("삭제 사유를 입력해 주세요.")

    await prisma.$transaction(async (tx) => {
      const before = await tx.measuringInstrument.findFirst({ where: { id, tenantId: actor.tenantId, deletedAt: null } })
      if (!before) throw new UserFacingError("계측기를 찾을 수 없습니다.")
      const historyCount = await tx.instrumentCalibration.count({ where: { tenantId: actor.tenantId, instrumentId: id } })
      if (historyCount > 0) {
        throw new UserFacingError("교정이력이 있는 계측기는 삭제할 수 없습니다. 사용상태를 '폐기'로 변경해 주세요(이력은 보존됩니다).")
      }
      await tx.measuringInstrument.update({ where: { id }, data: { deletedAt: new Date() } })
      await recordAuditLog(tx, {
        tenantId: actor.tenantId,
        actor,
        entityType: "MeasuringInstrument",
        entityId: id,
        action: "DELETE",
        beforeData: auditSnapshot(before),
        afterData: { reason: trimmed, deleted: true },
        menuName: MENU_NAME,
      })
    })

    revalidatePath(PAGE_PATH)
    return { ok: true, data: undefined }
  } catch (error) {
    return toFailure(error)
  }
}

// ─── 교정 실적 ────────────────────────────────────────────────────────────────

const calibrationFieldsSchema = z.object({
  calibrationDate: dateKeySchema,
  calibrationAgency: optionalText(100),
  certificateNo: optionalText(100),
  result: z.enum(["PASS", "FAIL"]),
  /** 비우면 교정실시일 + 교정주기로 자동 계산한다. 값을 직접 입력하면(자동계산값과 다르면) 수정 사유가 필요하다. */
  nextCalibrationDate: optionalDateKey,
  nextDateChangeReason: optionalText(300),
  calibrationCost: z
    .number()
    .min(0, "교정비용은 0 이상이어야 합니다.")
    .max(9_999_999_999, "교정비용이 너무 큽니다.")
    .nullish()
    .transform((v) => v ?? null),
  managerId: z.string().nullish().transform((v) => v || null),
  remarks: optionalText(500),
})

const registerCalibrationSchema = calibrationFieldsSchema.extend({
  instrumentId: z.string().min(1),
  /** 예정/진행중 이력을 완료 처리하는 경우 해당 id */
  openCalibrationId: z.string().nullish().transform((v) => v || null),
})

export type RegisterCalibrationInput = z.input<typeof registerCalibrationSchema>
export type UpdateCalibrationInput = z.input<typeof calibrationFieldsSchema>

type ResolvedNextDate = { nextCalibrationDate: string | null; overridden: boolean; reason: string | null }

function resolveNextDate(
  fields: z.output<typeof calibrationFieldsSchema>,
  intervalMonths: number | null,
  calibrationRequired: boolean,
): ResolvedNextDate {
  const today = todayDateKey()
  if (fields.calibrationDate > today) throw new UserFacingError("교정실시일은 오늘 이후로 등록할 수 없습니다.")
  if (!calibrationRequired) throw new UserFacingError("교정대상에서 제외된 계측기에는 교정 실적을 등록할 수 없습니다.")

  // 부적합: 정상 교정 완료로 보지 않으므로 차기교정일을 부여하지 않는다.
  if (fields.result === "FAIL") return { nextCalibrationDate: null, overridden: false, reason: null }

  const computed = computeNextCalibrationDate(fields.calibrationDate, intervalMonths)
  const next = fields.nextCalibrationDate ?? computed
  if (!next) {
    throw new UserFacingError("교정주기가 설정되지 않아 차기교정일을 계산할 수 없습니다. 차기교정일을 직접 입력하거나 계측기의 교정주기를 먼저 지정해 주세요.")
  }
  if (next < fields.calibrationDate) throw new UserFacingError("차기교정일은 교정실시일보다 빠를 수 없습니다.")
  const overridden = computed !== null ? next !== computed : true
  if (overridden && !fields.nextDateChangeReason) {
    throw new UserFacingError("차기교정일을 자동계산값과 다르게 지정한 경우 수정 사유를 입력해 주세요.")
  }
  return { nextCalibrationDate: next, overridden, reason: overridden ? fields.nextDateChangeReason : null }
}

/** 교정이력에서 계측기 요약(최근교정일/차기교정일/현재 교정)을 다시 계산해 마스터에 반영한다. */
async function refreshInstrumentSummary(tx: Tx, tenantId: string, instrumentId: string) {
  const records = await tx.instrumentCalibration.findMany({
    where: { tenantId, instrumentId },
    select: {
      id: true,
      progressStatus: true,
      calibrationDate: true,
      nextCalibrationDate: true,
      result: true,
      cancelledAt: true,
      createdAt: true,
    },
  })
  const likes: CalibrationRecordLike[] = records.map((r) => ({
    id: r.id,
    progressStatus: r.progressStatus,
    calibrationDate: dateToKey(r.calibrationDate),
    nextCalibrationDate: dateToKey(r.nextCalibrationDate),
    result: r.result,
    cancelled: r.cancelledAt !== null,
    createdAtMs: r.createdAt.getTime(),
  }))
  const summary = summarizeCalibrations(likes)
  await tx.measuringInstrument.update({
    where: { id: instrumentId },
    data: {
      currentCalibrationId: summary.currentCalibrationId,
      lastCalibrationDate: summary.lastCalibrationDate ? dateKeyToDate(summary.lastCalibrationDate) : null,
      nextCalibrationDate: summary.nextCalibrationDate ? dateKeyToDate(summary.nextCalibrationDate) : null,
    },
  })
  return summary
}

/**
 * 가장 최근 교정이 부적합이면 사용가능 상태를 유지하지 않는다(사용중지로 전환).
 * 이후 정상 교정을 등록해도 사용가능으로 자동 복귀하지 않으며, 관리자가 사유와 함께 직접 변경해야 한다.
 */
async function suspendIfLatestFailed(
  tx: Tx,
  params: {
    tenantId: string
    instrumentId: string
    latestResult: "PASS" | "FAIL" | null
    certificateNo: string | null
    actorId: string
  },
) {
  if (params.latestResult !== "FAIL") return
  const instrument = await tx.measuringInstrument.findUnique({
    where: { id: params.instrumentId },
    select: { usageStatus: true },
  })
  if (!instrument || instrument.usageStatus !== "AVAILABLE") return
  await tx.measuringInstrument.update({ where: { id: params.instrumentId }, data: { usageStatus: "SUSPENDED" } })
  await addStatusHistory(tx, {
    tenantId: params.tenantId,
    instrumentId: params.instrumentId,
    previous: "AVAILABLE",
    next: "SUSPENDED",
    reason: `교정 부적합 판정${params.certificateNo ? ` (성적서 ${params.certificateNo})` : ""}`,
    actorId: params.actorId,
  })
}

async function assertNoDuplicateCertificate(
  tx: Tx,
  tenantId: string,
  instrumentId: string,
  certificateNo: string | null,
  excludeId: string | null,
) {
  if (!certificateNo) return
  const duplicate = await tx.instrumentCalibration.findFirst({
    where: {
      tenantId,
      instrumentId,
      cancelledAt: null,
      progressStatus: "COMPLETED",
      certificateNo: { equals: certificateNo, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  })
  if (duplicate) throw new UserFacingError(`성적서번호 '${certificateNo}'은(는) 이 계측기에 이미 등록되어 있습니다.`)
}

function calibrationAudit(c: {
  progressStatus: string
  calibrationDate: Date | null
  calibrationAgency: string | null
  certificateNo: string | null
  result: string | null
  nextCalibrationDate: Date | null
  nextDateChangeReason: string | null
  calibrationCost: Prisma.Decimal | number | null
  managerId: string | null
  remarks: string | null
  cancelledAt?: Date | null
}) {
  return {
    progressStatus: c.progressStatus,
    calibrationDate: dateToKey(c.calibrationDate),
    calibrationAgency: c.calibrationAgency,
    certificateNo: c.certificateNo,
    result: c.result,
    nextCalibrationDate: dateToKey(c.nextCalibrationDate),
    nextDateChangeReason: c.nextDateChangeReason,
    calibrationCost: c.calibrationCost === null ? null : Number(c.calibrationCost),
    managerId: c.managerId,
    remarks: c.remarks,
    cancelledAt: c.cancelledAt ? c.cancelledAt.toISOString() : null,
  }
}

export async function registerCalibration(input: RegisterCalibrationInput): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission("CREATE")
    const data = registerCalibrationSchema.parse(input)

    const id = await prisma.$transaction(async (tx) => {
      const instrument = await tx.measuringInstrument.findFirst({
        where: { id: data.instrumentId, tenantId: actor.tenantId, deletedAt: null },
      })
      if (!instrument) throw new UserFacingError("계측기를 찾을 수 없습니다.")
      if (instrument.usageStatus === "DISPOSED") throw new UserFacingError("폐기된 계측기에는 교정 실적을 등록할 수 없습니다.")

      const next = resolveNextDate(data, instrument.calibrationIntervalMonths, instrument.calibrationRequired)
      await assertManager(tx, actor.tenantId, data.managerId)
      await assertNoDuplicateCertificate(tx, actor.tenantId, instrument.id, data.certificateNo, data.openCalibrationId)

      const values = {
        progressStatus: "COMPLETED" as const,
        calibrationDate: dateKeyToDate(data.calibrationDate),
        calibrationAgency: data.calibrationAgency,
        certificateNo: data.certificateNo,
        result: data.result,
        nextCalibrationDate: next.nextCalibrationDate ? dateKeyToDate(next.nextCalibrationDate) : null,
        nextDateOverridden: next.overridden,
        nextDateChangeReason: next.reason,
        calibrationCost: data.calibrationCost,
        managerId: data.managerId,
        remarks: data.remarks,
      }

      let record
      if (data.openCalibrationId) {
        const open = await tx.instrumentCalibration.findFirst({
          where: {
            id: data.openCalibrationId,
            tenantId: actor.tenantId,
            instrumentId: instrument.id,
            cancelledAt: null,
            progressStatus: { not: "COMPLETED" },
          },
        })
        if (!open) throw new UserFacingError("완료 처리할 교정 일정을 찾을 수 없습니다.")
        record = await tx.instrumentCalibration.update({ where: { id: open.id }, data: values })
      } else {
        record = await tx.instrumentCalibration.create({
          data: { ...values, tenantId: actor.tenantId, instrumentId: instrument.id, source: "MANUAL", createdById: actor.profileId },
        })
      }

      const summary = await refreshInstrumentSummary(tx, actor.tenantId, instrument.id)
      await suspendIfLatestFailed(tx, {
        tenantId: actor.tenantId,
        instrumentId: instrument.id,
        latestResult: summary.latestResult,
        certificateNo: data.certificateNo,
        actorId: actor.profileId,
      })
      await recordAuditLog(tx, {
        tenantId: actor.tenantId,
        actor,
        entityType: "InstrumentCalibration",
        entityId: record.id,
        action: "CREATE",
        afterData: { managementNo: instrument.managementNo, ...calibrationAudit(record) },
        menuName: MENU_NAME,
      })
      return record.id
    })

    revalidatePath(PAGE_PATH)
    return { ok: true, data: { id } }
  } catch (error) {
    return toFailure(error)
  }
}

export async function updateCalibration(id: string, input: UpdateCalibrationInput): Promise<ActionResult> {
  try {
    const actor = await requirePermission("UPDATE")
    const data = calibrationFieldsSchema.parse(input)

    await prisma.$transaction(async (tx) => {
      const before = await tx.instrumentCalibration.findFirst({
        where: { id, tenantId: actor.tenantId },
        include: { instrument: true },
      })
      if (!before) throw new UserFacingError("교정이력을 찾을 수 없습니다.")
      if (before.cancelledAt) throw new UserFacingError("취소된 교정이력은 수정할 수 없습니다.")
      if (before.progressStatus !== "COMPLETED") throw new UserFacingError("완료되지 않은 교정 일정은 '교정 실적 등록'으로 완료 처리해 주세요.")
      if (before.instrument.deletedAt) throw new UserFacingError("삭제된 계측기의 이력은 수정할 수 없습니다.")

      const next = resolveNextDate(data, before.instrument.calibrationIntervalMonths, before.instrument.calibrationRequired)
      await assertManager(tx, actor.tenantId, data.managerId)
      await assertNoDuplicateCertificate(tx, actor.tenantId, before.instrumentId, data.certificateNo, id)

      const updated = await tx.instrumentCalibration.update({
        where: { id },
        data: {
          calibrationDate: dateKeyToDate(data.calibrationDate),
          calibrationAgency: data.calibrationAgency,
          certificateNo: data.certificateNo,
          result: data.result,
          nextCalibrationDate: next.nextCalibrationDate ? dateKeyToDate(next.nextCalibrationDate) : null,
          nextDateOverridden: next.overridden,
          nextDateChangeReason: next.reason,
          calibrationCost: data.calibrationCost,
          managerId: data.managerId,
          remarks: data.remarks,
        },
      })
      const summary = await refreshInstrumentSummary(tx, actor.tenantId, before.instrumentId)
      await suspendIfLatestFailed(tx, {
        tenantId: actor.tenantId,
        instrumentId: before.instrumentId,
        latestResult: summary.latestResult,
        certificateNo: data.certificateNo,
        actorId: actor.profileId,
      })
      await recordAuditLog(tx, {
        tenantId: actor.tenantId,
        actor,
        entityType: "InstrumentCalibration",
        entityId: id,
        action: "UPDATE",
        beforeData: { managementNo: before.instrument.managementNo, ...calibrationAudit(before) },
        afterData: { managementNo: before.instrument.managementNo, ...calibrationAudit(updated) },
        menuName: MENU_NAME,
      })
    })

    revalidatePath(PAGE_PATH)
    return { ok: true, data: undefined }
  } catch (error) {
    return toFailure(error)
  }
}

/** 교정이력 취소(삭제하지 않고 취소 표시). 취소된 이력은 최신 교정 판정에서 제외된다. */
export async function cancelCalibration(id: string, reason: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission("UPDATE")
    const trimmed = text(reason, 300)
    if (!trimmed) throw new UserFacingError("취소 사유를 입력해 주세요.")

    await prisma.$transaction(async (tx) => {
      const before = await tx.instrumentCalibration.findFirst({
        where: { id, tenantId: actor.tenantId },
        include: { instrument: { select: { managementNo: true } } },
      })
      if (!before) throw new UserFacingError("교정이력을 찾을 수 없습니다.")
      if (before.cancelledAt) throw new UserFacingError("이미 취소된 이력입니다.")

      const updated = await tx.instrumentCalibration.update({
        where: { id },
        data: { cancelledAt: new Date(), cancelledById: actor.profileId, cancelReason: trimmed },
      })
      await refreshInstrumentSummary(tx, actor.tenantId, before.instrumentId)
      await recordAuditLog(tx, {
        tenantId: actor.tenantId,
        actor,
        entityType: "InstrumentCalibration",
        entityId: id,
        action: "UPDATE",
        beforeData: { managementNo: before.instrument.managementNo, ...calibrationAudit(before) },
        afterData: { managementNo: before.instrument.managementNo, ...calibrationAudit(updated), reason: trimmed },
        menuName: MENU_NAME,
      })
    })

    revalidatePath(PAGE_PATH)
    return { ok: true, data: undefined }
  } catch (error) {
    return toFailure(error)
  }
}

// ─── 교정 일정(예정/진행중) ───────────────────────────────────────────────────

const scheduleSchema = z.object({
  instrumentId: z.string().min(1),
  status: z.enum(["SCHEDULED", "IN_PROGRESS"]),
  plannedDate: optionalDateKey,
  calibrationAgency: optionalText(100),
  managerId: z.string().nullish().transform((v) => v || null),
  remarks: optionalText(500),
})

export type ScheduleInput = z.input<typeof scheduleSchema>

/** 계측기의 교정 일정(예정일/담당자/진행상태)을 저장한다. 열린 일정이 있으면 갱신하고 없으면 새로 만든다. */
export async function saveCalibrationSchedule(input: ScheduleInput): Promise<ActionResult> {
  try {
    const actor = await requirePermission("UPDATE")
    const data = scheduleSchema.parse(input)

    await prisma.$transaction(async (tx) => {
      const instrument = await tx.measuringInstrument.findFirst({
        where: { id: data.instrumentId, tenantId: actor.tenantId, deletedAt: null },
      })
      if (!instrument) throw new UserFacingError("계측기를 찾을 수 없습니다.")
      if (instrument.usageStatus === "DISPOSED" || !instrument.calibrationRequired) {
        throw new UserFacingError("폐기되었거나 교정대상에서 제외된 계측기는 교정 일정을 지정할 수 없습니다.")
      }
      await assertManager(tx, actor.tenantId, data.managerId)

      const open = await tx.instrumentCalibration.findFirst({
        where: { tenantId: actor.tenantId, instrumentId: instrument.id, cancelledAt: null, progressStatus: { not: "COMPLETED" } },
        orderBy: { createdAt: "desc" },
      })
      const values = {
        progressStatus: data.status,
        plannedDate: data.plannedDate ? dateKeyToDate(data.plannedDate) : null,
        calibrationAgency: data.calibrationAgency,
        managerId: data.managerId,
        remarks: data.remarks,
      }
      const record = open
        ? await tx.instrumentCalibration.update({ where: { id: open.id }, data: values })
        : await tx.instrumentCalibration.create({
            data: { ...values, tenantId: actor.tenantId, instrumentId: instrument.id, source: "MANUAL", createdById: actor.profileId },
          })
      await recordAuditLog(tx, {
        tenantId: actor.tenantId,
        actor,
        entityType: "InstrumentCalibration",
        entityId: record.id,
        action: open ? "UPDATE" : "CREATE",
        beforeData: open ? { managementNo: instrument.managementNo, ...calibrationAudit(open), plannedDate: dateToKey(open.plannedDate) } : undefined,
        afterData: { managementNo: instrument.managementNo, ...calibrationAudit(record), plannedDate: dateToKey(record.plannedDate) },
        menuName: MENU_NAME,
      })
    })

    revalidatePath(PAGE_PATH)
    return { ok: true, data: undefined }
  } catch (error) {
    return toFailure(error)
  }
}

// ─── 엑셀 다운로드 (서버에서 EXPORT 권한과 필터를 적용한 행을 만든다) ─────────

export type ExportPayload = {
  header: string[]
  rows: ExportCell[][]
  count: number
}

export async function exportInstrumentRows(filters: InstrumentFilters): Promise<ActionResult<ExportPayload>> {
  try {
    const user = await requirePermission("EXPORT")
    const { instruments } = await loadViewRows(user.tenantId)
    const filtered = filterInstrumentRows(instruments, filters ?? {})
    return { ok: true, data: { header: [...INSTRUMENT_EXPORT_HEADER], rows: toInstrumentExportRows(filtered), count: filtered.length } }
  } catch (error) {
    return toFailure(error)
  }
}

export async function exportCalibrationRows(filters: CalibrationFilters): Promise<ActionResult<ExportPayload>> {
  try {
    const user = await requirePermission("EXPORT")
    const { calibrations } = await loadViewRows(user.tenantId)
    const filtered = filterCalibrationRows(calibrations, filters ?? {}).sort(
      (a, b) =>
        a.managementNo.localeCompare(b.managementNo, "ko", { numeric: true }) ||
        (b.calibrationDate ?? "").localeCompare(a.calibrationDate ?? ""),
    )
    return { ok: true, data: { header: [...CALIBRATION_EXPORT_HEADER], rows: toCalibrationExportRows(filtered), count: filtered.length } }
  } catch (error) {
    return toFailure(error)
  }
}

// ─── 엑셀 이관 ────────────────────────────────────────────────────────────────

const importSheetsSchema = z
  .array(
    z.object({
      name: z.string().max(100),
      rows: z.array(z.array(z.string().max(500)).max(40)).max(2000),
    }),
  )
  .min(1, "읽을 시트가 없습니다.")
  .max(60, "시트가 너무 많습니다.")

export type ImportSheetsInput = z.input<typeof importSheetsSchema>

export type ImportPreview = {
  summary: ImportPlanSummary
  issues: ImportIssue[]
  instruments: Array<{
    rowRef: string
    managementNo: string
    name: string
    action: PlannedInstrument["action"]
    usageStatus: InstrumentUsageStatusValue
    usageStatusLabel: string
    differences: string[]
  }>
  calibrations: Array<{
    sheet: string
    rowRef: string
    managementNo: string
    agency: string
    certificateNo: string
    nextCalibrationDate: string | null
    action: PlannedCalibration["action"]
    reason: string
  }>
}

async function buildClassifiedPlan(db: Tx | typeof prisma, tenantId: string, sheets: ImportSheetsInput) {
  const parsed = importSheetsSchema.parse(sheets)
  const base = buildImportPlan(parsed)
  const [instruments, calibrations] = await Promise.all([
    db.measuringInstrument.findMany({
      where: { tenantId },
      select: { id: true, managementNo: true, name: true, specification: true, serialNo: true, manufacturer: true, deletedAt: true },
    }),
    db.instrumentCalibration.findMany({
      where: { tenantId },
      select: { instrumentId: true, certificateNo: true, nextCalibrationDate: true, sourceKey: true },
    }),
  ])
  return classifyImportPlan(
    base,
    instruments.map((i) => ({
      id: i.id,
      managementNo: i.managementNo,
      name: i.name,
      specification: i.specification,
      serialNo: i.serialNo,
      manufacturer: i.manufacturer,
      deleted: i.deletedAt !== null,
    })),
    calibrations.map((c) => ({
      instrumentId: c.instrumentId,
      certificateNo: c.certificateNo,
      nextCalibrationDate: dateToKey(c.nextCalibrationDate),
      sourceKey: c.sourceKey,
    })),
  )
}

/** 저장 없이 이관 미리보기(신규/기존/중복/오류 건수)를 만든다. */
export async function previewInstrumentImport(sheets: ImportSheetsInput): Promise<ActionResult<ImportPreview>> {
  try {
    const actor = await requirePermission("CREATE")
    const plan = await buildClassifiedPlan(prisma, actor.tenantId, sheets)
    return {
      ok: true,
      data: {
        summary: summarizeImportPlan(plan),
        issues: plan.issues.slice(0, 300),
        instruments: plan.instruments.map((i) => ({
          rowRef: i.rowRef,
          managementNo: i.data.managementNo,
          name: i.data.name,
          action: i.action,
          usageStatus: i.data.usageStatus,
          usageStatusLabel: USAGE_STATUS_LABELS[i.data.usageStatus],
          differences: i.differences,
        })),
        calibrations: plan.calibrations.map((c) => ({
          sheet: c.sheet,
          rowRef: c.rowRef,
          managementNo: c.data.managementNo,
          agency: c.data.calibrationAgency ?? "",
          certificateNo: c.data.certificateNo ?? "",
          nextCalibrationDate: c.data.nextCalibrationDate,
          action: c.action,
          reason: c.reason ?? "",
        })),
      },
    }
  } catch (error) {
    return toFailure(error)
  }
}

export type ImportCommitResult = {
  instrumentsCreated: number
  instrumentsSkippedExisting: number
  calibrationsCreated: number
  calibrationsSkipped: number
  errorCount: number
}

/**
 * 이관 실행. 클라이언트가 보낸 미리보기 결과를 신뢰하지 않고 같은 원본으로 서버에서 다시 계획을 만든 뒤,
 * 트랜잭션 안에서 신규 계측기와 신규 교정이력만 저장한다(기존 계측기 정보는 덮어쓰지 않는다).
 */
export async function commitInstrumentImport(sheets: ImportSheetsInput): Promise<ActionResult<ImportCommitResult>> {
  try {
    const actor = await requirePermission("CREATE")

    const result = await prisma.$transaction(
      async (tx) => {
        const plan = await buildClassifiedPlan(tx, actor.tenantId, sheets)
        const summary = summarizeImportPlan(plan)
        if (!plan.masterSheet) throw new UserFacingError("종합 관리대장 시트를 찾을 수 없어 이관할 수 없습니다.")

        const newInstruments = plan.instruments.filter((i) => i.action === "NEW")
        const newCalibrations = plan.calibrations.filter((c) => c.action === "NEW")
        if (newInstruments.length === 0 && newCalibrations.length === 0) {
          throw new UserFacingError("새로 이관할 계측기 또는 교정이력이 없습니다.")
        }

        if (newInstruments.length > 0) {
          await tx.measuringInstrument.createMany({
            data: newInstruments.map((i) => ({
              tenantId: actor.tenantId,
              managementNo: i.data.managementNo,
              name: i.data.name,
              category: i.data.category,
              specification: i.data.specification,
              serialNo: i.data.serialNo,
              manufacturer: i.data.manufacturer,
              calibrationRequired: i.data.calibrationRequired,
              calibrationIntervalMonths: i.data.calibrationIntervalMonths,
              department: i.data.department,
              location: i.data.location,
              usageStatus: i.data.usageStatus,
              remarks: i.data.remarks,
              source: "EXCEL_IMPORT" as const,
              sourceRef: i.data.sourceRef,
              createdById: actor.profileId,
            })),
          })
        }

        const instruments = await tx.measuringInstrument.findMany({
          where: { tenantId: actor.tenantId, deletedAt: null },
          select: { id: true, managementNo: true, usageStatus: true },
        })
        const idByKey = new Map(instruments.map((i) => [normalizeManagementNo(i.managementNo), i]))

        if (newInstruments.length > 0) {
          await tx.instrumentStatusHistory.createMany({
            data: newInstruments.flatMap((i) => {
              const row = idByKey.get(normalizeManagementNo(i.data.managementNo))
              return row
                ? [{ tenantId: actor.tenantId, instrumentId: row.id, previousStatus: null, newStatus: row.usageStatus, reason: "엑셀 이관", changedById: actor.profileId }]
                : []
            }),
          })
        }

        const affected = new Set<string>()
        const toCreate = newCalibrations.flatMap((c) => {
          const row = idByKey.get(normalizeManagementNo(c.data.managementNo))
          if (!row) return []
          affected.add(row.id)
          return [
            {
              tenantId: actor.tenantId,
              instrumentId: row.id,
              progressStatus: "COMPLETED" as const,
              calibrationDate: null,
              calibrationAgency: c.data.calibrationAgency,
              certificateNo: c.data.certificateNo,
              result: null,
              nextCalibrationDate: c.data.nextCalibrationDate ? dateKeyToDate(c.data.nextCalibrationDate) : null,
              remarks: c.data.remarks,
              source: "EXCEL_IMPORT" as const,
              sourceRef: c.data.sourceRef,
              sourceKey: c.data.sourceKey,
              createdById: actor.profileId,
            },
          ]
        })
        if (toCreate.length > 0) await tx.instrumentCalibration.createMany({ data: toCreate })

        for (const instrumentId of Array.from(affected)) {
          await refreshInstrumentSummary(tx, actor.tenantId, instrumentId)
        }

        await recordAuditLog(tx, {
          tenantId: actor.tenantId,
          actor,
          entityType: "MeasuringInstrument",
          entityId: "BULK",
          action: "CREATE",
          afterData: {
            source: "EXCEL_IMPORT",
            masterSheet: plan.masterSheet,
            instrumentsCreated: newInstruments.length,
            calibrationsCreated: toCreate.length,
            managementNos: newInstruments.slice(0, 20).map((i) => i.data.managementNo),
          },
          menuName: MENU_NAME,
        })

        return {
          instrumentsCreated: newInstruments.length,
          instrumentsSkippedExisting: summary.instrumentsExisting,
          calibrationsCreated: toCreate.length,
          calibrationsSkipped: summary.calibrationsDuplicate + summary.calibrationsSkipped,
          errorCount: summary.instrumentErrors,
        } satisfies ImportCommitResult
      },
      { timeout: 60_000, maxWait: 10_000 },
    )

    revalidatePath(PAGE_PATH)
    return { ok: true, data: result }
  } catch (error) {
    return toFailure(error)
  }
}
