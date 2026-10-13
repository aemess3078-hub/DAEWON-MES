"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { closePurchaseOrderRemainder } from "@/lib/actions/purchase-order.actions"
import type { PurchaseOrderRow } from "./columns"

const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 3 })

/** 종결 대상 라인: 발주 − 입고 > 0 인 품목만 */
export function getOpenLines(order: PurchaseOrderRow) {
  return order.items
    .map((i) => {
      const qty = Number(i.qty)
      const received = Number(i.receivedQty)
      return {
        id: i.id,
        code: i.item.code,
        name: i.item.name,
        uom: i.item.uom ?? "",
        qty,
        received,
        remaining: Math.max(0, qty - received),
      }
    })
    .filter((l) => l.remaining > 0)
}

interface Props {
  order: PurchaseOrderRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed: () => void
}

export function PurchaseOrderCloseDialog({ order, open, onOpenChange, onClosed }: Props) {
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setReason("")
      setError(null)
    }
  }, [open, order?.id])

  if (!order) return null
  const lines = getOpenLines(order)
  const totalRemaining = lines.reduce((s, l) => s + l.remaining, 0)
  const singleUom = new Set(lines.map((l) => l.uom)).size === 1 ? lines[0]?.uom ?? "" : ""

  async function submit() {
    if (!order) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await closePurchaseOrderRemainder(order.id, reason.trim() || undefined)
      if (!res.success) {
        setError(res.error)
        return
      }
      onOpenChange(false)
      onClosed()
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 중 오류가 발생했습니다.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">미입고 잔량 종결</DialogTitle>
          <DialogDescription className="text-[14px]">
            발주 <span className="font-mono">{order.orderNo}</span> · {order.supplier.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[14px] text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              남은 <strong>{fmt(totalRemaining)}{singleUom}</strong>는 더 이상 입고예정으로 계산되지 않습니다.
              종결 후에는 이 발주에 입고할 수 없으며, 발주수량과 입고수량 기록은 그대로 보존됩니다.
            </p>
          </div>

          <div className="overflow-hidden rounded-md border">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-[13px] text-muted-foreground">
                  <th className="px-3 py-2">품목</th>
                  <th className="px-3 py-2 text-right">발주</th>
                  <th className="px-3 py-2 text-right">입고</th>
                  <th className="px-3 py-2 text-right">종결 잔량</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-mono text-[13px]">{l.code}</span> {l.name}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(l.qty)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(l.received)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-amber-700">
                      {fmt(l.remaining)}
                      {l.uom}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="po-close-reason" className="text-[14px] font-medium">
              종결 사유 <span className="text-[13px] font-normal text-muted-foreground">(선택, 감사 이력에 기록)</span>
            </label>
            <Textarea
              id="po-close-reason"
              value={reason}
              maxLength={200}
              rows={2}
              placeholder="예: 공급사 생산 중단으로 잔량 납품 불가"
              className="text-[14px]"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {error && <p className="text-[14px] text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            취소
          </Button>
          <Button variant="destructive" onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            잔량 종결
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
