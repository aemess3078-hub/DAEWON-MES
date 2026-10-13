"use client"

import { useState, useTransition } from "react"
import { WorkOrderStatus } from "@prisma/client"
import { ClipboardList } from "lucide-react"

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
import { DataTable } from "@/components/common/data-table"
import { getDailyProductionTrend, getProductionProgressData } from "@/lib/actions/production-progress.actions"
import type {
  DailyProductionTrendPoint,
  ProductionProgressData,
  ProductionProgressFilter,
  ProductionProgressFilterOptions,
} from "@/lib/actions/production-progress.types"
import { getColumns } from "./columns"
import { ProductionSummary } from "./production-summary"
import { OperationProgressSummary } from "./operation-progress-summary"
import { DailyProductionTrendChart } from "./daily-production-trend-chart"
import { ProductionAlertsCard } from "./production-alerts-card"
import { formatQuantity } from "@/lib/utils"

// ─── 생산진행 현황 화면(NewMES 전용) — 필터 / KPI / DataTable ────────────────────
//
// KPI·목록 값은 getProductionProgressData()가 반환한 summary/rows를 그대로 표시만
// 한다. 이 파일에서 계획수량·생산실적·진행률·재공수량을 다시 계산하지 않는다
// (production-progress.service.ts가 정본).

const ALL = "all"

// work-orders/columns.tsx의 workOrderStatusLabels와 동일한 값(이 프로젝트는 상태
// 라벨을 화면마다 로컬 상수로 둔다 — export된 공용 매퍼가 없어 새로 만들지 않고
// 같은 값을 그대로 복제했다).
const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  DRAFT: "초안",
  RELEASED: "작업대기",
  IN_PROGRESS: "진행중",
  COMPLETED: "완료",
  CANCELLED: "취소",
}

type FilterFormState = {
  from: string
  to: string
  siteId: string
  itemId: string
  operationId: string
  workOrderStatus: string
}

function toFormState(filter: ProductionProgressFilter): FilterFormState {
  return {
    from: filter.from ?? "",
    to: filter.to ?? "",
    siteId: filter.siteId ?? ALL,
    itemId: filter.itemId ?? ALL,
    operationId: filter.operationId ?? ALL,
    workOrderStatus: filter.workOrderStatus ?? ALL,
  }
}

function toApiFilter(form: FilterFormState): ProductionProgressFilter {
  return {
    from: form.from || undefined,
    to: form.to || undefined,
    siteId: form.siteId !== ALL ? form.siteId : undefined,
    itemId: form.itemId !== ALL ? form.itemId : undefined,
    operationId: form.operationId !== ALL ? form.operationId : undefined,
    workOrderStatus:
      form.workOrderStatus !== ALL ? (form.workOrderStatus as WorkOrderStatus) : undefined,
  }
}

// production-summary.tsx(생산 요약 카드)에서도 동일한 진행률 포맷을 써야 해서 export한다.
// 계산 규칙을 바꾸는 것이 아니라 이미 있는 표시용 formatter를 재사용 가능하게만 하는 것.
export function formatPercent(rate: number): string {
  const rounded = Math.round(rate * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`
}

// ─── 요약 카드 (order-status/equipment-output의 기존 SummaryCard 스타일 재사용) ───

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
  accent?: "green" | "amber" | "red"
  description?: string
}) {
  const textColor =
    accent === "green"
      ? "text-emerald-700"
      : accent === "amber"
        ? "text-amber-600"
        : accent === "red"
          ? "text-red-600"
          : "text-foreground"

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[20px] font-semibold tabular-nums ${textColor}`}>
        {value}
        {suffix && (
          <span className="ml-1 text-[14px] font-normal text-muted-foreground">{suffix}</span>
        )}
      </p>
      {description && <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>}
    </div>
  )
}

// ─── 원형 진행률 게이지 (전체 진행률 KPI 전용) ────────────────────────────────────
// 값은 summary.overallProgressRate를 그대로 표시만 한다 — 여기서 재계산하지 않는다.
// recharts를 추가로 마운트하지 않도록 순수 SVG로 그린다(불필요한 차트 인스턴스 방지).

function CircularProgress({ value, size = 44 }: { value: number; size?: number }) {
  const clamped = Math.min(100, Math.max(0, value))
  const strokeWidth = 5
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="hsl(var(--muted))"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  )
}

function ProgressGaugeCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div>
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <p className="mt-1 text-[20px] font-semibold tabular-nums text-foreground">
          {formatPercent(value)}
        </p>
      </div>
      <div className="relative h-11 w-11 shrink-0">
        <CircularProgress value={value} />
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-foreground">
          {Math.round(Math.min(100, Math.max(0, value)))}%
        </span>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border bg-card py-16 text-center">
      <ClipboardList className="mx-auto h-10 w-10 mb-3 opacity-20" />
      <p className="text-[15px] text-muted-foreground">
        조회 조건에 해당하는 작업지시가 없습니다.
      </p>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  initialData: ProductionProgressData
  initialTrend: DailyProductionTrendPoint[]
  filterOptions: ProductionProgressFilterOptions
  defaultFilter: ProductionProgressFilter
}

export function ProductionProgressClient({
  initialData,
  initialTrend,
  filterOptions,
  defaultFilter,
}: Props) {
  const columns = getColumns()
  const [data, setData] = useState<ProductionProgressData>(initialData)
  const [dailyTrend, setDailyTrend] = useState<DailyProductionTrendPoint[]>(initialTrend)
  const [form, setForm] = useState<FilterFormState>(() => toFormState(defaultFilter))
  const [isPending, startTransition] = useTransition()
  const [formError, setFormError] = useState("")
  const [loadError, setLoadError] = useState("")

  // DataTable/KPI/생산 요약/공정별 진행 현황/일별 생산실적 추이 모두 같은 조회
  // 버튼 한 번으로 갱신한다. 두 Server Action 중 하나라도 실패하면 (부분 성공 UI를
  // 새로 만들지 않고) 기존 오류 문구 하나로 통일해서 보여준다.
  function runQuery(filter: ProductionProgressFilter) {
    setLoadError("")
    startTransition(async () => {
      try {
        const [progressResult, trendResult] = await Promise.all([
          getProductionProgressData(filter),
          getDailyProductionTrend(filter),
        ])
        setData(progressResult)
        setDailyTrend(trendResult)
      } catch {
        // Prisma/서버 내부 오류를 그대로 노출하지 않는다.
        setLoadError("생산현황을 조회하지 못했습니다.")
      }
    })
  }

  function handleSearch() {
    setFormError("")
    if (!form.from || !form.to) {
      setFormError("시작일과 종료일을 모두 입력해 주세요.")
      return
    }
    if (form.from > form.to) {
      setFormError("시작일이 종료일보다 늦을 수 없습니다.")
      return
    }
    runQuery(toApiFilter(form))
  }

  function handleReset() {
    const resetState = toFormState(defaultFilter)
    setForm(resetState)
    setFormError("")
    runQuery(toApiFilter(resetState))
  }

  const summary = data.summary
  const quantitySuffix = summary.isMixedUom ? "" : (summary.uom ?? "")
  const mixedUomMessage = "복수 단위가 포함되어 전체 수량 합계를 표시하지 않습니다."

  return (
    <div className="space-y-6">
      {/* 조회조건 */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-[13px]">시작일</Label>
            <Input
              type="date"
              value={form.from}
              onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
              className="h-9 w-40 text-[14px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">종료일</Label>
            <Input
              type="date"
              value={form.to}
              onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}
              className="h-9 w-40 text-[14px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">사업장</Label>
            <Select
              value={form.siteId}
              onValueChange={(v) => setForm((f) => ({ ...f, siteId: v }))}
            >
              <SelectTrigger className="h-9 w-40 text-[14px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL} className="text-[14px]">전체 사업장</SelectItem>
                {filterOptions.sites.map((site) => (
                  <SelectItem key={site.id} value={site.id} className="text-[14px]">
                    {site.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">품목</Label>
            <Select
              value={form.itemId}
              onValueChange={(v) => setForm((f) => ({ ...f, itemId: v }))}
            >
              <SelectTrigger className="h-9 w-48 text-[14px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL} className="text-[14px]">전체 품목</SelectItem>
                {filterOptions.items.map((item) => (
                  <SelectItem key={item.id} value={item.id} className="text-[14px]">
                    {item.code ? `${item.code} - ${item.name}` : item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">현재공정</Label>
            <Select
              value={form.operationId}
              onValueChange={(v) => setForm((f) => ({ ...f, operationId: v }))}
            >
              <SelectTrigger className="h-9 w-40 text-[14px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL} className="text-[14px]">전체 공정</SelectItem>
                {filterOptions.operations.map((operation) => (
                  <SelectItem key={operation.id} value={operation.id} className="text-[14px]">
                    {operation.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">작업지시 상태</Label>
            <Select
              value={form.workOrderStatus}
              onValueChange={(v) => setForm((f) => ({ ...f, workOrderStatus: v }))}
            >
              <SelectTrigger className="h-9 w-36 text-[14px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL} className="text-[14px]">전체 상태</SelectItem>
                {filterOptions.workOrderStatuses.map((status) => (
                  <SelectItem key={status} value={status} className="text-[14px]">
                    {WORK_ORDER_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={handleSearch} disabled={isPending} className="h-9">
              {isPending ? "조회 중..." : "조회"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleReset}
              disabled={isPending}
              className="h-9"
            >
              초기화
            </Button>
          </div>
        </div>

        {formError && <p className="text-[13px] text-red-500">{formError}</p>}
        {loadError && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-600">
            {loadError}
          </p>
        )}
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <SummaryCard
          label="총 작업지시"
          value={formatQuantity(summary.totalWorkOrders)}
          suffix="건"
        />
        <SummaryCard
          label="계획수량"
          value={summary.isMixedUom ? "단위 혼합" : formatQuantity(summary.totalPlannedQty)}
          suffix={quantitySuffix}
          description={summary.isMixedUom ? mixedUomMessage : undefined}
        />
        <SummaryCard
          label="생산실적"
          value={summary.isMixedUom ? "단위 혼합" : formatQuantity(summary.totalProductionOutputQty)}
          suffix={quantitySuffix}
          description={summary.isMixedUom ? mixedUomMessage : undefined}
        />
        {summary.isMixedUom ? (
          <SummaryCard
            label="전체 생산 달성률"
            value="단위 혼합"
            description="복수 단위가 포함되어 전체 달성률을 표시하지 않습니다."
          />
        ) : (
          <ProgressGaugeCard label="전체 생산 달성률" value={summary.overallProgressRate} />
        )}
        <SummaryCard
          label="정상"
          value={formatQuantity(summary.normalCount)}
          suffix="건"
          accent="green"
        />
        <SummaryCard
          label="주의"
          value={formatQuantity(summary.warningCount)}
          suffix="건"
          accent={summary.warningCount > 0 ? "amber" : undefined}
        />
        <SummaryCard
          label="지연"
          value={formatQuantity(summary.delayedCount)}
          suffix="건"
          accent={summary.delayedCount > 0 ? "red" : undefined}
        />
      </div>

      {/* 작업지시 목록 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-foreground">작업지시 진행 현황</h2>
          <span className="text-[13px] text-muted-foreground">
            총 {formatQuantity(data.rows.length)}건
          </span>
        </div>

        {data.rows.length === 0 ? (
          <EmptyState />
        ) : (
          <DataTable
            columns={columns}
            data={data.rows}
            pageSize={20}
            getRowId={(row) => row.workOrderId}
          />
        )}
      </div>

      {/* 생산 요약 — data.rows / data.summary만 사용, 별도 DB 조회 없음 */}
      <ProductionSummary rows={data.rows} summary={summary} />

      {/* 공정별 진행 현황 + 일별 생산실적 추이 — desktop 2열, 화면이 좁아지면 1열로 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 공정별 진행 현황 — data.rows의 currentOperation 위치만 집계, 별도 DB 조회 없음 */}
        <OperationProgressSummary rows={data.rows} />
        {/* 일별 생산실적 추이 — dailyTrend를 그대로 표시, 이 컴포넌트 내부 재계산 없음 */}
        <DailyProductionTrendChart data={dailyTrend} />
      </div>

      {/* 주요 생산 알림 — data.rows만 사용, 별도 DB 조회 없음. 필터와 자동 동기화 */}
      <ProductionAlertsCard rows={data.rows} />
    </div>
  )
}
