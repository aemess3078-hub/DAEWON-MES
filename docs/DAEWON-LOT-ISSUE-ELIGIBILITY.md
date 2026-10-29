# 대원정밀 MES — 원자재 LOT 출고 검증 통일

수동 LOT 선택, QR 스캔 조회, 출고 확정(`issueMaterialsForWorkOrder`)이 **같은 출고 적격성 규칙**(`src/lib/material-issue/lot-eligibility.ts`)을 쓰도록 통일했다. QR 은 여전히 선택적 편의기능이며, QR 이라서 허용/거부되는 경로는 없다.

## 1. 기존 LOT 상태·유효기간 구조 (코드 근거)
- `Lot.status: LotStatus` — `ACTIVE`(활성, 기본값) · `QUARANTINE`(격리) · `ON_HOLD`(보류) · `CONSUMED`(소진) · `EXPIRED`(만료).
- 상태는 LOT 관리 화면의 [상태 변경](`updateLotStatus`)으로만 바뀐다. **자동 전환 코드는 없다**(재고 0 → 소진, 유효기간 경과 → 만료 자동 처리 없음).
- `Lot.expiryDate: DateTime?` — 선택 입력. 자재입고는 값을 넣지 않는다 → 대부분의 LOT 는 유효기간이 비어 있다.
- 변경 전: 수동 목록과 출고 확정은 상태/유효기간을 보지 않았고, QR 조회만 ACTIVE 를 요구했다(불일치).

## 2. 출고 가능 정책 (공통 함수 `evaluateLotIssueEligibility`)
| 조건 | 결과 |
|---|---|
| status = ACTIVE, 유효기간 없음 | 허용 |
| status = ACTIVE, 유효기간 ≥ 오늘(한국 날짜) | 허용 (유효기간 당일까지) |
| QUARANTINE · ON_HOLD · CONSUMED · EXPIRED | 제한 |
| ACTIVE 이지만 유효기간이 어제 이전 | 제한 (`유효기간 경과`) |
| 정의되지 않은 상태값 | 제한 (안전 쪽 차단) |
| 가용재고 없음 | 기존 재고 검증이 담당 (목록 제외 / 확정 시 '가용재고 부족') |

## 3. 적용 위치
- **수동 선택 목록** `getLotStockByItems`: 제한 LOT 도 목록에 남기되 `issueBlockReason/issueBlockLabel` 을 붙인다. 화면(`issue-form-dialog.tsx`)은 해당 항목을 선택 불가로 표시하고 `— 출고 불가(격리)` 라벨·툴팁 사유·안내 문구를 보여 주며, 확정 전 안내도 한다.
- **QR 조회** `lookupLotForMaterialIssue`: 같은 함수 사용(별도 상태 목록 제거). 코드 `LOT_RESTRICTED` / `LOT_EXPIRED`.
- **출고 확정** `issueMaterialsForWorkOrder`: 기존 트랜잭션 안에서 LOT 행을 다시 읽어(`tx.lot.findFirst`) 같은 함수로 재검증. 거부는 예외 → 트랜잭션 전체 롤백이라 재고·수불·예약·WIP·감사 이력이 남지 않는다. 기존 차감 방식/수량 계산/WIP 생성/잠금은 수정하지 않았다(추가 코드는 조회 1회 + 검사 1회).
- Multi-LOT: 한 LOT 라도 제한이면 요청 전체가 거부(롤백)된다.

## 4. 새로 막히는 기존 정상 작업 (영향 분석)
- LOT 관리에서 **수동으로 격리/보류/소진/만료로 바꾼 LOT** — 이전엔 수동 출고 가능, 이제 불가(의도한 변경).
- **ACTIVE 인데 유효기간이 지난 LOT** — 이제 불가.
- ACTIVE 이고 유효기간이 비어 있는 LOT(입고로 생성된 대부분)는 영향 없음.
- 주의: 소진(CONSUMED) 처리된 LOT 에 재고가 다시 입고되어도 자동으로 ACTIVE 가 되지 않는다. LOT 관리에서 활성으로 바꿔야 출고된다.

## 5. 모호한 점 (임의 판단하지 않고 보고)
- 유효기간 경계: 한국 날짜 기준 **유효기간 당일까지 허용**으로 구현. LOT 관리 화면은 시각이 지나면 붉게 표시해 기준이 약간 다르다 → 정책 확인 필요.
- (4-1.6단계에서 해결) 경쟁 구간 · 조회 인증 · BOM 소속 검증은 아래 "4-1.6단계 보안·정합성 보완" 참고. 유효기간은 한국 날짜 기준 당일까지 유효로 확정되었고, LOT 관리 화면의 만료(붉은색) 표시도 같은 기준으로 맞췄다.

## 7. 4-1.6단계 보안·정합성 보완
1. **조회 인증** — `getLotStockByItems` 는 로그인·권한(재고/LOT/작업지시/자재출고 중 하나의 READ)·tenant 를 확인한다(`lot-read-access.ts`, QR 조회와 공통). tenant 는 세션 값만 쓰고, 클라이언트가 보낸 `tenantId` 가 세션과 다르면 조회 없이 빈 결과를 돌려준다. 클라이언트 시그니처는 그대로여서 기존 화면은 영향이 없다.
2. **BOM 소속** — `issueMaterialsForWorkOrder` 는 쓰기 전에 요청 품목이 작업지시 BOM 구성품인지 확인한다(수동/QR 동일). 자재출고 화면과 QR 조회는 처음부터 BOM 구성품만 다루므로 정상 업무는 영향이 없다. 대체자재(ItemSubstitute)는 출고 화면·출고 액션 어디에도 쓰이지 않아(삭제 참조 확인에서만 사용) 유지할 기존 방식이 없다. 이전에는 화면을 거치지 않은 직접 호출로 BOM 밖 품목을 출고하면 새 예약이 만들어졌으나, 이제 거부된다.
3. **LOT 상태 동시성** — 출고 트랜잭션이 LOT 행을 `SELECT id … FOR SHARE` 로 잠근 뒤 상태를 다시 읽는다. 상태 변경(`updateLotStatus`, 단일 UPDATE 문)은 출고 트랜잭션이 끝날 때까지 대기하므로 "읽은 뒤 바뀌어 통과"하는 구간이 사라진다. 공유 잠금끼리는 충돌하지 않아 동시 출고는 서로 막지 않고, 잠금 순서는 작업지시 FOR UPDATE → LOT FOR SHARE → 재고 차감이며 상태 변경 쪽은 다른 잠금을 기다리지 않아 교착이 생기지 않는다.
4. **미검증(실제 PostgreSQL 필요)** — 위 잠금 동작(대기·해제), 실제 격리 수준(Prisma 기본 = READ COMMITTED, 명시 설정 없음), Prisma `$queryRaw` 가 `"Lot"` 테이블명으로 실행되는지, 잠금 대기 시간 영향.
5. **남은 위험** — `getWorkOrdersForIssue`·`getWarehousesWithStock` 에도 인증이 없다(이번 범위 밖, 페이지 서버 컴포넌트에서만 호출). 예약 ID(`reservationId`)가 다른 작업지시의 예약인지는 확인하지 않는다(기존).
- 테스트: `npm run test:material-issue-integrity` (78, 4-1.7단계 포함).

## 8. 4-1.7단계 자재출고 최종 안정화
1. **목록·창고 조회 인증** — `getWorkOrdersForIssue` / `getWarehousesWithStock` 는 자재출고 메뉴 권한(PURCHASE_ORDER READ)과 세션 tenant 를 확인한다(`requireMaterialIssueReader`). 비로그인은 `UNAUTHORIZED`, 권한 없음과 다른 tenant 요청은 같은 권한 오류로 거부되고(다른 tenant 데이터 존재 여부 비노출) 조회는 실행되지 않는다. 결과가 없으면 빈 배열이라 인증 실패와 구분된다. 호출처는 자재출고 페이지(서버 컴포넌트) 하나이며 layout 의 로그인·메뉴 권한 확인은 그대로다.
2. **예약 ID 소속** — 요청의 `reservationId` 는 존재 · 현재 작업지시 일치 · 품목 일치(작업지시가 tenant 를 이미 확인하므로 tenant 도 일치)를 쓰기 전에 확인하고, 트랜잭션 안에서 한 번 더 확인한다. 위반은 모두 같은 오류 문구(없는 ID 와 다른 tenant 예약을 구분하지 않음). 예약 ID 가 없는 출고(기존 예약 갱신 / 예약 없으면 생성)는 그대로다.
3. **LOT 잠금 순서** — LOT 공유 잠금을 요청 순서가 아니라 LOT ID 오름차순으로 루프 전에 한 번에 잡는다. 순서: 작업지시 FOR UPDATE → LOT FOR SHARE(정렬) → WIP 확인 → 재고 행 차감(요청 순서, 기존 그대로).
4. **한계** — 공유 잠금은 서로 충돌하지 않고 대기하는 쪽(LOT 상태 변경)은 다른 잠금을 쥐지 않아 LOT 잠금만으로는 교착 경로가 없다고 판단하지만, 재고 행 차감 순서(요청 순서)는 기존 그대로여서 서로 다른 작업지시가 같은 재고 행을 반대 순서로 차감하면 기존에도 있던 교착 가능성이 남는다(발생 시 기존 `withQuantityTransactionRetry` 가 재시도). 실제 PostgreSQL 에서 검증하지 못했으므로 교착이 해결되었다고 단정하지 않는다.
5. **기존 test:role-permission-enforcement 실패** — `inventory.actions.ts` 에 `createTransaction` 이 없다는 소스 검사 실패이며 HEAD 에서도 동일하다(파일·테스트 모두 미수정, 이력에 해당 함수 없음). 이 항목만 제외하면 나머지 92건은 통과. 이번 범위와 무관해 수정하지 않았다.

## 6. 테스트
- `npm run test:lot-issue-eligibility` (52, 가짜 DB·트랜잭션 롤백 모사): 공통 규칙, 수동 목록 사유, 수동=QR=확정 일치, 거부 시 변경 없음, 선택 후 상태 변경, 선택 후 재고 소진, 조회~차감 사이 동시 사용 롤백, Multi-LOT, 정상 수동/QR 출고 동일 결과, 비LOT 회귀, 소스 구조.
- 미검증(실제 DB 필요): 실제 Prisma `select`(status·expiryDate), PostgreSQL 트랜잭션 롤백/격리 동작, 동시 상태 변경 경쟁, 실제 LOT 상태·유효기간 분포(새로 막힐 LOT 수 조회), 실제 화면 클릭.
