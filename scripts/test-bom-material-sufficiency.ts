import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  assertProductionQuantityWithinMaterialLimit,
  calculateBomMaterialSufficiency,
} from "../src/lib/bom-material-sufficiency"

const root = process.cwd()
let passed = 0

function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log("PASS " + label)
}

function equal(actual: unknown, expected: unknown, label: string) {
  assert.deepEqual(actual, expected, label)
  passed += 1
  console.log("PASS " + label)
}

function read(path: string) {
  return readFileSync(join(root, path), "utf8")
}

function baseRequirements() {
  return [
    { componentItemId: "mat-a", componentCode: "MAT-A", componentName: "자재 A", qtyPer: 2, scrapRate: 0 },
    { componentItemId: "mat-b", componentCode: "MAT-B", componentName: "자재 B", qtyPer: 1, scrapRate: 0 },
  ]
}

function calc(overrides: Partial<Parameters<typeof calculateBomMaterialSufficiency>[0]> = {}) {
  return calculateBomMaterialSufficiency({
    plannedQty: 100,
    producedQty: 0,
    requirements: baseRequirements(),
    issuedTransactions: [
      { itemId: "mat-a", txType: "ISSUE", qty: 200 },
      { itemId: "mat-b", txType: "ISSUE", qty: 100 },
    ],
    ...overrides,
  })
}

{
  const s = calc({ requirements: [baseRequirements()[0]], issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 200 }] })
  equal(s.materialProducibleQty, 100, "1 component sufficient allows full planned quantity")
  assertProductionQuantityWithinMaterialLimit(s, 100)
  ok(true, "1 component sufficient accepts matching production")
}

{
  const s = calc({ requirements: [baseRequirements()[0]], issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 120 }] })
  equal(s.materialProducibleQty, 60, "1 component shortage caps producible quantity")
  assert.throws(() => assertProductionQuantityWithinMaterialLimit(s, 61), /최대 60 EA/)
  ok(true, "1 component shortage rejects over-cap production")
}

{
  const s = calc({ issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 120 }, { itemId: "mat-b", txType: "ISSUE", qty: 100 }] })
  equal(s.materialProducibleQty, 60, "multiple components use the most restrictive producible quantity")
}

{
  const s = calc({ issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 200 }, { itemId: "mat-b", txType: "ISSUE", qty: 50 }] })
  equal(s.materialProducibleQty, 50, "A sufficient and B shortage is limited by B")
}

{
  const s = calc({ issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 80 }, { itemId: "mat-b", txType: "ISSUE", qty: 100 }] })
  equal(s.materialProducibleQty, 40, "A shortage and B sufficient is limited by A")
}

{
  const s = calc({ issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 80 }, { itemId: "mat-b", txType: "ISSUE", qty: 40 }] })
  assertProductionQuantityWithinMaterialLimit(s, 40)
  ok(true, "partial issue allows partial production")
}

{
  const s = calc({ issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 140 }, { itemId: "mat-b", txType: "ISSUE", qty: 70 }], producedQty: 40 })
  equal(s.maxAdditionalProductionQty, 30, "additional issue increases cumulative material capacity")
}

{
  const s = calc({ issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 120 }, { itemId: "mat-b", txType: "ISSUE", qty: 100 }], producedQty: 40 })
  equal(s.maxAdditionalProductionQty, 20, "already produced quantity reduces remaining material capacity")
}

{
  const s = calc({ issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 200 }, { itemId: "mat-b", txType: "ISSUE", qty: 100 }], producedQty: 90 })
  assertProductionQuantityWithinMaterialLimit(s, 10)
  assert.throws(() => assertProductionQuantityWithinMaterialLimit(s, 11), /최대 10 EA/)
  ok(true, "good plus defect plus rework consumed policy is enforced through produced quantity")
}

{
  const s = calc({ issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 300 }, { itemId: "mat-b", txType: "ISSUE", qty: 150 }] })
  equal(s.maxAdditionalProductionQty, 100, "over-issued materials cannot exceed planned quantity")
}

{
  const s = calc({ issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 120 }, { itemId: "mat-b", txType: "ISSUE", qty: 60 }] })
  assertProductionQuantityWithinMaterialLimit(s, 60)
  ok(true, "multiple lots are represented as multiple ISSUE rows and summed")
}

{
  const s = calc({
    requirements: [baseRequirements()[0]],
    issuedTransactions: [
      { itemId: "mat-a", txType: "ISSUE", qty: 100 },
      { itemId: "mat-a", txType: "RETURN", qty: 20 },
    ],
  })
  equal(s.materialProducibleQty, 40, "WORK_ORDER RETURN transactions reduce net issued quantity")
}

{
  const s = calc({
    requirements: [
      { componentItemId: "mat-a", componentCode: "MAT-A", componentName: "자재 A", qtyPer: 1.5, scrapRate: 0.1 },
    ],
    issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 165 }],
  })
  equal(s.materialProducibleQty, 100, "decimal BOM usage includes scrap rate")
}

{
  const s = calc({
    requirements: [
      { componentItemId: "mat-a", componentCode: "MAT-A", componentName: "자재 A", qtyPer: 1, scrapRate: 0 },
      { componentItemId: "mat-a", componentCode: "MAT-A", componentName: "자재 A", qtyPer: 0.5, scrapRate: 0 },
    ],
    issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 150 }],
  })
  equal(s.materialProducibleQty, 100, "duplicate BOM component rows aggregate per-unit requirement")
}

{
  const s = calc({ requirements: [], issuedTransactions: [], producedQty: 40 })
  equal(s.materialProducibleQty, null, "BOM without required components is not material-limited")
  equal(s.maxAdditionalProductionQty, 60, "BOM without required components keeps planned remaining as cap")
}

// ─── ISSUE-01: 부동소수점 나눗셈 / 출고 한도와 실적 한도의 반올림 기준 차이 ───
{
  const req = [{ componentItemId: "mat-a", componentCode: "MAT-A", componentName: "자재 A", qtyPer: 2.5, scrapRate: 0.03 }]
  const s = calc({ plannedQty: 30, requirements: req, issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 77.25 }] })
  equal(s.requirements[0].perUnitRequirement, 2.575, "I01-1 단위소요 2.5 × 1.03 = 2.575")
  equal(s.materialProducibleQty, 30, "I01-2 77.25 ÷ 2.575 = 정확히 30 (29.999999 아님)")
  assertProductionQuantityWithinMaterialLimit(s, 30)
  ok(true, "I01-3 필요량만큼 출고하면 계획 30 EA 전량 실적 등록 허용")
  assert.throws(() => assertProductionQuantityWithinMaterialLimit(s, 30.000001), /최대 30 EA/)
  ok(true, "I01-4 계획을 넘는 초과 실적(30.000001)은 거부")
  equal(s.shortages.length, 0, "I01-5 필요량 전량 출고 시 부족 목록 없음")
}

{
  const req = [{ componentItemId: "mat-a", componentCode: "MAT-A", componentName: "자재 A", qtyPer: 2.575, scrapRate: 0 }]
  const s = calc({ plannedQty: 30, requirements: req, issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 77.249999 }] })
  equal(s.materialProducibleQty, 29.999999, "I01-6 출고가 0.000001 모자라면 생산가능량은 29.999999로 제한(정확한 내림)")
  assert.throws(() => assertProductionQuantityWithinMaterialLimit(s, 30), /최대 29\.999999 EA/)
  ok(true, "I01-7 실제 자재 부족 시 기존 제한 유지")
  equal(s.shortages.length, 1, "I01-8 실제 부족은 부족 목록에 남음")
}

{
  const req = [{ componentItemId: "mat-a", componentCode: "MAT-A", componentName: "자재 A", qtyPer: 2.575, scrapRate: 0 }]
  const s = calc({ plannedQty: 30, producedQty: 29, requirements: req, issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 77.25 }] })
  equal(s.maxAdditionalProductionQty, 1, "I01-9 29 EA 등록 후 마지막 1 EA 등록 가능")
  assert.throws(() => assertProductionQuantityWithinMaterialLimit(s, 2), /최대 1 EA/)
  ok(true, "I01-10 누적 실적이 계획을 넘지 않음")
}

{
  const req = [{ componentItemId: "mat-a", componentCode: "MAT-A", componentName: "자재 A", qtyPer: 2.575, scrapRate: 0 }]
  const s = calc({ plannedQty: 30, requirements: req, issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 51.5 }] })
  equal(s.materialProducibleQty, 20, "I01-11 부분 출고 51.5 ÷ 2.575 = 정확히 20")
}

{
  // 출고 필요량은 소수 셋째 자리 반올림(자재출고 화면 기준): 3 × 0.33335 = 1.00005 → 1.000
  const req = [{ componentItemId: "mat-a", componentCode: "MAT-A", componentName: "자재 A", qtyPer: 0.33335, scrapRate: 0 }]
  const full = calc({ plannedQty: 3, requirements: req, issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 1 }] })
  equal(full.requirements[0].requiredQty, 1, "I01-12 필요량은 자재출고 한도와 같은 값(1.000)")
  equal(full.maxAdditionalProductionQty, 3, "I01-13 출고 화면 필요량을 다 출고하면 반올림 차이와 관계없이 계획 전량 생산 가능")
  const short = calc({ plannedQty: 3, requirements: req, issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: 0.9 }] })
  assert.throws(() => assertProductionQuantityWithinMaterialLimit(short, 3), /최대 2\.699865 EA/)
  ok(true, "I01-14 필요량 미달 출고는 단위소요 기준으로 제한")
}

{
  const req = [
    { componentItemId: "mat-a", componentCode: "MAT-A", componentName: "자재 A", qtyPer: 2.575, scrapRate: 0 },
    { componentItemId: "mat-b", componentCode: "MAT-B", componentName: "자재 B", qtyPer: 0.7, scrapRate: 0.1 },
  ]
  const s = calc({
    plannedQty: 30,
    requirements: req,
    issuedTransactions: [
      { itemId: "mat-a", txType: "ISSUE", qty: 77.25 },
      { itemId: "mat-b", txType: "ISSUE", qty: 15.4 },
    ],
  })
  equal(s.materialProducibleQty, 20, "I01-15 A 전량 출고 + B 부분 출고(15.4 ÷ 0.77 = 20)는 B 기준으로 제한")
}

{
  // 경계값 전수: 자재출고 화면이 허용하는 필요량을 정확히 출고하면 항상 계획 전량, 0.001 모자라면 항상 계획 미만
  const qtyPers = [0.1, 0.2, 0.3, 0.7, 1.1, 2.5, 2.575, 0.125, 3.3, 0.015, 0.33335, 1.234567]
  const scrapRates = [0, 0.01, 0.03, 0.05, 0.1, 0.0375]
  let fullOk = 0
  let shortOk = 0
  for (const qtyPer of qtyPers) {
    for (const scrapRate of scrapRates) {
      for (let planned = 1; planned <= 200; planned += 1) {
        const required = Math.round(qtyPer * planned * (1 + scrapRate) * 1000) / 1000
        if (required <= 0.001) continue
        const req = [{ componentItemId: "mat-a", componentCode: "MAT-A", componentName: "자재 A", qtyPer, scrapRate }]
        const full = calc({ plannedQty: planned, requirements: req, issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: required }] })
        assert.equal(full.maxAdditionalProductionQty, planned, `full issue qtyPer=${qtyPer} scrap=${scrapRate} planned=${planned}`)
        fullOk += 1
        const shortIssued = Math.round((required - 0.001) * 1000) / 1000
        const short = calc({ plannedQty: planned, requirements: req, issuedTransactions: [{ itemId: "mat-a", txType: "ISSUE", qty: shortIssued }] })
        assert.ok(short.maxAdditionalProductionQty < planned, `short issue qtyPer=${qtyPer} scrap=${scrapRate} planned=${planned}`)
        shortOk += 1
      }
    }
  }
  ok(fullOk > 10000 && shortOk === fullOk, `I01-16 경계값 ${fullOk}조합: 필요량 출고=계획 전량, 0.001 부족=계획 미만`)
}

const helper = read("src/lib/bom-material-sufficiency.ts")
const pop = read("src/lib/actions/pop.actions.ts")
const materialIssue = read("src/lib/actions/material-issue.actions.ts")
const workOrder = read("src/lib/actions/work-order.actions.ts")
const schema = read("prisma/schema.prisma")
const f09Test = read("scripts/test-equipment-result-attribution.ts")
const rolePermissionTest = read("scripts/test-role-permission-enforcement.ts")
const qualityHistoryTest = read("scripts/test-quality-history-integrity.ts")
const shipmentTest = read("scripts/test-shipment-state-integrity.ts")
const qualityGateTest = read("scripts/test-quality-release-gate.ts")
const popWorktimeTest = read("scripts/test-pop-worktime-operator.ts")
const operationStatusTest = read("scripts/test-operation-status-integrity.ts")
const planWorkOrderTest = read("scripts/test-production-plan-workorder-integrity.ts")
const planSalesTest = read("scripts/test-production-plan-sales-link.ts")

ok(schema.includes("bomId           String") && schema.includes("bom     BOM"), "WorkOrder stores a fixed BOM foreign key")
ok(schema.includes("qtyPer") && schema.includes("scrapRate"), "BOMItem exposes qtyPer and scrapRate for required material calculation")
ok(!schema.includes("optional") && !schema.includes("substituteBomItem"), "schema has no BOM optional/substitute component grouping")
ok(helper.includes('refType: "WORK_ORDER"') && helper.includes("refId: operation.workOrderId"), "issued quantity is scoped to the target WorkOrder")
ok(helper.includes("tenantId: params.tenantId"), "issued quantity is scoped to the current tenant")
ok(helper.includes('txType: { in: ["ISSUE", "RETURN"] }'), "net issued quantity only uses WORK_ORDER ISSUE/RETURN semantics")
ok(helper.includes("itemId: { in: bomItemIds }"), "issued quantity is scoped to BOM component items only")
ok(materialIssue.includes('txType: "ISSUE"') && materialIssue.includes('refType: "WORK_ORDER"'), "material issue creates WORK_ORDER ISSUE transactions")
ok(materialIssue.includes("qty: workOrder.plannedQty"), "latest main reproduced: material issue creates root WIP at plannedQty, so partial issue needed F10 submit cap")
ok(workOrder.includes("blockedStatuses") && workOrder.includes('"IN_PROGRESS"') && workOrder.includes('"COMPLETED"'), "WorkOrder cannot change BOM after progress starts")
ok(pop.includes("getWorkOrderMaterialSufficiency(tx") && pop.includes("assertProductionQuantityWithinMaterialLimit"), "submitProductionResult enforces BOM material sufficiency on the server")
ok(pop.includes("materialSufficiency: {"), "POP operation detail exposes material sufficiency for display")
ok(f09Test.includes("ProductionResult assignment equipment overrides representative operation equipment"), "F09 regression test remains present")
ok(rolePermissionTest.includes("role-permission-enforcement static checks complete"), "F08 regression test remains present")
ok(qualityHistoryTest.includes("quality history integrity: PASS"), "F07 regression test remains present")
ok(shipmentTest.includes("shipment state integrity: PASS"), "F06 regression test remains present")
ok(qualityGateTest.includes("quality release gate"), "F05 regression test remains present")
ok(popWorktimeTest.includes("pop-worktime-operator"), "F04 regression test remains present")
ok(operationStatusTest.includes("operation-status-integrity"), "F03 regression test remains present")
ok(planWorkOrderTest.includes("production-plan-workorder"), "F02 regression test remains present")
ok(planSalesTest.includes("reconcileProductionPlanItems"), "F01 regression test remains present")

console.log(`\\n${passed} BOM material sufficiency checks passed.`)
