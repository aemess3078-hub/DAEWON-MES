"use client"

import { useState, useTransition } from "react"
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
  const [mergedQty, setMergedQty] = useState("")
  const [scrapQty, setScrapQty] = useState("")

  if (!reworkItem) return null

  const handleSubmit = () => {
    const merged = Number(mergedQty)
    const scrap = Number(scrapQty)
    if (
      !Number.isFinite(merged) ||
      !Number.isFinite(scrap) ||
      merged < 0 ||
      scrap < 0 ||
      merged + scrap <= 0
    ) {
      alert("복귀 수량과 폐기 수량을 올바르게 입력하세요.")
      return
    }
    if (Math.abs(merged + scrap - reworkItem.reworkQty) > 0.000001) {
      alert(`복귀 수량과 폐기 수량의 합계는 재작업 수량(${formatQuantity(reworkItem.reworkQty)})과 같아야 합니다.`)
      return
    }

    startTransition(async () => {
      const res = await completeRework({
        reworkWipUnitId: reworkItem.id,
        mergedQty: merged,
        scrapQty: scrap,
      })
      if (!res.ok) {
        alert(res.error ?? "오류가 발생했습니다.")
        return
      }
      router.refresh()
      onOpenChange(false)
      setMergedQty("")
      setScrapQty("")
    })
  }

  const handleClose = () => {
    onOpenChange(false)
    setMergedQty("")
    setScrapQty("")
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
            이 처리는 완료 재공 수량의 복귀 및 폐기 이력만 기록하며, 공정 완료 수량을 다시 증가시키지 않습니다.
          </div>

          {/* 결과 입력 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[14px]">양품 복귀 수량</Label>
              <Input
                type="number"
                min={0}
                max={reworkItem.reworkQty}
                placeholder="0"
                value={mergedQty}
                onChange={(e) => setMergedQty(e.target.value)}
                className="text-[14px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[14px]">폐기 수량</Label>
              <Input
                type="number"
                min={0}
                max={reworkItem.reworkQty}
                placeholder="0"
                value={scrapQty}
                onChange={(e) => setScrapQty(e.target.value)}
                className="text-[14px]"
              />
            </div>
          </div>

          <div className="rounded-md bg-muted/30 p-3 text-[13px] text-muted-foreground">
            입력 합계:{" "}
            <span className="font-medium text-foreground">
              {formatQuantity((Number(mergedQty) || 0) + (Number(scrapQty) || 0))} / {formatQuantity(reworkItem.reworkQty)}개
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !mergedQty || !scrapQty}>
            {isPending ? "처리 중..." : "완료 처리"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
