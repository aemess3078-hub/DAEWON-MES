-- 대원정밀 MES — 운영 배포 전/후 점검 (읽기 전용 SELECT 한 문장)
--
-- 대상: PR #5 에 포함된 migration 2개
--   6) 20261019000000_add_receiving_request_idempotency   (ReceivingRequest 테이블 추가)
--   7) 20261019010000_add_inventory_balance_null_lot_unique (비LOT 재고 partial unique index)
--
-- 실행 주체/조건: DB 담당자가 사용자 승인 후 실행. 이 저장소의 자동화는 운영 DB 에 접속하지 않는다.
-- 안전장치(둘 중 하나 이상 사용 권장):
--   psql :  PGOPTIONS="-c default_transaction_read_only=on" psql "$DIRECT_URL" -X -f scripts/sql/production-predeploy-readonly-checks.sql
--   Supabase SQL Editor : 이 파일 전체를 붙여 넣어 실행(한 문장이라 결과 표 1개가 나온다). 쓰기 문장이 없다.
-- 출력 해석: status = BLOCK(배포 중단 사유) / WARN(확인 필요) / PASS / INFO / PENDING(배포 전에는 정상)
--           배포 "후"에 다시 실행하면 6·7번이 applied 이고 BLOCK/WARN 이 없어야 한다.

WITH expected(seq, name) AS (
  VALUES
    (1, '20261013000000_daewon_initial_baseline'),
    (2, '20261013000100_supabase_public_hardening'),
    (3, '20261014000000_add_item_supplier'),
    (4, '20261014010000_add_item_safety_stock'),
    (5, '20261014020000_add_mrp_run_history'),
    (6, '20261019000000_add_receiving_request_idempotency'),
    (7, '20261019010000_add_inventory_balance_null_lot_unique')
),
mig AS (
  SELECT e.seq, e.name,
         CASE
           WHEN m.migration_name IS NULL THEN 'PENDING'
           WHEN m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL THEN 'applied'
           WHEN m.rolled_back_at IS NOT NULL THEN 'rolled_back'
           ELSE 'FAILED'
         END AS state
    FROM expected e
    LEFT JOIN LATERAL (
      SELECT * FROM _prisma_migrations x WHERE x.migration_name = e.name ORDER BY x.started_at DESC LIMIT 1
    ) m ON true
),
nl AS (  -- lotId IS NULL 중복 그룹
  SELECT "tenantId", "itemId", "warehouseId", count(*) AS n
    FROM "InventoryBalance" WHERE "lotId" IS NULL
   GROUP BY 1, 2, 3 HAVING count(*) > 1
),
idx AS (
  SELECT c.relname, c.relkind::text AS relkind, i.indisunique, i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid) AS def
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    LEFT JOIN pg_index i ON i.indexrelid = c.oid
   WHERE c.relname = 'InventoryBalance_tenantId_itemId_warehouseId_null_lot_key'
),
checks(ord, item, value, expected, status) AS (
  -- ── 환경 ──
  SELECT 10, 'PostgreSQL 버전', version(), '15 이상', CASE WHEN current_setting('server_version_num')::int >= 150000 THEN 'PASS' ELSE 'WARN' END
  UNION ALL SELECT 11, '접속 DB / 사용자', current_database() || ' / ' || current_user, '운영 DB 인지 확인', 'INFO'
  UNION ALL SELECT 12, 'default_transaction_read_only', current_setting('default_transaction_read_only'), 'on 권장(읽기 전용 세션)', CASE WHEN current_setting('default_transaction_read_only') = 'on' THEN 'PASS' ELSE 'INFO' END
  -- ── Prisma migration 상태 ──
  UNION ALL SELECT 20, 'migration 이력 행 수', count(*)::text, '5(배포 전) / 7(배포 후)', 'INFO' FROM _prisma_migrations
  UNION ALL SELECT 21, '실패/미완료 migration (finished_at 없음, rolled_back 아님)', count(*)::text, '0', CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'BLOCK' END
    FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL
  UNION ALL SELECT 22, '이력에는 있으나 저장소에 없는 migration', count(*)::text, '0', CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'WARN' END
    FROM _prisma_migrations m WHERE NOT EXISTS (SELECT 1 FROM expected e WHERE e.name = m.migration_name)
  UNION ALL SELECT 30 + seq, 'migration ' || seq || ' ' || name, state,
         CASE WHEN seq <= 5 THEN 'applied' ELSE 'PENDING(배포 전) → applied(배포 후)' END,
         CASE WHEN seq <= 5 THEN (CASE WHEN state = 'applied' THEN 'PASS' ELSE 'BLOCK' END)
              ELSE (CASE WHEN state = 'applied' THEN 'PASS' WHEN state = 'PENDING' THEN 'PENDING' ELSE 'BLOCK' END) END
    FROM mig
  -- ── 신규 테이블 / 인덱스 ──
  UNION ALL SELECT 40, 'ReceivingRequest 테이블 존재', coalesce(to_regclass('public."ReceivingRequest"')::text, '없음'), '배포 전 없음 / 후 있음', 'INFO'
  UNION ALL SELECT 41, '비LOT 부분 유니크 인덱스(동명) 존재', coalesce((SELECT relkind FROM idx), '없음'), '배포 전 없음(레거시로 있으면 정의 확인) / 후 i', 'INFO'
  UNION ALL SELECT 42, '동명 인덱스 정의 정상 여부',
         coalesce((SELECT CASE WHEN relkind = 'i' AND indisunique AND indisvalid AND indisready
                               AND def = 'CREATE UNIQUE INDEX "InventoryBalance_tenantId_itemId_warehouseId_null_lot_key" ON public."InventoryBalance" USING btree ("tenantId", "itemId", "warehouseId") WHERE ("lotId" IS NULL)'
                          THEN '정상' ELSE '비정상: ' || coalesce(def, relkind) END FROM idx), '해당 없음(인덱스 없음)'),
         '정상 또는 해당 없음', CASE WHEN EXISTS (SELECT 1 FROM idx) AND NOT EXISTS (
            SELECT 1 FROM idx WHERE relkind = 'i' AND indisunique AND indisvalid AND indisready
              AND def = 'CREATE UNIQUE INDEX "InventoryBalance_tenantId_itemId_warehouseId_null_lot_key" ON public."InventoryBalance" USING btree ("tenantId", "itemId", "warehouseId") WHERE ("lotId" IS NULL)')
          THEN 'BLOCK' ELSE 'PASS' END
  -- ── 재고 데이터 (인덱스 적용 가능 여부) ──
  UNION ALL SELECT 50, 'InventoryBalance 전체 행 수', count(*)::text, '(참고)', 'INFO' FROM "InventoryBalance"
  UNION ALL SELECT 51, 'InventoryBalance lotId IS NULL 행 수', count(*)::text, '(참고)', 'INFO' FROM "InventoryBalance" WHERE "lotId" IS NULL
  UNION ALL SELECT 52, '비LOT 중복 재고 그룹 수', count(*)::text, '0 (0 이 아니면 migration 이 NULL_LOT_DUPLICATES 로 중단)', CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'BLOCK' END FROM nl
  UNION ALL SELECT 53, '비LOT 중복 재고 행 수(그룹 합)', coalesce(sum(n), 0)::text, '0', CASE WHEN coalesce(sum(n), 0) = 0 THEN 'PASS' ELSE 'BLOCK' END FROM nl
  UNION ALL SELECT 54, '음수/불일치 재고 행(qtyOnHand<0, qtyAvailable<0, available>onHand)', count(*)::text, '0', CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'WARN' END
    FROM "InventoryBalance" WHERE "qtyOnHand" < 0 OR "qtyAvailable" < 0 OR "qtyAvailable" > "qtyOnHand"
  UNION ALL SELECT 55, '입고거래번호 (tenantId, txNo) 중복', count(*)::text, '0', CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'WARN' END
    FROM (SELECT 1 FROM "InventoryTransaction" GROUP BY "tenantId", "txNo" HAVING count(*) > 1) d
  -- ── 업무 데이터 사용 현황 (영향 범위 판단용) ──
  UNION ALL SELECT 60, 'PurchaseOrder 건수', count(*)::text, '(참고)', 'INFO' FROM "PurchaseOrder"
  UNION ALL SELECT 61, 'ReceivingInspection 건수', count(*)::text, '(참고)', 'INFO' FROM "ReceivingInspection"
  UNION ALL SELECT 62, 'InventoryTransaction 건수', count(*)::text, '(참고)', 'INFO' FROM "InventoryTransaction"
  UNION ALL SELECT 63, 'Lot 건수', count(*)::text, '(참고)', 'INFO' FROM "Lot"
  UNION ALL SELECT 64, 'WorkOrder 건수', count(*)::text, '(참고)', 'INFO' FROM "WorkOrder"
  UNION ALL SELECT 65, 'Item 중 isLotTracked=true 건수', count(*)::text, '(참고)', 'INFO' FROM "Item" WHERE "isLotTracked" = true
  -- ── 작업 시간/잠금 판단 ──
  UNION ALL SELECT 70, '현재 DB 접속 세션 수', count(*)::text, '(참고)', 'INFO' FROM pg_stat_activity WHERE datname = current_database()
  UNION ALL SELECT 71, '가장 오래 열려 있는 트랜잭션(초)', coalesce(max(extract(epoch FROM (now() - xact_start)))::int, 0)::text, '짧을수록 좋음(길면 인덱스 생성이 대기)', 'INFO'
    FROM pg_stat_activity WHERE datname = current_database() AND xact_start IS NOT NULL AND pid <> pg_backend_pid()
  UNION ALL SELECT 72, 'InventoryBalance / InventoryTransaction 크기', pg_size_pretty(pg_total_relation_size('"InventoryBalance"')) || ' / ' || pg_size_pretty(pg_total_relation_size('"InventoryTransaction"')), '작을수록 인덱스 생성이 짧음', 'INFO'
  UNION ALL SELECT 73, 'RLS 활성 테이블 / 전체 테이블(public)', count(*) FILTER (WHERE rowsecurity)::text || ' / ' || count(*)::text, '배포 전 전부 활성(Phase 6 기준 115/115), 후 +1', 'INFO'
    FROM pg_tables WHERE schemaname = 'public'
)
SELECT ord, item, value, expected, status FROM checks ORDER BY ord;
