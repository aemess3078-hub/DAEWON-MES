/**
 * 생산 유형·수주 충당 수량 규칙 단위 테스트 — 순수 모듈만 사용(DB·네트워크 없음).
 * 실제 DB 검증은 tests/e2e/tc-n19-production-allocation.e2e.ts.
 *
 *  K. 유형 판정(STOCK / ORDER / ORDER_EXTRA)
 *  U. 생산계획 수정 한 줄의 해석(충당 유지·감소, 여유 사유 필수, 충당>계획·재고 생산 충당 거부)
 *  R. 생산의뢰 라인 정규화(충당 > 0, 여유 ≥ 0, 사유, 중복 줄) · 멱등 해시가 여유·사유를 포함
 *  V. 충당 잔량 판정(여유 수량은 잔량에 영향 없음) · 한글 안내 문구
 */
import assert from "node:assert/strict"
import { classifyProductionKind, resolvePlanItemUpdate, EXTRA_REASON_MAX_LENGTH } from "../src/lib/production-allocation"
import { findProductionRequestViolation, hashProductionRequest, normalizeRequestLines, productionRequestViolationMessage, allocationIncreaseViolationMessage } from "../src/lib/production-request"

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}
const S = (n: number) => BigInt(Math.round(n * 1_000_000))

// K. 유형 판정
ok(classifyProductionKind({ linked: false, plannedScaled: S(200), allocatedScaled: S(0) }) === "STOCK", "K1 수주 연결 없음 → STOCK")
ok(classifyProductionKind({ linked: true, plannedScaled: S(100), allocatedScaled: S(100) }) === "ORDER", "K2 계획=충당 → ORDER")
ok(classifyProductionKind({ linked: true, plannedScaled: S(110), allocatedScaled: S(100) }) === "ORDER_EXTRA", "K3 계획>충당 → ORDER_EXTRA")

// U. 수정 해석
const orderRow = { kind: "ORDER" as const, allocatedScaled: S(100), extraReason: null }
const extraRow = { kind: "ORDER_EXTRA" as const, allocatedScaled: S(100), extraReason: "불량 대비" }
const r1 = resolvePlanItemUpdate({ linked: true, existing: orderRow, plannedQty: 110 })
ok(!r1.ok && /여유 생산 사유/.test(r1.error), "U1 ORDER 줄의 계획 수량만 올리면 사유 필요")
const r2 = resolvePlanItemUpdate({ linked: true, existing: orderRow, plannedQty: 110, extraReason: "  후공정 불량  " })
ok(r2.ok && r2.kind === "ORDER_EXTRA" && r2.allocatedScaled === S(100) && r2.extraReason === "후공정 불량" && !r2.allocationIncreased, "U2 사유와 함께 증가: 충당 유지·사유 trim·충당 증가 아님")
const r3 = resolvePlanItemUpdate({ linked: true, existing: extraRow, plannedQty: 130 })
ok(r3.ok && r3.kind === "ORDER_EXTRA" && r3.extraReason === "불량 대비", "U3 기존 사유 유지하며 추가 증가")
const r4 = resolvePlanItemUpdate({ linked: true, existing: extraRow, plannedQty: 100 })
ok(r4.ok && r4.kind === "ORDER" && r4.extraReason === null && r4.allocatedScaled === S(100), "U4 여유가 사라지면 ORDER·사유 비움")
const r5 = resolvePlanItemUpdate({ linked: true, existing: orderRow, plannedQty: 80 })
ok(r5.ok && r5.kind === "ORDER" && r5.allocatedScaled === S(80), "U5 충당 미지정 + 계획 < 충당 → 충당도 계획만큼 줄어든다")
const r6 = resolvePlanItemUpdate({ linked: true, existing: orderRow, plannedQty: 70, allocatedQty: 90 })
ok(!r6.ok && /충당 수량.*계획 수량.*클 수 없/.test(r6.error), "U6 충당 > 계획 거부")
const r7 = resolvePlanItemUpdate({ linked: true, existing: { kind: "ORDER", allocatedScaled: S(60), extraReason: null }, plannedQty: 70, allocatedQty: 70 })
ok(r7.ok && r7.allocationIncreased && r7.kind === "ORDER", "U7 충당 증가는 합계 검증 대상으로 표시")
const r8 = resolvePlanItemUpdate({ linked: true, existing: orderRow, plannedQty: 100, allocatedQty: -1 })
ok(!r8.ok, "U8 음수 충당 거부")
const r9 = resolvePlanItemUpdate({ linked: false, existing: { kind: "STOCK", allocatedScaled: S(0), extraReason: null }, plannedQty: 300 })
ok(r9.ok && r9.kind === "STOCK" && r9.allocatedScaled === S(0), "U9 재고 생산은 자유 수정, 충당 0")
const r10 = resolvePlanItemUpdate({ linked: false, existing: { kind: "STOCK", allocatedScaled: S(0), extraReason: null }, plannedQty: 300, allocatedQty: 10 })
ok(!r10.ok, "U10 재고 생산에 충당 지정 거부")
for (const bad of [0, -3, 1.1234567, Number.NaN]) {
  const r = resolvePlanItemUpdate({ linked: false, existing: { kind: "STOCK", allocatedScaled: S(0), extraReason: null }, plannedQty: bad })
  ok(!r.ok, `U11 계획 수량 ${String(bad)} 거부`)
}
const r12 = resolvePlanItemUpdate({ linked: true, existing: orderRow, plannedQty: 110, extraReason: "가".repeat(EXTRA_REASON_MAX_LENGTH + 1) })
ok(!r12.ok, "U12 사유 길이 초과 거부")
const r13 = resolvePlanItemUpdate({ linked: true, existing: orderRow, plannedQty: 0.3, allocatedQty: 0.1, extraReason: "소수 수량" })
ok(r13.ok && r13.plannedScaled === S(0.3) && r13.allocatedScaled === S(0.1), "U13 소수 수량도 6자리 정수로 정확히 처리(부동소수점 오차 없음)")

// R. 생산의뢰 라인
const n1 = normalizeRequestLines([{ salesOrderItemId: "a", itemId: "i", qty: 100 }])
ok(n1.ok && n1.lines[0].extraScaled === BigInt(0) && n1.lines[0].extraReason === null, "R1 여유 없이 → 충당만")
const n2 = normalizeRequestLines([{ salesOrderItemId: "a", itemId: "i", qty: 100, extraQty: 10, extraReason: " 불량 대비 " }])
ok(n2.ok && n2.lines[0].extraScaled === S(10) && n2.lines[0].extraReason === "불량 대비", "R2 여유 10 + 사유")
ok(!normalizeRequestLines([{ salesOrderItemId: "a", itemId: "i", qty: 100, extraQty: 10 }]).ok, "R3 여유 있는데 사유 없음 거부")
ok(!normalizeRequestLines([{ salesOrderItemId: "a", itemId: "i", qty: 100, extraQty: -1, extraReason: "x" }]).ok, "R4 음수 여유 거부")
ok(!normalizeRequestLines([{ salesOrderItemId: "a", itemId: "i", qty: 0, extraQty: 10, extraReason: "x" }]).ok, "R5 충당 0 거부(여유만으로 수주 의뢰 불가)")
const n6 = normalizeRequestLines([{ salesOrderItemId: "a", itemId: "i", qty: 5, extraQty: 0, extraReason: "무시" }])
ok(n6.ok && n6.lines[0].extraReason === null, "R6 여유 0 이면 사유는 저장하지 않음")
ok(!normalizeRequestLines([{ salesOrderItemId: "a", itemId: "i", qty: 1 }, { salesOrderItemId: "a", itemId: "j", qty: 1 }]).ok, "R7 같은 수주 품목 두 줄 거부")
const h = (extra: number, reason: string | null) => {
  const n = normalizeRequestLines([{ salesOrderItemId: "a", itemId: "i", qty: 100, extraQty: extra, extraReason: reason }])
  if (!n.ok) throw new Error(n.error)
  return hashProductionRequest("so1", n.lines)
}
ok(h(10, "A") === h(10, "A"), "R8 같은 요청은 같은 해시")
ok(h(10, "A") !== h(10, "B") && h(10, "A") !== h(11, "A") && h(10, "A") !== h(0, null), "R9 여유 수량·사유가 다르면 해시도 다름(같은 ID 다른 내용 감지)")

// V. 충당 잔량
const ordered = new Map([["a", S(100)]])
ok(findProductionRequestViolation([{ salesOrderItemId: "a", qtyScaled: S(100) }], ordered, new Map()) === null, "V1 충당 100/100 허용(여유와 무관)")
const v2 = findProductionRequestViolation([{ salesOrderItemId: "a", qtyScaled: S(50) }], ordered, new Map([["a", S(100)]]))
ok(v2 !== null && v2.remainingScaled === BigInt(0), "V2 이미 100 충당 → 추가 50 거부, 잔량 0")
const v3 = findProductionRequestViolation([{ salesOrderItemId: "a", qtyScaled: S(61) }], ordered, new Map([["a", S(40)]]))
ok(v3 !== null && v3.remainingScaled === S(60) && /가능 잔량 60.*요청 61/.test(productionRequestViolationMessage("FG-1", v3)), "V3 잔량 60 에 61 → 거부, 기존 N-14 문구 형식 유지")
ok(/수주 충당 수량 초과.*다른 계획이 이미 충당 40.*충당 가능 60.*요청 충당 61/.test(allocationIncreaseViolationMessage("FG-1", v3!)), "V4 수정 경로 문구")

console.log(`\n${passed} checks passed`)
