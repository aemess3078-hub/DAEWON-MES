export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import { getSitesSimple } from "@/lib/actions/site.actions"
import { getPurchaseOrders, getSuppliers, getRawMaterials } from "@/lib/actions/purchase-order.actions"
import { PurchaseOrderDataTable } from "./purchase-order-data-table"

export default async function PurchaseOrdersPage() {
  const tenantId = await getTenantId()
  const sites = await getSitesSimple()
  const siteId = sites[0]?.id ?? ""

  const [orders, suppliers, items] = await Promise.all([
    getPurchaseOrders(tenantId),
    getSuppliers(tenantId),
    getRawMaterials(tenantId),
  ])

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold leading-tight">자재발주현황</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          공급사 발주를 등록하고 입고 현황을 관리합니다
        </p>
      </div>
      <PurchaseOrderDataTable
        data={orders as any}
        tenantId={tenantId}
        siteId={siteId}
        suppliers={suppliers}
        items={items}
      />
    </div>
  )
}
