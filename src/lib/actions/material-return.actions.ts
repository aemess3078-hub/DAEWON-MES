"use server"

import { prisma } from "@/lib/db/prisma"
import { Prisma } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireRole, getTenantId } from "@/lib/auth"
import { getErrorMessage } from "@/lib/utils"
import { toKstDateKey } from "@/lib/date/kst"
import { MATERIAL_RETURN_STATUS_TRANSITIONS } from "@/lib/material-return-status"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { BUSINESS_NUMBER_MAX_ATTEMPTS, isUniqueConstraintError } from "@/lib/business-numbering"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

// ─── 청운커팅 사업계획서 "자재관리 > 반품관리" (PR #50) ────────────────────────
//
// 정상 입고되어 회사 재고가 된 자재를 공급사에 반품하는 업무만 다룬다. 입고검사
// 불합격 수량의 공급사 반송 workflow는 별개이며 이번 PR의 범위가 아니다.
// PO/입고 이력(PurchaseOrderItem.receivedQty, ReceivingInspection, PurchaseOrder.status)은
// read-only 원장으로만 참조하고 절대 수정하지 않는다.
// 모든 조회/등록/수정/삭제/상태변경 액션은 클라이언트가 넘긴 tenantId를 신뢰하지
// 않고 getTenantId()로 세션에서 직접 구한다.
//
// 코드리뷰 반영(BLOCKER 3건):
//  1) InventoryBalance 차감은 read-then-absolute-write가 아니라 DB WHERE 가드 +
//     decrement 연산자를 쓴 원자적 updateMany로 처리한다 — 서로 다른 MaterialReturn
//     두 건이 같은 balance를 동시에 완료해도 lost update가 생기지 않는다.
//  2) PO 합격입고수량 상한 검증은 completeMaterialReturn 트랜잭션 안에서 해당
//     purchaseOrderItemId들을 정렬된 순서로 FOR UPDATE 잠근 뒤 수행한다 — 서로
//     다른 MaterialReturn이 같은 PurchaseOrderItem을 동시에 완료해도 둘 다 상한
//     검증을 통과할 수 없다.
//  3) MaterialReturn.siteId를 필수로 추가해 반품 건 전체를 한 사업장으로 고정한다.
//     품목의 warehouse, 연결된 PO/PO품목 모두 이 siteId 기준으로 검증한다.

const MENU_NAME = "반품관리"
const CODE_GENERATION_MAX_ATTEMPTS = BUSINESS_NUMBER_MAX_ATTEMPTS
const TXN_GENERATION_MAX_ATTEMPTS = BUSINESS_NUMBER_MAX_ATTEMPTS

function revalidateMaterialReturnPaths() {
  revalidatePath("/app/mes/material-return")
  revalidatePath("/app/mes/inventory")
  revalidatePath("/app/mes/material/stock")
  revalidatePath("/app/mes/inventory-transactions")
}

function assertPositiveQty(qty: number, label: string) {
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error(`${label} 수량은 0보다 커야 합니다.`)
  }
}

// ─── 번호 생성 (내부 전용) ────────────────────────────────────────────────────

async function generateMaterialReturnNo(tenantId: string): Promise<string> {
  const kstYear = toKstDateKey(new Date()).slice(0, 4)
  const prefix = `SR-${kstYear}-`
  const last = await prisma.materialReturn.findFirst({
    where: { tenantId, returnNo: { startsWith: prefix } },
    orderBy: { returnNo: "desc" },
    select: { returnNo: true },
  })
  const seq = last ? (parseInt(last.returnNo.split("-")[2] ?? "0", 10) || 0) + 1 : 1
  return `${prefix}${String(seq).padStart(3, "0")}`
}

// ─── 조회 ───────────────────────────────────────────────────────────────────

export type MaterialReturnRow = {
  id: string
  returnNo: string
  status: "DRAFT" | "COMPLETED" | "CANCELLED"
  site: { id: string; code: string; name: string }
  supplier: { id: string; name: string }
  purchaseOrder: { id: string; orderNo: string } | null
  reason: string | null
  itemCount: number
  totalReturnQty: number
  createdBy: { id: string; name: string }
  completedBy: { id: string; name: string } | null
  createdAt: Date
  completedAt: Date | null
}

const RETURN_LIST_SELECT = {
  id: true,
  returnNo: true,
  status: true,
  reason: true,
  createdAt: true,
  completedAt: true,
  site: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, orderNo: true } },
  createdBy: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
  items: { select: { returnQty: true } },
} satisfies Prisma.MaterialReturnSelect

export async function getMaterialReturnList(): Promise<MaterialReturnRow[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const rows = await prisma.materialReturn.findMany({
    where: { tenantId },
    select: RETURN_LIST_SELECT,
    orderBy: { createdAt: "desc" },
  })
  return rows.map((r) => ({
    id: r.id,
    returnNo: r.returnNo,
    status: r.status,
    site: r.site,
    supplier: r.supplier,
    purchaseOrder: r.purchaseOrder,
    reason: r.reason,
    itemCount: r.items.length,
    totalReturnQty: r.items.reduce((s, i) => s + Number(i.returnQty), 0),
    createdBy: r.createdBy,
    completedBy: r.completedBy,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
  }))
}

export type MaterialReturnItemDetail = {
  id: string
  item: { id: string; code: string; name: string; uom: string; spec: string | null; isLotTracked: boolean }
  purchaseOrderItem: { id: string; purchaseOrderId: string; purchaseOrderNo: string } | null
  lot: { id: string; lotNo: string } | null
  warehouse: { id: string; code: string; name: string }
  returnQty: number
  note: string | null
  inventoryTransactionId: string | null
}

export type MaterialReturnDetail = MaterialReturnRow & {
  note: string | null
  items: MaterialReturnItemDetail[]
}

export async function getMaterialReturnDetail(id: string): Promise<MaterialReturnDetail> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const r = await prisma.materialReturn.findFirst({
    where: { id, tenantId },
    select: {
      ...RETURN_LIST_SELECT,
      note: true,
      items: {
        select: {
          id: true,
          returnQty: true,
          note: true,
          inventoryTransactionId: true,
          item: { select: { id: true, code: true, name: true, uom: true, spec: true, isLotTracked: true } },
          lot: { select: { id: true, lotNo: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          purchaseOrderItem: { select: { id: true, purchaseOrderId: true, purchaseOrder: { select: { orderNo: true } } } },
        },
      },
    },
  })
  if (!r) throw new Error("반품 건을 찾을 수 없습니다.")

  return {
    id: r.id,
    returnNo: r.returnNo,
    status: r.status,
    site: r.site,
    supplier: r.supplier,
    purchaseOrder: r.purchaseOrder,
    reason: r.reason,
    note: r.note,
    itemCount: r.items.length,
    totalReturnQty: r.items.reduce((s, i) => s + Number(i.returnQty), 0),
    createdBy: r.createdBy,
    completedBy: r.completedBy,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    items: r.items.map((i) => ({
      id: i.id,
      item: i.item,
      purchaseOrderItem: i.purchaseOrderItem
        ? { id: i.purchaseOrderItem.id, purchaseOrderId: i.purchaseOrderItem.purchaseOrderId, purchaseOrderNo: i.purchaseOrderItem.purchaseOrder.orderNo }
        : null,
      lot: i.lot,
      warehouse: i.warehouse,
      returnQty: Number(i.returnQty),
      note: i.note,
      inventoryTransactionId: i.inventoryTransactionId,
    })),
  }
}

// 등록 Dialog: 사업장 선택지 — 반품 건 전체를 한 사업장으로 고정하기 위해 최우선으로 선택한다.
export async function getMaterialReturnSites() {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  return prisma.site.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })
}

// 등록 Dialog: 공급사 선택지 (SUPPLIER/BOTH)
export async function getMaterialReturnSuppliers() {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const partners = await prisma.businessPartner.findMany({
    where: { tenantId, partnerType: { in: ["SUPPLIER", "BOTH"] }, status: "ACTIVE" },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })
  return partners
}

// 등록 Dialog: 선택된 사업장·공급사의 발주 목록 (선택 사항 — PO 연결 없이도 반품 가능)
export async function getMaterialReturnPurchaseOrders(supplierId: string, siteId: string) {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const orders = await prisma.purchaseOrder.findMany({
    where: { tenantId, supplierId, siteId },
    select: { id: true, orderNo: true, orderDate: true },
    orderBy: { orderDate: "desc" },
  })
  return orders
}

// 등록 Dialog: 선택된 발주의 품목별 실제 합격입고수량 / 기존 완료 반품 누적수량
export type MaterialReturnPoItemOption = {
  id: string
  itemId: string
  itemCode: string
  itemName: string
  uom: string
  isLotTracked: boolean
  acceptedQty: number
  returnedQty: number
  returnableQty: number
}

export async function getMaterialReturnPoItems(purchaseOrderId: string): Promise<MaterialReturnPoItemOption[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const po = await prisma.purchaseOrder.findFirst({ where: { id: purchaseOrderId, tenantId }, select: { id: true } })
  if (!po) throw new Error("발주를 찾을 수 없습니다.")

  const items = await prisma.purchaseOrderItem.findMany({
    where: { purchaseOrderId },
    select: {
      id: true,
      item: { select: { id: true, code: true, name: true, uom: true, isLotTracked: true } },
      receivingInspections: { select: { acceptedQty: true } },
      materialReturnItems: {
        where: { materialReturn: { status: "COMPLETED" } },
        select: { returnQty: true },
      },
    },
  })

  return items.map((poi) => {
    const acceptedQty = poi.receivingInspections.reduce((s, r) => s + Number(r.acceptedQty), 0)
    const returnedQty = poi.materialReturnItems.reduce((s, ri) => s + Number(ri.returnQty), 0)
    return {
      id: poi.id,
      itemId: poi.item.id,
      itemCode: poi.item.code,
      itemName: poi.item.name,
      uom: poi.item.uom,
      isLotTracked: poi.item.isLotTracked,
      acceptedQty,
      returnedQty,
      returnableQty: Math.max(0, acceptedQty - returnedQty),
    }
  })
}

// 등록 Dialog: PO 미연결 직접 반품용 품목 선택지 (원자재/반제품/소모품)
export async function getMaterialReturnItemOptions() {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  return prisma.item.findMany({
    where: { tenantId, status: "ACTIVE", itemType: { in: ["RAW_MATERIAL", "SEMI_FINISHED", "CONSUMABLE"] } },
    select: { id: true, code: true, name: true, uom: true, isLotTracked: true },
    orderBy: { name: "asc" },
  })
}

// 등록 Dialog: 특정 사업장·품목의 창고별(LOT관리 품목은 LOT별) 가용재고
export type MaterialReturnStockOption = {
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  lotId: string | null
  lotNo: string | null
  qtyAvailable: number
}

export async function getMaterialReturnItemStock(itemId: string, siteId: string): Promise<MaterialReturnStockOption[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const balances = await prisma.inventoryBalance.findMany({
    where: { tenantId, itemId, siteId, qtyAvailable: { gt: 0 } },
    select: {
      qtyAvailable: true,
      warehouse: { select: { id: true, code: true, name: true } },
      lot: { select: { id: true, lotNo: true } },
    },
    orderBy: [{ warehouse: { name: "asc" } }],
  })
  return balances.map((b) => ({
    warehouseId: b.warehouse.id,
    warehouseCode: b.warehouse.code,
    warehouseName: b.warehouse.name,
    lotId: b.lot?.id ?? null,
    lotNo: b.lot?.lotNo ?? null,
    qtyAvailable: Number(b.qtyAvailable),
  }))
}

// ─── 입력 검증 (등록/수정 공용) ────────────────────────────────────────────────

export type MaterialReturnItemInput = {
  itemId: string
  purchaseOrderItemId?: string | null
  lotId?: string | null
  warehouseId: string
  returnQty: number
  note?: string | null
}

export type MaterialReturnHeaderInput = {
  siteId: string
  supplierId: string
  purchaseOrderId?: string | null
  reason?: string | null
  note?: string | null
  items: MaterialReturnItemInput[]
}

type ValidatedItem = MaterialReturnItemInput & {
  itemCode: string
  isLotTracked: boolean
}

// §8: returnQty <= qtyAvailable(항상) AND (purchaseOrderItemId 연결 시) 누적 완료
// 반품수량 + 금회 반품수량 <= 실제 합격입고수량. LOT 품목은 기존 LOT만 허용(신규
// LOT 생성 금지) + tenant/item 일치 검증. 비LOT 품목은 lotId를 받지 않는다.
//
// §3/§4 (코드리뷰 BLOCKER): 반품 건 전체가 하나의 siteId로 고정된다. 품목의
// warehouse는 tenantId+siteId가 모두 일치해야 하고, 연결된 PO/PO품목은 tenant·
// site·supplier가 모두 일치해야 한다. purchaseOrderItemId 검증은 header의
// purchaseOrderId가 null이어도 항상 수행한다 — purchaseOrderItem.findMany의
// where 절에 `purchaseOrder: { tenantId, siteId, supplierId }`를 걸어두면, 다른
// 사업장/공급사의 PO품목 id를 조작해서 보내도 poItemMap에서 조회되지 않아
// "선택한 발주품목이 올바르지 않습니다"로 자연스럽게 차단된다.
async function validateMaterialReturnInput(
  tenantId: string,
  input: MaterialReturnHeaderInput
): Promise<ValidatedItem[]> {
  const site = await prisma.site.findFirst({ where: { id: input.siteId, tenantId }, select: { id: true } })
  if (!site) throw new Error("사업장을 찾을 수 없습니다.")

  const supplier = await prisma.businessPartner.findFirst({
    where: { id: input.supplierId, tenantId, partnerType: { in: ["SUPPLIER", "BOTH"] } },
    select: { id: true },
  })
  if (!supplier) throw new Error("공급사를 찾을 수 없습니다.")

  if (input.purchaseOrderId) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, tenantId, siteId: input.siteId, supplierId: input.supplierId },
      select: { id: true },
    })
    if (!po) throw new Error("선택한 발주는 해당 사업장/공급사의 발주가 아닙니다.")
  }

  if (input.items.length === 0) throw new Error("반품 품목을 1건 이상 입력하세요.")

  const itemIds = Array.from(new Set(input.items.map((i) => i.itemId)))
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true, code: true, isLotTracked: true },
  })
  const itemMap = new Map(items.map((i) => [i.id, i]))

  const warehouseIds = Array.from(new Set(input.items.map((i) => i.warehouseId)))
  const warehouses = await prisma.warehouse.findMany({
    where: { id: { in: warehouseIds }, tenantId, siteId: input.siteId },
    select: { id: true },
  })
  const warehouseIdSet = new Set(warehouses.map((w) => w.id))

  const poItemIds = Array.from(new Set(input.items.map((i) => i.purchaseOrderItemId).filter((v): v is string => !!v)))
  const poItems = poItemIds.length
    ? await prisma.purchaseOrderItem.findMany({
        where: {
          id: { in: poItemIds },
          purchaseOrder: { tenantId, siteId: input.siteId, supplierId: input.supplierId },
        },
        select: {
          id: true,
          itemId: true,
          purchaseOrderId: true,
          receivingInspections: { select: { acceptedQty: true } },
          materialReturnItems: { where: { materialReturn: { status: "COMPLETED" } }, select: { returnQty: true } },
        },
      })
    : []
  const poItemMap = new Map(poItems.map((p) => [p.id, p]))

  const lotIds = Array.from(new Set(input.items.map((i) => i.lotId).filter((v): v is string => !!v)))
  const lots = lotIds.length
    ? await prisma.lot.findMany({ where: { id: { in: lotIds }, tenantId }, select: { id: true, itemId: true } })
    : []
  const lotMap = new Map(lots.map((l) => [l.id, l]))

  const balances = await prisma.inventoryBalance.findMany({
    where: { tenantId, siteId: input.siteId, itemId: { in: itemIds }, warehouseId: { in: warehouseIds } },
    select: { itemId: true, warehouseId: true, lotId: true, qtyAvailable: true },
  })
  const balanceKey = (itemId: string, warehouseId: string, lotId: string | null) => `${itemId}::${warehouseId}::${lotId ?? ""}`
  const balanceMap = new Map(balances.map((b) => [balanceKey(b.itemId, b.warehouseId, b.lotId), Number(b.qtyAvailable)]))

  // purchaseOrderItemId 별 "이번 요청 내" 합산 — 같은 PO품목을 여러 줄에 나눠 입력한
  // 경우까지 함께 검증한다.
  const requestedByPoItem = new Map<string, number>()
  for (const it of input.items) {
    if (!it.purchaseOrderItemId) continue
    requestedByPoItem.set(it.purchaseOrderItemId, (requestedByPoItem.get(it.purchaseOrderItemId) ?? 0) + it.returnQty)
  }

  const validated: ValidatedItem[] = []
  for (const it of input.items) {
    assertPositiveQty(it.returnQty, "반품")

    const item = itemMap.get(it.itemId)
    if (!item) throw new Error("품목을 찾을 수 없습니다.")

    if (!warehouseIdSet.has(it.warehouseId)) throw new Error(`창고를 찾을 수 없습니다(다른 사업장의 창고일 수 있습니다): ${item.code}`)

    if (item.isLotTracked) {
      if (!it.lotId) throw new Error(`LOT 관리 품목(${item.code})은 반품 시 LOT를 지정해야 합니다.`)
      const lot = lotMap.get(it.lotId)
      if (!lot || lot.itemId !== it.itemId) {
        throw new Error(`LOT가 올바르지 않습니다: ${item.code}`)
      }
    } else if (it.lotId) {
      throw new Error(`LOT 비관리 품목(${item.code})에는 LOT를 지정할 수 없습니다.`)
    }

    const qtyAvailable = balanceMap.get(balanceKey(it.itemId, it.warehouseId, it.lotId ?? null)) ?? 0
    if (it.returnQty > qtyAvailable) {
      throw new Error(`가용재고 부족: ${item.code} — 가용재고 ${qtyAvailable}, 반품 요청 ${it.returnQty}`)
    }

    if (it.purchaseOrderItemId) {
      const poItem = poItemMap.get(it.purchaseOrderItemId)
      if (!poItem || poItem.itemId !== it.itemId) {
        throw new Error(`선택한 발주품목이 올바르지 않습니다(다른 사업장/공급사의 발주품목일 수 있습니다): ${item.code}`)
      }
      if (input.purchaseOrderId && poItem.purchaseOrderId !== input.purchaseOrderId) {
        throw new Error(`선택한 발주품목이 선택한 발주에 속하지 않습니다: ${item.code}`)
      }
      const acceptedQty = poItem.receivingInspections.reduce((s, r) => s + Number(r.acceptedQty), 0)
      const alreadyReturned = poItem.materialReturnItems.reduce((s, ri) => s + Number(ri.returnQty), 0)
      const requestedTotal = requestedByPoItem.get(it.purchaseOrderItemId) ?? it.returnQty
      if (alreadyReturned + requestedTotal > acceptedQty) {
        throw new Error(
          `PO 합격입고수량 초과: ${item.code} — 합격입고 ${acceptedQty}, 기완료반품 ${alreadyReturned}, 이번요청 ${requestedTotal}`
        )
      }
    }

    validated.push({ ...it, itemCode: item.code, isLotTracked: item.isLotTracked })
  }

  return validated
}

// ─── 등록 ───────────────────────────────────────────────────────────────────

export async function createMaterialReturn(
  input: MaterialReturnHeaderInput
): Promise<{ ok: boolean; error?: string; returnId?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PURCHASE_ORDER", "CREATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    await validateMaterialReturnInput(tenantId, input)

    let lastError: unknown = null
    for (let attempt = 0; attempt < CODE_GENERATION_MAX_ATTEMPTS; attempt++) {
      const returnNo = await generateMaterialReturnNo(tenantId)
      try {
        const created = await prisma.$transaction(async (tx) => {
          const materialReturn = await tx.materialReturn.create({
            data: {
              tenantId,
              siteId: input.siteId,
              supplierId: input.supplierId,
              purchaseOrderId: input.purchaseOrderId || null,
              returnNo,
              reason: input.reason?.trim() || null,
              note: input.note?.trim() || null,
              createdById: actor.id,
              items: {
                create: input.items.map((it) => ({
                  itemId: it.itemId,
                  purchaseOrderItemId: it.purchaseOrderItemId || null,
                  lotId: it.lotId || null,
                  warehouseId: it.warehouseId,
                  returnQty: it.returnQty,
                  note: it.note?.trim() || null,
                })),
              },
            },
          })

          await tx.auditLog.create({
            data: {
              tenantId,
              actorId: actor.id,
              actorLabel: actor.name,
              entityType: "MaterialReturn",
              entityId: materialReturn.id,
              action: "CREATE",
              afterData: {
                returnNo: materialReturn.returnNo,
                status: materialReturn.status,
                siteId: materialReturn.siteId,
                supplierId: materialReturn.supplierId,
                purchaseOrderId: materialReturn.purchaseOrderId,
                items: input.items,
              },
              menuName: MENU_NAME,
            },
          })

          return materialReturn
        })

        revalidateMaterialReturnPaths()
        return { ok: true, returnId: created.id }
      } catch (e) {
        if (isUniqueConstraintError(e, ["tenantId", "returnNo"])) {
          lastError = e
          continue
        }
        throw e
      }
    }
    throw lastError instanceof Error ? lastError : new Error("반품번호 생성에 실패했습니다. 다시 시도해 주세요.")
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 수정 (DRAFT만) ───────────────────────────────────────────────────────────
//
// siteId는 등록 이후 변경할 수 없다 — 한 반품 건에 여러 사업장의 재고가 섞이는
// 것을 막기 위해서다(§5). 클라이언트가 다른 siteId를 보내더라도 서버는 항상
// current.siteId로 덮어써 검증/저장한다.

export async function updateMaterialReturn(
  id: string,
  input: MaterialReturnHeaderInput
): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PURCHASE_ORDER", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.materialReturn.findFirst({
      where: { id, tenantId },
      include: { items: true },
    })
    if (!current) throw new Error("반품 건을 찾을 수 없습니다.")
    if (current.status !== "DRAFT") throw new Error("임시저장 상태의 반품만 수정할 수 있습니다.")

    const normalizedInput: MaterialReturnHeaderInput = { ...input, siteId: current.siteId }
    await validateMaterialReturnInput(tenantId, normalizedInput)

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.materialReturn.updateMany({
        where: { id: current.id, tenantId, status: "DRAFT" },
        data: {
          supplierId: normalizedInput.supplierId,
          purchaseOrderId: normalizedInput.purchaseOrderId || null,
          reason: normalizedInput.reason?.trim() || null,
          note: normalizedInput.note?.trim() || null,
        },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }

      await tx.materialReturnItem.deleteMany({ where: { materialReturnId: current.id } })
      await tx.materialReturnItem.createMany({
        data: normalizedInput.items.map((it) => ({
          materialReturnId: current.id,
          itemId: it.itemId,
          purchaseOrderItemId: it.purchaseOrderItemId || null,
          lotId: it.lotId || null,
          warehouseId: it.warehouseId,
          returnQty: it.returnQty,
          note: it.note?.trim() || null,
        })),
      })

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "MaterialReturn",
          entityId: current.id,
          action: "UPDATE",
          beforeData: {
            siteId: current.siteId,
            supplierId: current.supplierId,
            purchaseOrderId: current.purchaseOrderId,
            items: current.items.map((i) => ({ itemId: i.itemId, warehouseId: i.warehouseId, lotId: i.lotId, returnQty: Number(i.returnQty) })),
          },
          afterData: {
            siteId: current.siteId,
            supplierId: normalizedInput.supplierId,
            purchaseOrderId: normalizedInput.purchaseOrderId || null,
            items: normalizedInput.items,
          },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateMaterialReturnPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 삭제 (DRAFT만) ───────────────────────────────────────────────────────────

export async function deleteMaterialReturn(id: string): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PURCHASE_ORDER", "DELETE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.materialReturn.findFirst({ where: { id, tenantId } })
    if (!current) throw new Error("반품 건을 찾을 수 없습니다.")
    if (current.status !== "DRAFT") throw new Error("임시저장 상태의 반품만 삭제할 수 있습니다.")

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.materialReturn.deleteMany({ where: { id: current.id, tenantId, status: "DRAFT" } })
      if (deleted.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "MaterialReturn",
          entityId: current.id,
          action: "DELETE",
          beforeData: { returnNo: current.returnNo, status: current.status },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateMaterialReturnPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 취소 (DRAFT → CANCELLED) ─────────────────────────────────────────────────

export async function cancelMaterialReturn(id: string): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PURCHASE_ORDER", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.materialReturn.findFirst({ where: { id, tenantId } })
    if (!current) throw new Error("반품 건을 찾을 수 없습니다.")
    if (current.status !== "DRAFT") throw new Error("임시저장 상태의 반품만 취소할 수 있습니다.")
    if (!MATERIAL_RETURN_STATUS_TRANSITIONS[current.status].includes("CANCELLED")) {
      throw new Error("현재 상태에서는 취소할 수 없습니다.")
    }

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.materialReturn.updateMany({
        where: { id: current.id, tenantId, status: "DRAFT" },
        data: { status: "CANCELLED" },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "MaterialReturn",
          entityId: current.id,
          action: "UPDATE",
          beforeData: { status: "DRAFT" },
          afterData: { status: "CANCELLED" },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateMaterialReturnPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 반품완료 (DRAFT → COMPLETED, 실제 재고차감) ──────────────────────────────
//
// §6: 반품완료 및 실제 재고차감은 MANAGER 이상만 수행할 수 있다. §5: COMPLETED
// 전환 시에만 InventoryBalance를 실제로 차감하고 InventoryTransaction(SUPPLIER_RETURN)을
// 생성한다. 완료 이후에는 수정·삭제·취소를 전면 금지한다(상태전이표에도 COMPLETED는
// terminal로 반영).
//
// 동시성 보장(코드리뷰 BLOCKER 1·2 반영):
//  - InventoryBalance 차감은 원자적 updateMany(WHERE qty >= X + decrement)로 처리한다.
//    같은 balance를 동시에 완료하는 두 트랜잭션은 Postgres가 행 단위로 UPDATE를
//    직렬화하므로 lost update가 생기지 않고, 둘 중 하나는 반드시 count=0으로
//    재고부족 처리된다.
//  - PO 합격입고수량 상한 검증 전에 이 반품이 참조하는 purchaseOrderItemId들을
//    정렬된 순서로 SELECT ... FOR UPDATE 잠근다. 같은 PO품목을 동시에 완료하려는
//    두 번째 트랜잭션은 첫 번째가 커밋할 때까지 이 SELECT에서 대기하고, 대기가
//    풀린 뒤에는 첫 번째가 반영한 완료 반품수량을 보고 상한을 재검증하므로 둘 다
//    통과하는 경우가 없다.
export async function completeMaterialReturn(id: string): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PURCHASE_ORDER", "UPDATE")
  try {
    const actor = await requireRole("MANAGER")
    const tenantId = await getTenantId()

    const current = await prisma.materialReturn.findFirst({
      where: { id, tenantId },
      include: {
        items: {
          include: {
            item: { select: { id: true, code: true, isLotTracked: true } },
          },
        },
      },
    })
    if (!current) throw new Error("반품 건을 찾을 수 없습니다.")
    if (current.status !== "DRAFT") throw new Error("임시저장 상태의 반품만 완료 처리할 수 있습니다.")
    if (current.items.length === 0) throw new Error("반품 품목이 없습니다.")

    // §7: 거래번호 날짜는 UTC가 아니라 KST 달력일로 채번한다 — 자정 전후 UTC 전날로
    // 찍히는 문제를 막는다.
    const todayKst = toKstDateKey(new Date()).replace(/-/g, "")

    // 같은 (item, warehouse, lot) balance를 여러 줄이 참조하거나, 서로 다른
    // MaterialReturn이 겹치는 balance/PO품목 집합을 반대 순서로 잠그면 교착
    // 가능성이 생긴다 — 처리 순서를 자연키로 정렬해 결정적으로 만든다.
    const orderedItems = [...current.items].sort((a, b) => {
      const keyA = `${a.itemId}::${a.warehouseId}::${a.lotId ?? ""}`
      const keyB = `${b.itemId}::${b.warehouseId}::${b.lotId ?? ""}`
      return keyA.localeCompare(keyB)
    })

    let lastError: unknown = null

    for (let attempt = 0; attempt < TXN_GENERATION_MAX_ATTEMPTS; attempt++) {
      const txSeqBase = await prisma.inventoryTransaction.count({
        where: { tenantId, txNo: { startsWith: `SRT-${todayKst}` } },
      })
      try {
        await prisma.$transaction(async (tx) => {
          const claimed = await tx.materialReturn.updateMany({
            where: { id: current.id, tenantId, status: "DRAFT" },
            data: { status: "COMPLETED", completedById: actor.id, completedAt: new Date() },
          })
          if (claimed.count !== 1) {
            throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
          }

          // ── PO품목 행 잠금 (동시 반품완료 직렬화) ────────────────────────────
          const poItemIds = Array.from(
            new Set(current.items.map((i) => i.purchaseOrderItemId).filter((v): v is string => !!v))
          ).sort()
          if (poItemIds.length > 0) {
            await tx.$queryRaw`SELECT id FROM "PurchaseOrderItem" WHERE id IN (${Prisma.join(poItemIds)}) ORDER BY id FOR UPDATE`
          }

          const completedItemsLog: Array<{
            itemCode: string
            warehouseId: string
            lotId: string | null
            returnQty: number
            inventoryTransactionId: string
            txNo: string
          }> = []

          // PO품목별 "이번 완료 처리 중" 누적치 — 같은 PO품목을 이 반품 내 여러 줄에
          // 나눠 입력한 경우까지 합산한다. 위에서 이미 현재 MaterialReturn.status를
          // COMPLETED로 바꿔놓았기 때문에, 아래 DB 재검증 쿼리에서 materialReturnId
          // != current.id로 자기 자신(과 자기 자신의 다른 줄)을 제외해야 한다 — 그렇지
          // 않으면 방금 COMPLETED로 바뀐 자신의 줄이 "기완료반품"에 다시 잡혀 이중계산된다.
          const completedThisRunByPoItem = new Map<string, number>()

          for (let i = 0; i < orderedItems.length; i++) {
            const line = orderedItems[i]
            const returnQty = Number(line.returnQty)

            // ── PO 합격입고수량 재검증 (잠금 이후) ───────────────────────────
            if (line.purchaseOrderItemId) {
              const poItem = await tx.purchaseOrderItem.findUnique({
                where: { id: line.purchaseOrderItemId },
                select: {
                  receivingInspections: { select: { acceptedQty: true } },
                  materialReturnItems: {
                    where: { materialReturn: { status: "COMPLETED", id: { not: current.id } } },
                    select: { returnQty: true },
                  },
                },
              })
              const acceptedQty = poItem?.receivingInspections.reduce((s, r) => s + Number(r.acceptedQty), 0) ?? 0
              const otherCompletedReturned = poItem?.materialReturnItems.reduce((s, ri) => s + Number(ri.returnQty), 0) ?? 0
              // completedThisRunByPoItem에는 "이번 완료 처리(current MaterialReturn) 중
              // 처리한 수량"만 저장한다 — otherCompletedReturned(과거 완료반품)는 매
              // 줄마다 DB에서 다시 조회되는 고정값이므로 Map에 함께 누적하면 같은
              // PO품목을 여러 줄로 나눈 두 번째 줄부터 이중으로 반복 가산된다.
              const processedThisRun = completedThisRunByPoItem.get(line.purchaseOrderItemId) ?? 0
              const totalBeforeThisLine = otherCompletedReturned + processedThisRun
              if (totalBeforeThisLine + returnQty > acceptedQty) {
                throw new Error(
                  `PO 합격입고수량 초과: ${line.item.code} — 합격입고 ${acceptedQty}, 기완료반품 ${totalBeforeThisLine}, 이번요청 ${returnQty}`
                )
              }
              completedThisRunByPoItem.set(line.purchaseOrderItemId, processedThisRun + returnQty)
            }

            // ── InventoryBalance 원자적 차감 ─────────────────────────────────
            // read-then-absolute-write 대신 DB WHERE 가드 + decrement 연산자로
            // lost update를 방지한다. qtyOnHand/qtyAvailable을 동일 수량만큼
            // decrement하면 qtyHold와의 기존 관계(qtyOnHand - qtyAvailable = qtyHold)가
            // 자동으로 보존되므로 qtyHold를 직접 읽거나 쓸 필요가 없다.
            const decremented = await tx.inventoryBalance.updateMany({
              where: {
                tenantId,
                itemId: line.itemId,
                warehouseId: line.warehouseId,
                lotId: line.lotId,
                qtyOnHand: { gte: returnQty },
                qtyAvailable: { gte: returnQty },
              },
              data: {
                qtyOnHand: { decrement: returnQty },
                qtyAvailable: { decrement: returnQty },
              },
            })
            if (decremented.count !== 1) {
              const staleBalance = await tx.inventoryBalance.findFirst({
                where: { tenantId, itemId: line.itemId, warehouseId: line.warehouseId, lotId: line.lotId },
                select: { qtyAvailable: true },
              })
              throw new Error(
                `가용재고 부족(동시 반품 처리로 재고가 변경되었을 수 있습니다): ${line.item.code} — 가용재고 ${staleBalance ? Number(staleBalance.qtyAvailable) : 0}, 반품 요청 ${returnQty}`
              )
            }

            const txNo = `SRT-${todayKst}-${String(txSeqBase + i + 1).padStart(4, "0")}`
            const inventoryTx = await tx.inventoryTransaction.create({
              data: {
                tenantId,
                itemId: line.itemId,
                lotId: line.lotId,
                fromLocationId: line.warehouseId,
                txNo,
                txType: "SUPPLIER_RETURN",
                qty: returnQty,
                refType: "MATERIAL_RETURN",
                refId: current.id,
                note: `공급사 반품 (${current.returnNo})`,
                txAt: new Date(),
              },
            })

            await tx.materialReturnItem.update({
              where: { id: line.id },
              data: { inventoryTransactionId: inventoryTx.id },
            })

            completedItemsLog.push({
              itemCode: line.item.code,
              warehouseId: line.warehouseId,
              lotId: line.lotId,
              returnQty,
              inventoryTransactionId: inventoryTx.id,
              txNo,
            })
          }

          await tx.auditLog.create({
            data: {
              tenantId,
              actorId: actor.id,
              actorLabel: actor.name,
              entityType: "MaterialReturn",
              entityId: current.id,
              action: "UPDATE",
              beforeData: { status: "DRAFT" },
              afterData: { status: "COMPLETED", completedById: actor.id, items: completedItemsLog },
              menuName: MENU_NAME,
            },
          })
        })

        revalidateMaterialReturnPaths()
        return { ok: true }
      } catch (e) {
        if (isUniqueConstraintError(e, ["tenantId", "txNo"])) {
          lastError = e
          continue
        }
        throw e
      }
    }
    throw lastError instanceof Error ? lastError : new Error("반품 거래번호 생성에 실패했습니다. 다시 시도해 주세요.")
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}
