"use client"

import { ColumnDef } from "@tanstack/react-table"
import { DataTableColumnHeader } from "@/components/common/data-table"
import type { EquipmentOutputRow } from "@/lib/actions/equipment-output.actions"
import { EQUIPMENT_TYPE_LABELS } from "@/app/app/mes/master/equipment/columns"
import { formatQuantity } from "@/lib/utils"

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function fmtWorkTime(minutes: number): string {
  if (minutes <= 0) return "—"
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m}분`
  if (m === 0) return `${h}시간`
  return `${h}시간 ${m}분`
}

// ─── 컬럼 정의 ────────────────────────────────────────────────────────────────

export const columns: ColumnDef<EquipmentOutputRow>[] = [
  {
    id:          "equipmentCode",
    accessorKey: "equipmentCode",
    header: ({ column }) => <DataTableColumnHeader column={column} title="설비코드" />,
    cell: ({ row }) => (
      <span className="font-mono text-[14px] font-medium">{row.original.equipmentCode}</span>
    ),
  },
  {
    id:          "equipmentName",
    accessorKey: "equipmentName",
    header: ({ column }) => <DataTableColumnHeader column={column} title="설비명" />,
    cell: ({ row }) => (
      <span className="text-[14px]">{row.original.equipmentName}</span>
    ),
  },
  {
    id:          "equipmentType",
    accessorKey: "equipmentType",
    header: ({ column }) => <DataTableColumnHeader column={column} title="설비유형" />,
    cell: ({ row }) => (
      <span className="text-[13px] text-muted-foreground">
        {EQUIPMENT_TYPE_LABELS[row.original.equipmentType] ?? row.original.equipmentType}
      </span>
    ),
    filterFn: (row, _id, filterValues: string[]) =>
      filterValues.includes(row.original.equipmentType),
  },
  {
    id:          "siteName",
    accessorKey: "siteName",
    header: ({ column }) => <DataTableColumnHeader column={column} title="사이트" />,
    cell: ({ row }) => (
      <span className="text-[14px]">{row.original.siteName}</span>
    ),
  },
  {
    id:          "workCenterName",
    accessorKey: "workCenterName",
    header: ({ column }) => <DataTableColumnHeader column={column} title="작업장" />,
    cell: ({ row }) => (
      <span className="text-[14px] text-muted-foreground">{row.original.workCenterName}</span>
    ),
  },
  {
    id:          "resultCount",
    accessorKey: "resultCount",
    header: ({ column }) => <DataTableColumnHeader column={column} title="실적건수" />,
    cell: ({ row }) => (
      <span className="text-[14px] tabular-nums text-muted-foreground">
        {formatQuantity(row.original.resultCount)}건
      </span>
    ),
  },
  {
    id:          "totalQty",
    accessorKey: "totalQty",
    header: ({ column }) => <DataTableColumnHeader column={column} title="생산수량" />,
    cell: ({ row }) => (
      <span className="text-[14px] tabular-nums font-medium">
        {formatQuantity(row.original.totalQty)}
      </span>
    ),
  },
  {
    id:          "goodQty",
    accessorKey: "goodQty",
    header: ({ column }) => <DataTableColumnHeader column={column} title="양품수량" />,
    cell: ({ row }) => (
      <span className="text-[14px] tabular-nums text-emerald-700 font-medium">
        {formatQuantity(row.original.goodQty)}
      </span>
    ),
  },
  {
    id:          "defectQty",
    accessorKey: "defectQty",
    header: ({ column }) => <DataTableColumnHeader column={column} title="불량수량" />,
    cell: ({ row }) => {
      const v = row.original.defectQty
      return (
        <span className={`text-[14px] tabular-nums ${v > 0 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
          {v > 0 ? formatQuantity(v) : "—"}
        </span>
      )
    },
  },
  {
    id:          "defectRate",
    accessorKey: "defectRate",
    header: ({ column }) => <DataTableColumnHeader column={column} title="불량률" />,
    cell: ({ row }) => {
      const v = row.original.defectRate
      return (
        <span className={`text-[14px] tabular-nums ${
          v >= 5  ? "text-red-600 font-semibold"
          : v > 0 ? "text-amber-600"
          : "text-muted-foreground"
        }`}>
          {v > 0 ? `${v.toFixed(1)}%` : "—"}
        </span>
      )
    },
  },
  {
    id:          "workTimeMin",
    accessorKey: "workTimeMin",
    header: ({ column }) => <DataTableColumnHeader column={column} title="작업시간" />,
    cell: ({ row }) => (
      <span className="text-[13px] tabular-nums text-muted-foreground">
        {fmtWorkTime(row.original.workTimeMin)}
      </span>
    ),
  },
  {
    id:          "latestAt",
    accessorKey: "latestAt",
    header: ({ column }) => <DataTableColumnHeader column={column} title="최근실적일" />,
    cell: ({ row }) => {
      const d = row.original.latestAt
      if (!d) return <span className="text-[13px] text-muted-foreground">—</span>
      return (
        <span className="text-[13px] text-muted-foreground">
          {new Date(d).toLocaleDateString("ko-KR")}
        </span>
      )
    },
  },
]
