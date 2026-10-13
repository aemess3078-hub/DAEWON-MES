"use client"

import { useState, useTransition } from "react"
import { useRouter, usePathname } from "next/navigation"
import { CheckCircle2, XCircle, MinusCircle, ClipboardList } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/common/data-table"
import { ColumnDef } from "@tanstack/react-table"
import type {
  DailyCheckStatusData,
  DailyCheckStatusRow,
} from "@/lib/actions/equipment-management.actions"
import { formatQuantity } from "@/lib/utils"

const RESULT_CONFIG = {
  PASS: {
    label: "이상없음",
    className: "bg-green-100 text-green-700 border-0",
    Icon: CheckCircle2,
  },
  FAIL: {
    label: "이상있음",
    className: "bg-red-100 text-red-700 border-0",
    Icon: XCircle,
  },
  NA: {
    label: "해당없음",
    className: "bg-slate-100 text-slate-600 border-0",
    Icon: MinusCircle,
  },
} as const

interface Props {
  data: DailyCheckStatusData
  equipments: { id: string; code: string; name: string }[]
  filter: { from: string; to: string; equipmentId: string }
}

export function CheckStatusClient({ data, equipments, filter }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  const [from, setFrom] = useState(filter.from)
  const [to, setTo] = useState(filter.to)
  const [equipmentId, setEquipmentId] = useState(filter.equipmentId)

  function handleApply() {
    const params = new URLSearchParams()
    params.set("from", from)
    params.set("to", to)
    if (equipmentId) params.set("equipmentId", equipmentId)
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  const columns: ColumnDef<DailyCheckStatusRow>[] = [
    {
      accessorKey: "checkDate",
      header: "점검일",
      cell: ({ row }) => (
        <span className="font-medium text-[14px]">{row.original.checkDate}</span>
      ),
    },
    {
      accessorKey: "equipmentName",
      header: "설비",
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-[14px]">{row.original.equipmentName}</p>
          <p className="text-[13px] text-muted-foreground">{row.original.equipmentCode}</p>
        </div>
      ),
    },
    {
      accessorKey: "result",
      header: "점검결과",
      cell: ({ row }) => {
        const cfg = RESULT_CONFIG[row.original.result]
        return (
          <Badge className={`${cfg.className} text-[12px] font-medium gap-1`}>
            <cfg.Icon className="h-3 w-3" />
            {cfg.label}
          </Badge>
        )
      },
    },
    {
      accessorKey: "checkerName",
      header: "점검자",
      cell: ({ row }) => (
        <span className="text-[14px]">{row.original.checkerName}</span>
      ),
    },
    {
      accessorKey: "siteName",
      header: "사이트",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">{row.original.siteName}</span>
      ),
    },
    {
      accessorKey: "note",
      header: "비고",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">{row.original.note ?? "—"}</span>
      ),
    },
  ]

  const filterableColumns = [
    {
      id: "result" as keyof DailyCheckStatusRow,
      title: "점검결과",
      options: Object.entries(RESULT_CONFIG).map(([value, cfg]) => ({
        label: cfg.label,
        value,
      })),
    },
  ]

  const { summary } = data

  return (
    <div className="space-y-6">
      {/* 기간·설비 필터 */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[14px] text-muted-foreground">기간</span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="border border-border rounded-md px-3 py-1.5 text-[14px] bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="text-[14px] text-muted-foreground">~</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="border border-border rounded-md px-3 py-1.5 text-[14px] bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <select
          value={equipmentId}
          onChange={(e) => setEquipmentId(e.target.value)}
          className="border border-border rounded-md px-3 py-1.5 text-[14px] bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">전체 설비</option>
          {equipments.map((e) => (
            <option key={e.id} value={e.id}>
              [{e.code}] {e.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleApply}
          disabled={isPending}
          className="px-4 py-1.5 rounded-md text-[14px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isPending ? "조회중…" : "조회"}
        </button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <p className="text-[13px] text-muted-foreground">전체</p>
          </div>
          <p className="text-[22px] font-semibold tabular-nums text-foreground">
            {formatQuantity(summary.total)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <p className="text-[13px] text-muted-foreground">이상없음</p>
          </div>
          <p className="text-[22px] font-semibold tabular-nums text-emerald-700">
            {formatQuantity(summary.passCount)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="h-4 w-4 text-red-600" />
            <p className="text-[13px] text-muted-foreground">이상있음</p>
          </div>
          <p className="text-[22px] font-semibold tabular-nums text-red-700">
            {formatQuantity(summary.failCount)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <MinusCircle className="h-4 w-4 text-slate-500" />
            <p className="text-[13px] text-muted-foreground">해당없음</p>
          </div>
          <p className="text-[22px] font-semibold tabular-nums text-slate-700">
            {formatQuantity(summary.naCount)}
          </p>
        </div>
      </div>

      {/* 점검 목록 */}
      {data.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 py-12 text-center">
          <ClipboardList className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-[15px] text-muted-foreground">조회 기간 내 점검 이력이 없습니다.</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={data.rows}
          filterableColumns={filterableColumns}
        />
      )}
    </div>
  )
}
