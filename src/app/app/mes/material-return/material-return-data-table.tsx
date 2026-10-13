"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { useUserRole } from "@/lib/contexts/user-role-context"
import { getColumns, MaterialReturnRow } from "./columns"
import { MaterialReturnDetailSheet } from "./return-detail-sheet"
import { ReturnFormDialog } from "./return-form-dialog"

interface MaterialReturnDataTableProps {
  data: MaterialReturnRow[]
}

export function MaterialReturnDataTable({ data }: MaterialReturnDataTableProps) {
  const router = useRouter()
  const role = useUserRole()
  const canMutate = role !== "VIEWER"
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailReturnId, setDetailReturnId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const handleViewDetail = (row: MaterialReturnRow) => {
    setDetailReturnId(row.id)
    setDetailOpen(true)
  }

  const columns = getColumns(handleViewDetail)

  const supplierOptions = useMemo(() => {
    const names = new Set<string>()
    data.forEach((row) => names.add(row.supplier.name))
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b, "ko"))
      .map((name) => ({ label: name, value: name }))
  }, [data])

  const siteOptions = useMemo(() => {
    const names = new Set<string>()
    data.forEach((row) => names.add(row.site.name))
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b, "ko"))
      .map((name) => ({ label: name, value: name }))
  }, [data])

  const filterableColumns = [
    {
      id: "status" as keyof MaterialReturnRow,
      title: "상태",
      options: [
        { label: "임시저장", value: "DRAFT" },
        { label: "반품완료", value: "COMPLETED" },
        { label: "취소됨", value: "CANCELLED" },
      ],
    },
    {
      id: "siteName" as keyof MaterialReturnRow,
      title: "사업장",
      options: siteOptions,
    },
    {
      id: "supplierName" as keyof MaterialReturnRow,
      title: "공급사",
      options: supplierOptions,
    },
  ]

  return (
    <div className="space-y-4">
      {canMutate && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            반품 등록
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={data}
        searchableColumns={[
          { id: "returnNo" as keyof MaterialReturnRow, title: "반품번호" },
          { id: "supplierName" as keyof MaterialReturnRow, title: "공급사" },
          { id: "purchaseOrderNo" as keyof MaterialReturnRow, title: "발주번호" },
        ]}
        filterableColumns={filterableColumns}
      />

      <MaterialReturnDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        returnId={detailReturnId}
        onChanged={() => router.refresh()}
      />

      <ReturnFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSuccess={() => {
          setCreateOpen(false)
          router.refresh()
        }}
      />
    </div>
  )
}
