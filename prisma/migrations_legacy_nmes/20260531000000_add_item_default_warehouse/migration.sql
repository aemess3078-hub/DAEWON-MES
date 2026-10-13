-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "defaultWarehouseId" TEXT;

-- CreateIndex
CREATE INDEX "Item_defaultWarehouseId_idx" ON "Item"("defaultWarehouseId");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_defaultWarehouseId_fkey" FOREIGN KEY ("defaultWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
