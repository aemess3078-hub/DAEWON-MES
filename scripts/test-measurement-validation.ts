/**
 * PR #53 "검사항목 실측값 기반 구축" code-path test.
 *
 * inspection-measurement.helpers.ts는 DB에 의존하지 않는 순수 함수라
 * ts-node로 직접 실행해 검증한다(jest/vitest 등 테스트 러너가 이 저장소에
 * 아직 없어, scripts/check-use-server-exports.ts와 동일한 방식으로 작성).
 *
 * 실행 (tsconfig.json의 module:esnext 때문에 commonjs로 오버라이드해서 실행):
 *   npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/test-measurement-validation.ts
 */
import {
  computeNumericJudgement,
  validateMeasurements,
  SpecItemForValidation,
} from "../src/lib/actions/inspection-measurement.helpers"

let passed = 0
let failed = 0

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

function assertThrows(fn: () => void, label: string) {
  try {
    fn()
    failed++
    console.error(`FAIL: ${label} (에러가 발생하지 않음)`)
  } catch {
    passed++
  }
}

// ─── computeNumericJudgement ────────────────────────────────────────────────

assertEqual(computeNumericJudgement(5, 1, 10), "PASS", "정상 범위 값은 PASS")
assertEqual(computeNumericJudgement(0.5, 1, 10), "FAIL", "LSL 미만은 FAIL")
assertEqual(computeNumericJudgement(10.1, 1, 10), "FAIL", "USL 초과는 FAIL")
assertEqual(computeNumericJudgement(1, 1, 10), "PASS", "LSL 경계값은 PASS")
assertEqual(computeNumericJudgement(10, 1, 10), "PASS", "USL 경계값은 PASS")
assertEqual(computeNumericJudgement(-1000, null, 10), "PASS", "LSL 없음(상한만) — 하한 이탈 판단 안 함")
assertEqual(computeNumericJudgement(11, null, 10), "FAIL", "LSL 없음(상한만) — 상한 초과는 FAIL")
assertEqual(computeNumericJudgement(-5, 1, null), "FAIL", "USL 없음(하한만) — 하한 미만은 FAIL")
assertEqual(computeNumericJudgement(100000, 1, null), "PASS", "USL 없음(하한만) — 상한 이탈 판단 안 함")
assertEqual(computeNumericJudgement(0, null, null), "PASS", "규격 없음 — 항상 PASS")

// ─── validateMeasurements ───────────────────────────────────────────────────

const numericItem: SpecItemForValidation = {
  id: "item-numeric",
  name: "두께",
  inputType: "NUMERIC",
  lowerLimit: 1,
  upperLimit: 10,
  unit: "mm",
}
const textItem: SpecItemForValidation = {
  id: "item-text",
  name: "색상",
  inputType: "TEXT",
  lowerLimit: null,
  upperLimit: null,
  unit: null,
}
const boolItem: SpecItemForValidation = {
  id: "item-bool",
  name: "외관",
  inputType: "BOOLEAN",
  lowerLimit: null,
  upperLimit: null,
  unit: null,
}
const oneSidedUpperItem: SpecItemForValidation = {
  id: "item-usl-only",
  name: "불순물",
  inputType: "NUMERIC",
  lowerLimit: null,
  upperLimit: 5,
  unit: "%",
}
const preciseUslItem: SpecItemForValidation = {
  id: "item-precise-usl",
  name: "정밀도검사",
  inputType: "NUMERIC",
  lowerLimit: 1,
  upperLimit: 1,
  unit: "mm",
}
const specItems = [numericItem, textItem, boolItem, oneSidedUpperItem, preciseUslItem]

// NUMERIC 정상
{
  const result = validateMeasurements(
    [{ inspectionItemId: "item-numeric", numericValue: 5 }],
    specItems
  )
  assertEqual(result.length, 1, "NUMERIC 정상 — 1건 생성")
  assertEqual(result[0].judgement, "PASS", "NUMERIC 정상 — PASS")
  assertEqual(result[0].sampleNo, 1, "NUMERIC 정상 — sampleNo 기본값 1")
  assertEqual(result[0].unitSnapshot, "mm", "NUMERIC 정상 — unitSnapshot 스냅샷")
}

// NUMERIC LSL 미만 FAIL
{
  const result = validateMeasurements(
    [{ inspectionItemId: "item-numeric", numericValue: 0.5 }],
    specItems
  )
  assertEqual(result[0].judgement, "FAIL", "NUMERIC LSL 미만 — FAIL")
}

// NUMERIC USL 초과 FAIL
{
  const result = validateMeasurements(
    [{ inspectionItemId: "item-numeric", numericValue: 10.5 }],
    specItems
  )
  assertEqual(result[0].judgement, "FAIL", "NUMERIC USL 초과 — FAIL")
}

// P1: 소수점 6자리는 허용
{
  const result = validateMeasurements(
    [{ inspectionItemId: "item-numeric", numericValue: 1.123456 }],
    specItems
  )
  assertEqual(result.length, 1, "P1. 소수점 6자리(1.123456) 허용")
  assertEqual(result[0].numericValue, 1.123456, "P1. 값 그대로 저장")
}

// P2: 소수점 7자리는 차단
assertThrows(
  () => validateMeasurements([{ inspectionItemId: "item-numeric", numericValue: 1.1234567 }], specItems),
  "P2. 소수점 7자리(1.1234567) 차단"
)

// P3: USL=1.000000, 입력=1.0000004(소수점 7자리) → 저장 전 차단되어 판정/저장값 모순 방지
assertThrows(
  () => validateMeasurements([{ inspectionItemId: "item-precise-usl", numericValue: 1.0000004 }], specItems),
  "P3. USL 경계 근접 + 정밀도 초과 값은 판정 이전에 차단"
)

// P4: LSL/USL 경계와 정확히 동일한 값(정밀도 이내) → PASS
{
  const result = validateMeasurements(
    [{ inspectionItemId: "item-precise-usl", numericValue: 1 }],
    specItems
  )
  assertEqual(result[0].judgement, "PASS", "P4. LSL=USL=1 경계와 정확히 동일한 값은 PASS")
}

// 편측 규격(USL only)
{
  const passResult = validateMeasurements(
    [{ inspectionItemId: "item-usl-only", numericValue: -1000 }],
    specItems
  )
  assertEqual(passResult[0].judgement, "PASS", "편측 규격(USL only) — 하한 이탈 판단 안 함, PASS")

  const failResult = validateMeasurements(
    [{ inspectionItemId: "item-usl-only", numericValue: 5.1 }],
    specItems
  )
  assertEqual(failResult[0].judgement, "FAIL", "편측 규격(USL only) — 상한 초과 FAIL")
}

// TEXT
{
  const result = validateMeasurements(
    [{ inspectionItemId: "item-text", textValue: "빨강" }],
    specItems
  )
  assertEqual(result[0].textValue, "빨강", "TEXT 값 저장")
  assertEqual(result[0].judgement, null, "TEXT는 judgement 없음")
}

// BOOLEAN
{
  const result = validateMeasurements(
    [{ inspectionItemId: "item-bool", booleanValue: true }],
    specItems
  )
  assertEqual(result[0].booleanValue, true, "BOOLEAN 값 저장")
  assertEqual(result[0].judgement, null, "BOOLEAN은 judgement 없음(이번 PR 범위)")
}

// sampleNo 1/2/3
{
  const result = validateMeasurements(
    [
      { inspectionItemId: "item-numeric", sampleNo: 1, numericValue: 5 },
      { inspectionItemId: "item-numeric", sampleNo: 2, numericValue: 6 },
      { inspectionItemId: "item-numeric", sampleNo: 3, numericValue: 7 },
    ],
    specItems
  )
  assertEqual(result.map((r) => r.sampleNo), [1, 2, 3], "sampleNo 1/2/3 모두 생성")
}

// duplicate sampleNo 차단
assertThrows(
  () =>
    validateMeasurements(
      [
        { inspectionItemId: "item-numeric", sampleNo: 1, numericValue: 5 },
        { inspectionItemId: "item-numeric", sampleNo: 1, numericValue: 6 },
      ],
      specItems
    ),
  "동일 항목 duplicate sampleNo 차단"
)

// 다른 spec의 inspectionItem 주입 차단
assertThrows(
  () => validateMeasurements([{ inspectionItemId: "not-in-spec", numericValue: 5 }], specItems),
  "spec에 속하지 않는 inspectionItemId 차단"
)

// null/비수치값 제외 (빈 값 skip)
{
  const result = validateMeasurements(
    [
      { inspectionItemId: "item-numeric", numericValue: null },
      { inspectionItemId: "item-text", textValue: "" },
      { inspectionItemId: "item-bool", booleanValue: null },
    ],
    specItems
  )
  assertEqual(result.length, 0, "값이 전부 비어있는 행은 모두 제외")
}

// inputType 불일치 값 주입 차단 (NUMERIC 항목에 textValue)
assertThrows(
  () => validateMeasurements([{ inspectionItemId: "item-numeric", textValue: "5" }], specItems),
  "NUMERIC 항목에 textValue 입력 시 차단"
)

// 서로 다른 값 유형 동시 입력 차단
assertThrows(
  () =>
    validateMeasurements(
      [{ inspectionItemId: "item-numeric", numericValue: 5, textValue: "5" }],
      specItems
    ),
  "동일 측정행에 numericValue+textValue 동시 입력 차단"
)

// sampleNo 0/음수 차단
assertThrows(
  () => validateMeasurements([{ inspectionItemId: "item-numeric", sampleNo: 0, numericValue: 5 }], specItems),
  "sampleNo 0 차단"
)

// M4/M5/M6: NUMERIC finite validation (NaN/Infinity/-Infinity 차단)
assertThrows(
  () => validateMeasurements([{ inspectionItemId: "item-numeric", numericValue: NaN }], specItems),
  "M4. NUMERIC NaN 차단"
)
assertThrows(
  () => validateMeasurements([{ inspectionItemId: "item-numeric", numericValue: Infinity }], specItems),
  "M5. NUMERIC Infinity 차단"
)
assertThrows(
  () => validateMeasurements([{ inspectionItemId: "item-numeric", numericValue: -Infinity }], specItems),
  "M6. NUMERIC -Infinity 차단"
)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
