const QTY_DECIMAL_SCALE = 6
const QTY_SCALE_MULTIPLIER = BigInt("1000000")
const ZERO_QTY = BigInt(0)

export type QuantityValue = number | string | { toString(): string }

export type WorkOrderAllocation = {
  id: string
  plannedQty: QuantityValue
  status: string
}

export type ProductionPlanItemAllocation = {
  id: string
  plannedQty: QuantityValue
  workOrders: WorkOrderAllocation[]
}

function toScaledQty(value: QuantityValue, fieldName: string): bigint {
  const raw = value.toString().trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`${fieldName}은 숫자여야 합니다.`)
  }

  const [integerPart, decimalPart = ""] = raw.split(".")
  if (decimalPart.length > QTY_DECIMAL_SCALE) {
    throw new Error(`${fieldName}은 소수점 ${QTY_DECIMAL_SCALE}자리까지만 입력할 수 있습니다.`)
  }

  return (
    BigInt(integerPart) * QTY_SCALE_MULTIPLIER +
    BigInt(decimalPart.padEnd(QTY_DECIMAL_SCALE, "0"))
  )
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

export function summarizeProductionPlanItemAllocation(
  plannedQty: QuantityValue,
  workOrders: WorkOrderAllocation[],
  excludeWorkOrderId?: string
) {
  const planned = toScaledQty(plannedQty, "생산계획 수량")
  const effectiveWorkOrders = workOrders.filter(
    (workOrder) =>
      workOrder.status !== "CANCELLED" && workOrder.id !== excludeWorkOrderId
  )
  const assigned = effectiveWorkOrders.reduce(
    (sum, workOrder) => sum + toScaledQty(workOrder.plannedQty, "작업지시 수량"),
    ZERO_QTY
  )

  return {
    plannedQty: planned,
    assignedQty: assigned,
    remainingQty: planned - assigned,
    effectiveWorkOrders,
  }
}

export function assertProductionPlanItemCapacity(input: {
  plannedQty: QuantityValue
  workOrders: WorkOrderAllocation[]
  requestedQty: QuantityValue
  excludeWorkOrderId?: string
}) {
  const summary = summarizeProductionPlanItemAllocation(
    input.plannedQty,
    input.workOrders,
    input.excludeWorkOrderId
  )
  const requestedQty = toScaledQty(input.requestedQty, "작업지시 계획수량")

  if (requestedQty <= ZERO_QTY) {
    throw new Error("작업지시 계획수량은 0보다 커야 합니다.")
  }

  if (summary.assignedQty + requestedQty > summary.plannedQty) {
    throw new Error(
      `계획수량을 초과하여 작업지시를 생성할 수 없습니다. ` +
        `(계획 ${formatScaledQty(summary.plannedQty)}, ` +
        `기배정 ${formatScaledQty(summary.assignedQty)}, ` +
        `잔여 ${formatScaledQty(summary.remainingQty)}, ` +
        `요청 ${formatScaledQty(requestedQty)})`
    )
  }

  return summary
}

export function evaluateProductionPlanWorkOrderCompletion(
  items: ProductionPlanItemAllocation[]
) {
  const itemSummaries = items.map((item) => ({
    item,
    summary: summarizeProductionPlanItemAllocation(item.plannedQty, item.workOrders),
  }))
  const effectiveWorkOrders = itemSummaries.flatMap(
    ({ summary }) => summary.effectiveWorkOrders
  )
  const allItemsFullyAssigned =
    itemSummaries.length > 0 &&
    itemSummaries.every(({ summary }) => summary.assignedQty === summary.plannedQty)
  const allEffectiveWorkOrdersCompleted =
    effectiveWorkOrders.length > 0 &&
    effectiveWorkOrders.every((workOrder) => workOrder.status === "COMPLETED")

  return {
    hasEffectiveWorkOrders: effectiveWorkOrders.length > 0,
    allItemsFullyAssigned,
    allEffectiveWorkOrdersCompleted,
    shouldComplete: allItemsFullyAssigned && allEffectiveWorkOrdersCompleted,
  }
}

export function formatProductionPlanQuantity(value: bigint): string {
  return formatScaledQty(value)
}
