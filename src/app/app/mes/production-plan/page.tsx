export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import { getResourcePermissions } from "@/lib/auth/role-permissions"
import { getProductionPlans, getSites, getItemsForPlan } from "@/lib/actions/production-plan.actions"
import { PlanDataTable } from "./plan-data-table"
import { isFeatureEnabled } from "@/lib/services/feature.service"
import { notFound } from "next/navigation"

interface ProductionPlanPageProps {
  searchParams: Promise<{ salesOrderId?: string }>
}

export default async function ProductionPlanPage({ searchParams }: ProductionPlanPageProps) {
  const tenantId = await getTenantId()
  const params = await searchParams
  const enabled = await isFeatureEnabled(tenantId, "PRODUCTION_PLAN")

  if (!enabled) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">이 기능은 활성화되어 있지 않습니다.</p>
      </div>
    )
  }

  const permissions = await getResourcePermissions("PRODUCTION_PLAN")
  if (!permissions.canRead) notFound()

  const [plans, sites, items] = await Promise.all([
    getProductionPlans(),
    getSites(),
    getItemsForPlan(),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            생산계획별생산현황
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            생산계획을 등록하고 관리합니다.
          </p>
        </div>
      </div>
      <PlanDataTable
        data={plans}
        sites={sites}
        items={items}
        tenantId={tenantId}
        permissions={permissions}
        initialSalesOrderId={params.salesOrderId}
      />
    </div>
  )
}
