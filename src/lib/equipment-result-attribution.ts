import type { Prisma } from "@prisma/client"

export type ActualEquipmentRef = {
  id: string
  code: string
  name: string
}

export type ActualEquipmentSource = {
  workOrderOperationAssignment?: {
    equipment: ActualEquipmentRef | null
  } | null
  workOrderOperation?: {
    equipment: ActualEquipmentRef | null
  } | null
}

export function resolveActualProductionEquipment<
  TAssignmentEquipment extends ActualEquipmentRef = ActualEquipmentRef,
  TOperationEquipment extends ActualEquipmentRef = ActualEquipmentRef,
>(result: {
  workOrderOperationAssignment?: {
    equipment: TAssignmentEquipment | null
  } | null
  workOrderOperation?: {
    equipment: TOperationEquipment | null
  } | null
}): TAssignmentEquipment | TOperationEquipment | null {
  return (
    result.workOrderOperationAssignment?.equipment ??
    result.workOrderOperation?.equipment ??
    null
  )
}

export function actualProductionEquipmentWhere(
  equipmentIds?: string | string[] | null
): Prisma.ProductionResultWhereInput {
  const ids = Array.isArray(equipmentIds)
    ? equipmentIds.filter(Boolean)
    : equipmentIds
    ? [equipmentIds]
    : []

  if (ids.length === 0) return {}

  const equipmentId = ids.length === 1 ? ids[0] : { in: ids }

  return {
    OR: [
      {
        workOrderOperationAssignment: {
          equipmentId,
        },
      },
      {
        workOrderOperationAssignmentId: null,
        workOrderOperation: {
          equipmentId,
        },
      },
    ],
  }
}
