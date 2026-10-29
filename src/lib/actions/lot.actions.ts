"use server"

import { prisma } from "@/lib/db/prisma"
import { computeNextMaterialReceiptLotNo } from "@/lib/lot-numbering/lot-reservation"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { getTenantId } from "@/lib/auth"
import { assertSessionTenant, requireLotEntryReader, requireLotReader } from "@/lib/lot-numbering/lot-session-access"

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
  // 로그인 · LOT 화면 조회 권한 확인. 세션 tenant 의 LOT 만 반환한다(이전에는 tenant 조건이 없어 모든 tenant 의 LOT 가 나왔다).
  const { tenantId } = await requireLotReader()
  const lots = await prisma.lot.findMany({
    where: { tenantId },
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
        where: { tenantId },
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

/** 선택 입력 날짜: 비어 있으면 null(기존과 동일), 해석할 수 없는 값은 DB 쓰기 전에 거부한다. */
function parseOptionalDate(value: unknown): Date | null {
  if (!value) return null
  const date = new Date(value as string)
  if (typeof value !== "string" || Number.isNaN(date.getTime())) throw new Error("날짜 형식이 올바르지 않습니다.")
  return date
}

export async function createLot(data: CreateLotInput, clientTenantId: string) {
  // 로그인 · LOT 등록(LOT CREATE) 권한 확인. tenant 는 세션 값만 쓰고, 클라이언트가 보낸 tenantId 가 다르면 거부한다.
  // (getTenantId 의 개발용 대체값을 쓰지 않는다.) 아래 검증은 모두 DB 쓰기 전에 끝난다.
  const actor = await requireResourcePermission("LOT", "CREATE")
  if (typeof clientTenantId !== "string" || clientTenantId !== actor.tenantId) throw new Error("이 기능을 사용할 권한이 없습니다.")
  const tenantId = actor.tenantId

  // 입력 검증: 저장되는 값은 아래 명시한 필드뿐이다(data 안의 tenantId·status 등 다른 필드는 무시된다).
  const itemId = typeof data?.itemId === "string" ? data.itemId : ""
  const lotNo = typeof data?.lotNo === "string" ? data.lotNo : ""
  if (!lotNo.trim()) throw new Error("LOT번호를 입력하세요")
  if (lotNo.length > 128) throw new Error("LOT번호가 너무 깁니다.")
  const manufactureDate = parseOptionalDate(data?.manufactureDate)
  const expiryDate = parseOptionalDate(data?.expiryDate)

  // 품목은 세션 tenant 소속만 인정한다. 없는/잘못된 품목과 다른 tenant 의 품목은 같은 오류로 응답한다(존재 여부 비노출).
  const item = itemId ? await prisma.item.findFirst({ where: { id: itemId, tenantId }, select: { id: true } }) : null
  if (!item) throw new Error("품목을 찾을 수 없습니다.")

  const existing = await prisma.lot.findFirst({
    where: { tenantId, lotNo },
  })
  if (existing) {
    throw new Error(`LOT번호 '${lotNo}'는 이미 존재합니다.`)
  }
  // 입고 화면에서 자동채번으로 예약(미만료)된 번호는 수동 등록할 수 없다 — 입고 수동 경로(다른 발주품목의 예약 번호 차단)와 같은 정책.
  // 예약 번호를 먼저 수동 등록하면 예약한 사용자의 입고 확정이 그 LOT 에 합쳐지거나 실패한다.
  const activeReservation = await prisma.lotNumberReservation.findFirst({
    where: { tenantId, lotNo, status: "RESERVED", expiresAt: { gt: new Date() } },
    select: { id: true },
  })
  if (activeReservation) {
    throw new Error(`LOT번호 '${lotNo}'는 입고 화면에서 자동채번 예약 중입니다. 다른 번호를 입력하거나 예약이 끝난 뒤 다시 시도해 주세요.`)
  }

  await prisma.lot.create({
    data: {
      tenantId,
      itemId: item.id,
      lotNo,
      status: "ACTIVE",
      manufactureDate,
      expiryDate,
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
  // 로그인 · LOT 등록(LOT CREATE) 권한 확인 — LOT 등록 시트의 다른 번호 생성/등록 액션과 같은 권한이다.
  // tenant 는 세션 값만 쓰고(getTenantId 의 개발용 대체값은 쓰지 않는다), 클라이언트가 보낸 tenantId 가 다르면 거부한다.
  const actor = await requireResourcePermission("LOT", "CREATE")
  if (typeof tenantId !== "string" || tenantId !== actor.tenantId) throw new Error("이 기능을 사용할 권한이 없습니다.")
  // 품목은 세션 tenant 소속만 조회한다. 없는 품목과 다른 tenant 의 품목은 같은 오류로 응답한다(존재 여부 비노출).
  const item = typeof itemId === "string" && itemId ? await prisma.item.findFirst({
    where: { id: itemId, tenantId: actor.tenantId },
    select: {
      code: true,
      itemType: true,
      lotNumberingType: true,
      lotPrefix: true,
      manualLotPolicy: true,
      itemGroup: { select: { code: true } },
      category: { select: { code: true } },
    },
  }) : null
  if (!item) throw new Error("품목을 찾을 수 없습니다.")
  return computeNextMaterialReceiptLotNo(prisma, actor.tenantId, {
    itemCode: item.code,
    itemGroupCode: item.itemGroup?.code,
    itemCategoryCode: item.category?.code,
    itemType: item.itemType,
    lotNumberingType: item.lotNumberingType,
    lotPrefix: item.lotPrefix,
    manualLotPolicy: item.manualLotPolicy,
  }, new Date())
}

// ─── 재귀 정추적 헬퍼 ─────────────────────────────────────────────────────────

// 모든 조회에 세션 tenant 를 건다: 시작 LOT·재귀로 따라가는 LOT·재고 합계가 모두 같은 tenant 안에 있어야 한다.
// 계통(LotGenealogy)에는 tenantId 가 없으므로 연결된 LOT 의 tenant 로 간선을 걸러, 다른 tenant 로 이어진 연결은 따라가지 않는다.
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
  // 로그인 · LOT 조회 권한 확인. 시작 LOT 가 세션 tenant 소속이 아니면 없는 LOT 와 같은 오류로 응답한다(추적 자체를 하지 않는다).
  const { tenantId } = await requireLotReader()
  return buildForwardTree(typeof lotId === "string" ? lotId : "", tenantId, 0)
}

// ─── 역추적 (Backward): 이 LOT ← 부모 LOT들 ─────────────────────────────────

export async function getLotBackwardTrace(lotId: string): Promise<LotGenealogyNode> {
  const { tenantId } = await requireLotReader()
  return buildBackwardTree(typeof lotId === "string" ? lotId : "", tenantId, 0)
}

// ─── LOT 검색 (Traceability 검색용) ──────────────────────────────────────────

export async function searchLotByNo(lotNo: string, clientTenantId: string) {
  // 로그인 · LOT 조회 권한 확인. 클라이언트가 보낸 tenantId 는 세션과 같은지만 확인하고 조회는 세션 tenant 로 한다.
  const { tenantId } = await requireLotReader()
  assertSessionTenant(clientTenantId, tenantId)
  return prisma.lot.findFirst({
    where: {
      tenantId,
      lotNo: { contains: typeof lotNo === "string" ? lotNo : "" },
    },
    include: { item: true },
  })
}

// ─── 품목 목록 (LOT 전용) ─────────────────────────────────────────────────────

export async function getItemsForLot() {
  // LOT 화면(및 LOT 등록 시트)의 품목 후보 — 로그인 · LOT 조회/등록 권한 확인, 세션 tenant 의 품목만.
  const { tenantId } = await requireLotEntryReader()
  return prisma.item.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      itemType: true,
      uom: true,
      categoryId: true,
    },
    where: { tenantId, status: "ACTIVE" },
    orderBy: { code: "asc" },
  })
}

// ─── 사이트 목록 (LOT 전용) ───────────────────────────────────────────────────

export async function getSitesForLot() {
  const { tenantId } = await requireLotEntryReader()
  return prisma.site.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })
}
