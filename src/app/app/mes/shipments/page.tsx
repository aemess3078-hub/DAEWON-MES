export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import {
  getShipments,
  getShippableSalesOrders,
  getWarehouses,
} from "@/lib/actions/shipment.actions"
import { ShipmentDataTable } from "./shipment-data-table"

interface ShipmentsPageProps {
  searchParams: Promise<{ salesOrderId?: string }>
}

export default async function ShipmentsPage({ searchParams }: ShipmentsPageProps) {
  const tenantId = await getTenantId()
  const params = await searchParams

  const [shipments, salesOrders, warehouses] = await Promise.all([
    getShipments(tenantId),
    getShippableSalesOrders(tenantId),
    getWarehouses(tenantId),
  ])

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold leading-tight">납품정보등록</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          수주 기반 출하를 등록하고 출하 현황을 추적합니다
        </p>
      </div>
      <ShipmentDataTable
        data={shipments as any}
        tenantId={tenantId}
        salesOrders={salesOrders as any}
        warehouses={warehouses}
        initialSalesOrderId={params.salesOrderId}
      />
    </div>
  )
}
