"use client"

import { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ExternalLink } from "lucide-react"
import { formatDDay } from "@/lib/date/kst"
import {
  computeStageSummary,
  resolveCurrentStageLabel,
  resolveProjectDelayStatus,
  type StageForProgress,
  type ProjectDelayStatus,
} from "@/lib/project-stage-progress"

export type ProjectProgressRow = {
  id: string
  code: string
  name: string
  priority: "LOW" | "MEDIUM" | "HIGH"
  status: "DRAFT" | "CONFIRMED" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "CANCELLED"
  plannedStartDate: Date | string | null
  dueDate: Date | string | null
  customer: { id: string; name: string }
  owner: { id: string; name: string }
  stages: (StageForProgress & { dueDate: Date | string | null })[]
  // §21: 진행현황 목록에는 이슈 컬럼을 최소한(미해결 건수)만 추가한다 — 진행률
  // 계산에는 포함하지 않는다(여전히 ProjectStage 완료 개수 기준).
  openIssueCount: number
}

export const PROJECT_STATUS_CONFIG: Record<
  ProjectProgressRow["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  DRAFT:       { label: "초안",     variant: "secondary" },
  CONFIRMED:   { label: "수주확정", variant: "default" },
  IN_PROGRESS: { label: "진행중",   variant: "default" },
  ON_HOLD:     { label: "보류",     variant: "outline" },
  COMPLETED:   { label: "완료",     variant: "secondary" },
  CANCELLED:   { label: "취소",     variant: "destructive" },
}

export const PRIORITY_CONFIG: Record<
  ProjectProgressRow["priority"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  LOW:    { label: "낮음", variant: "outline" },
  MEDIUM: { label: "보통", variant: "secondary" },
  HIGH:   { label: "높음", variant: "destructive" },
}

export const DELAY_CONFIG: Record<
  ProjectDelayStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  NORMAL:   { label: "정상",     variant: "secondary" },
  DUE_SOON: { label: "마감임박", variant: "outline" },
  DELAYED:  { label: "지연",     variant: "destructive" },
}

export function getColumns(onViewDetail: (row: ProjectProgressRow) => void): ColumnDef<ProjectProgressRow>[] {
  return [
    {
      accessorKey: "code",
      header: "오더번호",
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
      accessorKey: "name",
      header: "프로젝트명",
      cell: ({ row }) => <span className="text-[14px] font-medium">{row.original.name}</span>,
    },
    {
      id: "customer",
      header: "거래처",
      accessorFn: (row) => row.customer.name,
      cell: ({ row }) => <span className="text-[14px]">{row.original.customer.name}</span>,
    },
    {
      id: "owner",
      header: "담당자",
      accessorFn: (row) => row.owner.name,
      cell: ({ row }) => <span className="text-[14px]">{row.original.owner.name}</span>,
    },
    {
      accessorKey: "priority",
      header: "우선순위",
      cell: ({ row }) => {
        const cfg = PRIORITY_CONFIG[row.original.priority]
        return <Badge variant={cfg.variant} className="text-[12px]">{cfg.label}</Badge>
      },
    },
    {
      accessorKey: "status",
      header: "프로젝트 상태",
      cell: ({ row }) => {
        const cfg = PROJECT_STATUS_CONFIG[row.original.status]
        return <Badge variant={cfg.variant} className="text-[12px]">{cfg.label}</Badge>
      },
    },
    {
      accessorKey: "plannedStartDate",
      header: "시작예정",
      cell: ({ row }) =>
        row.original.plannedStartDate ? (
          <span className="text-[13px] text-muted-foreground">
            {format(new Date(row.original.plannedStartDate), "yyyy-MM-dd")}
          </span>
        ) : (
          <span className="text-[13px] text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: "dueDate",
      header: "납기예정",
      cell: ({ row }) =>
        row.original.dueDate ? (
          <span className="text-[13px] text-muted-foreground">
            {format(new Date(row.original.dueDate), "yyyy-MM-dd")}
          </span>
        ) : (
          <span className="text-[13px] text-muted-foreground">—</span>
        ),
    },
    {
      id: "dday",
      header: "D-Day",
      cell: ({ row }) => {
        const due = row.original.dueDate
        if (!due) return <span className="text-[13px] text-muted-foreground">—</span>
        const isDone = ["COMPLETED", "CANCELLED"].includes(row.original.status)
        const label = formatDDay(new Date(due))
        const delay = resolveProjectDelayStatus(due, row.original.status)
        const colorClass = isDone
          ? "text-muted-foreground"
          : delay === "DELAYED"
          ? "text-red-600"
          : delay === "DUE_SOON"
          ? "text-amber-600"
          : "text-muted-foreground"
        return <span className={`text-[13px] font-medium tabular-nums ${colorClass}`}>{label}</span>
      },
    },
    {
      id: "currentStage",
      header: "현재 단계",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {resolveCurrentStageLabel(row.original.stages)}
        </span>
      ),
    },
    {
      id: "progress",
      header: "단계 완료율",
      cell: ({ row }) => {
        const { completedCount, totalCount, percent } = computeStageSummary(row.original.stages)
        return (
          <div className="flex items-center gap-2 min-w-[96px]">
            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
            <span className="text-[12px] text-muted-foreground tabular-nums whitespace-nowrap">
              {completedCount}/{totalCount} · {percent}%
            </span>
          </div>
        )
      },
    },
    {
      id: "delayStatus",
      header: "지연상태",
      accessorFn: (row) => resolveProjectDelayStatus(row.dueDate, row.status),
      cell: ({ row }) => {
        const delay = resolveProjectDelayStatus(row.original.dueDate, row.original.status)
        const cfg = DELAY_CONFIG[delay]
        return <Badge variant={cfg.variant} className="text-[12px]">{cfg.label}</Badge>
      },
    },
    {
      accessorKey: "openIssueCount",
      header: "이슈",
      cell: ({ row }) => {
        const count = row.original.openIssueCount
        return count > 0 ? (
          <Badge variant="destructive" className="text-[12px]">미해결 {count}</Badge>
        ) : (
          <span className="text-[13px] text-muted-foreground">—</span>
        )
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
