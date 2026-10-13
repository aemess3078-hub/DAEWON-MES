import { getQualityReport, getReportFilterOptions } from "@/lib/actions/report.actions"
import type { DefectStatsFilter } from "@/lib/actions/defect-stats.actions"
import { resolveKstDateRangeFilter } from "@/lib/date/kst"
import { QualityReportClient } from "./quality-report-client"

export const dynamic = "force-dynamic"

interface PageProps {
  searchParams?: Promise<{
    from?: string
    to?: string
    itemId?: string
    routingOperationId?: string
  }>
}

export default async function QualityReportPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {}
  const dateRange = resolveKstDateRangeFilter(30, params.from, params.to)

  const filter: DefectStatsFilter = {
    from: dateRange.from,
    to: dateRange.to,
    itemId: params.itemId?.trim() || undefined,
    routingOperationId: params.routingOperationId?.trim() || undefined,
  }

  const [stats, options] = await Promise.all([
    getQualityReport(filter),
    getReportFilterOptions(),
  ])

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">품질리포트</h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          기간별 검사·불량 현황을 확인하고 Excel/인쇄로 출력합니다.
        </p>
      </div>
      <QualityReportClient
        initialFilter={{
          from: filter.from!,
          to: filter.to!,
          itemId: filter.itemId ?? "",
          routingOperationId: filter.routingOperationId ?? "",
        }}
        stats={stats}
        options={options}
      />
    </div>
  )
}
