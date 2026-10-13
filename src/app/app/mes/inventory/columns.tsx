"use client"

import { type ColumnDef } from "@tanstack/react-table"
import { Tag, AlertTriangle } from "lucide-react"

import { DataTableColumnHeader } from "@/components/common/data-table"
import { type GroupedInventoryStock } from "@/lib/actions/inventory.actions"
import { formatQuantity } from "@/lib/utils"

const itemTypeLabels: Record<string, string> = {
  RAW_MATERIAL: "원자재",
  SEMI_FINISHED: "반제품",
  FINISHED: "완제품",
  CONSUMABLE: "소모품",
}

export function getGroupedInventoryColumns(): ColumnDef<GroupedInventoryStock>[] {
  return [
    {
      id: "itemCode",
      accessorFn: (row) => row.itemCode,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="품목코드" />
      ),
      cell: ({ row }) => (
        <span className="font-mono text-[14px] font-medium">{row.original.itemCode}</span>
      ),
    },
    {
      id: "itemName",
      accessorFn: (row) => row.itemName,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="품목명" />
      ),
      cell: ({ row }) => {
        const { itemName, itemSpec, isLotTracked, hasUnlottedStock } = row.original
        return (
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-medium">{itemName}</span>
              {isLotTracked && (
                <span className="inline-flex items-center gap-0.5 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                  <Tag className="h-2.5 w-2.5" />
                  LOT
                </span>
              )}
              {hasUnlottedStock && (
                <span className="inline-flex items-center gap-0.5 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  미지정
                </span>
              )}
            </div>
            {itemSpec && (
              <div className="mt-0.5 text-[13px] text-muted-foreground">{itemSpec}</div>
            )}
          </div>
        )
      },
    },
    {
      id: "itemType",
      accessorFn: (row) => row.itemType,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="품목유형" />
      ),
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {itemTypeLabels[row.original.itemType] ?? row.original.itemType}
        </span>
      ),
      filterFn: (row, _id, filterValues: string[]) =>
        filterValues.includes(row.original.itemType),
    },
    {
      id: "uom",
      accessorFn: (row) => row.uom,
      header: "단위",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">{row.original.uom}</span>
      ),
    },
    {
      id: "totalQtyOnHand",
      accessorFn: (row) => row.totalQtyOnHand,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="현재고" />
      ),
      cell: ({ row }) => (
        <span className="block text-right text-[14px] font-semibold tabular-nums">
          {formatQuantity(row.original.totalQtyOnHand)}
        </span>
      ),
    },
    {
      id: "totalQtyAvailable",
      accessorFn: (row) => row.totalQtyAvailable,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="가용재고" />
      ),
      cell: ({ row }) => {
        const qty = row.original.totalQtyAvailable
        return (
          <span
            className={`block text-right text-[14px] font-semibold tabular-nums ${
              qty <= 0 ? "text-red-600" : "text-emerald-700"
            }`}
          >
            {formatQuantity(qty)}
          </span>
        )
      },
    },
    {
      id: "totalQtyHold",
      accessorFn: (row) => row.totalQtyHold,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="보류재고" />
      ),
      cell: ({ row }) => (
        <span className="block text-right text-[14px] text-muted-foreground tabular-nums">
          {row.original.totalQtyHold > 0
            ? formatQuantity(row.original.totalQtyHold)
            : "—"}
        </span>
      ),
    },
    {
      id: "detailCount",
      accessorFn: (row) => (row.isLotTracked ? row.lotCount : row.warehouseCount),
      header: "상세",
      cell: ({ row }) => {
        const { isLotTracked, lotCount, warehouseCount } = row.original
        if (isLotTracked) {
          return (
            <span className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[12px] font-medium text-blue-700">
              LOT {lotCount}개
            </span>
          )
        }
        return (
          <span className="text-[13px] text-muted-foreground">{warehouseCount}개소</span>
        )
      },
    },
  ]
}
