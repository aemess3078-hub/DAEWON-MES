import { notFound } from "next/navigation"
import { getGateways, getSitesForGateway } from "@/lib/actions/equipment-integration.actions"
import { GatewayDataTable } from "./gateway-data-table"
import { getCurrentUser, getTenantId } from "@/lib/auth"
import { isDeveloperUser } from "@/lib/developer"

export const dynamic = "force-dynamic"

export default async function GatewaysPage() {
  const user = await getCurrentUser()
  if (!isDeveloperUser(user)) notFound()
  const tenantId = await getTenantId()

  const [gateways, sites] = await Promise.all([
    getGateways(tenantId),
    getSitesForGateway(tenantId),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            Edge Gateway 관리
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            현장 설비와 클라우드를 연결하는 Edge Gateway를 등록하고 관리합니다.
          </p>
        </div>
      </div>

      <GatewayDataTable data={gateways} tenantId={tenantId} sites={sites} />
    </div>
  )
}
