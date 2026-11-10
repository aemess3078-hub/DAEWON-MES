import assert from "node:assert/strict"
import {
  formatTraceDateTime,
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

console.log("traceability display tests passed")
