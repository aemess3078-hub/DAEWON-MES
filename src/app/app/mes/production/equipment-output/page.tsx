import { getEquipmentOutputStats } from "@/lib/actions/equipment-output.actions"
import type { PeriodType, EquipmentOutputFilter } from "@/lib/actions/equipment-output.actions"
import { EquipmentOutputClient } from "./equipment-output-client"

export const dynamic = "force-dynamic"

// ─── 날짜 유틸 ────────────────────────────────────────────────────────────────

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function computeFilter(params: Record<string, string | undefined>): EquipmentOutputFilter {
  const today = new Date()
  const periodType = (params.periodType as PeriodType) || "month"

  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  const defaultDate  = fmt(today)
  const defaultYear  = String(today.getFullYear())

  switch (periodType) {
    case "day": {
      const date = params.date || defaultDate
      return { periodType, from: date, to: date, periodDate: date, periodMonth: defaultMonth, periodYear: defaultYear }
    }

    case "week": {
      const dateStr = params.date || defaultDate
      const base = new Date(`${dateStr}T12:00:00`)
      const day  = base.getDay()                      // 0=일, 1=월 …
      const diff = day === 0 ? -6 : 1 - day           // 월요일까지의 차이
      const mon  = new Date(base); mon.setDate(base.getDate() + diff)
      const sun  = new Date(mon);  sun.setDate(mon.getDate() + 6)
      return {
        periodType,
        from:        fmt(mon),
        to:          fmt(sun),
        periodDate:  dateStr,
        periodMonth: defaultMonth,
        periodYear:  defaultYear,
      }
    }

    case "month": {
      const month = params.month || defaultMonth
      const [y, m] = month.split("-").map(Number)
      const lastDay = new Date(y, m, 0).getDate()
      return {
        periodType,
        from:        `${month}-01`,
        to:          `${month}-${String(lastDay).padStart(2, "0")}`,
        periodDate:  defaultDate,
        periodMonth: month,
        periodYear:  defaultYear,
      }
    }

    case "year": {
      const year = params.year || defaultYear
      return {
        periodType,
        from:        `${year}-01-01`,
        to:          `${year}-12-31`,
        periodDate:  defaultDate,
        periodMonth: defaultMonth,
        periodYear:  year,
      }
    }

    default: { // range
      const from = params.from || `${defaultMonth}-01`
      const to   = params.to   || defaultDate
      return {
        periodType: "range",
        from,
        to,
        periodDate:  defaultDate,
        periodMonth: defaultMonth,
        periodYear:  defaultYear,
      }
    }
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface Props {
  searchParams?: Promise<Record<string, string | undefined>>
}

export default async function EquipmentOutputPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {}
  const filter = computeFilter(params)

  const rows = await getEquipmentOutputStats({ from: filter.from, to: filter.to })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          설비별생산현황
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          MES › 생산관리 · 설비에 배정된 공정의 생산실적을 설비 단위로 집계합니다.
        </p>
      </div>

      <EquipmentOutputClient data={rows} appliedFilter={filter} />
    </div>
  )
}
