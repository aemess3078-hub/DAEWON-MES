"use client"

import { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ExternalLink } from "lucide-react"
import { formatDDay } from "@/lib/date/kst"
import { resolveProjectIssueDelayStatus, type ProjectIssueDelayStatus } from "@/lib/project-issue-calculations"
import type { ProjectIssueRow } from "@/lib/actions/project-issue.actions"

export type { ProjectIssueRow }

export const ISSUE_TYPE_CONFIG: Record<
  ProjectIssueRow["type"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  ISSUE: { label: "이슈", variant: "secondary" },
  RISK:  { label: "리스크", variant: "outline" },
}

export const ISSUE_SEVERITY_CONFIG: Record<
  ProjectIssueRow["severity"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  LOW:      { label: "낮음", variant: "outline" },
  MEDIUM:   { label: "보통", variant: "secondary" },
  HIGH:     { label: "높음", variant: "default" },
  CRITICAL: { label: "긴급", variant: "destructive" },
}

export const ISSUE_STATUS_CONFIG: Record<
  ProjectIssueRow["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  OPEN:        { label: "미조치", variant: "outline" },
  IN_PROGRESS: { label: "조치중", variant: "default" },
  RESOLVED:    { label: "해결완료", variant: "secondary" },
}

export const ISSUE_DELAY_CONFIG: Record<
  ProjectIssueDelayStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  NO_DUE_DATE: { label: "일정없음", variant: "outline" },
  RESOLVED:    { label: "완료",     variant: "secondary" },
  NORMAL:      { label: "정상",     variant: "secondary" },
  DUE_SOON:    { label: "마감임박", variant: "outline" },
  DELAYED:     { label: "지연",     variant: "destructive" },
}

export function getColumns(onViewDetail: (row: ProjectIssueRow) => void): ColumnDef<ProjectIssueRow>[] {
  return [
    {
      accessorKey: "code",
      header: "이슈번호",
      cell: ({ row }) => (
        <button
          onClick={() => onViewDetail(row.original)}
          className="font-mono text-[13px] font-medium text-primary hover:underline"
        >
          {row.original.code}
        </button>
      ),
    },
    {
      id: "projectOrderCode",
      header: "오더번호",
      accessorFn: (row) => row.projectOrder.code,
      cell: ({ row }) => <span className="font-mono text-[13px] text-muted-foreground">{row.original.projectOrder.code}</span>,
    },
    {
      id: "projectName",
      header: "프로젝트명",
      accessorFn: (row) => row.projectOrder.name,
      cell: ({ row }) => <span className="text-[14px]">{row.original.projectOrder.name}</span>,
    },
    {
      id: "customerName",
      header: "거래처",
      accessorFn: (row) => row.customer.name,
      cell: ({ row }) => <span className="text-[13px] text-muted-foreground">{row.original.customer.name}</span>,
    },
    {
      accessorKey: "title",
      header: "제목",
      cell: ({ row }) => <span className="text-[14px] font-medium">{row.original.title}</span>,
    },
    {
      accessorKey: "type",
      header: "유형",
      cell: ({ row }) => {
        const cfg = ISSUE_TYPE_CONFIG[row.original.type]
        return <Badge variant={cfg.variant} className="text-[12px]">{cfg.label}</Badge>
      },
    },
    {
      accessorKey: "severity",
      header: "중요도",
      cell: ({ row }) => {
        const cfg = ISSUE_SEVERITY_CONFIG[row.original.severity]
        return <Badge variant={cfg.variant} className="text-[12px]">{cfg.label}</Badge>
      },
    },
    {
      accessorKey: "status",
      header: "상태",
      cell: ({ row }) => {
        const cfg = ISSUE_STATUS_CONFIG[row.original.status]
        return <Badge variant={cfg.variant} className="text-[12px]">{cfg.label}</Badge>
      },
    },
    {
      id: "assignee",
      header: "담당자",
      accessorFn: (row) => row.assignee?.name ?? "미지정",
      cell: ({ row }) => (
        <span className="text-[14px]">{row.original.assignee?.name ?? <span className="text-muted-foreground">미지정</span>}</span>
      ),
    },
    {
      accessorKey: "occurredAt",
      header: "발생일",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">{format(new Date(row.original.occurredAt), "yyyy-MM-dd")}</span>
      ),
    },
    {
      accessorKey: "dueDate",
      header: "목표일",
      cell: ({ row }) =>
        row.original.dueDate ? (
          <span className="text-[13px] text-muted-foreground">{format(new Date(row.original.dueDate), "yyyy-MM-dd")}</span>
        ) : (
          <span className="text-[13px] text-muted-foreground">—</span>
        ),
    },
    {
      id: "dday",
      header: "D-Day",
      cell: ({ row }) => {
        const { dueDate, status } = row.original
        if (!dueDate) return <span className="text-[13px] text-muted-foreground">—</span>
        if (status === "RESOLVED") return <span className="text-[13px] text-muted-foreground">완료</span>
        const label = formatDDay(new Date(dueDate))
        const delay = resolveProjectIssueDelayStatus(dueDate, status)
        const colorClass =
          delay === "DELAYED" ? "text-red-600" : delay === "DUE_SOON" ? "text-amber-600" : "text-muted-foreground"
        return <span className={`text-[13px] font-medium tabular-nums ${colorClass}`}>{label}</span>
      },
    },
    {
      id: "delayStatus",
      header: "지연여부",
      accessorFn: (row) => resolveProjectIssueDelayStatus(row.dueDate, row.status),
      cell: ({ row }) => {
        const delay = resolveProjectIssueDelayStatus(row.original.dueDate, row.original.status)
        const cfg = ISSUE_DELAY_CONFIG[delay]
        return <Badge variant={cfg.variant} className="text-[12px]">{cfg.label}</Badge>
      },
    },
    {
      id: "actions",
      header: "관리",
      cell: ({ row }) => (
        <Button size="sm" variant="outline" className="h-7 text-[13px] px-2 gap-1" onClick={() => onViewDetail(row.original)}>
          <ExternalLink className="h-3 w-3" />
          상세
        </Button>
      ),
      enableSorting: false,
    },
  ]
}
