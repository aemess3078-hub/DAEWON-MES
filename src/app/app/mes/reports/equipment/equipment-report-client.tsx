"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Filter, RotateCcw, FileSpreadsheet, Printer } from "lucide-react"

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatQuantity, formatPercent } from "@/lib/utils"
import { downloadExcelSheet } from "@/lib/export-excel"
import {
  buildEquipmentReportRows,
  buildEquipmentDailyTrend,
  buildReportFilename,
} from "@/lib/actions/report.helpers"
import type { EquipmentStatisticsData } from "@/lib/actions/equipment-statistics.actions"

const NONE_VALUE = "__ALL__"

interface FilterState {
  from: string
  to: string
  equipmentId: string
}

interface Props {
  initialFilter: FilterState
  data: EquipmentStatisticsData
  equipments: { id: string; code: string; name: string }[]
}

export function EquipmentReportClient({ initialFilter, data, equipments }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [filter, setFilter] = useState<FilterState>(initialFilter)
  // 서버(SSR)와 클라이언트(hydration)의 Date 포맷팅 엔진이 로케일 문자열을
  // 다르게 렌더링할 수 있어 렌더 중에 계산하면 hydration mismatch가 난다 —
  // 마운트 이후에만 클라이언트에서 계산한다.
  const [printedAt, setPrintedAt] = useState("")
  useEffect(() => {
    setPrintedAt(new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }))
  }, [])

  function applyFilter(next: FilterState) {
    const params = new URLSearchParams()
    if (next.from) params.set("from", next.from)
    if (next.to) params.set("to", next.to)
    if (next.equipmentId) params.set("equipmentId", next.equipmentId)
    startTransition(() => {
      router.push(`/app/mes/reports/equipment?${params.toString()}`)
    })
  }

  function resetFilter() {
    const reset: FilterState = { ...initialFilter, equipmentId: "" }
    setFilter(reset)
    applyFilter(reset)
  }

  const equipmentRows = useMemo(() => buildEquipmentReportRows(data), [data])
  const dailyTrend = useMemo(() => buildEquipmentDailyTrend(data), [data])

  function handleExcelDownload() {
    // downloadExcelSheet은 단일 시트 헬퍼다(§ export-excel.ts) — 설비별
    // 통계와 일자별 추이를 한 시트에 담기 위해 구분 빈 행을 두고 이어붙인다
    // (다중시트 API를 새로 만들지 않고 기존 헬퍼를 그대로 재사용).
    const header = ["설비코드", "설비명", "양품수량", "불량수량", "작업시간(h)", "가동시간(분)", "가동률", "비가동시간(분)", "알람건수", "경고건수"]
    const rows = equipmentRows.map((r) => [
      r.code,
      r.name,
      r.goodQty,
      r.defectQty,
      r.workHours,
      r.runMinutes,
      r.availabilityRate !== null ? Number((r.availabilityRate * 100).toFixed(1)) : "",
      r.downtimeMinutes,
      r.alarmCount,
      r.warningCount,
    ])
    const trendHeader = ["일자", "양품수량", "불량수량", "작업시간(h)"]
    const trendRows = dailyTrend.map((d) => [d.date, d.goodQty, d.defectQty, d.hours])

    const filename = buildReportFilename("설비리포트", filter.from, filter.to)

    downloadExcelSheet(filename, "설비리포트", header, [
      ...rows,
      [],
      trendHeader,
      ...trendRows,
    ])
  }

  return (
    <div className="space-y-6">
      {/* 필터 */}
      <div className="rounded-lg border bg-card p-4 space-y-3 print:hidden">
        <div className="flex items-center gap-2 text-[14px] font-medium text-foreground">
          <Filter className="h-4 w-4" />
          필터
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label htmlFor="from" className="text-[13px]">시작일</Label>
            <Input
              id="from"
              type="date"
              value={filter.from}
              onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))}
              className="h-9 text-[14px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to" className="text-[13px]">종료일</Label>
            <Input
              id="to"
              type="date"
              value={filter.to}
              onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))}
              className="h-9 text-[14px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px]">설비</Label>
            <Select
              value={filter.equipmentId || NONE_VALUE}
              onValueChange={(v) => setFilter((f) => ({ ...f, equipmentId: v === NONE_VALUE ? "" : v }))}
            >
              <SelectTrigger className="h-9 text-[14px]">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {equipments.map((eq) => (
                  <SelectItem key={eq.id} value={eq.id}>[{eq.code}] {eq.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={resetFilter} disabled={isPending} className="gap-1">
            <RotateCcw className="h-3.5 w-3.5" />
            초기화
          </Button>
          <Button size="sm" onClick={() => applyFilter(filter)} disabled={isPending}>
            {isPending ? "조회중..." : "조회"}
          </Button>
        </div>
      </div>

      {/* 인쇄 전용 헤더 */}
      <div className="hidden print:block">
        <h1 className="text-[20px] font-semibold">설비리포트</h1>
        <p className="text-[13px] text-muted-foreground">
          조회기간: {filter.from} ~ {filter.to} · 출력일시: {printedAt}
        </p>
      </div>

      {/* 액션 버튼 */}
      <div className="flex justify-end gap-2 print:hidden">
        <Button variant="outline" size="sm" onClick={handleExcelDownload} className="gap-1">
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Excel 다운로드
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1">
          <Printer className="h-3.5 w-3.5" />
          인쇄
        </Button>
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <SummaryCard label="총양품수량" value={formatQuantity(data.production.totalGoodQty)} accent="green" />
        <SummaryCard label="총불량수량" value={formatQuantity(data.production.totalDefectQty)} accent="red" />
        <SummaryCard label="평균가동률" value={formatPercent(data.availability.avgRate)} />
        <SummaryCard label="총비가동시간" value={`${formatQuantity(data.downtime.totalMinutes)}분`} />
        <SummaryCard label="알람/경고" value={`${formatQuantity(data.errors.alarmCount)}/${formatQuantity(data.errors.warningCount)}`} />
        <SummaryCard label="총작업시간" value={data.workTime.totalHours !== null ? `${formatQuantity(data.workTime.totalHours)}h` : "-"} />
      </div>

      {/* 설비별 통계 */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-[16px] font-semibold text-foreground">설비별 통계</h2>
        {equipmentRows.length === 0 ? (
          <EmptyBox message="해당 조건의 설비 데이터가 없습니다." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[13px]">설비</TableHead>
                  <TableHead className="text-[13px] text-right">양품수량</TableHead>
                  <TableHead className="text-[13px] text-right">불량수량</TableHead>
                  <TableHead className="text-[13px] text-right">작업시간(h)</TableHead>
                  <TableHead className="text-[13px] text-right">가동시간(분)</TableHead>
                  <TableHead className="text-[13px] text-right">가동률</TableHead>
                  <TableHead className="text-[13px] text-right">비가동시간(분)</TableHead>
                  <TableHead className="text-[13px] text-right">알람</TableHead>
                  <TableHead className="text-[13px] text-right">경고</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {equipmentRows.map((r) => (
                  <TableRow key={r.code}>
                    <TableCell className="text-[14px]">[{r.code}] {r.name}</TableCell>
                    <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(r.goodQty)}</TableCell>
                    <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(r.defectQty)}</TableCell>
                    <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(r.workHours)}</TableCell>
                    <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(r.runMinutes)}</TableCell>
                    <TableCell className="text-[14px] text-right tabular-nums">{formatPercent(r.availabilityRate)}</TableCell>
                    <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(r.downtimeMinutes)}</TableCell>
                    <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(r.alarmCount)}</TableCell>
                    <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(r.warningCount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* 일자별 생산/작업시간 추이 */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-[16px] font-semibold text-foreground">일자별 생산/작업시간</h2>
        {dailyTrend.length === 0 ? (
          <EmptyBox message="해당 기간의 데이터가 없습니다." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[13px]">일자</TableHead>
                  <TableHead className="text-[13px] text-right">양품수량</TableHead>
                  <TableHead className="text-[13px] text-right">불량수량</TableHead>
                  <TableHead className="text-[13px] text-right">작업시간</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dailyTrend.map((d) => (
                  <TableRow key={d.date}>
                    <TableCell className="text-[14px]">{d.date}</TableCell>
                    <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(d.goodQty)}</TableCell>
                    <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(d.defectQty)}</TableCell>
                    <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(d.hours)}h</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: "green" | "red"
}) {
  const color = accent === "green" ? "text-emerald-700" : accent === "red" ? "text-red-700" : "text-foreground"
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[20px] font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

function EmptyBox({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-10 rounded-md border border-dashed text-[13px] text-muted-foreground">
      {message}
    </div>
  )
}
