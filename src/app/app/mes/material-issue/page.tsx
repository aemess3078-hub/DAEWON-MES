export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import {
  searchWorkOrdersForIssue,
  getMaterialIssueSummary,
  getWarehousesWithStock,
} from "@/lib/actions/material-issue.actions"
import { MaterialIssueTable } from "./material-issue-table"

interface MaterialIssuePageProps {
  searchParams: Promise<{ workOrderId?: string; q?: string; page?: string }>
}

export default async function MaterialIssuePage({ searchParams }: MaterialIssuePageProps) {
  const tenantId = await getTenantId()
  const params = await searchParams

  // 서버 검색 + 페이지네이션(검색어·페이지는 URL 로 유지). 요약 배지는 검색과 무관한 전체 범위 기준.
  const [result, summary] = await Promise.all([
    searchWorkOrdersForIssue(tenantId, {
      q: typeof params.q === "string" ? params.q : undefined,
      page: Number(params.page),
      includeWorkOrderId: params.workOrderId,
    }),
    getMaterialIssueSummary(tenantId),
  ])
  const workOrders = result.rows

  const itemIdSet = new Set(workOrders.flatMap((workOrder) => workOrder.materials.map((material) => material.itemId)))
  const itemIds = Array.from(itemIdSet)
  const warehouses = await getWarehousesWithStock(tenantId, itemIds)

  const pendingCount = summary.pending
  const completedCount = summary.completed
  const manufacturingNoCount = summary.withManufacturingNo

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            자재출고현황
          </h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            작업지시와 제조번호 기준으로 원자재 LOT를 출고하고 투입 이력을 연결합니다.
          </p>
        </div>
        {(pendingCount > 0 || completedCount > 0) && (
          <div className="flex gap-3">
            <SummaryBadge label="출고 대기" value={pendingCount} tone="amber" />
            <SummaryBadge label="출고 완료" value={completedCount} tone="green" />
            <SummaryBadge label="제조번호 보유" value={manufacturingNoCount} tone="blue" />
          </div>
        )}
      </div>

      <MaterialIssueTable
          data={workOrders}
          warehouses={warehouses}
          tenantId={tenantId}
          initialWorkOrderId={params.workOrderId}
          query={result.query}
          total={result.total}
          page={result.page}
          totalPages={result.totalPages}
        />
    </div>
  )
}

function SummaryBadge({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "amber" | "green" | "blue"
}) {
  const toneClass = {
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    green: "border-green-200 bg-green-50 text-green-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
  }[tone]

  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${toneClass}`}>
      <div className="text-[18px] font-semibold">{value}</div>
      <div className="text-[13px]">{label}</div>
    </div>
  )
}
