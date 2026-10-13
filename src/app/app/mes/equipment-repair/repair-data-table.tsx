"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Pencil, Trash2, Play, CheckCircle, MoreHorizontal } from "lucide-react"
import { format } from "date-fns"
import { ko } from "date-fns/locale"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/common/data-table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ColumnDef } from "@tanstack/react-table"
import {
  RepairRequestRow,
  ProblemTypeRow,
  deleteRepairRequest,
  updateRepairStatus,
} from "@/lib/actions/equipment-management.actions"
import { RepairRepairFormSheet } from "./repair-form-sheet"

const PRIORITY_CONFIG = {
  LOW: { label: "낮음", className: "bg-slate-100 text-slate-700" },
  MEDIUM: { label: "보통", className: "bg-blue-100 text-blue-700" },
  HIGH: { label: "높음", className: "bg-orange-100 text-orange-700" },
  CRITICAL: { label: "긴급", className: "bg-red-100 text-red-700" },
}

const STATUS_CONFIG = {
  OPEN: { label: "접수", className: "bg-slate-100 text-slate-700" },
  IN_PROGRESS: { label: "수리중", className: "bg-yellow-100 text-yellow-700" },
  COMPLETED: { label: "완료", className: "bg-green-100 text-green-700" },
  CANCELLED: { label: "취소", className: "bg-red-100 text-red-600" },
}

interface Props {
  data: RepairRequestRow[]
  equipments: { id: string; code: string; name: string; workCenter: { name: string } }[]
  profiles: { id: string; name: string }[]
  problemTypes: ProblemTypeRow[]
  defaultEquipmentId?: string
}

export function RepairDataTable({ data, equipments, profiles, problemTypes, defaultEquipmentId }: Props) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<RepairRequestRow | null>(null)
  const defaultEquipment = equipments.find((equipment) => equipment.id === defaultEquipmentId)

  useEffect(() => {
    if (!defaultEquipmentId || !defaultEquipment) return
    setEditingRow(null)
    setFormOpen(true)
  }, [defaultEquipment, defaultEquipmentId])

  async function handleDelete(row: RepairRequestRow) {
    if (!confirm(`'${row.title}' 수리요청을 삭제하시겠습니까?`)) return
    await deleteRepairRequest(row.id)
    router.refresh()
  }

  async function handleStatusChange(row: RepairRequestRow, status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED") {
    await updateRepairStatus(row.id, status)
    router.refresh()
  }

  const columns: ColumnDef<RepairRequestRow>[] = [
    {
      accessorKey: "requestNo",
      header: "요청번호",
      cell: ({ row }) => (
        <span className="font-mono text-[13px] text-muted-foreground">{row.original.requestNo}</span>
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
      accessorKey: "title",
      header: "제목",
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-[14px]">{row.original.title}</p>
          {row.original.problemType && (
            <p className="text-[13px] text-muted-foreground">{row.original.problemType.name}</p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "priority",
      header: "우선순위",
      cell: ({ row }) => {
        const cfg = PRIORITY_CONFIG[row.original.priority]
        return <Badge className={`${cfg.className} text-[12px] font-medium border-0`}>{cfg.label}</Badge>
      },
    },
    {
      accessorKey: "status",
      header: "상태",
      cell: ({ row }) => {
        const cfg = STATUS_CONFIG[row.original.status]
        return <Badge className={`${cfg.className} text-[12px] font-medium border-0`}>{cfg.label}</Badge>
      },
    },
    {
      accessorKey: "requester",
      header: "요청자",
      cell: ({ row }) => <span className="text-[14px]">{row.original.requester.name}</span>,
    },
    {
      accessorKey: "assignee",
      header: "담당자",
      cell: ({ row }) => (
        <span className="text-[14px]">{row.original.assignee?.name ?? "—"}</span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "요청일",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {format(new Date(row.original.createdAt), "MM/dd HH:mm", { locale: ko })}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {row.original.status === "OPEN" && (
              <DropdownMenuItem onClick={() => handleStatusChange(row.original, "IN_PROGRESS")}>
                <Play className="h-4 w-4 mr-2 text-yellow-600" />
                수리 시작
              </DropdownMenuItem>
            )}
            {row.original.status === "IN_PROGRESS" && (
              <DropdownMenuItem onClick={() => handleStatusChange(row.original, "COMPLETED")}>
                <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                수리 완료
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => { setEditingRow(row.original); setFormOpen(true) }}>
              <Pencil className="h-4 w-4 mr-2" />
              수정
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => handleDelete(row.original)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  const filterableColumns = [
    {
      id: "status" as keyof RepairRequestRow,
      title: "상태",
      options: Object.entries(STATUS_CONFIG).map(([value, cfg]) => ({
        label: cfg.label,
        value,
      })),
    },
    {
      id: "priority" as keyof RepairRequestRow,
      title: "우선순위",
      options: Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({
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
              ? `${defaultEquipment.name} 설비 컨텍스트를 유지해 수리 요청 화면을 열었습니다.`
              : "전달된 설비가 현재 수리 요청 대상에 없습니다."}
          </span>
          <Button variant="outline" size="sm" className="h-8 bg-white text-[13px]" asChild>
            <Link href="/app/mes/equipment-repair">전체 보기</Link>
          </Button>
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={() => { setEditingRow(null); setFormOpen(true) }} className="gap-2">
          <Plus className="h-4 w-4" />
          수리 요청
        </Button>
      </div>

      <DataTable columns={columns} data={data} filterableColumns={filterableColumns} />

      <RepairRepairFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        editingRow={editingRow}
        equipments={equipments}
        profiles={profiles}
        problemTypes={problemTypes}
        defaultEquipmentId={defaultEquipment?.id}
      />
    </div>
  )
}
