import {
  getDefectStats,
  getDefectStatsFilterOptions,
  type DefectStatsFilter,
} from "@/lib/actions/defect-stats.actions"
import { DefectStatsClient } from "./defect-stats-client"
import { InspectionStage } from "@prisma/client"

export const dynamic = "force-dynamic"

interface DefectStatsPageProps {
  searchParams?: Promise<{
    from?: string
    to?: string
    itemId?: string
    routingOperationId?: string
    manufacturingNo?: string
    stage?: string
  }>
}

const VALID_STAGES = new Set<InspectionStage>(["FIRST", "MID", "FINAL"])

function defaultDateRange(): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return { from: fmt(from), to: fmt(to) }
}

export default async function DefectStatsPage({
  searchParams,
}: DefectStatsPageProps) {
  const params = searchParams ? await searchParams : {}
  const { from: defaultFrom, to: defaultTo } = defaultDateRange()

  const filter: DefectStatsFilter = {
    from: params.from?.trim() || defaultFrom,
    to: params.to?.trim() || defaultTo,
    itemId: params.itemId?.trim() || undefined,
    routingOperationId: params.routingOperationId?.trim() || undefined,
    manufacturingNo: params.manufacturingNo?.trim() || undefined,
    stage:
      params.stage && VALID_STAGES.has(params.stage as InspectionStage)
        ? (params.stage as InspectionStage)
        : undefined,
  }

  const [stats, options] = await Promise.all([
    getDefectStats(filter),
    getDefectStatsFilterOptions(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          불량분석
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          공정검사 데이터를 기준으로 기간·품목·공정·제조번호별 불량률을 분석합니다.
        </p>
      </div>

      <DefectStatsClient
        initialFilter={{
          from: filter.from!,
          to: filter.to!,
          itemId: filter.itemId ?? "",
          routingOperationId: filter.routingOperationId ?? "",
          manufacturingNo: filter.manufacturingNo ?? "",
          stage: filter.stage ?? "",
        }}
        stats={stats}
        options={options}
      />
    </div>
  )
}
