/**
 * 생산 수량 조회 모델 순수 계산 단위 테스트 — DB·네트워크 없음.
 * 실제 DB 대조는 tests/e2e/tc-qm-production-quantities.e2e.ts.
 *
 *  P. 미입고 충당 구간(추정 없이 하한·상한)  A. 승인 표시(PENDING 을 승인으로 보지 않음)
 *  O. 수주 품목 수량·충당·여유·출하  C. 기존/신규 부족수량 비교와 중복 차감 방지  T. 합계·유형 요약
 */
import assert from "node:assert/strict"
import {
  buildItemStockView,
  buildOrderItemQuantityView,
  buildPlanLineView,
  buildPlanQuantityView,
  sumPlanLines,
  type ItemStockInput,
  type OrderItemInput,
  type PlanLineInput,
} from "../src/lib/production-quantity-model"

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}
const eq = (a: unknown, b: unknown, label: string) => { assert.deepEqual(a, b, label); passed += 1; console.log(`PASS ${label}`) }

/** woQty: 작업지시 계획 수량 합(기본: 입고가 있으면 계획 전체, 없으면 0), receivable: 작업지시별 (기대 공급 − 입고) 합(기본: woQty − 입고) */
const line = (o: Partial<PlanLineInput> & { planned: number; allocated: number; received?: number; woQty?: number; receivable?: number }): PlanLineInput => ({
  planItemId: o.planItemId ?? "pi", planId: o.planId ?? "p", planNo: o.planNo ?? "PP-1", planStatus: o.planStatus ?? "CONFIRMED",
  itemId: "item", salesOrderItemId: o.salesOrderItemId === undefined ? "soi" : o.salesOrderItemId,
  productionKind: o.productionKind ?? (o.allocated === o.planned ? "ORDER" : "ORDER_EXTRA"),
  plannedQty: o.planned, allocatedQty: o.allocated, extraReason: null,
  extraApprovalStatus: o.extraApprovalStatus ?? "NOT_REQUIRED",
  workOrderQty: o.woQty ?? ((o.received ?? 0) > 0 ? o.planned : 0), workOrderCount: 0, receivedQty: o.received ?? 0,
  receivableFromWorkOrdersQty: o.receivable ?? Math.max(0, (o.woQty ?? ((o.received ?? 0) > 0 ? o.planned : 0)) - (o.received ?? 0)),
})
const pend = (l: PlanLineInput) => buildPlanLineView(l).pendingAllocatedReceipt

// P. 미입고 충당 구간
eq(pend(line({ planned: 100, allocated: 100, received: 60 })), { minQty: 40, maxQty: 40, exact: true }, "P1 ORDER: 입고 60 → 미입고 충당 40(정확)")
eq(pend(line({ planned: 110, allocated: 100, received: 0 })), { minQty: 100, maxQty: 100, exact: true }, "P2 ORDER_EXTRA 입고 0 → 충당 100 전부 미입고(정확)")
eq(pend(line({ planned: 110, allocated: 100, received: 60 })), { minQty: 40, maxQty: 50, exact: false }, "P3 ORDER_EXTRA 입고 60 → 40~50(어느 몫에 입고됐는지 DB 에 없어 구간)")
eq(pend(line({ planned: 110, allocated: 100, received: 105 })), { minQty: 0, maxQty: 5, exact: false }, "P4 ORDER_EXTRA 입고 105 → 0~5")
eq(pend(line({ planned: 110, allocated: 100, received: 110 })), { minQty: 0, maxQty: 0, exact: true }, "P5 전량 입고 → 0(정확)")
eq(pend(line({ planned: 100, allocated: 100, received: 0, planStatus: "CANCELLED" })), { minQty: 0, maxQty: 0, exact: true }, "P6 취소 계획은 미입고 충당 0")
const done = buildPlanLineView(line({ planned: 100, allocated: 100, received: 70, planStatus: "COMPLETED", receivable: 0 }))
ok(done.pendingPlannedReceiptQty === 0 && done.shortfallQty === 30 && done.counted, "P7 완료 계획에서 더 들어올 수량이 없으면 부족분(30)을 별도 표시(충당 합계에는 포함)")
const prod = buildPlanLineView(line({ planned: 110, allocated: 100, received: 60, planStatus: "COMPLETED", woQty: 110, receivable: 50 }))
ok(prod.pendingPlannedReceiptQty === 50 && prod.shortfallQty === 0 && prod.pendingAllocatedReceipt.minQty === 40 && prod.pendingAllocatedReceipt.maxQty === 50, "P9 작업지시 완료(생산 110)·입고 60: 미입고 50 이 남아 있음(완료 계획이어도 입고 대기분은 미입고)")
const short = buildPlanLineView(line({ planned: 110, allocated: 100, received: 100, planStatus: "COMPLETED", woQty: 110, receivable: 0 }))
ok(short.pendingPlannedReceiptQty === 0 && short.shortfallQty === 10 && short.pendingAllocatedReceipt.maxQty === 0 && short.pendingAllocatedReceipt.exact, "P10 작업지시가 100 만 생산하고 전량 입고: 더 들어올 것 없음(부족 10), 미입고 충당 0")
const unrel = buildPlanLineView(line({ planned: 110, allocated: 100, received: 0, planStatus: "CONFIRMED", woQty: 50, receivable: 50 }))
ok(unrel.pendingPlannedReceiptQty === 110 && unrel.pendingAllocatedReceipt.minQty === 100 && unrel.pendingAllocatedReceipt.exact, "P11 확정 계획: 작업지시 50 배정 + 미배정 60 = 미입고 예정 110")
const stock = buildPlanLineView(line({ planned: 200, allocated: 0, salesOrderItemId: null, productionKind: "STOCK", received: 50 }))
ok(stock.pendingAllocatedReceipt.maxQty === 0 && stock.pendingPlannedReceiptQty === 150 && stock.extraQty === 200, "P8 재고 생산: 충당 0·미입고 계획 150 (extraQty 필드는 계획−충당이지만 합계에서는 여유로 세지 않음)")

// A. 승인 표시
const ap = (s: PlanLineInput["extraApprovalStatus"]) => buildPlanLineView(line({ planned: 110, allocated: 100, extraApprovalStatus: s })).approval
ok(ap("PENDING").approved === false && ap("PENDING").needsAttention === true, "A1 PENDING 은 승인 완료가 아니다")
ok(ap("APPROVED").approved === true && ap("APPROVED").needsAttention === false, "A2 APPROVED 만 승인 완료")
ok(ap("REJECTED").approved === false && ap("REJECTED").needsAttention === true, "A3 REJECTED 는 승인 아님·확인 필요")
ok(ap("NOT_REQUIRED").approved === false && ap("NOT_REQUIRED").needsAttention === false, "A4 NOT_REQUIRED 는 승인 완료로 보지 않는다")
ok([ap("PENDING"), ap("APPROVED"), ap("NOT_REQUIRED")].every((a) => a.policyApplied === false), "A5 승인 정책 적용 여부는 항상 false(3단계 전)")

// O/C. 수주 품목
const order = (o: Partial<OrderItemInput> & { ordered: number; shipped?: number; shippedCol?: number }): OrderItemInput => ({
  salesOrderItemId: "soi", salesOrderId: "so", orderNo: "SO-1", orderStatus: "CONFIRMED", itemId: "item", itemCode: "FG", itemName: "fg", uom: "EA", isLotTracked: true,
  orderedQty: o.ordered, shippedQtyFromShipments: o.shipped ?? 0, shippedQtyColumn: o.shippedCol ?? o.shipped ?? 0,
})
const stk = (shippable: number, legacy = shippable, extra: Partial<ItemStockInput["breakdown"]> = {}) => buildItemStockView({
  stock: { itemId: "item", legacyAvailableQty: legacy, shippableQty: shippable, breakdown: { activeLotQty: shippable, excludedByLotStatus: {}, qualityBlockedQty: 0, plannedShipmentReservedQty: 0, unassignedForLotTrackedQty: 0, ...extra } },
  competingOutstandingQty: 0, competingOrderCount: 0, independentStockLines: [],
})
const view = (o: Parameters<typeof order>[0], lines: PlanLineInput[], st = stk(0)) => buildOrderItemQuantityView(order(o), lines, st)

const v1 = view({ ordered: 100 }, [])
ok(v1.outstandingQty === 100 && v1.allocatedQty === 0 && v1.unallocatedQty === 100 && v1.plannedQty === 0, "O1 수주 100·계획 없음")
const v2 = view({ ordered: 100 }, [line({ planned: 40, allocated: 40 })])
ok(v2.allocatedQty === 40 && v2.unallocatedQty === 60 && v2.shortage.proposed.shortageMinQty === 60 && v2.shortage.legacy.shortageQty === 100, "O2 충당 40: 미충당 60, 신규 부족 60 vs 기존 100")
const v3 = view({ ordered: 100 }, [line({ planned: 40, allocated: 40, planItemId: "a" }), line({ planned: 60, allocated: 60, planItemId: "b" })])
ok(v3.allocatedQty === 100 && v3.unallocatedQty === 0 && v3.shortage.suggestedAllocationQty.maxQty === 0 && v3.lines.length === 2, "O3 충당 40+60: 미충당 0, 추가 충당 제안 0")
const v4 = view({ ordered: 100 }, [line({ planned: 110, allocated: 100 })])
ok(v4.allocatedQty === 100 && v4.plannedQty === 110 && v4.extraQty === 10 && v4.unallocatedQty === 0, "O4 충당 100 + 여유 10 = 계획 110")
eq(v4.pendingAllocatedReceipt, { minQty: 100, maxQty: 100, exact: true }, "O4b 입고 전 미입고 충당 100")
const v5 = view({ ordered: 100 }, [line({ planned: 100, allocated: 100, planStatus: "CANCELLED" })])
ok(v5.allocatedQty === 0 && v5.plannedQty === 0 && v5.unallocatedQty === 100 && v5.lines[0].counted === false, "O5 취소 계획은 합계에서 제외(줄은 counted=false)")
const v6 = view({ ordered: 120 }, [line({ planned: 120, allocated: 120 })])
ok(v6.overAllocatedQty === 0, "O6 정상 충당은 초과 없음")
const v7 = view({ ordered: 100 }, [line({ planned: 70, allocated: 70, planItemId: "a" }), line({ planned: 50, allocated: 50, planItemId: "b" })])
ok(v7.overAllocatedQty === 20 && v7.unallocatedQty === 0 && v7.shortage.differenceCodes.includes("OVER_ALLOCATED_LEGACY_DATA"), "O7 충당 합계가 수주 수량 초과(비정상 데이터)면 표시")
const v8 = view({ ordered: 100, shipped: 30, shippedCol: 30 }, [line({ planned: 100, allocated: 100, received: 100 })], stk(70))
ok(v8.shippedQty === 30 && v8.outstandingQty === 70 && v8.shortage.proposed.shortageMinQty === 0 && v8.shortage.legacy.shortageQty === 0 && !v8.shippedQtySourceMismatch, "O8 부분 출하 30 후 미납 70, 재고 70 → 부족 0")
const v9 = view({ ordered: 100, shipped: 30, shippedCol: 50 }, [], stk(0))
ok(v9.shippedQtySourceMismatch && v9.shortage.differenceCodes.includes("SHIPPED_QTY_SOURCE_MISMATCH") && v9.outstandingQty === 70 && v9.shortage.legacy.remainingQty === 50, "O9 출하 수량 컬럼과 확정 출하 합이 다르면 표시(신규는 확정 출하 기준)")

// C. 중복 차감 방지·기존/신규 비교
const c1 = view({ ordered: 100 }, [line({ planned: 100, allocated: 100, received: 60 })], stk(60))
ok(c1.shortage.legacy.shortageQty === 40 && c1.shortage.proposed.shortageMinQty === 0 && c1.shortage.proposed.shortageMaxQty === 0 && c1.shortage.proposed.exact, "C1 입고 60(재고 60)+미입고 40: 기존 40 vs 신규 0 — 입고분은 재고에서만, 미입고는 계획에서만 차감(겹치지 않음)")
ok(c1.shortage.differenceCodes.includes("PENDING_ALLOCATION_NOT_IN_LEGACY") && c1.shortage.deltaMinQty === -40, "C1b 차이 사유와 델타")
const naive = Math.max(0, 100 - 60 - 100) // 입고된 계획 수량까지 전체 충당(100)으로 차감하면 입고분 60 이 재고와 계획에서 이중 차감된다
ok(naive === 0 && c1.shortage.proposed.shortageMinQty === 0, "C2 (참고) 단순히 재고와 전체 충당을 동시에 빼면 100−60−100 으로 −60 만큼 이중 차감 — 모델은 미입고 40 만 뺀다")
const c3 = view({ ordered: 100 }, [line({ planned: 110, allocated: 100, received: 60 })], stk(20))
ok(c3.shortage.proposed.shortageMinQty === 30 && c3.shortage.proposed.shortageMaxQty === 40 && !c3.shortage.proposed.exact && c3.shortage.differenceCodes.includes("PENDING_ALLOCATION_RANGE"), "C3 ORDER_EXTRA 부분 입고: 부족수량도 구간(30~40)으로 내고 하나로 추정하지 않음")
ok(c3.shortage.suggestedAllocationQty.maxQty === 0, "C3b 충당 잔량이 0 이므로 추가 충당 제안 0")
const c4 = view({ ordered: 100 }, [], stk(40, 100, { plannedShipmentReservedQty: 10, qualityBlockedQty: 20 }))
ok(c4.shortage.legacy.shortageQty === 0 && c4.shortage.proposed.shortageMinQty === 60 && c4.shortage.differenceCodes.includes("STOCK_RESERVED_BY_PLANNED_SHIPMENT") && c4.shortage.differenceCodes.includes("STOCK_BLOCKED_BY_QUALITY_GATE"), "C4 격리·품질·예정출하 예약을 제외한 재고로 계산하면 기존(0)과 신규(60)가 갈린다")
const c5 = buildItemStockView({ stock: { itemId: "item", legacyAvailableQty: 80, shippableQty: 50, breakdown: { activeLotQty: 60, excludedByLotStatus: { QUARANTINE: 20 }, qualityBlockedQty: 0, plannedShipmentReservedQty: 10, unassignedForLotTrackedQty: 0 } }, competingOutstandingQty: 70, competingOrderCount: 2, independentStockLines: [line({ planned: 200, allocated: 0, salesOrderItemId: null, productionKind: "STOCK", received: 50 })] })
ok(c5.reservation.supported === false && c5.reservation.reservedForThisOrder === null && c5.competingOutstandingQty === 70 && c5.independentStockPendingQty === 150 && c5.breakdown.excludedByLotStatus.QUARANTINE === 20, "C5 재고 예약 없음 표시·경합 수주 미납·독립 재고 생산 미입고·LOT 상태별 제외")

// T. 합계·유형 요약
const t = sumPlanLines([line({ planned: 110, allocated: 100, planItemId: "a" }), line({ planned: 200, allocated: 0, salesOrderItemId: null, productionKind: "STOCK", planItemId: "b" }), line({ planned: 30, allocated: 30, planStatus: "CANCELLED", planItemId: "c" })].map(buildPlanLineView))
ok(t.plannedQty === 310 && t.allocatedQty === 100 && t.extraQty === 10 && t.stockProductionQty === 200 && t.lineCount === 2, "T1 합계: 취소 제외, 여유 10 은 수주 연결 줄만, 재고 생산 200 은 별도")
const pv = buildPlanQuantityView({ planId: "p", planNo: "PP", planStatus: "DRAFT" }, [line({ planned: 110, allocated: 100, planItemId: "a" }), line({ planned: 200, allocated: 0, salesOrderItemId: null, productionKind: "STOCK", planItemId: "b" })], new Map([["soi", order({ ordered: 100 })]]), new Map([["soi", BigInt(100_000_000)]]))
ok(pv.kindSummary === "MIXED" && pv.lines[0].order?.allocatedByOtherLinesQty === 0 && pv.lines[0].order?.allocatableMoreQty === 0 && pv.lines[1].order === null, "T2 계획 화면 모델: 혼합 유형·수주 맥락(다른 줄 충당·추가 충당 가능)")
const pv2 = buildPlanQuantityView({ planId: "p", planNo: "PP", planStatus: "DRAFT" }, [line({ planned: 40, allocated: 40, planItemId: "a" })], new Map([["soi", order({ ordered: 100 })]]), new Map([["soi", BigInt(100_000_000)]]))
ok(pv2.lines[0].order?.allocatedByOtherLinesQty === 60 && pv2.lines[0].order?.allocatableMoreQty === 0 && pv2.kindSummary === "ORDER", "T3 동일 수주 다른 계획 충당 60 은 '다른 줄 충당'으로 분리")
const dec = buildPlanLineView(line({ planned: 0.3, allocated: 0.1 }))
ok(dec.extraQty === 0.2, "T4 소수 수량 정확 계산(0.3−0.1=0.2)")

console.log(`\n${passed} checks passed`)
