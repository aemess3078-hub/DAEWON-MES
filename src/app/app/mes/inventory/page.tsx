import { getTenantId } from "@/lib/auth"
import { isFeatureEnabled } from "@/lib/services/feature.service"
import { getGroupedInventoryBalances, getSitesForInventory } from "@/lib/actions/inventory.actions"
import { InventoryDataTable } from "./inventory-data-table"

export const dynamic = "force-dynamic"

export default async function InventoryPage() {
  const tenantId = await getTenantId()
  const enabled = await isFeatureEnabled(tenantId, "INVENTORY")

  if (!enabled) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">이 기능은 활성화되어 있지 않습니다.</p>
      </div>
    )
  }

  const [groups, sites] = await Promise.all([
    getGroupedInventoryBalances(),
    getSitesForInventory(),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            재고현황
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            전체 품목의 재고현황을 조회합니다. 품목 행을 클릭하면 LOT/창고별 상세 재고가 펼쳐집니다.
          </p>
        </div>
      </div>
      <InventoryDataTable data={groups} sites={sites} />
    </div>
  )
}
