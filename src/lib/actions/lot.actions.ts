"use server"

import { prisma } from "@/lib/db/prisma"
import { generateCnsMaterialReceiptLotNo } from "@/lib/lot-numbering/lot-number-generator"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { getTenantId } from "@/lib/auth"
import { LotStatus } from "@prisma/client"
import { recordAuditLog } from "@/lib/audit-log"
import { requireActor, requireReadActor, assertSessionTenant } from "@/lib/auth/action-guards"

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
  const sessionActor = await requireReadActor("LOT")
  const lots = await prisma.lot.findMany({
    where: { tenantId: sessionActor.tenantId },
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
  const actor = await requireResourcePermission("LOT", "CREATE")
  // 클라이언트 tenantId 는 신뢰하지 않는다 — 세션 tenant 와 다르면 거부, 품목은 세션 tenant 소유만 허용.
  assertSessionTenant(actor, tenantId)
  const ownedItem = await prisma.item.findFirst({
    where: { id: data.itemId, tenantId: actor.tenantId },
    select: { id: true },
  })
  if (!ownedItem) throw new Error("품목을 찾을 수 없습니다.")
  const lotNo = data.lotNo?.trim()
  if (!lotNo) throw new Error("LOT 번호를 입력해 주세요.")
  const existing = await prisma.lot.findFirst({
    where: { tenantId: actor.tenantId, lotNo },
  })
  if (existing) {
    throw new Error(`LOT번호 '${data.lotNo}'는 이미 존재합니다.`)
  }

  await prisma.$transaction(async (tx) => {
    const created = await tx.lot.create({
      data: {
        tenantId: actor.tenantId,
        itemId: data.itemId,
        lotNo,
        status: "ACTIVE",
        manufactureDate: data.manufactureDate ? new Date(data.manufactureDate) : null,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
      },
    })
    // Phase 11 / DG-030: LOT 생성 감사(LOT_CREATE). 생성 후 lotNo 는 변하지 않는다 — LOT QR 의 식별자.
    await recordAuditLog(tx, {
      tenantId: actor.tenantId,
      actor,
      entityType: "Lot",
      entityId: created.id,
      action: "CREATE",
      afterData: { event: "LOT_CREATE", lotNo, itemId: data.itemId, status: "ACTIVE" },
      menuName: "LOT관리",
    })
  })

  revalidatePath("/app/mes/lot")
}

// ─── LOT 상태 변경 ────────────────────────────────────────────────────────────

export async function updateLotStatus(id: string, status: string) {
  const actor = await requireResourcePermission("LOT", "UPDATE")
  const tenantId = actor.tenantId
  // 허용된 LotStatus enum 값만 받는다(임의 문자열 → DB 오류/오염 방지).
  if (!(Object.values(LotStatus) as string[]).includes(status)) {
    throw new Error("유효하지 않은 LOT 상태입니다.")
  }
  const nextStatus = status as LotStatus
  const ownedLot = await prisma.lot.findFirst({ where: { id, tenantId }, select: { id: true, status: true, lotNo: true } })
  if (!ownedLot) throw new Error("LOT를 찾을 수 없습니다.")
  if (ownedLot.status === nextStatus) return
  await prisma.$transaction(async (tx) => {
    const updated = await tx.lot.updateMany({ where: { id, tenantId }, data: { status: nextStatus } })
    if (updated.count !== 1) throw new Error("LOT를 찾을 수 없습니다.")
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "Lot",
      entityId: id,
      action: "UPDATE",
      beforeData: { lotNo: ownedLot.lotNo, status: ownedLot.status },
      afterData: { lotNo: ownedLot.lotNo, status: nextStatus },
      menuName: "LOT관리",
    })
  })
  revalidatePath("/app/mes/lot")
}

// ─── LOT 번호 자동 생성 ───────────────────────────────────────────────────────

export async function generateLotNo(itemId: string, tenantId: string): Promise<string> {
  const sessionActor = await requireActor()
  assertSessionTenant(sessionActor, tenantId)
  const item = await prisma.item.findFirst({
    where: { id: itemId, tenantId: sessionActor.tenantId },
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
  return generateCnsMaterialReceiptLotNo(prisma, sessionActor.tenantId, {
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
  tenantId: string,
  depth: number = 0
): Promise<LotGenealogyNode> {
  const lot = await prisma.lot.findFirst({
    where: { id: lotId, tenantId },
    include: { item: true },
  })
  if (!lot) throw new Error(`LOT not found: ${lotId}`)

  const totalQty = await prisma.inventoryBalance
    .aggregate({
      where: { lotId, tenantId },
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
    where: { parentLotId: lotId, childLot: { tenantId } },
    include: { childLot: { include: { item: true } } },
  })

  for (const g of genealogies) {
    const childNode = await buildForwardTree(g.childLotId, tenantId, depth + 1)
    childNode.relationType = g.relationType
    node.children!.push(childNode)
  }

  return node
}

// ─── 재귀 역추적 헬퍼 ─────────────────────────────────────────────────────────

async function buildBackwardTree(
  lotId: string,
  tenantId: string,
  depth: number = 0
): Promise<LotGenealogyNode> {
  const lot = await prisma.lot.findFirst({
    where: { id: lotId, tenantId },
    include: { item: true },
  })
  if (!lot) throw new Error(`LOT not found: ${lotId}`)

  const totalQty = await prisma.inventoryBalance
    .aggregate({
      where: { lotId, tenantId },
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
    where: { childLotId: lotId, parentLot: { tenantId } },
    include: { parentLot: { include: { item: true } } },
  })

  for (const g of genealogies) {
    const parentNode = await buildBackwardTree(g.parentLotId, tenantId, depth + 1)
    parentNode.relationType = g.relationType
    node.children!.push(parentNode)
  }

  return node
}

// ─── 정추적 (Forward): 이 LOT → 자식 LOT들 ──────────────────────────────────

export async function getLotForwardTrace(lotId: string): Promise<LotGenealogyNode> {
  const sessionActor = await requireReadActor("LOT")
  return buildForwardTree(lotId, sessionActor.tenantId, 0)
}

// ─── 역추적 (Backward): 이 LOT ← 부모 LOT들 ─────────────────────────────────

export async function getLotBackwardTrace(lotId: string): Promise<LotGenealogyNode> {
  const sessionActor = await requireReadActor("LOT")
  return buildBackwardTree(lotId, sessionActor.tenantId, 0)
}

// ─── LOT 검색 (Traceability 검색용) ──────────────────────────────────────────

export async function searchLotByNo(lotNo: string, tenantId: string) {
  const sessionActor = await requireReadActor("LOT")
  assertSessionTenant(sessionActor, tenantId)
  return prisma.lot.findFirst({
    where: {
      tenantId: sessionActor.tenantId,
      lotNo: { contains: lotNo },
    },
    include: { item: true },
  })
}

// ─── 품목 목록 (LOT 전용) ─────────────────────────────────────────────────────

export async function getItemsForLot() {
  const sessionActor = await requireActor()
  return prisma.item.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      itemType: true,
      uom: true,
      categoryId: true,
    },
    where: { tenantId: sessionActor.tenantId, status: "ACTIVE" },
    orderBy: { code: "asc" },
  })
}

// ─── 사이트 목록 (LOT 전용) ───────────────────────────────────────────────────

export async function getSitesForLot() {
  const sessionActor = await requireActor()
  return prisma.site.findMany({
    where: { tenantId: sessionActor.tenantId },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })
}
