"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { useUserRole } from "@/lib/contexts/user-role-context"
import { getColumns, ProjectOrderPriceRow } from "./columns"
import { ProjectPriceDetailSheet } from "./project-price-detail-sheet"
import { ProjectPriceFormDialog } from "./project-price-form-dialog"

interface ProjectPriceDataTableProps {
  data: ProjectOrderPriceRow[]
}

export function ProjectPriceDataTable({ data }: ProjectPriceDataTableProps) {
  const router = useRouter()
  const role = useUserRole()
  const canRegister = role !== "VIEWER"

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailPriceId, setDetailPriceId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const handleViewDetail = (row: ProjectOrderPriceRow) => {
    setDetailPriceId(row.id)
    setDetailOpen(true)
  }

  const columns = getColumns(handleViewDetail)

  const customerOptions = useMemo(() => {
    const names = new Set<string>()
    data.forEach((row) => names.add(row.customer.name))
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b, "ko"))
      .map((name) => ({ label: name, value: name }))
  }, [data])

  const filterableColumns = [
    {
      id: "status" as keyof ProjectOrderPriceRow,
      title: "상태",
      options: [
        { label: "임시저장", value: "DRAFT" },
        { label: "결정완료", value: "DECIDED" },
      ],
    },
    {
      id: "customer" as keyof ProjectOrderPriceRow,
      title: "거래처",
      options: customerOptions,
    },
  ]

  return (
    <div className="space-y-4">
      {canRegister && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            단가 등록
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={data}
        searchableColumns={[
          { id: "project" as keyof ProjectOrderPriceRow, title: "프로젝트" },
          { id: "customer" as keyof ProjectOrderPriceRow, title: "거래처" },
          { id: "item" as keyof ProjectOrderPriceRow, title: "품목" },
        ]}
        filterableColumns={filterableColumns}
      />

      <ProjectPriceDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        priceId={detailPriceId}
        onChanged={() => router.refresh()}
      />

      <ProjectPriceFormDialog
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
