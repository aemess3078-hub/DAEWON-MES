-- CreateTable
CREATE TABLE "DefectCauseAnalysis" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "defectRecordId" TEXT NOT NULL,
    "rootCause" TEXT NOT NULL,
    "analysisDetail" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefectCauseAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DefectCauseAnalysis_defectRecordId_key" ON "DefectCauseAnalysis"("defectRecordId");

-- CreateIndex
CREATE INDEX "DefectCauseAnalysis_tenantId_idx" ON "DefectCauseAnalysis"("tenantId");

-- AddForeignKey
ALTER TABLE "DefectCauseAnalysis" ADD CONSTRAINT "DefectCauseAnalysis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCauseAnalysis" ADD CONSTRAINT "DefectCauseAnalysis_defectRecordId_fkey" FOREIGN KEY ("defectRecordId") REFERENCES "DefectRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCauseAnalysis" ADD CONSTRAINT "DefectCauseAnalysis_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCauseAnalysis" ADD CONSTRAINT "DefectCauseAnalysis_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
