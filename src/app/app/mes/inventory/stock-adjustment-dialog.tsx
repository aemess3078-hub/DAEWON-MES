"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ClipboardCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { QuantityInput } from "@/components/ui/quantity-input"
import { Textarea } from "@/components/ui/textarea"
import { adjustInventoryStock } from "@/lib/actions/inventory.actions"
import { formatQuantity } from "@/lib/utils"

export type StockAdjustmentTarget = {
  balanceId: string
  itemId: string
  itemCode: string
  itemName: string
  uom: string
  siteId: string
  siteName: string
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  lotId: string | null
  lotNo: string | null
  qtyOnHand: number
}

export function StockAdjustmentDialog({ target }: { target: StockAdjustmentTarget }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [physicalQty, setPhysicalQty] = useState<number | undefined>(target.qtyOnHand)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const isValidPhysicalQty = physicalQty !== undefined && Number.isFinite(physicalQty) && physicalQty >= 0
  const diffQty = isValidPhysicalQty
    ? Number((physicalQty - target.qtyOnHand).toFixed(6))
    : 0
  const canSubmit = isValidPhysicalQty && diffQty !== 0 && reason.trim().length > 0 && !isPending

  const diffClassName = useMemo(() => {
    if (!isValidPhysicalQty || diffQty === 0) return "text-muted-foreground"
    return diffQty > 0 ? "text-emerald-700" : "text-red-600"
  }, [diffQty, isValidPhysicalQty])

  function resetForm(nextOpen: boolean) {
    setOpen(nextOpen)
    setError(null)
    setSuccess(null)
    if (nextOpen) {
      setPhysicalQty(target.qtyOnHand)
      setReason("")
    }
  }

  function handleSubmit() {
    setError(null)
    setSuccess(null)

    if (!isValidPhysicalQty || physicalQty === undefined) {
      setError("실사수량은 0 이상 숫자여야 합니다.")
      return
    }
    if (diffQty === 0) {
      setError("현재 시스템수량과 동일하여 조정할 차이수량이 없습니다.")
      return
    }
    if (!reason.trim()) {
      setError("조정 사유를 입력하세요.")
      return
    }

    const confirmedPhysicalQty = physicalQty

    startTransition(async () => {
      const result = await adjustInventoryStock({
        balanceId: target.balanceId,
        physicalQty: confirmedPhysicalQty,
        reason,
      })

      if (!result.success) {
        setError(result.error ?? "재고조정 중 오류가 발생했습니다.")
        return
      }

      setSuccess(`ADJUST ${result.diffQty && result.diffQty > 0 ? "+" : ""}${formatQuantity(result.diffQty ?? 0)} 저장 완료 (${result.txNo})`)
      router.refresh()
      window.setTimeout(() => resetForm(false), 700)
    })
  }

  return (
    <Dialog open={open} onOpenChange={resetForm}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-[12px]"
          onClick={(event) => event.stopPropagation()}
        >
          <ClipboardCheck className="h-3.5 w-3.5" />
          재고조정
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[560px]" onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>재고조정</DialogTitle>
          <DialogDescription>
            실사수량과 시스템수량의 차이만큼 ADJUST 이력을 생성합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-3 text-[13px]">
            <Info label="품목" value={`[${target.itemCode}] ${target.itemName}`} />
            <Info label="창고" value={`[${target.warehouseCode}] ${target.warehouseName}`} />
            <Info label="사이트" value={target.siteName} />
            <Info label="LOT" value={target.lotNo ?? "비LOT"} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-[13px]">현재 시스템수량</Label>
              <div className="mt-1 rounded-md border bg-muted/20 px-3 py-2 text-right font-semibold tabular-nums">
                {formatQuantity(target.qtyOnHand)} {target.uom}
              </div>
            </div>
            <div>
              <Label htmlFor={`physical-${target.balanceId ?? target.itemId}`} className="text-[13px]">
                실사수량
              </Label>
              <QuantityInput
                id={`physical-${target.balanceId ?? target.itemId}`}
                value={physicalQty}
                onChange={setPhysicalQty}
                maxDecimals={6}
                allowNegative={false}
                className="mt-1 text-right tabular-nums"
              />
            </div>
            <div>
              <Label className="text-[13px]">차이수량</Label>
              <div className={`mt-1 rounded-md border bg-muted/20 px-3 py-2 text-right font-semibold tabular-nums ${diffClassName}`}>
                {isValidPhysicalQty ? `${diffQty > 0 ? "+" : ""}${formatQuantity(diffQty)}` : "-"} {target.uom}
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor={`reason-${target.balanceId ?? target.itemId}`} className="text-[13px]">
              조정 사유
            </Label>
            <Textarea
              id={`reason-${target.balanceId ?? target.itemId}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="실사 결과, 파손, 누락 확인 등"
              className="mt-1 min-h-[88px]"
            />
          </div>

          {error ? <p className="text-[13px] text-red-600">{error}</p> : null}
          {success ? <p className="text-[13px] text-emerald-700">{success}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => resetForm(false)} disabled={isPending}>
            취소
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {isPending ? "저장 중..." : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-medium" title={value}>
        {value}
      </p>
    </div>
  )
}
