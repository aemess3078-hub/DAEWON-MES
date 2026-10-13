/**
 * 구매 정책 계산 (순수 모듈 — DB/Prisma/현재 시각 비의존, 서버·클라이언트 공용)
 *
 * Phase 5D: 공급업체 구매조건(MOQ / 발주배수 / 리드타임)과 안전재고 정책의 숫자·날짜 계산.
 *
 *  - 수량 계산은 부동소수 오차에 의존하지 않는다: 소수 6자리 고정소수(BigInt)로 올림/배수 판정을 한다.
 *    (재고/발주 수량은 DECIMAL(18,6) 이므로 6자리가 전체 정밀도다.)
 *  - 적용 순서: 필요량 → MOQ(최소 적용) → 발주배수(올림). 필요량이 0 이하이면 구매하지 않는다(0).
 *  - 날짜는 date-only 문자열(YYYY-MM-DD)이며 달력일 기준이다(영업일 달력 없음). 현재 시각은 읽지 않는다.
 */

import type { DateOnly } from "./types"

const SCALE = 6
// target(ES5) 에서는 BigInt 리터럴(ZERO)을 쓸 수 없어 생성자 호출로 만든다
const ZERO = BigInt(0)
const ONE = BigInt(1)

/** 정밀도 보장 범위: 절대값 < 1e12 (DECIMAL(18,6)). 이 범위 밖은 NaN 으로 취급한다. */
const MAX_ABS = 1_000_000_000_000

export function toScaled(value: number): bigint | null {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) >= MAX_ABS) return null
  // toFixed(6) 은 십진 문자열이므로 이후 연산이 정확하다(0.1+0.2 류 오차가 들어오지 않는다)
  const s = value.toFixed(SCALE)
  const negative = s.startsWith("-")
  const digits = s.replace("-", "").replace(".", "")
  const n = BigInt(digits)
  return negative ? -n : n
}

export function fromScaled(scaled: bigint): number {
  const negative = scaled < ZERO
  const abs = negative ? -scaled : scaled
  const s = abs.toString().padStart(SCALE + 1, "0")
  const text = `${s.slice(0, -SCALE)}.${s.slice(-SCALE)}`
  const n = Number(text)
  return negative ? -n : n
}

export type SupplierTerms = {
  /** 최소 발주수량. null = 제한 없음. 0 이하는 데이터 오류 */
  moq: number | null
  /** 발주 배수. null = 제한 없음. 0 이하는 데이터 오류 */
  orderMultiple: number | null
}

export type TermsApplication =
  | {
      ok: true
      /** 구매조건 적용 전 필요량 */
      rawQty: number
      /** MOQ 적용 후 수량 */
      qtyAfterMoq: number
      /** 최종 제안 수량(MOQ → 배수 올림) */
      qty: number
      moqApplied: boolean
      multipleApplied: boolean
    }
  | { ok: false; code: "INVALID_MOQ" | "INVALID_ORDER_MULTIPLE" | "INVALID_QUANTITY" }

/**
 * 필요량에 공급업체 구매조건을 적용한다.
 *  need 17 / MOQ 20 / 배수 10 → 20,  need 23 / MOQ 20 / 배수 10 → 30,  need 17 / MOQ 25 / 배수 10 → 30
 *  need 2.6 / 배수 0.5 → 3.0 (Decimal-safe)
 */
export function applySupplierTerms(rawQty: number, terms: SupplierTerms): TermsApplication {
  const raw = toScaled(rawQty)
  if (raw === null || raw < ZERO) return { ok: false, code: "INVALID_QUANTITY" }
  const moq = terms.moq === null || terms.moq === undefined ? null : toScaled(terms.moq)
  if (terms.moq !== null && terms.moq !== undefined && (moq === null || moq <= ZERO)) return { ok: false, code: "INVALID_MOQ" }
  const multiple = terms.orderMultiple === null || terms.orderMultiple === undefined ? null : toScaled(terms.orderMultiple)
  if (terms.orderMultiple !== null && terms.orderMultiple !== undefined && (multiple === null || multiple <= ZERO)) {
    return { ok: false, code: "INVALID_ORDER_MULTIPLE" }
  }

  if (raw === ZERO) {
    return { ok: true, rawQty: 0, qtyAfterMoq: 0, qty: 0, moqApplied: false, multipleApplied: false }
  }
  let qty = raw
  let moqApplied = false
  if (moq !== null && qty < moq) {
    qty = moq
    moqApplied = true
  }
  const qtyAfterMoq = qty
  let multipleApplied = false
  if (multiple !== null && qty % multiple !== ZERO) {
    qty = ((qty + multiple - ONE) / multiple) * multiple
    multipleApplied = true
  }
  return {
    ok: true,
    rawQty: fromScaled(raw),
    qtyAfterMoq: fromScaled(qtyAfterMoq),
    qty: fromScaled(qty),
    moqApplied,
    multipleApplied,
  }
}

export type TermsViolation =
  | { ok: true }
  | { ok: false; code: "BELOW_MOQ" | "NOT_MULTIPLE" | "INVALID_TERMS" | "INVALID_QUANTITY"; moq: number | null; orderMultiple: number | null }

/** 사용자가 정한 최종 발주수량이 공급업체 구매조건을 만족하는지 판정한다(서버 재검증/화면 경고 공용). */
export function validateQtyAgainstTerms(qty: number, terms: SupplierTerms): TermsViolation {
  const q = toScaled(qty)
  if (q === null || q <= ZERO) return { ok: false, code: "INVALID_QUANTITY", moq: terms.moq, orderMultiple: terms.orderMultiple }
  const moq = terms.moq === null || terms.moq === undefined ? null : toScaled(terms.moq)
  const multiple = terms.orderMultiple === null || terms.orderMultiple === undefined ? null : toScaled(terms.orderMultiple)
  if ((terms.moq != null && (moq === null || moq <= ZERO)) || (terms.orderMultiple != null && (multiple === null || multiple <= ZERO))) {
    return { ok: false, code: "INVALID_TERMS", moq: terms.moq, orderMultiple: terms.orderMultiple }
  }
  if (moq !== null && q < moq) return { ok: false, code: "BELOW_MOQ", moq: terms.moq, orderMultiple: terms.orderMultiple }
  if (multiple !== null && q % multiple !== ZERO) {
    return { ok: false, code: "NOT_MULTIPLE", moq: terms.moq, orderMultiple: terms.orderMultiple }
  }
  return { ok: true }
}

/** 위반 사유의 사용자 메시지 */
export function describeTermsViolation(v: Exclude<TermsViolation, { ok: true }>, qty: number): string {
  const fmt = (n: number | null) => (n === null ? "-" : n.toLocaleString("ko-KR", { maximumFractionDigits: 6 }))
  switch (v.code) {
    case "BELOW_MOQ":
      return `최소발주수량(MOQ) ${fmt(v.moq)} 미만입니다(입력 ${fmt(qty)}).`
    case "NOT_MULTIPLE":
      return `발주배수 ${fmt(v.orderMultiple)}의 배수가 아닙니다(입력 ${fmt(qty)}).`
    case "INVALID_TERMS":
      return "공급업체 구매조건(MOQ/발주배수) 데이터가 올바르지 않습니다."
    default:
      return "발주수량이 올바르지 않습니다."
  }
}

// ─── 날짜(달력일, date-only) ────────────────────────────────────────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function toUtcMs(date: DateOnly): number | null {
  const m = DATE_RE.exec(date)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const ms = Date.UTC(y, mo - 1, d)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return ms
}

/**
 * 발주 필요일 = 목표 입고일 − 리드타임(달력일). 윤년/연도 경계는 UTC 달력 계산으로 안전하다.
 * 리드타임이 null(미등록)이거나 날짜가 올바르지 않으면 null.
 */
export function computeOrderByDate(targetReceiptDate: DateOnly | null, leadTimeDays: number | null): DateOnly | null {
  if (targetReceiptDate === null || leadTimeDays === null || leadTimeDays === undefined) return null
  if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0) return null
  const ms = toUtcMs(targetReceiptDate)
  if (ms === null) return null
  return new Date(ms - leadTimeDays * 86_400_000).toISOString().slice(0, 10)
}

/** 두 date-only 사이의 일수(to - from). 올바르지 않으면 null */
export function daysBetween(from: DateOnly, to: DateOnly): number | null {
  const a = toUtcMs(from)
  const b = toUtcMs(to)
  if (a === null || b === null) return null
  return Math.round((b - a) / 86_400_000)
}

export type OrderTiming =
  | { status: "NO_TARGET_DATE" }
  | { status: "LEAD_TIME_MISSING" }
  | { status: "OVERDUE"; orderByDate: DateOnly; overdueDays: number }
  | { status: "DUE_TODAY"; orderByDate: DateOnly }
  | { status: "OK"; orderByDate: DateOnly; daysLeft: number }

/**
 * 발주 타이밍 판정: 기준일(baseDate, KST 오늘)과 발주 필요일 비교.
 * 리드타임 미등록은 발주 필요일을 계산하지 않는다(DRAFT 생성은 가능, 경고만).
 */
export function evaluateOrderTiming(
  targetReceiptDate: DateOnly | null,
  leadTimeDays: number | null,
  baseDate: DateOnly | null
): OrderTiming {
  if (targetReceiptDate === null) return { status: "NO_TARGET_DATE" }
  if (leadTimeDays === null || leadTimeDays === undefined) return { status: "LEAD_TIME_MISSING" }
  const orderByDate = computeOrderByDate(targetReceiptDate, leadTimeDays)
  if (orderByDate === null) return { status: "LEAD_TIME_MISSING" }
  if (baseDate === null) return { status: "OK", orderByDate, daysLeft: 0 }
  const diff = daysBetween(baseDate, orderByDate)
  if (diff === null) return { status: "OK", orderByDate, daysLeft: 0 }
  if (diff < 0) return { status: "OVERDUE", orderByDate, overdueDays: -diff }
  if (diff === 0) return { status: "DUE_TODAY", orderByDate }
  return { status: "OK", orderByDate, daysLeft: diff }
}
