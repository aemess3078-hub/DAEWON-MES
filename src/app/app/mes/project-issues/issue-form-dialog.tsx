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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  createProjectIssue,
  updateProjectIssue,
  getProjectIssueProjectOptions,
  getProjectIssueAssignableUsers,
  type ProjectIssueDetail,
} from "@/lib/actions/project-issue.actions"
import type { ProjectIssueType, ProjectIssueSeverity } from "@prisma/client"
import { ISSUE_TYPE_CONFIG, ISSUE_SEVERITY_CONFIG } from "./columns"

interface IssueFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  issue?: ProjectIssueDetail | null
  /** 프로젝트 진행현황 상세에서 열 때: 프로젝트를 고정하고 선택 UI를 숨긴다. */
  fixedProjectOrderId?: string
  fixedProjectLabel?: string
  onSuccess: () => void
}

type ProjectOption = { id: string; code: string; name: string; customerName: string }
type UserOption = { id: string; name: string }

function toDateInputValue(d: Date | string | null): string {
  if (!d) return ""
  return new Date(d).toISOString().split("T")[0]
}

function todayInputValue(): string {
  return new Date().toISOString().split("T")[0]
}

export function IssueFormDialog({
  open,
  onOpenChange,
  mode,
  issue,
  fixedProjectOrderId,
  fixedProjectLabel,
  onSuccess,
}: IssueFormDialogProps) {
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([])
  const [userOptions, setUserOptions] = useState<UserOption[]>([])

  const [projectOrderId, setProjectOrderId] = useState("")
  const [title, setTitle] = useState("")
  const [type, setType] = useState<ProjectIssueType>("ISSUE")
  const [severity, setSeverity] = useState<ProjectIssueSeverity>("MEDIUM")
  const [assigneeId, setAssigneeId] = useState<string>("")
  const [occurredAt, setOccurredAt] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [description, setDescription] = useState("")

  // §11: 조치중 이슈는 제목/유형/발생일 변경이 서버에서 차단된다 — UI도 동일하게 잠근다.
  const isNameLocked = mode === "edit" && issue?.status === "IN_PROGRESS"

  useEffect(() => {
    if (!open) return
    setIsLoadingOptions(true)
    Promise.all([
      fixedProjectOrderId ? Promise.resolve([]) : getProjectIssueProjectOptions(),
      getProjectIssueAssignableUsers(),
    ])
      .then(([projects, users]) => {
        setProjectOptions(projects)
        setUserOptions(users)
      })
      .catch((e) => alert(e instanceof Error ? e.message : "옵션을 불러오지 못했습니다."))
      .finally(() => setIsLoadingOptions(false))
  }, [open, fixedProjectOrderId])

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && issue) {
      setProjectOrderId(issue.projectOrder.id)
      setTitle(issue.title)
      setType(issue.type)
      setSeverity(issue.severity)
      setAssigneeId(issue.assignee?.id ?? "")
      setOccurredAt(toDateInputValue(issue.occurredAt))
      setDueDate(toDateInputValue(issue.dueDate))
      setDescription(issue.description ?? "")
    } else {
      setProjectOrderId(fixedProjectOrderId ?? "")
      setTitle("")
      setType("ISSUE")
      setSeverity("MEDIUM")
      setAssigneeId("")
      setOccurredAt(todayInputValue())
      setDueDate("")
      setDescription("")
    }
  }, [open, mode, issue, fixedProjectOrderId])

  const handleClose = () => onOpenChange(false)

  const handleSubmit = async () => {
    if (mode === "create" && !projectOrderId) {
      alert("프로젝트를 선택하세요.")
      return
    }
    if (!isNameLocked && !title.trim()) {
      alert("제목을 입력하세요.")
      return
    }
    if (mode === "create" && !occurredAt) {
      alert("발생일을 입력하세요.")
      return
    }
    if (occurredAt && dueDate && dueDate < occurredAt) {
      alert("목표일은 발생일보다 빠를 수 없습니다.")
      return
    }

    setIsPending(true)
    try {
      const result =
        mode === "create"
          ? await createProjectIssue({
              projectOrderId,
              title: title.trim(),
              type,
              severity,
              occurredAt: new Date(occurredAt),
              assigneeId: assigneeId || null,
              dueDate: dueDate ? new Date(dueDate) : null,
              description: description.trim() || null,
            })
          : await updateProjectIssue({
              id: issue!.id,
              ...(!isNameLocked && { title: title.trim(), type, occurredAt: new Date(occurredAt) }),
              severity,
              assigneeId: assigneeId || null,
              dueDate: dueDate ? new Date(dueDate) : null,
              description: description.trim() || null,
            })

      if (!result.ok) {
        alert(result.error ?? "저장 중 오류가 발생했습니다.")
        return
      }
      onSuccess()
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{mode === "create" ? "이슈 등록" : "이슈 수정"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-[14px]">프로젝트 {mode === "create" && <span className="text-red-500">*</span>}</Label>
            {fixedProjectOrderId ? (
              <p className="text-[14px] font-medium rounded-md border px-3 py-2 bg-muted/30">
                {fixedProjectLabel ?? fixedProjectOrderId}
              </p>
            ) : mode === "edit" ? (
              <p className="text-[14px] font-medium rounded-md border px-3 py-2 bg-muted/30">
                {issue?.projectOrder.code} · {issue?.projectOrder.name}
              </p>
            ) : (
              <Select value={projectOrderId} onValueChange={setProjectOrderId} disabled={isLoadingOptions}>
                <SelectTrigger className="text-[14px]">
                  <SelectValue placeholder={isLoadingOptions ? "불러오는 중..." : "프로젝트를 선택하세요"} />
                </SelectTrigger>
                <SelectContent>
                  {projectOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-[14px]">
                      [{p.code}] {p.name} ({p.customerName})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[14px]">제목 <span className="text-red-500">*</span></Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 원자재 입고 지연"
              disabled={isNameLocked}
              className="text-[14px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[14px]">유형</Label>
              <Select value={type} onValueChange={(v) => setType(v as ProjectIssueType)} disabled={isNameLocked}>
                <SelectTrigger className="text-[14px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ISSUE_TYPE_CONFIG) as ProjectIssueType[]).map((k) => (
                    <SelectItem key={k} value={k} className="text-[14px]">{ISSUE_TYPE_CONFIG[k].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[14px]">중요도</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as ProjectIssueSeverity)}>
                <SelectTrigger className="text-[14px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ISSUE_SEVERITY_CONFIG) as ProjectIssueSeverity[]).map((k) => (
                    <SelectItem key={k} value={k} className="text-[14px]">{ISSUE_SEVERITY_CONFIG[k].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[14px]">담당자 (선택)</Label>
            <Select value={assigneeId || "__NONE__"} onValueChange={(v) => setAssigneeId(v === "__NONE__" ? "" : v)}>
              <SelectTrigger className="text-[14px]">
                <SelectValue placeholder="담당자를 선택하세요" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__NONE__" className="text-[14px]">미지정</SelectItem>
                {userOptions.map((u) => (
                  <SelectItem key={u.id} value={u.id} className="text-[14px]">{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[14px]">발생일 {mode === "create" && <span className="text-red-500">*</span>}</Label>
              <Input
                type="date"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                disabled={isNameLocked}
                className="text-[14px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[14px]">목표일 (선택)</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="text-[14px]" />
            </div>
          </div>

          {isNameLocked && (
            <p className="text-[12px] text-muted-foreground">
              조치중인 이슈는 제목/유형/발생일을 수정할 수 없습니다. 중요도/담당자/목표일/내용만 수정 가능합니다.
            </p>
          )}

          <div className="space-y-1.5">
            <Label className="text-[14px]">내용 (선택)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="이슈 상세 내용을 입력하세요"
              className="text-[14px]"
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "저장 중..." : mode === "create" ? "등록" : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
