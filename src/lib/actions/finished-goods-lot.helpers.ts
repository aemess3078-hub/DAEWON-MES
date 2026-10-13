import { Prisma, type Lot } from "@prisma/client"
import { generateCnsFinishedGoodsLotNo } from "@/lib/lot-numbering/lot-number-generator"
import type { CnsItemRuleContext } from "@/lib/lot-numbering/lot-rule-resolver"

export type FinishedGoodsLotTx = Prisma.TransactionClient

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

async function getCnsItemRuleContext(
  tx: FinishedGoodsLotTx,
  tenantId: string,
  itemId: string,
): Promise<CnsItemRuleContext> {
  const item = await tx.item.findFirst({
    where: { id: itemId, tenantId },
    select: {
      code: true,
      itemType: true,
      lotNumberingType: true,
      lotPrefix: true,
      manualLotPolicy: true,
      itemGroup: { select: { code: true } },
      category: { select: { code: true } },
    },
  })

  return {
    itemCode: item?.code,
    itemGroupCode: item?.itemGroup?.code,
    itemCategoryCode: item?.category?.code,
    itemType: item?.itemType,
    lotNumberingType: item?.lotNumberingType,
    lotPrefix: item?.lotPrefix,
    manualLotPolicy: item?.manualLotPolicy,
  }
}

async function resolveAvailableLotNo(
  tx: FinishedGoodsLotTx,
  tenantId: string,
  candidate: string,
  expectedItemId: string,
): Promise<{ lotNo: string; reuseLot: Lot | null }> {
  const existing = await tx.lot.findUnique({
    where: { tenantId_lotNo: { tenantId, lotNo: candidate } },
  })

  if (!existing) {
    return { lotNo: candidate, reuseLot: null }
  }

  if (existing.itemId === expectedItemId) {
    return { lotNo: candidate, reuseLot: existing }
  }

  for (let i = 1; i <= 99; i++) {
    const suffix = String(i).padStart(2, "0")
    const next = `${candidate}-${suffix}`
    const conflict = await tx.lot.findUnique({
      where: { tenantId_lotNo: { tenantId, lotNo: next } },
    })
    if (!conflict) {
      return { lotNo: next, reuseLot: null }
    }
    if (conflict.itemId === expectedItemId) {
      return { lotNo: next, reuseLot: conflict }
    }
  }

  throw new Error(`Finished goods LOT generation failed: ${candidate} suffix range exhausted`)
}

async function nextSequentialLotNo(
  tx: FinishedGoodsLotTx,
  tenantId: string,
  base: string,
  expectedItemId: string,
  forceSuffix: boolean,
): Promise<string> {
  if (!forceSuffix) {
    const baseResolved = await resolveAvailableLotNo(tx, tenantId, base, expectedItemId)
    if (!baseResolved.reuseLot) return baseResolved.lotNo
  }

  for (let i = 1; i <= 99; i++) {
    const suffix = String(i).padStart(2, "0")
    const next = `${base}-${suffix}`
    const conflict = await tx.lot.findUnique({
      where: { tenantId_lotNo: { tenantId, lotNo: next } },
    })
    if (!conflict) return next
  }

  throw new Error(`Finished goods LOT generation failed: ${base} suffix range exhausted`)
}

export async function createFinishedGoodsLot(
  tx: FinishedGoodsLotTx,
  params: {
    tenantId: string
    workOrder: {
      orderNo: string | null
      manufacturingNo: string | null
      itemId: string
    }
    forceNewLot?: boolean
    isSemiFinished?: boolean
  },
): Promise<Lot> {
  const { tenantId, workOrder, forceNewLot } = params
  const itemContext = await getCnsItemRuleContext(tx, tenantId, workOrder.itemId)
  const manufacturingNo = workOrder.manufacturingNo?.trim()
  const maxAttempts = 5

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const lotNo = manufacturingNo
      ? await nextSequentialLotNo(
          tx,
          tenantId,
          manufacturingNo,
          workOrder.itemId,
          forceNewLot ?? false,
        )
      : await generateCnsFinishedGoodsLotNo(tx, tenantId, itemContext, new Date(), attempt)

    try {
      return await tx.lot.create({
        data: {
          tenantId,
          itemId: workOrder.itemId,
          lotNo,
          status: "ACTIVE",
          manufactureDate: new Date(),
        },
      })
    } catch (error) {
      if (isUniqueConstraintError(error) && attempt < maxAttempts - 1) {
        continue
      }
      throw error
    }
  }

  throw new Error("Finished goods LOT generation failed after repeated number collisions")
}
