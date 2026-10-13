"use server"

import { prisma } from "@/lib/db/prisma"
import { OperationStatus, Prisma, WipUnitStatus, WorkOrderStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { getTenantId, requireRole } from "@/lib/auth"
import { headers } from "next/headers"
import { createLoginHistoryLog } from "@/lib/login-history"
import { POP_PIN_LOGIN_HISTORY_ID, isAutoLockExpired } from "@/lib/login-lock"
import {
  assertValidPopPin,
  createPopPinFingerprint,
  verifyPopPin,
} from "@/lib/auth/pop-pin"
import {
  getPopWorkerSession,
  setPopWorkerSessionCookie,
  type PopWorkerSessionPayload,
} from "@/lib/auth/pop-worker-session"
import {
  advanceWipUnitOnOperationComplete,
  findActiveWipUnitForWorkOrder,
  recordProductionResultQualityMovements,
  transitionWipUnitOnStart,
} from "@/lib/actions/wip-traceability.helpers"
import {
  recordSelfInspectionDefects,
  type SelfInspectionDefectDetail,
} from "@/lib/actions/self-inspection.helpers"
import { syncProductionPlanStatusForWorkOrder } from "@/lib/production-plan-sync"
import {
  assertDirectOperationStatusRequestAllowed,
  assertOperationResultAllowed,
  assertOperationStartAllowed,
  MATERIAL_NOT_ISSUED_MESSAGE,
} from "@/lib/operation-status-integrity"
import { resolveProductionResultTime } from "@/lib/pop-worktime-operator"
import {
  assertProductionQuantityWithinMaterialLimit,
  getWorkOrderMaterialSufficiency,
} from "@/lib/bom-material-sufficiency"
import { lockWorkOrderOperationForUpdate } from "@/lib/quantity-concurrency"
import {
  computeRemainingLife,
  computeUsageRate,
  TOOL_TYPES,
  type ToolEquipmentType,
} from "@/lib/actions/tool.helpers"
import {
  getWorkStandardsForOperationContext,
  type PopWorkStandard,
} from "@/lib/pop-work-standard.server"

// ─── Types ────────────────────────────────────────────────────────────────────

export type PopWorkerSession = {
  userId: string
  tenantUserId: string
  name: string
  role: string
  siteId: string
  tenantId: string
}

export type SubmitResultInput = {
  workOrderOperationId: string
  assignmentId?: string | null
  goodQty: number
  defectQty: number
  reworkQty: number
  // 불량수량 > 0이면 불량코드별 수량(자주검사 불량내역)을 필수로 받는다.
  // 합계는 defectQty와 일치해야 한다.
  defectDetails?: SelfInspectionDefectDetail[]
  // F18: 실제 공구 사용은 선택사항이다. 생략/빈 배열이면 "사용 안 함"으로 처리한다.
  toolIds?: string[]
}

export type PopAvailableTool = {
  id: string
  code: string
  name: string
  equipmentType: ToolEquipmentType
  currentUsage: number
  lifeLimit: number | null
  remainingLife: number | null
  usageRate: number | null
}

export type PopWorkQueueRow = {
  rowId: string
  operationId: string
  assignmentId: string | null
  workOrderId: string
  orderNo: string
  manufacturingNo: string | null
  itemCode: string
  itemName: string
  processName: string
  equipmentName: string | null
  seq: number
  status: OperationStatus
  operationStatus: OperationStatus
  assignmentStatus: OperationStatus | null
  plannedQty: number
  assignedQty: number | null
  completedQty: number
  remainingQty: number
  dueDate: string | null
  materialLotCount: number
  materialLotQty: number
  canWork: boolean
  availabilityLabel: string
  materialIssuanceReady: boolean
  availableTools: PopAvailableTool[]
}

// ─── Auth context helpers ─────────────────────────────────────────────────────

type PopAuthContext =
  | { mode: "USER_SESSION"; tenantId: string; profileId: string }
  | { mode: "POP_WORKER_SESSION"; tenantId: string; siteId: string | null; profileId: string; session: PopWorkerSessionPayload }
  | { mode: "UNAUTHENTICATED" }

async function resolvePopAuthContext(): Promise<PopAuthContext> {
  const popWorkerSession = await getPopWorkerSession()
  if (popWorkerSession) {
    return {
      mode: "POP_WORKER_SESSION",
      tenantId: popWorkerSession.tenantId,
      siteId: popWorkerSession.siteId,
      profileId: popWorkerSession.profileId,
      session: popWorkerSession,
    }
  }
  try {
    const user = await requireRole("OPERATOR")
    const tenantId = await getTenantId()
    return { mode: "USER_SESSION", tenantId, profileId: user.profileId }
  } catch {
    return { mode: "UNAUTHENTICATED" }
  }
}

async function assertActivePopOperator(
  tx: Prisma.TransactionClient,
  authCtx: Exclude<PopAuthContext, { mode: "UNAUTHENTICATED" }>
): Promise<void> {
  const tenantUser = await tx.tenantUser.findFirst({
    where: {
      tenantId: authCtx.tenantId,
      profileId: authCtx.profileId,
      isActive: true,
      ...(authCtx.mode === "POP_WORKER_SESSION"
        ? { id: authCtx.session.tenantUserId }
        : {}),
    },
    select: { id: true },
  })
  if (!tenantUser) {
    throw new Error("현재 사업장의 활성 작업자만 생산실적을 처리할 수 있습니다.")
  }
}

function assertPopSessionSiteMatch(
  session: PopWorkerSessionPayload,
  workOrderSiteId: string | null,
): void {
  if (session.siteId != null && workOrderSiteId != null && session.siteId !== workOrderSiteId) {
    throw new Error("해당 작업장의 작업만 처리할 수 있습니다.")
  }
}

function normalizePopToolIds(toolIds: string[] | undefined): string[] {
  if (!toolIds) return []
  return Array.from(new Set(toolIds.map((id) => id.trim()).filter(Boolean)))
}

function serializePopAvailableTool(tool: {
  id: string
  code: string
  name: string
  equipmentType: string
  currentUsage: number
  lifeLimit: number | null
}): PopAvailableTool {
  return {
    id: tool.id,
    code: tool.code,
    name: tool.name,
    equipmentType: tool.equipmentType as ToolEquipmentType,
    currentUsage: tool.currentUsage,
    lifeLimit: tool.lifeLimit,
    remainingLife: computeRemainingLife(tool.lifeLimit, tool.currentUsage),
    usageRate: computeUsageRate(tool.lifeLimit, tool.currentUsage),
  }
}

async function recordPopToolUsage(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string
    siteId: string | null
    routingOperationId: string
    workOrderOperationId: string
    productionResultId: string
    itemId: string
    operatorProfileId: string
    usedAt: Date
    toolIds: string[]
  }
): Promise<void> {
  if (args.toolIds.length === 0) return
  if (!args.siteId) throw new Error("공구 사용이력을 남기려면 작업지시의 사업장 정보가 필요합니다.")

  // 기존 공구수명 단위는 사용횟수(회): 선택한 공구별 실적 segment 1건 = 사용 1회.
  const usageCount = 1
  const tools = await tx.equipment.findMany({
    where: {
      id: { in: args.toolIds },
      tenantId: args.tenantId,
      siteId: args.siteId,
      status: "ACTIVE",
      equipmentType: { in: [...TOOL_TYPES] },
      operationMaps: { some: { routingOperationId: args.routingOperationId } },
    },
    select: { id: true },
  })

  if (tools.length !== args.toolIds.length) {
    throw new Error("선택한 공구 중 현재 공정에서 사용할 수 없는 공구가 있습니다.")
  }

  await tx.equipmentUsageHistory.createMany({
    data: args.toolIds.map((equipmentId) => ({
      tenantId: args.tenantId,
      equipmentId,
      usedAt: args.usedAt,
      usageCount,
      itemId: args.itemId,
      workOrderOperationId: args.workOrderOperationId,
      productionResultId: args.productionResultId,
      operatorId: args.operatorProfileId,
      createdById: args.operatorProfileId,
      note: "POP 생산실적 실제 공구 사용",
    })),
  })

  await Promise.all(
    args.toolIds.map((equipmentId) =>
      tx.equipment.update({
        where: { id: equipmentId },
        data: { currentUsage: { increment: usageCount } },
      })
    )
  )
}

// ─── 1. PIN 로그인 ───────────────────────────────────────────────────────────

const QTY_DECIMAL_SCALE = 6
const ZERO_QTY = BigInt(0)
const QTY_SCALE_MULTIPLIER = BigInt("1000000")

function toScaledQty(
  value: number | string | Prisma.Decimal,
  fieldName = "수량",
  options: { allowZero?: boolean } = {}
): bigint {
  const raw = value?.toString().trim()
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`${fieldName}은 0 이상의 숫자여야 합니다.`)
  }

  const [integerPart, decimalPart = ""] = raw.split(".")
  if (decimalPart.length > QTY_DECIMAL_SCALE) {
    throw new Error(`${fieldName}은 소수점 ${QTY_DECIMAL_SCALE}자리까지만 입력할 수 있습니다.`)
  }

  const scaled =
    BigInt(integerPart) * QTY_SCALE_MULTIPLIER +
    BigInt(decimalPart.padEnd(QTY_DECIMAL_SCALE, "0"))

  if (!options.allowZero && scaled <= ZERO_QTY) {
    throw new Error(`${fieldName}은 0보다 커야 합니다.`)
  }

  return scaled
}

function sumScaledQty(values: bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, ZERO_QTY)
}

function formatScaledQty(value: bigint): string {
  const sign = value < ZERO_QTY ? "-" : ""
  const absolute = value < ZERO_QTY ? -value : value
  const integerPart = absolute / QTY_SCALE_MULTIPLIER
  const decimalPart = (absolute % QTY_SCALE_MULTIPLIER)
    .toString()
    .padStart(QTY_DECIMAL_SCALE, "0")
    .replace(/0+$/, "")

  return `${sign}${integerPart.toString()}${decimalPart ? `.${decimalPart}` : ""}`
}

// ─── POP PIN 로그인 시도 제한 ──────────────────────────────────────────────────
// PIN(4자리) 단독 로그인이라 무제한 시도를 허용하면 전수 대입이 가능하다.
// 실패 시도를 기존 LoginHistory(스키마 변경 없음)에 기록하고, 같은 IP 에서 시간창 내 실패가
// 한도를 넘으면 추가 시도를 거부한다. 공장 내 공용 공인 IP 를 고려해 한도는 넉넉히 둔다.
// 이력 조회/기록 실패 시에는 로그인을 막지 않는다(createLoginHistoryLog 와 동일한 fail-open).
const POP_LOGIN_HISTORY_ID = POP_PIN_LOGIN_HISTORY_ID
const POP_LOGIN_FAIL_WINDOW_MS = 10 * 60 * 1000
const POP_LOGIN_FAIL_LIMIT = 30

async function getPopClientIp(): Promise<string | null> {
  try {
    const h = await headers()
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null
  } catch {
    return null
  }
}

async function isPopLoginThrottled(tenantId: string, ip: string | null): Promise<boolean> {
  try {
    const failures = await prisma.loginHistory.count({
      where: {
        tenantId,
        loginId: POP_LOGIN_HISTORY_ID,
        eventType: "LOGIN_FAIL",
        ipAddress: ip,
        createdAt: { gte: new Date(Date.now() - POP_LOGIN_FAIL_WINDOW_MS) },
      },
    })
    return failures >= POP_LOGIN_FAIL_LIMIT
  } catch {
    return false
  }
}

async function recordPopLoginFailure(
  tenantId: string,
  ip: string | null,
  reason: "USER_NOT_FOUND" | "INVALID_PASSWORD" | "LOCKED" | "INACTIVE",
): Promise<void> {
  await createLoginHistoryLog({
    tenantId,
    loginId: POP_LOGIN_HISTORY_ID,
    eventType: "LOGIN_FAIL",
    failReason: reason,
    ipAddress: ip,
  })
}

export async function popLogin(
  pin: string,
  tenantId: string
): Promise<PopWorkerSession | null> {
  // PIN 형식 검증
  try { assertValidPopPin(pin) } catch { return null }

  // 서버 env 우선 사용 (클라이언트 쿠키 fallback 무효화)
  const effectiveTenantId = process.env.DEFAULT_TENANT_ID ?? tenantId
  const hasDefaultTenantEnv = Boolean(process.env.DEFAULT_TENANT_ID)

  let popPinFingerprint = ""
  let failureReason = "UNKNOWN"

  try {
    popPinFingerprint = createPopPinFingerprint(effectiveTenantId, pin)
  } catch (e) {
    failureReason = "FINGERPRINT_ERROR"
    console.info("[POP_LOGIN_DEBUG]", {
      clientTenantId: tenantId,
      hasDefaultTenantId: hasDefaultTenantEnv,
      effectiveTenantId,
      pinLength: pin.length,
      failureReason,
      error: e instanceof Error ? e.message : String(e),
    })
    return null
  }

  const clientIp = await getPopClientIp()
  if (await isPopLoginThrottled(effectiveTenantId, clientIp)) {
    console.warn("[popLogin] 로그인 시도 제한 초과")
    return null
  }

  try {
    const credential = await prisma.userCredential.findFirst({
      where: { tenantId: effectiveTenantId, popPinFingerprint },
      select: {
        isLocked: true,
        lockedAt: true,
        failCount: true,
        mustChangePw: true,
        popPinHash: true,
        profileId: true,
        loginId: true,
        profile: {
          select: {
            name: true,
            tenantUsers: {
              where: { tenantId: effectiveTenantId },
              select: { id: true, role: true, siteId: true, isActive: true },
              take: 1,
            },
          },
        },
      },
    })

    const tenantUser = credential?.profile?.tenantUsers[0]

    if (!credential) {
      failureReason = "CREDENTIAL_NOT_FOUND"
    } else if (!credential.popPinHash) {
      failureReason = "NO_PIN_HASH"
    } else if (credential.isLocked && !isAutoLockExpired(credential)) {
      // 로그인 실패 자동 잠금은 cooldown 이후 풀린다(웹 로그인과 동일 정책). 수동 잠금은 계속 차단.
      failureReason = "LOCKED"
    } else if (credential.mustChangePw) {
      failureReason = "MUST_CHANGE_PW"
    } else if (!tenantUser) {
      failureReason = "NO_TENANT_USER"
    } else if (!tenantUser.isActive) {
      failureReason = "INACTIVE"
    }

    // Runtime Log: Vercel에서 정확한 실패 원인 확인용
    console.info("[POP_LOGIN_DEBUG]", {
      clientTenantId: tenantId,
      hasDefaultTenantId: hasDefaultTenantEnv,
      effectiveTenantId,
      pinLength: pin.length,
      foundCredential: Boolean(credential),
      hasPopPinHash: Boolean(credential?.popPinHash),
      isLocked: credential?.isLocked ?? null,
      mustChangePw: credential?.mustChangePw ?? null,
      tenantUserFound: Boolean(tenantUser),
      tenantUserActive: tenantUser?.isActive ?? null,
      failureReason,
    })

    if (failureReason !== "UNKNOWN") {
      await recordPopLoginFailure(
        effectiveTenantId,
        clientIp,
        failureReason === "CREDENTIAL_NOT_FOUND" ? "USER_NOT_FOUND"
          : failureReason === "LOCKED" ? "LOCKED"
          : failureReason === "INACTIVE" ? "INACTIVE"
          : "INVALID_PASSWORD",
      )
      return null
    }

    if (await verifyPopPin(pin, credential!.popPinHash!)) {
      await setPopWorkerSessionCookie({
        tenantId: effectiveTenantId,
        profileId: credential!.profileId,
        tenantUserId: tenantUser!.id,
        workerName: credential!.profile.name,
        role: tenantUser!.role,
        siteId: tenantUser!.siteId,
      })
      return {
        userId: credential!.profileId,
        tenantUserId: tenantUser!.id,
        name: credential!.profile.name,
        role: tenantUser!.role,
        siteId: tenantUser!.siteId ?? "site-a",
        tenantId: effectiveTenantId,
      }
    }

    // bcrypt compare failed
    console.info("[POP_LOGIN_DEBUG] failureReason=HASH_MISMATCH")
    await recordPopLoginFailure(effectiveTenantId, clientIp, "INVALID_PASSWORD")
    return null

  } catch (e) {
    console.error("[popLogin] unexpected error:", e instanceof Error ? e.message : e)
    return null
  }
}

// ─── 2. 오늘의 작업지시 목록 ──────────────────────────────────────────────────

export async function getTodayWorkOrders() {
  const authCtx = await resolvePopAuthContext()
  if (authCtx.mode === "UNAUTHENTICATED") return []

  return prisma.workOrder.findMany({
    where: {
      tenantId: authCtx.tenantId,
      status: { in: ["RELEASED", "IN_PROGRESS"] },
      ...(authCtx.mode === "POP_WORKER_SESSION" && authCtx.siteId != null
        ? { siteId: authCtx.siteId }
        : {}),
    },
    include: {
      item: true,
      operations: {
        include: {
          routingOperation: true,
          equipment: true,
          assignments: {
            include: { equipment: true },
            orderBy: { seq: "asc" },
          },
        },
        orderBy: { seq: "asc" },
      },
    },
    orderBy: { dueDate: "asc" },
  })
}

// 원본 WIP는 자재출고 시 생성되며 POP 화면의 출고 완료 신호로 사용한다.
async function workOrderHasMaterialIssuance(
  tenantId: string,
  workOrderId: string
): Promise<boolean> {
  const wipUnit = await prisma.wipUnit.findFirst({
    where: {
      tenantId,
      workOrderId,
      parentWipUnitId: null,
      sourceProductionResultId: null,
    },
    select: { id: true },
  })
  return Boolean(wipUnit)
}

export async function getPopWorkQueueRows(tenantId: string): Promise<PopWorkQueueRow[]> {
  // 인증(관리자 세션 또는 POP 작업자 세션) 필요, 인자로 받은 tenantId 는 신뢰하지 않고 세션의 tenant 와 일치할 때만 조회
  const authCtx = await resolvePopAuthContext()
  if (authCtx.mode === "UNAUTHENTICATED" || authCtx.tenantId !== tenantId) return []
  const operations = await prisma.workOrderOperation.findMany({
    where: {
      status: { in: ["PENDING", "IN_PROGRESS"] },
      workOrder: {
        tenantId,
        status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED] },
      },
    },
    select: {
      id: true,
      seq: true,
      status: true,
      plannedQty: true,
      completedQty: true,
      equipment: {
        select: { name: true },
      },
      assignments: {
        select: {
          id: true,
          assignedQty: true,
          completedQty: true,
          status: true,
          equipment: { select: { name: true } },
        },
        orderBy: { seq: "asc" },
      },
      routingOperation: {
        select: {
          name: true,
          equipmentMaps: {
            where: {
              equipment: {
                equipmentType: { in: [...TOOL_TYPES] },
                status: "ACTIVE",
              },
            },
            select: {
              equipment: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  equipmentType: true,
                  siteId: true,
                  currentUsage: true,
                  lifeLimit: true,
                },
              },
            },
          },
        },
      },
      workOrder: {
        select: {
          id: true,
          orderNo: true,
          manufacturingNo: true,
          siteId: true,
          dueDate: true,
          item: { select: { code: true, name: true } },
          operations: {
            select: { seq: true, status: true },
            orderBy: { seq: "asc" },
          },
          materialLots: { select: { id: true, qty: true } },
        },
      },
    },
    orderBy: [
      { workOrder: { dueDate: "asc" } },
      { workOrder: { orderNo: "asc" } },
      { seq: "asc" },
    ],
  })

  // 자재출고 완료(원본 WipUnit 존재) 작업지시 집합을 1회 조회
  const workOrderIds = Array.from(new Set(operations.map((o) => o.workOrder.id)))
  const issuedWorkOrderIds = new Set(
    (
      await prisma.wipUnit.findMany({
        where: {
          tenantId,
          workOrderId: { in: workOrderIds },
          parentWipUnitId: null,
          sourceProductionResultId: null,
        },
        select: { workOrderId: true },
        distinct: ["workOrderId"],
      })
    ).map((w) => w.workOrderId)
  )

  return operations.flatMap((operation): PopWorkQueueRow[] => {
    const previousOperations = operation.workOrder.operations.filter(
      (candidate) => candidate.seq < operation.seq
    )
    const previousCompleted = previousOperations.every(
      (candidate) => candidate.status === "COMPLETED"
    )
    const materialIssuanceReady = issuedWorkOrderIds.has(operation.workOrder.id)
    const operationCanWork =
      (operation.status === "IN_PROGRESS" || previousCompleted) && materialIssuanceReady
    const materialLotQty = operation.workOrder.materialLots.reduce(
      (sum, lot) => sum + Number(lot.qty),
      0
    )
    const plannedQty = Number(operation.plannedQty)
    const completedQty = Number(operation.completedQty)
    const baseRow = {
      operationId: operation.id,
      workOrderId: operation.workOrder.id,
      orderNo: operation.workOrder.orderNo,
      manufacturingNo: operation.workOrder.manufacturingNo,
      itemCode: operation.workOrder.item.code,
      itemName: operation.workOrder.item.name,
      processName: operation.routingOperation.name,
      seq: operation.seq,
      operationStatus: operation.status,
      dueDate: operation.workOrder.dueDate?.toISOString() ?? null,
      materialLotCount: operation.workOrder.materialLots.length,
      materialLotQty,
      availableTools: operation.routingOperation.equipmentMaps
        .map((map) => map.equipment)
        .filter((tool) => tool.siteId === operation.workOrder.siteId)
        .map(serializePopAvailableTool),
    }

    if (operation.assignments.length > 0) {
      return operation.assignments
        .filter((assignment) => assignment.status !== "COMPLETED")
        .map((assignment) => {
          const assignedQty = Number(assignment.assignedQty)
          const assignmentCompletedQty = Number(assignment.completedQty)
          const canWork = operationCanWork && assignment.status !== "COMPLETED"

          return {
            ...baseRow,
            rowId: assignment.id,
            assignmentId: assignment.id,
            equipmentName: assignment.equipment.name,
            status: assignment.status,
            assignmentStatus: assignment.status,
            plannedQty: assignedQty,
            assignedQty,
            completedQty: assignmentCompletedQty,
            remainingQty: Math.max(assignedQty - assignmentCompletedQty, 0),
            canWork,
            materialIssuanceReady,
            availabilityLabel:
              assignment.status === "IN_PROGRESS"
                ? "진행중"
                : !materialIssuanceReady
                  ? "자재출고 대기"
                  : canWork
                    ? "작업가능"
                    : "이전 공정 대기",
          } satisfies PopWorkQueueRow
        })
    }

    return [{
      ...baseRow,
      rowId: operation.id,
      assignmentId: null,
      equipmentName: operation.equipment?.name ?? null,
      status: operation.status,
      assignmentStatus: null,
      plannedQty,
      assignedQty: null,
      completedQty,
      remainingQty: Math.max(plannedQty - completedQty, 0),
      canWork: operationCanWork,
      materialIssuanceReady,
      availabilityLabel:
        operation.status === "IN_PROGRESS"
          ? "진행중"
          : !materialIssuanceReady
            ? "자재출고 대기"
            : operationCanWork
              ? "작업가능"
              : "이전 공정 대기",
    } satisfies PopWorkQueueRow]
  })
}

export async function getOperationDetail(operationId: string, assignmentId?: string | null) {
  const authCtx = await resolvePopAuthContext()
  if (authCtx.mode === "UNAUTHENTICATED") return null

  const operation = await prisma.workOrderOperation.findUnique({
    where: { id: operationId },
    include: {
      workOrder: { include: { item: true } },
      routingOperation: {
        include: {
          equipmentMaps: {
            where: {
              equipment: {
                equipmentType: { in: [...TOOL_TYPES] },
                status: "ACTIVE",
              },
            },
            include: {
              equipment: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  equipmentType: true,
                  siteId: true,
                  currentUsage: true,
                  lifeLimit: true,
                },
              },
            },
          },
        },
      },
      equipment: true,
      assignments: {
        include: { equipment: true },
        orderBy: { seq: "asc" },
      },
      productionResults: {
        where: assignmentId ? { workOrderOperationAssignmentId: assignmentId } : undefined,
        orderBy: { startedAt: "desc" },
      },
    },
  })

  if (!operation) return null
  if (operation.workOrder.tenantId !== authCtx.tenantId) return null
  if (
    authCtx.mode === "POP_WORKER_SESSION" &&
    authCtx.siteId != null &&
    operation.workOrder.siteId !== authCtx.siteId
  ) return null

  const selectedAssignment = assignmentId
    ? operation.assignments.find((assignment) => assignment.id === assignmentId) ?? null
    : null

  if (assignmentId && !selectedAssignment) return null

  const materialIssuanceReady = operation.workOrder
    ? await workOrderHasMaterialIssuance(operation.workOrder.tenantId, operation.workOrder.id)
    : true

  // 현재 공정의 실제 투입 가능 WIP 수량 (전공정 불량/재작업 차감 반영)
  const rootWipForDisplay = operation.workOrder
    ? await prisma.wipUnit.findFirst({
        where: {
          workOrderId: operation.workOrder.id,
          parentWipUnitId: null,
          sourceProductionResultId: null,
          status: {
            in: [
              WipUnitStatus.WAITING,
              WipUnitStatus.IN_PROCESS,
              WipUnitStatus.ON_HOLD,
              WipUnitStatus.OUTSOURCED,
              WipUnitStatus.IN_TRANSIT,
              WipUnitStatus.RECEIVED,
              WipUnitStatus.REWORK,
            ],
          },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: { qty: true },
      })
    : null

  const goodSoFarAgg = rootWipForDisplay
    ? await prisma.productionResult.aggregate({
        where: { workOrderOperationId: operation.id },
        _sum: { goodQty: true },
      })
    : null

  const availableWipQty =
    rootWipForDisplay !== null
      ? Math.max(0, Number(rootWipForDisplay.qty) - Number(goodSoFarAgg?._sum?.goodQty ?? 0))
      : null

  const materialSufficiency = await getWorkOrderMaterialSufficiency(prisma, {
    tenantId: operation.workOrder.tenantId,
    workOrderOperationId: operation.id,
  })

  // POP 자주검사 불량코드 선택용 목록 + F21 작업표준서 표시 목록
  const [defectCodes, workStandards] = await Promise.all([
    prisma.defectCode.findMany({
      where: { tenantId: operation.workOrder.tenantId },
      select: { id: true, code: true, name: true, defectCategory: true },
      orderBy: { code: "asc" },
    }),
    getWorkStandardsForOperationContext(prisma, {
      tenantId: operation.workOrder.tenantId,
      itemId: operation.workOrder.itemId,
      routingOperationId: operation.routingOperationId,
    }),
  ])

  return {
    id: operation.id,
    seq: operation.seq,
    status: operation.status,
    materialIssuanceReady,
    plannedQty: Number(operation.plannedQty),
    completedQty: Number(operation.completedQty),
    availableWipQty,
    materialSufficiency: {
      plannedQty: materialSufficiency.plannedQty,
      producedQty: materialSufficiency.producedQty,
      materialProducibleQty: materialSufficiency.materialProducibleQty,
      remainingPlanQty: materialSufficiency.remainingPlanQty,
      remainingMaterialQty: materialSufficiency.remainingMaterialQty,
      maxAdditionalProductionQty: materialSufficiency.maxAdditionalProductionQty,
      shortages: materialSufficiency.shortages.map((shortage) => ({
        itemId: shortage.itemId,
        itemCode: shortage.itemCode,
        itemName: shortage.itemName,
        requiredQty: shortage.requiredQty,
        issuedQty: shortage.issuedQty,
        shortageQty: shortage.shortageQty,
      })),
    },
    defectCodes: defectCodes.map((dc) => ({
      id: dc.id,
      code: dc.code,
      name: dc.name,
      category: dc.defectCategory,
    })),
    workStandards,
    workOrder: operation.workOrder
      ? {
          id: operation.workOrder.id,
          orderNo: operation.workOrder.orderNo,
          item: operation.workOrder.item
            ? {
                name: operation.workOrder.item.name,
                code: operation.workOrder.item.code,
              }
            : null,
        }
      : null,
    routingOperation: operation.routingOperation
      ? { name: operation.routingOperation.name }
      : null,
    availableTools: operation.routingOperation
      ? operation.routingOperation.equipmentMaps
          .map((map) => map.equipment)
          .filter((tool) => tool.siteId === operation.workOrder.siteId)
          .map(serializePopAvailableTool)
      : [],
    equipment: operation.equipment ? { name: operation.equipment.name } : null,
    assignments: operation.assignments.map((assignment) => ({
      id: assignment.id,
      status: assignment.status,
      assignedQty: Number(assignment.assignedQty),
      completedQty: Number(assignment.completedQty),
      equipment: { name: assignment.equipment.name },
    })),
    selectedAssignment: selectedAssignment
      ? {
          id: selectedAssignment.id,
          status: selectedAssignment.status,
          assignedQty: Number(selectedAssignment.assignedQty),
          completedQty: Number(selectedAssignment.completedQty),
          equipment: { name: selectedAssignment.equipment.name },
        }
      : null,
    productionResults: operation.productionResults.map((result) => ({
      id: result.id,
      goodQty: Number(result.goodQty),
      defectQty: Number(result.defectQty),
      reworkQty: Number(result.reworkQty),
      startedAt: result.startedAt?.toISOString() ?? null,
    })),
  }
}

export async function submitProductionResult(
  data: SubmitResultInput
): Promise<{ success: boolean; error?: string; isCompleted?: boolean }> {
  const { workOrderOperationId, assignmentId, goodQty, defectQty, reworkQty } = data
  const selectedToolIds = normalizePopToolIds(data.toolIds)

  if (goodQty < 0 || defectQty < 0 || reworkQty < 0) {
    return { success: false, error: "수량은 0 이상이어야 합니다." }
  }

  let totalScaled: bigint
  try {
    totalScaled = sumScaledQty([
      toScaledQty(goodQty, "양품수량", { allowZero: true }),
      toScaledQty(defectQty, "불량수량", { allowZero: true }),
      toScaledQty(reworkQty, "재작업수량", { allowZero: true }),
    ])
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "수량 형식이 올바르지 않습니다." }
  }

  if (totalScaled <= ZERO_QTY) {
    return { success: false, error: "수량을 1 이상 입력해 주세요." }
  }

  // ── 불량 자주검사 입력 검증 ────────────────────────────────────────────────
  // 불량수량 > 0이면 불량코드별 수량(defectDetails)이 필수이며,
  // 코드 중복 금지 + 합계가 불량수량과 정확히 일치해야 한다.
  const defectDetails = (data.defectDetails ?? []).filter((d) => d && d.defectCodeId)
  if (defectQty > 0) {
    if (defectDetails.length === 0) {
      return { success: false, error: "불량수량이 있으면 불량코드별 수량을 입력해 주세요." }
    }
    const seen = new Set<string>()
    let detailSumScaled = ZERO_QTY
    for (const detail of defectDetails) {
      if (seen.has(detail.defectCodeId)) {
        return { success: false, error: "이미 선택된 불량코드입니다. 중복 없이 입력해 주세요." }
      }
      seen.add(detail.defectCodeId)
      if (!(detail.qty > 0)) {
        return { success: false, error: "불량코드별 수량은 1 이상이어야 합니다." }
      }
      try {
        detailSumScaled += toScaledQty(detail.qty, "불량코드 수량")
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "불량코드 수량 형식이 올바르지 않습니다." }
      }
    }
    const defectScaled = toScaledQty(defectQty, "불량수량")
    if (detailSumScaled !== defectScaled) {
      return {
        success: false,
        error: `불량코드 수량 합계(${formatScaledQty(detailSumScaled)})가 불량수량(${formatScaledQty(defectScaled)})과 일치해야 합니다.`,
      }
    }
  } else if (defectDetails.length > 0) {
    return { success: false, error: "불량수량이 0인데 불량코드가 입력되었습니다." }
  }

  try {
    const authCtx = await resolvePopAuthContext()
    if (authCtx.mode === "UNAUTHENTICATED") {
      return { success: false, error: "작업자 로그인이 필요합니다." }
    }
    let isCompleted = false

    await prisma.$transaction(async (tx) => {
      // 같은 공정의 동시 실적 등록을 직렬화한다. assignment 없는 공정도 F10 자재기준
      // 추가 생산가능량과 completedQty 집계를 공유하므로 동일 anchor를 먼저 잠근다.
      await lockWorkOrderOperationForUpdate(tx, workOrderOperationId)

      const op = await tx.workOrderOperation.findUnique({
        where: { id: workOrderOperationId },
        select: {
          id: true,
          status: true,
          completedQty: true,
          plannedQty: true,
          startedAt: true,
          workOrderId: true,
          seq: true,
          assignments: {
            select: {
              id: true,
              tenantId: true,
              workOrderOperationId: true,
              assignedQty: true,
              completedQty: true,
              status: true,
              startedAt: true,
            },
            orderBy: { seq: "asc" },
          },
          routingOperationId: true,
          routingOperation: {
            select: { workCenterId: true },
          },
          workOrder: {
            select: {
              tenantId: true,
              siteId: true,
              itemId: true,
              status: true,
              operations: {
                select: { seq: true, status: true },
                orderBy: { seq: "asc" },
              },
            },
          },
        },
      })
      if (!op) throw new Error("공정을 찾을 수 없습니다.")
      if (authCtx.mode === "POP_WORKER_SESSION") {
        if (authCtx.tenantId !== op.workOrder.tenantId) {
          throw new Error("작업자 세션과 작업지시 사업장이 일치하지 않습니다.")
        }
        assertPopSessionSiteMatch(authCtx.session, op.workOrder.siteId)
      }
      await assertActivePopOperator(tx, authCtx)

      const previousOperations = op.workOrder.operations.filter((candidate) => candidate.seq < op.seq)

      // ── 전공정 양품 기준 투입 가능 수량 제한 + 공정 완료 판단용 WIP 소진 여부 ────
      // 이 공정에 투입 가능한 수량은 plannedQty(작업지시 계획수량)가 아니라
      // 전공정에서 양품으로 넘어온 수량(= 현재 활성 root WipUnit 수량) 기준이어야 한다.
      // 전공정 불량/재작업으로 분리된 수량은 recordProductionResultQualityMovements에서
      // 이미 root WipUnit qty에서 차감되므로, root WipUnit 수량이 곧 "이동 가능 양품 + 재작업 복귀" 수량이다.
      //   이번 입력 허용치 = root WipUnit 현재 수량 - 이 공정에서 이미 기록한 양품수량
      // (root 수량은 이 공정에서 분리된 불량/재작업만큼 이미 줄어 있으므로, 양품 기처리분만 차감하면 된다.)
      //
      // wipExhaustedAfterThisResult: 이번 실적을 반영한 뒤 처리 가능 WIP가 전량 소진되는지 여부.
      // recordProductionResultQualityMovements 가 root qty -= (defect+rework) 를 수행하므로
      // 남은 WIP = availableInput - totalScaled. 0이면 이 공정에서 더 처리할 WIP가 없으므로
      // plannedQty 미달이더라도 공정을 완료 처리할 수 있다.
      const rootWip = await findActiveWipUnitForWorkOrder(tx, {
        tenantId: op.workOrder.tenantId,
        workOrderId: op.workOrderId,
      })
      // 재작업/보류관리(wip-hold.actions.ts) 방어 — 동시성: defectQty/reworkQty가 둘 다 0이면
      // recordProductionResultQualityMovements가 early return해 이 실적등록 경로 전체가 WipUnit을
      // 전혀 쓰지 않을 수 있다. 그 경우 createHold의 updateMany와 경쟁해도 자연스러운 row lock이
      // 걸리지 않으므로, 여기서 명시적으로 FOR UPDATE로 잠그고 잠금 이후의 최신 상태로 재확인한다
      // (line 699의 WorkOrderOperation FOR UPDATE와 동일한 기존 관례).
      let lockedRootWip: { status: WipUnitStatus; qty: Prisma.Decimal } | null = null
      if (rootWip) {
        await tx.$queryRaw`SELECT id FROM "WipUnit" WHERE id = ${rootWip.id} FOR UPDATE`
        lockedRootWip = await tx.wipUnit.findUnique({
          where: { id: rootWip.id },
          select: { status: true, qty: true },
        })
      }
      assertOperationResultAllowed({
        operationStatus: op.status,
        previousOperationStatuses: previousOperations.map((candidate) => candidate.status),
        materialIssuanceReady: lockedRootWip != null,
        wipStatus: lockedRootWip?.status ?? null,
      })
      let wipExhaustedAfterThisResult = false
      if (rootWip && lockedRootWip) {
        const rootQtyScaled = toScaledQty(lockedRootWip.qty, "이동 가능 수량", { allowZero: true })
        const goodAgg = await tx.productionResult.aggregate({
          where: { workOrderOperationId },
          _sum: { goodQty: true },
        })
        const goodSoFarScaled = toScaledQty(goodAgg._sum.goodQty ?? 0, "양품수량", { allowZero: true })
        const availableInputScaled = rootQtyScaled - goodSoFarScaled
        if (totalScaled > availableInputScaled) {
          const available = formatScaledQty(
            availableInputScaled > ZERO_QTY ? availableInputScaled : ZERO_QTY
          )
          throw new Error(
            `전공정에서 다음 공정으로 이동 가능한 수량은 ${available}개입니다. 불량/재작업 대기 수량을 먼저 처리해 주세요.`
          )
        }
        wipExhaustedAfterThisResult = availableInputScaled - totalScaled <= ZERO_QTY
      }

      const materialSufficiency = await getWorkOrderMaterialSufficiency(tx, {
        tenantId: op.workOrder.tenantId,
        workOrderOperationId,
      })
      assertProductionQuantityWithinMaterialLimit(
        materialSufficiency,
        Number(totalScaled) / Number(QTY_SCALE_MULTIPLIER)
      )

      const assignment = assignmentId
        ? op.assignments.find((candidate) => candidate.id === assignmentId) ?? null
        : null

      if (op.assignments.length > 0 && !assignmentId) {
        throw new Error("설비배정이 있는 공정은 설비를 선택해 실적을 등록해 주세요.")
      }

      if (assignmentId) {
        if (!assignment) throw new Error("설비배정을 찾을 수 없습니다.")
        if (assignment.workOrderOperationId !== workOrderOperationId) {
          throw new Error("설비배정과 공정이 일치하지 않습니다.")
        }
        if (assignment.tenantId !== op.workOrder.tenantId) {
          throw new Error("설비배정의 사업장 정보가 일치하지 않습니다.")
        }
        if (assignment.status === "COMPLETED") {
          throw new Error("이미 완료된 설비배정에는 실적을 추가할 수 없습니다.")
        }
        if (assignment.status !== "IN_PROGRESS") {
          throw new Error("설비배정 작업시작 후 실적을 등록해 주세요.")
        }

        const assignedScaled = toScaledQty(assignment.assignedQty, "배정수량")
        const assignmentCompletedScaled = toScaledQty(assignment.completedQty, "완료수량", { allowZero: true })
        const newAssignmentCompletedScaled = assignmentCompletedScaled + totalScaled

        if (newAssignmentCompletedScaled > assignedScaled) {
          const remainingScaled = assignedScaled - assignmentCompletedScaled
          throw new Error("잔여 수량(" + formatScaledQty(remainingScaled) + ")을 초과할 수 없습니다.")
        }

        const assignmentShouldComplete =
          newAssignmentCompletedScaled >= assignedScaled || wipExhaustedAfterThisResult
        const assignmentCompletedById = new Map(
          op.assignments.map((candidate) => [
            candidate.id,
            candidate.id === assignment.id
              ? newAssignmentCompletedScaled
              : toScaledQty(candidate.completedQty, "완료수량", { allowZero: true }),
          ])
        )
        const operationCompletedScaled = sumScaledQty(Array.from(assignmentCompletedById.values()))

        const previousResult = await tx.productionResult.findFirst({
          where: {
            workOrderOperationId,
            workOrderOperationAssignmentId: assignment.id,
            endedAt: { not: null },
          },
          select: { endedAt: true },
          orderBy: { endedAt: "desc" },
        })
        const resultTime = resolveProductionResultTime({
          endedAt: new Date(),
          operationStartedAt: op.startedAt,
          assignmentStartedAt: assignment.startedAt,
          previousResultEndedAt: previousResult?.endedAt ?? null,
        })

        const createdResult = await tx.productionResult.create({
          data: {
            workOrderOperationId,
            workOrderOperationAssignmentId: assignment.id,
            goodQty,
            defectQty,
            reworkQty,
            startedAt: resultTime.startedAt,
            endedAt: resultTime.endedAt,
            operatorId: authCtx.profileId,
          },
        })

        await recordPopToolUsage(tx, {
          tenantId: op.workOrder.tenantId,
          siteId: op.workOrder.siteId,
          routingOperationId: op.routingOperationId,
          workOrderOperationId,
          productionResultId: createdResult.id,
          itemId: op.workOrder.itemId,
          operatorProfileId: authCtx.profileId,
          usedAt: resultTime.endedAt,
          toolIds: selectedToolIds,
        })

        await recordProductionResultQualityMovements(tx, {
          tenantId: op.workOrder.tenantId,
          siteId: op.workOrder.siteId,
          workOrderId: op.workOrderId,
          operationId: workOrderOperationId,
          workCenterId: op.routingOperation.workCenterId,
          productionResultId: createdResult.id,
          defectQty,
          reworkQty,
        })

        // POP 불량을 자주검사(QualityInspection + DefectRecord)로 기록 → 불량통계 반영
        await recordSelfInspectionDefects(tx, {
          tenantId: op.workOrder.tenantId,
          workOrderOperationId,
          itemId: op.workOrder.itemId,
          routingOperationId: op.routingOperationId,
          inspectorProfileId: authCtx.profileId,
          inspectedQty: goodQty + defectQty + reworkQty,
          defectDetails,
        })

        await tx.workOrderOperationAssignment.update({
          where: { id: assignment.id },
          data: {
            completedQty: formatScaledQty(newAssignmentCompletedScaled),
            status: assignmentShouldComplete ? "COMPLETED" : "IN_PROGRESS",
          },
        })

        // WIP 전량 소진 시 아직 처리 대기 중인 다른 설비배정도 완료 처리한다.
        // completedQty는 실제 처리한 수량 그대로 유지하고 status만 COMPLETED로 전환한다.
        if (wipExhaustedAfterThisResult) {
          await tx.workOrderOperationAssignment.updateMany({
            where: {
              workOrderOperationId,
              status: { in: ["PENDING", "IN_PROGRESS"] },
              id: { not: assignment.id },
            },
            data: { status: "COMPLETED" },
          })
        }

        // Re-query after update: lock guarantees no concurrent modifications; fresh read
        // includes our just-applied update, replacing stale snapshot-based calculation
        const freshAssignments = await tx.workOrderOperationAssignment.findMany({
          where: { workOrderOperationId },
          select: { status: true },
        })
        const allAssignmentsCompleted = freshAssignments.every((a) => a.status === "COMPLETED")

        await tx.workOrderOperation.update({
          where: { id: workOrderOperationId },
          data: {
            completedQty: formatScaledQty(operationCompletedScaled),
            ...(allAssignmentsCompleted ? { status: "COMPLETED" as OperationStatus } : {}),
          },
        })

        if (allAssignmentsCompleted) {
          isCompleted = true
          const allOps = await tx.workOrderOperation.findMany({
            where: { workOrderId: op.workOrderId },
            select: {
              id: true,
              seq: true,
              status: true,
              routingOperation: { select: { workCenterId: true } },
            },
            orderBy: { seq: "asc" },
          })
          const allCompleted = allOps.every((candidate) => candidate.status === "COMPLETED")
          if (allCompleted) {
            await tx.workOrder.update({
              where: { id: op.workOrderId },
              data: { status: "COMPLETED" },
            })
            await syncProductionPlanStatusForWorkOrder(
              tx,
              op.workOrderId,
              op.workOrder.tenantId
            )
          }

          const nextOp = allOps.find((candidate) => candidate.seq > op.seq)
          await advanceWipUnitOnOperationComplete(tx, {
            tenantId: op.workOrder.tenantId,
            siteId: op.workOrder.siteId,
            workOrderId: op.workOrderId,
            completedOperationId: workOrderOperationId,
            completedWorkCenterId: op.routingOperation.workCenterId,
            nextOperation: nextOp
              ? {
                  id: nextOp.id,
                  routingOperation: {
                    workCenterId: nextOp.routingOperation.workCenterId,
                  },
                }
              : null,
            productionResultId: createdResult.id,
          })
        }

        return
      }

      const currentCompletedScaled = toScaledQty(op.completedQty, "완료수량", { allowZero: true })
      const plannedScaled = toScaledQty(op.plannedQty, "계획수량")
      const newCompletedScaled = currentCompletedScaled + totalScaled

      if (newCompletedScaled > plannedScaled) {
        const remainingScaled = plannedScaled - currentCompletedScaled
        throw new Error("잔여 수량(" + formatScaledQty(remainingScaled) + ")을 초과할 수 없습니다.")
      }

      const shouldComplete = newCompletedScaled >= plannedScaled || wipExhaustedAfterThisResult

      const previousResult = await tx.productionResult.findFirst({
        where: {
          workOrderOperationId,
          workOrderOperationAssignmentId: null,
          endedAt: { not: null },
        },
        select: { endedAt: true },
        orderBy: { endedAt: "desc" },
      })
      const resultTime = resolveProductionResultTime({
        endedAt: new Date(),
        operationStartedAt: op.startedAt,
        previousResultEndedAt: previousResult?.endedAt ?? null,
      })

      const createdResult = await tx.productionResult.create({
        data: {
          workOrderOperationId,
          goodQty,
          defectQty,
          reworkQty,
          startedAt: resultTime.startedAt,
          endedAt: resultTime.endedAt,
          operatorId: authCtx.profileId,
        },
      })

      await recordPopToolUsage(tx, {
        tenantId: op.workOrder.tenantId,
        siteId: op.workOrder.siteId,
        routingOperationId: op.routingOperationId,
        workOrderOperationId,
        productionResultId: createdResult.id,
        itemId: op.workOrder.itemId,
        operatorProfileId: authCtx.profileId,
        usedAt: resultTime.endedAt,
        toolIds: selectedToolIds,
      })

      await recordProductionResultQualityMovements(tx, {
        tenantId: op.workOrder.tenantId,
        siteId: op.workOrder.siteId,
        workOrderId: op.workOrderId,
        operationId: workOrderOperationId,
        workCenterId: op.routingOperation.workCenterId,
        productionResultId: createdResult.id,
        defectQty,
        reworkQty,
      })

      // POP 불량을 자주검사(QualityInspection + DefectRecord)로 기록 → 불량통계 반영
      await recordSelfInspectionDefects(tx, {
        tenantId: op.workOrder.tenantId,
        workOrderOperationId,
        itemId: op.workOrder.itemId,
        routingOperationId: op.routingOperationId,
        inspectorProfileId: authCtx.profileId,
        inspectedQty: goodQty + defectQty + reworkQty,
        defectDetails,
      })

      await tx.workOrderOperation.update({
        where: { id: workOrderOperationId },
        data: {
          completedQty: formatScaledQty(newCompletedScaled),
          ...(shouldComplete ? { status: "COMPLETED" as OperationStatus } : {}),
        },
      })

      if (shouldComplete) {
        isCompleted = true
        const allOps = await tx.workOrderOperation.findMany({
          where: { workOrderId: op.workOrderId },
          select: {
            id: true,
            seq: true,
            status: true,
            routingOperation: { select: { workCenterId: true } },
          },
          orderBy: { seq: "asc" },
        })
        const allCompleted = allOps.every((candidate) => candidate.status === "COMPLETED")
        if (allCompleted) {
          await tx.workOrder.update({
            where: { id: op.workOrderId },
            data: { status: "COMPLETED" },
          })
          await syncProductionPlanStatusForWorkOrder(
            tx,
            op.workOrderId,
            op.workOrder.tenantId
          )
        }

        const nextOp = allOps.find((candidate) => candidate.seq > op.seq)
        await advanceWipUnitOnOperationComplete(tx, {
          tenantId: op.workOrder.tenantId,
          siteId: op.workOrder.siteId,
          workOrderId: op.workOrderId,
          completedOperationId: workOrderOperationId,
          completedWorkCenterId: op.routingOperation.workCenterId,
          nextOperation: nextOp
            ? {
                id: nextOp.id,
                routingOperation: {
                  workCenterId: nextOp.routingOperation.workCenterId,
                },
              }
            : null,
          productionResultId: createdResult.id,
        })
      }
    })

    revalidatePath("/app/pop/work-queue")
    revalidatePath("/pop/work-select")
    if (selectedToolIds.length > 0) revalidatePath("/app/mes/equipment-tools")
    revalidatePath("/app/mes/production-plan")
    return { success: true, isCompleted }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "오류가 발생했습니다." }
  }
}

export async function startOperation(
  operationId: string,
  assignmentId?: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const authCtx = await resolvePopAuthContext()
    if (authCtx.mode === "UNAUTHENTICATED") {
      return { success: false, error: "작업자 로그인이 필요합니다." }
    }
    const tenantId = authCtx.tenantId

    const op = await prisma.workOrderOperation.findFirst({
      where: {
        id: operationId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
        workOrder: { tenantId },
      },
      select: {
        status: true,
        startedAt: true,
        seq: true,
        workOrderId: true,
        assignments: {
          select: {
            id: true,
            tenantId: true,
            workOrderOperationId: true,
            status: true,
            startedAt: true,
          },
        },
        routingOperation: {
          select: { workCenterId: true },
        },
        workOrder: {
          select: {
            id: true,
            siteId: true,
            status: true,
            operations: {
              select: { seq: true, status: true },
              orderBy: { seq: "asc" },
            },
          },
        },
      },
    })

    if (!op) {
      return { success: false, error: "Operation not found or already completed." }
    }

    if (authCtx.mode === "POP_WORKER_SESSION" && authCtx.siteId != null) {
      if (op.workOrder.siteId != null && op.workOrder.siteId !== authCtx.siteId) {
        return { success: false, error: "해당 작업장의 작업만 처리할 수 있습니다." }
      }
    }

    const prevOps = op.workOrder.operations.filter((o) => o.seq < op.seq)
    const rootWip = await findActiveWipUnitForWorkOrder(prisma, {
      tenantId,
      workOrderId: op.workOrderId,
    })
    assertOperationStartAllowed({
      operationStatus: op.status,
      workOrderStatus: op.workOrder.status,
      previousOperationStatuses: prevOps.map((operation) => operation.status),
      materialIssuanceReady: rootWip != null,
      wipStatus: rootWip?.status ?? null,
    })

    const assignment = assignmentId
      ? op.assignments.find((candidate) => candidate.id === assignmentId) ?? null
      : null

    if (op.assignments.length > 0 && !assignmentId) {
      return { success: false, error: "Select an equipment assignment before starting work." }
    }

    if (assignmentId) {
      if (!assignment) {
        return { success: false, error: "Equipment assignment not found." }
      }
      if (assignment.workOrderOperationId !== operationId || assignment.tenantId !== tenantId) {
        return { success: false, error: "Equipment assignment does not match this operation." }
      }
      if (assignment.status === "COMPLETED") {
        return { success: false, error: "Equipment assignment is already completed." }
      }
    }

    await prisma.$transaction(async (tx) => {
      await assertActivePopOperator(tx, authCtx)
      // 재작업/보류관리 방어(동시성): op.status가 이미 IN_PROGRESS인 경우(새 설비배정만
      // 시작하는 경로)에는 transitionWipUnitOnStart를 거치지 않아 WipUnit을 전혀 쓰지 않으므로
      // createHold의 updateMany와 경쟁해도 자연스러운 row lock이 걸리지 않는다. transaction
      // 내부에서 FOR UPDATE로 명시적으로 잠근 뒤 잠금 이후의 최신 상태로 재확인해야
      // "root WIP 조회 → HOLD 등록 끼어듦 → transaction 시작" 경쟁을 막을 수 있다.
      // PENDING/IN_PROGRESS operation 모두 여기서 공통으로 적용한다.
      const rootWipForHoldCheck = await findActiveWipUnitForWorkOrder(tx, {
        tenantId,
        workOrderId: op.workOrderId,
      })
      let lockedWipStatus = null
      if (rootWipForHoldCheck) {
        await tx.$queryRaw`SELECT id FROM "WipUnit" WHERE id = ${rootWipForHoldCheck.id} FOR UPDATE`
        const lockedWip = await tx.wipUnit.findUnique({
          where: { id: rootWipForHoldCheck.id },
          select: { status: true },
        })
        lockedWipStatus = lockedWip?.status ?? null
      }
      assertOperationStartAllowed({
        operationStatus: op.status,
        workOrderStatus: op.workOrder.status,
        previousOperationStatuses: prevOps.map((operation) => operation.status),
        materialIssuanceReady: lockedWipStatus != null,
        wipStatus: lockedWipStatus,
      })

      const startedAt = new Date()
      if (op.status === "PENDING") {
        await tx.workOrderOperation.update({
          where: { id: operationId },
          data: { status: "IN_PROGRESS", startedAt },
        })
        await tx.workOrder.update({
          where: { id: op.workOrderId },
          data: { status: "IN_PROGRESS" },
        })
        await syncProductionPlanStatusForWorkOrder(tx, op.workOrderId, tenantId)

        await transitionWipUnitOnStart(tx, {
          tenantId,
          siteId: op.workOrder.siteId,
          workOrderId: op.workOrderId,
          operationId,
          workCenterId: op.routingOperation.workCenterId,
        })
      }

      if (assignment && assignment.status === "PENDING") {
        await tx.workOrderOperationAssignment.update({
          where: { id: assignment.id },
          data: { status: "IN_PROGRESS", startedAt },
        })
      }
    })

    revalidatePath("/app/pop/work-queue")
    revalidatePath("/pop/work-select")
    revalidatePath("/app/mes/production-plan")
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "오류가 발생했습니다." }
  }
}

export async function getTodayProductionResults() {
  const authCtx = await resolvePopAuthContext()
  if (authCtx.mode === "UNAUTHENTICATED") return []

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  return prisma.productionResult.findMany({
    where: {
      startedAt: { gte: today, lt: tomorrow },
      workOrderOperation: {
        workOrder: {
          tenantId: authCtx.tenantId,
          ...(authCtx.mode === "POP_WORKER_SESSION" && authCtx.siteId != null
            ? { siteId: authCtx.siteId }
            : {}),
        },
      },
    },
    include: {
      workOrderOperation: {
        include: {
          routingOperation: { select: { name: true } },
          workOrder: {
            include: {
              item: { select: { name: true, code: true } },
            },
          },
        },
      },
    },
    orderBy: { startedAt: "desc" },
  })
}

// ─── 6. 공정 상태 변경 + WorkOrder 상태 자동 갱신 ────────────────────────────

export async function updateOperationStatus(
  operationId: string,
  status: OperationStatus
): Promise<{ success: boolean; error?: string }> {
  await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const operation = await prisma.workOrderOperation.findFirst({
    where: { id: operationId, workOrder: { tenantId } },
    select: { status: true },
  })
  if (!operation) return { success: false, error: "공정을 찾을 수 없습니다." }

  try {
    assertDirectOperationStatusRequestAllowed(operation.status, status)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "오류가 발생했습니다." }
  }
  return startOperation(operationId)
}
