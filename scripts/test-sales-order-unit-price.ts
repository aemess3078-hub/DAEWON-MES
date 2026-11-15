/**
 * 수주 등록 총금액 ↔ 단가 자동 계산 규칙 검증 (순수 로직, DB 불필요)
 * 실행: npm run test:sales-order-unit-price
 */
import assert from "node:assert/strict"
import { deriveAutoUnitPrice, getAmountMismatch, type UnitPriceRow } from "../src/lib/sales-order-unit-price"

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const row = (qty: number | undefined, unitPrice: number | undefined, manual = false): UnitPriceRow => ({
  qty,
  unitPrice,
  manual,
})

console.log("sales-order unit price rules")

check("시나리오 1: 총금액 500,000 → 수량 100 → 단가 5,000", () => {
  const r = deriveAutoUnitPrice(500_000, [row(100, undefined)])
  assert.equal(r?.unitPrice, 5_000)
  assert.equal(r?.basis, "total")
})

check("시나리오 3: 총금액 500,000 → 수량 200 → 단가 2,500", () => {
  const r = deriveAutoUnitPrice(500_000, [row(200, 5_000)])
  assert.equal(r?.unitPrice, 2_500)
})

check("시나리오 4: 수동 단가 5,500 은 자동 계산이 덮어쓰지 않는다", () => {
  assert.equal(deriveAutoUnitPrice(500_000, [row(100, 5_500, true)]), null)
})

check("시나리오 5: 수동 변경 후 수량 수정 → 수동 단가 유지", () => {
  assert.equal(deriveAutoUnitPrice(500_000, [row(250, 5_500, true)]), null)
})

check("시나리오 6: 총금액 미입력 → 계산하지 않음", () => {
  assert.equal(deriveAutoUnitPrice(undefined, [row(100, undefined)]), null)
  assert.equal(deriveAutoUnitPrice(0, [row(100, undefined)]), null)
})

check("수량 0 또는 미입력 → 계산하지 않음", () => {
  assert.equal(deriveAutoUnitPrice(500_000, [row(0, undefined)]), null)
  assert.equal(deriveAutoUnitPrice(500_000, [row(undefined, undefined)]), null)
})

check("시나리오 8: 다중 품목 → 자동 행이 여럿이면 총금액을 배분하지 않는다", () => {
  assert.equal(deriveAutoUnitPrice(500_000, [row(100, undefined), row(50, undefined)]), null)
})

check("다중 품목: 나머지 확정 품목 금액을 뺀 잔여 금액으로 단가 계산", () => {
  // 확정: 40 × 5,000 = 200,000 → 잔여 300,000 ÷ 60 = 5,000
  const r = deriveAutoUnitPrice(500_000, [row(40, 5_000, true), row(60, undefined)])
  assert.equal(r?.unitPrice, 5_000)
  assert.equal(r?.basis, "remainder")
  assert.equal(r?.basisAmount, 300_000)
})

check("다중 품목: 나머지 품목 단가가 비어 있으면 계산하지 않는다", () => {
  assert.equal(deriveAutoUnitPrice(500_000, [row(40, undefined), row(60, undefined)]), null)
})

check("다중 품목: 확정 금액이 총금액을 넘으면 계산하지 않는다", () => {
  assert.equal(deriveAutoUnitPrice(100_000, [row(40, 5_000, true), row(60, undefined)]), null)
})

check("소수점 발생 시 원 단위 반올림 (MoneyInput 은 정수만 다룬다)", () => {
  assert.equal(deriveAutoUnitPrice(1_000, [row(3, undefined)])?.unitPrice, 333)
})

check("불일치 감지: 수동 단가로 합계가 총금액과 달라지면 차이 반환", () => {
  const m = getAmountMismatch(500_000, [{ qty: 100, unitPrice: 5_500 }])
  assert.deepEqual(m, { lineSum: 550_000, difference: -50_000, roundingOnly: false })
})

check("수량 미입력 행이 있으면 자동 계산도 불일치 판단도 하지 않는다", () => {
  assert.equal(deriveAutoUnitPrice(1_000, [row(undefined, undefined)]), null)
  assert.equal(getAmountMismatch(1_000, [{ qty: undefined, unitPrice: 333 }]), null)
})

check("반올림 차이(KRW, 자동 행, 1원): 안내만 — roundingOnly true", () => {
  // 1,000 ÷ 3 = 333 → 333 × 3 = 999, 차이 1원
  const m = getAmountMismatch(1_000, [{ qty: 3, unitPrice: 333, manual: false }], "KRW")
  assert.deepEqual(m, { lineSum: 999, difference: 1, roundingOnly: true })
})

check("반올림 차이: 다중 품목에서 자동 행만 반올림 때문이면 roundingOnly true", () => {
  // 확정 1 × 200,000 + 자동 3 × 100,000 = 500,000, 총금액 500,001 → 차이 1원
  const m = getAmountMismatch(
    500_001,
    [
      { qty: 1, unitPrice: 200_000, manual: true },
      { qty: 3, unitPrice: 100_000, manual: false },
    ],
    "KRW"
  )
  assert.equal(m?.roundingOnly, true)
})

check("반올림 차이 아님: 수동 단가로 1원 차이 → 확인 대상 (roundingOnly false)", () => {
  const m = getAmountMismatch(1_000, [{ qty: 3, unitPrice: 333, manual: true }], "KRW")
  assert.equal(m?.roundingOnly, false)
})

check("반올림 차이 아님: manual 값이 없으면 수동 취급 (roundingOnly false)", () => {
  assert.equal(getAmountMismatch(1_000, [{ qty: 3, unitPrice: 333 }], "KRW")?.roundingOnly, false)
})

check("반올림 차이 아님: 차이 2원 이상 (자동 계산 반올림 범위 초과)", () => {
  // 1,000 ÷ 6 = 167 → 167 × 6 = 1,002, 차이 -2
  const m = getAmountMismatch(1_000, [{ qty: 6, unitPrice: 167, manual: false }], "KRW")
  assert.equal(m?.difference, -2)
  assert.equal(m?.roundingOnly, false)
})

check("반올림 차이 아님: 자동 행 단가가 자동 계산 결과와 다르면 (stale) 확인 대상", () => {
  // 자동 계산이라면 1,000 ÷ 1 = 1,000 인데 999 로 남아 있음 → 차이 1원이지만 반올림 때문이 아님
  assert.equal(getAmountMismatch(1_000, [{ qty: 1, unitPrice: 999, manual: false }], "KRW")?.roundingOnly, false)
})

check("반올림 차이 아님: KRW 가 아닌 통화는 기존 확인 절차 유지", () => {
  assert.equal(getAmountMismatch(1_000, [{ qty: 3, unitPrice: 333, manual: false }], "USD")?.roundingOnly, false)
})

check("일치 시 불일치 없음 / 단가 미입력 행이 있으면 판단하지 않음", () => {
  assert.equal(getAmountMismatch(500_000, [{ qty: 100, unitPrice: 5_000 }]), null)
  assert.equal(getAmountMismatch(500_000, [{ qty: 100, unitPrice: undefined }]), null)
  assert.equal(getAmountMismatch(undefined, [{ qty: 100, unitPrice: 5_000 }]), null)
})

console.log(`\n${passed} checks passed`)
