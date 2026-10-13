"use client"

import { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import { Trash2, Eye } from "lucide-react"

import { Button } from "@/components/ui/button"
import { QualityInspectionWithDetails } from "@/lib/actions/quality.actions"
import { formatQuantity } from "@/lib/utils"

// ─── 결과 배지 설정 ───────────────────────────────────────────────────────────

const RESULT_CONFIG: Record<string, { label: string; className: string }> = {
  PASS:        { label: "합격",    className: "bg-green-100 text-green-800" },
  FAIL:        { label: "불합격",  className: "bg-red-100 text-red-800" },
  CONDITIONAL: { label: "조건부",  className: "bg-amber-100 text-amber-800" },
}

// ─── 컬럼 정의 ───────────────────────────────────────────────────────────────

type ColumnActions = {
  onView: (row: QualityInspectionWithDetails) => void
  onDelete: (row: QualityInspectionWithDetails) => void
}

export function getInspectionColumns({
  onView,
  onDelete,
}: ColumnActions): ColumnDef<QualityInspectionWithDetails>[] {
  return [
    {
      accessorKey: "inspectedAt",
      header: "검사일시",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground font-mono">
          {format(new Date(row.original.inspectedAt), "yyyy-MM-dd HH:mm")}
        </span>
      ),
    },
    {
      id: "orderNo",
      header: "작업지시번호",
      cell: ({ row }) => {
        const workOrder = row.original.workOrderOperation.workOrder
        return (
          <div>
            <p className="font-mono text-[13px]">{workOrder.orderNo}</p>
            {workOrder.manufacturingNo && (
              <p className="font-mono text-[12px] text-blue-700">{workOrder.manufacturingNo}</p>
            )}
          </div>
        )
      },
    },
    {
      id: "itemName",
      header: "품목",
      cell: ({ row }) => {
        const wo = row.original.workOrderOperation.workOrder
        return (
          <div>
            <p className="text-[14px] font-medium">{wo.item.name}</p>
            <p className="text-[12px] text-muted-foreground font-mono">{wo.item.code}</p>
          </div>
        )
      },
    },
    {
      id: "operationName",
      header: "공정",
      cell: ({ row }) => (
        <span className="text-[14px]">
          {row.original.workOrderOperation.routingOperation.name}
        </span>
      ),
    },
    {
      accessorKey: "inspectedQty",
      header: () => <div className="text-right">검사수량</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-[14px]">
          {formatQuantity(Number(row.original.inspectedQty))}
        </div>
      ),
    },
    {
      accessorKey: "result",
      header: "판정",
      cell: ({ row }) => {
        const result = row.original.result
        if (!result) {
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium bg-slate-100 text-slate-500">
              미판정
            </span>
          )
        }
        const cfg = RESULT_CONFIG[result]
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium ${
              cfg?.className ?? "bg-gray-100 text-gray-600"
            }`}
          >
            {cfg?.label ?? result}
          </span>
        )
      },
      filterFn: (row, _, filterValue: string[]) => {
        if (!filterValue?.length) return true
        const result = row.original.result ?? "NONE"
        return filterValue.includes(result)
      },
    },
    {
      id: "defectCount",
      header: () => <div className="text-right">불량건수</div>,
      cell: ({ row }) => {
        const count = row.original.defectRecords.length
        return (
          <div className="text-right">
            {count > 0 ? (
              <span className="text-[13px] font-medium text-red-600">{count}건</span>
            ) : (
              <span className="text-[13px] text-muted-foreground">—</span>
            )}
          </div>
        )
      },
    },
    {
      id: "inspector",
      header: "검사자",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {row.original.inspector.name}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const item = row.original
        return (
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[13px] text-blue-600 hover:text-blue-700"
              onClick={() => onView(item)}
            >
              <Eye className="h-3.5 w-3.5 mr-1" />
              상세
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => onDelete(item)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )
      },
    },
  ]
}

export { RESULT_CONFIG }
