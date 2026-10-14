"use client"

import { Fragment } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { OrderMrpMaterialView, OrderMrpStepView } from "@/lib/mrp/order-mrp-adapter"

const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 3 })

/**
 * (Phase 5E) 반제품 Netting 근거 문구.
 *  - 반제품 자신의 행: 총 필요 → 재고 사용 → 순소요
 *  - 하위 자재의 행: 상위 반제품 순소요 × 1단위당 소요 = 이 자재 소요
 */
function NettingCell({ s }: { s: OrderMrpStepView }) {
  if (!s.semiNetting && !s.netting) return <span className="text-muted-foreground">-</span>
  return (
    <div className="space-y-0.5 text-[13px]">
      {s.semiNetting && (
        <div>
          총 필요 {fmt(s.semiNetting.grossQty)} − 재고 사용 {fmt(s.semiNetting.usedQty)} = <strong>순소요 {fmt(s.semiNetting.netQty)}</strong>
        </div>
      )}
      {s.netting?.map((n, i) => (
        <div key={i}>
          반제품 <span className="font-mono">{n.parentCode}</span>: 총 {fmt(n.parentGross)} − 재고 {fmt(n.parentUsed)} = 순소요{" "}
          {fmt(n.parentNet)} × {fmt(n.qtyPer)} = <strong>{fmt(n.requirement)}</strong>
        </div>
      ))}
    </div>
  )
}

/**
 * 수주기준 MRP 결과의 자재 1행 + 펼침 상세(수주별 순차 차감 또는 입고·수요 시간축).
 * order-mrp-panel.tsx 에서 분리했다(렌더링 단위 테스트를 위해).
 */
export function MaterialRows({
  m,
  open,
  onToggle,
  receipts,
  colCount,
}: {
  m: OrderMrpMaterialView
  open: boolean
  onToggle: () => void
  receipts: boolean
  colCount: number
}) {
  const short = m.shortageQty > 0
  const poText =
    m.shortageOrderNos.length === 0
      ? "-"
      : m.shortageOrderNos.length <= 2
        ? m.shortageOrderNos.join(", ")
        : `${m.shortageOrderNos.slice(0, 2).join(", ")} 외 ${m.shortageOrderNos.length - 2}건`
  const rowTone = short
    ? "bg-red-50/40 hover:bg-red-50/70"
    : receipts && m.temporaryShortage
      ? "bg-amber-50/40 hover:bg-amber-50/70"
      : "hover:bg-muted/10"
  return (
    <Fragment>
      <tr className={`border-b cursor-pointer transition-colors ${rowTone}`} onClick={onToggle}>
        <td className="px-2 py-3 text-muted-foreground">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </td>
        <td className="px-3 py-3 font-mono text-[13px] whitespace-nowrap">{m.code}</td>
        <td className="px-3 py-3 font-medium">
          {m.name}
          {m.netting && (
            <div className="mt-0.5 text-[13px] font-normal text-sky-700">
              반제품 재고 {fmt(m.netting.usedQty)} 사용 → 순소요 {fmt(m.netting.netQty)}
            </div>
          )}
        </td>
        <td className="px-3 py-3 text-muted-foreground">{m.spec ?? "-"}</td>
        <td className="px-3 py-3 text-muted-foreground">{m.uom}</td>
        <td className="px-3 py-3 text-right">{fmt(m.qtyOnHand)}</td>
        <td className="px-3 py-3 text-right text-muted-foreground">{fmt(m.qtyHold)}</td>
        <td className="px-3 py-3 text-right">{fmt(m.qtyAvailable)}</td>
        <td className="px-3 py-3 text-right">{fmt(m.totalRequirement)}</td>
        {receipts && (
          <td className="px-3 py-3 text-right">
            {m.scheduledReceiptQty > 0 ? (
              <span className="text-emerald-700 font-medium">+{fmt(m.scheduledReceiptQty)}</span>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </td>
        )}
        <td className={`px-3 py-3 text-right font-semibold ${m.finalBalance < 0 ? "text-red-600" : ""}`}>
          {fmt(m.finalBalance)}
        </td>
        <td className={`px-3 py-3 text-right font-semibold ${short ? "text-red-600" : "text-muted-foreground"}`}>
          {short ? fmt(m.shortageQty) : "-"}
        </td>
        {receipts && (
          <td className={`px-3 py-3 text-right ${m.peakShortageQty > 0 ? "text-red-600" : "text-muted-foreground"}`}>
            {m.peakShortageQty > 0 ? fmt(m.peakShortageQty) : "-"}
          </td>
        )}
        <td className="px-3 py-3 whitespace-nowrap">{m.firstShortageDate ?? "-"}</td>
        {receipts && <td className="px-3 py-3 whitespace-nowrap">{m.nextReceiptDate ?? "-"}</td>}
        {receipts && (
          <td className="px-3 py-3 whitespace-nowrap">
            {short ? (
              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[13px] text-red-700">최종 부족</span>
            ) : m.temporaryShortage ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[13px] text-amber-800">
                입고예정으로 해소
              </span>
            ) : (
              <span className="text-muted-foreground">정상</span>
            )}
          </td>
        )}
        <td className="px-3 py-3">{poText}</td>
        <td className="px-3 py-3 text-right">{m.shortageDemandCount > 0 ? fmt(m.shortageDemandCount) : "-"}</td>
      </tr>
      {open && (
        <tr className="border-b bg-muted/10">
          <td />
          <td colSpan={colCount} className="px-3 py-4">
            {m.netting && (
              <p className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[14px] text-sky-900">
                <strong>반제품 Netting</strong> — 총 필요 {fmt(m.netting.grossQty)} · 가용재고 {fmt(m.qtyAvailable)} 중{" "}
                {fmt(m.netting.usedQty)} 사용 · <strong>순소요 {fmt(m.netting.netQty)}</strong> (하위 자재는 순소요만 전개합니다)
              </p>
            )}
            {receipts && m.timeline.length > 0 ? (
              <>
                <p className="text-[14px] font-medium mb-1">
                  입고·수요 시간축 — {m.code} {m.name}
                </p>
                <p className="text-[13px] text-muted-foreground mb-3">
                  가용재고 {fmt(m.qtyAvailable)}
                  {m.qtyHold > 0 && ` (현재고 ${fmt(m.qtyOnHand)} − 예약 ${fmt(m.qtyHold)})`}
                  {m.qtyExcludedByLot > 0 && ` · 격리/보류 LOT ${fmt(m.qtyExcludedByLot)} 제외`} 에서 날짜순으로 처리합니다. 같은 날은 입고예정이
                  수요보다 먼저 반영됩니다.
                  {m.temporaryShortage && m.shortageRecoveredAt && ` 결품은 ${m.shortageRecoveredAt} 입고예정으로 해소됩니다.`}
                  {m.overdueReceiptQty > 0 && ` 예정일이 지난 미입고 ${fmt(m.overdueReceiptQty)}${m.uom}는 반영하지 않았습니다.`}
                </p>
                <div className="overflow-x-auto rounded-lg border bg-background">
                  <table className="w-full text-[14px] border-collapse">
                    <thead>
                      <tr className="bg-muted/30 border-b text-[13px] text-muted-foreground">
                        <th className="px-3 py-2 text-left">일자</th>
                        <th className="px-3 py-2 text-left">구분</th>
                        <th className="px-3 py-2 text-left">참조번호</th>
                        <th className="px-3 py-2 text-left">공급사/고객</th>
                        <th className="px-3 py-2 text-left">제품</th>
                        <th className="px-3 py-2 text-right">수량</th>
                        <th className="px-3 py-2 text-right">이전 잔량</th>
                        <th className="px-3 py-2 text-right">이후 잔량</th>
                        <th className="px-3 py-2 text-left">상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.timeline.map((ev, i) => (
                        <tr
                          key={i}
                          className={`border-b last:border-0 ${ev.isShortage ? "bg-red-50/50" : ev.type === "SCHEDULED_RECEIPT" ? "bg-emerald-50/40" : ""}`}
                        >
                          <td className="px-3 py-2 whitespace-nowrap">{ev.date ?? "-"}</td>
                          <td className="px-3 py-2">{ev.type === "SCHEDULED_RECEIPT" ? "입고예정" : "수주"}</td>
                          <td className="px-3 py-2 font-mono text-[13px]">{ev.referenceNo}</td>
                          <td className="px-3 py-2">{ev.partyName ?? "-"}</td>
                          <td className="px-3 py-2 font-mono text-[13px]">{ev.itemCode ?? "-"}</td>
                          <td
                            className={`px-3 py-2 text-right font-medium ${ev.signedQuantity > 0 ? "text-emerald-700" : ""}`}
                          >
                            {ev.signedQuantity > 0 ? "+" : "-"}
                            {fmt(ev.quantity)}
                          </td>
                          <td className="px-3 py-2 text-right">{fmt(ev.balanceBefore)}</td>
                          <td className={`px-3 py-2 text-right font-semibold ${ev.balanceAfter < 0 ? "text-red-600" : ""}`}>
                            {fmt(ev.balanceAfter)}
                          </td>
                          <td className="px-3 py-2">
                            {ev.isShortage ? (
                              <span className="text-red-600 font-medium">결품</span>
                            ) : ev.type === "SCHEDULED_RECEIPT" && ev.balanceBefore < 0 && ev.balanceAfter >= 0 ? (
                              <span className="text-emerald-700 font-medium">결품 해소</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {m.steps.some((s) => s.semiNetting || s.netting) && (
                  <div className="mt-3 rounded-lg border bg-background px-3 py-2">
                    <p className="mb-1 text-[13px] font-medium text-muted-foreground">반제품 Netting 근거</p>
                    {m.steps
                      .filter((s) => s.semiNetting || s.netting)
                      .map((s) => (
                        <div key={s.orderLineId} className="py-1 text-[14px]">
                          <span className="mr-2 font-mono text-[13px]">{s.orderNo}</span>
                          <NettingCell s={s} />
                        </div>
                      ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-[14px] font-medium mb-1">
                  수주별 순차 차감 — {m.code} {m.name}
                </p>
                <p className="text-[13px] text-muted-foreground mb-3">
                  가용재고 {fmt(m.qtyAvailable)}
                  {m.qtyHold > 0 && ` (현재고 ${fmt(m.qtyOnHand)} − 예약 ${fmt(m.qtyHold)})`}
                  {m.qtyExcludedByLot > 0 && ` · 격리/보류 LOT ${fmt(m.qtyExcludedByLot)} 제외`} 에서 납기순으로 차감합니다.
                  {receipts && m.overdueReceiptQty > 0 && ` 예정일이 지난 미입고 ${fmt(m.overdueReceiptQty)}${m.uom}는 반영하지 않았습니다.`}
                </p>
                <div className="overflow-x-auto rounded-lg border bg-background">
                  <table className="w-full text-[14px] border-collapse">
                    <thead>
                      <tr className="bg-muted/30 border-b text-[13px] text-muted-foreground">
                        <th className="px-3 py-2 text-left">순서</th>
                        <th className="px-3 py-2 text-left">납기</th>
                        <th className="px-3 py-2 text-left">PO</th>
                        <th className="px-3 py-2 text-left">고객</th>
                        <th className="px-3 py-2 text-left">제품</th>
                        <th className="px-3 py-2 text-right">수주잔량</th>
                        <th className="px-3 py-2 text-right">해당 자재 소요</th>
                        <th className="px-3 py-2 text-right">차감 전</th>
                        <th className="px-3 py-2 text-right">차감 후</th>
                        <th className="px-3 py-2 text-left">결품</th>
                        {m.steps.some((s) => s.semiNetting || s.netting) && (
                          <th className="px-3 py-2 text-left">반제품 Netting</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {m.steps.map((s) => (
                        <tr key={s.orderLineId} className={`border-b last:border-0 ${s.isShortage ? "bg-red-50/50" : ""}`}>
                          <td className="px-3 py-2">{s.sequence}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{s.deliveryDate ?? "-"}</td>
                          <td className="px-3 py-2 font-mono text-[13px]">{s.orderNo}</td>
                          <td className="px-3 py-2">{s.customerName ?? "-"}</td>
                          <td className="px-3 py-2">
                            <span className="font-mono text-[13px]">{s.itemCode}</span>
                            {s.itemName !== s.itemCode && <span className="text-muted-foreground"> {s.itemName}</span>}
                          </td>
                          <td className="px-3 py-2 text-right">{fmt(s.demandQty)}</td>
                          <td className="px-3 py-2 text-right">{fmt(s.requirement)}</td>
                          <td className="px-3 py-2 text-right">{fmt(s.balanceBefore)}</td>
                          <td className={`px-3 py-2 text-right font-semibold ${s.balanceAfter < 0 ? "text-red-600" : ""}`}>
                            {fmt(s.balanceAfter)}
                          </td>
                          <td className="px-3 py-2">
                            {s.isShortage ? (
                              <span className="text-red-600 font-medium">부족 {fmt(s.shortageAtThisDemand)}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          {m.steps.some((x) => x.semiNetting || x.netting) && (
                            <td className="px-3 py-2">
                              <NettingCell s={s} />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  )
}
