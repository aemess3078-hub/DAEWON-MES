export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import { getSitesSimple } from "@/lib/actions/site.actions"
import { getPlansForMRP } from "@/lib/actions/mrp.actions"
import { MrpTabs } from "./mrp-tabs"

export default async function MRPPage() {
  const tenantId = await getTenantId()
  const sites = await getSitesSimple()
  const siteId = sites[0]?.id ?? ""

  const plans = await getPlansForMRP()

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold leading-tight">MRP 자재소요량</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          수주 납기순 결품예측 · 생산계획 기반 소요량 계산
        </p>
      </div>
      <MrpTabs plans={plans as any} tenantId={tenantId} siteId={siteId} />
    </div>
  )
}
