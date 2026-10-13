-- CreateEnum
CREATE TYPE "RecurrencePreventionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'VERIFYING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "VerificationResult" AS ENUM ('EFFECTIVE', 'INEFFECTIVE');

-- CreateTable
CREATE TABLE "DefectRecurrencePrevention" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "defectRecordId" TEXT NOT NULL,
    "preventionContent" TEXT NOT NULL,
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "RecurrencePreventionStatus" NOT NULL DEFAULT 'OPEN',
    "verificationContent" TEXT,
    "verificationResult" "VerificationResult",
    "verifierId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefectRecurrencePrevention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DefectRecurrencePrevention_tenantId_idx" ON "DefectRecurrencePrevention"("tenantId");

-- CreateIndex
CREATE INDEX "DefectRecurrencePrevention_tenantId_status_idx" ON "DefectRecurrencePrevention"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DefectRecurrencePrevention_tenantId_dueDate_idx" ON "DefectRecurrencePrevention"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "DefectRecurrencePrevention_defectRecordId_idx" ON "DefectRecurrencePrevention"("defectRecordId");

-- CreateIndex
CREATE INDEX "DefectRecurrencePrevention_assigneeId_idx" ON "DefectRecurrencePrevention"("assigneeId");

-- AddForeignKey
ALTER TABLE "DefectRecurrencePrevention" ADD CONSTRAINT "DefectRecurrencePrevention_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecurrencePrevention" ADD CONSTRAINT "DefectRecurrencePrevention_defectRecordId_fkey" FOREIGN KEY ("defectRecordId") REFERENCES "DefectRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecurrencePrevention" ADD CONSTRAINT "DefectRecurrencePrevention_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecurrencePrevention" ADD CONSTRAINT "DefectRecurrencePrevention_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecurrencePrevention" ADD CONSTRAINT "DefectRecurrencePrevention_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecurrencePrevention" ADD CONSTRAINT "DefectRecurrencePrevention_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
