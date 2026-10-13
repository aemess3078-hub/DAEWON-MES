"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle } from "lucide-react"
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
import { Badge } from "@/components/ui/badge"
import {
  OperationProgressRow,
  dispositionDefects,
} from "@/lib/actions/process-progress.actions"

interface DefectDispositionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  operation: OperationProgressRow | null
}

export function DefectDispositionDialog({
  open,
  onOpenChange,
  operation,
}: DefectDispositionDialogProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [reworkQtyMap, setReworkQtyMap] = useState<Record<string, string>>({})

  if (!operation) return null

  const defectResults = operation.productionResults.filter(
    (r) => r.defectQty > 0
  )

  const handleSubmit = () => {
    startTransition(async () => {
      let hasError = false
      for (const result of defectResults) {
        const rawVal = reworkQtyMap[result.id]
        const reworkQty = rawVal === undefined ? result.reworkQty : Number(rawVal)
        if (isNaN(reworkQty) || reworkQty < 0 || reworkQty > result.defectQty) {
          alert(`재작업 수량은 0 ~ ${result.defectQty} 범위여야 합니다.`)
          hasError = true
          break
        }
        const res = await dispositionDefects(result.id, reworkQty)
        if (!res.ok) {
          alert(res.error ?? "오류가 발생했습니다.")
          hasError = true
          break
        }
      }
      if (!hasError) {
        router.refresh()
        onOpenChange(false)
        setReworkQtyMap({})
      }
    })
  }

  const handleClose = () => {
    onOpenChange(false)
    setReworkQtyMap({})
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[18px]">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            공정부적합 처리
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 공정 정보 */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-1">
            <div className="text-[13px] text-muted-foreground">공정</div>
            <div className="text-[15px] font-medium">
              {operation.workOrder.orderNo} — {operation.seq}. {operation.routingOperation.name}
            </div>
            <div className="text-[14px] text-muted-foreground">
              {operation.workOrder.item.name}
            </div>
          </div>

          {/* 불량 실적별 처리 */}
          <div className="space-y-3">
            <div className="text-[14px] font-medium text-foreground">
              불량 수량 처리
            </div>
            {defectResults.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">
                처리할 불량 실적이 없습니다.
              </p>
            ) : (
              defectResults.map((result, i) => {
                const rawVal = reworkQtyMap[result.id]
                const reworkQty = rawVal === undefined ? result.reworkQty : Number(rawVal)
                const scrapQty = result.defectQty - (isNaN(reworkQty) ? 0 : reworkQty)
                return (
                  <div
                    key={result.id}
                    className="rounded-md border p-3 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-muted-foreground">
                        실적 #{i + 1}
                        {result.startedAt && (
                          <span className="ml-2">
                            {result.startedAt.toLocaleString("ko-KR", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[13px] border-red-200 text-red-700"
                      >
                        불량 {result.defectQty}개
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-[13px]">재작업 수량</Label>
                        <Input
                          type="number"
                          min={0}
                          max={result.defectQty}
                          value={rawVal ?? String(result.reworkQty)}
                          onChange={(e) =>
                            setReworkQtyMap((prev) => ({
                              ...prev,
                              [result.id]: e.target.value,
                            }))
                          }
                          className="h-8 text-[14px]"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[13px] text-muted-foreground">폐기 수량 (자동)</Label>
                        <div className="h-8 rounded-md border bg-muted/30 flex items-center px-3">
                          <span
                            className={`text-[14px] ${scrapQty > 0 ? "text-red-600 font-medium" : "text-muted-foreground"}`}
                          >
                            {Math.max(0, scrapQty)}개
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || defectResults.length === 0}
          >
            {isPending ? "처리 중..." : "처리 완료"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
