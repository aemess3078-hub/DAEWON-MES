"use client"

import { ColumnDef } from "@tanstack/react-table"
import { OperationStatus } from "@prisma/client"

import { Badge } from "@/components/ui/badge"
import { DataTableColumnHeader } from "@/components/common/data-table"
import { ProductionResultWithDetails } from "@/lib/actions/production-result.actions"
import { formatQuantity } from "@/lib/utils"

const operationStatusLabels: Record<OperationStatus, string> = {
  PENDING: "대기",
  IN_PROGRESS: "진행중",
  COMPLETED: "완료",
  SKIPPED: "건너뜀",
}

function formatDateTime(date: string | null): string {
  if (!date) return "-"
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return "-"
  const dateStr = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })
  const timeStr = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  return `${dateStr} ${timeStr}`
}

function formatDuration(minutes: number | null): string {
  if (minutes == null) return "-"
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return hours > 0 ? `${hours}시간 ${remainder}분` : `${remainder}분`
}

export function getColumns(): ColumnDef<ProductionResultWithDetails>[] {
  return [
    {
      id: "orderNo",
      accessorFn: (row) => row.workOrderOperation.workOrder.orderNo,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="작업지시번호" />
      ),
      cell: ({ row }) => (
        <span className="font-mono font-medium text-[14px]">
          {row.getValue("orderNo")}
        </span>
      ),
    },
    {
      id: "item",
      accessorFn: (row) =>
        `${row.workOrderOperation.workOrder.item.code} ${row.workOrderOperation.workOrder.item.name}`,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="품목" />
      ),
      cell: ({ row }) => {
        const item = row.original.workOrderOperation.workOrder.item
        return (
          <div className="flex flex-col">
            <span className="text-[14px] font-medium">{item.name}</span>
            <span className="text-[13px] text-muted-foreground">{item.code}</span>
          </div>
        )
      },
    },
    {
      id: "operation",
      accessorFn: (row) => row.workOrderOperation.routingOperation.name,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="공정" />
      ),
      cell: ({ row }) => (
        <span className="text-[14px]">
          {row.original.workOrderOperation.routingOperation.name}
        </span>
      ),
    },
    {
      id: "workCenter",
      accessorFn: (row) =>
        row.workOrderOperation.routingOperation.workCenter.name,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="작업장" />
      ),
      cell: ({ row }) => (
        <span className="text-[14px]">
          {row.original.workOrderOperation.routingOperation.workCenter.name}
        </span>
      ),
    },
    {
      id: "equipment",
      accessorFn: (row) => row.equipment?.name ?? "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="설비" />
      ),
      cell: ({ row }) => {
        const eq = row.original.equipment
        if (!eq) return <span className="text-[13px] text-muted-foreground">—</span>
        return (
          <div className="flex flex-col">
            <span className="text-[14px]">{eq.name}</span>
            <span className="text-[13px] text-muted-foreground font-mono">{eq.code}</span>
          </div>
        )
      },
    },
    {
      id: "goodQty",
      accessorFn: (row) => row.goodQty,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="양품수량" />
      ),
      cell: ({ row }) => {
        const qty = row.getValue("goodQty") as number
        return (
          <span className="text-[14px] font-semibold text-green-700 block text-right">
            {formatQuantity(qty)}
          </span>
        )
      },
    },
    {
      id: "defectQty",
      accessorFn: (row) => row.defectQty,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="불량수량" />
      ),
      cell: ({ row }) => {
        const qty = row.getValue("defectQty") as number
        return (
          <span
            className={`text-[14px] font-semibold block text-right ${
              qty > 0 ? "text-red-600" : "text-muted-foreground"
            }`}
          >
            {formatQuantity(qty)}
          </span>
        )
      },
    },
    {
      id: "reworkQty",
      accessorFn: (row) => row.reworkQty,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="재작업수량" />
      ),
      cell: ({ row }) => {
        const qty = row.getValue("reworkQty") as number
        return (
          <span
            className={`text-[14px] font-semibold block text-right ${
              qty > 0 ? "text-amber-600" : "text-muted-foreground"
            }`}
          >
            {formatQuantity(qty)}
          </span>
        )
      },
    },
    {
      id: "operator",
      accessorFn: (row) => row.operator?.name ?? "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="작업자" />
      ),
      cell: ({ row }) => (
        <span className="text-[14px] whitespace-nowrap">
          {row.original.operator?.name ?? "-"}
        </span>
      ),
    },
    {
      id: "startedAt",
      accessorFn: (row) => row.startedAt,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="작업시작" />
      ),
      cell: ({ row }) => (
        <span className="text-[14px] text-muted-foreground whitespace-nowrap">
          {formatDateTime(row.original.startedAt)}
        </span>
      ),
    },
    {
      id: "endedAt",
      accessorFn: (row) => row.endedAt,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="작업종료" />
      ),
      cell: ({ row }) => (
        <span className="text-[14px] text-muted-foreground whitespace-nowrap">
          {formatDateTime(row.original.endedAt)}
        </span>
      ),
    },
    {
      id: "workDuration",
      accessorFn: (row) => row.workDurationMinutes ?? -1,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="작업시간" />
      ),
      cell: ({ row }) => (
        <span className="text-[14px] text-muted-foreground whitespace-nowrap">
          {formatDuration(row.original.workDurationMinutes)}
        </span>
      ),
    },
    {
      id: "operationStatus",
      accessorFn: (row) => row.workOrderOperation.status,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="공정상태" />
      ),
      cell: ({ row }) => {
        const status = row.original.workOrderOperation.status as OperationStatus
        const label = operationStatusLabels[status] ?? status

        if (status === "PENDING") {
          return (
            <Badge variant="secondary" className="text-[13px]">
              {label}
            </Badge>
          )
        }
        if (status === "IN_PROGRESS") {
          return (
            <Badge className="text-[13px] bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
              {label}
            </Badge>
          )
        }
        if (status === "COMPLETED") {
          return (
            <Badge className="text-[13px] bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
              {label}
            </Badge>
          )
        }
        // SKIPPED
        return (
          <Badge variant="outline" className="text-[13px]">
            {label}
          </Badge>
        )
      },
      filterFn: (row, id, filterValues: string[]) =>
        filterValues.includes(row.original.workOrderOperation.status),
    },
  ]
}
