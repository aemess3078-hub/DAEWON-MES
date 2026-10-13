"use client"

import { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DataTableColumnHeader } from "@/components/common/data-table"
import type { ItemCategoryWithCounts } from "@/lib/actions/item-category.actions"

export const ITEM_TYPE_LABELS: Record<string, string> = {
  RAW_MATERIAL:  "원자재",
  SEMI_FINISHED: "반제품",
  FINISHED:      "완제품",
  CONSUMABLE:    "소모품",
}

const itemTypeBadgeClass: Record<string, string> = {
  FINISHED:      "bg-blue-100 text-blue-800 border-blue-200",
  SEMI_FINISHED: "bg-purple-100 text-purple-800 border-purple-200",
  RAW_MATERIAL:  "bg-amber-100 text-amber-800 border-amber-200",
  CONSUMABLE:    "bg-slate-100 text-slate-700 border-slate-200",
}

type ColCallbacks = {
  onEdit:   (cat: ItemCategoryWithCounts) => void
  onDelete: (cat: ItemCategoryWithCounts) => void
}

export function getColumns({ onEdit, onDelete }: ColCallbacks): ColumnDef<ItemCategoryWithCounts>[] {
  return [
    {
      id:          "code",
      accessorKey: "code",
      header: ({ column }) => <DataTableColumnHeader column={column} title="코드" />,
      cell: ({ row }) => (
        <span className="font-mono text-[14px] font-medium">{row.original.code}</span>
      ),
    },
    {
      id:          "name",
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="품목분류명" />,
      cell: ({ row }) => <span className="text-[14px]">{row.original.name}</span>,
    },
    {
      id:          "itemType",
      accessorKey: "itemType",
      header: ({ column }) => <DataTableColumnHeader column={column} title="시스템 유형" />,
      cell: ({ row }) => {
        const t = row.original.itemType
        if (!t) return <span className="text-[13px] text-muted-foreground">—</span>
        return (
          <Badge variant="outline" className={itemTypeBadgeClass[t] ?? ""}>
            {ITEM_TYPE_LABELS[t] ?? t}
          </Badge>
        )
      },
    },
    {
      id:          "displayOrder",
      accessorKey: "displayOrder",
      header: ({ column }) => <DataTableColumnHeader column={column} title="표시순서" />,
      cell: ({ row }) => (
        <span className="text-[13px] tabular-nums text-muted-foreground">
          {row.original.displayOrder}
        </span>
      ),
    },
    {
      id:          "itemCount",
      accessorFn:  (row) => row._count.items,
      header:      "품목수",
      cell: ({ row }) => {
        const cnt = row.original._count.items
        return (
          <span className={`text-[13px] tabular-nums ${cnt > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>
            {cnt > 0 ? `${cnt}개` : "—"}
          </span>
        )
      },
    },
    {
      id:         "groupCount",
      accessorFn: (row) => row._count.itemGroups,
      header:     "품목군수",
      cell: ({ row }) => {
        const cnt = row.original._count.itemGroups
        return (
          <span className={`text-[13px] tabular-nums ${cnt > 0 ? "text-blue-600 font-medium" : "text-muted-foreground"}`}>
            {cnt > 0 ? `${cnt}개` : "—"}
          </span>
        )
      },
    },
    {
      id:     "actions",
      header: "",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(row.original)} className="text-[14px]">
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
      enableSorting: false,
      enableHiding:  false,
    },
  ]
}
