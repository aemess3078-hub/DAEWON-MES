-- Add unique constraint to InventoryBalance (tenantId, itemId, locationId)
-- Using IF NOT EXISTS to safely handle case where constraint already exists in DB
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryBalance_tenantId_itemId_locationId_key"
  ON "InventoryBalance"("tenantId", "itemId", "locationId");
