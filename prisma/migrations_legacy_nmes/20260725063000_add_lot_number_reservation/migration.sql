-- CreateEnum
CREATE TYPE "LotReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateTable
CREATE TABLE "LotNumberReservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "status" "LotReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "reservedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "LotNumberReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LotNumberReservation_tenantId_purchaseOrderItemId_idx" ON "LotNumberReservation"("tenantId", "purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "LotNumberReservation_status_expiresAt_idx" ON "LotNumberReservation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LotNumberReservation_tenantId_lotNo_key" ON "LotNumberReservation"("tenantId", "lotNo");

-- AddForeignKey
ALTER TABLE "LotNumberReservation" ADD CONSTRAINT "LotNumberReservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotNumberReservation" ADD CONSTRAINT "LotNumberReservation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotNumberReservation" ADD CONSTRAINT "LotNumberReservation_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotNumberReservation" ADD CONSTRAINT "LotNumberReservation_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

