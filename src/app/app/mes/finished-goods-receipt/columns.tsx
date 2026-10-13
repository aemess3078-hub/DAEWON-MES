"use client"

import { ColumnDef } from "@tanstack/react-table"
import { CheckCircle2, AlertCircle, Clock, PackagePlus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTableColumnHeader } from "@/components/common/data-table"
import { WorkOrderForReceipt } from "@/lib/actions/finished-goods.actions"
import { formatQuantity } from "@/lib/utils"

const INSPECTION_CONFIG = {
  PASS: { label: "합격", className: "bg-green-100 text-green-800 border-green-200", icon: CheckCircle2 },
  FAIL: { label: "불합격", className: "bg-red-100 text-red-800 border-red-200", icon: AlertCircle },
  CONDITIONAL: { label: "조건부", className: "bg-amber-100 text-amber-800 border-amber-200", icon: AlertCircle },
  NOT_INSPECTED: { label: "미검사", className: "bg-slate-100 text-slate-700 border-slate-200", icon: Clock },
} as const

type GetColumnsProps = {
  onReceipt: (wo: WorkOrderForReceipt) => void
}

export function getColumns({ onReceipt }: GetColumnsProps): ColumnDef<WorkOrderForReceipt>[] {
  return [
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
      id: "plannedQty",
      header: "계획/입고 기준",
      cell: ({ row }) => {
        const { plannedQty, receiptBasisQty, isWipTracked, item } = row.original
        return (
          <div>
            <div className="text-[14px]">
              <span className="text-muted-foreground">{formatQuantity(plannedQty)}</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="font-medium">{formatQuantity(receiptBasisQty)}</span>
              <span className="text-[13px] text-muted-foreground ml-1">{item.uom}</span>
            </div>
            <div className="text-[13px] text-muted-foreground">
              {isWipTracked ? "완료 재공품 기준" : "최종공정 기준"}
            </div>
          </div>
        )
      },
    },
    {
      id: "receiptQty",
      header: "입고현황",
      cell: ({ row }) => {
        const { totalReceiptQty, receiptBasisQty, pendingQty, receiptBlockedReason, item } = row.original
        if (receiptBlockedReason) {
          return (
            <div className="text-[13px] font-medium text-amber-700">
              {receiptBlockedReason}
            </div>
          )
        }
        if (pendingQty === 0 && totalReceiptQty > 0) {
          return (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              <span className="text-[14px] text-green-700 font-medium">
                {formatQuantity(totalReceiptQty)} {item.uom} 입고 완료
              </span>
            </div>
          )
        }
        if (totalReceiptQty > 0) {
          return (
            <div className="text-[14px]">
              <span className="text-muted-foreground">{formatQuantity(totalReceiptQty)}</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="font-medium text-amber-700">{formatQuantity(pendingQty)} 대기</span>
              <span className="text-[13px] text-muted-foreground ml-1">{item.uom}</span>
            </div>
          )
        }
        return (
          <span className="text-[14px] text-muted-foreground">
            {receiptBasisQty > 0 ? `${formatQuantity(receiptBasisQty)} ${item.uom} 대기` : "-"}
          </span>
        )
      },
    },
    {
      id: "inspectionResult",
      header: "검사결과",
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
      id: "actions",
      header: "작업",
      cell: ({ row }) => {
        const wo = row.original
        if (wo.pendingQty <= 0) return null
        const qualityBlocked = wo.qualityRelease.requiresInspection &&
          wo.qualityRelease.inspectionResult !== "PASS"
        return (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[13px] px-2 gap-1 border-green-200 text-green-700 hover:bg-green-50"
            onClick={() => onReceipt(wo)}
            disabled={qualityBlocked}
            title={qualityBlocked ? (wo.qualityRelease.inspectionResult === "FAIL"
              ? "최종검사 불합격 제품은 입고할 수 없습니다."
              : "최종검사를 완료한 후 완제품을 입고할 수 있습니다.") : undefined}
          >
            <PackagePlus className="h-3.5 w-3.5" />
            입고처리
          </Button>
        )
      },
      enableSorting: false,
    },
  ]
}
