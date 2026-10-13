import { readFileSync } from "fs"

function read(path: string) {
  return readFileSync(path, "utf8")
}

function ok(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
  console.log(`✓ ${message}`)
}

function bodyOf(source: string, name: string) {
  let start = source.indexOf(`export async function ${name}`)
  if (start < 0) start = source.indexOf(`async function ${name}`)
  ok(start >= 0, `${name} exists`)
  const nextExport = source.indexOf("\nexport async function ", start + 1)
  const nextHelper = source.indexOf("\nasync function ", start + 1)
  const next = [nextExport, nextHelper].filter((index) => index >= 0).sort((a, b) => a - b)[0]
  return source.slice(start, next >= 0 ? next : source.length)
}

const schema = read("prisma/schema.prisma")
const equipmentManagement = read("src/lib/actions/equipment-management.actions.ts")
const statistics = read("src/lib/actions/equipment-statistics.actions.ts")
const downtimeReason = read("src/lib/actions/downtime-reason.actions.ts")
const referenceCheck = read("src/lib/actions/reference-check.server.ts")
const packageJson = read("package.json")

ok(/enum EquipmentDowntimeKind\s*\{[\s\S]*PLANNED[\s\S]*UNPLANNED[\s\S]*\}/.test(schema), "F16: downtime distinguishes planned and unplanned reasons")
ok(/model EquipmentDowntime/.test(schema), "F16: EquipmentDowntime model exists")
ok(/reason\s+CommonCode\s+@relation\("DowntimeReason"/.test(schema), "F16: downtime records reference DOWNTIME_REASON CommonCode")
ok(/equipmentEvent\s+EquipmentEvent\?\s+@relation\("EquipmentEventDowntime"/.test(schema), "F16: downtime records link to the actual EquipmentEvent")
ok(/repairRequest\s+EquipmentRepairRequest\?/.test(schema), "F16: downtime can be tied to repair request history")
ok(/model EquipmentMaintenancePlan/.test(schema), "F16: preventive maintenance plan model exists")
ok(/model EquipmentMaintenanceHistory/.test(schema), "F16: preventive maintenance execution history model exists")
ok(/@@unique\(\[planId, scheduledAt\]\)/.test(schema), "F16: one scheduled preventive maintenance occurrence can be completed once")
ok(/lastCompletedAt\s+DateTime\?/.test(schema) && /nextDueAt\s+DateTime/.test(schema), "F16: maintenance plan stores last completion and next due date")

const createDowntime = bodyOf(equipmentManagement, "createEquipmentDowntime")
ok(/requireResourcePermission\("EQUIPMENT_REPAIR", "CREATE"\)/.test(createDowntime), "F16: downtime creation uses existing EQUIPMENT_REPAIR CREATE guard")
ok(/requireDowntimeReason\(tenantId, data\.reasonId\)/.test(createDowntime), "F16: downtime creation validates reason through DOWNTIME_REASON")
ok(/assertNoDowntimeOverlap/.test(createDowntime), "F16: downtime creation blocks overlapping equipment downtime")
ok(/equipmentEvent\.create/.test(createDowntime) && /equipmentDowntime\.create/.test(createDowntime), "F16: downtime creation creates event and downtime record in one action")
ok(/duration:\s*endedAt \? secondsBetween\(startedAt, endedAt\) : null/.test(createDowntime), "F16: downtime event duration is derived from startedAt/endedAt")
ok(/recordAuditLog\(tx,[\s\S]*entityType: "EquipmentDowntime"/.test(createDowntime), "F16: downtime creation writes audit log inside transaction")

const endDowntime = bodyOf(equipmentManagement, "endEquipmentDowntime")
ok(/requireResourcePermission\("EQUIPMENT_REPAIR", "UPDATE"\)/.test(endDowntime), "F16: downtime completion uses existing EQUIPMENT_REPAIR UPDATE guard")
ok(/equipmentEvent\.update/.test(endDowntime) && /duration: secondsBetween\(current\.startedAt, endedAt\)/.test(endDowntime), "F16: ending downtime updates linked EquipmentEvent duration from timestamps")
ok(/recordAuditLog\(tx,[\s\S]*entityType: "EquipmentDowntime"/.test(endDowntime), "F16: downtime completion writes audit log inside transaction")

const createPlan = bodyOf(equipmentManagement, "createMaintenancePlan")
ok(/requireResourcePermission\("EQUIPMENT_REPAIR", "CREATE"\)/.test(createPlan), "F16: maintenance plan creation uses existing EQUIPMENT_REPAIR CREATE guard")
ok(/cycleValue/.test(createPlan) && /cycleValue <= 0/.test(createPlan), "F16: maintenance plan validates cycle value")
ok(/recordAuditLog\(tx,[\s\S]*entityType: "EquipmentMaintenancePlan"/.test(createPlan), "F16: maintenance plan creation is audited")

const completePlan = bodyOf(equipmentManagement, "completeMaintenancePlan")
ok(/requireResourcePermission\("EQUIPMENT_REPAIR", "UPDATE"\)/.test(completePlan), "F16: maintenance completion uses existing EQUIPMENT_REPAIR UPDATE guard")
ok(/completedAt < plan\.nextDueAt/.test(completePlan), "F16: maintenance cannot complete a future occurrence early or double-advance immediately")
ok(/planId_scheduledAt/.test(completePlan), "F16: maintenance completion checks unique scheduled occurrence")
ok(/equipmentMaintenanceHistory\.create/.test(completePlan), "F16: maintenance completion creates execution history")
ok(/equipmentMaintenancePlan\.update/.test(completePlan) && /lastCompletedAt: completedAt/.test(completePlan) && /nextDueAt/.test(completePlan), "F16: maintenance completion advances lastCompletedAt and nextDueAt together")
ok(/addMaintenanceCycle\(completedAt, plan\.cycleValue, plan\.cycleUnit\)/.test(completePlan), "F16: next due date is calculated from actual completion and configured cycle")
ok((completePlan.match(/recordAuditLog\(tx,/g) ?? []).length >= 2, "F16: maintenance completion audits both history creation and plan due-date update")

ok(/prisma\.equipmentDowntime\.findMany/.test(statistics), "F16: downtime statistics read canonical EquipmentDowntime records")
ok(!/eventType: \{ in: \["STOP", "MAINTENANCE"\] \}/.test(bodyOf(statistics, "fetchDowntimeStats")), "F16: downtime statistics no longer bypass reason-linked downtime records")
ok(/checkDowntimeReasonReferencesForBulk\(r\.id\)/.test(downtimeReason), "F16: downtime reason deletion checks the selected reason id")
ok(/equipmentDowntime\.count\(\{ where: \{ reasonId: downtimeReasonId \} \}\)/.test(referenceCheck), "F16: referenced downtime reasons cannot be deleted")
ok(/"test:equipment-downtime-maintenance-integrity"/.test(packageJson), "F16: package script exposes dedicated integrity test")

console.log("\nF16 equipment downtime and preventive maintenance integrity checks passed.")
