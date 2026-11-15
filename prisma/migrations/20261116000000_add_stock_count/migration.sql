-- 재고실사(창고 단위): 실사 건 + 실사 줄. 순수 추가(신규 enum/테이블/인덱스)만 있어 기존 데이터는 변경되지 않는다.
-- 롤백: DROP TABLE "StockCountLine"; DROP TABLE "StockCount"; DROP TYPE "StockCountStatus";

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "countNo" TEXT NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "startedById" TEXT,
    "startedByName" TEXT,
    "endedById" TEXT,
    "endedByName" TEXT,
    "note" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "stockCountId" TEXT NOT NULL,
    "balanceId" TEXT,
    "itemId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "lotId" TEXT,
    "lotNo" TEXT,
    "systemQty" DECIMAL(18,6) NOT NULL,
    "countedQty" DECIMAL(18,6),
    "countedAt" TIMESTAMP(3),
    "countedByName" TEXT,
    "adjustedAt" TIMESTAMP(3),
    "adjustedByName" TEXT,
    "adjustTxNo" TEXT,
    "adjustedToQty" DECIMAL(18,6),
    "adjustReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_tenantId_countNo_key" ON "StockCount"("tenantId", "countNo");
CREATE INDEX "StockCount_tenantId_startedAt_idx" ON "StockCount"("tenantId", "startedAt");
CREATE INDEX "StockCount_tenantId_warehouseId_status_idx" ON "StockCount"("tenantId", "warehouseId", "status");
CREATE INDEX "StockCountLine_stockCountId_idx" ON "StockCountLine"("stockCountId");
CREATE INDEX "StockCountLine_balanceId_idx" ON "StockCountLine"("balanceId");

-- 같은 창고에 진행 중인 실사는 1건만(동시 실사 방지)
CREATE UNIQUE INDEX "StockCount_one_in_progress_per_warehouse" ON "StockCount"("tenantId", "warehouseId") WHERE "status" = 'IN_PROGRESS';

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
