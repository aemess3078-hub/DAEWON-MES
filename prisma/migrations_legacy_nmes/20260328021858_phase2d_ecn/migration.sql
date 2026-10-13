-- CreateEnum
CREATE TYPE "ECNStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWING', 'APPROVED', 'REJECTED', 'IMPLEMENTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "EngineeringChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ecnNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "targetItemId" TEXT NOT NULL,
    "status" "ECNStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "implementedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngineeringChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineeringChangeDetail" (
    "id" TEXT NOT NULL,
    "engineeringChangeId" TEXT NOT NULL,
    "changeTarget" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "description" TEXT,

    CONSTRAINT "EngineeringChangeDetail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EngineeringChange_tenantId_status_idx" ON "EngineeringChange"("tenantId", "status");

-- CreateIndex
CREATE INDEX "EngineeringChange_targetItemId_idx" ON "EngineeringChange"("targetItemId");

-- CreateIndex
CREATE UNIQUE INDEX "EngineeringChange_tenantId_ecnNo_key" ON "EngineeringChange"("tenantId", "ecnNo");

-- CreateIndex
CREATE INDEX "EngineeringChangeDetail_engineeringChangeId_idx" ON "EngineeringChangeDetail"("engineeringChangeId");

-- AddForeignKey
ALTER TABLE "EngineeringChange" ADD CONSTRAINT "EngineeringChange_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineeringChange" ADD CONSTRAINT "EngineeringChange_targetItemId_fkey" FOREIGN KEY ("targetItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineeringChange" ADD CONSTRAINT "EngineeringChange_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineeringChange" ADD CONSTRAINT "EngineeringChange_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineeringChangeDetail" ADD CONSTRAINT "EngineeringChangeDetail_engineeringChangeId_fkey" FOREIGN KEY ("engineeringChangeId") REFERENCES "EngineeringChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
