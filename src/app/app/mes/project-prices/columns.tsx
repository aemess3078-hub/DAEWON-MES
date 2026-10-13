"use client"

import { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ExternalLink } from "lucide-react"
import type { ProjectOrderPriceRow } from "@/lib/actions/project-order-price.actions"
import { formatAmountWithCurrency, formatQuantity } from "@/lib/utils"

export type { ProjectOrderPriceRow }

export const PRICE_STATUS_CONFIG: Record<
  ProjectOrderPriceRow["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  DRAFT: { label: "임시저장", variant: "outline" },
  DECIDED: { label: "결정완료", variant: "secondary" },
}

function fmtPrice(price: number | null, currency: string): string {
  if (price == null) return "—"
  return formatAmountWithCurrency(price, currency, { maxDecimals: 2 })
}

export function getColumns(onViewDetail: (row: ProjectOrderPriceRow) => void): ColumnDef<ProjectOrderPriceRow>[] {
  return [
    {
      id: "project",
      header: "프로젝트",
      accessorFn: (row) => `${row.projectOrder.code} ${row.projectOrder.name}`,
      cell: ({ row }) => (
        <button onClick={() => onViewDetail(row.original)} className="text-left hover:underline">
          <div className="font-mono text-[13px] font-medium text-primary">{row.original.projectOrder.code}</div>
          <div className="text-[13px] text-muted-foreground">{row.original.projectOrder.name}</div>
        </button>
      ),
    },
    {
      id: "customer",
      header: "거래처",
      accessorFn: (row) => row.customer.name,
      cell: ({ row }) => <span className="text-[14px]">{row.original.customer.name}</span>,
    },
    {
      id: "item",
      header: "품목",
      accessorFn: (row) => `${row.item.code} ${row.item.name}`,
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          [{row.original.item.code}] {row.original.item.name}
        </span>
      ),
    },
    {
      id: "quantity",
      header: "수량",
      accessorFn: (row) => row.quantity,
      cell: ({ row }) => (
        <span className="block text-right text-[14px] tabular-nums">
          {formatQuantity(row.original.quantity)} {row.original.item.uom}
        </span>
      ),
    },
    {
      id: "quotationUnitPrice",
      header: "견적단가",
      accessorFn: (row) => row.quotationUnitPrice ?? -1,
      cell: ({ row }) => (
        <span className="block text-right text-[13px] tabular-nums text-muted-foreground">
          {fmtPrice(row.original.quotationUnitPrice, row.original.currency)}
        </span>
      ),
    },
    {
      id: "orderUnitPrice",
      header: "수주단가",
      accessorFn: (row) => row.orderUnitPrice ?? -1,
      cell: ({ row }) => (
        <span className="block text-right text-[13px] tabular-nums text-muted-foreground">
          {fmtPrice(row.original.orderUnitPrice, row.original.currency)}
        </span>
      ),
    },
    {
      id: "finalUnitPrice",
      header: "최종결정단가",
      accessorFn: (row) => row.finalUnitPrice ?? -1,
      cell: ({ row }) => (
        <span className="block text-right text-[14px] font-semibold tabular-nums">
          {fmtPrice(row.original.finalUnitPrice, row.original.currency)}
        </span>
      ),
    },
    {
      id: "quoteToFinalRate",
      header: "조정률",
      accessorFn: (row) => {
        const { quotationUnitPrice, finalUnitPrice } = row
        if (quotationUnitPrice == null || finalUnitPrice == null || quotationUnitPrice === 0) return null
        return ((finalUnitPrice - quotationUnitPrice) / quotationUnitPrice) * 100
      },
      cell: ({ row }) => {
        const { quotationUnitPrice, finalUnitPrice } = row.original
        if (quotationUnitPrice == null || finalUnitPrice == null || quotationUnitPrice === 0) {
          return <span className="block text-right text-[13px] text-muted-foreground">—</span>
        }
        const rate = ((finalUnitPrice - quotationUnitPrice) / quotationUnitPrice) * 100
        const colorClass = rate > 0 ? "text-red-600" : rate < 0 ? "text-blue-600" : "text-muted-foreground"
        return (
          <span className={`block text-right text-[13px] font-medium tabular-nums ${colorClass}`}>
            {rate > 0 ? "+" : ""}
            {rate.toFixed(1)}%
          </span>
        )
      },
    },
    {
      id: "status",
      header: "상태",
      cell: ({ row }) => {
        const cfg = PRICE_STATUS_CONFIG[row.original.status]
        return <Badge variant={cfg.variant} className="text-[12px]">{cfg.label}</Badge>
      },
    },
    {
      accessorKey: "decidedAt",
      header: "최종결정일",
      cell: ({ row }) =>
        row.original.decidedAt ? (
          <span className="text-[13px] text-muted-foreground">{format(new Date(row.original.decidedAt), "yyyy-MM-dd")}</span>
        ) : (
          <span className="text-[13px] text-muted-foreground">—</span>
        ),
    },
    {
      id: "actions",
      header: "관리",
      cell: ({ row }) => (
        <Button size="sm" variant="outline" className="h-7 text-[13px] px-2 gap-1" onClick={() => onViewDetail(row.original)}>
          <ExternalLink className="h-3 w-3" />
          상세
        </Button>
      ),
      enableSorting: false,
    },
  ]
}
