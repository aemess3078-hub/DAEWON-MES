"use client"

import { useMemo, useState } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { HoldableWipRow, createHold } from "@/lib/actions/wip-hold.actions"

const WIP_STATUS_LABEL: Record<string, string> = {
  WAITING: "대기",
  IN_PROCESS: "진행중",
}

interface HoldRegisterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  holdableWipUnits: HoldableWipRow[]
  onSuccess: () => void
}

export function HoldRegisterDialog({ open, onOpenChange, holdableWipUnits, onSuccess }: HoldRegisterDialogProps) {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [wipUnitId, setWipUnitId] = useState("")
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")

  const selected = useMemo(
    () => holdableWipUnits.find((u) => u.id === wipUnitId) ?? null,
    [holdableWipUnits, wipUnitId]
  )

  const handleClose = () => {
    onOpenChange(false)
    setWipUnitId("")
    setReason("")
    setNote("")
  }

  const handleSubmit = async () => {
    if (!wipUnitId) {
      alert("보류할 재공품을 선택하세요.")
      return
    }
    if (!reason.trim()) {
      alert("보류 사유를 입력하세요.")
      return
    }

    setIsPending(true)
    try {
      const res = await createHold({ wipUnitId, reason: reason.trim(), note: note.trim() || null })
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
          <DialogTitle className="text-[18px]">보류 등록</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-[14px]">대상 재공품</Label>
            <Select value={wipUnitId} onValueChange={setWipUnitId}>
              <SelectTrigger className="text-[14px]">
                <SelectValue placeholder="보류할 재공품을 선택하세요" />
              </SelectTrigger>
              <SelectContent>
                {holdableWipUnits.length === 0 ? (
                  <div className="px-3 py-2 text-[13px] text-muted-foreground">
                    보류 가능한 재공품이 없습니다.
                  </div>
                ) : (
                  holdableWipUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-[14px]">
                      {u.workOrder.orderNo} · {u.workOrder.item.name} · {u.routingOperation.seq}.
                      {u.routingOperation.name} ({u.qty}개, {WIP_STATUS_LABEL[u.status] ?? u.status})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {selected && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-[13px]">
              <div>
                <span className="text-muted-foreground">품목 </span>
                {selected.workOrder.item.code} · {selected.workOrder.item.name}
              </div>
              <div>
                <span className="text-muted-foreground">제조번호 </span>
                {selected.manufacturingNo ?? "-"}
              </div>
              <div>
                <span className="text-muted-foreground">공정 </span>
                {selected.routingOperation.seq}. {selected.routingOperation.name}
                {selected.routingOperation.workCenter ? ` (${selected.routingOperation.workCenter.name})` : ""}
              </div>
              <div>
                <span className="text-muted-foreground">수량 </span>
                {selected.qty}개
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[14px]">보류 사유</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 설비 점검으로 인한 일시 정지, 고객 사양 확인 대기 등"
              className="text-[14px]"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[14px]">상세 메모 (선택)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="추가로 남길 내용이 있으면 입력하세요"
              className="text-[14px]"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !wipUnitId || !reason.trim()}>
            {isPending ? "등록 중..." : "보류 등록"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
