"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { useUserRole } from "@/lib/contexts/user-role-context"
import {
  type NcwatchMappingRow,
  unmapNcwatchMapping,
} from "@/lib/actions/equipment-integration.actions"
import { getNcwatchMappingColumns } from "./ncwatch-mapping-columns"
import { NcwatchMappingFormSheet } from "./ncwatch-mapping-form-sheet"

type EquipmentOption = {
  id: string
  code: string
  name: string
  workCenter: { name: string }
}

interface NcwatchMappingDataTableProps {
  data: NcwatchMappingRow[]
  equipments: EquipmentOption[]
}

export function NcwatchMappingDataTable({
  data,
  equipments,
}: NcwatchMappingDataTableProps) {
  const router = useRouter()
  const role = useUserRole()
  const canMutate = role === "OWNER" || role === "ADMIN" || role === "MANAGER"
  const [formOpen, setFormOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<NcwatchMappingRow | null>(null)

  const machineNames = useMemo(
    () => Array.from(new Set(data.map((row) => row.machineName))).sort(),
    [data]
  )

  function handleCreate() {
    setEditingRow(null)
    setFormOpen(true)
  }

  function handleEdit(row: NcwatchMappingRow) {
    setEditingRow(row)
    setFormOpen(true)
  }

  async function handleUnmap(row: NcwatchMappingRow) {
    if (!row.id) return
    if (!confirm(`'${row.machineName}' 매핑을 해제하시겠습니까? 수신 데이터는 유지됩니다.`)) return
    try {
      await unmapNcwatchMapping(row.id)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "매핑 해제 중 오류가 발생했습니다.")
    }
  }

  const columns = getNcwatchMappingColumns({
    canMutate,
    onEdit: handleEdit,
    onUnmap: handleUnmap,
    onRefresh: () => router.refresh(),
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canMutate && (
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            NCWatch 매핑 등록
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data}
        searchableColumns={[
          { id: "machineName", title: "수집 기계명" },
        ]}
        filterableColumns={[
          {
            id: "status",
            title: "매핑 상태",
            options: [
              { label: "매핑완료", value: "MAPPED" },
              { label: "미매핑", value: "UNMAPPED" },
              { label: "비활성", value: "INACTIVE" },
            ],
          },
        ]}
      />

      <NcwatchMappingFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        editingRow={editingRow}
        equipments={equipments}
        machineNames={machineNames}
      />
    </div>
  )
}
