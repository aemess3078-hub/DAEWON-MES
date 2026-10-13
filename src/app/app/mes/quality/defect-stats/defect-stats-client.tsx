"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts"
import { ExternalLink, Filter, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
import type {
  DefectStatsResult,
  DefectStatsFilterOptions,
  DefectStatsRow,
} from "@/lib/actions/defect-stats.actions"
import { formatQuantity } from "@/lib/utils"
import { isLinkVisible } from "@/lib/auth/daewon-scope"

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const STAGE_LABEL: Record<string, string> = {
  FIRST: "초물",
  MID: "중간",
  FINAL: "종물",
}

const RESULT_CONFIG: Record<string, { label: string; className: string }> = {
  PASS: { label: "합격", className: "bg-green-100 text-green-700" },
  FAIL: { label: "불합격", className: "bg-red-100 text-red-700" },
  CONDITIONAL: {
    label: "조건부합격",
    className: "bg-orange-100 text-orange-700",
  },
}

const NONE_VALUE = "__ALL__" // Select에서 "전체" 표현용 (빈 문자열은 Radix가 허용 안 함)

// ─── Props ────────────────────────────────────────────────────────────────────

interface FilterState {
  from: string
  to: string
  itemId: string
  routingOperationId: string
  manufacturingNo: string
  stage: string
}

interface Props {
  initialFilter: FilterState
  stats: DefectStatsResult
  options: DefectStatsFilterOptions
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DefectStatsClient({ initialFilter, stats, options }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [filter, setFilter] = useState<FilterState>(initialFilter)

  function applyFilter(next: FilterState) {
    const params = new URLSearchParams()
    if (next.from) params.set("from", next.from)
    if (next.to) params.set("to", next.to)
    if (next.itemId) params.set("itemId", next.itemId)
    if (next.routingOperationId)
      params.set("routingOperationId", next.routingOperationId)
    if (next.manufacturingNo)
      params.set("manufacturingNo", next.manufacturingNo)
    if (next.stage) params.set("stage", next.stage)

    startTransition(() => {
      router.push(`/app/mes/quality/defect-stats?${params.toString()}`)
    })
  }

  function resetFilter() {
    const reset: FilterState = {
      from: initialFilter.from, // 페이지 진입 시 기본값(최근 30일) 유지
      to: initialFilter.to,
      itemId: "",
      routingOperationId: "",
      manufacturingNo: "",
      stage: "",
    }
    setFilter(reset)
    applyFilter(reset)
  }

  // ─── 파생값 ─────────────────────────────────────────────────────────────────

  const defectRatePct = (stats.summary.defectRate * 100).toFixed(2)

  const dailyChartData = useMemo(
    () =>
      stats.daily.map((d) => ({
        date: d.date.slice(5), // MM-DD
        검사수량: d.inspectedQty,
        불량수량: d.defectQty,
        불량률: Number((d.defectRate * 100).toFixed(2)),
      })),
    [stats.daily]
  )

  return (
    <div className="space-y-6">
      {/* 필터 */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-[14px] font-medium text-foreground">
          <Filter className="h-4 w-4" />
          필터
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="space-y-1">
            <Label htmlFor="from" className="text-[13px]">
              시작일
            </Label>
            <Input
              id="from"
              type="date"
              value={filter.from}
              onChange={(e) =>
                setFilter((f) => ({ ...f, from: e.target.value }))
              }
              className="h-9 text-[14px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to" className="text-[13px]">
              종료일
            </Label>
            <Input
              id="to"
              type="date"
              value={filter.to}
              onChange={(e) =>
                setFilter((f) => ({ ...f, to: e.target.value }))
              }
              className="h-9 text-[14px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px]">품목</Label>
            <Select
              value={filter.itemId || NONE_VALUE}
              onValueChange={(v) =>
                setFilter((f) => ({ ...f, itemId: v === NONE_VALUE ? "" : v }))
              }
            >
              <SelectTrigger className="h-9 text-[14px]">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {options.items.map((it) => (
                  <SelectItem key={it.id} value={it.id}>
                    [{it.code}] {it.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[13px]">공정</Label>
            <Select
              value={filter.routingOperationId || NONE_VALUE}
              onValueChange={(v) =>
                setFilter((f) => ({
                  ...f,
                  routingOperationId: v === NONE_VALUE ? "" : v,
                }))
              }
            >
              <SelectTrigger className="h-9 text-[14px]">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {options.routingOperations.map((op) => (
                  <SelectItem key={op.id} value={op.id}>
                    [{op.routingCode}] {op.routingName} / {op.name} (seq.
                    {op.seq})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="manufacturingNo" className="text-[13px]">
              제조번호
            </Label>
            <Input
              id="manufacturingNo"
              placeholder="제조번호 정확히 일치"
              value={filter.manufacturingNo}
              onChange={(e) =>
                setFilter((f) => ({ ...f, manufacturingNo: e.target.value }))
              }
              className="h-9 text-[14px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px]">검사단계</Label>
            <Select
              value={filter.stage || NONE_VALUE}
              onValueChange={(v) =>
                setFilter((f) => ({ ...f, stage: v === NONE_VALUE ? "" : v }))
              }
            >
              <SelectTrigger className="h-9 text-[14px]">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                <SelectItem value="FIRST">초물</SelectItem>
                <SelectItem value="MID">중간</SelectItem>
                <SelectItem value="FINAL">종물</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={resetFilter}
            disabled={isPending}
            className="gap-1"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            초기화
          </Button>
          <Button
            size="sm"
            onClick={() => applyFilter(filter)}
            disabled={isPending}
          >
            {isPending ? "조회중..." : "조회"}
          </Button>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="총 검사수량" value={stats.summary.inspectedQty} />
        <SummaryCard
          label="합격수량"
          value={stats.summary.passQty}
          accent="green"
        />
        <SummaryCard
          label="불량수량"
          value={stats.summary.defectQty}
          accent="red"
        />
        <SummaryCard
          label="불량률"
          value={`${defectRatePct}%`}
          accent={stats.summary.defectRate >= 0.05 ? "red" : "amber"}
          subText={`검사 ${formatQuantity(stats.summary.inspectionCount)}건`}
        />
      </div>

      {/* 일자별 추이 */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <div>
          <h2 className="text-[16px] font-semibold text-foreground">
            일자별 불량률 추이
          </h2>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            선택한 기간 동안 일별 검사수량과 불량률 변화입니다.
          </p>
        </div>
        {dailyChartData.length === 0 ? (
          <EmptyBox message="해당 기간의 데이터가 없습니다." />
        ) : (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={dailyChartData}
                margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
                <XAxis
                  dataKey="date"
                  fontSize={12}
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  yAxisId="left"
                  fontSize={12}
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  fontSize={12}
                  unit="%"
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 13,
                    borderRadius: 8,
                    border: "1px solid hsl(var(--border))",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="검사수량"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="불량수량"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="불량률"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* 그룹별 집계 — 3개 카드 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GroupSection
          title="불량유형별 집계"
          emptyMessage="집계된 불량이 없습니다."
          rows={stats.byType.slice(0, 10).map((t) => ({
            key: t.defectCodeId,
            label: `[${t.code}] ${t.name}`,
            primary: formatQuantity(t.qty),
            secondary: `${(t.percentage * 100).toFixed(1)}%`,
            bar: t.percentage,
          }))}
        />
        <GroupSection
          title="품목별 불량률"
          emptyMessage="해당 기간의 품목별 데이터가 없습니다."
          rows={stats.byItem.slice(0, 10).map((it) => ({
            key: it.itemId,
            label: `[${it.code}] ${it.name}`,
            primary: `${(it.defectRate * 100).toFixed(2)}%`,
            secondary: `검사 ${formatQuantity(it.inspectedQty)} / 불량 ${formatQuantity(it.defectQty)}`,
            bar: it.defectRate,
          }))}
        />
        <GroupSection
          title="공정별 불량률"
          emptyMessage="해당 기간의 공정별 데이터가 없습니다."
          rows={stats.byOperation.map((op) => ({
            key: op.routingOperationId,
            label: `seq.${op.seq} · ${op.routingOperationName}`,
            primary: `${(op.defectRate * 100).toFixed(2)}%`,
            secondary: `검사 ${formatQuantity(op.inspectedQty)} / 불량 ${formatQuantity(op.defectQty)}`,
            bar: op.defectRate,
          }))}
        />
      </div>

      {/* 상세 목록 */}
      <section className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-[16px] font-semibold text-foreground">
              검사 상세 목록
            </h2>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              총 {formatQuantity(stats.rows.length)}건
              {stats.truncated && " (상위 500건만 표시)"}
            </p>
          </div>
        </div>
        <DetailTable rows={stats.rows} />
      </section>
    </div>
  )
}

// ─── SummaryCard ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  accent,
  subText,
}: {
  label: string
  value: number | string
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
      <p
        className={`mt-1 text-[24px] font-semibold tabular-nums ${color}`}
      >
        {typeof value === "number" ? formatQuantity(value) : value}
      </p>
      {subText && (
        <p className="text-[12px] text-muted-foreground mt-0.5">{subText}</p>
      )}
    </div>
  )
}

// ─── GroupSection ─────────────────────────────────────────────────────────────

interface GroupRow {
  key: string
  label: string
  primary: string
  secondary: string
  bar: number // 0~1
}

function GroupSection({
  title,
  rows,
  emptyMessage,
}: {
  title: string
  rows: GroupRow[]
  emptyMessage: string
}) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
      {rows.length === 0 ? (
        <EmptyBox message={emptyMessage} />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] truncate">{r.label}</span>
                <span className="text-[13px] font-semibold tabular-nums shrink-0">
                  {r.primary}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-red-500/70 rounded-full"
                  style={{ width: `${Math.min(100, r.bar * 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">{r.secondary}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── EmptyBox ────────────────────────────────────────────────────────────────

function EmptyBox({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-10 rounded-md border border-dashed text-[13px] text-muted-foreground">
      {message}
    </div>
  )
}

// ─── DetailTable ─────────────────────────────────────────────────────────────

function DetailTable({ rows }: { rows: DefectStatsRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-[14px] text-muted-foreground">
        해당 조건의 검사 데이터가 없습니다.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-[13px]">검사일시</TableHead>
            <TableHead className="text-[13px]">제조번호</TableHead>
            <TableHead className="text-[13px]">작업지시</TableHead>
            <TableHead className="text-[13px]">품목</TableHead>
            <TableHead className="text-[13px]">공정</TableHead>
            <TableHead className="text-[13px]">단계</TableHead>
            <TableHead className="text-right text-[13px]">검사수량</TableHead>
            <TableHead className="text-right text-[13px]">불량수량</TableHead>
            <TableHead className="text-[13px]">판정</TableHead>
            <TableHead className="text-[13px]">불량유형</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const resultCfg = r.result ? RESULT_CONFIG[r.result] : null
            return (
              <TableRow key={r.id}>
                <TableCell className="text-[13px] whitespace-nowrap">
                  {formatDateTime(r.inspectedAt)}
                </TableCell>
                <TableCell className="text-[13px] font-mono">
                  {r.manufacturingNo && !isLinkVisible("/app/mes/manufacturing-traceability") ? (
                    <span>{r.manufacturingNo}</span>
                  ) : r.manufacturingNo ? (
                    <Link
                      href={`/app/mes/manufacturing-traceability?manufacturingNo=${encodeURIComponent(r.manufacturingNo)}`}
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                    >
                      {r.manufacturingNo}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-[13px] font-mono">
                  {r.orderNo}
                </TableCell>
                <TableCell className="text-[13px]">
                  <div className="font-medium">{r.itemName}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.itemCode}
                  </div>
                </TableCell>
                <TableCell className="text-[13px]">
                  seq.{r.routingOperationSeq} · {r.routingOperationName}
                </TableCell>
                <TableCell className="text-[13px]">
                  {STAGE_LABEL[r.stage] ?? r.stage}
                </TableCell>
                <TableCell className="text-right text-[13px] tabular-nums">
                  {formatQuantity(r.inspectedQty)}
                </TableCell>
                <TableCell className="text-right text-[13px] tabular-nums">
                  {r.defectQty > 0 ? (
                    <span className="text-red-700 font-medium">
                      {formatQuantity(r.defectQty)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell>
                  {resultCfg ? (
                    <Badge
                      className={`${resultCfg.className} text-[12px] font-medium border-0`}
                    >
                      {resultCfg.label}
                    </Badge>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">
                      미판정
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {r.defectLabels.length === 0 ? (
                    <span className="text-[12px] text-muted-foreground">
                      —
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1 max-w-[280px]">
                      {r.defectLabels.map((label, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center px-1.5 py-0.5 rounded bg-red-50 text-red-700 text-[11px]"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}
