/**
 * 출하예정 등록 수량 규칙(순수 함수 + 소스 정적 검사). DB 없이 실행된다.
 *  - 추가 출하 가능 = 수주 − 출하완료 − 기존 출하예정
 *  - LOT 예약 가능 = LOT 재고 − 기존 출하예정 예약
 *  - 화면(출하 시트)과 서버(createShipment/submitShipmentPlan)가 같은 헬퍼를 쓰는지 확인
 * 실제 DB 를 쓰는 시나리오(예약/확정/삭제/동시성)는 scripts/db-it 에서 로컬 테스트 DB 가드를 거쳐 실행한다.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  SHIPMENT_PLAN_SYSTEM_ERROR_MESSAGE,
  ShipmentPlanError,
  calculateReservableLotQty,
  calculateShippableQty,
  lotReservableExceededMessage,
  orderShippableExceededMessage,
} from "../src/lib/shipment/shipment-plan-quantities"

let passed = 0
function ok(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  PASS ${name}`)
}

// 1. 수주 품목 추가 출하 가능
ok("수주 100 · 기존 예약 30 → 추가 출하 가능 70", () => {
  assert.equal(calculateShippableQty(100, 0, 30), 70)
})
ok("수주 100 · 출하완료 40 · 기존 예약 0 → 60", () => {
  assert.equal(calculateShippableQty(100, 40, 0), 60)
})
ok("수주 16 · 출하완료 284 · 기존 예약 16 (SO-2026-004 형태) → 0 (음수 아님)", () => {
  assert.equal(calculateShippableQty(300, 284, 16), 0)
  assert.equal(calculateShippableQty(300, 290, 16), 0)
})

// 2. LOT 예약 가능
ok("LOT 재고 100 · 기존 예약 40 → 예약 가능 60", () => {
  assert.equal(calculateReservableLotQty(100, 40), 60)
})
ok("LOT 재고 20 · 기존 예약 0 → 20 (MFG-2610-0025 형태)", () => {
  assert.equal(calculateReservableLotQty(20, 0), 20)
})
ok("LOT 재고 10 · 기존 예약 15 → 0 (음수 아님)", () => {
  assert.equal(calculateReservableLotQty(10, 15), 0)
})

// 3. 요청 vs 한도 — 한도 안이면 OK, 초과면 한국어 사유
ok("multi-LOT 20 + 30 = 50 ≤ 추가 출하 가능 50 → 허용(합계 기준)", () => {
  const shippable = calculateShippableQty(100, 30, 20)
  const requested = 20 + 30
  assert.equal(shippable, 50)
  assert.ok(requested <= shippable)
})
ok("요청 86 · LOT 예약 가능 20 → 한국어 사유에 요청/예약 가능/출하 수량 확인 안내 포함", () => {
  const msg = lotReservableExceededMessage({ lotNo: "MFG-2610-0025", requestedQty: 86, reservableQty: 20 })
  assert.match(msg, /^출하예정 등록 불가/)
  assert.match(msg, /MFG-2610-0025/)
  assert.match(msg, /예약 가능 수량은 20개입니다/)
  assert.match(msg, /요청 수량 86 \/ 예약 가능 수량 20 \/ 출하 수량을 확인해 주세요\./)
  assert.doesNotMatch(msg, /Error|prisma|SELECT|\/src\//i)
})
ok("추가 출하 가능 0 → 차단 사유(수주/출하완료/기존 출하예정 식 표시)", () => {
  const msg = orderShippableExceededMessage({
    itemCode: "MAN-FG-CAP01", orderQty: 300, shippedQty: 284, plannedQty: 16, requestedQty: 16, shippableQty: 0,
  })
  assert.match(msg, /추가 출하 가능 수량이 없습니다/)
  assert.match(msg, /수주 300 − 출하완료 284 − 기존 출하예정 16 = 0/)
})
ok("추가 출하 가능 부족 → 요청/가능 수량 표시", () => {
  const msg = orderShippableExceededMessage({
    itemCode: "MAN-FG-CAP01", orderQty: 100, shippedQty: 0, plannedQty: 30, requestedQty: 80, shippableQty: 70,
  })
  assert.match(msg, /추가 출하 가능 수량은 70개입니다/)
  assert.match(msg, /요청 수량 80/)
})
ok("ShipmentPlanError 는 Error 이고 name 이 구분된다 / 시스템 오류 문구에 내부 정보 없음", () => {
  const e = new ShipmentPlanError("x")
  assert.ok(e instanceof Error)
  assert.equal(e.name, "ShipmentPlanError")
  assert.doesNotMatch(SHIPMENT_PLAN_SYSTEM_ERROR_MESSAGE, /prisma|postgres|src\/|stack/i)
})

// 4. 화면·서버 동일 헬퍼 사용 + 재고 차감 없음 + 권한/트랜잭션 유지 (정적 검사)
const read = (p: string) => readFileSync(resolve(p), "utf8")
const actions = read("src/lib/actions/shipment.actions.ts")
const sheet = read("src/app/app/mes/shipments/shipment-form-sheet.tsx")
const createBody = actions.slice(actions.indexOf("export async function createShipment"), actions.indexOf("export type SubmitShipmentPlanResult"))
const submitBody = actions.slice(actions.indexOf("export async function submitShipmentPlan"), actions.indexOf("export async function confirmShipment"))

ok("서버 createShipment 의 수주 한도 계산이 공용 헬퍼 calculateShippableQty 를 쓴다", () => {
  assert.match(createBody, /calculateShippableQty\(orderQty, shippedQty, plannedQty\)/)
  assert.doesNotMatch(createBody, /Number\(salesOrderItem\.qty\) - Number\(salesOrderItem\.shippedQty\) -/)
})
ok("화면 시트의 추가 출하 가능 계산도 같은 헬퍼를 쓰고, 기존 예약을 뺀다", () => {
  assert.match(sheet, /calculateShippableQty\(/)
  assert.match(sheet, /reservedQty/)
  assert.doesNotMatch(sheet, /getRemainingQty[\s\S]{0,80}Number\(item\.shippedQty\)\s*$/m)
})
ok("서버 목록(getShippableSalesOrders)이 PLANNED 예약 수량 reservedQty 를 내려준다", () => {
  assert.match(actions, /reservedQty: plannedBySalesOrderItem\.get\(i\.id\)/)
})
ok("LOT 목록 행이 재고(qtyStock)·기존 예약(qtyReserved)·예약 가능(qtyAvailable)을 분리해 준다", () => {
  assert.match(actions, /qtyStock,\s*\n\s*qtyReserved,\s*\n\s*qtyAvailable: calculateReservableQty\(qtyStock, qtyReserved\)/)
})
ok("화면은 submitShipmentPlan(결과 값 반환)으로 등록하고 createShipment 를 직접 부르지 않는다", () => {
  assert.match(sheet, /submitShipmentPlan\(tenantId/)
  assert.doesNotMatch(sheet, /await createShipment\(/)
})
ok("submitShipmentPlan: 업무 오류는 메시지를 값으로, 그 밖은 로그 후 일반 문구", () => {
  assert.match(submitBody, /error.name === "ShipmentPlanError"/)
  assert.match(submitBody, /console\.error\(/)
  assert.match(submitBody, /SHIPMENT_PLAN_SYSTEM_ERROR_MESSAGE/)
  assert.doesNotMatch(submitBody, /error\.stack|error\.message\)\s*\}\s*$/m)
})
ok("createShipment 는 재고를 차감하지 않는다(예약만)", () => {
  assert.doesNotMatch(createBody, /inventoryTransaction\.create/)
  assert.doesNotMatch(createBody, /qtyOnHand: \{ decrement/)
  assert.doesNotMatch(createBody, /shippedQty: \{ increment/)
})
ok("createShipment 의 잠금·트랜잭션 순서 유지(수주 품목 잠금 → 재고 잠금 → 예약 집계)", () => {
  const lockSo = createBody.indexOf("lockSalesOrderItemsForUpdate(tx")
  const lockBal = createBody.indexOf("lockInventoryBalancesForUpdate(tx, balanceIdsToLock)")
  const reservedAgg = createBody.indexOf("tx.shipmentItem.aggregate")
  assert.ok(lockSo > 0 && lockBal > lockSo && reservedAgg > lockBal)
})
ok("QC 보류/품질 출하 제한(assertLotQualityReleaseAllowed) 유지", () => {
  assert.match(createBody, /assertLotQualityReleaseAllowed\(tx, \{ tenantId, lotId: lot\.id \}\)/)
})
ok("확정은 조건부 상태 전환(PLANNED→SHIPPED)으로 중복 확정을 막는다", () => {
  const confirm = actions.slice(actions.indexOf("export async function confirmShipment"), actions.indexOf("export async function deleteShipment"))
  assert.match(confirm, /updateMany\(\{\s*where: \{ id, tenantId: user\.tenantId, status: "PLANNED" \}/)
})

console.log(`shipment plan quantities: PASS (${passed} checks)`)
