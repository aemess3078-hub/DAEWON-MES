import { InspectionInputType, InspectionJudgement } from "@prisma/client"

// quality.actions.ts(createQualityInspection) 내부에서만 호출되는 순수 검증/계산 헬퍼.
// "use server" 파일은 async 함수만 export할 수 있어(scripts/check-use-server-exports.ts)
// 동기 함수인 이 로직들은 별도 모듈로 분리했다 — self-inspection.helpers.ts와 동일한 이유.
// DB 접근이 없는 순수 함수라 code-path 테스트(scripts/test-measurement-validation.ts)로
// 직접 검증할 수 있다.

export type CreateMeasurementInput = {
  inspectionItemId: string
  sampleNo?: number
  numericValue?: number | null
  textValue?: string | null
  booleanValue?: boolean | null
}

export type SpecItemForValidation = {
  id: string
  name: string
  inputType: InspectionInputType
  lowerLimit: unknown
  upperLimit: unknown
  unit: string | null
}

export type ValidatedMeasurement = {
  inspectionItemId: string
  sampleNo: number
  numericValue: number | null
  textValue: string | null
  booleanValue: boolean | null
  lowerLimitSnapshot: number | null
  upperLimitSnapshot: number | null
  itemNameSnapshot: string
  inputTypeSnapshot: InspectionInputType
  unitSnapshot: string | null
  judgement: InspectionJudgement | null
}

// InspectionMeasurement.numericValue / InspectionItem.lowerLimit·upperLimit는
// 전부 Decimal(18,6)이다. 서버가 판정에 쓰는 number 원값과 DB에 실제 저장될
// Decimal(18,6) 값이 달라지면(부동소수점 반올림으로 뒤늦게 저장 정밀도가 달라짐)
// "저장된 값 기준으로는 PASS인데 판정은 FAIL" 같은 모순이 생길 수 있어, 저장
// 전에 정밀도를 벗어난 값을 조용히 반올림하지 않고 명시적으로 거부한다.
const MEASUREMENT_DECIMAL_SCALE = 6
const MEASUREMENT_MAX_INTEGER_DIGITS = 12 // Decimal(18,6) → 18자리 중 정수부 최대 12자리

/**
 * numericValue가 Decimal(18,6)에 그대로 저장 가능한 정밀도인지 문자열 기준으로
 * 확인한다. pop.actions.ts의 toScaledQty()와 같은 "문자열 소수부 길이 비교" 방식을
 * 따르되, 측정값은 음수(예: 온도)를 허용해야 하므로 부호를 별도로 처리한다.
 * decimal.js/Prisma.Decimal 변환은 쓰지 않는다 — number.toString()이 이미 JS가
 * 왕복 가능한 최단 10진 표현을 주므로 문자열 비교만으로 충분하다.
 */
function assertMeasurementPrecision(value: number, itemName: string): void {
  const raw = value.toString()
  const unsigned = raw.startsWith("-") ? raw.slice(1) : raw

  if (!/^\d+(\.\d+)?$/.test(unsigned)) {
    // 매우 크거나(>=1e21) 매우 작은(<1e-6) 값은 toString()이 지수표기가 되는데,
    // 어느 쪽이든 Decimal(18,6) 범위를 명백히 벗어나므로 거부한다.
    throw new Error(`'${itemName}' 항목의 측정값이 너무 크거나 작아 저장할 수 없습니다.`)
  }

  const [integerPart, decimalPart = ""] = unsigned.split(".")
  if (decimalPart.length > MEASUREMENT_DECIMAL_SCALE) {
    throw new Error(`'${itemName}' 항목의 측정값은 소수점 ${MEASUREMENT_DECIMAL_SCALE}자리까지 입력할 수 있습니다.`)
  }
  if (integerPart.length > MEASUREMENT_MAX_INTEGER_DIGITS) {
    throw new Error(
      `'${itemName}' 항목의 측정값이 너무 큽니다(정수부 최대 ${MEASUREMENT_MAX_INTEGER_DIGITS}자리).`
    )
  }
}

/**
 * NUMERIC 항목의 판정을 확정한다. 편측 규격을 지원한다 —
 * lowerLimit/upperLimit 중 없는 쪽은 그 방향의 이탈을 판단하지 않는다.
 */
export function computeNumericJudgement(
  numericValue: number,
  lowerLimit: number | null,
  upperLimit: number | null
): InspectionJudgement {
  if (lowerLimit != null && numericValue < lowerLimit) return "FAIL"
  if (upperLimit != null && numericValue > upperLimit) return "FAIL"
  return "PASS"
}

/**
 * 클라이언트가 보낸 측정값 입력을 서버 정본(spec에 속한 InspectionItem 목록) 기준으로
 * 전부 재검증하고, 스냅샷/판정까지 확정한다. 클라이언트 값은 신뢰하지 않는다.
 */
export function validateMeasurements(
  measurements: CreateMeasurementInput[],
  specItems: SpecItemForValidation[]
): ValidatedMeasurement[] {
  const itemsById = new Map(specItems.map((item) => [item.id, item]))
  const seen = new Set<string>()

  return measurements.flatMap((m): ValidatedMeasurement[] => {
    const item = itemsById.get(m.inspectionItemId)
    if (!item) {
      throw new Error("측정값의 검사항목이 선택한 검사표준에 속하지 않습니다.")
    }

    const hasNumeric = m.numericValue != null
    const hasText = m.textValue != null && m.textValue !== ""
    const hasBoolean = m.booleanValue != null

    if ([hasNumeric, hasText, hasBoolean].filter(Boolean).length > 1) {
      throw new Error(`'${item.name}' 항목에 서로 다른 값 유형을 동시에 입력할 수 없습니다.`)
    }

    // 값이 하나도 입력되지 않은 행(빈 sample 슬롯)은 저장하지 않는다.
    if (!hasNumeric && !hasText && !hasBoolean) return []

    const sampleNo = m.sampleNo ?? 1
    if (!Number.isInteger(sampleNo) || sampleNo < 1) {
      throw new Error(`'${item.name}' 항목의 sampleNo는 1 이상의 정수여야 합니다.`)
    }
    const dedupeKey = `${item.id}:${sampleNo}`
    if (seen.has(dedupeKey)) {
      throw new Error(`'${item.name}' 항목의 sampleNo ${sampleNo}가 중복되었습니다.`)
    }
    seen.add(dedupeKey)

    const lowerLimit = item.lowerLimit == null ? null : Number(item.lowerLimit)
    const upperLimit = item.upperLimit == null ? null : Number(item.upperLimit)

    let numericValue: number | null = null
    let textValue: string | null = null
    let booleanValue: boolean | null = null
    let judgement: InspectionJudgement | null = null

    switch (item.inputType) {
      case "NUMERIC": {
        if (!hasNumeric) {
          throw new Error(`'${item.name}' 항목은 숫자 측정값만 입력할 수 있습니다.`)
        }
        if (typeof m.numericValue !== "number" || !Number.isFinite(m.numericValue)) {
          throw new Error(`'${item.name}' 항목의 측정값은 유한한 숫자여야 합니다.`)
        }
        assertMeasurementPrecision(m.numericValue, item.name)
        numericValue = m.numericValue
        judgement = computeNumericJudgement(numericValue, lowerLimit, upperLimit)
        break
      }
      case "TEXT":
      case "SELECT": {
        if (!hasText) {
          throw new Error(`'${item.name}' 항목은 텍스트 값만 입력할 수 있습니다.`)
        }
        textValue = String(m.textValue)
        break
      }
      case "BOOLEAN": {
        if (!hasBoolean) {
          throw new Error(`'${item.name}' 항목은 합부(boolean) 값만 입력할 수 있습니다.`)
        }
        booleanValue = Boolean(m.booleanValue)
        break
      }
    }

    return [{
      inspectionItemId: item.id,
      sampleNo,
      numericValue,
      textValue,
      booleanValue,
      lowerLimitSnapshot: lowerLimit,
      upperLimitSnapshot: upperLimit,
      itemNameSnapshot: item.name,
      inputTypeSnapshot: item.inputType,
      unitSnapshot: item.unit,
      judgement,
    }]
  })
}
