"use server"

import { getTenantId, requireRole } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { generateCnsMaterialReceiptLotNo } from "@/lib/lot-numbering/lot-number-generator"
import { computeNextMaterialReceiptLotNo } from "@/lib/lot-numbering/lot-reservation"
import type { CnsItemRuleContext } from "@/lib/lot-numbering/lot-rule-resolver"
import { Prisma, ReceivingInspectionResult } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { lockPurchaseOrderItemsForUpdate } from "@/lib/quantity-concurrency"
import { recordAuditLog } from "@/lib/audit-log"
import { BUSINESS_NUMBER_MAX_ATTEMPTS, isUniqueConstraintError, kstDateParts } from "@/lib/business-numbering"

export type CreateReceivingInspectionInput = {
  purchaseOrderItemId: string
  purchaseOrderId: string
  warehouseId: string          // 사용자가 명시적으로 선택한 창고
  siteId: string               // PO의 사이트 (서버 검증용)
  inspectorId?: string
  receivedQty: number
  acceptedQty: number
  rejectedQty: number
  result: ReceivingInspectionResult
  note?: string
  lotNo?: string               // 입력 시 해당 LOT 사용, 미입력 + isLotTracked 시 자동생성
  lotReservationId?: string    // 자동채번 미리보기(reserveReceivingLotNumber)로 발급받은 예약 id
  // 하위 호환용 (무시됨)
  tenantId?: string
}

/** 특정 사이트에 속한 창고 목록 조회 (다이얼로그 창고 선택용) */
export async function getWarehousesForSite(siteId: string) {
  const tenantId = await getTenantId()
  return prisma.warehouse.findMany({
    where: { siteId, tenantId },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  })
}

/** 원자재 LOT 번호 자동생성 헬퍼.
 * CNS quick rule: YY + month letter(A-L) + DD + "-" + daily sequence.
 * 수동 LOT 입력은 createReceivingInspection에서 우선 처리한다.
 */
export async function generateReceivingLotNo(
  tenantId: string,
  itemContext: CnsItemRuleContext = {},
  sequenceOffset = 0,
): Promise<string> {
  return generateCnsMaterialReceiptLotNo(prisma, tenantId, itemContext, new Date(), sequenceOffset)
}

const AUTO_LOT_COLLISION = "AUTO_LOT_COLLISION"

async function generateTxNo(tenantId: string): Promise<string> {
  const { yyyymmdd: ymd } = kstDateParts()
  const prefix = `RCV-${ymd}-`
  const last = await prisma.inventoryTransaction.findFirst({
    where: { tenantId, txNo: { startsWith: prefix } },
    orderBy: { txNo: "desc" },
    select: { txNo: true },
  })
  const seq = last ? (parseInt(last.txNo.split("-")[2] ?? "0", 10) || 0) + 1 : 1
  return `${prefix}${String(seq).padStart(4, "0")}`
}

export async function createReceivingInspection(
  data: CreateReceivingInspectionInput,
): Promise<{ success: boolean; message?: string }> {
  await requireResourcePermission("PURCHASE_ORDER", "CREATE")
  try {
    return await createReceivingInspectionInternal(data)
  } catch (error) {
    // Next.js는 프로덕션에서 Server Action이 throw한 에러 메시지를 자동으로
    // 지우므로(보안상 기본 동작), 여기서 잡아 메시지를 그대로 반환값에 담아
    // 클라이언트가 실제 원인을 표시할 수 있게 한다.
    console.error("[createReceivingInspection] error:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "입고 처리 중 오류가 발생했습니다.",
    }
  }
}

async function createReceivingInspectionInternal(
  data: CreateReceivingInspectionInput,
): Promise<{ success: boolean; message?: string }> {
  const user = await requireRole("OPERATOR")
  const tenantId = user.tenantId

  // ── 1. 창고 존재 및 테넌트 소속 확인 ──────────────────────────────────────
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: data.warehouseId, tenantId },
  })
  if (!warehouse) {
    throw new Error("선택한 창고를 찾을 수 없습니다.")
  }

  // ── 2. PO 품목 조회 (isLotTracked 포함) 및 사이트-창고 정합성 검증 ────────
  const purchaseOrderItem = await prisma.purchaseOrderItem.findUniqueOrThrow({
    where: { id: data.purchaseOrderItemId },
    include: {
      purchaseOrder: { select: { siteId: true } },
      item: {
        select: {
          code: true,
          itemType: true,
          lotNumberingType: true,
          lotPrefix: true,
          manualLotPolicy: true,
          isLotTracked: true,
          uom: true,
          itemGroup: { select: { code: true } },
          category: { select: { code: true } },
        },
      },
    },
  })

  const poSiteId = purchaseOrderItem.purchaseOrder.siteId
  if (warehouse.siteId !== poSiteId) {
    throw new Error(
      `입고 창고의 사이트가 발주 사이트와 다릅니다. ` +
      `창고는 반드시 발주의 사이트에 속해야 합니다.`
    )
  }

  // ── 2-A. 수량 검증 (DB 기준 재계산) ──────────────────────────────────────
  const orderedQty = Number(purchaseOrderItem.qty)
  const alreadyReceivedQty = Number(purchaseOrderItem.receivedQty)
  const remainingQty = orderedQty - alreadyReceivedQty
  const uom = purchaseOrderItem.item.uom

  if (data.receivedQty <= 0) {
    throw new Error("입고수량은 0보다 커야 합니다.")
  }
  if (data.receivedQty > remainingQty) {
    throw new Error(
      `입고수량은 잔여수량을 초과할 수 없습니다. 잔여수량: ${remainingQty.toLocaleString("ko-KR")} ${uom}`
    )
  }
  if (data.acceptedQty < 0 || data.rejectedQty < 0) {
    throw new Error("합격수량과 불합격수량은 0 이상이어야 합니다.")
  }
  if (Math.abs(data.acceptedQty + data.rejectedQty - data.receivedQty) > 0.001) {
    throw new Error("합격수량과 불합격수량의 합은 금회 입고수량과 같아야 합니다.")
  }

  const isLotTracked = purchaseOrderItem.item.isLotTracked ?? false

  // ── 3. LOT 번호 결정 ───────────────────────────────────────────────────────
  // isLotTracked=false → 입력값 무시, 항상 null (비LOT 출고 흐름 보존)
  // isLotTracked=true  → 아래 4가지 모드 중 하나
  //   RESERVED: 자동채번 미리보기(lotReservationId)로 확정된 번호 그대로 사용
  //   MANUAL:   공급사 LOT 직접 입력
  //   AUTO:     미입력(또는 DISABLED 정책) → 입고 확정 시 서버가 즉시 채번
  //   NONE:     비LOT 품목
  const manualLotNo = isLotTracked ? data.lotNo?.trim() || null : null
  const manualLotPolicy = purchaseOrderItem.item.manualLotPolicy ?? "ALLOWED"
  const lotNumberingType = purchaseOrderItem.item.lotNumberingType ?? "DEFAULT"
  const shouldIgnoreManualLotNo = manualLotPolicy === "DISABLED"
  if (isLotTracked && (lotNumberingType === "MANUAL" || manualLotPolicy === "REQUIRED") && !manualLotNo) {
    throw new Error("LOT 번호를 직접 입력해야 하는 품목입니다.")
  }

  type LotResolutionMode = "NONE" | "AUTO" | "MANUAL" | "RESERVED"
  let lotResolutionMode: LotResolutionMode
  if (!isLotTracked) {
    lotResolutionMode = "NONE"
  } else if (data.lotReservationId) {
    // 유효한 예약(자동채번 미리보기)이 있으면 정책(ALLOWED/DISABLED)과 무관하게 그 번호를 그대로 사용한다.
    // reserveReceivingLotNumber 자체가 REQUIRED/MANUAL 품목에는 예약 발급을 거부하므로 안전하다.
    // 이미 라벨이 출력됐을 수 있으므로 미리보기 번호와 실제 저장 번호가 달라지면 안 된다.
    lotResolutionMode = "RESERVED"
  } else if (shouldIgnoreManualLotNo) {
    // DISABLED 정책 + 예약 미사용 → 입력값과 무관하게 서버가 즉시 자동 발행한다.
    lotResolutionMode = "AUTO"
  } else if (manualLotNo) {
    lotResolutionMode = "MANUAL"
  } else {
    lotResolutionMode = "AUTO"
  }

  const itemRuleContext: CnsItemRuleContext = {
    itemCode: purchaseOrderItem.item.code,
    itemGroupCode: purchaseOrderItem.item.itemGroup?.code,
    itemCategoryCode: purchaseOrderItem.item.category?.code,
    itemType: purchaseOrderItem.item.itemType,
    lotNumberingType,
    lotPrefix: purchaseOrderItem.item.lotPrefix,
    manualLotPolicy,
  }
  // txNo 사전 생성 (트랜잭션 외부 - 기존 패턴 유지)
  // ── 4. 트랜잭션 처리 ───────────────────────────────────────────────────────
  // AUTO만 충돌 시 재시도(최대 5회). RESERVED/MANUAL/NONE은 재시도 없이 그대로 확정하거나 실패시킨다.
  //
  // AUTO 경로도 LotNumberReservation을 "단일 발행 원장"으로 사용한다: 번호를 계산한 뒤 곧바로
  // 같은 트랜잭션 안에서 CONSUMED 상태로 예약 행을 만들어(=원자적 클레임) Lot을 생성한다.
  // 이렇게 하면 자동채번 미리보기(RESERVED)와 버튼 미사용 AUTO 확정이 서로 다른 트랜잭션에서
  // 동시에 실행되어도, 두 경로 모두 같은 테이블의 (tenantId, lotNo) unique 제약을 통해서만
  // 번호를 "소유"할 수 있으므로 Lot 테이블과 예약 테이블 사이의 경합이 사라진다.
  const maxAttempts = data.acceptedQty > 0 || lotResolutionMode === "AUTO" ? BUSINESS_NUMBER_MAX_ATTEMPTS : 1
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const txNo = data.acceptedQty > 0 ? await generateTxNo(tenantId) : null
    try {
      await prisma.$transaction(async (tx) => {
        await lockPurchaseOrderItemsForUpdate(tx, tenantId, [data.purchaseOrderItemId])
        const lockedPurchaseOrderItem = await tx.purchaseOrderItem.findFirst({
          where: {
            id: data.purchaseOrderItemId,
            purchaseOrder: { tenantId },
          },
          select: {
            qty: true,
            receivedQty: true,
            item: { select: { uom: true } },
          },
        })
        if (!lockedPurchaseOrderItem) {
          throw new Error("발주 품목을 찾을 수 없습니다.")
        }
        const lockedRemainingQty =
          Number(lockedPurchaseOrderItem.qty) - Number(lockedPurchaseOrderItem.receivedQty)
        if (data.receivedQty > lockedRemainingQty) {
          throw new Error(
            `입고수량은 잔여수량을 초과할 수 없습니다. 잔여수량: ${lockedRemainingQty.toLocaleString("ko-KR")} ${lockedPurchaseOrderItem.item.uom}`
          )
        }

        let consumedReservationId: string | null = null
        let resolvedLotNo: string | null = null

    // 4-0. 자동채번 미리보기(RESERVED) 검증 — 예약이 유효할 때만 그 번호를 그대로 사용한다.
    //      임의로 다른 순번을 대신 발행하지 않는다: 이미 라벨이 출력됐을 수 있기 때문.
    if (lotResolutionMode === "RESERVED") {
      resolvedLotNo = manualLotNo
      const reservation = await tx.lotNumberReservation.findFirst({
        where: { id: data.lotReservationId!, tenantId },
      })
      if (
        !reservation ||
        reservation.itemId !== purchaseOrderItem.itemId ||
        reservation.purchaseOrderItemId !== data.purchaseOrderItemId ||
        reservation.lotNo !== resolvedLotNo
      ) {
        throw new Error("자동채번 예약이 만료되었습니다. 다시 자동채번한 후 라벨을 출력해주세요.")
      }
      if (reservation.status === "RESERVED" && reservation.expiresAt < new Date()) {
        // lazy expiration: 검증 시점에 만료가 확인되면 그 자리에서 정리한다.
        //   - 라벨 미출력: 행 삭제(번호 재사용 가능) / 라벨 출력됨: EXPIRED로 남김(번호 영구 재사용 금지)
        if (reservation.printedAt) {
          await tx.lotNumberReservation.update({
            where: { id: reservation.id },
            data: { status: "EXPIRED" },
          })
        } else {
          await tx.lotNumberReservation.delete({ where: { id: reservation.id } })
        }
        throw new Error("자동채번 예약이 만료되었습니다. 다시 자동채번한 후 라벨을 출력해주세요.")
      }
      if (reservation.status !== "RESERVED") {
        throw new Error("자동채번 예약이 만료되었습니다. 다시 자동채번한 후 라벨을 출력해주세요.")
      }
      consumedReservationId = reservation.id
    }

    // 4-0-B. MANUAL: 다른 발주품목이 예약(RESERVED, 미만료) 중인 번호를 그대로 수동입력하면 차단
    if (lotResolutionMode === "MANUAL") {
      resolvedLotNo = manualLotNo
      const conflictingReservation = await tx.lotNumberReservation.findFirst({
        where: {
          tenantId,
          lotNo: resolvedLotNo!,
          status: "RESERVED",
          purchaseOrderItemId: { not: data.purchaseOrderItemId },
        },
      })
      if (conflictingReservation && conflictingReservation.expiresAt > new Date()) {
        throw new Error(
          `LOT 번호 '${resolvedLotNo}'는 다른 입고 건에 예약되어 있습니다. 잠시 후 다시 시도해주세요.`
        )
      }
    }

    // 4-0-C. AUTO: 번호 계산과 "예약 원장에 CONSUMED로 즉시 클레임"을 같은 트랜잭션에서 원자적으로 수행.
    //        claim insert가 unique 충돌(P2002)나면 트랜잭션 전체가 롤백되고 바깥 루프가 다음 attempt로 재시도한다.
    if (lotResolutionMode === "AUTO") {
      resolvedLotNo = await computeNextMaterialReceiptLotNo(tx, tenantId, itemRuleContext, new Date(), attempt)
      const claimed = await tx.lotNumberReservation.create({
        data: {
          tenantId,
          itemId: purchaseOrderItem.itemId,
          purchaseOrderId: data.purchaseOrderId,
          purchaseOrderItemId: data.purchaseOrderItemId,
          lotNo: resolvedLotNo,
          status: "CONSUMED",
          reservedBy: user.id,
          expiresAt: new Date(),
          consumedAt: new Date(),
        },
      })
      consumedReservationId = claimed.id
    }

    // 4-1. LOT 조회 또는 생성
    let lotId: string | null = null
    if (resolvedLotNo) {
      const existingLot = await tx.lot.findFirst({
        where: { tenantId, lotNo: resolvedLotNo },
      })
      if (existingLot) {
        if (existingLot.itemId !== purchaseOrderItem.itemId) {
          throw new Error(
            `LOT 번호 '${resolvedLotNo}'는 다른 품목에 이미 사용 중입니다. 다른 번호를 입력해주세요.`
          )
        }
        if (lotResolutionMode === "AUTO") {
          throw new Error(AUTO_LOT_COLLISION)
        }
        lotId = existingLot.id
      } else {
        const newLot = await tx.lot.create({
          data: {
            tenantId,
            itemId: purchaseOrderItem.itemId,
            lotNo: resolvedLotNo,
            status: "ACTIVE",
            manufactureDate: new Date(),
          },
        })
        lotId = newLot.id
      }
    }

    // 4-1-B. 예약을 사용했다면 실제 Lot 생성과 같은 트랜잭션에서 CONSUMED 처리
    //        (트랜잭션이 실패하면 이 갱신도 함께 롤백되어 "입고 실패 시 CONSUMED 처리 금지"가 보장된다)
    if (consumedReservationId) {
      await tx.lotNumberReservation.update({
        where: { id: consumedReservationId },
        data: { status: "CONSUMED", consumedAt: new Date() },
      })
    }

    // 4-2. ReceivingInspection 생성
    const inspection = await tx.receivingInspection.create({
      data: {
        purchaseOrderItemId: data.purchaseOrderItemId,
        inspectorId: data.inspectorId ?? null,
        receivedQty: data.receivedQty,
        acceptedQty: data.acceptedQty,
        rejectedQty: data.rejectedQty,
        result: data.result,
        note: data.note,
      },
    })

    // 4-3. PurchaseOrderItem.receivedQty 갱신
    await tx.purchaseOrderItem.update({
      where: { id: data.purchaseOrderItemId },
      data: { receivedQty: { increment: data.acceptedQty } },
    })

    // 4-4. InventoryBalance 갱신 (합격 수량만)
    if (data.acceptedQty > 0) {
      const existingBalance = await tx.inventoryBalance.findFirst({
        where: {
          tenantId,
          itemId: purchaseOrderItem.itemId,
          warehouseId: warehouse.id,
          lotId,
        },
      })
      if (existingBalance) {
        await tx.inventoryBalance.update({
          where: { id: existingBalance.id },
          data: {
            qtyOnHand: { increment: data.acceptedQty },
            qtyAvailable: { increment: data.acceptedQty },
          },
        })
      } else {
        await tx.inventoryBalance.create({
          data: {
            tenantId,
            siteId: warehouse.siteId,
            itemId: purchaseOrderItem.itemId,
            warehouseId: warehouse.id,
            lotId,
            qtyOnHand: data.acceptedQty,
            qtyAvailable: data.acceptedQty,
            qtyHold: 0,
          },
        })
      }

      // 4-5. InventoryTransaction 생성
      await tx.inventoryTransaction.create({
        data: {
          tenantId,
          itemId: purchaseOrderItem.itemId,
          lotId,
          toLocationId: warehouse.id,
          txNo: txNo!,
          txType: "RECEIPT",
          qty: data.acceptedQty,
          refType: "PURCHASE_ORDER",
          refId: data.purchaseOrderId,
          note: resolvedLotNo ? `LOT 입고: ${resolvedLotNo}` : (data.note ?? null),
        },
      })
    }

    // 4-6. PurchaseOrder 상태 갱신
    const allItems = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId: data.purchaseOrderId },
    })
    const fullyReceived = allItems.every((i) => Number(i.receivedQty) >= Number(i.qty))
    if (fullyReceived) {
      await tx.purchaseOrder.update({
        where: { id: data.purchaseOrderId },
        data: { status: "RECEIVED" },
      })
    } else if (allItems.some((i) => Number(i.receivedQty) > 0)) {
      await tx.purchaseOrder.update({
        where: { id: data.purchaseOrderId },
        data: { status: "PARTIAL_RECEIVED" },
      })
    }
    await recordAuditLog(tx, {
      tenantId,
      actor: user,
      entityType: "ReceivingInspection",
      entityId: inspection.id,
      action: "CREATE",
      afterData: {
        purchaseOrderId: data.purchaseOrderId,
        purchaseOrderItemId: data.purchaseOrderItemId,
        itemId: purchaseOrderItem.itemId,
        warehouseId: warehouse.id,
        receivedQty: data.receivedQty,
        acceptedQty: data.acceptedQty,
        rejectedQty: data.rejectedQty,
        result: data.result,
        lotNo: resolvedLotNo,
        txNo,
      },
      menuName: "자재입고",
    })
      })
      break
    } catch (error) {
      const txNoCollision = isUniqueConstraintError(error, ["tenantId", "txNo"])
      const autoLotCollision = lotResolutionMode === "AUTO" &&
        (isUniqueConstraintError(error) ||
          (error instanceof Error && error.message === AUTO_LOT_COLLISION))
      const canRetry = txNoCollision || autoLotCollision

      if (canRetry && attempt < maxAttempts - 1) {
        continue
      }

      if (autoLotCollision) {
        throw new Error("LOT 자동발행 중 번호 충돌이 반복되었습니다. 다시 시도해 주세요.")
      }
      if (txNoCollision) {
        throw new Error("입고거래번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요.")
      }

      throw error
    }
  }

  revalidatePath("/app/mes/purchase-orders")
  revalidatePath("/app/mes/material-receipt")
  revalidatePath("/app/mes/material/stock")
  revalidatePath("/app/mes/inventory-transactions")

  return { success: true }
}
