export type ExistingProductionPlanItem = {
  id: string
  itemId: string
  salesOrderItemId: string | null
  salesOrderItemTenantId: string | null
}

export type SubmittedProductionPlanItem = {
  productionPlanItemId?: string | null
  itemId: string
  salesOrderItemId?: string | null
}

export type ProductionPlanItemReconciliation = {
  updateIds: string[]
  createIndexes: number[]
  deleteIds: string[]
}

/**
 * Reconciles editable rows without trusting a client-supplied sales-order link.
 * Existing links are retained from the database and new rows are always manual.
 */
export function reconcileProductionPlanItems(
  tenantId: string,
  existingItems: ExistingProductionPlanItem[],
  submittedItems: SubmittedProductionPlanItem[]
): ProductionPlanItemReconciliation {
  const existingById = new Map(existingItems.map((item) => [item.id, item]))
  const retainedIds = new Set<string>()
  const updateIds: string[] = []
  const createIndexes: number[] = []

  submittedItems.forEach((submittedItem, index) => {
    const productionPlanItemId = submittedItem.productionPlanItemId?.trim()

    if (!productionPlanItemId) {
      if (submittedItem.salesOrderItemId) {
        throw new Error("새 생산계획 품목에 수주 연결을 직접 지정할 수 없습니다.")
      }
      createIndexes.push(index)
      return
    }

    if (retainedIds.has(productionPlanItemId)) {
      throw new Error("동일한 생산계획 품목을 중복으로 저장할 수 없습니다.")
    }

    const existingItem = existingById.get(productionPlanItemId)
    if (!existingItem) {
      throw new Error("현재 생산계획에 속하지 않은 품목은 수정할 수 없습니다.")
    }

    if (
      submittedItem.salesOrderItemId !== undefined &&
      submittedItem.salesOrderItemId !== existingItem.salesOrderItemId
    ) {
      throw new Error("수주 품목 연결은 변경할 수 없습니다.")
    }

    if (
      existingItem.salesOrderItemId &&
      existingItem.salesOrderItemTenantId !== tenantId
    ) {
      throw new Error("다른 테넌트의 수주 품목을 생산계획에 연결할 수 없습니다.")
    }

    if (existingItem.salesOrderItemId && submittedItem.itemId !== existingItem.itemId) {
      throw new Error("수주와 연결된 생산계획 품목은 다른 품목으로 변경할 수 없습니다.")
    }

    retainedIds.add(productionPlanItemId)
    updateIds.push(productionPlanItemId)
  })

  return {
    updateIds,
    createIndexes,
    deleteIds: existingItems
      .filter((item) => !retainedIds.has(item.id))
      .map((item) => item.id),
  }
}
