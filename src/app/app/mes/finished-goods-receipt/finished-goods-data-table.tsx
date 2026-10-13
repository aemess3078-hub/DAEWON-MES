"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { getColumns } from "./columns"
import { ReceiptDialog } from "./receipt-dialog"
import {
  WorkOrderForReceipt,
  WarehouseWithLocations,
} from "@/lib/actions/finished-goods.actions"

interface FinishedGoodsDataTableProps {
  data: WorkOrderForReceipt[]
  warehouses: WarehouseWithLocations[]
  tenantId: string
  initialWorkOrderId?: string
}

export function FinishedGoodsDataTable({
  data,
  warehouses,
  tenantId,
  initialWorkOrderId,
}: FinishedGoodsDataTableProps) {
  const [receiptTarget, setReceiptTarget] = useState<WorkOrderForReceipt | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)

  useEffect(() => {
    if (!initialWorkOrderId) return
    const workOrder = data.find((row) => row.id === initialWorkOrderId)
    if (!workOrder) {
      setContextError("전달된 작업지시가 현재 완제품 입고 대상에 없습니다.")
      return
    }
    if (workOrder.receiptBlockedReason || workOrder.pendingQty <= 0) {
      setContextError(workOrder.receiptBlockedReason ?? "전달된 작업지시는 입고 대기 수량이 없습니다.")
      return
    }
    setContextError(null)
    setReceiptTarget(workOrder)
    setReceiptOpen(true)
  }, [data, initialWorkOrderId])

  const columns = getColumns({
    onReceipt: (wo) => {
      setReceiptTarget(wo)
      setReceiptOpen(true)
    },
  })

  return (
    <>
      {initialWorkOrderId && (
        <div className={`mb-4 flex items-center justify-between rounded-lg border px-4 py-3 text-[14px] ${
          contextError
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-blue-200 bg-blue-50 text-blue-800"
        }`}>
          <span>{contextError ?? "작업지시 컨텍스트를 유지해 완제품 입고 화면을 열었습니다."}</span>
          <Button variant="outline" size="sm" className="h-8 bg-white text-[13px]" asChild>
            <Link href="/app/mes/finished-goods-receipt">전체 보기</Link>
          </Button>
        </div>
      )}
      <DataTable
        columns={columns}
        data={data}
        searchableColumns={[
          { id: "orderNo" as keyof WorkOrderForReceipt, title: "작업지시번호" },
          { id: "itemName" as keyof WorkOrderForReceipt, title: "품목명" },
        ]}
      />

      <ReceiptDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        workOrder={receiptTarget}
        warehouses={warehouses}
        tenantId={tenantId}
      />
    </>
  )
}
