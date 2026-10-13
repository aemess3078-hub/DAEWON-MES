import {
  getEquipmentAnalysisData,
  getEquipmentTimelineData,
} from "@/lib/actions/equipment-analysis.actions"
import { EquipmentAnalysisClient } from "./analysis-client"
import { DailyProductionSummary } from "@/components/common/daily-production-summary"
import type { AnalysisPeriod } from "@/lib/actions/equipment-analysis.actions"

export const dynamic = "force-dynamic"

interface Props {
  searchParams?: Promise<{ period?: string }>
}

const VALID_PERIODS = new Set<AnalysisPeriod>(["today", "week", "month"])

function toPeriod(raw: string | undefined): AnalysisPeriod {
  if (raw && VALID_PERIODS.has(raw as AnalysisPeriod)) return raw as AnalysisPeriod
  return "today"
}

export default async function EquipmentAnalysisPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {}
  const period = toPeriod(params.period)
  const [data, timelineData] = await Promise.all([
    getEquipmentAnalysisData(period),
    getEquipmentTimelineData(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          분석 모니터링
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          설비별 가동률·비가동·알람 현황을 기간 단위로 분석합니다.
        </p>
      </div>

      <DailyProductionSummary />

      <EquipmentAnalysisClient data={data} timelineData={timelineData} />
    </div>
  )
}
