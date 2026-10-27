# 대원정밀 MES — 4-1단계 자재출고 QR 스캔 연동

QR 은 **선택적 편의기능**이다. QR 없이도 자재출고 업무를 전부 수행할 수 있고, QR 은 LOT "선택"만 돕는다. 실제 출고는 기존 [출고 처리] 버튼과 기존 서버 액션(`issueMaterialsForWorkOrder`)만 수행하며, QR/수동 선택은 같은 데이터 구조(LOT 분할 행)와 같은 확정 서버 검증을 쓴다.

## 기존 업무 분석 결과
- 화면: `material-issue/page.tsx` → `material-issue-table.tsx`(작업지시 목록) → `issue-form-dialog.tsx`(출고 처리 창). **작업지시 기반 생산자재 출고만** 있다(일반 재고출고 화면/액션은 별도 — 이번 연동 대상 아님). 서버 `getWorkOrdersForIssue` 가 BOM 자재별 필요/기출고/잔량(MaterialReservation.issuedQty)을 계산한다.
- LOT 선택: LOT 관리 자재는 자재별 "LOT 분할 행"(`lotSplitsMap`: `lotValue="lotId:warehouseId"` + `qty`)을 여러 개 둘 수 있다 = **Multi-LOT 지원**. LOT 목록은 `getLotStockByItems`(LOT·창고별 가용재고>0).
- 확정: `issueMaterialsForWorkOrder` 가 권한(PURCHASE_ORDER CREATE + OPERATOR) · tenant · 동일 LOT 중복 · 수량 합계 · LOT 지정 · 창고별 재고/가용재고를 트랜잭션에서 검증하고 재고 차감·예약·WipUnit 생성을 한다. 이후 단계에서 확정 시 **LOT 상태·유효기간(공통 규칙), BOM 구성품 소속, 자재예약 ID 소속**을 같은 트랜잭션 전/안에서 검증하고 LOT 행을 공유 잠금하도록 보완했다(수동/QR 동일, 상세는 `docs/DAEWON-LOT-ISSUE-ELIGIBILITY.md`).

## 연동 위치
- `issue-form-dialog.tsx` 의 **"출고 자재 목록" 머리(자재별 LOT 선택 행 바로 위)** 에 [QR 스캔] 버튼(`lot-qr-scan-section.tsx`). LOT 관리 자재가 있을 때만 표시. 기존 수동 LOT 선택 상자·행 추가/삭제·수량 입력은 그대로.
- 스캔 흐름: 버튼 → 공통 `QrScannerDialog`(LOT/WIP QR 검증) → WIP QR 은 거부 안내 → 서버 읽기 전용 조회 `lookupLotForMaterialIssue(workOrderId, lotNo)` → 화면의 자재 목록에서 선택 가능한 자재인지 확인 → 창고 후보 1건이면 바로, 여러 건이면 사용자가 창고 선택 → 기존 LOT 행에 반영(빈 행에 채움 / 없으면 새 행 추가, **수량은 정하지 않음**).

## 서버 검증 (읽기 전용, 쓰기 없음)
로그인·권한(READ) / tenant(세션 기준, 클라이언트 값 무시) / 작업지시 소유 / LOT 존재(다른 tenant·없는 LOT 는 같은 응답) / **실제 품목이 이 작업지시의 BOM 구성품인지**(QR 문자열로 원자재/완제품을 판단하지 않음) / LOT 상태·유효기간(공통 규칙: ACTIVE 이고 유효기간 당일까지) / 출고 가능 재고(`getLotStockByItems` 재사용). LOT 번호가 여러 창고에 있으면 후보를 모두 돌려주고 사용자가 고른다.

## 결정이 필요한 사항
1. **LOT 상태 제한 — 해결됨**: 수동 목록 · QR 조회 · 출고 확정이 같은 공통 규칙(`lot-eligibility.ts`)을 쓴다. 자세한 내용은 `docs/DAEWON-LOT-ISSUE-ELIGIBILITY.md`.
2. BOM 소속·"대체품"(ItemSubstitute): 수동 UI 와 같이 BOM 구성품만 허용(대체품 미지원).
3. 스위치: `NEXT_PUBLIC_QR_SCAN_DISABLED=true` 로 [QR 스캔]을 끌 수 있다(기존 업무 영향 없음).

## 점검 화면 / 테스트
- `/label-print/scan/issue-lot`: 실제 연동 컴포넌트 + 같은 반영 규칙, 서버 조회만 가짜(로그인·DB 없음). **개발·점검용이라 운영 빌드에서는 기본 404** — production build 로 브라우저 테스트를 돌릴 때만 서버에 `ENABLE_QR_DEV_PAGES=true` 를 지정한다(`next dev` 에서는 항상 열림, `src/lib/dev-pages.ts`).
- `npm run test:material-issue-qr`(62, 가짜 DB): 서버 조회 전 시나리오, 읽기 전용 가드, 수동/QR 동일성, 소스 구조.
- `scripts/test-material-issue-qr-browser.ts`(65, Chrome 가짜 카메라 + 디코더 모킹): 정상/WIP/잘못된 QR/서버 거부 5종/중복/Multi-LOT/복수 창고/조회 중 중복 방지/카메라 권한 거부 후 수동 출고.
- 미검증: 실제 로그인·DB 환경의 자재출고 화면 클릭, 실제 Android 기기·카메라, 실제 재고 데이터.
