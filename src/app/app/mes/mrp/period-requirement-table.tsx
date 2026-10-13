"use client"

import { Fragment } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { OrderMrpMaterialView } from "@/lib/mrp/order-mrp-adapter"

const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 3 })

const HEADERS: Array<{ label: string; align?: "right" }> = [
  { label: "자재코드" },
  { label: "자재명" },
  { label: "규격" },
  { label: "단위" },
  { label: "기간 소요량", align: "right" },
  { label: "수주 라인", align: "right" },
  { label: "제품 수", align: "right" },
  { label: "현재 가용재고", align: "right" },
  { label: "기간 종료 예상재고", align: "right" },
  { label: "부족수량", align: "right" },
  { label: "최초 필요일" },
  { label: "최종 필요일" },
]

type Props = {
  rows: OrderMrpMaterialView[]
  expanded: string | null
  onToggle: (componentItemId: string) => void
  /** 예정입고를 반영한 결과일 때: 기간 내 입고예정(참고) 컬럼을 추가한다. 소요량 자체는 입고예정으로 줄어들지 않는다. */
  showScheduledReceipts?: boolean
}

/**
 * 예상소요량(기간): "이 기간에 어떤 자재가 얼마나 필요한가".
 * 결품예측 화면과 같은 엔진 결과(OrderMrpView)를 다른 관점으로 보여 준다(추가 쿼리 없음).
 */
export function PeriodRequirementTable({ rows, expanded, onToggle, showScheduledReceipts = false }: Props) {
  const headers: typeof HEADERS = showScheduledReceipts
    ? [
        ...HEADERS.slice(0, 8),
        { label: "기간 내 입고예정", align: "right" },
        ...HEADERS.slice(8),
      ]
    : HEADERS
  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[14px] border-collapse">
          <thead>
            <tr className="bg-muted/30 border-b">
              <th className="w-8 px-2 py-3" />
              {headers.map((h) => (
                <th
                  key={h.label}
                  className={`px-3 py-3 text-[13px] font-semibold text-muted-foreground whitespace-nowrap ${
                    h.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const open = expanded === m.componentItemId
              const short = m.shortageQty > 0
              return (
                <Fragment key={m.componentItemId}>
                  <tr
                    className={`border-b cursor-pointer transition-colors ${short ? "bg-red-50/40 hover:bg-red-50/70" : "hover:bg-muted/10"}`}
                    onClick={() => onToggle(m.componentItemId)}
                  >
                    <td className="px-2 py-3 text-muted-foreground">
                      {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </td>
                    <td className="px-3 py-3 font-mono text-[13px] whitespace-nowrap">{m.code}</td>
                    <td className="px-3 py-3 font-medium">{m.name}</td>
                    <td className="px-3 py-3 text-muted-foreground">{m.spec ?? "-"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{m.uom}</td>
                    <td className="px-3 py-3 text-right font-semibold">{fmt(m.totalRequirement)}</td>
                    <td className="px-3 py-3 text-right">{fmt(m.demandLineCount)}</td>
                    <td className="px-3 py-3 text-right">{fmt(m.productCount)}</td>
                    <td className="px-3 py-3 text-right">{fmt(m.qtyAvailable)}</td>
                    {showScheduledReceipts && (
                      <td className="px-3 py-3 text-right">
                        {m.scheduledReceiptQty > 0 ? (
                          <span className="text-emerald-700">+{fmt(m.scheduledReceiptQty)}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    )}
                    <td className={`px-3 py-3 text-right ${m.finalBalance < 0 ? "text-red-600 font-semibold" : ""}`}>
                      {fmt(m.finalBalance)}
                    </td>
                    <td className={`px-3 py-3 text-right ${short ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                      {short ? fmt(m.shortageQty) : "-"}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{m.firstNeedDate ?? "-"}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{m.lastNeedDate ?? "-"}</td>
                  </tr>
                  {open && (
                    <tr className="border-b bg-muted/10">
                      <td />
                      <td colSpan={headers.length} className="px-3 py-4">
                        <p className="text-[14px] font-medium mb-1">
                          수요 상세 — {m.code} {m.name}
                        </p>
                        <p className="text-[13px] text-muted-foreground mb-3">
                          기간 총소요 {fmt(m.totalRequirement)} {m.uom} · 수주 라인 {fmt(m.demandLineCount)}건 · 제품{" "}
                          {fmt(m.productCount)}종
                        </p>
                        <div className="overflow-x-auto rounded-lg border bg-background">
                          <table className="w-full text-[14px] border-collapse">
                            <thead>
                              <tr className="bg-muted/30 border-b text-[13px] text-muted-foreground">
                                <th className="px-3 py-2 text-left">납기</th>
                                <th className="px-3 py-2 text-left">PO</th>
                                <th className="px-3 py-2 text-left">고객</th>
                                <th className="px-3 py-2 text-left">제품코드</th>
                                <th className="px-3 py-2 text-left">제품명</th>
                                <th className="px-3 py-2 text-right">수주잔량</th>
                                <th className="px-3 py-2 text-right">제품당 BOM 소요</th>
                                <th className="px-3 py-2 text-right">이 수주의 자재 소요</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...m.steps]
                                .sort((a, b) => (a.deliveryDate ?? "") < (b.deliveryDate ?? "") ? -1 : (a.deliveryDate ?? "") > (b.deliveryDate ?? "") ? 1 : a.sequence - b.sequence)
                                .map((s) => (
                                  <tr key={s.orderLineId} className="border-b last:border-0">
                                    <td className="px-3 py-2 whitespace-nowrap">{s.deliveryDate ?? "-"}</td>
                                    <td className="px-3 py-2 font-mono text-[13px]">{s.orderNo}</td>
                                    <td className="px-3 py-2">{s.customerName ?? "-"}</td>
                                    <td className="px-3 py-2 font-mono text-[13px]">{s.itemCode}</td>
                                    <td className="px-3 py-2">{s.itemName !== s.itemCode ? s.itemName : "-"}</td>
                                    <td className="px-3 py-2 text-right">{fmt(s.demandQty)}</td>
                                    <td className="px-3 py-2 text-right text-muted-foreground">{fmt(s.bomQtyPerUnit)}</td>
                                    <td className="px-3 py-2 text-right font-medium">{fmt(s.requirement)}</td>
                                  </tr>
                                ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t bg-muted/20">
                                <td colSpan={7} className="px-3 py-2 text-right text-[13px] text-muted-foreground">
                                  기간 총소요
                                </td>
                                <td className="px-3 py-2 text-right font-semibold">
                                  {fmt(m.totalRequirement)} {m.uom}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={headers.length + 1} className="px-4 py-8 text-center text-muted-foreground">
                  조건에 맞는 자재가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
