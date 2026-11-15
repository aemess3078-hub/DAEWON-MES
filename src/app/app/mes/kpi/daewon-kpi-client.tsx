"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { DaewonKpiData, DaewonKpiFilterOptions } from "@/lib/actions/daewon-kpi.actions"
import type { KpiKey, TrendPoint } from "@/lib/kpi/daewon-kpi"

interface Props {
  data: DaewonKpiData
  filterOptions: DaewonKpiFilterOptions
  initialKpi: KpiKey
}

// ─── 표시 유틸 ────────────────────────────────────────────────────────────────

const nf = (d: number) => new Intl.NumberFormat("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d })

function fmt(v: number | null | undefined, decimals: number): string {
  return v == null || !Number.isFinite(v) ? "—" : nf(decimals).format(v)
}

const KPI_ORDER: KpiKey[] = ["uph", "ppm", "onTime"]

// ─── 공통 테이블 ──────────────────────────────────────────────────────────────

function Table({
  headers,
  rows,
  empty = "데이터 없음",
  rightFrom = 1,
}: {
  headers: string[]
  rows: (string | number | null)[][]
  empty?: string
  rightFrom?: number
}) {
  if (rows.length === 0) {
    return <div className="py-8 text-center text-[14px] text-muted-foreground">{empty}</div>
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-[14px]">
        <thead className="bg-muted/40">
          <tr className="border-b border-border">
            {headers.map((h, i) => (
              <th
                key={h}
                className={`px-3 py-2 text-[13px] font-medium text-muted-foreground whitespace-nowrap ${i >= rightFrom ? "text-right" : "text-left"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-3 py-2 text-foreground whitespace-nowrap ${j >= rightFrom ? "text-right tabular-nums" : ""}`}
                >
                  {cell ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] font-semibold text-foreground mb-2">{children}</p>
}

// ─── 추이 차트 ────────────────────────────────────────────────────────────────

function TrendChart({
  title,
  points,
  unit,
  decimals,
}: {
  title: string
  points: TrendPoint[]
  unit: string
  decimals: number
}) {
  const hasData = points.some((p) => p.value != null)
  const chartData = points.map((p) => ({ bucket: p.bucket, value: p.value }))
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[15px] font-semibold text-foreground">{title}</p>
      </div>
      {hasData ? (
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="bucket" tick={{ fontSize: 12 }} minTickGap={24} />
              <YAxis
                tick={{ fontSize: 12 }}
                width={56}
                domain={[(min: number) => min * 0.95, (max: number) => max * 1.05]}
                tickFormatter={(v: number) => nf(decimals === 0 ? 0 : 0).format(v)}
              />
              <Tooltip
                formatter={(v: unknown) => [`${fmt(typeof v === "number" ? v : null, decimals)} ${unit}`, title]}
                contentStyle={{ fontSize: 13 }}
              />
              <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-[220px] flex items-center justify-center text-[14px] text-muted-foreground">데이터 없음</div>
      )}
    </div>
  )
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

export function DaewonKpiClient({ data, filterOptions, initialKpi }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [activeKpi, setActiveKpi] = useState<KpiKey>(initialKpi)
  const [from, setFrom] = useState(data.filter.from)
  const [to, setTo] = useState(data.filter.to)
  const [itemId, setItemId] = useState(data.filter.itemId ?? "")
  const [processId, setProcessId] = useState(data.filter.processId ?? "")
  const [customerId, setCustomerId] = useState(data.filter.customerId ?? "")
  const [equipmentIds, setEquipmentIds] = useState<string[]>(data.filter.equipmentIds ?? [])
  const [granularity, setGranularity] = useState(data.filter.granularity)
  const [equipOpen, setEquipOpen] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!equipOpen) return
    const close = () => setEquipOpen(false)
    document.addEventListener("click", close)
    return () => document.removeEventListener("click", close)
  }, [equipOpen])

  // 선택한 KPI 와 무관한 필터는 비활성화한다.
  const productionFiltersEnabled = activeKpi !== "onTime"
  const customerFilterEnabled = activeKpi === "onTime"

  function apply(nextGranularity = granularity, nextKpi = activeKpi) {
    const p = new URLSearchParams()
    p.set("from", from)
    p.set("to", to)
    if (itemId) p.set("itemId", itemId)
    if (processId) p.set("processId", processId)
    if (equipmentIds.length) p.set("equipmentIds", equipmentIds.join(","))
    if (customerId) p.set("customerId", customerId)
    p.set("granularity", nextGranularity)
    p.set("kpi", nextKpi)
    startTransition(() => router.push(`${pathname}?${p.toString()}`))
  }

  function selectKpi(k: KpiKey) {
    setActiveKpi(k)
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }))
  }

  const t = data.targets
  const prod = data.production
  const del = data.delivery

  const cardValue: Record<KpiKey, number | null> = {
    uph: data.evaluations.uph.actual,
    ppm: data.evaluations.ppm.actual,
    onTime: data.evaluations.onTime.actual,
  }
  const selectCls =
    "border border-border rounded-md px-3 py-2 text-[14px] bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[180px] disabled:opacity-50 disabled:cursor-not-allowed"
  const labelCls = "text-[13px] font-medium text-muted-foreground"

  return (
    <div className="space-y-6">
      {/* 조회 조건 */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <p className={labelCls}>조회 기간 (KST)</p>
            <div className="flex items-center gap-2">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls + " min-w-0"} />
              <span className="text-[14px] text-muted-foreground">~</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selectCls + " min-w-0"} />
            </div>
          </div>
          <div className="space-y-1">
            <p className={labelCls}>품목</p>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={selectCls}>
              <option value="">전체 품목</option>
              {filterOptions.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.code})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <p className={labelCls}>공정</p>
            <select
              value={processId}
              onChange={(e) => setProcessId(e.target.value)}
              disabled={!productionFiltersEnabled}
              className={selectCls}
            >
              <option value="">전체 공정</option>
              {filterOptions.processes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 relative">
            <p className={labelCls}>설비</p>
            <button
              type="button"
              disabled={!productionFiltersEnabled}
              onClick={(e) => {
                e.stopPropagation()
                setEquipOpen((o) => !o)
              }}
              className={selectCls + " text-left flex items-center justify-between gap-2"}
            >
              <span className="truncate">{equipmentIds.length === 0 ? "전체 설비" : `${equipmentIds.length}개 선택`}</span>
              <span className="text-[12px]">▼</span>
            </button>
            {equipOpen && productionFiltersEnabled && (
              <div
                className="absolute z-20 top-full left-0 mt-1 w-64 max-h-60 overflow-y-auto rounded-md border border-border bg-background shadow-md"
                onClick={(e) => e.stopPropagation()}
              >
                {filterOptions.equipments.length === 0 ? (
                  <p className="px-3 py-2 text-[13px] text-muted-foreground">설비 없음</p>
                ) : (
                  filterOptions.equipments.map((eq) => (
                    <label key={eq.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 cursor-pointer text-[14px]">
                      <input
                        type="checkbox"
                        checked={equipmentIds.includes(eq.id)}
                        onChange={() =>
                          setEquipmentIds((prev) => (prev.includes(eq.id) ? prev.filter((x) => x !== eq.id) : [...prev, eq.id]))
                        }
                      />
                      <span>
                        {eq.name} ({eq.code})
                      </span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <p className={labelCls}>거래처 (납기준수율)</p>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              disabled={!customerFilterEnabled}
              className={selectCls}
            >
              <option value="">전체 거래처</option>
              {filterOptions.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => apply()}
            disabled={isPending}
            className="px-5 py-2 rounded-md text-[14px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isPending ? "조회중…" : "조회"}
          </button>
        </div>
        <p className="text-[13px] text-muted-foreground">
          공정·설비 필터는 시간당 생산량/공정불량률에, 거래처 필터는 납기준수율에만 적용됩니다. 비활성화된 필터는 선택한 KPI와 무관합니다.
        </p>
      </div>

      {/* KPI 요약 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {KPI_ORDER.map((key) => {
          const def = t[key]
          const active = activeKpi === key
          return (
            <button
              key={key}
              onClick={() => selectKpi(key)}
              className={[
                "text-left rounded-lg border bg-card px-5 py-4 transition-all",
                active ? "border-primary ring-1 ring-primary shadow-sm" : "border-border hover:border-primary/50 hover:shadow-sm",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[18px] font-semibold text-foreground">{def.label}</p>
              </div>

              <div className="mt-3 flex items-baseline gap-2">
                {cardValue[key] != null ? (
                  <>
                    <span className="text-[28px] font-semibold tabular-nums text-foreground leading-none">
                      {fmt(cardValue[key], def.decimals)}
                    </span>
                    <span className="text-[14px] text-muted-foreground">{def.unit}</span>
                  </>
                ) : (
                  <span className="text-[18px] text-muted-foreground">데이터 없음</span>
                )}
              </div>
              <p className="text-[13px] text-primary mt-3">{active ? "▼ 아래 상세 분석 표시 중" : "클릭하여 상세 분석 보기"}</p>
            </button>
          )
        })}
      </div>

      {/* 추이 그래프 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[20px] font-semibold text-foreground">KPI 추이</p>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {(["day", "month"] as const).map((g) => (
              <button
                key={g}
                disabled={isPending}
                onClick={() => {
                  setGranularity(g)
                  apply(g)
                }}
                className={[
                  "px-4 py-1.5 text-[14px] transition-colors",
                  granularity === g ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-muted/50",
                ].join(" ")}
              >
                {g === "day" ? "일별" : "월별"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <TrendChart title="시간당 생산량" points={prod.uph.trend} unit={t.uph.unit} decimals={t.uph.decimals} />
          <TrendChart title="공정불량률" points={prod.ppm.trend} unit={t.ppm.unit} decimals={t.ppm.decimals} />
          <TrendChart title="납기준수율" points={del.trend} unit={t.onTime.unit} decimals={t.onTime.decimals} />
        </div>
        <p className="text-[13px] text-muted-foreground">
          시간당 생산량·공정불량률은 생산실적 일자(KST), 납기준수율은 약속 납기일 기준으로 집계합니다. 월별 값은 해당 월 전체 실적을 합산해 다시 계산한 값입니다.
        </p>
      </div>

      {/* 상세 분석 */}
      <div ref={detailRef} className="rounded-lg border border-primary/30 bg-card p-5 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[20px] font-semibold text-foreground">{t[activeKpi].label} 상세 분석</p>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {KPI_ORDER.map((k) => (
              <button
                key={k}
                onClick={() => setActiveKpi(k)}
                className={[
                  "px-3 py-1.5 text-[14px] transition-colors",
                  activeKpi === k ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-muted/50",
                ].join(" ")}
              >
                {t[k].label}
              </button>
            ))}
          </div>
        </div>

        {activeKpi === "uph" && (
          <div className="space-y-6">
            <p className="text-[14px] text-muted-foreground">
              계산식: 양품 생산수량 ÷ 실제 작업시간(h). 시작·종료 시각이 모두 기록된 생산실적만 계산에 사용합니다 (대상 {fmt(prod.uph.validCount, 0)}건
              {prod.uph.excludedCount > 0 ? `, 작업시간 미기록/0 으로 제외 ${fmt(prod.uph.excludedCount, 0)}건` : ""}
              {prod.duplicateSkipped > 0 ? `, 중복 ${fmt(prod.duplicateSkipped, 0)}건 제외` : ""}).
            </p>
            <div>
              <SubTitle>공정별 실적</SubTitle>
              <Table
                headers={["공정", "실적 건수", "양품수량", "작업시간(h)", "UPH(개/시간)"]}
                rows={prod.uph.byProcess.map((r) => [r.label, fmt(r.resultCount, 0), fmt(r.goodQty, 0), fmt(r.hours, 1), fmt(r.uph, 1)])}
                empty="작업시간이 기록된 생산실적 없음"
              />
            </div>
            <div>
              <SubTitle>품목별 실적</SubTitle>
              <Table
                headers={["품목", "품목코드", "실적 건수", "양품수량", "작업시간(h)", "UPH(개/시간)"]}
                rows={prod.uph.byItem.map((r) => [r.label, r.sub ?? "", fmt(r.resultCount, 0), fmt(r.goodQty, 0), fmt(r.hours, 1), fmt(r.uph, 1)])}
                empty="작업시간이 기록된 생산실적 없음"
                rightFrom={2}
              />
            </div>
            <div>
              <SubTitle>설비별 실적</SubTitle>
              <Table
                headers={["설비", "실적 건수", "양품수량", "작업시간(h)", "UPH(개/시간)"]}
                rows={prod.uph.byEquipment.map((r) => [r.label, fmt(r.resultCount, 0), fmt(r.goodQty, 0), fmt(r.hours, 1), fmt(r.uph, 1)])}
                empty="작업시간이 기록된 생산실적 없음"
              />
            </div>
            <ProductionRowsTable data={data} mode="uph" />
          </div>
        )}

        {activeKpi === "ppm" && (
          <div className="space-y-6">
            <p className="text-[14px] text-muted-foreground">
              계산식: 공정 불량수량 ÷ (양품수량 + 불량수량) × 1,000,000. 생산실적(ProductionResult)의 양품·불량수량 기준이며, 재작업 수량({fmt(prod.ppm.reworkQty, 0)})은 분모·분자에 포함하지 않습니다.
              검사 기준 불량률(품질관리 화면)과는 별개의 지표입니다.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                ["양품수량", fmt(prod.ppm.goodQty, 0)],
                ["불량수량", fmt(prod.ppm.defectQty, 0)],
                ["총 생산수량 (양품+불량)", fmt(prod.ppm.totalQty, 0)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-md border border-border bg-muted/20 px-4 py-3">
                  <p className="text-[13px] text-muted-foreground">{k}</p>
                  <p className="text-[20px] font-semibold tabular-nums text-foreground mt-1">{v}</p>
                </div>
              ))}
            </div>
            <div>
              <SubTitle>공정별 불량 현황</SubTitle>
              <Table
                headers={["공정", "실적 건수", "양품수량", "불량수량", "총 수량", "PPM"]}
                rows={prod.ppm.byProcess.map((r) => [r.label, fmt(r.resultCount, 0), fmt(r.goodQty, 0), fmt(r.defectQty, 0), fmt(r.totalQty, 0), fmt(r.ppm, 0)])}
                empty="조회 기간 내 생산실적 없음"
              />
            </div>
            <div>
              <SubTitle>품목별 불량 현황</SubTitle>
              <Table
                headers={["품목", "품목코드", "실적 건수", "양품수량", "불량수량", "총 수량", "PPM"]}
                rows={prod.ppm.byItem.map((r) => [r.label, r.sub ?? "", fmt(r.resultCount, 0), fmt(r.goodQty, 0), fmt(r.defectQty, 0), fmt(r.totalQty, 0), fmt(r.ppm, 0)])}
                empty="조회 기간 내 생산실적 없음"
                rightFrom={2}
              />
            </div>
            <div>
              <SubTitle>설비별 불량 현황</SubTitle>
              <Table
                headers={["설비", "실적 건수", "양품수량", "불량수량", "총 수량", "PPM"]}
                rows={prod.ppm.byEquipment.map((r) => [r.label, fmt(r.resultCount, 0), fmt(r.goodQty, 0), fmt(r.defectQty, 0), fmt(r.totalQty, 0), fmt(r.ppm, 0)])}
                empty="조회 기간 내 생산실적 없음"
              />
            </div>
            <div>
              <SubTitle>불량 유형별 수량·비중 (검사 등록 불량 기준)</SubTitle>
              <p className="text-[13px] text-muted-foreground mb-2">
                불량 유형은 품질검사에서 등록된 불량 기록에서 집계합니다. 생산실적 불량수량과 집계 출처가 달라 합계가 다를 수 있으며, PPM 계산에는 사용하지 않습니다. 설비 필터는 검사 대상 공정의 지정 설비 기준입니다.
              </p>
              <Table
                headers={["불량 유형", "불량코드", "수량", "비중"]}
                rows={data.inspectionDefectTypes.rows.map((r) => [r.name, r.code, fmt(r.qty, 0), `${r.pct}%`])}
                empty="조회 기간 내 검사 불량 기록 없음"
                rightFrom={2}
              />
            </div>
            <ProductionRowsTable data={data} mode="ppm" />
          </div>
        )}

        {activeKpi === "onTime" && (
          <div className="space-y-6">
            <p className="text-[14px] text-muted-foreground">
              계산식: 납기 내 완료된 수주품목 건수 ÷ 납기가 도래한 전체 수주품목 건수 × 100. 약속 납기일은 수주품목 납기일(없으면 수주 납기일)이며,
              출하확정(출하/납품 완료) 이력의 누적 수량이 주문수량을 처음 충족한 일자를 완료일로 봅니다. 납기일이 오늘({data.todayKey}) 이후인 건, 취소·미확정 수주는 제외합니다.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                ["납기 도래 수주품목", `${fmt(del.dueCount, 0)}건`],
                ["납기 내 완료", `${fmt(del.onTimeCount, 0)}건`],
                ["지연 완료", `${fmt(del.lateCompletedCount, 0)}건`],
                ["납기 경과 미납품", `${fmt(del.lateOpenCount, 0)}건`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-md border border-border bg-muted/20 px-4 py-3">
                  <p className="text-[13px] text-muted-foreground">{k}</p>
                  <p className="text-[20px] font-semibold tabular-nums text-foreground mt-1">{v}</p>
                </div>
              ))}
            </div>
            <div>
              <SubTitle>거래처별 납기 현황</SubTitle>
              <Table
                headers={["거래처", "납기 도래", "납기 내", "지연", "지연일수 합", "납기준수율(%)"]}
                rows={del.byCustomer.map((r) => [r.label, fmt(r.dueCount, 0), fmt(r.onTimeCount, 0), fmt(r.lateCount, 0), fmt(r.delayDaysSum, 0), fmt(r.rate, 1)])}
                empty="납기가 도래한 수주품목 없음"
              />
            </div>
            <div>
              <SubTitle>품목별 납기 현황</SubTitle>
              <Table
                headers={["품목", "품목코드", "납기 도래", "납기 내", "지연", "지연일수 합", "납기준수율(%)"]}
                rows={del.byItem.map((r) => [r.label, r.sub ?? "", fmt(r.dueCount, 0), fmt(r.onTimeCount, 0), fmt(r.lateCount, 0), fmt(r.delayDaysSum, 0), fmt(r.rate, 1)])}
                empty="납기가 도래한 수주품목 없음"
                rightFrom={2}
              />
            </div>
            <div>
              <SubTitle>지연 내역 ({fmt(del.lateCount, 0)}건)</SubTitle>
              <Table
                headers={["수주번호", "거래처", "품목", "주문수량", "출하수량", "납기일", "완료일", "지연일수", "상태"]}
                rows={del.lateRows.map((r) => [
                  r.orderNo,
                  r.customerName,
                  r.itemName,
                  fmt(r.orderedQty, 0),
                  fmt(r.shippedQty, 0),
                  r.dueKey,
                  r.completedKey ?? "미납품",
                  `${fmt(r.delayDays, 0)}일`,
                  r.state === "LATE_OPEN" ? "납기 경과 미납품" : "지연 완료",
                ])}
                empty="지연 건 없음"
                rightFrom={3}
              />
            </div>
            <div>
              <SubTitle>납기 도래 전체 수주품목 ({fmt(data.deliveryRows.length, 0)}건 · 계산 근거)</SubTitle>
              <Table
                headers={["수주번호", "거래처", "품목", "주문수량", "출하수량", "납기일", "완료일", "판정"]}
                rows={data.deliveryRows.map((r) => [
                  r.orderNo,
                  r.customerName,
                  r.itemName,
                  fmt(r.orderedQty, 0),
                  fmt(r.shippedQty, 0),
                  r.dueKey,
                  r.completedKey ?? "미납품",
                  r.onTime ? "납기 준수" : r.state === "LATE_OPEN" ? "미준수(미납품)" : "미준수(지연)",
                ])}
                empty="납기가 도래한 수주품목 없음"
                rightFrom={3}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ProductionRowsTable({ data, mode }: { data: DaewonKpiData; mode: "uph" | "ppm" }) {
  const rows = data.productionRows
  return (
    <div>
      <SubTitle>계산 근거 — 생산실적 상세 (최근 {fmt(rows.length, 0)}건{data.productionRowsTruncated ? ` / 전체 ${fmt(data.production.resultCount, 0)}건 중` : ""})</SubTitle>
      {data.productionRowsTruncated && (
        <p className="text-[13px] text-muted-foreground mb-2">
          목록은 최근 실적 일부이며, 상단 KPI 수치와 위 집계표는 조회 조건에 해당하는 전체 {fmt(data.production.resultCount, 0)}건 기준입니다.
        </p>
      )}
      <Table
        headers={
          mode === "uph"
            ? ["일자", "작업지시", "품목", "공정", "설비", "양품수량", "작업시간(h)", "UPH"]
            : ["일자", "작업지시", "품목", "공정", "설비", "양품수량", "불량수량", "PPM"]
        }
        rows={rows.map((r) => {
          const base = [r.dateKey, r.orderNo, r.itemName, r.processName, r.equipmentName ?? "설비 미지정", fmt(r.goodQty, 0)]
          if (mode === "uph") {
            return [...base, r.hours != null ? fmt(r.hours, 2) : "시간 미기록", r.hours != null ? fmt(r.goodQty / r.hours, 1) : "—"]
          }
          const total = r.goodQty + r.defectQty
          return [...base, fmt(r.defectQty, 0), total > 0 ? fmt((r.defectQty / total) * 1_000_000, 0) : "—"]
        })}
        empty="조회 기간 내 생산실적 없음"
        rightFrom={5}
      />
    </div>
  )
}
