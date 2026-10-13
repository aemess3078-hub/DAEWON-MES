-- AlterTable
-- ItemCategory에 itemType 필드 추가 (nullable: 기존 데이터 호환)
ALTER TABLE "ItemCategory" ADD COLUMN "itemType" "ItemType";

-- CreateTable
CREATE TABLE "ItemGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemGroup_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- Item에 itemGroupId nullable FK 추가
ALTER TABLE "Item" ADD COLUMN "itemGroupId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ItemGroup_tenantId_code_key" ON "ItemGroup"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ItemGroup_tenantId_idx" ON "ItemGroup"("tenantId");

-- CreateIndex
CREATE INDEX "ItemGroup_categoryId_idx" ON "ItemGroup"("categoryId");

-- CreateIndex
CREATE INDEX "Item_itemGroupId_idx" ON "Item"("itemGroupId");

-- AddForeignKey
ALTER TABLE "ItemGroup" ADD CONSTRAINT "ItemGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemGroup" ADD CONSTRAINT "ItemGroup_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ItemCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_itemGroupId_fkey" FOREIGN KEY ("itemGroupId") REFERENCES "ItemGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
