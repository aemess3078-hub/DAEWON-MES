import { InspectionResult, InspectionStage, Prisma } from "@prisma/client"

type DbClient = Prisma.TransactionClient | typeof import("@/lib/db/prisma").prisma

export type QualityReleaseStatus = {
  requiresInspection: boolean
  inspectionStatus: "NOT_REQUIRED" | "NOT_INSPECTED" | InspectionResult
  inspectionId: string | null
  inspectionResult: InspectionResult | null
  inspectionSpecId: string | null
  blockingReason: string | null
}

export type QualityReleaseTarget = "RECEIPT" | "SHIPMENT"

const MESSAGES = {
  RECEIPT: {
    pending: "최종검사를 완료한 후 완제품을 입고할 수 있습니다.",
    failed: "최종검사 불합격 제품은 입고할 수 없습니다.",
  },
  SHIPMENT: {
    pending: "최종검사를 완료한 후 출하할 수 있습니다.",
    failed: "최종검사 불합격 제품은 출하할 수 없습니다.",
  },
} as const

export function evaluateQualityRelease(input: {
  inspectionSpecId: string | null
  inspections: Array<{
    id: string
    inspectionSpecId: string
    stage: InspectionStage
    result: InspectionResult | null
    inspectedAt: Date
  }>
}): QualityReleaseStatus {
  if (!input.inspectionSpecId) {
    return {
      requiresInspection: false,
      inspectionStatus: "NOT_REQUIRED",
      inspectionId: null,
      inspectionResult: null,
      inspectionSpecId: null,
      blockingReason: null,
    }
  }

  const latest = input.inspections
    .filter(
      (inspection) =>
        inspection.inspectionSpecId === input.inspectionSpecId &&
        inspection.stage === InspectionStage.FINAL,
    )
    .slice()
    .sort(
      (a, b) =>
        b.inspectedAt.getTime() - a.inspectedAt.getTime() || b.id.localeCompare(a.id),
    )[0]

  return {
    requiresInspection: true,
    inspectionStatus: latest?.result ?? "NOT_INSPECTED",
    inspectionId: latest?.id ?? null,
    inspectionResult: latest?.result ?? null,
    inspectionSpecId: input.inspectionSpecId,
    blockingReason: latest?.result === InspectionResult.PASS ? null : "QUALITY_RELEASE_BLOCKED",
  }
}

async function getWorkOrderFinalInspectionContext(
  db: DbClient,
  input: { tenantId: string; workOrderId: string },
) {
  const workOrder = await db.workOrder.findFirst({
    where: { id: input.workOrderId, tenantId: input.tenantId },
    select: {
      itemId: true,
      operations: {
        orderBy: [{ seq: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          id: true,
          routingOperationId: true,
          qualityInspections: {
            where: { stage: InspectionStage.FINAL },
            select: {
              id: true,
              inspectionSpecId: true,
              stage: true,
              result: true,
              inspectedAt: true,
              lotId: true,
            },
          },
        },
      },
    },
  })
  if (!workOrder) throw new Error("작업지시를 찾을 수 없습니다.")

  const finalOperation = workOrder.operations[0]
  if (!finalOperation) {
    return { activeSpec: null, finalOperation: null }
  }

  const activeSpec = await db.inspectionSpec.findFirst({
    where: {
      tenantId: input.tenantId,
      itemId: workOrder.itemId,
      routingOperationId: finalOperation.routingOperationId,
      status: "ACTIVE",
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  })

  return { activeSpec, finalOperation }
}

export async function getWorkOrderQualityReleaseStatus(
  db: DbClient,
  input: { tenantId: string; workOrderId: string },
): Promise<QualityReleaseStatus> {
  const { activeSpec, finalOperation } = await getWorkOrderFinalInspectionContext(db, input)

  return evaluateQualityRelease({
    inspectionSpecId: activeSpec?.id ?? null,
    inspections: finalOperation?.qualityInspections ?? [],
  })
}

export async function getWorkOrderLotQualityReleaseStatus(
  db: DbClient,
  input: { tenantId: string; workOrderId: string; lotId: string },
): Promise<QualityReleaseStatus> {
  const { activeSpec, finalOperation } = await getWorkOrderFinalInspectionContext(db, input)
  if (!finalOperation || !activeSpec) {
    return evaluateQualityRelease({ inspectionSpecId: null, inspections: [] })
  }

  const inspections = finalOperation.qualityInspections
  const activeFinalInspections = inspections.filter(
    (inspection) =>
      inspection.inspectionSpecId === activeSpec.id &&
      inspection.stage === InspectionStage.FINAL,
  )
  const hasLotSpecificInspection = activeFinalInspections.some((inspection) => inspection.lotId)

  return evaluateQualityRelease({
    inspectionSpecId: activeSpec.id,
    inspections: hasLotSpecificInspection
      ? activeFinalInspections.filter((inspection) => inspection.lotId === input.lotId)
      : activeFinalInspections,
  })
}

export function assertQualityReleaseAllowed(
  status: QualityReleaseStatus,
  target: QualityReleaseTarget,
) {
  if (!status.requiresInspection || status.inspectionResult === InspectionResult.PASS) return
  if (status.inspectionResult === InspectionResult.FAIL) throw new Error(MESSAGES[target].failed)
  throw new Error(MESSAGES[target].pending)
}

export async function assertWorkOrderQualityReleaseAllowed(
  db: DbClient,
  input: { tenantId: string; workOrderId: string; target: QualityReleaseTarget },
) {
  const status = await getWorkOrderQualityReleaseStatus(db, input)
  assertQualityReleaseAllowed(status, input.target)
  return status
}

export async function assertWorkOrderLotQualityReleaseAllowed(
  db: DbClient,
  input: { tenantId: string; workOrderId: string; lotId: string; target: QualityReleaseTarget },
) {
  const status = await getWorkOrderLotQualityReleaseStatus(db, input)
  assertQualityReleaseAllowed(status, input.target)
  return status
}

export async function assertLotQualityReleaseAllowed(
  db: DbClient,
  input: { tenantId: string; lotId: string; target?: QualityReleaseTarget },
) {
  const receipts = await db.finishedGoodsReceipt.findMany({
    where: { tenantId: input.tenantId, lotId: input.lotId },
    select: { workOrderId: true },
    distinct: ["workOrderId"],
  })

  // 생산입고 이력이 없는 기초/수동/외부구매 LOT은 기존 출하 정책을 유지한다.
  for (const receipt of receipts) {
    await assertWorkOrderLotQualityReleaseAllowed(db, {
      tenantId: input.tenantId,
      workOrderId: receipt.workOrderId,
      lotId: input.lotId,
      target: input.target ?? "SHIPMENT",
    })
  }
}
