-- CreateEnum
CREATE TYPE "WipMovementType" AS ENUM ('CREATED', 'STARTED', 'MOVED', 'HOLD', 'RELEASED', 'SPLIT', 'MERGE', 'DEFECT', 'REWORK', 'SCRAP', 'OUTSOURCED', 'RETURNED', 'COMPLETED', 'ADJUSTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WipUnitStatus" ADD VALUE 'WAITING';
ALTER TYPE "WipUnitStatus" ADD VALUE 'OUTSOURCED';
ALTER TYPE "WipUnitStatus" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "WipUnitStatus" ADD VALUE 'RECEIVED';
ALTER TYPE "WipUnitStatus" ADD VALUE 'REWORK';

-- AlterTable
ALTER TABLE "WipUnit" ADD COLUMN     "currentWarehouseId" TEXT,
ADD COLUMN     "currentWorkCenterId" TEXT,
ADD COLUMN     "manufacturingNo" TEXT,
ADD COLUMN     "outsourcingPartnerId" TEXT,
ADD COLUMN     "parentWipUnitId" TEXT,
ADD COLUMN     "siteId" TEXT,
ADD COLUMN     "sourceProductionResultId" TEXT,
ADD COLUMN     "tenantId" TEXT,
ADD COLUMN     "workOrderId" TEXT;

-- Backfill traceability anchors for existing WIP rows before enforcing tenantId.
UPDATE "WipUnit" AS wu
SET
    "tenantId" = wo."tenantId",
    "siteId" = COALESCE(wu."siteId", wo."siteId"),
    "workOrderId" = COALESCE(wu."workOrderId", wo."id"),
    "manufacturingNo" = COALESCE(wu."manufacturingNo", wo."manufacturingNo"),
    "currentWorkCenterId" = COALESCE(wu."currentWorkCenterId", ro."workCenterId")
FROM "WorkOrderOperation" AS woo
JOIN "WorkOrder" AS wo ON wo."id" = woo."workOrderId"
JOIN "RoutingOperation" AS ro ON ro."id" = woo."routingOperationId"
WHERE wu."workOrderOperationId" = woo."id"
  AND wu."tenantId" IS NULL;

ALTER TABLE "WipUnit" ALTER COLUMN "tenantId" SET NOT NULL;

-- CreateTable
CREATE TABLE "WipMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT,
    "wipUnitId" TEXT NOT NULL,
    "movementType" "WipMovementType" NOT NULL,
    "fromOperationId" TEXT,
    "toOperationId" TEXT,
    "fromWorkCenterId" TEXT,
    "toWorkCenterId" TEXT,
    "fromWarehouseId" TEXT,
    "toWarehouseId" TEXT,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "fromPartnerId" TEXT,
    "toPartnerId" TEXT,
    "relatedWipUnitId" TEXT,
    "qty" DECIMAL(18,6) NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WipMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WipUnitMaterialLot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "wipUnitId" TEXT NOT NULL,
    "workOrderMaterialLotId" TEXT,
    "materialItemId" TEXT NOT NULL,
    "materialLotId" TEXT,
    "materialLotNo" TEXT,
    "qty" DECIMAL(18,6) NOT NULL,
    "unit" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WipUnitMaterialLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WipMovement_tenantId_wipUnitId_idx" ON "WipMovement"("tenantId", "wipUnitId");

-- CreateIndex
CREATE INDEX "WipMovement_tenantId_movementType_idx" ON "WipMovement"("tenantId", "movementType");

-- CreateIndex
CREATE INDEX "WipMovement_tenantId_createdAt_idx" ON "WipMovement"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "WipMovement_tenantId_sourceType_sourceId_idx" ON "WipMovement"("tenantId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "WipMovement_tenantId_fromOperationId_idx" ON "WipMovement"("tenantId", "fromOperationId");

-- CreateIndex
CREATE INDEX "WipMovement_tenantId_toOperationId_idx" ON "WipMovement"("tenantId", "toOperationId");

-- CreateIndex
CREATE INDEX "WipMovement_tenantId_relatedWipUnitId_idx" ON "WipMovement"("tenantId", "relatedWipUnitId");

-- CreateIndex
CREATE INDEX "WipUnitMaterialLot_tenantId_wipUnitId_idx" ON "WipUnitMaterialLot"("tenantId", "wipUnitId");

-- CreateIndex
CREATE INDEX "WipUnitMaterialLot_tenantId_workOrderMaterialLotId_idx" ON "WipUnitMaterialLot"("tenantId", "workOrderMaterialLotId");

-- CreateIndex
CREATE INDEX "WipUnitMaterialLot_tenantId_materialItemId_idx" ON "WipUnitMaterialLot"("tenantId", "materialItemId");

-- CreateIndex
CREATE INDEX "WipUnitMaterialLot_tenantId_materialLotId_idx" ON "WipUnitMaterialLot"("tenantId", "materialLotId");

-- CreateIndex
CREATE INDEX "WipUnitMaterialLot_tenantId_materialLotNo_idx" ON "WipUnitMaterialLot"("tenantId", "materialLotNo");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_workOrderId_idx" ON "WipUnit"("tenantId", "workOrderId");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_manufacturingNo_idx" ON "WipUnit"("tenantId", "manufacturingNo");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_workOrderOperationId_idx" ON "WipUnit"("tenantId", "workOrderOperationId");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_status_idx" ON "WipUnit"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_currentLocationId_idx" ON "WipUnit"("tenantId", "currentLocationId");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_currentWorkCenterId_idx" ON "WipUnit"("tenantId", "currentWorkCenterId");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_currentWarehouseId_idx" ON "WipUnit"("tenantId", "currentWarehouseId");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_outsourcingPartnerId_idx" ON "WipUnit"("tenantId", "outsourcingPartnerId");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_lotId_idx" ON "WipUnit"("tenantId", "lotId");

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_currentWorkCenterId_fkey" FOREIGN KEY ("currentWorkCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_currentWarehouseId_fkey" FOREIGN KEY ("currentWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_outsourcingPartnerId_fkey" FOREIGN KEY ("outsourcingPartnerId") REFERENCES "BusinessPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_sourceProductionResultId_fkey" FOREIGN KEY ("sourceProductionResultId") REFERENCES "ProductionResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_parentWipUnitId_fkey" FOREIGN KEY ("parentWipUnitId") REFERENCES "WipUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_wipUnitId_fkey" FOREIGN KEY ("wipUnitId") REFERENCES "WipUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_fromOperationId_fkey" FOREIGN KEY ("fromOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_toOperationId_fkey" FOREIGN KEY ("toOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_fromWorkCenterId_fkey" FOREIGN KEY ("fromWorkCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_toWorkCenterId_fkey" FOREIGN KEY ("toWorkCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_fromPartnerId_fkey" FOREIGN KEY ("fromPartnerId") REFERENCES "BusinessPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_toPartnerId_fkey" FOREIGN KEY ("toPartnerId") REFERENCES "BusinessPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_relatedWipUnitId_fkey" FOREIGN KEY ("relatedWipUnitId") REFERENCES "WipUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnitMaterialLot" ADD CONSTRAINT "WipUnitMaterialLot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnitMaterialLot" ADD CONSTRAINT "WipUnitMaterialLot_wipUnitId_fkey" FOREIGN KEY ("wipUnitId") REFERENCES "WipUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnitMaterialLot" ADD CONSTRAINT "WipUnitMaterialLot_workOrderMaterialLotId_fkey" FOREIGN KEY ("workOrderMaterialLotId") REFERENCES "WorkOrderMaterialLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnitMaterialLot" ADD CONSTRAINT "WipUnitMaterialLot_materialItemId_fkey" FOREIGN KEY ("materialItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnitMaterialLot" ADD CONSTRAINT "WipUnitMaterialLot_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
