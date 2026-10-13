/**
 * SPC(통계적 공정관리) 순수 계산 모듈. DB/React에 의존하지 않는다 —
 * 입력은 항상 InspectionMeasurement.numericValue와 그 시점의
 * lowerLimitSnapshot/upperLimitSnapshot이며(spc.actions.ts에서 채워 전달),
 * 이 파일은 계산만 담당한다. code-path 테스트는 scripts/test-spc-calculations.ts.
 */

export const CONTROL_CHART_TYPES = ["I_MR"] as const
export type ControlChartType = (typeof CONTROL_CHART_TYPES)[number]

// I chart(개별값) 상수: CL±2.66*MRbar (d2=1.128 기준 관례상수)
const I_CHART_CONSTANT = 2.66
// MR chart(이동범위, n=2) UCL 상수: D4=3.267, LCL은 0(D3=0)
const MR_CHART_UCL_CONSTANT = 3.267

const CAPABILITY_MIN_N = 30

// ─── 기초 통계 ─────────────────────────────────────────────────────────────

export function mean(values: number[]): number {
  if (values.length === 0) return NaN
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** 표본표준편차(n-1). 모집단 표준편차는 사용하지 않는다. */
export function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return NaN
  const m = mean(values)
  const sumSq = values.reduce((sum, v) => sum + (v - m) ** 2, 0)
  return Math.sqrt(sumSq / (values.length - 1))
}

/** MR_i = |X_i - X_(i-1)|, i = 2..n → 길이 n-1. */
export function movingRanges(values: number[]): number[] {
  if (values.length < 2) return []
  const ranges: number[] = []
  for (let i = 1; i < values.length; i++) {
    ranges.push(Math.abs(values[i] - values[i - 1]))
  }
  return ranges
}

// ─── I-MR 관리도 ────────────────────────────────────────────────────────────

export type IMRPoint = { index: number; value: number; outOfControl: boolean }

export type IMRResult =
  | { status: "INSUFFICIENT_DATA"; n: number }
  | {
      status: "OK"
      n: number
      xbar: number
      mrbar: number
      iChart: { cl: number; ucl: number; lcl: number; points: IMRPoint[] }
      mrChart: { cl: number; ucl: number; lcl: number; points: IMRPoint[] }
    }

/**
 * Individuals - Moving Range 관리도.
 * I chart: CL=Xbar, UCL/LCL=Xbar±2.66*MRbar
 * MR chart: CL=MRbar, UCL=3.267*MRbar, LCL=0
 * 최소 2개 측정값(MR 1개 이상)이 없으면 INSUFFICIENT_DATA.
 */
export function calculateIMRLimits(values: number[]): IMRResult {
  if (values.length < 2) {
    return { status: "INSUFFICIENT_DATA", n: values.length }
  }

  const xbar = mean(values)
  const ranges = movingRanges(values)
  const mrbar = mean(ranges)

  const iUcl = xbar + I_CHART_CONSTANT * mrbar
  const iLcl = xbar - I_CHART_CONSTANT * mrbar
  const mrUcl = MR_CHART_UCL_CONSTANT * mrbar
  const mrLcl = 0

  const iPoints: IMRPoint[] = values.map((v, i) => ({
    index: i,
    value: v,
    outOfControl: v > iUcl || v < iLcl,
  }))
  const mrPoints: IMRPoint[] = ranges.map((v, i) => ({
    index: i + 1, // MR_2 부터 존재하므로 개별값 index와 맞춰 1부터 표시
    value: v,
    outOfControl: v > mrUcl || v < mrLcl,
  }))

  return {
    status: "OK",
    n: values.length,
    xbar,
    mrbar,
    iChart: { cl: xbar, ucl: iUcl, lcl: iLcl, points: iPoints },
    mrChart: { cl: mrbar, ucl: mrUcl, lcl: mrLcl, points: mrPoints },
  }
}

// ─── 공정능력 Cp/Cpk ─────────────────────────────────────────────────────────

export type ProcessCapabilityResult =
  | { status: "DATA_INSUFFICIENT"; n: number }
  | { status: "NO_SPEC_LIMIT"; n: number; mean: number; stdDev: number }
  | { status: "ZERO_VARIANCE"; n: number; mean: number; stdDev: number }
  | {
      status: "OK"
      n: number
      mean: number
      stdDev: number
      cp: number | null
      cpk: number | null
      cpu: number | null
      cpl: number | null
    }

/**
 * 표본표준편차(n-1) 기준 Cp/Cpk. N<30이면 DATA_INSUFFICIENT.
 * 편측 규격만 있으면 그 방향의 지수만 계산하고 Cp/Cpk는 임의로 만들지 않는다.
 */
export function calculateProcessCapability(
  values: number[],
  lsl: number | null,
  usl: number | null
): ProcessCapabilityResult {
  const n = values.length
  if (n < CAPABILITY_MIN_N) {
    return { status: "DATA_INSUFFICIENT", n }
  }

  const m = mean(values)
  const s = sampleStandardDeviation(values)

  if (lsl == null && usl == null) {
    return { status: "NO_SPEC_LIMIT", n, mean: m, stdDev: s }
  }

  if (s === 0) {
    return { status: "ZERO_VARIANCE", n, mean: m, stdDev: s }
  }

  const cpu = usl != null ? (usl - m) / (3 * s) : null
  const cpl = lsl != null ? (m - lsl) / (3 * s) : null

  if (lsl != null && usl != null) {
    const cp = (usl - lsl) / (6 * s)
    const cpk = Math.min(cpu as number, cpl as number)
    return { status: "OK", n, mean: m, stdDev: s, cp, cpk, cpu, cpl }
  }

  // 편측 규격: Cp/Cpk는 산출하지 않는다(임의 생성 금지).
  return { status: "OK", n, mean: m, stdDev: s, cp: null, cpk: null, cpu, cpl }
}

// ─── Histogram ──────────────────────────────────────────────────────────────

export type HistogramBin = { binStart: number; binEnd: number; count: number }

const HISTOGRAM_MIN_BINS = 1
const HISTOGRAM_MAX_BINS = 30

/** Sturges' rule(ceil(log2(n)+1))로 deterministic한 bin 수를 정한다. */
function sturgesBinCount(n: number): number {
  if (n <= 1) return 1
  const k = Math.ceil(Math.log2(n) + 1)
  return Math.min(HISTOGRAM_MAX_BINS, Math.max(HISTOGRAM_MIN_BINS, k))
}

export function buildHistogram(values: number[]): HistogramBin[] {
  if (values.length === 0) return []

  const min = Math.min(...values)
  const max = Math.max(...values)

  // 모든 값이 동일(zero-range)하면 bin 1개로 표시.
  if (max === min) {
    return [{ binStart: min, binEnd: max, count: values.length }]
  }

  const binCount = sturgesBinCount(values.length)
  const width = (max - min) / binCount
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    binStart: min + i * width,
    binEnd: min + (i + 1) * width,
    count: 0,
  }))

  for (const v of values) {
    // 최댓값은 마지막 bin에 포함(반열림 구간 [start, end), 마지막만 닫힘).
    const idx = v === max ? binCount - 1 : Math.floor((v - min) / width)
    bins[Math.min(binCount - 1, Math.max(0, idx))].count += 1
  }

  return bins
}

// ─── 규격 이탈 판정(참고용) ───────────────────────────────────────────────────

/** LSL/USL(spec limit) 기준 이탈 여부. control limit(UCL/LCL)과 혼동하지 않는다. */
export function calculateSpecViolation(
  value: number,
  lsl: number | null,
  usl: number | null
): boolean {
  if (lsl != null && value < lsl) return true
  if (usl != null && value > usl) return true
  return false
}
