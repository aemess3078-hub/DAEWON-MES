export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import {
  getProductionResults,
} from "@/lib/actions/production-result.actions"
import { isFeatureEnabled } from "@/lib/services/feature.service"
import { ProductionResultDataTable } from "./production-result-data-table"

export default async function ProductionResultsPage() {
  const tenantId = await getTenantId()
  const enabled = await isFeatureEnabled(tenantId, "PRODUCTION_RESULT")

  if (!enabled) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">이 기능은 활성화되어 있지 않습니다.</p>
      </div>
    )
  }

  const results = await getProductionResults()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          작업일지(실적)
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          공정별 생산 실적을 조회하고 양품·불량·재작업 수량을 분석합니다.
        </p>
      </div>
      <ProductionResultDataTable data={results} />
    </div>
  )
}
