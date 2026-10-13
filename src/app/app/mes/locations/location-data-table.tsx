"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { DataTable } from "@/components/common/data-table"
import { BulkDeleteDialog, type BulkDeleteCandidate } from "@/components/common/bulk-delete-dialog"
import { getColumns } from "./columns"
import { LocationFormSheet } from "./location-form-sheet"
import {
  LocationWithSite,
  deleteLocation,
  bulkCheckLocationsForDelete,
  bulkDeleteLocations,
} from "@/lib/actions/location.actions"
import { Button } from "@/components/ui/button"
import { Plus, Trash2 } from "lucide-react"

type Props = {
  data: LocationWithSite[]
  sites: { id: string; code: string; name: string }[]
  canBulkDelete: boolean
}

export function LocationDataTable({ data, sites, canBulkDelete }: Props) {
  const router = useRouter()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<LocationWithSite | null>(null)

  const [selectedItems, setSelectedItems] = useState<LocationWithSite[]>([])
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0)
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkChecking, setBulkChecking] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkCandidates, setBulkCandidates] = useState<BulkDeleteCandidate[]>([])

  const handleEdit = (location: LocationWithSite) => {
    setEditTarget(location)
    setSheetOpen(true)
  }

  const handleDelete = async (location: LocationWithSite) => {
    if (!confirm(`"${location.name}" 로케이션을 삭제하시겠습니까?`)) return
    try {
      await deleteLocation(location.id)
      router.refresh()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const handleBulkDeleteClick = async () => {
    setBulkDialogOpen(true)
    setBulkChecking(true)
    setBulkCandidates([])
    try {
      const result = await bulkCheckLocationsForDelete(selectedItems.map((i) => i.id))
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
      const { deleted, blocked, failed } = await bulkDeleteLocations(deletableIds)
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

  const columns = getColumns({ onEdit: handleEdit, onDelete: handleDelete })

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
        <Button
          onClick={() => {
            setEditTarget(null)
            setSheetOpen(true)
          }}
          size="sm"
        >
          <Plus className="h-4 w-4 mr-2" />
          로케이션 등록
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        getRowId={(item) => item.id}
        enableRowSelection={canBulkDelete}
        onSelectionChange={setSelectedItems}
        clearSelectionSignal={clearSelectionSignal}
        searchableColumns={[{ id: "name", title: "이름" }]}
        filterableColumns={[]}
      />

      <LocationFormSheet
        mode={editTarget ? "edit" : "create"}
        location={editTarget}
        sites={sites}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) setEditTarget(null)
        }}
      />

      <BulkDeleteDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        entityLabel="로케이션"
        loading={bulkChecking}
        candidates={bulkCandidates}
        confirming={bulkDeleting}
        onConfirm={handleConfirmBulkDelete}
      />
    </div>
  )
}
