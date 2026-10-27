import { Prisma } from "@prisma/client"

export const CONCURRENT_QUANTITY_CHANGE_MESSAGE =
  "다른 작업으로 수량이 변경되었습니다. 현재 수량을 확인한 후 다시 시도해주세요."

const DEFAULT_MAX_ATTEMPTS = 3

export function isRetryableQuantityTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034"
  }

  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes("deadlock detected") ||
    message.includes("could not serialize access") ||
    message.includes("serialization failure") ||
    message.includes("write conflict")
  )
}

export async function withQuantityTransactionRetry<T>(
  operation: () => Promise<T>,
  options: { maxAttempts?: number } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isRetryableQuantityTransactionError(error) || attempt >= maxAttempts - 1) {
        break
      }
    }
  }

  if (lastError && isRetryableQuantityTransactionError(lastError)) {
    throw new Error(CONCURRENT_QUANTITY_CHANGE_MESSAGE)
  }
  throw lastError
}

function uniqueSorted(ids: Array<string | null | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => !!id))).sort()
}

export async function lockInventoryBalancesForUpdate(
  tx: Prisma.TransactionClient,
  ids: Array<string | null | undefined>
): Promise<void> {
  const sortedIds = uniqueSorted(ids)
  if (sortedIds.length === 0) return

  await tx.$queryRaw`
    SELECT id
    FROM "InventoryBalance"
    WHERE id IN (${Prisma.join(sortedIds)})
    ORDER BY id
    FOR UPDATE
  `
}

export async function lockSalesOrderItemsForUpdate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ids: Array<string | null | undefined>
): Promise<void> {
  const sortedIds = uniqueSorted(ids)
  if (sortedIds.length === 0) return

  await tx.$queryRaw`
    SELECT soi.id
    FROM "SalesOrderItem" soi
    JOIN "SalesOrder" so ON so.id = soi."salesOrderId"
    WHERE soi.id IN (${Prisma.join(sortedIds)})
      AND so."tenantId" = ${tenantId}
    ORDER BY soi.id
    FOR UPDATE
  `
}

export async function lockProductionPlanItemsForUpdate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ids: Array<string | null | undefined>
): Promise<void> {
  const sortedIds = uniqueSorted(ids)
  if (sortedIds.length === 0) return

  await tx.$queryRaw`
    SELECT ppi.id
    FROM "ProductionPlanItem" ppi
    JOIN "ProductionPlan" pp ON pp.id = ppi."planId"
    WHERE ppi.id IN (${Prisma.join(sortedIds)})
      AND pp."tenantId" = ${tenantId}
    ORDER BY ppi.id
    FOR UPDATE
  `
}

export async function lockPurchaseOrderItemsForUpdate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ids: Array<string | null | undefined>
): Promise<void> {
  const sortedIds = uniqueSorted(ids)
  if (sortedIds.length === 0) return

  await tx.$queryRaw`
    SELECT poi.id
    FROM "PurchaseOrderItem" poi
    JOIN "PurchaseOrder" po ON po.id = poi."purchaseOrderId"
    WHERE poi.id IN (${Prisma.join(sortedIds)})
      AND po."tenantId" = ${tenantId}
    ORDER BY poi.id
    FOR UPDATE
  `
}

export async function lockWorkOrderForUpdate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workOrderId: string
): Promise<void> {
  await tx.$queryRaw`
    SELECT id
    FROM "WorkOrder"
    WHERE id = ${workOrderId}
      AND "tenantId" = ${tenantId}
    FOR UPDATE
  `
}

/**
 * LOT 행 공유 잠금(FOR SHARE). 출고 트랜잭션이 끝날 때까지 다른 트랜잭션이 이 LOT 의 상태·유효기간을 바꾸지 못하게 한다
 * (LOT 상태 변경은 UPDATE 라 잠금이 풀릴 때까지 기다린다). 공유 잠금끼리는 충돌하지 않아 동시 출고는 서로 막지 않는다.
 * id 만 읽는다(enum 컬럼을 raw 로 읽지 않는다).
 */
export async function lockLotForShare(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lotId: string
): Promise<void> {
  await tx.$queryRaw`
    SELECT id
    FROM "Lot"
    WHERE id = ${lotId}
      AND "tenantId" = ${tenantId}
    FOR SHARE
  `
}

export async function lockWorkOrderOperationForUpdate(
  tx: Prisma.TransactionClient,
  workOrderOperationId: string
): Promise<void> {
  await tx.$queryRaw`
    SELECT id
    FROM "WorkOrderOperation"
    WHERE id = ${workOrderOperationId}
    FOR UPDATE
  `
}
