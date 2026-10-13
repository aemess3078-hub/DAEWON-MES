export const dynamic = "force-dynamic"

import { getItemsForCosting } from "@/lib/actions/costing.actions"
import { CostingDashboard } from "./costing-dashboard"

export default async function CostingPage() {
  const items = await getItemsForCosting()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">원가분석</h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          BOM 기반 표준원가와 실적 기반 실제원가를 비교 분석합니다.
        </p>
      </div>
      <CostingDashboard items={items} />
    </div>
  )
}
