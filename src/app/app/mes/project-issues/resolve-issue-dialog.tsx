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
import { Textarea } from "@/components/ui/textarea"
import { resolveProjectIssue } from "@/lib/actions/project-issue.actions"

interface ResolveIssueDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  issueId: string | null
  onSuccess: () => void
}

// §8: RESOLVED 전환 시 조치내용(resolution)이 필수다 — 빈 값이면 서버가 차단한다.
export function ResolveIssueDialog({ open, onOpenChange, issueId, onSuccess }: ResolveIssueDialogProps) {
  const [resolution, setResolution] = useState("")
  const [isPending, setIsPending] = useState(false)

  useEffect(() => {
    if (open) setResolution("")
  }, [open])

  const handleClose = () => onOpenChange(false)

  const handleSubmit = async () => {
    if (!issueId) return
    if (!resolution.trim()) {
      alert("조치내용을 입력해 주세요.")
      return
    }
    setIsPending(true)
    try {
      const result = await resolveProjectIssue(issueId, resolution.trim())
      if (!result.ok) {
        alert(result.error ?? "해결 처리 중 오류가 발생했습니다.")
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
          <DialogTitle className="text-[18px]">이슈 해결 완료</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label className="text-[14px]">조치내용 <span className="text-red-500">*</span></Label>
          <Textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="어떻게 조치했는지 입력하세요"
            className="text-[14px]"
            rows={5}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "처리 중..." : "해결 완료"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
