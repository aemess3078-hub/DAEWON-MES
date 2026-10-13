"use client"

function sanitizeDisplayNote(note: string): string {
  return note.replace(/\s*\(salesOrderId:\s*[^)]+\)/gi, "").trim()
}

import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { PlanWithDetails } from "@/lib/actions/production-plan.actions"
import { PlanStatus, PlanType } from "@prisma/client"
import { ShoppingCart } from "lucide-react"
import { formatQuantity } from "@/lib/utils"

interface PlanDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: PlanWithDetails | null
}

const planTypeLabels: Record<PlanType, string> = {
  DAILY: "일간",
  WEEKLY: "주간",
  MONTHLY: "월간",
}

const planStatusLabels: Record<PlanStatus, string> = {
  DRAFT: "초안",
  CONFIRMED: "확정",
  IN_PROGRESS: "진행중",
  COMPLETED: "완료",
  CANCELLED: "취소",
}

const itemTypeLabels: Record<string, string> = {
  RAW_MATERIAL: "원자재",
  SEMI_FINISHED: "반제품",
  FINISHED: "완제품",
  CONSUMABLE: "소모품",
}

const salesOrderStatusLabels: Record<string, string> = {
  DRAFT: "초안",
  IN_REVIEW: "검토중",
  APPROVED: "승인",
  IN_PRODUCTION: "생산중",
  PARTIAL_SHIPPED: "부분출하",
  SHIPPED: "출하완료",
  CLOSED: "마감",
  CANCELLED: "취소",
}

function formatDate(date: Date): string {
  return new Date(date).toISOString().split("T")[0]
}

export function PlanDetailSheet({ open, onOpenChange, plan }: PlanDetailSheetProps) {
  if (!plan) return null

  const salesBasedItems = plan.items.filter((i) => i.salesOrderItem != null)
  const isSalesBased = salesBasedItems.length > 0

  // 수주 기준으로 그룹핑
  const salesOrderGroups = isSalesBased
    ? Object.values(
        salesBasedItems.reduce<
          Record<
            string,
            {
              salesOrder: NonNullable<typeof salesBasedItems[0]["salesOrderItem"]>["salesOrder"]
              items: typeof salesBasedItems
            }
          >
        >((acc, planItem) => {
          const so = planItem.salesOrderItem!.salesOrder
          if (!acc[so.id]) {
            acc[so.id] = { salesOrder: so, items: [] }
          }
          acc[so.id].items.push(planItem)
          return acc
        }, {})
      )
    : []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto flex flex-col">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle className="font-mono text-[18px]">{plan.planNo}</SheetTitle>
            {isSalesBased && (
              <Badge className="text-[12px] bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50">
                <ShoppingCart className="w-3 h-3 mr-1" />
                수주기반
              </Badge>
            )}
          </div>
          <SheetDescription>생산계획 품목 상세</SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex-1 space-y-6">
          {/* 기본 정보 */}
          <div className="rounded-md border divide-y text-[14px]">
            <div className="flex items-center px-4 py-2.5">
              <span className="w-24 text-muted-foreground shrink-0">계획유형</span>
              <Badge variant="outline" className="text-[13px]">
                {planTypeLabels[plan.planType]}
              </Badge>
            </div>
            <div className="flex items-center px-4 py-2.5">
              <span className="w-24 text-muted-foreground shrink-0">공장</span>
              <span>{plan.site.name}</span>
            </div>
            <div className="flex items-center px-4 py-2.5">
              <span className="w-24 text-muted-foreground shrink-0">계획 기간</span>
              <span className="text-muted-foreground">
                {formatDate(plan.startDate)} ~ {formatDate(plan.endDate)}
              </span>
            </div>
            <div className="flex items-center px-4 py-2.5">
              <span className="w-24 text-muted-foreground shrink-0">상태</span>
              <StatusBadge status={plan.status} label={planStatusLabels[plan.status]} />
            </div>
            {plan.note && (
              <div className="flex items-start px-4 py-2.5">
                <span className="w-24 text-muted-foreground shrink-0 pt-0.5">비고</span>
                <span className="text-muted-foreground">{sanitizeDisplayNote(plan.note ?? "")}</span>
              </div>
            )}
          </div>

          {/* 수주 정보 (수주기반인 경우만) */}
          {isSalesBased && (
            <div className="space-y-3">
              <p className="text-[15px] font-medium flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-blue-600" />
                연결 수주
                <span className="text-[13px] font-normal text-muted-foreground">
                  {salesOrderGroups.length}건
                </span>
              </p>

              {salesOrderGroups.map(({ salesOrder, items: soItems }) => (
                <div
                  key={salesOrder.id}
                  className="rounded-md border border-blue-100 overflow-hidden"
                >
                  {/* 수주 헤더 */}
                  <div className="bg-blue-50 px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold text-[14px] text-blue-800">
                        {salesOrder.orderNo}
                      </span>
                      <SalesOrderStatusBadge status={salesOrder.status} />
                    </div>
                    <span className="text-[13px] text-blue-700 font-medium">
                      {salesOrder.customer.name}
                      <span className="ml-1 font-normal text-blue-500">
                        [{salesOrder.customer.code}]
                      </span>
                    </span>
                  </div>

                  {/* 수주 날짜 정보 */}
                  <div className="px-4 py-2 bg-blue-50/40 border-b border-blue-100 flex gap-6 text-[13px] text-muted-foreground">
                    <span>
                      수주일:{" "}
                      <span className="text-foreground">{formatDate(salesOrder.orderDate)}</span>
                    </span>
                    <span>
                      고객 납기일:{" "}
                      <span className="font-medium text-foreground">
                        {formatDate(salesOrder.deliveryDate)}
                      </span>
                    </span>
                  </div>

                  {/* 수주 품목 테이블 */}
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="bg-muted/30 border-b">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                          품목
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                          수주수량
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                          계획수량
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                          고객 납기
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {soItems.map((planItem) => (
                        <tr key={planItem.id} className="border-t hover:bg-muted/10">
                          <td className="px-3 py-2.5">
                            <div className="font-medium">{planItem.item.name}</div>
                            <div className="text-muted-foreground text-[12px]">
                              {planItem.item.code}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {formatQuantity(Number(planItem.salesOrderItem!.qty))}
                          </td>
                          <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                            {formatQuantity(Number(planItem.plannedQty))}
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground">
                            {formatDate(planItem.salesOrderItem!.deliveryDate ?? salesOrder.deliveryDate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {/* 품목 목록 */}
          <div className="space-y-2">
            <p className="text-[15px] font-medium">
              품목 목록
              <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                {plan.items.length}건
              </span>
            </p>

            {plan.items.length === 0 ? (
              <div className="rounded-md border border-dashed py-8 text-center text-[14px] text-muted-foreground">
                등록된 품목이 없습니다.
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                        품목
                      </th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                        유형
                      </th>
                      <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                        계획수량
                      </th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                        BOM
                      </th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                        라우팅
                      </th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                        수주
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.items.map((planItem, index) => (
                      <tr
                        key={planItem.id}
                        className={`border-t ${index % 2 === 0 ? "" : "bg-muted/20"}`}
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-medium">{planItem.item.name}</div>
                          <div className="text-muted-foreground text-[12px]">
                            {planItem.item.code}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {itemTypeLabels[planItem.item.itemType] ?? planItem.item.itemType}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                          {formatQuantity(Number(planItem.plannedQty))}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {planItem.bom?.version ?? (
                            <span className="text-muted-foreground/50">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {planItem.routing?.version ?? (
                            <span className="text-muted-foreground/50">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {planItem.salesOrderItem ? (
                            <span className="font-mono text-[12px] text-blue-600">
                              {planItem.salesOrderItem.salesOrder.orderNo}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40 text-[12px]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/30">
                      <td
                        colSpan={2}
                        className="px-3 py-2 text-[12px] text-muted-foreground font-medium"
                      >
                        합계
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatQuantity(
                          plan.items.reduce((sum, i) => sum + Number(i.plannedQty), 0)
                        )}
                      </td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>

        <SheetFooter className="mt-8 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function StatusBadge({ status, label }: { status: PlanStatus; label: string }) {
  if (status === "DRAFT")
    return <Badge variant="secondary" className="text-[13px]">{label}</Badge>
  if (status === "CONFIRMED")
    return <Badge variant="default" className="text-[13px]">{label}</Badge>
  if (status === "IN_PROGRESS")
    return (
      <Badge className="text-[13px] bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
        {label}
      </Badge>
    )
  if (status === "COMPLETED")
    return (
      <Badge className="text-[13px] bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
        {label}
      </Badge>
    )
  return <Badge variant="destructive" className="text-[13px]">{label}</Badge>
}

function SalesOrderStatusBadge({ status }: { status: string }) {
  const label = salesOrderStatusLabels[status] ?? status
  if (status === "IN_PRODUCTION")
    return (
      <Badge className="text-[12px] bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
        {label}
      </Badge>
    )
  if (status === "SHIPPED" || status === "CLOSED")
    return (
      <Badge className="text-[12px] bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
        {label}
      </Badge>
    )
  if (status === "APPROVED")
    return <Badge variant="default" className="text-[12px]">{label}</Badge>
  if (status === "CANCELLED")
    return <Badge variant="destructive" className="text-[12px]">{label}</Badge>
  return <Badge variant="secondary" className="text-[12px]">{label}</Badge>
}
