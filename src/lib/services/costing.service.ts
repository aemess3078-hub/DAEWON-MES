import { prisma } from "@/lib/db/prisma"

export type CostResult = {
  materialCost: number
  laborCost: number
  overheadCost: number
  totalCost: number
}

export type CostComparison = {
  standard: CostResult | null
  actual: CostResult | null
  diff: CostResult | null
  diffRate: { material: number | null; labor: number | null; overhead: number | null; total: number | null } | null
}

export type CostHistoryItem = {
  id: string
  costType: string
  materialCost: number
  laborCost: number
  overheadCost: number
  totalCost: number
  calculatedAt: Date
  bomId: string | null
  workOrderId: string | null
  note: string | null
}

async function getCostConfig(
  tenantId: string
): Promise<{ laborRatePerHour: number; overheadRate: number }> {
  const group = await prisma.codeGroup.findUnique({
    where: { tenantId_groupCode: { tenantId, groupCode: "COST_CONFIG" } },
    include: { codes: true },
  })
  const codes = group?.codes ?? []
  const laborCode = codes.find((c) => c.code === "LABOR_RATE_PER_HOUR")
  const overheadCode = codes.find((c) => c.code === "OVERHEAD_RATE")
  return {
    laborRatePerHour: (laborCode?.extra as Record<string, number> | null)?.value ?? 25000,
    overheadRate: (((overheadCode?.extra as Record<string, number> | null)?.value ?? 10)) / 100,
  }
}

async function getLatestPurchasePrice(itemId: string): Promise<number> {
  const price = await prisma.itemPrice.findFirst({
    where: {
      itemId,
      priceType: "PURCHASE",
      effectiveFrom: { lte: new Date() },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
    },
    orderBy: { effectiveFrom: "desc" },
  })
  if (!price) {
    console.warn(`[Costing] No purchase price found for item ${itemId}, using 0`)
    return 0
  }
  return Number(price.unitPrice)
}

export async function calculateStandardCost(
  itemId: string,
  bomId: string,
  tenantId: string
): Promise<CostResult> {
  const [bom, itemRoutingRecord, config] = await Promise.all([
    prisma.bOM.findUnique({
      where: { id: bomId },
      include: {
        bomItems: { include: { componentItem: true } },
      },
    }),
    prisma.itemRouting.findFirst({
      where: {
        itemId,
        isDefault: true,
        routing: { status: "ACTIVE" },
      },
      include: { routing: { include: { operations: true } } },
    }),
    getCostConfig(tenantId),
  ])
  const routing = itemRoutingRecord?.routing ?? null

  // 자재비 계산
  let materialCost = 0
  if (bom) {
    for (const bomItem of bom.bomItems) {
      const unitPrice = await getLatestPurchasePrice(bomItem.componentItemId)
      const qtyPer = Number(bomItem.qtyPer)
      const scrapRate = Number(bomItem.scrapRate ?? 0)
      materialCost += qtyPer * (1 + scrapRate) * unitPrice
    }
  }

  // 노무비 계산 (standardTime = 분 단위)
  let laborCost = 0
  if (routing) {
    for (const op of routing.operations) {
      const hours = Number(op.standardTime) / 60
      laborCost += hours * config.laborRatePerHour
    }
  }

  // 경비 계산
  const overheadCost = materialCost * config.overheadRate
  const totalCost = materialCost + laborCost + overheadCost

  await prisma.itemCost.create({
    data: {
      tenantId,
      itemId,
      costType: "STANDARD",
      materialCost,
      laborCost,
      overheadCost,
      totalCost,
      bomId,
      calculatedAt: new Date(),
    },
  })

  return { materialCost, laborCost, overheadCost, totalCost }
}

export async function calculateActualCost(
  itemId: string,
  workOrderId: string,
  tenantId: string
): Promise<CostResult> {
  const [workOrder, config] = await Promise.all([
    prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        operations: {
          include: {
            materialConsumptions: true,
            productionResults: true,
          },
        },
      },
    }),
    getCostConfig(tenantId),
  ])

  // 실제 자재비
  let materialCost = 0
  // 실제 노무비
  let laborCost = 0

  if (workOrder) {
    for (const op of workOrder.operations) {
      // 실제 자재비
      for (const mc of op.materialConsumptions) {
        const unitPrice = await getLatestPurchasePrice(mc.itemId)
        const qty = Number(mc.consumedQty ?? 0) + Number(mc.scrapQty ?? 0)
        materialCost += qty * unitPrice
      }

      // 실제 노무비
      for (const pr of op.productionResults) {
        if (!pr.startedAt || !pr.endedAt) continue
        const hours = (pr.endedAt.getTime() - pr.startedAt.getTime()) / (1000 * 60 * 60)
        laborCost += hours * config.laborRatePerHour
      }
    }
  }

  const overheadCost = materialCost * config.overheadRate
  const totalCost = materialCost + laborCost + overheadCost

  await prisma.itemCost.create({
    data: {
      tenantId,
      itemId,
      costType: "ACTUAL",
      materialCost,
      laborCost,
      overheadCost,
      totalCost,
      workOrderId,
      calculatedAt: new Date(),
    },
  })

  return { materialCost, laborCost, overheadCost, totalCost }
}

export async function getCostHistory(tenantId: string, itemId: string): Promise<CostHistoryItem[]> {
  const records = await prisma.itemCost.findMany({
    where: { tenantId, itemId },
    orderBy: { calculatedAt: "desc" },
  })
  return records.map((r) => ({
    id: r.id,
    costType: r.costType,
    materialCost: Number(r.materialCost),
    laborCost: Number(r.laborCost),
    overheadCost: Number(r.overheadCost),
    totalCost: Number(r.totalCost),
    calculatedAt: r.calculatedAt,
    bomId: r.bomId,
    workOrderId: r.workOrderId,
    note: r.note,
  }))
}

export async function getCostComparison(tenantId: string, itemId: string): Promise<CostComparison> {
  const [latestStandard, latestActual] = await Promise.all([
    prisma.itemCost.findFirst({
      where: { tenantId, itemId, costType: "STANDARD" },
      orderBy: { calculatedAt: "desc" },
    }),
    prisma.itemCost.findFirst({
      where: { tenantId, itemId, costType: "ACTUAL" },
      orderBy: { calculatedAt: "desc" },
    }),
  ])

  const toResult = (r: typeof latestStandard): CostResult | null => {
    if (!r) return null
    return {
      materialCost: Number(r.materialCost),
      laborCost: Number(r.laborCost),
      overheadCost: Number(r.overheadCost),
      totalCost: Number(r.totalCost),
    }
  }

  const standard = toResult(latestStandard)
  const actual = toResult(latestActual)

  if (!standard || !actual) {
    return { standard, actual, diff: null, diffRate: null }
  }

  const diff: CostResult = {
    materialCost: actual.materialCost - standard.materialCost,
    laborCost: actual.laborCost - standard.laborCost,
    overheadCost: actual.overheadCost - standard.overheadCost,
    totalCost: actual.totalCost - standard.totalCost,
  }

  const rate = (a: number, s: number) => (s === 0 ? null : ((a - s) / s) * 100)
  const diffRate = {
    material: rate(actual.materialCost, standard.materialCost),
    labor: rate(actual.laborCost, standard.laborCost),
    overhead: rate(actual.overheadCost, standard.overheadCost),
    total: rate(actual.totalCost, standard.totalCost),
  }

  return { standard, actual, diff, diffRate }
}
