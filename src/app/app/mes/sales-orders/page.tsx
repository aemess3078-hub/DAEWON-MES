export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import { getSitesSimple } from "@/lib/actions/site.actions"
import { getSalesOrders, getCustomers, getItemsForSales } from "@/lib/actions/sales-order.actions"
import { getResourcePermissions } from "@/lib/auth/role-permissions"
import { SalesOrderDataTable } from "./sales-order-data-table"

export default async function SalesOrdersPage() {
  const tenantId = await getTenantId()

  const [orders, customers, items, sites] = await Promise.all([
    getSalesOrders(tenantId),
    getCustomers(tenantId),
    getItemsForSales(tenantId),
    getSitesSimple(),
  ])
  const siteId = sites[0]?.id ?? ""
  // 생산 수량 조회: 수주 조회 + 생산계획 조회 / 생산의뢰: 수주 수정 + 생산계획 등록 (서버 액션이 같은 권한을 다시 확인한다)
  const [soPerm, planPerm] = await Promise.all([getResourcePermissions("SALES_ORDER"), getResourcePermissions("PRODUCTION_PLAN")])

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold leading-tight">수주등록</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          고객 수주를 접수하고 납기일을 관리합니다
        </p>
      </div>
      <SalesOrderDataTable
        data={orders as any}
        tenantId={tenantId}
        siteId={siteId}
        customers={customers}
        items={items}
        canViewQuantities={soPerm.canRead && planPerm.canRead}
        canRequestProduction={soPerm.canUpdate && planPerm.canCreate}
      />
    </div>
  )
}
