"use client"

import { useState } from "react"
import { ColumnDef } from "@tanstack/react-table"
import { Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/common/data-table"
import { DataTableColumnHeader } from "@/components/common/data-table"
import { ReworkRow } from "@/lib/actions/process-progress.actions"
import { ReworkCompleteDialog } from "./rework-complete-dialog"

interface ReworkDataTableProps {
  data: ReworkRow[]
}

export function ReworkDataTable({ data }: ReworkDataTableProps) {
  const [target, setTarget] = useState<ReworkRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const columns: ColumnDef<ReworkRow>[] = [
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
          <div className="text-[13px] text-muted-foreground">
            {row.original.workOrder.item.code}
          </div>
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
              {row.original.routingOperation.seq}.
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
      id: "manufacturingNo",
      header: "제조번호",
      cell: ({ row }) => (
        <span className="font-mono text-[13px] text-muted-foreground">
          {row.original.manufacturingNo ?? "-"}
        </span>
      ),
    },
    {
      id: "reworkQty",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="재작업 수량" />
      ),
      accessorFn: (row) => row.reworkQty,
      cell: ({ row }) => (
        <div>
          <Badge className="text-[13px] bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
            {row.original.reworkQty}개
          </Badge>
          <div className="mt-1 text-[13px] text-muted-foreground">
            원 재공품 {row.original.parentWipUnit?.qty ?? "-"}개
          </div>
        </div>
      ),
    },
    {
      id: "resolution",
      header: "처리 가능 여부",
      cell: ({ row }) =>
        row.original.canComplete ? (
          <Badge className="text-[13px] bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
            최종공정 종결 가능
          </Badge>
        ) : (
          <div>
            <Badge className="text-[13px] bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100">
              종결불가
            </Badge>
            <div className="mt-1 max-w-48 text-[13px] text-muted-foreground">
              {row.original.blockedReason}
            </div>
          </div>
        ),
    },
    {
      id: "startedAt",
      header: "발생일시",
      cell: ({ row }) => {
        const d = row.original.startedAt
        if (!d) return <span className="text-[14px] text-muted-foreground">-</span>
        return (
          <span className="text-[14px] text-muted-foreground">
            {d.toLocaleString("ko-KR", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )
      },
    },
    {
      id: "actions",
      header: "작업",
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[13px] px-2 gap-1"
          disabled={!row.original.canComplete}
          onClick={() => {
            setTarget(row.original)
            setDialogOpen(true)
          }}
        >
          <Wrench className="h-3 w-3" />
          {row.original.canComplete ? "완료처리" : "처리불가"}
        </Button>
      ),
      enableSorting: false,
    },
  ]

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        searchableColumns={[
          { id: "orderNo" as keyof ReworkRow, title: "작업지시번호" },
          { id: "itemName" as keyof ReworkRow, title: "품목명" },
        ]}
      />

      <ReworkCompleteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        reworkItem={target}
      />
    </>
  )
}
