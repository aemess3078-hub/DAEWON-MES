"use client"

import { useCallback, useEffect, useState } from "react"
import { format } from "date-fns"
import { Pencil, Trash2, CheckCircle2, RefreshCw } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useUserRole } from "@/lib/contexts/user-role-context"
import { canDecideProjectOrderPrice } from "@/lib/project-order-price-status"
import { calculateProjectOrderPriceAmounts } from "@/lib/project-order-price-calculations"
import {
  getProjectOrderPriceDetail,
  deleteProjectOrderPrice,
  type ProjectOrderPriceDetail,
} from "@/lib/actions/project-order-price.actions"
import { PRICE_STATUS_CONFIG } from "./columns"
import { ProjectPriceFormDialog } from "./project-price-form-dialog"
import { DecidePriceDialog } from "./decide-price-dialog"
import { formatAmountWithCurrency, formatQuantity } from "@/lib/utils"

interface ProjectPriceDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  priceId: string | null
  onChanged?: () => void
}

function fmtDate(d: Date | string | null): string {
  return d ? format(new Date(d), "yyyy-MM-dd") : "—"
}

function fmtDateTime(d: Date | string | null): string {
  return d ? format(new Date(d), "yyyy-MM-dd HH:mm") : "—"
}

function fmtAmount(amount: number | null, currency: string): string {
  if (amount == null) return "—"
  // 기존 표시 정책 유지: 금액(수량 x 단가)은 소수 없이 반올림해 보여준다.
  // formatQuantity는 절사만 하고 반올림하지 않으므로, 반올림은 여기서 먼저 한다.
  return formatAmountWithCurrency(Math.round(amount), currency, { maxDecimals: 0 })
}

function fmtRate(rate: number | null): string {
  if (rate == null) return "—"
  return `${rate > 0 ? "+" : ""}${rate.toFixed(1)}%`
}

export function ProjectPriceDetailSheet({ open, onOpenChange, priceId, onChanged }: ProjectPriceDetailSheetProps) {
  const role = useUserRole()
  const canOperate = role !== "VIEWER"
  const canDecide = canDecideProjectOrderPrice(role)

  const [isLoading, setIsLoading] = useState(false)
  const [price, setPrice] = useState<ProjectOrderPriceDetail | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [decideOpen, setDecideOpen] = useState(false)

  const refetch = useCallback(() => {
    if (!priceId) return
    setIsLoading(true)
    getProjectOrderPriceDetail(priceId)
      .then(setPrice)
      .catch((e) => alert(e instanceof Error ? e.message : "정보를 불러오지 못했습니다."))
      .finally(() => setIsLoading(false))
  }, [priceId])

  useEffect(() => {
    if (open && priceId) {
      refetch()
    } else if (!open) {
      setPrice(null)
    }
  }, [open, priceId, refetch])

  const handleDelete = async () => {
    if (!price) return
    if (!confirm(`'${price.projectOrder.code}' 프로젝트의 단가 정보를 삭제하시겠습니까?`)) return
    setIsPending(true)
    try {
      const result = await deleteProjectOrderPrice(price.id)
      if (!result.ok) {
        alert(result.error ?? "삭제 중 오류가 발생했습니다.")
        return
      }
      onChanged?.()
      onOpenChange(false)
    } finally {
      setIsPending(false)
    }
  }

  if (!priceId) return null

  const amounts = price
    ? calculateProjectOrderPriceAmounts({
        quantity: price.quantity,
        quotationUnitPrice: price.quotationUnitPrice,
        orderUnitPrice: price.orderUnitPrice,
        finalUnitPrice: price.finalUnitPrice,
      })
    : null

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          {isLoading && !price ? (
            <p className="text-[14px] text-muted-foreground py-8 text-center">불러오는 중...</p>
          ) : price ? (
            <>
              <SheetHeader className="pb-6 border-b">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <SheetTitle className="text-[20px] font-semibold font-mono">{price.projectOrder.code}</SheetTitle>
                    <p className="text-[15px] text-muted-foreground font-medium">{price.projectOrder.name}</p>
                  </div>
                  <Badge variant={PRICE_STATUS_CONFIG[price.status].variant} className="text-[12px] mt-1">
                    {PRICE_STATUS_CONFIG[price.status].label}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-3">
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">사업장</p>
                    <p className="text-[14px] font-medium">[{price.site.code}] {price.site.name}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">담당자</p>
                    <p className="text-[14px] font-medium">{price.owner.name}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">거래처</p>
                    <p className="text-[14px] font-medium">{price.customer.name}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">품목</p>
                    <p className="text-[14px] font-medium">[{price.item.code}] {price.item.name}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">견적번호</p>
                    <p className="text-[14px] font-medium">{price.quotation?.quotationNo ?? "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">수주번호</p>
                    <p className="text-[14px] font-medium">{price.salesOrder?.orderNo ?? "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">수량 / 통화</p>
                    <p className="text-[14px] font-medium">{formatQuantity(price.quantity)} {price.item.uom} · {price.currency}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">최종결정일</p>
                    <p className="text-[14px] font-medium">{fmtDate(price.decidedAt)}</p>
                  </div>
                </div>
              </SheetHeader>

              <div className="pt-6 space-y-5">
                <div className="space-y-1.5">
                  <p className="text-[13px] font-semibold text-muted-foreground">가격 비교</p>
                  <div className="rounded-lg border divide-y">
                    <div className="grid grid-cols-3 gap-2 p-3 text-[13px]">
                      <div>
                        <p className="text-muted-foreground">견적단가 / 견적금액</p>
                        <p className="font-medium tabular-nums">
                          {price.quotationUnitPrice != null
                            ? formatAmountWithCurrency(price.quotationUnitPrice, price.currency, { maxDecimals: 2 })
                            : "—"}
                        </p>
                        <p className="text-muted-foreground tabular-nums">{fmtAmount(amounts?.quotationAmount ?? null, price.currency)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">수주단가 / 수주금액</p>
                        <p className="font-medium tabular-nums">
                          {price.orderUnitPrice != null
                            ? formatAmountWithCurrency(price.orderUnitPrice, price.currency, { maxDecimals: 2 })
                            : "—"}
                        </p>
                        <p className="text-muted-foreground tabular-nums">{fmtAmount(amounts?.orderAmount ?? null, price.currency)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">최종결정단가 / 금액</p>
                        <p className="font-semibold tabular-nums">
                          {price.finalUnitPrice != null
                            ? formatAmountWithCurrency(price.finalUnitPrice, price.currency, { maxDecimals: 2 })
                            : "—"}
                        </p>
                        <p className="text-muted-foreground tabular-nums">{fmtAmount(amounts?.finalAmount ?? null, price.currency)}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-3 text-[13px]">
                      <div>
                        <p className="text-muted-foreground">견적→최종 조정액 / 조정률</p>
                        <p className="font-medium tabular-nums">
                          {fmtAmount(amounts?.quoteToFinalDifference ?? null, price.currency)} · {fmtRate(amounts?.quoteToFinalRate ?? null)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">수주→최종 조정액 / 조정률</p>
                        <p className="font-medium tabular-nums">
                          {fmtAmount(amounts?.orderToFinalDifference ?? null, price.currency)} · {fmtRate(amounts?.orderToFinalRate ?? null)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {price.decisionReason && (
                  <div className="space-y-1.5">
                    <p className="text-[13px] font-semibold text-muted-foreground">결정사유</p>
                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap rounded-lg bg-muted/30 px-3 py-2.5">
                      {price.decisionReason}
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <p className="text-[13px] font-semibold text-muted-foreground">최종결정단가 변경이력</p>
                  {price.revisions.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground py-3 text-center rounded-lg border">
                      아직 결정된 이력이 없습니다.
                    </p>
                  ) : (
                    <div className="rounded-lg border divide-y">
                      {price.revisions.map((rev) => (
                        <div key={rev.id} className="p-3 space-y-1">
                          <div className="flex items-center justify-between">
                            <p className="text-[13px] text-muted-foreground">{fmtDateTime(rev.changedAt)} · {rev.changedBy.name}</p>
                            <p className="text-[14px] font-semibold tabular-nums">
                              {rev.previousFinalUnitPrice != null
                                ? `${formatQuantity(rev.previousFinalUnitPrice, { maxDecimals: 2 })} → `
                                : ""}
                              {formatAmountWithCurrency(rev.newFinalUnitPrice, price.currency, { maxDecimals: 2 })}
                            </p>
                          </div>
                          {rev.reason && <p className="text-[13px] text-muted-foreground">사유: {rev.reason}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t text-[12px] text-muted-foreground space-y-0.5">
                  <p>등록: {price.createdBy.name} · {fmtDateTime(price.createdAt)}</p>
                  {price.updatedBy && <p>최근 수정: {price.updatedBy.name} · {fmtDateTime(price.updatedAt)}</p>}
                </div>

                {canOperate && (
                  <div className="flex items-center gap-2 pt-2 border-t">
                    {canDecide && (
                      <Button size="sm" onClick={() => setDecideOpen(true)} disabled={isPending} className="gap-1.5">
                        {price.status === "DECIDED" ? <RefreshCw className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        {price.status === "DECIDED" ? "재결정" : "최종결정"}
                      </Button>
                    )}
                    {price.status === "DRAFT" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={isPending} className="gap-1.5">
                          <Pencil className="h-3.5 w-3.5" />
                          수정
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-destructive hover:text-destructive"
                          onClick={handleDelete}
                          disabled={isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          삭제
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {price.status === "DECIDED" && (
                  <p className="text-[13px] text-muted-foreground">
                    결정완료된 단가는 삭제할 수 없습니다. 최종결정단가만 재결정으로 변경할 수 있습니다.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-[14px] text-muted-foreground py-8 text-center">프로젝트 단가 정보를 찾을 수 없습니다.</p>
          )}
        </SheetContent>
      </Sheet>

      <ProjectPriceFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        price={price}
        onSuccess={() => {
          setEditOpen(false)
          refetch()
          onChanged?.()
        }}
      />

      <DecidePriceDialog
        open={decideOpen}
        onOpenChange={setDecideOpen}
        priceId={price?.id ?? null}
        isRedecision={price?.status === "DECIDED"}
        currentFinalUnitPrice={price?.finalUnitPrice ?? null}
        onSuccess={() => {
          setDecideOpen(false)
          refetch()
          onChanged?.()
        }}
      />
    </>
  )
}
