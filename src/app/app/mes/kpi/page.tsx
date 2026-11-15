import { getDaewonKpiData, getDaewonKpiFilterOptions } from "@/lib/actions/daewon-kpi.actions"
import { isValidKstDateRange } from "@/lib/date/kst"
import { DEFAULT_KPI_PERIOD } from "@/lib/kpi/daewon-kpi"
import { DaewonKpiClient } from "./daewon-kpi-client"

export const dynamic = "force-dynamic"

interface Props {
  searchParams?: Promise<{
    from?: string
    to?: string
    itemId?: string
    processId?: string
    equipmentIds?: string
    customerId?: string
    granularity?: string
    kpi?: string
  }>
}

export default async function KpiDashboardPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {}
  const defaults = DEFAULT_KPI_PERIOD
  const requestedFrom = params.from?.trim()
  const requestedTo = params.to?.trim()
  // 잘못된 기간(형식 오류·from>to)은 기본 기간(DEFAULT_KPI_PERIOD)으로 대체한다.
  const validRange = !!requestedFrom && !!requestedTo && isValidKstDateRange(requestedFrom, requestedTo)

  const [data, filterOptions] = await Promise.all([
    getDaewonKpiData({
      from: validRange ? requestedFrom : defaults.from,
      to: validRange ? requestedTo : defaults.to,
      itemId: params.itemId?.trim() || undefined,
      processId: params.processId?.trim() || undefined,
      equipmentIds: params.equipmentIds ? params.equipmentIds.split(",").filter(Boolean) : undefined,
      customerId: params.customerId?.trim() || undefined,
      granularity: params.granularity === "month" ? "month" : "day",
    }),
    getDaewonKpiFilterOptions(),
  ])

  const initialKpi = params.kpi === "ppm" || params.kpi === "onTime" ? params.kpi : "uph"

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">KPI 대시보드</h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          스마트공장 구축사업 핵심 성과지표(시간당 생산량 · 공정불량률 · 납기준수율)를 MES 실적으로 자동 산출합니다.
        </p>
      </div>
      <DaewonKpiClient data={data} filterOptions={filterOptions} initialKpi={initialKpi} />
    </div>
  )
}
