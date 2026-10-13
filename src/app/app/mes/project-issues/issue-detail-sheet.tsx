"use client"

import { useCallback, useEffect, useState } from "react"
import { format } from "date-fns"
import { Pencil, Trash2, PlayCircle, CheckCircle2 } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDDay } from "@/lib/date/kst"
import { resolveProjectIssueDelayStatus } from "@/lib/project-issue-calculations"
import {
  getProjectIssueDetail,
  startProjectIssue,
  deleteProjectIssue,
  type ProjectIssueDetail,
} from "@/lib/actions/project-issue.actions"
import {
  ISSUE_TYPE_CONFIG,
  ISSUE_SEVERITY_CONFIG,
  ISSUE_STATUS_CONFIG,
  ISSUE_DELAY_CONFIG,
} from "./columns"
import { IssueFormDialog } from "./issue-form-dialog"
import { ResolveIssueDialog } from "./resolve-issue-dialog"

interface ProjectIssueDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  issueId: string | null
  /** 목록/집계가 갱신되어야 할 때(등록·수정·삭제·상태변경 성공) 호출된다. */
  onChanged?: () => void
}

const BLOCKED_ORDER_STATUSES = ["COMPLETED", "CANCELLED"]

function fmtDate(d: Date | string | null): string {
  return d ? format(new Date(d), "yyyy-MM-dd") : "—"
}

export function ProjectIssueDetailSheet({ open, onOpenChange, issueId, onChanged }: ProjectIssueDetailSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [issue, setIssue] = useState<ProjectIssueDetail | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [resolveOpen, setResolveOpen] = useState(false)

  const refetch = useCallback(() => {
    if (!issueId) return
    setIsLoading(true)
    getProjectIssueDetail(issueId)
      .then(setIssue)
      .catch((e) => alert(e instanceof Error ? e.message : "정보를 불러오지 못했습니다."))
      .finally(() => setIsLoading(false))
  }, [issueId])

  useEffect(() => {
    if (open && issueId) {
      refetch()
    } else if (!open) {
      setIssue(null)
    }
  }, [open, issueId, refetch])

  const handleStart = async () => {
    if (!issue) return
    setIsPending(true)
    try {
      const result = await startProjectIssue(issue.id)
      if (!result.ok) {
        alert(result.error ?? "조치 시작 중 오류가 발생했습니다.")
        return
      }
      refetch()
      onChanged?.()
    } finally {
      setIsPending(false)
    }
  }

  const handleDelete = async () => {
    if (!issue) return
    if (!confirm(`'${issue.title}' 이슈를 삭제하시겠습니까?`)) return
    setIsPending(true)
    try {
      const result = await deleteProjectIssue(issue.id)
      if (!result.ok) {
        alert(result.error ?? "삭제 중 오류가 발생했습니다.")
        return
      }
      onChanged?.()
      onOpenChange(false)
    } finally {
      setIsPending(false)
    }
  }

  if (!issueId) return null

  const isProjectOrderEditable = issue ? !BLOCKED_ORDER_STATUSES.includes(issue.projectOrder.status) : false
  const delay = issue ? resolveProjectIssueDelayStatus(issue.dueDate, issue.status) : "NO_DUE_DATE"
  const delayCfg = ISSUE_DELAY_CONFIG[delay]

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          {isLoading && !issue ? (
            <p className="text-[14px] text-muted-foreground py-8 text-center">불러오는 중...</p>
          ) : issue ? (
            <>
              <SheetHeader className="pb-6 border-b">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <SheetTitle className="text-[20px] font-semibold font-mono">{issue.code}</SheetTitle>
                    <p className="text-[15px] text-muted-foreground font-medium">{issue.title}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 mt-1">
                    <div className="flex gap-1.5">
                      <Badge variant={ISSUE_TYPE_CONFIG[issue.type].variant} className="text-[12px]">
                        {ISSUE_TYPE_CONFIG[issue.type].label}
                      </Badge>
                      <Badge variant={ISSUE_SEVERITY_CONFIG[issue.severity].variant} className="text-[12px]">
                        {ISSUE_SEVERITY_CONFIG[issue.severity].label}
                      </Badge>
                      <Badge variant={ISSUE_STATUS_CONFIG[issue.status].variant} className="text-[12px]">
                        {ISSUE_STATUS_CONFIG[issue.status].label}
                      </Badge>
                    </div>
                    <Badge variant={delayCfg.variant} className="text-[12px]">{delayCfg.label}</Badge>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-3">
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">프로젝트</p>
                    <p className="text-[14px] font-medium font-mono">{issue.projectOrder.code}</p>
                    <p className="text-[13px] text-muted-foreground">{issue.projectOrder.name}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">거래처</p>
                    <p className="text-[14px] font-medium">{issue.customer.name}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">담당자</p>
                    <p className="text-[14px] font-medium">{issue.assignee?.name ?? "미지정"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">등록자</p>
                    <p className="text-[14px] font-medium">{issue.createdBy.name}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">발생일</p>
                    <p className="text-[14px] font-medium">{fmtDate(issue.occurredAt)}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">목표일</p>
                    <p className="text-[14px] font-medium">
                      {fmtDate(issue.dueDate)}
                      {issue.dueDate && issue.status !== "RESOLVED" && (
                        <span className="text-muted-foreground font-normal"> ({formatDDay(new Date(issue.dueDate))})</span>
                      )}
                    </p>
                  </div>
                </div>
              </SheetHeader>

              <div className="pt-6 space-y-5">
                <div className="space-y-1.5">
                  <p className="text-[13px] font-semibold text-muted-foreground">이슈 내용</p>
                  {issue.description ? (
                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap rounded-lg bg-muted/30 px-3 py-2.5">
                      {issue.description}
                    </p>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">등록된 내용이 없습니다.</p>
                  )}
                </div>

                {issue.status === "RESOLVED" && (
                  <div className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-[13px] font-semibold text-emerald-800">조치내용</p>
                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-emerald-900">
                      {issue.resolution}
                    </p>
                    <p className="text-[12px] text-emerald-700">해결일: {fmtDate(issue.resolvedAt)}</p>
                  </div>
                )}

                {!isProjectOrderEditable && issue.status !== "RESOLVED" && (
                  <p className="text-[13px] text-muted-foreground">
                    완료되었거나 취소된 프로젝트의 이슈는 조치·수정·삭제할 수 없습니다.
                  </p>
                )}

                <div className="flex items-center gap-2 pt-2 border-t">
                  {issue.status === "OPEN" && (
                    <>
                      <Button size="sm" disabled={isPending || !isProjectOrderEditable} onClick={handleStart} className="gap-1.5">
                        <PlayCircle className="h-3.5 w-3.5" />
                        조치 시작
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending || !isProjectOrderEditable}
                        onClick={() => setEditOpen(true)}
                        className="gap-1.5"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        수정
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-destructive hover:text-destructive"
                        disabled={isPending || !isProjectOrderEditable}
                        onClick={handleDelete}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        삭제
                      </Button>
                    </>
                  )}
                  {issue.status === "IN_PROGRESS" && (
                    <>
                      <Button
                        size="sm"
                        disabled={isPending || !isProjectOrderEditable}
                        onClick={() => setResolveOpen(true)}
                        className="gap-1.5"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        해결 완료
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending || !isProjectOrderEditable}
                        onClick={() => setEditOpen(true)}
                        className="gap-1.5"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        수정
                      </Button>
                    </>
                  )}
                  {issue.status === "RESOLVED" && (
                    <p className="text-[13px] text-muted-foreground">해결완료된 이슈는 읽기 전용입니다.</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="text-[14px] text-muted-foreground py-8 text-center">프로젝트 이슈를 찾을 수 없습니다.</p>
          )}
        </SheetContent>
      </Sheet>

      <IssueFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        issue={issue}
        onSuccess={() => {
          setEditOpen(false)
          refetch()
          onChanged?.()
        }}
      />

      <ResolveIssueDialog
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        issueId={issue?.id ?? null}
        onSuccess={() => {
          setResolveOpen(false)
          refetch()
          onChanged?.()
        }}
      />
    </>
  )
}
