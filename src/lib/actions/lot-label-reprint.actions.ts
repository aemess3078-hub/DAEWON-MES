"use server"

/**
 * LOT/Serial 관리 화면 [라벨 출력] 지원 — 이미 등록된 LOT 의 라벨 데이터를 서버 저장값으로 조회한다(읽기 전용).
 *
 *  - 입고 처리·재고·수불·LOT 상태·번호 채번은 건드리지 않는다. 이 액션은 아무것도 쓰지 않는다.
 *    (최초/재출력 판정과 감사 기록은 기존 checkLotLabelPrintable / recordLotLabelPrint 가 인쇄 시점에 한다.)
 *  - 로그인 · LOT 화면 조회 권한(requireLotReader)을 확인하고, tenant 는 세션 값만 쓴다. 다른 tenant 의 LOT 는 "없음"과 같은 응답이다.
 *  - 라벨 수량·일자의 근거는 LOT 의 입고(RECEIPT) 수불이다. 현재 재고나 LOT 등록일을 입고수량·입고일로 쓰지 않는다.
 */

import { prisma } from "@/lib/db/prisma"
import { ROLE_PERMISSION_DENIED_MESSAGE } from "@/lib/auth/role-permissions"
import { requireLotReader } from "@/lib/lot-numbering/lot-session-access"
import { labelTypeForItemType, receiptKindForRef, type LotLabelReceipt } from "@/lib/label/lot-label-reprint"
import type { LabelType } from "@/lib/label/label-spec"

export type LotLabelSourceResult =
  | {
      ok: true
      lot: {
        id: string
        lotNo: string
        status: string
        itemCode: string
        itemName: string
        itemType: string
        uom: string
        spec: string | null
      }
      labelType: LabelType | null
      /** 이 LOT 의 입고 이력(오래된 순). 비어 있으면 수량·일자를 표시할 근거가 없다. */
      receipts: LotLabelReceipt[]
    }
  | { ok: false; code: "UNAUTHORIZED" | "DENIED" | "INVALID" | "NOT_FOUND"; message: string }

export async function getLotLabelSource(input: { lotId: string }): Promise<LotLabelSourceResult> {
  let tenantId: string
  try {
    tenantId = (await requireLotReader()).tenantId
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." }
    return { ok: false, code: "DENIED", message: ROLE_PERMISSION_DENIED_MESSAGE }
  }

  const lotId = typeof input?.lotId === "string" ? input.lotId.trim() : ""
  if (!lotId) return { ok: false, code: "INVALID", message: "LOT 를 선택해 주세요." }

  const lot = await prisma.lot.findFirst({
    where: { id: lotId, tenantId },
    select: {
      id: true,
      lotNo: true,
      status: true,
      item: { select: { code: true, name: true, itemType: true, uom: true, spec: true } },
    },
  })
  // 없는 LOT 와 다른 tenant 의 LOT 는 같은 응답(존재 여부 비노출)
  if (!lot) return { ok: false, code: "NOT_FOUND", message: "LOT 를 찾을 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요." }

  const txs = await prisma.inventoryTransaction.findMany({
    where: { tenantId, lotId: lot.id, txType: "RECEIPT" },
    orderBy: [{ txAt: "asc" }, { txNo: "asc" }],
    select: { id: true, txNo: true, qty: true, txAt: true, refType: true, refId: true },
  })

  const poIds = txs.filter((t) => t.refType === "PURCHASE_ORDER" && t.refId).map((t) => t.refId as string)
  const woIds = txs.filter((t) => t.refType === "WORK_ORDER" && t.refId).map((t) => t.refId as string)
  const [pos, wos] = await Promise.all([
    poIds.length ? prisma.purchaseOrder.findMany({ where: { tenantId, id: { in: poIds } }, select: { id: true, orderNo: true } }) : [],
    woIds.length ? prisma.workOrder.findMany({ where: { tenantId, id: { in: woIds } }, select: { id: true, orderNo: true } }) : [],
  ])
  const refNo = new Map<string, string>([...pos, ...wos].map((r) => [r.id, r.orderNo]))

  const receipts: LotLabelReceipt[] = txs.map((t) => ({
    key: t.id,
    txNo: t.txNo,
    qty: Number(t.qty),
    at: t.txAt.toISOString(),
    kind: receiptKindForRef(t.refType),
    refNo: t.refId ? (refNo.get(t.refId) ?? null) : null,
  }))

  return {
    ok: true,
    lot: {
      id: lot.id,
      lotNo: lot.lotNo,
      status: String(lot.status),
      itemCode: lot.item.code,
      itemName: lot.item.name,
      itemType: String(lot.item.itemType),
      uom: String(lot.item.uom),
      spec: lot.item.spec ?? null,
    },
    labelType: labelTypeForItemType(String(lot.item.itemType)) ?? null,
    receipts,
  }
}
