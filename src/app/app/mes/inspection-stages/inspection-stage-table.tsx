"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus } from "lucide-react"
import { format } from "date-fns"
import { ko } from "date-fns/locale"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/common/data-table"
import { ColumnDef } from "@tanstack/react-table"
import { InspectionStageRow } from "@/lib/actions/inspection-stages.actions"
import { InspectionStageFormSheet } from "./inspection-stage-form-sheet"
import { formatQuantity } from "@/lib/utils"

const STAGE_CONFIG = {
  FIRST: { label: "초물검사", className: "bg-blue-100 text-blue-700" },
  MID: { label: "중간검사", className: "bg-yellow-100 text-yellow-700" },
  FINAL: { label: "종물검사", className: "bg-purple-100 text-purple-700" },
}

const RESULT_CONFIG = {
  PASS: { label: "합격", className: "bg-green-100 text-green-700" },
  FAIL: { label: "불합격", className: "bg-red-100 text-red-700" },
  CONDITIONAL: { label: "조건부합격", className: "bg-orange-100 text-orange-700" },
}

interface Props {
  data: InspectionStageRow[]
  workOrders: any[]
}

export function InspectionStageTable({ data, workOrders }: Props) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingInspection, setEditingInspection] = useState<InspectionStageRow | null>(null)
  const [stageFilter, setStageFilter] = useState<string>("ALL")

  const filtered = stageFilter === "ALL" ? data : data.filter((d) => d.stage === stageFilter)

  const handleEdit = (inspection: InspectionStageRow) => {
    setEditingInspection(inspection)
    setEditOpen(true)
  }

  const columns: ColumnDef<InspectionStageRow>[] = [
    {
      accessorKey: "stage",
      header: "검사단계",
      cell: ({ row }) => {
        const cfg = STAGE_CONFIG[row.original.stage]
        return <Badge className={`${cfg.className} text-[12px] font-medium border-0`}>{cfg.label}</Badge>
      },
    },
    {
      accessorKey: "workOrderOperation",
      header: "작업지시",
      cell: ({ row }) => {
        const woo = row.original.workOrderOperation
        return (
          <div>
            <p className="font-medium text-[14px]">{woo.workOrder.orderNo}</p>
            <p className="text-[13px] text-muted-foreground">{woo.workOrder.item.name}</p>
          </div>
        )
      },
    },
    {
      accessorKey: "routingOperation",
      header: "공정",
      cell: ({ row }) => {
        const op = row.original.workOrderOperation.routingOperation
        return (
          <span className="text-[14px]">
            {op.seq}. {op.name}
          </span>
        )
      },
    },
    {
      accessorKey: "inspectedQty",
      header: "검사수량",
      cell: ({ row }) => (
        <span className="text-[14px] tabular-nums">{formatQuantity(Number(row.original.inspectedQty))}</span>
      ),
    },
    {
      accessorKey: "result",
      header: "판정",
      cell: ({ row }) => {
        if (!row.original.result) return <span className="text-[13px] text-muted-foreground">미판정</span>
        const cfg = RESULT_CONFIG[row.original.result as keyof typeof RESULT_CONFIG]
        if (!cfg) return <span className="text-[13px]">{row.original.result}</span>
        return <Badge className={`${cfg.className} text-[12px] font-medium border-0`}>{cfg.label}</Badge>
      },
    },
    {
      accessorKey: "inspector",
      header: "검사자",
      cell: ({ row }) => <span className="text-[14px]">{row.original.inspector.name}</span>,
    },
    {
      accessorKey: "inspectedAt",
      header: "검사일시",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {format(new Date(row.original.inspectedAt), "MM/dd HH:mm", { locale: ko })}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[13px] text-muted-foreground hover:text-foreground"
          onClick={() => handleEdit(row.original)}
        >
          <Pencil className="h-3.5 w-3.5 mr-1" />
          수정
        </Button>
      ),
    },
  ]

  const filterableColumns = [
    {
      id: "result" as keyof InspectionStageRow,
      title: "판정",
      options: [
        { label: "합격", value: "PASS" },
        { label: "불합격", value: "FAIL" },
        { label: "조건부합격", value: "CONDITIONAL" },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {/* Stage tabs */}
        <div className="flex gap-2">
          {["ALL", "FIRST", "MID", "FINAL"].map((s) => (
            <button
              key={s}
              onClick={() => setStageFilter(s)}
              className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
                stageFilter === s
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {s === "ALL" ? "전체" : STAGE_CONFIG[s as keyof typeof STAGE_CONFIG]?.label}
            </button>
          ))}
        </div>

        <Button onClick={() => setFormOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          검사 등록
        </Button>
      </div>

      <DataTable columns={columns} data={filtered} filterableColumns={filterableColumns} />

      <InspectionStageFormSheet
        mode="create"
        open={formOpen}
        onOpenChange={setFormOpen}
        workOrders={workOrders}
        onSuccess={() => router.refresh()}
      />

      {editingInspection && (
        <InspectionStageFormSheet
          mode="edit"
          open={editOpen}
          onOpenChange={setEditOpen}
          inspection={editingInspection}
          onSuccess={() => router.refresh()}
        />
      )}
    </div>
  )
}
