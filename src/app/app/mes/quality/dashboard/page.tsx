import {
  getQualityDashboardData,
  getQualityDashboardFilterOptions,
  type QualityDashboardFilter,
} from "@/lib/actions/quality-dashboard.actions"
import { kstDefaultDateRange, isValidKstDateRange } from "@/lib/date/kst"
import { QualityDashboardClient } from "./quality-dashboard-client"

export const dynamic = "force-dynamic"

interface QualityDashboardPageProps {
  searchParams?: Promise<{
    from?: string
    to?: string
    itemId?: string
    routingOperationId?: string
  }>
}

export default async function QualityDashboardPage({ searchParams }: QualityDashboardPageProps) {
  const params = searchParams ? await searchParams : {}
  const { from: defaultFrom, to: defaultTo } = kstDefaultDateRange(30)

  const rawFrom = params.from?.trim()
  const rawTo = params.to?.trim()
  const bothValid = !!rawFrom && !!rawTo && isValidKstDateRange(rawFrom, rawTo)

  const filter: QualityDashboardFilter = {
    from: bothValid ? rawFrom! : defaultFrom,
    to: bothValid ? rawTo! : defaultTo,
    itemId: params.itemId?.trim() || undefined,
    routingOperationId: params.routingOperationId?.trim() || undefined,
  }

  const [data, filterOptions] = await Promise.all([
    getQualityDashboardData(filter),
    getQualityDashboardFilterOptions(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          품질현황
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          불량분석·원인분석·조치관리·재발방지관리 데이터를 기준으로 종합 품질 상태를 확인합니다.
        </p>
      </div>

      <QualityDashboardClient
        initialFilter={{
          from: filter.from!,
          to: filter.to!,
          itemId: filter.itemId ?? "",
          routingOperationId: filter.routingOperationId ?? "",
        }}
        data={data}
        filterOptions={filterOptions}
      />
    </div>
  )
}
