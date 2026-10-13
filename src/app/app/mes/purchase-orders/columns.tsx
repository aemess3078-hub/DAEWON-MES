"use client"

import { ColumnDef } from "@tanstack/react-table"
import { PurchaseOrderStatus } from "@prisma/client"
import { MoreHorizontal, Pencil, Trash2, ArrowRight } from "lucide-react"
import { format, isPast } from "date-fns"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatAmountWithCurrency } from "@/lib/utils"

export type PurchaseOrderRow = {
  id: string
  orderNo: string
  supplier: { id: string; name: string; code: string }
  orderDate: Date | string
  expectedDate: Date | string
  status: PurchaseOrderStatus
  totalAmount?: number | null
  currency: string
  items: {
    id: string
    qty: number | string
    unitPrice: number | string
    receivedQty: number | string
    item: { id: string; code: string; name: string; isLotTracked?: boolean; defaultWarehouseId?: string | null }
    receivingInspections: { id: string }[]
  }[]
}

const STATUS_CONFIG: Record<
  PurchaseOrderStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  DRAFT:            { label: "초안",     variant: "secondary" },
  ORDERED:          { label: "발주완료", variant: "default" },
  PARTIAL_RECEIVED: { label: "부분입고", variant: "outline" },
  RECEIVED:         { label: "입고완료", variant: "default" },
  CLOSED:           { label: "종료",     variant: "secondary" },
  CANCELLED:        { label: "취소",     variant: "destructive" },
}

export function getColumns(
  onEdit: (row: PurchaseOrderRow) => void,
  onDelete: (id: string) => void,
  canMutate = true
): ColumnDef<PurchaseOrderRow>[] {
  return [
    {
      accessorKey: "orderNo",
      header: "발주번호",
      cell: ({ row }) => (
        <span className="font-mono text-[13px] font-medium">{row.original.orderNo}</span>
      ),
    },
    {
      id: "supplier",
      header: "공급사",
      accessorFn: (row) => row.supplier.name,
      cell: ({ row }) => (
        <span className="text-[14px]">{row.original.supplier.name}</span>
      ),
    },
    {
      accessorKey: "orderDate",
      header: "발주일",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {format(new Date(row.original.orderDate), "yyyy-MM-dd")}
        </span>
      ),
    },
    {
      accessorKey: "expectedDate",
      header: "입고예정일",
      cell: ({ row }) => {
        const date = new Date(row.original.expectedDate)
        const overdue =
          isPast(date) &&
          row.original.status !== "RECEIVED" &&
          row.original.status !== "CLOSED" &&
          row.original.status !== "CANCELLED"
        return (
          <span
            className={`text-[13px] font-medium ${
              overdue ? "text-red-600" : "text-muted-foreground"
            }`}
          >
            {format(date, "yyyy-MM-dd")}
          </span>
        )
      },
    },
    {
      id: "itemCount",
      header: "품목 수",
      cell: ({ row }) => (
        <span className="text-[13px] text-center block">{row.original.items.length}개</span>
      ),
    },
    {
      id: "totalAmount",
      header: "총금액",
      cell: ({ row }) => {
        const amount = row.original.totalAmount
        if (!amount) return <span className="text-[13px] text-muted-foreground">—</span>
        return (
          <span className="text-[13px] font-medium">
            {formatAmountWithCurrency(amount, row.original.currency)}
          </span>
        )
      },
    },
    {
      id: "receiptRate",
      header: "입고율",
      cell: ({ row }) => {
        const totalQty = row.original.items.reduce((s, i) => s + Number(i.qty), 0)
        const totalReceived = row.original.items.reduce((s, i) => s + Number(i.receivedQty), 0)
        if (totalQty === 0) return <span className="text-[13px] text-muted-foreground">—</span>
        const rate = Math.round((totalReceived / totalQty) * 100)
        return (
          <span
            className={`text-[13px] font-medium ${
              rate >= 100 ? "text-green-600" : rate > 0 ? "text-amber-600" : "text-muted-foreground"
            }`}
          >
            {rate}%
          </span>
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
      id: "actions",
      cell: ({ row }) => {
        const canGoToReceipt =
          row.original.status === "ORDERED" || row.original.status === "PARTIAL_RECEIVED"
        return (
          <div className="flex items-center gap-1.5">
            {canGoToReceipt && (
              <Link href="/app/mes/material-receipt">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[12px] gap-1 text-primary border-primary/30 hover:bg-primary/5"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                  자재입고
                </Button>
              </Link>
            )}
            {canMutate && (
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
                    disabled={row.original.status !== "DRAFT"}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> 삭제
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )
      },
    },
  ]
}
