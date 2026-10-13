/**
 * Phase 5C — 발주제안 표 컴포넌트 렌더링 테스트 (SSR 정적 렌더, 브라우저/DB/네트워크 없음)
 *
 * 실행: npm run test:mrp-purchase-suggestion-ui
 */
import assert from "node:assert/strict"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { parseQty, PurchaseSuggestionTable, type SuggestionRowEdit } from "../src/app/app/mes/mrp/purchase-suggestion-table"
import type { PurchaseSuggestionRow, SupplierChoice } from "../src/lib/mrp/purchase-suggestion"

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

function row(over: Partial<PurchaseSuggestionRow>): PurchaseSuggestionRow {
  return {
    componentItemId: "r1",
    code: "R1",
    name: "자재1",
    spec: "규격1",
    uom: "EA",
    kind: "FINAL_SHORTAGE",
    qtyAvailable: 0,
    totalRequirement: 60,
    scheduledReceiptQty: 0,
    peakShortageQty: 60,
    finalShortageQty: 60,
    suggestedQty: 60,
    requiredDate: "2026-10-12",
    firstShortageOrderNo: "SO-1",
    shortageRecoveredAt: null,
    nextReceiptDate: null,
    recommendedSupplierId: "s1",
    supplierReason: "DEFAULT",
    suppliers: [
      choice("s1", "가나공급", { isDefault: true, price: { unitPrice: 100, currency: "KRW", effectiveFrom: "2026-01-01" } }),
      choice("s2", "다라상사", { priority: 5 }),
    ],
    draftOpenQty: 0,
    ...over,
  }
}
const edit = (over: Partial<SuggestionRowEdit> = {}): SuggestionRowEdit => ({
  selected: false,
  qty: "60",
  supplierId: "s1",
  requiredDate: "2026-10-12",
  ...over,
})
const render = (rows: PurchaseSuggestionRow[], edits: Record<string, SuggestionRowEdit>, priceVisible = true) =>
  renderToStaticMarkup(
    <PurchaseSuggestionTable rows={rows} edits={edits} priceVisible={priceVisible} onChange={() => {}} onToggleAll={() => {}} />
  )

// U1: 최종 부족 + 기본 공급업체 + 단가
{
  const html = render([row({})], { r1: edit({ selected: true }) })
  ok(html.includes("최종 부족"), "U1 상태: 최종 부족")
  ok(html.includes("기본 공급업체"), "U1 추천 사유: 기본 공급업체")
  ok(html.includes("100 KRW"), "U1 선택 공급업체의 단가 표시")
  ok(html.includes('value="60"'), "U1 제안수량 입력 기본값")
  ok(html.includes("2026-10-12"), "U1 결품예정일/목표입고일")
  ok(html.includes("가나공급 (기본)"), "U1 공급업체 선택 목록(기본 표시)")
  ok(html.includes('aria-label="R1 선택"') && /aria-label="R1 선택"[^>]*checked|checked=""[^>]*aria-label="R1 선택"/.test(html), "U1 선택 체크")
}

// U2: 일시 결품 — 자동 제안 없음, 검토 문구
{
  const r = row({
    componentItemId: "r2",
    code: "R2",
    kind: "TEMPORARY_SHORTAGE",
    suggestedQty: 0,
    peakShortageQty: 10,
    finalShortageQty: 0,
    shortageRecoveredAt: "2026-10-15",
    supplierReason: "LOWEST_PRIORITY",
  })
  const html = render([r], { r2: edit({ qty: "" }) })
  ok(html.includes("일시 결품"), "U2 상태: 일시 결품")
  ok(html.includes("납기 당김 / 긴급조달 검토"), "U2 검토 안내(납기 당김/긴급조달)")
  ok(html.includes("2026-10-15 입고로 해소"), "U2 회복일")
  ok(html.includes("기본 0"), "U2 제안수량 기본 0 안내")
  ok(html.includes('value=""'), "U2 수량 입력 비어 있음(자동 제안 없음)")
}

// U3: 공급업체 없음 / 불명확
{
  const none = row({ componentItemId: "r4", code: "R4", suppliers: [], recommendedSupplierId: null, supplierReason: "NONE" })
  const amb = row({
    componentItemId: "r3",
    code: "R3",
    recommendedSupplierId: null,
    supplierReason: "AMBIGUOUS_PRIORITY",
    peakShortageQty: 10,
    finalShortageQty: 5,
    suggestedQty: 10,
  })
  const html = render([none, amb], { r4: edit({ supplierId: null }), r3: edit({ supplierId: null, qty: "10" }) })
  ok(html.includes("공급업체 미지정"), "U3 공급업체 미지정 Badge")
  ok(html.includes("품목관리 &gt; 공급업체 관리에서 등록하세요"), "U3 등록 안내")
  ok(html.includes("등록된 공급업체 없음"), "U3 선택 목록 비활성")
  ok(html.includes("최우선 공급업체가 불명확합니다"), "U3 동률 안내(자동 선택 안 함)")
  ok(html.includes("최대결품 기준(최종부족 5)"), "U3 peak > final 설명")
}

// U4: 단가 권한 없음 / 단가 미등록 / DRAFT 참고
{
  const html = render([row({ draftOpenQty: 40 })], { r1: edit() }, false)
  ok(!html.includes("100 KRW"), "U4 단가 권한 없음: 단가 숨김")
  ok(html.includes("DRAFT 발주 40EA 존재"), "U4 DRAFT 발주 참고 정보(입고예정 미반영)")
  const noPrice = render([row({})], { r1: edit({ supplierId: "s2" }) })
  ok(noPrice.includes("단가 미등록"), "U4 선택 공급업체 단가 미등록 표시(다른 공급업체 단가 사용 안 함)")
  ok(!noPrice.includes("100 KRW"), "U4 다른 공급업체(s1) 단가를 s2 에 표시하지 않음")
}

// U5: 수량 파싱
{
  ok(parseQty("12.5") === 12.5 && parseQty("1,200") === 1200, "U5 수량 파싱(소수/천단위)")
  ok(parseQty("") === null && parseQty("0") === null && parseQty("-3") === null && parseQty("abc") === null, "U5 0/음수/빈값/문자 거부")
}

console.log(`\n✅ mrp-purchase-suggestion-ui: ${passed} checks passed`)
