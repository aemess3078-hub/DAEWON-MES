"use client"

import { ColumnDef } from "@tanstack/react-table"
import { differenceInDays, isPast } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { DataTableColumnHeader, DataTableRowActions } from "@/components/common/data-table"
import type { QuotationWithDetails } from "@/lib/actions/quotation.actions"

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT:       { label: "초안",       className: "" },
  SUBMITTED:   { label: "제출됨",     className: "bg-blue-100 text-blue-800 border-blue-200" },
  NEGOTIATING: { label: "협상중",     className: "bg-amber-100 text-amber-800 border-amber-200" },
  WON:         { label: "수주확정",   className: "bg-green-100 text-green-800 border-green-200" },
  LOST:        { label: "실패",       className: "bg-red-100 text-red-700 border-red-200" },
  EXPIRED:     { label: "만료",       className: "line-through text-muted-foreground" },
  CANCELLED:   { label: "취소",       className: "bg-red-100 text-red-700 border-red-200" },
}

const ACTIVE_STATUSES = new Set(["DRAFT", "SUBMITTED", "NEGOTIATING"])

export function getColumns(callbacks: {
  onEdit: (q: QuotationWithDetails) => void
  onDelete: (q: QuotationWithDetails) => void
  onConvert: (q: QuotationWithDetails) => void
}): ColumnDef<QuotationWithDetails>[] {
  return [
    {
      accessorKey: "quotationNo",
      header: ({ column }) => <DataTableColumnHeader column={column} title="견적번호" />,
      cell: ({ row }) => (
        <span className="font-mono text-[13px] font-semibold text-primary">
          {row.getValue("quotationNo")}
        </span>
      ),
    },
    {
      id: "customerName",
      accessorFn: (row) => row.customer.name,
      header: ({ column }) => <DataTableColumnHeader column={column} title="고객사" />,
      cell: ({ row }) => <span className="text-[14px]">{row.getValue("customerName")}</span>,
    },
    {
      accessorKey: "quotationDate",
      header: ({ column }) => <DataTableColumnHeader column={column} title="견적일" />,
      cell: ({ row }) => (
        <span className="text-[14px] font-mono">
          {new Date(row.getValue("quotationDate")).toLocaleDateString("ko-KR")}
        </span>
      ),
    },
    {
      accessorKey: "validUntil",
      header: "유효기한",
      cell: ({ row }) => {
        const date = new Date(row.getValue("validUntil"))
        const status = row.original.status
        const isActive = ACTIVE_STATUSES.has(status)
        const expired = isActive && isPast(date)
        const daysLeft = differenceInDays(date, new Date())
        const nearExpiry = isActive && !expired && daysLeft <= 7

        return (
          <span className={`text-[14px] font-mono ${
            expired ? "text-red-600 font-semibold" :
            nearExpiry ? "text-amber-600 font-semibold" :
            "text-foreground"
          }`}>
            {date.toLocaleDateString("ko-KR")}
            {expired && <span className="ml-1 text-[11px]">만료</span>}
          </span>
        )
      },
    },
    {
      id: "itemCount",
      accessorFn: (row) => row.items.length,
      header: "품목 수",
      cell: ({ row }) => (
        <span className="text-[14px] text-muted-foreground">{row.getValue("itemCount")}건</span>
      ),
    },
    {
      accessorKey: "totalAmount",
      header: ({ column }) => <DataTableColumnHeader column={column} title="총금액" />,
      cell: ({ row }) => {
        const amount = row.getValue("totalAmount") as number | null
        return (
          <span className="text-[14px] font-semibold text-right block">
            {amount != null ? `₩${amount.toLocaleString("ko-KR")}` : "-"}
          </span>
        )
      },
    },
    {
      id: "status",
      accessorFn: (row) => row.status,
      header: "상태",
      cell: ({ row }) => {
        const status = row.getValue("status") as string
        const cfg = STATUS_CONFIG[status] ?? { label: status, className: "" }
        return (
          <Badge
            variant={status === "DRAFT" ? "secondary" : "outline"}
            className={`text-[12px] ${cfg.className}`}
          >
            {cfg.label}
          </Badge>
        )
      },
      filterFn: (row, id, filterValues: string[]) => filterValues.includes(row.getValue(id)),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const q = row.original
        const isLocked = ["WON", "LOST", "EXPIRED", "CANCELLED"].includes(q.status)
        const canConvert = q.status === "WON" && !q.convertedSalesOrderId
        return (
          <div className="flex items-center gap-1">
            {canConvert && (
              <button
                onClick={() => callbacks.onConvert(q)}
                className="text-[12px] px-2 py-1 rounded bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 font-medium"
              >
                수주 전환
              </button>
            )}
            {q.convertedSalesOrderId && (
              <span className="text-[12px] text-muted-foreground px-2">수주완료</span>
            )}
            <DataTableRowActions
              onEdit={isLocked ? undefined : () => callbacks.onEdit(q)}
              onDelete={q.status === "DRAFT" ? () => callbacks.onDelete(q) : undefined}
            />
          </div>
        )
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]
}
