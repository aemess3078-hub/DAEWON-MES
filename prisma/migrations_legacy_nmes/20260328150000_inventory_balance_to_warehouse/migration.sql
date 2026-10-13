-- Clear dev data first
DELETE FROM "InventoryBalance";
DELETE FROM "InventoryTransaction";

-- InventoryBalance: rename locationId → warehouseId, re-target FK
ALTER TABLE "InventoryBalance" DROP CONSTRAINT IF EXISTS "InventoryBalance_locationId_fkey";
ALTER TABLE "InventoryBalance" RENAME COLUMN "locationId" TO "warehouseId";
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop old indexes
DROP INDEX IF EXISTS "InventoryBalance_locationId_idx";
DROP INDEX IF EXISTS "InventoryBalance_tenantId_locationId_idx";
DROP INDEX IF EXISTS "InventoryBalance_tenantId_itemId_lotId_locationId_idx";
DROP INDEX IF EXISTS "InventoryBalance_tenantId_itemId_locationId_key";

-- Create new indexes
CREATE INDEX "InventoryBalance_warehouseId_idx" ON "InventoryBalance"("warehouseId");
CREATE INDEX "InventoryBalance_tenantId_warehouseId_idx" ON "InventoryBalance"("tenantId", "warehouseId");
CREATE INDEX "InventoryBalance_tenantId_itemId_lotId_warehouseId_idx" ON "InventoryBalance"("tenantId", "itemId", "lotId", "warehouseId");
CREATE UNIQUE INDEX "InventoryBalance_tenantId_itemId_warehouseId_key" ON "InventoryBalance"("tenantId", "itemId", "warehouseId");

-- InventoryTransaction: re-target fromLocationId/toLocationId FK from Location to Warehouse
ALTER TABLE "InventoryTransaction" DROP CONSTRAINT IF EXISTS "InventoryTransaction_fromLocationId_fkey";
ALTER TABLE "InventoryTransaction" DROP CONSTRAINT IF EXISTS "InventoryTransaction_toLocationId_fkey";
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
