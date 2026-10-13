-- F16: 설비 비가동 이력과 예방점검 계획/실시 이력 정본화

CREATE TYPE "EquipmentDowntimeKind" AS ENUM ('PLANNED', 'UNPLANNED');
CREATE TYPE "PreventiveMaintenanceCycleUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');

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

CREATE UNIQUE INDEX "EquipmentDowntime_equipmentEventId_key" ON "EquipmentDowntime"("equipmentEventId");
CREATE INDEX "EquipmentDowntime_tenantId_startedAt_idx" ON "EquipmentDowntime"("tenantId", "startedAt");
CREATE INDEX "EquipmentDowntime_equipmentId_startedAt_idx" ON "EquipmentDowntime"("equipmentId", "startedAt");
CREATE INDEX "EquipmentDowntime_reasonId_idx" ON "EquipmentDowntime"("reasonId");
CREATE INDEX "EquipmentDowntime_repairRequestId_idx" ON "EquipmentDowntime"("repairRequestId");

CREATE INDEX "EquipmentMaintenancePlan_tenantId_nextDueAt_idx" ON "EquipmentMaintenancePlan"("tenantId", "nextDueAt");
CREATE INDEX "EquipmentMaintenancePlan_equipmentId_nextDueAt_idx" ON "EquipmentMaintenancePlan"("equipmentId", "nextDueAt");

CREATE UNIQUE INDEX "EquipmentMaintenanceHistory_planId_scheduledAt_key" ON "EquipmentMaintenanceHistory"("planId", "scheduledAt");
CREATE INDEX "EquipmentMaintenanceHistory_tenantId_completedAt_idx" ON "EquipmentMaintenanceHistory"("tenantId", "completedAt");
CREATE INDEX "EquipmentMaintenanceHistory_equipmentId_completedAt_idx" ON "EquipmentMaintenanceHistory"("equipmentId", "completedAt");

ALTER TABLE "EquipmentDowntime" ADD CONSTRAINT "EquipmentDowntime_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentDowntime" ADD CONSTRAINT "EquipmentDowntime_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentDowntime" ADD CONSTRAINT "EquipmentDowntime_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentDowntime" ADD CONSTRAINT "EquipmentDowntime_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "CommonCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentDowntime" ADD CONSTRAINT "EquipmentDowntime_equipmentEventId_fkey" FOREIGN KEY ("equipmentEventId") REFERENCES "EquipmentEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EquipmentDowntime" ADD CONSTRAINT "EquipmentDowntime_repairRequestId_fkey" FOREIGN KEY ("repairRequestId") REFERENCES "EquipmentRepairRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EquipmentDowntime" ADD CONSTRAINT "EquipmentDowntime_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EquipmentMaintenancePlan" ADD CONSTRAINT "EquipmentMaintenancePlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentMaintenancePlan" ADD CONSTRAINT "EquipmentMaintenancePlan_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentMaintenancePlan" ADD CONSTRAINT "EquipmentMaintenancePlan_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentMaintenancePlan" ADD CONSTRAINT "EquipmentMaintenancePlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EquipmentMaintenanceHistory" ADD CONSTRAINT "EquipmentMaintenanceHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentMaintenanceHistory" ADD CONSTRAINT "EquipmentMaintenanceHistory_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentMaintenanceHistory" ADD CONSTRAINT "EquipmentMaintenanceHistory_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentMaintenanceHistory" ADD CONSTRAINT "EquipmentMaintenanceHistory_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EquipmentMaintenancePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentMaintenanceHistory" ADD CONSTRAINT "EquipmentMaintenanceHistory_performedBy_fkey" FOREIGN KEY ("performedBy") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
