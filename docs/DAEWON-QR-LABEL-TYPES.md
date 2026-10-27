# 대원정밀 MES — QR 라벨 3종 (1단계: 디자인·출력 기능)

기준: `origin/main` 1f5dd74 (PR #7 병합 후). 브랜치 `feat/daewon-qr-label-types` (**미커밋**). 스캐너·업무 화면 연동은 이번 단계에서 제외. 실제 프린터 출력은 하지 않았고 Chrome 인쇄 미리보기(PDF)로 방향·잘림만 확인했다.

## 라벨 용지 / 인쇄 설정
- 디자인 기준 **90×29mm 가로**. 인쇄 설정은 용지 **29×90mm 또는 사용자 정의 90×29mm**, 배율 **100%**, 여백 **없음**(`@page { size: 90mm 29mm; margin: 0 }`).
- 29×90 세로 용지로만 인식되면 `/label-print` 의 [용지 방향]을 *세로 29×90mm* 로 바꾼다(라벨 면을 90° 회전, 미리보기로 검증).

## 3종
| 종류 | QR (식별값만) | 인쇄 내용 | 비고 |
|---|---|---|---|
| 원자재 LOT (`RAW_LOT`) | `DAEWON|LOT|1|<LOT 번호>` | 유형칩 · 품목명 · 품목코드(+규격) · LOT · 수량 · 입고일 | 기존 LOT QR 재사용 |
| 공정·재공 WIP (`WIP`) | `DAEWON|WIP|1|<WIP 식별값>` | 유형칩 · 품목명 · 품목코드+작업지시 · WIP 식별값 · 제조번호 · 발행일 | **수량·공정·상태 인쇄 안 함**(MES 조회). 최초 발행 후 모든 공정 재사용 |
| 완제품 LOT (`FG_LOT`) | `DAEWON|LOT|1|<LOT 번호>` | 유형칩 · 품목명 · 품목코드 · LOT · 수량 · 생산일 | 원자재와 같은 LOT QR (품목 유형은 MES 조회로 구분) |

출하·공정이동 전용 라벨/QR 은 정의하지 않았다(`BATCH` 등 미정의 종류는 파서가 거부).

## 코드
- `lib/qr/lot-qr.ts`: `encodeWipQr` / `parseWipQr` / `parseDaewonQr` 추가(기존 LOT 함수·`classifyScanInput` 불변, LOT 파서는 WIP QR 을 거부).
- `lib/label/label-spec.ts`: `LabelType`, `WIP_QR`, 3종 레이아웃(29mm 높이 자동 맞춤), 출력 가능 규칙(식별값 없으면 QR 없이 출력 불가, 유형/QR 불일치 거부, 시험용 `TEST-` 값만).
- `components/common/barcode/barcode-label.tsx`, `barcode-print-dialog.tsx`: 3종 렌더 / WIP 발행 흐름(사전확인 → 감사, 재발행 사유).
- `lib/actions/wip-label.actions.ts`: WIP 발행 게이트·감사(`WipLabel`, `WIP_LABEL_ISSUE|REISSUE`) — 읽기 + AuditLog 만.
- `/label-print/samples`: 시험용 3종 샘플 미리보기·인쇄(서버/DB 무관). 샘플 이미지 `docs/qr-label-samples/types/`. **개발·점검용이라 운영 빌드에서는 기본 404** (production build 로 브라우저 테스트를 돌릴 때만 서버에 `ENABLE_QR_DEV_PAGES=true`, `next dev` 에서는 항상 열림 — `src/lib/dev-pages.ts`). 실제 라벨 출력 경로 `/label-print` 는 이 제한과 무관하다.

## 결정이 필요한 사항 (임의 확정하지 않음)
1. **WIP 식별값**: 현재 코드는 `WipUnit.id`(cuid, 불변·tenant 내 유일)를 *제안값*으로 가정. 사람이 읽는 WIP 번호 체계를 따로 둘지(신규 컬럼/채번) 결정 필요. 제조번호(`manufacturingNo`)는 작업지시 단위라 WIP 별 고유값이 아님(분할/불량/재작업 자식 WIP 과 공유).
2. **WIP 라벨 부착 대상/시점**: 1 작업지시 = 1 WipUnit(첫 자재출고 시 생성)이며 분할·불량·재작업 시 자식 WipUnit 이 생긴다. 자식 WIP 에 새 라벨을 발행할지, 로트/용기 단위 라벨이 필요한지 현장 운영 확인 필요.
3. **WIP 발행 불가 상태**: 현재 SCRAPPED 만 차단. COMPLETED/OUTSOURCED 등 허용 범위 확정 필요.
4. **원자재 라벨 추가 항목**: 공급사·공급사 LOT·유효기간·검사 상태 표시 여부(현재 규격만 선택 표시).
5. **LOT 번호 규칙**: 미확정(대원정밀 자동채번 가드). 이번 단계는 입력된 LOT 번호를 그대로 QR 에 담음.
6. **실제 용지**: DK-11201 등 29×90mm 절취 라벨의 비인쇄 여백, Android Brother Print Service Plugin 의 사용자 정의 용지 처리는 실물 확인 필요.
7. **업무 화면 연동(다음 단계)**: 입고/완제품입고 화면은 현재 유형 미지정(기존 LOT 라벨 모양). 원자재/완제품 유형 칩 적용과 WIP 라벨 발행 화면(자재출고 시 WIP 생성 직후 등)은 연동 단계에서 결정.

## 안정화 (WIP 인쇄 요청 이력)

**이력의 의미**: 감사 이력은 "라벨 인쇄 **요청** 이력"이다. 브라우저는 실제 프린터 출력 완료를 알 수 없어, 인쇄창 취소·프린터 오류가 나도 이력은 남는다(출력 완료 확인 기능은 범위 밖). 그래서 이미 요청 이력이 있는 WIP 의 두 번째 요청부터는 사유(이전 인쇄 취소·실패, 분실·훼손 등)를 받아 `WIP_LABEL_REISSUE`(재요청)로 기록한다. 최초는 `WIP_LABEL_ISSUE`. 화면 문구도 "인쇄 요청"으로 통일했고 "출력/발행 완료"로 오해될 표현은 쓰지 않는다. 기존 LOT 라벨 이력 동작은 변경하지 않았다.

**동시성** (`recordWipLabelPrint`): 하나의 `prisma.$transaction` 안에서 ① 요청한 WipUnit 행을 tenant 조건과 함께 id 정렬 순서로 `SELECT … FOR UPDATE`(저장소 관례, `pop.actions.ts` 와 동일) → ② 잠금 이후 최신 이력으로 최초/재요청 판정 → ③ 같은 트랜잭션에서 AuditLog 기록. 같은 WIP 의 동시 요청은 잠금에서 직렬화되어 최초는 1건뿐이고 횟수는 중복·역전 없이 증가한다. 서로 다른 WIP 은 다른 행을 잠가 서로 기다리지 않는다. 다중 WIP 요청은 전부 기록되거나 전혀 기록되지 않는다(롤백). 잠금 대기 5초(`lock_timeout`), 트랜잭션 15초 제한, 실패 시 사용자용 메시지만 노출. `checkWipLabelPrintable` 은 화면용 사전 확인(잠금 없음)이고 권위 있는 판정은 기록 함수가 한다. 스키마/마이그레이션 변경 없음.

**검증 범위**
- 가짜 DB(`scripts/test-label-types.tsx`, 커밋 전 쓰기 비가시·행 잠금 대기·롤백 모사): 최초/사유 없는 재요청/사유 있는 재요청, 동일 WIP 동시 최초 2건(최초 1건만 기록), 동시 재요청(횟수 1·2·3·4), 서로 다른 WIP 동시(직렬화 안 됨), 겹치는 다중 WIP(교착 없음), 롤백·잠금 해제, 잠금 제거 대조 실험(중복 재현).
- **실제 PostgreSQL 에서만 확인 가능**: `FOR UPDATE` 잠금 의미와 대기/해제 타이밍, `set_config('lock_timeout')` 와 `$queryRaw` 의 파라미터 바인딩 동작, Prisma 트랜잭션 타임아웃·연결 풀 고갈, 실제 교착 감지, 업무 트랜잭션(공정 진행 등)과의 WipUnit 행 잠금 경합, `READ COMMITTED` 에서 잠금 이후 재조회가 다른 트랜잭션의 커밋을 보는지.

## 2단계: 업무 화면 연동

| 라벨 | 업무 화면 | 버튼 위치 | 출력 데이터 조회 경로 |
|---|---|---|---|
| 원자재 LOT (RAW_LOT 칩) | 자재입고(`material-receipt` → `receiving-form-dialog.tsx`) | 입고 확정(`runReceivingBatch` 성공) 직후 라벨 창이 열리고, 확정 전에는 [LOT 라벨 미리보기](미리보기 전용) | 화면에 입력·확정된 LOT 번호/수량(기존) + 서버 영속화 확인(`checkLotLabelPrintable`) |
| 공정·재공 WIP (WIP 칩) | 자재출고(`material-issue`) 목록의 **출고완료** 작업지시 행 [WIP 라벨] (`wip-label-button.tsx`) | 행 우측 | 클릭 시 서버 `getWipLabelTarget(workOrderId)` 가 DB 에서 조회: 작업지시의 원본(루트) WipUnit 의 `id`(=QR 식별값)·품목·제조번호·작업지시번호 |
| 완제품 LOT (완제품 칩) | 완제품입고(`finished-goods-receipt` → `receipt-dialog.tsx`) | 입고 성공 직후 라벨 창(미리보기 → 입고 후 인쇄) | 입고 액션이 돌려준 서버 발번 LOT(`res.lotNo`) + 입력 수량 + 서버 영속화 확인 |

- WIP 대상: 자재출고가 만든 루트 WipUnit(`parentWipUnitId`·`sourceProductionResultId` 없음) **정확히 1건**일 때만. 0건=발행 불가(자재출고 완료 후 안내), 2건 이상=임의로 고르지 않고 차단, 폐기 WIP 차단, 다른 tenant 작업지시는 구분 없이 거부. 자식(분할·불량·재작업) WIP 은 대상이 아니다. WIP 생성·채번 코드는 없다.
- 최초/재요청·사유·동시 발행 방지는 안정화 단계의 `recordWipLabelPrint`(WipUnit 행 잠금 트랜잭션)를 그대로 사용. 이력은 "인쇄 요청"이며 출력 완료가 아니다. 출력은 라벨 창의 [인쇄] 버튼으로만 시작(자동 인쇄/프린터 자동 선택/IP 직접 출력 없음).
- 기존 입고·출고·완제품입고·출하·POP·WIP 생성/이동 서버 로직과 스키마는 변경하지 않았다.

## 2단계 최종 안정화

**1) WIP 라벨 발행 조건 통일 — "자재출고 완료"만 허용(서버 검증)**
- 기존 자재출고 목록의 완료 판정(`getWorkOrdersForIssue.allIssued`)을 먼저 확인했다: 상태 ∈ {RELEASED, IN_PROGRESS}, 자재별 필요수량 = round(BOM qtyPer × 계획수량 × (1+scrapRate), 3자리), 기출고 = 해당 품목 첫 MaterialReservation.issuedQty, 모든 자재 대기수량 ≤ 0 이고 자재가 1개 이상. 이 규칙은 DB 의 현재 값만으로 서버에서 재계산할 수 있어 같은 규칙을 `lib/label/wip-label-eligibility.ts`(순수 함수)로 옮겼다. `material-issue.actions.ts` 는 수정하지 않았고, 테스트가 실제 `getWorkOrdersForIssue` 결과(allIssued)와 이 함수를 같은 입력에서 비교한다.
- `getWipLabelTarget` / `checkWipLabelPrintable` / `recordWipLabelPrint` 가 **같은 `findIneligible`** 을 쓴다. 차단: 하위(분할·불량·재작업) WIP · 작업지시 없음 · 작업지시 상태 부적합 · **일부 출고(PARTIAL) · 출고 없음(NONE) · BOM 없음** · 폐기 WIP · 타 tenant. 최초 발행과 재발행 모두 동일(이력이 있어도 미완료면 사유가 있어도 차단). `recordWipLabelPrint` 는 WipUnit 행 잠금 이후 같은 트랜잭션에서 한 번 더 확인한다(사전 확인 이후 상태가 바뀐 경우).
- 락 순서: WipUnit 행만 `FOR UPDATE`, 작업지시/예약은 잠금 없이 읽기만 한다. 자재출고 트랜잭션은 작업지시 → WipUnit 순으로 잠그지만 라벨 트랜잭션은 작업지시를 잠그지 않아 새 교착 경로가 없다. (읽기라서 출고 트랜잭션이 커밋 중인 값은 보이지 않는다 — 그 경우 이전 상태로 판정되어 차단 쪽으로 기운다.)
- 작업지시 상태가 RELEASED/IN_PROGRESS 가 아니면(예: 완료) 자재출고 목록에 나오지 않으므로 화면과 같이 서버도 차단한다.

**2) 서버 자동 생성 LOT 라벨 연결**
- 원인: `createReceivingInspection` 은 서버가 채번한 LOT(`resolvedLotNo`)를 트랜잭션 안에서만 알고 응답에는 담지 않아, 화면에 번호가 없는 AUTO 입고는 입고 후 라벨을 만들 수 없었다.
- 변경(응답 필드 추가만): 트랜잭션의 모든 쓰기 뒤에 확정 LOT 를 기록하고, **커밋 뒤 DB 에서 (tenant, lotNo, 품목) Lot 행을 다시 확인**한 번호만 `{ success: true, lotNo }` 로 반환한다(LOT 관리 품목만, 확인 실패는 입고 결과를 뒤집지 않고 lotNo 없이 성공). 채번 규칙/예약/수량/재고 로직은 그대로. 재전송(replay) 응답에는 lotNo 가 없다(이번 호출에서 새로 확정한 LOT 가 아님 → 화면은 추측하지 않고 안내).
- 화면: 입고 성공 응답의 lotNo 를 발주품목별로 보관해 라벨 대상에 우선 사용, 없으면 기존처럼 화면에 입력·예약된 번호(수동 입력). 라벨 창은 모든 품목 입고 성공 분기에서만 열리고, 인쇄 시 서버가 Lot 영속화를 다시 확인한다.
- 참고: 대원정밀은 LOT 자동 채번 규칙이 미확정이라(가드) 현재 AUTO 입고는 서버에서 거부된다 — 규칙 확정 후 바로 이 경로로 라벨이 연결된다.
