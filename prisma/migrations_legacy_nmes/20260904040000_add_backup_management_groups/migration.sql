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
