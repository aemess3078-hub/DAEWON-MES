"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import {
  EdgeGatewayRow,
  deleteGateway,
} from "@/lib/actions/equipment-integration.actions"
import {
  getGatewayColumns,
  GATEWAY_STATUS_CONFIG,
} from "./gateway-columns"
import { GatewayFormSheet } from "./gateway-form-sheet"

// ─── Types ────────────────────────────────────────────────────────────────────

interface GatewayDataTableProps {
  data: EdgeGatewayRow[]
  tenantId: string
  sites: { id: string; code: string; name: string }[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GatewayDataTable({ data, tenantId, sites }: GatewayDataTableProps) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<EdgeGatewayRow | null>(null)

  function handleCreate() {
    setEditingRow(null)
    setFormOpen(true)
  }

  function handleEdit(row: EdgeGatewayRow) {
    setEditingRow(row)
    setFormOpen(true)
  }

  async function handleDelete(row: EdgeGatewayRow) {
    if (!confirm(`'${row.name}' 게이트웨이를 삭제하시겠습니까?`)) return
    try {
      await deleteGateway(row.id)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  const columns = getGatewayColumns({ onEdit: handleEdit, onDelete: handleDelete })

  const filterableColumns = [
    {
      id: "status" as keyof EdgeGatewayRow,
      title: "상태",
      options: Object.entries(GATEWAY_STATUS_CONFIG).map(([value, cfg]) => ({
        label: cfg.label,
        value,
      })),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={handleCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          게이트웨이 등록
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        searchableColumns={[
          { id: "name" as keyof EdgeGatewayRow, title: "이름" },
        ]}
        filterableColumns={filterableColumns}
      />

      <GatewayFormSheet
        tenantId={tenantId}
        sites={sites}
        open={formOpen}
        onOpenChange={setFormOpen}
        editingRow={editingRow}
      />
    </div>
  )
}
