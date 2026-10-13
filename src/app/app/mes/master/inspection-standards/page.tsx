import { getTenantId } from "@/lib/auth"
import {
  getInspectionSpecs,
  getItemsForQuality,
  getRoutingOperationsForQuality,
} from "@/lib/actions/quality.actions"
import { InspectionStandardsClient } from "./inspection-standards-client"

export const dynamic = "force-dynamic"

export default async function InspectionStandardsPage() {
  const tenantId = await getTenantId()

  const [specs, items, routingOperations] = await Promise.all([
    getInspectionSpecs(tenantId),
    getItemsForQuality(),
    getRoutingOperationsForQuality(tenantId),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          검사표준관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          품목·공정별 검사기준과 합부판정 항목을 등록·관리합니다.
        </p>
      </div>

      <InspectionStandardsClient
        tenantId={tenantId}
        specs={specs}
        items={items}
        routingOperations={routingOperations}
      />
    </div>
  )
}
