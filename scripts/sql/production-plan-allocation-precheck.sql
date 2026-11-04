-- 생산계획 품목 생산 유형·수주 충당 수량 이관 사전 점검 (읽기 전용 — SELECT 만 사용)
-- 대상 migration: 20261102000000_add_production_plan_item_kind_allocation
-- 운영 적용 전에 반드시 실행한다. (3) 예외 데이터가 1건이라도 있으면 migration 은 이관을 중단한다(변경 없음).
-- 예외 데이터의 충당 수량·사유·승인 상태는 승인된 업무 정책 없이 자동 배분하지 않는다 — 처리 방침 결정 후 재배포.
-- 실행: psql "$DATABASE_URL" -f scripts/sql/production-plan-allocation-precheck.sql   (운영 DB 접근은 별도 승인 후에만)

\echo '== (1) 이관 분류 건수 =='
SELECT 'STOCK (수주 연결 없음) → 자동 이관' AS class, count(*) AS plan_item_rows
  FROM "ProductionPlanItem" WHERE "salesOrderItemId" IS NULL
UNION ALL
SELECT 'ORDER (취소된 계획 이력) → 자동 이관', count(*)
  FROM "ProductionPlanItem" ppi JOIN "ProductionPlan" pp ON pp.id = ppi."planId"
 WHERE ppi."salesOrderItemId" IS NOT NULL AND pp.status = 'CANCELLED'
UNION ALL
SELECT 'ORDER (정상: 수주 수량 이내) → 자동 이관', count(*)
  FROM "ProductionPlanItem" ppi JOIN "ProductionPlan" pp ON pp.id = ppi."planId" AND pp.status <> 'CANCELLED'
  JOIN "SalesOrderItem" soi ON soi.id = ppi."salesOrderItemId"
 WHERE ppi."salesOrderItemId" IN (
   SELECT a."salesOrderItemId" FROM "ProductionPlanItem" a JOIN "ProductionPlan" b ON b.id = a."planId" AND b.status <> 'CANCELLED'
     JOIN "SalesOrderItem" s ON s.id = a."salesOrderItemId" GROUP BY a."salesOrderItemId", s.qty HAVING sum(a."plannedQty") <= s.qty)
UNION ALL
SELECT '예외: 수주 수량 초과 수주 품목 (이관 중단 대상)', count(*) FROM (
  SELECT ppi."salesOrderItemId" FROM "ProductionPlanItem" ppi
    JOIN "ProductionPlan" pp ON pp.id = ppi."planId" AND pp.status <> 'CANCELLED'
    JOIN "SalesOrderItem" soi ON soi.id = ppi."salesOrderItemId"
   GROUP BY ppi."salesOrderItemId", soi.qty HAVING sum(ppi."plannedQty") > soi.qty) x
UNION ALL
SELECT '예외: 계획 수량이 음수인 줄 (이관 중단 대상)', count(*) FROM "ProductionPlanItem" WHERE "plannedQty" < 0;

\echo '== (2) 예외 수주 품목: 수주 수량 vs 비취소 계획 합계 =='
SELECT so."orderNo", i.code AS item_code, soi.id AS sales_order_item_id, soi.qty AS order_qty,
       sum(ppi."plannedQty") AS planned_sum, sum(ppi."plannedQty") - soi.qty AS over_qty, count(*) AS plan_lines
  FROM "ProductionPlanItem" ppi
  JOIN "ProductionPlan" pp ON pp.id = ppi."planId" AND pp.status <> 'CANCELLED'
  JOIN "SalesOrderItem" soi ON soi.id = ppi."salesOrderItemId"
  JOIN "SalesOrder" so ON so.id = soi."salesOrderId"
  JOIN "Item" i ON i.id = soi."itemId"
 GROUP BY so."orderNo", i.code, soi.id, soi.qty
HAVING sum(ppi."plannedQty") > soi.qty
 ORDER BY so."orderNo", i.code;

\echo '== (3) 예외 수주 품목에 연결된 계획 줄 (수량·상태 — 충당 수량 제안 없음) =='
SELECT so."orderNo", pp."planNo", pp.status AS plan_status, pp."createdAt" AS plan_created, ppi."plannedQty" AS planned_qty, soi.qty AS order_qty
  FROM "ProductionPlanItem" ppi
  JOIN "ProductionPlan" pp ON pp.id = ppi."planId"
  JOIN "SalesOrderItem" soi ON soi.id = ppi."salesOrderItemId"
  JOIN "SalesOrder" so ON so.id = soi."salesOrderId"
 WHERE ppi."salesOrderItemId" IN (
   SELECT a."salesOrderItemId" FROM "ProductionPlanItem" a JOIN "ProductionPlan" b ON b.id = a."planId" AND b.status <> 'CANCELLED'
     JOIN "SalesOrderItem" s ON s.id = a."salesOrderItemId" GROUP BY a."salesOrderItemId", s.qty HAVING sum(a."plannedQty") > s.qty)
 ORDER BY so."orderNo", pp."createdAt", pp."planNo";

\echo '== (4) 계획 수량이 음수인 줄 =='
SELECT pp."planNo", ppi.id AS plan_item_id, ppi."plannedQty" FROM "ProductionPlanItem" ppi JOIN "ProductionPlan" pp ON pp.id = ppi."planId" WHERE ppi."plannedQty" < 0;
