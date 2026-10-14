-- Phase 6: MRP 실행이력 / Snapshot / DRAFT 구매발주 연결
--
-- MrpRun(불변 Snapshot) / MrpRunSuggestion(발주제안 행) / MrpRunPurchase(DRAFT PO 연결, 멱등키) 신규 테이블 3개.
-- additive migration: 기존 테이블/데이터는 변경하지 않는다(관계 컬럼 추가 없음, 신규 테이블이 기존 테이블을 FK 로 참조만 한다).
-- 신규 테이블에는 RLS 와 anon/authenticated 권한 회수를 함께 적용한다.

-- CreateTable
CREATE TABLE "MrpRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runType" TEXT NOT NULL DEFAULT 'ORDER_MRP',
    "mode" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'SAVED',
    "baseDate" DATE NOT NULL,
    "fromDate" DATE,
    "toDate" DATE,
    "includeDraft" BOOLEAN NOT NULL DEFAULT false,
    "includeScheduledReceipts" BOOLEAN NOT NULL DEFAULT true,
    "semiFinishedNetting" BOOLEAN NOT NULL DEFAULT true,
    "demandLineCount" INTEGER NOT NULL DEFAULT 0,
    "materialCount" INTEGER NOT NULL DEFAULT 0,
    "shortageMaterialCount" INTEGER NOT NULL DEFAULT 0,
    "purchaseNeededCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "resultHash" TEXT NOT NULL,
    "requestKey" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MrpRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MrpRunSuggestion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rawNeed" DECIMAL(18,6) NOT NULL,
    "suggestedQty" DECIMAL(18,6) NOT NULL,
    "draftCoverageQty" DECIMAL(18,6) NOT NULL,
    "additionalQty" DECIMAL(18,6) NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "targetReceiptDate" DATE,
    "orderByDate" DATE,
    "payload" JSONB NOT NULL,

    CONSTRAINT "MrpRunSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MrpRunPurchase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "orderNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "totalQty" DECIMAL(18,6) NOT NULL,
    "overrideUsed" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "lines" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MrpRunPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MrpRun_tenantId_createdAt_idx" ON "MrpRun"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MrpRun_tenantId_requestKey_key" ON "MrpRun"("tenantId", "requestKey");

-- CreateIndex
CREATE INDEX "MrpRunSuggestion_tenantId_itemId_idx" ON "MrpRunSuggestion"("tenantId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "MrpRunSuggestion_runId_itemId_key" ON "MrpRunSuggestion"("runId", "itemId");

-- CreateIndex
CREATE INDEX "MrpRunPurchase_tenantId_runId_idx" ON "MrpRunPurchase"("tenantId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "MrpRunPurchase_tenantId_requestKey_supplierId_key" ON "MrpRunPurchase"("tenantId", "requestKey", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "MrpRunPurchase_purchaseOrderId_key" ON "MrpRunPurchase"("purchaseOrderId");

-- AddForeignKey
ALTER TABLE "MrpRun" ADD CONSTRAINT "MrpRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MrpRun" ADD CONSTRAINT "MrpRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MrpRunSuggestion" ADD CONSTRAINT "MrpRunSuggestion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MrpRunSuggestion" ADD CONSTRAINT "MrpRunSuggestion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MrpRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MrpRunPurchase" ADD CONSTRAINT "MrpRunPurchase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MrpRunPurchase" ADD CONSTRAINT "MrpRunPurchase_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MrpRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MrpRunPurchase" ADD CONSTRAINT "MrpRunPurchase_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── 이하 Prisma schema 로 표현되지 않는 DB 제약 / 하드닝 (수기 추가) ───────────────────────

-- 값 범위
ALTER TABLE "MrpRun" ADD CONSTRAINT "MrpRun_status_chk" CHECK ("status" IN ('SAVED'));
ALTER TABLE "MrpRun" ADD CONSTRAINT "MrpRun_runType_chk" CHECK ("runType" IN ('ORDER_MRP'));
ALTER TABLE "MrpRun" ADD CONSTRAINT "MrpRun_mode_chk" CHECK ("mode" IN ('NORMAL'));
ALTER TABLE "MrpRun" ADD CONSTRAINT "MrpRun_counts_chk" CHECK (
  "demandLineCount" >= 0 AND "materialCount" >= 0 AND "shortageMaterialCount" >= 0 AND "purchaseNeededCount" >= 0 AND "warningCount" >= 0 AND "snapshotVersion" >= 1
);
ALTER TABLE "MrpRunSuggestion" ADD CONSTRAINT "MrpRunSuggestion_qty_chk" CHECK (
  "rawNeed" >= 0 AND "suggestedQty" >= 0 AND "draftCoverageQty" >= 0 AND "additionalQty" >= 0
);
ALTER TABLE "MrpRunPurchase" ADD CONSTRAINT "MrpRunPurchase_qty_chk" CHECK ("totalQty" > 0 AND "itemCount" > 0);
ALTER TABLE "MrpRunPurchase" ADD CONSTRAINT "MrpRunPurchase_override_reason_chk" CHECK ("overrideUsed" = false OR ("overrideReason" IS NOT NULL AND length(btrim("overrideReason")) > 0));

-- Snapshot 불변성: 저장된 이력은 이후 수정할 수 없다.
--  - MrpRun / MrpRunSuggestion: 행 전체 불변(작성자 Profile 삭제로 인한 createdById NULL 전환만 허용)
--  - MrpRunPurchase: 구매발주(PO)가 삭제되어 purchaseOrderId 가 NULL 로 바뀌는 것(FK SET NULL)과 createdById NULL 전환만 허용
CREATE OR REPLACE FUNCTION "mrp_run_history_immutable_guard"() RETURNS trigger AS $$
DECLARE
  allowed text[];
BEGIN
  IF TG_TABLE_NAME = 'MrpRunPurchase' THEN
    allowed := ARRAY['purchaseOrderId', 'createdById'];
  ELSIF TG_TABLE_NAME = 'MrpRun' THEN
    allowed := ARRAY['createdById'];
  ELSE
    allowed := ARRAY[]::text[];
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION '% 이력은 수정할 수 없습니다(immutable snapshot).', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MrpRun_immutable_trg" BEFORE UPDATE ON "MrpRun"
  FOR EACH ROW EXECUTE FUNCTION "mrp_run_history_immutable_guard"();
CREATE TRIGGER "MrpRunSuggestion_immutable_trg" BEFORE UPDATE ON "MrpRunSuggestion"
  FOR EACH ROW EXECUTE FUNCTION "mrp_run_history_immutable_guard"();
CREATE TRIGGER "MrpRunPurchase_immutable_trg" BEFORE UPDATE ON "MrpRunPurchase"
  FOR EACH ROW EXECUTE FUNCTION "mrp_run_history_immutable_guard"();

-- ── Supabase hardening (20261013000100_supabase_public_hardening 과 동일한 의도) ─────────────
-- 하드닝 migration 은 "당시 존재하던" 테이블에만 RLS 를 켰으므로 신규 테이블에도 직접 적용한다.
-- 정책 없음 = anon/authenticated 거부. 앱은 Prisma(테이블 소유자) / service_role 로만 접근한다.
ALTER TABLE "MrpRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MrpRunSuggestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MrpRunPurchase" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
  tbl text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH tbl IN ARRAY ARRAY['MrpRun', 'MrpRunSuggestion', 'MrpRunPurchase'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', tbl, role_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;
