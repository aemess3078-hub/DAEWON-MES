export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import { getResourcePermissions } from "@/lib/auth/role-permissions"
import { getStockCounts, getStockCountWarehouses } from "@/lib/actions/stock-count.actions"
import { isFeatureEnabled } from "@/lib/services/feature.service"
import { notFound } from "next/navigation"
import { StockCountListClient } from "./stock-count-list-client"

export default async function StockCountPage() {
  const tenantId = await getTenantId()
  const enabled = await isFeatureEnabled(tenantId, "INVENTORY")
  if (!enabled) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">이 기능은 활성화되어 있지 않습니다.</p>
      </div>
    )
  }
  const permissions = await getResourcePermissions("INVENTORY")
  if (!permissions.canRead) notFound()

  const [rows, warehouses] = await Promise.all([getStockCounts(), getStockCountWarehouses()])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">재고실사</h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          창고 단위로 실사를 시작·종료하고, 실사 결과와 조정 이력을 관리합니다. 실사 중에도 입출고는 계속할 수 있습니다.
        </p>
      </div>
      <StockCountListClient rows={rows} warehouses={warehouses} canCreate={permissions.canCreate} />
    </div>
  )
}
