"use client"

import { ColumnDef } from "@tanstack/react-table"
import { ShipmentStatus } from "@prisma/client"
import { format } from "date-fns"

import { DataTableColumnHeader } from "@/components/common/data-table"
import { Badge } from "@/components/ui/badge"
import type { DeliveryStatusRow } from "@/lib/actions/shipment.actions"
import { formatQuantity } from "@/lib/utils"

const STATUS_CONFIG: Record<
  ShipmentStatus,
  { label: string; className: string }
> = {
  PLANNED: {
    label: "출하예정",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  },
  PICKED: {
    label: "피킹완료",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  SHIPPED: {
    label: "출하완료",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  DELIVERED: {
    label: "배송완료",
    className: "border-teal-200 bg-teal-50 text-teal-700",
  },
  CANCELLED: {
    label: "취소",
    className: "border-red-200 bg-red-50 text-red-700",
  },
}

const CLOSED_STATUSES: ShipmentStatus[] = ["SHIPPED", "DELIVERED", "CANCELLED"]

export function getColumns(): ColumnDef<DeliveryStatusRow>[] {
  return [
    {
      accessorKey: "shipmentNo",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="출하번호" />
      ),
      cell: ({ row }) => (
        <span className="font-mono text-[13px] font-medium text-primary">
          {row.original.shipmentNo}
        </span>
      ),
    },
    {
      id: "orderNo",
      accessorFn: (row) => row.salesOrder.orderNo,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="수주번호" />
      ),
      cell: ({ row }) => (
        <span className="font-mono text-[13px] text-muted-foreground">
          {row.original.salesOrder.orderNo}
        </span>
      ),
    },
    {
      id: "customerName",
      accessorFn: (row) => row.salesOrder.customer.name,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="거래처" />
      ),
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <p className="text-[14px] font-medium text-foreground">
            {row.original.salesOrder.customer.name}
          </p>
          <p className="font-mono text-[13px] text-muted-foreground">
            {row.original.salesOrder.customer.code}
          </p>
        </div>
      ),
    },
    {
      id: "shipmentDate",
      accessorFn: (row) => getDisplayShipmentDate(row).getTime(),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="출하/납품일" />
      ),
      cell: ({ row }) => {
        const date = getDisplayShipmentDate(row.original)
        const sourceLabel = row.original.deliveredDate
          ? "납품"
          : row.original.shippedDate
            ? "출하"
            : "예정"

        return (
          <div className="space-y-0.5">
            <p className="text-[13px] font-medium text-foreground">
              {format(date, "yyyy-MM-dd")}
            </p>
            <p className="text-[13px] text-muted-foreground">{sourceLabel}</p>
          </div>
        )
      },
    },
    {
      id: "deliveryDate",
      accessorFn: (row) => new Date(row.salesOrder.deliveryDate).getTime(),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="납기일" />
      ),
      cell: ({ row }) => {
        const dueState = getDueState(row.original)
        return (
          <div className="flex items-center gap-2">
            <span
              className={`text-[13px] font-medium ${
                dueState === "overdue"
                  ? "text-red-600"
                  : dueState === "soon"
                    ? "text-amber-600"
                    : "text-muted-foreground"
              }`}
            >
              {format(new Date(row.original.salesOrder.deliveryDate), "yyyy-MM-dd")}
            </span>
            <DueBadge state={dueState} />
          </div>
        )
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="상태" />
      ),
      cell: ({ row }) => {
        const config = STATUS_CONFIG[row.original.status]
        return (
          <Badge variant="outline" className={`text-[12px] ${config.className}`}>
            {config.label}
          </Badge>
        )
      },
      filterFn: (row, _id, filterValues: string[]) =>
        filterValues.includes(row.original.status),
    },
    {
      id: "itemSummary",
      accessorFn: (row) => {
        const firstItem = row.items[0]?.item ?? row.salesOrder.items[0]?.item
        return firstItem ? `${firstItem.code} ${firstItem.name}` : ""
      },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="대표 품목" />
      ),
      cell: ({ row }) => {
        const items = row.original.items.length > 0
          ? row.original.items
          : row.original.salesOrder.items
        const firstItem = items[0]?.item
        if (!firstItem) {
          return <span className="text-[13px] text-muted-foreground">-</span>
        }

        const extraCount = items.length - 1
        return (
          <div className="space-y-0.5">
            <p className="text-[14px] font-medium text-foreground">
              {firstItem.name}
              {extraCount > 0 ? (
                <span className="ml-1 text-[13px] text-muted-foreground">
                  외 {formatQuantity(extraCount)}건
                </span>
              ) : null}
            </p>
            <p className="font-mono text-[13px] text-muted-foreground">
              {firstItem.code}
            </p>
          </div>
        )
      },
    },
    {
      id: "orderedQty",
      accessorFn: (row) => getQuantitySummary(row).orderedQty,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="수주수량" />
      ),
      cell: ({ row }) => (
        <QuantityCell value={getQuantitySummary(row.original).orderedQty} />
      ),
    },
    {
      id: "shippedQty",
      accessorFn: (row) => getQuantitySummary(row).shipmentQty,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="출하수량" />
      ),
      cell: ({ row }) => (
        <QuantityCell value={getQuantitySummary(row.original).shipmentQty} />
      ),
    },
    {
      id: "remainingQty",
      accessorFn: (row) => getQuantitySummary(row).remainingQty,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="미납품수량" />
      ),
      cell: ({ row }) => {
        const summary = getQuantitySummary(row.original)
        const hasDataIssue = summary.rawRemainingQty < 0
        return (
          <div className="space-y-1 text-right">
            <span
              className={`block text-[14px] font-medium tabular-nums ${
                summary.remainingQty > 0 ? "text-amber-700" : "text-emerald-700"
              }`}
            >
              {formatQuantity(summary.remainingQty)}
            </span>
            {hasDataIssue ? (
              <Badge variant="outline" className="border-red-200 bg-red-50 text-[12px] text-red-700">
                수량 확인
              </Badge>
            ) : null}
          </div>
        )
      },
    },
    {
      id: "dueState",
      accessorFn: (row) => getDueState(row),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="납기 상태" />
      ),
      cell: ({ row }) => <DueBadge state={getDueState(row.original)} />,
    },
  ]
}

function QuantityCell({ value }: { value: number }) {
  return (
    <span className="block text-right text-[14px] tabular-nums">
      {formatQuantity(value)}
    </span>
  )
}

function DueBadge({ state }: { state: "completed" | "overdue" | "soon" | "normal" }) {
  if (state === "completed") {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[12px] text-emerald-700">
        완료
      </Badge>
    )
  }
  if (state === "overdue") {
    return (
      <Badge variant="outline" className="border-red-200 bg-red-50 text-[12px] text-red-700">
        지연
      </Badge>
    )
  }
  if (state === "soon") {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[12px] text-amber-700">
        임박
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[12px] text-slate-700">
      정상
    </Badge>
  )
}

function getQuantitySummary(delivery: DeliveryStatusRow) {
  const orderedQty = delivery.salesOrder.items.reduce(
    (sum, item) => sum + Number(item.qty),
    0
  )
  const shippedQty = delivery.salesOrder.items.reduce(
    (sum, item) => sum + Number(item.shippedQty),
    0
  )
  const shipmentQty = delivery.items.reduce(
    (sum, item) => sum + Number(item.qty),
    0
  )
  const rawRemainingQty = orderedQty - shippedQty

  return {
    orderedQty,
    shippedQty,
    shipmentQty,
    rawRemainingQty,
    remainingQty: Math.max(0, rawRemainingQty),
  }
}

function getDisplayShipmentDate(delivery: DeliveryStatusRow) {
  return new Date(delivery.deliveredDate ?? delivery.shippedDate ?? delivery.plannedDate)
}

function getDueState(delivery: DeliveryStatusRow) {
  if (CLOSED_STATUSES.includes(delivery.status)) return "completed"

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const deliveryDate = new Date(delivery.salesOrder.deliveryDate)
  deliveryDate.setHours(0, 0, 0, 0)

  const daysUntilDue = Math.ceil(
    (deliveryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  )

  if (daysUntilDue < 0) return "overdue"
  if (daysUntilDue <= 7) return "soon"
  return "normal"
}
