-- F13 outsource order linkage: connect outsourcing purchase order items to the exact production operation.
-- Nullable keeps ordinary material purchase orders and legacy outsourcing orders valid.
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "workOrderOperationId" TEXT;

ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_workOrderOperationId_fkey"
  FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PurchaseOrderItem_workOrderOperationId_idx" ON "PurchaseOrderItem"("workOrderOperationId");