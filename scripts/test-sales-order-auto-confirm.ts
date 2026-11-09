/**
 * 수주 자동 확정 정책 단위 테스트 — 순수 모듈, DB·네트워크 없음.
 * 서버·화면 통합은 tests/e2e/tc-auto-confirm.e2e.ts.
 */
import assert from "node:assert/strict"
import {
  CREATABLE_STATUSES,
  MANUAL_STATUS_TRANSITIONS,
  NEW_SALES_ORDER_STATUS,
  resolveNewSalesOrderStatus,
  salesOrderItemEditBlockReason,
  sameSalesOrderItems,
  selectableSalesOrderStatuses,
  validateSalesOrderItemEditInput,
  validateSalesOrderStatusChange,
  type SalesOrderFollowUp,
} from "../src/lib/sales-order-status"

let passed = 0
function ok(value: unknown, label: string) { assert.ok(value, label); passed += 1; console.log(`PASS ${label}`) }

ok(NEW_SALES_ORDER_STATUS === "CONFIRMED", "A1 신규 수주 상태는 CONFIRMED")
for (const requested of [undefined, null, "CONFIRMED", "DRAFT"]) {
  const r = resolveNewSalesOrderStatus(requested)
  ok(r.ok && r.status === "CONFIRMED", `A2 요청 상태 ${String(requested)} → CONFIRMED 로 저장`)
}
for (const requested of ["IN_PRODUCTION", "PARTIAL_SHIPPED", "SHIPPED", "CLOSED", "CANCELLED", "BOGUS"]) {
  const r = resolveNewSalesOrderStatus(requested)
  ok(!r.ok && /등록 즉시 확정/.test(r.error), `A3 ${requested} 로는 등록 불가`)
}
ok(CREATABLE_STATUSES.join() === "DRAFT,CONFIRMED", "A4 구 클라이언트 호환 입력값은 초안·확정")
ok(selectableSalesOrderStatuses("DRAFT").join() === "DRAFT,CONFIRMED,CANCELLED", "B1 기존 초안 수주는 수정 화면에서 개별 확정 가능")
ok(MANUAL_STATUS_TRANSITIONS.DRAFT.includes("CONFIRMED"), "B2 DRAFT→CONFIRMED 수동 경로 유지")
ok(MANUAL_STATUS_TRANSITIONS.CONFIRMED.join() === "DRAFT,CANCELLED", "B3 확정 수주 수동 전이(초안 복귀·취소) 유지")
ok(MANUAL_STATUS_TRANSITIONS.IN_PRODUCTION.join() === "CANCELLED" && MANUAL_STATUS_TRANSITIONS.SHIPPED.join() === "CLOSED", "B4 생산중·출하완료 전이 유지")
const none: SalesOrderFollowUp = { activePlanNos: [], workOrderNos: [], shipmentNos: [], openShipmentNos: [], fullyShipped: false, hasShippedQty: false }
ok(validateSalesOrderStatusChange("DRAFT", "CONFIRMED", none) === null, "B5 초안 확정 허용")
ok(!!validateSalesOrderStatusChange("CONFIRMED", "IN_PRODUCTION", none), "B6 생산중은 직접 지정 불가(생산의뢰 결과로만)")
ok(!!validateSalesOrderStatusChange("CANCELLED", "CONFIRMED", none), "B7 취소된 수주는 변경 불가")
ok(!!validateSalesOrderStatusChange("CONFIRMED", "CANCELLED", { ...none, activePlanNos: ["PP-1"] }), "B8 취소되지 않은 생산계획이 있으면 취소 불가")

// 수주 품목 수정 정책(후속 업무가 없는 초안·확정 수주만 수정 가능)
for (const st of ["DRAFT", "CONFIRMED"] as const) ok(salesOrderItemEditBlockReason(st, none) === null, `E1 ${st} + 후속 업무 없음 → 품목 수정 가능`)
for (const st of ["IN_PRODUCTION", "PARTIAL_SHIPPED", "SHIPPED", "CLOSED", "CANCELLED"] as const) ok(/수정할 수 없습니다/.test(salesOrderItemEditBlockReason(st, none) ?? ""), `E2 ${st} → 품목 수정 불가`)
ok(/생산계획\(PP-1\)/.test(salesOrderItemEditBlockReason("CONFIRMED", { ...none, activePlanNos: ["PP-1"] }) ?? ""), "E3 활성 생산계획이 있으면 불가(번호 안내)")
ok(/작업지시\(WO-1\)/.test(salesOrderItemEditBlockReason("DRAFT", { ...none, workOrderNos: ["WO-1"] }) ?? ""), "E4 작업지시가 있으면 불가")
ok(/출하\(SH-1\)/.test(salesOrderItemEditBlockReason("CONFIRMED", { ...none, shipmentNos: ["SH-1"] }) ?? ""), "E5 출하(예정 포함)가 있으면 불가")
ok(/출하 이력/.test(salesOrderItemEditBlockReason("CONFIRMED", { ...none, hasShippedQty: true }) ?? ""), "E6 출하 수량 이력이 있으면 불가")
ok(validateSalesOrderItemEditInput([{ itemId: "a", qty: 1 }]) === null, "V1 정상 입력")
ok(!!validateSalesOrderItemEditInput([]), "V2 품목 0건 거부")
ok(!!validateSalesOrderItemEditInput([{ itemId: "a", qty: 0 }]) && !!validateSalesOrderItemEditInput([{ itemId: "a", qty: -1 }]) && !!validateSalesOrderItemEditInput([{ itemId: "a", qty: "x" }]), "V3 수량 0·음수·비숫자 거부")
ok(!!validateSalesOrderItemEditInput([{ itemId: "a", qty: 1 }, { itemId: "a", qty: 2 }]), "V4 같은 품목 중복 거부")
ok(!!validateSalesOrderItemEditInput([{ itemId: "a", qty: 1, unitPrice: -5 }]) && validateSalesOrderItemEditInput([{ itemId: "a", qty: 1, unitPrice: 0 }]) === null, "V5 음수 단가 거부, 0 허용")
const cur = [{ itemId: "a", qty: "10.000000", unitPrice: "5.00", deliveryDate: new Date("2026-12-01"), note: null }]
ok(sameSalesOrderItems(cur, [{ itemId: "a", qty: 10, unitPrice: 5 }]), "S1 같은 품목·수량·단가는 변경 아님(문자열/숫자 표현 차이 무시)")
ok(sameSalesOrderItems(cur, [{ itemId: "a", qty: 10, unitPrice: 5, deliveryDate: "2026-12-01", note: "" }]), "S2 납기·비고도 같으면 변경 아님(null = 빈 문자열)")
ok(!sameSalesOrderItems(cur, [{ itemId: "a", qty: 11, unitPrice: 5 }]), "S3 수량이 다르면 변경")
ok(!sameSalesOrderItems(cur, [{ itemId: "a", qty: 10, unitPrice: 6 }]), "S4 단가가 다르면 변경")
ok(!sameSalesOrderItems(cur, [{ itemId: "a", qty: 10, unitPrice: 5, deliveryDate: "2026-12-02" }]), "S5 납기가 다르면 변경")
ok(!sameSalesOrderItems(cur, [{ itemId: "a", qty: 10, unitPrice: 5 }, { itemId: "b", qty: 1 }]) && !sameSalesOrderItems(cur, [{ itemId: "b", qty: 10, unitPrice: 5 }]), "S6 품목 추가·교체는 변경")

console.log(`\n${passed} checks passed`)
