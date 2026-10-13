"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Pencil, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  EquipmentConnectionRow,
  toggleConnectionActive,
} from "@/lib/actions/equipment-integration.actions"
import { ConnectionProtocol } from "@prisma/client"

// ─── 프로토콜 설정 ────────────────────────────────────────────────────────────

export const PROTOCOL_CONFIG: Record<ConnectionProtocol, { label: string; className: string }> = {
  MODBUS_TCP:    { label: "Modbus TCP",    className: "bg-blue-100 text-blue-800" },
  OPC_UA:        { label: "OPC-UA",        className: "bg-purple-100 text-purple-800" },
  MQTT:          { label: "MQTT",          className: "bg-green-100 text-green-800" },
  MC_PROTOCOL:   { label: "MC Protocol",   className: "bg-amber-100 text-amber-800" },
  S7:            { label: "S7",            className: "bg-orange-100 text-orange-800" },
  FOCAS:         { label: "FOCAS",         className: "bg-cyan-100 text-cyan-800" },
  CUSTOM:        { label: "Custom",        className: "bg-gray-100 text-gray-700" },
  NCWATCH_AGENT: { label: "NCWatch Agent", className: "bg-teal-100 text-teal-800" },
}

// ─── 컬럼 정의 ───────────────────────────────────────────────────────────────

type ColumnActions = {
  onEdit: (row: EquipmentConnectionRow) => void
  onDelete: (row: EquipmentConnectionRow) => void
  onRefresh: () => void
}

export function getConnectionColumns({
  onEdit,
  onDelete,
  onRefresh,
}: ColumnActions): ColumnDef<EquipmentConnectionRow>[] {
  return [
    {
      id: "equipment",
      header: "설비명",
      cell: ({ row }) => (
        <div>
          <span className="font-medium text-[14px]">{row.original.equipment.name}</span>
          <span className="ml-2 text-[13px] text-muted-foreground font-mono">
            {row.original.equipment.code}
          </span>
        </div>
      ),
    },
    {
      id: "gateway",
      header: "게이트웨이",
      cell: ({ row }) => (
        <span className="text-[14px] text-muted-foreground">
          {row.original.gateway.name}
        </span>
      ),
    },
    {
      accessorKey: "protocol",
      header: "프로토콜",
      cell: ({ row }) => {
        const cfg = PROTOCOL_CONFIG[row.original.protocol]
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
        return filterValue.includes(row.original.protocol)
      },
    },
    {
      id: "hostPort",
      header: "호스트:포트",
      cell: ({ row }) => {
        const { host, port } = row.original
        if (!host) return <span className="text-[13px] text-muted-foreground">-</span>
        return (
          <span className="font-mono text-[13px]">
            {host}{port ? `:${port}` : ""}
          </span>
        )
      },
    },
    {
      id: "tagCount",
      header: "태그 수",
      cell: ({ row }) => (
        <span className="text-[14px] tabular-nums">{row.original._count.tags}개</span>
      ),
    },
    {
      accessorKey: "isActive",
      header: "활성",
      cell: ({ row }) => {
        const item = row.original
        return (
          <Switch
            checked={item.isActive}
            onCheckedChange={async (checked) => {
              try {
                await toggleConnectionActive(item.id, checked)
                onRefresh()
              } catch {
                alert("상태 변경 중 오류가 발생했습니다.")
              }
            }}
          />
        )
      },
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
