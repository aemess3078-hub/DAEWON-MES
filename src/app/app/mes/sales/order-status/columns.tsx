"use client"

import { ColumnDef } from "@tanstack/react-table"
import { SalesOrderStatus } from "@prisma/client"
import { format } from "date-fns"

import { DataTableColumnHeader } from "@/components/common/data-table"
import { Badge } from "@/components/ui/badge"
import type { SalesOrderStatusRow } from "@/lib/actions/sales-order.actions"
import { formatQuantity } from "@/lib/utils"

const STATUS_CONFIG: Record<
  SalesOrderStatus,
  { label: string; className: string }
> = {
  DRAFT: {
    label: "초안",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  },
  CONFIRMED: {
    label: "확정",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  IN_PRODUCTION: {
    label: "생산중",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  PARTIAL_SHIPPED: {
    label: "부분출하",
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
  SHIPPED: {
    label: "출하완료",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  CLOSED: {
    label: "완료",
    className: "border-zinc-200 bg-zinc-50 text-zinc-700",
  },
  CANCELLED: {
    label: "취소",
    className: "border-red-200 bg-red-50 text-red-700",
  },
}

const CLOSED_STATUSES: SalesOrderStatus[] = ["SHIPPED", "CLOSED", "CANCELLED"]

export function getColumns(): ColumnDef<SalesOrderStatusRow>[] {
  return [
    {
      accessorKey: "orderNo",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="수주번호" />
      ),
      cell: ({ row }) => (
        <span className="font-mono text-[13px] font-medium text-primary">
          {row.original.orderNo}
        </span>
      ),
    },
    {
      id: "customerName",
      accessorFn: (row) => row.customer.name,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="거래처" />
      ),
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <p className="text-[14px] font-medium text-foreground">
            {row.original.customer.name}
          </p>
          <p className="font-mono text-[13px] text-muted-foreground">
            {row.original.customer.code}
          </p>
        </div>
      ),
    },
    {
      id: "orderDate",
      accessorFn: (row) => new Date(row.orderDate).getTime(),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="수주일" />
      ),
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {format(new Date(row.original.orderDate), "yyyy-MM-dd")}
        </span>
      ),
    },
    {
      id: "deliveryDate",
      accessorFn: (row) => new Date(row.deliveryDate).getTime(),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="납기일" />
      ),
      cell: ({ row }) => {
        const overdue = isOverdue(row.original)
        return (
          <div className="flex items-center gap-2">
            <span
              className={`text-[13px] font-medium ${
                overdue ? "text-red-600" : "text-muted-foreground"
              }`}
            >
              {format(new Date(row.original.deliveryDate), "yyyy-MM-dd")}
            </span>
            {overdue ? (
              <Badge variant="outline" className="border-red-200 bg-red-50 text-[12px] text-red-700">
                지연
              </Badge>
            ) : null}
          </div>
        )
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="상태" />
      ),
      cell: ({ row }) => {
        const config = STATUS_CONFIG[row.original.status]
        return (
          <Badge variant="outline" className={`text-[12px] ${config.className}`}>
            {config.label}
          </Badge>
        )
      },
      filterFn: (row, _id, filterValues: string[]) =>
        filterValues.includes(row.original.status),
    },
    {
      id: "itemSummary",
      accessorFn: (row) => {
        const firstItem = row.items[0]?.item
        return firstItem ? `${firstItem.code} ${firstItem.name}` : ""
      },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="품목" />
      ),
      cell: ({ row }) => {
        const firstItem = row.original.items[0]?.item
        if (!firstItem) {
          return <span className="text-[13px] text-muted-foreground">품목 없음</span>
        }

        const extraCount = row.original.items.length - 1
        return (
          <div className="space-y-0.5">
            <p className="text-[14px] font-medium text-foreground">
              {firstItem.name}
              {extraCount > 0 ? (
                <span className="ml-1 text-[13px] text-muted-foreground">
                  외 {formatQuantity(extraCount)}건
                </span>
              ) : null}
            </p>
            <p className="font-mono text-[13px] text-muted-foreground">
              {firstItem.code}
            </p>
          </div>
        )
      },
    },
    {
      id: "orderedQty",
      accessorFn: (row) => getQuantitySummary(row).orderedQty,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="수주수량" />
      ),
      cell: ({ row }) => (
        <QuantityCell value={getQuantitySummary(row.original).orderedQty} />
      ),
    },
    {
      id: "shippedQty",
      accessorFn: (row) => getQuantitySummary(row).shippedQty,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="출하수량" />
      ),
      cell: ({ row }) => (
        <QuantityCell value={getQuantitySummary(row.original).shippedQty} />
      ),
    },
    {
      id: "remainingQty",
      accessorFn: (row) => getQuantitySummary(row).remainingQty,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="미출하수량" />
      ),
      cell: ({ row }) => {
        const remainingQty = getQuantitySummary(row.original).remainingQty
        return (
          <span
            className={`block text-right text-[14px] font-medium tabular-nums ${
              remainingQty > 0 ? "text-amber-700" : "text-emerald-700"
            }`}
          >
            {formatQuantity(remainingQty)}
          </span>
        )
      },
    },
  ]
}

function QuantityCell({ value }: { value: number }) {
  return (
    <span className="block text-right text-[14px] tabular-nums">
      {formatQuantity(value)}
    </span>
  )
}

function getQuantitySummary(order: SalesOrderStatusRow) {
  return order.items.reduce(
    (summary, item) => {
      const orderedQty = Number(item.qty)
      const shippedQty = Number(item.shippedQty)

      summary.orderedQty += orderedQty
      summary.shippedQty += shippedQty
      summary.remainingQty += Math.max(0, orderedQty - shippedQty)

      return summary
    },
    { orderedQty: 0, shippedQty: 0, remainingQty: 0 }
  )
}

function isOverdue(order: SalesOrderStatusRow) {
  if (CLOSED_STATUSES.includes(order.status)) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const deliveryDate = new Date(order.deliveryDate)
  deliveryDate.setHours(0, 0, 0, 0)

  return deliveryDate < today
}
