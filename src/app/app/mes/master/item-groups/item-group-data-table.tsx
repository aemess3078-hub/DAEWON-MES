"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, Plus, Trash2 } from "lucide-react"
import { DataTable } from "@/components/common/data-table"
import { BulkDeleteDialog, type BulkDeleteCandidate } from "@/components/common/bulk-delete-dialog"
import { getColumns } from "./columns"
import { ItemGroupFormSheet } from "./item-group-form-sheet"
import {
  deleteItemGroup,
  bulkCheckItemGroupsForDelete,
  bulkDeleteItemGroups,
  type ItemGroupWithDetails,
} from "@/lib/actions/item-group.actions"
import { useUserRole } from "@/lib/contexts/user-role-context"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

type Category = { id: string; code: string; name: string }

const DELETE_ERRORS: Record<string, string> = {
  HAS_ITEMS: "사용 중인 품목군은 삭제할 수 없습니다.",
  NOT_FOUND: "품목군을 찾을 수 없습니다.",
  FORBIDDEN: "권한이 없습니다.",
}

interface Props {
  data:          ItemGroupWithDetails[]
  categories:    Category[]
  canBulkDelete: boolean
}

export function ItemGroupDataTable({ data, categories, canBulkDelete }: Props) {
  const router    = useRouter()
  const canMutate = useUserRole() !== "VIEWER"

  const [keyword,    setKeyword]    = useState("")
  const [categoryId, setCategoryId] = useState("all")
  const [sheetOpen,  setSheetOpen]  = useState(false)
  const [editTarget, setEditTarget] = useState<ItemGroupWithDetails | null>(null)

  const [selectedItems, setSelectedItems]   = useState<ItemGroupWithDetails[]>([])
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0)
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkChecking,   setBulkChecking]   = useState(false)
  const [bulkDeleting,   setBulkDeleting]   = useState(false)
  const [bulkCandidates, setBulkCandidates] = useState<BulkDeleteCandidate[]>([])

  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return data.filter((g) => {
      if (categoryId !== "all" && g.categoryId !== categoryId) return false
      if (kw) {
        const hay = [g.code, g.name, g.category.name, g.description ?? ""].join(" ").toLowerCase()
        if (!hay.includes(kw)) return false
      }
      return true
    })
  }, [data, keyword, categoryId])

  const handleEdit = (g: ItemGroupWithDetails) => {
    setEditTarget(g)
    setSheetOpen(true)
  }

  const handleDelete = async (g: ItemGroupWithDetails) => {
    if (!confirm(`"${g.name}" 품목군을 삭제하시겠습니까?`)) return
    try {
      await deleteItemGroup(g.id)
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
      const result = await bulkCheckItemGroupsForDelete(selectedItems.map((i) => i.id))
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
      const { deleted, blocked, failed } = await bulkDeleteItemGroups(deletableIds)
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
              placeholder="코드 / 품목군명 / 설명 검색"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="h-9 w-[260px] pl-9 text-[14px]"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[14px] text-muted-foreground whitespace-nowrap">품목분류</span>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-[180px] text-[14px]">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-[14px]">전체</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-[14px]">
                    {c.name}
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
            onClick={() => { setEditTarget(null); setSheetOpen(true) }}
          >
            <Plus className="h-4 w-4 mr-2" />
            품목군 등록
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

      <ItemGroupFormSheet
        mode={editTarget ? "edit" : "create"}
        group={editTarget}
        categories={categories}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) setEditTarget(null)
        }}
      />

      <BulkDeleteDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        entityLabel="품목군"
        loading={bulkChecking}
        candidates={bulkCandidates}
        confirming={bulkDeleting}
        onConfirm={handleConfirmBulkDelete}
      />
    </div>
  )
}
