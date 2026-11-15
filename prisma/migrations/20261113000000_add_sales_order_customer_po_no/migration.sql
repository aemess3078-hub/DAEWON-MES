-- 수주에 거래처(고객사) 발주번호 추가. nullable·기본값 없음 → 기존 수주 행은 NULL 로 유지(데이터 변경 없음, 롤백은 컬럼·인덱스 DROP).
-- 문자열(TEXT)이라 앞자리 0·영문 조합이 보존된다. UNIQUE 는 두지 않는다(분할 납품 등 정상 중복 가능).
ALTER TABLE "SalesOrder" ADD COLUMN "customerPoNo" TEXT;

CREATE INDEX "SalesOrder_tenantId_customerId_customerPoNo_idx" ON "SalesOrder"("tenantId", "customerId", "customerPoNo");
