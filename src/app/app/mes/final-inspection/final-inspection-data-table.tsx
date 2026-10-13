"use client"

import Link from "next/link"
import { ColumnDef } from "@tanstack/react-table"
import { CheckCircle2, AlertCircle, Clock, ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { DataTableColumnHeader } from "@/components/common/data-table"
import { WorkOrderForReceipt } from "@/lib/actions/finished-goods.actions"

const INSPECTION_CONFIG = {
  PASS: {
    label: "합격",
    className: "bg-green-100 text-green-800 border-green-200",
    icon: CheckCircle2,
  },
  FAIL: {
    label: "불합격",
    className: "bg-red-100 text-red-800 border-red-200",
    icon: AlertCircle,
  },
  CONDITIONAL: {
    label: "조건부",
    className: "bg-amber-100 text-amber-800 border-amber-200",
    icon: AlertCircle,
  },
  NOT_INSPECTED: {
    label: "미검사",
    className: "bg-slate-100 text-slate-700 border-slate-200",
    icon: Clock,
  },
} as const

interface FinalInspectionDataTableProps {
  data: WorkOrderForReceipt[]
}

export function FinalInspectionDataTable({ data }: FinalInspectionDataTableProps) {
  const columns: ColumnDef<WorkOrderForReceipt>[] = [
    {
      id: "orderNo",
      accessorFn: (row) => row.orderNo,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="작업지시번호" />
      ),
      cell: ({ row }) => (
        <span className="font-mono font-medium text-[14px]">{row.original.orderNo}</span>
      ),
    },
    {
      id: "itemName",
      accessorFn: (row) => row.item.name,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="품목명" />
      ),
      cell: ({ row }) => (
        <div>
          <div className="text-[14px] font-medium">{row.original.item.name}</div>
          <div className="text-[13px] text-muted-foreground font-mono">
            {row.original.item.code}
          </div>
        </div>
      ),
    },
    {
      id: "goodQty",
      header: "양품 수량",
      cell: ({ row }) => (
        <span className="text-[14px]">
          {row.original.totalGoodQty.toLocaleString()}{" "}
          <span className="text-muted-foreground text-[13px]">{row.original.item.uom}</span>
        </span>
      ),
    },
    {
      id: "dueDate",
      header: "납기일",
      cell: ({ row }) => {
        const d = row.original.dueDate
        if (!d) return <span className="text-[14px] text-muted-foreground">-</span>
        const date = new Date(d)
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        return (
          <span
            className={`text-[14px] ${date < today ? "text-red-600 font-medium" : "text-muted-foreground"}`}
          >
            {date.toISOString().split("T")[0]}
          </span>
        )
      },
    },
    {
      id: "inspectionResult",
      header: "최종검사 결과",
      cell: ({ row }) => {
        const release = row.original.qualityRelease
        if (!release.requiresInspection) {
          return (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[13px] text-muted-foreground">검사비대상</span>
            </div>
          )
        }
        const result = release.inspectionStatus === "NOT_REQUIRED"
          ? "NOT_INSPECTED"
          : release.inspectionStatus
        const cfg = INSPECTION_CONFIG[result]
        const Icon = cfg.icon
        return (
          <Badge variant="outline" className={`text-[13px] gap-1 ${cfg.className}`}>
            <Icon className="h-3 w-3" />
            {cfg.label}
          </Badge>
        )
      },
    },
    {
      id: "receiptStatus",
      header: "입고 현황",
      cell: ({ row }) => {
        const { totalReceiptQty, pendingQty } = row.original
        if (pendingQty === 0 && totalReceiptQty > 0) {
          return (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              <span className="text-[13px] text-green-700 font-medium">입고 완료</span>
            </div>
          )
        }
        if (totalReceiptQty > 0) {
          return (
            <span className="text-[13px] text-amber-700">부분 입고 ({totalReceiptQty})</span>
          )
        }
        return <span className="text-[13px] text-muted-foreground">미입고</span>
      },
    },
    {
      id: "actions",
      header: "작업",
      cell: ({ row }) => {
        const wo = row.original
        return (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[13px] px-2 gap-1"
              asChild
            >
              <Link href="/app/mes/inspection-stages">
                <ExternalLink className="h-3 w-3" />
                검사 등록
              </Link>
            </Button>
            {wo.pendingQty > 0 && (!wo.qualityRelease.requiresInspection || wo.qualityRelease.inspectionResult === "PASS") && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[13px] px-2 gap-1 border-green-200 text-green-700 hover:bg-green-50"
                asChild
              >
                <Link href="/app/mes/finished-goods-receipt">
                  입고 처리
                </Link>
              </Button>
            )}
          </div>
        )
      },
      enableSorting: false,
    },
  ]

  return (
    <DataTable
      columns={columns}
      data={data}
      searchableColumns={[
        { id: "orderNo" as keyof WorkOrderForReceipt, title: "작업지시번호" },
        { id: "itemName" as keyof WorkOrderForReceipt, title: "품목명" },
      ]}
    />
  )
}
