-- 계측기 검교정관리 기본 권한(INSTRUMENT_CALIBRATION) 보완 — 기존 DB 용 데이터 migration
--
-- 배경: 20261029000000 migration 이 테이블만 만들었고, 권한 행은 사용자관리 화면(ensurePermissionMatrix)이나 seed 로만 생겼다.
--       이미 구축된 DB 는 이 migration 으로 사용자관리 화면 진입 없이 기본 권한이 채워진다.
--       신규(빈) DB 는 Tenant 가 아직 없으므로 아무 행도 만들지 않고, seed 가 같은 기본값(src/lib/auth/permission-catalog.ts)을 만든다.
--
-- 안전성: INSERT 만 한다. 이미 저장된 행(허용/차단 모두)은 ON CONFLICT DO NOTHING 으로 덮어쓰지 않고, 삭제/갱신은 없다. 반복 실행해도 중복이 없다.
-- 기본값(permission-catalog.ts 와 같아야 한다 — scripts/test-calibration-permissions.ts 가 불일치를 검사한다):
--   OWNER/ADMIN: READ CREATE UPDATE DELETE APPROVE EXPORT / MANAGER: READ CREATE UPDATE EXPORT / OPERATOR, VIEWER: READ
-- 롤백: DELETE FROM "RolePermission" WHERE "resource" = 'INSTRUMENT_CALIBRATION';  (앱은 행이 없으면 쓰기를 허용하지 않고 조회만 허용한다)

INSERT INTO "RolePermission" ("id", "tenantId", "role", "resource", "action", "isAllowed", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."id", d.role::"UserRole", 'INSTRUMENT_CALIBRATION', d.action::"PermissionAction", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN (VALUES
  ('OWNER', 'READ'), ('OWNER', 'CREATE'), ('OWNER', 'UPDATE'), ('OWNER', 'DELETE'), ('OWNER', 'APPROVE'), ('OWNER', 'EXPORT'),
  ('ADMIN', 'READ'), ('ADMIN', 'CREATE'), ('ADMIN', 'UPDATE'), ('ADMIN', 'DELETE'), ('ADMIN', 'APPROVE'), ('ADMIN', 'EXPORT'),
  ('MANAGER', 'READ'), ('MANAGER', 'CREATE'), ('MANAGER', 'UPDATE'), ('MANAGER', 'EXPORT'),
  ('OPERATOR', 'READ'),
  ('VIEWER', 'READ')
) AS d(role, action)
ON CONFLICT ("tenantId", "role", "resource", "action") DO NOTHING;
