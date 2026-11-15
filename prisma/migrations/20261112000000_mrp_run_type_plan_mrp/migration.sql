-- 생산계획 MRP 로 구매발주(DRAFT)를 만들 때 근거 실행이력(MrpRun)을 같은 파이프라인으로 저장한다.
-- 기존 CHECK 는 ORDER_MRP 만 허용하므로 PLAN_MRP 를 추가한다(데이터 변경 없음, 기존 행 영향 없음).
ALTER TABLE "MrpRun" DROP CONSTRAINT IF EXISTS "MrpRun_runType_chk";
ALTER TABLE "MrpRun" ADD CONSTRAINT "MrpRun_runType_chk" CHECK ("runType" IN ('ORDER_MRP', 'PLAN_MRP'));
