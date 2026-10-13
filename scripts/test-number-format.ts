/**
 * 숫자/통화 표시 공통 기반(formatQuantity/formatCurrency/parseFormattedNumber,
 * QuantityInput의 sanitize/format 로직) code-path test.
 *
 * DB에 의존하지 않는 순수 함수만 검증한다(scripts/test-spc-calculations.ts와
 * 동일 방식). React 컴포넌트(quantity-input.tsx) 자체는 "use client"라
 * ts-node로 직접 실행할 수 없으므로, 그 안의 순수 로직을 분리해 둔
 * quantity-input.helpers.ts를 대신 테스트한다.
 *
 * 실행:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/test-number-format.ts
 */
import { formatQuantity, formatCurrency, formatAmountWithCurrency, parseFormattedNumber } from "../src/lib/utils"
import {
  sanitizeTypedValue,
  formatLiveDisplay,
  toEditableDisplay,
} from "../src/components/ui/quantity-input.helpers"

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

/** sanitizeTypedValue + formatLiveDisplay를 한 번에 태워 "타이핑 중" 표시값을 재현한다. */
function typedDisplay(raw: string, opts: { allowNegative: boolean; maxDecimals: number }): string {
  return formatLiveDisplay(sanitizeTypedValue(raw, opts))
}

// ─── formatQuantity: 기본 케이스 ────────────────────────────────────────────
assertEqual(formatQuantity(0), "0", "Q1. 0 -> 0")
assertEqual(formatQuantity(1000), "1,000", "Q2. 1000 -> 1,000")
assertEqual(formatQuantity(1250000), "1,250,000", "Q3. 1250000 -> 1,250,000")
assertEqual(formatQuantity(12345.67), "12,345.67", "Q4. 12345.67 -> 12,345.67")
assertEqual(formatQuantity(1234.123456), "1,234.123456", "Q5. 1234.123456 -> 1,234.123456 (6자리 보존)")
assertEqual(formatQuantity(-1234.5), "-1,234.5", "Q6. -1234.5 -> -1,234.5")
assertEqual(formatQuantity(null), "-", "Q7. null -> -")
assertEqual(formatQuantity(undefined), "-", "Q8. undefined -> -")

// ─── formatQuantity: trailing zero / 정밀도 절사(반올림 아님) 정책 ─────────
assertEqual(formatQuantity("1234.500000"), "1,234.5", "Q9. trailing zero 제거")
assertEqual(formatQuantity("1234.000000"), "1,234", "Q10. 소수부 전부 0이면 소수점 자체 제거")
assertEqual(
  formatQuantity("1234.1234567"),
  "1,234.123456",
  "Q11. 7자리째는 반올림하지 않고 그대로 절사(6자리까지만)"
)
assertEqual(
  formatQuantity("1234.123456"),
  "1,234.123456",
  "Q12. 문자열(Decimal 직렬화) 입력도 number 변환 없이 정확히 처리"
)
assertEqual(formatQuantity("20260001", { maxDecimals: 0 }), "20,260,001", "Q13. 코드 자체는 identifier 여부를 모른다(호출부 책임) — 참고용")

// ─── formatCurrency ─────────────────────────────────────────────────────────
assertEqual(formatCurrency(1250000), "1,250,000원", "C1. 기본 suffix")
assertEqual(formatCurrency(1000000, { display: "plain" }), "1,000,000", "C2. plain은 접미사 없음")
assertEqual(formatCurrency(null), "-", "C3. null -> -")
assertEqual(formatCurrency(1234.99), "1,234원", "C4. KRW는 정수 표시 — 소수부는 반올림 없이 절사(1234.99 -> 1,234원, 1,235원 아님)")

// ─── formatAmountWithCurrency (sales/project 등 다통화 화면 공용) ───────────
assertEqual(formatAmountWithCurrency(1250000, "KRW"), "1,250,000원", "A1. KRW -> 원 접미사")
assertEqual(formatAmountWithCurrency(1250.5, "USD"), "1,250.5 USD", "A2. 외화는 코드 유지, 원 접미사 없음")
assertEqual(formatAmountWithCurrency(1250.567, "USD", { maxDecimals: 2 }), "1,250.56 USD", "A3. maxDecimals 옵션 전달 시 그 자리까지만(반올림 없이 절사)")
assertEqual(formatAmountWithCurrency(null, "KRW"), "-", "A4. null(KRW) -> -")
assertEqual(formatAmountWithCurrency(null, "USD"), "-", "A5. null(외화) -> -")
assertEqual(formatAmountWithCurrency("20260001", "KRW"), "20,260,001원", "A6. identifier 판별은 하지 않음(호출부 책임) — 참고용")

// ─── parseFormattedNumber ───────────────────────────────────────────────────
assertEqual(parseFormattedNumber("1,234,567"), 1234567, "P1. 콤마 제거 후 정수 파싱")
assertEqual(parseFormattedNumber("1,234.123456"), 1234.123456, "P2. 소수 6자리 파싱")
assertEqual(parseFormattedNumber("-1,234.5"), -1234.5, "P3. 음수 파싱")
assertEqual(parseFormattedNumber(""), undefined, "P4. 빈 문자열 -> undefined(예외 아님)")
assertEqual(parseFormattedNumber("abc"), undefined, "P5. 숫자가 아니면 undefined")
assertEqual(parseFormattedNumber(null), undefined, "P6. null -> undefined")
assertEqual(parseFormattedNumber(undefined), undefined, "P7. undefined -> undefined")

// ─── QuantityInput 타이핑 중 표시(sanitize + live format) ───────────────────
const q6 = { allowNegative: false, maxDecimals: 6 }
assertEqual(typedDisplay("1000", q6), "1,000", "I1. 1000 -> 1,000")
assertEqual(typedDisplay("1234.56", q6), "1,234.56", "I2. 1234.56 -> 1,234.56")
assertEqual(typedDisplay("1,234.56", q6), "1,234.56", "I3. paste \"1,234.56\" -> 콤마 정리 후 동일하게 표시")
assertEqual(
  sanitizeTypedValue("1,234.56", q6),
  "1234.56",
  "I3b. paste \"1,234.56\"의 raw(sanitized)는 콤마 없는 \"1234.56\""
)
assertEqual(typedDisplay("1234.123456", q6), "1,234.123456", "I4. 6자리 소수 그대로 유지")
assertEqual(
  typedDisplay("1234.1234567", q6),
  "1,234.123456",
  "I5. 7번째 소수 입력은 타이핑 중에도 자동으로 잘림(반올림 없음)"
)

// ─── 입력 중간상태: "1.", "0.", "-", "-1." ──────────────────────────────────
assertEqual(typedDisplay("1.", q6), "1.", 'I6. "1." 입력 중 즉시 "1"로 바뀌지 않음')
assertEqual(typedDisplay("0.", q6), "0.", 'I7. "0." 입력 중 즉시 "0"으로 바뀌지 않음')
const qNeg6 = { allowNegative: true, maxDecimals: 6 }
assertEqual(typedDisplay("-", qNeg6), "-", 'I8. "-" 단독 입력 상태가 사라지지 않음(allowNegative:true)')
assertEqual(typedDisplay("-1.", qNeg6), "-1.", 'I9. "-1." 입력 중 상태 유지')

// ─── allowNegative:false ────────────────────────────────────────────────────
assertEqual(typedDisplay("-5", q6), "5", "I10. allowNegative:false면 '-' 자체가 무시되고 숫자만 남음")
assertEqual(typedDisplay("-", q6), "", "I11. allowNegative:false면 '-' 단독 입력은 빈 문자열")

// ─── maxDecimals:0 (정수 전용 필드, 예: KRW 금액) ───────────────────────────
const int0 = { allowNegative: false, maxDecimals: 0 }
assertEqual(typedDisplay("123.45", int0), "123", "I12. maxDecimals:0이면 소수점 자체가 입력되지 않음")
assertEqual(typedDisplay("1234567", int0), "1,234,567", "I13. 정수부는 정상적으로 콤마 표시")

// ─── raw number 계산 확인(onChange가 실제로 emit할 값과 동일한 경로) ───────
assertEqual(Number(sanitizeTypedValue("1,234.56", q6)), 1234.56, "I14. 표시 \"1,234.56\"의 raw는 1234.56")
assertEqual(Number(sanitizeTypedValue("1000", q6)), 1000, "I15. 표시 \"1,000\"의 raw는 1000")

// ─── toEditableDisplay (blur/mount 시 canonical 표시, 입력 필드 전용) ──────
assertEqual(toEditableDisplay(1234.5, 6), "1,234.5", "E1. number 입력")
assertEqual(toEditableDisplay(null, 6), "", 'E2. null -> 빈 문자열(표시용 "-"가 아님 — 입력 필드에 "-"가 남으면 안 됨)')
assertEqual(toEditableDisplay(undefined, 6), "", "E3. undefined -> 빈 문자열")
assertEqual(toEditableDisplay("1234.500000", 6), "1,234.5", "E4. blur 시점엔 trailing zero 정리됨")
assertEqual(toEditableDisplay(0, 6), "0", "E5. 0은 빈 문자열이 아니라 \"0\"으로 표시")

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
