-- F12 LOT lineage integrity: optional explicit LOT attribution for quality inspections.
-- Nullable keeps legacy WorkOrder/operation-level inspections valid.
-- The FK uses the default RESTRICT behavior so LOT rows with quality history are not cascade-deleted.
ALTER TABLE "QualityInspection" ADD COLUMN "lotId" TEXT;

ALTER TABLE "QualityInspection"
  ADD CONSTRAINT "QualityInspection_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "QualityInspection_lotId_idx" ON "QualityInspection"("lotId");
CREATE INDEX "QualityInspection_lotId_inspectedAt_idx" ON "QualityInspection"("lotId", "inspectedAt");