-- Fix: Convert unique INDEX to proper unique CONSTRAINT
-- Prisma upsert requires ON CONFLICT ON CONSTRAINT (named constraint),
-- not just a unique index.

DO $$
BEGIN
  -- 1. 이전 migration이 만든 unique index가 있으면 제거
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'InventoryBalance'
      AND indexname = 'InventoryBalance_tenantId_itemId_locationId_key'
  ) THEN
    DROP INDEX "InventoryBalance_tenantId_itemId_locationId_key";
  END IF;

  -- 2. 같은 이름의 constraint가 없으면 생성
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'InventoryBalance_tenantId_itemId_locationId_key'
  ) THEN
    ALTER TABLE "InventoryBalance"
    ADD CONSTRAINT "InventoryBalance_tenantId_itemId_locationId_key"
    UNIQUE ("tenantId", "itemId", "locationId");
  END IF;
END $$;
