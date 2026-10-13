-- CreateEnum
CREATE TYPE "ProjectIssueType" AS ENUM ('ISSUE', 'RISK');

-- CreateEnum
CREATE TYPE "ProjectIssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ProjectIssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateTable
CREATE TABLE "ProjectIssue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectOrderId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ProjectIssueType" NOT NULL DEFAULT 'ISSUE',
    "severity" "ProjectIssueSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "ProjectIssueStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectIssue_tenantId_idx" ON "ProjectIssue"("tenantId");

-- CreateIndex
CREATE INDEX "ProjectIssue_tenantId_status_idx" ON "ProjectIssue"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ProjectIssue_tenantId_dueDate_idx" ON "ProjectIssue"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "ProjectIssue_projectOrderId_idx" ON "ProjectIssue"("projectOrderId");

-- CreateIndex
CREATE INDEX "ProjectIssue_assigneeId_idx" ON "ProjectIssue"("assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectIssue_tenantId_code_key" ON "ProjectIssue"("tenantId", "code");

-- AddForeignKey
ALTER TABLE "ProjectIssue" ADD CONSTRAINT "ProjectIssue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIssue" ADD CONSTRAINT "ProjectIssue_projectOrderId_fkey" FOREIGN KEY ("projectOrderId") REFERENCES "ProjectOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIssue" ADD CONSTRAINT "ProjectIssue_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIssue" ADD CONSTRAINT "ProjectIssue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
