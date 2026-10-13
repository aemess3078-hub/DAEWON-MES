import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { InspectionResult, InspectionStage } from "@prisma/client"
import {
  assertQualityReleaseAllowed,
  evaluateQualityRelease,
} from "../src/lib/actions/quality-release-gate.helpers"

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${passed}: ${name}`)
}

const at = (minute: number) => new Date(`2026-09-07T00:${String(minute).padStart(2, "0")}:00Z`)
const inspection = (
  id: string,
  result: InspectionResult | null,
  minute: number,
  options: { spec?: string; stage?: InspectionStage } = {},
) => ({
  id,
  result,
  inspectedAt: at(minute),
  inspectionSpecId: options.spec ?? "spec-final",
  stage: options.stage ?? InspectionStage.FINAL,
})

const notRequired = evaluateQualityRelease({ inspectionSpecId: null, inspections: [] })
check("검사표준이 없으면 검사 비대상이다", () => assert.equal(notRequired.requiresInspection, false))
check("검사 비대상 상태는 NOT_REQUIRED다", () => assert.equal(notRequired.inspectionStatus, "NOT_REQUIRED"))
check("검사 비대상은 입고를 허용한다", () => assert.doesNotThrow(() => assertQualityReleaseAllowed(notRequired, "RECEIPT")))
check("검사 비대상은 출하를 허용한다", () => assert.doesNotThrow(() => assertQualityReleaseAllowed(notRequired, "SHIPMENT")))

const missing = evaluateQualityRelease({ inspectionSpecId: "spec-final", inspections: [] })
check("검사표준이 있고 이력이 없으면 미검사다", () => assert.equal(missing.inspectionStatus, "NOT_INSPECTED"))
check("미검사는 입고를 차단한다", () => assert.throws(() => assertQualityReleaseAllowed(missing, "RECEIPT"), /최종검사를 완료/))
check("미검사는 출하를 차단한다", () => assert.throws(() => assertQualityReleaseAllowed(missing, "SHIPMENT"), /최종검사를 완료/))

const fail = evaluateQualityRelease({ inspectionSpecId: "spec-final", inspections: [inspection("f1", InspectionResult.FAIL, 1)] })
check("최종 FAIL을 선택한다", () => assert.equal(fail.inspectionResult, InspectionResult.FAIL))
check("FAIL은 입고를 차단한다", () => assert.throws(() => assertQualityReleaseAllowed(fail, "RECEIPT"), /불합격 제품은 입고/))
check("FAIL은 출하를 차단한다", () => assert.throws(() => assertQualityReleaseAllowed(fail, "SHIPMENT"), /불합격 제품은 출하/))

const pass = evaluateQualityRelease({ inspectionSpecId: "spec-final", inspections: [inspection("p1", InspectionResult.PASS, 1)] })
check("최종 PASS를 선택한다", () => assert.equal(pass.inspectionResult, InspectionResult.PASS))
check("PASS는 입고를 허용한다", () => assert.doesNotThrow(() => assertQualityReleaseAllowed(pass, "RECEIPT")))
check("PASS는 출하를 허용한다", () => assert.doesNotThrow(() => assertQualityReleaseAllowed(pass, "SHIPMENT")))

const conditional = evaluateQualityRelease({ inspectionSpecId: "spec-final", inspections: [inspection("c1", InspectionResult.CONDITIONAL, 1)] })
check("조건부 판정을 보존한다", () => assert.equal(conditional.inspectionResult, InspectionResult.CONDITIONAL))
check("조건부 판정은 입고를 차단한다", () => assert.throws(() => assertQualityReleaseAllowed(conditional, "RECEIPT"), /최종검사를 완료/))

const midPass = evaluateQualityRelease({
  inspectionSpecId: "spec-final",
  inspections: [inspection("mid", InspectionResult.PASS, 2, { stage: InspectionStage.MID })],
})
check("POP 중간검사 PASS는 최종 승인으로 쓰지 않는다", () => assert.equal(midPass.inspectionStatus, "NOT_INSPECTED"))

const wrongSpecPass = evaluateQualityRelease({
  inspectionSpecId: "spec-final",
  inspections: [inspection("other", InspectionResult.PASS, 3, { spec: "other-work-order-spec" })],
})
check("다른 검사규격 PASS는 주입할 수 없다", () => assert.equal(wrongSpecPass.inspectionStatus, "NOT_INSPECTED"))

const retestPass = evaluateQualityRelease({
  inspectionSpecId: "spec-final",
  inspections: [inspection("old-fail", InspectionResult.FAIL, 1), inspection("new-pass", InspectionResult.PASS, 2)],
})
check("FAIL 후 최신 재검 PASS를 허용한다", () => assert.equal(retestPass.inspectionId, "new-pass"))
check("재검 PASS는 출하를 허용한다", () => assert.doesNotThrow(() => assertQualityReleaseAllowed(retestPass, "SHIPMENT")))

const retestFail = evaluateQualityRelease({
  inspectionSpecId: "spec-final",
  inspections: [inspection("old-pass", InspectionResult.PASS, 1), inspection("new-fail", InspectionResult.FAIL, 2)],
})
check("최신 재검 FAIL을 차단한다", () => assert.equal(retestFail.inspectionId, "new-fail"))

const samplePass = evaluateQualityRelease({ inspectionSpecId: "spec-final", inspections: [inspection("sample", InspectionResult.PASS, 4)] })
check("검사수량 coverage 없이 PASS 판정만 사용한다", () => assert.equal(samplePass.blockingReason, null))

const root = path.resolve(__dirname, "..")
const finishedSource = fs.readFileSync(path.join(root, "src/lib/actions/finished-goods.actions.ts"), "utf8")
const shipmentSource = fs.readFileSync(path.join(root, "src/lib/actions/shipment.actions.ts"), "utf8")
const stageSource = fs.readFileSync(path.join(root, "src/lib/actions/inspection-stages.actions.ts"), "utf8")
check("완제품입고 mutation이 서버 gate를 호출한다", () => assert.match(finishedSource, /assertWorkOrderQualityReleaseAllowed\(tx/))
check("공통 출하 mutation이 LOT gate를 호출한다", () => assert.match(shipmentSource, /assertLotQualityReleaseAllowed\(tx/))
check("수주와 출하등록이 쓰는 공통 createShipment에 gate가 있다", () => assert.equal((shipmentSource.match(/export async function createShipment/g) ?? []).length, 1))
check("종물검사 등록은 tenant 범위의 공정과 규격을 검증한다", () => assert.match(stageSource, /workOrder: \{ tenantId \}/))
check("완료 작업지시도 종물검사 등록 대상에 포함한다", () => assert.match(stageSource, /\["RELEASED", "IN_PROGRESS", "COMPLETED"\]/))

console.log(`quality release gate: ${passed}/${passed} PASS`)
