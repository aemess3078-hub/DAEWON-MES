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
import { formatQuantity, formatPercent } from "@/lib/utils"
import { downloadExcelSheet } from "@/lib/export-excel"
import { buildReportFilename, formatKstDateTime } from "@/lib/actions/report.helpers"
import { topDefectTypes } from "@/lib/actions/quality-dashboard.helpers"
import type { DefectStatsResult } from "@/lib/actions/defect-stats.actions"
import type { ReportFilterOptions } from "@/lib/actions/report.actions"

const NONE_VALUE = "__ALL__"

const RESULT_LABEL: Record<string, string> = {
  PASS: "합격",
  FAIL: "불합격",
  CONDITIONAL: "조건부합격",
}

interface FilterState {
  from: string
  to: string
  itemId: string
  routingOperationId: string
}

interface Props {
  initialFilter: FilterState
  stats: DefectStatsResult
  options: ReportFilterOptions
}

export function QualityReportClient({ initialFilter, stats, options }: Props) {
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
    if (next.itemId) params.set("itemId", next.itemId)
    if (next.routingOperationId) params.set("routingOperationId", next.routingOperationId)
    startTransition(() => {
      router.push(`/app/mes/reports/quality?${params.toString()}`)
    })
  }

  function resetFilter() {
    const reset: FilterState = { ...initialFilter, itemId: "", routingOperationId: "" }
    setFilter(reset)
    applyFilter(reset)
  }

  const top5 = topDefectTypes(stats.byType, 5)

  function handleExcelDownload() {
    const header = [
      "검사일시",
      "작업지시",
      "제조번호",
      "품목코드",
      "품목명",
      "공정",
      "검사수량",
      "결과",
      "불량수량",
      "불량유형",
      "검사자",
    ]
    const rows = stats.rows.map((r) => [
      formatKstDateTime(r.inspectedAt),
      r.orderNo,
      r.manufacturingNo ?? "",
      r.itemCode,
      r.itemName,
      r.routingOperationName,
      r.inspectedQty,
      r.result ? RESULT_LABEL[r.result] ?? r.result : "",
      r.defectQty,
      r.defectLabels.join(", "),
      r.inspectorName,
    ])
    const filename = buildReportFilename("품질리포트", filter.from, filter.to)
    downloadExcelSheet(filename, "품질리포트", header, rows)
  }

  const defectRatePct = formatPercent(stats.summary.defectRate)

  return (
    <div className="space-y-6">
      {/* 필터 */}
      <div className="rounded-lg border bg-card p-4 space-y-3 print:hidden">
        <div className="flex items-center gap-2 text-[14px] font-medium text-foreground">
          <Filter className="h-4 w-4" />
          필터
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
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
        <h1 className="text-[20px] font-semibold">품질리포트</h1>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="총검사수량" value={formatQuantity(stats.summary.inspectedQty)} />
        <SummaryCard label="합격수량" value={formatQuantity(stats.summary.passQty)} accent="green" />
        <SummaryCard label="총불량수량" value={formatQuantity(stats.summary.defectQty)} accent="red" />
        <SummaryCard
          label="불량률"
          value={defectRatePct}
          accent={stats.summary.defectRate >= 0.05 ? "red" : "amber"}
          subText={`검사 ${formatQuantity(stats.summary.inspectionCount)}건`}
        />
      </div>

      {/* 불량유형 TOP */}
      <section className="rounded-lg border bg-card p-4 space-y-3 print:break-inside-avoid">
        <h2 className="text-[16px] font-semibold text-foreground">불량유형 TOP {top5.length}</h2>
        {top5.length === 0 ? (
          <EmptyBox message="해당 기간의 불량 데이터가 없습니다." />
        ) : (
          <div className="space-y-1.5">
            {top5.map((t) => (
              <div key={t.defectCodeId} className="flex items-center justify-between text-[14px]">
                <span className="text-foreground">[{t.code}] {t.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatQuantity(t.qty)}건 ({formatPercent(t.percentage)})
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 상세 테이블 */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <div className="print:hidden">
          <h2 className="text-[16px] font-semibold text-foreground">검사 상세 내역</h2>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {stats.truncated
              ? `표시 가능한 최대 건수를 초과하여 최근 ${formatQuantity(stats.rows.length)}건만 표시합니다. 전체 데이터는 Excel 다운로드를 이용하세요.`
              : `총 ${formatQuantity(stats.rows.length)}건`}
          </p>
        </div>
        {stats.rows.length === 0 ? (
          <EmptyBox message="해당 조건의 검사 데이터가 없습니다." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[13px]">검사일시</TableHead>
                  <TableHead className="text-[13px]">제조번호</TableHead>
                  <TableHead className="text-[13px]">품목</TableHead>
                  <TableHead className="text-[13px]">공정</TableHead>
                  <TableHead className="text-[13px] text-right">검사수량</TableHead>
                  <TableHead className="text-[13px]">결과</TableHead>
                  <TableHead className="text-[13px] text-right">불량수량</TableHead>
                  <TableHead className="text-[13px]">불량유형</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-[14px]">
                      {formatKstDateTime(r.inspectedAt)}
                    </TableCell>
                    <TableCell className="text-[14px]">{r.manufacturingNo ?? "-"}</TableCell>
                    <TableCell className="text-[14px]">[{r.itemCode}] {r.itemName}</TableCell>
                    <TableCell className="text-[14px]">{r.routingOperationName}</TableCell>
                    <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(r.inspectedQty)}</TableCell>
                    <TableCell className="text-[14px]">{r.result ? RESULT_LABEL[r.result] ?? r.result : "-"}</TableCell>
                    <TableCell className="text-[14px] text-right tabular-nums">{formatQuantity(r.defectQty)}</TableCell>
                    <TableCell className="text-[14px]">{r.defectLabels.join(", ") || "-"}</TableCell>
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
  subText,
}: {
  label: string
  value: string
  accent?: "green" | "red" | "amber"
  subText?: string
}) {
  const color =
    accent === "green"
      ? "text-emerald-700"
      : accent === "red"
        ? "text-red-700"
        : accent === "amber"
          ? "text-amber-700"
          : "text-foreground"
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[20px] font-semibold tabular-nums ${color}`}>{value}</p>
      {subText && <p className="text-[13px] text-muted-foreground mt-0.5">{subText}</p>}
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
