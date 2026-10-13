import { CalendarCheck } from "lucide-react"

// 현황모니터링 페이지 네비게이션 중 즉시 표시되는 스켈레톤 UI.
// Next.js App Router는 이 파일을 Suspense 경계로 자동 처리해 메뉴 클릭 즉시 렌더링한다.
export default function StatusMonitoringLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-48 rounded-md bg-muted animate-pulse" />
        <div className="h-5 w-72 rounded-md bg-muted animate-pulse mt-2" />
      </div>

      {/* DailyProductionSummary 스켈레톤 */}
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

      {/* 설비 그리드 스켈레톤 */}
      <div className="space-y-4">
        <div className="flex gap-2.5 flex-wrap">
          {["전체", "가동", "비가동", "알람", "통신지연"].map((label) => (
            <div
              key={label}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg border bg-muted/30 animate-pulse"
            >
              <span className="text-[13px] text-muted-foreground/50">{label}</span>
              <span className="text-[24px] font-semibold leading-none text-muted-foreground/30">—</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4 h-48 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}
