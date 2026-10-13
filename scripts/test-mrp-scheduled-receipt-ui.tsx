/**
 * Phase 5B — 수주기준 MRP 화면 컴포넌트 렌더링 테스트 (SSR 정적 렌더, 브라우저/DB/네트워크 없음)
 *
 * 실행: npm run test:mrp-scheduled-receipt-ui
 *
 *  U1 입고 후 수요 타임라인   U2 수요 후 입고(결품 → 해소) 표시   U3 입고예정 미반영 시 기존 상세(수주별 순차 차감)
 *  U4 경과 미입고 안내        U5 기간 예상소요량 참고 컬럼(입고예정)  U6 렌더링 오류 없음
 */
import assert from "node:assert/strict"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MaterialRows } from "../src/app/app/mes/mrp/material-rows"
import { PeriodRequirementTable } from "../src/app/app/mes/mrp/period-requirement-table"
import type { OrderMrpMaterialView } from "../src/lib/mrp/order-mrp-adapter"

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log("PASS " + label)
}

function material(over: Partial<OrderMrpMaterialView>): OrderMrpMaterialView {
  return {
    componentItemId: "r1",
    code: "R1",
    name: "자재1",
    spec: null,
    uom: "EA",
    itemType: "RAW_MATERIAL",
    qtyOnHand: 50,
    qtyHold: 0,
    qtyAvailable: 50,
    qtyExcludedByLot: 0,
    totalRequirement: 60,
    finalBalance: 20,
    shortageQty: 0,
    firstShortageDate: null,
    firstShortageOrderNo: null,
    shortageDemandCount: 0,
    shortageOrderNos: [],
    demandLineCount: 1,
    productCount: 1,
    firstNeedDate: "2026-10-12",
    lastNeedDate: "2026-10-12",
    steps: [
      {
        sequence: 1,
        orderId: "o1",
        orderNo: "SO-1",
        orderLineId: "l1",
        customerName: "고객사",
        itemCode: "FG-A",
        itemName: "제품A",
        deliveryDate: "2026-10-12",
        demandQty: 60,
        bomQtyPerUnit: 1,
        requirement: 60,
        balanceBefore: 80,
        balanceAfter: 20,
        shortageAtThisDemand: 0,
        isShortage: false,
      },
    ],
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

const render = (m: OrderMrpMaterialView, open: boolean, receipts: boolean) =>
  renderToStaticMarkup(
    <table>
      <tbody>
        <MaterialRows m={m} open={open} onToggle={() => {}} receipts={receipts} colCount={receipts ? 17 : 13} />
      </tbody>
    </table>
  )

// U1: 입고 → 수요
const u1 = material({
  scheduledReceiptQty: 30,
  scheduledReceiptCount: 1,
  nextReceiptDate: "2026-10-10",
  timeline: [
    { type: "SCHEDULED_RECEIPT", date: "2026-10-10", referenceNo: "PO-001", partyName: "공급사A", itemCode: null, quantity: 30, signedQuantity: 30, balanceBefore: 50, balanceAfter: 80, isShortage: false, sequence: null },
    { type: "DEMAND", date: "2026-10-12", referenceNo: "SO-1", partyName: "고객사", itemCode: "FG-A", quantity: 60, signedQuantity: -60, balanceBefore: 80, balanceAfter: 20, isShortage: false, sequence: 1 },
  ],
})
{
  const html = render(u1, true, true)
  ok(html.includes("입고·수요 시간축"), "U1 시간축 상세 제목")
  ok(html.includes("PO-001") && html.includes("공급사A") && html.includes("+30"), "U1 입고 이벤트(발주번호/공급사/+30)")
  ok(html.includes("SO-1") && html.includes("-60"), "U1 수요 이벤트(수주번호/-60)")
  ok(html.indexOf("PO-001") < html.indexOf("SO-1"), "U1 날짜순: 입고가 수요보다 앞")
  ok(html.includes("2026-10-10"), "U1 다음 입고일 컬럼/이벤트 일자")
  ok(html.includes("정상"), "U1 상태 정상")
}

// U2: 수요 → 입고(결품 후 회복)
const u2 = material({
  finalBalance: 20,
  shortageQty: 0,
  hadShortage: true,
  peakShortageQty: 10,
  temporaryShortage: true,
  shortageRecoveredAt: "2026-10-15",
  firstShortageDate: "2026-10-12",
  firstShortageOrderNo: "SO-1",
  shortageDemandCount: 1,
  shortageOrderNos: ["SO-1"],
  scheduledReceiptQty: 30,
  scheduledReceiptCount: 1,
  nextReceiptDate: "2026-10-15",
  timeline: [
    { type: "DEMAND", date: "2026-10-12", referenceNo: "SO-1", partyName: "고객사", itemCode: "FG-A", quantity: 60, signedQuantity: -60, balanceBefore: 50, balanceAfter: -10, isShortage: true, sequence: 1 },
    { type: "SCHEDULED_RECEIPT", date: "2026-10-15", referenceNo: "PO-001", partyName: "공급사A", itemCode: null, quantity: 30, signedQuantity: 30, balanceBefore: -10, balanceAfter: 20, isShortage: false, sequence: null },
  ],
})
{
  const html = render(u2, true, true)
  ok(html.includes("입고예정으로 해소"), "U2 상태: 입고예정으로 해소")
  ok(html.includes("결품 해소"), "U2 이벤트: 결품 해소")
  ok(html.includes("결품은 2026-10-15 입고예정으로 해소됩니다"), "U2 회복일 안내")
  ok(html.includes("-10"), "U2 10/12 시점 잔량 -10 표시")
  ok(html.indexOf("SO-1") < html.indexOf("PO-001"), "U2 날짜순: 수요 → 입고")
  ok(html.includes("bg-amber-50/40"), "U2 일시 결품 행 강조")
}

// U3: 최종 부족
{
  const short = material({ finalBalance: -10, shortageQty: 10, hadShortage: true, peakShortageQty: 10 })
  const html = render(short, false, true)
  ok(html.includes("최종 부족"), "U3 최종 부족 상태 배지")
}

// U4: 입고예정 미반영(기존 상세)
{
  const legacy = material({})
  const html = render(legacy, true, false)
  ok(html.includes("수주별 순차 차감"), "U4 미반영: 기존 상세(수주별 순차 차감)")
  ok(!html.includes("입고·수요 시간축"), "U4 미반영: 시간축 없음")
  ok(!html.includes("다음 입고일"), "U4 미반영: 추가 컬럼 없음")
}

// U5: 경과 미입고 안내(상세)
{
  const overdue = material({ overdueReceiptQty: 50, overdueReceiptCount: 1 })
  const html = render(overdue, true, true)
  ok(html.includes("예정일이 지난 미입고 50EA는 반영하지 않았습니다"), "U5 경과 미입고 안내")
}

// U6: 기간 예상소요량 참고 컬럼
{
  const withCol = renderToStaticMarkup(
    <PeriodRequirementTable rows={[u1]} expanded={null} onToggle={() => {}} showScheduledReceipts />
  )
  ok(withCol.includes("기간 내 입고예정") && withCol.includes("+30"), "U6 기간 내 입고예정 참고 컬럼")
  ok(withCol.includes("60"), "U6 기간 소요량(수요)은 입고예정으로 줄어들지 않음")
  const without = renderToStaticMarkup(<PeriodRequirementTable rows={[u1]} expanded={null} onToggle={() => {}} />)
  ok(!without.includes("기간 내 입고예정"), "U6 입고예정 미반영 시 컬럼 없음(기존 화면)")
}

console.log(`\n✅ mrp-scheduled-receipt-ui: ${passed} checks passed`)
