# DAEWON-MES 1차 개발 — 기존 기능 안정화 및 오류 수정 보고

> 작성: 2026-10-19 · 작업 브랜치 `fix/daewon-stabilization-phase1` (기준 `origin/main` @ `aee84bc`) · 1차 커밋 `c79b58a` 를 Push 하여 **Draft PR #5** 로 등록됨. 아래 "2-A. PR #5 검토 보완"은 그 이후 별도 커밋(amend 아님)으로 반영. **main 병합·운영 배포 없음(사용자 검토 대기)**
> 대상 사업: 「2026년 대중소상생형 스마트공장 구축지원 사업」 (사업계획서 `2026_사업계획서_상생형_대원정밀_v10.docx` 표지 기준, 유형 "상생형-B (기초)"). 사업계획서 v10 본문·머리글·바닥글에서 "울산항만공사" 문구는 확인되지 않았다.
> 원칙: 최소 수정 · Schema 변경 0 · Migration 0 · DB write 0 · 운영 배포 0 · main 병합 0

---

## 1. Git / 기준선

| 항목 | 값 |
|---|---|
| 저장소 | `aemess3078-hub/DAEWON-MES` (`origin` 확인) |
| 시작 시점 브랜치 | `perf/monitor-latest-snapshot` (이미 main 에 PR #4 로 병합됨) |
| 작업 브랜치 | `fix/daewon-stabilization-phase1` ← `origin/main` @ `aee84bc` |
| 기존 변경사항 | 미추적 `docs/DAEWON-MRP-GAP-ANALYSIS.md` — 수정/삭제/stage 없음 |
| `feat/daewon-phase11-lot-qr-traceability` | `6d5ad8a`. **main 에 병합되어 있지 않음.** Phase 9/10 도 미병합(merge-base `5d7b74c`, main 보다 7 커밋 앞, main 에만 있는 커밋 9개). 병합하지 않았고 읽기 전용으로만 비교 |
| DB / 배포 | 어떤 DB 에도 연결하지 않음. `prisma db push / migrate` 미실행. 빌드는 더미 DB URL 로 실행 |

---

## 2. 오류별 결과

### 오류 1 — 자재발주 등록 (Prisma `void` 역직렬화) — **원인 확인 · 수정**

* **원인**: `pgAdvisoryXactLock` 이 `tx.$queryRaw\`SELECT pg_advisory_xact_lock(...)\`` 로 잠금을 걸었다. 이 함수의 반환형은 PostgreSQL `void` 이고, Prisma `$queryRaw` 는 결과 컬럼을 읽으려다 `Failed to deserialize column of type 'void'` 로 실패한다 (설치된 Prisma 5.22 쿼리 엔진 바이너리에 해당 문구가 존재함을 확인). 발주 생성(`createPurchaseOrder`)과 MRP 발주 초안 생성이 모두 이 함수를 쓰므로 둘 다 영향 대상이었다.
* **수정**: `src/lib/services/purchase-order-number.service.ts` — `$queryRaw` → `$executeRaw`. 같은 SQL, 같은 잠금 키(`PO_NO|tenant|연도`), 결과 행을 읽지 않으므로 void 문제가 없고 잠금은 트랜잭션 종료까지 동일하게 유지된다. **잠금 제거 없음 · 번호 규칙(`PO-YYYY-NNNNNN`) 불변 · 테넌트별 분리 불변 · unique(tenantId, orderNo) 재시도 불변.**
* **검증**: Fake PG(advisory lock 모사)로 동시 20건 → 중복 0 · 연속 번호, 테넌트 분리, 대조군(잠금 없음 → 중복 발생) 확인. **실제 PostgreSQL 에서의 재현/수정 확인은 하지 못했다 (미검증).**

### 오류 2 — 작업지시 제조번호 — **의도된 차단 확인 · 사용자 안내만 개선**

* **현재 상태**: 대원정밀은 `lot-brand-guard.ts` 로 CNS 규칙 자동 채번이 **의도적으로 차단**되어 있다 (`NEXT_PUBLIC_BRAND=newmes` 가 아니면 fail-closed). 가드는 건드리지 않았고 새 채번 규칙도 만들지 않았다.
* **실제 결함 (두 가지)**
  1. 화면 문구가 "미입력 시 자동 발행"이라 안내하지만 실제로는 오류가 난다.
  2. `createWorkOrder` 가 throw 한 메시지는 **Next.js 프로덕션에서 지워지므로**(기존 `receiving.actions.ts` 주석이 같은 이유를 명시) 사용자는 "제조번호를 직접 입력하세요" 대신 일반 오류만 봤을 가능성이 높다.
* **수정**: ① 대원정밀 브랜드에서는 제조번호 입력 칸에 "직접 입력" 안내를 보이고, 미입력 시 제출 전에 필드 오류로 막는다(서버 가드는 그대로 2차 방어). ② `createWorkOrder` 가 오류를 `{ success:false, message }` 로 반환한다.
* **유지 확인**: 수동 제조번호 정상 입력, 제조번호 중복 → "이미 사용 중인 제조번호입니다", 품목별 LOT 정책(MANUAL/REQUIRED/DISABLED) 검증.

### 오류 3 — 자재출고 경고 아이콘 겹침 — **재현(코드상) · 수정**

* **원인**: 비LOT 품목 출고수량 입력칸에서 재고 초과 시 `AlertCircle` 이 `absolute right-7` 로 입력칸 **위**에 얹혀 우측 정렬된 숫자와 겹쳤다. (LOT 행은 겹치지 않았으나 경고 글자가 11px.)
* **수정**: `issue-form-dialog.tsx` — 아이콘을 입력칸 아래 별도 줄의 "재고 초과" 문구로 이동(두 경로 모두 13px, `aria-invalid` 추가). 수량 계산·재고 차감 로직 변경 없음. 표는 기존 `min-w-[940px]` + 가로 스크롤 컨테이너 유지.
* **검증**: 정적 구조 검사만 수행. **브라우저에서 실제 렌더링(모바일/태블릿 폭) 확인은 하지 못했다 (미검증).**

### 오류 4 — 원자재 LOT 흐름 — **코드 점검 (수정 없음)**

| 점검 항목 | 결과 (코드 기준) |
|---|---|
| 입고 시 LOT 생성/기존 LOT 사용 | 수동 입력 LOT 가 이미 있으면 같은 품목일 때 재사용, 다른 품목이면 "다른 품목에 이미 사용 중" 거부 |
| LOT 번호 중복 | `Lot (tenantId, lotNo)` 조회 + 자동 채번은 예약 원장 unique 로 원자적 클레임, 충돌 시 재시도 |
| 품목별 LOT 추적 | `Item.isLotTracked` — 비LOT 품목은 입력 LOT 무시(lotId=null) |
| 재고 반영 | 합격수량만 `InventoryBalance(lotId)` 증가 + `InventoryTransaction(RECEIPT)` |
| LOT별 출고 가능 수량 | 출고는 `qtyOnHand/qtyAvailable >= 수량` 조건부 `updateMany`(count≠1 이면 거부) |
| 작업지시 연결 / 이력 | `WorkOrderMaterialLot`, `WipUnitMaterialLot` 기록 |
| 자동 채번 가드 | **제거하지 않음** |

발견 사항 (수정하지 않고 보고): ① main 의 `issueMaterialsForWorkOrder` 는 작업지시 상태(취소/완료)·LOT 상태(격리/보류)·BOM 구성품 여부 검증이 없다 — 이는 Phase 10(DG-014) 브랜치에 있는 보강이며 main 에는 없다. ② `purchase-orders/receiving-dialog.tsx` 가 `createReceivingInspection` 의 `{success:false}` 를 **무시**해 실패해도 창이 닫히던 결함이 있어 수정했다 (오류 5 항목).

### 오류 5 — 사용자 오류 메시지 — **수정**

* **문제**: 입고/출고 액션이 `error.message` 를 그대로 반환해 Prisma 오류(쿼리 원문, 테이블/컬럼명, 오류 코드)가 화면에 노출될 수 있었고, 발주·작업지시 생성은 throw 방식이라 프로덕션에서는 업무 메시지조차 전달되지 않았다.
* **수정**: `src/lib/errors/user-error.ts` (신규) — `toUserErrorMessage()`:
  * 업무 규칙 메시지(재고 부족, 필수 입력, 제조번호 중복, 권한 부족 등)는 그대로 전달
  * Prisma 알려진 오류 P2002/P2003/P2025/P2034/P2028 → 중복·참조·대상 없음·동시 처리·시간 초과 안내
  * 쿼리/테이블/오류코드/연결정보/스택이 섞인 메시지 → 일반 안내
  * `FORBIDDEN`/`UNAUTHORIZED` → 권한/로그인 안내
  * 원본 오류는 `console.error` 로 서버 로그에 그대로 유지
* **적용**: `createPurchaseOrder`, `createWorkOrder`(반환형 `ActionResult`), `createReceivingInspection`, `issueMaterialsForWorkOrder`(권한 확인도 반환값으로). 클라이언트 4곳(발주 폼, 작업지시 폼, 발주 입고 다이얼로그, 기존 반환 처리)이 결과를 처리.
* **미적용(범위 밖)**: 그 외 약 60개 폼의 `alert(error.message)` 패턴은 그대로. 같은 변환을 점진 확대 필요.

---

## 2-A. PR #5 검토 보완 (후속 커밋)

| # | 발견된 실제 문제 | 조치 |
|---|---|---|
| 1 | `toUserErrorMessage` 가 내부 패턴에 걸리지 않은 **알 수 없는 오류 문구를 그대로 반환**했다 (예: `Cannot read properties of undefined`, DB 호스트명 오류, 한글+서버 경로). | **allowlist 방식으로 변경**: `UserFacingError`, 영문 업무 코드(FORBIDDEN 등), 길이 300자 이하·한글·내부정보 패턴 없음인 업무 메시지만 전달. 나머지는 일반 안내. 경로/소스위치/제약조건/SQL/접속정보 패턴 추가. 품목코드(P1000 등)를 Prisma 오류코드로 오인하지 않도록 패턴 정밀화. |
| 2 | 다품목 입고에서 **A 성공 → B 실패 후 같은 창에서 다시 저장하면 A 가 한 번 더 입고**될 수 있었다 (입력값·창이 그대로 남고, 수량 표시도 갱신되지 않음). `자재입고(material-receipt)` 화면에도 같은 결함. | `src/lib/receiving-batch.ts`: 품목별 결과(done/failed/unknown)를 기억하고 done·unknown 품목은 재전송하지 않음. 성공 품목은 입력 잠금 + "입고 완료" 표시 + 기입고/잔여를 서버와 같은 규칙(합격수량만큼 증가)으로 즉시 반영 + `router.refresh()`. 응답 불명(예외)은 자동 재전송 금지·확인 안내. `useRef` 가드로 더블클릭 방어. 검증(창고 선택)은 전송 전 일괄 수행. **서버 입고 트랜잭션·재고 계산은 변경하지 않음.** |
| 3 | `manualLotPolicy=DISABLED` 품목은 입력한 제조번호가 **무시되고 자동 채번을 시도**해, 대원정밀에서는 "규칙 미설정 → 직접 입력하세요"라는 **모순된 안내**로 실패했다. `MANUAL`+`DISABLED` 충돌 설정도 같은 문제. | `lot-numbering/manufacturing-no-policy.ts`(순수 함수)로 `lotNumberingType × manualLotPolicy` 조합을 판정: 대원정밀에서 처리할 수 없는 조합은 사유를 정확히 설명하는 한글 안내로 거절. 자동 채번 가드·CNS 규칙·품목 정책은 변경하지 않음. 수정(update) 흐름은 기존 동작 유지(미입력 허용). |

미해결/주의: ① `updateWorkOrder`·`createReceivingInspection` 외 다른 액션은 아직 throw 방식이라 프로덕션에서 메시지가 지워진다(수정 화면의 제조번호 오류 포함). ② 프로덕션 빌드에서 실제로 메시지가 지워지는 동작은 이번에 재현하지 않았다(기존 코드 주석 근거). ③ 실제 DB 로 부분 성공 → 재시도 시나리오를 돌려보지 못했다 (Fake 서버 모델만 사용).

---

## 3. 1차 업무 흐름 검증 (발주 → 입고 → LOT → 작업지시 → 출고 → 재고 차감 → 투입 이력)

DB 가 없으므로 Fake/Mock 과 소스 구조 검사로만 검증했다.

| # | 항목 | 검증 수준 |
|---|---|---|
| 1 | 발주 등록 | Fake: 채번 잠금 호출 경로. **실 DB 미검증** |
| 2 | 발주번호 중복 방지 | Fake: 동시 20건 중복 0, 대조군 확인 / P2002 재시도 로직 단위 검증. **실 DB 미검증** |
| 3 | 입고 시 재고 증가 | 소스 구조만. **미검증** (`test-inventory-concurrency-integrity` 는 실 DB 필요 → 실행 안 함) |
| 4 | LOT 관리 | 소스 구조만. **미검증** |
| 5~6 | 작업지시 등록 / 수동 제조번호 | 가드 동작(단위), 폼 검증(구조). **미검증(실 DB)** |
| 7~8 | 작업지시별 출고 / 재고 차감 | 소스 구조(조건부 updateMany 불변). **미검증** |
| 9 | LOT별 재고 정합성 | **미검증** |
| 10 | 잘못된 요청/중복 방어 | 오류 변환 단위 검증, 가드 fail-closed 검증 |

---

## 4. 테스트

| 구분 | 결과 |
|---|---|
| `npm run type-check` | 통과 (오류 0) |
| 신규 `npm run test:daewon-stabilization-phase1` | **279개 단언 통과** (Fake PG 동시성, 오류 변환·allowlist, LOT 가드, 다품목 입고 부분 성공/재시도, 제조번호 정책 96조합, 소스 구조). 1차 커밋 시점은 79개. 입고 중복·정합성 최종 검증은 `docs/DAEWON-RECEIVING-INTEGRITY-REVIEW.md` 참고 |
| 기존 테스트 49개(DB 불필요) 실행 | 42 통과 / 7 실패 → **7개 모두 기존 실패** (아래) |
| `npm run build` | 통과 (`prisma generate` + `next build`, 더미 DB URL 로 실행 — DB 미접속. 린트/타입 검사 포함) |
| `npm run check:server-actions` | 통과 (82개 "use server" 파일 export 검사) |
| 실행하지 않음 | `test:inventory-concurrency-integrity`, `test:pop-tool-usage-integrity`, `test:monitor-latest-snapshot`, `test:ncwatch-phase12`(실 DB 사용), `test:f22-browser-smoke`(브라우저) |

**기존 실패 7건** — 변경을 `git stash` 로 되돌려 같은 테스트를 실행해 **실패 시그니처가 동일**함을 확인했다: `test:role-permission-enforcement`(inventory.actions `createTransaction` 부재), `test:cause-analysis`, `test:corrective-action`(deleteQualityInspection 구조), `test:report-output`, `test:production-plan-workorder-integrity` 및 `test:bom-material-sufficiency`(삭제된 `scripts/test-production-plan-sales-link.ts` 참조), `test:f25-master-menu-cleanup-integrity`(메뉴 라벨 불일치). 이번 변경과 무관.

---

## 5. 기존 QR / WIP 기능 분석

분류: ① 구현 완료 · ② 부분 구현 · ③ 미구현 · ④ 구현되어 있으나 검증 필요. 비교 대상: **main** vs **`feat/daewon-phase11-lot-qr-traceability`(미병합)**.

| 기능 | main | Phase 11 브랜치 | 재사용 포인트 |
|---|---|---|---|
| QR 생성 | ③ (`qrcode` 패키지는 설치돼 있으나 미사용, CODE128 바코드만) | ④ `src/lib/qr/lot-qr.ts` 표준 `DAEWON\|LOT\|1\|<lotNo>`, `barcode-label` 에서 QRCode 생성 | 파서/표준 모듈을 엔티티 확장(WO, WIP)하기 좋게 단일 모듈로 구성됨 |
| QR 라벨 출력 | ② 품목코드 CODE128 라벨(`barcode-label/print-dialog`), LOT 미포함 | ④ LOT QR 라벨 + 재출력 사유/감사 + 영속화 후 출력 게이트 (프린터 실기 미검증) | 브라우저 인쇄(mm CSS 변수) → 라벨 규격 변경 용이 |
| 카메라 QR 스캔 | ③ (USB 리더 키보드 입력 `BarcodeScanInput` 만) | ④ `CameraQrScanner`(BarcodeDetector + jsQR 폴백), `LotScanDialog` (태블릿 실기 미검증) | 공통 컴포넌트 1개로 자재출고/출하/POP 공용 |
| 원자재 LOT QR | ③ | ④ 입고 라벨 → 출고 스캔(서버 재검증) | 입고 확정 → Lot 영속화 후 출력 게이트 |
| 작업지시 QR | ③ | ③ (파서는 엔티티 확장 가능, 작업지시 QR 자체는 없음) | `parseLotQr` 구조 확장 |
| POP QR | ③ | ② POP 에서 자재 LOT 확인 스캔만(투입 mutation 없음), 작업/공정 QR 없음 | `pop.actions` 세션/사업장 검증 재사용 |
| `WipUnit` | ④ 모델·생성(자재출고 시 root)·상태 전이(시작/완료/보류/외주/재작업/폐기) 구현. 이번에 실 DB 검증은 안 함 | 동일(변경 없음) | `parentWipUnitId` 계보, `lotId`, `manufacturingNo` 이미 존재 |
| `WipMovement` | ④ 이동 유형 14종(`SPLIT`/`MERGE`/`MOVED`/…), 이력 기록 구현 | 동일 | 이동 이력 원장으로 그대로 사용 |
| 생산 묶음(BATCH) 분할 | ② 불량/재작업/외주 분리용 SPLIT(부모-자식 WipUnit)만. **사용자가 임의로 묶음을 나누고 합치는 기능과 BATCH 개념/화면은 없음** | ③ (WIP QR 은 `NOT_REQUIRED_NOW` 판정) | `SPLIT/MERGE` 이동 유형·`parentWipUnitId` 활용 |
| 공정별 재공품 수량 관리 | ② `wip-inventory`·`process-progress` 화면 존재. WO 단위 root WipUnit 이 공정을 따라 이동하는 구조라 공정별 분할 수량 모델은 아님 | 동일 | `WipUnit.currentWorkCenterId/Location` 인덱스 존재 |
| 완제품 LOT 추적 | ② 완제품입고(`FinishedGoodsReceipt`)·LOT=제조번호 기반 생성, 기존 추적 화면 3개(`traceability`, `trace-reverse`, `manufacturing-traceability`). RAW→FG 계보 미생성 | ④ 정/역방향 추적 `traceRawLot/traceFinishedLot/traceShipment` (**WorkOrder 단위** 계보; 완제품 LOT 별 원재료 수량 배분은 미구현) | 새 테이블 없이 기존 FK 체인을 따라가는 서비스 |
| 출하 이력 | ① `ShipmentOrder/Item(lotId)`, 생성/확정/삭제, 부분출하·다중 LOT. 기존 `test:shipment-state-integrity` 통과 | ④ 출하 스캔 추가 | `ShipmentItem.lotId` 인덱스 없음(Phase 11 문서 권고) |

**추가 개발 필요사항 요약**: (a) Phase 9/10/11 병합 여부 결정이 선행되어야 한다 (QR 라벨·카메라·추적 서비스가 모두 이 브랜치에 있음). (b) 작업지시 QR·POP 작업 QR·생산 묶음(BATCH) 모델/분할·병합 화면은 어디에도 없다. (c) WIP 별 QR 은 Phase 11 에서 "현재 불필요"로 판정했으나(대원정밀 마스터에 SEMI_FINISHED 0건), BATCH 요구가 확정되면 `WipUnit` 에 라벨 식별자를 붙이는 설계가 필요하다. (d) 현장 검증(프린터, 태블릿 카메라) 전부 미수행.

---

## 6. 다음 개발 권장사항

1. **브랜치 정리 먼저**: Phase 10(보안)·Phase 11(LOT QR)을 main 에 어떻게 반영할지 결정. 아래 파일이 이번 변경과 겹쳐 병합 시 수동 충돌 해결이 필요하다: `purchase-order.actions.ts`, `work-order.actions.ts`, `receiving.actions.ts`, `material-issue.actions.ts`.
2. **LOT/제조번호 규칙 확정(DG-003)** → 가드 교체 → `Item.isLotTracked` 정책 적용(DG-001) 순서 유지.
3. **테스트 DB 확보**(Supabase 별도 프로젝트 또는 로컬 Postgres) 후 `test:inventory-concurrency-integrity` 와 이번 변경(void 잠금, 입고/출고 흐름)을 실제 DB 로 검증.
4. 오류 메시지 변환을 나머지 폼으로 점진 확대(`alert(error.message)` 약 60곳).
5. 병합 후 WIP/BATCH 설계(작업지시 QR, 묶음 분할·병합, 공정별 WIP 수량) 착수.

---

## 7. 사용자 승인이 필요한 사항

1. **대원정밀 LOT / 제조번호 채번 규칙** (임의로 만들지 않았음). 결정이 필요한 항목: 원자재 입고 LOT(공급사 LOT 원본 보존 + 내부 LOT 병기 여부), 작업지시 제조번호, 완제품 LOT(현재 제조번호 기반 생성 — 승계 유지?), 세척/포장 이후 승계 여부, 자릿수·날짜 체계(월 문자 사용 여부), 품목군별 접두사 필요 여부. 참고용 권장안(예시, 확정 아님): 원자재 `공급사 LOT 원본 유지(MANUAL) + 입고일 기준 내부 일련`, 제조번호 `M{YYMM}-{NNN}`(월별 리셋, 대원정밀 전용), 완제품 LOT = 제조번호 승계.
2. **Phase 10/11 브랜치 병합 방식** (병합 순서, PR 단위).
3. **Draft PR #5 의 Ready for review 전환 및 병합** (현재 Draft, 병합하지 않음).
4. **테스트 DB 사용 승인** (실 DB 흐름 검증용). 운영 DB 는 사용하지 않음.
5. 스키마 변경은 필요하지 않았다 (Phase 11 이 권고한 `ShipmentItem(lotId)` 인덱스는 별도 승인 사항).
6. **품목별 LOT 정책 확인**: `manualLotPolicy=DISABLED` 인 품목은 대원정밀에서 작업지시를 만들 수 없다(직접 입력 금지 + 자동 채번 불가). 해당 품목이 실제로 존재하는지, 있다면 정책을 바꿀지 업무 판단이 필요하다 (코드는 품목 정책을 변경하지 않는다).
