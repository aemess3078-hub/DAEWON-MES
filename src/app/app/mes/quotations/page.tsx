export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import { getQuotations, getCustomersForQuotation, getFinishedItems } from "@/lib/actions/quotation.actions"
import { getSites } from "@/lib/actions/production-plan.actions"
import { QuotationDataTable } from "./quotation-data-table"

export default async function QuotationsPage() {
  const tenantId = await getTenantId()

  const [quotations, customers, items, sites] = await Promise.all([
    getQuotations(),
    getCustomersForQuotation(),
    getFinishedItems(),
    getSites(),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            견적관리
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            고객 견적서를 관리하고 확정 시 수주로 전환합니다.
          </p>
        </div>
      </div>
      <QuotationDataTable
        quotations={quotations}
        customers={customers}
        items={items}
        sites={sites as any}
        tenantId={tenantId}
      />
    </div>
  )
}
