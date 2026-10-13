"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { BulkDeleteDialog, type BulkDeleteCandidate } from "@/components/common/bulk-delete-dialog"
import {
  DefectCodeRow,
  deleteDefectCode,
  bulkCheckDefectCodesForDelete,
  bulkDeleteDefectCodes,
} from "@/lib/actions/quality.actions"
import { getDefectColumns, DEFECT_CATEGORY_CONFIG } from "./defect-columns"
import { DefectFormSheet } from "./defect-form-sheet"

// ─── Types ────────────────────────────────────────────────────────────────────

interface DefectDataTableProps {
  data: DefectCodeRow[]
  tenantId: string
  canBulkDelete: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DefectDataTable({ data, tenantId, canBulkDelete }: DefectDataTableProps) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<DefectCodeRow | null>(null)

  const [selectedItems, setSelectedItems] = useState<DefectCodeRow[]>([])
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0)
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkChecking, setBulkChecking] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkCandidates, setBulkCandidates] = useState<BulkDeleteCandidate[]>([])

  function handleCreate() {
    setEditingRow(null)
    setFormOpen(true)
  }

  function handleEdit(row: DefectCodeRow) {
    setEditingRow(row)
    setFormOpen(true)
  }

  async function handleDelete(row: DefectCodeRow) {
    if (!confirm(`'${row.name}' 불량코드를 삭제하시겠습니까?`)) return
    try {
      await deleteDefectCode(row.id)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  const handleBulkDeleteClick = async () => {
    setBulkDialogOpen(true)
    setBulkChecking(true)
    setBulkCandidates([])
    try {
      const result = await bulkCheckDefectCodesForDelete(selectedItems.map((i) => i.id))
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
      const { deleted, blocked, failed } = await bulkDeleteDefectCodes(deletableIds)
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

  const columns = getDefectColumns({ onEdit: handleEdit, onDelete: handleDelete })

  const filterableColumns = [
    {
      id: "defectCategory" as keyof DefectCodeRow,
      title: "불량유형",
      options: Object.entries(DEFECT_CATEGORY_CONFIG).map(([value, cfg]) => ({
        label: cfg.label,
        value,
      })),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
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
        <Button onClick={handleCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          불량코드 등록
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        getRowId={(item) => item.id}
        enableRowSelection={canBulkDelete}
        onSelectionChange={setSelectedItems}
        clearSelectionSignal={clearSelectionSignal}
        searchableColumns={[
          { id: "code" as keyof DefectCodeRow, title: "불량코드" },
          { id: "name" as keyof DefectCodeRow, title: "불량명" },
        ]}
        filterableColumns={filterableColumns}
      />

      <DefectFormSheet
        tenantId={tenantId}
        open={formOpen}
        onOpenChange={setFormOpen}
        editingRow={editingRow}
      />

      <BulkDeleteDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        entityLabel="불량코드"
        loading={bulkChecking}
        candidates={bulkCandidates}
        confirming={bulkDeleting}
        onConfirm={handleConfirmBulkDelete}
      />
    </div>
  )
}
