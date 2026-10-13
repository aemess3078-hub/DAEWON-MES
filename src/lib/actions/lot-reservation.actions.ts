"use server"

import { getTenantId, requireRole } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import {
  computeNextMaterialReceiptLotNo,
  expireStaleReservations,
  releaseOrDeleteReservation,
  LOT_RESERVATION_TTL_MS,
} from "@/lib/lot-numbering/lot-reservation"
import type { CnsItemRuleContext } from "@/lib/lot-numbering/lot-rule-resolver"
import { Prisma } from "@prisma/client"
import { requireResourcePermission } from "@/lib/auth/role-permissions"

const MAX_RESERVE_ATTEMPTS = 5

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

export type ReserveReceivingLotNumberInput = {
  purchaseOrderId: string
  purchaseOrderItemId: string
  /**
   * 재채번 시 기존 예약 id — 서버에서 먼저 정리한 뒤 새로 발행한다.
   * 라벨 미출력이었으면 행을 삭제(번호 재사용 가능), 라벨 출력됐었으면 RELEASED로 남긴다(번호 영구 재사용 금지).
   */
  previousReservationId?: string
}

export type ReserveReceivingLotNumberResult =
  | {
      success: true
      reservationId: string
      lotNo: string
      expiresAt: string
      /** 재채번 대상이었던 이전 예약이 라벨 출력된 상태였으면 true — 클라이언트가 안내 문구를 보여줄 때 사용 */
      previousWasPrinted?: boolean
    }
  | { success: false; message: string }

/** 자재입고 LOT 자동채번 "미리보기" — 실제 Lot을 만들지 않고 번호만 예약해 라벨 선출력을 지원한다. */
export async function reserveReceivingLotNumber(
  input: ReserveReceivingLotNumberInput,
): Promise<ReserveReceivingLotNumberResult> {
  await requireResourcePermission("PURCHASE_ORDER", "CREATE")
  try {
    return await reserveReceivingLotNumberInternal(input)
  } catch (error) {
    console.error("[reserveReceivingLotNumber] error:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "LOT 자동채번 중 오류가 발생했습니다.",
    }
  }
}

async function reserveReceivingLotNumberInternal(
  input: ReserveReceivingLotNumberInput,
): Promise<ReserveReceivingLotNumberResult> {
  const user = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const poItem = await prisma.purchaseOrderItem.findFirst({
    where: { id: input.purchaseOrderItemId, purchaseOrderId: input.purchaseOrderId },
    include: {
      purchaseOrder: { select: { id: true, tenantId: true } },
      item: {
        select: {
          id: true,
          code: true,
          itemType: true,
          isLotTracked: true,
          lotNumberingType: true,
          lotPrefix: true,
          manualLotPolicy: true,
          itemGroup: { select: { code: true } },
          category: { select: { code: true } },
        },
      },
    },
  })

  if (!poItem || poItem.purchaseOrder.tenantId !== tenantId) {
    return { success: false, message: "발주품목을 찾을 수 없습니다." }
  }
  if (!poItem.item.isLotTracked) {
    return { success: false, message: "LOT 관리 품목이 아닙니다." }
  }

  const lotNumberingType = poItem.item.lotNumberingType ?? "DEFAULT"
  const manualLotPolicy = poItem.item.manualLotPolicy ?? "ALLOWED"
  if (lotNumberingType === "MANUAL" || manualLotPolicy === "REQUIRED") {
    return { success: false, message: "이 품목은 LOT 번호를 직접 입력해야 하는 품목입니다." }
  }

  // 새 예약 발급 전 lazy expiration — 만료된 RESERVED를 정리(라벨 미출력이면 삭제, 출력됐으면 EXPIRED 유지)
  await expireStaleReservations(prisma, tenantId)

  // 재채번: 기존 예약을 먼저 정리(같은 tenant·발주품목 소유일 때만 — 타 tenant/타 예약 보호)
  //   - 라벨 미출력: 행 삭제 → 경쟁자가 없다면 같은 번호가 다시 나올 수 있음
  //   - 라벨 출력됨: RELEASED로 남김 → 번호 영구 재사용 금지, 사용자에게 안내 필요
  let previousWasPrinted = false
  if (input.previousReservationId) {
    const result = await releaseOrDeleteReservation(
      prisma,
      input.previousReservationId,
      tenantId,
      input.purchaseOrderItemId,
    )
    previousWasPrinted = result.wasPrinted
  }

  const itemRuleContext: CnsItemRuleContext = {
    itemCode: poItem.item.code,
    itemGroupCode: poItem.item.itemGroup?.code,
    itemCategoryCode: poItem.item.category?.code,
    itemType: poItem.item.itemType,
    lotNumberingType,
    lotPrefix: poItem.item.lotPrefix,
    manualLotPolicy,
  }

  const date = new Date()
  for (let attempt = 0; attempt < MAX_RESERVE_ATTEMPTS; attempt++) {
    const lotNo = await computeNextMaterialReceiptLotNo(prisma, tenantId, itemRuleContext, date, attempt)
    try {
      const expiresAt = new Date(Date.now() + LOT_RESERVATION_TTL_MS)
      const reservation = await prisma.lotNumberReservation.create({
        data: {
          tenantId,
          itemId: poItem.item.id,
          purchaseOrderId: poItem.purchaseOrder.id,
          purchaseOrderItemId: poItem.id,
          lotNo,
          status: "RESERVED",
          reservedBy: user.id,
          expiresAt,
        },
      })
      return {
        success: true,
        reservationId: reservation.id,
        lotNo: reservation.lotNo,
        expiresAt: expiresAt.toISOString(),
        previousWasPrinted,
      }
    } catch (error) {
      if (isUniqueConstraintError(error) && attempt < MAX_RESERVE_ATTEMPTS - 1) continue
      if (isUniqueConstraintError(error)) {
        return { success: false, message: "LOT 자동채번 중 번호 충돌이 반복되었습니다. 다시 시도해 주세요." }
      }
      throw error
    }
  }
  return { success: false, message: "LOT 자동채번에 실패했습니다. 다시 시도해 주세요." }
}

/**
 * 예약 정리(best-effort) — 취소, X 닫기, 수동입력 전환, 발주·품목 변경, 입고수량 0 변경,
 * 다이얼로그 정상 종료 등에서 호출된다. 실패해도 서버의 만료(expiresAt) 정책이 최종 안전망이 되므로
 * 클라이언트는 이 호출의 실패를 무시해도 된다.
 *
 * 라벨 미출력 상태였으면 행을 삭제해 번호를 바로 재사용 가능하게 하고, 라벨 출력됐었으면
 * RELEASED로 남겨 번호를 영구히 재사용하지 않는다.
 */
export async function releaseLotReservation(input: {
  reservationId: string
}): Promise<{ success: boolean }> {
  await requireResourcePermission("PURCHASE_ORDER", "CREATE")
  try {
    await requireRole("OPERATOR")
    const tenantId = await getTenantId()
    await releaseOrDeleteReservation(prisma, input.reservationId, tenantId)
    return { success: true }
  } catch (error) {
    console.error("[releaseLotReservation] error:", error)
    return { success: false }
  }
}

export type MarkLotReservationPrintedResult =
  | { success: true }
  | { success: false; message: string }

/**
 * 바코드 라벨을 실제로 출력하기 직전에 호출 — 예약을 "출력됨"으로 확정한다.
 * 이 호출이 성공한 뒤에만 클라이언트가 라벨 다이얼로그를 열어야 한다.
 * 출력이 확정된 예약은 이후 취소/재채번/만료되어도 번호가 영구히 재사용되지 않는다.
 * 이미 printedAt이 설정된 예약을 다시 호출해도 안전(idempotent)하다.
 */
export async function markLotReservationPrinted(input: {
  reservationId: string
  purchaseOrderItemId: string
}): Promise<MarkLotReservationPrintedResult> {
  await requireResourcePermission("PURCHASE_ORDER", "CREATE")
  try {
    await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const reservation = await prisma.lotNumberReservation.findFirst({
      where: {
        id: input.reservationId,
        tenantId,
        purchaseOrderItemId: input.purchaseOrderItemId,
      },
    })

    if (!reservation) {
      return { success: false, message: "자동채번 예약을 찾을 수 없습니다. 다시 자동채번한 후 라벨을 출력해주세요." }
    }
    if (reservation.status === "CONSUMED") {
      // 이미 입고 확정까지 끝난 예약(정상적으로는 여기까지 오지 않지만 방어적으로 허용)
      return { success: true }
    }
    if (reservation.status !== "RESERVED") {
      return { success: false, message: "자동채번 예약이 만료되었습니다. 다시 자동채번한 후 라벨을 출력해주세요." }
    }
    if (reservation.expiresAt < new Date()) {
      if (reservation.printedAt) {
        await prisma.lotNumberReservation.update({ where: { id: reservation.id }, data: { status: "EXPIRED" } })
      } else {
        await prisma.lotNumberReservation.delete({ where: { id: reservation.id } })
      }
      return { success: false, message: "자동채번 예약이 만료되었습니다. 다시 자동채번한 후 라벨을 출력해주세요." }
    }

    if (!reservation.printedAt) {
      await prisma.lotNumberReservation.update({
        where: { id: reservation.id },
        data: { printedAt: new Date() },
      })
    }
    return { success: true }
  } catch (error) {
    console.error("[markLotReservationPrinted] error:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "라벨 출력 확정 중 오류가 발생했습니다.",
    }
  }
}
