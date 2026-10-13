-- F21: SOP mapping from Item + RoutingOperation to Document.
-- This migration only creates the explicit FK-backed mapping table.

CREATE TABLE "WorkStandardMapping" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "routingOperationId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkStandardMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkStandardMapping_tenantId_documentId_itemId_routingOperationId_key"
ON "WorkStandardMapping"("tenantId", "documentId", "itemId", "routingOperationId");

CREATE INDEX "WorkStandardMapping_tenantId_itemId_routingOperationId_isActive_idx"
ON "WorkStandardMapping"("tenantId", "itemId", "routingOperationId", "isActive");

CREATE INDEX "WorkStandardMapping_documentId_idx"
ON "WorkStandardMapping"("documentId");

CREATE INDEX "WorkStandardMapping_routingOperationId_idx"
ON "WorkStandardMapping"("routingOperationId");

ALTER TABLE "WorkStandardMapping"
ADD CONSTRAINT "WorkStandardMapping_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkStandardMapping"
ADD CONSTRAINT "WorkStandardMapping_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkStandardMapping"
ADD CONSTRAINT "WorkStandardMapping_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkStandardMapping"
ADD CONSTRAINT "WorkStandardMapping_routingOperationId_fkey"
FOREIGN KEY ("routingOperationId") REFERENCES "RoutingOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
