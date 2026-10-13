"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { getColumns } from "./columns"
import { QuotationFormSheet } from "./quotation-form-sheet"
import { deleteQuotation, convertToSalesOrder, type QuotationWithDetails } from "@/lib/actions/quotation.actions"

interface Props {
  quotations: QuotationWithDetails[]
  customers: { id: string; code: string; name: string }[]
  items: { id: string; code: string; name: string; itemType: string; uom: string }[]
  sites: { id: string; code: string; name: string; type: string }[]
  tenantId: string
}

export function QuotationDataTable({ quotations, customers, items, sites, tenantId }: Props) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<"create" | "edit">("create")
  const [editingQuotation, setEditingQuotation] = useState<QuotationWithDetails | null>(null)
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null)

  const handleEdit = (q: QuotationWithDetails) => {
    setEditingQuotation(q)
    setFormMode("edit")
    setFormOpen(true)
  }

  const handleDelete = async (q: QuotationWithDetails) => {
    if (!confirm(`'${q.quotationNo}' 견적을 삭제하시겠습니까?`)) return
    try {
      await deleteQuotation(q.id)
      router.refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제 실패")
    }
  }

  const handleConvert = async (q: QuotationWithDetails) => {
    if (!confirm(`'${q.quotationNo}' 견적을 수주로 전환하시겠습니까?`)) return
    try {
      await convertToSalesOrder(q.id, tenantId)
      setMessage({ text: `수주가 생성되었습니다. 수주관리에서 확인하세요.`, type: "success" })
      router.refresh()
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "전환 실패", type: "error" })
    }
  }

  const columns = getColumns({
    onEdit: handleEdit,
    onDelete: handleDelete,
    onConvert: handleConvert,
  })

  return (
    <div className="space-y-4">
      {message && (
        <div className={`px-4 py-3 rounded-lg text-[14px] border ${
          message.type === "success"
            ? "bg-emerald-50 border-emerald-200 text-emerald-700"
            : "bg-red-50 border-red-200 text-red-700"
        }`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-2 underline text-[12px]">닫기</button>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditingQuotation(null)
            setFormMode("create")
            setFormOpen(true)
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          견적 등록
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={quotations}
        searchableColumns={[
          { id: "quotationNo" as keyof QuotationWithDetails, title: "견적번호" },
          { id: "customerName" as keyof QuotationWithDetails, title: "고객사" },
        ]}
        filterableColumns={[
          {
            id: "status" as keyof QuotationWithDetails,
            title: "상태",
            options: [
              { label: "초안", value: "DRAFT" },
              { label: "제출됨", value: "SUBMITTED" },
              { label: "협상중", value: "NEGOTIATING" },
              { label: "수주확정", value: "WON" },
              { label: "실패", value: "LOST" },
              { label: "만료", value: "EXPIRED" },
              { label: "취소", value: "CANCELLED" },
            ],
          },
        ]}
      />

      <QuotationFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        quotation={editingQuotation}
        customers={customers}
        items={items}
        sites={sites}
        tenantId={tenantId}
      />
    </div>
  )
}
