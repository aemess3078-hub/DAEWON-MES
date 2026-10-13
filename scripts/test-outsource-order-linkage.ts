import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${passed}: ${name}`)
}

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8")
}

const schema = read("prisma/schema.prisma")
const migration = read("prisma/migrations_legacy_nmes/20260909000000_add_outsource_order_operation_linkage/migration.sql")
const actions = read("src/lib/actions/outsourcing.actions.ts")
const ui = read("src/app/app/mes/production/outsourcing/outsourcing-client.tsx")
const permissions = read("src/lib/auth/role-permissions.ts")
const f12Lineage = read("src/lib/actions/lot-lineage.actions.ts")
const concurrency = read("src/lib/quantity-concurrency.ts")

check("PurchaseOrderItem has nullable workOrderOperationId", () => {
  assert.match(schema, /model PurchaseOrderItem[\s\S]*workOrderOperationId\s+String\?/)
})
check("PurchaseOrderItem links to WorkOrderOperation with an explicit relation", () => {
  assert.match(schema, /workOrderOperation\s+WorkOrderOperation\?\s+@relation\("OutsourcingOperationPurchaseItems", fields: \[workOrderOperationId\], references: \[id\]\)/)
})
check("WorkOrderOperation exposes 1:N purchaseOrderItems for multiple outsource orders", () => {
  assert.match(schema, /purchaseOrderItems\s+PurchaseOrderItem\[\]\s+@relation\("OutsourcingOperationPurchaseItems"\)/)
})
check("migration adds only the nullable operation FK column", () => {
  assert.match(migration, /ALTER TABLE "PurchaseOrderItem" ADD COLUMN "workOrderOperationId" TEXT/)
})
check("migration FK uses RESTRICT and CASCADE update", () => {
  assert.match(migration, /REFERENCES "WorkOrderOperation"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/)
})
check("migration indexes workOrderOperationId", () => {
  assert.match(migration, /CREATE INDEX "PurchaseOrderItem_workOrderOperationId_idx"/)
})
check("outsourcing remains mapped to PURCHASE_ORDER resource", () => {
  assert.match(permissions, /outsourcing:\s+"PURCHASE_ORDER"/)
})
check("createOutsourcingOrder keeps PURCHASE_ORDER CREATE guard", () => {
  assert.match(actions, /createOutsourcingOrder[\s\S]*requireResourcePermission\("PURCHASE_ORDER", "CREATE"\)/)
})
check("issueWipUnitToOutsourcing keeps PURCHASE_ORDER UPDATE guard", () => {
  assert.match(actions, /issueWipUnitToOutsourcing[\s\S]*requireResourcePermission\("PURCHASE_ORDER", "UPDATE"\)/)
})
check("inspectOutsourcedWipUnit keeps QUALITY_INSPECTION CREATE guard", () => {
  assert.match(actions, /inspectOutsourcedWipUnit[\s\S]*requireResourcePermission\("QUALITY_INSPECTION", "CREATE"\)/)
})
check("issue validates PurchaseOrder tenant and outsourcing marker", () => {
  assert.match(actions, /purchaseOrder\.tenantId !== tenantId \|\| !isOutsourcingPurchaseOrder\(purchaseOrder\)/)
})
check("issue validates supplier tenant/type", () => {
  assert.match(actions, /purchaseOrder\.supplier\.tenantId !== tenantId/)
  assert.match(actions, /SUPPLIER", "BOTH"/)
})
check("issue validates purchase order site equals work order site", () => {
  assert.match(actions, /purchaseOrder\.siteId !== wipUnit\.workOrderOperation\.workOrder\.siteId/)
})
check("issue creates PurchaseOrderItem with workOrderOperationId", () => {
  assert.match(actions, /purchaseOrderItem\.create\([\s\S]*workOrderOperationId: wipUnit\.workOrderOperationId/)
})
check("issue rejects same PO same item linked to another operation", () => {
  assert.match(actions, /같은 외주발주에 동일 품목의 다른 공정을 함께 연결할 수 없습니다/)
})
check("issue movement references PurchaseOrderItem instead of PurchaseOrder header", () => {
  assert.match(actions, /sourceType: "PurchaseOrderItem"/)
  assert.match(actions, /sourceId: orderItem\.id/)
})
check("receive resolves PO item from latest OUTSOURCED movement sourceId", () => {
  assert.match(actions, /getLatestOutsourcingOrderItemForWipUnit/)
  assert.match(actions, /movementType: "OUTSOURCED"[\s\S]*sourceType: "PurchaseOrderItem"/)
})
check("receive no longer finds outsourcing order by supplier/date/latest order", () => {
  assert.doesNotMatch(actions, /orderDate:\s*\{[\s\S]*90 \* 24 \* 60 \* 60 \* 1000/)
  assert.doesNotMatch(actions, /현재는 같은 외주처의 최신 외주발주/)
})
check("receive validates PO item operation equals WipUnit operation", () => {
  assert.match(actions, /orderItem\.workOrderOperationId !== wipUnit\.workOrderOperationId/)
})
check("receive validates PO supplier equals WipUnit outsourcing partner", () => {
  assert.match(actions, /orderItem\.purchaseOrder\.supplierId !== wipUnit\.outsourcingPartnerId/)
})
check("receive locks PurchaseOrderItem before remaining quantity update", () => {
  assert.match(actions, /lockPurchaseOrderItemsForUpdate\(tx, tenantId, \[orderItem\.id\]\)/)
  assert.match(concurrency, /lockPurchaseOrderItemsForUpdate/)
})
check("receive prevents cumulative receivedQty over ordered qty", () => {
  assert.match(actions, /외주입고수량은 외주발주 잔량을 초과할 수 없습니다/)
  assert.match(actions, /receivedQty: \{ increment: wipUnit\.qty \}/)
})
check("issue prevents cumulative outsourced qty over ordered qty", () => {
  assert.match(actions, /외주출고수량은 외주발주수량을 초과할 수 없습니다/)
})
check("WipUnit status transition keeps OUTSOURCED then RECEIVED then inspection release", () => {
  assert.match(actions, /status: "OUTSOURCED"/)
  assert.match(actions, /status: "RECEIVED"/)
  assert.match(actions, /parentNewStatus = acceptedQty > 0 \? "IN_PROCESS" : "SCRAPPED"/)
})
check("inspection uses latest RETURNED PurchaseOrderItem sourceId", () => {
  assert.match(actions, /const orderItemId = latestReturned\.sourceId/)
  assert.match(actions, /sourceType: "OutsourcingInspection"[\s\S]*sourceId: orderItem\.id/)
})
check("defect and rework WIP children preserve LOT relation", () => {
  assert.match(actions, /lotId: wipUnit\.lotId/)
})
check("outsourcing order list includes work order and operation fields", () => {
  assert.match(actions, /workOrderNo: firstLinkedOperation\?\.workOrder\.orderNo/)
  assert.match(actions, /operationName: firstLinkedOperation\?\.routingOperation\.name/)
})
check("WIP rows include outsourcing order item and order number", () => {
  assert.match(actions, /outsourcingOrderItemId: w\.movements\[0\]\?\.sourceId/)
  assert.match(actions, /row\.outsourcingOrderNo = outsourcingOrderItemById/)
})
check("receiving history includes outsourcing order item and order number", () => {
  assert.match(actions, /outsourcingOrderNo: m\.sourceType === "PurchaseOrderItem"/)
  assert.match(actions, /outsourcingOrderItemId: m\.sourceType === "PurchaseOrderItem"/)
})
check("UI shows linked work order and operation on outsourcing order table", () => {
  assert.match(ui, /row\.original\.workOrderNo/)
  assert.match(ui, /row\.original\.operationName/)
})
check("UI shows outsourcing order number on active WIP table", () => {
  assert.match(ui, /accessorKey: "outsourcingOrderNo"/)
})
check("UI issue dialog still shows candidate WIP work order and operation", () => {
  assert.match(ui, /placeholder="제조번호 · 품목 · 작업지시로 검색"/)
  assert.match(ui, /w\.operationSeq/)
})
check("F12 LOT lineage remains FK-based", () => {
  assert.match(f12Lineage, /lotId: lot\.id/)
  assert.match(f12Lineage, /InventoryTransaction\.lotId|inventoryTransaction: \{ lotId: lot\.id \}/)
})
check("F12 LOT lineage includes explicit outsourcing movement references", () => {
  assert.match(f12Lineage, /outsourcingHistory/)
  assert.match(f12Lineage, /movement\.sourceType === "PurchaseOrderItem"/)
  assert.match(f12Lineage, /movement\.sourceType === "OutsourcingInspection"/)
})
check("F11 transaction retry helper is reused for outsourcing issue/receive", () => {
  assert.match(actions, /withQuantityTransactionRetry\(\(\) => prisma\.\$transaction/)
})
check("ordinary PurchaseOrder remains compatible through nullable FK", () => {
  assert.match(schema, /workOrderOperationId\s+String\?/)
})

console.log(`outsource order linkage: ${passed}/${passed} PASS`)
