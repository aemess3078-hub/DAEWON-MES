import {
  getDefectCauseAnalysisList,
  getDefectCauseAnalysisFilterOptions,
  type DefectCauseAnalysisFilter,
} from "@/lib/actions/defect-cause-analysis.actions"
import { kstDefaultDateRange, isValidKstDateRange } from "@/lib/date/kst"
import { CauseAnalysisClient } from "./cause-analysis-client"

export const dynamic = "force-dynamic"

interface CauseAnalysisPageProps {
  searchParams?: Promise<{
    from?: string
    to?: string
    itemId?: string
    routingOperationId?: string
    manufacturingNo?: string
    defectCodeId?: string
    analysisStatus?: string
  }>
}

const VALID_STATUS = new Set(["ALL", "ANALYZED", "UNANALYZED"])

export default async function CauseAnalysisPage({ searchParams }: CauseAnalysisPageProps) {
  const params = searchParams ? await searchParams : {}
  const { from: defaultFrom, to: defaultTo } = kstDefaultDateRange(30)

  const rawFrom = params.from?.trim()
  const rawTo = params.to?.trim()
  const bothValid = !!rawFrom && !!rawTo && isValidKstDateRange(rawFrom, rawTo)

  const filter: DefectCauseAnalysisFilter = {
    from: bothValid ? rawFrom! : defaultFrom,
    to: bothValid ? rawTo! : defaultTo,
    itemId: params.itemId?.trim() || undefined,
    routingOperationId: params.routingOperationId?.trim() || undefined,
    manufacturingNo: params.manufacturingNo?.trim() || undefined,
    defectCodeId: params.defectCodeId?.trim() || undefined,
    analysisStatus:
      params.analysisStatus && VALID_STATUS.has(params.analysisStatus)
        ? (params.analysisStatus as "ALL" | "ANALYZED" | "UNANALYZED")
        : "ALL",
  }

  const [rows, filterOptions] = await Promise.all([
    getDefectCauseAnalysisList(filter),
    getDefectCauseAnalysisFilterOptions(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          원인분석
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          불량 및 이상 발생 원인을 등록하고 분석 내용을 기록·관리합니다.
        </p>
      </div>

      <CauseAnalysisClient
        initialFilter={{
          from: filter.from!,
          to: filter.to!,
          itemId: filter.itemId ?? "",
          routingOperationId: filter.routingOperationId ?? "",
          manufacturingNo: filter.manufacturingNo ?? "",
          defectCodeId: filter.defectCodeId ?? "",
          analysisStatus: filter.analysisStatus ?? "ALL",
        }}
        rows={rows}
        filterOptions={filterOptions}
      />
    </div>
  )
}
