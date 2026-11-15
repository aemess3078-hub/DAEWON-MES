import { calcAdjustTarget, calcCountDiff, hasDriftedSinceStart, parseCountedQty, summarizeCount } from "../src/lib/stock-count/stock-count-calc"

let passed = 0
let failed = 0
const ok = (c: boolean, m: string) => { if (c) passed++; else { failed++; console.error("FAIL:", m) } }
const eq = (a: unknown, b: unknown, m: string) => ok(a === b, `${m} (got ${String(a)}, want ${String(b)})`)

eq(calcCountDiff(100, 95), -5, "부족 차이")
eq(calcCountDiff(100, 102.5), 2.5, "초과 차이")
eq(calcCountDiff(100, 100), 0, "차이 없음")
eq(calcCountDiff(100, null), null, "미실사")
eq(calcCountDiff(0.1, 0.3), 0.2, "소수 오차 정리")

eq(calcAdjustTarget(95, 100, 100), 95, "변동 없음 → 실사수량")
eq(calcAdjustTarget(95, 100, 120), 115, "실사 중 입고 +20 보존")
eq(calcAdjustTarget(95, 100, 70), 65, "실사 중 출고 −30 보존")
eq(calcAdjustTarget(10, 100, 5), 0, "음수는 0")
ok(!hasDriftedSinceStart(100, 100), "변동 없음")
ok(hasDriftedSinceStart(100, 101), "변동 있음")

const s = summarizeCount([
  { systemQty: 100, countedQty: 95, adjustedAt: null },
  { systemQty: 50, countedQty: 55, adjustedAt: new Date() },
  { systemQty: 10, countedQty: 10, adjustedAt: null },
  { systemQty: 7, countedQty: null, adjustedAt: null },
])
eq(s.lineCount, 4, "줄 수")
eq(s.countedCount, 3, "실사 입력 수")
eq(s.uncountedCount, 1, "미실사 수")
eq(s.diffLineCount, 2, "차이 줄 수")
eq(s.plusQty, 5, "초과 합")
eq(s.minusQty, -5, "부족 합")
eq(s.adjustedCount, 1, "조정 완료")
eq(s.pendingAdjustCount, 1, "조정 대기")

eq(parseCountedQty(""), null, "빈 값")
eq(parseCountedQty(null), null, "null")
eq(parseCountedQty("1,234.5"), 1234.5, "콤마")
eq(parseCountedQty("-1"), undefined, "음수 거부")
eq(parseCountedQty("abc"), undefined, "문자 거부")
eq(parseCountedQty(0), 0, "0 허용")

console.log(`stock-count calc: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
