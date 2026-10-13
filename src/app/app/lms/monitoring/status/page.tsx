import { Suspense } from "react"
import { CalendarCheck } from "lucide-react"
import { RealtimeMonitorClient } from "./realtime-monitor-client"
import { DailyProductionSummary } from "@/components/common/daily-production-summary"

// 세션 쿠키에서 tenantId를 읽으므로 캐시 금지.
// 단, 이 페이지 자체는 무거운 DB 조회를 하지 않는다 — 설비 데이터는 클라이언트가
// 마운트 직후 /api/mes/equipment-monitor/light를 호출해 가져온다.
export const dynamic = "force-dynamic"

function DailyProductionSummarySkeleton() {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarCheck className="h-[18px] w-[18px] text-muted-foreground/30" />
        <div className="h-5 w-28 rounded-md bg-muted animate-pulse" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4">
            <div className="h-3.5 w-14 rounded bg-muted animate-pulse mb-2" />
            <div className="h-8 w-16 rounded bg-muted animate-pulse" />
            <div className="h-3 w-20 rounded bg-muted animate-pulse mt-2" />
          </div>
        ))}
      </div>
    </section>
  )
}

export default function StatusMonitoringPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          설비현황
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          설비 가동 상태를 실시간으로 관제합니다.
        </p>
      </div>

      {/* Suspense로 감싸 DailyProductionSummary DB 조회가 끝나기 전에 페이지 shell을 먼저 렌더링 */}
      <Suspense fallback={<DailyProductionSummarySkeleton />}>
        <DailyProductionSummary />
      </Suspense>

      {/* 설비 데이터는 SSR 없이 클라이언트에서 light API로 로드 */}
      <RealtimeMonitorClient />
    </div>
  )
}
