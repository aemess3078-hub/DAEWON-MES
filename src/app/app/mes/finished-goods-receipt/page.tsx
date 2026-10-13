export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import {
  getWorkOrdersForReceipt,
  getFinishedGoodsWarehouses,
} from "@/lib/actions/finished-goods.actions"
import { FinishedGoodsDataTable } from "./finished-goods-data-table"

interface FinishedGoodsReceiptPageProps {
  searchParams: Promise<{ workOrderId?: string }>
}

export default async function FinishedGoodsReceiptPage({ searchParams }: FinishedGoodsReceiptPageProps) {
  const tenantId = await getTenantId()
  const params = await searchParams

  const [workOrders, warehouses] = await Promise.all([
    getWorkOrdersForReceipt(tenantId),
    getFinishedGoodsWarehouses(tenantId),
  ])

  const pendingCount = workOrders.filter((wo) => wo.pendingQty > 0).length
  const completedCount = workOrders.filter(
    (wo) => !wo.receiptBlockedReason && wo.pendingQty === 0 && wo.totalReceiptQty > 0,
  ).length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            완제품입고
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            생산 완료된 작업지시의 완제품을 창고에 입고 처리합니다.
          </p>
        </div>
        {(pendingCount > 0 || completedCount > 0) && (
          <div className="flex gap-3 text-[13px]">
            {pendingCount > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-center">
                <div className="font-semibold text-amber-800 text-[18px]">{pendingCount}</div>
                <div className="text-amber-700">입고 대기</div>
              </div>
            )}
            {completedCount > 0 && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-center">
                <div className="font-semibold text-green-700 text-[18px]">{completedCount}</div>
                <div className="text-green-600">입고 완료</div>
              </div>
            )}
          </div>
        )}
      </div>

      {workOrders.length === 0 && !params.workOrderId ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-[15px] text-muted-foreground">
            생산 완료된 작업지시가 없습니다.
          </p>
        </div>
      ) : (
        <FinishedGoodsDataTable
          data={workOrders}
          warehouses={warehouses}
          tenantId={tenantId}
          initialWorkOrderId={params.workOrderId}
        />
      )}
    </div>
  )
}
