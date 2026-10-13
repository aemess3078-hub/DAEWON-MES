-- 의료기기 추적성 Phase 1
--
-- 변경:
--   1. WorkOrder.manufacturingNo 컬럼 추가 (nullable) — 의료기기 제조번호
--      tenantId+manufacturingNo partial unique (NULL 값은 중복 허용)
--   2. WorkOrderMaterialLot 테이블 신규 — 작업지시-제조번호-원자재 LOT 연결
--      자재출고 시 어떤 작업지시의 어떤 제조번호에 어떤 원자재 LOT가 투입됐는지 기록

-- 1. WorkOrder.manufacturingNo
ALTER TABLE "WorkOrder" ADD COLUMN "manufacturingNo" TEXT;

CREATE UNIQUE INDEX "WorkOrder_tenantId_manufacturingNo_key"
  ON "WorkOrder"("tenantId", "manufacturingNo")
  WHERE "manufacturingNo" IS NOT NULL;

CREATE INDEX "WorkOrder_tenantId_manufacturingNo_idx"
  ON "WorkOrder"("tenantId", "manufacturingNo");

-- 2. WorkOrderMaterialLot
CREATE TABLE "WorkOrderMaterialLot" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "manufacturingNo" TEXT,
  "materialItemId" TEXT NOT NULL,
  "materialLotNo" TEXT NOT NULL,
  "qty" DECIMAL(18,6) NOT NULL,
  "unit" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedBy" TEXT,
  "inventoryTransactionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkOrderMaterialLot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkOrderMaterialLot_tenantId_idx" ON "WorkOrderMaterialLot"("tenantId");
CREATE INDEX "WorkOrderMaterialLot_workOrderId_idx" ON "WorkOrderMaterialLot"("workOrderId");
CREATE INDEX "WorkOrderMaterialLot_tenantId_manufacturingNo_idx"
  ON "WorkOrderMaterialLot"("tenantId", "manufacturingNo");
CREATE INDEX "WorkOrderMaterialLot_materialItemId_idx" ON "WorkOrderMaterialLot"("materialItemId");
CREATE INDEX "WorkOrderMaterialLot_tenantId_materialLotNo_idx"
  ON "WorkOrderMaterialLot"("tenantId", "materialLotNo");
CREATE INDEX "WorkOrderMaterialLot_inventoryTransactionId_idx"
  ON "WorkOrderMaterialLot"("inventoryTransactionId");

ALTER TABLE "WorkOrderMaterialLot"
  ADD CONSTRAINT "WorkOrderMaterialLot_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkOrderMaterialLot"
  ADD CONSTRAINT "WorkOrderMaterialLot_materialItemId_fkey"
  FOREIGN KEY ("materialItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkOrderMaterialLot"
  ADD CONSTRAINT "WorkOrderMaterialLot_inventoryTransactionId_fkey"
  FOREIGN KEY ("inventoryTransactionId") REFERENCES "InventoryTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
