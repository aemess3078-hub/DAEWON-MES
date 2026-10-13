"use client"

import Link from "next/link"
import { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal, Pencil, Trash2, XCircle } from "lucide-react"
import { PlanStatus, PlanType } from "@prisma/client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DataTableColumnHeader } from "@/components/common/data-table"
import { PlanWithDetails } from "@/lib/actions/production-plan.actions"
import { formatQuantity } from "@/lib/utils"
import { kstDaysUntil, toKstDateKey } from "@/lib/date/kst"

const planTypeLabels: Record<PlanType, string> = {
  DAILY: "일간",
  WEEKLY: "주간",
  MONTHLY: "월간",
}

const planStatusLabels: Record<PlanStatus, string> = {
  DRAFT: "초안",
  CONFIRMED: "확정",
  IN_PROGRESS: "진행중",
  COMPLETED: "완료",
  CANCELLED: "취소",
}

type GetColumnsProps = {
  onEdit: (plan: PlanWithDetails) => void
  onDelete: (plan: PlanWithDetails) => void
  onCancel: (plan: PlanWithDetails) => void
  onViewDetail: (plan: PlanWithDetails) => void
  canUpdate: boolean
  canDelete: boolean
}

function formatDate(date: Date): string {
  return toKstDateKey(date)
}

export function getColumns({ onEdit, onDelete, onCancel, onViewDetail, canUpdate, canDelete }: GetColumnsProps): ColumnDef<PlanWithDetails>[] {
  return [
    {
      accessorKey: "planNo",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="계획번호" />
      ),
      cell: ({ row }) => (
        <button
          className="font-mono font-medium text-[14px] text-primary underline-offset-4 hover:underline cursor-pointer"
          onClick={() => onViewDetail(row.original)}
        >
          {row.getValue("planNo")}
        </button>
      ),
    },
    {
      accessorKey: "planType",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="계획유형" />
      ),
      cell: ({ row }) => {
        const planType = row.getValue("planType") as PlanType
        if (planType === "DAILY") {
          return (
            <Badge variant="secondary" className="text-[13px]">
              {planTypeLabels[planType]}
            </Badge>
          )
        }
        if (planType === "WEEKLY") {
          return (
            <Badge variant="outline" className="text-[13px]">
              {planTypeLabels[planType]}
            </Badge>
          )
        }
        return (
          <Badge variant="default" className="text-[13px]">
            {planTypeLabels[planType]}
          </Badge>
        )
      },
      filterFn: (row, id, filterValues: string[]) =>
        filterValues.includes(row.getValue(id)),
    },
    {
      id: "siteName",
      accessorFn: (row) => row.site.name,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="공장" />
      ),
      cell: ({ row }) => (
        <span className="text-[14px]">{row.getValue("siteName")}</span>
      ),
    },
    {
      id: "period",
      accessorFn: (row) => `${formatDate(row.startDate)} ~ ${formatDate(row.endDate)}`,
      header: "기간",
      cell: ({ row }) => (
        <span className="text-[14px] text-muted-foreground">
          {row.getValue("period")}
        </span>
      ),
    },
    {
      id: "salesOrderBased",
      accessorFn: (row) => row.items.some((i) => i.salesOrderItemId != null),
      header: "유형",
      cell: ({ row }) => {
        const isSalesBased = row.getValue("salesOrderBased") as boolean
        return isSalesBased ? (
          <Badge className="text-[12px] bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50">
            수주기반
          </Badge>
        ) : (
          <span className="text-[13px] text-muted-foreground/60">—</span>
        )
      },
    },
    {
      id: "earliestDueDate",
      accessorFn: (row) => {
        // 수주 연결 품목에서 유효한 납기일을 수집 (품목별 > 수주 헤더 순)
        const dates = row.items
          .map((i) => i.salesOrderItem?.deliveryDate ?? i.salesOrderItem?.salesOrder.deliveryDate ?? null)
          .filter((d): d is Date => d != null)
        if (dates.length === 0) return null
        return dates.reduce((min, d) => (d < min ? d : min))
      },
      header: "고객 납기일",
      cell: ({ row }) => {
        const date = row.getValue("earliestDueDate") as Date | null
        if (!date) return <span className="text-[13px] text-muted-foreground/40">—</span>
        const formatted = toKstDateKey(date)
        const isOverdue = kstDaysUntil(date) < 0
        return (
          <span className={`text-[13px] tabular-nums ${isOverdue ? "text-red-600 font-medium" : "text-foreground"}`}>
            {formatted}
          </span>
        )
      },
    },
    {
      id: "itemCount",
      accessorFn: (row) => row.items.length,
      header: "품목 수",
      cell: ({ row }) => (
        <span className="text-[14px] text-muted-foreground">
          {row.getValue("itemCount")}건
        </span>
      ),
    },
    {
      id: "totalPlannedQty",
      accessorFn: (row) =>
        row.items.reduce((sum, item) => sum + Number(item.plannedQty), 0),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="총 계획수량" />
      ),
      cell: ({ row }) => (
        <span className="text-[14px] text-right block">
          {formatQuantity(row.getValue("totalPlannedQty") as number)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="상태" />
      ),
      cell: ({ row }) => {
        const status = row.getValue("status") as PlanStatus
        if (status === "DRAFT") {
          return (
            <Badge variant="secondary" className="text-[13px]">
              {planStatusLabels[status]}
            </Badge>
          )
        }
        if (status === "CONFIRMED") {
          return (
            <Badge variant="default" className="text-[13px]">
              {planStatusLabels[status]}
            </Badge>
          )
        }
        if (status === "IN_PROGRESS") {
          return (
            <Badge className="text-[13px] bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
              {planStatusLabels[status]}
            </Badge>
          )
        }
        if (status === "COMPLETED") {
          return (
            <Badge className="text-[13px] bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
              {planStatusLabels[status]}
            </Badge>
          )
        }
        return (
          <Badge variant="destructive" className="text-[13px]">
            {planStatusLabels[status]}
          </Badge>
        )
      },
      filterFn: (row, id, filterValues: string[]) =>
        filterValues.includes(row.getValue(id)),
    },
    {
      id: "nextWork",
      header: "다음 업무",
      cell: ({ row }) => {
        const plan = row.original
        const firstItem = plan.items[0]
        if (!firstItem || plan.status === "CANCELLED") return <span className="text-[13px] text-muted-foreground">—</span>
        return (
          <Button variant="outline" size="sm" className="h-7 text-[12px]" asChild>
            <Link
              href={`/app/mes/work-orders?productionPlanId=${encodeURIComponent(plan.id)}&productionPlanItemId=${encodeURIComponent(firstItem.id)}`}
            >
              작업지시
            </Link>
          </Button>
        )
      },
      enableSorting: false,
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const plan = row.original
        const status = plan.status
        const canEditPlan = canUpdate && status !== "CANCELLED"
        const canCancelPlan = canUpdate && (status === "DRAFT" || status === "CONFIRMED")
        const canDeletePlan = canDelete && status === "DRAFT"
        if (!canEditPlan && !canCancelPlan && !canDeletePlan) return null
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex h-8 w-8 p-0 data-[state=open]:bg-muted">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">메뉴 열기</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[150px]">
              <DropdownMenuLabel className="text-[13px]">작업</DropdownMenuLabel>
              {canEditPlan && (
                <DropdownMenuItem onClick={() => onEdit(plan)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  수정
                </DropdownMenuItem>
              )}
              {canCancelPlan && (
                <DropdownMenuItem onClick={() => onCancel(plan)} className="text-amber-700 focus:text-amber-700">
                  <XCircle className="mr-2 h-4 w-4" />
                  취소
                </DropdownMenuItem>
              )}
              {(canUpdate || canCancelPlan) && canDeletePlan && <DropdownMenuSeparator />}
              {canDeletePlan && (
                <DropdownMenuItem onClick={() => onDelete(plan)} className="text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  삭제
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]
}
