-- Supabase public 스키마 하드닝
--
-- Supabase 는 public 스키마의 기본 권한(default privileges)으로 새 테이블에 anon/authenticated 의
-- 전체 권한을 자동 부여한다. RLS 가 꺼져 있으면 공개된 anon key 만으로 PostgREST(/rest/v1)를 통해
-- UserCredential 등 모든 테이블을 읽고/쓸 수 있다.
--
-- DAEWON-MES 는 Prisma(DB 직접 연결, 테이블 소유자 postgres)와 서버 전용 service_role 로만 접근하며
-- anon/authenticated 로 DB 에 접근하지 않는다. 따라서:
--   1) 이후 생성될 public 객체의 기본 권한에서 anon/authenticated 를 제거하고
--   2) 이미 만들어진 테이블/시퀀스/함수의 권한을 회수하고
--   3) 모든 public 테이블에 RLS 를 켠다(정책 없음 = anon/authenticated 거부, 소유자/service_role 은 영향 없음).
-- service_role / postgres 권한과 Supabase 관리 스키마(auth, storage 등)는 변경하지 않는다.

DO $$
DECLARE
  r record;
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      -- 1) 이후 생성 객체의 기본 권한 제거 (현재 실행 롤 = 테이블 소유자 기준)
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', role_name);
      -- 2) 기존 객체 권한 회수
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);
    END IF;
  END LOOP;

  -- 3) 모든 public 테이블에 RLS 활성화
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
