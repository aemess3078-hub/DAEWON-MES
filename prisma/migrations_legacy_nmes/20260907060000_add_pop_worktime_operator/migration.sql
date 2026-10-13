ALTER TABLE "WorkOrderOperation"
ADD COLUMN "startedAt" TIMESTAMP(3);

ALTER TABLE "WorkOrderOperationAssignment"
ADD COLUMN "startedAt" TIMESTAMP(3);

ALTER TABLE "ProductionResult"
ADD COLUMN "operatorId" TEXT;

CREATE INDEX "ProductionResult_operatorId_idx" ON "ProductionResult"("operatorId");

ALTER TABLE "ProductionResult"
ADD CONSTRAINT "ProductionResult_operatorId_fkey"
FOREIGN KEY ("operatorId") REFERENCES "Profile"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
