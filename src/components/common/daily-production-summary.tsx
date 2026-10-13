import { getDailyProductionSummary } from "@/lib/actions/daily-production.actions"
import { CalendarCheck } from "lucide-react"

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

function formatKstTime(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS)
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  return `${hh}:${mm}`
}

/**
 * 오늘(KST) 생산실적 요약 KPI 섹션.
 * 현황 모니터링·분석 모니터링 상단에 공통으로 사용한다.
 */
export async function DailyProductionSummary() {
  const s = await getDailyProductionSummary()

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarCheck className="h-[18px] w-[18px] text-muted-foreground" />
        <h2 className="text-[18px] font-semibold tracking-tight text-foreground">
          오늘 생산현황
        </h2>
        <span className="text-[13px] text-muted-foreground">{s.date} 기준</span>
        <span className="ml-auto text-[13px] text-muted-foreground">
          마지막 실적 {formatKstTime(s.latestAt)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-[13px] text-muted-foreground mb-1">총 생산량</p>
          <p className="text-[28px] font-semibold">{s.totalQty.toLocaleString()}</p>
          <p className="text-[12px] text-muted-foreground mt-0.5">양품+불량+재작업</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-[13px] text-muted-foreground mb-1">양품</p>
          <p className="text-[28px] font-semibold text-green-700">
            {s.goodQty.toLocaleString()}
          </p>
          <p className="text-[12px] text-muted-foreground mt-0.5">정상 생산 수량</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-[13px] text-muted-foreground mb-1">불량</p>
          <p className="text-[28px] font-semibold text-red-700">
            {s.defectQty.toLocaleString()}
          </p>
          <p className="text-[12px] text-muted-foreground mt-0.5">불량 판정 수량</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-[13px] text-muted-foreground mb-1">재작업</p>
          <p className="text-[28px] font-semibold text-amber-700">
            {s.reworkQty.toLocaleString()}
          </p>
          <p className="text-[12px] text-muted-foreground mt-0.5">재작업 수량</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-[13px] text-muted-foreground mb-1">불량률</p>
          <p
            className={`text-[28px] font-semibold ${
              s.defectRate >= 5 ? "text-red-700" : "text-foreground"
            }`}
          >
            {s.defectRate.toFixed(1)}
            <span className="text-[16px] font-normal text-muted-foreground">%</span>
          </p>
          <p className="text-[12px] text-muted-foreground mt-0.5">불량 / 총 생산량</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-[13px] text-muted-foreground mb-1">실적 건수</p>
          <p className="text-[28px] font-semibold">
            {s.resultCount.toLocaleString()}
            <span className="text-[16px] font-normal text-muted-foreground">건</span>
          </p>
          <p className="text-[12px] text-muted-foreground mt-0.5">생산실적 등록 건수</p>
        </div>
      </div>
    </section>
  )
}
