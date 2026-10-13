"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Pencil, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  DataTagRow,
  toggleTagActive,
} from "@/lib/actions/equipment-integration.actions"
import { TagDataType, TagCategory } from "@prisma/client"

// ─── 설정 맵 ──────────────────────────────────────────────────────────────────

export const TAG_DATA_TYPE_CONFIG: Record<TagDataType, { label: string; className: string }> = {
  BOOL:   { label: "BOOL",   className: "bg-blue-100 text-blue-800" },
  INT:    { label: "INT",    className: "bg-purple-100 text-purple-800" },
  FLOAT:  { label: "FLOAT",  className: "bg-green-100 text-green-800" },
  STRING: { label: "STRING", className: "bg-amber-100 text-amber-800" },
}

export const TAG_CATEGORY_CONFIG: Record<TagCategory, { label: string; className: string }> = {
  PROCESS: { label: "공정",   className: "bg-blue-50 text-blue-700" },
  STATUS:  { label: "상태",   className: "bg-gray-100 text-gray-700" },
  ALARM:   { label: "알람",   className: "bg-red-100 text-red-700" },
  COUNTER: { label: "카운터", className: "bg-indigo-100 text-indigo-700" },
  QUALITY: { label: "품질",   className: "bg-green-100 text-green-700" },
}

// ─── 컬럼 정의 ───────────────────────────────────────────────────────────────

type ColumnActions = {
  onEdit: (row: DataTagRow) => void
  onDelete: (row: DataTagRow) => void
  onRefresh: () => void
}

export function getTagColumns({
  onEdit,
  onDelete,
  onRefresh,
}: ColumnActions): ColumnDef<DataTagRow>[] {
  return [
    {
      accessorKey: "tagCode",
      header: "태그코드",
      cell: ({ row }) => (
        <span className="font-mono font-medium text-[13px]">{row.original.tagCode}</span>
      ),
    },
    {
      accessorKey: "displayName",
      header: "표시명",
      cell: ({ row }) => (
        <span className="text-[14px]">{row.original.displayName}</span>
      ),
    },
    {
      id: "equipment",
      header: "설비",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {row.original.connection.equipment.name}
        </span>
      ),
    },
    {
      accessorKey: "dataType",
      header: "데이터타입",
      cell: ({ row }) => {
        const cfg = TAG_DATA_TYPE_CONFIG[row.original.dataType]
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium font-mono ${cfg.className}`}
          >
            {cfg.label}
          </span>
        )
      },
      filterFn: (row, _, filterValue: string[]) => {
        if (!filterValue?.length) return true
        return filterValue.includes(row.original.dataType)
      },
    },
    {
      accessorKey: "unit",
      header: "단위",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {row.original.unit ?? "-"}
        </span>
      ),
    },
    {
      accessorKey: "plcAddress",
      header: "PLC 주소",
      cell: ({ row }) => (
        <span className="font-mono text-[13px]">{row.original.plcAddress}</span>
      ),
    },
    {
      accessorKey: "category",
      header: "카테고리",
      cell: ({ row }) => {
        const cfg = TAG_CATEGORY_CONFIG[row.original.category]
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
        return filterValue.includes(row.original.category)
      },
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
                await toggleTagActive(item.id, checked)
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
