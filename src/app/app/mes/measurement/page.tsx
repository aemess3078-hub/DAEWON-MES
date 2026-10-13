import { getTenantId } from "@/lib/auth"
import {
  getInspectionSpecs,
  getItemsForQuality,
  getRoutingOperationsForQuality,
} from "@/lib/actions/quality.actions"
import { MeasurementManager } from "./measurement-manager"

export const dynamic = "force-dynamic"

export default async function MeasurementPage() {
  const tenantId = await getTenantId()

  const [specs, items, routingOperations] = await Promise.all([
    getInspectionSpecs(tenantId),
    getItemsForQuality(),
    getRoutingOperationsForQuality(tenantId),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            검사기준 관리
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            품목·공정별 검사기준과 검사항목을 정의합니다.
          </p>
        </div>
      </div>

      <MeasurementManager
        tenantId={tenantId}
        specs={specs}
        items={items}
        routingOperations={routingOperations}
      />
    </div>
  )
}
