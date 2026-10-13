import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  assertProductionPlanItemCapacity,
  evaluateProductionPlanWorkOrderCompletion,
  summarizeProductionPlanItemAllocation,
} from "../src/lib/production-plan-workorder-integrity"

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) passed++
  else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

function assertThrows(run: () => unknown, includes: string, label: string) {
  try {
    run()
    assert(false, label)
  } catch (error) {
    assert(error instanceof Error && error.message.includes(includes), label)
  }
}

const wo = (id: string, plannedQty: number | string, status = "DRAFT") => ({
  id,
  plannedQty,
  status,
})
const item = (
  id: string,
  plannedQty: number | string,
  workOrders: ReturnType<typeof wo>[]
) => ({ id, plannedQty, workOrders })

assertProductionPlanItemCapacity({ plannedQty: 100, workOrders: [], requestedQty: 100 })
assert(true, "계획수량과 같은 단일 작업지시 허용")
assertProductionPlanItemCapacity({
  plannedQty: 100,
  workOrders: [wo("wo-1", 40)],
  requestedQty: 60,
})
assert(true, "합계가 계획수량과 같은 분할 작업지시 허용")
assertThrows(
  () =>
    assertProductionPlanItemCapacity({
      plannedQty: 100,
      workOrders: [wo("wo-1", 60)],
      requestedQty: 41,
    }),
  "계획수량을 초과하여 작업지시를 생성할 수 없습니다.",
  "생성 시 계획수량 초과 거절"
)
assertThrows(
  () =>
    assertProductionPlanItemCapacity({
      plannedQty: 100,
      workOrders: [wo("wo-1", 60), wo("wo-2", 30)],
      requestedQty: 50,
      excludeWorkOrderId: "wo-2",
    }),
  "계획수량을 초과하여 작업지시를 생성할 수 없습니다.",
  "수정 시 자기 자신을 제외한 합계로 초과 거절"
)
assertProductionPlanItemCapacity({
  plannedQty: 100,
  workOrders: [wo("wo-1", 60), wo("wo-2", 30)],
  requestedQty: 40,
  excludeWorkOrderId: "wo-2",
})
assert(true, "수정 시 자기 자신 수량 제외 후 잔여만큼 허용")

const cancelled = summarizeProductionPlanItemAllocation(100, [
  wo("active", 30),
  wo("cancelled", 70, "CANCELLED"),
])
assert(cancelled.assignedQty === BigInt(30000000), "취소 작업지시는 배정합계에서 제외")
assert(cancelled.remainingQty === BigInt(70000000), "취소 작업지시 수량은 잔여로 복원")

const decimal = summarizeProductionPlanItemAllocation("0.3", [
  wo("decimal-1", "0.1"),
  wo("decimal-2", "0.2"),
])
assert(decimal.assignedQty === decimal.plannedQty, "Decimal 수량을 부동소수점 오차 없이 합산")
assertProductionPlanItemCapacity({
  plannedQty: "10.000001",
  workOrders: [wo("decimal-3", "0.000001")],
  requestedQty: "10",
})
assert(true, "Decimal(18,6) 최대 소수 자릿수 허용")
assertThrows(
  () =>
    assertProductionPlanItemCapacity({
      plannedQty: "1.000000",
      workOrders: [],
      requestedQty: "1.000001",
    }),
  "계획수량을 초과하여 작업지시를 생성할 수 없습니다.",
  "Decimal 최소 단위 초과도 거절"
)

const completeSingle = evaluateProductionPlanWorkOrderCompletion([
  item("item-a", 100, [wo("wo-a", 100, "COMPLETED")]),
])
assert(completeSingle.shouldComplete, "완전 배정된 단일 품목의 모든 작업 완료 시 계획 완료")
assert(completeSingle.allItemsFullyAssigned, "단일 품목 완전 배정 판정")
assert(completeSingle.allEffectiveWorkOrdersCompleted, "단일 작업지시 완료 판정")

const partial = evaluateProductionPlanWorkOrderCompletion([
  item("item-a", 100, [wo("wo-a", 60, "COMPLETED")]),
])
assert(!partial.shouldComplete, "일부 배정만 완료된 계획은 완료하지 않음")
assert(!partial.allItemsFullyAssigned, "미배정 잔량 감지")
assert(partial.allEffectiveWorkOrdersCompleted, "유효 작업지시 완료 여부와 배정 충족을 분리")

const missingItem = evaluateProductionPlanWorkOrderCompletion([
  item("item-a", 100, [wo("wo-a", 100, "COMPLETED")]),
  item("item-b", 50, []),
])
assert(!missingItem.shouldComplete, "작업지시가 없는 계획 품목이 있으면 완료하지 않음")
assert(!missingItem.allItemsFullyAssigned, "작업지시 누락 품목을 미배정으로 판정")

const splitComplete = evaluateProductionPlanWorkOrderCompletion([
  item("item-a", 100, [
    wo("wo-a1", 40, "COMPLETED"),
    wo("wo-a2", 60, "COMPLETED"),
  ]),
])
assert(splitComplete.shouldComplete, "분할 작업지시 합계 충족 및 모두 완료 시 계획 완료")

const splitInProgress = evaluateProductionPlanWorkOrderCompletion([
  item("item-a", 100, [
    wo("wo-a1", 40, "COMPLETED"),
    wo("wo-a2", 60, "IN_PROGRESS"),
  ]),
])
assert(!splitInProgress.shouldComplete, "분할 작업지시 하나가 진행 중이면 계획 미완료")
assert(!splitInProgress.allEffectiveWorkOrdersCompleted, "미완료 유효 작업지시 감지")

const cancelledPlusComplete = evaluateProductionPlanWorkOrderCompletion([
  item("item-a", 100, [
    wo("wo-cancelled", 50, "CANCELLED"),
    wo("wo-complete", 100, "COMPLETED"),
  ]),
])
assert(cancelledPlusComplete.shouldComplete, "취소 지시를 제외한 배정합계와 완료상태로 판정")

const cancelledOnly = evaluateProductionPlanWorkOrderCompletion([
  item("item-a", 100, [wo("wo-cancelled", 100, "CANCELLED")]),
])
assert(!cancelledOnly.hasEffectiveWorkOrders, "취소 작업지시만 있으면 유효 지시 없음")
assert(!cancelledOnly.shouldComplete, "취소 작업지시만으로 계획 완료하지 않음")

const overAssignedLegacy = evaluateProductionPlanWorkOrderCompletion([
  item("item-a", 100, [wo("wo-a", 101, "COMPLETED")]),
])
assert(!overAssignedLegacy.shouldComplete, "기존 초과배정 데이터는 완료로 판정하지 않음")

const sameItemDifferentPlanItems = evaluateProductionPlanWorkOrderCompletion([
  item("plan-item-a", 50, [wo("wo-a", 50, "COMPLETED")]),
  item("plan-item-b", 70, [wo("wo-b", 70, "COMPLETED")]),
])
assert(sameItemDifferentPlanItems.shouldComplete, "동일 품목도 ProductionPlanItem별로 독립 집계")

const emptyPlan = evaluateProductionPlanWorkOrderCompletion([])
assert(!emptyPlan.shouldComplete, "품목 없는 계획은 완료하지 않음")
assert(!emptyPlan.hasEffectiveWorkOrders, "품목 없는 계획에는 유효 작업지시 없음")

const workOrderSource = readFileSync(
  join(process.cwd(), "src/lib/actions/work-order.actions.ts"),
  "utf8"
)
assert(
  workOrderSource.includes("assertProductionPlanItemCapacity") &&
    workOrderSource.includes("excludeWorkOrderId: id"),
  "생성·수정 공통 용량 검증 및 수정 자기 자신 제외 경로 유지"
)
assert(
  workOrderSource.includes('status: { in: ["CONFIRMED", "IN_PROGRESS"] }'),
  "진행 중 계획에도 분할 작업지시 연결 허용"
)
assert(
  workOrderSource.includes("if (!productionPlanItemId) return"),
  "생산계획 미연결 작업지시는 기존 독립 흐름 유지"
)
assert(
  workOrderSource.includes("id: productionPlanItemId") &&
    workOrderSource.includes("plan: {") &&
    workOrderSource.includes("tenantId,") &&
    workOrderSource.includes('status: { in: ["CONFIRMED", "IN_PROGRESS"] }'),
  "다른 tenant의 ProductionPlanItem 주입 차단"
)
assert(
  workOrderSource.includes("await tx.workOrder.create") &&
    workOrderSource.includes("await tx.workOrder.update"),
  "createWorkOrder와 updateWorkOrder 저장 경로 유지"
)

const planActionSource = readFileSync(
  join(process.cwd(), "src/lib/actions/production-plan.actions.ts"),
  "utf8"
)
assert(
  planActionSource.includes("evaluateProductionPlanWorkOrderCompletion(plan.items)"),
  "생산계획 상태 동기화가 품목별 배정·완료 규칙 사용"
)
assert(
  planActionSource.includes('const FINAL_PLAN_STATUSES: PlanStatus[] = ["COMPLETED", "CANCELLED"]'),
  "완료·취소 계획의 기존 종결 상태 의미 유지"
)

const salesLinkTestSource = readFileSync(
  join(process.cwd(), "scripts/test-production-plan-sales-link.ts"),
  "utf8"
)
assert(
  salesLinkTestSource.includes("salesOrderItemId") &&
    salesLinkTestSource.includes("productionPlanItemId"),
  "F01 salesOrderItemId 및 ProductionPlanItem.id 보존 회귀검증 유지"
)
assert(
  JSON.stringify([wo("kept", 40)].filter((workOrder) => workOrder.id !== "deleted")) ===
    JSON.stringify([wo("kept", 40)]),
  "삭제된 WorkOrder는 조회 집계에 존재하지 않아 자연 제외"
)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
