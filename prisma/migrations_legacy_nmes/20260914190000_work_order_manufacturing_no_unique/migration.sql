-- F19: WorkOrder manufacturingNo must be unique per tenant when present.
-- PostgreSQL unique constraints allow multiple NULL values, preserving non-tracked/manual-empty cases.
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_tenantId_manufacturingNo_key" UNIQUE ("tenantId", "manufacturingNo");
