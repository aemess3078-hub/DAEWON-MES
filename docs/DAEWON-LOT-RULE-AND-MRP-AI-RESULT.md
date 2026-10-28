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

---

# 최종 안정화 (2차 검토)

## 7. 예약 번호 ↔ 수동 LOT 등록 충돌 (실제 결함 확인 후 최소 수정)

시나리오: ① 입고 화면에서 번호 예약(RESERVED) → ② 다른 사용자가 LOT 관리 화면에서 같은 번호를 수동 등록 → ③ 원래 사용자가 예약 번호로 입고 확정.

수정 전 실제 DB 재현(`db-it/11-reservation-conflict.ts`): 4개 항목 실패.
- DB 제약은 `Lot`(tenantId, lotNo)와 `LotNumberReservation`(tenantId, lotNo)이 **각자** unique 일 뿐 서로를 막지 않는다.
- `createLot` 은 `Lot` 만 검사했다 → **예약 중인 번호를 수동 등록할 수 있었다**(같은 품목·다른 품목 모두).
- 입고 확정(RESERVED 모드)은 같은 품목의 기존 Lot 가 있으면 **그 LOT 에 조용히 합쳐** 입고했다(수동 등록한 LOT 의 이력/재고와 섞임). 다른 품목이면 "다른 품목에 이미 사용 중" 오류로 이미 라벨을 출력한 예약이 무효가 됐다.

최소 수정(예약 상태 정책·업무 흐름 변경 없음):
1. `createLot`: 미만료 `RESERVED` 예약이 있는 번호는 거부("입고 화면에서 자동채번 예약 중입니다"). 만료된 예약은 막지 않는다 — 입고의 수동 입력 경로(4-0-B)와 같은 정책.
2. 입고 확정(RESERVED 모드): 예약 번호의 Lot 가 이미 있으면 합치지 않고 중단(경쟁 상태 방어, 예약은 RESERVED 로 유지되어 재채번 안내).

수정 후: 실제 DB 7/7 통과(거부·Lot 미생성·원래 입고 정상 확정·만료 예약 허용·경쟁 시 재고 0/예약 유지·기존 중복 검증 유지). 남은 한계: `createLot` 의 검사와 생성 사이의 극히 짧은 경쟁은 스키마 변경(예약-Lot 교차 unique) 없이는 완전히 막을 수 없다 — 위 2번 방어로 데이터 합쳐짐은 방지된다. 입고 확정 트랜잭션 지문(`RECEIVING_TX_BASELINE_FINGERPRINT`)은 이 4줄 추가 때문에 의도적으로 갱신했고 사유를 주석에 남겼다.

## 8. 기존 테스트 실패 8건 (기준 커밋 1b5b150 과 동일, 신규 실패 없음)

기준 커밋 worktree 와 현재 트리에서 같은 스크립트를 실행해 오류 메시지·통과 수를 비교했다. **8건 모두 두 쪽이 동일**하다.

| # | 스크립트 | 실패 내용 | 업무 영향 | 향후 조치 |
|---|---|---|---|---|
| 1 | test-bom-material-sufficiency | 존재하지 않는 `scripts/test-production-plan-sales-link.ts` 를 읽다 ENOENT (통과 18건 후 중단) | 없음(테스트가 삭제된 파일 참조) | 참조 갱신/삭제된 테스트 복원 |
| 2 | test-production-plan-workorder-integrity | 위와 같은 ENOENT + 소스 패턴 2건 불일치(계획 상태 동기화 문구) | 낮음(테스트 낡음, 계획 상태 로직 재확인 권장) | 소스 구조 변경에 맞춰 테스트 갱신 |
| 3 | test-corrective-action | T21: deleteQualityInspection 의 삭제 순서 소스 패턴 불일치 | 낮음~중간(품질 시정조치 삭제 참조무결성 — 대원정밀 범위 밖 화면) | 로직 확인 후 테스트 또는 코드 정리 |
| 4 | test-defect-cause-analysis | C16/C17: 삭제 전 tenant 소속 확인 소스 패턴 불일치 | 낮음~중간(테넌트 격리 — 범위 밖 화면) | 실제 코드의 소유권 검사 위치 확인 필요 |
| 5 | test-report-output | T18: getQualityReport 소스 패턴 불일치 | 낮음(보고서, 범위 밖) | 테스트 갱신 |
| 6 | test-f25-master-menu-cleanup-integrity | nav 라벨 기대 "불량관리" vs 실제 "불량코드관리" | 없음(라벨 변경 후 테스트 미갱신) | 기대값 갱신 |
| 7 | test-pop-tool-usage-integrity | `next/headers` 목(mock) 누락 (통과 21건 후 중단) | 없음(하니스 문제) | 목 추가 |
| 8 | test-inventory-concurrency-integrity | DATABASE_URL 없이 실행되는 실DB 테스트 | 해당 없음(재고 동시성은 `db-it/05` 로 대체 검증, 통과) | 환경변수 안내/실행 가드 추가 |

실패를 숨기기 위해 테스트를 삭제·비활성화하지 않았다. 3·4번은 이번 변경과 무관하지만 테넌트 격리·참조무결성을 다루므로 **별도 점검 대상**으로 기록한다.

## 9. 실제 DB 영향 확인 (읽기 전용 `db-it/12-data-impact.ts`)

- `NumberingRule`(LOT) 원본 그대로: id·updatedAt(2026-10-28T01:22:40Z)·토큰·활성 상태 동일, `NumberingSequence` 0건.
- 비-ZT 품목 427개 그대로, 기준 시각 이후 수정된 비-ZT 품목/재고 행/수불 0건, 비-ZT 품목의 LOT 생성 0건, 비-ZT BOM 라인 변경 0건, 비-ZT 작업지시 0건. 설비 수집 이벤트 2,064건 정상 유지(최근 수신 확인).
- BOM: 변경된 것은 `ZT5-1`(ZT5-FG-A, 테스트 데이터) 의 `isDefault=true` 뿐이며 Default 는 1개.
- ZT 접두어 없는 발주서: `PO-MRP-…` 4건(최종 검증 중 1건 추가: 1793153737549, 1793153809141, 1793153862008, 1793157020796)은 모두 상태 DRAFT, 라인은 `ZT5-RM-A` 7개 1줄뿐. `ZT6-PO-*`(PARTIAL_RECEIVED), `ZT6-PP-*` 계획, LOT/예약(CONSUMED·RELEASED·RESERVED)은 전부 ZT 품목에만 연결.
- 스테이지 5 스크립트(03·04) 재실행으로 ZT5-FG-A 작업지시 51건(제조번호 ZT5-*)이 추가 생성됐다. 주문번호 `WO-2026-nnn`/출하 `SH-2026-nnn` 은 시스템 채번이라 ZT 접두어가 없고 채번 시퀀스를 소모했다(스테이지 5에서도 동일). 비-ZT 품목 작업지시는 0건.
- 테스트 데이터는 이번 단계에서 삭제하지 않았다. DB 초기화·migrate reset 없음.

## 10. 최종 검증 결과 (2차)

| 항목 | 결과 |
|---|---|
| tsc / lint / check:server-actions | 통과 / 오류 0(기존 경고 1) / 87개 통과 |
| production build | 성공 |
| 단위·소스 스크립트(브라우저·실DB 제외) | 54 통과, 7 실패(위 표 1~7번, 기준과 동일), 8번은 DB 환경 필요로 제외 |
| 신규 단위 `test-daewon-lot-rule` | 43 통과 |
| 실DB `09-lot-rule` / `10-mrp-regression` / `11-reservation-conflict` | 29/0, 13/0, 7/0 |
| 실DB `03-wip-pop`(WIP·POP QR) | 23 통과 / 0 실패 |
| 실DB `05-issue-concurrency`(출고 동시성) | 재실행 9 통과 / 0 실패 (첫 실행은 원격 DB 지연 시간 초과로 1건 실패) |
| 실DB `02-raw-material` | 14 통과 / 2 실패(R3·R4): 스크립트가 "DB 에 이 스크립트가 만든 LOT/수불만 있다"고 가정해 반복 실행(스테이지 5 및 이번 테스트 데이터 누적) 시 깨지는 비멱등 검사. 입고·멱등·출고 단계는 통과 |
| 실DB `04-fg-shipment`(완제품 출하 QR) | 실패 0건이나 원격 지연으로 인터랙티브 트랜잭션 5초 제한에 걸려 중간 종료(rc=1). **기준 커밋에서도 동일하게 중단**(실패 1·시간 초과 4) → 이번 변경과 무관, 현장 동일 리전에서 재측정 권장 |
| 브라우저 실화면 테스트(06·07 등) | 서버 기동이 필요해 이번에는 실행하지 않음 |

신규 회귀: 없음. 02·04·05 의 실패/중단은 원격 DB 지연과 테스트 데이터 누적 때문이며, 해당 코드(`material-issue.actions` 등)는 이번에 수정하지 않았다.

## 11. 남은 개선사항

1. 위 8번 표의 낡은/환경 의존 테스트 정리(특히 3·4번 품질 모듈의 테넌트 격리 확인).
2. `db-it/02` 의 반복 실행 안전화(자기 데이터만 조회하도록).
3. 입고 동시성: 일자별 거래번호 advisory lock + 5초 트랜잭션 제한 — 현장 리전에서 재측정 후 필요하면 트랜잭션 timeout 조정 검토.
4. 예약-Lot 교차 unique(스키마) 또는 `createLot` 의 트랜잭션화로 남은 극소 경쟁 구간 제거(필요 시).
5. 브라우저 실화면(LOT 등록·입고·MRP) 수동/자동 검증.
