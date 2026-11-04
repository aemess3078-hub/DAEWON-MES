/**
 * 수주 처리 생산의뢰 입력 규칙 단위 테스트 — 순수 모듈, DB·네트워크 없음.
 * 화면·서버 통합은 tests/e2e/tc-so-process-dialog.e2e.ts.
 */
import assert from "node:assert/strict"
import {
  buildRequestKey,
  createRequestIdKeeper,
  defaultAllocationText,
  evaluateRequestRow,
  formatRange,
  parseQtyText,
  type RequestRowInput,
} from "../src/lib/production-request-form"

let passed = 0
function ok(value: unknown, label: string) { assert.ok(value, label); passed += 1; console.log(`PASS ${label}`) }

const row = (o: Partial<RequestRowInput> = {}): RequestRowInput => ({ salesOrderItemId: "soi", itemId: "item", unallocatedQty: 60, allocText: "", extraText: "", reasonText: "", ...o })

// 입력 파싱
ok(parseQtyText("") === BigInt(0) && parseQtyText("  ") === BigInt(0), "P1 빈 입력은 0")
ok(parseQtyText("12.5") === BigInt(12_500_000) && parseQtyText("1,000") === BigInt(1_000_000_000), "P2 소수·천 단위 쉼표")
ok(parseQtyText("-1") === null && parseQtyText("1.1234567") === null && parseQtyText("abc") === null && parseQtyText("1e3") === null, "P3 음수·7자리·문자·지수 거부")

// 검증
const r1 = evaluateRequestRow(row({ allocText: "60", extraText: "10", reasonText: "가공 불량 대비" }))
ok(r1.ok && r1.included && r1.plannedQty === "70" && r1.kind === "ORDER_EXTRA" && r1.line.qty === 60 && r1.line.extraQty === 10 && r1.line.extraReason === "가공 불량 대비", "V1 충당 60 + 여유 10 → 계획 70, ORDER_EXTRA")
const r2 = evaluateRequestRow(row({ allocText: "60", extraText: "0", reasonText: "무시되는 사유" }))
ok(r2.ok && r2.included && r2.kind === "ORDER" && r2.line.extraQty === 0 && r2.line.extraReason === null && r2.plannedQty === "60", "V2 여유 0 → ORDER(사유 보내지 않음)")
const r3 = evaluateRequestRow(row({ allocText: "61" }))
ok(!r3.ok && /초과/.test(r3.errors.alloc ?? ""), "V3 충당 > 추가 충당 가능량 거부")
const r4 = evaluateRequestRow(row({ allocText: "10", extraText: "5", reasonText: "  " }))
ok(!r4.ok && /사유/.test(r4.errors.reason ?? ""), "V4 여유가 있는데 사유 없음 거부")
const r5 = evaluateRequestRow(row({ allocText: "", extraText: "5", reasonText: "재고 확보" }))
ok(!r5.ok && /재고 생산/.test(r5.errors.alloc ?? ""), "V5 충당 0 + 여유만 → 거부하고 재고 생산 경로 안내")
const r6 = evaluateRequestRow(row({ allocText: "", extraText: "" }))
ok(r6.ok && !r6.included, "V6 둘 다 비어 있으면 의뢰에서 제외(오류 아님)")
const r7 = evaluateRequestRow(row({ allocText: "10", extraText: "-1" }))
ok(!r7.ok && !!r7.errors.extra, "V7 음수 여유 거부")
const r8 = evaluateRequestRow(row({ allocText: "10", extraText: "1", reasonText: "가".repeat(501) }))
ok(!r8.ok && /500자/.test(r8.errors.reason ?? ""), "V8 사유 500자 초과 거부")
const r9 = evaluateRequestRow(row({ allocText: "0.1", extraText: "0.2", reasonText: "소수" }))
ok(r9.ok && r9.included && r9.plannedQty === "0.3", "V9 소수 수량 정확(0.1+0.2=0.3)")
const r10 = evaluateRequestRow(row({ unallocatedQty: 0, allocText: "1" }))
ok(!r10.ok, "V10 이미 전량 충당된 품목에 충당 1 거부")

// 기본값
ok(defaultAllocationText(100, 60) === "60" && defaultAllocationText(30, 60) === "30" && defaultAllocationText(0, 60) === "" && defaultAllocationText(50, 0) === "", "D1 기본 충당 = 기존 부족수량을 미충당 안으로 자른 값(0 이면 비움)")

// 요청 키·요청 ID
const mk = (qty: number, extra = 0, reason: string | null = null) => buildRequestKey("so", [{ salesOrderItemId: "a", itemId: "i", qty, extraQty: extra, extraReason: reason }])
ok(mk(60, 10, "x") === mk(60, 10, "x") && mk(60, 10, "x") !== mk(60, 11, "x") && mk(60, 10, "x") !== mk(61, 10, "x") && mk(60, 10, "x") !== mk(60, 10, "y"), "K1 같은 입력은 같은 키, 충당·여유·사유가 다르면 다른 키")
let n = 0
const keeper = createRequestIdKeeper(() => `id-${++n}`)
const a1 = keeper.idFor(mk(60)), a2 = keeper.idFor(mk(60))
ok(a1 === a2, "K2 같은 입력의 재시도(더블클릭·네트워크 재시도)는 같은 요청 ID")
const b1 = keeper.idFor(mk(50))
ok(b1 !== a1, "K3 입력이 바뀌면 새 요청 ID")
const b2 = keeper.idFor(mk(60))
ok(b2 !== b1 && b2 !== a1, "K4 이전 입력으로 되돌려도 새 ID(이전 ID 를 재사용하지 않음)")
keeper.reset()
const c1 = keeper.idFor(mk(60))
ok(c1 !== b2, "K5 성공 후(reset) 같은 입력으로 다시 의뢰해도 새 요청 ID")

ok(formatRange(40, 50, false, String) === "40~50" && formatRange(40, 40, true, String) === "40" && formatRange(0, 5, true, String) === "0", "F1 구간 표시")

console.log(`\n${passed} checks passed`)
