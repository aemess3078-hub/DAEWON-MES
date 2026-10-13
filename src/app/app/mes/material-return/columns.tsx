"use client"

import { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ExternalLink } from "lucide-react"
import type { MaterialReturnRow } from "@/lib/actions/material-return.actions"
import { formatQuantity } from "@/lib/utils"

export type { MaterialReturnRow }

export const RETURN_STATUS_CONFIG: Record<
  MaterialReturnRow["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  DRAFT:     { label: "임시저장", variant: "outline" },
  COMPLETED: { label: "반품완료", variant: "secondary" },
  CANCELLED: { label: "취소됨", variant: "destructive" },
}

export function getColumns(onViewDetail: (row: MaterialReturnRow) => void): ColumnDef<MaterialReturnRow>[] {
  return [
    {
      accessorKey: "returnNo",
      header: "반품번호",
      cell: ({ row }) => (
        <button
          onClick={() => onViewDetail(row.original)}
          className="font-mono text-[13px] font-medium text-primary hover:underline"
        >
          {row.original.returnNo}
        </button>
      ),
    },
    {
      id: "siteName",
      header: "사업장",
      accessorFn: (row) => row.site.name,
      cell: ({ row }) => <span className="text-[13px] text-muted-foreground">{row.original.site.name}</span>,
    },
    {
      id: "supplierName",
      header: "공급사",
      accessorFn: (row) => row.supplier.name,
      cell: ({ row }) => <span className="text-[14px] font-medium">{row.original.supplier.name}</span>,
    },
    {
      id: "purchaseOrderNo",
      header: "발주번호",
      accessorFn: (row) => row.purchaseOrder?.orderNo ?? "",
      cell: ({ row }) => (
        <span className="font-mono text-[13px] text-muted-foreground">
          {row.original.purchaseOrder?.orderNo ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "상태",
      cell: ({ row }) => {
        const cfg = RETURN_STATUS_CONFIG[row.original.status]
        return <Badge variant={cfg.variant} className="text-[12px]">{cfg.label}</Badge>
      },
    },
    {
      id: "itemCount",
      header: "품목수",
      accessorFn: (row) => row.itemCount,
      cell: ({ row }) => <span className="text-[14px] tabular-nums">{row.original.itemCount}</span>,
    },
    {
      id: "totalReturnQty",
      header: "총반품수량",
      accessorFn: (row) => row.totalReturnQty,
      cell: ({ row }) => (
        <span className="block text-right text-[14px] font-semibold tabular-nums text-red-600">
          -{formatQuantity(row.original.totalReturnQty)}
        </span>
      ),
    },
    {
      id: "reason",
      header: "반품사유",
      accessorFn: (row) => row.reason ?? "",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">{row.original.reason || "—"}</span>
      ),
    },
    {
      id: "createdByName",
      header: "등록자",
      accessorFn: (row) => row.createdBy.name,
      cell: ({ row }) => <span className="text-[14px]">{row.original.createdBy.name}</span>,
    },
    {
      accessorKey: "createdAt",
      header: "등록일",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">{format(new Date(row.original.createdAt), "yyyy-MM-dd")}</span>
      ),
    },
    {
      id: "completedAt",
      header: "완료일",
      accessorFn: (row) => row.completedAt ?? "",
      cell: ({ row }) =>
        row.original.completedAt ? (
          <span className="text-[13px] text-muted-foreground">{format(new Date(row.original.completedAt), "yyyy-MM-dd")}</span>
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
