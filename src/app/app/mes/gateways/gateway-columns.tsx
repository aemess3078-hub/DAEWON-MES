"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Pencil, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { EdgeGatewayRow } from "@/lib/actions/equipment-integration.actions"
import { GatewayStatus } from "@prisma/client"
import { formatQuantity } from "@/lib/utils"

// ─── 상태 설정 ────────────────────────────────────────────────────────────────

export const GATEWAY_STATUS_CONFIG: Record<
  GatewayStatus,
  { label: string; className: string }
> = {
  ONLINE:  { label: "온라인",  className: "bg-green-100 text-green-800" },
  OFFLINE: { label: "오프라인", className: "bg-gray-100 text-gray-600" },
  ERROR:   { label: "오류",    className: "bg-red-100 text-red-700" },
}

// ─── 컬럼 정의 ───────────────────────────────────────────────────────────────

type ColumnActions = {
  onEdit: (row: EdgeGatewayRow) => void
  onDelete: (row: EdgeGatewayRow) => void
}

export function getGatewayColumns({
  onEdit,
  onDelete,
}: ColumnActions): ColumnDef<EdgeGatewayRow>[] {
  return [
    {
      accessorKey: "name",
      header: "이름",
      cell: ({ row }) => (
        <span className="font-medium text-[14px]">{row.original.name}</span>
      ),
    },
    {
      id: "site",
      header: "공장",
      cell: ({ row }) => (
        <span className="text-[14px] text-muted-foreground">
          {row.original.site.name}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "상태",
      cell: ({ row }) => {
        const cfg = GATEWAY_STATUS_CONFIG[row.original.status]
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium ${cfg.className}`}
          >
            {cfg.label}
          </span>
        )
      },
      filterFn: (row, _, filterValue: string[]) => {
        if (!filterValue?.length) return true
        return filterValue.includes(row.original.status)
      },
    },
    {
      id: "lastHeartbeat",
      header: "마지막 통신",
      cell: ({ row }) => {
        const hb = row.original.lastHeartbeat
        if (!hb) return <span className="text-[13px] text-muted-foreground">-</span>
        return (
          <span className="text-[13px] text-muted-foreground">
            {new Date(hb).toLocaleString("ko-KR", {
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
      id: "connectionCount",
      header: "연결 설비",
      cell: ({ row }) => (
        <span className="text-[14px] tabular-nums">
          {formatQuantity(row.original._count.connections)}건
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
              size="icon"
              className="h-7 w-7"
              onClick={() => onEdit(item)}
            >
              <Pencil className="h-3.5 w-3.5" />
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
