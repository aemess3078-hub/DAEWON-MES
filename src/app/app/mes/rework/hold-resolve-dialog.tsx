"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { WipHoldRow, releaseHold, cancelHold } from "@/lib/actions/wip-hold.actions"

function formatDateTime(d: Date | null): string {
  if (!d) return "-"
  return new Date(d).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

interface HoldResolveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hold: WipHoldRow | null
  mode: "release" | "cancel"
  onSuccess: () => void
}

export function HoldResolveDialog({ open, onOpenChange, hold, mode, onSuccess }: HoldResolveDialogProps) {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [note, setNote] = useState("")

  if (!hold) return null

  const isRelease = mode === "release"

  const handleClose = () => {
    onOpenChange(false)
    setNote("")
  }

  const handleSubmit = async () => {
    setIsPending(true)
    try {
      const res = isRelease
        ? await releaseHold({ holdId: hold.id, releaseNote: note.trim() || null })
        : await cancelHold({ holdId: hold.id, cancelNote: note.trim() || null })
      if (!res.ok) {
        alert(res.error ?? "오류가 발생했습니다.")
        return
      }
      onSuccess()
      router.refresh()
      handleClose()
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{isRelease ? "보류 해제" : "보류 등록 취소"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-[13px]">
            <div>
              <span className="text-muted-foreground">작업지시번호 </span>
              {hold.wipUnit.workOrder?.orderNo ?? "-"}
            </div>
            <div>
              <span className="text-muted-foreground">품목 </span>
              {hold.wipUnit.workOrder?.item.code} · {hold.wipUnit.workOrder?.item.name}
            </div>
            <div>
              <span className="text-muted-foreground">제조번호 </span>
              {hold.wipUnit.manufacturingNo ?? "-"}
            </div>
            <div>
              <span className="text-muted-foreground">공정 </span>
              {hold.wipUnit.routingOperation.seq}. {hold.wipUnit.routingOperation.name}
            </div>
            <div>
              <span className="text-muted-foreground">보류 사유 </span>
              {hold.reason}
            </div>
            <div>
              <span className="text-muted-foreground">보류일시 </span>
              {formatDateTime(hold.heldAt)} {hold.heldByName ? `· ${hold.heldByName}` : ""}
            </div>
          </div>

          {!isRelease && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
              보류 등록 자체를 취소합니다. 재공품은 보류 이전 상태로 복원되며, 이 이력은 &ldquo;취소&rdquo;로 보존됩니다.
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[14px]">{isRelease ? "해제 메모 (선택)" : "취소 메모 (선택)"}</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isRelease ? "해제 사유나 조치 내용을 입력하세요" : "취소 사유를 입력하세요"}
              className="text-[14px]"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            닫기
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending}
            variant={isRelease ? "default" : "destructive"}
          >
            {isPending ? "처리 중..." : isRelease ? "해제" : "등록 취소"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
