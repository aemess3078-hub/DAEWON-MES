/**
 * Phase 5E — 반제품 Netting 근거 화면 렌더링 테스트 (SSR 정적 렌더, 브라우저/DB 없음)
 *
 * 실행: npm run test:mrp-semi-netting-ui
 */
import assert from "node:assert/strict"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MaterialRows } from "../src/app/app/mes/mrp/material-rows"
import { PeriodRequirementTable } from "../src/app/app/mes/mrp/period-requirement-table"
import type { OrderMrpMaterialView, OrderMrpStepView } from "../src/lib/mrp/order-mrp-adapter"

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log("PASS " + label)
}

const step = (over: Partial<OrderMrpStepView>): OrderMrpStepView => ({
  sequence: 1,
  orderId: "o1",
  orderNo: "SO-1",
  orderLineId: "l1",
  customerName: "고객사",
  itemCode: "FG-A",
  itemName: "제품A",
  deliveryDate: "2026-10-12",
  demandQty: 10,
  bomQtyPerUnit: 2,
  requirement: 20,
  balanceBefore: 8,
  balanceAfter: -12,
  shortageAtThisDemand: 12,
  isShortage: true,
  ...over,
})

function material(over: Partial<OrderMrpMaterialView>): OrderMrpMaterialView {
  return {
    componentItemId: "x",
    code: "X",
    name: "자재",
    spec: null,
    uom: "EA",
    itemType: "RAW_MATERIAL",
    qtyOnHand: 0,
    qtyHold: 0,
    qtyAvailable: 0,
    qtyExcludedByLot: 0,
    totalRequirement: 0,
    finalBalance: 0,
    shortageQty: 0,
    firstShortageDate: null,
    firstShortageOrderNo: null,
    shortageDemandCount: 0,
    shortageOrderNos: [],
    demandLineCount: 1,
    productCount: 1,
    firstNeedDate: "2026-10-12",
    lastNeedDate: "2026-10-12",
    steps: [],
    scheduledReceiptQty: 0,
    scheduledReceiptCount: 0,
    nextReceiptDate: null,
    hadShortage: false,
    peakShortageQty: 0,
    temporaryShortage: false,
    shortageRecoveredAt: null,
    overdueReceiptQty: 0,
    overdueReceiptCount: 0,
    timeline: [],
    ...over,
  }
}

const render = (m: OrderMrpMaterialView, open: boolean, receipts = false) =>
  renderToStaticMarkup(
    <table>
      <tbody>
        <MaterialRows m={m} open={open} onToggle={() => {}} receipts={receipts} colCount={receipts ? 17 : 13} />
      </tbody>
    </table>
  )

// 반제품 행 (총 20 / 가용 8 / 사용 8 / 순소요 12)
const semi = material({
  componentItemId: "sf",
  code: "SF-1",
  name: "반제품1",
  itemType: "SEMI_FINISHED",
  qtyOnHand: 8,
  qtyAvailable: 8,
  totalRequirement: 20,
  finalBalance: -12,
  shortageQty: 12,
  netting: { grossQty: 20, usedQty: 8, netQty: 12 },
  steps: [step({ semiNetting: { grossQty: 20, usedQty: 8, netQty: 12 } })],
})
{
  const closed = render(semi, false)
  ok(closed.includes("반제품 재고 8 사용 → 순소요 12"), "반제품 행: 재고 사용 → 순소요 요약")
  const html = render(semi, true)
  ok(html.includes("반제품 Netting") && html.includes("총 필요 20") && html.includes("가용재고 8") && html.includes("8 사용") && html.includes("순소요 12"), "반제품 상세: 총 필요 / 가용 / 사용 / 순소요")
  ok(html.includes("총 필요 20 − 재고 사용 8 = ") && html.includes("순소요 12"), "수주별 근거 열: 총 필요 − 재고 사용 = 순소요")
}

// 원자재 행: 상위 반제품 순소요 × 1단위당 소요 = 소요
const raw = material({
  componentItemId: "rm",
  code: "RM-1",
  name: "원자재1",
  totalRequirement: 36,
  finalBalance: -36,
  shortageQty: 36,
  steps: [
    step({
      requirement: 36,
      balanceBefore: 0,
      balanceAfter: -36,
      shortageAtThisDemand: 36,
      netting: [{ parentCode: "SF-1", parentGross: 20, parentUsed: 8, parentNet: 12, qtyPer: 3, requirement: 36 }],
    }),
  ],
})
{
  const html = render(raw, true)
  ok(html.includes("SF-1") && html.includes("총 20 − 재고 8 = 순소요 12 × 3 = ") && html.includes("36"), "원자재 상세: 반제품 SF-1 총 20 − 재고 8 = 순소요 12 × 3 = 36")
  const plain = render(material({ componentItemId: "r", code: "R", totalRequirement: 5, steps: [step({ requirement: 5 })] }), true)
  ok(!plain.includes("반제품 Netting"), "Netting 이 없는 자재는 기존 화면 그대로")
}

// 입고예정 시간축 보기에서도 근거 표시
{
  const html = render(
    material({
      ...raw,
      timeline: [
        { type: "DEMAND", date: "2026-10-12", referenceNo: "SO-1", partyName: "고객사", itemCode: "FG-A", quantity: 36, signedQuantity: -36, balanceBefore: 0, balanceAfter: -36, isShortage: true, sequence: 1 },
      ],
    }),
    true,
    true
  )
  ok(html.includes("입고·수요 시간축") && html.includes("반제품 Netting 근거") && html.includes("순소요 12"), "시간축 보기에서도 반제품 Netting 근거를 표시")
}

// 기간 예상소요량
{
  const html = renderToStaticMarkup(<PeriodRequirementTable rows={[raw, semi]} expanded="sf" onToggle={() => {}} />)
  ok(html.includes("반제품 Netting: 총 필요 20 − 재고 사용 8 = 순소요 12"), "기간 예상소요량: 반제품 Netting 요약")
  const expandedRaw = renderToStaticMarkup(<PeriodRequirementTable rows={[raw]} expanded="rm" onToggle={() => {}} />)
  ok(expandedRaw.includes("순소요") && expandedRaw.includes("전개해 계산했습니다"), "기간 예상소요량: 원자재가 순소요 기반임을 안내")
}

console.log(`\n✅ mrp-semi-netting-ui: ${passed} checks passed`)
