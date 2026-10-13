export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import {
  getWorkOrders,
  getSites,
  getItemsForWorkOrder,
  getEquipments,
  getConfirmedProductionPlanItemsForWorkOrder,
} from "@/lib/actions/work-order.actions"
import { WorkOrderDataTable } from "./work-order-data-table"
import { isFeatureEnabled } from "@/lib/services/feature.service"

interface WorkOrdersPageProps {
  searchParams: Promise<{ productionPlanId?: string; productionPlanItemId?: string }>
}

export default async function WorkOrdersPage({ searchParams }: WorkOrdersPageProps) {
  const tenantId = await getTenantId()
  const params = await searchParams
  const enabled = await isFeatureEnabled(tenantId, "WORK_ORDER")

  if (!enabled) {
    return (
      <div className="p-6">
        <p className="text-[15px] text-muted-foreground">
          작업지시 기능이 활성화되어 있지 않습니다.
        </p>
      </div>
    )
  }

  const [workOrders, sites, items, equipments, productionPlanItems] = await Promise.all([
    getWorkOrders(),
    getSites(),
    getItemsForWorkOrder(),
    getEquipments(),
    getConfirmedProductionPlanItemsForWorkOrder(tenantId),
  ])

  const defaultProductionPlanItemId =
    productionPlanItems.find((item) => item.id === params.productionPlanItemId)?.id ??
    productionPlanItems.find((item) => item.plan.id === params.productionPlanId)?.id

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            작업지시
          </h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            작업지시 생성부터 제조번호 발행, 원자재 LOT 투입, 공정 진행 상태를 확인합니다.
          </p>
        </div>
      </div>
      <WorkOrderDataTable
        data={workOrders}
        sites={sites}
        items={items}
        equipments={equipments}
        productionPlanItems={productionPlanItems}
        tenantId={tenantId}
        initialProductionPlanId={params.productionPlanId}
        defaultProductionPlanItemId={defaultProductionPlanItemId}
      />
    </div>
  )
}
