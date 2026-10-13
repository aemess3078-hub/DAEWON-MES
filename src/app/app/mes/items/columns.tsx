"use client"

import { ColumnDef } from "@tanstack/react-table"
import { ItemType, ItemStatus } from "@prisma/client"
import { Badge } from "@/components/ui/badge"
import { DataTableColumnHeader } from "@/components/common/data-table"
import { DataTableRowActions } from "@/components/common/data-table"
import type { ItemWithDetails } from "@/lib/actions/item.actions"

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  RAW_MATERIAL:  "원자재",
  SEMI_FINISHED: "반제품",
  FINISHED:      "완제품",
  CONSUMABLE:    "소모품",
}

const itemTypeBadgeClass: Record<ItemType, string> = {
  FINISHED:      "bg-blue-100 text-blue-800 border-blue-200",
  SEMI_FINISHED: "bg-purple-100 text-purple-800 border-purple-200",
  RAW_MATERIAL:  "bg-amber-100 text-amber-800 border-amber-200",
  CONSUMABLE:    "bg-slate-100 text-slate-700 border-slate-200",
}

const itemStatusLabels: Record<ItemStatus, string> = {
  ACTIVE:       "활성",
  INACTIVE:     "비활성",
  DISCONTINUED: "단종",
}

export function getColumns(callbacks: {
  onEdit:   (item: ItemWithDetails) => void
  onDelete: (item: ItemWithDetails) => void
}): ColumnDef<ItemWithDetails>[] {
  return [
    {
      accessorKey: "code",
      header: ({ column }) => <DataTableColumnHeader column={column} title="품목코드" />,
      cell: ({ row }) => (
        <span className="font-mono font-medium text-[14px]">{row.getValue("code")}</span>
      ),
    },
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="품목명" />,
      cell: ({ row }) => (
        <span className="text-[14px]">{row.getValue("name")}</span>
      ),
      filterFn: (row, _colId, filterValue: string) => {
        const q = filterValue.toLowerCase()
        return (
          row.original.code.toLowerCase().includes(q) ||
          row.original.name.toLowerCase().includes(q)
        )
      },
    },
    {
      accessorKey: "itemType",
      header: ({ column }) => <DataTableColumnHeader column={column} title="시스템 유형" />,
      cell: ({ row }) => {
        const t = row.getValue("itemType") as ItemType
        return (
          <Badge variant="outline" className={`text-[13px] ${itemTypeBadgeClass[t] ?? ""}`}>
            {ITEM_TYPE_LABELS[t] ?? t}
          </Badge>
        )
      },
      filterFn: (row, id, filterValues: string[]) =>
        filterValues.includes(row.getValue(id)),
    },
    {
      id:         "category",
      accessorFn: (row) => row.category?.name ?? null,
      header:     "품목분류",
      cell: ({ row }) => {
        const name = row.original.category?.name
        return (
          <span className="text-[14px] text-muted-foreground">
            {name ?? <span className="text-[13px] italic">품목분류 미지정</span>}
          </span>
        )
      },
    },
    {
      id:         "itemGroup",
      accessorFn: (row) => row.itemGroup?.name ?? null,
      header:     "품목군",
      cell: ({ row }) => {
        const name = row.original.itemGroup?.name
        return (
          <span className="text-[13px] text-muted-foreground">
            {name ?? "—"}
          </span>
        )
      },
    },
    {
      accessorKey: "uom",
      header:      "단위",
      cell: ({ row }) => (
        <span className="text-[14px]">{row.getValue("uom")}</span>
      ),
    },
    {
      accessorKey: "spec",
      header:      "규격",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground line-clamp-1 max-w-[160px]">
          {row.getValue("spec") ?? "—"}
        </span>
      ),
    },
    {
      id:         "defaultWarehouse",
      accessorFn: (row) => row.defaultWarehouse?.name ?? null,
      header:     "기본 입고창고",
      cell: ({ row }) => {
        const wh = row.original.defaultWarehouse
        if (!wh) return <span className="text-[13px] text-muted-foreground">—</span>
        return (
          <span className="whitespace-nowrap text-[13px]">
            <span className="font-mono text-muted-foreground">[{wh.code}]</span> {wh.name}
          </span>
        )
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="상태" />,
      cell: ({ row }) => {
        const s = row.getValue("status") as ItemStatus
        const variantMap: Record<ItemStatus, "default" | "secondary" | "destructive"> = {
          ACTIVE:       "default",
          INACTIVE:     "secondary",
          DISCONTINUED: "destructive",
        }
        return (
          <Badge variant={variantMap[s]} className="text-[13px]">
            {itemStatusLabels[s]}
          </Badge>
        )
      },
      filterFn: (row, id, filterValues: string[]) =>
        filterValues.includes(row.getValue(id)),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DataTableRowActions
          onEdit={()   => callbacks.onEdit(row.original)}
          onDelete={() => callbacks.onDelete(row.original)}
        />
      ),
      enableSorting: false,
      enableHiding:  false,
    },
  ]
}
