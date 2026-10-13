"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Pencil, Unlink, Power } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  type NcwatchMappingRow,
  toggleNcwatchMappingActive,
} from "@/lib/actions/equipment-integration.actions"

const STATUS_CONFIG = {
  MAPPED: { label: "매핑완료", className: "bg-emerald-100 text-emerald-800" },
  UNMAPPED: { label: "미매핑", className: "bg-amber-100 text-amber-800" },
  INACTIVE: { label: "비활성", className: "bg-slate-100 text-slate-700" },
} as const

function formatDateTime(value: Date | null) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

type ColumnActions = {
  canMutate: boolean
  onEdit: (row: NcwatchMappingRow) => void
  onUnmap: (row: NcwatchMappingRow) => void
  onRefresh: () => void
}

export function getNcwatchMappingColumns({
  canMutate,
  onEdit,
  onUnmap,
  onRefresh,
}: ColumnActions): ColumnDef<NcwatchMappingRow>[] {
  const columns: ColumnDef<NcwatchMappingRow>[] = [
    {
      accessorKey: "machineName",
      header: "수집 기계명",
      cell: ({ row }) => (
        <span className="font-mono text-[13px] font-medium">
          {row.original.machineName}
        </span>
      ),
    },
    {
      id: "equipment",
      header: "MES 설비",
      cell: ({ row }) => {
        const equipment = row.original.equipment
        if (!equipment) return <span className="text-[13px] text-muted-foreground">미매핑</span>
        return (
          <div>
            <span className="font-medium text-[14px]">{equipment.name}</span>
            <span className="ml-2 text-[13px] text-muted-foreground font-mono">
              {equipment.code}
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: "status",
      header: "매핑 상태",
      cell: ({ row }) => {
        const cfg = STATUS_CONFIG[row.original.status]
        return (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium ${cfg.className}`}>
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
      id: "received",
      header: "마지막 수신",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {formatDateTime(row.original.lastReceivedAt)}
        </span>
      ),
    },
    {
      id: "currentStatus",
      header: "현재 상태",
      cell: ({ row }) => {
        const { statusCode, statusLabel } = row.original
        if (statusCode == null && !statusLabel) return <span className="text-[13px] text-muted-foreground">-</span>
        return (
          <div className="text-[13px]">
            <span className="font-mono">{statusCode ?? "-"}</span>
            {statusLabel && <span className="ml-1 text-muted-foreground">{statusLabel}</span>}
          </div>
        )
      },
    },
    {
      id: "sync",
      header: "마지막 동기화",
      cell: ({ row }) => {
        const { lastSyncResult, lastSyncMessage, lastSyncAt } = row.original
        if (!lastSyncResult) return <span className="text-[13px] text-muted-foreground">-</span>
        return (
          <div className="max-w-[220px]">
            <div className="text-[13px] font-medium">{lastSyncResult}</div>
            <div className="truncate text-[12px] text-muted-foreground">
              {lastSyncMessage || formatDateTime(lastSyncAt)}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: "isActive",
      header: "사용",
      cell: ({ row }) => {
        const item = row.original
        if (!item.id) return <span className="text-[13px] text-muted-foreground">-</span>
        return (
          <Switch
            checked={item.isActive}
            disabled={!canMutate}
            onCheckedChange={async (checked) => {
              try {
                await toggleNcwatchMappingActive(item.id!, checked)
                onRefresh()
              } catch (error) {
                alert(error instanceof Error ? error.message : "사용 여부 변경 중 오류가 발생했습니다.")
              }
            }}
          />
        )
      },
    },
  ]

  if (!canMutate) return columns

  return [
    ...columns,
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const item = row.original
        return (
          <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover/row:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onEdit(item)}
              title="수정"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {item.id && item.equipmentId && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onUnmap(item)}
                title="매핑 해제"
              >
                <Unlink className="h-3.5 w-3.5" />
              </Button>
            )}
            {item.id && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={async () => {
                  try {
                    await toggleNcwatchMappingActive(item.id!, false)
                    onRefresh()
                  } catch (error) {
                    alert(error instanceof Error ? error.message : "비활성화 중 오류가 발생했습니다.")
                  }
                }}
                title="비활성화"
              >
                <Power className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )
      },
    },
  ]
}
