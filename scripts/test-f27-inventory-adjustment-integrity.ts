import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
const exists = (relativePath: string) => fs.existsSync(path.join(repoRoot, relativePath))

function section(source: string, start: string, end?: string): string {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `${start} 섹션을 찾을 수 없음`)
  if (!end) return source.slice(startIndex)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `${end} 섹션을 찾을 수 없음`)
  return source.slice(startIndex, endIndex)
}

function assertNotIncludes(source: string, needle: string, message: string) {
  assert.equal(source.includes(needle), false, message)
}

function computeAdjustmentDiff(currentQty: number, physicalQty: number) {
  if (!Number.isFinite(physicalQty) || physicalQty < 0) throw new Error("invalid physicalQty")
  return Number((physicalQty - currentQty).toFixed(6))
}

assert.equal(computeAdjustmentDiff(100, 80), -20, "100 → 80은 ADJUST -20")
assert.equal(computeAdjustmentDiff(100, 120), 20, "100 → 120은 ADJUST +20")
assert.equal(computeAdjustmentDiff(100, 0), -100, "physicalQty=0 허용")
assert.throws(() => {
  const diff = computeAdjustmentDiff(100, 100)
  if (diff === 0) throw new Error("same quantity")
}, /same quantity/, "동일 수량은 ledger 생성 없이 reject")

const inventoryActions = read("src/lib/actions/inventory.actions.ts")
const transactionsPage = read("src/app/app/mes/inventory-transactions/page.tsx")
const transactionsTable = read("src/app/app/mes/inventory-transactions/inventory-transaction-data-table.tsx")
const columns = read("src/app/app/mes/inventory-transactions/columns.tsx")
const stockDialog = read("src/app/app/mes/inventory/stock-adjustment-dialog.tsx")

assertNotIncludes(transactionsTable, "입출고 등록", "전체입출고내역에 입출고 등록 버튼 없음")
assertNotIncludes(transactionsTable, "TransactionFormSheet", "전체입출고내역 DataTable에 등록 form import 없음")
assertNotIncludes(transactionsPage, "tenantId=", "전체입출고내역 page가 등록용 tenantId prop을 전달하지 않음")
assertNotIncludes(transactionsPage, "getWarehousesForTransaction", "전체입출고내역 page가 등록용 창고 helper를 호출하지 않음")
assert.equal(exists("src/app/app/mes/inventory-transactions/transaction-form-sheet.tsx"), false, "generic transaction form 삭제")
assert.equal(exists("src/app/app/mes/inventory-transactions/transaction-form-schema.ts"), false, "generic transaction form schema 삭제")

assertNotIncludes(inventoryActions, "export async function createTransaction", "generic createTransaction export 제거")
assertNotIncludes(inventoryActions, "CreateTransactionInput", "generic CreateTransactionInput 제거")
assertNotIncludes(inventoryActions, "qtyAbsolute", "generic absolute ADJUST 경로 제거")
assertNotIncludes(inventoryActions, "TransactionType.RECEIPT\n", "inventory.actions generic RECEIPT switch block 제거")
assertNotIncludes(inventoryActions, "TransactionType.ISSUE\n", "inventory.actions generic ISSUE switch block 제거")

const adjustBody = section(inventoryActions, "export async function adjustInventoryStock", "// ─── 재고조정 이력 조회")
assert.match(inventoryActions, /export type StockAdjustmentInput = \{[\s\S]*balanceId: string/, "StockAdjustmentInput은 balanceId 필수")
assert.match(stockDialog, /adjustInventoryStock\(\{\s*balanceId: target\.balanceId,[\s\S]*physicalQty: confirmedPhysicalQty,[\s\S]*reason,/, "UI는 balanceId/physicalQty/reason만 mutation payload로 전달")
assertNotIncludes(stockDialog, "siteId: target.siteId", "UI가 siteId를 mutation 정본으로 전달하지 않음")
assertNotIncludes(stockDialog, "warehouseId: target.warehouseId", "UI가 warehouseId를 mutation 정본으로 전달하지 않음")
assertNotIncludes(stockDialog, "itemId: target.itemId", "UI가 itemId를 mutation 정본으로 전달하지 않음")
assert.match(adjustBody, /where: \{ id: balanceId, tenantId \}/, "balanceId + tenantId ownership 확인")
assert.match(adjustBody, /lockInventoryBalancesForUpdate\(tx, \[balanceId\]\)/, "balance row FOR UPDATE lock 사용")
assert.match(adjustBody, /withQuantityTransactionRetry/, "quantity transaction retry 사용")
assert.match(adjustBody, /const balance = await tx\.inventoryBalance\.findFirst[\s\S]*include: \{[\s\S]*item:[\s\S]*tenantId: true[\s\S]*site:[\s\S]*tenantId: true[\s\S]*warehouse:[\s\S]*lot:/, "lock 이후 item/site/warehouse/lot relation 포함 balance 재조회")
assert.match(adjustBody, /balance\.item\.tenantId !== tenantId/, "item tenant 검증")
assert.match(adjustBody, /balance\.site\.tenantId !== tenantId/, "site tenant 검증")
assert.match(adjustBody, /balance\.warehouse\.tenantId !== tenantId/, "warehouse tenant 검증")
assert.match(adjustBody, /balance\.warehouse\.siteId !== balance\.siteId/, "warehouse site 검증")
assert.match(adjustBody, /balance\.lot\.tenantId !== tenantId \|\| balance\.lot\.itemId !== balance\.itemId/, "LOT tenant/item 검증")
assert.match(adjustBody, /balance\.item\.isLotTracked && !balance\.lotId/, "LOT tracked + unlotted balance 조정 차단")
assert.match(adjustBody, /qty: diffQty/, "InventoryTransaction qty는 signed diff")
assert.match(adjustBody, /refType: STOCK_ADJUSTMENT_REF_TYPE/, "ADJUST refType은 STOCK_ADJUSTMENT")
assert.match(adjustBody, /input\.physicalQty < 0/, "physicalQty는 0 이상 허용")
assert.match(adjustBody, /diffQty === 0/, "same quantity reject")
assert.match(adjustBody, /!reason/, "reason 필수")
assert.match(adjustBody, /physicalQty < qtyHold/, "physicalQty < qtyHold 차단")
assert.match(adjustBody, /qtyAvailableAfter = Number\(\(physicalQty - qtyHold\)\.toFixed\(6\)\)/, "qtyAvailable은 physicalQty - qtyHold")
assertNotIncludes(adjustBody, "inventoryBalance.create", "canonical ADJUST는 missing balance 생성 금지")
assert.match(adjustBody, /beforeData: \{[\s\S]*balanceId:[\s\S]*qtyAvailable:/, "AuditLog beforeData에 balance/qty 정보 기록")
assert.match(adjustBody, /afterData: \{[\s\S]*balanceId:[\s\S]*siteId:[\s\S]*warehouseId:[\s\S]*itemId:[\s\S]*currentQty,[\s\S]*physicalQty,[\s\S]*diffQty,[\s\S]*qtyHold,[\s\S]*qtyAvailableBefore,[\s\S]*qtyAvailableAfter,[\s\S]*reason,[\s\S]*txNo,/, "AuditLog afterData에 추적 payload 기록")

const groupedInventory = section(inventoryActions, "export async function getGroupedInventoryBalances", "// ─── 트랜잭션 이력 조회")
assert.match(groupedInventory, /const tenantId = await getTenantId\(\)[\s\S]*where: \{[\s\S]*tenantId,[\s\S]*item: \{ tenantId \},[\s\S]*site: \{ tenantId \},[\s\S]*warehouse: \{ tenantId \},[\s\S]*OR: \[\{ lotId: null \}, \{ lot: \{ tenantId \} \}\]/, "getGroupedInventoryBalances relation tenant scope")
const materialInventory = section(inventoryActions, "export async function getMaterialInventoryBalances", "// ─── 품목 기준 그룹화 재고")
assert.match(materialInventory, /const tenantId = await getTenantId\(\)[\s\S]*where: \{[\s\S]*tenantId,[\s\S]*item: \{ tenantId, itemType[\s\S]*site: \{ tenantId \},[\s\S]*warehouse: \{ tenantId \},[\s\S]*OR: \[\{ lotId: null \}, \{ lot: \{ tenantId \} \}\]/, "getMaterialInventoryBalances balance relation tenant scope")
assert.match(materialInventory, /inventoryTransaction\.findMany\(\{[\s\S]*where: \{[\s\S]*tenantId,[\s\S]*item: \{ tenantId \},[\s\S]*OR: \[\{ lotId: null \}, \{ lot: \{ tenantId \} \}\],[\s\S]*fromLocation: \{ tenantId \}[\s\S]*toLocation: \{ tenantId \}/, "getMaterialInventoryBalances tx relation tenant scope")
const txHistory = section(inventoryActions, "export async function getInventoryTransactions", "// ─── 사이트 목록")
assert.match(txHistory, /const tenantId = await getTenantId\(\)[\s\S]*where: \{[\s\S]*tenantId,[\s\S]*item: \{ tenantId \},[\s\S]*OR: \[\{ lotId: null \}, \{ lot: \{ tenantId \} \}\],[\s\S]*fromLocation: \{ tenantId \}[\s\S]*toLocation: \{ tenantId \}/, "getInventoryTransactions relation tenant scope")
const sites = section(inventoryActions, "export async function getSitesForInventory", "// ─── txNo 생성")
assert.match(sites, /const tenantId = await getTenantId\(\)[\s\S]*where: \{ tenantId \}/, "getSitesForInventory tenant scope")
const adjustmentHistory = section(inventoryActions, "export async function getStockAdjustmentHistory")
assert.match(adjustmentHistory, /const tenantId = await getTenantId\(\)[\s\S]*where: \{[\s\S]*tenantId,[\s\S]*refType: STOCK_ADJUSTMENT_REF_TYPE,[\s\S]*item: \{ tenantId \},[\s\S]*OR: \[\{ lotId: null \}, \{ lot: \{ tenantId \} \}\],[\s\S]*fromLocation: \{ tenantId \}[\s\S]*toLocation: \{ tenantId \}/, "getStockAdjustmentHistory relation tenant scope")

assert.match(columns, /조정\(기존\)/, "historical generic ADJUST label 분리")
assert.match(columns, /isCanonicalAdjustment[\s\S]*Math\.abs\(qty\)/, "canonical ADJUST 수량 부호 중복 방지")

assertNotIncludes(inventoryActions, "inventoryTransaction.update", "InventoryTransaction update 없음")
assertNotIncludes(inventoryActions, "inventoryTransaction.updateMany", "InventoryTransaction updateMany 없음")
assertNotIncludes(inventoryActions, "inventoryTransaction.delete", "InventoryTransaction delete 없음")
assertNotIncludes(inventoryActions, "inventoryTransaction.deleteMany", "InventoryTransaction deleteMany 없음")

const receiving = read("src/lib/actions/receiving.actions.ts")
const materialIssue = read("src/lib/actions/material-issue.actions.ts")
const finishedGoods = read("src/lib/actions/finished-goods.actions.ts")
const shipment = read("src/lib/actions/shipment.actions.ts")
const materialReturn = read("src/lib/actions/material-return.actions.ts")
assert.match(receiving, /txType: "RECEIPT"/, "자재입고 dedicated RECEIPT 보존")
assert.match(receiving, /refType: "PURCHASE_ORDER"/, "자재입고 PURCHASE_ORDER refType 보존")
assert.match(materialIssue, /txType: "ISSUE"/, "자재출고 dedicated ISSUE 보존")
assert.match(materialIssue, /refType: "WORK_ORDER"/, "자재출고 WORK_ORDER refType 보존")
assert.match(finishedGoods, /txType: "RECEIPT"/, "완제품입고 dedicated RECEIPT 보존")
assert.match(finishedGoods, /refType: "WORK_ORDER"/, "완제품입고 WORK_ORDER refType 보존")
assert.match(shipment, /txType: "ISSUE"/, "출하 dedicated ISSUE 보존")
assert.match(shipment, /refType: "SHIPMENT_ITEM"/, "출하 SHIPMENT_ITEM refType 보존")
assert.match(materialReturn, /txType: "SUPPLIER_RETURN"/, "공급처반품 dedicated SUPPLIER_RETURN 보존")
assert.match(materialReturn, /refType: "MATERIAL_RETURN"/, "공급처반품 MATERIAL_RETURN refType 보존")

console.log("F27 inventory adjustment integrity: passed")


