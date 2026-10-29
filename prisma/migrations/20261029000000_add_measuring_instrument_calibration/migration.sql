-- 계측기 검교정관리: MeasuringInstrument / InstrumentCalibration / InstrumentStatusHistory
--
-- 추가 전용(additive) migration 이다. 기존 테이블·데이터는 변경/삭제하지 않는다.
--  - 신규 enum 4개, 신규 테이블 3개, 신규 인덱스/FK 만 만든다.
--  - 롤백: DROP TABLE "InstrumentStatusHistory", "InstrumentCalibration", "MeasuringInstrument";
--          DROP TYPE "InstrumentDataSource", "CalibrationProgressStatus", "CalibrationResult", "InstrumentUsageStatus";
--          (신규 테이블이라 앱의 다른 기능에는 영향이 없다)
--  - 성적서 파일 첨부용 테이블/스토리지는 만들지 않는다(성적서 번호만 문자열로 관리).

-- CreateEnum
CREATE TYPE "InstrumentUsageStatus" AS ENUM ('AVAILABLE', 'SUSPENDED', 'ON_HOLD', 'DISPOSED');

-- CreateEnum
CREATE TYPE "CalibrationResult" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "CalibrationProgressStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "InstrumentDataSource" AS ENUM ('MANUAL', 'EXCEL_IMPORT');

-- CreateTable
CREATE TABLE "MeasuringInstrument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "managementNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "specification" TEXT,
    "serialNo" TEXT,
    "manufacturer" TEXT,
    "calibrationRequired" BOOLEAN NOT NULL DEFAULT true,
    "calibrationIntervalMonths" INTEGER,
    "department" TEXT,
    "location" TEXT,
    "managerId" TEXT,
    "usageStatus" "InstrumentUsageStatus" NOT NULL DEFAULT 'AVAILABLE',
    "lastCalibrationDate" DATE,
    "nextCalibrationDate" DATE,
    "currentCalibrationId" TEXT,
    "remarks" TEXT,
    "source" "InstrumentDataSource" NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MeasuringInstrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstrumentCalibration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "progressStatus" "CalibrationProgressStatus" NOT NULL DEFAULT 'COMPLETED',
    "plannedDate" DATE,
    "calibrationDate" DATE,
    "calibrationAgency" TEXT,
    "certificateNo" TEXT,
    "result" "CalibrationResult",
    "nextCalibrationDate" DATE,
    "nextDateOverridden" BOOLEAN NOT NULL DEFAULT false,
    "nextDateChangeReason" TEXT,
    "calibrationCost" DECIMAL(14,2),
    "managerId" TEXT,
    "remarks" TEXT,
    "source" "InstrumentDataSource" NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "sourceKey" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstrumentCalibration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstrumentStatusHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "previousStatus" "InstrumentUsageStatus",
    "newStatus" "InstrumentUsageStatus" NOT NULL,
    "reason" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstrumentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeasuringInstrument_currentCalibrationId_key" ON "MeasuringInstrument"("currentCalibrationId");

-- CreateIndex
CREATE INDEX "MeasuringInstrument_tenantId_deletedAt_idx" ON "MeasuringInstrument"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "MeasuringInstrument_tenantId_usageStatus_idx" ON "MeasuringInstrument"("tenantId", "usageStatus");

-- CreateIndex
CREATE INDEX "MeasuringInstrument_tenantId_nextCalibrationDate_idx" ON "MeasuringInstrument"("tenantId", "nextCalibrationDate");

-- CreateIndex
CREATE UNIQUE INDEX "MeasuringInstrument_tenantId_managementNo_key" ON "MeasuringInstrument"("tenantId", "managementNo");

-- CreateIndex
CREATE INDEX "InstrumentCalibration_tenantId_instrumentId_calibrationDate_idx" ON "InstrumentCalibration"("tenantId", "instrumentId", "calibrationDate");

-- CreateIndex
CREATE INDEX "InstrumentCalibration_tenantId_progressStatus_idx" ON "InstrumentCalibration"("tenantId", "progressStatus");

-- CreateIndex
CREATE UNIQUE INDEX "InstrumentCalibration_tenantId_sourceKey_key" ON "InstrumentCalibration"("tenantId", "sourceKey");

-- CreateIndex
CREATE INDEX "InstrumentStatusHistory_tenantId_instrumentId_changedAt_idx" ON "InstrumentStatusHistory"("tenantId", "instrumentId", "changedAt");

-- AddForeignKey
ALTER TABLE "MeasuringInstrument" ADD CONSTRAINT "MeasuringInstrument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasuringInstrument" ADD CONSTRAINT "MeasuringInstrument_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasuringInstrument" ADD CONSTRAINT "MeasuringInstrument_currentCalibrationId_fkey" FOREIGN KEY ("currentCalibrationId") REFERENCES "InstrumentCalibration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstrumentCalibration" ADD CONSTRAINT "InstrumentCalibration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstrumentCalibration" ADD CONSTRAINT "InstrumentCalibration_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "MeasuringInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstrumentCalibration" ADD CONSTRAINT "InstrumentCalibration_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstrumentStatusHistory" ADD CONSTRAINT "InstrumentStatusHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstrumentStatusHistory" ADD CONSTRAINT "InstrumentStatusHistory_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "MeasuringInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Supabase hardening (20261013000100_supabase_public_hardening 과 동일한 의도) ─────────────
-- 하드닝 migration 은 "당시 존재하던" 테이블에만 RLS 를 켰으므로 신규 테이블에도 직접 적용한다.
-- 정책 없음 = anon/authenticated 거부. 앱은 Prisma(테이블 소유자) / service_role 로만 접근한다.
ALTER TABLE "MeasuringInstrument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InstrumentCalibration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InstrumentStatusHistory" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
  tbl text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH tbl IN ARRAY ARRAY['MeasuringInstrument', 'InstrumentCalibration', 'InstrumentStatusHistory'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', tbl, role_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;
