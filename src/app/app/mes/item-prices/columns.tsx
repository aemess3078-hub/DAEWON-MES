"use client"

import { ColumnDef } from "@tanstack/react-table"
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

export type ItemPriceRow = {
  id: string
  priceType: string
  unitPrice: number | string
  currency: string
  effectiveFrom: Date | string
  effectiveTo?: Date | string | null
  note?: string | null
  item: { id: string; code: string; name: string }
  partner: { id: string; code: string; name: string }
}

export function getColumns(
  onEdit: (row: ItemPriceRow) => void,
  onDelete: (id: string) => void
): ColumnDef<ItemPriceRow>[] {
  return [
    {
      id: "itemCode",
      header: "품목코드",
      accessorFn: (row) => row.item.code,
      cell: ({ row }) => (
        <span className="font-mono text-[13px]">{row.original.item.code}</span>
      ),
    },
    {
      id: "itemName",
      header: "품목명",
      accessorFn: (row) => row.item.name,
      cell: ({ row }) => (
        <span className="text-[14px]">{row.original.item.name}</span>
      ),
    },
    {
      id: "partnerName",
      header: "거래처",
      accessorFn: (row) => row.partner.name,
      cell: ({ row }) => (
        <span className="text-[14px]">{row.original.partner.name}</span>
      ),
    },
    {
      accessorKey: "priceType",
      header: "유형",
      cell: ({ row }) => {
        const isPurchase = row.original.priceType === "PURCHASE"
        return (
          <Badge
            variant="outline"
            className={`text-[12px] ${
              isPurchase
                ? "border-blue-300 text-blue-700 bg-blue-50"
                : "border-green-300 text-green-700 bg-green-50"
            }`}
          >
            {isPurchase ? "구매" : "판매"}
          </Badge>
        )
      },
    },
    {
      accessorKey: "unitPrice",
      header: "단가",
      cell: ({ row }) => (
        <span className="text-[14px] font-medium">
          {Number(row.original.unitPrice).toLocaleString()} {row.original.currency}
        </span>
      ),
    },
    {
      accessorKey: "effectiveFrom",
      header: "유효 시작",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {format(new Date(row.original.effectiveFrom), "yyyy-MM-dd")}
        </span>
      ),
    },
    {
      accessorKey: "effectiveTo",
      header: "유효 종료",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {row.original.effectiveTo
            ? format(new Date(row.original.effectiveTo), "yyyy-MM-dd")
            : "—"}
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
              <Pencil className="mr-2 h-4 w-4" /> 수정
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(row.original.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> 삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]
}
