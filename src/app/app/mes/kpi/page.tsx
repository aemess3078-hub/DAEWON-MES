import { getKpiDashboardData, getKpiFilterOptions } from "@/lib/actions/kpi.actions"
import { KpiDashboardClient } from "./kpi-dashboard-client"

export const dynamic = "force-dynamic"

interface Props {
  searchParams?: Promise<{ from?: string; to?: string; itemId?: string; equipmentIds?: string }>
}

function defaultDateRange() {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - 30)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return { from: fmt(from), to: fmt(to) }
}

export default async function KpiDashboardPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {}
  const { from: defaultFrom, to: defaultTo } = defaultDateRange()

  const itemId = params.itemId?.trim() || undefined
  const equipmentIds = params.equipmentIds
    ? params.equipmentIds.split(",").filter(Boolean)
    : undefined

  const [data, filterOptions] = await Promise.all([
    getKpiDashboardData({
      from: params.from?.trim() || defaultFrom,
      to: params.to?.trim() || defaultTo,
      itemId,
      equipmentIds,
    }),
    getKpiFilterOptions(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          KPI 대시보드
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          핵심 성과 지표를 한 화면에서 확인합니다.
        </p>
      </div>
      <KpiDashboardClient data={data} filterOptions={filterOptions} />
    </div>
  )
}
