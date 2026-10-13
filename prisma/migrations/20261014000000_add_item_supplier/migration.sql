-- Phase 5A: 품목별 공급업체 기준정보 (ItemSupplier)
--
-- 품목 ↔ 공급업체(BusinessPartner SUPPLIER|BOTH) 관계와 발주 조건(리드타임/MOQ/발주배수).
-- 가격은 저장하지 않는다(ItemPrice). additive migration: 신규 테이블만 만들고 기존 테이블/데이터는 변경하지 않는다.

-- CreateTable
CREATE TABLE "ItemSupplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "leadTimeDays" INTEGER,
    "moq" DECIMAL(18,6),
    "orderMultiple" DECIMAL(18,6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemSupplier_tenantId_itemId_idx" ON "ItemSupplier"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "ItemSupplier_tenantId_supplierId_idx" ON "ItemSupplier"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemSupplier_tenantId_itemId_supplierId_key" ON "ItemSupplier"("tenantId", "itemId", "supplierId");

-- AddForeignKey
ALTER TABLE "ItemSupplier" ADD CONSTRAINT "ItemSupplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSupplier" ADD CONSTRAINT "ItemSupplier_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSupplier" ADD CONSTRAINT "ItemSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 이하 Prisma schema 로 표현되지 않는 DB 제약 (수기 추가) ─────────────────────────────────

-- 품목당 ACTIVE Default 공급업체는 최대 1개 (partial unique index).
-- 서비스(item-supplier.service.ts)도 같은 transaction 안에서 기존 Default 를 먼저 해제한 뒤 지정한다.
CREATE UNIQUE INDEX "ItemSupplier_one_active_default_per_item"
    ON "ItemSupplier"("tenantId", "itemId")
    WHERE "isDefault" = true AND "isActive" = true;

-- 값 범위: 미설정은 NULL 로만 표현한다(0 을 "미설정"으로 쓰지 않는다).
ALTER TABLE "ItemSupplier" ADD CONSTRAINT "ItemSupplier_priority_range_chk" CHECK ("priority" >= 0 AND "priority" <= 9999);
ALTER TABLE "ItemSupplier" ADD CONSTRAINT "ItemSupplier_leadTimeDays_chk" CHECK ("leadTimeDays" IS NULL OR ("leadTimeDays" >= 0 AND "leadTimeDays" <= 3650));
ALTER TABLE "ItemSupplier" ADD CONSTRAINT "ItemSupplier_moq_chk" CHECK ("moq" IS NULL OR "moq" > 0);
ALTER TABLE "ItemSupplier" ADD CONSTRAINT "ItemSupplier_orderMultiple_chk" CHECK ("orderMultiple" IS NULL OR "orderMultiple" > 0);
-- 비활성 관계는 Default 상태를 유지하지 않는다.
ALTER TABLE "ItemSupplier" ADD CONSTRAINT "ItemSupplier_inactive_not_default_chk" CHECK ("isActive" = true OR "isDefault" = false);

-- ── Supabase hardening (20261013000100_supabase_public_hardening 과 동일한 의도) ─────────────
-- 하드닝 migration 은 "당시 존재하던" 테이블에만 RLS 를 켰으므로 신규 테이블에도 직접 적용한다.
-- 정책 없음 = anon/authenticated 거부. 앱은 Prisma(테이블 소유자) / service_role 로만 접근한다.
ALTER TABLE "ItemSupplier" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public."ItemSupplier" FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
