/**
 * 생산계획 MRP 발주제안 / 행 검증 / 입력 정규화 단위 테스트 (순수 모듈 — DB·네트워크 없음)
 *
 * 실행: npm run test:mrp-plan-purchase
 * 실제 DB 에서의 생성·멱등·중복 방지·교차 검증은 scripts/db-it/18-mrp-plan-purchase.ts 가 한다.
 */
import assert from "node:assert/strict"
import { aggregateDraftCoverage } from "../src/lib/mrp/draft-coverage"
import { buildPlanMrpRunSnapshot } from "../src/lib/mrp/mrp-run-snapshot"
import { buildPlanPurchaseSuggestionRows, type PlanMrpMaterial } from "../src/lib/mrp/plan-purchase-suggestion"
import { parseQtyInput, rowCoveredByDraft, validateRowEdit } from "../src/lib/mrp/purchase-row-validation"
import type { SupplierCandidateInput } from "../src/lib/mrp/purchase-suggestion"
import { computeDraftRequestHash, normalizeDraftPoInput } from "../src/lib/services/mrp-purchase-draft.service"

let passed = 0
function eq<T>(actual: T, expected: T, label: string) {
  assert.deepStrictEqual(actual, expected, label)
  passed += 1
  console.log("PASS " + label)
}
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log("PASS " + label)
}

const mat = (over: Partial<PlanMrpMaterial>): PlanMrpMaterial => ({
  itemId: "i1",
  itemCode: "RM-1",
  itemName: "강관",
  uom: "EA",
  grossRequirement: 100,
  currentStock: 20,
  availableStock: 20,
  onOrder: 10,
  netRequirement: 70,
  ...over,
})
const sup = (id: string, over: Partial<SupplierCandidateInput> = {}): SupplierCandidateInput => ({
  supplierId: id,
  supplierCode: id.toUpperCase(),
  supplierName: "공급" + id,
  isDefault: false,
  priority: 100,
  leadTimeDays: 5,
  moq: null,
  orderMultiple: null,
  ...over,
})
const build = (materials: PlanMrpMaterial[], suppliers: Record<string, SupplierCandidateInput[]>, cov: Array<{ itemId: string; supplierId: string; orderNo: string; openQty: number }> = [], planStartDate = "2026-11-20") =>
  buildPlanPurchaseSuggestionRows({
    materials,
    planStartDate,
    baseDate: "2026-11-12",
    suppliersByItem: new Map(Object.entries(suppliers)),
    prices: new Map([["i1|a", { unitPrice: 100, currency: "KRW", effectiveFrom: "2026-01-01" }]]),
    draftCoverage: aggregateDraftCoverage(cov),
  })

// ── P1: 행 변환(기존 계산값 그대로) ──
{
  const rows = build([mat({}), mat({ itemId: "i2", itemCode: "RM-2", netRequirement: 0 }), mat({ itemId: "i3", itemCode: "RM-3", netRequirement: -5 })], { i1: [sup("a", { isDefault: true, moq: 50, orderMultiple: 10 })] })
  eq(rows.map((r) => r.code), ["RM-1"], "P1 순소요량 > 0 인 자재만 행으로 나온다")
  const r = rows[0]
  eq([r.totalRequirement, r.qtyAvailable, r.scheduledReceiptQty, r.rawSuggestedQty, r.finalShortageQty], [100, 20, 10, 70, 70], "P1 소요량/가용재고/발주중/부족수량은 기존 계산값 그대로")
  eq([r.suggestedQty, r.moqApplied, r.multipleApplied], [70, false, false], "P1 MOQ 50 · 배수 10: 70 은 이미 조건 충족 → 70 그대로")
  eq([r.requiredDate, r.baseDate, r.orderByDate, r.orderTiming], ["2026-11-20", "2026-11-12", "2026-11-15", "OK"], "P1 목표입고일=계획 시작일, 발주 필요일=목표−리드타임(5일)")
  eq([r.safetyStock, r.finalBalance, r.kind, r.breachKind], [0, -70, "FINAL_SHORTAGE", "SHORTAGE"], "P1 안전재고 미사용(기존 계산), 최종 부족")
  eq(r.suppliers.find((s) => s.supplierId === "a")?.price?.unitPrice, 100, "P1 공급업체별 단가 연결")
}

// ── P2: 구매조건 올림 / 공급업체 추천 ──
{
  const r = build([mat({ netRequirement: 17 })], { i1: [sup("a", { isDefault: true, moq: 100, orderMultiple: 10 })] })[0]
  eq([r.suggestedQty, r.moqApplied], [100, true], "P2 필요 17 → MOQ 100")
  const r2 = build([mat({ netRequirement: 123 })], { i1: [sup("a", { isDefault: true, moq: 20, orderMultiple: 50 })] })[0]
  eq(r2.suggestedQty, 150, "P2 필요 123 → 배수 50 올림 150")
  const none = build([mat({})], {})[0]
  eq([none.supplierReason, none.recommendedSupplierId, none.suggestedQty], ["NONE", null, 70], "P2 공급업체 없음: 자동 선택 없음, 구매조건 미적용")
  const amb = build([mat({})], { i1: [sup("a"), sup("b")] })[0]
  eq([amb.supplierReason, amb.recommendedSupplierId], ["AMBIGUOUS_PRIORITY", null], "P2 동률 priority 는 자동 선택하지 않음")
}

// ── P3: DRAFT Coverage(중복 발주 방지) ──
{
  const suppliers = { i1: [sup("a", { isDefault: true, moq: 50, orderMultiple: 10 })] }
  const partial = build([mat({})], suppliers, [{ itemId: "i1", supplierId: "a", orderNo: "PO-1", openQty: 30 }])[0]
  eq([partial.draftCoverageQty, partial.remainingRawNeed, partial.additionalQty, partial.coverageStatus], [30, 40, 50, "PARTIAL"], "P3 필요 70 − DRAFT 30 = 40 → MOQ 50")
  eq(partial.rawSuggestedQty, 70, "P3 정책 필요량(raw)은 DRAFT 로 바뀌지 않음")
  const covered = build([mat({})], suppliers, [{ itemId: "i1", supplierId: "b", orderNo: "PO-2", openQty: 80 }])[0]
  eq([covered.remainingRawNeed, covered.additionalQty, covered.coverageStatus], [0, 0, "COVERED"], "P3 다른 공급업체 DRAFT 도 품목 전체 Coverage 로 충족 처리")
  eq(covered.draftOrders.map((o) => o.orderNo), ["PO-2"], "P3 기존 DRAFT 발주번호 표시")
}

// ── P4: 목표입고일 ──
{
  const past = build([mat({})], { i1: [sup("a", { isDefault: true })] }, [], "2026-11-01")[0]
  eq([past.requiredDate, past.orderTiming], ["2026-11-12", "OVERDUE"], "P4 계획 시작일이 지났으면 오늘 기준(즉시 필요) — 리드타임 5일이면 발주 필요일 경과")
  const noLead = build([mat({})], { i1: [sup("a", { isDefault: true, leadTimeDays: 0 })] }, [], "2026-11-01")[0]
  eq([noLead.requiredDate, noLead.orderTiming], ["2026-11-12", "DUE_TODAY"], "P4 리드타임 0 이면 오늘 발주 필요")
}

// ── V: 행 검증(표/패널/서버 같은 규칙) ──
{
  const r = build([mat({})], { i1: [sup("a", { isDefault: true, moq: 50, orderMultiple: 10 }), sup("b", { moq: 100 })] })[0]
  const e = (over = {}) => ({ qty: "70", supplierId: "a", override: false, overrideReason: "", ...over })
  eq(validateRowEdit(r, e()), null, "V1 정상 입력은 문제 없음")
  eq(validateRowEdit(r, e({ qty: "" }))?.code, "QTY", "V2 수량 없음")
  eq(validateRowEdit(r, e({ qty: "0" }))?.code, "QTY", "V2 수량 0")
  eq(validateRowEdit(r, e({ supplierId: null }))?.code, "SUPPLIER", "V3 공급업체 미선택")
  eq(validateRowEdit(r, e({ supplierId: "zzz" }))?.code, "SUPPLIER_INVALID", "V4 등록되지 않은 공급업체")
  eq(validateRowEdit(r, e({ qty: "40" }))?.code, "TERMS", "V5 MOQ 미달")
  eq(validateRowEdit(r, e({ qty: "75" }))?.code, "TERMS", "V6 발주배수 위반")
  eq(validateRowEdit(r, e({ supplierId: "b", qty: "70" }))?.code, "TERMS", "V7 공급업체 변경 시 그 공급업체 MOQ(100)로 검증")
  const covered = build([mat({})], { i1: [sup("a", { isDefault: true })] }, [{ itemId: "i1", supplierId: "a", orderNo: "PO-1", openQty: 100 }])[0]
  ok(rowCoveredByDraft(covered, "a"), "V8 DRAFT 로 충족된 행 판정")
  eq(validateRowEdit(covered, { qty: "10", supplierId: "a" })?.code, "OVERRIDE_CONFIRM", "V8 충족 행은 추가 발주 확인 필요")
  eq(validateRowEdit(covered, { qty: "10", supplierId: "a", override: true, overrideReason: "  " })?.code, "OVERRIDE_REASON", "V8 사유 공백 거부")
  eq(validateRowEdit(covered, { qty: "10", supplierId: "a", override: true, overrideReason: "긴급" }), null, "V8 확인 + 사유가 있으면 통과")
  const legacyRow = { suppliers: r.suppliers }
  ok(!rowCoveredByDraft(legacyRow, "a"), "V9 Coverage 정보가 없는 행은 중복 판정 대상 아님")
  eq([parseQtyInput("1,200"), parseQtyInput("12.5"), parseQtyInput("-3"), parseQtyInput("abc")], [1200, 12.5, null, null], "V10 수량 파싱")
}

// ── N: 입력 정규화 / 요청 해시 ──
{
  const line = { itemId: "i1", supplierId: "a", qty: 70, requiredDate: "2026-11-20" }
  const base = { requestKey: "req-key-0001", planId: "plan-1", lines: [line], siteId: "s1" }
  const n1 = normalizeDraftPoInput(base)
  ok(n1.ok && n1.history.planId === "plan-1" && n1.history.mrp === null && n1.history.runId === null, "N1 planId 근거를 정규화한다")
  ok(!normalizeDraftPoInput({ ...base, runId: "r1" }).ok, "N2 planId + runId 는 거부")
  ok(!normalizeDraftPoInput({ ...base, mrp: { from: null, to: null, includeDraft: false } }).ok, "N2 planId + mrp 파라미터는 거부")
  ok(!normalizeDraftPoInput({ ...base, planId: "" }).ok, "N3 빈 planId 는 거부")
  ok(!normalizeDraftPoInput({ ...base, planId: 123 as unknown as string }).ok, "N3 planId 형식 오류 거부")
  const nA = normalizeDraftPoInput(base)
  const nB = normalizeDraftPoInput({ ...base, planId: "plan-2" })
  if (nA.ok && nB.ok) {
    ok(computeDraftRequestHash(nA) !== computeDraftRequestHash(nB), "N4 계획이 다르면 요청 해시가 다르다(같은 키 재사용 불일치 검출)")
    const nC = normalizeDraftPoInput({ ...base, requestKey: "other-key-0002" })
    ok(nC.ok && computeDraftRequestHash(nC) === computeDraftRequestHash(nA), "N4 요청 키는 해시에 포함되지 않는다(같은 의미의 요청은 같은 해시)")
  }
}

// ── S: 생산계획 Snapshot ──
{
  const rows = build([mat({}), mat({ itemId: "i2", itemCode: "RM-2" })], { i1: [sup("a", { isDefault: true })] })
  const args = { rows, planId: "p1", planNo: "PP-1", baseDate: "2026-11-12", planStartDate: "2026-11-20", planEndDate: "2026-12-01", materialCount: 5, generatedAt: new Date("2026-11-12T03:00:00Z") }
  const b1 = buildPlanMrpRunSnapshot(args)
  const b2 = buildPlanMrpRunSnapshot({ ...args, generatedAt: new Date("2026-11-12T05:00:00Z") })
  eq([b1.snapshot.meta.runType, b1.columns.materialCount, b1.columns.shortageMaterialCount, b1.suggestionRows.length], ["PLAN_MRP", 5, 2, 2], "S1 PLAN_MRP Snapshot 요약")
  eq([b1.sourceHash, b1.resultHash], [b2.sourceHash, b2.resultHash], "S2 생성 시각이 달라도 해시는 같다(결정적)")
  eq(b1.suggestionRows[0].rawNeed, 70, "S3 제안 행의 정책 필요량(rawNeed) 저장")
  ok(!/(password|token|DATABASE_URL|tenantId)/i.test(JSON.stringify(b1.snapshot)), "S4 Snapshot 에 비밀/tenantId 없음")
  ok(b1.snapshot.materials.length === 0 && b1.snapshot.suggestions.length === 2, "S5 경량 Snapshot(자재 시간축 없음, 제안 행만)")
}

console.log(`\n✅ mrp-plan-purchase: ${passed} checks passed`)
