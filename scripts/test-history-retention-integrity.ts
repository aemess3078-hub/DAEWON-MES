import { readFileSync } from "fs"

function read(path: string) {
  return readFileSync(path, "utf8")
}

function ok(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
  console.log(`✓ ${message}`)
}

function bodyOf(source: string, exportName: string) {
  let start = source.indexOf(`export async function ${exportName}`)
  if (start < 0) start = source.indexOf(`async function ${exportName}`)
  ok(start >= 0, `${exportName} export exists`)
  const nextExport = source.indexOf("\nexport async function ", start + 1)
  const nextHelper = source.indexOf("\nasync function ", start + 1)
  const next = [nextExport, nextHelper].filter((index) => index >= 0).sort((a, b) => a - b)[0]
  return source.slice(start, next ?? source.length)
}

const schema = read("prisma/schema.prisma")
const shipment = read("src/lib/actions/shipment.actions.ts")
const equipment = read("src/lib/actions/equipment.actions.ts")
const equipmentManagement = read("src/lib/actions/equipment-management.actions.ts")
const purchaseOrder = read("src/lib/actions/purchase-order.actions.ts")
const finishedGoods = read("src/lib/actions/finished-goods.actions.ts")
const materialIssue = read("src/lib/actions/material-issue.actions.ts")
const materialReturn = read("src/lib/actions/material-return.actions.ts")
const inventory = read("src/lib/actions/inventory.actions.ts")
const quality = read("src/lib/actions/quality.actions.ts")
const outsourcing = read("src/lib/actions/outsourcing.actions.ts")
const lotLineage = read("src/lib/actions/lot-lineage.actions.ts")

const deleteShipment = bodyOf(shipment, "deleteShipment")
const confirmShipment = bodyOf(shipment, "confirmShipment")
ok(/status !== "PLANNED"/.test(deleteShipment), "F06/F14: only PLANNED shipments can be hard-deleted")
ok(!/inventoryTransaction\.deleteMany|inventoryTransaction\.delete\(/.test(deleteShipment), "F14: shipment delete does not erase inventory transaction history")
ok(!/shipmentOrder\.deleteMany/.test(deleteShipment), "F14: shipment delete is scoped to the selected order, not bulk destructive delete")
ok(/inventoryTransaction\.create/.test(confirmShipment) && /txType:\s*"ISSUE"/.test(confirmShipment), "F06/F14: SHIPPED confirmation creates ISSUE history")
ok(/resolveSalesOrderStatusAfterShipmentRollback/.test(confirmShipment), "F14: shippedQty/status rollback semantics from F06 remain wired after shipment confirmation")

const createReceipt = bodyOf(finishedGoods, "createFinishedGoodsReceiptAction")
ok(/finishedGoodsReceipt\.create/.test(createReceipt), "F14: finished-goods receipt keeps a receipt row")
ok(/inventoryTransaction\.create/.test(createReceipt) && /txType:\s*"RECEIPT"/.test(createReceipt), "F14: finished-goods receipt creates RECEIPT transaction history")
ok(!/finishedGoodsReceipt\.(delete|deleteMany)|inventoryTransaction\.(delete|deleteMany)/.test(finishedGoods), "F14: finished-goods actions do not provide destructive receipt/transaction deletion")

const issueMaterials = bodyOf(materialIssue, "issueMaterialsForWorkOrder")
ok(/inventoryTransaction\.create/.test(issueMaterials) && /txType:\s*"ISSUE"/.test(issueMaterials), "F10/F14: material issue creates ISSUE transaction history")
ok(/wipMovement\.create/.test(issueMaterials) && /movementType:\s*"CREATED"/.test(issueMaterials), "F14: material issue preserves WIP creation movement history")
ok(!/inventoryTransaction\.(delete|deleteMany)/.test(materialIssue), "F14: material issue actions do not erase transaction history")

const deleteMaterialReturn = bodyOf(materialReturn, "deleteMaterialReturn")
const cancelMaterialReturn = bodyOf(materialReturn, "cancelMaterialReturn")
const completeMaterialReturn = bodyOf(materialReturn, "completeMaterialReturn")
ok(/status !== "DRAFT"/.test(deleteMaterialReturn), "F14: only DRAFT supplier returns can be hard-deleted")
ok(/status:\s*"CANCELLED"/.test(cancelMaterialReturn), "F14: DRAFT supplier returns are cancelled by status")
ok(/inventoryTransaction\.create/.test(completeMaterialReturn) && /txType:\s*"SUPPLIER_RETURN"/.test(completeMaterialReturn), "F14: completed supplier returns create SUPPLIER_RETURN transaction history")
ok(/updateMany\(\{\s*where:\s*\{ id: current\.id, tenantId, status: "DRAFT" \}/.test(completeMaterialReturn), "F11/F14: supplier return completion uses conditional state claim")

ok(/기존 입출고 InventoryTransaction은 수정\/삭제하지 않는다/.test(inventory), "F14: stock adjustment documents append-only transaction policy")
ok(/txType:\s*TransactionType\.ADJUST/.test(inventory), "F14: stock adjustment uses ADJUST instead of rewriting old transactions")
ok(!/export async function delete.*Inventory|inventoryTransaction\.(delete|deleteMany|update|updateMany)/i.test(inventory), "F14: inventory transaction UI/actions do not expose destructive transaction mutation")

const deleteEquipment = bodyOf(equipment, "deleteEquipment")
ok(/equipmentEvent\.count/.test(deleteEquipment), "F14: equipment deletion checks EquipmentEvent history")
ok(!/equipmentEvent\.deleteMany/.test(deleteEquipment), "F14: equipment deletion no longer deletes EquipmentEvent history")
ok(/equipmentRepairRequest\.count/.test(deleteEquipment), "F14: equipment deletion checks repair request history")
ok(/equipmentDailyCheck\.count/.test(deleteEquipment), "F14: equipment deletion checks daily check history")
ok(/equipmentUsageHistory\.count/.test(deleteEquipment), "F14: equipment deletion checks usage history")

const deleteProblemType = bodyOf(equipmentManagement, "deleteProblemType")
const updateRepairRequest = bodyOf(equipmentManagement, "updateRepairRequest")
const deleteRepairRequest = bodyOf(equipmentManagement, "deleteRepairRequest")
ok(/equipmentRepairRequest\.count/.test(deleteProblemType), "F14: problem type deletion is blocked when repair history exists")
ok(/current\.status === "COMPLETED" \|\| current\.status === "CANCELLED"/.test(updateRepairRequest), "F14: completed/cancelled repair requests cannot be rewritten")
ok(/current\.status !== "OPEN"/.test(deleteRepairRequest), "F14: only untouched OPEN repair requests can be hard-deleted")

const deleteQualityInspection = bodyOf(quality, "deleteQualityInspection")
ok(/assertInspectionHistoryMutable\(tx, id, tenantId\)/.test(deleteQualityInspection), "F07/F14: QualityInspection destructive delete remains guarded by downstream history")
ok(/defectRecords DefectRecord\[\]/.test(schema) && /causeAnalysis\s+DefectCauseAnalysis\?/.test(schema), "F07/F14: inspection to defect to cause relation remains in schema")
ok(/correctiveActions\s+DefectCorrectiveAction\[\]/.test(schema), "F07/F14: defect to corrective-action relation remains in schema")
ok(/recurrencePreventions\s+DefectRecurrencePrevention\[\]/.test(schema), "F07/F14: defect to recurrence-prevention relation remains in schema")

const assertPoHistory = bodyOf(purchaseOrder, "assertPurchaseOrderHasNoOperationalHistory")
const updatePo = bodyOf(purchaseOrder, "updatePurchaseOrder")
const deletePo = bodyOf(purchaseOrder, "deletePurchaseOrder")
ok(/receivingInspection\.count/.test(assertPoHistory), "F14: purchase order history guard checks receiving inspections")
ok(/materialReturnItem\.count/.test(assertPoHistory), "F14: purchase order history guard checks completed supplier returns")
ok(/wipMovement\.count/.test(assertPoHistory) && /sourceType:\s*"PurchaseOrderItem"/.test(assertPoHistory), "F13/F14: purchase order history guard checks outsourcing WIP movements")
ok(/assertPurchaseOrderHasNoOperationalHistory\(tx, id, tenantId\)/.test(updatePo), "F14: purchase order item replacement is guarded before deleteMany")
ok(/data\.supplierId !== undefined && data\.supplierId !== current\.supplierId/.test(updatePo), "F14: supplier rewrite is guarded when purchase order has history")
ok(/status !== "DRAFT"/.test(deletePo), "F14: only DRAFT purchase orders can be hard-deleted")
ok(/assertPurchaseOrderHasNoOperationalHistory\(tx, id, tenantId\)/.test(deletePo), "F14: purchase order delete checks downstream history before deleting items")

ok(/sourceType:\s*"PurchaseOrderItem"/.test(outsourcing), "F13/F14: outsource issue/receive keeps PO item as movement source")
ok(!/wipMovement\.(delete|deleteMany|update|updateMany)/.test(outsourcing), "F14: outsourcing actions do not rewrite/delete WIP movement history")
ok(/outsourcingHistory/.test(lotLineage), "F12/F14: LOT lineage includes outsourcing history")

ok(/enum TransactionType\s*\{[\s\S]*RECEIPT[\s\S]*ISSUE[\s\S]*ADJUST[\s\S]*RETURN[\s\S]*SUPPLIER_RETURN[\s\S]*\}/.test(schema), "F14: existing transaction types cover receipt, issue, return, adjustment, and supplier return without new schema")
ok(/model InventoryTransaction/.test(schema) && /@@index\(\[tenantId, refType, refId\]\)/.test(schema), "F14: inventory transaction refType/refId lineage index remains available")

console.log("F14 history retention integrity source audit passed.")
