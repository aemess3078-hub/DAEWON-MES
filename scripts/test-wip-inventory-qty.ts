/**
 * 재공품재고 현재 재공수량 산정 회귀 테스트 — 순수 로직(DB 없음).
 * 입고 완료·폐기 완료 제외 / 입고 대기 포함 / 부분 입고 잔량 / 재작업 보류 구분 / KPI 중복 집계 방지.
 */
import assert from "node:assert/strict"
import { computeWipCurrentQtyByUnit, summarizeWipInventory } from "../src/lib/actions/wip-receipt.helpers"

let passed = 0
function eq<T>(actual: T, expected: T, label: string) {
  assert.deepEqual(actual, expected, label)
  passed += 1
  console.log(`PASS ${label}`)
}
const t = (n: number) => new Date(2026, 0, 1, 0, n)
const unit = (id: string, qty: number, status: string, o: { root?: boolean; final?: boolean; at?: number } = {}) => ({
  id, qty, status, isRoot: o.root ?? true, isFinalCompletedRoot: o.final ?? false, createdAt: t(o.at ?? 0),
})

// 1. 전량 입고 → 재공 0, RECEIVED
let m = computeWipCurrentQtyByUnit([unit("r", 100, "COMPLETED", { final: true })], 100)
eq(m.get("r"), { category: "RECEIVED", wipQty: 0, receivedQty: 100, isCurrent: false }, "전량 입고 완료는 현재 재공에서 제외")

// 2. 입고 전(생산 완료·입고 대기) → 전량 재공
m = computeWipCurrentQtyByUnit([unit("r", 100, "COMPLETED", { final: true })], 0)
eq(m.get("r"), { category: "AWAITING_RECEIPT", wipQty: 100, receivedQty: 0, isCurrent: true }, "생산 완료 후 입고 대기 수량은 재공 포함")

// 3. 부분 입고 → 잔량만
m = computeWipCurrentQtyByUnit([unit("r", 100, "COMPLETED", { final: true })], 40)
eq(m.get("r"), { category: "AWAITING_RECEIPT", wipQty: 60, receivedQty: 40, isCurrent: true }, "부분 입고는 미입고 잔량만 집계")

// 4. 폐기 완료 제외, 재작업 보류 별도, 진행 중 포함
m = computeWipCurrentQtyByUnit([
  unit("root", 90, "IN_PROCESS"),
  unit("scrap", 5, "SCRAPPED", { root: false, at: 1 }),
  unit("rw", 3, "REWORK", { root: false, at: 2 }),
], 0)
eq(m.get("root")?.wipQty, 90, "진행 중 재공은 전체 수량")
eq(m.get("scrap"), { category: "SCRAPPED", wipQty: 0, receivedQty: 0, isCurrent: false }, "폐기 완료 수량은 재공에서 제외")
eq(m.get("rw")?.category, "REWORK_HOLD", "재작업 보류는 별도 구분")
eq(m.get("rw")?.wipQty, 3, "재작업 보류 수량 유지")

// 5. 완료 root 가 둘이면 입고 누적은 한 번만 배분(중복 집계 없음)
m = computeWipCurrentQtyByUnit([unit("a", 50, "COMPLETED", { final: true, at: 0 }), unit("b", 50, "COMPLETED", { final: true, at: 1 })], 70)
eq([m.get("a")?.wipQty, m.get("b")?.wipQty], [0, 30], "입고 누적은 완료 root 에 생성순으로 1회만 배분")

// 6. 소수 수량 / 입고 초과 방어
m = computeWipCurrentQtyByUnit([unit("r", 34.6, "COMPLETED", { final: true })], 34.6)
eq(m.get("r")?.isCurrent, false, "소수 수량도 전량 입고면 제외")
m = computeWipCurrentQtyByUnit([unit("r", 10, "COMPLETED", { final: true })], 15)
eq(m.get("r")?.wipQty, 0, "입고 초과여도 음수 재공 없음")

// 7. KPI 요약
const rows = (
  [
    ["w1", "IN_PROCESS", 90, 0, true],
    ["w2", "AWAITING_RECEIPT", 60, 60, true],
    ["w2", "REWORK_HOLD", 3, 0, true],
    ["w3", "RECEIVED", 0, 0, false],
    ["w3", "SCRAPPED", 0, 0, false],
  ] as const
).map(([workOrderId, category, wipQty, availableReceiptQty, isCurrent]) => ({
  workOrderId, category, wipQty, availableReceiptQty, blocked: false, isCurrent,
}))
eq(summarizeWipInventory(rows), {
  currentOrderCount: 2, currentWipQty: 150, inProcessQty: 90, awaitingReceiptQty: 60, receivableQty: 60, reworkHoldQty: 3,
}, "KPI: 입고완료·폐기 제외, 재작업 보류 별도, 작업지시 수는 현재 재공 기준")
eq(summarizeWipInventory([]).currentWipQty, 0, "빈 목록 KPI 0")
eq(
  summarizeWipInventory([
    { workOrderId: "x", category: "AWAITING_RECEIPT", wipQty: 10, availableReceiptQty: 20, blocked: false, isCurrent: true },
    { workOrderId: "x", category: "AWAITING_RECEIPT", wipQty: 10, availableReceiptQty: 20, blocked: false, isCurrent: true },
  ]).receivableQty,
  20,
  "입고 가능 수량은 작업지시당 1회만 합산",
)

console.log(`\n${passed}건 통과`)
