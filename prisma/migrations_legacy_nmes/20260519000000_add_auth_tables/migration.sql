-- CreateEnum
CREATE TYPE "SignupRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LoginEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAIL', 'LOGOUT');

-- CreateEnum
CREATE TYPE "LoginFailReason" AS ENUM ('USER_NOT_FOUND', 'INVALID_PASSWORD', 'PENDING_APPROVAL', 'HOLD', 'REJECTED', 'INACTIVE', 'LOCKED', 'DELETED');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "department" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "employeeNo" TEXT,
ADD COLUMN "jobTitle" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "ipAddress" TEXT,
ADD COLUMN "userAgent" TEXT,
ADD COLUMN "menuName" TEXT;

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
CREATE TABLE "UserCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
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

-- CreateIndex
CREATE INDEX "SignupRequest_tenantId_idx" ON "SignupRequest"("tenantId");

-- CreateIndex
CREATE INDEX "SignupRequest_status_idx" ON "SignupRequest"("status");

-- CreateIndex
CREATE INDEX "SignupRequest_email_idx" ON "SignupRequest"("email");

-- CreateIndex
CREATE INDEX "SignupRequest_tenantId_loginId_idx" ON "SignupRequest"("tenantId", "loginId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCredential_profileId_key" ON "UserCredential"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCredential_tenantId_loginId_key" ON "UserCredential"("tenantId", "loginId");

-- CreateIndex
CREATE INDEX "UserCredential_tenantId_idx" ON "UserCredential"("tenantId");

-- CreateIndex
CREATE INDEX "LoginHistory_tenantId_idx" ON "LoginHistory"("tenantId");

-- CreateIndex
CREATE INDEX "LoginHistory_profileId_idx" ON "LoginHistory"("profileId");

-- CreateIndex
CREATE INDEX "LoginHistory_loginId_createdAt_idx" ON "LoginHistory"("loginId", "createdAt");

-- AddForeignKey
ALTER TABLE "SignupRequest" ADD CONSTRAINT "SignupRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignupRequest" ADD CONSTRAINT "SignupRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignupRequest" ADD CONSTRAINT "SignupRequest_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCredential" ADD CONSTRAINT "UserCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCredential" ADD CONSTRAINT "UserCredential_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginHistory" ADD CONSTRAINT "LoginHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginHistory" ADD CONSTRAINT "LoginHistory_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
