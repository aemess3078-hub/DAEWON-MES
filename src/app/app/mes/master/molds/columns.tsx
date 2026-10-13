"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Pencil, Trash2, MoreHorizontal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DataTableColumnHeader } from "@/components/common/data-table"
import type { MoldRow } from "@/lib/actions/mold.actions"

// ─── Labels ───────────────────────────────────────────────────────────────────

export const MOLD_TYPE_LABELS: Record<string, string> = {
  TOOL: "공구",
  JIG: "지그",
  FIXTURE: "고정구",
}

export const MOLD_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "사용중",
  INACTIVE: "보관중",
  MAINTENANCE: "수리중",
}

const statusStyle: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800 border-emerald-200",
  INACTIVE: "bg-slate-100 text-slate-600 border-slate-200",
  MAINTENANCE: "bg-amber-100 text-amber-800 border-amber-200",
}

// ─── Columns ──────────────────────────────────────────────────────────────────

type ColCallbacks = {
  onEdit: (row: MoldRow) => void
  onDelete: (row: MoldRow) => void
}

export function getMoldColumns({ onEdit, onDelete }: ColCallbacks): ColumnDef<MoldRow>[] {
  return [
    {
      id: "code",
      accessorKey: "code",
      header: ({ column }) => <DataTableColumnHeader column={column} title="코드" />,
      cell: ({ row }) => (
        <span className="font-mono text-[14px] font-medium">{row.original.code}</span>
      ),
    },
    {
      id: "name",
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="명칭" />,
      cell: ({ row }) => <span className="text-[14px]">{row.original.name}</span>,
    },
    {
      id: "equipmentType",
      accessorKey: "equipmentType",
      header: ({ column }) => <DataTableColumnHeader column={column} title="유형" />,
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {MOLD_TYPE_LABELS[row.original.equipmentType] ?? row.original.equipmentType}
        </span>
      ),
      filterFn: (row, _id, filterValues: string[]) =>
        filterValues.includes(row.original.equipmentType),
    },
    {
      id: "siteName",
      accessorKey: "siteName",
      header: ({ column }) => <DataTableColumnHeader column={column} title="사업장" />,
      cell: ({ row }) => <span className="text-[14px]">{row.original.siteName}</span>,
    },
    {
      id: "workCenterName",
      accessorKey: "workCenterName",
      header: ({ column }) => <DataTableColumnHeader column={column} title="위치" />,
      cell: ({ row }) => (
        <span className="text-[14px] text-muted-foreground">
          {row.original.workCenterName}
        </span>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="상태" />,
      cell: ({ row }) => {
        const s = row.original.status
        return (
          <Badge className={`text-[12px] border ${statusStyle[s] ?? ""}`}>
            {MOLD_STATUS_LABELS[s] ?? s}
          </Badge>
        )
      },
      filterFn: (row, _id, filterValues: string[]) =>
        filterValues.includes(row.original.status),
    },
    {
      id: "updatedAt",
      accessorKey: "updatedAt",
      header: ({ column }) => <DataTableColumnHeader column={column} title="최근 수정일" />,
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {new Date(row.original.updatedAt).toLocaleDateString("ko-KR")}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => onEdit(row.original)}
              className="text-[14px]"
            >
              <Pencil className="h-4 w-4 mr-2" />
              수정
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(row.original)}
              className="text-[14px] text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]
}
