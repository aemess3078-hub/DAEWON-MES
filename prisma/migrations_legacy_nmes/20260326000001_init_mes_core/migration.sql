-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "SiteType" AS ENUM ('FACTORY', 'WAREHOUSE', 'OFFICE');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('RAW_MATERIAL', 'SEMI_FINISHED', 'FINISHED', 'CONSUMABLE');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "UOM" AS ENUM ('EA', 'KG', 'G', 'L', 'ML', 'M', 'CM', 'MM', 'BOX', 'SET');

-- CreateEnum
CREATE TYPE "BOMStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RoutingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WorkCenterKind" AS ENUM ('ASSEMBLY', 'MACHINING', 'INSPECTION', 'PACKAGING', 'STORAGE');

-- CreateEnum
CREATE TYPE "EquipmentType" AS ENUM ('MACHINE', 'TOOL', 'JIG', 'FIXTURE', 'VEHICLE');

-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'PARTIAL', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('ACTIVE', 'QUARANTINE', 'ON_HOLD', 'CONSUMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUST', 'RETURN', 'SCRAP');

-- CreateEnum
CREATE TYPE "WipUnitStatus" AS ENUM ('IN_PROCESS', 'ON_HOLD', 'COMPLETED', 'SCRAPPED');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PASS', 'FAIL', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "DefectSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR');

-- CreateEnum
CREATE TYPE "DefectDisposition" AS ENUM ('SCRAP', 'REWORK', 'ACCEPT', 'USE_AS_IS');

-- CreateEnum
CREATE TYPE "DefectCategory" AS ENUM ('DIMENSIONAL', 'VISUAL', 'FUNCTIONAL', 'MATERIAL');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('SOP', 'DRAWING', 'SPEC', 'CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "InspectionInputType" AS ENUM ('NUMERIC', 'TEXT', 'BOOLEAN', 'SELECT');

-- CreateEnum
CREATE TYPE "LotGenealogyRelation" AS ENUM ('INPUT', 'OUTPUT', 'REWORK');

-- CreateEnum
CREATE TYPE "InspectionSpecStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'BATCH', 'API');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SiteType" NOT NULL DEFAULT 'FACTORY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantUser" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "siteId" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkCenter" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WorkCenterKind" NOT NULL DEFAULT 'ASSEMBLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessPartner" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partnerType" "PartnerType" NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "BusinessPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ItemCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "uom" "UOM" NOT NULL DEFAULT 'EA',
    "spec" TEXT,
    "isLotTracked" BOOLEAN NOT NULL DEFAULT false,
    "isSerialTracked" BOOLEAN NOT NULL DEFAULT false,
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemSubstitute" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "substituteItemId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ItemSubstitute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BOM" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "BOMStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BOM_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BOMItem" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "componentItemId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "qtyPer" DECIMAL(18,6) NOT NULL,
    "scrapRate" DECIMAL(5,4) NOT NULL DEFAULT 0,

    CONSTRAINT "BOMItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Routing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "RoutingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Routing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingOperation" (
    "id" TEXT NOT NULL,
    "routingId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "operationCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "standardTime" DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT "RoutingOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "equipmentType" "EquipmentType" NOT NULL,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentOperationMap" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "routingOperationId" TEXT NOT NULL,

    CONSTRAINT "EquipmentOperationMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationType" TEXT,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "prefix" TEXT,
    "dateFormat" TEXT,
    "seqLength" INTEGER NOT NULL DEFAULT 4,

    CONSTRAINT "LotRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionSpec" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "routingOperationId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "InspectionSpecStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionItem" (
    "id" TEXT NOT NULL,
    "inspectionSpecId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "inputType" "InspectionInputType" NOT NULL DEFAULT 'NUMERIC',
    "lowerLimit" DECIMAL(18,6),
    "upperLimit" DECIMAL(18,6),

    CONSTRAINT "InspectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefectCode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defectCategory" "DefectCategory" NOT NULL,

    CONSTRAINT "DefectCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "docType" "DocType" NOT NULL,
    "fileUrl" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLink" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,

    CONSTRAINT "DocumentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "routingId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "plannedQty" DECIMAL(18,6) NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderOperation" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "routingOperationId" TEXT NOT NULL,
    "equipmentId" TEXT,
    "seq" INTEGER NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'PENDING',
    "plannedQty" DECIMAL(18,6) NOT NULL,
    "completedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,

    CONSTRAINT "WorkOrderOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialReservation" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "requiredQty" DECIMAL(18,6) NOT NULL,
    "reservedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "issuedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "MaterialReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "status" "LotStatus" NOT NULL DEFAULT 'ACTIVE',
    "manufactureDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "locationId" TEXT NOT NULL,
    "qtyOnHand" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "qtyAvailable" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "qtyHold" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "txNo" TEXT NOT NULL,
    "txType" "TransactionType" NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "txAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialConsumption" (
    "id" TEXT NOT NULL,
    "workOrderOperationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "consumedQty" DECIMAL(18,6) NOT NULL,
    "scrapQty" DECIMAL(18,6) NOT NULL DEFAULT 0,

    CONSTRAINT "MaterialConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WipUnit" (
    "id" TEXT NOT NULL,
    "workOrderOperationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "currentLocationId" TEXT,
    "qty" DECIMAL(18,6) NOT NULL,
    "status" "WipUnitStatus" NOT NULL DEFAULT 'IN_PROCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WipUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionResult" (
    "id" TEXT NOT NULL,
    "workOrderOperationId" TEXT NOT NULL,
    "goodQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "defectQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "reworkQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ProductionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinishedGoodsReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "receiptQty" DECIMAL(18,6) NOT NULL,
    "receiptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinishedGoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityInspection" (
    "id" TEXT NOT NULL,
    "workOrderOperationId" TEXT NOT NULL,
    "inspectionSpecId" TEXT NOT NULL,
    "inspectorId" TEXT NOT NULL,
    "result" "InspectionResult",
    "inspectedQty" DECIMAL(18,6) NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefectRecord" (
    "id" TEXT NOT NULL,
    "qualityInspectionId" TEXT NOT NULL,
    "defectCodeId" TEXT NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "severity" "DefectSeverity" NOT NULL DEFAULT 'MAJOR',
    "disposition" "DefectDisposition",

    CONSTRAINT "DefectRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotGenealogy" (
    "id" TEXT NOT NULL,
    "parentLotId" TEXT NOT NULL,
    "childLotId" TEXT NOT NULL,
    "relationType" "LotGenealogyRelation" NOT NULL DEFAULT 'OUTPUT',
    "qty" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "LotGenealogy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" "AuditActorType" NOT NULL DEFAULT 'USER',
    "actorLabel" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "actedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "approverId" TEXT,
    "requestType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_code_key" ON "Tenant"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_email_key" ON "Profile"("email");

-- CreateIndex
CREATE INDEX "Site_tenantId_idx" ON "Site"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_tenantId_code_key" ON "Site"("tenantId", "code");

-- CreateIndex
CREATE INDEX "TenantUser_tenantId_idx" ON "TenantUser"("tenantId");

-- CreateIndex
CREATE INDEX "TenantUser_profileId_idx" ON "TenantUser"("profileId");

-- CreateIndex
CREATE INDEX "TenantUser_siteId_idx" ON "TenantUser"("siteId");

-- CreateIndex
CREATE INDEX "TenantUser_tenantId_profileId_idx" ON "TenantUser"("tenantId", "profileId");

-- CreateIndex
CREATE INDEX "TenantUser_tenantId_siteId_role_idx" ON "TenantUser"("tenantId", "siteId", "role");

-- CreateIndex
CREATE INDEX "WorkCenter_siteId_idx" ON "WorkCenter"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCenter_siteId_code_key" ON "WorkCenter"("siteId", "code");

-- CreateIndex
CREATE INDEX "BusinessPartner_tenantId_idx" ON "BusinessPartner"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPartner_tenantId_code_key" ON "BusinessPartner"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ItemCategory_tenantId_idx" ON "ItemCategory"("tenantId");

-- CreateIndex
CREATE INDEX "ItemCategory_parentId_idx" ON "ItemCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCategory_tenantId_code_key" ON "ItemCategory"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Item_tenantId_idx" ON "Item"("tenantId");

-- CreateIndex
CREATE INDEX "Item_categoryId_idx" ON "Item"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_tenantId_code_key" ON "Item"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ItemSubstitute_itemId_idx" ON "ItemSubstitute"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemSubstitute_itemId_substituteItemId_key" ON "ItemSubstitute"("itemId", "substituteItemId");

-- CreateIndex
CREATE INDEX "BOM_tenantId_idx" ON "BOM"("tenantId");

-- CreateIndex
CREATE INDEX "BOM_itemId_idx" ON "BOM"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "BOM_tenantId_itemId_version_key" ON "BOM"("tenantId", "itemId", "version");

-- CreateIndex
CREATE INDEX "BOMItem_bomId_idx" ON "BOMItem"("bomId");

-- CreateIndex
CREATE INDEX "BOMItem_componentItemId_idx" ON "BOMItem"("componentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "BOMItem_bomId_seq_key" ON "BOMItem"("bomId", "seq");

-- CreateIndex
CREATE INDEX "Routing_tenantId_idx" ON "Routing"("tenantId");

-- CreateIndex
CREATE INDEX "Routing_itemId_idx" ON "Routing"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Routing_tenantId_itemId_version_key" ON "Routing"("tenantId", "itemId", "version");

-- CreateIndex
CREATE INDEX "RoutingOperation_routingId_idx" ON "RoutingOperation"("routingId");

-- CreateIndex
CREATE INDEX "RoutingOperation_workCenterId_idx" ON "RoutingOperation"("workCenterId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutingOperation_routingId_seq_key" ON "RoutingOperation"("routingId", "seq");

-- CreateIndex
CREATE INDEX "Equipment_tenantId_idx" ON "Equipment"("tenantId");

-- CreateIndex
CREATE INDEX "Equipment_siteId_idx" ON "Equipment"("siteId");

-- CreateIndex
CREATE INDEX "Equipment_workCenterId_idx" ON "Equipment"("workCenterId");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_siteId_code_key" ON "Equipment"("siteId", "code");

-- CreateIndex
CREATE INDEX "EquipmentOperationMap_equipmentId_idx" ON "EquipmentOperationMap"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentOperationMap_routingOperationId_idx" ON "EquipmentOperationMap"("routingOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentOperationMap_equipmentId_routingOperationId_key" ON "EquipmentOperationMap"("equipmentId", "routingOperationId");

-- CreateIndex
CREATE INDEX "Warehouse_tenantId_idx" ON "Warehouse"("tenantId");

-- CreateIndex
CREATE INDEX "Warehouse_siteId_idx" ON "Warehouse"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_siteId_code_key" ON "Warehouse"("siteId", "code");

-- CreateIndex
CREATE INDEX "Location_warehouseId_idx" ON "Location"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_warehouseId_code_key" ON "Location"("warehouseId", "code");

-- CreateIndex
CREATE INDEX "LotRule_tenantId_idx" ON "LotRule"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LotRule_tenantId_itemId_key" ON "LotRule"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "InspectionSpec_tenantId_idx" ON "InspectionSpec"("tenantId");

-- CreateIndex
CREATE INDEX "InspectionSpec_itemId_idx" ON "InspectionSpec"("itemId");

-- CreateIndex
CREATE INDEX "InspectionSpec_routingOperationId_idx" ON "InspectionSpec"("routingOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionSpec_tenantId_itemId_routingOperationId_version_key" ON "InspectionSpec"("tenantId", "itemId", "routingOperationId", "version");

-- CreateIndex
CREATE INDEX "InspectionItem_inspectionSpecId_idx" ON "InspectionItem"("inspectionSpecId");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionItem_inspectionSpecId_seq_key" ON "InspectionItem"("inspectionSpecId", "seq");

-- CreateIndex
CREATE INDEX "DefectCode_tenantId_idx" ON "DefectCode"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DefectCode_tenantId_code_key" ON "DefectCode"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Document_tenantId_idx" ON "Document"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_tenantId_code_key" ON "Document"("tenantId", "code");

-- CreateIndex
CREATE INDEX "DocumentLink_documentId_idx" ON "DocumentLink"("documentId");

-- CreateIndex
CREATE INDEX "DocumentLink_targetType_targetId_idx" ON "DocumentLink"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLink_documentId_targetType_targetId_key" ON "DocumentLink"("documentId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_idx" ON "WorkOrder"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrder_siteId_idx" ON "WorkOrder"("siteId");

-- CreateIndex
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_siteId_status_idx" ON "WorkOrder"("tenantId", "siteId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_dueDate_idx" ON "WorkOrder"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_itemId_idx" ON "WorkOrder"("tenantId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_tenantId_orderNo_key" ON "WorkOrder"("tenantId", "orderNo");

-- CreateIndex
CREATE INDEX "WorkOrderOperation_workOrderId_idx" ON "WorkOrderOperation"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderOperation_routingOperationId_idx" ON "WorkOrderOperation"("routingOperationId");

-- CreateIndex
CREATE INDEX "WorkOrderOperation_equipmentId_idx" ON "WorkOrderOperation"("equipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderOperation_workOrderId_seq_key" ON "WorkOrderOperation"("workOrderId", "seq");

-- CreateIndex
CREATE INDEX "MaterialReservation_workOrderId_idx" ON "MaterialReservation"("workOrderId");

-- CreateIndex
CREATE INDEX "MaterialReservation_itemId_idx" ON "MaterialReservation"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialReservation_workOrderId_itemId_key" ON "MaterialReservation"("workOrderId", "itemId");

-- CreateIndex
CREATE INDEX "Lot_tenantId_idx" ON "Lot"("tenantId");

-- CreateIndex
CREATE INDEX "Lot_itemId_idx" ON "Lot"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_tenantId_lotNo_key" ON "Lot"("tenantId", "lotNo");

-- CreateIndex
CREATE INDEX "InventoryBalance_tenantId_idx" ON "InventoryBalance"("tenantId");

-- CreateIndex
CREATE INDEX "InventoryBalance_siteId_idx" ON "InventoryBalance"("siteId");

-- CreateIndex
CREATE INDEX "InventoryBalance_itemId_idx" ON "InventoryBalance"("itemId");

-- CreateIndex
CREATE INDEX "InventoryBalance_locationId_idx" ON "InventoryBalance"("locationId");

-- CreateIndex
CREATE INDEX "InventoryBalance_tenantId_siteId_itemId_idx" ON "InventoryBalance"("tenantId", "siteId", "itemId");

-- CreateIndex
CREATE INDEX "InventoryBalance_tenantId_locationId_idx" ON "InventoryBalance"("tenantId", "locationId");

-- CreateIndex
CREATE INDEX "InventoryBalance_tenantId_itemId_lotId_locationId_idx" ON "InventoryBalance"("tenantId", "itemId", "lotId", "locationId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_tenantId_idx" ON "InventoryTransaction"("tenantId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_itemId_idx" ON "InventoryTransaction"("itemId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_lotId_idx" ON "InventoryTransaction"("lotId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_txType_idx" ON "InventoryTransaction"("txType");

-- CreateIndex
CREATE INDEX "InventoryTransaction_txAt_idx" ON "InventoryTransaction"("txAt");

-- CreateIndex
CREATE INDEX "InventoryTransaction_tenantId_txAt_idx" ON "InventoryTransaction"("tenantId", "txAt");

-- CreateIndex
CREATE INDEX "InventoryTransaction_tenantId_itemId_txAt_idx" ON "InventoryTransaction"("tenantId", "itemId", "txAt");

-- CreateIndex
CREATE INDEX "InventoryTransaction_tenantId_refType_refId_idx" ON "InventoryTransaction"("tenantId", "refType", "refId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_fromLocationId_idx" ON "InventoryTransaction"("fromLocationId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_toLocationId_idx" ON "InventoryTransaction"("toLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_tenantId_txNo_key" ON "InventoryTransaction"("tenantId", "txNo");

-- CreateIndex
CREATE INDEX "MaterialConsumption_workOrderOperationId_idx" ON "MaterialConsumption"("workOrderOperationId");

-- CreateIndex
CREATE INDEX "MaterialConsumption_itemId_idx" ON "MaterialConsumption"("itemId");

-- CreateIndex
CREATE INDEX "MaterialConsumption_lotId_idx" ON "MaterialConsumption"("lotId");

-- CreateIndex
CREATE INDEX "WipUnit_workOrderOperationId_idx" ON "WipUnit"("workOrderOperationId");

-- CreateIndex
CREATE INDEX "WipUnit_itemId_idx" ON "WipUnit"("itemId");

-- CreateIndex
CREATE INDEX "WipUnit_lotId_idx" ON "WipUnit"("lotId");

-- CreateIndex
CREATE INDEX "WipUnit_currentLocationId_idx" ON "WipUnit"("currentLocationId");

-- CreateIndex
CREATE INDEX "WipUnit_status_idx" ON "WipUnit"("status");

-- CreateIndex
CREATE INDEX "WipUnit_currentLocationId_status_idx" ON "WipUnit"("currentLocationId", "status");

-- CreateIndex
CREATE INDEX "ProductionResult_workOrderOperationId_idx" ON "ProductionResult"("workOrderOperationId");

-- CreateIndex
CREATE INDEX "FinishedGoodsReceipt_tenantId_idx" ON "FinishedGoodsReceipt"("tenantId");

-- CreateIndex
CREATE INDEX "FinishedGoodsReceipt_siteId_idx" ON "FinishedGoodsReceipt"("siteId");

-- CreateIndex
CREATE INDEX "FinishedGoodsReceipt_workOrderId_idx" ON "FinishedGoodsReceipt"("workOrderId");

-- CreateIndex
CREATE INDEX "FinishedGoodsReceipt_itemId_idx" ON "FinishedGoodsReceipt"("itemId");

-- CreateIndex
CREATE INDEX "FinishedGoodsReceipt_lotId_idx" ON "FinishedGoodsReceipt"("lotId");

-- CreateIndex
CREATE INDEX "FinishedGoodsReceipt_tenantId_siteId_receiptAt_idx" ON "FinishedGoodsReceipt"("tenantId", "siteId", "receiptAt");

-- CreateIndex
CREATE INDEX "FinishedGoodsReceipt_warehouseId_locationId_idx" ON "FinishedGoodsReceipt"("warehouseId", "locationId");

-- CreateIndex
CREATE INDEX "QualityInspection_workOrderOperationId_idx" ON "QualityInspection"("workOrderOperationId");

-- CreateIndex
CREATE INDEX "QualityInspection_inspectionSpecId_idx" ON "QualityInspection"("inspectionSpecId");

-- CreateIndex
CREATE INDEX "QualityInspection_inspectorId_idx" ON "QualityInspection"("inspectorId");

-- CreateIndex
CREATE INDEX "QualityInspection_workOrderOperationId_inspectedAt_idx" ON "QualityInspection"("workOrderOperationId", "inspectedAt");

-- CreateIndex
CREATE INDEX "QualityInspection_inspectorId_inspectedAt_idx" ON "QualityInspection"("inspectorId", "inspectedAt");

-- CreateIndex
CREATE INDEX "DefectRecord_qualityInspectionId_idx" ON "DefectRecord"("qualityInspectionId");

-- CreateIndex
CREATE INDEX "DefectRecord_defectCodeId_idx" ON "DefectRecord"("defectCodeId");

-- CreateIndex
CREATE INDEX "LotGenealogy_parentLotId_idx" ON "LotGenealogy"("parentLotId");

-- CreateIndex
CREATE INDEX "LotGenealogy_childLotId_idx" ON "LotGenealogy"("childLotId");

-- CreateIndex
CREATE UNIQUE INDEX "LotGenealogy_parentLotId_childLotId_relationType_key" ON "LotGenealogy"("parentLotId", "childLotId", "relationType");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actedAt_idx" ON "AuditLog"("actedAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entityType_entityId_actedAt_idx" ON "AuditLog"("tenantId", "entityType", "entityId", "actedAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_tenantId_idx" ON "ApprovalRequest"("tenantId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requesterId_idx" ON "ApprovalRequest"("requesterId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_approverId_idx" ON "ApprovalRequest"("approverId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_idx" ON "ApprovalRequest"("status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_requestedAt_idx" ON "ApprovalRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_tenantId_targetType_targetId_idx" ON "ApprovalRequest"("tenantId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCenter" ADD CONSTRAINT "WorkCenter_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessPartner" ADD CONSTRAINT "BusinessPartner_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCategory" ADD CONSTRAINT "ItemCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCategory" ADD CONSTRAINT "ItemCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ItemCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ItemCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSubstitute" ADD CONSTRAINT "ItemSubstitute_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSubstitute" ADD CONSTRAINT "ItemSubstitute_substituteItemId_fkey" FOREIGN KEY ("substituteItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOM" ADD CONSTRAINT "BOM_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOM" ADD CONSTRAINT "BOM_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOMItem" ADD CONSTRAINT "BOMItem_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BOM"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOMItem" ADD CONSTRAINT "BOMItem_componentItemId_fkey" FOREIGN KEY ("componentItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Routing" ADD CONSTRAINT "Routing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Routing" ADD CONSTRAINT "Routing_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingOperation" ADD CONSTRAINT "RoutingOperation_routingId_fkey" FOREIGN KEY ("routingId") REFERENCES "Routing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingOperation" ADD CONSTRAINT "RoutingOperation_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentOperationMap" ADD CONSTRAINT "EquipmentOperationMap_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentOperationMap" ADD CONSTRAINT "EquipmentOperationMap_routingOperationId_fkey" FOREIGN KEY ("routingOperationId") REFERENCES "RoutingOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotRule" ADD CONSTRAINT "LotRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotRule" ADD CONSTRAINT "LotRule_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionSpec" ADD CONSTRAINT "InspectionSpec_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionSpec" ADD CONSTRAINT "InspectionSpec_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionSpec" ADD CONSTRAINT "InspectionSpec_routingOperationId_fkey" FOREIGN KEY ("routingOperationId") REFERENCES "RoutingOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionItem" ADD CONSTRAINT "InspectionItem_inspectionSpecId_fkey" FOREIGN KEY ("inspectionSpecId") REFERENCES "InspectionSpec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCode" ADD CONSTRAINT "DefectCode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BOM"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_routingId_fkey" FOREIGN KEY ("routingId") REFERENCES "Routing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperation" ADD CONSTRAINT "WorkOrderOperation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperation" ADD CONSTRAINT "WorkOrderOperation_routingOperationId_fkey" FOREIGN KEY ("routingOperationId") REFERENCES "RoutingOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperation" ADD CONSTRAINT "WorkOrderOperation_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReservation" ADD CONSTRAINT "MaterialReservation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReservation" ADD CONSTRAINT "MaterialReservation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialConsumption" ADD CONSTRAINT "MaterialConsumption_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialConsumption" ADD CONSTRAINT "MaterialConsumption_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialConsumption" ADD CONSTRAINT "MaterialConsumption_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_currentLocationId_fkey" FOREIGN KEY ("currentLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionResult" ADD CONSTRAINT "ProductionResult_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodsReceipt" ADD CONSTRAINT "FinishedGoodsReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodsReceipt" ADD CONSTRAINT "FinishedGoodsReceipt_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodsReceipt" ADD CONSTRAINT "FinishedGoodsReceipt_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodsReceipt" ADD CONSTRAINT "FinishedGoodsReceipt_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodsReceipt" ADD CONSTRAINT "FinishedGoodsReceipt_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodsReceipt" ADD CONSTRAINT "FinishedGoodsReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodsReceipt" ADD CONSTRAINT "FinishedGoodsReceipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityInspection" ADD CONSTRAINT "QualityInspection_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityInspection" ADD CONSTRAINT "QualityInspection_inspectionSpecId_fkey" FOREIGN KEY ("inspectionSpecId") REFERENCES "InspectionSpec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityInspection" ADD CONSTRAINT "QualityInspection_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecord" ADD CONSTRAINT "DefectRecord_qualityInspectionId_fkey" FOREIGN KEY ("qualityInspectionId") REFERENCES "QualityInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecord" ADD CONSTRAINT "DefectRecord_defectCodeId_fkey" FOREIGN KEY ("defectCodeId") REFERENCES "DefectCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotGenealogy" ADD CONSTRAINT "LotGenealogy_parentLotId_fkey" FOREIGN KEY ("parentLotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotGenealogy" ADD CONSTRAINT "LotGenealogy_childLotId_fkey" FOREIGN KEY ("childLotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================
-- Partial Unique Indexes
-- Prisma schema.prisma에서 표현 불가 → migration.sql에 직접 포함
-- prisma migrate deploy 한 번으로 함께 적용됨
-- =============================================================

-- TenantUser: siteId IS NULL → 전역 멤버십 (테넌트 내 중복 방지)
CREATE UNIQUE INDEX IF NOT EXISTS "TenantUser_global_membership_uidx"
  ON "TenantUser" ("tenantId", "profileId")
  WHERE "siteId" IS NULL;

-- TenantUser: siteId IS NOT NULL → 사이트별 멤버십 (사이트 내 중복 방지)
CREATE UNIQUE INDEX IF NOT EXISTS "TenantUser_site_membership_uidx"
  ON "TenantUser" ("tenantId", "profileId", "siteId")
  WHERE "siteId" IS NOT NULL;

-- InventoryBalance: lotId IS NULL → LOT 미추적 품목 재고 스냅샷 unique
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryBalance_without_lot_uidx"
  ON "InventoryBalance" ("tenantId", "itemId", "locationId")
  WHERE "lotId" IS NULL;

-- InventoryBalance: lotId IS NOT NULL → LOT 추적 품목 재고 스냅샷 unique
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryBalance_with_lot_uidx"
  ON "InventoryBalance" ("tenantId", "itemId", "lotId", "locationId")
  WHERE "lotId" IS NOT NULL;
