"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal, Pencil, PowerOff, Power, Plus, Search, Trash2 } from "lucide-react"
import { Badge }  from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input }  from "@/components/ui/input"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DataTable, DataTableColumnHeader } from "@/components/common/data-table"
import { BulkDeleteDialog, type BulkDeleteCandidate } from "@/components/common/bulk-delete-dialog"
import { useUserRole } from "@/lib/contexts/user-role-context"
import {
  toggleDowntimeReasonActive,
  bulkCheckDowntimeReasonsForDelete,
  bulkDeleteDowntimeReasons,
  type DowntimeReason,
} from "@/lib/actions/downtime-reason.actions"
import { DowntimeReasonFormSheet } from "./downtime-reason-form"

// ─── 에러 메시지 ──────────────────────────────────────────────────────────────

const TOGGLE_ERRORS: Record<string, string> = {
  NOT_FOUND:  "항목을 찾을 수 없습니다.",
  FORBIDDEN:  "권한이 없습니다.",
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  data: DowntimeReason[]
  canBulkDelete: boolean
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function DowntimeReasonsClient({ data, canBulkDelete }: Props) {
  const router    = useRouter()
  const canMutate = useUserRole() !== "VIEWER"

  const [keyword,    setKeyword]    = useState("")
  const [sheetOpen,  setSheetOpen]  = useState(false)
  const [editTarget, setEditTarget] = useState<DowntimeReason | null>(null)

  const [selectedItems, setSelectedItems]   = useState<DowntimeReason[]>([])
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0)
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkChecking,   setBulkChecking]   = useState(false)
  const [bulkDeleting,   setBulkDeleting]   = useState(false)
  const [bulkCandidates, setBulkCandidates] = useState<BulkDeleteCandidate[]>([])

  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return data
    return data.filter((r) => {
      const hay = [r.code, r.name, r.description ?? ""].join(" ").toLowerCase()
      return hay.includes(kw)
    })
  }, [data, keyword])

  const handleEdit = (r: DowntimeReason) => {
    setEditTarget(r)
    setSheetOpen(true)
  }

  const handleToggle = async (r: DowntimeReason) => {
    const action  = r.isActive ? "비활성" : "활성"
    const ok = window.confirm(`"${r.name}" 사유를 ${action} 처리하시겠습니까?`)
    if (!ok) return
    try {
      await toggleDowntimeReasonActive(r.id, !r.isActive)
      router.refresh()
    } catch (e: unknown) {
      const key = e instanceof Error ? e.message : ""
      alert(TOGGLE_ERRORS[key] ?? (e instanceof Error ? e.message : "처리 중 오류가 발생했습니다."))
    }
  }

  const handleBulkDeleteClick = async () => {
    setBulkDialogOpen(true)
    setBulkChecking(true)
    setBulkCandidates([])
    try {
      const result = await bulkCheckDowntimeReasonsForDelete(selectedItems.map((i) => i.id))
      setBulkCandidates(result)
    } catch (error) {
      console.error("참조 확인 실패:", error)
      setBulkDialogOpen(false)
      alert("삭제 가능 여부 확인에 실패했습니다.")
    } finally {
      setBulkChecking(false)
    }
  }

  const handleConfirmBulkDelete = async () => {
    const deletableIds = bulkCandidates.filter((c) => c.canDelete).map((c) => c.id)
    if (deletableIds.length === 0) return
    setBulkDeleting(true)
    try {
      const { deleted, blocked, failed } = await bulkDeleteDowntimeReasons(deletableIds)
      const excluded = blocked.length + failed.length
      setBulkDialogOpen(false)
      setSelectedItems([])
      setClearSelectionSignal((n) => n + 1)
      router.refresh()
      alert(
        excluded > 0
          ? `${deleted.length}개 삭제 완료, ${excluded}개는 사용 이력으로 인해 삭제 제외되었습니다.`
          : `${deleted.length}개 삭제 완료`
      )
    } catch (error) {
      alert(error instanceof Error ? error.message : "삭제에 실패했습니다.")
    } finally {
      setBulkDeleting(false)
    }
  }

  // ─── 컬럼 정의 ──────────────────────────────────────────────────────────────

  const columns = useMemo<ColumnDef<DowntimeReason>[]>(() => {
    const base: ColumnDef<DowntimeReason>[] = [
      {
        id:          "code",
        accessorKey: "code",
        header: ({ column }) => <DataTableColumnHeader column={column} title="코드" />,
        cell: ({ row }) => (
          <span className="font-mono text-[14px] font-medium">{row.original.code}</span>
        ),
      },
      {
        id:          "name",
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="사유명" />,
        cell: ({ row }) => <span className="text-[14px] font-medium">{row.original.name}</span>,
      },
      {
        id:          "description",
        accessorKey: "description",
        header:      "설명",
        cell: ({ row }) => (
          <span className="text-[13px] text-muted-foreground line-clamp-1 max-w-[240px]">
            {row.original.description ?? "—"}
          </span>
        ),
      },
      {
        id:          "displayOrder",
        accessorKey: "displayOrder",
        header: ({ column }) => <DataTableColumnHeader column={column} title="정렬순서" />,
        cell: ({ row }) => (
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {row.original.displayOrder}
          </span>
        ),
      },
      {
        id:          "isActive",
        accessorKey: "isActive",
        header:      "사용여부",
        cell: ({ row }) => (
          row.original.isActive
            ? <Badge variant="default" className="bg-emerald-100 text-emerald-800 border-emerald-200">사용</Badge>
            : <Badge variant="secondary">미사용</Badge>
        ),
      },
      {
        id:     "updatedAt",
        header: "수정일",
        cell: ({ row }) => (
          <span className="text-[13px] text-muted-foreground">
            {new Date(row.original.updatedAt).toLocaleDateString("ko-KR")}
          </span>
        ),
      },
    ]

    if (!canMutate) return base

    return [
      ...base,
      {
        id:     "actions",
        header: "",
        cell: ({ row }) => {
          const r = row.original
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleEdit(r)} className="text-[14px]">
                  <Pencil className="h-4 w-4 mr-2" />
                  수정
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleToggle(r)}
                  className="text-[14px]"
                >
                  {r.isActive
                    ? <><PowerOff className="h-4 w-4 mr-2 text-amber-600" /><span className="text-amber-700">비활성 처리</span></>
                    : <><Power    className="h-4 w-4 mr-2 text-emerald-600" /><span className="text-emerald-700">활성 처리</span></>
                  }
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
        enableSorting: false,
        enableHiding:  false,
      },
    ]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canMutate])

  // ─── 렌더 ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* 툴바 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="코드 / 사유명 / 설명 검색"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="h-9 w-[260px] pl-9 text-[14px]"
            />
          </div>
          {canBulkDelete && selectedItems.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5 text-[13px] h-9"
              onClick={handleBulkDeleteClick}
            >
              <Trash2 className="h-4 w-4" />
              선택 삭제 ({selectedItems.length})
            </Button>
          )}
        </div>

        {canMutate && (
          <Button
            size="sm"
            onClick={() => { setEditTarget(null); setSheetOpen(true) }}
          >
            <Plus className="h-4 w-4 mr-2" />
            비가동사유 등록
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={filteredData}
        getRowId={(item) => item.id}
        enableRowSelection={canBulkDelete}
        onSelectionChange={setSelectedItems}
        clearSelectionSignal={clearSelectionSignal}
      />

      <DowntimeReasonFormSheet
        mode={editTarget ? "edit" : "create"}
        reason={editTarget}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) setEditTarget(null)
        }}
      />

      <BulkDeleteDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        entityLabel="비가동사유"
        loading={bulkChecking}
        candidates={bulkCandidates}
        confirming={bulkDeleting}
        onConfirm={handleConfirmBulkDelete}
      />
    </div>
  )
}
