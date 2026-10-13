-- CreateEnum
CREATE TYPE "InspectionJudgement" AS ENUM ('PASS', 'FAIL');

-- AlterTable
ALTER TABLE "InspectionItem" ADD COLUMN     "unit" TEXT;

-- CreateTable
CREATE TABLE "InspectionMeasurement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "qualityInspectionId" TEXT NOT NULL,
    "inspectionItemId" TEXT NOT NULL,
    "sampleNo" INTEGER NOT NULL DEFAULT 1,
    "numericValue" DECIMAL(18,6),
    "textValue" TEXT,
    "booleanValue" BOOLEAN,
    "lowerLimitSnapshot" DECIMAL(18,6),
    "upperLimitSnapshot" DECIMAL(18,6),
    "itemNameSnapshot" TEXT NOT NULL,
    "inputTypeSnapshot" "InspectionInputType" NOT NULL,
    "unitSnapshot" TEXT,
    "judgement" "InspectionJudgement",
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InspectionMeasurement_tenantId_measuredAt_idx" ON "InspectionMeasurement"("tenantId", "measuredAt");

-- CreateIndex
CREATE INDEX "InspectionMeasurement_tenantId_inspectionItemId_measuredAt_idx" ON "InspectionMeasurement"("tenantId", "inspectionItemId", "measuredAt");

-- CreateIndex
CREATE INDEX "InspectionMeasurement_qualityInspectionId_idx" ON "InspectionMeasurement"("qualityInspectionId");

-- CreateIndex
CREATE INDEX "InspectionMeasurement_inspectionItemId_idx" ON "InspectionMeasurement"("inspectionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionMeasurement_qualityInspectionId_inspectionItemId__key" ON "InspectionMeasurement"("qualityInspectionId", "inspectionItemId", "sampleNo");

-- AddForeignKey
ALTER TABLE "InspectionMeasurement" ADD CONSTRAINT "InspectionMeasurement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionMeasurement" ADD CONSTRAINT "InspectionMeasurement_qualityInspectionId_fkey" FOREIGN KEY ("qualityInspectionId") REFERENCES "QualityInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionMeasurement" ADD CONSTRAINT "InspectionMeasurement_inspectionItemId_fkey" FOREIGN KEY ("inspectionItemId") REFERENCES "InspectionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
