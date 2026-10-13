"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Copy, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { useUserRole } from "@/lib/contexts/user-role-context"
import {
  DataTagRow,
  deleteTag,
} from "@/lib/actions/equipment-integration.actions"
import {
  getTagColumns,
  TAG_DATA_TYPE_CONFIG,
  TAG_CATEGORY_CONFIG,
} from "./tag-columns"
import { TagFormSheet } from "./tag-form-sheet"
import { CopyTagsDialog } from "./copy-tags-dialog"

interface TagDataTableProps {
  data: DataTagRow[]
  connections: {
    id: string
    protocol: string
    equipment: { id: string; code: string; name: string }
    gateway: { name: string }
    _count?: { tags: number }
  }[]
}

export function TagDataTable({ data, connections }: TagDataTableProps) {
  const router = useRouter()
  const canMutate = useUserRole() !== "VIEWER"
  const [formOpen, setFormOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<DataTagRow | null>(null)

  function handleCreate() {
    setEditingRow(null)
    setFormOpen(true)
  }

  function handleEdit(row: DataTagRow) {
    setEditingRow(row)
    setFormOpen(true)
  }

  async function handleDelete(row: DataTagRow) {
    if (!confirm(`'${row.displayName}' (${row.tagCode}) 태그를 삭제하시겠습니까?`)) return
    try {
      await deleteTag(row.id)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  const columns = getTagColumns({
    onEdit: handleEdit,
    onDelete: handleDelete,
    onRefresh: () => router.refresh(),
  })

  const filterableColumns = [
    {
      id: "dataType" as keyof DataTagRow,
      title: "데이터 타입",
      options: Object.entries(TAG_DATA_TYPE_CONFIG).map(([value, cfg]) => ({
        label: cfg.label,
        value,
      })),
    },
    {
      id: "category" as keyof DataTagRow,
      title: "카테고리",
      options: Object.entries(TAG_CATEGORY_CONFIG).map(([value, cfg]) => ({
        label: cfg.label,
        value,
      })),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {canMutate && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCopyOpen(true)}
              className="gap-2"
            >
              <Copy className="h-4 w-4" />
              다른 설비에서 복사
            </Button>
            <Button onClick={handleCreate} className="gap-2">
              <Plus className="h-4 w-4" />
              태그 등록
            </Button>
          </>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data}
        searchableColumns={[
          { id: "tagCode" as keyof DataTagRow, title: "태그코드" },
          { id: "displayName" as keyof DataTagRow, title: "표시명" },
        ]}
        filterableColumns={filterableColumns}
      />

      <TagFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        editingRow={editingRow}
        connections={connections}
      />

      <CopyTagsDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        connections={connections}
        onCopied={() => router.refresh()}
      />
    </div>
  )
}
