-- InventoryBalance: LOT 미지정(lotId IS NULL) 재고 행의 유일성 보장 (partial unique index)
--
-- 문제: baseline migration 은 `prisma migrate diff --from-empty` 로 만들어져 Prisma 스키마로 표현할 수 없는
--       partial unique index 가 빠졌다. PostgreSQL 은 NULL 을 서로 다른 값으로 취급하므로
--       @@unique([tenantId, itemId, warehouseId, lotId]) 만으로는 lotId=NULL(비LOT 품목) 행의 중복을 막지 못한다.
--
-- 이 migration 은 **SQL 이 기준**이다(Prisma 가 관리하지 못하는 객체 — 20261014000000_add_item_supplier 와 같은 방식).
-- 전체가 한 트랜잭션이므로 아래 검사 중 하나라도 실패하면 DB 는 아무것도 바뀌지 않는다.
--
-- 동작
--   1) 같은 이름의 인덱스가 이미 있으면 **정의를 검사**한다(IF NOT EXISTS 를 맹신하지 않는다).
--      - 올바른 정의(InventoryBalance / UNIQUE / (tenantId, itemId, warehouseId) / WHERE lotId IS NULL / VALID·READY)이면
--        아무것도 하지 않고 통과한다(레거시 migration 으로 이미 만들어진 DB 와 호환).
--      - 하나라도 다르면 **덮어쓰지 않고** 명확한 오류로 중단한다(NULL_LOT_INDEX_MISMATCH).
--   2) 인덱스가 없으면 lotId IS NULL 중복 그룹을 점검한다. 중복이 있으면 **자동 삭제·합산 없이** 중단한다(NULL_LOT_DUPLICATES).
--      → scripts/sql/inventory-balance-null-lot-duplicates.sql 로 확인하고, 수불 이력을 보존하는 병합을 별도 승인·백업 하에 수행한 뒤 재배포한다.
--   3) 중복이 없으면 인덱스를 만든다.
--
-- 실패 후 복구(Prisma): 원인 해결 후 `prisma migrate resolve --rolled-back 20261019010000_add_inventory_balance_null_lot_unique` → `prisma migrate deploy`.
-- 롤백: DROP INDEX "InventoryBalance_tenantId_itemId_warehouseId_null_lot_key";  (앱 코드는 인덱스가 없어도 동작한다)

DO $$
DECLARE
  v_name        constant text := 'InventoryBalance_tenantId_itemId_warehouseId_null_lot_key';
  v_oid         oid;
  v_kind        "char";
  v_table       text;
  v_unique      boolean;
  v_valid       boolean;
  v_ready       boolean;
  v_nkeyatts    int;
  v_natts       int;
  v_hasexpr     boolean;
  v_cols        text[];
  v_pred        text;
  v_dup_groups  bigint;
BEGIN
  SELECT c.oid, c.relkind INTO v_oid, v_kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = v_name;

  IF v_oid IS NOT NULL THEN
    -- 같은 이름이 이미 있다 → 올바른 partial unique index 인지 검사한다.
    IF v_kind <> 'i' THEN
      RAISE EXCEPTION 'NULL_LOT_INDEX_MISMATCH: "%" 이름의 객체가 인덱스가 아닙니다(relkind=%). 자동으로 덮어쓰지 않습니다.', v_name, v_kind;
    END IF;

    SELECT t.relname, i.indisunique, i.indisvalid, i.indisready, i.indnkeyatts, i.indnatts, (i.indexprs IS NOT NULL),
           (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum),
           coalesce(pg_get_expr(i.indpred, i.indrelid), '')
      INTO v_table, v_unique, v_valid, v_ready, v_nkeyatts, v_natts, v_hasexpr, v_cols, v_pred
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
     WHERE i.indexrelid = v_oid;

    IF v_table IS DISTINCT FROM 'InventoryBalance'
       OR NOT v_unique
       OR NOT v_valid
       OR NOT v_ready
       OR v_hasexpr
       OR v_nkeyatts <> 3 OR v_natts <> 3
       OR v_cols IS DISTINCT FROM ARRAY['tenantId', 'itemId', 'warehouseId']::text[]
       OR regexp_replace(v_pred, '[\s"()]', '', 'g') <> 'lotIdISNULL'
    THEN
      RAISE EXCEPTION 'NULL_LOT_INDEX_MISMATCH: 기존 인덱스 "%" 의 정의가 기대와 다릅니다 (table=%, unique=%, valid=%, ready=%, columns=%, predicate=%). 자동으로 덮어쓰지 않습니다. 인덱스를 확인·정리한 뒤 다시 배포하세요.',
        v_name, v_table, v_unique, v_valid, v_ready, v_cols, v_pred;
    END IF;

    RAISE NOTICE '올바른 partial unique index "%" 가 이미 있어 건너뜁니다.', v_name;
    RETURN;
  END IF;

  -- 인덱스가 없다 → 중복 행이 있으면 만들 수 없다. 자동 삭제·합산은 하지 않는다.
  SELECT count(*) INTO v_dup_groups FROM (
    SELECT 1 FROM "InventoryBalance" WHERE "lotId" IS NULL
     GROUP BY "tenantId", "itemId", "warehouseId" HAVING count(*) > 1
  ) d;

  IF v_dup_groups > 0 THEN
    RAISE EXCEPTION 'NULL_LOT_DUPLICATES: InventoryBalance 에 lotId IS NULL 중복 재고 행 그룹이 % 개 있어 유일성 인덱스를 만들 수 없습니다. 자동으로 삭제·합산하지 않습니다. scripts/sql/inventory-balance-null-lot-duplicates.sql 로 확인하고, 수불 이력을 보존하는 병합을 백업·승인 후 수행한 뒤 다시 배포하세요.', v_dup_groups;
  END IF;

  EXECUTE format(
    'CREATE UNIQUE INDEX %I ON "InventoryBalance" ("tenantId", "itemId", "warehouseId") WHERE "lotId" IS NULL',
    v_name
  );
END $$;
