/**
 * MES 수량 정밀도 정책 (Decimal(18,6) = 소수점 6자리) 공통 유틸리티.
 *
 * 모든 수량 컬럼은 `Decimal(18,6)` 이다. JS number 로 더하고 빼면 0.3 - 0.1 = 0.19999999999999998 처럼
 * 부동소수점 오차가 생기므로, 수량 비교·합산은 **소수점 6자리 정수(bigint)** 로 환산해서 정확히 한다.
 *
 *  - 6자리를 넘는 소수는 거부한다 (조용히 반올림하지 않음)
 *  - number 입력은 6자리 값에서 1e-9(상대 1e-12) 이내로 벗어난 부동소수점 오차만 같은 값으로 본다
 *  - 서버/클라이언트 양쪽에서 import 하는 순수 모듈 (React/DB/"use server" 아님)
 */

export const QUANTITY_DECIMAL_SCALE = 6
export const QUANTITY_SCALE = 1_000_000

const SCALE_BIGINT = BigInt(QUANTITY_SCALE)
const DECIMAL_STRING = /^-?\d+(\.\d{1,6})?$/

/** number/문자열/Decimal 을 소수점 6자리 정수로 환산. 유한한 수가 아니거나 6자리를 넘으면 null. */
export function toScaledQuantity(value: unknown): bigint | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    const scaled = Math.round(value * QUANTITY_SCALE)
    if (!Number.isSafeInteger(scaled)) return null
    const tolerance = Math.max(1e-9, Math.abs(value) * 1e-12)
    if (Math.abs(value - scaled / QUANTITY_SCALE) > tolerance) return null
    return BigInt(scaled)
  }
  if (typeof value === "string" || (typeof value === "object" && value !== null && "toString" in value)) {
    const text = String(value).trim()
    if (!DECIMAL_STRING.test(text)) return null
    const negative = text.startsWith("-")
    const [integerPart, decimalPart = ""] = (negative ? text.slice(1) : text).split(".")
    const scaled = BigInt(integerPart) * SCALE_BIGINT + BigInt(decimalPart.padEnd(QUANTITY_DECIMAL_SCALE, "0"))
    return negative ? -scaled : scaled
  }
  return null
}

/** 소수점 6자리 정수 → number (6자리 값에 가장 가까운 double) */
export function fromScaledQuantity(scaled: bigint): number {
  return Number(scaled) / QUANTITY_SCALE
}

/** 소수점 6자리 정수 → 표시용 문자열 (부동소수점 없이, 불필요한 0 제거) */
export function formatScaledQuantity(scaled: bigint): string {
  const negative = scaled < BigInt(0)
  const abs = negative ? -scaled : scaled
  const integerPart = abs / SCALE_BIGINT
  const decimalPart = (abs % SCALE_BIGINT).toString().padStart(QUANTITY_DECIMAL_SCALE, "0").replace(/0+$/, "")
  return `${negative ? "-" : ""}${integerPart.toString()}${decimalPart ? `.${decimalPart}` : ""}`
}

/** a - b (정확). 한쪽이라도 올바른 수량이 아니면 null */
export function subtractQuantities(a: unknown, b: unknown): number | null {
  const x = toScaledQuantity(a)
  const y = toScaledQuantity(b)
  return x === null || y === null ? null : fromScaledQuantity(x - y)
}

/** a + b (정확). 한쪽이라도 올바른 수량이 아니면 null */
export function addQuantities(a: unknown, b: unknown): number | null {
  const x = toScaledQuantity(a)
  const y = toScaledQuantity(b)
  return x === null || y === null ? null : fromScaledQuantity(x + y)
}

/** a ? b (정확한 비교). 올바른 수량이 아니면 null */
export function compareQuantities(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const x = toScaledQuantity(a)
  const y = toScaledQuantity(b)
  if (x === null || y === null) return null
  return x === y ? 0 : x > y ? 1 : -1
}

/** 합격 + 불합격 = 입고 수량 이 소수점 6자리까지 정확히 성립하는가 (허용오차 없음) */
export function isQuantityBalanced(received: unknown, accepted: unknown, rejected: unknown): boolean {
  const r = toScaledQuantity(received)
  const a = toScaledQuantity(accepted)
  const j = toScaledQuantity(rejected)
  return r !== null && a !== null && j !== null && a + j === r
}
