"use server"

import { getTenantId, requireRole } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { BOMStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"

export type BOMWithDetails = {
  id: string
  tenantId: string
  itemId: string
  version: string
  isDefault: boolean
  status: BOMStatus
  createdAt: Date
  updatedAt: Date
  item: {
    id: string
    code: string
    name: string
    itemType: string
    category: { id: string; name: string } | null
  }
  bomItems: {
    id: string
    bomId: string
    componentItemId: string
    seq: number
    qtyPer: number
    scrapRate: number
    componentItem: {
      id: string
      code: string
      name: string
      itemType: string
      uom: string
    }
  }[]
}

function serializeBom(bom: any): BOMWithDetails {
  return {
    ...bom,
    bomItems: bom.bomItems.map((bi: any) => ({
      ...bi,
      qtyPer: Number(bi.qtyPer),
      scrapRate: Number(bi.scrapRate),
    })),
  }
}

export async function getBoms(): Promise<BOMWithDetails[]> {
  const tenantId = await getTenantId()
  const boms = await prisma.bOM.findMany({
    where: { tenantId },
    include: {
      item: { include: { category: true } },
      bomItems: {
        include: { componentItem: true },
        orderBy: { seq: "asc" },
      },
    },
    orderBy: [{ item: { name: "asc" } }, { version: "asc" }],
  })
  return boms.map(serializeBom)
}

export async function getBomById(id: string): Promise<BOMWithDetails | null> {
  const tenantId = await getTenantId()
  const bom = await prisma.bOM.findFirst({
    where: { id, tenantId },
    include: {
      item: { include: { category: true } },
      bomItems: {
        include: { componentItem: true },
        orderBy: { seq: "asc" },
      },
    },
  })
  return bom ? serializeBom(bom) : null
}

export async function getItemsForBom() {
  const tenantId = await getTenantId()
  return prisma.item.findMany({
    where: { tenantId, itemType: { in: ["FINISHED", "SEMI_FINISHED"] } },
    select: { id: true, code: true, name: true, itemType: true },
    orderBy: { code: "asc" },
  })
}

export async function getComponentItems() {
  const tenantId = await getTenantId()
  return prisma.item.findMany({
    where: { tenantId, itemType: { in: ["RAW_MATERIAL", "SEMI_FINISHED", "CONSUMABLE"] } },
    select: { id: true, code: true, name: true, itemType: true, uom: true },
    orderBy: { code: "asc" },
  })
}

export type BOMItemInput = {
  componentItemId: string
  seq: number
  qtyPer: number
  scrapRate: number
}

export type CreateBomInput = {
  itemId: string
  version: string
  isDefault: boolean
  status: BOMStatus
  bomItems: BOMItemInput[]
}

export async function createBom(data: CreateBomInput, _tenantId?: string) {
  await requireResourcePermission("BOM", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const { bomItems, ...bomFields } = data
  const bom = await prisma.bOM.create({
    data: {
      ...bomFields,
      tenantId,
      bomItems: {
        create: bomItems.map((item) => ({
          componentItemId: item.componentItemId,
          seq: item.seq,
          qtyPer: item.qtyPer,
          scrapRate: item.scrapRate,
        })),
      },
    },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "BOM",
      entityId: bom.id,
      action: "CREATE",
      afterData: { itemId: bom.itemId, version: bom.version, status: bom.status, bomItemCount: bomItems.length },
      menuName: "BOM",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/bom")
}

export async function updateBom(id: string, data: CreateBomInput) {
  await requireResourcePermission("BOM", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.bOM.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("NOT_FOUND")

  const { bomItems, ...bomFields } = data
  const { itemId, version, isDefault, status } = bomFields
  await prisma.$transaction([
    prisma.bOMItem.deleteMany({ where: { bomId: id } }),
    prisma.bOM.update({
      where: { id },
      data: {
        itemId,
        version,
        isDefault,
        status,
        bomItems: {
          create: bomItems.map((item) => ({
            componentItemId: item.componentItemId,
            seq: item.seq,
            qtyPer: item.qtyPer,
            scrapRate: item.scrapRate,
          })),
        },
      },
    }),
  ])
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "BOM",
      entityId: id,
      action: "UPDATE",
      beforeData: { itemId: owned.itemId, version: owned.version, status: owned.status },
      afterData: { itemId, version, status, bomItemCount: bomItems.length },
      menuName: "BOM",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/bom")
}

export async function deleteBom(id: string) {
  await requireResourcePermission("BOM", "DELETE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.bOM.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("NOT_FOUND")

  await prisma.$transaction([
    prisma.bOMItem.deleteMany({ where: { bomId: id } }),
    prisma.bOM.delete({ where: { id } }),
  ])
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "BOM",
      entityId: id,
      action: "DELETE",
      beforeData: { itemId: owned.itemId, version: owned.version, status: owned.status },
      menuName: "BOM",
    },
  }).catch(() => {})
  revalidatePath("/app/mes/bom")
}
