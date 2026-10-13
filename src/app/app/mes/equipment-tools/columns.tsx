"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatQuantity } from "@/lib/utils"
import type { ToolRow } from "@/lib/actions/tool.actions"

export type { ToolRow }

export const TYPE_LABEL: Record<ToolRow["equipmentType"], string> = {
  TOOL: "공구",
  JIG: "지그",
  FIXTURE: "고정구",
}

export const STATUS_CONFIG: Record<ToolRow["status"], { label: string; className: string }> = {
  ACTIVE:      { label: "사용가능", className: "bg-green-100 text-green-800" },
  INACTIVE:    { label: "보관중",   className: "bg-slate-100 text-slate-700" },
  MAINTENANCE: { label: "수리중",   className: "bg-amber-100 text-amber-800" },
  DISCARDED:   { label: "폐기",     className: "bg-red-100 text-red-700" },
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}

export function getColumns(onViewDetail: (row: ToolRow) => void): ColumnDef<ToolRow>[] {
  return [
    {
      accessorKey: "code",
      header: "공구번호",
      cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.code}</span>,
    },
    {
      accessorKey: "name",
      header: "공구명",
      cell: ({ row }) => <span className="text-[14px] font-medium">{row.original.name}</span>,
    },
    {
      id: "equipmentType",
      accessorFn: (row) => TYPE_LABEL[row.equipmentType] ?? row.equipmentType,
      header: "유형",
      cell: ({ row }) => <span className="text-[13px]">{TYPE_LABEL[row.original.equipmentType]}</span>,
    },
    {
      id: "appliedItems",
      accessorFn: (row) => row.appliedItems.map((i) => `${i.code} ${i.name}`).join(" "),
      header: "적용품목",
      cell: ({ row }) => {
        const items = row.original.appliedItems
        if (items.length === 0) return <span className="text-[13px] text-muted-foreground">-</span>
        return (
          <p className="max-w-[180px] truncate text-[13px]" title={items.map((i) => i.name).join(", ")}>
            {items.map((i) => i.name).join(", ")}
          </p>
        )
      },
    },
    {
      id: "workCenterName",
      accessorFn: (row) => row.workCenterName,
      header: "보관위치",
      cell: ({ row }) => (
        <div>
          <p className="text-[13px]">{row.original.workCenterName}</p>
          <p className="text-[12px] text-muted-foreground">{row.original.siteName}</p>
        </div>
      ),
    },
    {
      id: "usage",
      header: "현재사용량 / 수명",
      cell: ({ row }) => {
        const r = row.original
        if (r.lifeLimit === null) {
          return <span className="text-[13px] text-muted-foreground">{formatQuantity(r.currentUsage)}회 (수명 미설정)</span>
        }
        return (
          <span className="text-[13px]">
            {formatQuantity(r.currentUsage)} / {formatQuantity(r.lifeLimit)}회
            {r.usageRate !== null && <span className="ml-1 text-[12px] text-muted-foreground">({r.usageRate}%)</span>}
          </span>
        )
      },
    },
    {
      id: "remainingLife",
      header: "잔여수명",
      cell: ({ row }) => {
        const r = row.original.remainingLife
        if (r === null) return <span className="text-[13px] text-muted-foreground">-</span>
        return (
          <span className={`text-[13px] ${r < 0 ? "text-red-600 font-medium" : ""}`}>
            {formatQuantity(r)}회
          </span>
        )
      },
    },
    {
      accessorKey: "status",
      header: "상태",
      cell: ({ row }) => {
        const cfg = STATUS_CONFIG[row.original.status]
        return <Badge className={`${cfg.className} border-0 text-[12px] font-medium`}>{cfg.label}</Badge>
      },
    },
    {
      id: "lastUsedAt",
      header: "최근사용일",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {row.original.lastUsedAt ? fmtDate(row.original.lastUsedAt) : "-"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "작업",
      cell: ({ row }) => (
        <Button variant="outline" size="sm" onClick={() => onViewDetail(row.original)}>
          상세
        </Button>
      ),
      enableSorting: false,
    },
  ]
}
