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
import type { ItemGroupWithDetails } from "@/lib/actions/item-group.actions"

type ColCallbacks = {
  onEdit:   (g: ItemGroupWithDetails) => void
  onDelete: (g: ItemGroupWithDetails) => void
}

export function getColumns({ onEdit, onDelete }: ColCallbacks): ColumnDef<ItemGroupWithDetails>[] {
  return [
    {
      id:          "code",
      accessorKey: "code",
      header: ({ column }) => <DataTableColumnHeader column={column} title="품목군코드" />,
      cell: ({ row }) => (
        <span className="font-mono text-[14px] font-medium">{row.original.code}</span>
      ),
    },
    {
      id:          "name",
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="품목군명" />,
      cell: ({ row }) => <span className="text-[14px]">{row.original.name}</span>,
    },
    {
      id:         "category",
      accessorFn: (row) => row.category.name,
      header: ({ column }) => <DataTableColumnHeader column={column} title="품목분류" />,
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px]">{row.original.category.name}</span>
          <span className="text-[12px] text-muted-foreground font-mono">
            {row.original.category.code}
          </span>
        </div>
      ),
    },
    {
      id:          "description",
      accessorKey: "description",
      header:      "설명",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground line-clamp-1 max-w-[200px]">
          {row.original.description ?? "—"}
        </span>
      ),
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
      id:         "itemCount",
      accessorFn: (row) => row._count.items,
      header:     "연결 품목",
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
      id:          "isActive",
      accessorKey: "isActive",
      header:      "사용여부",
      cell: ({ row }) => (
        row.original.isActive
          ? <Badge variant="default" className="bg-emerald-100 text-emerald-800 border-emerald-200">사용</Badge>
          : <Badge variant="secondary">미사용</Badge>
      ),
      filterFn: (row, _id, filterValues: string[]) =>
        filterValues.includes(String(row.original.isActive)),
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
