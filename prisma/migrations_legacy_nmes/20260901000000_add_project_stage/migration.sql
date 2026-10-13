-- CreateEnum
CREATE TYPE "ProjectStageStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "ProjectStage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectOrderId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectStageStatus" NOT NULL DEFAULT 'PENDING',
    "plannedStartDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "sourceRoutingOperationId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectStage_tenantId_idx" ON "ProjectStage"("tenantId");

-- CreateIndex
CREATE INDEX "ProjectStage_projectOrderId_idx" ON "ProjectStage"("projectOrderId");

-- CreateIndex
CREATE INDEX "ProjectStage_sourceRoutingOperationId_idx" ON "ProjectStage"("sourceRoutingOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectStage_projectOrderId_seq_key" ON "ProjectStage"("projectOrderId", "seq");

-- AddForeignKey
ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_projectOrderId_fkey" FOREIGN KEY ("projectOrderId") REFERENCES "ProjectOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_sourceRoutingOperationId_fkey" FOREIGN KEY ("sourceRoutingOperationId") REFERENCES "RoutingOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
