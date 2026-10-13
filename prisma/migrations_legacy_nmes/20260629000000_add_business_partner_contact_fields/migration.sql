-- BusinessPartner 연락처/상세 정보 컬럼 추가 (전부 nullable, 기존 행은 null로 채워짐)
ALTER TABLE "BusinessPartner"
  ADD COLUMN "businessNumber" TEXT,
  ADD COLUMN "ceoName" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "email2" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "contactPhone" TEXT,
  ADD COLUMN "remark" TEXT;
