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

/**
 * BOM 입력 서버 검증 (N-02, S-09 일부)
 *  - 한 BOM 안에서 같은 구성자재 중복 금지(Excel 업로드 경로와 같은 정책)
 *  - 상위 품목을 자기 자신의 구성자재로 쓸 수 없음
 *  - 상위 품목·구성자재가 모두 내 테넌트 소유 품목이어야 함(클라이언트가 보낸 ID 를 신뢰하지 않는다)
 */
async function assertBomInputValid(tenantId: string, data: CreateBomInput) {
  const componentIds = data.bomItems.map((b) => b.componentItemId)
  const dupIds = componentIds.filter((id, i) => componentIds.indexOf(id) !== i)
  if (dupIds.length > 0) {
    const dups = await prisma.item.findMany({ where: { tenantId, id: { in: Array.from(new Set(dupIds)) } }, select: { code: true } })
    throw new Error(`같은 구성자재를 한 BOM 에 중복해서 등록할 수 없습니다: ${dups.map((d) => d.code).join(", ") || "중복 자재"}`)
  }
  if (componentIds.includes(data.itemId)) throw new Error("BOM 의 상위 품목을 구성자재로 등록할 수 없습니다.")
  const wanted = Array.from(new Set([data.itemId, ...componentIds]))
  const owned = await prisma.item.count({ where: { tenantId, id: { in: wanted } } })
  if (owned !== wanted.length) throw new Error("선택한 품목 중 존재하지 않거나 접근 권한이 없는 품목이 있습니다.")
}

export async function createBom(data: CreateBomInput, _tenantId?: string) {
  await requireResourcePermission("BOM", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  await assertBomInputValid(tenantId, data)
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
  await assertBomInputValid(tenantId, data)

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

  // N-04: 생산계획·작업지시가 참조 중인 BOM 은 삭제할 수 없다(계획의 BOM 참조가 조용히 끊기는 것을 방지).
  const [planItemCount, workOrderCount] = await Promise.all([
    prisma.productionPlanItem.count({ where: { bomId: id } }),
    prisma.workOrder.count({ where: { bomId: id } }),
  ])
  if (planItemCount > 0 || workOrderCount > 0) {
    throw new Error(
      `이 BOM 은 생산계획 ${planItemCount}건, 작업지시 ${workOrderCount}건에서 사용 중이라 삭제할 수 없습니다. 사용을 중단하려면 상태를 '비활성'으로 변경하세요.`
    )
  }

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
