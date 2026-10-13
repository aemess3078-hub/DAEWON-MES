"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { QuantityInput } from "@/components/ui/quantity-input"
import { Textarea } from "@/components/ui/textarea"
import { setProjectOrderPriceFinal } from "@/lib/actions/project-order-price.actions"

interface DecidePriceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  priceId: string | null
  // 최초 결정인지 재결정인지에 따라 결정사유 필수 여부가 달라진다(§9).
  isRedecision: boolean
  currentFinalUnitPrice: number | null
  onSuccess: () => void
}

export function DecidePriceDialog({
  open,
  onOpenChange,
  priceId,
  isRedecision,
  currentFinalUnitPrice,
  onSuccess,
}: DecidePriceDialogProps) {
  const [finalUnitPrice, setFinalUnitPrice] = useState<number | undefined>(undefined)
  const [decisionReason, setDecisionReason] = useState("")
  const [isPending, setIsPending] = useState(false)

  useEffect(() => {
    if (open) {
      setFinalUnitPrice(currentFinalUnitPrice ?? undefined)
      setDecisionReason("")
    }
  }, [open, currentFinalUnitPrice])

  const handleClose = () => onOpenChange(false)

  const handleSubmit = async () => {
    if (!priceId) return
    if (finalUnitPrice === undefined || finalUnitPrice < 0) {
      alert("최종결정단가를 올바르게 입력하세요.")
      return
    }
    const price = finalUnitPrice
    if (isRedecision && !decisionReason.trim()) {
      alert("재결정 시 결정사유를 입력해야 합니다.")
      return
    }
    setIsPending(true)
    try {
      const result = await setProjectOrderPriceFinal(priceId, {
        finalUnitPrice: price,
        decisionReason: decisionReason.trim() || null,
      })
      if (!result.ok) {
        alert(result.error ?? "결정 처리 중 오류가 발생했습니다.")
        return
      }
      onSuccess()
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{isRedecision ? "최종결정단가 재수정" : "최종결정단가 결정"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-[14px]">최종결정단가 <span className="text-red-500">*</span></Label>
            <QuantityInput
              maxDecimals={2}
              allowNegative={false}
              value={finalUnitPrice}
              onChange={setFinalUnitPrice}
              className="text-[14px]"
              placeholder="0"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[14px]">
              결정사유 {isRedecision && <span className="text-red-500">*</span>}
              {!isRedecision && <span className="text-muted-foreground"> (선택)</span>}
            </Label>
            <Textarea
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
              placeholder={isRedecision ? "재수정 사유를 입력하세요 (필수)" : "결정 사유를 입력하세요"}
              className="text-[14px]"
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>취소</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "처리 중..." : isRedecision ? "재결정" : "결정"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
