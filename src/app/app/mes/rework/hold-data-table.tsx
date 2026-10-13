"use client"

import { useState, useTransition } from "react"
import { ColumnDef } from "@tanstack/react-table"
import { Ban, CirclePause, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/common/data-table"
import { DataTableColumnHeader } from "@/components/common/data-table"
import {
  HoldableWipRow,
  HoldStatusFilter,
  WipHoldRow,
  getHolds,
} from "@/lib/actions/wip-hold.actions"
import { HoldRegisterDialog } from "./hold-register-dialog"
import { HoldEditDialog } from "./hold-edit-dialog"
import { HoldResolveDialog } from "./hold-resolve-dialog"

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: "보류중", className: "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100" },
  RELEASED: { label: "해제됨", className: "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100" },
  CANCELLED: { label: "취소됨", className: "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100" },
}

const FILTERS: { value: HoldStatusFilter; label: string }[] = [
  { value: "ACTIVE", label: "보류중" },
  { value: "RELEASED", label: "해제" },
  { value: "CANCELLED", label: "취소" },
  { value: "ALL", label: "전체" },
]

function formatDateTime(d: Date | null): string {
  if (!d) return "-"
  return new Date(d).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

interface HoldDataTableProps {
  initialData: WipHoldRow[]
  holdableWipUnits: HoldableWipRow[]
}

export function HoldDataTable({ initialData, holdableWipUnits }: HoldDataTableProps) {
  const [data, setData] = useState<WipHoldRow[]>(initialData)
  const [filter, setFilter] = useState<HoldStatusFilter>("ACTIVE")
  const [isPending, startTransition] = useTransition()

  const [registerOpen, setRegisterOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<WipHoldRow | null>(null)
  const [resolveTarget, setResolveTarget] = useState<WipHoldRow | null>(null)
  const [resolveMode, setResolveMode] = useState<"release" | "cancel">("release")

  const handleFilterChange = (next: HoldStatusFilter) => {
    setFilter(next)
    startTransition(async () => {
      const rows = await getHolds(next)
      setData(rows)
    })
  }

  // 등록/수정/해제/취소 다이얼로그가 성공한 뒤 호출한다. router.refresh()만으로는
  // 이 컴포넌트의 로컬 data state(useState 초기값)가 새 서버 props로 자동 동기화되지
  // 않으므로, 현재 선택된 filter 기준으로 직접 다시 조회해 반영한다.
  const refetch = () => {
    startTransition(async () => {
      const rows = await getHolds(filter)
      setData(rows)
    })
  }

  const columns: ColumnDef<WipHoldRow>[] = [
    {
      id: "status",
      header: "상태",
      cell: ({ row }) => {
        const s = STATUS_LABEL[row.original.status] ?? { label: row.original.status, className: "" }
        return (
          <Badge className={`text-[13px] ${s.className}`}>{s.label}</Badge>
        )
      },
    },
    {
      id: "orderNo",
      accessorFn: (row) => row.wipUnit.workOrder?.orderNo ?? "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="작업지시번호" />,
      cell: ({ row }) => (
        <span className="font-mono font-medium text-[14px]">
          {row.original.wipUnit.workOrder?.orderNo ?? "-"}
        </span>
      ),
    },
    {
      id: "item",
      accessorFn: (row) => row.wipUnit.workOrder?.item.name ?? "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="품목" />,
      cell: ({ row }) => (
        <div>
          <div className="text-[14px] font-medium">{row.original.wipUnit.workOrder?.item.name ?? "-"}</div>
          <div className="text-[13px] text-muted-foreground">{row.original.wipUnit.workOrder?.item.code ?? "-"}</div>
        </div>
      ),
    },
    {
      id: "manufacturingNo",
      header: "제조번호",
      cell: ({ row }) => (
        <span className="font-mono text-[13px] text-muted-foreground">
          {row.original.wipUnit.manufacturingNo ?? "-"}
        </span>
      ),
    },
    {
      id: "operation",
      accessorFn: (row) => row.wipUnit.routingOperation.name,
      header: ({ column }) => <DataTableColumnHeader column={column} title="공정" />,
      cell: ({ row }) => (
        <span className="text-[14px]">
          {row.original.wipUnit.routingOperation.seq}. {row.original.wipUnit.routingOperation.name}
        </span>
      ),
    },
    {
      id: "qty",
      header: "수량",
      cell: ({ row }) => <span className="text-[14px]">{row.original.wipUnit.qty}개</span>,
    },
    {
      id: "reason",
      header: "보류 사유",
      cell: ({ row }) => (
        <div className="max-w-56">
          <div className="text-[13px] text-muted-foreground truncate" title={row.original.reason}>
            {row.original.reason}
          </div>
          {row.original.status === "CANCELLED" && row.original.cancelNote && (
            <div
              className="mt-0.5 text-[12px] text-slate-500 truncate"
              title={`취소 메모: ${row.original.cancelNote}`}
            >
              취소 메모: {row.original.cancelNote}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "heldAt",
      header: ({ column }) => <DataTableColumnHeader column={column} title="보류일시" />,
      accessorFn: (row) => row.heldAt,
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">{formatDateTime(row.original.heldAt)}</span>
      ),
    },
    {
      id: "actor",
      header: "처리자",
      cell: ({ row }) => {
        const r = row.original
        const label =
          r.status === "ACTIVE" ? r.heldByName
          : r.status === "RELEASED" ? r.releasedByName
          : r.cancelledByName
        return <span className="text-[13px] text-muted-foreground">{label ?? "-"}</span>
      },
    },
    {
      id: "actions",
      header: "작업",
      cell: ({ row }) => {
        if (row.original.status !== "ACTIVE") return null
        return (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[13px] px-2 gap-1"
              onClick={() => setEditTarget(row.original)}
            >
              <Pencil className="h-3 w-3" />
              수정
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[13px] px-2 gap-1"
              onClick={() => {
                setResolveMode("release")
                setResolveTarget(row.original)
              }}
            >
              <CirclePause className="h-3 w-3" />
              해제
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[13px] px-2 gap-1 text-destructive hover:text-destructive"
              onClick={() => {
                setResolveMode("cancel")
                setResolveTarget(row.original)
              }}
            >
              <Ban className="h-3 w-3" />
              취소
            </Button>
          </div>
        )
      },
      enableSorting: false,
    },
  ]

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filter === f.value ? "default" : "outline"}
              className="h-7 text-[13px] px-2.5"
              disabled={isPending}
              onClick={() => handleFilterChange(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <Button size="sm" className="h-8 text-[13px]" onClick={() => setRegisterOpen(true)}>
          보류 등록
        </Button>
      </div>

      {data.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-[15px] text-muted-foreground">
            {filter === "ACTIVE" ? "현재 보류 중인 재공품이 없습니다." : "조회된 이력이 없습니다."}
          </p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          searchableColumns={[
            { id: "orderNo" as keyof WipHoldRow, title: "작업지시번호" },
            { id: "item" as keyof WipHoldRow, title: "품목" },
          ]}
        />
      )}

      <HoldRegisterDialog
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        holdableWipUnits={holdableWipUnits}
        onSuccess={refetch}
      />
      <HoldEditDialog
        open={editTarget != null}
        onOpenChange={(open) => !open && setEditTarget(null)}
        hold={editTarget}
        onSuccess={refetch}
      />
      <HoldResolveDialog
        open={resolveTarget != null}
        onOpenChange={(open) => !open && setResolveTarget(null)}
        hold={resolveTarget}
        mode={resolveMode}
        onSuccess={refetch}
      />
    </>
  )
}
