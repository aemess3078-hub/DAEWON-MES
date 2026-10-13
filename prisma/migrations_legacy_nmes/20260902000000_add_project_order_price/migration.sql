-- CreateEnum
CREATE TYPE "ProjectPriceStatus" AS ENUM ('DRAFT', 'DECIDED');

-- CreateTable
CREATE TABLE "ProjectOrderPrice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectOrderId" TEXT NOT NULL,
    "quotationId" TEXT,
    "salesOrderId" TEXT,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "quotationUnitPrice" DECIMAL(18,2),
    "orderUnitPrice" DECIMAL(18,2),
    "finalUnitPrice" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "status" "ProjectPriceStatus" NOT NULL DEFAULT 'DRAFT',
    "quotationDate" TIMESTAMP(3),
    "orderDate" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectOrderPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectOrderPriceRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectOrderPriceId" TEXT NOT NULL,
    "previousFinalUnitPrice" DECIMAL(18,2),
    "newFinalUnitPrice" DECIMAL(18,2) NOT NULL,
    "reason" TEXT,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectOrderPriceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOrderPrice_projectOrderId_key" ON "ProjectOrderPrice"("projectOrderId");

-- CreateIndex
CREATE INDEX "ProjectOrderPrice_tenantId_idx" ON "ProjectOrderPrice"("tenantId");

-- CreateIndex
CREATE INDEX "ProjectOrderPrice_tenantId_status_idx" ON "ProjectOrderPrice"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ProjectOrderPrice_tenantId_decidedAt_idx" ON "ProjectOrderPrice"("tenantId", "decidedAt");

-- CreateIndex
CREATE INDEX "ProjectOrderPrice_quotationId_idx" ON "ProjectOrderPrice"("quotationId");

-- CreateIndex
CREATE INDEX "ProjectOrderPrice_salesOrderId_idx" ON "ProjectOrderPrice"("salesOrderId");

-- CreateIndex
CREATE INDEX "ProjectOrderPrice_itemId_idx" ON "ProjectOrderPrice"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOrderPrice_tenantId_projectOrderId_key" ON "ProjectOrderPrice"("tenantId", "projectOrderId");

-- CreateIndex
CREATE INDEX "ProjectOrderPriceRevision_tenantId_idx" ON "ProjectOrderPriceRevision"("tenantId");

-- CreateIndex
CREATE INDEX "ProjectOrderPriceRevision_projectOrderPriceId_idx" ON "ProjectOrderPriceRevision"("projectOrderPriceId");

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_projectOrderId_fkey" FOREIGN KEY ("projectOrderId") REFERENCES "ProjectOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPriceRevision" ADD CONSTRAINT "ProjectOrderPriceRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPriceRevision" ADD CONSTRAINT "ProjectOrderPriceRevision_projectOrderPriceId_fkey" FOREIGN KEY ("projectOrderPriceId") REFERENCES "ProjectOrderPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPriceRevision" ADD CONSTRAINT "ProjectOrderPriceRevision_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
