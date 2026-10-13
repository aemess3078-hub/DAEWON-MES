"use client"

import { ColumnDef } from "@tanstack/react-table"
import { WorkCenterWithDetails } from "@/lib/actions/work-center.actions"
import { WorkCenterKind } from "@prisma/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"

const KIND_LABELS: Record<WorkCenterKind, string> = {
  ASSEMBLY: "조립",
  MACHINING: "가공",
  INSPECTION: "검사",
  PACKAGING: "포장",
  STORAGE: "창고",
}

const KIND_COLORS: Record<WorkCenterKind, string> = {
  ASSEMBLY: "bg-blue-100 text-blue-800 border-blue-200",
  MACHINING: "bg-violet-100 text-violet-800 border-violet-200",
  INSPECTION: "bg-green-100 text-green-800 border-green-200",
  PACKAGING: "bg-amber-100 text-amber-800 border-amber-200",
  STORAGE: "bg-slate-100 text-slate-700 border-slate-200",
}

type GetColumnsProps = {
  onEdit: (wc: WorkCenterWithDetails) => void
  onDelete: (wc: WorkCenterWithDetails) => void
}

export function getColumns({ onEdit, onDelete }: GetColumnsProps): ColumnDef<WorkCenterWithDetails>[] {
  return [
    {
      accessorKey: "code",
      header: "공정코드",
      cell: ({ row }) => (
        <span className="font-mono text-sm font-medium">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "공정명",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: "kind",
      header: "공정유형",
      cell: ({ row }) => {
        const kind = row.original.kind
        return (
          <Badge variant="outline" className={KIND_COLORS[kind]}>
            {KIND_LABELS[kind]}
          </Badge>
        )
      },
    },
    {
      id: "site",
      header: "공장/사이트",
      cell: ({ row }) => row.original.site?.name ?? "—",
    },
    {
      id: "usageCount",
      header: "라우팅 사용",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original._count.routingOperations}건
        </span>
      ),
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
              <Pencil className="h-4 w-4 mr-2" /> 수정
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(row.original)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" /> 삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]
}
