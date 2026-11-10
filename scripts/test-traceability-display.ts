import assert from "node:assert/strict"
import fs from "node:fs"
import {
  MOVEMENT_TONE_CLASS,
  formatTraceDateTime,
  getActionStatusLabel,
  getInspectionResultLabel,
  getInspectionStageLabel,
  getItemTypeLabel,
  getLotRelationLabel,
  getOperationStatusLabel,
  getTxTypeLabel,
  getSourceTypeLabel,
  getWipMovementLabel,
  isOutsourcingMovement,
  summarizeResultTimes,
} from "../src/lib/traceability-display"

// 1. 외주 이력 한글화
assert.equal(getWipMovementLabel("OUTSOURCED", "PurchaseOrderItem").label, "외주 반출")
assert.equal(getWipMovementLabel("RETURNED", "PurchaseOrderItem").label, "외주 입고")
assert.equal(getWipMovementLabel("RELEASED", "OutsourcingInspection").label, "외주 검사완료")
assert.equal(getWipMovementLabel("RELEASED", null).label, "보류해제", "외주와 무관한 RELEASED는 보류해제 유지")
assert.equal(getWipMovementLabel("DEFECT", "OutsourcingInspection").label, "외주 검사 불량")
assert.equal(getWipMovementLabel("REWORK", "OutsourcingInspection").label, "재외주")
assert.equal(getWipMovementLabel("SCRAP", "OutsourcingInspection").label, "외주 불량 폐기")
assert.equal(getWipMovementLabel("SPLIT", "OutsourcingInspection").label, "외주 수량 분리")
assert.equal(getWipMovementLabel("DEFECT", null).label, "불량 발생")
assert.equal(getWipMovementLabel("UNKNOWN_X", null).label, "UNKNOWN_X", "알 수 없는 코드는 원문 유지")
assert.equal(getSourceTypeLabel("PurchaseOrderItem"), "외주 발주")
assert.equal(getSourceTypeLabel("OutsourcingInspection"), "외주 입고검사")
assert.equal(getSourceTypeLabel(null), "-")
assert.equal(isOutsourcingMovement({ movementType: "OUTSOURCED" }), true)
assert.equal(isOutsourcingMovement({ movementType: "RELEASED", sourceType: "OutsourcingInspection" }), true)
assert.equal(isOutsourcingMovement({ movementType: "RELEASED", sourceType: null }), false)

// 2. 일시 형식 (한국 표준시, YYYY-MM-DD HH:mm:ss)
assert.equal(formatTraceDateTime("2026-11-05T00:03:09.000Z"), "2026-11-05 09:03:09")
assert.equal(formatTraceDateTime("2026-11-05T15:00:00.000Z"), "2026-11-06 00:00:00", "자정은 24가 아닌 00")
assert.equal(formatTraceDateTime(null), "-")
assert.equal(formatTraceDateTime(undefined), "-")
assert.equal(formatTraceDateTime("not-a-date"), "-")

// 3. 작업시작·완료시간
const r = [
  { startedAt: "2026-11-05T02:00:00Z", endedAt: "2026-11-05T03:00:00Z" },
  { startedAt: "2026-11-05T01:00:00Z", endedAt: "2026-11-05T05:00:00Z" },
  { startedAt: null, endedAt: "2026-11-05T09:00:00Z" },
]
assert.deepEqual(summarizeResultTimes(r, true), { startedAt: "2026-11-05T01:00:00.000Z", completedAt: "2026-11-05T09:00:00.000Z" })
assert.equal(summarizeResultTimes(r, false).completedAt, null, "진행 중이면 완료시간 없음")
assert.deepEqual(summarizeResultTimes([], true), { startedAt: null, completedAt: null })
assert.deepEqual(summarizeResultTimes([{ startedAt: null, endedAt: null }], true), { startedAt: null, completedAt: null }, "기록 없으면 임의 생성 금지")

// 4. 그 외 코드값 한글 표시(공통) — 알 수 없는 값은 원문 유지
assert.equal(getOperationStatusLabel("IN_PROGRESS"), "진행중")
assert.equal(getOperationStatusLabel("SKIPPED"), "건너뜀")
assert.equal(getOperationStatusLabel(undefined), "-")
assert.equal(getInspectionStageLabel("FIRST"), "초물")
assert.equal(getInspectionStageLabel("FINAL"), "종물")
assert.equal(getInspectionResultLabel("CONDITIONAL"), "조건부")
assert.equal(getInspectionResultLabel(null), "미판정")
assert.equal(getLotRelationLabel("INPUT"), "투입")
assert.equal(getLotRelationLabel("OUTPUT"), "산출")
assert.equal(getTxTypeLabel("ISSUE"), "출고")
assert.equal(getTxTypeLabel("SUPPLIER_RETURN"), "공급사 반품")
assert.equal(getItemTypeLabel("SEMI_FINISHED"), "반제품")
assert.equal(getActionStatusLabel("VERIFYING"), "효과확인")
assert.equal(getActionStatusLabel("NEW_CODE"), "NEW_CODE")
assert.ok(MOVEMENT_TONE_CLASS.cyan.includes("cyan"))

// 5. 두 이력추적 화면이 같은 공통 표시 로직을 사용하고, 영문 코드가 그대로 노출되지 않는다
const lot = fs.readFileSync("src/app/app/mes/traceability/traceability-client.tsx", "utf8")
const mfg = fs.readFileSync("src/app/app/mes/manufacturing-traceability/manufacturing-traceability-client.tsx", "utf8")
for (const [name, src] of [["LOT 이력추적", lot], ["제조 이력추적", mfg]] as const) {
  assert.ok(src.includes('from "@/lib/traceability-display"'), `${name}: 공통 표시 모듈 사용`)
  assert.ok(src.includes("getWipMovementLabel(movement.movementType, movement.sourceType)"), `${name}: 외주 이력은 sourceType 으로 구분해 한글 표시`)
  assert.ok(!/<b>\{movement\.movementType\}<\/b>/.test(src), `${name}: 외주 상태 영문 코드 직접 출력 금지`)
}
assert.ok(lot.includes("summarizeResultTimes(operation.productionResults") && lot.includes("작업시작시간") && lot.includes("작업완료시간"), "LOT 이력추적: 공정별 작업시작·완료시간 표시")
assert.ok(!/\.toLocaleString\(\)/.test(lot), "LOT 이력추적: 일시는 한국 표준시 공통 형식")
assert.ok(!/\{lot\.relationType\}|\{issue\.transaction\.txType\}|\{inspection\.stage\}<\/b>/.test(lot), "LOT 이력추적: relationType/txType/stage 영문 직접 출력 금지")
assert.ok(!/const (OPERATION_STATUS|INSPECTION_STAGE|MOVEMENT_TONE_CLASS)\b/.test(mfg), "제조 이력추적: 중복 로컬 상수 제거(공통 모듈로 통합)")
assert.equal(getWipMovementLabel("OUTSOURCED", "PurchaseOrderItem").label, "외주 반출")
assert.equal(getWipMovementLabel("RELEASED", null).label, "보류해제", "일반 RELEASED 는 보류해제 유지")

console.log("traceability display tests passed")
