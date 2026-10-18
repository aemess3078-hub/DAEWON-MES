import type { PurchaseOrderStatus } from "@prisma/client"

/**
 * 발주 상태 전이 규칙 (Phase 10 / DG-021). 순수 모듈 — 서버 액션과 테스트가 함께 사용한다.
 *
 * 사용자가 화면/직접 호출로 지정할 수 있는 상태는 DRAFT·ORDERED·CANCELLED 뿐이다.
 *  - PARTIAL_RECEIVED / RECEIVED : 입고 처리(receiving.actions)가 수량 기준으로만 설정한다.
 *  - CLOSED                      : 잔량 종결(closePurchaseOrderRemainder)이 설정한다.
 *
 * MRP 의 입고예정/발주잔량 계산이 이 상태에 의존하므로 임의 변경을 허용하지 않는다.
 */
export const PO_USER_TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  DRAFT: ["DRAFT", "ORDERED", "CANCELLED"],
  ORDERED: ["ORDERED", "DRAFT", "CANCELLED"],
  PARTIAL_RECEIVED: ["PARTIAL_RECEIVED"],
  RECEIVED: ["RECEIVED"],
  CLOSED: ["CLOSED"],
  CANCELLED: ["CANCELLED"],
}

/** 신규 발주 생성 시 허용되는 초기 상태 */
export const PO_CREATE_STATUSES: readonly PurchaseOrderStatus[] = ["DRAFT", "ORDERED"]

export function isAllowedPurchaseOrderTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  return PO_USER_TRANSITIONS[from]?.includes(to) ?? false
}

/** 입고/외주 처리 이력이 있으면 DRAFT 복귀·취소를 막아야 하는 전이인지 */
export function transitionRequiresNoHistory(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  return from === "ORDERED" && (to === "DRAFT" || to === "CANCELLED")
}
