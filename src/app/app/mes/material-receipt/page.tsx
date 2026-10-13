export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import { getSitesSimple } from "@/lib/actions/site.actions"
import { getPendingPurchaseOrdersForReceipt } from "@/lib/actions/purchase-order.actions"
import { MaterialReceiptDataTable } from "./material-receipt-data-table"

export default async function MaterialReceiptPage() {
  const tenantId = await getTenantId()
  const sites = await getSitesSimple()
  const siteId = sites[0]?.id ?? ""

  // 현재 site 기준 입고 대기 발주만 조회 (status 필터 + 외주 제외는 쿼리에서 처리)
  const pendingOrders = await getPendingPurchaseOrdersForReceipt(tenantId, siteId)

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold leading-tight">자재입고현황</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          입고 대기 중인 발주를 확인하고 입고 처리합니다
        </p>
      </div>
      <MaterialReceiptDataTable
        data={pendingOrders as any}
        tenantId={tenantId}
        siteId={siteId}
      />
    </div>
  )
}
