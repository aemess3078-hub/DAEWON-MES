/**
 * 자재입고 요청 멱등성 — 서버 측 순수 로직 (DB 접근 없음, 테스트 가능).
 *
 * 처리 규칙 (receiving.actions.ts 가 사용)
 *  1. 요청 ID 형식 검증 (isValidReceivingRequestId)
 *  2. 요청 내용 해시(SHA-256) 계산 — 수량은 소수점 6자리 정수 문자열로 정규화해 부동소수점 표기 차이를 무시
 *  3. 같은 (tenantId, requestId) 가 이미 있으면:
 *       - 해시 같음  → 새 입고/LOT 번호/거래번호를 만들지 않고 기존 결과 반환 (REPLAY)
 *       - 해시 다름  → 명확한 오류 (CONFLICT)
 *  4. 없으면 같은 트랜잭션에서 클레임(INSERT) 후 입고 처리. 동시 요청은 DB unique 가 하나만 통과시킨다.
 */

import { createHash } from "node:crypto"

export { RECEIVING_UNKNOWN_MESSAGE } from "./receiving-request-id"

export const RECEIVING_REQUEST_ID_INVALID_MESSAGE =
  "입고 요청 식별자가 올바르지 않습니다. 화면을 새로고침한 후 다시 시도해 주세요."
export const RECEIVING_REQUEST_CONFLICT_MESSAGE =
  "같은 입고 요청 번호로 서로 다른 내용이 전달되었습니다. 이미 처리된 요청일 수 있으니 입고 내역을 확인한 뒤, 새로 입고하려면 화면을 새로고침해 다시 진행해 주세요."

export type ReceivingRequestFingerprint = {
  purchaseOrderId: string
  purchaseOrderItemId: string
  warehouseId: string
  /** 소수점 6자리 정수(bigint) 의 문자열 */
  receivedScaled: string
  acceptedScaled: string
  rejectedScaled: string
  result: string
  lotNo: string | null | undefined
  lotReservationId: string | null | undefined
  inspectorId: string | null | undefined
  note: string | null | undefined
}

/** 요청 내용의 SHA-256(hex). 필드 순서·공백·null/undefined 표기 차이에 영향받지 않도록 정규화한다. */
export function hashReceivingRequest(f: ReceivingRequestFingerprint): string {
  const canonical = JSON.stringify([
    "v1",
    f.purchaseOrderId,
    f.purchaseOrderItemId,
    f.warehouseId,
    f.receivedScaled,
    f.acceptedScaled,
    f.rejectedScaled,
    f.result,
    (f.lotNo ?? "").trim(),
    f.lotReservationId ?? "",
    f.inspectorId ?? "",
    (f.note ?? "").trim(),
  ])
  return createHash("sha256").update(canonical, "utf8").digest("hex")
}

export type ExistingRequestVerdict = "REPLAY" | "CONFLICT"

/** 이미 기록된 요청과 새 요청의 관계 */
export function judgeExistingRequest(existingHash: string, incomingHash: string): ExistingRequestVerdict {
  return existingHash === incomingHash ? "REPLAY" : "CONFLICT"
}
