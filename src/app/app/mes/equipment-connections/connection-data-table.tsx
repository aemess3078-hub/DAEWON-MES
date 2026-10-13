"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import {
  EquipmentConnectionRow,
  deleteConnection,
} from "@/lib/actions/equipment-integration.actions"
import { getConnectionColumns, PROTOCOL_CONFIG } from "./connection-columns"
import { ConnectionFormSheet } from "./connection-form-sheet"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectionDataTableProps {
  data: EquipmentConnectionRow[]
  equipments: { id: string; code: string; name: string; workCenter: { name: string } }[]
  gateways: { id: string; name: string; status: string }[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectionDataTable({
  data,
  equipments,
  gateways,
}: ConnectionDataTableProps) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<EquipmentConnectionRow | null>(null)

  function handleCreate() {
    setEditingRow(null)
    setFormOpen(true)
  }

  function handleEdit(row: EquipmentConnectionRow) {
    setEditingRow(row)
    setFormOpen(true)
  }

  async function handleDelete(row: EquipmentConnectionRow) {
    if (!confirm(`'${row.equipment.name} — ${row.gateway.name}' 연결을 삭제하시겠습니까?`)) return
    try {
      await deleteConnection(row.id)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  const columns = getConnectionColumns({
    onEdit: handleEdit,
    onDelete: handleDelete,
    onRefresh: () => router.refresh(),
  })

  const filterableColumns = [
    {
      id: "protocol" as keyof EquipmentConnectionRow,
      title: "프로토콜",
      options: Object.entries(PROTOCOL_CONFIG).map(([value, cfg]) => ({
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
          연결 등록
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        filterableColumns={filterableColumns}
      />

      <ConnectionFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        editingRow={editingRow}
        equipments={equipments}
        gateways={gateways}
      />
    </div>
  )
}
