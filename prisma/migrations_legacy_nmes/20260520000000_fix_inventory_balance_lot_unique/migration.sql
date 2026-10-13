-- InventoryBalance LOT-aware unique 재구성
--
-- 문제: 기존 @@unique([tenantId, itemId, warehouseId])는 lotId를 포함하지 않아
--       동일 품목/창고에 복수 LOT 재고를 별도 row로 관리할 수 없었음.
--
-- 해결:
--   1. 기존 unique 제약 제거
--   2. LOT 관리 품목: (tenantId, itemId, warehouseId, lotId) 복합 unique
--   3. LOT 비관리 품목: lotId IS NULL partial unique index
--      PostgreSQL에서 NULL != NULL이므로 복합 unique만으로는 NULL 중복을 막지 못함

-- 1. 기존 unique 제약/인덱스 제거
DROP INDEX IF EXISTS "InventoryBalance_tenantId_itemId_warehouseId_key";
ALTER TABLE "InventoryBalance" DROP CONSTRAINT IF EXISTS "InventoryBalance_tenantId_itemId_warehouseId_key";

-- 2. LOT 포함 복합 unique (LOT 관리 품목용)
--    lotId에 값이 있는 경우 (tenantId, itemId, warehouseId, lotId) 조합을 고유하게 보장
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryBalance_tenantId_itemId_warehouseId_lotId_key"
  ON "InventoryBalance"("tenantId", "itemId", "warehouseId", "lotId");

-- 3. LOT 비관리 품목 partial unique (lotId IS NULL인 경우 중복 방지)
--    Prisma schema로 표현 불가 → migration에서 직접 적용
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryBalance_tenantId_itemId_warehouseId_null_lot_key"
  ON "InventoryBalance"("tenantId", "itemId", "warehouseId")
  WHERE "lotId" IS NULL;
