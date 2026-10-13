"use client"

import { useState } from "react"
import { format, isPast } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PackageCheck, ChevronDown, ChevronRight } from "lucide-react"
import { ReceivingFormDialog } from "./receiving-form-dialog"
import { formatQuantity } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

export type MaterialReceiptOrderRow = {
  id: string
  orderNo: string
  status: string
  orderDate: Date | string | null
  expectedDate: Date | string | null
  supplier: { id: string; name: string; code: string }
  items: Array<{
    id: string
    qty: number | string
    receivedQty: number | string
    item: {
      id: string
      code: string
      name: string
      uom: string
      isLotTracked: boolean
      defaultWarehouseId?: string | null
      lotNumberingType?: string | null
      manualLotPolicy?: string | null
    }
  }>
}

interface MaterialReceiptDataTableProps {
  data: MaterialReceiptOrderRow[]
  tenantId: string
  siteId: string
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  ORDERED:          { label: "발주완료", variant: "default" },
  PARTIAL_RECEIVED: { label: "부분입고", variant: "outline" },
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MaterialReceiptDataTable({
  data,
  tenantId,
  siteId,
}: MaterialReceiptDataTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [receivingOrder, setReceivingOrder] = useState<MaterialReceiptOrderRow | null>(null)

  function toggleExpand(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/20 py-16 text-center">
        <p className="text-[14px] text-muted-foreground">입고 대기 중인 발주가 없습니다.</p>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-lg border overflow-hidden">
        {/* 테이블 헤더 */}
        <div className="grid grid-cols-[40px_1fr_1fr_1fr_1fr_1fr_120px] bg-muted/30 border-b">
          <div className="py-2.5 px-3" />
          <div className="py-2.5 px-3 text-[13px] font-medium text-muted-foreground">발주번호</div>
          <div className="py-2.5 px-3 text-[13px] font-medium text-muted-foreground">공급사</div>
          <div className="py-2.5 px-3 text-[13px] font-medium text-muted-foreground">발주일시</div>
          <div className="py-2.5 px-3 text-[13px] font-medium text-muted-foreground">입고예정일</div>
          <div className="py-2.5 px-3 text-[13px] font-medium text-muted-foreground">상태</div>
          <div className="py-2.5 px-3 text-[13px] font-medium text-muted-foreground text-right">처리</div>
        </div>

        {/* 테이블 바디 */}
        <div className="divide-y">
          {data.map((order) => {
            const isExpanded = expandedRows.has(order.id)
            const cfg = STATUS_CONFIG[order.status] ?? { label: order.status, variant: "secondary" as const }
            const expectedDate = order.expectedDate ? new Date(order.expectedDate) : null
            const isOverdue =
              expectedDate &&
              isPast(expectedDate) &&
              order.status !== "RECEIVED" &&
              order.status !== "CLOSED"

            return (
              <div key={order.id}>
                {/* 발주 행 */}
                <div className="grid grid-cols-[40px_1fr_1fr_1fr_1fr_1fr_120px] items-center hover:bg-muted/20 transition-colors">
                  {/* 펼치기 버튼 */}
                  <button
                    className="flex items-center justify-center h-full py-3 px-3 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => toggleExpand(order.id)}
                    aria-label={isExpanded ? "접기" : "펼치기"}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>

                  {/* 발주번호 */}
                  <div className="py-3 px-3">
                    <span className="font-mono text-[13px] font-medium">{order.orderNo}</span>
                    <span className="ml-2 text-[12px] text-muted-foreground">{order.items.length}개 품목</span>
                  </div>

                  {/* 공급사 */}
                  <div className="py-3 px-3">
                    <span className="text-[14px]">{order.supplier.name}</span>
                  </div>

                  {/* 발주일시 */}
                  <div className="py-3 px-3">
                    {order.orderDate ? (
                      <span className="text-[13px] text-muted-foreground">
                        {format(new Date(order.orderDate), "yyyy-MM-dd HH:mm")}
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* 입고예정일 */}
                  <div className="py-3 px-3">
                    {expectedDate ? (
                      <span className={`text-[13px] font-medium ${isOverdue ? "text-red-600" : "text-muted-foreground"}`}>
                        {format(expectedDate, "yyyy-MM-dd")}
                        {isOverdue && <span className="ml-1 text-[11px]">(지연)</span>}
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* 상태 */}
                  <div className="py-3 px-3">
                    <Badge variant={cfg.variant} className="text-[12px]">
                      {cfg.label}
                    </Badge>
                  </div>

                  {/* 입고처리 버튼 */}
                  <div className="py-3 px-3 flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[13px] gap-1.5"
                      onClick={() => setReceivingOrder(order)}
                    >
                      <PackageCheck className="h-3.5 w-3.5" />
                      입고처리
                    </Button>
                  </div>
                </div>

                {/* 품목 상세 (확장) */}
                {isExpanded && (
                  <div className="bg-muted/10 border-t px-4 py-3">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-1.5 px-2 font-medium text-muted-foreground w-16">코드</th>
                          <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">품목명</th>
                          <th className="text-right py-1.5 px-2 font-medium text-muted-foreground w-24">발주수량</th>
                          <th className="text-right py-1.5 px-2 font-medium text-muted-foreground w-24">기입고</th>
                          <th className="text-right py-1.5 px-2 font-medium text-muted-foreground w-24">잔여수량</th>
                          <th className="text-left py-1.5 px-2 font-medium text-muted-foreground w-16">단위</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {order.items.map((oi) => {
                          const orderedQty = Number(oi.qty)
                          const receivedQty = Number(oi.receivedQty)
                          const remainingQty = Math.max(0, orderedQty - receivedQty)
                          return (
                            <tr key={oi.id} className="hover:bg-muted/20">
                              <td className="py-1.5 px-2 font-mono text-muted-foreground">{oi.item.code}</td>
                              <td className="py-1.5 px-2">{oi.item.name}</td>
                              <td className="py-1.5 px-2 text-right">{formatQuantity(orderedQty)}</td>
                              <td className="py-1.5 px-2 text-right text-muted-foreground">{formatQuantity(receivedQty)}</td>
                              <td className={`py-1.5 px-2 text-right font-medium ${remainingQty > 0 ? "text-amber-600" : "text-green-600"}`}>
                                {formatQuantity(remainingQty)}
                              </td>
                              <td className="py-1.5 px-2 text-muted-foreground">{oi.item.uom}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ReceivingFormDialog */}
      {receivingOrder && (
        <ReceivingFormDialog
          purchaseOrder={receivingOrder}
          tenantId={tenantId}
          siteId={siteId}
          open={!!receivingOrder}
          onClose={() => setReceivingOrder(null)}
        />
      )}
    </>
  )
}
