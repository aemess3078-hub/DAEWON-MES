import type { WorkOrderStatus } from "@prisma/client"

import { computeExpectedProgressRate } from "@/lib/actions/production-progress.calculations"
import type { ProductionProgressRow } from "@/lib/actions/production-progress.types"
import { kstDateKeyToUtcStart, toKstDateKey } from "@/lib/date/kst"

// ─── 주요 생산 알림(NewMES 전용) — 순수 계산 ─────────────────────────────────────
//
// data.rows만 사용한다. DB 접근 없음, React 없음, 별도 fetch 없음.
// 새로운 건강도 규칙을 만들지 않는다 — row.healthStatus를 정본으로 삼아
// "지연 사유만 세분화"한다(production-progress.service.ts의 resolveHealthStatus를
// 그대로 신뢰). 계획수량/생산실적/진행률/WIP/건강도 계산은 여기서 재구현하지 않는다.

export type ProductionAlertSeverity = "CRITICAL" | "WARNING"

export type ProductionAlertType = "OVERDUE" | "PROGRESS_DELAY" | "DUE_SOON" | "UNRESOLVED_REWORK"

export type ProductionAlert = {
  id: string
  workOrderId: string
  orderNo: string
  severity: ProductionAlertSeverity
  type: ProductionAlertType
  dueDate: Date | null
  progressRate: number
  /** OVERDUE: 납기 초과일수(KST 달력일). DUE_SOON: 납기까지 남은 일수(0=오늘) */
  days?: number
  /** PROGRESS_DELAY: expectedProgressRate - progressRate. 계산 불가(시작일 없음 등) 시 생략 */
  progressGap?: number
}

const EXCLUDED_HEALTH_ALERT_STATUSES: WorkOrderStatus[] = ["COMPLETED", "CANCELLED"]

// "며칠 초과/남음" 표시값만 KST 달력일 기준으로 계산한다(요구사항). 한국은 DST가
// 없으므로 각 날짜를 그 날 KST 00:00의 UTC instant로 앵커링해 밀리초 차이를
// 24시간으로 나누면 항상 정확한 정수 일수가 나온다(daily-production-trend-chart.tsx의
// KST 처리와 동일한 방식, src/lib/date/kst.ts 재사용).
function kstCalendarDayDiff(fromDate: Date, toDate: Date): number {
  const fromAnchor = kstDateKeyToUtcStart(toKstDateKey(fromDate)).getTime()
  const toAnchor = kstDateKeyToUtcStart(toKstDateKey(toDate)).getTime()
  return Math.round((toAnchor - fromAnchor) / (24 * 60 * 60 * 1000))
}

function buildHealthAlert(row: ProductionProgressRow, referenceDate: Date): ProductionAlert | null {
  if (EXCLUDED_HEALTH_ALERT_STATUSES.includes(row.workOrderStatus)) return null

  // OVERDUE/PROGRESS_DELAY 분기는 resolveHealthStatus가 DELAYED를 판정할 때 쓴 것과
  // 정확히 같은 "시각(instant)" 비교를 그대로 써야 healthStatus와 절대 어긋나지
  // 않는다. KST 달력일 비교로 바꾸면 자정 부근에서 서로 다른 결론이 날 수 있다
  // (예: dueDate가 오늘 08시, 지금이 오늘 10시 → 시각 기준으로는 이미 지났지만
  //  달력일로는 "오늘"이라 지나지 않은 것처럼 보일 수 있음). KST 달력일 변환은
  // 화면에 보여줄 "며칠 초과/남음" 숫자를 만들 때만 사용한다.
  const isOverdue = row.dueDate != null && row.dueDate.getTime() < referenceDate.getTime()

  if (row.healthStatus === "DELAYED" && isOverdue) {
    return {
      id: `${row.workOrderId}:OVERDUE`,
      workOrderId: row.workOrderId,
      orderNo: row.orderNo,
      severity: "CRITICAL",
      type: "OVERDUE",
      dueDate: row.dueDate,
      progressRate: row.progressRate,
      days: row.dueDate ? kstCalendarDayDiff(row.dueDate, referenceDate) : undefined,
    }
  }

  if (row.healthStatus === "DELAYED") {
    // isOverdue가 아닌데 DELAYED라는 것은 resolveHealthStatus 구조상
    // "예상 진행률 - 실제 진행률 >= 20%p" 조건으로 판정된 경우뿐이다(dueDate가
    // null이면애초에 DELAYED가 될 수 없으므로 이 분기의 row.dueDate는 항상 존재).
    const expectedProgressRate = computeExpectedProgressRate(
      row.startedAt,
      row.dueDate,
      referenceDate
    )
    return {
      id: `${row.workOrderId}:PROGRESS_DELAY`,
      workOrderId: row.workOrderId,
      orderNo: row.orderNo,
      severity: "WARNING",
      type: "PROGRESS_DELAY",
      dueDate: row.dueDate,
      progressRate: row.progressRate,
      progressGap:
        expectedProgressRate != null ? expectedProgressRate - row.progressRate : undefined,
    }
  }

  if (row.healthStatus === "WARNING") {
    return {
      id: `${row.workOrderId}:DUE_SOON`,
      workOrderId: row.workOrderId,
      orderNo: row.orderNo,
      severity: "WARNING",
      type: "DUE_SOON",
      dueDate: row.dueDate,
      progressRate: row.progressRate,
      days: row.dueDate != null ? kstCalendarDayDiff(referenceDate, row.dueDate) : undefined,
    }
  }

  return null
}

function buildReworkAlert(row: ProductionProgressRow): ProductionAlert | null {
  // 재작업은 healthStatus와 독립적이라 COMPLETED 작업지시에도 표시를 허용한다 —
  // 실제로 모든 WorkOrderOperation이 COMPLETED되어 WorkOrder.status가 COMPLETED로
  // 바뀐 뒤에도, 이전 공정에서 분리된 REWORK child WipUnit은 completeRework()로
  // 별도 종결되기 전까지 REWORK 상태로 남아 있을 수 있다(공정 완료가 재작업 종결을
  // 기다리지 않는 구조 — pop.actions.ts/process-progress.actions.ts 확인). 다만
  // CANCELLED 작업지시는 더 이상 조치 대상이 아니므로 제외한다.
  if (row.workOrderStatus === "CANCELLED") return null
  if (!row.hasUnresolvedRework) return null

  return {
    id: `${row.workOrderId}:UNRESOLVED_REWORK`,
    workOrderId: row.workOrderId,
    orderNo: row.orderNo,
    severity: "CRITICAL",
    type: "UNRESOLVED_REWORK",
    dueDate: row.dueDate,
    progressRate: row.progressRate,
  }
}

const SEVERITY_RANK: Record<ProductionAlertSeverity, number> = { CRITICAL: 0, WARNING: 1 }

function compareAlerts(a: ProductionAlert, b: ProductionAlert): number {
  const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  if (severityDiff !== 0) return severityDiff

  if (a.dueDate == null && b.dueDate == null) return a.orderNo.localeCompare(b.orderNo, "ko")
  if (a.dueDate == null) return 1
  if (b.dueDate == null) return -1
  const dueDiff = a.dueDate.getTime() - b.dueDate.getTime()
  if (dueDiff !== 0) return dueDiff

  return a.orderNo.localeCompare(b.orderNo, "ko")
}

/**
 * 작업지시당 최대 2개(건강도 알림 1개 + 재작업 알림 1개)까지 생성한다.
 * 표시 개수 제한(예: 상위 8개)은 이 함수의 책임이 아니다 — 여기서는 해당 조회
 * 조건의 전체 알림을 정렬된 상태로 모두 반환하고, "몇 개까지 보여줄지"는 UI에서
 * 정한다(전체 N건 카운트를 정확히 보여주기 위해 자르지 않는다).
 */
export function buildProductionAlerts(
  rows: ProductionProgressRow[],
  referenceDate: Date = new Date()
): ProductionAlert[] {
  const alerts: ProductionAlert[] = []

  for (const row of rows) {
    const healthAlert = buildHealthAlert(row, referenceDate)
    if (healthAlert) alerts.push(healthAlert)

    const reworkAlert = buildReworkAlert(row)
    if (reworkAlert) alerts.push(reworkAlert)
  }

  return alerts.sort(compareAlerts)
}
