import type { Prisma, TransactionType } from "@prisma/client"

const QTY_PRECISION = 6
const QTY_FACTOR = 10 ** QTY_PRECISION

type MaterialSufficiencyClient = Pick<
  Prisma.TransactionClient,
  "workOrderOperation" | "inventoryTransaction" | "productionResult"
>

export type BomMaterialRequirementInput = {
  componentItemId: string
  componentCode: string
  componentName: string
  qtyPer: number
  scrapRate: number
}

export type BomMaterialIssuedInput = {
  itemId: string
  txType: TransactionType | "ISSUE" | "RETURN"
  qty: number
}

export type BomMaterialSufficiencyInput = {
  plannedQty: number
  producedQty: number
  requirements: BomMaterialRequirementInput[]
  issuedTransactions: BomMaterialIssuedInput[]
}

export type BomMaterialShortage = {
  itemId: string
  itemCode: string
  itemName: string
  requiredQty: number
  issuedQty: number
  shortageQty: number
  perUnitRequirement: number
  producibleQty: number
}

export type BomMaterialSufficiency = {
  plannedQty: number
  producedQty: number
  materialProducibleQty: number | null
  remainingPlanQty: number
  remainingMaterialQty: number | null
  maxAdditionalProductionQty: number
  requirements: Array<{
    itemId: string
    itemCode: string
    itemName: string
    perUnitRequirement: number
    requiredQty: number
    issuedQty: number
    producibleQty: number
  }>
  shortages: BomMaterialShortage[]
}

export class BomMaterialSufficiencyError extends Error {
  constructor(
    message: string,
    readonly sufficiency: BomMaterialSufficiency
  ) {
    super(message)
    this.name = "BomMaterialSufficiencyError"
  }
}

function roundQty(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * QTY_FACTOR) / QTY_FACTOR
}

function floorQty(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.floor((value + Number.EPSILON) * QTY_FACTOR) / QTY_FACTOR
}

function positiveQty(value: number): number {
  return Math.max(0, roundQty(value))
}

function formatQty(value: number): string {
  return roundQty(value).toLocaleString("ko-KR", {
    maximumFractionDigits: QTY_PRECISION,
  })
}

export function calculateBomMaterialSufficiency(
  input: BomMaterialSufficiencyInput
): BomMaterialSufficiency {
  const requirementMap = new Map<
    string,
    {
      itemId: string
      itemCode: string
      itemName: string
      perUnitRequirement: number
    }
  >()

  for (const requirement of input.requirements) {
    const perUnitRequirement = roundQty(
      requirement.qtyPer * (1 + requirement.scrapRate)
    )
    if (perUnitRequirement <= 0) continue
    const existing = requirementMap.get(requirement.componentItemId)
    if (existing) {
      existing.perUnitRequirement = roundQty(
        existing.perUnitRequirement + perUnitRequirement
      )
    } else {
      requirementMap.set(requirement.componentItemId, {
        itemId: requirement.componentItemId,
        itemCode: requirement.componentCode,
        itemName: requirement.componentName,
        perUnitRequirement,
      })
    }
  }

  const issuedMap = new Map<string, number>()
  for (const tx of input.issuedTransactions) {
    const direction = tx.txType === "RETURN" ? -1 : tx.txType === "ISSUE" ? 1 : 0
    if (direction === 0) continue
    issuedMap.set(tx.itemId, roundQty((issuedMap.get(tx.itemId) ?? 0) + direction * tx.qty))
  }

  const plannedQty = positiveQty(input.plannedQty)
  const producedQty = positiveQty(input.producedQty)
  const remainingPlanQty = positiveQty(plannedQty - producedQty)

  const requirements = Array.from(requirementMap.values()).map((requirement) => {
    const issuedQty = positiveQty(issuedMap.get(requirement.itemId) ?? 0)
    const requiredQty = roundQty(plannedQty * requirement.perUnitRequirement)
    return {
      ...requirement,
      requiredQty,
      issuedQty,
      producibleQty: floorQty(issuedQty / requirement.perUnitRequirement),
    }
  })

  if (requirements.length === 0) {
    return {
      plannedQty,
      producedQty,
      materialProducibleQty: null,
      remainingPlanQty,
      remainingMaterialQty: null,
      maxAdditionalProductionQty: remainingPlanQty,
      requirements: [],
      shortages: [],
    }
  }

  const materialProducibleQty = Math.min(
    ...requirements.map((requirement) => requirement.producibleQty)
  )
  const remainingMaterialQty = positiveQty(materialProducibleQty - producedQty)
  const maxAdditionalProductionQty = Math.min(remainingPlanQty, remainingMaterialQty)
  const shortages = requirements
    .filter((requirement) => requirement.issuedQty < requirement.requiredQty)
    .map((requirement) => ({
      itemId: requirement.itemId,
      itemCode: requirement.itemCode,
      itemName: requirement.itemName,
      requiredQty: requirement.requiredQty,
      issuedQty: requirement.issuedQty,
      shortageQty: positiveQty(requirement.requiredQty - requirement.issuedQty),
      perUnitRequirement: requirement.perUnitRequirement,
      producibleQty: requirement.producibleQty,
    }))

  return {
    plannedQty,
    producedQty,
    materialProducibleQty,
    remainingPlanQty,
    remainingMaterialQty,
    maxAdditionalProductionQty,
    requirements,
    shortages,
  }
}

export function assertProductionQuantityWithinMaterialLimit(
  sufficiency: BomMaterialSufficiency,
  requestedProductionQty: number
): void {
  const requestedQty = positiveQty(requestedProductionQty)
  if (sufficiency.materialProducibleQty === null) return
  if (requestedQty <= sufficiency.maxAdditionalProductionQty) return

  throw new BomMaterialSufficiencyError(
    `출고된 자재 기준으로 최대 ${formatQty(sufficiency.maxAdditionalProductionQty)} EA까지 생산실적을 등록할 수 있습니다.`,
    sufficiency
  )
}

export async function getWorkOrderMaterialSufficiency(
  db: MaterialSufficiencyClient,
  params: {
    tenantId: string
    workOrderOperationId: string
  }
): Promise<BomMaterialSufficiency> {
  const operation = await db.workOrderOperation.findFirst({
    where: {
      id: params.workOrderOperationId,
      workOrder: { tenantId: params.tenantId },
    },
    select: {
      id: true,
      plannedQty: true,
      workOrderId: true,
      workOrder: {
        select: {
          plannedQty: true,
          bom: {
            select: {
              bomItems: {
                select: {
                  componentItemId: true,
                  qtyPer: true,
                  scrapRate: true,
                  componentItem: {
                    select: { code: true, name: true },
                  },
                },
                orderBy: { seq: "asc" },
              },
            },
          },
        },
      },
    },
  })

  if (!operation) {
    throw new Error("공정을 찾을 수 없습니다.")
  }

  const bomItemIds = operation.workOrder.bom.bomItems.map((item) => item.componentItemId)
  const [transactions, producedResults] = await Promise.all([
    db.inventoryTransaction.findMany({
      where: {
        tenantId: params.tenantId,
        refType: "WORK_ORDER",
        refId: operation.workOrderId,
        itemId: { in: bomItemIds },
        txType: { in: ["ISSUE", "RETURN"] },
      },
      select: { itemId: true, txType: true, qty: true },
    }),
    db.productionResult.findMany({
      where: { workOrderOperationId: operation.id },
      select: { goodQty: true, defectQty: true, reworkQty: true },
    }),
  ])

  const producedQty = producedResults.reduce(
    (sum, result) =>
      sum +
      Number(result.goodQty) +
      Number(result.defectQty) +
      Number(result.reworkQty),
    0
  )

  return calculateBomMaterialSufficiency({
    plannedQty: Math.min(Number(operation.workOrder.plannedQty), Number(operation.plannedQty)),
    producedQty,
    requirements: operation.workOrder.bom.bomItems.map((item) => ({
      componentItemId: item.componentItemId,
      componentCode: item.componentItem.code,
      componentName: item.componentItem.name,
      qtyPer: Number(item.qtyPer),
      scrapRate: Number(item.scrapRate),
    })),
    issuedTransactions: transactions.map((tx) => ({
      itemId: tx.itemId,
      txType: tx.txType,
      qty: Number(tx.qty),
    })),
  })
}
