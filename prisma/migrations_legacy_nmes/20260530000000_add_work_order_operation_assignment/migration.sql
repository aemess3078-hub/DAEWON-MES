-- AlterTable
ALTER TABLE "ProductionResult" ADD COLUMN     "workOrderOperationAssignmentId" TEXT;

-- CreateTable
CREATE TABLE "WorkOrderOperationAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderOperationId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "assignedQty" DECIMAL(18,6) NOT NULL,
    "completedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "status" "OperationStatus" NOT NULL DEFAULT 'PENDING',
    "seq" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderOperationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrderOperationAssignment_tenantId_idx" ON "WorkOrderOperationAssignment"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrderOperationAssignment_workOrderOperationId_idx" ON "WorkOrderOperationAssignment"("workOrderOperationId");

-- CreateIndex
CREATE INDEX "WorkOrderOperationAssignment_equipmentId_idx" ON "WorkOrderOperationAssignment"("equipmentId");

-- CreateIndex
CREATE INDEX "WorkOrderOperationAssignment_status_idx" ON "WorkOrderOperationAssignment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderOperationAssignment_workOrderOperationId_equipment_key" ON "WorkOrderOperationAssignment"("workOrderOperationId", "equipmentId");

-- CreateIndex
CREATE INDEX "ProductionResult_workOrderOperationAssignmentId_idx" ON "ProductionResult"("workOrderOperationAssignmentId");

-- AddForeignKey
ALTER TABLE "WorkOrderOperationAssignment" ADD CONSTRAINT "WorkOrderOperationAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperationAssignment" ADD CONSTRAINT "WorkOrderOperationAssignment_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperationAssignment" ADD CONSTRAINT "WorkOrderOperationAssignment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionResult" ADD CONSTRAINT "ProductionResult_workOrderOperationAssignmentId_fkey" FOREIGN KEY ("workOrderOperationAssignmentId") REFERENCES "WorkOrderOperationAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
