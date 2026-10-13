"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { getColumns } from "./columns"
import { LotFormSheet } from "./lot-form-sheet"
import { LotWithDetails, updateLotStatus } from "@/lib/actions/lot.actions"

// ─── Types ────────────────────────────────────────────────────────────────────

interface LotDataTableProps {
  data: LotWithDetails[]
  items: { id: string; code: string; name: string; itemType: string; uom: string }[]
  tenantId: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LotDataTable({ data, items, tenantId }: LotDataTableProps) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)

  const handleStatusChange = async (lot: LotWithDetails, status: string) => {
    const LOT_STATUS_LABELS: Record<string, string> = {
      ACTIVE:     "활성",
      QUARANTINE: "격리",
      ON_HOLD:    "보류",
      CONSUMED:   "소진",
      EXPIRED:    "만료",
    }
    if (
      !confirm(
        `'${lot.lotNo}' LOT 상태를 '${LOT_STATUS_LABELS[status] ?? status}'으로 변경하시겠습니까?`
      )
    )
      return

    try {
      await updateLotStatus(lot.id, status)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "상태 변경 중 오류가 발생했습니다.")
    }
  }

  const columns = getColumns({ onStatusChange: handleStatusChange })

  const filterableColumns = [
    {
      id: "status" as keyof LotWithDetails,
      title: "상태",
      options: [
        { label: "활성",   value: "ACTIVE" },
        { label: "격리",   value: "QUARANTINE" },
        { label: "보류",   value: "ON_HOLD" },
        { label: "소진",   value: "CONSUMED" },
        { label: "만료",   value: "EXPIRED" },
      ],
    },
    {
      id: "itemType" as keyof LotWithDetails,
      title: "품목유형",
      options: [
        { label: "원자재", value: "RAW_MATERIAL" },
        { label: "반제품", value: "SEMI_FINISHED" },
        { label: "완제품", value: "FINISHED" },
        { label: "소모품", value: "CONSUMABLE" },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => setFormOpen(true)}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          LOT 등록
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        searchableColumns={[
          { id: "lotNo" as keyof LotWithDetails, title: "LOT번호" },
          { id: "itemName" as keyof LotWithDetails, title: "품목명" },
        ]}
        filterableColumns={filterableColumns}
      />

      <LotFormSheet
        items={items}
        tenantId={tenantId}
        open={formOpen}
        onOpenChange={setFormOpen}
      />
    </div>
  )
}
