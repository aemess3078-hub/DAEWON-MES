export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import {
  getProductionResults,
} from "@/lib/actions/production-result.actions"
import { resolveKstDateRangeFilter } from "@/lib/date/kst"
import { isFeatureEnabled } from "@/lib/services/feature.service"
import { ProductionResultDataTable } from "./production-result-data-table"

// 화면에 읽어 오는 실적 상한. 이보다 많으면 최신순으로 잘라 안내한다(기간을 좁혀 조회).
const RESULT_LIMIT = 3000
const RANGE_PRESETS: Record<string, number> = { "7": 7, "30": 30, "90": 90 }

interface ProductionResultsPageProps {
  searchParams?: Promise<{ range?: string; from?: string; to?: string }>
}

export default async function ProductionResultsPage({ searchParams }: ProductionResultsPageProps) {
  const params = searchParams ? await searchParams : {}
  const tenantId = await getTenantId()
  const enabled = await isFeatureEnabled(tenantId, "PRODUCTION_RESULT")

  if (!enabled) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">이 기능은 활성화되어 있지 않습니다.</p>
      </div>
    )
  }

  // 기간: from/to 직접 지정 > range 프리셋(7/30/90일, all=전체) > 기본 최근 30일
  const isAll = params.range === "all"
  const presetDays = RANGE_PRESETS[params.range ?? ""] ?? 30
  const hasCustom = !!params.from && !!params.to
  const resolved = resolveKstDateRangeFilter(
    presetDays,
    hasCustom ? params.from : undefined,
    hasCustom ? params.to : undefined
  )
  const fetched = await getProductionResults(
    isAll ? undefined : { startDate: resolved.fromDate, endDateExclusive: resolved.toExclusiveDate },
    { limit: RESULT_LIMIT + 1 }
  )
  const truncated = fetched.length > RESULT_LIMIT
  const results = truncated ? fetched.slice(0, RESULT_LIMIT) : fetched
  const period = {
    mode: isAll ? "all" : hasCustom ? "custom" : String(presetDays),
    from: resolved.from,
    to: resolved.to,
    limit: RESULT_LIMIT,
    truncated,
  } as const

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          작업일지(실적)
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          공정별 생산 실적을 조회하고 양품·불량·재작업 수량을 분석합니다.
        </p>
      </div>
      <ProductionResultDataTable data={results} period={period} />
    </div>
  )
}
