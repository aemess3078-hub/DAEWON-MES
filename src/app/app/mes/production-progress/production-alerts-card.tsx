"use client"

import { useMemo } from "react"

import { Badge } from "@/components/ui/badge"
import type { ProductionProgressRow } from "@/lib/actions/production-progress.types"
import { toKstDateKey } from "@/lib/date/kst"
import { formatPercent } from "./production-progress-client"
import { buildProductionAlerts, type ProductionAlert } from "./production-alerts"
import { formatQuantity } from "@/lib/utils"

// ─── 주요 생산 알림 카드(NewMES 전용) ────────────────────────────────────────────
//
// rows만 props로 받는다 — 별도 fetch/Server Action 없음. 값 계산은 순수 헬퍼
// buildProductionAlerts()(production-alerts.ts)에 전부 위임하고, 이 파일은
// 한국어 메시지 조립과 표시(상위 8개)만 담당한다.

const MAX_VISIBLE_ALERTS = 8

const SEVERITY_LABELS: Record<ProductionAlert["severity"], string> = {
  CRITICAL: "긴급",
  WARNING: "주의",
}

const SEVERITY_BADGE_CLASS: Record<ProductionAlert["severity"], string> = {
  CRITICAL: "border-red-200 bg-red-50 text-red-700",
  WARNING: "border-amber-200 bg-amber-50 text-amber-700",
}

function formatKstDate(date: Date): string {
  return toKstDateKey(date).replaceAll("-", ".")
}

function formatAlertMessage(alert: ProductionAlert): string {
  switch (alert.type) {
    case "OVERDUE":
      return `납기일이 ${alert.days ?? ""}일 초과되었습니다.`
    case "PROGRESS_DELAY":
      return alert.progressGap != null
        ? `계획 대비 생산 진행률이 ${Math.round(alert.progressGap)}%p 뒤처져 있습니다.`
        : "계획 대비 생산 진행이 지연되고 있습니다."
    case "DUE_SOON":
      if (alert.days === 0) {
        return `완료예정일이 오늘이며 현재 진행률은 ${formatPercent(alert.progressRate)}입니다.`
      }
      return alert.days != null
        ? `완료예정일까지 ${alert.days}일 남았으며 현재 진행률은 ${formatPercent(alert.progressRate)}입니다.`
        : `완료예정일이 임박했으며 현재 진행률은 ${formatPercent(alert.progressRate)}입니다.`
    case "UNRESOLVED_REWORK":
      return "미해결 재작업이 존재합니다."
  }
}

interface Props {
  rows: ProductionProgressRow[]
}

export function ProductionAlertsCard({ rows }: Props) {
  const alerts = useMemo(() => buildProductionAlerts(rows), [rows])
  const visibleAlerts = alerts.slice(0, MAX_VISIBLE_ALERTS)

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-foreground">주요 생산 알림</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            현재 조회조건에서 확인이 필요한 작업지시입니다.
          </p>
        </div>
        <span className="whitespace-nowrap text-[13px] text-muted-foreground">
          전체 {formatQuantity(alerts.length)}건
        </span>
      </div>

      {alerts.length === 0 ? (
        <p className="py-8 text-center text-[14px] text-muted-foreground">
          현재 조회조건에서 확인이 필요한 생산 알림이 없습니다.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {visibleAlerts.map((alert) => (
            <li key={alert.id} className="rounded-md border border-border px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`text-[11px] ${SEVERITY_BADGE_CLASS[alert.severity]}`}
                >
                  {SEVERITY_LABELS[alert.severity]}
                </Badge>
                <span className="font-mono text-[13px] font-medium text-foreground">
                  {alert.orderNo}
                </span>
              </div>
              <p className="mt-1 text-[14px] text-foreground">{formatAlertMessage(alert)}</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {alert.dueDate ? `완료예정 ${formatKstDate(alert.dueDate)} · ` : ""}
                진행률 {formatPercent(alert.progressRate)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
