import { InspectionResult } from "@prisma/client"
import { validateMeasurements, type CreateMeasurementInput } from "./inspection-measurement.helpers"

type InspectionContextClient = {
  workOrderOperation: { findFirst(args: object): Promise<any> }
  inspectionSpec: { findFirst(args: object): Promise<any> }
  profile: { findFirst(args: object): Promise<any> }
  defectCode: { count(args: object): Promise<number> }
  lot: { findFirst(args: object): Promise<any> }
}

export type InspectionMutationInput = {
  workOrderOperationId: string
  inspectionSpecId: string
  inspectorId: string
  result: InspectionResult | null
  inspectedQty: number
  lotId?: string | null
  measurements?: CreateMeasurementInput[]
  defectRecords?: { defectCodeId: string }[]
}

/** The single server-side authority for every QualityInspection creation path. */
export async function validateInspectionMutationContext(
  client: InspectionContextClient,
  tenantId: string,
  data: InspectionMutationInput,
) {
  if (!Number.isFinite(data.inspectedQty) || data.inspectedQty <= 0) {
    throw new Error("검사 수량은 0보다 커야 합니다.")
  }
  if (data.result !== null && !Object.values(InspectionResult).includes(data.result)) {
    throw new Error("유효하지 않은 검사 판정입니다.")
  }

  const [operation, spec, inspector, lot] = await Promise.all([
    client.workOrderOperation.findFirst({
      where: { id: data.workOrderOperationId, workOrder: { tenantId } },
      select: { routingOperationId: true, workOrder: { select: { id: true, itemId: true } } },
    }),
    client.inspectionSpec.findFirst({
      where: { id: data.inspectionSpecId, tenantId, status: "ACTIVE" },
      select: { routingOperationId: true, itemId: true, inspectionItems: { select: { id: true, name: true, inputType: true, lowerLimit: true, upperLimit: true, unit: true } } },
    }),
    client.profile.findFirst({
      where: { id: data.inspectorId, tenantUsers: { some: { tenantId, isActive: true } } },
      select: { id: true },
    }),
    data.lotId
      ? client.lot.findFirst({
          where: { id: data.lotId, tenantId },
          select: { id: true, itemId: true, lotNo: true },
        })
      : Promise.resolve(null),
  ])
  if (!operation) throw new Error("검사 대상 작업지시 공정을 찾을 수 없습니다.")
  if (!spec) throw new Error("활성 검사표준을 찾을 수 없습니다.")
  if (!inspector) throw new Error("검사자를 찾을 수 없습니다.")
  if (data.lotId && !lot) throw new Error("검사 대상 LOT를 찾을 수 없습니다.")
  if (lot && lot.itemId !== operation.workOrder.itemId) {
    throw new Error("검사 대상 LOT 품목이 작업지시 품목과 일치하지 않습니다.")
  }
  if (operation.routingOperationId !== spec.routingOperationId || operation.workOrder.itemId !== spec.itemId) {
    throw new Error("검사표준이 선택한 작업지시 공정 및 품목과 일치하지 않습니다.")
  }
  const defectCodeIds = Array.from(new Set((data.defectRecords ?? []).map((record) => record.defectCodeId)))
  if (defectCodeIds.length > 0 && await client.defectCode.count({ where: { tenantId, id: { in: defectCodeIds } } }) !== defectCodeIds.length) {
    throw new Error("하나 이상의 불량코드가 현재 tenant에 속하지 않습니다.")
  }
  return {
    validatedLotId: lot?.id ?? null,
    validatedMeasurements: validateMeasurements(data.measurements ?? [], spec.inspectionItems),
  }
}

export async function assertInspectionHistoryMutable(client: any, inspectionId: string, tenantId: string) {
  const inspection = await client.qualityInspection.findFirst({
    where: { id: inspectionId, workOrderOperation: { workOrder: { tenantId } } },
    select: { id: true, defectRecords: { select: { id: true, causeAnalysis: { select: { id: true } }, correctiveActions: { select: { id: true } }, recurrencePreventions: { select: { id: true } } } } },
  })
  if (!inspection) throw new Error("검사 기록을 찾을 수 없습니다.")
  if (inspection.defectRecords.length > 0) {
    throw new Error("연결된 품질 이력이 있어 삭제하거나 판정을 변경할 수 없습니다.")
  }
  return inspection
}
