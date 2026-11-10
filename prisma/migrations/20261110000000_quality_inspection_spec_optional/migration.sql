-- 검사표준 없이 등록되는 POP 자주검사(불량 실적)를 위해 inspectionSpecId 를 nullable 로 완화한다.
-- 기존 행/FK/인덱스는 그대로 유지되며 데이터 변경 없음.
ALTER TABLE "QualityInspection" ALTER COLUMN "inspectionSpecId" DROP NOT NULL;
