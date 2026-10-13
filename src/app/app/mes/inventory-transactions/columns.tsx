"use client"

import { type ColumnDef } from "@tanstack/react-table"
import { type TransactionType } from "@prisma/client"

import { Badge } from "@/components/ui/badge"
import { DataTableColumnHeader } from "@/components/common/data-table"
import { type InventoryTransactionWithDetails } from "@/lib/actions/inventory.actions"
import { formatQuantity } from "@/lib/utils"

const txTypeLabels: Record<TransactionType, string> = {
  RECEIPT: "입고",
  ISSUE: "출고",
  TRANSFER: "이동",
  ADJUST: "조정",
  RETURN: "반품",
  SCRAP: "폐기",
  // 공급사 반품(outbound, -재고) — 기존 RETURN(inbound, +재고)과 구분해 명확히 표시한다.
  SUPPLIER_RETURN: "공급사 반품",
}

const txTypeBadgeClass: Record<TransactionType, string> = {
  RECEIPT: "border-green-200 bg-green-100 text-green-800 hover:bg-green-100",
  ISSUE: "border-red-200 bg-red-100 text-red-800 hover:bg-red-100",
  TRANSFER: "border-amber-200 bg-amber-100 text-amber-800 hover:bg-amber-100",
  ADJUST: "border-blue-200 bg-blue-100 text-blue-800 hover:bg-blue-100",
  RETURN: "border-purple-200 bg-purple-100 text-purple-800 hover:bg-purple-100",
  SCRAP: "border-gray-200 bg-gray-100 text-gray-800 hover:bg-gray-100",
  SUPPLIER_RETURN: "border-orange-200 bg-orange-100 text-orange-800 hover:bg-orange-100",
}

function formatDateTime(date: Date | string): string {
  return new Date(date)
    .toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(/\. /g, "-")
    .replace(/\./g, "")
    .trim()
}

export function getColumns(): ColumnDef<InventoryTransactionWithDetails>[] {
  return [
    {
      id: "txAt",
      accessorFn: (row) => row.txAt,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="거래일시" />
      ),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-[13px] text-muted-foreground">
          {formatDateTime(row.original.txAt)}
        </span>
      ),
    },
    {
      id: "txType",
      accessorKey: "txType",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="거래유형" />
      ),
      cell: ({ row }) => {
        const txType = row.getValue("txType") as TransactionType
        const label = txType === "ADJUST" && row.original.refType !== "STOCK_ADJUSTMENT"
          ? "조정(기존)"
          : txTypeLabels[txType]
        return (
          <Badge className={`text-[13px] ${txTypeBadgeClass[txType]}`}>
            {label}
          </Badge>
        )
      },
      filterFn: (row, id, filterValues: string[]) =>
        filterValues.includes(row.getValue(id)),
    },
    {
      id: "itemName",
      accessorFn: (row) => row.item.name,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="품목명" />
      ),
      cell: ({ row }) => (
        <div className="text-[14px]">
          <div className="font-medium">{row.original.item.name}</div>
          <div className="font-mono text-[13px] text-muted-foreground">{row.original.item.code}</div>
        </div>
      ),
    },
    {
      id: "spec",
      accessorFn: (row) => row.item.spec ?? "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="규격" />
      ),
      cell: ({ row }) => (
        <span className="text-[14px] text-muted-foreground">{row.getValue("spec") || "-"}</span>
      ),
    },
    {
      id: "lotNo",
      accessorFn: (row) => row.lot?.lotNo ?? "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="LOT 번호" />
      ),
      cell: ({ row }) => (
        <span className="font-mono text-[13px] text-muted-foreground">
          {row.original.lot?.lotNo ?? "-"}
        </span>
      ),
    },
    {
      id: "qty",
      accessorFn: (row) => Number(row.qty),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="수량" />
      ),
      cell: ({ row }) => {
        const txType = row.original.txType
        const qty = row.getValue("qty") as number
        const isCanonicalAdjustment = txType === "ADJUST" && row.original.refType === "STOCK_ADJUSTMENT"
        const isPositive = txType === "RECEIPT" || txType === "RETURN" || (isCanonicalAdjustment && qty > 0)
        const isNegative = txType === "ISSUE" || txType === "SCRAP" || txType === "SUPPLIER_RETURN" || (isCanonicalAdjustment && qty < 0)
        const sign = isPositive ? "+" : isNegative ? "-" : ""
        const displayQty = isCanonicalAdjustment ? Math.abs(qty) : qty
        return (
          <span
            className={`block text-right text-[14px] font-semibold tabular-nums ${
              isPositive ? "text-green-700" : isNegative ? "text-red-600" : ""
            }`}
          >
            {sign}
            {formatQuantity(displayQty)} {row.original.item.uom}
          </span>
        )
      },
    },
    {
      id: "warehouse",
      accessorFn: (row) => row.fromLocation?.name ?? row.toLocation?.name ?? "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="창고/위치" />
      ),
      cell: ({ row }) => (
        <div className="text-[13px] text-muted-foreground">
          <div>출고: {row.original.fromLocation?.name ?? "-"}</div>
          <div>입고: {row.original.toLocation?.name ?? "-"}</div>
        </div>
      ),
    },
    {
      id: "workOrderNo",
      accessorFn: (row) => row.workOrderLinks[0]?.workOrder?.orderNo ?? "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="작업지시번호" />
      ),
      cell: ({ row }) => (
        <span className="font-mono text-[13px] text-muted-foreground">
          {row.original.workOrderLinks[0]?.workOrder?.orderNo ?? "-"}
        </span>
      ),
    },
    {
      id: "manufacturingNo",
      accessorFn: (row) =>
        row.workOrderLinks[0]?.manufacturingNo ??
        row.workOrderLinks[0]?.workOrder?.manufacturingNo ??
        "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="제조번호" />
      ),
      cell: ({ row }) => {
        const link = row.original.workOrderLinks[0]
        const manufacturingNo = link?.manufacturingNo ?? link?.workOrder?.manufacturingNo
        return (
          <span className="font-mono text-[13px] text-blue-700">
            {manufacturingNo ?? "-"}
          </span>
        )
      },
    },
    {
      id: "note",
      accessorKey: "note",
      header: "비고",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {row.original.note ?? row.original.refType ?? "-"}
        </span>
      ),
    },
  ]
}
