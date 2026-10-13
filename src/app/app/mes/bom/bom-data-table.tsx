"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Download, FileSpreadsheet, Plus, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { getColumns } from "./columns"
import { BomFormSheet } from "./bom-form-sheet"
import { BomDetailPanel } from "./bom-detail-panel"
import { BomExcelUploadDialog } from "./bom-excel-upload-dialog"
import { downloadBomTemplate, downloadBomData } from "./bom-excel-download"
import { getBomExportData } from "@/lib/actions/bom-excel.actions"
import { deleteBom, BOMWithDetails } from "@/lib/actions/bom.actions"
import { BOMFormValues } from "./bom-form-schema"
import { BOMStatus } from "@prisma/client"
import { useUserRole } from "@/lib/contexts/user-role-context"

interface ParentItem {
  id: string
  code: string
  name: string
  itemType: string
}

interface ComponentItem {
  id: string
  code: string
  name: string
  itemType: string
  uom: string
}

interface BomDataTableProps {
  boms: BOMWithDetails[]
  parentItems: ParentItem[]
  componentItems: ComponentItem[]
  tenantId: string
}

export function BomDataTable({
  boms,
  parentItems,
  componentItems,
  tenantId,
}: BomDataTableProps) {
  const router = useRouter()
  const canMutate = useUserRole() !== "VIEWER"
  const [formOpen, setFormOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [formMode, setFormMode] = useState<"create" | "edit">("create")
  const [editingBom, setEditingBom] = useState<BOMWithDetails | null>(null)
  const [expandedBomId, setExpandedBomId] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)

  const handleDownloadCurrent = async () => {
    setIsDownloading(true)
    try {
      const rows = await getBomExportData()
      await downloadBomData(rows)
    } finally {
      setIsDownloading(false)
    }
  }

  const handleSelect = (bom: BOMWithDetails) => {
    setExpandedBomId((prev) => (prev === bom.id ? null : bom.id))
  }

  const handleEdit = (bom: BOMWithDetails) => {
    setEditingBom(bom)
    setFormMode("edit")
    setFormOpen(true)
  }

  const handleDelete = async (bom: BOMWithDetails) => {
    if (!confirm(`'${bom.item.name} (v${bom.version})' BOM을 삭제하시겠습니까?`)) return
    try {
      await deleteBom(bom.id)
      router.refresh()
    } catch (error) {
      console.error("삭제 실패:", error)
    }
  }

  const allColumns = getColumns({
    onEdit: handleEdit,
    onDelete: handleDelete,
    onSelect: handleSelect,
    selectedId: expandedBomId,
  })
  const columns = canMutate ? allColumns : allColumns.filter((c) => c.id !== "actions")

  const defaultValues: Partial<BOMFormValues> | undefined = editingBom
    ? {
        itemId: editingBom.itemId,
        version: editingBom.version,
        isDefault: editingBom.isDefault,
        status: editingBom.status as BOMStatus,
        bomItems: editingBom.bomItems.map((bi) => ({
          componentItemId: bi.componentItemId,
          seq: bi.seq,
          qtyPer: Number(bi.qtyPer),
          scrapRate: Number(bi.scrapRate),
        })),
      }
    : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={downloadBomTemplate} className="gap-2">
          <Download className="h-4 w-4" />
          엑셀 양식
        </Button>
        <Button variant="outline" onClick={handleDownloadCurrent} disabled={isDownloading} className="gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          {isDownloading ? "다운로드 중..." : "현재 BOM 다운로드"}
        </Button>
        {canMutate && (
          <Button variant="outline" onClick={() => setUploadOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" />
            엑셀 업로드
          </Button>
        )}
        {canMutate && (
          <Button
            onClick={() => {
              setEditingBom(null)
              setFormMode("create")
              setFormOpen(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            BOM 등록
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={boms}
        searchableColumns={[{ id: "itemName" as keyof BOMWithDetails, title: "품목명" }]}
        filterableColumns={[
          {
            id: "itemType" as keyof BOMWithDetails,
            title: "품목유형",
            options: [
              { label: "반제품", value: "SEMI_FINISHED" },
              { label: "완제품", value: "FINISHED" },
            ],
          },
          {
            id: "status" as keyof BOMWithDetails,
            title: "상태",
            options: [
              { label: "초안", value: "DRAFT" },
              { label: "활성", value: "ACTIVE" },
              { label: "비활성", value: "INACTIVE" },
            ],
          },
        ]}
        getRowId={(row) => row.id}
        expandedRowId={expandedBomId}
        onExpandedRowIdChange={setExpandedBomId}
        expandOnRowClick
        renderExpandedRow={(bom) => (
          <BomDetailPanel
            bom={bom}
            onClose={() => setExpandedBomId(null)}
          />
        )}
      />

      <BomFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        defaultValues={defaultValues}
        bomId={editingBom?.id}
        parentItems={parentItems}
        componentItems={componentItems}
        tenantId={tenantId}
      />
      <BomExcelUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  )
}
