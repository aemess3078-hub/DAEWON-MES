"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { OperationStatus } from "@prisma/client"
import { DataTable } from "@/components/common/data-table"
import { getColumns } from "./columns"
import { DefectDispositionDialog } from "./defect-disposition-dialog"
import {
  OperationProgressRow,
  updateOperationStatusAction,
} from "@/lib/actions/process-progress.actions"

interface ProcessProgressDataTableProps {
  data: OperationProgressRow[]
}

export function ProcessProgressDataTable({ data }: ProcessProgressDataTableProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dispositionTarget, setDispositionTarget] =
    useState<OperationProgressRow | null>(null)
  const [dispositionOpen, setDispositionOpen] = useState(false)

  const handleStatusChange = (op: OperationProgressRow, status: OperationStatus) => {
    const label = status === "IN_PROGRESS" ? "시작" : "완료"
    if (!confirm(`'${op.workOrder.orderNo} - ${op.routingOperation.name}' 공정을 ${label} 처리하시겠습니까?`))
      return

    startTransition(async () => {
      const res = await updateOperationStatusAction(op.id, status)
      if (!res.ok) {
        alert(res.error ?? "오류가 발생했습니다.")
        return
      }
      router.refresh()
    })
  }

  const handleDefectDisposition = (op: OperationProgressRow) => {
    setDispositionTarget(op)
    setDispositionOpen(true)
  }

  const columns = getColumns({
    onStatusChange: handleStatusChange,
    onDefectDisposition: handleDefectDisposition,
  })

  return (
    <>
      <div className={isPending ? "opacity-60 pointer-events-none" : ""}>
        <DataTable
          columns={columns}
          data={data}
          searchableColumns={[
            { id: "orderNo" as keyof OperationProgressRow, title: "작업지시번호" },
            { id: "itemName" as keyof OperationProgressRow, title: "품목명" },
            { id: "operationName" as keyof OperationProgressRow, title: "공정명" },
          ]}
          filterableColumns={[
            {
              id: "status" as keyof OperationProgressRow,
              title: "상태",
              options: [
                { label: "대기", value: "PENDING" },
                { label: "진행중", value: "IN_PROGRESS" },
                { label: "완료", value: "COMPLETED" },
                { label: "건너뜀", value: "SKIPPED" },
              ],
            },
          ]}
        />
      </div>

      <DefectDispositionDialog
        open={dispositionOpen}
        onOpenChange={setDispositionOpen}
        operation={dispositionTarget}
      />
    </>
  )
}
