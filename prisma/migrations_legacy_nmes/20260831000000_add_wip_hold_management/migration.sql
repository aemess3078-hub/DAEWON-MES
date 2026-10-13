-- CreateEnum
CREATE TYPE "WipHoldStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WipHold" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT,
    "wipUnitId" TEXT NOT NULL,
    "previousStatus" "WipUnitStatus" NOT NULL,
    "status" "WipHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "heldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heldById" TEXT,
    "heldByName" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "releasedByName" TEXT,
    "releaseNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledByName" TEXT,
    "cancelNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WipHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WipHold_tenantId_wipUnitId_idx" ON "WipHold"("tenantId", "wipUnitId");

-- CreateIndex
CREATE INDEX "WipHold_tenantId_status_idx" ON "WipHold"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WipHold_wipUnitId_status_idx" ON "WipHold"("wipUnitId", "status");

-- CreateIndex
CREATE INDEX "WipHold_tenantId_heldAt_idx" ON "WipHold"("tenantId", "heldAt");

-- AddForeignKey
ALTER TABLE "WipHold" ADD CONSTRAINT "WipHold_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipHold" ADD CONSTRAINT "WipHold_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipHold" ADD CONSTRAINT "WipHold_wipUnitId_fkey" FOREIGN KEY ("wipUnitId") REFERENCES "WipUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
