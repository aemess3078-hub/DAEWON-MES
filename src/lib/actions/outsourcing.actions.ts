"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId, requireRole } from "@/lib/auth"
import { Prisma, PurchaseOrderStatus, ReceivingInspectionResult } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { randomBytes } from "crypto"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import {
  lockPurchaseOrderItemsForUpdate,
  lockWorkOrderOperationForUpdate,
  withQuantityTransactionRetry,
} from "@/lib/quantity-concurrency"
import { recordAuditLog } from "@/lib/audit-log"
import { delay, kstDateParts, withUniqueBusinessNumberRetry } from "@/lib/business-numbering"

// ─── Filter & Types ───────────────────────────────────────────────────────────

export type OutsourcingFilter = {
  from?: string  // YYYY-MM-DD
  to?: string
  supplierId?: string
  status?: PurchaseOrderStatus
}

export type OutsourcingOrderRow = {
  id: string
  orderNo: string
  orderDate: string
  expectedDate: string
  supplierName: string
  supplierId: string
  status: PurchaseOrderStatus
  totalAmount: number | null
  itemCount: number
  itemSummary: string
  firstItemCode: string | null
  totalQty: number
  totalReceivedQty: number
  workOrderNo: string | null
  operationName: string | null
  operationSeq: number | null
  isOverdue: boolean
  note: string | null
}

export type OutsourcingReceivingRow = {
  id: string
  inspectedAt: string
  orderNo: string
  supplierName: string
  workOrderNo: string | null
  operationName: string | null
  operationSeq: number | null
  itemCode: string
  itemName: string
  receivedQty: number
  acceptedQty: number
  rejectedQty: number
  result: ReceivingInspectionResult
}

export type OutsourcingSummary = {
  totalOrders: number
  pendingOrders: number
  partialReceived: number
  completed: number
  overdue: number
}

export type OutsourcingWipUnitRow = {
  id: string
  mfgNo: string
  workOrderNo: string | null
  outsourcingOrderNo: string | null
  outsourcingOrderItemId: string | null
  itemCode: string
  itemName: string
  qty: number
  partnerName: string
  processName: string
  wipStatus: "OUTSOURCED" | "RECEIVED"
}

export type OutsourcingAvailableWipUnitRow = {
  id: string
  mfgNo: string
  itemCode: string
  itemName: string
  qty: number
  workOrderNo: string
  operationSeq: number
  wipStatus: "IN_PROCESS" | "WAITING" | "REWORK"
  parentWipUnitId: string | null
}

export type OutsourcingWipReceivingRow = {
  id: string
  createdAt: string
  mfgNo: string
  workOrderNo: string | null
  outsourcingOrderNo: string | null
  outsourcingOrderItemId: string | null
  itemCode: string
  itemName: string
  qty: number
  partnerName: string
  note: string | null
}

export type OutsourcingData = {
  filter: OutsourcingFilter
  summary: OutsourcingSummary
  orders: OutsourcingOrderRow[]
  receivings: OutsourcingReceivingRow[]
  wipUnits: OutsourcingWipUnitRow[]
  availableWipUnits: OutsourcingAvailableWipUnitRow[]
  wipReceivingHistory: OutsourcingWipReceivingRow[]
  partners: { id: string; name: string }[]
  recentProcessNames: string[]
}

// ─── 타입 ────────────────────────────────────────────────────────────────────

export type CreateOutsourcingOrderInput = {
  supplierId: string
  outsourcingProcessName: string
  expectedDate?: string  // YYYY-MM-DD
  note?: string
}

export type IssueWipUnitToOutsourcingInput = {
  wipUnitId: string
  outsourcingOrderId: string
}

export type ReceiveWipUnitFromOutsourcingInput = {
  wipUnitId: string
  note?: string
}

export type InspectOutsourcedWipUnitInput = {
  wipUnitId: string
  acceptedQty: number
  defectQty: number
  reworkQty: number
  note?: string
}

export type InspectOutsourcedWipUnitResult = {
  success: true
  updatedWipUnitId: string
  createdDefectWipUnitId?: string
  createdReworkWipUnitId?: string
  message: string
}

// ─── 발주 생성 ────────────────────────────────────────────────────────────────

function generateOutsourcingOrderNo(): string {
  const now = new Date()
  const { yyyymmdd } = kstDateParts(now)
  const kstInstant = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const hhmmss = kstInstant.toISOString().slice(11, 19).replace(/:/g, "")
  const random = randomBytes(2).toString("hex").toUpperCase().slice(0, 4)
  return `OS-${yyyymmdd}-${hhmmss}-${random}`
}

function isOutsourcingPurchaseOrder(order: { orderNo: string; note: string | null }) {
  return order.orderNo.startsWith("OS-") || (order.note ?? "").includes("[OUTSOURCING]")
}

async function getLatestOutsourcingOrderItemForWipUnit(
  client: Pick<Prisma.TransactionClient, "wipMovement" | "purchaseOrderItem">,
  tenantId: string,
  wipUnitId: string,
) {
  const latestIssue = await client.wipMovement.findFirst({
    where: {
      tenantId,
      wipUnitId,
      movementType: "OUTSOURCED",
      sourceType: "PurchaseOrderItem",
      sourceId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { sourceId: true },
  })
  if (!latestIssue?.sourceId) return null

  return client.purchaseOrderItem.findFirst({
    where: {
      id: latestIssue.sourceId,
      purchaseOrder: { tenantId },
    },
    include: {
      purchaseOrder: { include: { supplier: true } },
      workOrderOperation: {
        include: {
          workOrder: { select: { id: true, orderNo: true, tenantId: true } },
          routingOperation: { select: { id: true, seq: true, name: true } },
        },
      },
    },
  })
}

export async function createOutsourcingOrder(data: CreateOutsourcingOrderInput) {
  await requireResourcePermission("PURCHASE_ORDER", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = actor.tenantId

  const supplier = await prisma.businessPartner.findUniqueOrThrow({
    where: { id: data.supplierId },
  })
  if (supplier.tenantId !== tenantId) {
    throw new Error("선택한 외주처를 찾을 수 없습니다.")
  }

  const now = new Date()
  const note = `[OUTSOURCING] ${data.outsourcingProcessName}${data.note ? `\n${data.note}` : ""}`

  const order = await withUniqueBusinessNumberRetry(async (attempt) => {
    if (attempt > 0) await delay(1100)
    const orderNo = generateOutsourcingOrderNo()
    return prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          tenantId,
          orderNo,
          supplierId: data.supplierId,
          siteId: (await tx.site.findFirst({ where: { tenantId } }))?.id || "",
          status: "ORDERED",
          orderDate: now,
          expectedDate: data.expectedDate
            ? new Date(`${data.expectedDate}T00:00:00.000`)
            : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          note,
        },
      })
      await recordAuditLog(tx, {
        tenantId,
        actor,
        entityType: "OutsourcingOrder",
        entityId: created.id,
        action: "CREATE",
        afterData: {
          orderNo,
          supplierId: data.supplierId,
          outsourcingProcessName: data.outsourcingProcessName,
        },
        menuName: "외주관리",
      })
      return created
    })
  }, { fields: ["tenantId", "orderNo"], message: "외주발주번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요." })

  revalidatePath("/app/mes/production/outsourcing")
  return order
}

// ─── WipUnit 외주출고 ──────────────────────────────────────────────────────────

export async function issueWipUnitToOutsourcing(data: IssueWipUnitToOutsourcingInput) {
  await requireResourcePermission("PURCHASE_ORDER", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = actor.tenantId

  const wipUnit = await prisma.wipUnit.findUniqueOrThrow({
    where: { id: data.wipUnitId },
    include: {
      workOrderOperation: {
        include: {
          workOrder: { select: { id: true, tenantId: true, siteId: true, orderNo: true } },
          routingOperation: { select: { id: true, seq: true, name: true } },
        },
      },
    },
  })
  if (wipUnit.tenantId !== tenantId) {
    throw new Error("작업 WIP을 찾을 수 없습니다.")
  }

  if (wipUnit.status === "OUTSOURCED") {
    throw new Error("이미 외주 처리된 작업입니다.")
  }

  const purchaseOrder = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: data.outsourcingOrderId },
    include: { supplier: true },
  })
  if (purchaseOrder.tenantId !== tenantId || !isOutsourcingPurchaseOrder(purchaseOrder)) {
    throw new Error("외주발주를 찾을 수 없습니다.")
  }
  if (purchaseOrder.supplier.tenantId !== tenantId || !["SUPPLIER", "BOTH"].includes(purchaseOrder.supplier.partnerType)) {
    throw new Error("선택한 외주처를 찾을 수 없습니다.")
  }
  if (purchaseOrder.siteId !== wipUnit.workOrderOperation.workOrder.siteId) {
    throw new Error("외주발주 사업장과 작업지시 사업장이 일치하지 않습니다.")
  }

  await withQuantityTransactionRetry(() => prisma.$transaction(async (tx) => {
    await lockWorkOrderOperationForUpdate(tx, wipUnit.workOrderOperationId)

    let orderItem = await tx.purchaseOrderItem.findFirst({
      where: { purchaseOrderId: purchaseOrder.id, itemId: wipUnit.itemId },
      include: { workOrderOperation: true },
    })
    if (orderItem && orderItem.workOrderOperationId !== wipUnit.workOrderOperationId) {
      throw new Error("같은 외주발주에 동일 품목의 다른 공정을 함께 연결할 수 없습니다. 공정별 외주발주를 분리해주세요.")
    }
    if (!orderItem) {
      orderItem = await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          itemId: wipUnit.itemId,
          workOrderOperationId: wipUnit.workOrderOperationId,
          qty: wipUnit.qty,
          unitPrice: 0,
          stockAtOrder: 0,
          note: `외주공정: ${wipUnit.workOrderOperation.workOrder.orderNo} / ${wipUnit.workOrderOperation.routingOperation.seq}. ${wipUnit.workOrderOperation.routingOperation.name}`,
        },
        include: { workOrderOperation: true },
      })
    }
    await lockPurchaseOrderItemsForUpdate(tx, tenantId, [orderItem.id])

    const currentIssuedQty = await tx.wipMovement.aggregate({
      where: {
        tenantId,
        movementType: "OUTSOURCED",
        sourceType: "PurchaseOrderItem",
        sourceId: orderItem.id,
      },
      _sum: { qty: true },
    })
    const nextIssuedQty = Number(currentIssuedQty._sum.qty ?? 0) + Number(wipUnit.qty)
    if (nextIssuedQty - Number(orderItem.qty) > 0.000001) {
      throw new Error(`외주출고수량은 외주발주수량을 초과할 수 없습니다. 잔여수량: ${Math.max(0, Number(orderItem.qty) - Number(currentIssuedQty._sum.qty ?? 0)).toLocaleString("ko-KR")}`)
    }

    const updated = await tx.wipUnit.updateMany({
      where: { id: data.wipUnitId, tenantId, status: { in: ["IN_PROCESS", "WAITING", "REWORK"] } },
      data: {
        status: "OUTSOURCED",
        outsourcingPartnerId: purchaseOrder.supplierId,
      },
    })
    if (updated.count !== 1) {
      throw new Error("이미 외주 처리되었거나 외주출고 가능한 상태가 아닙니다.")
    }

    await tx.wipMovement.create({
      data: {
        tenantId,
        siteId: wipUnit.siteId,
        wipUnitId: data.wipUnitId,
        movementType: "OUTSOURCED",
        fromOperationId: wipUnit.workOrderOperationId,
        toOperationId: wipUnit.workOrderOperationId,
        toPartnerId: purchaseOrder.supplierId,
        sourceType: "PurchaseOrderItem",
        sourceId: orderItem.id,
        qty: wipUnit.qty,
        note: `외주출고: ${purchaseOrder.orderNo} / ${purchaseOrder.supplier.name} - ${wipUnit.workOrderOperation.routingOperation.seq}. ${wipUnit.workOrderOperation.routingOperation.name} - 제조번호: ${wipUnit.manufacturingNo || "-"}`,
      },
    })
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "WipMovement",
      entityId: data.wipUnitId,
      action: "UPDATE",
      afterData: {
        movementType: "OUTSOURCED",
        wipUnitId: data.wipUnitId,
        purchaseOrderId: purchaseOrder.id,
        purchaseOrderItemId: orderItem.id,
        supplierId: purchaseOrder.supplierId,
        qty: wipUnit.qty,
      },
      menuName: "외주관리",
    })
  }))

  revalidatePath("/app/mes/production/outsourcing")
  revalidatePath("/app/mes/production/wip-inventory")
  revalidatePath("/app/mes/manufacturing-traceability")
}

// ─── WipUnit 외주입고 ──────────────────────────────────────────────────────────

export async function receiveWipUnitFromOutsourcing(data: ReceiveWipUnitFromOutsourcingInput) {
  await requireResourcePermission("PURCHASE_ORDER", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = actor.tenantId

  const wipUnit = await prisma.wipUnit.findUniqueOrThrow({
    where: { id: data.wipUnitId },
    include: { workOrderOperation: true },
  })
  if (wipUnit.tenantId !== tenantId) {
    throw new Error("작업 WIP을 찾을 수 없습니다.")
  }

  if (wipUnit.status !== "OUTSOURCED") {
    throw new Error("외주 처리되지 않은 작업입니다.")
  }

  if (!wipUnit.outsourcingPartnerId) {
    throw new Error("외주처 정보가 없습니다.")
  }

  const orderItem = await getLatestOutsourcingOrderItemForWipUnit(prisma, tenantId, data.wipUnitId)
  if (!orderItem || !orderItem.workOrderOperation) {
    throw new Error("외주발주 item 연결을 찾을 수 없습니다.")
  }
  if (orderItem.workOrderOperationId !== wipUnit.workOrderOperationId) {
    throw new Error("외주발주 공정과 재공 공정이 일치하지 않습니다.")
  }
  if (orderItem.purchaseOrder.supplierId !== wipUnit.outsourcingPartnerId) {
    throw new Error("외주발주 업체와 재공 외주처가 일치하지 않습니다.")
  }

  await withQuantityTransactionRetry(() => prisma.$transaction(async (tx) => {
    await lockPurchaseOrderItemsForUpdate(tx, tenantId, [orderItem.id])
    const lockedItem = await tx.purchaseOrderItem.findFirst({
      where: { id: orderItem.id, purchaseOrder: { tenantId } },
      include: { purchaseOrder: { include: { supplier: true } } },
    })
    if (!lockedItem) throw new Error("외주발주 item을 찾을 수 없습니다.")
    const remainingQty = Number(lockedItem.qty) - Number(lockedItem.receivedQty)
    if (Number(wipUnit.qty) - remainingQty > 0.000001) {
      throw new Error(`외주입고수량은 외주발주 잔량을 초과할 수 없습니다. 잔여수량: ${Math.max(0, remainingQty).toLocaleString("ko-KR")}`)
    }

    const updated = await tx.wipUnit.updateMany({
      where: { id: data.wipUnitId, tenantId, status: "OUTSOURCED", outsourcingPartnerId: lockedItem.purchaseOrder.supplierId },
      data: {
        status: "RECEIVED",
        outsourcingPartnerId: null,
      },
    })
    if (updated.count !== 1) {
      throw new Error("이미 외주입고 처리되었거나 외주처 정보가 일치하지 않습니다.")
    }

    await tx.purchaseOrderItem.update({
      where: { id: lockedItem.id },
      data: { receivedQty: { increment: wipUnit.qty } },
    })

    await tx.wipMovement.create({
      data: {
        tenantId,
        siteId: wipUnit.siteId,
        wipUnitId: data.wipUnitId,
        movementType: "RETURNED",
        fromOperationId: wipUnit.workOrderOperationId,
        toOperationId: wipUnit.workOrderOperationId,
        fromPartnerId: lockedItem.purchaseOrder.supplierId,
        sourceType: "PurchaseOrderItem",
        sourceId: lockedItem.id,
        qty: wipUnit.qty,
        note: `외주입고/검사대기: ${lockedItem.purchaseOrder.orderNo} / ${lockedItem.purchaseOrder.supplier.name} - 제조번호: ${wipUnit.manufacturingNo || "-"}${data.note ? ` - ${data.note}` : ""}`,
      },
    })
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "WipMovement",
      entityId: data.wipUnitId,
      action: "UPDATE",
      afterData: {
        movementType: "RETURNED",
        wipUnitId: data.wipUnitId,
        purchaseOrderId: lockedItem.purchaseOrderId,
        purchaseOrderItemId: lockedItem.id,
        supplierId: lockedItem.purchaseOrder.supplierId,
        qty: wipUnit.qty,
      },
      menuName: "외주관리",
    })
  }))

  revalidatePath("/app/mes/production/outsourcing")
  revalidatePath("/app/mes/production/wip-inventory")
  revalidatePath("/app/mes/manufacturing-traceability")
}

export async function inspectOutsourcedWipUnit(
  input: InspectOutsourcedWipUnitInput
): Promise<InspectOutsourcedWipUnitResult> {
  await requireResourcePermission("PURCHASE_ORDER", "UPDATE")
  await requireResourcePermission("QUALITY_INSPECTION", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = actor.tenantId

  // 1. WipUnit 조회 및 테넌트 검증
  const wipUnit = await prisma.wipUnit.findUniqueOrThrow({
    where: { id: input.wipUnitId },
  })
  if (wipUnit.tenantId !== tenantId) {
    throw new Error("재공을 찾을 수 없습니다.")
  }

  // 2. 상태 검증: RECEIVED만 허용
  if (wipUnit.status !== "RECEIVED") {
    throw new Error("입고검사 대기(RECEIVED) 상태의 재공만 검사처리할 수 있습니다.")
  }

  // 3. 수량 검증
  const { acceptedQty, defectQty, reworkQty } = input
  if (acceptedQty < 0 || defectQty < 0 || reworkQty < 0) {
    throw new Error("수량은 0 이상이어야 합니다.")
  }
  const totalInput = acceptedQty + defectQty + reworkQty
  if (totalInput === 0) {
    throw new Error("검사 수량을 입력해주세요.")
  }
  const wipQty = Number(wipUnit.qty)
  if (Math.abs(totalInput - wipQty) > 0.000001) {
    throw new Error(
      `검사 수량 합계(${totalInput})가 재공 수량(${wipQty})과 일치해야 합니다.`
    )
  }

  // 4. 중복 검사처리 방지 — 현재 외주 사이클로 한정
  //
  //   재공은 재외주로 여러 번 외주 사이클을 돌 수 있다. 따라서 "과거에 검사된 적이
  //   있는가"가 아니라 "이번 입고분이 이미 검사됐는가"를 판단해야 한다.
  //   가장 최근 RETURNED(외주입고) 시점을 현재 사이클의 시작으로 보고,
  //   그 이후에 생성된 OutsourcingInspection 이동만 중복으로 취급한다.
  const latestReturned = await prisma.wipMovement.findFirst({
    where: {
      tenantId,
      wipUnitId: input.wipUnitId,
      movementType: "RETURNED",
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, sourceId: true },
  })
  if (!latestReturned) {
    throw new Error("외주입고 이력을 찾을 수 없습니다.")
  }
  const orderItemId = latestReturned.sourceId
  if (!orderItemId) {
    throw new Error("외주입고의 외주발주 item 연결을 찾을 수 없습니다.")
  }
  const orderItem = await prisma.purchaseOrderItem.findFirst({
    where: { id: orderItemId, purchaseOrder: { tenantId } },
    include: {
      purchaseOrder: { select: { id: true, orderNo: true, supplierId: true } },
      workOrderOperation: {
        select: {
          id: true,
          workOrderId: true,
        },
      },
    },
  })
  if (!orderItem || orderItem.workOrderOperationId !== wipUnit.workOrderOperationId) {
    throw new Error("외주입고의 외주발주 item과 재공 공정이 일치하지 않습니다.")
  }

  const existingInspection = await prisma.wipMovement.findFirst({
    where: {
      tenantId,
      wipUnitId: input.wipUnitId,
      sourceType: "OutsourcingInspection",
      createdAt: { gte: latestReturned.createdAt },
    },
    select: { id: true },
  })
  if (existingInspection) {
    throw new Error("이미 검사처리된 재공입니다.")
  }

  // 5. siteId 조회
  const site = await prisma.site.findFirst({ where: { tenantId } })
  const siteId = site?.id ?? null

  let createdDefectWipUnitId: string | undefined
  let createdReworkWipUnitId: string | undefined

  await prisma.$transaction(async (tx) => {
    const movements: Prisma.WipMovementCreateManyInput[] = []

    // ── 합격분: 부모 WipUnit 복귀 ────────────────────────────────────────────
    //   acceptedQty=0이면 부모는 qty=0 / SCRAPPED (배치 전량 불합격)
    //
    //   status='RECEIVED' 를 where 에 포함한 updateMany 로 갱신하여 검사대기 상태를
    //   원자적으로 선점한다. 앞의 조회 기반 중복 검사는 동시 요청 사이에 틈이 있으므로
    //   더블클릭·동시 요청은 이 조건에서 count=0 이 되어 차단된다.
    const parentNewStatus = acceptedQty > 0 ? "IN_PROCESS" : "SCRAPPED"
    const parentUpdate = await tx.wipUnit.updateMany({
      where: { id: input.wipUnitId, tenantId, status: "RECEIVED" },
      data: { status: parentNewStatus, qty: acceptedQty },
    })
    if (parentUpdate.count !== 1) {
      throw new Error("이미 검사처리되었거나 검사대기 상태가 아닙니다.")
    }

    if (acceptedQty > 0) {
      movements.push({
        tenantId,
        siteId,
        wipUnitId: input.wipUnitId,
        movementType: "RELEASED",
        qty: acceptedQty,
        sourceType: "OutsourcingInspection",
        sourceId: orderItem.id,
        note: `외주검사 합격 복귀: ${orderItem.purchaseOrder.orderNo}${input.note ? ` - ${input.note}` : ""} (합격=${acceptedQty})`,
      })
    }

    // ── 불량분: SCRAPPED 자식 WipUnit 생성 ──────────────────────────────────
    if (defectQty > 0) {
      const defectChild = await tx.wipUnit.create({
        data: {
          tenantId,
          siteId: wipUnit.siteId,
          workOrderId: wipUnit.workOrderId,
          workOrderOperationId: wipUnit.workOrderOperationId,
          itemId: wipUnit.itemId,
          lotId: wipUnit.lotId,
          manufacturingNo: wipUnit.manufacturingNo,
          currentWorkCenterId: wipUnit.currentWorkCenterId,
          currentWarehouseId: wipUnit.currentWarehouseId,
          currentLocationId: wipUnit.currentLocationId,
          parentWipUnitId: input.wipUnitId,
          qty: defectQty,
          status: "SCRAPPED",
        },
      })
      createdDefectWipUnitId = defectChild.id

      movements.push(
        {
          tenantId,
          siteId,
          wipUnitId: input.wipUnitId,
          relatedWipUnitId: defectChild.id,
          movementType: "DEFECT",
          qty: defectQty,
          sourceType: "OutsourcingInspection",
          sourceId: orderItem.id,
          note: `외주검사 불량: ${orderItem.purchaseOrder.orderNo}${input.note ? ` - ${input.note}` : ""} (불량=${defectQty})`,
        },
        {
          tenantId,
          siteId,
          wipUnitId: input.wipUnitId,
          relatedWipUnitId: defectChild.id,
          movementType: "SPLIT",
          qty: defectQty,
          sourceType: "OutsourcingInspection",
          sourceId: orderItem.id,
          note: `외주검사 불량 수량 분리 (defectQty=${defectQty})`,
        }
      )
    }

    // ── 재외주분: REWORK 자식 WipUnit 생성 ──────────────────────────────────
    if (reworkQty > 0) {
      const reworkChild = await tx.wipUnit.create({
        data: {
          tenantId,
          siteId: wipUnit.siteId,
          workOrderId: wipUnit.workOrderId,
          workOrderOperationId: wipUnit.workOrderOperationId,
          itemId: wipUnit.itemId,
          lotId: wipUnit.lotId,
          manufacturingNo: wipUnit.manufacturingNo,
          currentWorkCenterId: wipUnit.currentWorkCenterId,
          currentWarehouseId: wipUnit.currentWarehouseId,
          currentLocationId: wipUnit.currentLocationId,
          parentWipUnitId: input.wipUnitId,
          qty: reworkQty,
          status: "REWORK",
        },
      })
      createdReworkWipUnitId = reworkChild.id

      movements.push(
        {
          tenantId,
          siteId,
          wipUnitId: input.wipUnitId,
          relatedWipUnitId: reworkChild.id,
          movementType: "REWORK",
          qty: reworkQty,
          sourceType: "OutsourcingInspection",
          sourceId: orderItem.id,
          note: `외주검사 재외주 대상: ${orderItem.purchaseOrder.orderNo}${input.note ? ` - ${input.note}` : ""} (재외주=${reworkQty})`,
        },
        {
          tenantId,
          siteId,
          wipUnitId: input.wipUnitId,
          relatedWipUnitId: reworkChild.id,
          movementType: "SPLIT",
          qty: reworkQty,
          sourceType: "OutsourcingInspection",
          sourceId: orderItem.id,
          note: `외주검사 재외주 수량 분리 (reworkQty=${reworkQty})`,
        }
      )
    }

    await tx.wipMovement.createMany({ data: movements })
    await recordAuditLog(tx, {
      tenantId,
      actor,
      entityType: "WipMovement",
      entityId: input.wipUnitId,
      action: "UPDATE",
      afterData: {
        movementType: "OutsourcingInspection",
        wipUnitId: input.wipUnitId,
        purchaseOrderId: orderItem.purchaseOrder.id,
        purchaseOrderItemId: orderItem.id,
        acceptedQty,
        defectQty,
        reworkQty,
        createdDefectWipUnitId,
        createdReworkWipUnitId,
      },
      menuName: "외주관리",
    })
  })

  revalidatePath("/app/mes/production/outsourcing")
  revalidatePath("/app/mes/production/wip-inventory")
  revalidatePath("/app/mes/manufacturing-traceability")

  return {
    success: true,
    updatedWipUnitId: input.wipUnitId,
    createdDefectWipUnitId,
    createdReworkWipUnitId,
    message: `검사처리 완료: 합격 ${acceptedQty}, 불량 ${defectQty}, 재외주 ${reworkQty}`,
  }
}

// ─── 조회 ─────────────────────────────────────────────────────────────────────

export async function getOutsourcingData(
  filter: OutsourcingFilter = {}
): Promise<OutsourcingData> {
  const tenantId = await getTenantId()
  const now = new Date()

  const from = filter.from ? new Date(`${filter.from}T00:00:00.000`) : undefined
  const to = filter.to ? new Date(`${filter.to}T23:59:59.999`) : undefined

  // ── 발주 목록 (외주발주만 필터링: OS- 접두어 또는 [OUTSOURCING] 태그) ───────
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      tenantId,
      OR: [
        { orderNo: { startsWith: "OS-" } },
        { note: { contains: "[OUTSOURCING]" } },
      ],
      ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(from || to
        ? { orderDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        select: {
          id: true,
          qty: true,
          receivedQty: true,
          unitPrice: true,
          item: { select: { code: true, name: true } },
          workOrderOperation: {
            select: {
              seq: true,
              routingOperation: { select: { name: true } },
              workOrder: { select: { orderNo: true } },
            },
          },
        },
      },
    },
    orderBy: { orderDate: "desc" },
  })

  const orderRows: OutsourcingOrderRow[] = orders.map((o) => {
    const totalQty = o.items.reduce((s, i) => s + Number(i.qty), 0)
    const totalReceivedQty = o.items.reduce((s, i) => s + Number(i.receivedQty), 0)
    const calculatedAmount = o.items.reduce(
      (sum, item) => sum + Number(item.qty) * Number(item.unitPrice),
      0
    )
    const firstItem = o.items[0]?.item
    const firstLinkedOperation = o.items.find((item) => item.workOrderOperation)?.workOrderOperation ?? null
    const itemSummary = firstItem
      ? o.items.length > 1
        ? `${firstItem.name} 외 ${o.items.length - 1}건`
        : firstItem.name
      : "-"
    const totalAmount =
      o.totalAmount !== null ? Number(o.totalAmount) : Math.round(calculatedAmount)
    const isOverdue =
      (o.status === "ORDERED" || o.status === "PARTIAL_RECEIVED") &&
      o.expectedDate < now
    return {
      id: o.id,
      orderNo: o.orderNo,
      orderDate: o.orderDate.toISOString(),
      expectedDate: o.expectedDate.toISOString(),
      supplierName: o.supplier.name,
      supplierId: o.supplier.id,
      status: o.status,
      totalAmount,
      itemCount: o.items.length,
      itemSummary,
      firstItemCode: firstItem?.code ?? null,
      totalQty: Math.round(totalQty * 100) / 100,
      totalReceivedQty: Math.round(totalReceivedQty * 100) / 100,
      workOrderNo: firstLinkedOperation?.workOrder.orderNo ?? null,
      operationName: firstLinkedOperation?.routingOperation.name ?? null,
      operationSeq: firstLinkedOperation?.seq ?? null,
      isOverdue,
      note: o.note,
    }
  })

  // ── 입고 이력 (외주발주 기반, OS- 또는 [OUTSOURCING] 태그) ─────────────────
  const receivings = await prisma.receivingInspection.findMany({
    where: {
      purchaseOrderItem: {
        purchaseOrder: {
          tenantId,
          OR: [
            { orderNo: { startsWith: "OS-" } },
            { note: { contains: "[OUTSOURCING]" } },
          ],
          ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
        },
      },
      ...(from || to
        ? {
            inspectedAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    include: {
      purchaseOrderItem: {
        include: {
          item: { select: { code: true, name: true } },
          workOrderOperation: {
            select: {
              seq: true,
              routingOperation: { select: { name: true } },
              workOrder: { select: { orderNo: true } },
            },
          },
          purchaseOrder: {
            select: { orderNo: true, supplier: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { inspectedAt: "desc" },
    take: 200,
  })

  const receivingRows: OutsourcingReceivingRow[] = receivings.map((r) => ({
    id: r.id,
    inspectedAt: r.inspectedAt.toISOString(),
    orderNo: r.purchaseOrderItem.purchaseOrder.orderNo,
    supplierName: r.purchaseOrderItem.purchaseOrder.supplier.name,
    workOrderNo: r.purchaseOrderItem.workOrderOperation?.workOrder.orderNo ?? null,
    operationName: r.purchaseOrderItem.workOrderOperation?.routingOperation.name ?? null,
    operationSeq: r.purchaseOrderItem.workOrderOperation?.seq ?? null,
    itemCode: r.purchaseOrderItem.item.code,
    itemName: r.purchaseOrderItem.item.name,
    receivedQty: Number(r.receivedQty),
    acceptedQty: Number(r.acceptedQty),
    rejectedQty: Number(r.rejectedQty),
    result: r.result,
  }))

  // ── 공급처 목록 ───────────────────────────────────────────────────────────────
  const partners = await prisma.businessPartner.findMany({
    where: { tenantId, partnerType: { in: ["SUPPLIER", "BOTH"] }, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  // ── 외주 중인 WipUnit (OUTSOURCED: 외주진행중, RECEIVED: 입고검사대기) ────────
  const outsourcedWipUnits = await prisma.wipUnit.findMany({
    where: {
      tenantId,
      status: { in: ["OUTSOURCED", "RECEIVED"] },
    },
    include: {
      item: { select: { code: true, name: true } },
      outsourcingPartner: { select: { name: true } },
      workOrder: { select: { orderNo: true } },
      workOrderOperation: { include: { routingOperation: { select: { name: true } } } },
      movements: {
        where: { movementType: "OUTSOURCED", sourceType: "PurchaseOrderItem" },
        select: {
          sourceId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  })

  const wipUnitRows: OutsourcingWipUnitRow[] = outsourcedWipUnits.map((w) => ({
    id: w.id,
    mfgNo: w.manufacturingNo || "-",
    workOrderNo: w.workOrder?.orderNo ?? null,
    outsourcingOrderNo: null,
    outsourcingOrderItemId: w.movements[0]?.sourceId ?? null,
    itemCode: w.item.code,
    itemName: w.item.name,
    qty: Number(w.qty),
    partnerName: w.outsourcingPartner?.name || "-",
    processName: `${w.workOrderOperation.seq}. ${w.workOrderOperation.routingOperation.name}`,
    wipStatus: w.status as "OUTSOURCED" | "RECEIVED",
  }))

  // ── 출고 가능한 WipUnit (IN_PROCESS / WAITING / REWORK) ─────────────────────
  const availableWipUnitsData = await prisma.wipUnit.findMany({
    where: {
      tenantId,
      status: { in: ["IN_PROCESS", "WAITING", "REWORK"] },
    },
    include: {
      item: { select: { code: true, name: true } },
      workOrder: { select: { orderNo: true } },
      workOrderOperation: { select: { seq: true, routingOperation: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  })

  const availableWipUnitRows: OutsourcingAvailableWipUnitRow[] = availableWipUnitsData.map((w) => ({
    id: w.id,
    mfgNo: w.manufacturingNo || "-",
    itemCode: w.item.code,
    itemName: w.item.name,
    qty: Number(w.qty),
    workOrderNo: w.workOrder?.orderNo || "-",
    operationSeq: w.workOrderOperation.seq,
    wipStatus: w.status as "IN_PROCESS" | "WAITING" | "REWORK",
    parentWipUnitId: w.parentWipUnitId,
  }))

  // ── 외주입고 이력 (WipMovement RETURNED) ─────────────────────────────────────
  const wipReceivingHistoryData = await prisma.wipMovement.findMany({
    where: {
      tenantId,
      movementType: "RETURNED",
    },
    include: {
      wipUnit: {
        include: {
          item: { select: { code: true, name: true } },
          workOrder: { select: { orderNo: true } },
        },
      },
      fromPartner: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  })

  const outsourcingOrderItemIds = Array.from(
    new Set([
      ...outsourcedWipUnits.map((w) => w.movements[0]?.sourceId).filter((id): id is string => Boolean(id)),
      ...wipReceivingHistoryData.map((m) => m.sourceType === "PurchaseOrderItem" ? m.sourceId : null).filter((id): id is string => Boolean(id)),
    ])
  )
  const outsourcingOrderItems = outsourcingOrderItemIds.length > 0
    ? await prisma.purchaseOrderItem.findMany({
        where: { id: { in: outsourcingOrderItemIds }, purchaseOrder: { tenantId } },
        include: { purchaseOrder: { select: { orderNo: true } } },
      })
    : []
  const outsourcingOrderItemById = new Map(outsourcingOrderItems.map((item) => [item.id, item]))
  for (const row of wipUnitRows) {
    if (!row.outsourcingOrderItemId) continue
    row.outsourcingOrderNo = outsourcingOrderItemById.get(row.outsourcingOrderItemId)?.purchaseOrder.orderNo ?? null
  }

  const wipReceivingHistoryRows: OutsourcingWipReceivingRow[] = wipReceivingHistoryData.map((m) => ({
    id: m.id,
    createdAt: m.createdAt.toISOString(),
    mfgNo: m.wipUnit.manufacturingNo || "-",
    workOrderNo: m.wipUnit.workOrder?.orderNo ?? null,
    outsourcingOrderNo: m.sourceType === "PurchaseOrderItem" && m.sourceId ? outsourcingOrderItemById.get(m.sourceId)?.purchaseOrder.orderNo ?? null : null,
    outsourcingOrderItemId: m.sourceType === "PurchaseOrderItem" ? m.sourceId : null,
    itemCode: m.wipUnit.item.code,
    itemName: m.wipUnit.item.name,
    qty: Number(m.qty),
    partnerName: m.fromPartner?.name || "-",
    note: m.note,
  }))

  // ── 최근 외주공정명 (datalist 후보용) ─────────────────────────────────────────
  const recentProcessNames = Array.from(
    new Set(
      orders
        .map((o) => {
          if (!o.note) return null
          const match = o.note.match(/\[OUTSOURCING\] ([^\n]+)/)
          return match ? match[1].trim() : null
        })
        .filter((n): n is string => n !== null)
    )
  ).slice(0, 10)

  // ── 요약 ─────────────────────────────────────────────────────────────────────
  const pendingOrders = orderRows.filter(
    (o) => o.status === "DRAFT" || o.status === "ORDERED"
  ).length
  const partialReceived = orderRows.filter((o) => o.status === "PARTIAL_RECEIVED").length
  const completed = orderRows.filter(
    (o) => o.status === "RECEIVED" || o.status === "CLOSED"
  ).length
  const overdue = orderRows.filter((o) => o.isOverdue).length

  return {
    filter,
    summary: {
      totalOrders: orderRows.length,
      pendingOrders,
      partialReceived,
      completed,
      overdue,
    },
    orders: orderRows,
    receivings: receivingRows,
    wipUnits: wipUnitRows,
    availableWipUnits: availableWipUnitRows,
    wipReceivingHistory: wipReceivingHistoryRows,
    partners: partners.map((p) => ({ id: p.id, name: p.name })),
    recentProcessNames,
  }
}
