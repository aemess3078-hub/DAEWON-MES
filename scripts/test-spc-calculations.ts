/**
 * PR #54 "SPC 통계분석" code-path test.
 *
 * spc-calculations.ts는 DB에 의존하지 않는 순수 함수라 ts-node로 직접
 * 실행해 검증한다(scripts/test-measurement-validation.ts와 동일 방식).
 *
 * 실행:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/test-spc-calculations.ts
 */
import {
  mean,
  sampleStandardDeviation,
  movingRanges,
  calculateIMRLimits,
  calculateProcessCapability,
  buildHistogram,
  calculateSpecViolation,
} from "../src/lib/spc-calculations"
import {
  kstDateKeyToUtcStart,
  kstDateKeyToUtcEnd,
  isValidKstDateKey,
  isValidKstDateRange,
  kstDefaultDateRange,
} from "../src/lib/date/kst"

let passed = 0
let failed = 0
const EPS = 1e-9

function assertEqual<T>(actual: T, expected: T, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  }
}

function assertApprox(actual: number, expected: number, label: string, eps = EPS) {
  const ok = Math.abs(actual - expected) <= eps
  if (ok) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
    console.error(`  expected: ${expected}`)
    console.error(`  actual:   ${actual}`)
  }
}

function assertTrue(cond: boolean, label: string) {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

// ─── T1: mean ───────────────────────────────────────────────────────────────
assertApprox(mean([1, 2, 3, 4, 5]), 3, "T1. mean([1,2,3,4,5]) = 3")

// ─── T2: sample standard deviation (n-1) ────────────────────────────────────
// [2,4,6] → mean=4, sumSq=(2-4)^2+(4-4)^2+(6-4)^2=8, n-1=2, variance=4, stdev=2
assertApprox(sampleStandardDeviation([2, 4, 6]), 2, "T2. sampleStandardDeviation는 n-1 사용")

// ─── 30개 대칭 데이터셋 (T5~T9, T19에서 재사용) ─────────────────────────────
// mean=10, 값은 9/11 교대 15개씩 → 표본표준편차는 T2와 동일한 n-1 방식으로 계산
const symmetric30: number[] = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 11 : 9))
const symmetricMean = mean(symmetric30)
const symmetricStd = sampleStandardDeviation(symmetric30)

// ─── T3: N<30 → DATA_INSUFFICIENT ───────────────────────────────────────────
{
  const result = calculateProcessCapability(symmetric30.slice(0, 29), 7, 13)
  assertEqual(result.status, "DATA_INSUFFICIENT", "T3. N<30이면 DATA_INSUFFICIENT")
  assertEqual((result as { n: number }).n, 29, "T3. DATA_INSUFFICIENT n 값")
}

// ─── T4: 분산=0 → ZERO_VARIANCE ─────────────────────────────────────────────
{
  const allSame = Array.from({ length: 30 }, () => 5)
  const result = calculateProcessCapability(allSame, 1, 10)
  assertEqual(result.status, "ZERO_VARIANCE", "T4. 표준편차 0이면 ZERO_VARIANCE")
}

// ─── T5: 양측 Cp ────────────────────────────────────────────────────────────
{
  const result = calculateProcessCapability(symmetric30, 7, 13)
  assertEqual(result.status, "OK", "T5. 양측 규격 + N>=30 → OK")
  if (result.status === "OK") {
    const expectedCp = (13 - 7) / (6 * symmetricStd)
    assertApprox(result.cp as number, expectedCp, "T5. Cp = (USL-LSL)/(6s)")
  }
}

// ─── T6: 양측 Cpk ───────────────────────────────────────────────────────────
{
  const result = calculateProcessCapability(symmetric30, 7, 13)
  if (result.status === "OK") {
    const expectedCpu = (13 - symmetricMean) / (3 * symmetricStd)
    const expectedCpl = (symmetricMean - 7) / (3 * symmetricStd)
    assertApprox(result.cpu as number, expectedCpu, "T6. Cpu = (USL-mean)/(3s)")
    assertApprox(result.cpl as number, expectedCpl, "T6. Cpl = (mean-LSL)/(3s)")
    assertApprox(result.cpk as number, Math.min(expectedCpu, expectedCpl), "T6. Cpk = min(Cpu, Cpl)")
  } else {
    failed++
    console.error("FAIL: T6. 양측 규격인데 OK 상태가 아님")
  }
}

// ─── T7: USL만 존재 → Cpu만, Cp/Cpk는 생성하지 않음 ─────────────────────────
{
  const result = calculateProcessCapability(symmetric30, null, 13)
  assertEqual(result.status, "OK", "T7. USL만 있어도 OK")
  if (result.status === "OK") {
    const expectedCpu = (13 - symmetricMean) / (3 * symmetricStd)
    assertApprox(result.cpu as number, expectedCpu, "T7. Cpu 계산")
    assertEqual(result.cp, null, "T7. Cp는 null(임의 생성 금지)")
    assertEqual(result.cpk, null, "T7. Cpk는 null(임의 생성 금지)")
    assertEqual(result.cpl, null, "T7. Cpl은 null(LSL 없음)")
  }
}

// ─── T8: LSL만 존재 → Cpl만, Cp/Cpk는 생성하지 않음 ─────────────────────────
{
  const result = calculateProcessCapability(symmetric30, 7, null)
  assertEqual(result.status, "OK", "T8. LSL만 있어도 OK")
  if (result.status === "OK") {
    const expectedCpl = (symmetricMean - 7) / (3 * symmetricStd)
    assertApprox(result.cpl as number, expectedCpl, "T8. Cpl 계산")
    assertEqual(result.cp, null, "T8. Cp는 null(임의 생성 금지)")
    assertEqual(result.cpk, null, "T8. Cpk는 null(임의 생성 금지)")
    assertEqual(result.cpu, null, "T8. Cpu는 null(USL 없음)")
  }
}

// ─── T9: 규격 전혀 없음 → NO_SPEC_LIMIT ─────────────────────────────────────
{
  const result = calculateProcessCapability(symmetric30, null, null)
  assertEqual(result.status, "NO_SPEC_LIMIT", "T9. LSL/USL 모두 없으면 NO_SPEC_LIMIT")
}

// ─── T10: moving range ──────────────────────────────────────────────────────
assertEqual(movingRanges([10, 12, 9, 15]), [2, 3, 6], "T10. MR_i = |X_i - X_(i-1)|")

// ─── I-MR용 데이터셋 (T11, T12) ─────────────────────────────────────────────
const imrValues = [10, 12, 9, 15, 11]
const imrXbar = mean(imrValues)
const imrRanges = movingRanges(imrValues)
const imrMrbar = mean(imrRanges)

// ─── T11: I chart CL/UCL/LCL ────────────────────────────────────────────────
{
  const result = calculateIMRLimits(imrValues)
  assertEqual(result.status, "OK", "T11. 5개 값이면 계산 가능")
  if (result.status === "OK") {
    assertApprox(result.xbar, imrXbar, "T11. I chart CL = Xbar")
    assertApprox(result.iChart.cl, imrXbar, "T11. I chart CL")
    assertApprox(result.iChart.ucl, imrXbar + 2.66 * imrMrbar, "T11. I chart UCL = Xbar+2.66*MRbar")
    assertApprox(result.iChart.lcl, imrXbar - 2.66 * imrMrbar, "T11. I chart LCL = Xbar-2.66*MRbar")
    assertEqual(result.iChart.points.length, imrValues.length, "T11. I chart point 개수 = 측정값 개수")
  }
}

// ─── T12: MR chart CL/UCL/LCL ───────────────────────────────────────────────
{
  const result = calculateIMRLimits(imrValues)
  if (result.status === "OK") {
    assertApprox(result.mrbar, imrMrbar, "T12. MR chart CL = MRbar")
    assertApprox(result.mrChart.cl, imrMrbar, "T12. MR chart CL")
    assertApprox(result.mrChart.ucl, 3.267 * imrMrbar, "T12. MR chart UCL = 3.267*MRbar")
    assertEqual(result.mrChart.lcl, 0, "T12. MR chart LCL = 0")
    assertEqual(result.mrChart.points.length, imrValues.length - 1, "T12. MR chart point 개수 = n-1")
  } else {
    failed++
    console.error("FAIL: T12. OK 상태가 아님")
  }
}

// ─── T13: 측정값 1개(또는 0개) → I-MR 계산 불가 ─────────────────────────────
assertEqual(calculateIMRLimits([5]).status, "INSUFFICIENT_DATA", "T13. 측정값 1개는 INSUFFICIENT_DATA")
assertEqual(calculateIMRLimits([]).status, "INSUFFICIENT_DATA", "T13. 측정값 0개도 INSUFFICIENT_DATA")

// ─── T14: histogram 정상 ────────────────────────────────────────────────────
{
  const values = [1, 2, 3, 4, 5, 6, 7, 8]
  const bins = buildHistogram(values)
  // Sturges: ceil(log2(8)+1) = ceil(4) = 4
  assertEqual(bins.length, 4, "T14. Sturges rule로 결정적 bin 수 산출")
  const totalCount = bins.reduce((s, b) => s + b.count, 0)
  assertEqual(totalCount, values.length, "T14. bin count 합 = 전체 측정값 개수")
  assertApprox(bins[0].binStart, Math.min(...values), "T14. 첫 bin 시작 = 최솟값")
  assertApprox(bins[bins.length - 1].binEnd, Math.max(...values), "T14. 마지막 bin 끝 = 최댓값")
}

// ─── T15: histogram 동일값(zero-range) ──────────────────────────────────────
{
  const bins = buildHistogram([5, 5, 5, 5])
  assertEqual(bins, [{ binStart: 5, binEnd: 5, count: 4 }], "T15. 모든 값이 동일하면 bin 1개, 오류 없음")
}

// ─── T16~T18: spec violation ────────────────────────────────────────────────
assertTrue(calculateSpecViolation(10, 5, 15) === false, "T16. 규격 내 값은 PASS(violation=false)")
assertTrue(calculateSpecViolation(3, 5, 15) === true, "T17. LSL 미만은 violation")
assertTrue(calculateSpecViolation(20, 5, 15) === true, "T18. USL 초과는 violation")

// ─── T19: outlier를 제거하지 않음 ────────────────────────────────────────────
{
  const withOutlier = [...symmetric30.slice(0, 29), 1000]
  const capability = calculateProcessCapability(withOutlier, 7, 13)
  assertEqual(capability.n, 30, "T19. outlier 포함해도 n은 그대로(자동 제거 없음)")
  assertTrue(
    Math.abs((capability as { mean: number }).mean - symmetricMean) > 1,
    "T19. outlier가 mean 계산에 실제로 반영됨(제거되지 않음)"
  )

  const imr = calculateIMRLimits([10, 12, 9, 15, 1000])
  if (imr.status === "OK") {
    assertEqual(imr.iChart.points.length, 5, "T19. I-MR도 outlier 포함 전체 point 반환")
    assertTrue(
      imr.iChart.points[4].outOfControl === true,
      "T19. outlier point는 outOfControl=true로 '표시'만 되고 제거되지 않음"
    )
  } else {
    failed++
    console.error("FAIL: T19. I-MR outlier 케이스가 OK 상태가 아님")
  }
}

// ─── T20: ordering에 따라 MR이 결정됨(내부에서 재정렬하지 않음) ─────────────
assertEqual(movingRanges([1, 2, 3]), [1, 1], "T20. 정렬된 순서의 MR")
assertEqual(movingRanges([3, 1, 2]), [2, 1], "T20. 다른 순서면 MR도 달라짐(내부 재정렬 없음)")

// ─── D1~D6: KST 날짜 경계 helper (src/lib/date/kst.ts) ──────────────────────
// PR #54 리뷰 BLOCKER: Vercel 서버가 UTC라 오프셋 없이 "YYYY-MM-DDT00:00:00.000"을
// 파싱하면 KST 대비 9시간 어긋난다 — 반드시 +09:00 명시 변환을 거쳐야 한다.

// D1: KST 달력일 시작 → UTC instant (2026-09-02 00:00 KST = 2026-09-01 15:00 UTC)
assertEqual(
  kstDateKeyToUtcStart("2026-09-02").toISOString(),
  "2026-09-01T15:00:00.000Z",
  "D1. KST 00:00:00.000 시작 경계 → UTC 변환"
)

// D2: KST 달력일 종료 → UTC instant (2026-09-02 23:59:59.999 KST = 2026-09-02 14:59:59.999 UTC)
assertEqual(
  kstDateKeyToUtcEnd("2026-09-02").toISOString(),
  "2026-09-02T14:59:59.999Z",
  "D2. KST 23:59:59.999 종료 경계 → UTC 변환"
)

// D3: process/Node의 local timezone과 무관하게 항상 동일한 결과여야 한다.
// 문자열에 +09:00을 명시해 파싱하므로 process.env.TZ를 바꿔도 결과가 흔들리면 안 된다.
{
  const originalTz = process.env.TZ
  const before = kstDateKeyToUtcStart("2026-09-02").getTime()
  process.env.TZ = "America/Los_Angeles"
  const afterLA = kstDateKeyToUtcStart("2026-09-02").getTime()
  process.env.TZ = "UTC"
  const afterUTC = kstDateKeyToUtcStart("2026-09-02").getTime()
  process.env.TZ = originalTz
  assertEqual(afterLA, before, "D3. TZ=America/Los_Angeles여도 동일 instant")
  assertEqual(afterUTC, before, "D3. TZ=UTC여도 동일 instant")

  // 자정 부근 경계값으로 KST 변환이 실제로 날짜를 넘기는지도 함께 확인한다
  // (버그가 있었다면 이 경계에서 하루가 밀렸을 것).
  const justBeforeMidnightKst = new Date("2026-09-02T14:30:00.000Z") // KST 23:30, 여전히 9/2
  const justAfterMidnightKst = new Date("2026-09-02T15:30:00.000Z") // KST 00:30, 이미 9/3
  assertEqual(justBeforeMidnightKst.getTime() < kstDateKeyToUtcEnd("2026-09-02").getTime(), true, "D3. KST 23:30은 9/2 종료 경계 이전")
  assertEqual(justAfterMidnightKst.getTime() > kstDateKeyToUtcEnd("2026-09-02").getTime(), true, "D3. KST 00:30(익일)은 9/2 종료 경계 이후")
}

// D4: 잘못된 형식/존재하지 않는 날짜 차단
assertEqual(isValidKstDateKey("2026-09-02"), true, "D4. 정상 날짜는 유효")
assertEqual(isValidKstDateKey("2026-02-30"), false, "D4. 2월 30일처럼 실재하지 않는 날짜 차단")
assertEqual(isValidKstDateKey("2026-13-01"), false, "D4. 13월처럼 잘못된 월 차단")
assertEqual(isValidKstDateKey("2026/09/02"), false, "D4. 형식이 다르면 차단")
assertEqual(isValidKstDateKey("not-a-date"), false, "D4. 날짜가 아닌 문자열 차단")

// D5: from > to 차단
assertEqual(isValidKstDateRange("2026-09-01", "2026-09-02"), true, "D5. from<=to는 허용")
assertEqual(isValidKstDateRange("2026-09-02", "2026-09-02"), true, "D5. from===to는 허용")
assertEqual(isValidKstDateRange("2026-09-02", "2026-09-01"), false, "D5. from>to는 차단")
assertEqual(isValidKstDateRange("bad-date", "2026-09-02"), false, "D5. 형식이 잘못되면 range 자체가 무효")

// D6: KST 기준 기본 조회기간(최근 N일) 계산
{
  // 2026-09-02 12:00 KST(=2026-09-02T03:00:00Z)에 조회 → 오늘 9/2, 30일 전 8/3
  const result = kstDefaultDateRange(30, new Date("2026-09-02T03:00:00.000Z"))
  assertEqual(result, { from: "2026-08-03", to: "2026-09-02" }, "D6. 30일 전 KST 달력일 계산")

  // 2026-09-02T15:30:00Z는 이미 KST로 9/3 00:30 — 기준일(to)이 하루 밀리지 않고 정확히 9/3이어야 한다
  const rollover = kstDefaultDateRange(30, new Date("2026-09-02T15:30:00.000Z"))
  assertEqual(rollover.to, "2026-09-03", "D6. UTC 자정 이전이어도 KST로는 다음날이면 to가 넘어감")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
