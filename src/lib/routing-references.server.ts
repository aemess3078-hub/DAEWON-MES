import { prisma } from "@/lib/db/prisma"
import type { Prisma } from "@prisma/client"

type RoutingReferenceDb = Prisma.TransactionClient | typeof prisma

export type RoutingOperationReferenceSummary = {
  workOrderOperationCount: number
  inspectionSpecCount: number
  equipmentMapCount: number
  workStandardMappingCount: number
}

export async function getRoutingOperationReferences(
  db: RoutingReferenceDb,
  routingOperationIds: string[]
): Promise<RoutingOperationReferenceSummary> {
  if (routingOperationIds.length === 0) {
    return {
      workOrderOperationCount: 0,
      inspectionSpecCount: 0,
      equipmentMapCount: 0,
      workStandardMappingCount: 0,
    }
  }

  const [workOrderOperationCount, inspectionSpecCount, equipmentMapCount, workStandardMappingCount] =
    await Promise.all([
      db.workOrderOperation.count({ where: { routingOperationId: { in: routingOperationIds } } }),
      db.inspectionSpec.count({ where: { routingOperationId: { in: routingOperationIds } } }),
      db.equipmentOperationMap.count({ where: { routingOperationId: { in: routingOperationIds } } }),
      db.workStandardMapping.count({ where: { routingOperationId: { in: routingOperationIds } } }),
    ])

  return { workOrderOperationCount, inspectionSpecCount, equipmentMapCount, workStandardMappingCount }
}
