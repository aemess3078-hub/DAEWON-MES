-- F18: link optional actual TOOL/JIG/FIXTURE usage to the POP ProductionResult that created it.
-- Existing manual usage history remains valid because productionResultId is nullable.

ALTER TABLE "EquipmentUsageHistory"
  ADD COLUMN "productionResultId" TEXT;

ALTER TABLE "EquipmentUsageHistory"
  ADD CONSTRAINT "EquipmentUsageHistory_productionResultId_fkey"
  FOREIGN KEY ("productionResultId") REFERENCES "ProductionResult"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "EquipmentUsageHistory_productionResultId_idx"
  ON "EquipmentUsageHistory"("productionResultId");

CREATE UNIQUE INDEX "EquipmentUsageHistory_productionResultId_equipmentId_key"
  ON "EquipmentUsageHistory"("productionResultId", "equipmentId");
