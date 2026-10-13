"use client"

import { useEffect, useState, useTransition } from "react"
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
import { formatQuantity } from "@/lib/utils"
import { downloadExcelSheet } from "@/lib/export-excel"
import { buildReportFilename, formatKstDateTime } from "@/lib/actions/report.helpers"
import type {
  DailyProductionReportData,
  ReportFilterOptions,
} from "@/lib/actions/report.actions"

const NONE_VALUE = "__ALL__"

interface FilterState {
  from: string
  to: string
  siteId: string
  itemId: string
  routingOperationId: string
}

interface Props {
  initialFilter: FilterState
  report: DailyProductionReportData
  options: ReportFilterOptions
}

export function ProductionDailyReportClient({ initialFilter, report, options }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [filter, setFilter] = useState<FilterState>(initialFilter)
  // 서버(SSR)와 클라이언트(hydration)의 Date 포맷팅 엔진이 로케일 문자열을
  // 다르게 렌더링할 수 있어(예: "PM 7:20" vs "오후 7:20") 렌더 중에 계산하면
  // hydration mismatch가 난다 — 마운트 이후에만 클라이언트에서 계산한다.
  const [printedAt, setPrintedAt] = useState("")
  useEffect(() => {
    setPrintedAt(new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }))
  }, [])

  function applyFilter(next: FilterState) {
    const params = new URLSearchParams()
    if (next.from) params.set("from", next.from)
    if (next.to) params.set("to", next.to)
    if (next.siteId) params.set("siteId", next.siteId)
    if (next.itemId) params.set("itemId", next.itemId)
    if (next.routingOperationId) params.set("routingOperationId", next.routingOperationId)
    startTransition(() => {
      router.push(`/app/mes/reports/production-daily?${params.toString()}`)
    })
  }

  function resetFilter() {
    const reset: FilterState = { ...initialFilter, siteId: "", itemId: "", routingOperationId: "" }
    setFilter(reset)
    applyFilter(reset)
  }

  const { summary, dateGroups } = report
  const quantitySuffix = summary.isMixedUom ? "" : (summary.uom ?? "")
  const mixedUomMessage = "복수 단위가 포함되어 전체 수량 합계를 표시하지 않습니다."
  const formatSummaryQuantity = (value: number) =>
    summary.isMixedUom ? "단위 혼합" : formatQuantity(value)

  function handleExcelDownload() {
    const header = [
      "일자",
      "작업지시",
      "제조번호",
      "품목코드",
      "품목명",
      "공정",
      "작업자",
      "작업시작",
      "작업종료",
      "공정계획수량",
      "실적수량",
      "단위",
      "양품수량",
      "불량수량",
      "재작업수량",
      "작업시간(h)",
      "설비",
    ]
    const rows = dateGroups.flatMap((group) =>
      group.rows.map((r) => [
        r.date,
        r.orderNo,
        r.manufacturingNo ?? "",
        r.itemCode,
        r.itemName,
        r.operationName,
        r.operatorName ?? "",
        formatKstDateTime(r.startedAt),
        r.endedAt ? formatKstDateTime(r.endedAt) : "",
        r.plannedQty,
        r.producedQty,
        r.itemUom,
        r.goodQty,
        r.defectQty,
        r.reworkQty,
        r.workHours ?? "",
        r.equipmentName ?? "",
      ])
    )
    const filename = buildReportFilename("생산일보", filter.from, filter.to)
    downloadExcelSheet(filename, "생산일보", header, rows)
  }

  return (
    <div className="space-y-6">
      {/* 필터 */}
      <div className="rounded-lg border bg-card p-4 space-y-3 print:hidden">
        <div className="flex items-center gap-2 text-[14px] font-medium text-foreground">
          <Filter className="h-4 w-4" />
          필터
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
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
            <Label className="text-[13px]">사업장</Label>
            <Select
              value={filter.siteId || NONE_VALUE}
              onValueChange={(v) => setFilter((f) => ({ ...f, siteId: v === NONE_VALUE ? "" : v }))}
            >
              <SelectTrigger className="h-9 text-[14px]">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {options.sites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>[{site.code}] {site.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[13px]">품목</Label>
            <Select
              value={filter.itemId || NONE_VALUE}
              onValueChange={(v) => setFilter((f) => ({ ...f, itemId: v === NONE_VALUE ? "" : v }))}
            >
              <SelectTrigger className="h-9 text-[14px]">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {options.items.map((it) => (
                  <SelectItem key={it.id} value={it.id}>[{it.code}] {it.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[13px]">공정</Label>
            <Select
              value={filter.routingOperationId || NONE_VALUE}
              onValueChange={(v) => setFilter((f) => ({ ...f, routingOperationId: v === NONE_VALUE ? "" : v }))}
            >
              <SelectTrigger className="h-9 text-[14px]">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {options.routingOperations.map((op) => (
                  <SelectItem key={op.id} value={op.id}>
                    [{op.routingCode}] {op.routingName} / {op.name}
                  </SelectItem>
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
        <h1 className="text-[20px] font-semibold">생산일보</h1>
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
        <SummaryCard
          label="공정계획수량"
          value={formatSummaryQuantity(summary.totalPlannedQty)}
          suffix={quantitySuffix}
          description={summary.isMixedUom ? mixedUomMessage : undefined}
        />
        <SummaryCard
          label="총실적수량"
          value={formatSummaryQuantity(summary.totalProducedQty)}
          suffix={quantitySuffix}
          description={summary.isMixedUom ? mixedUomMessage : undefined}
        />
        <SummaryCard
          label="총양품수량"
          value={formatSummaryQuantity(summary.totalGoodQty)}
          suffix={quantitySuffix}
          accent="green"
          description={summary.isMixedUom ? mixedUomMessage : undefined}
        />
        <SummaryCard
          label="총불량수량"
          value={formatSummaryQuantity(summary.totalDefectQty)}
          suffix={quantitySuffix}
          accent="red"
          description={summary.isMixedUom ? mixedUomMessage : undefined}
        />
        <SummaryCard
          label="총재작업수량"
          value={formatSummaryQuantity(summary.totalReworkQty)}
          suffix={quantitySuffix}
          description={summary.isMixedUom ? mixedUomMessage : undefined}
        />
        <SummaryCard label="총작업시간" value={`${formatQuantity(summary.totalWorkHours)}h`} />
      </div>

      {/* 일자별 실적 테이블 */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <div className="print:hidden">
          <h2 className="text-[16px] font-semibold text-foreground">일자별 생산실적</h2>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            선택한 기간의 실적을 일자별로 정리합니다. 총 {summary.resultCount}건.
          </p>
        </div>
        {dateGroups.length === 0 ? (
          <EmptyBox message="해당 조건의 생산실적이 없습니다." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[13px]">작업지시</TableHead>
                  <TableHead className="text-[13px]">제조번호</TableHead>
                  <TableHead className="text-[13px]">품목</TableHead>
                  <TableHead className="text-[13px]">공정</TableHead>
                  <TableHead className="text-[13px]">작업자</TableHead>
                  <TableHead className="text-[13px]">작업시작</TableHead>
                  <TableHead className="text-[13px]">작업종료</TableHead>
                  <TableHead className="text-[13px] text-right">공정계획수량</TableHead>
                  <TableHead className="text-[13px] text-right">실적수량</TableHead>
                  <TableHead className="text-[13px]">단위</TableHead>
                  <TableHead className="text-[13px] text-right">양품수량</TableHead>
                  <TableHead className="text-[13px] text-right">불량수량</TableHead>
                  <TableHead className="text-[13px] text-right">재작업수량</TableHead>
                  <TableHead className="text-[13px] text-right">작업시간</TableHead>
                  <TableHead className="text-[13px]">설비</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dateGroups.map((group) => (
                  <DateGroupRows key={group.date} group={group} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}

function DateGroupRows({ group }: { group: DailyProductionReportData["dateGroups"][number] }) {
  const quantitySubtotal = (value: number) =>
    group.isMixedUom ? "단위 혼합" : `${formatQuantity(value)}${group.uom ? ` ${group.uom}` : ""}`

  return (
    <>
      <TableRow className="bg-muted/50">
        <TableCell colSpan={15} className="text-[13px] font-medium text-foreground">
          {group.date}
        </TableCell>
      </TableRow>
      {group.rows.map((r) => (
        <TableRow key={r.id}>
          <TableCell className="text-[14px]">{r.orderNo}</TableCell>
          <TableCell className="text-[14px]">{r.manufacturingNo ?? "-"}</TableCell>
          <TableCell className="text-[14px]">[{r.itemCode}] {r.itemName}</TableCell>
          <TableCell className="text-[14px]">{r.operationName}</TableCell>
          <TableCell className="text-[14px]">{r.operatorName ?? "-"}</TableCell>
          <TableCell className="text-[14px] whitespace-nowrap">{formatKstDateTime(r.startedAt)}</TableCell>
          <TableCell className="text-[14px] whitespace-nowrap">{r.endedAt ? formatKstDateTime(r.endedAt) : "-"}</TableCell>
          <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(r.plannedQty)}</TableCell>
          <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(r.producedQty)}</TableCell>
          <TableCell className="text-[14px]">{r.itemUom}</TableCell>
          <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(r.goodQty)}</TableCell>
          <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(r.defectQty)}</TableCell>
          <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(r.reworkQty)}</TableCell>
          <TableCell className="text-[14px] text-right tabular-nums">
            {r.workHours !== null ? `${formatQuantity(r.workHours)}h` : "-"}
          </TableCell>
          <TableCell className="text-[14px]">{r.equipmentName ?? "-"}</TableCell>
        </TableRow>
      ))}
      <TableRow className="border-t-2">
        <TableCell colSpan={8} className="text-[13px] text-muted-foreground text-right">
          {group.date} 소계
        </TableCell>
        <TableCell className="text-[13px] text-right tabular-nums font-medium">
          {quantitySubtotal(group.subtotal.producedQty)}
        </TableCell>
        <TableCell />
        <TableCell className="text-[13px] text-right tabular-nums font-medium">
          {quantitySubtotal(group.subtotal.goodQty)}
        </TableCell>
        <TableCell className="text-[13px] text-right tabular-nums font-medium">
          {quantitySubtotal(group.subtotal.defectQty)}
        </TableCell>
        <TableCell className="text-[13px] text-right tabular-nums font-medium">
          {quantitySubtotal(group.subtotal.reworkQty)}
        </TableCell>
        <TableCell className="text-[13px] text-right tabular-nums font-medium">
          {formatQuantity(group.subtotal.workHours)}h
        </TableCell>
        <TableCell />
      </TableRow>
    </>
  )
}

function SummaryCard({
  label,
  value,
  suffix,
  accent,
  description,
}: {
  label: string
  value: string
  suffix?: string
  accent?: "green" | "red"
  description?: string
}) {
  const color = accent === "green" ? "text-emerald-700" : accent === "red" ? "text-red-700" : "text-foreground"
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[20px] font-semibold tabular-nums ${color}`}>
        {value}
        {suffix && <span className="ml-1 text-[13px] font-normal text-muted-foreground">{suffix}</span>}
      </p>
      {description && <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>}
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
