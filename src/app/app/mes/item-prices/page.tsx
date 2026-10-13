export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import { getItemPrices, getAllPartners } from "@/lib/actions/item-price.actions"
import { getItemsForSales } from "@/lib/actions/sales-order.actions"
import { ItemPriceDataTable } from "./item-price-data-table"

export default async function ItemPricesPage() {
  const tenantId = await getTenantId()

  const [prices, partners, items] = await Promise.all([
    getItemPrices(tenantId),
    getAllPartners(tenantId),
    getItemsForSales(tenantId),
  ])

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold leading-tight">단가관리</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          품목별 구매/판매 단가를 거래처별로 관리합니다
        </p>
      </div>
      <ItemPriceDataTable
        data={prices as any}
        tenantId={tenantId}
        partners={partners}
        items={items}
      />
    </div>
  )
}
