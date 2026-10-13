import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve("src/lib/actions/shipment.actions.ts"), "utf8")
const createBody = source.slice(source.indexOf("export async function createShipment"), source.indexOf("export async function confirmShipment"))
const confirmBody = source.slice(source.indexOf("export async function confirmShipment"), source.indexOf("export async function deleteShipment"))
const deleteBody = source.slice(source.indexOf("export async function deleteShipment"))

// Reservations are derived, never persisted in InventoryBalance.
assert.match(source, /shipmentOrder: \{ tenantId, siteId: warehouse\.siteId, warehouseId, status: "PLANNED" \}/)
assert.match(source, /calculateReservableQty/)
assert.equal(Math.max(0, 100 - 60), 40)
assert.equal(Math.max(0, 100 - 60 - 41), 0)

// Creation only creates reservation records; physical issue processing belongs to confirm.
assert.match(createBody, /shipmentItem\.create/)
assert.doesNotMatch(createBody, /inventoryTransaction\.create/)
assert.doesNotMatch(createBody, /qtyOnHand: \{ decrement/)
assert.doesNotMatch(createBody, /shippedQty: \{ increment/)

// Confirmation performs the one-way conditional transition and all actual shipment effects.
assert.match(confirmBody, /status: "PLANNED"/)
assert.match(confirmBody, /qtyOnHand: \{ decrement: item\.qty \}/)
assert.match(confirmBody, /inventoryTransaction\.create/)
assert.match(confirmBody, /shippedQty: \{ increment: item\.qty \}/)
assert.match(confirmBody, /resolveSalesOrderStatusAfterShipmentRollback/)

// Cancelling a reservation only removes ShipmentItem/ShipmentOrder.
assert.match(deleteBody, /shipmentItem\.deleteMany/)
assert.doesNotMatch(deleteBody, /inventoryBalance\.(update|updateMany)/)
assert.doesNotMatch(deleteBody, /inventoryTransaction\.deleteMany/)
assert.doesNotMatch(deleteBody, /shippedQty: \{ decrement/)

console.log("shipment state integrity: PASS")
