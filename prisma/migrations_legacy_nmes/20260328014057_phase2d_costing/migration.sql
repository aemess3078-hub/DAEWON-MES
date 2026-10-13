-- CreateTable
CREATE TABLE "ItemCost" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "costType" TEXT NOT NULL,
    "materialCost" DECIMAL(18,2) NOT NULL,
    "laborCost" DECIMAL(18,2) NOT NULL,
    "overheadCost" DECIMAL(18,2) NOT NULL,
    "totalCost" DECIMAL(18,2) NOT NULL,
    "bomId" TEXT,
    "workOrderId" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "ItemCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemCost_tenantId_itemId_costType_idx" ON "ItemCost"("tenantId", "itemId", "costType");

-- CreateIndex
CREATE INDEX "ItemCost_tenantId_calculatedAt_idx" ON "ItemCost"("tenantId", "calculatedAt");

-- CreateIndex
CREATE INDEX "ItemCost_bomId_idx" ON "ItemCost"("bomId");

-- CreateIndex
CREATE INDEX "ItemCost_workOrderId_idx" ON "ItemCost"("workOrderId");

-- AddForeignKey
ALTER TABLE "ItemCost" ADD CONSTRAINT "ItemCost_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCost" ADD CONSTRAINT "ItemCost_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCost" ADD CONSTRAINT "ItemCost_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BOM"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCost" ADD CONSTRAINT "ItemCost_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
