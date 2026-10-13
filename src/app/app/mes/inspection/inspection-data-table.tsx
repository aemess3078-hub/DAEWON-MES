"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import {
  QualityInspectionWithDetails,
  DefectCodeRow,
  WorkOrderOperationForInspection,
  deleteQualityInspection,
} from "@/lib/actions/quality.actions"
import { getInspectionColumns, RESULT_CONFIG } from "./inspection-columns"
import { InspectionFormSheet } from "./inspection-form-sheet"
import { InspectionDetailDialog } from "./inspection-detail-dialog"

// ─── Types ────────────────────────────────────────────────────────────────────

interface InspectionDataTableProps {
  data: QualityInspectionWithDetails[]
  tenantId: string
  workOrderOperations: WorkOrderOperationForInspection[]
  profiles: { id: string; displayName: string; email: string }[]
  defectCodes: DefectCodeRow[]
  initialOperationId?: string
  requestedOperationId?: string
  requestedWorkOrderId?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InspectionDataTable({
  data,
  tenantId,
  workOrderOperations,
  profiles,
  defectCodes,
  initialOperationId,
  requestedOperationId,
  requestedWorkOrderId,
}: InspectionDataTableProps) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedInspection, setSelectedInspection] =
    useState<QualityInspectionWithDetails | null>(null)

  useEffect(() => {
    if (!initialOperationId) return
    setFormOpen(true)
  }, [initialOperationId])

  function handleView(row: QualityInspectionWithDetails) {
    setSelectedInspection(row)
    setDetailOpen(true)
  }

  async function handleDelete(row: QualityInspectionWithDetails) {
    const wo = row.workOrderOperation.workOrder
    if (
      !confirm(
        `'${wo.orderNo}' 검사 기록을 삭제하시겠습니까?\n연결된 불량 기록도 함께 삭제됩니다.`
      )
    )
      return
    try {
      await deleteQualityInspection(row.id)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  const columns = getInspectionColumns({ onView: handleView, onDelete: handleDelete })

  const filterableColumns = [
    {
      id: "result" as keyof QualityInspectionWithDetails,
      title: "판정",
      options: [
        ...Object.entries(RESULT_CONFIG).map(([value, cfg]) => ({
          label: cfg.label,
          value,
        })),
        { label: "미판정", value: "NONE" },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      {(requestedOperationId || requestedWorkOrderId) && (
        <div className={`flex items-center justify-between rounded-lg border px-4 py-3 text-[14px] ${
          initialOperationId
            ? "border-blue-200 bg-blue-50 text-blue-800"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}>
          <span>
            {initialOperationId
              ? "작업지시/공정 컨텍스트를 유지해 검사 등록 화면을 열었습니다."
              : "전달된 작업지시 또는 공정이 현재 검사 등록 대상에 없습니다."}
          </span>
          <Button variant="outline" size="sm" className="h-8 bg-white text-[13px]" asChild>
            <Link href="/app/mes/inspection">전체 보기</Link>
          </Button>
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={() => setFormOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          검사 등록
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        filterableColumns={filterableColumns}
      />

      <InspectionFormSheet
        tenantId={tenantId}
        open={formOpen}
        onOpenChange={setFormOpen}
        workOrderOperations={workOrderOperations}
        profiles={profiles}
        defectCodes={defectCodes}
        defaultOperationId={initialOperationId}
      />

      <InspectionDetailDialog
        inspection={selectedInspection}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}
