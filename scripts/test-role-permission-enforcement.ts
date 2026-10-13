import { readFileSync } from "fs"
import { join } from "path"
import assert from "assert"
import ts from "typescript"

const root = process.cwd()

function read(path: string) {
  return readFileSync(join(root, path), "utf8")
}

function ok(value: unknown, message: string) {
  assert.ok(value, message)
  console.log(`PASS ${message}`)
}

function functionBody(source: string, filePath: string, functionName: string): string {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let body = ""

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName && node.body) {
      body = source.slice(node.body.getStart(sourceFile), node.body.end)
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  assert.ok(body, `${filePath} exports ${functionName}`)
  return body
}

function hasGuard(filePath: string, functionName: string, resource: string, action: string) {
  return functionBody(read(filePath), filePath, functionName).includes(
    `requireResourcePermission("${resource}", "${action}")`
  )
}

const schema = read("prisma/schema.prisma")
const rolePermissions = read("src/lib/auth/role-permissions.ts")
const layout = read("src/app/app/layout.tsx")
const middleware = read("src/middleware.ts")
const permissionActions = read("src/lib/actions/permission.actions.ts")
const productionPlanActions = read("src/lib/actions/production-plan.actions.ts")
const productionPlanPage = read("src/app/app/mes/production-plan/page.tsx")
const productionPlanTable = read("src/app/app/mes/production-plan/plan-data-table.tsx")
const productionPlanColumns = read("src/app/app/mes/production-plan/columns.tsx")
const popActions = read("src/lib/actions/pop.actions.ts")
const shipmentActions = read("src/lib/actions/shipment.actions.ts")
const qualityActions = read("src/lib/actions/quality.actions.ts")

ok(/enum PermissionAction\s*\{[\s\S]*READ[\s\S]*CREATE[\s\S]*UPDATE[\s\S]*DELETE[\s\S]*APPROVE[\s\S]*EXPORT[\s\S]*\}/.test(schema), "RolePermission action enum has READ/CREATE/UPDATE/DELETE plus APPROVE/EXPORT")
ok(/model RolePermission\s*\{[\s\S]*tenantId\s+String[\s\S]*role\s+UserRole[\s\S]*resource\s+String[\s\S]*action\s+PermissionAction[\s\S]*isAllowed\s+Boolean[\s\S]*@@unique\(\[tenantId, role, resource, action\]\)/.test(schema), "RolePermission is tenant scoped by role/resource/action")
ok(/model TenantUser\s*\{[\s\S]*tenantId\s+String[\s\S]*profileId\s+String[\s\S]*role\s+UserRole[\s\S]*isActive\s+Boolean/.test(schema), "TenantUser links one profile to one tenant role with active flag")

ok(rolePermissions.includes('ROLE_PERMISSION_DENIED_MESSAGE = "이 기능을 사용할 권한이 없습니다."'), "server permission helper exposes a generic forbidden message")
ok(/tenantUser\.findFirst\(\{[\s\S]*where:\s*\{\s*profileId,\s*tenantId,\s*isActive:\s*true\s*\}/.test(rolePermissions), "server permission helper re-reads active TenantUser by current tenant")
ok(/rolePermission\.findMany\(\{[\s\S]*where:\s*\{\s*tenantId,\s*role:\s*tenantUser\.role/.test(rolePermissions), "server permission helper reads RolePermission from the current tenant and live role")
ok(!/from "react"/.test(rolePermissions) && !/cache\(/.test(rolePermissions), "server permission helper does not keep RolePermission in a process-global cache")
ok(/if\s*\(tenantUser\.role === "OWNER"\)/.test(rolePermissions), "existing OWNER full-access policy is preserved")
ok(/throw new Error\(ROLE_PERMISSION_DENIED_MESSAGE\)/.test(rolePermissions), "server mutation guard fails before mutation when permission is missing")
ok(/configured\.has\(permissionKey\(resource,\s*"READ"\)\)/.test(rolePermissions), "menu/page READ filtering only applies when a READ row exists")
ok(rolePermissions.includes('"material-return": "PURCHASE_ORDER"') && rolePermissions.includes('"equipment-tools": "EQUIPMENT"') && rolePermissions.includes('spc: "QUALITY_INSPECTION"'), "menu/page READ mapping covers routed MES resources without creating new resource codes")
ok(["SALES_ORDER", "SHIPMENT", "QUOTATION", "COSTING"].every((resource) => permissionActions.includes(`"${resource}"`)), "permission catalog includes seeded sales/quotation/costing resources")

ok(middleware.includes("x-nmes-pathname"), "middleware forwards pathname to the app layout for direct URL guard")
ok(layout.includes("getCurrentPermissionSnapshot(user)") && layout.includes("canReadPath(permissionSnapshot, pathname)") && layout.includes("canReadMenuCode(permissionSnapshot, menuCode)"), "app layout applies RolePermission READ to direct URL and Sidebar")

ok(productionPlanPage.includes('getResourcePermissions("PRODUCTION_PLAN")') && productionPlanPage.includes("if (!permissions.canRead) notFound()"), "production plan page blocks direct URL without READ")
ok((productionPlanActions.match(/requireResourcePermission\("PRODUCTION_PLAN",\s*"READ"\)/g) ?? []).length >= 4, "production plan query and lookup actions require READ")
ok(productionPlanActions.includes('requireResourcePermission("PRODUCTION_PLAN", "CREATE")'), "production plan create path requires CREATE")
ok(productionPlanActions.includes('requireResourcePermission("PRODUCTION_PLAN", "UPDATE")'), "production plan update path requires UPDATE")
ok(productionPlanActions.includes('requireResourcePermission("PRODUCTION_PLAN", "DELETE")'), "production plan delete path requires DELETE")
ok(/const tenantId = user\.tenantId/.test(productionPlanActions), "production plan mutations use server-resolved tenant instead of client tenant")
ok(/where:\s*\{\s*tenantId:\s*user\.tenantId/.test(productionPlanActions), "production plan list queries are tenant scoped")

ok(productionPlanTable.includes("permissions.canCreate"), "production plan create button follows CREATE permission")
ok(productionPlanColumns.includes("canUpdate") && productionPlanColumns.includes("canDeletePlan"), "production plan row actions follow UPDATE/DELETE permissions")

const expectedMutationGuards: Array<[string, string, string, string]> = [
  ["src/lib/actions/business-partner.actions.ts", "createBusinessPartner", "PARTNER_MANAGEMENT", "CREATE"],
  ["src/lib/actions/business-partner.actions.ts", "updateBusinessPartner", "PARTNER_MANAGEMENT", "UPDATE"],
  ["src/lib/actions/business-partner.actions.ts", "deleteBusinessPartner", "PARTNER_MANAGEMENT", "DELETE"],
  ["src/lib/actions/item.actions.ts", "createItem", "ITEM", "CREATE"],
  ["src/lib/actions/item.actions.ts", "updateItem", "ITEM", "UPDATE"],
  ["src/lib/actions/item.actions.ts", "deleteItem", "ITEM", "DELETE"],
  ["src/lib/actions/bom.actions.ts", "createBom", "BOM", "CREATE"],
  ["src/lib/actions/bom.actions.ts", "updateBom", "BOM", "UPDATE"],
  ["src/lib/actions/bom.actions.ts", "deleteBom", "BOM", "DELETE"],
  ["src/lib/actions/routing.actions.ts", "createRouting", "ROUTING", "CREATE"],
  ["src/lib/actions/routing.actions.ts", "updateRouting", "ROUTING", "UPDATE"],
  ["src/lib/actions/routing.actions.ts", "deleteRouting", "ROUTING", "DELETE"],
  ["src/lib/actions/sales-order.actions.ts", "createSalesOrder", "SALES_ORDER", "CREATE"],
  ["src/lib/actions/sales-order.actions.ts", "updateSalesOrder", "SALES_ORDER", "UPDATE"],
  ["src/lib/actions/sales-order.actions.ts", "deleteSalesOrder", "SALES_ORDER", "DELETE"],
  ["src/lib/actions/production-plan.actions.ts", "createPlan", "PRODUCTION_PLAN", "CREATE"],
  ["src/lib/actions/production-plan.actions.ts", "updatePlan", "PRODUCTION_PLAN", "UPDATE"],
  ["src/lib/actions/production-plan.actions.ts", "deletePlan", "PRODUCTION_PLAN", "DELETE"],
  ["src/lib/actions/work-order.actions.ts", "createWorkOrder", "WORK_ORDER", "CREATE"],
  ["src/lib/actions/work-order.actions.ts", "updateWorkOrder", "WORK_ORDER", "UPDATE"],
  ["src/lib/actions/work-order.actions.ts", "deleteWorkOrder", "WORK_ORDER", "DELETE"],
  ["src/lib/actions/material-issue.actions.ts", "issueMaterialsForWorkOrder", "PURCHASE_ORDER", "CREATE"],
  ["src/lib/actions/purchase-order.actions.ts", "createPurchaseOrder", "PURCHASE_ORDER", "CREATE"],
  ["src/lib/actions/purchase-order.actions.ts", "updatePurchaseOrder", "PURCHASE_ORDER", "UPDATE"],
  ["src/lib/actions/purchase-order.actions.ts", "deletePurchaseOrder", "PURCHASE_ORDER", "DELETE"],
  ["src/lib/actions/receiving.actions.ts", "createReceivingInspection", "PURCHASE_ORDER", "CREATE"],
  ["src/lib/actions/inventory.actions.ts", "createTransaction", "INVENTORY_TXN", "CREATE"],
  ["src/lib/actions/inventory.actions.ts", "adjustInventoryStock", "INVENTORY", "UPDATE"],
  ["src/lib/actions/finished-goods.actions.ts", "createFinishedGoodsReceiptAction", "WORK_RESULT", "CREATE"],
  ["src/lib/actions/process-progress.actions.ts", "updateOperationStatusAction", "WORK_RESULT", "UPDATE"],
  ["src/lib/actions/lot.actions.ts", "createLot", "LOT", "CREATE"],
  ["src/lib/actions/lot.actions.ts", "updateLotStatus", "LOT", "UPDATE"],
  ["src/lib/actions/lot-reservation.actions.ts", "reserveReceivingLotNumber", "PURCHASE_ORDER", "CREATE"],
  ["src/lib/actions/lot-reservation.actions.ts", "markLotReservationPrinted", "PURCHASE_ORDER", "CREATE"],
  ["src/lib/actions/numbering-rule.actions.ts", "upsertNumberingRule", "LOT", "UPDATE"],
  ["src/lib/actions/outsourcing.actions.ts", "createOutsourcingOrder", "PURCHASE_ORDER", "CREATE"],
  ["src/lib/actions/outsourcing.actions.ts", "issueWipUnitToOutsourcing", "PURCHASE_ORDER", "UPDATE"],
  ["src/lib/actions/outsourcing.actions.ts", "receiveWipUnitFromOutsourcing", "PURCHASE_ORDER", "UPDATE"],
  ["src/lib/actions/outsourcing.actions.ts", "inspectOutsourcedWipUnit", "QUALITY_INSPECTION", "CREATE"],
  ["src/lib/actions/quality.actions.ts", "createQualityInspection", "QUALITY_INSPECTION", "CREATE"],
  ["src/lib/actions/quality.actions.ts", "updateInspectionResult", "QUALITY_INSPECTION", "UPDATE"],
  ["src/lib/actions/quality.actions.ts", "deleteQualityInspection", "QUALITY_INSPECTION", "DELETE"],
  ["src/lib/actions/quality.actions.ts", "createDefectCode", "DEFECT_MANAGEMENT", "CREATE"],
  ["src/lib/actions/quality.actions.ts", "updateDefectCode", "DEFECT_MANAGEMENT", "UPDATE"],
  ["src/lib/actions/quality.actions.ts", "deleteDefectCode", "DEFECT_MANAGEMENT", "DELETE"],
  ["src/lib/actions/defect-cause-analysis.actions.ts", "createDefectCauseAnalysis", "DEFECT_MANAGEMENT", "CREATE"],
  ["src/lib/actions/defect-cause-analysis.actions.ts", "updateDefectCauseAnalysis", "DEFECT_MANAGEMENT", "UPDATE"],
  ["src/lib/actions/defect-corrective-action.actions.ts", "createDefectCorrectiveAction", "DEFECT_MANAGEMENT", "CREATE"],
  ["src/lib/actions/defect-corrective-action.actions.ts", "updateDefectCorrectiveAction", "DEFECT_MANAGEMENT", "UPDATE"],
  ["src/lib/actions/defect-recurrence-prevention.actions.ts", "createDefectRecurrencePrevention", "DEFECT_MANAGEMENT", "CREATE"],
  ["src/lib/actions/defect-recurrence-prevention.actions.ts", "updateDefectRecurrencePrevention", "DEFECT_MANAGEMENT", "UPDATE"],
  ["src/lib/actions/equipment.actions.ts", "createEquipment", "EQUIPMENT", "CREATE"],
  ["src/lib/actions/equipment.actions.ts", "updateEquipment", "EQUIPMENT", "UPDATE"],
  ["src/lib/actions/equipment.actions.ts", "deleteEquipment", "EQUIPMENT", "DELETE"],
  ["src/lib/actions/tool.actions.ts", "createTool", "EQUIPMENT", "CREATE"],
  ["src/lib/actions/tool.actions.ts", "updateTool", "EQUIPMENT", "UPDATE"],
  ["src/lib/actions/tool.actions.ts", "deleteTool", "EQUIPMENT", "DELETE"],
  ["src/lib/actions/shipment.actions.ts", "createShipment", "SHIPMENT", "CREATE"],
  ["src/lib/actions/shipment.actions.ts", "confirmShipment", "SHIPMENT", "UPDATE"],
  ["src/lib/actions/shipment.actions.ts", "deleteShipment", "SHIPMENT", "DELETE"],
  ["src/lib/actions/user-management.actions.ts", "updateUserRole", "USER_MANAGEMENT", "UPDATE"],
  ["src/lib/actions/user-management.actions.ts", "deleteUserPermanently", "USER_MANAGEMENT", "DELETE"],
]

for (const [filePath, functionName, resource, action] of expectedMutationGuards) {
  ok(hasGuard(filePath, functionName, resource, action), `${resource} ${action} server guard protects ${functionName}`)
}

ok(/rolePermission\.findFirst\(\{\s*where:\s*\{\s*id,\s*tenantId:\s*actor\.tenantId\s*\}/.test(permissionActions), "single permission update is scoped to actor tenant")
ok(/rolePermission\.findMany\(\{[\s\S]*where:\s*\{\s*id:\s*\{\s*in:\s*ids\s*\},\s*tenantId:\s*actor\.tenantId\s*\}/.test(permissionActions), "bulk permission update verifies all target rows are in actor tenant")
ok(/rolePermission\.updateMany\(\{[\s\S]*where:\s*\{\s*id,\s*tenantId:\s*actor\.tenantId\s*\}/.test(permissionActions), "bulk permission update writes with tenant guard")
ok(permissionActions.includes('if (perm.role === "OWNER") throw new Error("OWNER 권한은 수정할 수 없습니다.")'), "OWNER permission rows remain immutable")

ok(!popActions.includes("role-permissions"), "POP worker actions are not tied to general MES RolePermission")
ok(shipmentActions.includes("assertLotQualityReleaseAllowed"), "F06 shipment confirmation keeps F05 quality release revalidation")
ok(qualityActions.includes("assertInspectionHistoryMutable"), "F07 quality/CAPA history guard remains wired")

console.log("PASS role-permission-enforcement static checks complete")
