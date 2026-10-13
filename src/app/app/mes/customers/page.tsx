import { getBusinessPartners } from "@/lib/actions/business-partner.actions"
import { PartnerDataTable } from "../business-partners/partner-data-table"

export const dynamic = "force-dynamic"

export default async function CustomersPage() {
  const partners = await getBusinessPartners("CUSTOMER")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            고객사관리
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            제품을 납품하는 고객사 정보를 관리합니다.
          </p>
        </div>
      </div>
      <PartnerDataTable partners={partners} fixedType="CUSTOMER" entityName="고객사" />
    </div>
  )
}
