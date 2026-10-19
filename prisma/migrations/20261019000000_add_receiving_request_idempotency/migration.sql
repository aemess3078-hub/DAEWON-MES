-- 자재입고 요청 멱등성 원장 (ReceivingRequest)
--
-- 같은 (tenantId, requestId) 입고 요청은 한 번만 처리한다. 입고검사/재고/수불/거래번호/LOT 와 같은 트랜잭션에서
-- 만들어지므로 롤백되면 함께 사라진다. 신규 테이블 추가뿐이며 기존 테이블/데이터/migration 은 변경하지 않는다.
-- 롤백: DROP TABLE "ReceivingRequest";  (앱 코드는 이 테이블이 없으면 입고를 처리하지 못하므로 코드와 함께 되돌린다)
--
-- 아래 DDL 은 `prisma migrate diff --from-schema-datamodel <이전 schema> --to-schema-datamodel <새 schema> --script` 결과이다.

-- CreateTable
CREATE TABLE "ReceivingRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "receivingInspectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceivingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceivingRequest_receivingInspectionId_key" ON "ReceivingRequest"("receivingInspectionId");

-- CreateIndex
CREATE INDEX "ReceivingRequest_purchaseOrderItemId_idx" ON "ReceivingRequest"("purchaseOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceivingRequest_tenantId_requestId_key" ON "ReceivingRequest"("tenantId", "requestId");

-- AddForeignKey
ALTER TABLE "ReceivingRequest" ADD CONSTRAINT "ReceivingRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingRequest" ADD CONSTRAINT "ReceivingRequest_receivingInspectionId_fkey" FOREIGN KEY ("receivingInspectionId") REFERENCES "ReceivingInspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 입력 형식 방어 (앱 검증과 동일한 의도): 요청 ID 16~128자, 요청 해시는 SHA-256 hex 64자
ALTER TABLE "ReceivingRequest" ADD CONSTRAINT "ReceivingRequest_requestId_len_chk" CHECK (char_length("requestId") BETWEEN 16 AND 128);
ALTER TABLE "ReceivingRequest" ADD CONSTRAINT "ReceivingRequest_requestHash_fmt_chk" CHECK ("requestHash" ~ '^[0-9a-f]{64}$');

-- ── Supabase hardening (20261013000100_supabase_public_hardening 과 동일한 의도) ─────────────
-- 정책 없음 = anon/authenticated 거부. 앱은 Prisma(테이블 소유자) / service_role 로만 접근한다.
ALTER TABLE "ReceivingRequest" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public."ReceivingRequest" FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
