"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { SalesOrderRow } from "./columns"
import { formatAmountWithCurrency } from "./format-amount"
import { SalesOrderStatus } from "@prisma/client"
import { formatQuantity } from "@/lib/utils"
import { getSalesOrderProgress } from "@/lib/actions/sales-order.actions"
import { toKstDateKey } from "@/lib/date/kst"

type SalesOrderProgress = NonNullable<Awaited<ReturnType<typeof getSalesOrderProgress>>>
type ProgressItem = SalesOrderProgress["items"][number]

interface SalesOrderDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  salesOrder: SalesOrderRow | null
}

const STATUS_CONFIG: Record<
  SalesOrderStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  DRAFT:           { label: "초안",     variant: "secondary" },
  CONFIRMED:       { label: "확정",     variant: "default" },
  IN_PRODUCTION:   { label: "생산중",   variant: "default" },
  PARTIAL_SHIPPED: { label: "부분출하", variant: "outline" },
  SHIPPED:         { label: "출하완료", variant: "default" },
  CLOSED:          { label: "완료",     variant: "secondary" },
  CANCELLED:       { label: "취소",     variant: "destructive" },
}

const PRODUCTION_STATUS_LABEL: Record<ProgressItem["productionStatus"], string> = {
  NOT_PLANNED: "생산계획 전",
  PLANNED: "생산계획",
  READY: "생산 준비",
  IN_PROGRESS: "생산 중",
  COMPLETED: "생산 완료",
}

const SHIPMENT_STATUS_LABEL: Record<ProgressItem["shipmentStatus"], string> = {
  NOT_SHIPPED: "미출하",
  IN_PROGRESS: "출하 진행",
  COMPLETED: "출하 완료",
}

function StatusBadge({ status }: { status: ProgressItem["productionStatus"] }) {
  const label = PRODUCTION_STATUS_LABEL[status]
  if (status === "COMPLETED") return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{label}</Badge>
  if (status === "IN_PROGRESS") return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">{label}</Badge>
  if (status === "READY") return <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">{label}</Badge>
  return <Badge variant="secondary">{label}</Badge>
}

function ShipmentBadge({ status }: { status: ProgressItem["shipmentStatus"] }) {
  const label = SHIPMENT_STATUS_LABEL[status]
  if (status === "COMPLETED") return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{label}</Badge>
  if (status === "IN_PROGRESS") return <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">{label}</Badge>
  return <Badge variant="secondary">{label}</Badge>
}

function Quantity({ value }: { value: number }) {
  return <span className="tabular-nums">{formatQuantity(value)}</span>
}

function LinkList({ links, enabled }: { links: ProgressItem["productionPlans"]; enabled: boolean }) {
  if (!enabled || links.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {links.slice(0, 3).map((link) => (
        <Button key={link.id} variant="outline" size="sm" className="h-7 px-2 text-[12px]" asChild>
          <Link href={link.href}>
            {link.label}
            <ExternalLink className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      ))}
      {links.length > 3 ? <span className="text-[12px] text-muted-foreground">+{links.length - 3}</span> : null}
    </div>
  )
}

export function SalesOrderDetailSheet({
  open,
  onOpenChange,
  salesOrder,
}: SalesOrderDetailSheetProps) {
  const [progress, setProgress] = useState<SalesOrderProgress | null>(null)
  const [progressLoading, setProgressLoading] = useState(false)
  const [progressError, setProgressError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !salesOrder?.id) {
      setProgress(null)
      setProgressError(null)
      return
    }

    let cancelled = false
    setProgressLoading(true)
    setProgressError(null)
    getSalesOrderProgress(salesOrder.id)
      .then((result) => {
        if (cancelled) return
        setProgress(result)
      })
      .catch((error) => {
        if (cancelled) return
        setProgressError(error instanceof Error ? error.message : "진행상황을 불러오지 못했습니다.")
      })
      .finally(() => {
        if (!cancelled) setProgressLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, salesOrder?.id])

  if (!salesOrder) return null

  const statusCfg = STATUS_CONFIG[salesOrder.status]
  const hasOverdue = progress?.hasOverdueItem ?? false

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-6xl overflow-y-auto">
        <SheetHeader className="pb-6 border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <SheetTitle className="text-[20px] font-semibold font-mono">
                {salesOrder.orderNo}
              </SheetTitle>
              <p className="text-[15px] text-muted-foreground font-medium">
                {salesOrder.customer.name}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {hasOverdue ? (
                <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                  <AlertTriangle className="mr-1 h-3.5 w-3.5" /> 납기 경과
                </Badge>
              ) : null}
              <Badge variant={statusCfg.variant} className="text-[13px] mt-1">
                {statusCfg.label}
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap gap-6 pt-2">
            <div className="space-y-0.5">
              <p className="text-[12px] text-muted-foreground uppercase tracking-wide">수주일</p>
              <p className="text-[14px] font-medium">
                {toKstDateKey(new Date(salesOrder.orderDate))}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[12px] text-muted-foreground uppercase tracking-wide">고객 납기일</p>
              <p className="text-[14px] font-medium">
                {progress?.customerDeliveryDate ?? toKstDateKey(new Date(salesOrder.deliveryDate))}
              </p>
            </div>
            {salesOrder.totalAmount && (
              <div className="space-y-0.5">
                <p className="text-[12px] text-muted-foreground uppercase tracking-wide">총금액</p>
                <p className="text-[14px] font-semibold">
                  {formatAmountWithCurrency(salesOrder.totalAmount, salesOrder.currency)}
                </p>
              </div>
            )}
          </div>
        </SheetHeader>

        <div className="pt-6 space-y-8">
          <section>
            <h3 className="text-[15px] font-semibold mb-3">수주 품목</h3>
            <div className="border rounded-xl overflow-hidden">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left px-3 py-2.5 text-[13px] font-medium text-muted-foreground w-8">#</th>
                    <th className="text-left px-3 py-2.5 text-[13px] font-medium text-muted-foreground">품목코드</th>
                    <th className="text-left px-3 py-2.5 text-[13px] font-medium text-muted-foreground">품목명</th>
                    <th className="text-center px-3 py-2.5 text-[13px] font-medium text-muted-foreground">UOM</th>
                    <th className="text-right px-3 py-2.5 text-[13px] font-medium text-muted-foreground">수주수량</th>
                    <th className="text-right px-3 py-2.5 text-[13px] font-medium text-muted-foreground">출하완료</th>
                    <th className="text-right px-3 py-2.5 text-[13px] font-medium text-muted-foreground">잔여수량</th>
                    <th className="text-center px-3 py-2.5 text-[13px] font-medium text-muted-foreground">품목 납기</th>
                    <th className="text-left px-3 py-2.5 text-[13px] font-medium text-muted-foreground">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {salesOrder.items.map((item, idx) => {
                    const orderedQty = Number(item.qty)
                    const shippedQty = Number(item.shippedQty ?? 0)
                    const remainingQty = Math.max(0, orderedQty - shippedQty)

                    return (
                      <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2.5 text-[13px] text-muted-foreground">{idx + 1}</td>
                        <td className="px-3 py-2.5"><span className="font-mono text-[13px] text-muted-foreground">{item.item.code}</span></td>
                        <td className="px-3 py-2.5"><span className="text-[14px] font-medium">{item.item.name}</span></td>
                        <td className="px-3 py-2.5 text-center"><span className="text-[13px] text-muted-foreground">{item.item.uom}</span></td>
                        <td className="px-3 py-2.5 text-right"><span className="text-[14px] font-medium tabular-nums">{formatQuantity(orderedQty)}</span></td>
                        <td className="px-3 py-2.5 text-right"><span className={`text-[13px] tabular-nums ${shippedQty > 0 ? "text-green-700 font-medium" : "text-muted-foreground"}`}>{shippedQty > 0 ? formatQuantity(shippedQty) : "—"}</span></td>
                        <td className="px-3 py-2.5 text-right"><span className={`text-[13px] font-medium tabular-nums ${remainingQty > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{formatQuantity(remainingQty)}</span></td>
                        <td className="px-3 py-2.5 text-center">{item.deliveryDate ? <span className="text-[13px] text-muted-foreground">{toKstDateKey(new Date(item.deliveryDate)).slice(5)}</span> : <span className="text-[13px] text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2.5"><span className="text-[13px] text-muted-foreground">{item.note ?? "—"}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold">생산·출하 진행상황</h3>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  생산실적은 작업지시별 가장 높은 실적 공정의 양품수량 기준이며, 완제품입고와 출하는 별도로 표시합니다.
                </p>
              </div>
              {progressLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            </div>

            {progressError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">{progressError}</div>
            ) : null}

            {progress ? (
              <>
                <div className="mb-4 grid gap-3 md:grid-cols-4 lg:grid-cols-7">
                  <SummaryCard label="총 수주" value={progress.summary.orderedQty} />
                  <SummaryCard label="총 계획" value={progress.summary.plannedQty} />
                  <SummaryCard label="총 작업지시" value={progress.summary.workOrderQty} />
                  <SummaryCard label="총 생산실적" value={progress.summary.producedQty} />
                  <SummaryCard label="총 완제품입고" value={progress.summary.finishedGoodsReceiptQty} />
                  <SummaryCard label="총 출하" value={progress.summary.shippedQty} />
                  <SummaryCard label="총 잔량" value={progress.summary.remainingQty} emphasis={progress.summary.remainingQty > 0} />
                </div>

                <div className="overflow-x-auto rounded-xl border">
                  <table className="min-w-[1180px] w-full text-[13px]">
                    <thead>
                      <tr className="border-b bg-muted/50 text-muted-foreground">
                        <th className="px-3 py-2.5 text-left font-medium">품목</th>
                        <th className="px-3 py-2.5 text-right font-medium">수주수량</th>
                        <th className="px-3 py-2.5 text-right font-medium">생산계획</th>
                        <th className="px-3 py-2.5 text-right font-medium">작업지시</th>
                        <th className="px-3 py-2.5 text-right font-medium">생산실적</th>
                        <th className="px-3 py-2.5 text-right font-medium">완제품입고</th>
                        <th className="px-3 py-2.5 text-right font-medium">출하</th>
                        <th className="px-3 py-2.5 text-right font-medium">잔량</th>
                        <th className="px-3 py-2.5 text-center font-medium">생산상태</th>
                        <th className="px-3 py-2.5 text-center font-medium">출하상태</th>
                        <th className="px-3 py-2.5 text-center font-medium">납기</th>
                        <th className="px-3 py-2.5 text-left font-medium">관련 업무</th>
                      </tr>
                    </thead>
                    <tbody>
                      {progress.items.map((item) => (
                        <tr key={item.salesOrderItemId} className="border-b last:border-b-0 align-top hover:bg-muted/20">
                          <td className="px-3 py-3">
                            <div className="font-medium">{item.itemName}</div>
                            <div className="font-mono text-[12px] text-muted-foreground">{item.itemCode} · {item.uom}</div>
                          </td>
                          <td className="px-3 py-3 text-right"><Quantity value={item.orderedQty} /></td>
                          <td className="px-3 py-3 text-right"><Quantity value={item.plannedQty} /></td>
                          <td className="px-3 py-3 text-right"><Quantity value={item.workOrderQty} /></td>
                          <td className="px-3 py-3 text-right"><Quantity value={item.producedQty} /></td>
                          <td className="px-3 py-3 text-right"><Quantity value={item.finishedGoodsReceiptQty} /></td>
                          <td className="px-3 py-3 text-right">
                            <div><Quantity value={item.shippedQty} /></div>
                            {item.plannedShipmentQty > 0 ? <div className="mt-1 text-[12px] text-muted-foreground">예정 <Quantity value={item.plannedShipmentQty} /></div> : null}
                          </td>
                          <td className={`px-3 py-3 text-right font-medium ${item.remainingQty > 0 ? "text-amber-700" : "text-emerald-700"}`}><Quantity value={item.remainingQty} /></td>
                          <td className="px-3 py-3 text-center"><StatusBadge status={item.productionStatus} /></td>
                          <td className="px-3 py-3 text-center"><ShipmentBadge status={item.shipmentStatus} /></td>
                          <td className="px-3 py-3 text-center">
                            <div className="tabular-nums">{item.effectiveDeliveryDate}</div>
                            {item.isOverdue ? <Badge variant="outline" className="mt-1 border-red-200 bg-red-50 text-red-700">납기 경과</Badge> : null}
                          </td>
                          <td className="px-3 py-3 space-y-2">
                            <div className="flex items-start gap-2"><span className="w-14 shrink-0 text-muted-foreground">계획</span><LinkList links={item.productionPlans} enabled={progress.permissions.canReadProductionPlan} /></div>
                            <div className="flex items-start gap-2"><span className="w-14 shrink-0 text-muted-foreground">지시</span><LinkList links={item.workOrders} enabled={progress.permissions.canReadWorkOrder} /></div>
                            <div className="flex items-start gap-2"><span className="w-14 shrink-0 text-muted-foreground">출하</span><LinkList links={item.shipments} enabled={progress.permissions.canReadShipment} /></div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : !progressLoading && !progressError ? (
              <div className="rounded-lg border px-4 py-6 text-center text-[14px] text-muted-foreground">진행상황 데이터가 없습니다.</div>
            ) : null}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function SummaryCard({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${emphasis ? "border-amber-200 bg-amber-50" : "bg-muted/20"}`}>
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[16px] font-semibold tabular-nums ${emphasis ? "text-amber-700" : "text-foreground"}`}>{formatQuantity(value)}</p>
    </div>
  )
}
