/**
 * 자재입고 수량 검증 정책 (순수 함수 — 서버 입고 액션의 사전 검증과 트랜잭션 내부 재검증이 같은 규칙을 쓴다).
 *
 *  - NaN / Infinity / 소수점 6자리 초과는 거부 (조용히 반올림하지 않음)
 *  - 입고수량 > 0, 합격·불합격수량 >= 0 (음수 차단)
 *  - 합격수량 + 불합격수량 = 입고수량 (허용오차 없이 소수점 6자리 정수로 정확히 비교)
 *  - 입고수량 <= 잔여수량(발주수량 - 누적 입고수량(합격 기준)) — 정확한 소수 비교
 */

import { formatScaledQuantity, fromScaledQuantity, toScaledQuantity } from "@/lib/quantity-scale"

export type ReceiptQuantities = {
  /** 소수점 6자리로 정규화된 값 (예: 0.19999999999999998 → 0.2) */
  received: number
  accepted: number
  rejected: number
  receivedScaled: bigint
}

export type ReceiptQuantityResult<T> = { ok: true; value: T } | { ok: false; message: string }

const ZERO = BigInt(0)

export function validateReceiptQuantities(input: {
  receivedQty: unknown
  acceptedQty: unknown
  rejectedQty: unknown
}): ReceiptQuantityResult<ReceiptQuantities> {
  const received = toScaledQuantity(input.receivedQty)
  const accepted = toScaledQuantity(input.acceptedQty)
  const rejected = toScaledQuantity(input.rejectedQty)
  if (received === null || accepted === null || rejected === null) {
    return { ok: false, message: "입고·합격·불합격 수량은 유한한 숫자이며 소수점 6자리까지만 입력할 수 있습니다." }
  }
  if (received <= ZERO) return { ok: false, message: "입고수량은 0보다 커야 합니다." }
  if (accepted < ZERO || rejected < ZERO) {
    return { ok: false, message: "합격수량과 불합격수량은 0 이상이어야 합니다." }
  }
  if (accepted + rejected !== received) {
    return { ok: false, message: "합격수량과 불합격수량의 합은 금회 입고수량과 같아야 합니다." }
  }
  return {
    ok: true,
    value: {
      received: fromScaledQuantity(received),
      accepted: fromScaledQuantity(accepted),
      rejected: fromScaledQuantity(rejected),
      receivedScaled: received,
    },
  }
}

/** 잔여수량 = 발주수량 - 누적 입고수량. 입고수량이 잔여수량을 넘으면 거부한다. */
export function checkReceiptRemaining(
  receivedScaled: bigint,
  orderedQty: unknown,
  alreadyReceivedQty: unknown,
  uom: string
): ReceiptQuantityResult<{ remainingScaled: bigint }> {
  const ordered = toScaledQuantity(orderedQty)
  const already = toScaledQuantity(alreadyReceivedQty)
  if (ordered === null || already === null) {
    return { ok: false, message: "발주 수량 데이터가 올바르지 않습니다. 관리자에게 문의해 주세요." }
  }
  const remainingScaled = ordered - already
  if (receivedScaled > remainingScaled) {
    return {
      ok: false,
      message: `입고수량은 잔여수량을 초과할 수 없습니다. 잔여수량: ${formatScaledQuantity(remainingScaled)} ${uom}`,
    }
  }
  return { ok: true, value: { remainingScaled } }
}
