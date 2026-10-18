# DAEWON-MES Phase 11 — LOT / QR 제조이력 추적 (Manufacturing Traceability)

> 작성: 2026-10-14 · 작업 브랜치 `feat/daewon-phase11-lot-qr-traceability` (Phase 10 브랜치 위 stacked) · **미커밋/미푸시(사용자 승인 대기)**
> 목표: 원자재 입고 LOT → 자재 QR → 자재출고 → 작업지시 → 공정/작업자/설비/실적/품질 → 완제품 LOT/QR → 출하 → 고객, 그리고 그 역방향.
> 원칙: **Schema 변경 0 · Migration 0 · Production write 0** · QR 은 식별자일 뿐, 제조이력의 Source of Truth 는 DB 관계다.

---

## A. Baseline

| 항목 | 값 |
|---|---|
| Parent branch | `fix/daewon-phase10-security-hardening` @ `cd9cd438500a07ac348e8b273f41e4314908bc7f` |
| Working branch | `feat/daewon-phase11-lot-qr-traceability` (Phase 10 위에서 분기, main 에서 분기하지 않음) |
| origin/main | `5d7b74c` — Phase 9/10 은 main 에 merge 되지 않음 |
| Phase 10 상태 | IMPLEMENTATION COMPLETE / **VALIDATION PENDING** (Vercel Preview Deployment Protection + Preview DB 가 Production 일 가능성 때문에 실환경 black-box 보류 — 본 Phase 에서도 재시도하지 않음) |
| 미추적 | `docs/DAEWON-MRP-GAP-ANALYSIS.md` — 수정/stage/삭제 없음 |
| 신규 dependency | `jsqr@1.4.0` (Apache-2.0, 무의존성) — BarcodeDetector 미지원 브라우저의 QR 디코더 폴백 1개만 추가 |
| Production | **write 0**. READ ONLY 조회 1회(LOT 정책 dry-run, `SET TRANSACTION READ ONLY` 트랜잭션 + SELECT 만) |

---

## B. Phase 9 Related GAP (문서 `DAEWON-PHASE9-FINAL-GAP-AUDIT.md` 의 실제 번호/내용 기준)

| DG | Phase 9 내용 | Phase 11 처리 | 상태 |
|---|---|---|---|
| DG-001 (P0) | Production Item 427건 전부 `isLotTracked=false` | **정책 제안 + READ ONLY dry-run 도구**만 제공. Production 값 변경 0 | 제안 완료 / **적용 금지 — DG-003 확정 후**(P0 유지, D절 순서 참조) |
| DG-003 (P1) | LOT/제조번호 자동채번 fail-closed(대원정밀 규칙 미확정) | 건드리지 않음(새 채번 정책을 만들지 않음). 수동/예약 LOT 번호가 QR 식별자로 그대로 쓰임 | 잔존 |
| DG-004 (P1) | 라벨/스캔이 품목 단위 — LOT 미포함 | LOT QR(`DAEWON\|LOT\|1\|<lotNo>`) 라벨 + 스캔 시 LOT 선택 | **코드 완료** (FIELD_TEST_REQUIRED) |
| DG-005 (P1) | 태블릿 카메라 스캔 미구현 | 공통 `CameraQrScanner`/`LotScanDialog` (후면 카메라·연속스캔·수동입력 폴백) | **코드 완료** (FIELD_TEST_REQUIRED) |
| DG-006 (P1) | 역추적(완제품 LOT → 원자재/공급사) 단절 | `traceFinishedLot` / `traceShipment` | **FULL** |
| DG-007 (P1) | 정방향(원자재 → 완제품 → 출하 → 고객) 미연결 | `traceRawLot` | **FULL** |
| DG-019 (P2) | 입고검사가 LOT 와 FK 로 연결되지 않음 | 스키마 변경이 필요해 보류(공급사 추적은 입고 RECEIPT 트랜잭션 → PO 경로로 해결) | 잔존 |
| DG-026 (P2) | 라벨 재출력 통제·이력 없음 | `LABEL_PRINT`/`LABEL_REPRINT` 감사 + 재출력 사유 + 재출력 표시 + 상태 기반 스캔 차단 | **완료**(재출력 승인 절차는 미구현) |
| DG-030 (P2) | LOT 생성/상태변경 감사 누락 | LOT 수동 생성 `LOT_CREATE` 감사 추가(상태변경은 Phase 10) | 부분 완료 |
| DG-034 (P2) | Brother QL-820NWB 인쇄 미검증 | 프린터 비종속 브라우저 인쇄 + mm 단위 CSS 변수 | FIELD_TEST_REQUIRED |

---

## C. Existing LOT Architecture (조사 결과 — 새 모델 없이 체인이 이미 존재)

```
BusinessPartner(SUPPLIER) ← PurchaseOrder.supplierId
      │                         ▲ InventoryTransaction(RECEIPT, refType=PURCHASE_ORDER, refId=PO.id, lotId)
      ▼                         │
   Lot(원자재) ───────────────────┘
      │ WorkOrderMaterialLot(materialLotNo · inventoryTransactionId → InventoryTransaction.lotId)
      ▼
   WorkOrder ── WorkOrderOperation ─ RoutingOperation / Equipment / WorkOrderOperationAssignment
      │               ├ ProductionResult(operatorId=Profile, goodQty/defectQty/reworkQty)
      │               └ QualityInspection(lotId?, inspectorId)
      ▼ FinishedGoodsReceipt(workOrderId · lotId)
   Lot(완제품) ── ShipmentItem(lotId) ── ShipmentOrder ── SalesOrder.customer
```

| 요구 관계 | 현재 모델로 가능? | 근거 |
|---|---|---|
| Receiving → Raw LOT | ✅ | `receiving.actions.ts` — RECEIPT 트랜잭션에 `lotId` + `refType=PURCHASE_ORDER/refId` |
| Raw LOT → Inventory | ✅ | `InventoryBalance(lotId)` |
| Raw LOT → Material Issue → WorkOrder | ✅ | `WorkOrderMaterialLot`(materialLotNo, qty, inventoryTransactionId) — 다대다(한 LOT→여러 WO, 한 WO→여러 LOT) |
| WorkOrder → Finished Receipt → Finished LOT | ✅ | `FinishedGoodsReceipt(workOrderId, lotId)` — 한 WO 가 복수 FG LOT 가능 |
| Finished LOT → Shipment → Customer | ✅ | `ShipmentItem(lotId, qty)` — 부분출하/다중 LOT/다중 출하 |
| 공정/작업자/설비/품질 | ✅(데이터 존재 시) | `ProductionResult.operatorId`, `WorkOrderOperation(Assignment).equipmentId`, `QualityInspection` |
| Raw → Finished `LotGenealogy` | ⚠ SEMI 구성품만 생성 | `finished-goods.actions.ts` 7-B. 대원정밀 BOM 은 100% RAW 라 genealogy 행이 만들어지지 않음 |

**결론: Schema 변경 불필요.** 별도 중복 테이블에 같은 값을 복사하지 않고 위 관계를 Trace Service 가 직접 따라간다. `LotGenealogy` 는 존재하는 경우에만 추가 간선으로 사용한다.

**Limitation (명시)**: 계보는 **WorkOrder-level genealogy** 다. 한 작업지시에 Raw LOT A/B/C 가 투입되고 Finished LOT F1/F2 가 생성되면 F1 → A/B/C, F2 → A/B/C 로 추적된다. **Finished-Lot-level material quantity allocation is not implemented** — Raw LOT 별 투입수량을 F1/F2 에 개별 배분하지 않는다. 이는 Phase 11 실패가 아니며, 대원정밀에서 동일 WorkOrder 내 Finished LOT 별 정확한 원재료 배분이 필요해지면 별도 고도화 대상으로 둔다.

---

## D. LOT Policy Proposal (제안만 — Production 변경 없음)

분류기: `src/lib/lot-policy/lot-policy.ts`(순수 함수) · 도구: `npm run lot-policy:dry-run [-- --csv <경로>]`(`SET TRANSACTION READ ONLY` + SELECT 만).

| 구분 | 정책 |
|---|---|
| RAW_MATERIAL — BOM 구성품 | **REQUIRED** (입고 LOT·공급사 역추적) |
| RAW_MATERIAL — BOM 미사용이나 구매/재고 이력 | RECOMMENDED |
| RAW_MATERIAL — 이력 없음 | OPTIONAL |
| FINISHED — 수주/출하 이력 또는 BOM 으로 생산 | **REQUIRED** (완제품 LOT) |
| FINISHED — 이력 없음 | RECOMMENDED |
| SEMI_FINISHED(WIP) | **REVIEW_REQUIRED** — 자동 지정 안 함. 공정간 이력은 WorkOrder/WipUnit/WipMovement 로 DB 에 유지 |
| CONSUMABLE | NOT_REQUIRED (BOM 투입 시 REVIEW_REQUIRED) |
| 비활성/단종 | NOT_REQUIRED (재고 잔액 있으면 REVIEW_REQUIRED) |

### 적용 순서 (확정)

`DG-003 LOT 자동채번 정책 확정` → `LOT Policy 최종 승인` → `Master baseline 재정의` → `DG-001 적용(Item.isLotTracked)`.
DG-003 이 미확정이므로 **Production `Item.isLotTracked` 는 변경하지 않는다.** Production write = 0 유지.

### 현재 Master 기준 결과 (READ ONLY, 2026-10-14)

| 품목유형 | REQUIRED | RECOMMENDED | OPTIONAL | NOT_REQUIRED | REVIEW_REQUIRED | 합계 |
|---|---|---|---|---|---|---|
| FINISHED | 134 | 29 | 0 | 0 | 0 | 163 |
| RAW_MATERIAL | 243 | 0 | 21 | 0 | 0 | 264 |
| SEMI_FINISHED / CONSUMABLE | 0 | 0 | 0 | 0 | 0 | 0 |
| **합계** | **377** | **29** | **21** | 0 | 0 | **427** |

변경 제안: `ENABLE_PROPOSED` 406 · `KEEP` 21 · `DISABLE_PROPOSED` 0 · `REVIEW` 0. 현재 Production `isLotTracked` 는 전부 `false` 이며 **이번 Phase 에서 단 한 건도 변경하지 않았다.** Master baseline hash 는 재계산/갱신하지 않았다. 적용 시에는 별도 승인 → dry-run 재실행 → 통제된 일괄 갱신(감사로그) → baseline hash 재정의 절차를 따른다.

### WIP QR 판정: **NOT_REQUIRED_NOW**
- Production 에 SEMI_FINISHED 품목 0건, BOM 구성품 100% RAW.
- 공정간 이동은 WO 당 root WipUnit + WipMovement 로 추적된다(물리 QR 없이도 DB 이력 유지).
- 구조는 준비돼 있다(`WipUnit.lotId`, `LotGenealogy`, 분류기 REVIEW_REQUIRED). 장시간 대기·타 장소 이동·분할·외주 이동·혼입 위험이 실제로 확인되면 그때 지정한다(SOFTWARE_READY).

---

## E. Schema Decision

| 항목 | 결과 |
|---|---|
| Schema Change | **NO** |
| Migration | **NO** |
| Production migration | **NOT APPLIED** |

WHY(스키마를 바꾸지 않은 이유): 위 C절대로 필요한 모든 관계가 이미 FK/참조로 존재한다. BEFORE = AFTER, BACKFILL 없음, ROLLBACK 불필요, PRODUCTION IMPACT 없음.

**권고(별도 승인)**: `ShipmentItem(lotId)` 인덱스가 없다. 출하 LOT 조회(`where lotId in (...)`)는 현재 `ShipmentItem` 풀스캔이다. 출하 데이터가 누적되기 전에 인덱스 1건 추가 migration 을 별도 Phase 에서 검토한다.

---

## F. Raw Material LOT

- 입고 흐름은 기존 그대로(PO → Receiving → Lot → InventoryBalance, 수동/예약 LOT 번호 재사용). **새 채번정책을 만들지 않았다.**
- 입고 화면의 라벨 출력이 LOT 번호를 가진 품목에 대해 **LOT QR 라벨**을 출력한다(품목코드 CODE128 은 비LOT 품목에만 유지).
- QR 식별자는 `lotNo` 를 유지한다(`Lot.id` 로 변경하지 않음).
- **라벨 출력 persistence 게이트(승인 조건 반영)**: 실제 출력은 `Receiving Transaction 성공 → Lot 행 영속화 확인 → LOT 번호 확정 → Label Print` 순서로만 가능하다.
  - 변경 전(재확인 결과): 입고 화면의 "바코드 라벨 출력"이 입고 확정 **전에** 실제 인쇄를 허용했다(예약 번호를 `printedAt` 로 소모) → 입고 실패/취소 시 존재하지 않는 LOT QR 이 현장에 남을 수 있었다.
  - 변경 후: ① 확정 전에는 **미리보기 전용**(인쇄 버튼 비활성, 안내 문구), 예약 번호를 "출력됨"으로 소모하지 않음 ② `createReceivingInspection` 이 트랜잭션 커밋 후 **DB 에서 Lot 행을 다시 조회**해 존재할 때만 `lotNo` 를 반환 ③ 입고 확정 성공 후 그 `lotNo` 로만 라벨 창이 열림 ④ 서버 `recordLotLabelPrint` 가 Lot 행이 없는 번호가 하나라도 있으면 `LOT_NOT_PERSISTED` 로 **전체 거부**(감사 기록도 없음) — UI 를 우회해도 막힘. 완제품 입고도 입고 성공 후에만 출력된다.
- LOT 조회: `lookupLotByQr` → 품목/LOT/상태/가용수량/창고.

---

## G. WorkOrder Material Genealogy

- Source of Truth = `WorkOrderMaterialLot` + `InventoryTransaction(ISSUE)`(기존 자재출고가 이미 기록). 값을 복사하는 새 테이블 없음.
- 자재출고에서 Raw LOT QR 을 스캔하면 **서버가 내려준 출고 후보(ACTIVE · 가용재고 > 0)** 에서 LOT 를 선택해 줄 뿐이며, 제출 시 `issueMaterialsForWorkOrder`(Phase 10 DG-014 검증: 로그인/tenant/작업지시 상태/BOM+대체품/LOT 품목·상태/가용수량/예약 소유)가 다시 검증한다. **QR 이 검증을 우회하지 않는다.**
- 동일 LOT 재스캔·연속 인식은 중복 행을 만들지 않는다(`planLotScanSelection` ALREADY_SELECTED).

---

## H. Finished LOT

- 완제품입고 서버 액션은 기존 그대로 LOT 를 발번(`createFinishedGoodsLot`)하고 `FinishedGoodsReceipt(workOrderId, lotId)` 를 남긴다 — WorkOrder provenance 가 끊기지 않는다.
- 입고 성공 응답의 `lotNo` 로 **입고 직후 완제품 LOT QR 라벨 출력 창**이 열린다(LOT 생성 이후에만 라벨 의미가 있으므로). 입고 완료 후에는 입고 버튼이 비활성화되어 중복 입고를 막는다.
- 라벨 문구: 대원정밀 / 제품명 / 품목코드 / LOT / 생산일 / 수량 / QR. QR 에는 식별자만 담긴다.

---

## I. QR Standard

| 항목 | 값 |
|---|---|
| Payload | `DAEWON\|LOT\|1\|<encodeURIComponent(lotNo)>` (예: `DAEWON\|LOT\|1\|CNS-20261014-001`) |
| 식별자 | `Lot.lotNo` — tenant 내 unique, 생성 후 변경 코드 없음 |
| 결정성 | 같은 LOT → 항상 같은 문자열(재출력해도 동일, 새 LOT 미생성) |
| 포함하지 않는 것 | 수량 · LOT 상태 · 공급업체 · 품명 · 검사결과 · 작업자 · 비밀값 · 개인정보 |
| 위조 방지 | **아님** — untrusted input. tenant/권한/상태는 항상 서버가 재검증 |
| Parser | `src/lib/qr/lot-qr.ts` — 단일 모듈(`parseLotQr`, `classifyScanInput`). 화면별 복붙 없음 |
| 거부 | 빈 값 · 256자 초과 · prefix 불일치 · 미지원 version/entity · 형식 오류 · 식별자 128자 초과/제어문자 |
| 수동/레거시 | 평문 LOT 번호(MANUAL_TEXT) 허용, 기존 `{itemCode}\|{lotId}` 는 품목 행 강조 용도로만 해석하고 LOT 확정에 쓰지 않음 |

---

## J. Tablet Camera

`src/components/common/barcode/camera-qr-scanner.tsx` (공통 컴포넌트 1개) + `lot-scan-dialog.tsx`(조회/결과 표시).

| 요구 | 구현 |
|---|---|
| HTTPS / 권한 | `isSecureContext`·`getUserMedia` 검사, 거부/미지원/HTTP 시 안내 + 수동 입력 |
| 후면 카메라 우선 | `facingMode: { ideal: "environment" }` |
| 카메라 목록 | `enumerateDevices` + 선택 |
| Start/Stop | 버튼. **정지/언마운트/탭 숨김 시 모든 MediaStream track `stop()`** |
| 디코더 | `BarcodeDetector`(qr_code) → 없으면 `jsQR` 동적 import 폴백(네이티브 앱 없음) |
| 성공/실패 피드백 | 테두리 색 + 진동 + 서버 결과 문구 |
| 중복 방어 | 같은 값 2초 디바운스 · 처리 중 재스캔 무시 · 연속 스캔 옵션 |
| 수동 입력 | LOT 번호/QR 문자열 직접 입력 |
| Touch UI | 버튼 높이 44px 이상, 본문 14~15px |

적용 화면: 자재출고 · 출하 · 완제품입고(품목 확인) · LOT 추적 · POP(자재 LOT 확인). **상태: SOFTWARE_READY / FIELD_TEST_REQUIRED**

---

## K. Label Printing

- 실제 출력은 **LOT 행이 DB 에 영속화된 뒤에만** 가능(F절 게이트). 미리보기는 언제든 가능.
- 브라우저 인쇄(`react-to-print`) — 프린터 제조사 SDK 비종속. 라벨 규격은 코드에 고정하지 않고 CSS 변수(mm)로 조정: `--label-width`(기본 62mm), `--label-qr-size`(기본 22mm), 다이얼로그 prop `labelWidthMm/qrSizeMm`.
- 라벨: 대원정밀 / 품명 / 품목코드 / LOT / 입고일(생산일) / 수량 / QR. 재출력은 "재출력" 표시.
- 적용 위치: 자재입고(입고일) · 완제품입고 완료(생산일) · LOT 목록의 "라벨" 버튼(재출력 모드).
- **상태: SOFTWARE_READY / FIELD_TEST_REQUIRED** (실제 프린터·용지 규격·여백·해상도).

---

## L. Material Issue Scan

흐름: 작업지시 선택 → [카메라] 또는 USB 스캐너/수동 입력 → `BarcodeScanInput` → 중앙 파서 → 출고 후보에서 선택 → **제출 시 서버 재검증**.

- 후보에 없는 LOT 는 `lookupLotByQr(purpose=MATERIAL_ISSUE, workOrderId)` 가 이유를 알려준다: 격리/보류/소진/만료, 가용재고 없음, BOM 구성품 아님, 타 작업지시, 품목 불일치.
- 스캔 자체는 DB write 0 (SCAN-08 / SCAN-10 로 검증).

---

## M. Shipment Scan

흐름: 수주/창고 선택 → 완제품 LOT QR 스캔 → 서버가 내려준 출하 가능 LOT(ACTIVE) 중 선택 + 수량 자동 제안(`min(가용, 수주 잔량 − 다른 행 배분)`) → 저장/확정 시 `createShipment`/`confirmShipment` 가 다시 검증(LOT 상태 ACTIVE, 품목 일치, 가용수량 예약 합산, 품질 게이트).

- 부분출하·다중 LOT/단일 Shipment·단일 LOT/다중 Shipment 로직은 변경하지 않았다(Phase 9 PASS 유지).
- 수주 품목이 아닌 LOT/사용 불가 LOT 는 사유와 함께 거부된다.

---

## N. Forward Trace (Raw LOT → Customer) — **FULL (WorkOrder-level genealogy)**

`traceRawLot(lotNoOrQr)` — 한 번의 Server Action. 결과(DTO): `nodes`(SUPPLIER · PURCHASE_ORDER · RAW_LOT · WORK_ORDER · PRODUCTION_PLAN · FINISHED_LOT · SHIPMENT · CUSTOMER), `edges`(SUPPLIES · RECEIVED_AS · CONSUMED_BY · PRODUCED · GENEALOGY · SHIPPED_IN · DELIVERED_TO · PLANNED), `workOrders`(공정/설비/작업자/실적/검사), `missing`.
Raw LOT → 공급사/발주 → 투입 WO(여러 개) → 공정/설비/작업자/검사 → 완제품 LOT(여러 개) → 출하(여러 건) → 고객.

## O. Reverse Trace (Customer/Finished LOT → Supplier) — **FULL (WorkOrder-level genealogy)**

`traceFinishedLot(lotNoOrQr)` / `traceShipment(shipmentNo)` — 출하 → 완제품 LOT → WO → 공정/작업자/설비/검사 → **투입 원자재 LOT → 입고(PO) → 공급사**.
(Phase 9 의 `Reverse Trace = BROKEN` → **FULL (WorkOrder-level genealogy)**. DG-006/007 해소. FULL 의 정의와 한계는 C절 Limitation 참조 — Finished-Lot-level material quantity allocation is not implemented.)

화면: 기존 `/app/mes/traceability`(LOT 추적 조회)를 확장 — QR 스캔 버튼 + 정방향/역방향 토글 + 공급사·입고 / 작업지시·공정·설비·작업자·품질 / 완제품 LOT·출하·고객 / 누락 구간 패널. (신규 화면 없음.)

---

## P. Quality / Worker / Equipment Trace

| 항목 | 결과 | 비고 |
|---|---|---|
| Quality | **PASS** | `QualityInspection` → WO 공정 → LOT. LOT 직접 귀속 / 작업지시 단위 귀속을 구분 표시. **InspectionSpec 이 없어도 실적을 rollback 하지 않고 "검사 이력 없음"을 known missing 으로 표현**(Phase 10 DG-031 정책 유지) |
| Worker | **PASS**(데이터 존재 시) | `ProductionResult.operatorId` → Profile. 작업자 없는 실적은 known missing |
| Equipment | **SOFTWARE_READY / MASTER_DATA_REQUIRED** | Production 설비 마스터 0건(Phase 9 DG-002). 연결 구조는 구현·검증됨, 설비 에이전트는 범위 밖 |

데이터가 없는 구간은 Trace 전체를 깨뜨리지 않고 `missing[]`(`SUPPLIER · WORK_ORDER · ROUTING · EQUIPMENT · OPERATOR · INSPECTION · SHIPMENT`)로 표현한다.

---

## Q. Security

| 항목 | 구현 / 검증 |
|---|---|
| 인증 | `lookupLotByQr` · `recordLotLabelPrint` · `trace*` 모두 `requireReadActor`(Phase 10 가드). 비인증 → UNAUTHORIZED, DB write 0 |
| tenant | 모든 조회가 세션 tenantId 로 한정. 클라이언트 tenantId 인자 없음. 다른 tenant 의 같은 lotNo 문자열이 있어도 세션 tenant 의 LOT 만 해석 |
| IDOR/존재 노출 | 타 tenant LOT 와 존재하지 않는 LOT 가 **동일한 일반 메시지** "LOT을 찾을 수 없거나 접근할 수 없습니다." |
| 교차 tenant 간선 | 다른 tenant LOT 로 향하는 `LotGenealogy` 가 있어도 tenant 필터로 노드에서 제외(변이 테스트로 확인) |
| 권한 | 스캔은 읽기 권한(LOT/INVENTORY/WORK_ORDER/WORK_RESULT/SHIPMENT/PURCHASE_ORDER 중 하나). 업무 mutation 은 기존 액션의 권한 그대로(VIEWER 는 스캔 후에도 자재출고 불가 — SCAN-10) |
| QR 로 mutation 금지 | QR/URL 에 action 파라미터 없음. 스캔=식별, 업무 버튼=권한+검증+mutation |
| POP | POP 작업자 세션/OPERATOR 세션 + 작업 사업장 일치 확인. 투입 mutation 없음(기존: 자재출고는 자재출고 화면) |
| Phase 10 정적 가드 스캔 | 신규 server action 포함 527개 export 가드 스캔 PASS(헬퍼를 `authorize*` 로 명명하고 각 export 가 직접 호출) |

---

## R. Audit / Reprint

| 이벤트 | 기록 |
|---|---|
| LOT_CREATE | `Lot` / CREATE / `afterData.event="LOT_CREATE"` (수동 생성) |
| LOT_STATUS_CHANGE | Phase 10 (`Lot` / UPDATE before/after) |
| LABEL_PRINT / LABEL_REPRINT | `LotLabel` / CREATE / `afterData={ event, lotNo, printCount, reason, qrPayload, lotStatus }` — **최초/재출력은 서버가 이전 이력으로 판정**(클라이언트 값 불신) |
| MATERIAL_ISSUE · FINISHED_RECEIPT · SHIPMENT | 기존 감사 로그 그대로(`MaterialIssue`, `FinishedGoodsReceipt`, `ShipmentOrder`) |

`AuditAction` enum 에 PRINT 가 없다. enum 변경은 migration 이 필요하므로 새 테이블/enum 을 만들지 않고 `entityType="LotLabel"` + `afterData.event` 로 표현했다. 새 PrintHistory 테이블 없음. 재출력은 새 LOT/QR 을 만들지 않으며 계보(WorkOrderMaterialLot/FinishedGoodsReceipt/LotGenealogy)를 변경하지 않는다(QR-08, PROP-07).

LOT 상태가 사용 가능 여부의 기준이다(ACTIVE만 출고/출하 가능; QUARANTINE · ON_HOLD · CONSUMED · EXPIRED 차단). 현재 enum 에 `CANCELLED` 는 없으므로 임의 상태를 추가하지 않았다. 물리 라벨 회수는 불가능하므로 라벨이 아니라 MES 상태로 통제한다.

---

## S. Tests

`npm run test:phase11-lot-qr` — **142 assertions PASS** (실제 서버 모듈 + 메모리 fake DB, DB 접속 없음).

| 그룹 | 항목 |
|---|---|
| QR | QR-01 valid · 02 prefix · 03 version · 04 malformed · 05 length · 06 other entity · 07 deterministic · 08 reprint same QR · 09 mutable data 미포함 · 10 분류기 |
| Scan | SCAN-01 비인증 · 02 cross-tenant(+응답 동일성) · 03 invalid/legacy · 04 만료 · 05 HOLD/QUARANTINE · 06 소진/재고0 · 07 wrong item/BOM 아님/타 tenant 작업지시 · 08 중복 스캔(write 0, 디바운스, 중복 선택 방지) · 09 허용 스캔 · 10 권한 없는 mutation 거부 |
| POP | POP-01~04 (비인증, 적합/부적합, DB write 0, 타 tenant 거부) |
| Raw 계보 | TRACE-R01~R08 (입고→LOT, 재고, 투입, WO, 1 LOT→N WO, 1 WO→N LOT, 부분소진, 잔량 보존) |
| 완제품 계보 | TRACE-F01~F08 (WO→입고→FG LOT, FG→WO, FG→Raw, 1 WO→N FG, 부분출하, N FG→1 출하, 1 FG→N 출하) |
| Forward/Reverse | TRACE-01 FULL · 02 FULL · 03 N raw→1 FG · 04 1 raw→N FG · 05 부분출하 · 06 불량 WO · 07 InspectionSpec 없음 · 08 공정/설비 없음 |
| Property | 타 tenant 노드 0 · edge 양끝 존재 · 결정성 · cycle 종료 · 중복 집계 없음 · 추적 write 0 · 출하/재출력이 생산수량/계보 불변 |
| Policy | POLICY-01~08 (분류, DB 접근 코드 없음) |
| Audit | REPRINT-01~06 (미존재 LOT 가 섞이면 전체 거부 · 감사 기록 없음) |
| 라벨 게이트 | LABEL-01 Lot 생성 실패 → print 불가 · 02 Lot 영속화 후 print 가능 · 03 reprint 동일 QR · 04 취소/미존재 LOT print/reprint 차단 · 05 입고 화면 미리보기 전용/서버 영속화 재확인 |

변이 검증: 추적 서비스의 tenant 필터를 일부러 제거하면 PROP-01 이 실패함을 확인한 뒤 복원했다.

### 회귀 (전체 `test:*` + `check:server-actions`, 53개 스크립트)

- Phase 10 보안: **122 assertions PASS** (신규 server action 포함 정적 가드 스캔 통과)
- MRP Phase 1~8 · 수주/발주/입고/재고/생산계획/작업지시/POP/품질/출하: Phase 10 최종 상태와 동일
- 기존 baseline failure 10건은 Phase 10 최종 및 Phase 9 baseline 과 **동일한 목록**(신규 failure 0): `role-permission-enforcement`, `cause-analysis`, `corrective-action`, `report-output`, `production-plan-workorder-integrity`, `bom-material-sufficiency`, `inventory-concurrency-integrity`, `pop-tool-usage-integrity`, `f22-browser-smoke`, `f25-master-menu-cleanup-integrity` — Phase 11 변경과 무관(정적 소스 패턴/누락 파일 fixture 등 기존 문제).
- 전체 스크립트 53개: **43 PASS / 10 FAIL(위 baseline 10건과 동일, 신규 failure 0)**.
- Type check **PASS** · Lint **error 0**(기존 warning 1건 동일) · Build **PASS**(`next build`, DB URL 더미 — 139 페이지; `/app/mes/lot` First Load 209→236 kB(QR 생성 라이브러리), `/app/mes/traceability` 101→122 kB).

---

## T. Performance

픽스처: Raw LOT 100 · WorkOrder 100 · MaterialIssue 500 · Finished LOT 100 · Shipment 100, 완제품 LOT 100개를 시작점으로 역추적.

| 규모 | LOT | WO | 투입 | 출하 | 쿼리 수 | 시간(메모리 DB) |
|---|---|---|---|---|---|---|
| N=10 | 20 | 10 | 50 | 10 | **26** | 0ms |
| N=100 | 200 | 100 | 500 | 100 | **26** | 8ms |

- **쿼리 수가 데이터 규모와 무관(N+1 없음)** — 단계(depth)마다 테이블별 1회 `in` 배치. 노드별 조회·UI 컴포넌트별 DB 호출 없음, 무제한 중첩 include 없음(필요 컬럼만 select 하는 flat 조회), 상한(LOT 500/WO 200/depth 6, `truncated` 플래그).
- 실시간 DB 지연은 포함되지 않은 수치다. 인덱스: `WorkOrderMaterialLot(tenantId, materialLotNo)`, `FinishedGoodsReceipt(lotId/workOrderId)`, `InventoryTransaction(lotId)` 등 사용; **`ShipmentItem.lotId` 인덱스 없음**(E절 권고).

---

## U. Field Test Required (코드 FAIL 이 아님)

| 장치 | 코드 | 현장 확인 |
|---|---|---|
| Tablet Camera | SOFTWARE_READY | 초점 · 인식 거리 · 조명 · QR 크기 · 오염/기름 · 세로/가로 · 장갑 UX · Samsung Internet/Chrome 의 BarcodeDetector/폴백 동작 |
| Label Printer | SOFTWARE_READY | 용지 규격(`--label-width`/`--label-qr-size`) · 여백 · 해상도 · 컷/연속 출력 · 대비 · 브라우저 인쇄 대화상자 흐름 |
| HTTPS | Vercel 제공 | 카메라 권한은 HTTPS 필수 — 사내망 HTTP 접속 시 수동 입력 폴백 |

---

## V. Production Impact

| 항목 | 값 |
|---|---|
| Production Master write (Item/BOM/…) | **0** (`isLotTracked` 포함 변경 없음) |
| Production Transaction write | **0** |
| Production migration | **NOT APPLIED** (migration 자체가 없음) |
| Production 접속 | LOT 정책 dry-run 1회 — `SET TRANSACTION READ ONLY` 트랜잭션 + SELECT |
| 빌드 | DB URL 을 더미로 덮어 Production 연결 차단 |
| 배포/merge/push | 없음 |

배포 시 영향: 신규 QR 라벨 출력, 카메라 스캔 UI, 추적 패널, LOT 라벨 감사(AuditLog 행 증가 — 출력 클릭당 LOT 1행). 스키마/데이터 변경 없음.

---

## W. Remaining GAP

| 구분 | 항목 | 내용 |
|---|---|---|
| **P0** | DG-001 적용 | LOT 정책 **제안은 완료**. 적용은 **DG-003 채번정책 확정 → LOT Policy 최종 승인 → Master baseline 재정의 → 적용** 순서. 미적용 상태에서는 비LOT 품목의 LOT 계보가 생성되지 않는다 |
| P0 | DG-002 | 라우팅/설비/작업장 마스터 데이터(설비 추적은 MASTER_DATA_REQUIRED) |
| P1 | DG-003 | LOT/제조번호 자동채번 규칙 미확정(수동/예약 번호 운영은 가능) — **DG-001 적용의 선행 조건** |
| P1 | Phase 10 validation | Preview black-box(Vercel 보호 + Preview DB 분리) 보류 — Phase 10 COMPLETE 아님 |
| P2 | DG-019 | 입고검사 ↔ LOT FK 없음(스키마 변경 필요) |
| P2 | `ShipmentItem(lotId)` 인덱스 | 대량 출하 이력 시 조회 성능 |
| P2 | 계보 정밀도 | WorkOrder-level genealogy — Finished-Lot-level material quantity allocation is not implemented(필요 시 별도 고도화) |
| P2 | 재출력 승인 | 재출력은 사유+감사만, 승인 워크플로 없음 |
| P2 | 오프라인 | 네트워크 단절 시 스캔 확정/큐잉 없음(명확한 오류만) — 별도 Phase |
| P2 | 중복 제출 idempotency | 자재출고 "처리 중" 버튼 잠금은 기존 `isPending`; 서버 idempotency key 는 스키마 필요 → 보류 |
| P3 | 유지 | DG-024(공개 현황판 액션), DG-017(운영 계정 정리), WAF, Backup/PITR, 중간공정 재작업 re-routing, 설비 연동, KPI, 검교정 |
