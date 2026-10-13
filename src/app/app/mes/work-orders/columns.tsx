"use client"

import Link from "next/link"
import { type ColumnDef } from "@tanstack/react-table"
import { type OperationStatus, type WorkOrderStatus } from "@prisma/client"
import { Boxes, ChevronDown, ChevronRight, ExternalLink, Layers, Package, Send, Wrench, type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTableColumnHeader } from "@/components/common/data-table"
import { DataTableRowActions } from "@/components/common/data-table"
import { type WorkOrderWithDetails } from "@/lib/actions/work-order.actions"
import { formatQty } from "./format-qty"
import { isLinkVisible } from "@/lib/auth/daewon-scope"

const operationStatusLabels: Record<string, string> = {
  PENDING: "대기",
  IN_PROGRESS: "진행중",
  COMPLETED: "완료",
  SKIPPED: "건너뜀",
}

const itemTypeBadge: Record<string, { label: string; className: string; Icon: LucideIcon }> = {
  FINISHED: { label: "완제품", className: "border-blue-200 bg-blue-50 text-blue-700", Icon: Package },
  SEMI_FINISHED: { label: "반제품", className: "border-purple-200 bg-purple-50 text-purple-700", Icon: Layers },
  RAW_MATERIAL: { label: "원자재", className: "border-slate-200 bg-slate-50 text-slate-600", Icon: Boxes },
  CONSUMABLE: { label: "소모품", className: "border-amber-200 bg-amber-50 text-amber-700", Icon: Wrench },
}

const workOrderStatusLabels: Record<WorkOrderStatus, string> = {
  DRAFT: "초안",
  RELEASED: "작업대기",
  IN_PROGRESS: "진행중",
  COMPLETED: "완료",
  CANCELLED: "취소",
}

const operationStatusPriority: Record<OperationStatus, number> = {
  IN_PROGRESS: 0,
  PENDING: 1,
  COMPLETED: 2,
  SKIPPED: 3,
}

type GetColumnsProps = {
  onEdit: (workOrder: WorkOrderWithDetails) => void
  onDelete: (workOrder: WorkOrderWithDetails) => void
  onRelease: (workOrder: WorkOrderWithDetails) => void
  canMutate: boolean
}

function displayProcessName(processName: string): string {
  return processName.includes("후처리") ? "후처리공정" : processName
}

/** expand 영역(사업장/지시일자)에서도 재사용하는 KST 안전 일시 포맷터. */
export function formatKstDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value))

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ""

  return `${getPart("year")}-${getPart("month")}-${getPart("day")} ${getPart("hour")}:${getPart("minute")}`
}

function getCurrentOperation(workOrder: WorkOrderWithDetails) {
  if (workOrder.operations.length === 0) return null

  return [...workOrder.operations].sort((a, b) => {
    const priorityDiff = operationStatusPriority[a.status] - operationStatusPriority[b.status]
    return priorityDiff !== 0 ? priorityDiff : a.seq - b.seq
  })[0]
}

function getCompletedQty(workOrder: WorkOrderWithDetails): number {
  if (workOrder.operations.length === 0) return 0

  const finalOperation = [...workOrder.operations].sort((a, b) => b.seq - a.seq)[0]
  return Number(finalOperation?.completedQty ?? 0)
}

function getOperationEquipmentLabel(
  operation: WorkOrderWithDetails["operations"][number]
): string {
  if (operation.assignments.length > 1) {
    return `${operation.assignments[0].equipment.name} 외 ${operation.assignments.length - 1}대`
  }
  if (operation.assignments.length === 1) {
    return operation.assignments[0].equipment.name
  }
  return operation.equipment?.name ?? "설비 미배정"
}

function getMaterialIssueStatus(workOrder: WorkOrderWithDetails): {
  label: string
  className: string
  detail: string
} {
  const issueCount = workOrder.materialLots.length
  if (issueCount > 0) {
    const totalQty = workOrder.materialLots.reduce((sum, lot) => sum + Number(lot.qty), 0)
    return {
      label: "투입됨",
      className: "border-green-200 bg-green-50 text-green-700",
      detail: `${issueCount}개 LOT / ${formatQty(totalQty)}`,
    }
  }

  return {
    label: "미투입",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    detail: "원자재 LOT 이력 없음",
  }
}

export function getColumns({ onEdit, onDelete, onRelease, canMutate }: GetColumnsProps): ColumnDef<WorkOrderWithDetails>[] {
  return [
    {
      id: "expand",
      header: "",
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={row.getIsExpanded() ? "상세 닫기" : "상세 열기"}
          onClick={(event) => {
            event.stopPropagation()
            row.toggleExpanded()
          }}
        >
          {row.getIsExpanded() ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      // 작업지시번호 + 제조번호 통합 컬럼.
      // 검색(searchableColumns)은 이 accessorFn이 반환하는 결합 문자열을 그대로 사용한다.
      id: "workOrderInfo",
      accessorFn: (row) => `${row.orderNo} ${row.manufacturingNo ?? ""}`.trim(),
      // 헤더에 보이는 값(orderNo, 동률이면 manufacturingNo) 그대로 정렬한다.
      // "WO-2026-10"이 "WO-2026-2"보다 앞에 오는 lexical 정렬 오류를 막기 위해
      // numeric:true natural compare를 사용한다.
      sortingFn: (rowA, rowB) => {
        const orderCompare = rowA.original.orderNo.localeCompare(
          rowB.original.orderNo,
          undefined,
          { numeric: true, sensitivity: "base" }
        )
        if (orderCompare !== 0) return orderCompare

        return (rowA.original.manufacturingNo ?? "").localeCompare(
          rowB.original.manufacturingNo ?? "",
          undefined,
          { numeric: true, sensitivity: "base" }
        )
      },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="작업지시 / 제조번호" />
      ),
      cell: ({ row }) => (
        <div>
          <span className="font-mono text-[14px] font-semibold">
            {row.original.orderNo}
          </span>
          {row.original.manufacturingNo ? (
            <div className="mt-0.5 whitespace-nowrap font-mono text-[13px] text-blue-700">
              {row.original.manufacturingNo}
            </div>
          ) : (
            <div className="mt-0.5 text-[13px] text-muted-foreground">-</div>
          )}
        </div>
      ),
    },
    {
      id: "itemName",
      accessorFn: (row) => row.item.name,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="품목명" />
      ),
      cell: ({ row }) => {
        const badge = itemTypeBadge[row.original.item.itemType]
        return (
          <div className="min-w-0 max-w-[190px] text-[14px]">
            <div className="flex min-w-0 items-start gap-2">
              <span className="min-w-0 line-clamp-2 break-keep font-medium">{row.original.item.name}</span>
              {badge && (
                <span className={`mt-0.5 inline-flex w-auto min-w-fit shrink-0 items-center gap-0.5 whitespace-nowrap break-keep rounded-full border px-1.5 py-0.5 text-[11px] font-medium leading-none ${badge.className}`}>
                  <badge.Icon className="h-2.5 w-2.5 shrink-0" />
                  {badge.label}
                </span>
              )}
            </div>
            <div className="truncate font-mono text-[13px] text-muted-foreground">{row.original.item.code}</div>
          </div>
        )
      },
    },
    {
      // 계획수량 + 완료수량 통합 컬럼.
      id: "qty",
      accessorFn: (row) => Number(row.plannedQty),
      sortingFn: (rowA, rowB) => Number(rowA.original.plannedQty) - Number(rowB.original.plannedQty),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="수량" />
      ),
      cell: ({ row }) => {
        const plannedQty = Number(row.original.plannedQty)
        const completedQty = getCompletedQty(row.original)
        return (
          <div className="min-w-[110px] text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">계획</span>
              <span className="tabular-nums text-[14px] font-medium">{formatQty(plannedQty)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">완료</span>
              <span className="tabular-nums text-[14px] font-medium">{formatQty(completedQty)}</span>
            </div>
          </div>
        )
      },
    },
    {
      id: "currentOperation",
      accessorFn: (row) => {
        const operation = getCurrentOperation(row)
        return operation ? displayProcessName(operation.routingOperation.name) : ""
      },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="현재 공정" />
      ),
      cell: ({ row }) => {
        const operation = getCurrentOperation(row.original)
        if (!operation) {
          return <span className="text-[13px] text-muted-foreground">공정 미생성</span>
        }

        const equipmentLabel = getOperationEquipmentLabel(operation)
        const statusLine = `${operationStatusLabels[operation.status] ?? operation.status} · ${equipmentLabel}`
        return (
          <div className="max-w-[150px] text-[13px]">
            <div className="truncate font-medium" title={`${operation.seq}. ${displayProcessName(operation.routingOperation.name)}`}>
              {operation.seq}. {displayProcessName(operation.routingOperation.name)}
            </div>
            <div className="truncate text-muted-foreground" title={statusLine}>
              {statusLine}
            </div>
          </div>
        )
      },
    },
    {
      id: "materialIssueStatus",
      accessorFn: (row) => row.materialLots.length,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="원자재 투입상태" />
      ),
      cell: ({ row }) => {
        const status = getMaterialIssueStatus(row.original)
        return (
          <div className="max-w-[140px]">
            <Badge variant="outline" className={`shrink-0 whitespace-nowrap text-[13px] ${status.className}`}>
              {status.label}
            </Badge>
            <div className="mt-1 truncate text-[12px] text-muted-foreground" title={status.detail}>{status.detail}</div>
          </div>
        )
      },
    },
    {
      id: "dueDate",
      accessorFn: (row) => row.dueDate,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="납기일" />
      ),
      cell: ({ row }) => {
        const dueDate = row.original.dueDate
        if (!dueDate) {
          return <span className="text-[14px] text-muted-foreground">-</span>
        }
        const date = new Date(dueDate)
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const isPast = date < today
        const formatted = date.toISOString().split("T")[0]
        return (
          <span className={`whitespace-nowrap text-[14px] ${isPast ? "font-medium text-red-600" : ""}`}>
            {formatted}
          </span>
        )
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="상태" />
      ),
      cell: ({ row }) => {
        const status = row.getValue("status") as WorkOrderStatus
        if (status === "DRAFT") {
          return (
            <Badge variant="secondary" className="whitespace-nowrap text-[13px]">
              {workOrderStatusLabels[status]}
            </Badge>
          )
        }
        if (status === "RELEASED") {
          return (
            <Badge variant="outline" className="whitespace-nowrap text-[13px]">
              {workOrderStatusLabels[status]}
            </Badge>
          )
        }
        if (status === "IN_PROGRESS") {
          return (
            <Badge className="whitespace-nowrap border-amber-200 bg-amber-100 text-[13px] text-amber-800 hover:bg-amber-100">
              {workOrderStatusLabels[status]}
            </Badge>
          )
        }
        if (status === "COMPLETED") {
          return (
            <Badge className="whitespace-nowrap border-green-200 bg-green-100 text-[13px] text-green-800 hover:bg-green-100">
              {workOrderStatusLabels[status]}
            </Badge>
          )
        }
        return (
          <Badge variant="destructive" className="whitespace-nowrap text-[13px]">
            {workOrderStatusLabels[status]}
          </Badge>
        )
      },
      filterFn: (row, id, filterValues: string[]) =>
        filterValues.includes(row.getValue(id)),
    },
    {
      // 추적성(조회) + 편집/삭제/릴리즈 통합 컬럼.
      // 조회는 읽기 전용이므로 VIEWER 역할에서도 항상 노출하고, 편집/삭제/릴리즈만 canMutate로 gating한다
      // (기존에는 "actions" 컬럼 전체를 canMutate로 필터링해 VIEWER가 조회 버튼도 못 보는 부작용이 있었음 —
      // 이번 통합에서 함께 바로잡는다).
      id: "actions",
      header: "작업",
      cell: ({ row }) => {
        const workOrder = row.original
        const manufacturingNo = workOrder.manufacturingNo
        const status = workOrder.status
        const canDelete = status === "DRAFT" || status === "RELEASED"
        const isDraft = status === "DRAFT"
        const currentOperation = getCurrentOperation(workOrder)
        const popHref = currentOperation
          ? `/pop/production/${encodeURIComponent(currentOperation.id)}${currentOperation.assignments[0]?.id ? `?assignmentId=${encodeURIComponent(currentOperation.assignments[0].id)}` : ""}`
          : null
        return (
          <div className="flex flex-wrap items-center gap-1">
            {manufacturingNo && isLinkVisible("/app/mes/manufacturing-traceability") ? (
              <Button asChild variant="outline" size="sm" className="h-8 gap-1 whitespace-nowrap px-2 text-[13px]">
                <Link href={`/app/mes/manufacturing-traceability?manufacturingNo=${encodeURIComponent(manufacturingNo)}`}>
                  조회
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : (
              <span className="px-1 text-[13px] text-muted-foreground">-</span>
            )}
            <Button asChild variant="outline" size="sm" className="h-8 whitespace-nowrap px-2 text-[13px]">
              <Link href={`/app/mes/material-issue?workOrderId=${encodeURIComponent(workOrder.id)}`}>
                자재
              </Link>
            </Button>
            {popHref && (
              <Button asChild variant="outline" size="sm" className="h-8 whitespace-nowrap px-2 text-[13px]">
                <Link href={popHref}>POP</Link>
              </Button>
            )}
            {currentOperation && isLinkVisible("/app/mes/inspection") && (
              <Button asChild variant="outline" size="sm" className="h-8 whitespace-nowrap px-2 text-[13px]">
                <Link href={`/app/mes/inspection?operationId=${encodeURIComponent(currentOperation.id)}&workOrderId=${encodeURIComponent(workOrder.id)}`}>
                  검사
                </Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm" className="h-8 whitespace-nowrap px-2 text-[13px]">
              <Link href={`/app/mes/finished-goods-receipt?workOrderId=${encodeURIComponent(workOrder.id)}`}>
                입고
              </Link>
            </Button>
            {canMutate && isDraft && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 whitespace-nowrap border-blue-200 px-2 text-[13px] text-blue-700 hover:bg-blue-50"
                aria-label="작업지시 내리기"
                onClick={(e) => { e.stopPropagation(); onRelease(row.original) }}
              >
                <Send className="h-3.5 w-3.5" />
                지시
              </Button>
            )}
            {canMutate && (
              <DataTableRowActions
                onEdit={() => onEdit(row.original)}
                onDelete={canDelete ? () => onDelete(row.original) : undefined}
              />
            )}
          </div>
        )
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]
}
