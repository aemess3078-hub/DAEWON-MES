export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import { getRoutings, getItemsForRouting, getWorkCenters } from "@/lib/actions/routing.actions"
import { isFeatureEnabled } from "@/lib/services/feature.service"
import { RoutingDataTable } from "./routing-data-table"

export default async function RoutingPage() {
  const tenantId = await getTenantId()
  const enabled = await isFeatureEnabled(tenantId, "ROUTING")

  if (!enabled) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">이 기능은 활성화되어 있지 않습니다.</p>
      </div>
    )
  }

  const [routings, items, workCenters] = await Promise.all([
    getRoutings(),
    getItemsForRouting(),
    getWorkCenters(),
  ])

  const resolvedTenantId = routings[0]?.tenantId ?? tenantId

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            라우팅관리
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            생산 공정 순서와 라우팅을 등록하고 관리합니다.
          </p>
        </div>
      </div>
      <RoutingDataTable
        data={routings}
        items={items}
        workCenters={workCenters}
        tenantId={resolvedTenantId}
      />
    </div>
  )
}
