"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, Plus, Trash2 } from "lucide-react"
import { DataTable } from "@/components/common/data-table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BulkDeleteDialog, type BulkDeleteCandidate } from "@/components/common/bulk-delete-dialog"
import { getMoldColumns, MOLD_TYPE_LABELS, MOLD_STATUS_LABELS } from "./columns"
import { MoldFormSheet } from "./mold-form-sheet"
import {
  deleteMold,
  bulkCheckMoldsForDelete,
  bulkDeleteMolds,
  type MoldRow,
} from "@/lib/actions/mold.actions"
import { useUserRole } from "@/lib/contexts/user-role-context"

type SiteOption = { id: string; code: string; name: string }
type WorkCenterOption = { id: string; code: string; name: string; siteId: string }

interface Props {
  data: MoldRow[]
  sites: SiteOption[]
  workCenters: WorkCenterOption[]
  canBulkDelete: boolean
}

export function MoldsDataTable({ data, sites, workCenters, canBulkDelete }: Props) {
  const router = useRouter()
  const canMutate = useUserRole() !== "VIEWER"
  const [keyword, setKeyword] = useState("")
  const [siteFilter, setSiteFilter] = useState("all")
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<MoldRow | null>(null)

  const [selectedItems, setSelectedItems]   = useState<MoldRow[]>([])
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0)
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkChecking,   setBulkChecking]   = useState(false)
  const [bulkDeleting,   setBulkDeleting]   = useState(false)
  const [bulkCandidates, setBulkCandidates] = useState<BulkDeleteCandidate[]>([])

  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return data.filter((row) => {
      if (siteFilter !== "all" && row.siteName !== siteFilter) return false
      if (kw.length > 0) {
        const hay = [row.code, row.name, row.siteName, row.workCenterName]
          .join(" ")
          .toLowerCase()
        if (!hay.includes(kw)) return false
      }
      return true
    })
  }, [data, keyword, siteFilter])

  const handleEdit = (row: MoldRow) => {
    setEditTarget(row)
    setSheetOpen(true)
  }

  const handleDelete = async (row: MoldRow) => {
    if (
      !confirm(
        `"${row.name}"을(를) 삭제하시겠습니까?\n이력이 있으면 삭제되지 않습니다.`
      )
    )
      return
    try {
      await deleteMold(row.id)
      router.refresh()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  const handleBulkDeleteClick = async () => {
    setBulkDialogOpen(true)
    setBulkChecking(true)
    setBulkCandidates([])
    try {
      const result = await bulkCheckMoldsForDelete(selectedItems.map((i) => i.id))
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
      const { deleted, blocked, failed } = await bulkDeleteMolds(deletableIds)
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

  const allColumns = getMoldColumns({ onEdit: handleEdit, onDelete: handleDelete })
  const columns = canMutate
    ? allColumns
    : allColumns.filter((c) => c.id !== "actions")

  const filterableColumns = [
    {
      id: "equipmentType" as keyof MoldRow,
      title: "유형",
      options: Object.entries(MOLD_TYPE_LABELS).map(([value, label]) => ({
        label,
        value,
      })),
    },
    {
      id: "status" as keyof MoldRow,
      title: "상태",
      options: Object.entries(MOLD_STATUS_LABELS).map(([value, label]) => ({
        label,
        value,
      })),
    },
  ]

  const siteNames = Array.from(new Set(data.map((r) => r.siteName)))

  return (
    <div className="space-y-4">
      {/* 툴바 */}
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="코드 / 명칭 / 위치 검색"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="h-9 w-[240px] pl-9 text-[14px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[14px] text-muted-foreground">사업장</span>
            <Select value={siteFilter} onValueChange={setSiteFilter}>
              <SelectTrigger className="h-9 w-[160px] text-[14px]">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-[14px]">
                  전체
                </SelectItem>
                {siteNames.map((name) => (
                  <SelectItem key={name} value={name} className="text-[14px]">
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            onClick={() => {
              setEditTarget(null)
              setSheetOpen(true)
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            등록
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
        filterableColumns={filterableColumns}
      />

      <MoldFormSheet
        mode={editTarget ? "edit" : "create"}
        mold={editTarget}
        sites={sites}
        workCenters={workCenters}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) setEditTarget(null)
        }}
      />

      <BulkDeleteDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        entityLabel="금형/치공구"
        loading={bulkChecking}
        candidates={bulkCandidates}
        confirming={bulkDeleting}
        onConfirm={handleConfirmBulkDelete}
      />
    </div>
  )
}
