"use server"

/**
 * 출하예정 등록 화면의 "QR 스캔으로 완제품 LOT 선택" 보조 조회 — 읽기 전용.
 *
 * 원칙
 *  - QR 에서 읽은 LOT 번호는 신뢰할 수 없는 외부 입력이다. 로그인·tenant(세션 기준)·창고·LOT 존재·품목 일치·LOT 상태·품질 출하 제한·가용재고를 서버가 확인한다.
 *  - 쓰기가 전혀 없다: 재고/예약/출하/수주/감사 이력을 바꾸지 않는다. 출하예정 등록(createShipment)과 출하 확정(confirmShipment)은
 *    사용자의 클릭으로만 수행하며, 그때 재고·수량·권한을 입력 방식(QR/수동)과 무관하게 다시 검증한다.
 *  - 접근 기준은 수동 선택 목록(getAvailableFinishedGoodsLots)과 같다 — 로그인(VIEWER 이상)·세션 tenant. 새 권한/업무 제한을 만들지 않는다.
 *  - 선택 후보는 수동 선택 UI 와 같은 조회(getAvailableFinishedGoodsLots: 출하 창고의 ACTIVE LOT, 가용 − 출하예정 예약 > 0)에서 나온다 — 새 재고 계산을 만들지 않는다.
 *  - 출하는 한 번에 하나의 창고만 쓰므로(화면에서 선택) 창고가 정해져 있다. 다른 창고의 LOT 는 자동 전환하지 않고 거부한다.
 *  - 다른 tenant 의 LOT/없는 LOT 는 같은 메시지로 응답해 존재 여부를 노출하지 않는다.
 *  - QR 에는 LOT 번호만 있다. 원자재/완제품은 QR 로 구분하지 않고 여기서 실제 품목으로 확인한다.
 */

import { prisma } from "@/lib/db/prisma"
import { requireRole } from "@/lib/auth"
import { encodeLotQr } from "@/lib/qr/lot-qr"
import { assertLotQualityReleaseAllowed } from "@/lib/actions/quality-release-gate.helpers"
import { getAvailableFinishedGoodsLots, type AvailableFinishedGoodsLot } from "@/lib/actions/shipment.actions"
import { SHIPMENT_LOT_LOOKUP_MESSAGES, type ShipmentLotLookupFailCode } from "@/lib/shipment/fg-lot-scan"

export type ShipmentLotLookupResult =
  | {
      ok: true
      itemId: string
      itemCode: string
      itemName: string
      lotId: string
      lotNo: string
      /** 수동 선택 목록(getAvailableFinishedGoodsLots)의 같은 LOT 행 */
      lot: AvailableFinishedGoodsLot
    }
  | { ok: false; code: ShipmentLotLookupFailCode; message: string }

function fail(code: ShipmentLotLookupFailCode, message?: string): ShipmentLotLookupResult {
  return { ok: false, code, message: message ?? SHIPMENT_LOT_LOOKUP_MESSAGES[code] }
}

/** 품질 출하 제한(assertLotQualityReleaseAllowed)이 던지는 안내 문구인지. 그 외 오류(DB 등)는 숨기지 않고 다시 던진다. */
function isQualityReleaseMessage(error: unknown): error is Error {
  return error instanceof Error && /최종검사/.test(error.message)
}

/**
 * 스캔한 LOT 번호로 "이 출하 품목의, 선택한 출하 창고에서 출하예정 등록에 선택 가능한 완제품 LOT"를 조회한다(읽기 전용).
 * 검증 순서: 로그인/tenant → 입력 → 창고(tenant 소유) → LOT 존재(tenant) → 품목 일치 → LOT 상태 → 품질 출하 제한 → 창고별 가용재고.
 */
export async function lookupLotForShipment(input: { warehouseId: string; itemId: string; lotNo: string }): Promise<ShipmentLotLookupResult> {
  let tenantId: string
  try {
    tenantId = (await requireRole("VIEWER")).tenantId // getAvailableFinishedGoodsLots 와 같은 로그인·권한 기준, tenant 는 세션 값
  } catch (error) {
    return fail(error instanceof Error && error.message === "FORBIDDEN" ? "DENIED" : "UNAUTHORIZED")
  }

  const warehouseId = typeof input?.warehouseId === "string" ? input.warehouseId.trim() : ""
  const itemId = typeof input?.itemId === "string" ? input.itemId.trim() : ""
  const lotNo = typeof input?.lotNo === "string" ? input.lotNo.trim() : ""
  if (!warehouseId) return fail("WAREHOUSE_NOT_FOUND")
  if (!itemId) return fail("ITEM_MISMATCH")
  try {
    encodeLotQr(lotNo) // 빈 값·제어문자·길이 초과 거부(QR 규격과 같은 기준)
  } catch {
    return fail("INVALID")
  }

  const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, tenantId }, select: { id: true } })
  if (!warehouse) return fail("WAREHOUSE_NOT_FOUND")

  const lot = await prisma.lot.findFirst({
    where: { tenantId, lotNo },
    select: {
      id: true,
      lotNo: true,
      status: true,
      itemId: true,
      item: { select: { id: true, code: true, name: true, itemType: true } },
    },
  })
  if (!lot) return fail("LOT_NOT_FOUND") // 다른 tenant 의 LOT 도 같은 응답

  if (lot.itemId !== itemId) {
    const itemType = String(lot.item.itemType)
    return fail(itemType === "RAW_MATERIAL" || itemType === "CONSUMABLE" ? "NOT_FINISHED_GOODS" : "ITEM_MISMATCH", undefined)
  }

  // 수동 선택 목록·출하예정 등록과 같은 규칙: ACTIVE LOT 만
  if (lot.status !== "ACTIVE") return fail("LOT_RESTRICTED")

  // 출하예정 등록(createShipment)과 같은 품질 출하 제한 — 등록 시 거부될 LOT 를 미리 알려 준다
  try {
    await assertLotQualityReleaseAllowed(prisma, { tenantId, lotId: lot.id })
  } catch (error) {
    if (isQualityReleaseMessage(error)) return fail("QUALITY_HOLD", error.message)
    throw error
  }

  // 수동 선택 UI 와 같은 조회 재사용 — 출하 창고의 가용(미예약) LOT 목록
  const available = await getAvailableFinishedGoodsLots(tenantId, warehouseId, [lot.itemId])
  const matches = (available.lotsByItem[lot.itemId] ?? []).filter((row) => row.lotId === lot.id)
  if (matches.length === 0) {
    const elsewhere = await prisma.inventoryBalance.findFirst({
      where: { tenantId, itemId: lot.itemId, lotId: lot.id, warehouseId: { not: warehouseId }, qtyAvailable: { gt: 0 } },
      select: { id: true },
    })
    return fail(elsewhere ? "OTHER_WAREHOUSE" : "NO_STOCK")
  }
  if (matches.length > 1) return fail("AMBIGUOUS")

  return { ok: true, itemId: lot.itemId, itemCode: lot.item.code, itemName: lot.item.name, lotId: lot.id, lotNo: lot.lotNo, lot: matches[0] }
}
