/**
 * 수주 처리 화면 다중 LOT 출하 행 검증(순수 함수). DB 없이 실행된다.
 *  - 행 오류: LOT 미선택 / 동일 LOT 중복 / 수량 0 이하 / LOT 예약 가능 초과
 *  - 품목 오류: 행 합계 > 추가 출하 가능 수량, 행 없음, 합계 0
 *  - LOT 선택 시 자동 수량: min(LOT 예약 가능, 남은 한도)
 *  - 화면이 이 헬퍼를 쓰는지 정적 검사
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  checkSalesOrderLotLine,
  suggestLotQty,
  type SalesOrderLotOption,
} from "../src/lib/shipment/sales-order-lot-lines"
import { calculateShippableQty } from "../src/lib/shipment/shipment-plan-quantities"

let passed = 0
function ok(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  PASS ${name}`)
}

const lots: SalesOrderLotOption[] = [
  { lotId: "A", lotNo: "MFG-2608-0013", qtyAvailable: 181 },
  { lotId: "B", lotNo: "MFG-2609-0027", qtyAvailable: 200 },
  { lotId: "C", lotNo: "MFG-2610-0025", qtyAvailable: 150 },
]
const check = (rows: { lotId: string; qty: number }[], limit: number) =>
  checkSalesOrderLotLine({ rows, lots, limit, uom: "EA" })

// 예시 시나리오: 수주 잔여 500, 기존 출하예정 0, LOT 181 / 200 / 119
ok("3개 LOT 합계 500 (수주 잔여 500) → 출하 가능", () => {
  const r = check([{ lotId: "A", qty: 181 }, { lotId: "B", qty: 200 }, { lotId: "C", qty: 119 }], 500)
  assert.equal(r.error, null)
  assert.deepEqual(r.rowErrors, [null, null, null])
  assert.equal(r.total, 500)
})

ok("일부 수량만 출하(부분 출하) 181 → 출하 가능", () => {
  const r = check([{ lotId: "A", qty: 181 }], 500)
  assert.equal(r.error, null)
  assert.equal(r.total, 181)
})

ok("단일 LOT 정상 등록", () => {
  assert.equal(check([{ lotId: "B", qty: 200 }], 500).error, null)
})

ok("동일 LOT 중복 선택 → 두 번째 행 오류", () => {
  const r = check([{ lotId: "A", qty: 10 }, { lotId: "A", qty: 10 }], 500)
  assert.equal(r.rowErrors[0], null)
  assert.equal(r.rowErrors[1], "동일한 LOT를 중복 선택할 수 없습니다.")
  assert.equal(r.error, "LOT 행의 입력 오류를 수정하세요.")
})

ok("LOT 예약 가능 수량 초과 차단 (182 > 181)", () => {
  const r = check([{ lotId: "A", qty: 182 }], 500)
  assert.match(r.rowErrors[0] ?? "", /예약 가능 수량\(181 EA\)을 초과/)
  assert.notEqual(r.error, null)
})

ok("수량 0 또는 음수 → 행 오류", () => {
  assert.equal(check([{ lotId: "A", qty: 0 }], 500).rowErrors[0], "출하 수량은 0보다 커야 합니다.")
  assert.equal(check([{ lotId: "A", qty: -3 }], 500).rowErrors[0], "출하 수량은 0보다 커야 합니다.")
})

ok("LOT 미선택 행 → 행 오류", () => {
  assert.equal(check([{ lotId: "", qty: 5 }], 500).rowErrors[0], "LOT를 선택하세요.")
})

ok("존재하지 않는(다른 품목·비활성) LOT id → LOT 미선택과 같은 오류", () => {
  assert.equal(check([{ lotId: "ZZZ", qty: 5 }], 500).rowErrors[0], "LOT를 선택하세요.")
})

ok("수주 추가 출하 가능 수량 초과 차단 (합계 501 > 한도 500, 행은 모두 정상)", () => {
  const r = check([{ lotId: "A", qty: 181 }, { lotId: "B", qty: 200 }, { lotId: "C", qty: 120 }], 500)
  assert.deepEqual(r.rowErrors, [null, null, null]) // C 는 예약 가능 150 이내
  assert.equal(r.total, 501)
  assert.equal(r.error, "추가 출하 가능 수량(500 EA)을 초과했습니다.")
})

ok("기존 출하예정 예약을 뺀 추가 출하 가능 수량이 한도 (수주 500 − 출하 0 − 예약 400 = 100)", () => {
  const limit = calculateShippableQty(500, 0, 400)
  assert.equal(limit, 100)
  assert.equal(check([{ lotId: "A", qty: 101 }], limit).rowErrors[0], null) // 행 자체는 LOT 예약 기준
  assert.equal(check([{ lotId: "A", qty: 101 }], limit).error, "추가 출하 가능 수량(100 EA)을 초과했습니다.")
  assert.equal(check([{ lotId: "A", qty: 100 }], limit).error, null)
})

ok("행이 없으면 품목 오류", () => {
  assert.equal(check([], 500).error, "LOT를 1개 이상 추가하세요.")
})

ok("합계 0(빈 수량 행이 아닌 0 입력) → 출하 수량 입력 필요", () => {
  // 0 입력은 행 오류("0보다 커야 합니다")가 먼저 잡힌다
  const r = check([{ lotId: "A", qty: 0 }], 500)
  assert.equal(r.error, "LOT 행의 입력 오류를 수정하세요.")
})

ok("빈 LOT 행: 미완성으로 표시되지만 잘못된 값은 아니다(화면은 입력 전 오류를 숨긴다)", () => {
  const r = check([{ lotId: "A", qty: 10 }, { lotId: "", qty: 0 }], 500)
  assert.equal(r.incomplete, true)
  assert.equal(r.invalid, false)
  assert.deepEqual(r.rowEmpty, [false, true])
  assert.equal(r.rowErrors[1], "LOT를 선택하세요.")
  assert.equal(r.error, "LOT를 선택하세요.")
})

ok("입력 합계는 잘못된 행을 포함하고, 출하요청 수량(validTotal)은 유효 행만 더한다", () => {
  const r = check([{ lotId: "A", qty: 10 }, { lotId: "B", qty: 0 }, { lotId: "C", qty: 182 }], 500)
  assert.equal(r.total, 192) // 0 + 182 포함
  assert.equal(r.validTotal, 10)
  assert.equal(r.invalid, true)
  assert.equal(r.rowErrors[1], "출하 수량은 0보다 커야 합니다.")
  assert.equal(r.rowErrors[2], "LOT 예약 가능 수량(150 EA)을 초과했습니다.")
  assert.equal(r.error, "LOT 행의 입력 오류를 수정하세요.")
})

ok("합계 한도 초과도 invalid 이고, 유효 행만이면 validTotal 이 실제 등록 수량", () => {
  const r = check([{ lotId: "A", qty: 181 }, { lotId: "B", qty: 200 }, { lotId: "C", qty: 120 }], 500)
  assert.equal(r.total, 501)
  assert.equal(r.validTotal, 501)
  assert.equal(r.invalid, true)
  assert.equal(r.incomplete, false)
})

ok("모든 행이 완성·유효하면 invalid/incomplete 모두 false", () => {
  const r = check([{ lotId: "A", qty: 181 }, { lotId: "B", qty: 19 }], 200)
  assert.equal(r.invalid, false)
  assert.equal(r.incomplete, false)
  assert.equal(r.total, 200)
  assert.equal(r.validTotal, 200)
})

ok("suggestLotQty: LOT 가용 181, 한도 500, 다른 행 319 → 181", () => {
  assert.equal(suggestLotQty({ lotQtyAvailable: 181, limit: 500, otherRowsQty: 319 }), 181)
})
ok("suggestLotQty: 남은 한도가 더 작으면 남은 한도만큼", () => {
  assert.equal(suggestLotQty({ lotQtyAvailable: 200, limit: 500, otherRowsQty: 400 }), 100)
})
ok("suggestLotQty: 한도 초과 상태여도 음수가 되지 않는다", () => {
  assert.equal(suggestLotQty({ lotQtyAvailable: 200, limit: 500, otherRowsQty: 600 }), 0)
})

// 정적 검사: 화면이 헬퍼를 쓰고, 서버 createShipment 가 LOT 행을 줄 단위로 받는지 확인
const dialogSrc = readFileSync(
  resolve(__dirname, "../src/app/app/mes/sales-orders/sales-order-process-dialog.tsx"),
  "utf8",
)
ok("수주 처리 화면은 LOT 분할 검증 헬퍼를 사용하고 LOT별 행을 서버로 보낸다", () => {
  assert.match(dialogSrc, /checkSalesOrderLotLine\(/)
  assert.match(dialogSrc, /suggestLotQty\(/)
  assert.match(dialogSrc, /handleAddLotRow/)
  assert.match(dialogSrc, /lotId: row\.lotId,/)
  assert.match(dialogSrc, /submitShipmentPlan\(tenantId/)
})
ok("수주 처리 화면은 기존 예약 수량을 포함한 추가 출하 가능 수량으로 한도를 계산한다", () => {
  assert.match(dialogSrc, /calculateShippableQty\(s\.orderedQty, s\.shippedQty, s\.plannedQty\)/)
})

console.log(`sales order lot lines: PASS (${passed} checks)`)
