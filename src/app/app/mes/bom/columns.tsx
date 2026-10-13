"use client"

import { ColumnDef } from "@tanstack/react-table"
import { BOMStatus } from "@prisma/client"

import { Badge } from "@/components/ui/badge"
import { DataTableColumnHeader } from "@/components/common/data-table"
import { DataTableRowActions } from "@/components/common/data-table"
import { BOMWithDetails } from "@/lib/actions/bom.actions"

const bomStatusLabels: Record<BOMStatus, string> = {
  DRAFT: "초안",
  ACTIVE: "활성",
  INACTIVE: "비활성",
}

const itemTypeLabels: Record<string, string> = {
  RAW_MATERIAL: "원자재",
  SEMI_FINISHED: "반제품",
  FINISHED: "완제품",
  CONSUMABLE: "소모품",
}

export function getColumns(callbacks: {
  onEdit: (bom: BOMWithDetails) => void
  onDelete: (bom: BOMWithDetails) => void
  onSelect: (bom: BOMWithDetails) => void
  selectedId?: string | null
}): ColumnDef<BOMWithDetails>[] {
  return [
    {
      id: "itemCode",
      accessorFn: (row) => row.item.code,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="품목코드" />
      ),
      cell: ({ row }) => {
        const isSelected = callbacks.selectedId === row.original.id
        return (
          <button
            onClick={(event) => {
              event.stopPropagation()
              callbacks.onSelect(row.original)
            }}
            className={`font-mono text-[13px] font-semibold px-2 py-0.5 rounded transition-colors ${
              isSelected
                ? "bg-primary text-primary-foreground"
                : "text-primary hover:bg-primary/10 hover:underline"
            }`}
          >
            {row.getValue("itemCode")}
          </button>
        )
      },
    },
    {
      id: "itemName",
      accessorFn: (row) => row.item.name,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="품목명" />
      ),
      cell: ({ row }) => (
        <span className="text-[14px]">{row.getValue("itemName")}</span>
      ),
    },
    {
      accessorKey: "version",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="버전" />
      ),
      cell: ({ row }) => (
        <span className="text-[14px] font-mono">{row.getValue("version")}</span>
      ),
    },
    {
      id: "bomItemCount",
      accessorFn: (row) => row.bomItems.length,
      header: "자재 수",
      cell: ({ row }) => (
        <span className="text-[14px] text-muted-foreground">
          {row.getValue("bomItemCount")}개
        </span>
      ),
    },
    {
      accessorKey: "isDefault",
      header: "기본 BOM",
      cell: ({ row }) => {
        const isDefault = row.getValue("isDefault") as boolean
        return (
          <Badge
            variant={isDefault ? "default" : "secondary"}
            className="text-[13px]"
          >
            {isDefault ? "기본" : "-"}
          </Badge>
        )
      },
    },
    {
      id: "itemType",
      accessorFn: (row) => row.item.itemType,
      header: "품목유형",
      cell: ({ row }) => {
        const type = row.getValue("itemType") as string
        return (
          <Badge variant="secondary" className="text-[13px]">
            {itemTypeLabels[type] ?? type}
          </Badge>
        )
      },
      filterFn: (row, id, filterValues: string[]) =>
        filterValues.includes(row.getValue(id)),
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="상태" />
      ),
      cell: ({ row }) => {
        const status = row.getValue("status") as BOMStatus
        const variantMap: Record<BOMStatus, "default" | "secondary" | "destructive"> = {
          DRAFT: "secondary",
          ACTIVE: "default",
          INACTIVE: "destructive",
        }
        return (
          <Badge variant={variantMap[status]} className="text-[13px]">
            {bomStatusLabels[status]}
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
          onEdit={() => callbacks.onEdit(row.original)}
          onDelete={() => callbacks.onDelete(row.original)}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
  ]
}
