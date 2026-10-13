"use client"

import { ColumnDef } from "@tanstack/react-table"

import { Badge } from "@/components/ui/badge"
import { DataTableColumnHeader } from "@/components/common/data-table"
import type { WipInventoryRow } from "@/lib/actions/work-order.actions"
import { formatQuantity } from "@/lib/utils"

export const WIP_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  WAITING: { label: "대기", className: "border-slate-200 bg-slate-50 text-slate-700" },
  IN_PROCESS: { label: "진행중", className: "border-sky-200 bg-sky-50 text-sky-700" },
  ON_HOLD: { label: "보류", className: "border-amber-200 bg-amber-50 text-amber-700" },
  OUTSOURCED: { label: "외주", className: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  IN_TRANSIT: { label: "이동중", className: "border-blue-200 bg-blue-50 text-blue-700" },
  RECEIVED: { label: "복귀", className: "border-cyan-200 bg-cyan-50 text-cyan-700" },
  COMPLETED: { label: "완료", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  SCRAPPED: { label: "폐기", className: "border-red-200 bg-red-50 text-red-700" },
  REWORK: { label: "재작업 보류", className: "border-orange-200 bg-orange-50 text-orange-700" },
}

export const UNIT_TYPE_CONFIG: Record<string, { label: string; className: string }> = {
  ROOT: { label: "입고 대상", className: "border-sky-200 bg-sky-50 text-sky-700" },
  SCRAP_CHILD: { label: "불량 분리", className: "border-red-200 bg-red-50 text-red-700" },
  REWORK_CHILD: { label: "재작업 분리", className: "border-orange-200 bg-orange-50 text-orange-700" },
  CHILD: { label: "분리 재공품", className: "border-slate-200 bg-slate-50 text-slate-700" },
}

export const RECEIPT_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  AVAILABLE: { label: "입고 가능", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  ON_HOLD: { label: "입고 보류", className: "border-amber-200 bg-amber-50 text-amber-700" },
  RECEIVED: { label: "입고 완료", className: "border-slate-200 bg-slate-50 text-slate-700" },
  NOT_READY: { label: "공정 진행중", className: "border-blue-200 bg-blue-50 text-blue-700" },
  NOT_APPLICABLE: { label: "입고 대상 아님", className: "border-zinc-200 bg-zinc-50 text-zinc-600" },
}

export function getColumns(): ColumnDef<WipInventoryRow>[] {
  return [
    {
      id: "workOrder",
      accessorFn: (row) => row.workOrder.orderNo,
      header: ({ column }) => <DataTableColumnHeader column={column} title="작업지시 / 제조번호" />,
      cell: ({ row }) => (
        <div className="min-w-[170px]">
          <p className="font-mono text-[13px] font-semibold text-primary">
            {row.original.workOrder.orderNo}
          </p>
          <p className="mt-0.5 font-mono text-[13px] text-muted-foreground">
            {row.original.workOrder.manufacturingNo ?? "-"}
          </p>
        </div>
      ),
    },
    {
      id: "item",
      accessorFn: (row) => row.workOrder.item.name,
      header: ({ column }) => <DataTableColumnHeader column={column} title="품목" />,
      cell: ({ row }) => (
        <div className="max-w-[160px]">
          <p className="text-[14px] font-medium leading-snug text-foreground">
            {row.original.workOrder.item.name}
          </p>
          <p className="mt-0.5 font-mono text-[13px] text-muted-foreground">
            {row.original.workOrder.item.code}
          </p>
        </div>
      ),
    },
    {
      id: "unitType",
      accessorFn: (row) => row.unitType,
      header: ({ column }) => <DataTableColumnHeader column={column} title="재공 구분" />,
      cell: ({ row }) => {
        const config = UNIT_TYPE_CONFIG[row.original.unitType]
        return (
          <div>
            <Badge variant="outline" className={`text-[13px] ${config.className}`}>
              {config.label}
            </Badge>
            {row.original.parentWipUnit ? (
              <p className="mt-1 text-[13px] text-muted-foreground">
                원 재공품 {formatQuantity(row.original.parentWipUnit.qty)}
              </p>
            ) : null}
          </div>
        )
      },
    },
    {
      id: "operation",
      accessorFn: (row) => row.operation.routingOperation.name,
      header: ({ column }) => <DataTableColumnHeader column={column} title="현재 공정 / 위치" />,
      cell: ({ row }) => {
        const location = row.original.currentLocation?.name ?? row.original.currentWarehouse?.name
        return (
          <div className="max-w-[175px]">
            <p className="text-[14px] font-medium text-foreground">
              <span className="mr-1 text-muted-foreground">{row.original.operation.seq}.</span>
              {row.original.operation.routingOperation.name}
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {row.original.currentWorkCenter?.name ??
                row.original.operation.routingOperation.workCenter.name}
            </p>
            {location ? <p className="text-[13px] text-muted-foreground">{location}</p> : null}
          </div>
        )
      },
    },
    {
      id: "wipStatus",
      accessorFn: (row) => row.wipStatus,
      header: ({ column }) => <DataTableColumnHeader column={column} title="재공 상태" />,
      cell: ({ row }) => {
        const config = WIP_STATUS_CONFIG[row.original.wipStatus]
        return (
          <Badge variant="outline" className={`text-[13px] ${config.className}`}>
            {config.label}
          </Badge>
        )
      },
    },
    {
      id: "qty",
      accessorFn: (row) => row.qty,
      header: ({ column }) => <DataTableColumnHeader column={column} title="재공 수량" />,
      cell: ({ row }) => (
        <div className="text-right">
          <p className="text-[15px] font-semibold tabular-nums text-foreground">
            {formatQuantity(row.original.qty)}
          </p>
          <p className="text-[13px] text-muted-foreground">{row.original.workOrder.item.uom}</p>
        </div>
      ),
    },
    {
      id: "receiptStatus",
      accessorFn: (row) => row.receiptStatus,
      header: ({ column }) => <DataTableColumnHeader column={column} title="완제품입고" />,
      cell: ({ row }) => {
        const config = RECEIPT_STATUS_CONFIG[row.original.receiptStatus]
        return (
          <div className="max-w-[190px]">
            <Badge variant="outline" className={`text-[13px] ${config.className}`}>
              {config.label}
            </Badge>
            {row.original.receiptStatus === "AVAILABLE" ? (
              <p className="mt-1 text-[13px] font-medium tabular-nums text-emerald-700">
                가능 {formatQuantity(row.original.availableReceiptQty)}
              </p>
            ) : null}
            {row.original.receiptBlockedReason ? (
              <p className="mt-1 text-[13px] text-amber-700">
                {row.original.receiptBlockedReason}
              </p>
            ) : null}
          </div>
        )
      },
    },
  ]
}
