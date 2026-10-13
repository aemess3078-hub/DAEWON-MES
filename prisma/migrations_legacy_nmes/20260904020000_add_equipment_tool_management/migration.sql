-- AlterEnum
ALTER TYPE "EquipmentStatus" ADD VALUE 'DISCARDED';

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "currentUsage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lifeLimit" INTEGER;

-- CreateTable
CREATE TABLE "EquipmentAppliedItem" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "EquipmentAppliedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentUsageHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL,
    "usageCount" INTEGER NOT NULL,
    "itemId" TEXT,
    "workOrderOperationId" TEXT,
    "operatorId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentUsageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquipmentAppliedItem_equipmentId_idx" ON "EquipmentAppliedItem"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentAppliedItem_itemId_idx" ON "EquipmentAppliedItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentAppliedItem_equipmentId_itemId_key" ON "EquipmentAppliedItem"("equipmentId", "itemId");

-- CreateIndex
CREATE INDEX "EquipmentUsageHistory_tenantId_idx" ON "EquipmentUsageHistory"("tenantId");

-- CreateIndex
CREATE INDEX "EquipmentUsageHistory_equipmentId_idx" ON "EquipmentUsageHistory"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentUsageHistory_usedAt_idx" ON "EquipmentUsageHistory"("usedAt");

-- AddForeignKey
ALTER TABLE "EquipmentAppliedItem" ADD CONSTRAINT "EquipmentAppliedItem_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAppliedItem" ADD CONSTRAINT "EquipmentAppliedItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageHistory" ADD CONSTRAINT "EquipmentUsageHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageHistory" ADD CONSTRAINT "EquipmentUsageHistory_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageHistory" ADD CONSTRAINT "EquipmentUsageHistory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageHistory" ADD CONSTRAINT "EquipmentUsageHistory_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageHistory" ADD CONSTRAINT "EquipmentUsageHistory_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageHistory" ADD CONSTRAINT "EquipmentUsageHistory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
