"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts"
import { RotateCcw, ExternalLink } from "lucide-react"

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
import { formatQuantity } from "@/lib/utils"
import type { QualityDashboardData } from "@/lib/actions/quality-dashboard.actions"
import type { DefectStatsFilterOptions } from "@/lib/actions/defect-stats.actions"

const NONE_VALUE = "__ALL__"

// 기존 각 관리 화면(원인분석/조치관리/재발방지관리)의 상태 배지 색상을 그대로 재사용한다.
// 새로운 arbitrary 색상 체계를 만들지 않는다(§ STEP 17).
const CAUSE_LABEL: Record<string, string> = { ANALYZED: "분석완료", UNANALYZED: "미분석" }
const CAUSE_CLASS: Record<string, string> = {
  ANALYZED: "bg-green-100 text-green-800",
  UNANALYZED: "bg-slate-100 text-slate-700",
}
const CORRECTIVE_LABEL: Record<string, string> = { OPEN: "등록", IN_PROGRESS: "진행중", COMPLETED: "완료" }
const CORRECTIVE_CLASS: Record<string, string> = {
  OPEN: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-800",
}
const PREVENTION_LABEL: Record<string, string> = {
  OPEN: "등록",
  IN_PROGRESS: "대책수행중",
  VERIFYING: "검증중",
  COMPLETED: "완료",
}
const PREVENTION_CLASS: Record<string, string> = {
  OPEN: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  VERIFYING: "bg-amber-100 text-amber-800",
  COMPLETED: "bg-green-100 text-green-800",
}

type FilterState = {
  from: string
  to: string
  itemId: string
  routingOperationId: string
}

interface QualityDashboardClientProps {
  initialFilter: FilterState
  data: QualityDashboardData
  filterOptions: DefectStatsFilterOptions
}

export function QualityDashboardClient({ initialFilter, data, filterOptions }: QualityDashboardClientProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterState>(initialFilter)
  const [isPending, startTransition] = useTransition()

  function applyFilter(next: FilterState) {
    const params = new URLSearchParams()
    params.set("from", next.from)
    params.set("to", next.to)
    if (next.itemId) params.set("itemId", next.itemId)
    if (next.routingOperationId) params.set("routingOperationId", next.routingOperationId)
    startTransition(() => router.push(`/app/mes/quality/dashboard?${params.toString()}`))
  }

  function resetFilter() {
    const reset: FilterState = { from: initialFilter.from, to: initialFilter.to, itemId: "", routingOperationId: "" }
    setFilter(reset)
    applyFilter(reset)
  }

  const defectRatePct = (data.kpi.defectRate * 100).toFixed(2)

  const chartData = useMemo(
    () =>
      data.daily.map((d) => ({
        date: d.date.slice(5),
        불량수량: d.defectQty,
        불량률: Number((d.defectRate * 100).toFixed(2)),
      })),
    [data.daily]
  )

  return (
    <div className="space-y-6">
      {/* 조회조건 — 한 줄 */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-[13px]">시작일</Label>
            <Input
              type="date"
              value={filter.from}
              onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))}
              className="h-9 text-[14px] w-[150px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px]">종료일</Label>
            <Input
              type="date"
              value={filter.to}
              onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))}
              className="h-9 text-[14px] w-[150px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px]">품목</Label>
            <Select value={filter.itemId || NONE_VALUE} onValueChange={(v) => setFilter((f) => ({ ...f, itemId: v === NONE_VALUE ? "" : v }))}>
              <SelectTrigger className="h-9 text-[14px] w-[220px]"><SelectValue placeholder="전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {filterOptions.items.map((it) => (
                  <SelectItem key={it.id} value={it.id}>[{it.code}] {it.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[13px]">공정</Label>
            <Select value={filter.routingOperationId || NONE_VALUE} onValueChange={(v) => setFilter((f) => ({ ...f, routingOperationId: v === NONE_VALUE ? "" : v }))}>
              <SelectTrigger className="h-9 text-[14px] w-[220px]"><SelectValue placeholder="전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {filterOptions.routingOperations.map((op) => (
                  <SelectItem key={op.id} value={op.id}>[{op.routingCode}] {op.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={resetFilter} disabled={isPending} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" />
              초기화
            </Button>
            <Button size="sm" onClick={() => applyFilter(filter)} disabled={isPending}>
              {isPending ? "조회중..." : "조회"}
            </Button>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="총 검사수량" value={data.kpi.inspectedQty} unit="EA" />
        <KpiCard label="불량수량" value={data.kpi.defectQty} unit="EA" accent="red" />
        <KpiCard label="불량률" value={`${defectRatePct}%`} accent={data.kpi.defectRate >= 0.05 ? "red" : "amber"} />
        <KpiCard label="검사건수" value={data.kpi.inspectionCount} unit="건" />
        <KpiCard
          label="미완료 조치"
          value={data.kpi.openCorrectiveActionCount}
          unit="건"
          accent={data.kpi.openCorrectiveActionCount > 0 ? "amber" : undefined}
          href="/app/mes/quality/corrective-action"
        />
        <KpiCard
          label="재발방지 검증대기"
          value={data.kpi.verifyingRecurrencePreventionCount}
          unit="건"
          accent={data.kpi.verifyingRecurrencePreventionCount > 0 ? "amber" : undefined}
          href="/app/mes/quality/recurrence-prevention"
        />
      </div>

      {/* 불량 추이 + 불량유형 TOP5 + 확인 필요 품질이슈 */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card
          title="일별 불량 추이"
          className="lg:col-span-2"
          headerAction={
            <Link href="/app/mes/spc" className="inline-flex items-center gap-1 text-[12px] text-blue-600 hover:underline shrink-0">
              SPC 상세보기 <ExternalLink className="h-3 w-3" />
            </Link>
          }
        >
          {chartData.length === 0 ? (
            <EmptyBox message="해당 기간의 데이터가 없습니다." />
          ) : (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
                  <XAxis dataKey="date" fontSize={12} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis yAxisId="left" fontSize={12} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis yAxisId="right" orientation="right" fontSize={12} unit="%" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={{ fontSize: 13, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Bar yAxisId="left" dataKey="불량수량" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="불량률" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="불량유형 TOP5">
          {data.topDefectTypes.length === 0 ? (
            <EmptyBox message="집계된 불량이 없습니다." />
          ) : (
            <ol className="space-y-2.5">
              {data.topDefectTypes.map((t, idx) => (
                <li key={t.defectCodeId} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] truncate">
                      <span className="text-muted-foreground mr-1">{idx + 1}.</span>
                      {t.name}
                    </span>
                    <span className="text-[13px] font-semibold tabular-nums shrink-0">
                      {formatQuantity(t.qty)} <span className="text-[11px] text-muted-foreground">({(t.percentage * 100).toFixed(1)}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-red-500/70 rounded-full" style={{ width: `${Math.min(100, t.percentage * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="확인 필요 품질이슈">
          {data.issues.length === 0 ? (
            <EmptyBox message="확인이 필요한 품질이슈가 없습니다." />
          ) : (
            <ul className="space-y-2.5">
              {data.issues.map((issue, idx) => (
                <li key={idx}>
                  <Link href={issue.linkHref} className="block hover:bg-muted/50 rounded-md -mx-1.5 px-1.5 py-1 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium text-foreground">{issue.label}</span>
                      <Badge className={`border-0 text-[11px] ${ISSUE_BADGE_CLASS[issue.category]}`}>{issue.statusLabel}</Badge>
                    </div>
                    <p className="text-[12px] text-muted-foreground truncate">
                      {issue.itemName} · {issue.routingOperationName} · {issue.dateLabel.slice(0, 10)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* 품목별 / 공정별 품질현황 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="품목별 품질현황">
          {data.byItem.length === 0 ? (
            <EmptyBox message="해당 기간의 품목별 데이터가 없습니다." />
          ) : (
            <RankTable
              rows={data.byItem.slice(0, 8).map((it) => ({
                key: it.itemId,
                label: it.name,
                sub: it.code,
                primary: `${(it.defectRate * 100).toFixed(2)}%`,
                secondary: `검사 ${formatQuantity(it.inspectedQty)} / 불량 ${formatQuantity(it.defectQty)}`,
              }))}
            />
          )}
        </Card>
        <Card title="공정별 품질현황">
          {data.byOperation.length === 0 ? (
            <EmptyBox message="해당 기간의 공정별 데이터가 없습니다." />
          ) : (
            <RankTable
              rows={data.byOperation.map((op) => ({
                key: op.routingOperationId,
                label: op.routingOperationName,
                sub: `seq.${op.seq}`,
                primary: `${(op.defectRate * 100).toFixed(2)}%`,
                secondary: `검사 ${formatQuantity(op.inspectedQty)} / 불량 ${formatQuantity(op.defectQty)}`,
              }))}
            />
          )}
        </Card>
      </div>

      {/* CAPA 진행현황 */}
      <Card title="품질 개선활동 현황 (CAPA)" subtitle="불량 → 원인분석 → 조치관리 → 재발방지관리 흐름의 현재 진행 상태입니다.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CapaStageBlock
            title="원인분석"
            href="/app/mes/quality/cause-analysis"
            badges={[
              { label: CAUSE_LABEL.UNANALYZED, count: data.capa.causeAnalysis.unanalyzed, className: CAUSE_CLASS.UNANALYZED },
              { label: CAUSE_LABEL.ANALYZED, count: data.capa.causeAnalysis.analyzed, className: CAUSE_CLASS.ANALYZED },
            ]}
          />
          <CapaStageBlock
            title="조치관리"
            href="/app/mes/quality/corrective-action"
            badges={[
              { label: CORRECTIVE_LABEL.OPEN, count: data.capa.correctiveAction.open, className: CORRECTIVE_CLASS.OPEN },
              { label: CORRECTIVE_LABEL.IN_PROGRESS, count: data.capa.correctiveAction.inProgress, className: CORRECTIVE_CLASS.IN_PROGRESS },
              { label: "기한초과", count: data.capa.correctiveAction.overdue, className: "bg-red-100 text-red-700" },
              { label: CORRECTIVE_LABEL.COMPLETED, count: data.capa.correctiveAction.completed, className: CORRECTIVE_CLASS.COMPLETED },
            ]}
          />
          <CapaStageBlock
            title="재발방지관리"
            href="/app/mes/quality/recurrence-prevention"
            badges={[
              { label: PREVENTION_LABEL.OPEN, count: data.capa.recurrencePrevention.open, className: PREVENTION_CLASS.OPEN },
              { label: PREVENTION_LABEL.IN_PROGRESS, count: data.capa.recurrencePrevention.inProgress, className: PREVENTION_CLASS.IN_PROGRESS },
              { label: PREVENTION_LABEL.VERIFYING, count: data.capa.recurrencePrevention.verifying, className: PREVENTION_CLASS.VERIFYING },
              { label: "기한초과", count: data.capa.recurrencePrevention.overdue, className: "bg-red-100 text-red-700" },
              { label: PREVENTION_LABEL.COMPLETED, count: data.capa.recurrencePrevention.completed, className: PREVENTION_CLASS.COMPLETED },
            ]}
          />
        </div>
      </Card>

      {/* 최근 품질이슈 */}
      <Card
        title="최근 품질이슈"
        subtitle={`최근 ${data.recentIssues.length}건${data.truncated ? " (불량분석 상세는 상위 500건만 집계)" : ""}`}
        headerAction={
          <Link href="/app/mes/quality/cause-analysis" className="inline-flex items-center gap-1 text-[13px] text-blue-600 hover:underline">
            원인분석에서 더보기 <ExternalLink className="h-3 w-3" />
          </Link>
        }
      >
        {data.recentIssues.length === 0 ? (
          <EmptyBox message="해당 기간의 불량 이력이 없습니다." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">발생일</th>
                  <th className="py-2 pr-3 font-medium">작업지시/제조번호</th>
                  <th className="py-2 pr-3 font-medium">품목</th>
                  <th className="py-2 pr-3 font-medium">공정</th>
                  <th className="py-2 pr-3 font-medium">불량유형/수량</th>
                  <th className="py-2 pr-3 font-medium">원인분석</th>
                  <th className="py-2 pr-3 font-medium">조치</th>
                  <th className="py-2 pr-3 font-medium">재발방지</th>
                </tr>
              </thead>
              <tbody>
                {data.recentIssues.map((r) => (
                  <tr key={r.defectRecordId} className="border-b last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{r.inspectedAt.slice(0, 10)}</td>
                    <td className="py-2 pr-3">
                      <p className="font-mono">{r.orderNo}</p>
                      <p className="font-mono text-[12px] text-blue-700">{r.manufacturingNo ?? "-"}</p>
                    </td>
                    <td className="py-2 pr-3">{r.itemName}</td>
                    <td className="py-2 pr-3">{r.routingOperationName}</td>
                    <td className="py-2 pr-3">
                      [{r.defectCode}] {r.defectCodeName}
                      <span className="text-muted-foreground"> · {formatQuantity(r.qty)}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge className={`border-0 text-[11px] ${CAUSE_CLASS[r.causeAnalysisStatus]}`}>{CAUSE_LABEL[r.causeAnalysisStatus]}</Badge>
                    </td>
                    <td className="py-2 pr-3">
                      {r.correctiveActionStatus ? (
                        <Badge className={`border-0 text-[11px] ${CORRECTIVE_CLASS[r.correctiveActionStatus] ?? "bg-slate-100 text-slate-700"}`}>
                          {CORRECTIVE_LABEL[r.correctiveActionStatus] ?? r.correctiveActionStatus}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">미등록</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {r.recurrencePreventionStatus ? (
                        <Badge className={`border-0 text-[11px] ${PREVENTION_CLASS[r.recurrencePreventionStatus] ?? "bg-slate-100 text-slate-700"}`}>
                          {PREVENTION_LABEL[r.recurrencePreventionStatus] ?? r.recurrencePreventionStatus}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">미등록</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

const ISSUE_BADGE_CLASS: Record<string, string> = {
  CORRECTIVE_OVERDUE: "bg-red-100 text-red-700",
  PREVENTION_OVERDUE: "bg-red-100 text-red-700",
  PREVENTION_VERIFYING: "bg-amber-100 text-amber-800",
  CAUSE_UNANALYZED: "bg-slate-100 text-slate-700",
}

// ─── 프레젠테이션 하위 컴포넌트 ────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  unit,
  accent,
  href,
}: {
  label: string
  value: number | string
  unit?: string
  accent?: "red" | "amber"
  href?: string
}) {
  const color = accent === "red" ? "text-red-700" : accent === "amber" ? "text-amber-700" : "text-foreground"
  const content = (
    <div className="rounded-lg border bg-card px-4 py-3 h-full">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[24px] font-semibold tabular-nums ${color}`}>
        {typeof value === "number" ? formatQuantity(value) : value}
        {unit && <span className="ml-1 text-[13px] font-normal text-muted-foreground">{unit}</span>}
      </p>
    </div>
  )
  return href ? (
    <Link href={href} className="block hover:opacity-80 transition-opacity">
      {content}
    </Link>
  ) : (
    content
  )
}

function Card({
  title,
  subtitle,
  className,
  headerAction,
  children,
}: {
  title: string
  subtitle?: string
  className?: string
  headerAction?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className={`rounded-lg border bg-card p-4 space-y-3 ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="text-[12px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {headerAction}
      </div>
      {children}
    </div>
  )
}

function RankTable({
  rows,
}: {
  rows: { key: string; label: string; sub: string; primary: string; secondary: string }[]
}) {
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-2 py-1 border-b last:border-0">
          <div className="min-w-0">
            <p className="text-[13px] truncate">{r.label}</p>
            <p className="text-[11px] text-muted-foreground">{r.sub}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[13px] font-semibold tabular-nums">{r.primary}</p>
            <p className="text-[11px] text-muted-foreground">{r.secondary}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

function CapaStageBlock({
  title,
  href,
  badges,
}: {
  title: string
  href: string
  badges: { label: string; count: number; className: string }[]
}) {
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-foreground">{title}</p>
        <Link href={href} className="text-[12px] text-blue-600 hover:underline">바로가기</Link>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {badges.map((b) => (
          <Badge key={b.label} className={`border-0 text-[11px] font-medium ${b.className}`}>
            {b.label} {formatQuantity(b.count)}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function EmptyBox({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 rounded-md border border-dashed text-[13px] text-muted-foreground">
      {message}
    </div>
  )
}
