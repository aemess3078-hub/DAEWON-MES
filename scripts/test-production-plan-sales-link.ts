/**
 * F01 회귀 검증 — 생산계획 품목 재조정 시 수주 연결(salesOrderItemId)과 ProductionPlanItem.id 보존
 *
 * 이 파일은 NMES 에서 복제되지 않아 누락되어 있었다(그 때문에 bom-material-sufficiency /
 * production-plan-workorder-integrity 가 첫 단계에서 중단됨). 두 테스트가 이 파일의 존재와 핵심 식별자를
 * 확인하므로, 자리표시 파일이 아니라 `reconcileProductionPlanItems`(src/lib/production-plan-item-reconciliation.ts)의
 * 실제 동작을 검증하는 테스트로 다시 작성했다. DB 불필요.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  reconcileProductionPlanItems,
  type ExistingProductionPlanItem,
} from "../src/lib/production-plan-item-reconciliation"

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${passed}: ${name}`)
}
function throwsMessage(fn: () => unknown, text: string) {
  assert.throws(fn, (error: unknown) => error instanceof Error && error.message.includes(text))
}

const TENANT = "tenant-1"
const existing: ExistingProductionPlanItem[] = [
  { id: "ppi-linked", itemId: "item-a", salesOrderItemId: "soi-1", salesOrderItemTenantId: TENANT },
  { id: "ppi-manual", itemId: "item-b", salesOrderItemId: null, salesOrderItemTenantId: null },
  { id: "ppi-removed", itemId: "item-c", salesOrderItemId: null, salesOrderItemTenantId: null },
]

check("기존 품목은 productionPlanItemId 를 유지해 갱신(update)하고, 새 행은 생성(create), 빠진 행은 삭제(delete)", () => {
  const result = reconcileProductionPlanItems(TENANT, existing, [
    { productionPlanItemId: "ppi-linked", itemId: "item-a" },
    { productionPlanItemId: "ppi-manual", itemId: "item-b" },
    { itemId: "item-new" },
  ])
  assert.deepEqual(result.updateIds, ["ppi-linked", "ppi-manual"])
  assert.deepEqual(result.createIndexes, [2])
  assert.deepEqual(result.deleteIds, ["ppi-removed"])
})

check("수주 연결(salesOrderItemId)은 DB 값을 유지한다 — 클라이언트가 생략해도 유지, 같은 값이면 허용", () => {
  const omitted = reconcileProductionPlanItems(TENANT, existing, [{ productionPlanItemId: "ppi-linked", itemId: "item-a" }])
  assert.deepEqual(omitted.updateIds, ["ppi-linked"])
  assert.ok(!omitted.deleteIds.includes("ppi-linked"), "연결된 계획 품목이 삭제되면 안 된다")
  const same = reconcileProductionPlanItems(TENANT, existing, [
    { productionPlanItemId: "ppi-linked", itemId: "item-a", salesOrderItemId: "soi-1" },
  ])
  assert.deepEqual(same.updateIds, ["ppi-linked"])
})

check("수주 연결 변경/신규 행에 수주 연결 직접 지정은 거부", () => {
  throwsMessage(
    () => reconcileProductionPlanItems(TENANT, existing, [{ productionPlanItemId: "ppi-linked", itemId: "item-a", salesOrderItemId: "soi-other" }]),
    "수주 품목 연결은 변경할 수 없습니다",
  )
  throwsMessage(
    () => reconcileProductionPlanItems(TENANT, existing, [{ productionPlanItemId: "ppi-manual", itemId: "item-b", salesOrderItemId: "soi-1" }]),
    "수주 품목 연결은 변경할 수 없습니다",
  )
  throwsMessage(() => reconcileProductionPlanItems(TENANT, existing, [{ itemId: "item-new", salesOrderItemId: "soi-1" }]), "직접 지정할 수 없습니다")
})

check("수주와 연결된 계획 품목의 품목 변경 거부, 수동 품목은 변경 허용", () => {
  throwsMessage(
    () => reconcileProductionPlanItems(TENANT, existing, [{ productionPlanItemId: "ppi-linked", itemId: "item-other" }]),
    "다른 품목으로 변경할 수 없습니다",
  )
  const manual = reconcileProductionPlanItems(TENANT, existing, [{ productionPlanItemId: "ppi-manual", itemId: "item-other" }])
  assert.deepEqual(manual.updateIds, ["ppi-manual"])
})

check("다른 테넌트의 수주 품목 연결, 다른 계획의 품목, 중복 제출 거부", () => {
  const foreign: ExistingProductionPlanItem[] = [{ id: "ppi-x", itemId: "item-a", salesOrderItemId: "soi-9", salesOrderItemTenantId: "tenant-2" }]
  throwsMessage(() => reconcileProductionPlanItems(TENANT, foreign, [{ productionPlanItemId: "ppi-x", itemId: "item-a" }]), "다른 테넌트")
  throwsMessage(() => reconcileProductionPlanItems(TENANT, existing, [{ productionPlanItemId: "not-in-plan", itemId: "item-a" }]), "속하지 않은 품목")
  throwsMessage(
    () =>
      reconcileProductionPlanItems(TENANT, existing, [
        { productionPlanItemId: "ppi-manual", itemId: "item-b" },
        { productionPlanItemId: "ppi-manual", itemId: "item-b" },
      ]),
    "중복",
  )
})

check("빈 productionPlanItemId(공백)는 새 행으로 취급", () => {
  const result = reconcileProductionPlanItems(TENANT, existing, [{ productionPlanItemId: "  ", itemId: "item-new" }])
  assert.deepEqual(result.createIndexes, [0])
})

check("서버 액션이 재조정 함수를 실제로 사용한다 / 스키마가 수주 연결 컬럼을 유지한다", () => {
  const actions = readFileSync(join(process.cwd(), "src/lib/actions/production-plan.actions.ts"), "utf8")
  assert.ok(actions.includes("reconcileProductionPlanItems(") && actions.includes("@/lib/production-plan-item-reconciliation"))
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8")
  const planItem = schema.slice(schema.indexOf("model ProductionPlanItem"), schema.indexOf("model ProductionPlanItem") + 900)
  assert.ok(planItem.includes("salesOrderItemId String?") && planItem.includes("salesOrderItem SalesOrderItem?"))
})

console.log(`\n${passed} checks passed`)
