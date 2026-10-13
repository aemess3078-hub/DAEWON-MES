import { getTenantId } from "@/lib/auth"
import { isFeatureEnabled } from "@/lib/services/feature.service"
import { getLots, getItemsForLot } from "@/lib/actions/lot.actions"
import { LotDataTable } from "./lot-data-table"

export const dynamic = "force-dynamic"

export default async function LotPage() {
  const tenantId = await getTenantId()

  const enabled = await isFeatureEnabled(tenantId, "LOT_TRACKING")
  if (!enabled) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">
          LOT 추적 기능이 활성화되어 있지 않습니다. 기능 관리 페이지에서 LOT_TRACKING을 활성화하세요.
        </p>
      </div>
    )
  }

  const [lots, items] = await Promise.all([
    getLots(),
    getItemsForLot(),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            LOT/Serial 관리
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            품목별 LOT를 등록하고 상태를 관리합니다.
          </p>
        </div>
      </div>

      <LotDataTable
        data={lots}
        items={items}
        tenantId={tenantId}
      />
    </div>
  )
}
