import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  MATERIAL_NOT_ISSUED_MESSAGE,
  OPERATION_RESULT_REQUIRED_MESSAGE,
  PREVIOUS_OPERATION_NOT_COMPLETED_MESSAGE,
  assertDirectOperationStatusRequestAllowed,
  assertOperationResultAllowed,
  assertOperationStartAllowed,
} from "../src/lib/operation-status-integrity"

let passed = 0
let failed = 0
const ok = (condition: boolean, label: string) => {
  if (condition) passed++
  else { failed++; console.error(`FAIL: ${label}`) }
}
const throws = (run: () => unknown, message: string, label: string) => {
  try { run(); ok(false, label) }
  catch (error) { ok(error instanceof Error && error.message.includes(message), label) }
}
const start = (overrides: Partial<Parameters<typeof assertOperationStartAllowed>[0]> = {}) =>
  assertOperationStartAllowed({
    operationStatus: "PENDING", workOrderStatus: "RELEASED",
    previousOperationStatuses: [], materialIssuanceReady: true,
    wipStatus: "WAITING", ...overrides,
  })
const result = (overrides: Partial<Parameters<typeof assertOperationResultAllowed>[0]> = {}) =>
  assertOperationResultAllowed({
    operationStatus: "IN_PROGRESS", previousOperationStatuses: ["COMPLETED"],
    materialIssuanceReady: true, wipStatus: "IN_PROCESS", ...overrides,
  })

start(); ok(true, "첫 공정 시작 허용")
throws(() => start({ previousOperationStatuses: ["PENDING"] }), PREVIOUS_OPERATION_NOT_COMPLETED_MESSAGE, "선행공정 미완료 차단")
start({ previousOperationStatuses: ["COMPLETED"] }); ok(true, "선행공정 완료 후 시작")
throws(() => start({ previousOperationStatuses: ["COMPLETED", "IN_PROGRESS"] }), PREVIOUS_OPERATION_NOT_COMPLETED_MESSAGE, "다공정 순서 차단")
start({ previousOperationStatuses: ["COMPLETED", "COMPLETED"] }); ok(true, "모든 선행공정 완료 시 시작")
throws(() => start({ operationStatus: "SKIPPED" }), "대기 또는 진행중", "건너뛴 공정 시작 차단")
throws(() => start({ operationStatus: "COMPLETED" }), "대기 또는 진행중", "완료공정 재오픈 차단")
start({ operationStatus: "IN_PROGRESS", wipStatus: "IN_PROCESS" }); ok(true, "진행중 공정의 설비배정 시작 허용")
throws(() => start({ workOrderStatus: "DRAFT" }), "작업대기 또는 진행중", "초안 작업지시 차단")
throws(() => start({ workOrderStatus: "COMPLETED" }), "작업대기 또는 진행중", "완료 작업지시 차단")
throws(() => start({ materialIssuanceReady: false, wipStatus: null }), MATERIAL_NOT_ISSUED_MESSAGE, "자재출고 전 시작 차단")
start({ materialIssuanceReady: true, wipStatus: "WAITING" }); ok(true, "자재출고 후 시작")
throws(() => start({ wipStatus: "ON_HOLD" }), "보류 중인 재공품", "HOLD WIP 시작 차단")
throws(() => start({ wipStatus: "REWORK" }), "일반 공정을 시작", "REWORK WIP 일반 시작 차단")
throws(() => start({ wipStatus: "OUTSOURCED" }), "일반 공정을 시작", "외주 출고 WIP 일반 시작 차단")
throws(() => start({ wipStatus: "IN_TRANSIT" }), "일반 공정을 시작", "외주 운송 WIP 일반 시작 차단")
throws(() => start({ wipStatus: "RECEIVED" }), "일반 공정을 시작", "외주 입고 WIP 일반 시작 차단")
result(); ok(true, "진행중 공정 실적등록 허용")
throws(() => result({ operationStatus: "PENDING" }), "작업시작 후", "시작 전 실적등록 차단")
throws(() => result({ previousOperationStatuses: ["PENDING"] }), "이전 공정이 완료되지 않아", "실적등록도 선행공정 통제")
throws(() => result({ materialIssuanceReady: false, wipStatus: null }), MATERIAL_NOT_ISSUED_MESSAGE, "실적등록도 자재출고 통제")
throws(() => result({ wipStatus: "ON_HOLD" }), "보류 중인 재공품", "HOLD WIP 실적등록 차단")
throws(() => result({ wipStatus: "REWORK" }), "생산실적을 등록", "REWORK WIP 일반 실적등록 차단")
throws(() => assertDirectOperationStatusRequestAllowed("PENDING", "COMPLETED"), OPERATION_RESULT_REQUIRED_MESSAGE, "PENDING 직접 완료 차단")
throws(() => assertDirectOperationStatusRequestAllowed("IN_PROGRESS", "COMPLETED"), OPERATION_RESULT_REQUIRED_MESSAGE, "ProductionResult 없는 완료 차단")
assertDirectOperationStatusRequestAllowed("PENDING", "IN_PROGRESS"); ok(true, "직접 시작 요청 허용")
throws(() => assertDirectOperationStatusRequestAllowed("COMPLETED", "IN_PROGRESS"), "다시 시작", "COMPLETED 재오픈 차단")
throws(() => assertDirectOperationStatusRequestAllowed("SKIPPED", "IN_PROGRESS"), "다시 시작", "SKIPPED 재오픈 차단")
throws(() => assertDirectOperationStatusRequestAllowed("PENDING", "SKIPPED"), "지원하지 않는", "임의 상태값 차단")

const pop = readFileSync(join(process.cwd(), "src/lib/actions/pop.actions.ts"), "utf8")
const progress = readFileSync(join(process.cwd(), "src/lib/actions/process-progress.actions.ts"), "utf8")
ok(pop.includes("assertOperationStartAllowed({"), "POP 시작이 공통 정본 사용")
ok(pop.includes("assertOperationResultAllowed({"), "POP 실적등록이 공통 정본 사용")
ok(progress.includes("assertDirectOperationStatusRequestAllowed(op.status, status)"), "process-progress 전이 정본 사용")
ok(progress.includes("await startOperation(operationId)"), "process-progress 시작이 POP 경로에 위임")
ok(progress.includes("workOrder: { tenantId }"), "process-progress tenant 범위 적용")
ok(!progress.includes("workOrderOperation.update({"), "process-progress 직접 상태쓰기 제거")
ok(pop.includes("assignment.workOrderOperationId !== operationId"), "다른 공정 설비배정 주입 차단 유지")

console.log(`operation-status-integrity: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
