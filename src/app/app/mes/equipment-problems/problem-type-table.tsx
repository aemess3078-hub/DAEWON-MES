"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/common/data-table"
import { ColumnDef } from "@tanstack/react-table"
import {
  ProblemTypeRow,
  deleteProblemType,
  updateProblemType,
} from "@/lib/actions/equipment-management.actions"
import { ProblemTypeFormSheet } from "./problem-type-form-sheet"
import { formatQuantity } from "@/lib/utils"

interface Props {
  data: ProblemTypeRow[]
}

export function ProblemTypeTable({ data }: Props) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<ProblemTypeRow | null>(null)

  async function handleDelete(row: ProblemTypeRow) {
    if (row._count.repairRequests > 0) {
      alert("수리요청에서 사용 중인 문제유형은 삭제할 수 없습니다.")
      return
    }
    if (!confirm(`'${row.name}' 문제유형을 삭제하시겠습니까?`)) return
    await deleteProblemType(row.id)
    router.refresh()
  }

  async function handleToggleActive(row: ProblemTypeRow) {
    await updateProblemType(row.id, { isActive: !row.isActive })
    router.refresh()
  }

  const columns: ColumnDef<ProblemTypeRow>[] = [
    {
      accessorKey: "code",
      header: "코드",
      cell: ({ row }) => (
        <span className="font-mono text-[13px] font-medium">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "문제유형명",
      cell: ({ row }) => (
        <span className="font-medium text-[14px]">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "category",
      header: "카테고리",
      cell: ({ row }) => (
        <span className="text-[14px]">{row.original.category ?? "—"}</span>
      ),
    },
    {
      accessorKey: "description",
      header: "설명",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">{row.original.description ?? "—"}</span>
      ),
    },
    {
      accessorKey: "_count",
      header: "사용건수",
      cell: ({ row }) => (
        <Badge variant="secondary" className="text-[12px]">
          {formatQuantity(row.original._count.repairRequests)}건
        </Badge>
      ),
    },
    {
      accessorKey: "isActive",
      header: "사용여부",
      cell: ({ row }) => (
        <Badge
          className={`text-[12px] font-medium border-0 cursor-pointer ${
            row.original.isActive
              ? "bg-green-100 text-green-700"
              : "bg-slate-100 text-slate-500"
          }`}
          onClick={() => handleToggleActive(row.original)}
        >
          {row.original.isActive ? "사용" : "미사용"}
        </Badge>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => { setEditingRow(row.original); setFormOpen(true) }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => handleDelete(row.original)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditingRow(null); setFormOpen(true) }} className="gap-2">
          <Plus className="h-4 w-4" />
          문제유형 등록
        </Button>
      </div>

      <DataTable columns={columns} data={data} />

      <ProblemTypeFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        editingRow={editingRow}
        onSuccess={() => router.refresh()}
      />
    </div>
  )
}
