import type { Prisma } from "@prisma/client"

/**
 * 일반 발주(자재 구매) 범위 — 외주발주("OS-" 접두어 / note 의 "[OUTSOURCING]")는 제외한다.
 *
 * note 는 NULL 일 수 있다. SQL 에서 `NOT (note LIKE '%x%')` 는 note 가 NULL 이면 NULL(=거짓)이 되어
 * 행이 사라지므로, `NOT: { note: { contains } }` 만 쓰면 note 가 없는 일반 발주가 조회에서 빠진다.
 * 그래서 "note 가 NULL 이거나 [OUTSOURCING] 을 포함하지 않는" 조건으로 명시한다.
 */
export const OUTSOURCING_NOTE_TAG = "[OUTSOURCING]"
export const OUTSOURCING_ORDER_NO_PREFIX = "OS-"

export const generalPurchaseOrderWhere: Prisma.PurchaseOrderWhereInput = {
  AND: [
    { NOT: { orderNo: { startsWith: OUTSOURCING_ORDER_NO_PREFIX } } },
    { OR: [{ note: null }, { NOT: { note: { contains: OUTSOURCING_NOTE_TAG } } }] },
  ],
}

/** generalPurchaseOrderWhere 와 같은 판정을 메모리에서 수행한다(테스트·검증용). */
export function isGeneralPurchaseOrder(po: { orderNo: string; note: string | null }): boolean {
  return !po.orderNo.startsWith(OUTSOURCING_ORDER_NO_PREFIX) && !(po.note ?? "").includes(OUTSOURCING_NOTE_TAG)
}
