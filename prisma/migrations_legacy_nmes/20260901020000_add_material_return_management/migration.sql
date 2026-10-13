-- CreateEnum
CREATE TYPE "MaterialReturnStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'SUPPLIER_RETURN';

-- CreateTable
CREATE TABLE "MaterialReturn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "returnNo" TEXT NOT NULL,
    "status" "MaterialReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialReturnItem" (
    "id" TEXT NOT NULL,
    "materialReturnId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT,
    "lotId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "returnQty" DECIMAL(18,6) NOT NULL,
    "note" TEXT,
    "inventoryTransactionId" TEXT,

    CONSTRAINT "MaterialReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialReturn_tenantId_idx" ON "MaterialReturn"("tenantId");

-- CreateIndex
CREATE INDEX "MaterialReturn_tenantId_status_idx" ON "MaterialReturn"("tenantId", "status");

-- CreateIndex
CREATE INDEX "MaterialReturn_siteId_idx" ON "MaterialReturn"("siteId");

-- CreateIndex
CREATE INDEX "MaterialReturn_supplierId_idx" ON "MaterialReturn"("supplierId");

-- CreateIndex
CREATE INDEX "MaterialReturn_purchaseOrderId_idx" ON "MaterialReturn"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialReturn_tenantId_returnNo_key" ON "MaterialReturn"("tenantId", "returnNo");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialReturnItem_inventoryTransactionId_key" ON "MaterialReturnItem"("inventoryTransactionId");

-- CreateIndex
CREATE INDEX "MaterialReturnItem_materialReturnId_idx" ON "MaterialReturnItem"("materialReturnId");

-- CreateIndex
CREATE INDEX "MaterialReturnItem_itemId_idx" ON "MaterialReturnItem"("itemId");

-- CreateIndex
CREATE INDEX "MaterialReturnItem_purchaseOrderItemId_idx" ON "MaterialReturnItem"("purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "MaterialReturnItem_lotId_idx" ON "MaterialReturnItem"("lotId");

-- CreateIndex
CREATE INDEX "MaterialReturnItem_warehouseId_idx" ON "MaterialReturnItem"("warehouseId");

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturnItem" ADD CONSTRAINT "MaterialReturnItem_materialReturnId_fkey" FOREIGN KEY ("materialReturnId") REFERENCES "MaterialReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturnItem" ADD CONSTRAINT "MaterialReturnItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturnItem" ADD CONSTRAINT "MaterialReturnItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturnItem" ADD CONSTRAINT "MaterialReturnItem_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturnItem" ADD CONSTRAINT "MaterialReturnItem_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturnItem" ADD CONSTRAINT "MaterialReturnItem_inventoryTransactionId_fkey" FOREIGN KEY ("inventoryTransactionId") REFERENCES "InventoryTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
