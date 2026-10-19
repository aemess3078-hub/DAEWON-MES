-- InventoryBalance lotId IS NULL 중복 재고 행 점검 (읽기 전용 SELECT 만 사용)
--
-- 용도: 20261019010000_add_inventory_balance_null_lot_unique migration 적용 전에 운영/스테이징 DB 를 점검한다.
-- 실행 주체: DB 담당자(사용자 승인 후). 이 저장소의 자동화는 운영 DB 에 접속하지 않는다.
-- 이 파일은 어떤 행도 수정·삭제·합산하지 않는다. 중복이 있으면 수불 이력(InventoryTransaction)을 보존하는 병합을
-- 백업과 별도 승인 하에 수작업으로 수행해야 하며, 자동 병합 SQL 은 제공하지 않는다.

\echo '== 1) 중복 그룹 수 (0 이어야 migration 이 통과) =='
SELECT count(*) AS duplicate_groups
  FROM (SELECT 1 FROM "InventoryBalance" WHERE "lotId" IS NULL
         GROUP BY "tenantId", "itemId", "warehouseId" HAVING count(*) > 1) d;

\echo '== 2) 중복 그룹 상세 (행 수, 수량 합계, 최근 수정) =='
SELECT b."tenantId", t.code AS tenant_code, b."itemId", i.code AS item_code, b."warehouseId", w.code AS warehouse_code,
       count(*) AS row_count,
       sum(b."qtyOnHand") AS sum_on_hand, sum(b."qtyAvailable") AS sum_available, sum(b."qtyHold") AS sum_hold,
       min(b."updatedAt") AS first_updated, max(b."updatedAt") AS last_updated
  FROM "InventoryBalance" b
  JOIN "Tenant" t ON t.id = b."tenantId"
  JOIN "Item" i ON i.id = b."itemId"
  JOIN "Warehouse" w ON w.id = b."warehouseId"
 WHERE b."lotId" IS NULL
 GROUP BY b."tenantId", t.code, b."itemId", i.code, b."warehouseId", w.code
HAVING count(*) > 1
 ORDER BY row_count DESC, last_updated DESC;

\echo '== 3) 중복 그룹의 개별 행 (병합 대상 확인용) =='
SELECT b.id, b."tenantId", b."itemId", b."warehouseId", b."qtyOnHand", b."qtyAvailable", b."qtyHold", b."updatedAt"
  FROM "InventoryBalance" b
  JOIN (SELECT "tenantId", "itemId", "warehouseId" FROM "InventoryBalance" WHERE "lotId" IS NULL
         GROUP BY 1, 2, 3 HAVING count(*) > 1) d
    ON d."tenantId" = b."tenantId" AND d."itemId" = b."itemId" AND d."warehouseId" = b."warehouseId"
 WHERE b."lotId" IS NULL
 ORDER BY b."tenantId", b."itemId", b."warehouseId", b."updatedAt";

\echo '== 4) 같은 이름의 인덱스가 이미 있는가 / 정의 (있으면 migration 이 정의를 검사한다) =='
SELECT c.relname AS index_name, t.relname AS table_name, i.indisunique AS is_unique, i.indisvalid AS is_valid, i.indisready AS is_ready,
       pg_get_indexdef(i.indexrelid) AS definition
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_class t ON t.oid = i.indrelid
 WHERE c.relname = 'InventoryBalance_tenantId_itemId_warehouseId_null_lot_key';

\echo '== 5) InventoryBalance 의 partial/기타 유니크 인덱스 전체 =='
SELECT indexname, indexdef FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'InventoryBalance' AND indexdef ILIKE '%UNIQUE%'
 ORDER BY indexname;

\echo '== 6) 적용된 migration 이력 =='
SELECT migration_name, finished_at IS NOT NULL AS applied, rolled_back_at IS NOT NULL AS rolled_back
  FROM _prisma_migrations ORDER BY started_at;
