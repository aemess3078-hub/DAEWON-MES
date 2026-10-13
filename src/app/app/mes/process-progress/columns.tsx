"use client"

import { ColumnDef } from "@tanstack/react-table"
import { OperationStatus } from "@prisma/client"
import { AlertTriangle, Play, CheckCircle, Clock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTableColumnHeader } from "@/components/common/data-table"
import { OperationProgressRow } from "@/lib/actions/process-progress.actions"

const operationStatusLabels: Record<OperationStatus, string> = {
  PENDING: "대기",
  IN_PROGRESS: "진행중",
  COMPLETED: "완료",
  SKIPPED: "건너뜀",
}

function OperationStatusBadge({ status }: { status: OperationStatus }) {
  if (status === "PENDING")
    return (
      <Badge variant="outline" className="text-[13px] gap-1">
        <Clock className="h-3 w-3" />
        {operationStatusLabels[status]}
      </Badge>
    )
  if (status === "IN_PROGRESS")
    return (
      <Badge className="text-[13px] gap-1 bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
        <Play className="h-3 w-3" />
        {operationStatusLabels[status]}
      </Badge>
    )
  if (status === "COMPLETED")
    return (
      <Badge className="text-[13px] gap-1 bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
        <CheckCircle className="h-3 w-3" />
        {operationStatusLabels[status]}
      </Badge>
    )
  return (
    <Badge variant="secondary" className="text-[13px]">
      {operationStatusLabels[status]}
    </Badge>
  )
}

type GetColumnsProps = {
  onStatusChange: (op: OperationProgressRow, status: OperationStatus) => void
  onDefectDisposition: (op: OperationProgressRow) => void
}

export function getColumns({
  onStatusChange,
  onDefectDisposition,
}: GetColumnsProps): ColumnDef<OperationProgressRow>[] {
  return [
    {
      id: "orderNo",
      accessorFn: (row) => row.workOrder.orderNo,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="작업지시번호" />
      ),
      cell: ({ row }) => (
        <span className="font-mono font-medium text-[14px]">
          {row.original.workOrder.orderNo}
        </span>
      ),
    },
    {
      id: "itemName",
      accessorFn: (row) => row.workOrder.item.name,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="품목명" />
      ),
      cell: ({ row }) => (
        <div>
          <div className="text-[14px] font-medium">{row.original.workOrder.item.name}</div>
          <div className="text-[13px] text-muted-foreground">{row.original.workOrder.item.code}</div>
        </div>
      ),
    },
    {
      id: "operationName",
      accessorFn: (row) => row.routingOperation.name,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="공정명" />
      ),
      cell: ({ row }) => (
        <div>
          <div className="text-[14px]">
            <span className="text-muted-foreground mr-1.5">
              {row.original.seq}.
            </span>
            {row.original.routingOperation.name}
          </div>
          {row.original.routingOperation.workCenter && (
            <div className="text-[13px] text-muted-foreground">
              {row.original.routingOperation.workCenter.name}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "progress",
      header: "진도율",
      cell: ({ row }) => {
        const { completedQty, plannedQty } = row.original
        const pct = plannedQty > 0 ? Math.min((completedQty / plannedQty) * 100, 100) : 0
        return (
          <div className="w-32 space-y-1">
            <div className="flex justify-between text-[13px]">
              <span className="text-muted-foreground">
                {completedQty.toLocaleString()} / {plannedQty.toLocaleString()}
              </span>
              <span className="font-medium">{Math.round(pct)}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      },
    },
    {
      id: "defectQty",
      header: "불량/재작업",
      cell: ({ row }) => {
        const { totalDefectQty, totalReworkQty } = row.original
        if (totalDefectQty === 0) {
          return <span className="text-[14px] text-muted-foreground">-</span>
        }
        const scrapQty = totalDefectQty - totalReworkQty
        return (
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />
            <div className="text-[13px]">
              <span className="text-red-600 font-medium">{totalDefectQty}</span>
              {totalReworkQty > 0 && (
                <span className="text-muted-foreground">
                  {" "}(재작업 {totalReworkQty} / 폐기 {scrapQty})
                </span>
              )}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="상태" />
      ),
      cell: ({ row }) => <OperationStatusBadge status={row.original.status} />,
      filterFn: (row, id, filterValues: string[]) =>
        filterValues.includes(row.getValue(id)),
    },
    {
      id: "actions",
      header: "작업",
      cell: ({ row }) => {
        const op = row.original
        const hasUnprocessedDefects = op.productionResults.some(
          (r) => r.defectQty > 0
        )
        return (
          <div className="flex items-center gap-2">
            {op.status === "PENDING" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[13px] px-2"
                onClick={() => onStatusChange(op, "IN_PROGRESS")}
              >
                시작
              </Button>
            )}
            {op.status === "IN_PROGRESS" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[13px] px-2"
                onClick={() => onStatusChange(op, "COMPLETED")}
              >
                완료
              </Button>
            )}
            {hasUnprocessedDefects && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[13px] px-2 border-red-200 text-red-700 hover:bg-red-50"
                onClick={() => onDefectDisposition(op)}
              >
                부적합처리
              </Button>
            )}
          </div>
        )
      },
      enableSorting: false,
    },
  ]
}
