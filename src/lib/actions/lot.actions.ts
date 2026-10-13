"use server"

import { prisma } from "@/lib/db/prisma"
import { generateCnsMaterialReceiptLotNo } from "@/lib/lot-numbering/lot-number-generator"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { getTenantId } from "@/lib/auth"

// ─── Types ────────────────────────────────────────────────────────────────────

export type LotWithDetails = {
  id: string
  tenantId: string
  itemId: string
  lotNo: string
  status: string
  qty: any // Decimal (from InventoryBalance total, computed)
  manufactureDate: Date | null
  expiryDate: Date | null
  createdAt: Date
  item: {
    id: string
    code: string
    name: string
    itemType: string
    uom: string
    categoryId: string | null
  }
}

export type LotGenealogyNode = {
  id: string
  lotNo: string
  itemName: string
  itemCode: string
  status: string
  qty: any
  relationType: string | null // LotGenealogyRelation enum (루트는 null)
  children?: LotGenealogyNode[]
}

export type CreateLotInput = {
  itemId: string
  lotNo: string
  qty: number
  manufactureDate?: string | null
  expiryDate?: string | null
}

// ─── LOT 전체 조회 ────────────────────────────────────────────────────────────

export async function getLots(): Promise<LotWithDetails[]> {
  const lots = await prisma.lot.findMany({
    include: {
      item: {
        select: {
          id: true,
          code: true,
          name: true,
          itemType: true,
          uom: true,
          categoryId: true,
        },
      },
      inventoryBalances: {
        select: { qtyOnHand: true },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return lots.map((lot) => {
    const totalQty = lot.inventoryBalances.reduce(
      (sum, b) => sum + Number(b.qtyOnHand),
      0
    )
    return {
      id: lot.id,
      tenantId: lot.tenantId,
      itemId: lot.itemId,
      lotNo: lot.lotNo,
      status: lot.status,
      qty: totalQty,
      manufactureDate: lot.manufactureDate,
      expiryDate: lot.expiryDate,
      createdAt: lot.createdAt,
      item: {
        id: lot.item.id,
        code: lot.item.code,
        name: lot.item.name,
        itemType: lot.item.itemType,
        uom: lot.item.uom,
        categoryId: lot.item.categoryId,
      },
    }
  }) as LotWithDetails[]
}

// ─── LOT 생성 ─────────────────────────────────────────────────────────────────

export async function createLot(data: CreateLotInput, tenantId: string) {
  await requireResourcePermission("LOT", "CREATE")
  const existing = await prisma.lot.findFirst({
    where: { tenantId, lotNo: data.lotNo },
  })
  if (existing) {
    throw new Error(`LOT번호 '${data.lotNo}'는 이미 존재합니다.`)
  }

  await prisma.lot.create({
    data: {
      tenantId,
      itemId: data.itemId,
      lotNo: data.lotNo,
      status: "ACTIVE",
      manufactureDate: data.manufactureDate ? new Date(data.manufactureDate) : null,
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
    },
  })

  revalidatePath("/app/mes/lot")
}

// ─── LOT 상태 변경 ────────────────────────────────────────────────────────────

export async function updateLotStatus(id: string, status: string) {
  await requireResourcePermission("LOT", "UPDATE")
  const tenantId = await getTenantId()
  const ownedLot = await prisma.lot.findFirst({ where: { id, tenantId }, select: { id: true } })
  if (!ownedLot) throw new Error("LOT를 찾을 수 없습니다.")
  await prisma.lot.update({
    where: { id },
    data: { status: status as any },
  })
  revalidatePath("/app/mes/lot")
}

// ─── LOT 번호 자동 생성 ───────────────────────────────────────────────────────

export async function generateLotNo(itemId: string, tenantId: string): Promise<string> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
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
  return generateCnsMaterialReceiptLotNo(prisma, tenantId, {
    itemCode: item?.code,
    itemGroupCode: item?.itemGroup?.code,
    itemCategoryCode: item?.category?.code,
    itemType: item?.itemType,
    lotNumberingType: item?.lotNumberingType,
    lotPrefix: item?.lotPrefix,
    manualLotPolicy: item?.manualLotPolicy,
  })
}

// ─── 재귀 정추적 헬퍼 ─────────────────────────────────────────────────────────

async function buildForwardTree(
  lotId: string,
  depth: number = 0
): Promise<LotGenealogyNode> {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    include: { item: true },
  })
  if (!lot) throw new Error(`LOT not found: ${lotId}`)

  const totalQty = await prisma.inventoryBalance
    .aggregate({
      where: { lotId },
      _sum: { qtyOnHand: true },
    })
    .then((r) => Number(r._sum.qtyOnHand ?? 0))

  const node: LotGenealogyNode = {
    id: lot.id,
    lotNo: lot.lotNo,
    itemName: lot.item.name,
    itemCode: lot.item.code,
    status: lot.status,
    qty: totalQty,
    relationType: null,
    children: [],
  }

  if (depth >= 10) return node

  const genealogies = await prisma.lotGenealogy.findMany({
    where: { parentLotId: lotId },
    include: { childLot: { include: { item: true } } },
  })

  for (const g of genealogies) {
    const childNode = await buildForwardTree(g.childLotId, depth + 1)
    childNode.relationType = g.relationType
    node.children!.push(childNode)
  }

  return node
}

// ─── 재귀 역추적 헬퍼 ─────────────────────────────────────────────────────────

async function buildBackwardTree(
  lotId: string,
  depth: number = 0
): Promise<LotGenealogyNode> {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    include: { item: true },
  })
  if (!lot) throw new Error(`LOT not found: ${lotId}`)

  const totalQty = await prisma.inventoryBalance
    .aggregate({
      where: { lotId },
      _sum: { qtyOnHand: true },
    })
    .then((r) => Number(r._sum.qtyOnHand ?? 0))

  const node: LotGenealogyNode = {
    id: lot.id,
    lotNo: lot.lotNo,
    itemName: lot.item.name,
    itemCode: lot.item.code,
    status: lot.status,
    qty: totalQty,
    relationType: null,
    children: [],
  }

  if (depth >= 10) return node

  const genealogies = await prisma.lotGenealogy.findMany({
    where: { childLotId: lotId },
    include: { parentLot: { include: { item: true } } },
  })

  for (const g of genealogies) {
    const parentNode = await buildBackwardTree(g.parentLotId, depth + 1)
    parentNode.relationType = g.relationType
    node.children!.push(parentNode)
  }

  return node
}

// ─── 정추적 (Forward): 이 LOT → 자식 LOT들 ──────────────────────────────────

export async function getLotForwardTrace(lotId: string): Promise<LotGenealogyNode> {
  return buildForwardTree(lotId, 0)
}

// ─── 역추적 (Backward): 이 LOT ← 부모 LOT들 ─────────────────────────────────

export async function getLotBackwardTrace(lotId: string): Promise<LotGenealogyNode> {
  return buildBackwardTree(lotId, 0)
}

// ─── LOT 검색 (Traceability 검색용) ──────────────────────────────────────────

export async function searchLotByNo(lotNo: string, tenantId: string) {
  return prisma.lot.findFirst({
    where: {
      tenantId,
      lotNo: { contains: lotNo },
    },
    include: { item: true },
  })
}

// ─── 품목 목록 (LOT 전용) ─────────────────────────────────────────────────────

export async function getItemsForLot() {
  return prisma.item.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      itemType: true,
      uom: true,
      categoryId: true,
    },
    where: { status: "ACTIVE" },
    orderBy: { code: "asc" },
  })
}

// ─── 사이트 목록 (LOT 전용) ───────────────────────────────────────────────────

export async function getSitesForLot() {
  return prisma.site.findMany({
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })
}
