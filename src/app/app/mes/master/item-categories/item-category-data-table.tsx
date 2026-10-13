"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, Plus, Trash2 } from "lucide-react"
import { DataTable } from "@/components/common/data-table"
import { BulkDeleteDialog, type BulkDeleteCandidate } from "@/components/common/bulk-delete-dialog"
import { getColumns } from "./columns"
import { ItemCategoryFormSheet } from "./item-category-form-sheet"
import {
  deleteItemCategory,
  bulkCheckItemCategoriesForDelete,
  bulkDeleteItemCategories,
  type ItemCategoryWithCounts,
} from "@/lib/actions/item-category.actions"
import { useUserRole } from "@/lib/contexts/user-role-context"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const DELETE_ERRORS: Record<string, string> = {
  HAS_ITEMS:  "사용 중인 품목분류는 삭제할 수 없습니다.",
  HAS_GROUPS: "품목군이 연결된 품목분류는 삭제할 수 없습니다.",
  NOT_FOUND:  "품목분류를 찾을 수 없습니다.",
  FORBIDDEN:  "권한이 없습니다.",
}

interface Props {
  data: ItemCategoryWithCounts[]
  canBulkDelete: boolean
}

export function ItemCategoryDataTable({ data, canBulkDelete }: Props) {
  const router     = useRouter()
  const canMutate  = useUserRole() !== "VIEWER"

  const [keyword,    setKeyword]    = useState("")
  const [sheetOpen,  setSheetOpen]  = useState(false)
  const [editTarget, setEditTarget] = useState<ItemCategoryWithCounts | null>(null)

  const [selectedItems, setSelectedItems]   = useState<ItemCategoryWithCounts[]>([])
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0)
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkChecking,   setBulkChecking]   = useState(false)
  const [bulkDeleting,   setBulkDeleting]   = useState(false)
  const [bulkCandidates, setBulkCandidates] = useState<BulkDeleteCandidate[]>([])

  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return data
    return data.filter((c) =>
      [c.code, c.name].join(" ").toLowerCase().includes(kw)
    )
  }, [data, keyword])

  const handleEdit = (cat: ItemCategoryWithCounts) => {
    setEditTarget(cat)
    setSheetOpen(true)
  }

  const handleDelete = async (cat: ItemCategoryWithCounts) => {
    if (!confirm(`"${cat.name}" 품목분류를 삭제하시겠습니까?`)) return
    try {
      await deleteItemCategory(cat.id)
      router.refresh()
    } catch (e: unknown) {
      const key = e instanceof Error ? e.message : ""
      alert(DELETE_ERRORS[key] ?? (e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다."))
    }
  }

  const handleBulkDeleteClick = async () => {
    setBulkDialogOpen(true)
    setBulkChecking(true)
    setBulkCandidates([])
    try {
      const result = await bulkCheckItemCategoriesForDelete(selectedItems.map((i) => i.id))
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
      const { deleted, blocked, failed } = await bulkDeleteItemCategories(deletableIds)
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

  const allColumns = getColumns({ onEdit: handleEdit, onDelete: handleDelete })
  const columns    = canMutate ? allColumns : allColumns.filter((c) => c.id !== "actions")

  return (
    <div className="space-y-4">
      {/* 툴바 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="코드 / 품목분류명 검색"
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
            품목분류 등록
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

      <ItemCategoryFormSheet
        mode={editTarget ? "edit" : "create"}
        category={editTarget}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) setEditTarget(null)
        }}
      />

      <BulkDeleteDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        entityLabel="품목분류"
        loading={bulkChecking}
        candidates={bulkCandidates}
        confirming={bulkDeleting}
        onConfirm={handleConfirmBulkDelete}
      />
    </div>
  )
}
