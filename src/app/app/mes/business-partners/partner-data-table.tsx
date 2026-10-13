"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Download, Plus, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { getColumns } from "./columns"
import { PartnerFormSheet } from "./partner-form-sheet"
import { PartnerDetailPanel } from "./partner-detail-panel"
import { PartnerExcelUploadDialog } from "./partner-excel-upload-dialog"
import downloadPartnerTemplate from "./partner-excel-download"
import { deleteBusinessPartner, BusinessPartner } from "@/lib/actions/business-partner.actions"
import { PartnerFormValues } from "./partner-form-schema"
import { PartnerType } from "@prisma/client"

interface PartnerDataTableProps {
  partners: BusinessPartner[]
  fixedType: PartnerType
  entityName: string
}

export function PartnerDataTable({ partners, fixedType, entityName }: PartnerDataTableProps) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [formMode, setFormMode] = useState<"create" | "edit">("create")
  const [editingPartner, setEditingPartner] = useState<BusinessPartner | null>(null)
  const [expandedPartnerId, setExpandedPartnerId] = useState<string | null>(null)

  const handleEdit = (partner: BusinessPartner) => {
    setEditingPartner(partner)
    setFormMode("edit")
    setFormOpen(true)
  }

  const handleDelete = async (partner: BusinessPartner) => {
    if (!confirm(`'${partner.name}'을(를) 삭제하시겠습니까?`)) return
    try {
      await deleteBusinessPartner(partner.id)
      router.refresh()
    } catch {
      alert("삭제에 실패했습니다. 연관된 데이터가 있을 수 있습니다.")
    }
  }

  const handleToggleExpand = (partner: BusinessPartner) => {
    setExpandedPartnerId((prev) => (prev === partner.id ? null : partner.id))
  }

  const columns = getColumns({
    onEdit: handleEdit,
    onDelete: handleDelete,
    onViewCode: handleToggleExpand,
  })

  const defaultValues: Partial<PartnerFormValues> | undefined = editingPartner
    ? {
        code: editingPartner.code,
        name: editingPartner.name,
        partnerType: editingPartner.partnerType,
        status: editingPartner.status,
        businessNumber: editingPartner.businessNumber ?? "",
        ceoName: editingPartner.ceoName ?? "",
        phone: editingPartner.phone ?? "",
        email: editingPartner.email ?? "",
        email2: editingPartner.email2 ?? "",
        address: editingPartner.address ?? "",
        contactName: editingPartner.contactName ?? "",
        contactPhone: editingPartner.contactPhone ?? "",
        remark: editingPartner.remark ?? "",
      }
    : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => downloadPartnerTemplate(fixedType)} className="gap-2">
          <Download className="h-4 w-4" />
          엑셀 양식
        </Button>
        <Button variant="outline" onClick={() => setUploadOpen(true)} className="gap-2">
          <Upload className="h-4 w-4" />
          엑셀 업로드
        </Button>
        <Button
          onClick={() => {
            setEditingPartner(null)
            setFormMode("create")
            setFormOpen(true)
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {entityName} 등록
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={partners}
        getRowId={(row) => row.id}
        expandOnRowClick
        expandedRowId={expandedPartnerId}
        onExpandedRowIdChange={setExpandedPartnerId}
        renderExpandedRow={(partner) => (
          <PartnerDetailPanel
            partner={partner}
            onClose={() => setExpandedPartnerId(null)}
          />
        )}
        searchableColumns={[{ id: "name", title: "코드/이름" }]}
        filterableColumns={[
          {
            id: "partnerType",
            title: "유형",
            options: [
              { label: "고객사", value: "CUSTOMER" },
              { label: "거래처", value: "SUPPLIER" },
              { label: "고객사 + 거래처", value: "BOTH" },
            ],
          },
          {
            id: "status",
            title: "상태",
            options: [
              { label: "활성", value: "ACTIVE" },
              { label: "비활성", value: "INACTIVE" },
            ],
          },
        ]}
      />

      <PartnerFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        defaultValues={defaultValues}
        partnerId={editingPartner?.id}
        fixedType={fixedType}
      />
      <PartnerExcelUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} fixedType={fixedType} />
    </div>
  )
}
