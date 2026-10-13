/**
 * Phase 5D — 발주제안 표(안전재고/구매조건/발주 필요일) 렌더링 테스트 (SSR 정적 렌더, 브라우저/DB 없음)
 *
 * 실행: npm run test:mrp-purchase-policy-ui
 */
import assert from "node:assert/strict"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { PurchaseSuggestionTable, type SuggestionRowEdit, type SuggestionTableRow } from "../src/app/app/mes/mrp/purchase-suggestion-table"
import type { SupplierChoice } from "../src/lib/mrp/purchase-suggestion"

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log("PASS " + label)
}

const choice = (id: string, name: string, over: Partial<SupplierChoice> = {}): SupplierChoice => ({
  supplierId: id,
  supplierCode: id.toUpperCase(),
  supplierName: name,
  isDefault: false,
  priority: 100,
  leadTimeDays: null,
  moq: null,
  orderMultiple: null,
  price: null,
  ...over,
})

function row(over: Partial<SuggestionTableRow>): SuggestionTableRow {
  return {
    componentItemId: "r1",
    code: "R1",
    name: "자재1",
    spec: null,
    uom: "EA",
    kind: "SAFETY_STOCK_SHORTAGE",
    qtyAvailable: 100,
    totalRequirement: 90,
    scheduledReceiptQty: 0,
    peakShortageQty: 0,
    finalShortageQty: 0,
    suggestedQty: 100,
    requiredDate: "2026-10-20",
    firstShortageOrderNo: null,
    shortageRecoveredAt: null,
    nextReceiptDate: null,
    recommendedSupplierId: "sa",
    supplierReason: "DEFAULT",
    suppliers: [
      choice("sa", "가나공급", { isDefault: true, leadTimeDays: 7, moq: 100, orderMultiple: 50, price: { unitPrice: 100, currency: "KRW", effectiveFrom: "2026-01-01" } }),
      choice("sb", "다라상사", { priority: 5, leadTimeDays: 3, moq: 20, orderMultiple: 10, price: { unitPrice: 120, currency: "KRW", effectiveFrom: "2026-01-01" } }),
    ],
    draftOpenQty: 0,
    // Phase 5D
    safetyStock: 20,
    openingStock: 100,
    finalBalance: 10,
    minProjectedBalance: 10,
    finalTargetDeficit: 10,
    peakTargetDeficit: 17,
    rawSuggestedQty: 17,
    breachKind: "DEMAND",
    firstBreachOrderNo: "SO-1",
    leadTimeDays: 7,
    moq: 100,
    orderMultiple: 50,
    moqApplied: true,
    multipleApplied: false,
    termsInvalid: false,
    orderByDate: "2026-10-13",
    orderTiming: "OK",
    orderOverdueDays: 0,
    baseDate: "2026-10-01",
    ...over,
  }
}
const edit = (over: Partial<SuggestionRowEdit> = {}): SuggestionRowEdit => ({
  selected: false,
  qty: "100",
  supplierId: "sa",
  requiredDate: "2026-10-20",
  ...over,
})
const render = (rows: SuggestionTableRow[], edits: Record<string, SuggestionRowEdit>) =>
  renderToStaticMarkup(
    <PurchaseSuggestionTable rows={rows} edits={edits} priceVisible onChange={() => {}} onToggleAll={() => {}} />
  )

// U1: 안전재고 부족 + 구매조건 + 발주 필요일
{
  const html = render([row({})], { r1: edit() })
  ok(html.includes("안전재고 부족"), "U1 상태: 안전재고 부족")
  ok(html.includes("안전재고") && html.includes("최저 예상") && html.includes("최종 예상") && html.includes("발주 필요일"), "U1 정책 컬럼(안전재고/최저·최종 예상/발주 필요일)")
  ok(html.includes("LT 7일") && html.includes("MOQ") && html.includes("배수"), "U1 공급업체 구매조건(LT/MOQ/배수) 표시")
  ok(html.includes("정책 필요량 17") && html.includes("MOQ 100"), "U1 산식: 정책 필요량 17 → MOQ 100")
  ok(html.includes("2026-10-13") && html.includes("여유 12일"), "U1 발주 필요일 10/13 · 여유 12일")
  ok(html.includes("100 KRW"), "U1 선택 공급업체 단가")
}

// U2: 공급업체 변경 → 구매조건/발주 필요일/단가가 B 기준
{
  const html = render([row({})], { r1: edit({ supplierId: "sb", qty: "20" }) })
  ok(html.includes("LT 3일"), "U2 B 선택: 리드타임 3일(A 의 7일 아님)")
  ok(html.includes("2026-10-17"), "U2 B 선택: 발주 필요일 10/17")
  ok(html.includes("120 KRW") && !html.includes("100 KRW"), "U2 B 선택: B 단가만 표시")
  ok(html.includes("정책 필요량 17") && html.includes("MOQ 20") && html.includes("배수 올림 20") === false, "U2 B 산식: 17 → MOQ 20 (배수 10 이미 충족)")
}

// U3: 수동 수량이 구매조건 위반이면 경고
{
  const html = render([row({})], { r1: edit({ supplierId: "sb", qty: "25" }) })
  ok(html.includes("배수 10의 배수가 아닙니다"), "U3 수동 수량 25: 배수 위반 경고")
  const low = render([row({})], { r1: edit({ supplierId: "sa", qty: "60" }) })
  ok(low.includes("최소발주수량(MOQ) 100 미만"), "U3 수동 수량 60: MOQ 미달 경고")
}

// U4: 리드타임 미등록 / 발주 필요일 경과
{
  const noLt = row({ suppliers: [choice("sa", "가나공급", { isDefault: true })] })
  const html = render([noLt], { r1: edit() })
  ok(html.includes("리드타임 미등록"), "U4 리드타임 미등록 표시")
  ok(html.includes("MOQ") && html.includes("없음"), "U4 MOQ/배수 없음 표시")

  const overdue = render([row({ requiredDate: "2026-10-04" })], { r1: edit({ requiredDate: "2026-10-04" }) })
  ok(overdue.includes("2026-09-27") && overdue.includes("4일 경과"), "U4 발주 필요일 9/27 · 4일 경과")
  ok(overdue.includes("발주 필요일 경과") && overdue.includes("긴급조달/납기협의"), "U4 발주 필요일 경과 Badge + 긴급조달/납기협의 안내")
}

// U5: 일시 미달 — 자동 제안 없음
{
  const r = row({ kind: "SAFETY_STOCK_TEMPORARY", suggestedQty: 0, rawSuggestedQty: 0, finalTargetDeficit: 0, peakTargetDeficit: 10, finalBalance: 40, minProjectedBalance: 10, shortageRecoveredAt: null })
  const html = render([r], { r1: edit({ qty: "" }) })
  ok(html.includes("안전재고 일시 미달"), "U5 상태: 안전재고 일시 미달")
  ok(html.includes("납기 당김 / 긴급조달 검토") && html.includes("기본 0"), "U5 검토 안내 + 제안수량 기본 0")
}

// U6: 안전재고 0 이면 안전재고 컬럼 값이 '-' (5C 의미 유지)
{
  const r = row({ kind: "FINAL_SHORTAGE", safetyStock: 0, minProjectedBalance: -60, finalBalance: -60, peakShortageQty: 60, finalShortageQty: 60 })
  const html = render([r], { r1: edit() })
  ok(html.includes("최종 부족"), "U6 안전재고 0: 최종 부족 상태 유지")
}

console.log(`\n✅ mrp-purchase-policy-ui: ${passed} checks passed`)
