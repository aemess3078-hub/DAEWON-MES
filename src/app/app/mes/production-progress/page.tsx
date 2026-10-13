import { notFound } from "next/navigation"

import {
  getDailyProductionTrend,
  getProductionProgressData,
  getProductionProgressFilterOptions,
} from "@/lib/actions/production-progress.actions"
import type { ProductionProgressFilter } from "@/lib/actions/production-progress.types"
import { kstDefaultDateRange } from "@/lib/date/kst"
import { ProductionProgressClient } from "./production-progress-client"

// ─── 생산진행 현황(NewMES 전용) ─────────────────────────────────────────────────
//
// Server Action(getProductionProgressData/getProductionProgressFilterOptions)은
// 이미 assertNewMesBrand()로 보호되지만, 그것만으로는 CNS Medical 배포에서 이
// 페이지 shell 자체(제목/필터 UI 등)가 직접 URL 접근 시 노출되는 것까지는 막지
// 못한다. 그래서 페이지 진입 시점에도 동일한 기존 NEXT_PUBLIC_BRAND 값으로 한 번
// 더 막는다. 새 브랜드 판정 로직이 아니라 이미 프로젝트에 있는 접근제한 패턴
// (src/app/app/mes/features/page.tsx의 notFound() 가드)을 그대로 재사용했다.
export const dynamic = "force-dynamic"

const DEFAULT_PERIOD_DAYS = 30

function getDefaultFilter(): ProductionProgressFilter {
  return kstDefaultDateRange(DEFAULT_PERIOD_DAYS)
}

export default async function ProductionProgressPage() {
  if (process.env.NEXT_PUBLIC_BRAND !== "newmes") {
    notFound()
  }

  const defaultFilter = getDefaultFilter()

  const [filterOptions, data, trend] = await Promise.all([
    getProductionProgressFilterOptions(),
    getProductionProgressData(defaultFilter),
    getDailyProductionTrend(defaultFilter),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          생산현황
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          작업지시별 생산 진행상태와 실적을 확인합니다.
        </p>
      </div>

      <ProductionProgressClient
        initialData={data}
        initialTrend={trend}
        filterOptions={filterOptions}
        defaultFilter={defaultFilter}
      />
    </div>
  )
}
