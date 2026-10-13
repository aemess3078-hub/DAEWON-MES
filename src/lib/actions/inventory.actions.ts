"use server"

import { prisma } from "@/lib/db/prisma"
import { TransactionType } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { getTenantId, requireRole } from "@/lib/auth"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { BUSINESS_NUMBER_MAX_ATTEMPTS, isUniqueConstraintError, kstDateParts } from "@/lib/business-numbering"
import { lockInventoryBalancesForUpdate, withQuantityTransactionRetry } from "@/lib/quantity-concurrency"

// ─── Types ────────────────────────────────────────────────────────────────────

export type InventoryBalanceWithDetails = {
  id: string
  tenantId: string
  siteId: string
  warehouseId: string
  itemId: string
  lotId: string | null
  qtyOnHand: number
  qtyAvailable: number
  qtyHold: number
  updatedAt: Date
  lastReceiptAt: Date | null
  lastIssueAt: Date | null
  warehouse: { id: string; code: string; name: string; siteId: string; site: { id: string; code: string; name: string } }
  item: { id: string; code: string; name: string; itemType: string; uom: string; spec: string | null; isLotTracked?: boolean; status?: string }
  lot: { id: string; lotNo: string; manufactureDate: Date | null; expiryDate: Date | null } | null
}

export type InventoryTransactionWithDetails = {
  id: string
  tenantId: string
  itemId: string
  lotId: string | null
  fromLocationId: string | null
  toLocationId: string | null
  txNo: string
  txType: TransactionType
  qty: number
  refType: string | null
  refId: string | null
  note: string | null
  txAt: Date
  item: { id: string; code: string; name: string; itemType: string; uom: string; spec: string | null }
  lot: { id: string; lotNo: string } | null
  fromLocation: { id: string; code: string; name: string } | null
  toLocation: { id: string; code: string; name: string } | null
  workOrderLinks: {
    id: string
    manufacturingNo: string | null
    workOrder: { id: string; orderNo: string; manufacturingNo: string | null } | null
  }[]
}

// ─── 재고현황 조회 ─────────────────────────────────────────────────────────────

export async function getInventoryBalances(): Promise<InventoryBalanceWithDetails[]> {
  const tenantId = await getTenantId()
  const rows = await prisma.inventoryBalance.findMany({
    where: {
      tenantId,
      item: { tenantId },
      site: { tenantId },
      warehouse: { tenantId },
      OR: [{ lotId: null }, { lot: { tenantId } }],
    },
    include: {
      warehouse: { include: { site: true } },
      item: { select: { id: true, tenantId: true, code: true, name: true, itemType: true, uom: true, spec: true, isLotTracked: true, status: true } },
      lot: { select: { id: true, tenantId: true, lotNo: true, manufactureDate: true, expiryDate: true } },
    },
    orderBy: [
      { warehouse: { name: "asc" } },
      { item: { code: "asc" } },
    ],
  })
  return rows.map((b) => ({
    ...b,
    qtyOnHand:    Number(b.qtyOnHand),
    qtyAvailable: Number(b.qtyAvailable),
    qtyHold:      Number(b.qtyHold),
    lastReceiptAt: null,
    lastIssueAt: null,
  }))
}

export async function getMaterialInventoryBalances(): Promise<InventoryBalanceWithDetails[]> {
  const tenantId = await getTenantId()
  const rows = await prisma.inventoryBalance.findMany({
    where: {
      tenantId,
      item: { tenantId, itemType: { in: ["RAW_MATERIAL", "CONSUMABLE"] } },
      site: { tenantId },
      warehouse: { tenantId },
      OR: [{ lotId: null }, { lot: { tenantId } }],
    },
    include: {
      warehouse: { include: { site: true } },
      // item: true → 필요 필드만 select (code/name/itemType/uom만 사용됨)
      item: { select: { id: true, tenantId: true, code: true, name: true, itemType: true, uom: true, spec: true, isLotTracked: true, status: true } },
      lot: { select: { id: true, tenantId: true, lotNo: true, manufactureDate: true, expiryDate: true } },
    },
    orderBy: [
      { warehouse: { name: "asc" } },
      { item: { code: "asc" } },
    ],
  })
  const txRows = await prisma.inventoryTransaction.findMany({
    where: {
      tenantId,
      itemId: { in: Array.from(new Set(rows.map((row) => row.itemId))) },
      txType: { in: ["RECEIPT", "ISSUE"] },
      item: { tenantId },
      OR: [{ lotId: null }, { lot: { tenantId } }],
      AND: [
        { OR: [{ fromLocationId: null }, { fromLocation: { tenantId } }] },
        { OR: [{ toLocationId: null }, { toLocation: { tenantId } }] },
      ],
    },
    select: {
      itemId: true,
      lotId: true,
      fromLocationId: true,
      toLocationId: true,
      txType: true,
      txAt: true,
    },
    orderBy: { txAt: "desc" },
  })

  const lastReceiptMap = new Map<string, Date>()
  const lastIssueMap = new Map<string, Date>()

  for (const tx of txRows) {
    const warehouseId = tx.txType === "RECEIPT" ? tx.toLocationId : tx.fromLocationId
    if (!warehouseId) continue
    const key = `${tx.itemId}:${tx.lotId ?? "NO_LOT"}:${warehouseId}`
    if (tx.txType === "RECEIPT" && !lastReceiptMap.has(key)) {
      lastReceiptMap.set(key, tx.txAt)
    }
    if (tx.txType === "ISSUE" && !lastIssueMap.has(key)) {
      lastIssueMap.set(key, tx.txAt)
    }
  }

  return rows.map((b) => {
    const key = `${b.itemId}:${b.lotId ?? "NO_LOT"}:${b.warehouseId}`
    return {
      ...b,
      qtyOnHand:    Number(b.qtyOnHand),
      qtyAvailable: Number(b.qtyAvailable),
      qtyHold:      Number(b.qtyHold),
      lastReceiptAt: lastReceiptMap.get(key) ?? null,
      lastIssueAt: lastIssueMap.get(key) ?? null,
    }
  })
}

// ─── 품목 기준 그룹화 재고 ─────────────────────────────────────────────────────

export type LotBalanceDetail = {
  balanceId: string
  lotId: string | null
  lotNo: string | null
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  siteId: string
  siteName: string
  qtyOnHand: number
  qtyAvailable: number
  qtyHold: number
  manufactureDate: string | null
  expiryDate: string | null
  lastReceiptAt: string | null
  lastIssueAt: string | null
}

export type GroupedMaterialStock = {
  itemId: string
  itemCode: string
  itemName: string
  itemType: string
  itemSpec: string | null
  uom: string
  isLotTracked: boolean
  totalQtyOnHand: number
  totalQtyAvailable: number
  totalQtyHold: number
  lotCount: number           // distinct non-null lotId count
  warehouseCount: number     // distinct warehouseId count
  hasUnlottedStock: boolean  // isLotTracked=true AND lotId=null row with qty > 0
  lotBalances: LotBalanceDetail[]
}

export async function getGroupedMaterialInventoryBalances(): Promise<GroupedMaterialStock[]> {
  const balances = await getMaterialInventoryBalances()

  type Accumulator = {
    group: GroupedMaterialStock
    lotIdSet: Set<string>
    warehouseIdSet: Set<string>
  }
  const groupMap = new Map<string, Accumulator>()

  for (const balance of balances) {
    const lotDetail: LotBalanceDetail = {
      balanceId: balance.id,
      lotId: balance.lotId,
      lotNo: balance.lot?.lotNo ?? null,
      warehouseId: balance.warehouseId,
      warehouseCode: balance.warehouse.code,
      warehouseName: balance.warehouse.name,
      siteId: balance.warehouse.siteId,
      siteName: balance.warehouse.site.name,
      qtyOnHand: balance.qtyOnHand,
      qtyAvailable: balance.qtyAvailable,
      qtyHold: balance.qtyHold,
      manufactureDate: balance.lot?.manufactureDate instanceof Date
        ? balance.lot.manufactureDate.toISOString()
        : null,
      expiryDate: balance.lot?.expiryDate instanceof Date
        ? balance.lot.expiryDate.toISOString()
        : null,
      lastReceiptAt: balance.lastReceiptAt instanceof Date
        ? balance.lastReceiptAt.toISOString()
        : null,
      lastIssueAt: balance.lastIssueAt instanceof Date
        ? balance.lastIssueAt.toISOString()
        : null,
    }

    const isUnlotted = (balance.item.isLotTracked ?? false) && !balance.lotId && balance.qtyOnHand > 0

    const existing = groupMap.get(balance.itemId)
    if (existing) {
      existing.group.totalQtyOnHand += balance.qtyOnHand
      existing.group.totalQtyAvailable += balance.qtyAvailable
      existing.group.totalQtyHold += balance.qtyHold
      if (balance.lotId) existing.lotIdSet.add(balance.lotId)
      existing.warehouseIdSet.add(balance.warehouseId)
      if (isUnlotted) existing.group.hasUnlottedStock = true
      existing.group.lotBalances.push(lotDetail)
    } else {
      const lotIdSet = new Set<string>()
      const warehouseIdSet = new Set<string>()
      if (balance.lotId) lotIdSet.add(balance.lotId)
      warehouseIdSet.add(balance.warehouseId)
      groupMap.set(balance.itemId, {
        group: {
          itemId: balance.itemId,
          itemCode: balance.item.code,
          itemName: balance.item.name,
          itemType: balance.item.itemType,
          itemSpec: balance.item.spec ?? null,
          uom: balance.item.uom,
          isLotTracked: balance.item.isLotTracked ?? false,
          totalQtyOnHand: balance.qtyOnHand,
          totalQtyAvailable: balance.qtyAvailable,
          totalQtyHold: balance.qtyHold,
          lotCount: 0,
          warehouseCount: 0,
          hasUnlottedStock: isUnlotted,
          lotBalances: [lotDetail],
        },
        lotIdSet,
        warehouseIdSet,
      })
    }
  }

  return Array.from(groupMap.values())
    .map(({ group, lotIdSet, warehouseIdSet }) => {
      group.lotCount = lotIdSet.size
      group.warehouseCount = warehouseIdSet.size
      return group
    })
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode))
}

// ─── 전체 품목 기준 그룹화 재고 ───────────────────────────────────────────────

export type InventoryLotBalanceDetail = {
  balanceId: string
  lotId: string | null
  lotNo: string | null
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  siteId: string
  siteName: string
  qtyOnHand: number
  qtyAvailable: number
  qtyHold: number
}

export type GroupedInventoryStock = {
  itemId: string
  itemCode: string
  itemName: string
  itemType: string
  itemSpec: string | null
  uom: string
  isLotTracked: boolean
  totalQtyOnHand: number
  totalQtyAvailable: number
  totalQtyHold: number
  lotCount: number
  warehouseCount: number
  hasUnlottedStock: boolean
  balances: InventoryLotBalanceDetail[]
}

export async function getGroupedInventoryBalances(): Promise<GroupedInventoryStock[]> {
  const tenantId = await getTenantId()
  const rows = await prisma.inventoryBalance.findMany({
    where: {
      tenantId,
      item: { tenantId },
      site: { tenantId },
      warehouse: { tenantId },
      OR: [{ lotId: null }, { lot: { tenantId } }],
    },
    include: {
      warehouse: { include: { site: true } },
      item: { select: { id: true, tenantId: true, code: true, name: true, itemType: true, uom: true, spec: true, isLotTracked: true } },
      lot: { select: { id: true, tenantId: true, lotNo: true } },
    },
    orderBy: { item: { code: "asc" } },
  })

  type Acc = { group: GroupedInventoryStock; lotIdSet: Set<string>; warehouseIdSet: Set<string> }
  const groupMap = new Map<string, Acc>()

  for (const b of rows) {
    const qtyOnHand = Number(b.qtyOnHand)
    const qtyAvailable = Number(b.qtyAvailable)
    const qtyHold = Number(b.qtyHold)
    const isLotTracked = b.item.isLotTracked ?? false
    const isUnlotted = isLotTracked && !b.lotId && qtyOnHand > 0

    const balanceDetail: InventoryLotBalanceDetail = {
      balanceId: b.id,
      lotId: b.lotId,
      lotNo: b.lot?.lotNo ?? null,
      warehouseId: b.warehouseId,
      warehouseCode: b.warehouse.code,
      warehouseName: b.warehouse.name,
      siteId: b.warehouse.siteId,
      siteName: b.warehouse.site.name,
      qtyOnHand,
      qtyAvailable,
      qtyHold,
    }

    const existing = groupMap.get(b.itemId)
    if (existing) {
      existing.group.totalQtyOnHand += qtyOnHand
      existing.group.totalQtyAvailable += qtyAvailable
      existing.group.totalQtyHold += qtyHold
      if (b.lotId) existing.lotIdSet.add(b.lotId)
      existing.warehouseIdSet.add(b.warehouseId)
      if (isUnlotted) existing.group.hasUnlottedStock = true
      existing.group.balances.push(balanceDetail)
    } else {
      const lotIdSet = new Set<string>()
      const warehouseIdSet = new Set<string>()
      if (b.lotId) lotIdSet.add(b.lotId)
      warehouseIdSet.add(b.warehouseId)
      groupMap.set(b.itemId, {
        group: {
          itemId: b.itemId,
          itemCode: b.item.code,
          itemName: b.item.name,
          itemType: b.item.itemType,
          itemSpec: b.item.spec ?? null,
          uom: b.item.uom,
          isLotTracked,
          totalQtyOnHand: qtyOnHand,
          totalQtyAvailable: qtyAvailable,
          totalQtyHold: qtyHold,
          lotCount: 0,
          warehouseCount: 0,
          hasUnlottedStock: isUnlotted,
          balances: [balanceDetail],
        },
        lotIdSet,
        warehouseIdSet,
      })
    }
  }

  return Array.from(groupMap.values())
    .map(({ group, lotIdSet, warehouseIdSet }) => {
      group.lotCount = lotIdSet.size
      group.warehouseCount = warehouseIdSet.size
      return group
    })
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode))
}


// ─── 트랜잭션 이력 조회 (최신 200건) ──────────────────────────────────────────

export async function getInventoryTransactions(): Promise<InventoryTransactionWithDetails[]> {
  const tenantId = await getTenantId()
  const rows = await prisma.inventoryTransaction.findMany({
    where: {
      tenantId,
      item: { tenantId },
      OR: [{ lotId: null }, { lot: { tenantId } }],
      AND: [
        { OR: [{ fromLocationId: null }, { fromLocation: { tenantId } }] },
        { OR: [{ toLocationId: null }, { toLocation: { tenantId } }] },
      ],
    },
    include: {
      item: { select: { id: true, tenantId: true, code: true, name: true, itemType: true, uom: true, spec: true } },
      lot: { select: { id: true, tenantId: true, lotNo: true } },
      fromLocation: { select: { id: true, tenantId: true, code: true, name: true } },
      toLocation: { select: { id: true, tenantId: true, code: true, name: true } },
      workOrderMaterialLots: {
        select: {
          id: true,
          manufacturingNo: true,
          workOrder: { select: { id: true, orderNo: true, manufacturingNo: true } },
        },
      },
    },
    orderBy: { txAt: "desc" },
    take: 200,
  })
  return rows.map((t) => ({
    ...t,
    qty: Number(t.qty),
    workOrderLinks: t.workOrderMaterialLots,
  }))
}

// ─── 사이트 목록 ──────────────────────────────────────────────────────────────

export async function getSitesForInventory() {
  const tenantId = await getTenantId()
  return prisma.site.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })
}

// ─── txNo 생성 ────────────────────────────────────────────────────────────────

async function generateTxNo(tenantId: string, txType: TransactionType): Promise<string> {
  const prefix = {
    RECEIPT: "RCP",
    ISSUE: "ISS",
    TRANSFER: "TRF",
    ADJUST: "ADJ",
    RETURN: "RTN",
    SCRAP: "SCR",
    SUPPLIER_RETURN: "SRT",
  }[txType] ?? "TXN"

  const { yyyymmdd } = kstDateParts()

  const last = await prisma.inventoryTransaction.findFirst({
    where: {
      tenantId,
      txNo: { startsWith: `${prefix}-${yyyymmdd}` },
    },
    orderBy: { txNo: "desc" },
    select: { txNo: true },
  })

  const seq = last ? (parseInt(last.txNo.split("-")[2] ?? "0", 10) || 0) + 1 : 1
  return `${prefix}-${yyyymmdd}-${String(seq).padStart(4, "0")}`
}

// ─── 재고실사/재고조정 (의료기기 추적성 보존) ──────────────────────────────────
//
// 고객사 실사 결과와 MES 재고가 다를 때 보정하는 기능.
// 설계 원칙:
//   1) qtyOnHand를 단순 덮어쓰기(set)하지 않는다. 차이수량(diff)만큼 증감한다.
//   2) 기존 입출고 InventoryTransaction은 수정/삭제하지 않는다.
//      차이수량만 refType=STOCK_ADJUSTMENT 인 ADJUST 트랜잭션으로 1건 신규 기록한다.
//   3) 누가/언제/무엇을/사유 를 AuditLog 로 남긴다.
//   4) LOT 관리 품목은 LOT 선택 필수. 비LOT 품목은 창고 기준.
//   5) qtyHold(예약 수량)는 보존하고 qtyAvailable만 재계산한다.
//   6) 라벨 재발행과 분리: 이 액션은 수량 보정만 수행한다.

const STOCK_ADJUSTMENT_REF_TYPE = "STOCK_ADJUSTMENT"

export type StockAdjustmentInput = {
  balanceId: string
  physicalQty: number // 실사수량
  reason: string      // 조정 사유 (필수)
  note?: string | null
}

export type StockAdjustmentResult = {
  success: boolean
  error?: string
  txNo?: string
  currentQty?: number
  physicalQty?: number
  diffQty?: number
  direction?: "INCREASE" | "DECREASE"
}

export async function adjustInventoryStock(
  input: StockAdjustmentInput
): Promise<StockAdjustmentResult> {
  await requireResourcePermission("INVENTORY", "UPDATE")
  // 권한: 의료기기 재고 보정은 책임자 권한(MANAGER 이상)으로 제한.
  let actor
  try {
    actor = await requireRole("MANAGER")
  } catch {
    return { success: false, error: "재고조정 권한이 없습니다. (MANAGER 이상 필요)" }
  }
  const tenantId = actor.tenantId
  const balanceId = input.balanceId?.trim()
  const reason = input.reason?.trim()
  const note = input.note?.trim() || null

  if (!balanceId) {
    return { success: false, error: "재고를 찾을 수 없습니다." }
  }
  if (!reason) {
    return { success: false, error: "재고조정 사유를 입력해 주세요." }
  }
  if (!Number.isFinite(input.physicalQty) || input.physicalQty < 0) {
    return { success: false, error: "실사수량은 0 이상의 숫자여야 합니다." }
  }

  try {
    let finalTxNo: string | null = null
    const result = await withQuantityTransactionRetry(async () => {
      let lastError: unknown
      for (let attempt = 0; attempt < BUSINESS_NUMBER_MAX_ATTEMPTS; attempt++) {
        const txNo = await generateTxNo(tenantId, TransactionType.ADJUST)
        try {
          return await prisma.$transaction(async (tx) => {
            const ownedBalance = await tx.inventoryBalance.findFirst({
              where: { id: balanceId, tenantId },
              select: { id: true },
            })
            if (!ownedBalance) {
              throw new Error("재고를 찾을 수 없습니다.")
            }

            await lockInventoryBalancesForUpdate(tx, [balanceId])

            const balance = await tx.inventoryBalance.findFirst({
              where: { id: balanceId, tenantId },
              include: {
                item: { select: { id: true, tenantId: true, code: true, name: true, isLotTracked: true } },
                site: { select: { id: true, tenantId: true } },
                warehouse: { select: { id: true, tenantId: true, siteId: true } },
                lot: { select: { id: true, tenantId: true, itemId: true, status: true } },
              },
            })
            if (!balance) {
              throw new Error("재고를 찾을 수 없습니다.")
            }
            if (
              balance.item.tenantId !== tenantId ||
              balance.site.tenantId !== tenantId ||
              balance.warehouse.tenantId !== tenantId ||
              balance.warehouse.siteId !== balance.siteId
            ) {
              throw new Error("재고의 테넌트/사업장 기준정보가 올바르지 않습니다.")
            }
            if (balance.item.isLotTracked && !balance.lotId) {
              throw new Error("LOT 관리 품목의 LOT 미지정 재고는 재고조정할 수 없습니다.")
            }
            if (balance.lotId) {
              if (!balance.lot || balance.lot.tenantId !== tenantId || balance.lot.itemId !== balance.itemId) {
                throw new Error("재고의 LOT 정보가 품목 또는 테넌트와 일치하지 않습니다.")
              }
            }

            const currentQty = Number(balance.qtyOnHand)
            const qtyAvailableBefore = Number(balance.qtyAvailable)
            const qtyHold = Number(balance.qtyHold)
            const physicalQty = input.physicalQty
            const diffQty = Number((physicalQty - currentQty).toFixed(6))

            if (diffQty === 0) {
              throw new Error("실사수량이 현재고와 동일하여 조정할 내역이 없습니다.")
            }
            if (physicalQty < qtyHold) {
              throw new Error("실사수량이 현재 보류수량보다 작습니다. 보류 상태를 먼저 정리한 후 재고조정해 주세요.")
            }

            const qtyAvailableAfter = Number((physicalQty - qtyHold).toFixed(6))

            await tx.inventoryTransaction.create({
              data: {
                tenantId,
                itemId: balance.itemId,
                lotId: balance.lotId,
                fromLocationId: diffQty < 0 ? balance.warehouseId : null,
                toLocationId: diffQty > 0 ? balance.warehouseId : null,
                txNo,
                txType: TransactionType.ADJUST,
                qty: diffQty,
                refType: STOCK_ADJUSTMENT_REF_TYPE,
                refId: balance.id,
                note:
                  `재고실사 조정 | 현재고:${currentQty} 실사:${physicalQty} 차이:${diffQty >= 0 ? "+" : ""}${diffQty} | 사유:${reason}` +
                  (note ? ` | 비고:${note}` : ""),
                txAt: new Date(),
              },
            })

            await tx.inventoryBalance.update({
              where: { id: balance.id },
              data: {
                qtyOnHand: physicalQty,
                qtyAvailable: qtyAvailableAfter,
              },
            })

            await tx.auditLog.create({
              data: {
                tenantId,
                actorId: actor.profileId,
                actorType: "USER",
                actorLabel: actor.name,
                entityType: "InventoryBalance",
                entityId: balance.id,
                action: "UPDATE",
                menuName: "재고조정",
                beforeData: {
                  balanceId: balance.id,
                  siteId: balance.siteId,
                  warehouseId: balance.warehouseId,
                  itemId: balance.itemId,
                  itemCode: balance.item.code,
                  lotId: balance.lotId,
                  qtyOnHand: currentQty,
                  qtyHold,
                  qtyAvailable: qtyAvailableBefore,
                },
                afterData: {
                  balanceId: balance.id,
                  siteId: balance.siteId,
                  warehouseId: balance.warehouseId,
                  itemId: balance.itemId,
                  itemCode: balance.item.code,
                  lotId: balance.lotId,
                  currentQty,
                  physicalQty,
                  diffQty,
                  qtyHold,
                  qtyAvailableBefore,
                  qtyAvailableAfter,
                  reason,
                  note,
                  txNo,
                },
              },
            })

            finalTxNo = txNo
            return { currentQty, physicalQty, diffQty }
          })
        } catch (e) {
          lastError = e
          if (!isUniqueConstraintError(e, ["tenantId", "txNo"]) || attempt >= BUSINESS_NUMBER_MAX_ATTEMPTS - 1) break
        }
      }
      if (lastError && isUniqueConstraintError(lastError, ["tenantId", "txNo"])) {
        throw new Error("재고조정번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요.")
      }
      throw lastError
    })

    revalidatePath("/app/mes/inventory")
    revalidatePath("/app/mes/material/stock")
    revalidatePath("/app/mes/inventory-transactions")

    return {
      success: true,
      txNo: finalTxNo ?? undefined,
      currentQty: result.currentQty,
      physicalQty: result.physicalQty,
      diffQty: result.diffQty,
      direction: result.diffQty > 0 ? "INCREASE" : "DECREASE",
    }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "재고조정 중 오류가 발생했습니다.",
    }
  }
}

// ─── 재고조정 이력 조회 ────────────────────────────────────────────────────────

export type StockAdjustmentHistoryRow = {
  id: string
  txNo: string
  txAt: string
  itemCode: string
  itemName: string
  lotNo: string | null
  warehouseName: string | null
  diffQty: number
  note: string | null
}

export async function getStockAdjustmentHistory(): Promise<StockAdjustmentHistoryRow[]> {
  const tenantId = await getTenantId()
  const rows = await prisma.inventoryTransaction.findMany({
    where: {
      tenantId,
      refType: STOCK_ADJUSTMENT_REF_TYPE,
      item: { tenantId },
      OR: [{ lotId: null }, { lot: { tenantId } }],
      AND: [
        { OR: [{ fromLocationId: null }, { fromLocation: { tenantId } }] },
        { OR: [{ toLocationId: null }, { toLocation: { tenantId } }] },
      ],
    },
    include: {
      item: { select: { code: true, name: true } },
      lot: { select: { lotNo: true } },
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
    },
    orderBy: { txAt: "desc" },
    take: 500,
  })

  return rows.map((r) => ({
    id: r.id,
    txNo: r.txNo,
    txAt: r.txAt.toISOString(),
    itemCode: r.item.code,
    itemName: r.item.name,
    lotNo: r.lot?.lotNo ?? null,
    warehouseName: r.toLocation?.name ?? r.fromLocation?.name ?? null,
    diffQty: Number(r.qty),
    note: r.note,
  }))
}
