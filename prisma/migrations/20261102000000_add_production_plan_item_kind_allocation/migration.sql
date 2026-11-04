-- ProductionPlanItem: 생산 유형(ORDER / ORDER_EXTRA / STOCK)과 수주 충당 수량(allocatedQty) 분리
--
-- 배경: 지금까지 plannedQty 하나가 "실제 생산 허용량"과 "수주 충당 수량"을 겸했다. 대원정밀은 수주 수량보다 여유 있게 생산하거나
--       수주 없이 재고를 위해 생산하므로 둘을 구분해야 한다.
--         - plannedQty   : 실제 생산 허용량(작업지시·완제품입고·MRP 의 기준). 기존 의미 그대로.
--         - allocatedQty : 이 계획 줄이 수주 품목 수량에서 가져가는 몫. 수주 품목별 합계(취소 제외) ≤ SalesOrderItem.qty.
--         - SalesOrderItem.producedQty(생산실적 컬럼)는 이 의미와 무관하다 — 재사용하지 않는다.
--
-- 이 migration 은 **SQL 이 기준**이다(CHECK·트리거는 Prisma 스키마로 표현되지 않는다).
-- 전체가 한 트랜잭션이다(Prisma 가 파일 전체를 한 번에 실행하고, 중간에 실패하면 PostgreSQL 이 전부 롤백한다 — 검증 결과는 test-results/N-19-RESULT.md).
-- 기존 데이터는 삭제·수량 변경 없이 컬럼만 채운다. 사전 점검: scripts/sql/production-plan-allocation-precheck.sql (읽기 전용, 운영 적용 전 필수).
--
-- 이관 정책 (업무 정책으로 확정된 것만 자동 처리한다)
--   자동 이관(정상 데이터)
--     1) 수주 연결 없음(salesOrderItemId IS NULL)                 → STOCK, 충당 0
--     2) 수주 연결 + 취소된 계획                                  → ORDER, 충당 = 계획 수량 (충당 합계에 포함되지 않는 이력 보존용)
--     3) 수주 연결 + 비취소 계획, 같은 수주 품목의 계획 수량 합계 ≤ 수주 수량 → ORDER, 충당 = 계획 수량
--   예외 데이터 → **이관 중단**(아무것도 바뀌지 않음)
--     - 같은 수주 품목의 비취소 계획 수량 합계가 수주 수량을 넘는 경우, 또는 계획 수량이 음수인 경우.
--     - 예외 데이터의 충당 수량·여유 사유·승인 상태는 승인된 업무 정책이 없으므로 이 migration 이 임의로 정하지 않는다.
--       중단 시 오류 메시지에 건수와 대상(최대 10건)이 나온다 → 사전 점검 SQL 로 전체 목록을 확인하고,
--       업무 담당자가 처리 방침(계획 수량 정정·취소, 또는 이관 규칙 확정)을 정한 뒤 다시 배포한다.
--     - 실패한 migration 복구(Prisma): 원인 해결 후 `prisma migrate resolve --rolled-back 20261102000000_add_production_plan_item_kind_allocation` → `prisma migrate deploy`.
--
-- 호환: 이 migration 이전 코드가 연결된 줄을 INSERT 하면(유형·충당 미지정) 트리거가 ORDER / 충당 = 계획 수량으로 채운다.
--       이전 코드가 plannedQty 만 올리는 UPDATE 는 CHECK 에 걸려 거부된다(= N-19 우회가 DB 에서도 막힌다).
--
-- 롤백(데이터 손실 없음, 새 컬럼 값만 사라짐):
--   DROP TRIGGER "ProductionPlanItem_legacy_link_defaults" ON "ProductionPlanItem";
--   DROP FUNCTION "ProductionPlanItem_legacy_link_defaults"();
--   ALTER TABLE "ProductionPlanItem" DROP CONSTRAINT "ProductionPlanItem_allocation_check";
--   DROP INDEX "ProductionPlanItem_salesOrderItemId_idx";
--   ALTER TABLE "ProductionPlanItem" DROP COLUMN "productionKind", DROP COLUMN "allocatedQty", DROP COLUMN "extraReason",
--     DROP COLUMN "extraApprovalStatus", DROP COLUMN "extraApprovedById", DROP COLUMN "extraApprovedAt";
--   DROP TYPE "ProductionKind"; DROP TYPE "ExtraApprovalStatus";

-- 0) 사전 점검: 예외 데이터가 있으면 아무것도 하지 않고 중단한다.
DO $$
DECLARE
  v_over_count  bigint;
  v_neg_count   bigint;
  v_sample      text;
BEGIN
  SELECT count(*) INTO v_over_count FROM (
    SELECT ppi."salesOrderItemId"
      FROM "ProductionPlanItem" ppi
      JOIN "ProductionPlan" pp ON pp.id = ppi."planId" AND pp.status <> 'CANCELLED'
      JOIN "SalesOrderItem" soi ON soi.id = ppi."salesOrderItemId"
     GROUP BY ppi."salesOrderItemId", soi.qty
    HAVING sum(ppi."plannedQty") > soi.qty
  ) x;

  SELECT count(*) INTO v_neg_count FROM "ProductionPlanItem" WHERE "plannedQty" < 0;

  IF v_over_count > 0 OR v_neg_count > 0 THEN
    SELECT string_agg(line, E'\n') INTO v_sample FROM (
      SELECT format('  수주 %s / 품목 %s: 수주 수량 %s, 비취소 계획 합계 %s (초과 %s)', so."orderNo", i.code, soi.qty, sum(ppi."plannedQty"), sum(ppi."plannedQty") - soi.qty) AS line
        FROM "ProductionPlanItem" ppi
        JOIN "ProductionPlan" pp ON pp.id = ppi."planId" AND pp.status <> 'CANCELLED'
        JOIN "SalesOrderItem" soi ON soi.id = ppi."salesOrderItemId"
        JOIN "SalesOrder" so ON so.id = soi."salesOrderId"
        JOIN "Item" i ON i.id = soi."itemId"
       GROUP BY so."orderNo", i.code, soi.id, soi.qty
      HAVING sum(ppi."plannedQty") > soi.qty
       ORDER BY so."orderNo", i.code
       LIMIT 10
    ) s;
    RAISE EXCEPTION 'PRODUCTION_PLAN_ALLOCATION_EXCEPTIONS: 수주 수량을 넘는 생산계획 수주 품목 % 건, 계획 수량이 음수인 줄 % 건. 이관을 중단했습니다(변경 없음). 충당 수량은 승인된 업무 정책 없이 임의 배분하지 않습니다. scripts/sql/production-plan-allocation-precheck.sql 로 전체 목록을 확인하고 처리 방침을 정한 뒤 다시 배포하세요.%',
      v_over_count, v_neg_count, CASE WHEN v_sample IS NULL THEN '' ELSE E'\n' || v_sample END;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "ProductionKind" AS ENUM ('ORDER', 'ORDER_EXTRA', 'STOCK');

-- CreateEnum
CREATE TYPE "ExtraApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "ProductionPlanItem"
  ADD COLUMN "productionKind" "ProductionKind" NOT NULL DEFAULT 'STOCK',
  ADD COLUMN "allocatedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN "extraReason" TEXT,
  ADD COLUMN "extraApprovalStatus" "ExtraApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "extraApprovedById" TEXT,
  ADD COLUMN "extraApprovedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ProductionPlanItem_salesOrderItemId_idx" ON "ProductionPlanItem"("salesOrderItemId");

-- 백필 (CHECK·트리거를 만들기 전에 수행). 위 사전 점검을 통과했으므로 연결된 줄의 충당 수량은 항상 계획 수량이다.
UPDATE "ProductionPlanItem"
   SET "allocatedQty" = "plannedQty",
       "productionKind" = 'ORDER'
 WHERE "salesOrderItemId" IS NOT NULL;

-- 일관성 CHECK: 유형 ↔ 수주 연결 ↔ 충당 수량 ↔ 여유 사유
--   STOCK       : 수주 연결 없음, 충당 0
--   ORDER       : 충당 = 계획 수량 (여유 없음)
--   ORDER_EXTRA : 충당 < 계획 수량, 여유 사유 필수
-- (수주 품목이 삭제되면 FK 가 연결을 NULL 로 만든다. 그 경우 ORDER / ORDER_EXTRA 이력은 연결 없이 남을 수 있으므로 연결 필수로 강제하지 않는다.)
ALTER TABLE "ProductionPlanItem"
  ADD CONSTRAINT "ProductionPlanItem_allocation_check" CHECK (
    "allocatedQty" >= 0
    AND "allocatedQty" <= "plannedQty"
    AND (
      ("productionKind" = 'STOCK' AND "salesOrderItemId" IS NULL AND "allocatedQty" = 0)
      OR ("productionKind" = 'ORDER' AND "allocatedQty" = "plannedQty")
      OR ("productionKind" = 'ORDER_EXTRA' AND "allocatedQty" < "plannedQty" AND char_length(btrim(coalesce("extraReason", ''))) > 0)
    )
  );

-- 이전 코드 호환: 유형·충당을 지정하지 않은 연결 줄 INSERT 는 ORDER / 충당 = 계획 수량으로 채운다.
CREATE FUNCTION "ProductionPlanItem_legacy_link_defaults"() RETURNS trigger AS $$
BEGIN
  IF NEW."salesOrderItemId" IS NOT NULL AND NEW."productionKind" = 'STOCK' AND NEW."allocatedQty" = 0 THEN
    NEW."productionKind" := 'ORDER';
    NEW."allocatedQty" := NEW."plannedQty";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProductionPlanItem_legacy_link_defaults"
  BEFORE INSERT ON "ProductionPlanItem"
  FOR EACH ROW EXECUTE FUNCTION "ProductionPlanItem_legacy_link_defaults"();
