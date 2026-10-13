"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Pencil, CheckCircle2, XCircle, MinusCircle } from "lucide-react"
import { format } from "date-fns"
import { ko } from "date-fns/locale"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/common/data-table"
import { ColumnDef } from "@tanstack/react-table"
import { DailyCheckRow } from "@/lib/actions/equipment-management.actions"
import { DailyCheckFormSheet } from "./daily-check-form-sheet"

const RESULT_CONFIG = {
  PASS: { label: "이상없음", className: "bg-green-100 text-green-700", Icon: CheckCircle2 },
  FAIL: { label: "이상있음", className: "bg-red-100 text-red-700", Icon: XCircle },
  NA: { label: "해당없음", className: "bg-slate-100 text-slate-600", Icon: MinusCircle },
}

interface Props {
  data: DailyCheckRow[]
  equipments: { id: string; code: string; name: string; workCenter: { name: string } }[]
  defaultEquipmentId?: string
}

export function DailyCheckTable({ data, equipments, defaultEquipmentId }: Props) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<DailyCheckRow | null>(null)
  const defaultEquipment = equipments.find((equipment) => equipment.id === defaultEquipmentId)

  useEffect(() => {
    if (!defaultEquipmentId || !defaultEquipment) return
    setEditingRow(null)
    setFormOpen(true)
  }, [defaultEquipment, defaultEquipmentId])

  const columns: ColumnDef<DailyCheckRow>[] = [
    {
      accessorKey: "checkDate",
      header: "점검일",
      cell: ({ row }) => (
        <span className="font-medium text-[14px]">
          {format(new Date(row.original.checkDate), "yyyy-MM-dd (EEE)", { locale: ko })}
        </span>
      ),
    },
    {
      accessorKey: "equipment",
      header: "설비",
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-[14px]">{row.original.equipment.name}</p>
          <p className="text-[13px] text-muted-foreground">{row.original.equipment.code}</p>
        </div>
      ),
    },
    {
      accessorKey: "result",
      header: "점검결과",
      cell: ({ row }) => {
        const cfg = RESULT_CONFIG[row.original.result]
        return (
          <Badge className={`${cfg.className} text-[12px] font-medium border-0 gap-1`}>
            <cfg.Icon className="h-3 w-3" />
            {cfg.label}
          </Badge>
        )
      },
    },
    {
      accessorKey: "checker",
      header: "점검자",
      cell: ({ row }) => <span className="text-[14px]">{row.original.checker.name}</span>,
    },
    {
      accessorKey: "note",
      header: "비고",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">{row.original.note ?? "—"}</span>
      ),
    },
    {
      accessorKey: "site",
      header: "사이트",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">{row.original.site.name}</span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => { setEditingRow(row.original); setFormOpen(true) }}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ]

  const filterableColumns = [
    {
      id: "result" as keyof DailyCheckRow,
      title: "점검결과",
      options: Object.entries(RESULT_CONFIG).map(([value, cfg]) => ({
        label: cfg.label,
        value,
      })),
    },
  ]

  return (
    <div className="space-y-4">
      {defaultEquipmentId && (
        <div className={`flex items-center justify-between rounded-lg border px-4 py-3 text-[14px] ${
          defaultEquipment
            ? "border-blue-200 bg-blue-50 text-blue-800"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}>
          <span>
            {defaultEquipment
              ? `${defaultEquipment.name} 설비 컨텍스트를 유지해 점검 등록 화면을 열었습니다.`
              : "전달된 설비가 현재 점검 대상에 없습니다."}
          </span>
          <Button variant="outline" size="sm" className="h-8 bg-white text-[13px]" asChild>
            <Link href="/app/mes/equipment-check">전체 보기</Link>
          </Button>
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={() => { setEditingRow(null); setFormOpen(true) }} className="gap-2">
          <Plus className="h-4 w-4" />
          점검 등록
        </Button>
      </div>

      <DataTable columns={columns} data={data} filterableColumns={filterableColumns} />

      <DailyCheckFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        editingRow={editingRow}
        equipments={equipments}
        defaultEquipmentId={defaultEquipment?.id}
        onSuccess={() => router.refresh()}
      />
    </div>
  )
}
