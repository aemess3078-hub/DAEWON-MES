-- CreateEnum
CREATE TYPE "ConnectionProtocol" AS ENUM ('OPC_UA', 'MODBUS_TCP', 'MQTT', 'MC_PROTOCOL', 'S7', 'FOCAS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TagDataType" AS ENUM ('BOOL', 'INT', 'FLOAT', 'STRING');

-- CreateEnum
CREATE TYPE "TagCategory" AS ENUM ('PROCESS', 'STATUS', 'ALARM', 'COUNTER', 'QUALITY');

-- CreateEnum
CREATE TYPE "GatewayStatus" AS ENUM ('ONLINE', 'OFFLINE', 'ERROR');

-- CreateEnum
CREATE TYPE "EquipmentEventType" AS ENUM ('RUN', 'STOP', 'ALARM', 'WARNING', 'MAINTENANCE');

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
CREATE INDEX "EquipmentEvent_equipmentId_startedAt_idx" ON "EquipmentEvent"("equipmentId", "startedAt");

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
ALTER TABLE "EquipmentEvent" ADD CONSTRAINT "EquipmentEvent_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
