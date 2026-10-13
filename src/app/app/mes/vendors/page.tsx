import { getBusinessPartners } from "@/lib/actions/business-partner.actions"
import { PartnerDataTable } from "../business-partners/partner-data-table"

export const dynamic = "force-dynamic"

export default async function VendorsPage() {
  const partners = await getBusinessPartners("SUPPLIER")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            거래처관리
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            원자재·부품을 공급하는 거래처 정보를 관리합니다.
          </p>
        </div>
      </div>
      <PartnerDataTable partners={partners} fixedType="SUPPLIER" entityName="거래처" />
    </div>
  )
}
