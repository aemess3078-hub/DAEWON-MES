export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import { getMaterialIssueHistory, getMaterialIssueHistoryWarehouses } from "@/lib/actions/material-issue-history.actions"
import { MaterialIssueHistoryClient } from "./issue-history-client"

interface MaterialIssueHistoryPageProps {
  searchParams: Promise<{ q?: string; from?: string; to?: string; wh?: string; page?: string }>
}

export default async function MaterialIssueHistoryPage({ searchParams }: MaterialIssueHistoryPageProps) {
  const tenantId = await getTenantId()
  const params = await searchParams

  const [result, warehouses] = await Promise.all([
    getMaterialIssueHistory(tenantId, {
      q: typeof params.q === "string" ? params.q : undefined,
      from: typeof params.from === "string" ? params.from : undefined,
      to: typeof params.to === "string" ? params.to : undefined,
      warehouseId: typeof params.wh === "string" ? params.wh : undefined,
      page: Number(params.page),
    }),
    getMaterialIssueHistoryWarehouses(tenantId),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">자재출고이력</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          작업지시에 투입된 원자재 출고 내역을 조회합니다. 완료된 작업지시의 과거 출고도 포함됩니다(조회 전용).
        </p>
      </div>

      <MaterialIssueHistoryClient result={result} warehouses={warehouses} />
    </div>
  )
}
