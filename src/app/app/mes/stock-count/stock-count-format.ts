/** 재고실사 화면 공통 표시 도우미 (KST 일시, 소요시간, 상태 배지). */

export function formatKstDateTime(value: string | null | undefined): string {
  if (!value) return "-"
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`
}

/** 시작~종료 소요시간(종료 전이면 null) */
export function formatDuration(startedAt: string, endedAt: string | null): string | null {
  if (!endedAt) return null
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}분`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}시간 ${m}분` : `${h}시간`
}

export const STATUS_BADGE: Record<string, string> = {
  IN_PROGRESS: "border-amber-200 bg-amber-50 text-amber-700",
  COMPLETED: "border-green-200 bg-green-50 text-green-700",
  CANCELLED: "border-slate-200 bg-slate-50 text-slate-600",
}
