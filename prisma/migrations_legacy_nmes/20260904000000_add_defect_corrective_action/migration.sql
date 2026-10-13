-- CreateEnum
CREATE TYPE "CorrectiveActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "DefectCorrectiveAction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "defectRecordId" TEXT NOT NULL,
    "actionContent" TEXT NOT NULL,
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "CorrectiveActionStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "completionNote" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefectCorrectiveAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DefectCorrectiveAction_tenantId_idx" ON "DefectCorrectiveAction"("tenantId");

-- CreateIndex
CREATE INDEX "DefectCorrectiveAction_tenantId_status_idx" ON "DefectCorrectiveAction"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DefectCorrectiveAction_tenantId_dueDate_idx" ON "DefectCorrectiveAction"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "DefectCorrectiveAction_defectRecordId_idx" ON "DefectCorrectiveAction"("defectRecordId");

-- CreateIndex
CREATE INDEX "DefectCorrectiveAction_assigneeId_idx" ON "DefectCorrectiveAction"("assigneeId");

-- AddForeignKey
ALTER TABLE "DefectCorrectiveAction" ADD CONSTRAINT "DefectCorrectiveAction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCorrectiveAction" ADD CONSTRAINT "DefectCorrectiveAction_defectRecordId_fkey" FOREIGN KEY ("defectRecordId") REFERENCES "DefectRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCorrectiveAction" ADD CONSTRAINT "DefectCorrectiveAction_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCorrectiveAction" ADD CONSTRAINT "DefectCorrectiveAction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCorrectiveAction" ADD CONSTRAINT "DefectCorrectiveAction_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
