"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Pencil, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DefectCodeRow } from "@/lib/actions/quality.actions"

// ─── 카테고리 설정 ────────────────────────────────────────────────────────────

export const DEFECT_CATEGORY_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  DIMENSIONAL: { label: "치수",   className: "bg-blue-100 text-blue-800" },
  VISUAL:      { label: "외관",   className: "bg-purple-100 text-purple-800" },
  FUNCTIONAL:  { label: "기능",   className: "bg-amber-100 text-amber-800" },
  MATERIAL:    { label: "재질",   className: "bg-green-100 text-green-800" },
}

// ─── 컬럼 정의 ───────────────────────────────────────────────────────────────

type ColumnActions = {
  onEdit: (row: DefectCodeRow) => void
  onDelete: (row: DefectCodeRow) => void
}

export function getDefectColumns({ onEdit, onDelete }: ColumnActions): ColumnDef<DefectCodeRow>[] {
  return [
    {
      accessorKey: "code",
      header: "불량코드",
      cell: ({ row }) => (
        <span className="font-mono font-medium text-[14px]">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "불량명",
      cell: ({ row }) => (
        <span className="text-[14px]">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "defectCategory",
      header: "불량유형",
      cell: ({ row }) => {
        const cfg = DEFECT_CATEGORY_CONFIG[row.original.defectCategory]
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium ${
              cfg?.className ?? "bg-gray-100 text-gray-600"
            }`}
          >
            {cfg?.label ?? row.original.defectCategory}
          </span>
        )
      },
      filterFn: (row, _, filterValue: string[]) => {
        if (!filterValue?.length) return true
        return filterValue.includes(row.original.defectCategory)
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
