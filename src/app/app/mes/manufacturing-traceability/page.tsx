import { getTenantId } from "@/lib/auth"
import { isFeatureEnabled } from "@/lib/services/feature.service"
import { ManufacturingTraceabilityClient } from "./manufacturing-traceability-client"

export const dynamic = "force-dynamic"

interface ManufacturingTraceabilityPageProps {
  searchParams?: Promise<{ manufacturingNo?: string }>
}

export default async function ManufacturingTraceabilityPage({
  searchParams,
}: ManufacturingTraceabilityPageProps) {
  const tenantId = await getTenantId()
  const params = searchParams ? await searchParams : {}
  const initialManufacturingNo = params.manufacturingNo?.trim() || undefined

  const enabled = await isFeatureEnabled(tenantId, "LOT_TRACKING")
  if (!enabled) {
    return (
      <div className="p-6">
        <p className="text-[15px] text-muted-foreground">
          LOT 추적 기능이 활성화되어 있지 않습니다. 기능 관리 페이지에서 LOT_TRACKING을 활성화해 주세요.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          제조번호 추적성
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          제조번호 기준으로 원자재 투입부터 출고까지 전체 이력을 추적합니다.
        </p>
      </div>

      <ManufacturingTraceabilityClient
        tenantId={tenantId}
        initialManufacturingNo={initialManufacturingNo}
      />
    </div>
  )
}
