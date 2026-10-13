"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Download, Upload, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { BulkDeleteDialog, type BulkDeleteCandidate } from "@/components/common/bulk-delete-dialog"
import { getColumns } from "./columns"
import { ItemFormSheet } from "./item-form-sheet"
import { ItemExcelUploadDialog } from "./item-excel-upload-dialog"
import {
  deleteItem,
  updateItem,
  bulkCheckItemsForDelete,
  bulkDeleteItems,
  type ItemWithDetails,
  type WarehouseForItemForm,
} from "@/lib/actions/item.actions"
import { type ItemFormValues } from "./item-form-schema"
import { useUserRole } from "@/lib/contexts/user-role-context"

type Category = {
  id:       string
  code:     string
  name:     string
  itemType: string | null
}

type ItemGroupOption = {
  id:         string
  code:       string
  name:       string
  categoryId: string
}

interface ItemDataTableProps {
  items:         ItemWithDetails[]
  categories:    Category[]
  itemGroups:    ItemGroupOption[]
  warehouses:    WarehouseForItemForm[]
  tenantId:      string
  /** ADMIN 이상 또는 개발자 계정(loginId='test') 여부 — 서버에서 role 계층과 무관하게 계산해 전달한다. */
  canBulkDelete: boolean
}

export function ItemDataTable({ items, categories, itemGroups, warehouses, tenantId, canBulkDelete }: ItemDataTableProps) {
  const router        = useRouter()
  const role          = useUserRole()
  const canMutate     = role !== "VIEWER"
  const [formOpen,     setFormOpen]     = useState(false)
  const [formMode,     setFormMode]     = useState<"create" | "edit">("create")
  const [editingItem,  setEditingItem]  = useState<ItemWithDetails | null>(null)
  const [uploadOpen,   setUploadOpen]   = useState(false)

  const [selectedItems, setSelectedItems]   = useState<ItemWithDetails[]>([])
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0)
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkChecking,   setBulkChecking]   = useState(false)
  const [bulkDeleting,   setBulkDeleting]   = useState(false)
  const [bulkCandidates, setBulkCandidates] = useState<BulkDeleteCandidate[]>([])

  const handleEdit = (item: ItemWithDetails) => {
    setEditingItem(item)
    setFormMode("edit")
    setFormOpen(true)
  }

  const handleDelete = async (item: ItemWithDetails) => {
    if (!confirm(`'${item.name}' 품목을 삭제하시겠습니까?\n\n삭제 후 복구할 수 없습니다.`)) return
    try {
      await deleteItem(item.id)
      router.refresh()
    } catch (error) {
      const msg = error instanceof Error ? error.message : ""
      if (msg.startsWith("ITEM_IN_USE:")) {
        const detail = msg.replace("ITEM_IN_USE:", "")
        const deactivate = confirm(
          `이 품목은 다음 데이터에서 사용 중이므로 삭제할 수 없습니다.\n\n${detail}\n\n비활성 처리하시겠습니까? (데이터는 유지됩니다)`
        )
        if (deactivate) {
          try {
            await updateItem(item.id, { ...buildItemFormValues(item), status: "INACTIVE" })
            router.refresh()
          } catch {
            alert("비활성 처리에 실패했습니다.")
          }
        }
      } else {
        alert("삭제에 실패했습니다. 잠시 후 다시 시도해주세요.")
        console.error("삭제 실패:", error)
      }
    }
  }

  function buildItemFormValues(item: ItemWithDetails) {
    return {
      code:               item.code,
      name:               item.name,
      categoryId:         item.categoryId ?? "",
      itemGroupId:        item.itemGroupId ?? null,
      uom:                item.uom,
      spec:               item.spec ?? null,
      isLotTracked:       item.isLotTracked,
      isSerialTracked:    item.isSerialTracked,
      lotNumberingType:   item.lotNumberingType,
      lotPrefix:          item.lotPrefix ?? null,
      manualLotPolicy:    item.manualLotPolicy,
      status:             item.status,
      defaultWarehouseId: item.defaultWarehouseId ?? null,
    }
  }

  const handleBulkDeleteClick = async () => {
    setBulkDialogOpen(true)
    setBulkChecking(true)
    setBulkCandidates([])
    try {
      const result = await bulkCheckItemsForDelete(selectedItems.map((i) => i.id))
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
      const { deleted, blocked, failed } = await bulkDeleteItems(deletableIds)
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

  const defaultValues: Partial<ItemFormValues> | undefined = editingItem
    ? {
        code:            editingItem.code,
        name:            editingItem.name,
        categoryId:      editingItem.categoryId ?? "",
        itemGroupId:     editingItem.itemGroupId ?? null,
        uom:             editingItem.uom,
        spec:            editingItem.spec ?? null,
        isLotTracked:    editingItem.isLotTracked,
        isSerialTracked: editingItem.isSerialTracked,
        lotNumberingType: editingItem.lotNumberingType,
        lotPrefix:       editingItem.lotPrefix ?? null,
        manualLotPolicy: editingItem.manualLotPolicy,
        status:          editingItem.status,
        defaultWarehouseId: editingItem.defaultWarehouseId ?? null,
      }
    : undefined

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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-[13px] h-9"
            onClick={async () => {
              const { default: downloadTemplate } = await import("./item-excel-download")
              downloadTemplate()
            }}
          >
            <Download className="h-4 w-4" />
            양식 다운로드
          </Button>
          {canMutate && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-[13px] h-9"
                onClick={() => setUploadOpen(true)}
              >
                <Upload className="h-4 w-4" />
                엑셀 업로드
              </Button>
              <Button
                size="sm"
                className="gap-1.5 text-[13px] h-9"
                onClick={() => {
                  setEditingItem(null)
                  setFormMode("create")
                  setFormOpen(true)
                }}
              >
                <Plus className="h-4 w-4" />
                품목 등록
              </Button>
            </>
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(item) => item.id}
        enableRowSelection={canBulkDelete}
        onSelectionChange={setSelectedItems}
        clearSelectionSignal={clearSelectionSignal}
        searchableColumns={[{ id: "name", title: "코드/품목명" }]}
        filterableColumns={[
          {
            id:    "itemType",
            title: "시스템 유형",
            options: [
              { label: "원자재", value: "RAW_MATERIAL" },
              { label: "반제품", value: "SEMI_FINISHED" },
              { label: "완제품", value: "FINISHED" },
              { label: "소모품", value: "CONSUMABLE" },
            ],
          },
          {
            id:    "status",
            title: "상태",
            options: [
              { label: "활성",  value: "ACTIVE" },
              { label: "비활성", value: "INACTIVE" },
              { label: "단종",  value: "DISCONTINUED" },
            ],
          },
        ]}
      />

      <ItemExcelUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />

      <ItemFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        defaultValues={defaultValues}
        itemId={editingItem?.id}
        categories={categories}
        itemGroups={itemGroups}
        warehouses={warehouses}
        tenantId={tenantId}
      />

      <BulkDeleteDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        entityLabel="품목"
        loading={bulkChecking}
        candidates={bulkCandidates}
        confirming={bulkDeleting}
        onConfirm={handleConfirmBulkDelete}
      />
    </div>
  )
}
