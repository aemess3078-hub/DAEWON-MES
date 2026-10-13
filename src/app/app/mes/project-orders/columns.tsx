"use client"

import { ColumnDef } from "@tanstack/react-table"
import { ProjectOrderStatus, ProjectOrderPriority } from "@prisma/client"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatDDay, kstDaysUntil } from "@/lib/date/kst"

export type ProjectOrderRow = {
  id: string
  code: string
  name: string
  siteId: string
  site: { id: string; code: string; name: string }
  priority: ProjectOrderPriority
  status: ProjectOrderStatus
  plannedStartDate: Date | string | null
  dueDate: Date | string | null
  description: string | null
  createdAt: Date | string
  updatedAt: Date | string
  customer: { id: string; code: string; name: string }
  item: { id: string; code: string; name: string } | null
  salesOrder: { id: string; orderNo: string } | null
  owner: { id: string; name: string }
}

export const STATUS_CONFIG: Record<
  ProjectOrderStatus,
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
  ProjectOrderPriority,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  LOW:    { label: "낮음", variant: "outline" },
  MEDIUM: { label: "보통", variant: "secondary" },
  HIGH:   { label: "높음", variant: "destructive" },
}

export function getColumns(
  onEdit: (row: ProjectOrderRow) => void,
  onDelete: (row: ProjectOrderRow) => void,
  onViewDetail?: (row: ProjectOrderRow) => void
): ColumnDef<ProjectOrderRow>[] {
  return [
    {
      accessorKey: "code",
      header: "오더번호",
      cell: ({ row }) => (
        <button
          onClick={() => onViewDetail?.(row.original)}
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
      id: "item",
      header: "품목/모델",
      accessorFn: (row) => row.item?.name ?? "",
      cell: ({ row }) =>
        row.original.item ? (
          <span className="text-[13px] text-muted-foreground">{row.original.item.name}</span>
        ) : (
          <span className="text-[13px] text-muted-foreground">—</span>
        ),
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
        return (
          <Badge variant={cfg.variant} className="text-[12px]">
            {cfg.label}
          </Badge>
        )
      },
    },
    {
      accessorKey: "status",
      header: "상태",
      cell: ({ row }) => {
        const cfg = STATUS_CONFIG[row.original.status]
        return (
          <Badge variant={cfg.variant} className="text-[12px]">
            {cfg.label}
          </Badge>
        )
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
        const diff = kstDaysUntil(new Date(due))
        const label = formatDDay(new Date(due))
        const isDone = ["COMPLETED", "CANCELLED"].includes(row.original.status)
        const colorClass = isDone
          ? "text-muted-foreground"
          : diff < 0
          ? "text-red-600"
          : diff <= 3
          ? "text-amber-600"
          : "text-muted-foreground"
        return <span className={`text-[13px] font-medium tabular-nums ${colorClass}`}>{label}</span>
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(row.original)}>
              <Pencil className="mr-2 h-4 w-4" /> 수정
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(row.original)}
              disabled={row.original.status !== "DRAFT"}
            >
              <Trash2 className="mr-2 h-4 w-4" /> 삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]
}
