-- CreateEnum
CREATE TYPE "SpcControlChartType" AS ENUM ('I_MR');

-- CreateTable
CREATE TABLE "SpcProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inspectionItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "controlChartType" "SpcControlChartType" NOT NULL DEFAULT 'I_MR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpcProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpcProfile_tenantId_idx" ON "SpcProfile"("tenantId");

-- CreateIndex
CREATE INDEX "SpcProfile_tenantId_isActive_idx" ON "SpcProfile"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "SpcProfile_inspectionItemId_idx" ON "SpcProfile"("inspectionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SpcProfile_tenantId_inspectionItemId_name_key" ON "SpcProfile"("tenantId", "inspectionItemId", "name");

-- AddForeignKey
ALTER TABLE "SpcProfile" ADD CONSTRAINT "SpcProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpcProfile" ADD CONSTRAINT "SpcProfile_inspectionItemId_fkey" FOREIGN KEY ("inspectionItemId") REFERENCES "InspectionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpcProfile" ADD CONSTRAINT "SpcProfile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpcProfile" ADD CONSTRAINT "SpcProfile_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
