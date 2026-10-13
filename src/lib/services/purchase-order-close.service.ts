/**
 * 구매발주 미입고 잔량 종결 코어 (DB 클라이언트 주입형) — Phase 5B
 *
 * 의미: "남은 미입고 수량은 더 이상 입고되지 않는다."
 *  - PurchaseOrder.status 를 CLOSED 로 바꾼다. PurchaseOrderItem.qty / receivedQty 는 건드리지 않는다
 *    (주문량·실입고·미납 종결 이력이 그대로 남는다. 예: 100 / 80 / CLOSED → 미납 20).
 *  - 허용 상태: ORDERED, PARTIAL_RECEIVED. (RECEIVED: 잔량 0, DRAFT: 삭제/취소 사용, CANCELLED/CLOSED: 불가)
 *    이미 CLOSED 이면 ALREADY_CLOSED 안내(변경 없음).
 *  - 외주발주(OS- / [OUTSOURCING] / 공정 연결 품목)는 외주관리 흐름이므로 이 기능으로 종결하지 않는다.
 *  - tenantId 는 authorize() 가 돌려준 인증 사용자에서만 결정한다. 타 tenant / 미존재 발주는 같은 일반 오류.
 *  - 수량 합산 이후 상태 전환은 입고(receiving)와 같은 품목 행 잠금(lockItems) 아래에서 조건부 갱신한다.
 *  - 종결 사유는 감사로그에만 남긴다(발주 note 에 쓰지 않는다: note 의 "[OUTSOURCING]" 표식이 분류에 쓰이므로).
 *  - 자동 종결은 하지 않는다. 사용자가 명시적으로 실행한다.
 */

import type { Prisma, PrismaClient } from "@prisma/client"

export type PurchaseOrderCloseDb = Pick<PrismaClient, "purchaseOrder" | "auditLog" | "$transaction">
type Tx = Prisma.TransactionClient

export type PurchaseOrderCloseActor = { id: string; name?: string | null; tenantId: string }

export type PurchaseOrderCloseCode =
  | "INVALID_INPUT"
  | "INVALID_REFERENCE"
  | "ALREADY_CLOSED"
  | "INVALID_STATUS"
  | "OUTSOURCING_ORDER"
  | "NOTHING_TO_CLOSE"
  | "CONFLICT"
  | "FAILED"

export const PURCHASE_ORDER_CLOSE_MESSAGES: Record<PurchaseOrderCloseCode, string> = {
  INVALID_INPUT: "입력값이 올바르지 않습니다.",
  INVALID_REFERENCE: "유효하지 않은 참조입니다.",
  ALREADY_CLOSED: "이미 종결된 발주입니다.",
  INVALID_STATUS: "발주완료 또는 부분입고 상태의 발주만 잔량을 종결할 수 있습니다.",
  OUTSOURCING_ORDER: "외주발주는 외주관리에서 처리해 주세요.",
  NOTHING_TO_CLOSE: "종결할 미입고 잔량이 없습니다.",
  CONFLICT: "다른 사용자가 먼저 발주를 변경했습니다. 새로고침 후 다시 시도해 주세요.",
  FAILED: "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.",
}

export const CLOSABLE_STATUSES = ["ORDERED", "PARTIAL_RECEIVED"] as const
export const MAX_CLOSE_REASON_LENGTH = 200

export type PurchaseOrderCloseSummary = {
  purchaseOrderId: string
  orderNo: string
  previousStatus: string
  orderedQty: number
  receivedQty: number
  /** 종결로 더 이상 입고예정이 아닌 미입고 수량 */
  remainingQty: number
  items: Array<{
    itemId: string
    itemCode: string | null
    qty: number
    receivedQty: number
    remainingQty: number
  }>
}

export type PurchaseOrderCloseResult =
  | { success: true; data: PurchaseOrderCloseSummary }
  | { success: false; code: PurchaseOrderCloseCode; error: string }

function fail(code: PurchaseOrderCloseCode, messageOverride?: string): PurchaseOrderCloseResult {
  return { success: false, code, error: messageOverride ?? PURCHASE_ORDER_CLOSE_MESSAGES[code] }
}

class CloseFailure extends Error {
  readonly isCloseFailure = true
  constructor(readonly code: PurchaseOrderCloseCode, readonly detail?: string) {
    super(code)
    Object.setPrototypeOf(this, CloseFailure.prototype)
  }
}

function isCloseFailure(e: unknown): e is CloseFailure {
  return typeof e === "object" && e !== null && (e as { isCloseFailure?: boolean }).isCloseFailure === true
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v as string)
  return Number.isFinite(n) ? n : 0
}

function isOutsourcing(po: { orderNo: string; note: string | null }, items: Array<{ workOrderOperationId: string | null }>) {
  return (
    po.orderNo.startsWith("OS-") ||
    (po.note ?? "").includes("[OUTSOURCING]") ||
    items.some((i) => i.workOrderOperationId !== null && i.workOrderOperationId !== undefined)
  )
}

const STATUS_MESSAGES: Record<string, string> = {
  RECEIVED: "이미 입고가 완료된 발주는 종결할 필요가 없습니다.",
  DRAFT: "초안 발주는 삭제하거나 취소 상태로 변경해 주세요. 잔량 종결은 발주완료/부분입고 상태에서만 가능합니다.",
  CANCELLED: "취소된 발주는 종결할 수 없습니다.",
}

export async function closePurchaseOrderRemainder(
  deps: {
    authorize: () => Promise<PurchaseOrderCloseActor>
    db: PurchaseOrderCloseDb
    /** 입고(receiving)와 같은 품목 행 잠금. 운영에서는 lockPurchaseOrderItemsForUpdate 를 주입한다. */
    lockItems?: (tx: Tx, tenantId: string, itemIds: string[]) => Promise<void>
  },
  purchaseOrderId: string,
  reason?: string | null
): Promise<PurchaseOrderCloseResult> {
  // 권한 실패(throw)는 DB 접근 전에 발생한다
  const actor = await deps.authorize()
  const { db } = deps
  const tenantId = actor.tenantId

  if (typeof purchaseOrderId !== "string" || purchaseOrderId.length === 0) return fail("INVALID_REFERENCE")
  let cleanReason: string | null = null
  if (reason !== undefined && reason !== null) {
    if (typeof reason !== "string") return fail("INVALID_INPUT")
    const trimmed = reason.trim()
    if (trimmed.length > MAX_CLOSE_REASON_LENGTH) return fail("INVALID_INPUT", `종결 사유는 ${MAX_CLOSE_REASON_LENGTH}자 이내로 입력해 주세요.`)
    cleanReason = trimmed.length > 0 ? trimmed : null
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const load = () =>
        tx.purchaseOrder.findFirst({
          where: { id: purchaseOrderId, tenantId },
          select: {
            id: true,
            orderNo: true,
            status: true,
            note: true,
            items: {
              select: {
                id: true,
                itemId: true,
                qty: true,
                receivedQty: true,
                workOrderOperationId: true,
                item: { select: { code: true } },
              },
            },
          },
        })

      let po = await load()
      if (!po) throw new CloseFailure("INVALID_REFERENCE")

      // 입고와 같은 품목 행 잠금을 잡은 뒤 다시 읽어(동시 입고 반영) 수량/상태를 확정한다
      if (deps.lockItems && po.items.length > 0) {
        await deps.lockItems(tx, tenantId, po.items.map((i) => i.id))
        po = await load()
        if (!po) throw new CloseFailure("INVALID_REFERENCE")
      }

      if (po.status === "CLOSED") throw new CloseFailure("ALREADY_CLOSED")
      if (!(CLOSABLE_STATUSES as readonly string[]).includes(po.status)) {
        throw new CloseFailure("INVALID_STATUS", STATUS_MESSAGES[po.status])
      }
      if (isOutsourcing(po, po.items)) throw new CloseFailure("OUTSOURCING_ORDER")

      const lines = po.items.map((i) => {
        const qty = num(i.qty)
        const received = num(i.receivedQty)
        return {
          itemId: i.itemId,
          itemCode: i.item?.code ?? null,
          qty,
          receivedQty: received,
          // 데이터 이상(입고 > 발주)은 0 으로 클램프: 음수 잔량을 만들지 않는다
          remainingQty: Math.max(0, qty - received),
        }
      })
      const remainingQty = lines.reduce((s, l) => s + l.remainingQty, 0)
      if (!(remainingQty > 0)) throw new CloseFailure("NOTHING_TO_CLOSE")

      // 조건부 갱신: 상태가 그 사이 바뀌었으면 0건 → CONFLICT. qty/receivedQty 는 수정하지 않는다.
      const updated = await tx.purchaseOrder.updateMany({
        where: { id: po.id, tenantId, status: { in: [...CLOSABLE_STATUSES] } },
        data: { status: "CLOSED" },
      })
      if (updated.count !== 1) throw new CloseFailure("CONFLICT")

      const orderedQty = lines.reduce((s, l) => s + l.qty, 0)
      const receivedQty = lines.reduce((s, l) => s + l.receivedQty, 0)
      const summary: PurchaseOrderCloseSummary = {
        purchaseOrderId: po.id,
        orderNo: po.orderNo,
        previousStatus: po.status,
        orderedQty,
        receivedQty,
        remainingQty,
        items: lines,
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name ?? null,
          entityType: "PurchaseOrder",
          entityId: po.id,
          action: "UPDATE",
          beforeData: { status: po.status },
          afterData: {
            status: "CLOSED",
            closeType: "REMAINDER_CLOSED",
            orderNo: po.orderNo,
            orderedQty,
            receivedQty,
            remainingQty,
            reason: cleanReason,
            items: lines.slice(0, 50),
          },
          menuName: "발주관리",
        },
      })
      return summary
    })
    return { success: true, data }
  } catch (e) {
    if (isCloseFailure(e)) return fail(e.code, e.detail)
    console.error("[closePurchaseOrderRemainder] failed:", e)
    return fail("FAILED")
  }
}
