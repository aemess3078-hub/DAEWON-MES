/**
 * 대원정밀 스마트공장 KPI 3종(시간당 생산량 / 공정불량률 / 납기준수율) 순수 계산 모듈.
 *
 * - DB·서버 의존성이 없어 단위 테스트 가능하며, 서버 액션(kpi.actions.ts)이 조회한 원천 행을 넘겨 집계한다.
 * - 기준값/목표값은 사업계획서 원본이며 임의로 변경하지 않는다.
 * - 데이터가 없으면 0 이 아니라 null(= "데이터 없음")을 반환한다.
 */

export type KpiKey = "uph" | "ppm" | "onTime"
export type KpiDirection = "INCREASE" | "DECREASE"

export type KpiTargetDef = {
  key: KpiKey
  label: string
  unit: string
  baseline: number
  target: number
  direction: KpiDirection
  decimals: number
}

/** 사업계획서 KPI 표 (구축 전 / 목표). 작업공수는 이번 범위에서 제외. */
export const DAEWON_KPI_TARGETS: Record<KpiKey, KpiTargetDef> = {
  uph: { key: "uph", label: "시간당 생산량", unit: "개/시간", baseline: 39, target: 44.7, direction: "INCREASE", decimals: 1 },
  ppm: { key: "ppm", label: "공정불량률", unit: "PPM", baseline: 2897, target: 2681, direction: "DECREASE", decimals: 0 },
  onTime: { key: "onTime", label: "납기준수율", unit: "%", baseline: 90, target: 95.4, direction: "INCREASE", decimals: 1 },
}

export type KpiAchievementStatus = "NO_DATA" | "NOT_ACHIEVED" | "ACHIEVED" | "EXCEEDED"

export type KpiEvaluation = {
  actual: number | null
  /** 구축 전 대비 개선율(%). 계산 불가 시 null */
  improvementRate: number | null
  /** 목표 달성률(%). 100 초과도 그대로 유지. 계산 불가 시 null */
  achievementRate: number | null
  status: KpiAchievementStatus
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** 증가 지표: (실적-구축전)/구축전×100, 감소 지표: (구축전-실적)/구축전×100. 분모 0 또는 실적 없음 → null */
export function calcImprovementRate(actual: number | null, baseline: number, direction: KpiDirection): number | null {
  if (!isNum(actual) || !isNum(baseline) || baseline === 0) return null
  const diff = direction === "INCREASE" ? actual - baseline : baseline - actual
  return (diff / baseline) * 100
}

/** (실적-구축전)/(목표-구축전)×100 (감소 지표에도 동일 식). 분모 0 또는 실적 없음 → null */
export function calcAchievementRate(actual: number | null, baseline: number, target: number): number | null {
  if (!isNum(actual) || !isNum(baseline) || !isNum(target) || target - baseline === 0) return null
  return ((actual - baseline) / (target - baseline)) * 100
}

export function judgeStatus(achievementRate: number | null): KpiAchievementStatus {
  if (achievementRate == null) return "NO_DATA"
  if (achievementRate > 100) return "EXCEEDED"
  if (achievementRate === 100) return "ACHIEVED"
  return "NOT_ACHIEVED"
}

export function evaluateKpi(key: KpiKey, actual: number | null): KpiEvaluation {
  const def = DAEWON_KPI_TARGETS[key]
  const a = isNum(actual) ? actual : null
  const achievementRate = calcAchievementRate(a, def.baseline, def.target)
  return {
    actual: a,
    improvementRate: calcImprovementRate(a, def.baseline, def.direction),
    achievementRate,
    status: judgeStatus(achievementRate),
  }
}

/** 시간당 생산량 = 양품수량 ÷ 작업시간(h). 작업시간이 0 이하면 null. */
export function calcUph(goodQty: number, hours: number): number | null {
  return hours > 0 ? goodQty / hours : null
}

/** PPM = 불량수량 ÷ (양품+불량) × 1,000,000. 분모 0 이하면 null. */
export function calcPpm(defectQty: number, totalQty: number): number | null {
  return totalQty > 0 ? (defectQty / totalQty) * 1_000_000 : null
}

/** 납기준수율 = 납기 내 완료 ÷ 납기 도래 전체 × 100. 분모 0 이면 null. */
export function calcOnTimeRate(onTimeCount: number, dueCount: number): number | null {
  return dueCount > 0 ? (onTimeCount / dueCount) * 100 : null
}

// ─── 기간 버킷 ────────────────────────────────────────────────────────────────

export type TrendGranularity = "day" | "month"

export function bucketKey(dateKey: string, granularity: TrendGranularity): string {
  return granularity === "month" ? dateKey.slice(0, 7) : dateKey
}

/** YYYY-MM-DD 두 키의 달력일 차이 (b - a) */
export function dateKeyDiffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number)
  const [by, bm, bd] = b.split("-").map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

// ─── 생산실적 기반 집계 (UPH / PPM) ───────────────────────────────────────────

/** 시간당 생산량(UPH) KPI 기준공정의 라우팅 공정순서 (NRV: 10 = 가공(HEAD)). 공정별 표준시간이 달라 전 공정을 합산하면 의미가 없다. */
export const UPH_BASIS_OPERATION_SEQ = 10

export type ProductionFact = {
  /** ProductionResult.id — 중복 집계 방지 키 */
  id: string
  dateKey: string
  orderNo: string
  itemId: string
  itemCode: string
  itemName: string
  processId: string
  processName: string
  equipmentId: string | null
  equipmentName: string | null
  goodQty: number
  defectQty: number
  reworkQty: number
  /** 실제 작업시간(h). 시작/종료 미기록 또는 0 이하이면 null */
  hours: number | null
  /** UPH 기준공정 실적 여부. 기준공정 실적이 하나도 없으면 전체 실적을 기준으로 계산한다. */
  uphBasis?: boolean
}

export type UphGroupRow = { key: string; label: string; sub?: string; goodQty: number; hours: number; resultCount: number; uph: number | null }
export type PpmGroupRow = { key: string; label: string; sub?: string; goodQty: number; defectQty: number; totalQty: number; resultCount: number; ppm: number | null }
export type TrendPoint = { bucket: string; value: number | null; a: number; b: number }

export type ProductionKpiSummary = {
  resultCount: number
  duplicateSkipped: number
  uph: {
    value: number | null
    goodQty: number
    hours: number
    validCount: number
    /** 작업시간 미기록/0 으로 UPH 계산에서 제외된 실적 수 */
    excludedCount: number
    byItem: UphGroupRow[]
    byProcess: UphGroupRow[]
    byEquipment: UphGroupRow[]
    trend: TrendPoint[] // a=양품, b=시간
  }
  ppm: {
    value: number | null
    goodQty: number
    defectQty: number
    totalQty: number
    reworkQty: number
    byItem: PpmGroupRow[]
    byProcess: PpmGroupRow[]
    byEquipment: PpmGroupRow[]
    trend: TrendPoint[] // a=불량, b=총수량
  }
}

export function validHours(startedAt: Date | null | undefined, endedAt: Date | null | undefined): number | null {
  if (!startedAt || !endedAt) return null
  const h = (endedAt.getTime() - startedAt.getTime()) / 3_600_000
  return h > 0 ? h : null
}

const round = (v: number, d: number) => {
  const f = 10 ** d
  return Math.round(v * f) / f
}

export function summarizeProduction(rawFacts: ProductionFact[], granularity: TrendGranularity): ProductionKpiSummary {
  const seen = new Set<string>()
  const facts: ProductionFact[] = []
  for (const f of rawFacts) {
    if (seen.has(f.id)) continue
    seen.add(f.id)
    facts.push(f)
  }
  const duplicateSkipped = rawFacts.length - facts.length

  const hasBasis = facts.some((f) => f.uphBasis)
  const candidates = hasBasis ? facts.filter((f) => f.uphBasis) : facts
  const valid = candidates.filter((f) => f.hours != null)
  const uphGood = valid.reduce((s, f) => s + f.goodQty, 0)
  const uphHours = valid.reduce((s, f) => s + (f.hours ?? 0), 0)

  const defect = facts.reduce((s, f) => s + f.defectQty, 0)
  const good = facts.reduce((s, f) => s + f.goodQty, 0)
  const rework = facts.reduce((s, f) => s + f.reworkQty, 0)

  const uphGroups = (keyFn: (f: ProductionFact) => { key: string; label: string; sub?: string }): UphGroupRow[] => {
    const map = new Map<string, UphGroupRow>()
    for (const f of valid) {
      const k = keyFn(f)
      const row = map.get(k.key) ?? { ...k, goodQty: 0, hours: 0, resultCount: 0, uph: null }
      row.goodQty += f.goodQty
      row.hours += f.hours ?? 0
      row.resultCount += 1
      map.set(k.key, row)
    }
    return Array.from(map.values())
      .map((r) => ({ ...r, uph: calcUph(r.goodQty, r.hours) }))
      .sort((a, b) => b.goodQty - a.goodQty)
  }
  const ppmGroups = (keyFn: (f: ProductionFact) => { key: string; label: string; sub?: string }): PpmGroupRow[] => {
    const map = new Map<string, PpmGroupRow>()
    for (const f of facts) {
      const k = keyFn(f)
      const row = map.get(k.key) ?? { ...k, goodQty: 0, defectQty: 0, totalQty: 0, resultCount: 0, ppm: null }
      row.goodQty += f.goodQty
      row.defectQty += f.defectQty
      row.totalQty += f.goodQty + f.defectQty
      row.resultCount += 1
      map.set(k.key, row)
    }
    return Array.from(map.values())
      .map((r) => ({ ...r, ppm: calcPpm(r.defectQty, r.totalQty) }))
      .sort((a, b) => (b.ppm ?? -1) - (a.ppm ?? -1) || b.defectQty - a.defectQty)
  }

  const byItem = (f: ProductionFact) => ({ key: f.itemId, label: f.itemName, sub: f.itemCode })
  const byProcess = (f: ProductionFact) => ({ key: f.processId, label: f.processName })
  const byEquipment = (f: ProductionFact) =>
    f.equipmentId ? { key: f.equipmentId, label: f.equipmentName ?? f.equipmentId } : { key: "__none__", label: "설비 미지정" }

  const uphTrendMap = new Map<string, { a: number; b: number }>()
  for (const f of valid) {
    const k = bucketKey(f.dateKey, granularity)
    const e = uphTrendMap.get(k) ?? { a: 0, b: 0 }
    e.a += f.goodQty
    e.b += f.hours ?? 0
    uphTrendMap.set(k, e)
  }
  const ppmTrendMap = new Map<string, { a: number; b: number }>()
  for (const f of facts) {
    const k = bucketKey(f.dateKey, granularity)
    const e = ppmTrendMap.get(k) ?? { a: 0, b: 0 }
    e.a += f.defectQty
    e.b += f.goodQty + f.defectQty
    ppmTrendMap.set(k, e)
  }
  const toTrend = (m: Map<string, { a: number; b: number }>, fn: (a: number, b: number) => number | null): TrendPoint[] =>
    Array.from(m.entries())
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([bucket, v]) => ({ bucket, value: fn(v.a, v.b), a: v.a, b: v.b }))

  return {
    resultCount: facts.length,
    duplicateSkipped,
    uph: {
      value: calcUph(uphGood, uphHours),
      goodQty: uphGood,
      hours: uphHours,
      validCount: valid.length,
      excludedCount: candidates.length - valid.length,
      byItem: uphGroups(byItem),
      byProcess: uphGroups(byProcess),
      byEquipment: uphGroups(byEquipment),
      trend: toTrend(uphTrendMap, calcUph),
    },
    ppm: {
      value: calcPpm(defect, good + defect),
      goodQty: good,
      defectQty: defect,
      totalQty: good + defect,
      reworkQty: rework,
      byItem: ppmGroups(byItem),
      byProcess: ppmGroups(byProcess),
      byEquipment: ppmGroups(byEquipment),
      trend: toTrend(ppmTrendMap, calcPpm),
    },
  }
}

// ─── 납기준수율 ───────────────────────────────────────────────────────────────

export type DeliveryLineInput = {
  salesOrderItemId: string
  orderNo: string
  customerId: string
  customerName: string
  itemId: string
  itemCode: string
  itemName: string
  orderedQty: number
  /** 약속 납기일 (KST YYYY-MM-DD). 품목 납기일 우선, 없으면 수주 납기일 */
  dueKey: string
  /** 출하 이력 (SHIPPED/DELIVERED 출하의 품목 행). dateKey 는 KST 일자 */
  shipments: Array<{ id: string; dateKey: string; qty: number }>
}

export type DeliveryLineResult = DeliveryLineInput & {
  shippedQty: number
  /** 주문수량을 처음 충족한 일자. 미충족이면 null */
  completedKey: string | null
  onTime: boolean
  /** 지연 일수(0 이상). 정시 완료는 0 */
  delayDays: number
  state: "ON_TIME" | "LATE_COMPLETED" | "LATE_OPEN"
}

/**
 * 한 수주품목의 납기 준수 여부.
 * - 출하 이력을 일자순으로 누적해 주문수량을 처음 충족한 일자가 납기일 이하이면 준수.
 * - 납기 경과 후에도 미충족이면 미준수(지연일수 = 오늘 - 납기일).
 * - 납기가 아직 도래하지 않은(dueKey >= todayKey, 납기 당일 포함) 건은 null 반환(분모 제외).
 */
export function evaluateDeliveryLine(line: DeliveryLineInput, todayKey: string): DeliveryLineResult | null {
  const seen = new Set<string>()
  const ships = line.shipments
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
  let cum = 0
  let completedKey: string | null = null
  for (const s of ships) {
    cum += s.qty
    if (completedKey == null && cum >= line.orderedQty - 1e-9) completedKey = s.dateKey
  }
  const shippedQty = cum
  // 납기 도래 = 납기일이 오늘(KST) 이전. 납기 당일·이후 건은 아직 판정하지 않는다(분모 제외).
  if (line.dueKey >= todayKey) return null
  if (completedKey != null) {
    const delayDays = Math.max(0, dateKeyDiffDays(line.dueKey, completedKey))
    return { ...line, shippedQty, completedKey, onTime: delayDays === 0, delayDays, state: delayDays === 0 ? "ON_TIME" : "LATE_COMPLETED" }
  }
  return { ...line, shippedQty, completedKey: null, onTime: false, delayDays: dateKeyDiffDays(line.dueKey, todayKey), state: "LATE_OPEN" }
}

export type DeliveryGroupRow = { key: string; label: string; sub?: string; dueCount: number; onTimeCount: number; lateCount: number; rate: number | null; delayDaysSum: number }

export type DeliveryKpiSummary = {
  value: number | null
  dueCount: number
  onTimeCount: number
  lateCount: number
  lateCompletedCount: number
  lateOpenCount: number
  byCustomer: DeliveryGroupRow[]
  byItem: DeliveryGroupRow[]
  trend: TrendPoint[] // a=준수, b=도래
  /** 지연 건(미준수) 상세 — 지연일수 내림차순 */
  lateRows: DeliveryLineResult[]
  /** 전체 판정 행(검증용) — 납기일 오름차순 */
  rows: DeliveryLineResult[]
}

export function summarizeDelivery(lines: DeliveryLineInput[], todayKey: string, granularity: TrendGranularity): DeliveryKpiSummary {
  const rows = lines
    .map((l) => evaluateDeliveryLine(l, todayKey))
    .filter((r): r is DeliveryLineResult => r != null)
    .sort((a, b) => a.dueKey.localeCompare(b.dueKey) || a.orderNo.localeCompare(b.orderNo))

  const onTimeCount = rows.filter((r) => r.onTime).length
  const group = (keyFn: (r: DeliveryLineResult) => { key: string; label: string; sub?: string }): DeliveryGroupRow[] => {
    const map = new Map<string, DeliveryGroupRow>()
    for (const r of rows) {
      const k = keyFn(r)
      const g = map.get(k.key) ?? { ...k, dueCount: 0, onTimeCount: 0, lateCount: 0, rate: null, delayDaysSum: 0 }
      g.dueCount += 1
      if (r.onTime) g.onTimeCount += 1
      else {
        g.lateCount += 1
        g.delayDaysSum += r.delayDays
      }
      map.set(k.key, g)
    }
    return Array.from(map.values())
      .map((g) => ({ ...g, rate: calcOnTimeRate(g.onTimeCount, g.dueCount) }))
      .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || b.dueCount - a.dueCount)
  }

  const trendMap = new Map<string, { a: number; b: number }>()
  for (const r of rows) {
    const k = bucketKey(r.dueKey, granularity)
    const e = trendMap.get(k) ?? { a: 0, b: 0 }
    e.b += 1
    if (r.onTime) e.a += 1
    trendMap.set(k, e)
  }

  return {
    value: calcOnTimeRate(onTimeCount, rows.length),
    dueCount: rows.length,
    onTimeCount,
    lateCount: rows.length - onTimeCount,
    lateCompletedCount: rows.filter((r) => r.state === "LATE_COMPLETED").length,
    lateOpenCount: rows.filter((r) => r.state === "LATE_OPEN").length,
    byCustomer: group((r) => ({ key: r.customerId, label: r.customerName })),
    byItem: group((r) => ({ key: r.itemId, label: r.itemName, sub: r.itemCode })),
    trend: Array.from(trendMap.entries())
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([bucket, v]) => ({ bucket, value: calcOnTimeRate(v.a, v.b), a: v.a, b: v.b })),
    lateRows: rows.filter((r) => !r.onTime).sort((a, b) => b.delayDays - a.delayDays),
    rows,
  }
}

export { round as roundTo }
