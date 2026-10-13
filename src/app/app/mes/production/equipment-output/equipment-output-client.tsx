"use client"

import { useState, useTransition } from "react"
import { useRouter, usePathname } from "next/navigation"
import { BarChart2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EquipmentOutputDataTable } from "./equipment-output-data-table"
import type {
  EquipmentOutputRow,
  EquipmentOutputFilter,
  PeriodType,
} from "@/lib/actions/equipment-output.actions"
import { formatQuantity } from "@/lib/utils"

// ─── 기간 유형 레이블 ─────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<PeriodType, string> = {
  day:   "일별",
  week:  "주별",
  month: "월별",
  year:  "연별",
  range: "기간 지정",
}

// ─── 요약 카드 ────────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  suffix,
  accent,
  isDecimal,
}: {
  label:      string
  value:      number
  suffix?:    string
  accent?:    "green" | "amber" | "red"
  isDecimal?: boolean
}) {
  const textColor =
    accent === "green" ? "text-emerald-700"
    : accent === "amber" ? "text-amber-600"
    : accent === "red"   ? "text-red-600"
    : "text-foreground"

  const display = isDecimal ? value.toFixed(1) : formatQuantity(value)

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[22px] font-semibold tabular-nums ${textColor}`}>
        {display}
        {suffix && (
          <span className="ml-1 text-[14px] font-normal text-muted-foreground">
            {suffix}
          </span>
        )}
      </p>
    </div>
  )
}

// ─── 빈 상태 ──────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-lg border bg-card py-16 text-center">
      <BarChart2 className="mx-auto h-10 w-10 mb-3 opacity-20" />
      <p className="text-[15px] text-muted-foreground">선택한 기간에 생산 데이터가 없습니다.</p>
      <p className="text-[13px] text-muted-foreground mt-1">기간 조건을 변경해 보세요.</p>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  data:          EquipmentOutputRow[]
  appliedFilter: EquipmentOutputFilter
}

export function EquipmentOutputClient({ data, appliedFilter }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()

  // ── 필터 UI 상태 (서버에서 받은 적용값으로 초기화) ───────────────────────────
  const [periodType, setPeriodType] = useState<PeriodType>(appliedFilter.periodType)
  const [dayDate,    setDayDate]    = useState(appliedFilter.periodDate)
  const [month,      setMonth]      = useState(appliedFilter.periodMonth)
  const [year,       setYear]       = useState(appliedFilter.periodYear)
  const [rangeFrom,  setRangeFrom]  = useState(
    appliedFilter.periodType === "range" ? appliedFilter.from : appliedFilter.periodMonth + "-01"
  )
  const [rangeTo,    setRangeTo]    = useState(
    appliedFilter.periodType === "range" ? appliedFilter.to : appliedFilter.periodDate
  )
  const [filterError, setFilterError] = useState("")

  // ── 연도 선택지 (현재 -3 ~ +4) ──────────────────────────────────────────────
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: 8 }, (_, i) => currentYear - 3 + i)

  // ── 조회 버튼 ────────────────────────────────────────────────────────────────
  function handleApply() {
    setFilterError("")

    if (periodType === "range") {
      if (!rangeFrom || !rangeTo) {
        setFilterError("시작일과 종료일을 모두 입력해 주세요.")
        return
      }
      if (rangeFrom > rangeTo) {
        setFilterError("시작일이 종료일보다 늦을 수 없습니다.")
        return
      }
      const diffDays =
        (new Date(rangeTo).getTime() - new Date(rangeFrom).getTime()) / 86_400_000
      if (diffDays > 366) {
        setFilterError("조회 기간은 최대 1년(366일)까지 설정할 수 있습니다.")
        return
      }
    }

    const params = new URLSearchParams({ periodType })
    if (periodType === "day")   params.set("date",  dayDate)
    if (periodType === "week")  params.set("date",  dayDate)
    if (periodType === "month") params.set("month", month)
    if (periodType === "year")  params.set("year",  year)
    if (periodType === "range") { params.set("from", rangeFrom); params.set("to", rangeTo) }

    startTransition(() => { router.push(`${pathname}?${params.toString()}`) })
  }

  // ── 요약 통계 ────────────────────────────────────────────────────────────────
  const totalEquipment = data.length
  const totalGood      = data.reduce((s, r) => s + r.goodQty,   0)
  const totalDefect    = data.reduce((s, r) => s + r.defectQty, 0)
  const totalRework    = data.reduce((s, r) => s + r.reworkQty, 0)
  const denom          = totalGood + totalDefect + totalRework
  const avgDefectRate  = denom > 0 ? (totalDefect / denom) * 100 : 0

  // ── 적용 기간 표시 ────────────────────────────────────────────────────────────
  const appliedRangeLabel =
    appliedFilter.from === appliedFilter.to
      ? appliedFilter.from
      : `${appliedFilter.from} ~ ${appliedFilter.to}`

  const weekNote =
    appliedFilter.periodType === "week"
      ? `(${appliedFilter.periodDate} 기준 주: ${appliedFilter.from} ~ ${appliedFilter.to})`
      : null

  return (
    <>
      {/* 기간 필터 */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-4">

          {/* 기간 유형 */}
          <div className="space-y-1.5">
            <Label className="text-[13px]">조회 기준</Label>
            <Select
              value={periodType}
              onValueChange={(v) => { setPeriodType(v as PeriodType); setFilterError("") }}
            >
              <SelectTrigger className="text-[14px] h-9 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(PERIOD_LABELS) as [PeriodType, string][]).map(([v, l]) => (
                  <SelectItem key={v} value={v} className="text-[14px]">{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 일별 */}
          {periodType === "day" && (
            <div className="space-y-1.5">
              <Label className="text-[13px]">날짜</Label>
              <Input
                type="date"
                value={dayDate}
                onChange={(e) => setDayDate(e.target.value)}
                className="h-9 w-40 text-[14px]"
              />
            </div>
          )}

          {/* 주별 */}
          {periodType === "week" && (
            <div className="space-y-1.5">
              <Label className="text-[13px]">기준 날짜 (해당 주 월~일 조회)</Label>
              <Input
                type="date"
                value={dayDate}
                onChange={(e) => setDayDate(e.target.value)}
                className="h-9 w-40 text-[14px]"
              />
            </div>
          )}

          {/* 월별 */}
          {periodType === "month" && (
            <div className="space-y-1.5">
              <Label className="text-[13px]">월</Label>
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="h-9 w-36 text-[14px]"
              />
            </div>
          )}

          {/* 연별 */}
          {periodType === "year" && (
            <div className="space-y-1.5">
              <Label className="text-[13px]">연도</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="h-9 w-28 text-[14px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)} className="text-[14px]">
                      {y}년
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 기간 지정 */}
          {periodType === "range" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[13px]">시작일</Label>
                <Input
                  type="date"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  className="h-9 w-40 text-[14px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">종료일</Label>
                <Input
                  type="date"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  className="h-9 w-40 text-[14px]"
                />
              </div>
            </>
          )}

          <Button size="sm" onClick={handleApply} className="h-9">
            조회
          </Button>
        </div>

        {/* 적용된 기간 표시 */}
        <p className="text-[13px] text-muted-foreground">
          {`조회 기간: ${appliedRangeLabel}`}
          {weekNote && <span className="ml-1">{weekNote}</span>}
        </p>

        {/* 입력 오류 */}
        {filterError && (
          <p className="text-[13px] text-red-500">{filterError}</p>
        )}
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="집계 설비"    value={totalEquipment} suffix="대" />
        <SummaryCard label="총 양품수량"  value={totalGood}      suffix="개" accent="green" />
        <SummaryCard
          label="총 불량수량"
          value={totalDefect}
          suffix="개"
          accent={totalDefect > 0 ? "red" : undefined}
        />
        <SummaryCard
          label="평균 불량률"
          value={avgDefectRate}
          suffix="%"
          isDecimal
          accent={avgDefectRate >= 5 ? "red" : avgDefectRate > 0 ? "amber" : undefined}
        />
      </div>

      {/* 데이터 테이블 또는 빈 상태 */}
      {data.length === 0 ? <EmptyState /> : <EquipmentOutputDataTable data={data} />}
    </>
  )
}
