"use client"

import { useTransition } from "react"
import { useRouter, usePathname } from "next/navigation"
import { BarChart2, Info } from "lucide-react"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import type {
  EquipmentAnalysisData,
  EquipmentAnalysisRow,
  AnalysisPeriod,
  TimelineData,
} from "@/lib/actions/equipment-analysis.actions"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS: { value: AnalysisPeriod; label: string }[] = [
  { value: "today", label: "오늘" },
  { value: "week",  label: "최근 7일" },
  { value: "month", label: "이번 달" },
]

function fmtMins(mins: number): string {
  if (mins === 0) return "—"
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}분`
  if (m === 0) return `${h}시간`
  return `${h}시간 ${m}분`
}

// ─── Ratio bar ────────────────────────────────────────────────────────────────

// 막대는 가동률(runRate)과 일치시킨다. NCWatch 일간 집계는 가동률(%)을 24시간 기준으로
// 산출하지만 비가동 항목별(정지/수동/오프라인) 시간은 에이전트가 전송하지 않으므로,
// 가동 / (알람) / 비가동 3분할로 표시한다 — 표의 가동률 숫자와 정확히 일치.
function RatioBar({ row }: { row: EquipmentAnalysisRow }) {
  if (row.source === "none" || row.runRate === null) {
    return <span className="text-[13px] text-muted-foreground">데이터 없음</span>
  }

  const run   = Math.max(0, Math.min(100, row.runRate))
  const alarm = Math.max(0, Math.min(100 - run, row.alarmRate ?? 0))
  const idle  = Math.max(0, 100 - run - alarm)

  return (
    <div className="flex h-3.5 w-36 rounded-full overflow-hidden bg-slate-100">
      {run > 0 && (
        <div className="bg-green-500 h-full" style={{ width: `${run}%` }} title={`가동 ${run.toFixed(1)}%`} />
      )}
      {alarm > 0 && (
        <div className="bg-red-500 h-full" style={{ width: `${alarm}%` }} title={`알람 ${alarm.toFixed(1)}%`} />
      )}
      {idle > 0 && (
        <div className="bg-slate-300 h-full" style={{ width: `${idle}%` }} title={`비가동 ${idle.toFixed(1)}%`} />
      )}
    </div>
  )
}

// ─── 24h Timeline ─────────────────────────────────────────────────────────────

const EVENT_COLOR: Record<string, string> = {
  RUN:         "bg-green-500",
  STOP:        "bg-slate-300",
  ALARM:       "bg-red-500",
  WARNING:     "bg-amber-300",
  MAINTENANCE: "bg-blue-400",
}

const HOUR_TICKS = [0, 4, 8, 12, 16, 20, 24]

function TimelineSection({ timeline }: { timeline: TimelineData }) {
  const { dayStart, dayEnd, now, equipments } = timeline
  const totalMs = Math.max(1, dayEnd.getTime() - dayStart.getTime()) // 고정 24h
  const nowPct = Math.min(100, Math.max(0, ((now.getTime() - dayStart.getTime()) / totalMs) * 100))

  if (equipments.length === 0) return null
  // 이벤트가 하나도 없는 경우 섹션 자체를 숨기지 않음 — "이벤트 없음" 표시
  const hasAnyEvent = equipments.some((eq) => eq.events.length > 0)

  function segLeft(ts: Date): number {
    const ms = Math.max(0, ts.getTime() - dayStart.getTime())
    return Math.min(100, (ms / totalMs) * 100)
  }
  function segWidth(from: Date, to: Date): number {
    const cFrom = from < dayStart ? dayStart : from
    const cTo   = to   > dayEnd   ? dayEnd   : to
    if (cTo <= cFrom) return 0
    return Math.min(100 - segLeft(cFrom), ((cTo.getTime() - cFrom.getTime()) / totalMs) * 100)
  }

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold">24시간 가동 타임라인</h3>
        <span className="text-[13px] text-muted-foreground">
          {format(dayStart, "M월 d일 (E)", { locale: ko })} · 현재 {format(now, "HH:mm")}
        </span>
      </div>

      {!hasAnyEvent ? (
        <p className="text-[14px] text-muted-foreground text-center py-6">
          오늘 기록된 설비 이벤트가 없습니다.
        </p>
      ) : (
        <div className="space-y-1.5">
          {/* 시각 눈금 헤더 */}
          <div className="flex">
            <div className="w-28 shrink-0" />
            <div className="flex-1 relative h-5">
              {HOUR_TICKS.map((h) => (
                <span
                  key={h}
                  className="absolute text-[11px] text-muted-foreground -translate-x-1/2 select-none"
                  style={{ left: `${(h / 24) * 100}%` }}
                >
                  {String(h).padStart(2, "0")}:00
                </span>
              ))}
            </div>
          </div>

          {/* 설비별 타임라인 바 */}
          {equipments.map((eq) => (
            <div key={eq.equipmentId} className="flex items-center">
              <div className="w-28 shrink-0 text-right pr-3 text-[13px] text-muted-foreground truncate">
                {eq.equipmentName}
              </div>
              <div className="flex-1 relative h-7 bg-slate-100 rounded overflow-hidden">
                {/* 시간대 구분선 */}
                {HOUR_TICKS.filter((h) => h > 0 && h < 24).map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 h-full w-px bg-white/50 z-10 pointer-events-none"
                    style={{ left: `${(h / 24) * 100}%` }}
                  />
                ))}

                {/* 미래 구간(현재 이후) 흐리게 */}
                {nowPct < 100 && (
                  <div
                    className="absolute top-0 h-full bg-slate-50 z-0"
                    style={{ left: `${nowPct}%`, width: `${100 - nowPct}%` }}
                  />
                )}

                {/* 현재 시각 마커 */}
                {nowPct < 100 && (
                  <div
                    className="absolute top-0 h-full w-px bg-foreground/40 z-20 pointer-events-none"
                    style={{ left: `${nowPct}%` }}
                    title={`현재 ${format(now, "HH:mm")}`}
                  />
                )}

                {/* 이벤트 세그먼트 */}
                {eq.events.map((ev, i) => {
                  const from = new Date(ev.startedAt)
                  const to   = ev.endedAt ? new Date(ev.endedAt) : now
                  if (from >= dayEnd || to <= dayStart) return null
                  const left  = segLeft(from < dayStart ? dayStart : from)
                  const width = segWidth(from, to)
                  if (width < 0.05) return null
                  const color = EVENT_COLOR[ev.eventType] ?? "bg-slate-300"
                  const label = `${ev.eventType} ${format(from < dayStart ? dayStart : from, "HH:mm")}–${ev.endedAt ? format(to, "HH:mm") : "진행중"}`
                  return (
                    <div
                      key={i}
                      className={`absolute top-0 h-full ${color}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={label}
                    />
                  )
                })}

                {/* 이벤트 없는 설비 */}
                {eq.events.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[11px] text-muted-foreground/50">이벤트 없음</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 범례 */}
      <div className="flex items-center gap-4 text-[12px] text-muted-foreground ml-28 pt-1">
        {[
          { color: "bg-green-500", label: "가동"  },
          { color: "bg-slate-300", label: "정지"  },
          { color: "bg-red-500",   label: "알람"  },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-sm ${color}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  data: EquipmentAnalysisData
  timelineData: TimelineData
}

export function EquipmentAnalysisClient({ data, timelineData }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  function handlePeriod(period: AnalysisPeriod) {
    startTransition(() => {
      router.push(`${pathname}?period=${period}`)
    })
  }

  const { rows, period, periodLabel, hasNcwatchData } = data

  const withData = rows.filter((r) => r.source !== "none")
  const avgRunRate =
    withData.length > 0
      ? Math.round(
          (withData.reduce((s, r) => s + (r.runRate ?? 0), 0) / withData.length) * 10
        ) / 10
      : null
  const totalAlarms = rows.reduce((s, r) => s + r.alarmCount, 0)

  return (
    <>
      {/* Period filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handlePeriod(opt.value)}
            disabled={isPending}
            className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
              period === opt.value
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-1 text-[13px] text-muted-foreground">기준: {periodLabel}</span>
        {!hasNcwatchData && (
          <span className="ml-auto flex items-center gap-1 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md">
            <Info className="h-3.5 w-3.5" />
            NCWatch 일간 집계 없음 — 이벤트 기반 집계
          </span>
        )}
      </div>

      {/* Summary KPI */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-[13px] text-muted-foreground mb-1">평균 가동률</p>
          <p className="text-[28px] font-semibold text-green-700">
            {avgRunRate !== null ? `${avgRunRate}%` : "—"}
          </p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            데이터 있는 설비 {withData.length}대 기준
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-[13px] text-muted-foreground mb-1">총 알람 발생</p>
          <p className="text-[28px] font-semibold text-red-700">{totalAlarms}건</p>
          <p className="text-[12px] text-muted-foreground mt-0.5">{periodLabel} 누계</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-[13px] text-muted-foreground mb-1">연동 설비</p>
          <p className="text-[28px] font-semibold">
            {withData.length}
            <span className="text-[16px] font-normal text-muted-foreground"> / {rows.length}대</span>
          </p>
          <p className="text-[12px] text-muted-foreground mt-0.5">데이터 수신 중</p>
        </div>
      </div>

      {/* Analysis table */}
      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card py-16 text-center">
          <BarChart2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-[15px] text-muted-foreground">조회할 설비 데이터가 없습니다.</p>
          <p className="text-[13px] text-muted-foreground mt-1">설비를 등록하거나 기간을 변경해 보세요.</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left py-3 px-4 text-[13px] font-medium text-muted-foreground">설비명</th>
                <th className="text-right py-3 px-4 text-[13px] font-medium text-muted-foreground">가동시간</th>
                <th className="text-right py-3 px-4 text-[13px] font-medium text-muted-foreground">정지시간</th>
                <th className="text-right py-3 px-4 text-[13px] font-medium text-muted-foreground">알람 발생</th>
                <th className="text-right py-3 px-4 text-[13px] font-medium text-muted-foreground">알람 횟수</th>
                <th className="text-right py-3 px-4 text-[13px] font-medium text-muted-foreground">가동률</th>
                <th className="py-3 px-4 text-[13px] font-medium text-muted-foreground">상태 비율</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.equipmentId} className={`${i > 0 ? "border-t" : ""} hover:bg-muted/20`}>
                  <td className="py-3 px-4">
                    <p className="text-[14px] font-medium">{row.equipmentName}</p>
                    <p className="text-[12px] text-muted-foreground">{row.equipmentCode}</p>
                  </td>
                  <td className="text-right py-3 px-4 text-[14px] text-green-700">
                    {fmtMins(row.runMinutes)}
                  </td>
                  <td className="text-right py-3 px-4 text-[14px] text-slate-500">
                    {fmtMins(row.stopMinutes)}
                  </td>
                  <td className="text-right py-3 px-4 text-[14px] text-red-600">
                    {row.lastAlarmAt ? format(new Date(row.lastAlarmAt), "MM/dd HH:mm") : "—"}
                  </td>
                  <td className="text-right py-3 px-4">
                    {row.alarmCount > 0 ? (
                      <span className="text-[13px] font-semibold text-red-600">{row.alarmCount}회</span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="text-right py-3 px-4">
                    {row.runRate !== null ? (
                      <span className="text-[14px] font-semibold">{row.runRate}%</span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <RatioBar row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {withData.length > 0 && (
        <div className="flex items-center gap-4 text-[12px] text-muted-foreground pt-1">
          <span className="font-medium text-foreground">범례</span>
          {[
            { color: "bg-green-500", label: "가동" },
            { color: "bg-red-500",   label: "알람" },
            { color: "bg-slate-300", label: "비가동" },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded-sm ${color}`} />
              {label}
            </span>
          ))}
        </div>
      )}

      {/* 24h 타임라인 */}
      <TimelineSection timeline={timelineData} />
    </>
  )
}
