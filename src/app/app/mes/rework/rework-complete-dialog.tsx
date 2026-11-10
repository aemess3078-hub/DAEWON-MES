"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ReworkRow, completeRework } from "@/lib/actions/process-progress.actions"
import { formatQuantity } from "@/lib/utils"
import { clampMergedInput, computeScrapQty, resolveReworkCompletion } from "@/lib/rework-complete-qty"

interface ReworkCompleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reworkItem: ReworkRow | null
}

export function ReworkCompleteDialog({
  open,
  onOpenChange,
  reworkItem,
}: ReworkCompleteDialogProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // 양품 복귀 수량은 사용자가 입력하고, 폐기 수량은 (재작업 수량 - 복귀 수량)으로 자동 계산한다.
  // 팝업이 열릴 때(또는 대상이 바뀔 때) 복귀 수량은 전체 재작업 수량으로 기본 설정한다.
  const [mergedQty, setMergedQty] = useState("")
  const itemId = reworkItem?.id
  const itemQty = reworkItem?.reworkQty
  useEffect(() => {
    if (open && itemQty !== undefined) setMergedQty(String(itemQty))
  }, [open, itemId, itemQty])

  if (!reworkItem) return null

  const scrapQty = computeScrapQty(mergedQty, reworkItem.reworkQty)
  const isValid = scrapQty !== null

  const handleSubmit = () => {
    const resolved = resolveReworkCompletion(mergedQty, reworkItem.reworkQty)
    if (!resolved.ok) {
      alert(resolved.error)
      return
    }

    startTransition(async () => {
      const res = await completeRework({
        reworkWipUnitId: reworkItem.id,
        mergedQty: resolved.mergedQty,
        scrapQty: resolved.scrapQty,
      })
      if (!res.ok) {
        alert(res.error ?? "오류가 발생했습니다.")
        return
      }
      router.refresh()
      onOpenChange(false)
    })
  }

  const handleClose = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[18px]">재작업 완료 처리</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 공정 정보 */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-1">
            <div className="text-[13px] text-muted-foreground">공정</div>
            <div className="text-[15px] font-medium">
              {reworkItem.workOrder.orderNo} — {reworkItem.routingOperation.seq}.{" "}
              {reworkItem.routingOperation.name}
            </div>
            <div className="text-[14px] text-muted-foreground">
              {reworkItem.workOrder.item.name}
            </div>
          </div>

          {/* 재작업 수량 정보 */}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-md border p-3">
              <div className="text-[13px] text-muted-foreground mb-1">현재 완료 재공</div>
              <div className="text-[20px] font-semibold text-slate-700">
                {reworkItem.parentWipUnit ? formatQuantity(reworkItem.parentWipUnit.qty) : "-"}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-[13px] text-muted-foreground mb-1">재작업 대상</div>
              <div className="text-[20px] font-semibold text-amber-700">
                {formatQuantity(reworkItem.reworkQty)}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-[13px] text-blue-800">
            {reworkItem.returnToOperation
              ? `양품 복귀 수량은 '${reworkItem.returnToOperation.name}' 공정부터 후속 공정을 정상 진행합니다. 모든 공정을 완료한 수량만 완제품 입고할 수 있으며, 재작업 발생 공정의 완료 수량은 다시 증가시키지 않습니다. 폐기 수량은 재공에서 제외되고 폐기 이력이 기록됩니다.`
              : "이 처리는 완료 재공 수량의 복귀 및 폐기 이력만 기록하며, 공정 완료 수량을 다시 증가시키지 않습니다."}
          </div>

          {/* 결과 입력: 복귀 수량만 입력, 폐기 수량은 자동 계산(읽기 전용) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[14px]">양품 복귀 수량</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={reworkItem.reworkQty}
                value={mergedQty}
                onChange={(e) => setMergedQty(clampMergedInput(e.target.value, reworkItem.reworkQty))}
                className="text-[14px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[14px]">폐기 수량 (자동 계산)</Label>
              <Input
                readOnly
                tabIndex={-1}
                value={scrapQty === null ? "" : String(scrapQty)}
                placeholder="-"
                className="bg-muted/50 text-[14px]"
                aria-label="폐기 수량 (재작업 대상 수량 - 양품 복귀 수량)"
              />
            </div>
          </div>

          <div className="rounded-md bg-muted/30 p-3 text-[13px] text-muted-foreground">
            폐기 수량 = 재작업 대상 {formatQuantity(reworkItem.reworkQty)} − 양품 복귀{" "}
            {formatQuantity(Number(mergedQty) || 0)} ={" "}
            <span className="font-medium text-foreground">{scrapQty === null ? "-" : `${formatQuantity(scrapQty)}개`}</span>
            {scrapQty === reworkItem.reworkQty && reworkItem.reworkQty > 0 ? " (전량 폐기)" : ""}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !isValid}>
            {isPending ? "처리 중..." : "완료 처리"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
