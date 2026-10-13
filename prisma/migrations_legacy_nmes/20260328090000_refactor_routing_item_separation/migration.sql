-- Migration: refactor-routing-item-separation
-- Routing 모델에서 itemId/isDefault 제거, code/name 추가
-- ItemRouting 중간 테이블 신설

-- Step 1: Routing 테이블에 새 컬럼을 nullable로 추가 (기존 데이터 보호)
ALTER TABLE "Routing" ADD COLUMN "code" TEXT;
ALTER TABLE "Routing" ADD COLUMN "name" TEXT;

-- Step 2: 기존 Routing 데이터를 기반으로 code/name 채우기
-- code: 기존 itemId + version 기반으로 생성 (예: RTG-{item.code}-v{version})
-- 기존 item 정보를 조인해서 채운다
UPDATE "Routing" r
SET
  "code" = 'RTG-' || i.code || '-V' || replace(r.version, '.', ''),
  "name" = i.name || ' v' || r.version
FROM "Item" i
WHERE i.id = r."itemId";

-- Step 3: ItemRouting 테이블 생성
CREATE TABLE "ItemRouting" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "itemId"    TEXT NOT NULL,
  "routingId" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ItemRouting_pkey" PRIMARY KEY ("id")
);

-- Step 4: 기존 Routing 데이터로 ItemRouting 레코드 생성
INSERT INTO "ItemRouting" ("id", "tenantId", "itemId", "routingId", "isDefault")
SELECT
  'ir-' || r.id,
  r."tenantId",
  r."itemId",
  r.id,
  r."isDefault"
FROM "Routing" r
WHERE r."itemId" IS NOT NULL;

-- Step 5: code/name을 NOT NULL로 변경
ALTER TABLE "Routing" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "Routing" ALTER COLUMN "name" SET NOT NULL;

-- Step 6: 기존 unique 제약 제거
DROP INDEX IF EXISTS "Routing_tenantId_itemId_version_key";

-- Step 7: 새 unique 제약 추가
CREATE UNIQUE INDEX "Routing_tenantId_code_key" ON "Routing"("tenantId", "code");

-- Step 8: itemId 인덱스 제거
DROP INDEX IF EXISTS "Routing_itemId_idx";

-- Step 9: Routing 테이블에서 itemId, isDefault 컬럼 제거
ALTER TABLE "Routing" DROP COLUMN "itemId";
ALTER TABLE "Routing" DROP COLUMN "isDefault";

-- Step 10: ItemRouting 외래키 제약 추가
ALTER TABLE "ItemRouting" ADD CONSTRAINT "ItemRouting_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ItemRouting" ADD CONSTRAINT "ItemRouting_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ItemRouting" ADD CONSTRAINT "ItemRouting_routingId_fkey"
  FOREIGN KEY ("routingId") REFERENCES "Routing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 11: ItemRouting 인덱스/unique 추가
CREATE UNIQUE INDEX "ItemRouting_itemId_routingId_key" ON "ItemRouting"("itemId", "routingId");
CREATE INDEX "ItemRouting_itemId_idx" ON "ItemRouting"("itemId");
CREATE INDEX "ItemRouting_routingId_idx" ON "ItemRouting"("routingId");
