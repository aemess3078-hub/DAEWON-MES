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
  return source.slice(start, next ?? source.length)
}

function requiresAudit(source: string, name: string, entity: string) {
  const body = bodyOf(source, name)
  ok(/recordAuditLog\(tx,/.test(body), `${name}: audit log is written inside transaction`)
  ok(body.includes(`entityType: "${entity}"`), `${name}: audit entityType is ${entity}`)
}

function hasSensitiveSanitizer(source: string) {
  ok(/sanitizeAuditValue/.test(source), "audit helper exposes sanitizer")
  ok(/passwordhash|pinhash|fingerprint|accesstoken|refreshtoken|apikey/i.test(source), "audit sanitizer removes credential/token material")
  ok(!/catch\s*\(\)\s*=>\s*\{\}/.test(source), "audit helper does not silently swallow audit write failures")
}

const schema = read("prisma/schema.prisma")
const helper = read("src/lib/audit-log.ts")
const nav = read("src/lib/nav-config.ts")
const permissions = read("src/lib/auth/role-permissions.ts")
const auditPage = read("src/app/app/mes/audit-log/page.tsx")
const auditTable = read("src/app/app/mes/users/audit-log-table.tsx")
const userManagement = read("src/lib/actions/user-management.actions.ts")

const salesOrder = read("src/lib/actions/sales-order.actions.ts")
const productionPlan = read("src/lib/actions/production-plan.actions.ts")
const workOrder = read("src/lib/actions/work-order.actions.ts")
const materialIssue = read("src/lib/actions/material-issue.actions.ts")
const finishedGoods = read("src/lib/actions/finished-goods.actions.ts")
const shipment = read("src/lib/actions/shipment.actions.ts")
const purchaseOrder = read("src/lib/actions/purchase-order.actions.ts")
const receiving = read("src/lib/actions/receiving.actions.ts")
const outsourcing = read("src/lib/actions/outsourcing.actions.ts")
const quality = read("src/lib/actions/quality.actions.ts")
const equipmentManagement = read("src/lib/actions/equipment-management.actions.ts")
const permissionActions = read("src/lib/actions/permission.actions.ts")

ok(/model AuditLog/.test(schema), "existing AuditLog model is retained")
ok((schema.match(/model AuditLog/g) ?? []).length === 1, "no duplicate AuditLog2/event-store model was added")
ok(/enum AuditAction/.test(schema) && /CREATE/.test(schema) && /UPDATE/.test(schema) && /DELETE/.test(schema), "AuditAction supports CRUD actions")
hasSensitiveSanitizer(helper)
ok(/await db\.auditLog\.create/.test(helper), "recordAuditLog writes through the provided db/transaction client")
ok(/Prisma\.JsonNull/.test(helper), "recordAuditLog handles JSON null explicitly")

ok(/nav-audit-log/.test(nav) && /\/app\/mes\/audit-log/.test(nav), "AUDIT_LOG has a dedicated menu route")
ok(/"audit-log": "AUDIT_LOG"/.test(permissions), "AUDIT_LOG route maps to RolePermission resource")
ok(/requireResourcePermission\("AUDIT_LOG", "READ"\)/.test(userManagement), "AuditLog query is protected by AUDIT_LOG READ")
ok(/getAuditLogs\(\{ days: 90/.test(auditPage), "dedicated AuditLog page loads paginated audit rows")
ok(/entityType/.test(auditTable) && /변경 전후/.test(auditTable), "AuditLog UI exposes entity filter and before/after detail")

requiresAudit(salesOrder, "createSalesOrder", "SalesOrder")
requiresAudit(salesOrder, "updateSalesOrder", "SalesOrder")
requiresAudit(salesOrder, "deleteSalesOrder", "SalesOrder")
requiresAudit(salesOrder, "requestProductionFromSalesOrder", "ProductionPlan")
requiresAudit(productionPlan, "createPlan", "ProductionPlan")
requiresAudit(productionPlan, "updatePlan", "ProductionPlan")
requiresAudit(productionPlan, "deletePlan", "ProductionPlan")
requiresAudit(workOrder, "createWorkOrder", "WorkOrder")
requiresAudit(workOrder, "updateWorkOrder", "WorkOrder")
requiresAudit(workOrder, "releaseWorkOrder", "WorkOrder")
requiresAudit(workOrder, "deleteWorkOrder", "WorkOrder")
requiresAudit(materialIssue, "issueMaterialsForWorkOrder", "MaterialIssue")
requiresAudit(finishedGoods, "createFinishedGoodsReceiptAction", "FinishedGoodsReceipt")
requiresAudit(shipment, "createShipment", "ShipmentOrder")
requiresAudit(shipment, "confirmShipment", "ShipmentOrder")
requiresAudit(shipment, "deleteShipment", "ShipmentOrder")
requiresAudit(purchaseOrder, "createPurchaseOrder", "PurchaseOrder")
requiresAudit(purchaseOrder, "updatePurchaseOrder", "PurchaseOrder")
requiresAudit(purchaseOrder, "deletePurchaseOrder", "PurchaseOrder")
requiresAudit(receiving, "createReceivingInspectionInternal", "ReceivingInspection")
requiresAudit(outsourcing, "createOutsourcingOrder", "OutsourcingOrder")
requiresAudit(outsourcing, "issueWipUnitToOutsourcing", "WipMovement")
requiresAudit(outsourcing, "receiveWipUnitFromOutsourcing", "WipMovement")
requiresAudit(outsourcing, "inspectOutsourcedWipUnit", "WipMovement")
requiresAudit(quality, "createQualityInspection", "QualityInspection")
requiresAudit(quality, "updateInspectionResult", "QualityInspection")
requiresAudit(quality, "deleteQualityInspection", "QualityInspection")
requiresAudit(equipmentManagement, "createProblemType", "EquipmentProblemType")
requiresAudit(equipmentManagement, "updateProblemType", "EquipmentProblemType")
requiresAudit(equipmentManagement, "deleteProblemType", "EquipmentProblemType")
requiresAudit(equipmentManagement, "createRepairRequest", "EquipmentRepairRequest")
requiresAudit(equipmentManagement, "updateRepairStatus", "EquipmentRepairRequest")
requiresAudit(equipmentManagement, "updateRepairRequest", "EquipmentRepairRequest")
requiresAudit(equipmentManagement, "deleteRepairRequest", "EquipmentRepairRequest")
requiresAudit(permissionActions, "updatePermission", "RolePermission")
requiresAudit(permissionActions, "bulkUpdatePermissions", "RolePermission")

ok(!/AuditLog2|eventSourcing|SIEM/i.test(helper + schema), "F15 stays on existing AuditLog without AuditLog2/event-sourcing/SIEM")
ok(!/passwordHash|popPinHash|popPinFingerprint/.test(auditTable), "audit log UI does not expose credential hashes")

console.log("\nCore audit-log coverage checks passed.")

