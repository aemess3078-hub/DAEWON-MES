-- Phase 5D: 품목 안전재고 (Item.safetyStock)
--
-- MRP 발주제안에서 "예상 가용재고가 유지해야 하는 목표 하한"으로만 사용하는 품목 정책값이다.
-- 물리 재고(openingStock)를 차감하지 않는다. additive migration: 컬럼 1개 추가, 기존 행은 0 으로 채워진다.
-- 신규 테이블이 아니므로 RLS / 권한(hardening) 변경은 없다(기존 Item 의 RLS 상태가 그대로 유지된다).

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "safetyStock" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ── 이하 Prisma schema 로 표현되지 않는 DB 제약 (수기 추가) ─────────────────────────────
-- 0 이상, 유한값. (PostgreSQL 에서 NaN 은 모든 수보다 크므로 상한 비교로 NaN/Infinity 를 함께 차단한다.)
ALTER TABLE "Item" ADD CONSTRAINT "Item_safetyStock_range_chk" CHECK ("safetyStock" >= 0 AND "safetyStock" < 1000000000000);
