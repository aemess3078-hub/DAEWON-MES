"use client"

import { useEffect, useState } from "react"
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
import { WipHoldRow, updateHold } from "@/lib/actions/wip-hold.actions"

interface HoldEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hold: WipHoldRow | null
  onSuccess: () => void
}

export function HoldEditDialog({ open, onOpenChange, hold, onSuccess }: HoldEditDialogProps) {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")

  useEffect(() => {
    if (hold) {
      setReason(hold.reason)
      setNote(hold.note ?? "")
    }
  }, [hold])

  if (!hold) return null

  const handleClose = () => {
    onOpenChange(false)
  }

  const handleSubmit = async () => {
    if (!reason.trim()) {
      alert("보류 사유를 입력하세요.")
      return
    }
    setIsPending(true)
    try {
      const res = await updateHold({ holdId: hold.id, reason: reason.trim(), note: note.trim() || null })
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
          <DialogTitle className="text-[18px]">보류 내용 수정</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-[13px]">
            <div>
              <span className="text-muted-foreground">작업지시 </span>
              {hold.wipUnit.workOrder?.orderNo ?? "-"}
            </div>
            <div>
              <span className="text-muted-foreground">품목 </span>
              {hold.wipUnit.workOrder?.item.name ?? "-"}
            </div>
            <div>
              <span className="text-muted-foreground">공정 </span>
              {hold.wipUnit.routingOperation.seq}. {hold.wipUnit.routingOperation.name}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[14px]">보류 사유</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="text-[14px]"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[14px]">상세 메모 (선택)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="text-[14px]"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !reason.trim()}>
            {isPending ? "저장 중..." : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
