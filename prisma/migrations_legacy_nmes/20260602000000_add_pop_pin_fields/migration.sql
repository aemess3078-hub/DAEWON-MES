ALTER TABLE "SignupRequest"
  ADD COLUMN "popPinHash" TEXT,
  ADD COLUMN "popPinFingerprint" TEXT,
  ADD COLUMN "popPinSetAt" TIMESTAMP(3);

ALTER TABLE "UserCredential"
  ADD COLUMN "popPinHash" TEXT,
  ADD COLUMN "popPinFingerprint" TEXT,
  ADD COLUMN "popPinSetAt" TIMESTAMP(3);

CREATE INDEX "SignupRequest_tenantId_popPinFingerprint_idx"
  ON "SignupRequest"("tenantId", "popPinFingerprint");

CREATE UNIQUE INDEX "UserCredential_tenantId_popPinFingerprint_key"
  ON "UserCredential"("tenantId", "popPinFingerprint");
