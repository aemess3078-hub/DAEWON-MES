import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  actualProductionEquipmentWhere,
  resolveActualProductionEquipment,
} from "../src/lib/equipment-result-attribution"

const root = process.cwd()
let passed = 0

function ok(value: unknown, message: string) {
  assert.ok(value, message)
  passed += 1
  console.log(`PASS ${message}`)
}

function read(path: string) {
  return readFileSync(join(root, path), "utf8")
}

const assignmentEquipment = { id: "eq-actual", code: "CUT-02", name: "커팅 2호기" }
const fallbackEquipment = { id: "eq-fallback", code: "CUT-01", name: "커팅 1호기" }

assert.deepEqual(
  resolveActualProductionEquipment({
    workOrderOperationAssignment: { equipment: assignmentEquipment },
    workOrderOperation: { equipment: fallbackEquipment },
  }),
  assignmentEquipment,
)
ok(true, "ProductionResult assignment equipment overrides representative operation equipment")

assert.deepEqual(
  resolveActualProductionEquipment({
    workOrderOperationAssignment: null,
    workOrderOperation: { equipment: fallbackEquipment },
  }),
  fallbackEquipment,
)
ok(true, "ProductionResult without assignment falls back to operation equipment")

assert.equal(
  resolveActualProductionEquipment({
    workOrderOperationAssignment: null,
    workOrderOperation: { equipment: null },
  }),
  null,
)
ok(true, "ProductionResult without assignment or operation equipment remains unattributed")

const singleWhere = actualProductionEquipmentWhere("eq-actual") as any
assert.equal(singleWhere.OR[0].workOrderOperationAssignment.equipmentId, "eq-actual")
assert.equal(singleWhere.OR[1].workOrderOperationAssignmentId, null)
assert.equal(singleWhere.OR[1].workOrderOperation.equipmentId, "eq-actual")
ok(true, "single-equipment filter targets assignment first and legacy fallback only when no assignment exists")

const multiWhere = actualProductionEquipmentWhere(["eq-actual", "eq-other"]) as any
assert.deepEqual(multiWhere.OR[0].workOrderOperationAssignment.equipmentId, {
  in: ["eq-actual", "eq-other"],
})
assert.equal(multiWhere.OR[1].workOrderOperationAssignmentId, null)
assert.deepEqual(multiWhere.OR[1].workOrderOperation.equipmentId, {
  in: ["eq-actual", "eq-other"],
})
ok(true, "multi-equipment filter preserves the same actual-equipment attribution policy")

const emptyWhere = actualProductionEquipmentWhere([])
assert.deepEqual(emptyWhere, {})
ok(true, "empty equipment filter leaves ProductionResult query unfiltered by equipment")

const equipmentStatisticsActions = read("src/lib/actions/equipment-statistics.actions.ts")
const kpiActions = read("src/lib/actions/kpi.actions.ts")
const productionResultActions = read("src/lib/actions/production-result.actions.ts")
const equipmentOutputActions = read("src/lib/actions/equipment-output.actions.ts")
const reportHelpers = read("src/lib/actions/report.helpers.ts")

ok(
  (equipmentStatisticsActions.match(/actualProductionEquipmentWhere\(/g) ?? []).length >= 3,
  "equipment statistics production/work-time/capacity queries use actual equipment filters",
)
ok(
  (equipmentStatisticsActions.match(/resolveActualProductionEquipment\(/g) ?? []).length >= 3,
  "equipment statistics production/work-time/capacity rows resolve actual equipment before aggregation",
)
ok(
  (kpiActions.match(/actualProductionEquipmentWhere\(f\.equipmentIds\)/g) ?? []).length >= 2,
  "KPI labor effort and UPH equipment filters use actual equipment attribution",
)
ok(
  productionResultActions.includes("resolveActualProductionEquipment(r)"),
  "production result list uses the shared actual equipment resolver",
)
ok(
  equipmentOutputActions.includes("resolveActualProductionEquipment(r)"),
  "equipment output keeps using assignment-first actual equipment resolution",
)
ok(
  reportHelpers.includes("row.goodQty += p.goodQty") &&
    reportHelpers.includes("row.workHours += w.hours") &&
    reportHelpers.includes("row.hours += w.hours"),
  "equipment report aggregates multi-equipment production and work-time rows instead of overwriting by date",
)
ok(
  !equipmentStatisticsActions.includes("...(f.equipmentId ? { equipmentId: f.equipmentId } : {})") &&
    !equipmentStatisticsActions.includes("...(filter.equipmentId ? { equipmentId: filter.equipmentId } : {})"),
  "equipment statistics no longer filters ProductionResult through representative WorkOrderOperation.equipmentId",
)
ok(
  !kpiActions.includes("...(f.equipmentIds?.length && { equipmentId: { in: f.equipmentIds } })"),
  "KPI production-result metrics no longer filter through representative WorkOrderOperation.equipmentId",
)

console.log(`\\n${passed} equipment result attribution checks passed.`)
