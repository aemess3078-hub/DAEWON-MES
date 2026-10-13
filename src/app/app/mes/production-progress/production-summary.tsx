"use client"

import type { ProductionProgressRow, ProductionProgressSummary } from "@/lib/actions/production-progress.types"
import { formatPercent } from "./production-progress-client"
import { formatQuantity } from "@/lib/utils"

// ─── 생산 요약(NewMES 전용) ─────────────────────────────────────────────────────
//
// 상단 KPI(총 작업지시/계획수량/생산실적/전체 진행률/정상/주의/지연)를 그대로
// 반복하지 않고, 운영 관점 보완 정보(작업 상태 구성/재공/납기 임박)를 보여준다.
// 신규 DB 조회 없음 — 이미 받아온 data.rows / data.summary만으로 계산한다.
// production-progress.service.ts의 계산 규칙(생산실적/진행률/재공수량 정의)은
// 여기서 재구현하지 않는다: 재공수량은 row.wipQty 합, 진행률은 summary.overallProgressRate
// 그대로 사용한다.

const UPCOMING_DUE_WINDOW_DAYS = 2
const KST_OFFSET_MS = 9 * 60 * 60 * 1000 // page.tsx의 기본 조회기간 계산과 동일한 KST 오프셋

// 달력 날짜(YYYY-MM-DD, KST) 단위로만 비교하기 위한 변환.
// 타임스탬프를 그대로 비교하면 시/분 차이 때문에 "오늘 마감"이 누락될 수 있다.
function toKstDateString(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

function countUpcomingDue(rows: ProductionProgressRow[]): number {
  const todayKst = toKstDateString(new Date())
  const limitKst = toKstDateString(
    new Date(Date.now() + UPCOMING_DUE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  )

  return rows.filter((row) => {
    if (row.workOrderStatus === "COMPLETED" || row.workOrderStatus === "CANCELLED") return false
    if (!row.dueDate) return false
    const dueKst = toKstDateString(new Date(row.dueDate))
    return dueKst >= todayKst && dueKst <= limitKst
  }).length
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="text-[20px] font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

interface Props {
  rows: ProductionProgressRow[]
  summary: ProductionProgressSummary
}

export function ProductionSummary({ rows, summary }: Props) {
  const inProgressCount = rows.filter((row) => row.workOrderStatus === "IN_PROGRESS").length
  const completedCount = rows.filter((row) => row.workOrderStatus === "COMPLETED").length
  // 재공수량 정본은 service가 계산한 row.wipQty — plannedQty-productionOutputQty 재계산 금지
  const totalWipQty = rows.reduce((sum, row) => sum + row.wipQty, 0)
  const warningOrDelayedCount = summary.warningCount + summary.delayedCount
  const upcomingDueCount = countUpcomingDue(rows)
  const totalWipDisplay = summary.isMixedUom
    ? "단위 혼합"
    : `${formatQuantity(totalWipQty)}${summary.uom ? ` ${summary.uom}` : ""}`

  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="mb-4 text-[18px] font-semibold text-foreground">생산 요약</h2>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
        <SummaryItem label="진행중 작업지시" value={`${formatQuantity(inProgressCount)}건`} />
        <SummaryItem label="완료 작업지시" value={`${formatQuantity(completedCount)}건`} />
        <SummaryItem label="총 재공수량" value={totalWipDisplay} />
        <SummaryItem label="주의·지연 작업지시" value={`${formatQuantity(warningOrDelayedCount)}건`} />
        <SummaryItem label="완료예정 임박" value={`${formatQuantity(upcomingDueCount)}건`} />
        <SummaryItem
          label="전체 생산 달성률"
          value={summary.isMixedUom ? "단위 혼합" : formatPercent(summary.overallProgressRate)}
        />
      </div>
    </div>
  )
}
