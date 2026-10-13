"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { getColumns, ProjectOrderRow } from "./columns"
import { ProjectOrderFormSheet } from "./project-order-form-sheet"
import { ProjectOrderDetailSheet } from "./project-order-detail-sheet"
import { deleteProjectOrder } from "@/lib/actions/project-order.actions"
import { useUserRole } from "@/lib/contexts/user-role-context"
import type { SearchableItemOption } from "@/components/common/searchable-item-combobox"

type SiteOption = { id: string; code: string; name: string }
type CustomerOption = { id: string; code: string; name: string }
type ItemOption = SearchableItemOption
type UserOption = { id: string; name: string }
type SalesOrderOption = {
  id: string
  orderNo: string
  customerId: string
  customer: { id: string; code: string; name: string }
  siteId: string
  deliveryDate: Date | string
  items: ItemOption[]
}

interface ProjectOrderDataTableProps {
  data: ProjectOrderRow[]
  sites: SiteOption[]
  customers: CustomerOption[]
  items: ItemOption[]
  users: UserOption[]
  salesOrders: SalesOrderOption[]
}

export function ProjectOrderDataTable({
  data,
  sites,
  customers,
  items,
  users,
  salesOrders,
}: ProjectOrderDataTableProps) {
  const router = useRouter()
  const canMutate = useUserRole() !== "VIEWER"

  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<"create" | "edit">("create")
  const [editingOrder, setEditingOrder] = useState<ProjectOrderRow | null>(null)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailOrder, setDetailOrder] = useState<ProjectOrderRow | null>(null)

  const handleEdit = (row: ProjectOrderRow) => {
    setEditingOrder(row)
    setFormMode("edit")
    setFormOpen(true)
  }

  const handleViewDetail = (row: ProjectOrderRow) => {
    setDetailOrder(row)
    setDetailOpen(true)
  }

  const handleDelete = async (row: ProjectOrderRow) => {
    if (row.status !== "DRAFT") {
      alert("DRAFT 상태인 프로젝트 오더만 삭제할 수 있습니다.")
      return
    }
    if (!confirm(`'${row.name}' 프로젝트 오더를 삭제하시겠습니까?`)) return

    const result = await deleteProjectOrder(row.id)
    if (!result.ok) {
      alert(result.error ?? "삭제 중 오류가 발생했습니다.")
      return
    }
    router.refresh()
  }

  const allColumns = getColumns(handleEdit, handleDelete, handleViewDetail)
  const columns = canMutate ? allColumns : allColumns.filter((c) => c.id !== "actions")

  const filterableColumns = [
    {
      id: "status" as keyof ProjectOrderRow,
      title: "상태",
      options: [
        { label: "초안", value: "DRAFT" },
        { label: "수주확정", value: "CONFIRMED" },
        { label: "진행중", value: "IN_PROGRESS" },
        { label: "보류", value: "ON_HOLD" },
        { label: "완료", value: "COMPLETED" },
        { label: "취소", value: "CANCELLED" },
      ],
    },
    {
      id: "priority" as keyof ProjectOrderRow,
      title: "우선순위",
      options: [
        { label: "낮음", value: "LOW" },
        { label: "보통", value: "MEDIUM" },
        { label: "높음", value: "HIGH" },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      {canMutate && (
        <div className="flex justify-end">
          <Button
            onClick={() => {
              setEditingOrder(null)
              setFormMode("create")
              setFormOpen(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            프로젝트 오더 등록
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={data}
        searchableColumns={[
          { id: "code" as keyof ProjectOrderRow, title: "오더번호" },
          { id: "name" as keyof ProjectOrderRow, title: "프로젝트명" },
          { id: "customer" as keyof ProjectOrderRow, title: "거래처" },
        ]}
        filterableColumns={filterableColumns}
      />

      <ProjectOrderFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        projectOrder={editingOrder}
        sites={sites}
        customers={customers}
        items={items}
        users={users}
        salesOrders={salesOrders}
      />

      <ProjectOrderDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        projectOrder={detailOrder}
      />
    </div>
  )
}
