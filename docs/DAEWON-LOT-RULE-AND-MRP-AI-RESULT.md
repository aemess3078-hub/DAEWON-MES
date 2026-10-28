# 대원정밀 LOT 자동채번 연결 및 MRP AI 제거 결과

기준: `feat/daewon-fg-shipping-qr` (HEAD 1b5b150 위 로컬 커밋, push/PR/병합/배포 없음). 검증일 2026-10-28.

## 1. 문제 A — LOT 채번 오류의 실제 원인

- 번호 규칙 관리 화면은 `NumberingRule`(type=LOT)에 저장하지만, 입고 자동 채번(`computeNextMaterialReceiptLotNo` → `generateCnsMaterialReceiptLotNo` → `resolveCnsLotRule`)은 **CNS 전용 규칙 모듈만** 쓰고 `NumberingRule` 을 한 번도 조회하지 않았다.
- `resolveCnsLotRule` 은 `lot-brand-guard`(`NEXT_PUBLIC_BRAND !== "newmes"`)로 모든 비수동 품목을 차단 → 저장 여부와 무관하게 "대원정밀 LOT 채번 규칙이 설정되지 않았습니다" 오류.
- 실제 DB(aquqetajewvhyirmewfy / daewon-001) 확인: 규칙은 정상 저장됨 — `ITEM_CODE · YY · MM · "-" · SEQ(3)`, `isActive=true`. `NumberingSequence` 는 0행(한 번도 사용 안 됨). 품목 431개 전부 `DEFAULT/ALLOWED`(LOT 관리 5개). 즉 저장 실패가 아니라 **연결 누락**이었다.
- 별개의 이중 구조: LOT 등록 화면의 `generateNumber` 는 `NumberingSequence` 카운터를 증가시켜(클릭마다 소비) 입고/예약이 쓰는 `Lot ∪ LotNumberReservation` 원장과 순번이 달라 중복·불일치 위험이 있었다.

## 2. 수정 내용 (LOT)

- 신규 `src/lib/lot-numbering/tenant-lot-rule.ts`: 저장된 활성 규칙의 토큰 순서대로 번호를 만든다(하드코딩 없음). 순번 토큰 앞(stem)·뒤(suffix)가 같은 번호끼리 한 계열 → 품목코드·연월이 stem 에 있으면 품목별·월별 001 시작. 순번은 **`Lot` ∪ `LotNumberReservation`(모든 상태) 최대값 + 1** 이므로 입고/예약/완제품/LOT 등록이 같은 원장을 본다. 미리보기는 순번을 소비하지 않는다. 날짜는 KST. 품목코드는 서버의 품목 데이터에서만 가져온다(클라이언트 값 무시). 규칙 없음/비활성/순번 토큰 오류/자릿수 초과/품목코드 누락/MANUAL·CNS 전용 방식 품목은 명확한 안내 오류.
- 연결 지점: `computeNextMaterialReceiptLotNo`(원자재 입고 AUTO·예약·`generateReceivingLotNo`·`generateLotNo` 공통), `createFinishedGoodsLot`(제조번호 없는 완제품 LOT, 직렬화 advisory lock 옵션), `generateNumber`(LOT 등록 화면, 대원정밀에서만 원장 기반 — NMES 경로는 기존 유지). 결과 메시지가 프로덕션에서 지워지지 않도록 LOT 등록 시트는 결과 객체를 돌려주는 `generateLotNumberForItem` 사용.
- 규칙 저장 시 LOT 규칙은 순번 토큰이 정확히 1개여야 저장된다.
- 예약·확정·취소·재시도 정책은 그대로(취소 시 미출력은 행 삭제→번호 재사용, 출력 후는 RELEASED→영구 제외, 멱등 requestId).
- 유지/분리: CNS 규칙은 대원정밀에 적용되지 않음(`resolveCnsLotRule` 가드·`NEXT_PUBLIC_BRAND` 불변). **제조번호는 LOT 규칙을 쓰지 않고 계속 직접 입력**(별도 안내 문구 `DAEWON_MANUFACTURING_NO_RULE_NOT_CONFIGURED_MESSAGE`). 재고·수불·WIP·생산실적 로직 무변경.
- 입고 화면의 CNS 예시 문구(`26A01-1`)는 대원정밀에서 중립 문구로 변경.

## 3. 문제 B — MRP AI 제거

- 삭제: `ai-suggestion-panel.tsx`, `mrp-ai.service.ts`, 서버 액션 `getAISuggestion`(UI 숨김이 아니라 서버 진입점 자체 제거 → 직접 호출 불가, OpenAI 호출 경로 없음). `mrp-dashboard`/`mrp-tabs` 의 AI 패널·문구·미사용 핸들러 제거.
- 보존: 공통 `openai.service.ts`, 전역 AI 어시스턴트(`ai-chat`, 개발자 전용 범위 가드 적용 중), 규칙 기반 발주제안, MRP 계산식(변경 없음).

## 4. 테스트 결과

| 항목 | 결과 |
|---|---|
| `tsc --noEmit` | 통과 |
| `next lint` | 오류 0 (기존 경고 1건: problem-type-form-sheet) |
| `check:server-actions` | 87개 파일 통과 |
| `next build` | 성공 |
| 신규 단위 `test-daewon-lot-rule.ts` | 43 통과 |
| 실제 DB `db-it/09-lot-rule.ts` | 29 통과 / 0 실패 |
| 실제 DB `db-it/10-mrp-regression.ts` | 13 통과 / 0 실패 |
| 기존 스크립트 일괄(브라우저·실DB 전용 10개 제외, 62개 실행) | 최초 53 통과·9 실패 → I6 수정 후 54 통과·8 실패(8개는 기준 커밋과 동일) |

실패 9개 중 **8개는 기준 커밋(1b5b150)에서도 동일하게 실패**(기존 문제: `test-bom-material-sufficiency`·`test-production-plan-workorder-integrity`(없는 `test-production-plan-sales-link.ts` 참조), `corrective-action`, `defect-cause-analysis`, `f25-master-menu-cleanup`, `inventory-concurrency`, `pop-tool-usage`, `report-output`). 나머지 1개(`test-material-issue-integrity` I6)는 이번 정책 변경(대원정밀 가드 → 저장 규칙)에 맞춰 테스트를 수정해 통과. 정책 변경에 맞춰 수정한 기존 테스트: `test-lot-number-security`, `test-lot-read-security`, `test-lot-tenant-isolation`(NMES 경로로 명시), `test-daewon-stabilization-phase1`, `test-label-types`, `test-material-issue-integrity`. CNS 보호 테스트(C1~C4, 7b 등)는 유지.

실제 DB 검증(09): 저장 규칙 조회 / DW-7 → `DW-72610-001`(요구 예시) / 같은 품목 연속·다른 품목 별도 순번 / 미리보기 순번 비소비 / 예약 순차·취소 재사용·출력 후 영구 제외 / 예약 확정(CONSUMED) / 예약 없는 AUTO 입고 / 멱등 재전송 / 수동 LOT / 동시 AUTO 입고 4건·동시 예약 5건·동시 완제품 LOT 4건 중복 없음 / 기존 LOT 선점 시 다음 번호 / LOT 등록 화면(서버 품목코드, 권한·비로그인 거부) / 규칙 없음·비활성·깨진 규칙 안내(트랜잭션 롤백, 사용자 규칙 불변) / 제조번호 계속 차단 / CNS 형식 번호 없음.
MRP(10): AI 액션·파일·참조 0, 외부 AI fetch 0건, 생산계획 MRP(BOM 전개 20/10)·결품 상태·수주기준 MRP·규칙 기반 발주제안·시뮬레이션·실행이력·발주서 생성 정상.

## 5. 남은 위험·참고 (직접 장애와 무관한 것은 미수정)

- **(중) 같은 발주품목 동시 입고 / 일 단위 직렬화**: 입고 거래번호 advisory lock(테넌트·일자)과 발주품목 행 잠금 때문에 동시 입고는 직렬화되고, 원격 DB 지연에서는 5초 트랜잭션 제한으로 일부가 UNKNOWN 이 된다(수동 LOT 입고도 동일, 기준 커밋과 동일 동작 확인 — 같은 requestId 재전송으로 복구 확인). 현장 동일 리전 지연에서 재측정 권장.
- (저) 동시 예약 시 충돌 재시도로 순번에 공백이 생길 수 있음(중복은 없음).
- (저) `createLot`(수동 등록)은 다른 발주품목이 예약 중인 번호를 막지 않는다(입고의 수동 경로는 막음) — 기존 동작.
- (저) 완제품 LOT 는 동일 (tenant, stem) 직렬화 lock 을 외곽 트랜잭션 종료까지 유지한다.
- 품목에 CNS 전용 LOT 방식(RAW_DATE_SEQ/PREFIX_MONTH_SEQ)이 설정되면 대원정밀에서는 자동 발행 대신 안내 오류(현재 해당 품목 없음).
- 브라우저 화면(실제 클릭) 검증은 이번에 하지 않았다. 문구/분기는 소스·단위 테스트로만 확인.

## 6. 실제 DB에 남은 테스트 데이터 (삭제하지 않음)

- LOT: `ZT5-RM-A/B`·`ZT5-FG-A` 접두 LOT 및 `ZT6-MAN-*`, 예약 행(CONSUMED/RELEASED), 발주 `ZT6-PO-*`(수량 소량 입고), 생산계획 `ZT6-PP-*`.
- 일반 발주 3건 `PO-MRP-1793153737549`, `PO-MRP-1793153809141`, `PO-MRP-1793153862008`(각각 품목 ZT5-RM-A 7개, 10번 스크립트 반복 실행으로 생성된 MRP 발주서 생성 테스트).
- ZT5 테스트 BOM(`ZT5-1`)을 Default 로 지정(생산계획 MRP 가 Default BOM 만 전개).
- 사용자가 저장한 번호 규칙(`NumberingRule` LOT)은 변경하지 않았다.
