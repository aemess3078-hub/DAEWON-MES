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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createProjectStage, updateProjectStage } from "@/lib/actions/project-stage.actions"
import type { ProjectStageRow } from "@/lib/actions/project-stage.actions"

interface StageFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  projectOrderId: string
  stage?: ProjectStageRow | null
  onSuccess: () => void
}

function toDateInputValue(d: Date | string | null): string {
  if (!d) return ""
  return new Date(d).toISOString().split("T")[0]
}

export function StageFormDialog({
  open,
  onOpenChange,
  mode,
  projectOrderId,
  stage,
  onSuccess,
}: StageFormDialogProps) {
  const [isPending, setIsPending] = useState(false)
  const [name, setName] = useState("")
  const [plannedStartDate, setPlannedStartDate] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [note, setNote] = useState("")

  // 진행중 단계는 일정/비고만 수정 가능(§9) — 단계명은 서버도 차단하므로 UI도 비활성화한다.
  const isNameLocked = mode === "edit" && stage?.status === "IN_PROGRESS"

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && stage) {
      setName(stage.name)
      setPlannedStartDate(toDateInputValue(stage.plannedStartDate))
      setDueDate(toDateInputValue(stage.dueDate))
      setNote(stage.note ?? "")
    } else {
      setName("")
      setPlannedStartDate("")
      setDueDate("")
      setNote("")
    }
  }, [open, mode, stage])

  const handleClose = () => {
    onOpenChange(false)
  }

  const handleSubmit = async () => {
    if (!isNameLocked && !name.trim()) {
      alert("단계명을 입력하세요.")
      return
    }
    if (plannedStartDate && dueDate && plannedStartDate > dueDate) {
      alert("계획 시작일은 계획 완료일보다 늦을 수 없습니다.")
      return
    }

    setIsPending(true)
    try {
      const payload = {
        plannedStartDate: plannedStartDate ? new Date(plannedStartDate) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        note: note.trim() || null,
      }

      const result =
        mode === "create"
          ? await createProjectStage({ projectOrderId, name: name.trim(), ...payload })
          : await updateProjectStage({
              id: stage!.id,
              ...(!isNameLocked && { name: name.trim() }),
              ...payload,
            })

      if (!result.ok) {
        alert(result.error ?? "저장 중 오류가 발생했습니다.")
        return
      }
      onSuccess()
      handleClose()
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{mode === "create" ? "단계 추가" : "단계 수정"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-[14px]">단계명</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 1차가공"
              disabled={isNameLocked}
              className="text-[14px]"
            />
            {isNameLocked && (
              <p className="text-[12px] text-muted-foreground">진행중인 단계는 일정/비고만 수정할 수 있습니다.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[14px]">계획 시작일 (선택)</Label>
              <Input
                type="date"
                value={plannedStartDate}
                onChange={(e) => setPlannedStartDate(e.target.value)}
                className="text-[14px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[14px]">계획 완료일 (선택)</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="text-[14px]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[14px]">비고 (선택)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="참고 사항을 입력하세요"
              className="text-[14px]"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "저장 중..." : mode === "create" ? "추가" : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
