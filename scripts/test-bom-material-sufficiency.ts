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
