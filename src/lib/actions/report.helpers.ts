import { toKstDateKey } from "../date/kst"
import type { ProductionResultWithDetails } from "./production-result.actions"
import type { EquipmentStatisticsData } from "./equipment-statistics.actions"

// 생산일보(리포트) 순수 집계 로직. report.actions.ts("use server")는 async
// export만 허용되므로 DB/네트워크에 의존하지 않는 파싱/집계 로직을 이 파일로
// 분리한다(backup.helpers.ts/quality-dashboard.helpers.ts와 동일한 이유).
//
// 데이터 정본: getProductionResults()가 이미 반환하는 ProductionResult 원본
// 필드(goodQty/defectQty/reworkQty)와 WorkOrderOperation의 canonical
// plannedQty/completedQty만 사용한다 — 새로운 진행률/생산량 정의를 만들지
// 않는다(§ STEP 13/14).

/** ISO(UTC) 문자열을 KST 기준 YYYY-MM-DD로 변환한다. */
export function toKstDateOnly(iso: string): string {
  return toKstDateKey(new Date(iso))
}

/**
 * KST 일시를 "YYYY-MM-DD HH:mm:ss" 형태로 표시한다(리포트 상세 테이블처럼
 * 서버 렌더 시점에 바로 표시되는 날짜/시각용). 오전/오후·AM/PM 같은 로케일
 * 문자열은 Node(SSR)와 브라우저(hydration)의 Intl 구현이 다르게 렌더링해
 * hydration mismatch를 일으킬 수 있어(실사용 중 발견), 24시간제 표기로
 * 고정해 로케일 텍스트에 의존하지 않는다.
 */
export function formatKstDateTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour12: false })
  return `${date} ${time}`
}

/**
 * 리포트 Excel 파일명 규칙(§ STEP 10): "{prefix}_YYYYMMDD.xlsx"(단일일자) 또는
 * "{prefix}_YYYYMMDD_YYYYMMDD.xlsx"(기간). from/to는 이미 KST 기준
 * YYYY-MM-DD 문자열(필터 상태)이라고 가정한다.
 */
export function buildReportFilename(prefix: string, from: string, to: string): string {
  const fromStamp = from.replace(/-/g, "")
  const toStamp = to.replace(/-/g, "")
  return fromStamp === toStamp ? `${prefix}_${fromStamp}.xlsx` : `${prefix}_${fromStamp}_${toStamp}.xlsx`
}

export type DailyProductionRow = {
  id: string
  date: string // YYYY-MM-DD, KST
  orderNo: string
  manufacturingNo: string | null
  itemCode: string
  itemName: string
  itemUom: string
  operationName: string
  operatorName: string | null
  startedAt: string
  endedAt: string | null
  equipmentName: string | null
  plannedQty: number // 해당 공정(WorkOrderOperation)의 계획수량 — 행마다 동일 공정이면 반복 표시됨
  producedQty: number // goodQty + defectQty + reworkQty
  goodQty: number
  defectQty: number
  reworkQty: number
  workHours: number | null // (endedAt - startedAt) 시간, 둘 중 하나라도 없으면 null(가짜 시간 생성 금지)
}

/** startedAt이 없는 실적은 "일자" 리포트에 배치할 기준이 없으므로 제외한다(가짜 일자 생성 금지, § STEP 7). */
export function buildDailyProductionRows(
  results: ProductionResultWithDetails[]
): DailyProductionRow[] {
  const rows: DailyProductionRow[] = []
  for (const r of results) {
    if (!r.startedAt) continue
    const op = r.workOrderOperation
    const workHours =
      r.endedAt && r.startedAt
        ? (new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 3_600_000
        : null
    rows.push({
      id: r.id,
      date: toKstDateOnly(r.startedAt),
      orderNo: op.workOrder.orderNo,
      manufacturingNo: op.workOrder.manufacturingNo,
      itemCode: op.workOrder.item.code,
      itemName: op.workOrder.item.name,
      itemUom: op.workOrder.item.uom,
      operationName: op.routingOperation.name,
      operatorName: r.operator?.name ?? null,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      equipmentName: r.equipment?.name ?? null,
      plannedQty: op.plannedQty,
      producedQty: r.goodQty + r.defectQty + r.reworkQty,
      goodQty: r.goodQty,
      defectQty: r.defectQty,
      reworkQty: r.reworkQty,
      workHours: workHours !== null ? Math.round(workHours * 10) / 10 : null,
    })
  }
  return rows
}

export type DailyProductionDateGroup = {
  date: string
  rows: DailyProductionRow[]
  uom: string | null
  isMixedUom: boolean
  subtotal: {
    producedQty: number
    goodQty: number
    defectQty: number
    reworkQty: number
    workHours: number
  }
}

/** 일자별로 묶고 최신 날짜부터 정렬한다(기존 생산실적조회의 startedAt desc 정렬과 일관). */
export function groupDailyProductionByDate(
  rows: DailyProductionRow[]
): DailyProductionDateGroup[] {
  const map = new Map<string, DailyProductionRow[]>()
  for (const row of rows) {
    const arr = map.get(row.date) ?? []
    arr.push(row)
    map.set(row.date, arr)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, dateRows]) => {
      const uoms = Array.from(new Set(dateRows.map((row) => row.itemUom)))
      const isMixedUom = uoms.length > 1
      return {
        date,
        rows: dateRows,
        uom: isMixedUom ? null : (uoms[0] ?? null),
        isMixedUom,
        subtotal: dateRows.reduce(
        (acc, r) => ({
          producedQty: acc.producedQty + r.producedQty,
          goodQty: acc.goodQty + r.goodQty,
          defectQty: acc.defectQty + r.defectQty,
          reworkQty: acc.reworkQty + r.reworkQty,
          workHours: acc.workHours + (r.workHours ?? 0),
        }),
          { producedQty: 0, goodQty: 0, defectQty: 0, reworkQty: 0, workHours: 0 }
        ),
      }
    })
}

export type DailyProductionSummaryTotals = {
  resultCount: number
  totalPlannedQty: number // distinct WorkOrderOperation 기준(행 중복 합산 방지)
  totalProducedQty: number
  totalGoodQty: number
  totalDefectQty: number
  totalReworkQty: number
  totalWorkHours: number
  uom: string | null
  isMixedUom: boolean
}

/**
 * 계획수량은 같은 공정(WorkOrderOperation)에 여러 실적 행이 걸쳐 있으면 행마다
 * 반복 표시되므로, 합계는 workOrderOperationId 기준으로 한 번만 센다(중복
 * 합산 방지 — § STEP 13/14 "화면별 숫자가 기존과 다르게 나오면 안 된다"와
 * 동일 원칙: 있는 그대로의 canonical 값을 왜곡 없이 합산한다).
 */
export function computeDailyProductionSummary(
  results: ProductionResultWithDetails[],
  rows: DailyProductionRow[]
): DailyProductionSummaryTotals {
  const opMap = new Map<string, { plannedQty: number }>()
  for (const r of results) {
    if (opMap.has(r.workOrderOperationId)) continue
    opMap.set(r.workOrderOperationId, {
      plannedQty: r.workOrderOperation.plannedQty,
    })
  }

  let totalPlannedQty = 0
  Array.from(opMap.values()).forEach((v) => {
    totalPlannedQty += v.plannedQty
  })
  const uoms = Array.from(new Set(rows.map((row) => row.itemUom)))
  const isMixedUom = uoms.length > 1

  const rowTotals = rows.reduce(
    (acc, r) => ({
      totalProducedQty: acc.totalProducedQty + r.producedQty,
      totalGoodQty: acc.totalGoodQty + r.goodQty,
      totalDefectQty: acc.totalDefectQty + r.defectQty,
      totalReworkQty: acc.totalReworkQty + r.reworkQty,
      totalWorkHours: acc.totalWorkHours + (r.workHours ?? 0),
    }),
    { totalProducedQty: 0, totalGoodQty: 0, totalDefectQty: 0, totalReworkQty: 0, totalWorkHours: 0 }
  )

  return {
    resultCount: rows.length,
    totalPlannedQty: Math.round(totalPlannedQty * 1000) / 1000,
    totalWorkHours: Math.round(rowTotals.totalWorkHours * 10) / 10,
    totalProducedQty: rowTotals.totalProducedQty,
    totalGoodQty: rowTotals.totalGoodQty,
    totalDefectQty: rowTotals.totalDefectQty,
    totalReworkQty: rowTotals.totalReworkQty,
    uom: isMixedUom ? null : (uoms[0] ?? null),
    isMixedUom,
  }
}

// ─── 설비리포트 — 기존 equipment-statistics.actions.ts의 정본 통계를 설비별로 합침 ─
//
// getEquipmentStatisticsData()는 카테고리별(생산/에러/비가동/작업시간/가동률)로
// 이미 올바르게 계산된 숫자를 돌려준다. 여기서는 새 지표를 계산하지 않고,
// 설비코드/일자라는 자연 키로 그 결과들을 합치기만 한다(§ STEP 17 "historical
// source가 없는 지표는 출력하지 않는다" — 없는 지표를 만들지 않고, 있는
// 지표만 보기 좋게 묶는다).

export type EquipmentReportRow = {
  code: string
  name: string
  goodQty: number
  defectQty: number
  workHours: number
  runMinutes: number
  availabilityRate: number | null
  stopMinutes: number
  maintenanceMinutes: number
  downtimeMinutes: number
  alarmCount: number
  warningCount: number
}

export function buildEquipmentReportRows(data: EquipmentStatisticsData): EquipmentReportRow[] {
  const map = new Map<string, EquipmentReportRow>()
  const ensure = (code: string, name: string): EquipmentReportRow => {
    let row = map.get(code)
    if (!row) {
      row = {
        code,
        name,
        goodQty: 0,
        defectQty: 0,
        workHours: 0,
        runMinutes: 0,
        availabilityRate: null,
        stopMinutes: 0,
        maintenanceMinutes: 0,
        downtimeMinutes: 0,
        alarmCount: 0,
        warningCount: 0,
      }
      map.set(code, row)
    }
    return row
  }

  for (const p of data.production.rows) {
    const row = ensure(p.equipmentCode, p.equipmentName)
    row.goodQty += p.goodQty
    row.defectQty += p.defectQty
  }
  for (const w of data.workTime.rows) {
    const row = ensure(w.equipmentCode, w.equipmentName)
    row.workHours += w.hours
  }
  for (const a of data.availability.rows) {
    const row = ensure(a.code, a.name)
    row.runMinutes = a.runMinutes
    row.availabilityRate = a.rate
  }
  for (const d of data.downtime.rows) {
    const row = ensure(d.equipmentCode, d.equipmentName)
    row.stopMinutes = d.stopMinutes
    row.maintenanceMinutes = d.maintenanceMinutes
    row.downtimeMinutes = d.total
  }
  for (const e of data.errors.rows) {
    const row = ensure(e.equipmentCode, e.equipmentName)
    row.alarmCount = e.alarmCount
    row.warningCount = e.warningCount
  }

  return Array.from(map.values())
    .map((row) => ({
      ...row,
      goodQty: Math.round(row.goodQty * 10) / 10,
      defectQty: Math.round(row.defectQty * 10) / 10,
      workHours: Math.round(row.workHours * 10) / 10,
    }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

export type DailyEquipmentTrendRow = {
  date: string
  goodQty: number
  defectQty: number
  hours: number
}

/** production.rows(일자별 양품/불량)와 workTime.rows(일자별 작업시간)를 일자 기준으로 합친다. */
export function buildEquipmentDailyTrend(data: EquipmentStatisticsData): DailyEquipmentTrendRow[] {
  const map = new Map<string, DailyEquipmentTrendRow>()
  const ensure = (date: string): DailyEquipmentTrendRow => {
    let row = map.get(date)
    if (!row) {
      row = { date, goodQty: 0, defectQty: 0, hours: 0 }
      map.set(date, row)
    }
    return row
  }

  for (const p of data.production.rows) {
    const row = ensure(p.date)
    row.goodQty += p.goodQty
    row.defectQty += p.defectQty
  }
  for (const w of data.workTime.rows) {
    const row = ensure(w.date)
    row.hours += w.hours
  }

  return Array.from(map.values())
    .map((row) => ({
      ...row,
      goodQty: Math.round(row.goodQty * 10) / 10,
      defectQty: Math.round(row.defectQty * 10) / 10,
      hours: Math.round(row.hours * 10) / 10,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
