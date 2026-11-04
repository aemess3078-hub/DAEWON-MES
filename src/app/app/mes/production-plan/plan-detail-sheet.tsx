"use client"

function sanitizeDisplayNote(note: string): string {
  return stripProductionRequestTag(note.replace(/\s*\(salesOrderId:\s*[^)]+\)/gi, "")).trim()
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
import { ShoppingCart, Info } from "lucide-react"
import { formatQuantity } from "@/lib/utils"
import type { PlanQuantityView } from "@/lib/production-quantity-model"
import { APPROVAL_POLICY_NOTICE_KO, diffQty, summarizeKinds } from "@/lib/production-plan-form"
import { PlanKindBadge, ApprovalText } from "./plan-badges"
import { stripProductionRequestTag } from "@/lib/production-request-tag"

interface PlanDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: PlanWithDetails | null
  /** 2-A 조회 모델(없으면 계획 줄에 저장된 값으로 표시) */
  quantities?: PlanQuantityView | null
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

export function PlanDetailSheet({ open, onOpenChange, plan, quantities = null }: PlanDetailSheetProps) {
  if (!plan) return null
  const kindSummary = quantities?.kindSummary ?? summarizeKinds(plan.items.map((i) => i.productionKind))
  const lineById = new Map((quantities?.lines ?? []).map((l) => [l.planItemId, l]))
  const showApprovalNotice = plan.items.some((i) => Number(i.plannedQty) > Number(i.allocatedQty) && i.salesOrderItemId) || plan.items.some((i) => i.extraApprovalStatus !== "NOT_REQUIRED")

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
      <SheetContent className="sm:max-w-3xl overflow-y-auto flex flex-col" data-testid="plan-detail">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle className="font-mono text-[18px]">{plan.planNo}</SheetTitle>
            <PlanKindBadge kind={kindSummary} testId="detail-kind" />
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
                          실제 계획수량
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

          {/* 품목 목록: 유형·수주 충당·여유·실제 계획 수량·사유·승인 */}
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
              <div className="space-y-3">
                {plan.items.map((planItem) => {
                  const line = lineById.get(planItem.id)
                  const allocated = line?.allocatedQty ?? Number(planItem.allocatedQty)
                  const planned = line?.plannedQty ?? Number(planItem.plannedQty)
                  const extra = line ? (planItem.salesOrderItemId ? line.extraQty : 0) : planItem.salesOrderItemId ? diffQty(planItem.plannedQty, planItem.allocatedQty) : 0
                  const approvalStatus = line?.approval.status ?? planItem.extraApprovalStatus
                  const linked = planItem.salesOrderItem
                  return (
                    <div key={planItem.id} className="rounded-lg border p-3 space-y-2" data-testid={`detail-item-${planItem.id}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-[14px] font-medium">{planItem.item.name}</div>
                          <div className="text-[13px] text-muted-foreground font-mono">
                            {planItem.item.code} · {itemTypeLabels[planItem.item.itemType] ?? planItem.item.itemType}
                          </div>
                        </div>
                        <PlanKindBadge kind={planItem.productionKind} testId={`detail-item-kind-${planItem.id}`} />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="rounded-md border bg-background px-3 py-2">
                          <div className="text-[13px] text-muted-foreground">수주 충당</div>
                          <div className="text-[15px] font-semibold tabular-nums" data-testid={`detail-alloc-${planItem.id}`}>{formatQuantity(allocated)}</div>
                        </div>
                        <div className="rounded-md border bg-background px-3 py-2">
                          <div className="text-[13px] text-muted-foreground">여유 생산</div>
                          <div className="text-[15px] font-semibold tabular-nums" data-testid={`detail-extra-${planItem.id}`}>{formatQuantity(extra)}</div>
                        </div>
                        <div className="rounded-md border bg-background px-3 py-2">
                          <div className="text-[13px] text-muted-foreground">실제 계획 수량</div>
                          <div className="text-[15px] font-semibold tabular-nums" data-testid={`detail-planned-${planItem.id}`}>{formatQuantity(planned)}</div>
                        </div>
                        <div className="rounded-md border bg-background px-3 py-2">
                          <div className="text-[13px] text-muted-foreground">입고</div>
                          <div className="text-[15px] font-semibold tabular-nums" data-testid={`detail-received-${planItem.id}`}>{line ? formatQuantity(line.receivedQty) : "—"}</div>
                        </div>
                      </div>
                      <div className="text-[13px] text-muted-foreground space-y-0.5">
                        <div>
                          수주 연결:{" "}
                          {linked ? (
                            <span className="font-mono text-blue-700" data-testid={`detail-order-${planItem.id}`}>
                              {linked.salesOrder.orderNo}
                              <span className="font-sans text-muted-foreground"> · 수주 수량 {formatQuantity(Number(linked.qty))}</span>
                            </span>
                          ) : (
                            <span>없음 (재고 생산)</span>
                          )}
                        </div>
                        {planItem.extraReason ? (
                          <div data-testid={`detail-reason-${planItem.id}`}>여유 생산 사유: <span className="text-foreground">{planItem.extraReason}</span></div>
                        ) : null}
                        {extra > 0 || approvalStatus !== "NOT_REQUIRED" ? (
                          <div>여유 승인 상태: <ApprovalText status={approvalStatus} testId={`detail-approval-${planItem.id}`} /></div>
                        ) : null}
                        <div>
                          BOM {planItem.bom?.version ?? "-"} · 라우팅 {planItem.routing?.version ?? "-"}
                          {planItem.workOrders.length > 0 ? ` · 작업지시 ${planItem.workOrders.map((w) => w.orderNo).join(", ")}` : ""}
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div className="rounded-md border bg-muted/30 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[14px]">
                  <span className="text-muted-foreground font-medium">합계</span>
                  <span className="tabular-nums" data-testid="detail-total">
                    충당 {formatQuantity(quantities?.totals.allocatedQty ?? plan.items.reduce((sum, i) => sum + Number(i.allocatedQty), 0))}
                    {" · "}여유 {formatQuantity(quantities?.totals.extraQty ?? 0)}
                    {" · "}<span className="font-semibold">실제 계획 {formatQuantity(quantities?.totals.plannedQty ?? plan.items.reduce((sum, i) => sum + Number(i.plannedQty), 0))}</span>
                  </span>
                </div>
              </div>
            )}

            {showApprovalNotice && (
              <div className="flex items-start gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[13px] text-amber-800" data-testid="detail-approval-notice">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                {APPROVAL_POLICY_NOTICE_KO}
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
