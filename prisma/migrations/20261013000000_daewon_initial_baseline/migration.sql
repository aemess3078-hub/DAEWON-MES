-- DAEWON-MES initial baseline
-- 생성: prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script (db push 미사용)
-- 빈 DB 에서 현재 schema.prisma 전체(테이블/enum/인덱스/FK)를 만든다. NMES legacy migration 과 무관.

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
CREATE TYPE "LotNumberingType" AS ENUM ('DEFAULT', 'MANUAL', 'RAW_DATE_SEQ', 'PREFIX_MONTH_SEQ');

-- CreateEnum
CREATE TYPE "ManualLotPolicy" AS ENUM ('ALLOWED', 'REQUIRED', 'DISABLED');

-- CreateEnum
CREATE TYPE "UOM" AS ENUM ('EA', 'KG', 'G', 'L', 'ML', 'M', 'CM', 'MM', 'BOX', 'SET');

-- CreateEnum
CREATE TYPE "BOMStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RoutingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RoutingScope" AS ENUM ('COMMON', 'ITEM_SPECIFIC');

-- CreateEnum
CREATE TYPE "WorkCenterKind" AS ENUM ('ASSEMBLY', 'MACHINING', 'INSPECTION', 'PACKAGING', 'STORAGE');

-- CreateEnum
CREATE TYPE "EquipmentType" AS ENUM ('MACHINE', 'TOOL', 'JIG', 'FIXTURE', 'VEHICLE');

-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'DISCARDED');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'PARTIAL', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('ACTIVE', 'QUARANTINE', 'ON_HOLD', 'CONSUMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LotReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUST', 'RETURN', 'SCRAP', 'SUPPLIER_RETURN');

-- CreateEnum
CREATE TYPE "WipUnitStatus" AS ENUM ('WAITING', 'IN_PROCESS', 'ON_HOLD', 'OUTSOURCED', 'IN_TRANSIT', 'RECEIVED', 'COMPLETED', 'SCRAPPED', 'REWORK');

-- CreateEnum
CREATE TYPE "WipMovementType" AS ENUM ('CREATED', 'STARTED', 'MOVED', 'HOLD', 'RELEASED', 'SPLIT', 'MERGE', 'DEFECT', 'REWORK', 'SCRAP', 'OUTSOURCED', 'RETURNED', 'COMPLETED', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "WipHoldStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PASS', 'FAIL', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "DefectSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR');

-- CreateEnum
CREATE TYPE "DefectDisposition" AS ENUM ('SCRAP', 'REWORK', 'ACCEPT', 'USE_AS_IS');

-- CreateEnum
CREATE TYPE "DefectCategory" AS ENUM ('DIMENSIONAL', 'VISUAL', 'FUNCTIONAL', 'MATERIAL');

-- CreateEnum
CREATE TYPE "CorrectiveActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RecurrencePreventionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'VERIFYING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "VerificationResult" AS ENUM ('EFFECTIVE', 'INEFFECTIVE');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('SOP', 'DRAWING', 'SPEC', 'CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "SignupRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "InspectionInputType" AS ENUM ('NUMERIC', 'TEXT', 'BOOLEAN', 'SELECT');

-- CreateEnum
CREATE TYPE "LotGenealogyRelation" AS ENUM ('INPUT', 'OUTPUT', 'REWORK');

-- CreateEnum
CREATE TYPE "InspectionSpecStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "InspectionJudgement" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "SpcControlChartType" AS ENUM ('I_MR');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'BATCH', 'API');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PermissionAction" AS ENUM ('READ', 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'EXPORT');

-- CreateEnum
CREATE TYPE "ConnectionProtocol" AS ENUM ('OPC_UA', 'MODBUS_TCP', 'MQTT', 'MC_PROTOCOL', 'S7', 'FOCAS', 'CUSTOM', 'NCWATCH_AGENT');

-- CreateEnum
CREATE TYPE "TagDataType" AS ENUM ('BOOL', 'INT', 'FLOAT', 'STRING');

-- CreateEnum
CREATE TYPE "TagCategory" AS ENUM ('PROCESS', 'STATUS', 'ALARM', 'COUNTER', 'QUALITY');

-- CreateEnum
CREATE TYPE "GatewayStatus" AS ENUM ('ONLINE', 'OFFLINE', 'ERROR');

-- CreateEnum
CREATE TYPE "ECNStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWING', 'APPROVED', 'REJECTED', 'IMPLEMENTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EquipmentEventType" AS ENUM ('RUN', 'STOP', 'ALARM', 'WARNING', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "LoginEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAIL', 'LOGOUT');

-- CreateEnum
CREATE TYPE "LoginFailReason" AS ENUM ('USER_NOT_FOUND', 'INVALID_PASSWORD', 'PENDING_APPROVAL', 'HOLD', 'REJECTED', 'INACTIVE', 'LOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "NumberingRuleType" AS ENUM ('LOT', 'SERIAL');

-- CreateEnum
CREATE TYPE "InspectionStage" AS ENUM ('FIRST', 'MID', 'FINAL');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'PARTIAL_SHIPPED', 'SHIPPED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PLANNED', 'PICKED', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReceivingInspectionResult" AS ENUM ('PASS', 'FAIL', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "MaterialReturnStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'NEGOTIATING', 'WON', 'LOST', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectOrderPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ProjectStageStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ProjectIssueType" AS ENUM ('ISSUE', 'RISK');

-- CreateEnum
CREATE TYPE "ProjectIssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ProjectIssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ProjectPriceStatus" AS ENUM ('DRAFT', 'DECIDED');

-- CreateEnum
CREATE TYPE "RepairRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RepairPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('PASS', 'FAIL', 'NA');

-- CreateEnum
CREATE TYPE "EquipmentDowntimeKind" AS ENUM ('PLANNED', 'UNPLANNED');

-- CreateEnum
CREATE TYPE "PreventiveMaintenanceCycleUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "SupportType" AS ENUM ('BUG_REPORT', 'FEATURE_REQUEST', 'IMPROVEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'ANSWERED', 'ON_HOLD', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

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
    "department" TEXT,
    "phone" TEXT,
    "employeeNo" TEXT,
    "jobTitle" TEXT,
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
CREATE TABLE "SignupRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loginId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "employeeNo" TEXT,
    "phone" TEXT,
    "jobTitle" TEXT,
    "passwordHash" TEXT,
    "popPinHash" TEXT,
    "popPinFingerprint" TEXT,
    "popPinSetAt" TIMESTAMP(3),
    "requestedRole" "UserRole" NOT NULL DEFAULT 'OPERATOR',
    "status" "SignupRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectReason" TEXT,

    CONSTRAINT "SignupRequest_pkey" PRIMARY KEY ("id")
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
    "businessNumber" TEXT,
    "ceoName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "email2" TEXT,
    "address" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "remark" TEXT,

    CONSTRAINT "BusinessPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemType" "ItemType",
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ItemCategory_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT,
    "itemGroupId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "uom" "UOM" NOT NULL DEFAULT 'EA',
    "spec" TEXT,
    "isLotTracked" BOOLEAN NOT NULL DEFAULT false,
    "isSerialTracked" BOOLEAN NOT NULL DEFAULT false,
    "lotNumberingType" "LotNumberingType" NOT NULL DEFAULT 'DEFAULT',
    "lotPrefix" TEXT,
    "manualLotPolicy" "ManualLotPolicy" NOT NULL DEFAULT 'ALLOWED',
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "defaultWarehouseId" TEXT,
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
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "RoutingStatus" NOT NULL DEFAULT 'DRAFT',
    "scope" "RoutingScope" NOT NULL DEFAULT 'ITEM_SPECIFIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Routing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemRouting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "routingId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ItemRouting_pkey" PRIMARY KEY ("id")
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
    "lifeLimit" INTEGER,
    "currentUsage" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentAppliedItem" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "EquipmentAppliedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentUsageHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL,
    "usageCount" INTEGER NOT NULL,
    "itemId" TEXT,
    "workOrderOperationId" TEXT,
    "productionResultId" TEXT,
    "operatorId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentUsageHistory_pkey" PRIMARY KEY ("id")
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
    "zone" TEXT,

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
CREATE TABLE "NumberingRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "NumberingRuleType" NOT NULL,
    "tokens" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberingSequence" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NumberingSequence_pkey" PRIMARY KEY ("id")
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
    "unit" TEXT,

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

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "description" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupGroupItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "externalBackupId" TEXT NOT NULL,
    "backupAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupGroupItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiddenBackup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalBackupId" TEXT NOT NULL,
    "hiddenById" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiddenBackup_pkey" PRIMARY KEY ("id")
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
    "manufacturingNo" TEXT,
    "plannedQty" DECIMAL(18,6) NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "productionPlanItemId" TEXT,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "startedAt" TIMESTAMP(3),

    CONSTRAINT "WorkOrderOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderOperationAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderOperationId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "assignedQty" DECIMAL(18,6) NOT NULL,
    "completedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "status" "OperationStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "seq" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderOperationAssignment_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "LotNumberReservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "status" "LotReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "reservedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "printedAt" TIMESTAMP(3),

    CONSTRAINT "LotNumberReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "warehouseId" TEXT NOT NULL,
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
    "note" TEXT,
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
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT,
    "workOrderId" TEXT,
    "workOrderOperationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "manufacturingNo" TEXT,
    "currentWorkCenterId" TEXT,
    "currentWarehouseId" TEXT,
    "currentLocationId" TEXT,
    "outsourcingPartnerId" TEXT,
    "sourceProductionResultId" TEXT,
    "parentWipUnitId" TEXT,
    "qty" DECIMAL(18,6) NOT NULL,
    "status" "WipUnitStatus" NOT NULL DEFAULT 'IN_PROCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WipUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WipMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT,
    "wipUnitId" TEXT NOT NULL,
    "movementType" "WipMovementType" NOT NULL,
    "fromOperationId" TEXT,
    "toOperationId" TEXT,
    "fromWorkCenterId" TEXT,
    "toWorkCenterId" TEXT,
    "fromWarehouseId" TEXT,
    "toWarehouseId" TEXT,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "fromPartnerId" TEXT,
    "toPartnerId" TEXT,
    "relatedWipUnitId" TEXT,
    "qty" DECIMAL(18,6) NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WipMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WipUnitMaterialLot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "wipUnitId" TEXT NOT NULL,
    "workOrderMaterialLotId" TEXT,
    "materialItemId" TEXT NOT NULL,
    "materialLotId" TEXT,
    "materialLotNo" TEXT,
    "qty" DECIMAL(18,6) NOT NULL,
    "unit" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WipUnitMaterialLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WipHold" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT,
    "wipUnitId" TEXT NOT NULL,
    "previousStatus" "WipUnitStatus" NOT NULL,
    "status" "WipHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "heldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heldById" TEXT,
    "heldByName" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "releasedByName" TEXT,
    "releaseNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledByName" TEXT,
    "cancelNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WipHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionResult" (
    "id" TEXT NOT NULL,
    "workOrderOperationId" TEXT NOT NULL,
    "workOrderOperationAssignmentId" TEXT,
    "goodQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "defectQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "reworkQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "operatorId" TEXT,

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
    "stage" "InspectionStage" NOT NULL DEFAULT 'MID',
    "result" "InspectionResult",
    "inspectedQty" DECIMAL(18,6) NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lotId" TEXT,

    CONSTRAINT "QualityInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionMeasurement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "qualityInspectionId" TEXT NOT NULL,
    "inspectionItemId" TEXT NOT NULL,
    "sampleNo" INTEGER NOT NULL DEFAULT 1,
    "numericValue" DECIMAL(18,6),
    "textValue" TEXT,
    "booleanValue" BOOLEAN,
    "lowerLimitSnapshot" DECIMAL(18,6),
    "upperLimitSnapshot" DECIMAL(18,6),
    "itemNameSnapshot" TEXT NOT NULL,
    "inputTypeSnapshot" "InspectionInputType" NOT NULL,
    "unitSnapshot" TEXT,
    "judgement" "InspectionJudgement",
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpcProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inspectionItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "controlChartType" "SpcControlChartType" NOT NULL DEFAULT 'I_MR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpcProfile_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "DefectCauseAnalysis" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "defectRecordId" TEXT NOT NULL,
    "rootCause" TEXT NOT NULL,
    "analysisDetail" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefectCauseAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefectCorrectiveAction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "defectRecordId" TEXT NOT NULL,
    "actionContent" TEXT NOT NULL,
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "CorrectiveActionStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "completionNote" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefectCorrectiveAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefectRecurrencePrevention" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "defectRecordId" TEXT NOT NULL,
    "preventionContent" TEXT NOT NULL,
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "RecurrencePreventionStatus" NOT NULL DEFAULT 'OPEN',
    "verificationContent" TEXT,
    "verificationResult" "VerificationResult",
    "verifierId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefectRecurrencePrevention_pkey" PRIMARY KEY ("id")
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
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "menuName" TEXT,
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

-- CreateTable
CREATE TABLE "ProductionPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "planNo" TEXT NOT NULL,
    "planType" "PlanType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionPlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "bomId" TEXT,
    "routingId" TEXT,
    "plannedQty" DECIMAL(18,6) NOT NULL,
    "note" TEXT,
    "salesOrderItemId" TEXT,

    CONSTRAINT "ProductionPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupCode" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommonCode" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "extra" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommonCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "resource" TEXT NOT NULL,
    "action" "PermissionAction" NOT NULL,
    "isAllowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "icon" TEXT,
    "menuCodes" TEXT[],
    "isCore" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureDependency" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FeatureDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureRequirement" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "FeatureRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantFeature" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "config" JSONB,

    CONSTRAINT "TenantFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EdgeGateway" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "apiKey" TEXT NOT NULL,
    "status" "GatewayStatus" NOT NULL DEFAULT 'OFFLINE',
    "lastHeartbeat" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EdgeGateway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentConnection" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "protocol" "ConnectionProtocol" NOT NULL,
    "host" TEXT,
    "port" INTEGER,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataTag" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "tagCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "dataType" "TagDataType" NOT NULL,
    "unit" TEXT,
    "category" "TagCategory" NOT NULL,
    "plcAddress" TEXT NOT NULL,
    "scaleFactor" DECIMAL(18,6),
    "offset" DECIMAL(18,6),
    "samplingMs" INTEGER NOT NULL DEFAULT 1000,
    "deadband" DECIMAL(18,6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagSnapshot" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "quality" TEXT NOT NULL DEFAULT 'GOOD',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TagSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagCurrentValue" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "numericValue" DECIMAL(18,6),
    "quality" TEXT NOT NULL DEFAULT 'GOOD',
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagCurrentValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentEvent" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "eventType" "EquipmentEventType" NOT NULL,
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "duration" INTEGER,

    CONSTRAINT "EquipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAmount" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderItem" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(18,2),
    "deliveryDate" TIMESTAMP(3),
    "producedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "shippedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "shipmentNo" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "shippedDate" TIMESTAMP(3),
    "deliveredDate" TIMESTAMP(3),
    "warehouseId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentOrderId" TEXT NOT NULL,
    "salesOrderItemId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "lotId" TEXT,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "expectedDate" TIMESTAMP(3) NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAmount" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "workOrderOperationId" TEXT,
    "qty" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "receivedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "stockAtOrder" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivingInspection" (
    "id" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "inspectorId" TEXT,
    "receivedQty" DECIMAL(18,6) NOT NULL,
    "acceptedQty" DECIMAL(18,6) NOT NULL,
    "rejectedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "result" "ReceivingInspectionResult" NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "ReceivingInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialReturn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "returnNo" TEXT NOT NULL,
    "status" "MaterialReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialReturnItem" (
    "id" TEXT NOT NULL,
    "materialReturnId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT,
    "lotId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "returnQty" DECIMAL(18,6) NOT NULL,
    "note" TEXT,
    "inventoryTransactionId" TEXT,

    CONSTRAINT "MaterialReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemPrice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "priceType" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIUsageLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "costEstimate" DECIMAL(10,6),
    "requestSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "quotationNo" TEXT NOT NULL,
    "quotationDate" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAmount" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "note" TEXT,
    "convertedSalesOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "itemId" TEXT,
    "salesOrderId" TEXT,
    "ownerId" TEXT NOT NULL,
    "priority" "ProjectOrderPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ProjectOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "plannedStartDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectStage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectOrderId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectStageStatus" NOT NULL DEFAULT 'PENDING',
    "plannedStartDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "sourceRoutingOperationId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectIssue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectOrderId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ProjectIssueType" NOT NULL DEFAULT 'ISSUE',
    "severity" "ProjectIssueSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "ProjectIssueStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectOrderPrice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectOrderId" TEXT NOT NULL,
    "quotationId" TEXT,
    "salesOrderId" TEXT,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "quotationUnitPrice" DECIMAL(18,2),
    "orderUnitPrice" DECIMAL(18,2),
    "finalUnitPrice" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "status" "ProjectPriceStatus" NOT NULL DEFAULT 'DRAFT',
    "quotationDate" TIMESTAMP(3),
    "orderDate" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectOrderPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectOrderPriceRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectOrderPriceId" TEXT NOT NULL,
    "previousFinalUnitPrice" DECIMAL(18,2),
    "newFinalUnitPrice" DECIMAL(18,2) NOT NULL,
    "reason" TEXT,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectOrderPriceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCost" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "costType" TEXT NOT NULL,
    "materialCost" DECIMAL(18,2) NOT NULL,
    "laborCost" DECIMAL(18,2) NOT NULL,
    "overheadCost" DECIMAL(18,2) NOT NULL,
    "totalCost" DECIMAL(18,2) NOT NULL,
    "bomId" TEXT,
    "workOrderId" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "ItemCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineeringChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ecnNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "targetItemId" TEXT NOT NULL,
    "status" "ECNStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "implementedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngineeringChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineeringChangeDetail" (
    "id" TEXT NOT NULL,
    "engineeringChangeId" TEXT NOT NULL,
    "changeTarget" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "description" TEXT,

    CONSTRAINT "EngineeringChangeDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentProblemType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentProblemType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentRepairRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "problemTypeId" TEXT,
    "requestNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "RepairPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "RepairRequestStatus" NOT NULL DEFAULT 'OPEN',
    "requestedBy" TEXT NOT NULL,
    "assignedTo" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentRepairRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentDailyCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "checkDate" DATE NOT NULL,
    "checkedBy" TEXT NOT NULL,
    "result" "CheckResult" NOT NULL DEFAULT 'PASS',
    "note" TEXT,
    "items" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentDailyCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentDowntime" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "reasonId" TEXT NOT NULL,
    "eventType" "EquipmentEventType" NOT NULL DEFAULT 'STOP',
    "kind" "EquipmentDowntimeKind" NOT NULL DEFAULT 'UNPLANNED',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "note" TEXT,
    "equipmentEventId" TEXT,
    "repairRequestId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentDowntime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentMaintenancePlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cycleValue" INTEGER NOT NULL,
    "cycleUnit" "PreventiveMaintenanceCycleUnit" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "lastCompletedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentMaintenancePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentMaintenanceHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "result" "CheckResult" NOT NULL DEFAULT 'PASS',
    "note" TEXT,
    "performedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentMaintenanceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "popPinHash" TEXT,
    "popPinFingerprint" TEXT,
    "popPinSetAt" TIMESTAMP(3),
    "mustChangePw" BOOLEAN NOT NULL DEFAULT true,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "profileId" TEXT,
    "eventType" "LoginEventType" NOT NULL,
    "failReason" "LoginFailReason",
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "type" "SupportType" NOT NULL,
    "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "imageUrl" TEXT,
    "answer" TEXT,
    "adminNote" TEXT,
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ncwatch_equipment_mapping" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT,
    "machine_name" TEXT NOT NULL,
    "equipment_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "memo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ncwatch_equipment_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ncwatch_status" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT,
    "machine_name" TEXT NOT NULL,
    "status_code" INTEGER,
    "status_label" TEXT,
    "run_code" INTEGER,
    "mode_code" INTEGER,
    "message_code" INTEGER,
    "program_name" TEXT,
    "o_number" TEXT,
    "spindle_speed" INTEGER,
    "feed_rate" INTEGER,
    "position_x" DECIMAL(18,4),
    "position_y" DECIMAL(18,4),
    "position_z" DECIMAL(18,4),
    "tool_no" TEXT,
    "part_count" INTEGER,
    "block_number" INTEGER,
    "block_tot" INTEGER,
    "ratio" DECIMAL(5,2),
    "alarm_code" TEXT,
    "alarm_message" TEXT,
    "alive_count" INTEGER,
    "ncwatch_ts" TEXT,
    "raw_payload" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ncwatch_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ncwatch_status_history" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "machine_name" TEXT NOT NULL,
    "status_code" INTEGER,
    "status_label" TEXT,
    "part_count" INTEGER,
    "spindle_speed" INTEGER,
    "alarm_message" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ncwatch_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ncwatch_report_daily" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "machine_name" TEXT NOT NULL,
    "report_date" DATE NOT NULL,
    "run_time" TEXT,
    "run_pct" DECIMAL(5,2),
    "part_count" INTEGER,
    "stop_time" TEXT,
    "stop_pct" DECIMAL(5,2),
    "manual_pct" DECIMAL(5,2),
    "alarm_pct" DECIMAL(5,2),
    "offline_pct" DECIMAL(5,2),
    "manual_time" TEXT,
    "alarm_time" TEXT,
    "offline_time" TEXT,
    "raw_payload" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ncwatch_report_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ncwatch_sync_log" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "machine_name" TEXT,
    "endpoint" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "message" TEXT,
    "payload_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ncwatch_sync_log_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "SignupRequest_tenantId_idx" ON "SignupRequest"("tenantId");

-- CreateIndex
CREATE INDEX "SignupRequest_status_idx" ON "SignupRequest"("status");

-- CreateIndex
CREATE INDEX "SignupRequest_email_idx" ON "SignupRequest"("email");

-- CreateIndex
CREATE INDEX "SignupRequest_tenantId_loginId_idx" ON "SignupRequest"("tenantId", "loginId");

-- CreateIndex
CREATE INDEX "SignupRequest_tenantId_popPinFingerprint_idx" ON "SignupRequest"("tenantId", "popPinFingerprint");

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
CREATE INDEX "ItemGroup_tenantId_idx" ON "ItemGroup"("tenantId");

-- CreateIndex
CREATE INDEX "ItemGroup_categoryId_idx" ON "ItemGroup"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemGroup_tenantId_code_key" ON "ItemGroup"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Item_tenantId_idx" ON "Item"("tenantId");

-- CreateIndex
CREATE INDEX "Item_categoryId_idx" ON "Item"("categoryId");

-- CreateIndex
CREATE INDEX "Item_itemGroupId_idx" ON "Item"("itemGroupId");

-- CreateIndex
CREATE INDEX "Item_defaultWarehouseId_idx" ON "Item"("defaultWarehouseId");

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
CREATE UNIQUE INDEX "Routing_tenantId_code_key" ON "Routing"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ItemRouting_itemId_idx" ON "ItemRouting"("itemId");

-- CreateIndex
CREATE INDEX "ItemRouting_routingId_idx" ON "ItemRouting"("routingId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemRouting_itemId_routingId_key" ON "ItemRouting"("itemId", "routingId");

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
CREATE INDEX "EquipmentAppliedItem_equipmentId_idx" ON "EquipmentAppliedItem"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentAppliedItem_itemId_idx" ON "EquipmentAppliedItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentAppliedItem_equipmentId_itemId_key" ON "EquipmentAppliedItem"("equipmentId", "itemId");

-- CreateIndex
CREATE INDEX "EquipmentUsageHistory_tenantId_idx" ON "EquipmentUsageHistory"("tenantId");

-- CreateIndex
CREATE INDEX "EquipmentUsageHistory_equipmentId_idx" ON "EquipmentUsageHistory"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentUsageHistory_productionResultId_idx" ON "EquipmentUsageHistory"("productionResultId");

-- CreateIndex
CREATE INDEX "EquipmentUsageHistory_usedAt_idx" ON "EquipmentUsageHistory"("usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentUsageHistory_productionResultId_equipmentId_key" ON "EquipmentUsageHistory"("productionResultId", "equipmentId");

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
CREATE INDEX "NumberingRule_tenantId_idx" ON "NumberingRule"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "NumberingRule_tenantId_type_key" ON "NumberingRule"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "NumberingSequence_ruleId_periodKey_key" ON "NumberingSequence"("ruleId", "periodKey");

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
CREATE INDEX "WorkStandardMapping_tenantId_itemId_routingOperationId_isAc_idx" ON "WorkStandardMapping"("tenantId", "itemId", "routingOperationId", "isActive");

-- CreateIndex
CREATE INDEX "WorkStandardMapping_documentId_idx" ON "WorkStandardMapping"("documentId");

-- CreateIndex
CREATE INDEX "WorkStandardMapping_routingOperationId_idx" ON "WorkStandardMapping"("routingOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkStandardMapping_tenantId_documentId_itemId_routingOpera_key" ON "WorkStandardMapping"("tenantId", "documentId", "itemId", "routingOperationId");

-- CreateIndex
CREATE INDEX "Attachment_tenantId_idx" ON "Attachment"("tenantId");

-- CreateIndex
CREATE INDEX "Attachment_entityType_entityId_idx" ON "Attachment"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Attachment_uploadedById_idx" ON "Attachment"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storagePath_key" ON "Attachment"("storagePath");

-- CreateIndex
CREATE INDEX "BackupGroup_tenantId_idx" ON "BackupGroup"("tenantId");

-- CreateIndex
CREATE INDEX "BackupGroupItem_tenantId_idx" ON "BackupGroupItem"("tenantId");

-- CreateIndex
CREATE INDEX "BackupGroupItem_externalBackupId_idx" ON "BackupGroupItem"("externalBackupId");

-- CreateIndex
CREATE UNIQUE INDEX "BackupGroupItem_groupId_externalBackupId_key" ON "BackupGroupItem"("groupId", "externalBackupId");

-- CreateIndex
CREATE INDEX "HiddenBackup_tenantId_idx" ON "HiddenBackup"("tenantId");

-- CreateIndex
CREATE INDEX "HiddenBackup_externalBackupId_idx" ON "HiddenBackup"("externalBackupId");

-- CreateIndex
CREATE UNIQUE INDEX "HiddenBackup_tenantId_externalBackupId_key" ON "HiddenBackup"("tenantId", "externalBackupId");

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
CREATE INDEX "WorkOrder_productionPlanItemId_idx" ON "WorkOrder"("productionPlanItemId");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_manufacturingNo_idx" ON "WorkOrder"("tenantId", "manufacturingNo");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_tenantId_orderNo_key" ON "WorkOrder"("tenantId", "orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_tenantId_manufacturingNo_key" ON "WorkOrder"("tenantId", "manufacturingNo");

-- CreateIndex
CREATE INDEX "WorkOrderMaterialLot_tenantId_idx" ON "WorkOrderMaterialLot"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrderMaterialLot_workOrderId_idx" ON "WorkOrderMaterialLot"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderMaterialLot_tenantId_manufacturingNo_idx" ON "WorkOrderMaterialLot"("tenantId", "manufacturingNo");

-- CreateIndex
CREATE INDEX "WorkOrderMaterialLot_materialItemId_idx" ON "WorkOrderMaterialLot"("materialItemId");

-- CreateIndex
CREATE INDEX "WorkOrderMaterialLot_tenantId_materialLotNo_idx" ON "WorkOrderMaterialLot"("tenantId", "materialLotNo");

-- CreateIndex
CREATE INDEX "WorkOrderMaterialLot_inventoryTransactionId_idx" ON "WorkOrderMaterialLot"("inventoryTransactionId");

-- CreateIndex
CREATE INDEX "WorkOrderOperation_workOrderId_idx" ON "WorkOrderOperation"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderOperation_routingOperationId_idx" ON "WorkOrderOperation"("routingOperationId");

-- CreateIndex
CREATE INDEX "WorkOrderOperation_equipmentId_idx" ON "WorkOrderOperation"("equipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderOperation_workOrderId_seq_key" ON "WorkOrderOperation"("workOrderId", "seq");

-- CreateIndex
CREATE INDEX "WorkOrderOperationAssignment_tenantId_idx" ON "WorkOrderOperationAssignment"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrderOperationAssignment_workOrderOperationId_idx" ON "WorkOrderOperationAssignment"("workOrderOperationId");

-- CreateIndex
CREATE INDEX "WorkOrderOperationAssignment_equipmentId_idx" ON "WorkOrderOperationAssignment"("equipmentId");

-- CreateIndex
CREATE INDEX "WorkOrderOperationAssignment_status_idx" ON "WorkOrderOperationAssignment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderOperationAssignment_workOrderOperationId_equipment_key" ON "WorkOrderOperationAssignment"("workOrderOperationId", "equipmentId");

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
CREATE INDEX "LotNumberReservation_tenantId_purchaseOrderItemId_idx" ON "LotNumberReservation"("tenantId", "purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "LotNumberReservation_status_expiresAt_idx" ON "LotNumberReservation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LotNumberReservation_tenantId_lotNo_key" ON "LotNumberReservation"("tenantId", "lotNo");

-- CreateIndex
CREATE INDEX "InventoryBalance_tenantId_idx" ON "InventoryBalance"("tenantId");

-- CreateIndex
CREATE INDEX "InventoryBalance_siteId_idx" ON "InventoryBalance"("siteId");

-- CreateIndex
CREATE INDEX "InventoryBalance_itemId_idx" ON "InventoryBalance"("itemId");

-- CreateIndex
CREATE INDEX "InventoryBalance_warehouseId_idx" ON "InventoryBalance"("warehouseId");

-- CreateIndex
CREATE INDEX "InventoryBalance_tenantId_siteId_itemId_idx" ON "InventoryBalance"("tenantId", "siteId", "itemId");

-- CreateIndex
CREATE INDEX "InventoryBalance_tenantId_warehouseId_idx" ON "InventoryBalance"("tenantId", "warehouseId");

-- CreateIndex
CREATE INDEX "InventoryBalance_tenantId_itemId_lotId_warehouseId_idx" ON "InventoryBalance"("tenantId", "itemId", "lotId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_tenantId_itemId_warehouseId_lotId_key" ON "InventoryBalance"("tenantId", "itemId", "warehouseId", "lotId");

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
CREATE INDEX "WipUnit_tenantId_workOrderId_idx" ON "WipUnit"("tenantId", "workOrderId");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_manufacturingNo_idx" ON "WipUnit"("tenantId", "manufacturingNo");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_workOrderOperationId_idx" ON "WipUnit"("tenantId", "workOrderOperationId");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_status_idx" ON "WipUnit"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_currentLocationId_idx" ON "WipUnit"("tenantId", "currentLocationId");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_currentWorkCenterId_idx" ON "WipUnit"("tenantId", "currentWorkCenterId");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_currentWarehouseId_idx" ON "WipUnit"("tenantId", "currentWarehouseId");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_outsourcingPartnerId_idx" ON "WipUnit"("tenantId", "outsourcingPartnerId");

-- CreateIndex
CREATE INDEX "WipUnit_tenantId_lotId_idx" ON "WipUnit"("tenantId", "lotId");

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
CREATE INDEX "WipMovement_tenantId_wipUnitId_idx" ON "WipMovement"("tenantId", "wipUnitId");

-- CreateIndex
CREATE INDEX "WipMovement_tenantId_movementType_idx" ON "WipMovement"("tenantId", "movementType");

-- CreateIndex
CREATE INDEX "WipMovement_tenantId_createdAt_idx" ON "WipMovement"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "WipMovement_tenantId_sourceType_sourceId_idx" ON "WipMovement"("tenantId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "WipMovement_tenantId_fromOperationId_idx" ON "WipMovement"("tenantId", "fromOperationId");

-- CreateIndex
CREATE INDEX "WipMovement_tenantId_toOperationId_idx" ON "WipMovement"("tenantId", "toOperationId");

-- CreateIndex
CREATE INDEX "WipMovement_tenantId_relatedWipUnitId_idx" ON "WipMovement"("tenantId", "relatedWipUnitId");

-- CreateIndex
CREATE INDEX "WipUnitMaterialLot_tenantId_wipUnitId_idx" ON "WipUnitMaterialLot"("tenantId", "wipUnitId");

-- CreateIndex
CREATE INDEX "WipUnitMaterialLot_tenantId_workOrderMaterialLotId_idx" ON "WipUnitMaterialLot"("tenantId", "workOrderMaterialLotId");

-- CreateIndex
CREATE INDEX "WipUnitMaterialLot_tenantId_materialItemId_idx" ON "WipUnitMaterialLot"("tenantId", "materialItemId");

-- CreateIndex
CREATE INDEX "WipUnitMaterialLot_tenantId_materialLotId_idx" ON "WipUnitMaterialLot"("tenantId", "materialLotId");

-- CreateIndex
CREATE INDEX "WipUnitMaterialLot_tenantId_materialLotNo_idx" ON "WipUnitMaterialLot"("tenantId", "materialLotNo");

-- CreateIndex
CREATE INDEX "WipHold_tenantId_wipUnitId_idx" ON "WipHold"("tenantId", "wipUnitId");

-- CreateIndex
CREATE INDEX "WipHold_tenantId_status_idx" ON "WipHold"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WipHold_wipUnitId_status_idx" ON "WipHold"("wipUnitId", "status");

-- CreateIndex
CREATE INDEX "WipHold_tenantId_heldAt_idx" ON "WipHold"("tenantId", "heldAt");

-- CreateIndex
CREATE INDEX "ProductionResult_workOrderOperationId_idx" ON "ProductionResult"("workOrderOperationId");

-- CreateIndex
CREATE INDEX "ProductionResult_workOrderOperationAssignmentId_idx" ON "ProductionResult"("workOrderOperationAssignmentId");

-- CreateIndex
CREATE INDEX "ProductionResult_operatorId_idx" ON "ProductionResult"("operatorId");

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
CREATE INDEX "QualityInspection_lotId_idx" ON "QualityInspection"("lotId");

-- CreateIndex
CREATE INDEX "QualityInspection_lotId_inspectedAt_idx" ON "QualityInspection"("lotId", "inspectedAt");

-- CreateIndex
CREATE INDEX "QualityInspection_workOrderOperationId_inspectedAt_idx" ON "QualityInspection"("workOrderOperationId", "inspectedAt");

-- CreateIndex
CREATE INDEX "QualityInspection_inspectorId_inspectedAt_idx" ON "QualityInspection"("inspectorId", "inspectedAt");

-- CreateIndex
CREATE INDEX "InspectionMeasurement_tenantId_measuredAt_idx" ON "InspectionMeasurement"("tenantId", "measuredAt");

-- CreateIndex
CREATE INDEX "InspectionMeasurement_tenantId_inspectionItemId_measuredAt_idx" ON "InspectionMeasurement"("tenantId", "inspectionItemId", "measuredAt");

-- CreateIndex
CREATE INDEX "InspectionMeasurement_qualityInspectionId_idx" ON "InspectionMeasurement"("qualityInspectionId");

-- CreateIndex
CREATE INDEX "InspectionMeasurement_inspectionItemId_idx" ON "InspectionMeasurement"("inspectionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionMeasurement_qualityInspectionId_inspectionItemId__key" ON "InspectionMeasurement"("qualityInspectionId", "inspectionItemId", "sampleNo");

-- CreateIndex
CREATE INDEX "SpcProfile_tenantId_idx" ON "SpcProfile"("tenantId");

-- CreateIndex
CREATE INDEX "SpcProfile_tenantId_isActive_idx" ON "SpcProfile"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "SpcProfile_inspectionItemId_idx" ON "SpcProfile"("inspectionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SpcProfile_tenantId_inspectionItemId_name_key" ON "SpcProfile"("tenantId", "inspectionItemId", "name");

-- CreateIndex
CREATE INDEX "DefectRecord_qualityInspectionId_idx" ON "DefectRecord"("qualityInspectionId");

-- CreateIndex
CREATE INDEX "DefectRecord_defectCodeId_idx" ON "DefectRecord"("defectCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "DefectCauseAnalysis_defectRecordId_key" ON "DefectCauseAnalysis"("defectRecordId");

-- CreateIndex
CREATE INDEX "DefectCauseAnalysis_tenantId_idx" ON "DefectCauseAnalysis"("tenantId");

-- CreateIndex
CREATE INDEX "DefectCorrectiveAction_tenantId_idx" ON "DefectCorrectiveAction"("tenantId");

-- CreateIndex
CREATE INDEX "DefectCorrectiveAction_tenantId_status_idx" ON "DefectCorrectiveAction"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DefectCorrectiveAction_tenantId_dueDate_idx" ON "DefectCorrectiveAction"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "DefectCorrectiveAction_defectRecordId_idx" ON "DefectCorrectiveAction"("defectRecordId");

-- CreateIndex
CREATE INDEX "DefectCorrectiveAction_assigneeId_idx" ON "DefectCorrectiveAction"("assigneeId");

-- CreateIndex
CREATE INDEX "DefectRecurrencePrevention_tenantId_idx" ON "DefectRecurrencePrevention"("tenantId");

-- CreateIndex
CREATE INDEX "DefectRecurrencePrevention_tenantId_status_idx" ON "DefectRecurrencePrevention"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DefectRecurrencePrevention_tenantId_dueDate_idx" ON "DefectRecurrencePrevention"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "DefectRecurrencePrevention_defectRecordId_idx" ON "DefectRecurrencePrevention"("defectRecordId");

-- CreateIndex
CREATE INDEX "DefectRecurrencePrevention_assigneeId_idx" ON "DefectRecurrencePrevention"("assigneeId");

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

-- CreateIndex
CREATE INDEX "ProductionPlan_tenantId_idx" ON "ProductionPlan"("tenantId");

-- CreateIndex
CREATE INDEX "ProductionPlan_siteId_idx" ON "ProductionPlan"("siteId");

-- CreateIndex
CREATE INDEX "ProductionPlan_status_idx" ON "ProductionPlan"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionPlan_tenantId_planNo_key" ON "ProductionPlan"("tenantId", "planNo");

-- CreateIndex
CREATE INDEX "ProductionPlanItem_planId_idx" ON "ProductionPlanItem"("planId");

-- CreateIndex
CREATE INDEX "ProductionPlanItem_itemId_idx" ON "ProductionPlanItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionPlanItem_planId_itemId_key" ON "ProductionPlanItem"("planId", "itemId");

-- CreateIndex
CREATE INDEX "CodeGroup_tenantId_idx" ON "CodeGroup"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CodeGroup_tenantId_groupCode_key" ON "CodeGroup"("tenantId", "groupCode");

-- CreateIndex
CREATE INDEX "CommonCode_groupId_idx" ON "CommonCode"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "CommonCode_groupId_code_key" ON "CommonCode"("groupId", "code");

-- CreateIndex
CREATE INDEX "RolePermission_tenantId_idx" ON "RolePermission"("tenantId");

-- CreateIndex
CREATE INDEX "RolePermission_role_idx" ON "RolePermission"("role");

-- CreateIndex
CREATE INDEX "RolePermission_resource_idx" ON "RolePermission"("resource");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_tenantId_role_resource_action_key" ON "RolePermission"("tenantId", "role", "resource", "action");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureDefinition_code_key" ON "FeatureDefinition"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureDependency_featureId_dependsOnId_key" ON "FeatureDependency"("featureId", "dependsOnId");

-- CreateIndex
CREATE INDEX "FeatureRequirement_featureId_idx" ON "FeatureRequirement"("featureId");

-- CreateIndex
CREATE INDEX "TenantFeature_tenantId_idx" ON "TenantFeature"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantFeature_tenantId_featureId_key" ON "TenantFeature"("tenantId", "featureId");

-- CreateIndex
CREATE UNIQUE INDEX "EdgeGateway_apiKey_key" ON "EdgeGateway"("apiKey");

-- CreateIndex
CREATE INDEX "EdgeGateway_tenantId_idx" ON "EdgeGateway"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentConnection_equipmentId_gatewayId_key" ON "EquipmentConnection"("equipmentId", "gatewayId");

-- CreateIndex
CREATE INDEX "DataTag_connectionId_idx" ON "DataTag"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "DataTag_connectionId_tagCode_key" ON "DataTag"("connectionId", "tagCode");

-- CreateIndex
CREATE INDEX "TagSnapshot_tagId_timestamp_idx" ON "TagSnapshot"("tagId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "TagCurrentValue_tagId_key" ON "TagCurrentValue"("tagId");

-- CreateIndex
CREATE INDEX "EquipmentEvent_equipmentId_startedAt_idx" ON "EquipmentEvent"("equipmentId", "startedAt");

-- CreateIndex
CREATE INDEX "SalesOrder_tenantId_idx" ON "SalesOrder"("tenantId");

-- CreateIndex
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");

-- CreateIndex
CREATE INDEX "SalesOrder_status_idx" ON "SalesOrder"("status");

-- CreateIndex
CREATE INDEX "SalesOrder_tenantId_deliveryDate_idx" ON "SalesOrder"("tenantId", "deliveryDate");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_tenantId_orderNo_key" ON "SalesOrder"("tenantId", "orderNo");

-- CreateIndex
CREATE INDEX "SalesOrderItem_salesOrderId_idx" ON "SalesOrderItem"("salesOrderId");

-- CreateIndex
CREATE INDEX "SalesOrderItem_itemId_idx" ON "SalesOrderItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderItem_salesOrderId_itemId_key" ON "SalesOrderItem"("salesOrderId", "itemId");

-- CreateIndex
CREATE INDEX "ShipmentOrder_tenantId_idx" ON "ShipmentOrder"("tenantId");

-- CreateIndex
CREATE INDEX "ShipmentOrder_salesOrderId_idx" ON "ShipmentOrder"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentOrder_tenantId_shipmentNo_key" ON "ShipmentOrder"("tenantId", "shipmentNo");

-- CreateIndex
CREATE INDEX "ShipmentItem_shipmentOrderId_idx" ON "ShipmentItem"("shipmentOrderId");

-- CreateIndex
CREATE INDEX "ShipmentItem_salesOrderItemId_idx" ON "ShipmentItem"("salesOrderItemId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_idx" ON "PurchaseOrder"("tenantId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_orderNo_key" ON "PurchaseOrder"("tenantId", "orderNo");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_itemId_idx" ON "PurchaseOrderItem"("itemId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_workOrderOperationId_idx" ON "PurchaseOrderItem"("workOrderOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItem_purchaseOrderId_itemId_key" ON "PurchaseOrderItem"("purchaseOrderId", "itemId");

-- CreateIndex
CREATE INDEX "ReceivingInspection_purchaseOrderItemId_idx" ON "ReceivingInspection"("purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "MaterialReturn_tenantId_idx" ON "MaterialReturn"("tenantId");

-- CreateIndex
CREATE INDEX "MaterialReturn_tenantId_status_idx" ON "MaterialReturn"("tenantId", "status");

-- CreateIndex
CREATE INDEX "MaterialReturn_siteId_idx" ON "MaterialReturn"("siteId");

-- CreateIndex
CREATE INDEX "MaterialReturn_supplierId_idx" ON "MaterialReturn"("supplierId");

-- CreateIndex
CREATE INDEX "MaterialReturn_purchaseOrderId_idx" ON "MaterialReturn"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialReturn_tenantId_returnNo_key" ON "MaterialReturn"("tenantId", "returnNo");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialReturnItem_inventoryTransactionId_key" ON "MaterialReturnItem"("inventoryTransactionId");

-- CreateIndex
CREATE INDEX "MaterialReturnItem_materialReturnId_idx" ON "MaterialReturnItem"("materialReturnId");

-- CreateIndex
CREATE INDEX "MaterialReturnItem_itemId_idx" ON "MaterialReturnItem"("itemId");

-- CreateIndex
CREATE INDEX "MaterialReturnItem_purchaseOrderItemId_idx" ON "MaterialReturnItem"("purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "MaterialReturnItem_lotId_idx" ON "MaterialReturnItem"("lotId");

-- CreateIndex
CREATE INDEX "MaterialReturnItem_warehouseId_idx" ON "MaterialReturnItem"("warehouseId");

-- CreateIndex
CREATE INDEX "ItemPrice_tenantId_itemId_partnerId_idx" ON "ItemPrice"("tenantId", "itemId", "partnerId");

-- CreateIndex
CREATE INDEX "ItemPrice_tenantId_priceType_idx" ON "ItemPrice"("tenantId", "priceType");

-- CreateIndex
CREATE INDEX "AIUsageLog_tenantId_feature_idx" ON "AIUsageLog"("tenantId", "feature");

-- CreateIndex
CREATE INDEX "AIUsageLog_tenantId_createdAt_idx" ON "AIUsageLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AIUsageLog_createdAt_idx" ON "AIUsageLog"("createdAt");

-- CreateIndex
CREATE INDEX "Quotation_tenantId_status_idx" ON "Quotation"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Quotation_customerId_idx" ON "Quotation"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_tenantId_quotationNo_key" ON "Quotation"("tenantId", "quotationNo");

-- CreateIndex
CREATE INDEX "QuotationItem_quotationId_idx" ON "QuotationItem"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationItem_itemId_idx" ON "QuotationItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationItem_quotationId_itemId_key" ON "QuotationItem"("quotationId", "itemId");

-- CreateIndex
CREATE INDEX "ProjectOrder_tenantId_idx" ON "ProjectOrder"("tenantId");

-- CreateIndex
CREATE INDEX "ProjectOrder_tenantId_status_idx" ON "ProjectOrder"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ProjectOrder_tenantId_dueDate_idx" ON "ProjectOrder"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "ProjectOrder_customerId_idx" ON "ProjectOrder"("customerId");

-- CreateIndex
CREATE INDEX "ProjectOrder_salesOrderId_idx" ON "ProjectOrder"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOrder_tenantId_code_key" ON "ProjectOrder"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ProjectStage_tenantId_idx" ON "ProjectStage"("tenantId");

-- CreateIndex
CREATE INDEX "ProjectStage_projectOrderId_idx" ON "ProjectStage"("projectOrderId");

-- CreateIndex
CREATE INDEX "ProjectStage_sourceRoutingOperationId_idx" ON "ProjectStage"("sourceRoutingOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectStage_projectOrderId_seq_key" ON "ProjectStage"("projectOrderId", "seq");

-- CreateIndex
CREATE INDEX "ProjectIssue_tenantId_idx" ON "ProjectIssue"("tenantId");

-- CreateIndex
CREATE INDEX "ProjectIssue_tenantId_status_idx" ON "ProjectIssue"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ProjectIssue_tenantId_dueDate_idx" ON "ProjectIssue"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "ProjectIssue_projectOrderId_idx" ON "ProjectIssue"("projectOrderId");

-- CreateIndex
CREATE INDEX "ProjectIssue_assigneeId_idx" ON "ProjectIssue"("assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectIssue_tenantId_code_key" ON "ProjectIssue"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOrderPrice_projectOrderId_key" ON "ProjectOrderPrice"("projectOrderId");

-- CreateIndex
CREATE INDEX "ProjectOrderPrice_tenantId_idx" ON "ProjectOrderPrice"("tenantId");

-- CreateIndex
CREATE INDEX "ProjectOrderPrice_tenantId_status_idx" ON "ProjectOrderPrice"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ProjectOrderPrice_tenantId_decidedAt_idx" ON "ProjectOrderPrice"("tenantId", "decidedAt");

-- CreateIndex
CREATE INDEX "ProjectOrderPrice_quotationId_idx" ON "ProjectOrderPrice"("quotationId");

-- CreateIndex
CREATE INDEX "ProjectOrderPrice_salesOrderId_idx" ON "ProjectOrderPrice"("salesOrderId");

-- CreateIndex
CREATE INDEX "ProjectOrderPrice_itemId_idx" ON "ProjectOrderPrice"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOrderPrice_tenantId_projectOrderId_key" ON "ProjectOrderPrice"("tenantId", "projectOrderId");

-- CreateIndex
CREATE INDEX "ProjectOrderPriceRevision_tenantId_idx" ON "ProjectOrderPriceRevision"("tenantId");

-- CreateIndex
CREATE INDEX "ProjectOrderPriceRevision_projectOrderPriceId_idx" ON "ProjectOrderPriceRevision"("projectOrderPriceId");

-- CreateIndex
CREATE INDEX "ItemCost_tenantId_itemId_costType_idx" ON "ItemCost"("tenantId", "itemId", "costType");

-- CreateIndex
CREATE INDEX "ItemCost_tenantId_calculatedAt_idx" ON "ItemCost"("tenantId", "calculatedAt");

-- CreateIndex
CREATE INDEX "ItemCost_bomId_idx" ON "ItemCost"("bomId");

-- CreateIndex
CREATE INDEX "ItemCost_workOrderId_idx" ON "ItemCost"("workOrderId");

-- CreateIndex
CREATE INDEX "EngineeringChange_tenantId_status_idx" ON "EngineeringChange"("tenantId", "status");

-- CreateIndex
CREATE INDEX "EngineeringChange_targetItemId_idx" ON "EngineeringChange"("targetItemId");

-- CreateIndex
CREATE UNIQUE INDEX "EngineeringChange_tenantId_ecnNo_key" ON "EngineeringChange"("tenantId", "ecnNo");

-- CreateIndex
CREATE INDEX "EngineeringChangeDetail_engineeringChangeId_idx" ON "EngineeringChangeDetail"("engineeringChangeId");

-- CreateIndex
CREATE INDEX "EquipmentProblemType_tenantId_idx" ON "EquipmentProblemType"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentProblemType_tenantId_code_key" ON "EquipmentProblemType"("tenantId", "code");

-- CreateIndex
CREATE INDEX "EquipmentRepairRequest_tenantId_idx" ON "EquipmentRepairRequest"("tenantId");

-- CreateIndex
CREATE INDEX "EquipmentRepairRequest_equipmentId_idx" ON "EquipmentRepairRequest"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentRepairRequest_status_idx" ON "EquipmentRepairRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentRepairRequest_tenantId_requestNo_key" ON "EquipmentRepairRequest"("tenantId", "requestNo");

-- CreateIndex
CREATE INDEX "EquipmentDailyCheck_tenantId_idx" ON "EquipmentDailyCheck"("tenantId");

-- CreateIndex
CREATE INDEX "EquipmentDailyCheck_equipmentId_checkDate_idx" ON "EquipmentDailyCheck"("equipmentId", "checkDate");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentDailyCheck_equipmentId_checkDate_key" ON "EquipmentDailyCheck"("equipmentId", "checkDate");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentDowntime_equipmentEventId_key" ON "EquipmentDowntime"("equipmentEventId");

-- CreateIndex
CREATE INDEX "EquipmentDowntime_tenantId_startedAt_idx" ON "EquipmentDowntime"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "EquipmentDowntime_equipmentId_startedAt_idx" ON "EquipmentDowntime"("equipmentId", "startedAt");

-- CreateIndex
CREATE INDEX "EquipmentDowntime_reasonId_idx" ON "EquipmentDowntime"("reasonId");

-- CreateIndex
CREATE INDEX "EquipmentDowntime_repairRequestId_idx" ON "EquipmentDowntime"("repairRequestId");

-- CreateIndex
CREATE INDEX "EquipmentMaintenancePlan_tenantId_nextDueAt_idx" ON "EquipmentMaintenancePlan"("tenantId", "nextDueAt");

-- CreateIndex
CREATE INDEX "EquipmentMaintenancePlan_equipmentId_nextDueAt_idx" ON "EquipmentMaintenancePlan"("equipmentId", "nextDueAt");

-- CreateIndex
CREATE INDEX "EquipmentMaintenanceHistory_tenantId_completedAt_idx" ON "EquipmentMaintenanceHistory"("tenantId", "completedAt");

-- CreateIndex
CREATE INDEX "EquipmentMaintenanceHistory_equipmentId_completedAt_idx" ON "EquipmentMaintenanceHistory"("equipmentId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentMaintenanceHistory_planId_scheduledAt_key" ON "EquipmentMaintenanceHistory"("planId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserCredential_profileId_key" ON "UserCredential"("profileId");

-- CreateIndex
CREATE INDEX "UserCredential_tenantId_idx" ON "UserCredential"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCredential_tenantId_loginId_key" ON "UserCredential"("tenantId", "loginId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCredential_tenantId_popPinFingerprint_key" ON "UserCredential"("tenantId", "popPinFingerprint");

-- CreateIndex
CREATE INDEX "LoginHistory_tenantId_idx" ON "LoginHistory"("tenantId");

-- CreateIndex
CREATE INDEX "LoginHistory_profileId_idx" ON "LoginHistory"("profileId");

-- CreateIndex
CREATE INDEX "LoginHistory_loginId_createdAt_idx" ON "LoginHistory"("loginId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportRequest_tenantId_idx" ON "SupportRequest"("tenantId");

-- CreateIndex
CREATE INDEX "SupportRequest_authorId_idx" ON "SupportRequest"("authorId");

-- CreateIndex
CREATE INDEX "SupportRequest_status_idx" ON "SupportRequest"("status");

-- CreateIndex
CREATE INDEX "SupportRequest_tenantId_status_idx" ON "SupportRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SupportRequest_tenantId_createdAt_idx" ON "SupportRequest"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ncwatch_equipment_mapping_equipment_id_idx" ON "ncwatch_equipment_mapping"("equipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "ncwatch_equipment_mapping_tenantId_machine_name_key" ON "ncwatch_equipment_mapping"("tenantId", "machine_name");

-- CreateIndex
CREATE INDEX "ncwatch_status_machine_name_idx" ON "ncwatch_status"("machine_name");

-- CreateIndex
CREATE UNIQUE INDEX "ncwatch_status_tenantId_machine_name_key" ON "ncwatch_status"("tenantId", "machine_name");

-- CreateIndex
CREATE INDEX "ncwatch_status_history_tenantId_machine_name_changed_at_idx" ON "ncwatch_status_history"("tenantId", "machine_name", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "ncwatch_report_daily_tenantId_machine_name_report_date_key" ON "ncwatch_report_daily"("tenantId", "machine_name", "report_date");

-- CreateIndex
CREATE INDEX "ncwatch_sync_log_tenantId_created_at_idx" ON "ncwatch_sync_log"("tenantId", "created_at");

-- CreateIndex
CREATE INDEX "ncwatch_sync_log_result_idx" ON "ncwatch_sync_log"("result");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignupRequest" ADD CONSTRAINT "SignupRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignupRequest" ADD CONSTRAINT "SignupRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignupRequest" ADD CONSTRAINT "SignupRequest_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCenter" ADD CONSTRAINT "WorkCenter_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessPartner" ADD CONSTRAINT "BusinessPartner_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCategory" ADD CONSTRAINT "ItemCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCategory" ADD CONSTRAINT "ItemCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ItemCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemGroup" ADD CONSTRAINT "ItemGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemGroup" ADD CONSTRAINT "ItemGroup_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ItemCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ItemCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_itemGroupId_fkey" FOREIGN KEY ("itemGroupId") REFERENCES "ItemGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_defaultWarehouseId_fkey" FOREIGN KEY ("defaultWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "ItemRouting" ADD CONSTRAINT "ItemRouting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemRouting" ADD CONSTRAINT "ItemRouting_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemRouting" ADD CONSTRAINT "ItemRouting_routingId_fkey" FOREIGN KEY ("routingId") REFERENCES "Routing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "EquipmentAppliedItem" ADD CONSTRAINT "EquipmentAppliedItem_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAppliedItem" ADD CONSTRAINT "EquipmentAppliedItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageHistory" ADD CONSTRAINT "EquipmentUsageHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageHistory" ADD CONSTRAINT "EquipmentUsageHistory_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageHistory" ADD CONSTRAINT "EquipmentUsageHistory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageHistory" ADD CONSTRAINT "EquipmentUsageHistory_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageHistory" ADD CONSTRAINT "EquipmentUsageHistory_productionResultId_fkey" FOREIGN KEY ("productionResultId") REFERENCES "ProductionResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageHistory" ADD CONSTRAINT "EquipmentUsageHistory_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageHistory" ADD CONSTRAINT "EquipmentUsageHistory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "NumberingRule" ADD CONSTRAINT "NumberingRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberingSequence" ADD CONSTRAINT "NumberingSequence_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "NumberingRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "WorkStandardMapping" ADD CONSTRAINT "WorkStandardMapping_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkStandardMapping" ADD CONSTRAINT "WorkStandardMapping_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkStandardMapping" ADD CONSTRAINT "WorkStandardMapping_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkStandardMapping" ADD CONSTRAINT "WorkStandardMapping_routingOperationId_fkey" FOREIGN KEY ("routingOperationId") REFERENCES "RoutingOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupGroup" ADD CONSTRAINT "BackupGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupGroup" ADD CONSTRAINT "BackupGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupGroup" ADD CONSTRAINT "BackupGroup_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupGroupItem" ADD CONSTRAINT "BackupGroupItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupGroupItem" ADD CONSTRAINT "BackupGroupItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BackupGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiddenBackup" ADD CONSTRAINT "HiddenBackup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiddenBackup" ADD CONSTRAINT "HiddenBackup_hiddenById_fkey" FOREIGN KEY ("hiddenById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_productionPlanItemId_fkey" FOREIGN KEY ("productionPlanItemId") REFERENCES "ProductionPlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderMaterialLot" ADD CONSTRAINT "WorkOrderMaterialLot_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderMaterialLot" ADD CONSTRAINT "WorkOrderMaterialLot_materialItemId_fkey" FOREIGN KEY ("materialItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderMaterialLot" ADD CONSTRAINT "WorkOrderMaterialLot_inventoryTransactionId_fkey" FOREIGN KEY ("inventoryTransactionId") REFERENCES "InventoryTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperation" ADD CONSTRAINT "WorkOrderOperation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperation" ADD CONSTRAINT "WorkOrderOperation_routingOperationId_fkey" FOREIGN KEY ("routingOperationId") REFERENCES "RoutingOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperation" ADD CONSTRAINT "WorkOrderOperation_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperationAssignment" ADD CONSTRAINT "WorkOrderOperationAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperationAssignment" ADD CONSTRAINT "WorkOrderOperationAssignment_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperationAssignment" ADD CONSTRAINT "WorkOrderOperationAssignment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReservation" ADD CONSTRAINT "MaterialReservation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReservation" ADD CONSTRAINT "MaterialReservation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotNumberReservation" ADD CONSTRAINT "LotNumberReservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotNumberReservation" ADD CONSTRAINT "LotNumberReservation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotNumberReservation" ADD CONSTRAINT "LotNumberReservation_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotNumberReservation" ADD CONSTRAINT "LotNumberReservation_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialConsumption" ADD CONSTRAINT "MaterialConsumption_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialConsumption" ADD CONSTRAINT "MaterialConsumption_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialConsumption" ADD CONSTRAINT "MaterialConsumption_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_currentLocationId_fkey" FOREIGN KEY ("currentLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_currentWorkCenterId_fkey" FOREIGN KEY ("currentWorkCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_currentWarehouseId_fkey" FOREIGN KEY ("currentWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_outsourcingPartnerId_fkey" FOREIGN KEY ("outsourcingPartnerId") REFERENCES "BusinessPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_sourceProductionResultId_fkey" FOREIGN KEY ("sourceProductionResultId") REFERENCES "ProductionResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnit" ADD CONSTRAINT "WipUnit_parentWipUnitId_fkey" FOREIGN KEY ("parentWipUnitId") REFERENCES "WipUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_wipUnitId_fkey" FOREIGN KEY ("wipUnitId") REFERENCES "WipUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_fromOperationId_fkey" FOREIGN KEY ("fromOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_toOperationId_fkey" FOREIGN KEY ("toOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_fromWorkCenterId_fkey" FOREIGN KEY ("fromWorkCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_toWorkCenterId_fkey" FOREIGN KEY ("toWorkCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_fromPartnerId_fkey" FOREIGN KEY ("fromPartnerId") REFERENCES "BusinessPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_toPartnerId_fkey" FOREIGN KEY ("toPartnerId") REFERENCES "BusinessPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipMovement" ADD CONSTRAINT "WipMovement_relatedWipUnitId_fkey" FOREIGN KEY ("relatedWipUnitId") REFERENCES "WipUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnitMaterialLot" ADD CONSTRAINT "WipUnitMaterialLot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnitMaterialLot" ADD CONSTRAINT "WipUnitMaterialLot_wipUnitId_fkey" FOREIGN KEY ("wipUnitId") REFERENCES "WipUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnitMaterialLot" ADD CONSTRAINT "WipUnitMaterialLot_workOrderMaterialLotId_fkey" FOREIGN KEY ("workOrderMaterialLotId") REFERENCES "WorkOrderMaterialLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnitMaterialLot" ADD CONSTRAINT "WipUnitMaterialLot_materialItemId_fkey" FOREIGN KEY ("materialItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipUnitMaterialLot" ADD CONSTRAINT "WipUnitMaterialLot_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipHold" ADD CONSTRAINT "WipHold_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipHold" ADD CONSTRAINT "WipHold_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WipHold" ADD CONSTRAINT "WipHold_wipUnitId_fkey" FOREIGN KEY ("wipUnitId") REFERENCES "WipUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionResult" ADD CONSTRAINT "ProductionResult_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionResult" ADD CONSTRAINT "ProductionResult_workOrderOperationAssignmentId_fkey" FOREIGN KEY ("workOrderOperationAssignmentId") REFERENCES "WorkOrderOperationAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionResult" ADD CONSTRAINT "ProductionResult_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "QualityInspection" ADD CONSTRAINT "QualityInspection_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionMeasurement" ADD CONSTRAINT "InspectionMeasurement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionMeasurement" ADD CONSTRAINT "InspectionMeasurement_qualityInspectionId_fkey" FOREIGN KEY ("qualityInspectionId") REFERENCES "QualityInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionMeasurement" ADD CONSTRAINT "InspectionMeasurement_inspectionItemId_fkey" FOREIGN KEY ("inspectionItemId") REFERENCES "InspectionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpcProfile" ADD CONSTRAINT "SpcProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpcProfile" ADD CONSTRAINT "SpcProfile_inspectionItemId_fkey" FOREIGN KEY ("inspectionItemId") REFERENCES "InspectionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpcProfile" ADD CONSTRAINT "SpcProfile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpcProfile" ADD CONSTRAINT "SpcProfile_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecord" ADD CONSTRAINT "DefectRecord_qualityInspectionId_fkey" FOREIGN KEY ("qualityInspectionId") REFERENCES "QualityInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecord" ADD CONSTRAINT "DefectRecord_defectCodeId_fkey" FOREIGN KEY ("defectCodeId") REFERENCES "DefectCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCauseAnalysis" ADD CONSTRAINT "DefectCauseAnalysis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCauseAnalysis" ADD CONSTRAINT "DefectCauseAnalysis_defectRecordId_fkey" FOREIGN KEY ("defectRecordId") REFERENCES "DefectRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCauseAnalysis" ADD CONSTRAINT "DefectCauseAnalysis_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCauseAnalysis" ADD CONSTRAINT "DefectCauseAnalysis_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCorrectiveAction" ADD CONSTRAINT "DefectCorrectiveAction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCorrectiveAction" ADD CONSTRAINT "DefectCorrectiveAction_defectRecordId_fkey" FOREIGN KEY ("defectRecordId") REFERENCES "DefectRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCorrectiveAction" ADD CONSTRAINT "DefectCorrectiveAction_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCorrectiveAction" ADD CONSTRAINT "DefectCorrectiveAction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCorrectiveAction" ADD CONSTRAINT "DefectCorrectiveAction_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecurrencePrevention" ADD CONSTRAINT "DefectRecurrencePrevention_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecurrencePrevention" ADD CONSTRAINT "DefectRecurrencePrevention_defectRecordId_fkey" FOREIGN KEY ("defectRecordId") REFERENCES "DefectRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecurrencePrevention" ADD CONSTRAINT "DefectRecurrencePrevention_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecurrencePrevention" ADD CONSTRAINT "DefectRecurrencePrevention_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecurrencePrevention" ADD CONSTRAINT "DefectRecurrencePrevention_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecurrencePrevention" ADD CONSTRAINT "DefectRecurrencePrevention_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlanItem" ADD CONSTRAINT "ProductionPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlanItem" ADD CONSTRAINT "ProductionPlanItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlanItem" ADD CONSTRAINT "ProductionPlanItem_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BOM"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlanItem" ADD CONSTRAINT "ProductionPlanItem_routingId_fkey" FOREIGN KEY ("routingId") REFERENCES "Routing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlanItem" ADD CONSTRAINT "ProductionPlanItem_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeGroup" ADD CONSTRAINT "CodeGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommonCode" ADD CONSTRAINT "CommonCode_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CodeGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureDependency" ADD CONSTRAINT "FeatureDependency_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "FeatureDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureDependency" ADD CONSTRAINT "FeatureDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "FeatureDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureRequirement" ADD CONSTRAINT "FeatureRequirement_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "FeatureDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantFeature" ADD CONSTRAINT "TenantFeature_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantFeature" ADD CONSTRAINT "TenantFeature_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "FeatureDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdgeGateway" ADD CONSTRAINT "EdgeGateway_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdgeGateway" ADD CONSTRAINT "EdgeGateway_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentConnection" ADD CONSTRAINT "EquipmentConnection_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentConnection" ADD CONSTRAINT "EquipmentConnection_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "EdgeGateway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataTag" ADD CONSTRAINT "DataTag_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "EquipmentConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagSnapshot" ADD CONSTRAINT "TagSnapshot_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "DataTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagCurrentValue" ADD CONSTRAINT "TagCurrentValue_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "DataTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentEvent" ADD CONSTRAINT "EquipmentEvent_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentOrder" ADD CONSTRAINT "ShipmentOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentOrder" ADD CONSTRAINT "ShipmentOrder_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentOrder" ADD CONSTRAINT "ShipmentOrder_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentOrder" ADD CONSTRAINT "ShipmentOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentOrderId_fkey" FOREIGN KEY ("shipmentOrderId") REFERENCES "ShipmentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingInspection" ADD CONSTRAINT "ReceivingInspection_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingInspection" ADD CONSTRAINT "ReceivingInspection_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturnItem" ADD CONSTRAINT "MaterialReturnItem_materialReturnId_fkey" FOREIGN KEY ("materialReturnId") REFERENCES "MaterialReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturnItem" ADD CONSTRAINT "MaterialReturnItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturnItem" ADD CONSTRAINT "MaterialReturnItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturnItem" ADD CONSTRAINT "MaterialReturnItem_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturnItem" ADD CONSTRAINT "MaterialReturnItem_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturnItem" ADD CONSTRAINT "MaterialReturnItem_inventoryTransactionId_fkey" FOREIGN KEY ("inventoryTransactionId") REFERENCES "InventoryTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPrice" ADD CONSTRAINT "ItemPrice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPrice" ADD CONSTRAINT "ItemPrice_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPrice" ADD CONSTRAINT "ItemPrice_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsageLog" ADD CONSTRAINT "AIUsageLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_projectOrderId_fkey" FOREIGN KEY ("projectOrderId") REFERENCES "ProjectOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_sourceRoutingOperationId_fkey" FOREIGN KEY ("sourceRoutingOperationId") REFERENCES "RoutingOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIssue" ADD CONSTRAINT "ProjectIssue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIssue" ADD CONSTRAINT "ProjectIssue_projectOrderId_fkey" FOREIGN KEY ("projectOrderId") REFERENCES "ProjectOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIssue" ADD CONSTRAINT "ProjectIssue_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIssue" ADD CONSTRAINT "ProjectIssue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_projectOrderId_fkey" FOREIGN KEY ("projectOrderId") REFERENCES "ProjectOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPrice" ADD CONSTRAINT "ProjectOrderPrice_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPriceRevision" ADD CONSTRAINT "ProjectOrderPriceRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPriceRevision" ADD CONSTRAINT "ProjectOrderPriceRevision_projectOrderPriceId_fkey" FOREIGN KEY ("projectOrderPriceId") REFERENCES "ProjectOrderPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrderPriceRevision" ADD CONSTRAINT "ProjectOrderPriceRevision_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCost" ADD CONSTRAINT "ItemCost_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCost" ADD CONSTRAINT "ItemCost_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCost" ADD CONSTRAINT "ItemCost_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BOM"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCost" ADD CONSTRAINT "ItemCost_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineeringChange" ADD CONSTRAINT "EngineeringChange_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineeringChange" ADD CONSTRAINT "EngineeringChange_targetItemId_fkey" FOREIGN KEY ("targetItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineeringChange" ADD CONSTRAINT "EngineeringChange_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineeringChange" ADD CONSTRAINT "EngineeringChange_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineeringChangeDetail" ADD CONSTRAINT "EngineeringChangeDetail_engineeringChangeId_fkey" FOREIGN KEY ("engineeringChangeId") REFERENCES "EngineeringChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentProblemType" ADD CONSTRAINT "EquipmentProblemType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRepairRequest" ADD CONSTRAINT "EquipmentRepairRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRepairRequest" ADD CONSTRAINT "EquipmentRepairRequest_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRepairRequest" ADD CONSTRAINT "EquipmentRepairRequest_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRepairRequest" ADD CONSTRAINT "EquipmentRepairRequest_problemTypeId_fkey" FOREIGN KEY ("problemTypeId") REFERENCES "EquipmentProblemType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRepairRequest" ADD CONSTRAINT "EquipmentRepairRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRepairRequest" ADD CONSTRAINT "EquipmentRepairRequest_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentDailyCheck" ADD CONSTRAINT "EquipmentDailyCheck_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentDailyCheck" ADD CONSTRAINT "EquipmentDailyCheck_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentDailyCheck" ADD CONSTRAINT "EquipmentDailyCheck_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentDailyCheck" ADD CONSTRAINT "EquipmentDailyCheck_checkedBy_fkey" FOREIGN KEY ("checkedBy") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentDowntime" ADD CONSTRAINT "EquipmentDowntime_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentDowntime" ADD CONSTRAINT "EquipmentDowntime_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentDowntime" ADD CONSTRAINT "EquipmentDowntime_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentDowntime" ADD CONSTRAINT "EquipmentDowntime_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "CommonCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentDowntime" ADD CONSTRAINT "EquipmentDowntime_equipmentEventId_fkey" FOREIGN KEY ("equipmentEventId") REFERENCES "EquipmentEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentDowntime" ADD CONSTRAINT "EquipmentDowntime_repairRequestId_fkey" FOREIGN KEY ("repairRequestId") REFERENCES "EquipmentRepairRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentDowntime" ADD CONSTRAINT "EquipmentDowntime_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenancePlan" ADD CONSTRAINT "EquipmentMaintenancePlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenancePlan" ADD CONSTRAINT "EquipmentMaintenancePlan_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenancePlan" ADD CONSTRAINT "EquipmentMaintenancePlan_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenancePlan" ADD CONSTRAINT "EquipmentMaintenancePlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenanceHistory" ADD CONSTRAINT "EquipmentMaintenanceHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenanceHistory" ADD CONSTRAINT "EquipmentMaintenanceHistory_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenanceHistory" ADD CONSTRAINT "EquipmentMaintenanceHistory_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenanceHistory" ADD CONSTRAINT "EquipmentMaintenanceHistory_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EquipmentMaintenancePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenanceHistory" ADD CONSTRAINT "EquipmentMaintenanceHistory_performedBy_fkey" FOREIGN KEY ("performedBy") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCredential" ADD CONSTRAINT "UserCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCredential" ADD CONSTRAINT "UserCredential_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginHistory" ADD CONSTRAINT "LoginHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginHistory" ADD CONSTRAINT "LoginHistory_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ncwatch_equipment_mapping" ADD CONSTRAINT "ncwatch_equipment_mapping_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

