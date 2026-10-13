# DAEWON MRP Phase 5-0 — 공급업체 / 발주 / 입고예정 구조 설계 조사

| 항목 | 내용 |
|---|---|
| 기준 commit | `f203e3b` (main) |
| 성격 | **설계 조사 전용** — 코드·schema·migration·DB 변경 없음. 이 문서 1개만 생성 |
| 근거 표기 | 실제 `prisma/schema.prisma`와 `src/**` 코드 확인 사항만 기재. 추정은 **[추정]** 으로 표시 |
| 운영 DB | 수주·품목·BOM·재고 0건(조회하지 않음). 분석에는 영향 없음 |

---

## 0. 요약

1. **품목↔공급업체 관계가 현재 schema에 없다.** `Item`에 공급업체 필드가 없고, 유일한 연결은 가격표 `ItemPrice`(+PO 이력)이다. `ItemPrice`는 기본 공급업체·우선순위·리드타임·MOQ·배수를 표현할 수 없고, 대원정밀 메뉴 범위 밖(개발자 계정 전용)이다.
2. **권장: 신규 `ItemSupplier` 관계 모델**(안 B). 가격 이력은 기존 `ItemPrice`에 남긴다.
3. **미입고 수량의 Source of Truth = `PurchaseOrderItem.qty − receivedQty`**(행 잠금으로 갱신되는 단일 원장). `ReceivingInspection`/`InventoryTransaction`은 대조용.
4. **입고예정일은 `PurchaseOrder.expectedDate`(헤더, NOT NULL, 품목별 없음)** 만 존재한다. 따라서 "ETA 없는 PO"는 구조적으로 없고 대신 **MRP가 만든 DRAFT의 +14일 임의 날짜**와 **예정일 경과 PO**가 실제 위험이다.
5. **시간축 확장은 기존 엔진에 "입고 이벤트"를 추가하는 방식(additive, 기본 OFF)** 으로 가능하며 Excel Golden을 깨지 않는다.
6. **필요한 migration은 2건**(5A `ItemSupplier`, 5D `Item.safetyStock`). 5B/5C/5E는 schema 변경 없이 가능하다.
7. 조사 중 발견한 선결 이슈: PO 채번 999 초과 오류, `CLOSED` 상태 설정 UI 부재, `ItemPrice` 액션의 tenant 소유 검증 누락, 외주발주(OS-)가 같은 테이블에 섞여 있음 → §Y.

---

## A. 현재 Supplier 구조

공급업체 전용 모델은 없고 `BusinessPartner`(거래처)를 `partnerType`으로 구분한다.

| 모델 | 필드(실제) | tenant | 공급업체 참조 | 가격/통화 | 리드타임 | MOQ/배수 | 기본/우선 | 유효기간 | 활성 |
|---|---|---|---|---|---|---|---|---|---|
| `BusinessPartner` | id, tenantId, code, name, partnerType(`CUSTOMER/SUPPLIER/BOTH`), status(`ACTIVE/INACTIVE`), 연락처류 | ✔ `@@unique([tenantId, code])` | — | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ status |
| `Item` | tenantId, code, name, itemType, uom, spec, status, defaultWarehouseId … | ✔ | **✘ (공급업체 필드 없음)** | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ status |
| `ItemPrice` | tenantId, itemId, partnerId, priceType(String: `PURCHASE/SALES`), unitPrice, currency, effectiveFrom, effectiveTo?, note | ✔ (unique 없음) | ✔ `partnerId` | ✔ | ✘ | ✘ | ✘ | ✔ | ✘ |
| `PurchaseOrder` | tenantId, siteId, supplierId, orderNo, orderDate, expectedDate, status … | ✔ `@@unique([tenantId, orderNo])` | ✔ | totalAmount, currency | ✘ | ✘ | — | — | status |
| `PurchaseOrderItem` | purchaseOrderId, itemId, workOrderOperationId?, qty, unitPrice, receivedQty, stockAtOrder | (헤더 경유) `@@unique([purchaseOrderId, itemId])` | (헤더) | unitPrice | ✘ | ✘ | — | **품목별 날짜 없음** | — |
| `ReceivingInspection` | purchaseOrderItemId, receivedQty, acceptedQty, rejectedQty, result, inspectedAt | (경유) | — | ✘ | — | — | — | — | — |
| `MaterialReturn(+Item)` | supplierId, purchaseOrderId?, status, returnQty … | ✔ | ✔ | ✘ | — | — | — | — | — |
| `InventoryTransaction` | txType(RECEIPT/ISSUE/…/SUPPLIER_RETURN), qty, refType, refId, txAt | ✔ | ✘ | ✘ | — | — | — | — | — |

- 안전재고/리드타임/MOQ/발주배수 필드는 **schema 어디에도 없다**(`safety|leadTime|moq|reorder` 전수 검색 결과 KPI 화면 문자열만 존재).
- 공급업체 관리 화면: `/app/mes/vendors`(`getBusinessPartners("SUPPLIER")`, 대원정밀 허용 라우트). `getSuppliers()`(발주 폼용)는 **status 필터가 없다**(반품 화면은 ACTIVE만).

## B. 품목 ↔ 공급업체 현재 관계

| 질문 | 조사 결과 |
|---|---|
| 직접 관계 | **없음** |
| `ItemPrice` 성격 | 가격표. 공급업체와 품목을 잇는 행이지만 "관계의 속성(기본/우선/리드타임/MOQ)"을 담을 곳이 없음 |
| 한 품목 여러 공급업체 | 가능(행을 여러 개 만들면 됨) |
| 기본 공급업체 표현 | **불가** (`isDefault`/`priority` 없음) |
| unique | **없음** — 같은 (item, partner, type) 중복 행 허용, 유효기간 겹침 검증 없음 |
| 가격 이력 | `effectiveFrom/To`로 가능. 발주 시 `getItemPrice()`가 `effectiveFrom desc` 1건 사용 |
| 대원정밀 사용성 | `/app/mes/item-prices`는 **대원정밀 허용 라우트에 없고**, 액션은 `assertDaewonFeatureScope()`로 **개발자 계정만** 통과 → 일반 사용자는 입력할 수 없음 |
| 보안 | `updateItemPrice/deleteItemPrice`는 id만으로 수정/삭제(**tenant 소유 검증 없음**), `createItemPrice(tenantId, …)`는 클라이언트 tenantId·itemId·partnerId를 검증 없이 사용 → 별도 FIX 후보 |
| Excel V09 | `설정!E 거래처명`(자재당 1개 문자열, 20개 업체). 이관 시 "품목당 기본 공급업체 1개"에 대응 |

→ **기존 `ItemPrice`만으로는 부족하다**: ① 기본/우선 표현 불가 ② 공급업체별 LT/MOQ/배수를 가격 이력 행마다 중복 저장해야 함 ③ 대원정밀 UI 범위 밖 ④ 유일성 규칙 없음.

## C. 권장 공급업체 모델 비교

| 기준 | 안 A `Item.defaultSupplierId` | 안 B `ItemSupplier` 관계 모델 | 안 C `ItemPrice` 확장 |
|---|---|---|---|
| 구조 | Item에 FK 1개 | (tenant,item,supplier) 관계 행 + 속성 | ItemPrice에 isDefault/priority/LT/MOQ 컬럼 추가 |
| 복수 공급처 | ✘ (후보 불가) | ✔ priority | △ 가격 행 단위로만 |
| 공급업체별 LT/MOQ/배수 | ✘ (Item 수준 단일값) | ✔ | △ 가격 이력 행마다 중복 |
| 가격 이력 | ItemPrice 그대로 | ItemPrice 그대로(역할 분리) | 이력과 관계가 한 테이블에 혼재 |
| 거래처 변경 | FK 교체(이력 없음) | 행 비활성/우선순위 교체 | 새 가격 행 + 플래그 정리 |
| migration 영향 | Item 컬럼 1개 | 신규 테이블 1개(기존 데이터 영향 없음) | 기존 테이블에 컬럼 4~5개 + 기존 행 backfill |
| 기존 코드 영향 | Item 폼/업로드/삭제 참조 체크 | 기존 코드 변경 거의 없음(신규 모듈) | ItemPrice 폼/액션/화면 전면 |
| 품목 Excel 업로드 | 컬럼 1개 추가 | 별도 "품목-공급업체" 업로드(Phase 7) | ItemPrice 업로드 신설 |
| MRP 사용성 | 기본 공급업체만 | 기본 + 대체 후보 + 속성 | 가능하나 조회가 복잡 |
| 한계 | 확장 시 결국 B 필요(이중 마이그레이션) | 입력 화면 신설 필요 | 의미가 흐려져 유지보수 곤란 |

**최종 권장: 안 B (`ItemSupplier`)** — 공급업체별 속성(LT/MOQ/배수)이 관계에 속한다는 점, 안 A는 결국 B로 재작업, 안 C는 가격 이력과 관계가 뒤섞이기 때문. 가격은 당분간 기존 `ItemPrice`(PURCHASE)를 읽기 전용으로 재사용한다.

제안 모델(실제 구조 기준):

```prisma
model ItemSupplier {
  id            String   @id @default(cuid())
  tenantId      String
  itemId        String
  supplierId    String            // BusinessPartner (SUPPLIER|BOTH)
  isDefault     Boolean  @default(false)
  priority      Int      @default(1)
  leadTimeDays  Int?              // null = 미등록
  moq           Decimal? @db.Decimal(18, 6)
  orderMultiple Decimal? @db.Decimal(18, 6)
  supplierItemCode String?        // 공급사 품번(선택)
  isActive      Boolean  @default(true)
  note          String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([tenantId, itemId, supplierId])
  @@index([tenantId, itemId])
  @@index([supplierId])
}
```

- 기본 공급업체 유일성: `(tenantId, itemId) WHERE isDefault AND isActive` **partial unique index**를 migration SQL에 직접 추가하고(Prisma schema로 표현 불가 → drift 주의), 서비스에서도 트랜잭션 내 교체 로직으로 보장.
- 단가는 `ItemSupplier`에 넣지 않는다(이력은 `ItemPrice`).

## D. 현재 PurchaseOrder 구조

| 항목 | PurchaseOrder | PurchaseOrderItem |
|---|---|---|
| 상태 | `status` enum | — |
| 발주수량/단가 | `totalAmount?`, `currency` | `qty`, `unitPrice`(NOT NULL), `stockAtOrder` |
| 입고수량 | — | `receivedQty`(기본 0) |
| 잔량 | (계산) | `qty − receivedQty` — **저장 필드 없음** |
| 발주일 | `orderDate`(NOT NULL) | — |
| 납기/입고예정일 | **`expectedDate`(NOT NULL, 헤더만)** | **없음** |
| 공급업체 | `supplierId`(NOT NULL) | — |
| site / warehouse | `siteId`(NOT NULL) / (창고는 입고 시 선택, PO에는 없음) | — |
| 취소/완료 | `CANCELLED`, `CLOSED` 상태 | — |
| 기타 | `note`, `orderNo`(tenant unique) | `workOrderOperationId?`(외주), `note`; `@@unique([purchaseOrderId, itemId])` |

## E. PO Status 흐름

`enum PurchaseOrderStatus { DRAFT, ORDERED, PARTIAL_RECEIVED, RECEIVED, CLOSED, CANCELLED }`

```
DRAFT ──(사용자: 발주완료)──▶ ORDERED ──(입고 합격 일부)──▶ PARTIAL_RECEIVED ──(전량)──▶ RECEIVED
  │                              │
  └──(사용자: 취소)──▶ CANCELLED ◀┘            CLOSED = enum 만 존재 (UI 에서 설정 불가)
```

- 상태 머신 **없음**: `updatePurchaseOrder`는 어떤 상태든 `data.status`로 덮어쓴다. UI는 `DRAFT/ORDERED/CANCELLED`만 제공(입고 후 상태는 자동).
- 자동 전환은 `createReceivingInspection`에서만(`RECEIVED`/`PARTIAL_RECEIVED`).
- 품목 수정·삭제는 DRAFT만, 입고/반품/외주 이력이 있으면 품목 재구성·공급사 변경 차단.
- **PARTIAL_RECEIVED 상태의 잔량을 종결하는 UI가 없다**(CLOSED 설정 불가, CANCELLED는 의미상 부적절).

**MRP 입고예정 인정 매핑**

| 상태 | 입고예정 인정 | 이유 |
|---|---|---|
| DRAFT | ✘ | 확정 전(임시, MRP가 만든 DRAFT 포함) |
| **ORDERED** | **✔** | 발주 확정 |
| **PARTIAL_RECEIVED** | **✔ (잔량만)** | 일부 입고, 잔량 대기 |
| RECEIVED | ✘ | 잔량 0 |
| CLOSED | ✘ | 종결(잔량 있어도 미인정) |
| CANCELLED | ✘ | 취소 |
| 외주발주(`OS-`/`[OUTSOURCING]`/`workOrderOperationId≠null`) | ✘ | 자재가 아닌 외주 공정 WIP(별도 흐름) |

## F. 입고 / 부분입고 구조

실제 코드(`receiving.actions.ts`):

```
PurchaseOrderItem ─(입고검사 1건/회)─▶ ReceivingInspection(receivedQty, acceptedQty, rejectedQty)
   └ receivedQty += acceptedQty (합격분만, FOR UPDATE 잠금)
   └ acceptedQty > 0 이면 InventoryBalance 증가 + InventoryTransaction(RECEIPT, refType=PURCHASE_ORDER, refId=PO.id)
   └ PO.status 자동 갱신 (전부 receivedQty ≥ qty → RECEIVED, 일부 → PARTIAL_RECEIVED)
```

- 부분입고 ✔: PO 100 → 입고 40 → `receivedQty=40`, 잔량 60, `PARTIAL_RECEIVED`. 여러 번 분할 가능, 잔량 초과 입고 차단.
- **불합격(rejected) 수량은 `receivedQty`에 포함되지 않아 잔량에 남는다**(재납품 대기로 해석). 입고수량 검증은 `receivedQty(입고 전체) ≤ 잔량`.
- 입고 취소/수정 액션은 **없다**(append-only). 정정은 재고조정(`ADJUST`)·자재반품으로 하며, **반품은 PO/입고 이력을 수정하지 않는다**(`material-return.actions.ts` 주석: read-only 원장). 따라서 반품 후에도 `receivedQty`는 그대로 → 반품된 물량이 미입고로 되살아나지 않는다.
- 외주입고(`outsourcing.actions.ts:450`)도 `receivedQty`를 증가시키지만 `ReceivingInspection`/`RECEIPT` 트랜잭션은 만들지 않는다.

## G. 미입고 수량 Source of Truth

| 후보 | 평가 |
|---|---|
| **A. `PurchaseOrderItem.qty − receivedQty`** | ✔ **채택.** 입고 트랜잭션에서 행 잠금과 함께 갱신되는 단일 원장. 외주 포함 모든 입고 경로가 이 값을 갱신 |
| B. `Σ ReceivingInspection.acceptedQty` | 자재 PO에서는 A와 일치해야 하나 외주 입고는 기록이 없어 불완전 → **대조(정합성 점검)용** |
| C. `InventoryTransaction(RECEIPT)` 합계 | `refId`가 PO 헤더 id라 품목 단위 집계가 불안정, 외주 미생성 → **대조용** |
| D. 기존 서비스(`calculateMRP`의 onOrder) | 같은 A 공식이나 **외주발주를 제외하지 않음**, tenant 조건은 Phase 2.5에서 보강 |

중복 차감 위험 점검

| 시나리오 | 결과 |
|---|---|
| 입고된 수량이 재고와 입고예정에 이중 반영 | ✘ 없음: 입고되면 `receivedQty`↑(잔량↓) 와 `qtyAvailable`↑가 같은 트랜잭션 → 잔량만 예정에 사용 |
| 격리 LOT로 입고된 수량 | 잔량에서는 빠지고(입고됨) 가용재고에서도 제외(Phase 2 정책) → 어느 쪽에도 안 잡힘 = 정책상 의도(사용 불가) |
| 입고 후 반품 | 재고↓, 잔량 불변 → 정확 |
| 불합격 | 잔량에 남음 → 재납품 기대로 계산(필요 시 경고) |
| 외주발주 | 제외해야 함(자재 아님) |
| 잔량이 영구히 남는 PARTIAL | 종결 수단 필요(§Y) |

## H. 입고예정일 Source

- **`PurchaseOrder.expectedDate`** (DateTime, NOT NULL, 헤더). 품목별 ETA·분할 납품 일정 **없음** → 같은 PO의 모든 잔량은 같은 날짜로 본다.
- UI는 이미 "예정일 경과"(`expectedDate < 오늘` 이면서 CLOSED/CANCELLED 아님)를 계산해 표시한다.
- 날짜 변환: `toDateOnly(date, 'Asia/Seoul')` (Phase 3 정책 재사용).
- **MRP 생성 DRAFT의 `expectedDate = 생성일 + 14일`(`mrp-purchase.service.ts`)** 은 사용자가 정한 값이 아니다. 발주완료 전환 시 수정하지 않으면 임의 날짜가 ETA로 굳는다 → Phase 5C에서 사용자 확인 필수.

## I. 시간축 MRP (Scheduled Receipt) 알고리즘

현재(Phase 1~4): `openingStock → 수요 순차 차감`. 확장: **자재별 이벤트 타임라인**.

```
events(m) = { 입고예정(date, qty, 출처 PO) } ∪ { 수요(date, qty, 수주 라인) }
정렬: date ASC → 같은 날은 입고 먼저 → 수요 기존 NORMAL 정렬(납기→PO→라인→입력순)
balance = openingStock(qtyAvailable)
for e in events:
    입고: balance += qty
    수요: before = balance; balance -= qty; 결품 = (qty>0 ∧ balance<0)
```

예 1 (재고 50, 10/10 입고 +30, 10/12 수요 60)

| 일자 | 이벤트 | 잔량 |
|---|---|---|
| 시작 | 가용재고 | 50 |
| 10/10 | 입고예정 PO +30 | **80** |
| 10/12 | 수요 −60 | **20** (결품 없음) |

예 2 (재고 50, 10/12 수요 60, 10/15 입고 +30)

| 일자 | 이벤트 | 잔량 | 판정 |
|---|---|---|---|
| 10/12 | 수요 −60 | **−10** | **결품 발생**(최초 결품일 10/12) |
| 10/15 | 입고예정 +30 | 20 | 결품 해소(일시 결품 10/12~10/15) |

결과 지표(추가): `shortageRecoveredAt`(해소일), `uncoveredShortageQty`(마지막 입고 반영 후에도 남는 부족=발주 필요량), `temporaryShortage`(입고로 해소되나 수요 시점에 부족=납기 대응/독촉 필요).

- 수요 납기가 없는(`null`) 시뮬레이션 수요: 입고를 적용하지 않는다(보수적, What-if 기존 동작 유지).
- 기간 MRP: `to` 이후 입고는 기간 종료 예상재고에 반영하지 않는다.
- 입고 `date < 기준일(오늘)`(예정일 경과)은 §K 정책.

**엔진 확장 설계 (기존 엔진 유지)**

| 후보 | 평가 |
|---|---|
| **A. 입력에 `scheduledReceipts` 이벤트 추가(additive)** | ✔ **권장.** 입력이 비어 있으면 현재 코드 경로와 동일(회귀 0). 결과 타입에 이동 이력의 `receipt` 항목·지표만 추가 |
| B. 날짜별 stock provider | 시점별 재고를 외부에서 만들면 순차 차감/최초 결품 로직을 어댑터가 중복 구현 |
| C. 새 projected-inventory 엔진 | 정렬·결품 정의가 이중화되어 Excel Golden/기존 테스트와 불일치 위험 |

구현 스케치: 자재별 입고 큐(날짜 정렬)를 두고, 수요 처리 직전에 `date ≤ 수요일` 입고를 선적용(같은 날 입고 우선). 마지막 수요 이후 남은 입고는 `to`(없으면 무제한) 이내만 최종 잔량에 반영. `EXCEL_COMPAT`은 입력이 있어도 무시(+경고). 영향 파일: `types.ts`, `order-mrp-engine.ts`(이벤트 적용부 한 곳), `order-mrp-adapter.ts`/`simulation-adapter.ts`(View 필드).

## J. 같은 날짜 입고 / 수요 순서

- **기본: 입고 → 수요** (그날 입고 예정분은 그날 수요에 사용 가능). 근거: 납기일 기준 일 단위 계획이며 장부 일 단위에서 순서를 정해야 함, 반대로 두면 정상 납품도 결품으로 표시되어 과발주를 유발.
- 실무 보완 [추정, 현업 확인 필요]: 입고 후 **수입검사(ReceivingInspection)가 끝나야 가용**이므로 "입고일 당일 사용 가능"이 아닐 수 있다. → 옵션 `receiptAvailabilityLagDays`(기본 0, 공급업체/테넌트 설정)를 설계에 예약하고 기본은 0일.
- 최종 권고: **입고 우선(당일 사용 가능)을 기본, 검사 지연일 옵션 제공**.

## K. ETA 없는 / 지난 PO 정책

- `expectedDate`가 NOT NULL이라 "ETA 없음"은 **현재 구조에서 발생하지 않는다**. 대신 ① MRP 생성 DRAFT의 임의 +14일 ② 예정일 경과 후에도 잔량이 남은 PO가 실질적 위험이다.
- **권장**: (1) 날짜가 없는(향후 nullable 전환 포함) 잔량은 투영에 더하지 않고 "입고일 미정 발주 N건" 경고. (2) **예정일이 기준일(오늘)보다 과거인 잔량도 기본은 더하지 않고** "입고 지연 발주 N건(잔량 X)"로 경고. 옵션 `overdueReceiptPolicy: EXCLUDE(기본) | AS_OF_TODAY`.
- 장점: 오지 않을 수 있는 물량으로 결품을 숨기지 않는다. 단점: 실제로 곧 도착할 지연 물량이 있으면 **과발주** 가능 → 제안 화면에 지연 잔량을 같이 표시해 사용자가 판단.

## L. 공급업체 선택 정책

우선순위: ① 사용자가 제안 화면에서 변경한 값 → ② `ItemSupplier.isDefault ∧ isActive` → ③ 활성 후보 중 `priority` 최소 → ④ (참고 힌트만) 해당 품목의 최근 PO 공급업체 → ⑤ **미지정**(발주 생성 비활성 + 경고).
- 현재 `createPurchaseOrdersFromMrp`의 "tenant의 첫 SUPPLIER" 임시 선택은 **Phase 5C에서 제거**.
- 후보는 `status=ACTIVE`, `partnerType ∈ {SUPPLIER, BOTH}`, `ItemSupplier.isActive`만.

## M. MOQ / 발주배수 / 리드타임

저장 위치: **`ItemSupplier`**(공급업체마다 다름). 안전재고는 공급업체와 무관하므로 `Item.safetyStock`.

수식(제안수량):

```
projectedEnd = openingStock + 인정된 입고예정 − 수요      # 음수 = 부족
need         = max(0, safetyStock − projectedEnd)         # 안전재고 이상 확보
if need == 0:           suggested = 0
else:
    qty       = max(need, moq ?? 0)
    suggested = multiple>0 ? ceil(qty / multiple) × multiple : qty
```

| 부족 | 안전재고 | MOQ | 배수 | 제안 |
|---|---|---|---|---|
| 17 | 0 | 20 | 10 | **20** |
| 23 | 0 | 20 | 10 | **30** |
| 17 | 5 | 20 | 10 | need=22 → **30** |
| 17 | 0 | 없음 | 없음 | **17** |

발주필요일 = `최초 결품일 − leadTimeDays`(달력일, 휴일 미반영). `< 오늘`이면 "리드타임 부족(긴급)" 표시.
MOQ 이후 배수 증가 방식(MOQ + n×배수)은 공급사별 계약에 따라 달라질 수 있어 옵션으로 남긴다(기본은 위 수식).

## N. 가격 구조

- MRP 계산에는 불필요, 제안 화면에는 예상단가/금액이 유용.
- 기존 `ItemPrice(priceType=PURCHASE, partnerId, effectiveFrom/To)` + `getItemPrice()` 로직을 **읽기 전용**으로 재사용 가능. 단 대원정밀은 가격 화면이 범위 밖이라 값이 없을 수 있음 → "단가 미등록" 표시, `unitPrice=0`(현재 PO 품목 기본값 NOT NULL).
- **필수 아님**: 5C에서 표시만, 입력/관리 UI는 후속.

## O. 발주제안 구조

입력: 수주기준 MRP 결과(기간/전체) + 입고예정 + 공급업체 정보. 자재 1행 = 제안 1건.

| 필드 | 설명 |
|---|---|
| 자재, 단위, 가용재고 | 기존 |
| 최초 결품일 / 부족수량 / 입고예정 합계 / 최종 부족 | 시간축 엔진 결과 |
| 지연·미정 발주 잔량 | §K 경고 |
| 기본 공급사(변경 가능), 리드타임, MOQ, 배수 | `ItemSupplier` |
| 발주필요일, 제안발주량 | §M |
| 기존 DRAFT 발주 잔량 | 중복 발주 방지 힌트(DRAFT는 예정입고에서 제외하지만 사용자에게는 표시) |
| 예상단가/금액 | `ItemPrice`(선택) |

## P. Draft PO 생성 구조

- 선택 항목을 **공급업체(+사이트)별로 그룹화 → 업체당 DRAFT PO 1건**, 하나의 DB transaction(전부 성공/전부 실패). **자동 확정 금지**(항상 DRAFT).
- PO 헤더: `supplierId`(검증된 선택값), `siteId`(tenant 소유 검증, 단일 사이트면 기본), `orderDate`(KST 오늘), `expectedDate`(제안 화면에서 사용자가 확인한 값 — 임의 +14일 폐기), `note`(`[MRP] 기간 …` 표식).
- PO 품목: `itemId`(소유 검증), `qty`(제안량, 사용자 수정 가능), `unitPrice`(ItemPrice 또는 0), `stockAtOrder`(현재고).
- MRP 실행 ID는 Snapshot Phase 이전이므로 **schema 의존성 없이 `note`에만 기록**. Phase 6에서 `MrpRun` 참조 필드 추가 검토.
- 감사: `recordAuditLog`(기존 `createPurchaseOrder` 패턴), 권한: `MRP CREATE` + `PURCHASE_ORDER CREATE`, tenant는 인증 컨텍스트(Phase 2.5 정책 유지).
- 중복 방지: 같은 품목의 DRAFT/ORDERED 잔량을 제안 화면에 표시 + 생성 직전 서버에서 재조회해 경고(강제 차단은 하지 않음).

## Q. PO 채번

| 항목 | 현황 |
|---|---|
| 일반 발주 | `generatePurchaseOrderNo`: `PO-{KST연도}-{3자리}`, 같은 prefix의 `orderNo desc` 1건을 읽어 +1, `withUniqueBusinessNumberRetry`(최대 5회) |
| MRP 발주 | `PO-MRP-${Date.now()}` — 같은 ms 충돌 시 재시도 없이 실패, 순번 체계와 분리 |
| 공식 채번 서비스 | `NumberingRule/Sequence`는 `type ∈ {LOT, SERIAL}` 전용 → **PO에는 사용 불가** |
| **잠재 버그** | 3자리 패딩이라 `PO-2026-1000`이 되면 문자열 `desc` 정렬에서 `PO-2026-999`가 더 크다고 판단 → 같은 번호를 반복 생성해 재시도 5회 모두 unique 위반 → **연 1,000건째 발주부터 생성 불가**(수주 `generateSalesOrderNo`도 동일 패턴) |

권장: 기존 로직을 `src/lib/` 공용 함수로 추출하고 ① 숫자 기준 최대값 산출(또는 패딩 확장) ② 한 transaction에서 N개 번호를 연속 할당 ③ unique 위반 시 전체 재시도. MRP 발주도 동일 `PO-YYYY-###` 사용(식별은 `note` 표식).

## R. 반제품 재고 Netting (구현하지 않음, 분석만)

| 항목 | 분석 |
|---|---|
| 현재 | 엔진은 `SEMI_FINISHED`를 항상 하위까지 전개하고 반제품 재고는 그 행의 재고로만 표시(기존 `explodeBOM`과 동일). 반제품 재고가 있어도 하위 자재가 전량 필요한 것으로 계산 → **과대 소요** |
| 목표 | 완제품 수요 → 반제품 필요량 → 반제품 가용 차감 → **부족분만** 하위 전개 |
| 난이도 | **높음(L)**. 현재 엔진은 제품당 단위 소요(`unit map`)를 정적으로 미리 계산하고 수요×단위로 곱한다. netting은 하위 소요가 반제품의 **런닝 잔량에 의존**하므로 수요 순서대로 반제품 잔량을 차감하며 하위로 동적 전개(레벨 순 처리, 동일 반제품 공유, 순환/깊이)해야 함 |
| 회귀 영향 | NORMAL 결과가 달라진다: Phase 2/3/4 테스트(66/98/71) 중 반제품 재고가 있는 시나리오 기대값 변경. `EXCEL_COMPAT`은 플래그 OFF로 Golden 불변 |
| 데이터 요구 | 반제품 재고의 신뢰성 — **공정 중 반제품은 `InventoryBalance`가 아니라 `WipUnit`(재공)으로 관리**되므로 WIP 포함 여부 정책 필요. 반제품 BOM/수율/보관 창고 정합 |
| 결론 | **Phase 5와 분리**(별도 5E, 가장 마지막). 정책 3건 선결: 재공 포함 여부, 반제품 가용 정의, 예약 |

## S. Compatibility Mode 영향

Excel 호환에서는 **미입고 PO, 안전재고, MOQ, 리드타임, 반제품 netting 전부 OFF**(입력/옵션 기본 비활성, `EXCEL_COMPAT`에서는 강제 무시). 추가 기능은 모두 "입력이 없으면 기존 경로 그대로"인 additive 설계이므로 Golden(36,582셀 / 2,457+2,457셀) 차이 0을 유지한다. 신규 테스트: 입력 비어 있음 ⇒ 결과 동일(프로퍼티 테스트), EXCEL_COMPAT + 입고 입력 ⇒ 무시+경고.

## T. 필요한 Schema 변경

| 단계 | 변경 | 필수 여부 |
|---|---|---|
| 5A | **`ItemSupplier` 신규 모델**(+ Item/BusinessPartner/Tenant 역관계, partial unique index, RLS enable) | 필수 |
| 5B | 없음 (`PurchaseOrderItem.qty/receivedQty`, `PurchaseOrder.expectedDate/status` 사용) | — |
| 5C | 없음 (`note` 활용, 채번 로직만 교체) | — |
| 5D | `Item.safetyStock Decimal(18,6)?` (LT/MOQ/배수는 5A의 `ItemSupplier`) | 필수 |
| 5E | 없음(정책 확정 후 재평가) | — |
| 후속 | `PurchaseOrder`↔`MrpRun` 참조(Phase 6), `PurchaseOrder.expectedDate` nullable 전환(검토만) | 선택 |

중복 필드 추가 없음: 입고예정일은 기존 `expectedDate`, 잔량은 계산값, 상태는 기존 enum 사용.

## U. Migration 전략

- **전부 additive**(신규 테이블 / nullable 컬럼). 기존 데이터 변환 없음, 데이터 손실 위험 없음.
- 순서: `nullable 추가 → (필요 시) backfill → constraint`. 5A는 신규 테이블이라 backfill 불필요. Excel 이관 시 `설정!E 거래처명` → `ItemSupplier(isDefault=true)` 생성은 Phase 7 도구가 수행.
- **적용 절차**: Vercel 빌드는 `prisma generate && next build`만 수행하므로 migration은 **수동 `prisma migrate deploy`(DIRECT_URL)** → 그 다음 코드 배포. 코드 먼저 배포하면 존재하지 않는 테이블 조회로 오류.
- **RLS**: 기존 `supabase_public_hardening` migration은 **당시 존재하던 테이블에만** RLS를 켰다. 신규 테이블 migration에 `ALTER TABLE "ItemSupplier" ENABLE ROW LEVEL SECURITY;`를 반드시 포함(기본 권한은 이미 anon/authenticated 회수됨).
- partial unique index는 Prisma schema로 표현되지 않아 이후 `migrate dev` 시 drift 경고 가능 → migration SQL에 주석으로 의도 명시, 서비스 레벨 방어와 테스트 병행.
- 롤백: 신규 테이블 `DROP`(다른 테이블과 FK 결합 없음).
- 기존 코드 사용처 영향: `ItemPrice`/`PurchaseOrder`/`Vendor` 구조 변경이 없으므로 기존 화면·액션 영향 없음.

## V. 기존 코드 영향 (파일 단위)

| 파일 | 변경 | 단계 |
|---|---|---|
| `prisma/schema.prisma` (+migration) | `ItemSupplier`, `Item.safetyStock` | 5A, 5D |
| 신규 `src/lib/services/item-supplier.service.ts`, `src/lib/actions/item-supplier.actions.ts` | CRUD, 기본 공급업체 교체, tenant 소유 검증 | 5A |
| 신규 품목 공급처 입력 UI(품목 상세 탭 또는 거래처 관리 하위) | 기준정보 입력 | 5A |
| `src/lib/auth/daewon-scope.ts`, `src/lib/nav-config.ts` | 신규 경로 허용(필요 시) | 5A |
| `src/lib/mrp/types.ts`, `order-mrp-engine.ts` | `scheduledReceipts`, 이동 이력/지표(additive) | 5B |
| `src/lib/services/mrp-loaders.ts` (+`mrp-order.service.ts`) | 미입고 PO 품목 배치 조회 (ORDERED/PARTIAL, 외주 제외, tenant) — 쿼리 +1 | 5B |
| `src/lib/mrp/order-mrp-adapter.ts`, `simulation-adapter.ts` | 입고예정/지연/미정 View 필드 | 5B |
| `src/app/app/mes/mrp/order-mrp-panel.tsx` 등 | 입고예정 컬럼, 경고, 발주제안 보기 | 5B, 5C |
| `src/lib/services/mrp-purchase.service.ts`, `src/lib/actions/mrp.actions.ts` | 업체별 그룹·검증·채번·감사로 **교체** | 5C |
| `src/lib/actions/purchase-order.actions.ts` | 채번 함수 추출(동작 동일), CLOSED 처리 수단 | 5C |
| `src/lib/services/mrp-plan.service.ts` | (선택) 외주발주 제외 | 5B |
| `src/lib/actions/item-price.actions.ts` | (별도 FIX) tenant 소유 검증 | 선행 |

기존 `createPurchaseOrdersFromMRP` 재사용 판단

| 재사용 | 교체 |
|---|---|
| 인증 구조(`authorize` DI), tenant 소유 검증 패턴, 전부 실패/전부 성공 원칙, 일반화된 오류 | "첫 SUPPLIER" 선택, 단일 PO 생성, `Date.now()` 채번, +14일 임의 납기, 단가 0 고정, 감사 로그 부재, 생산계획 MRP 결과만 입력 |
→ 재사용 약 30%(보안·구조), 업무 로직은 교체.

## W. UI 설계 (타당성 검토)

수주기준 MRP 결과 → "발주제안" 보기(기존 `결품예측 / 기간 예상소요량` 옆에 세 번째 보기). 표: 자재 / 최초 결품일 / 부족수량 / 입고예정 / 최종 부족 / 공급사(선택) / 리드타임 / 발주필요일 / MOQ / 배수 / 제안발주량(편집) / 예상단가. 선택 후 "선택 항목 구매발주(DRAFT) 생성" → 업체별 그룹 미리보기 → 확인.
- 타당: 기존 보기 전환 패턴(같은 결과 재사용)과 일치, 계산(엔진) 결과를 UI에서 재계산하지 않음.
- 주의: 공급사 미지정 행은 선택 불가, 제안량/예정일 편집 시 검증, 대량(수백 행) 렌더링은 가상 스크롤 검토, 확정/승인 버튼은 두지 않음(DRAFT만).

## X. 개발 Phase 분할

| Phase | 목표 | schema | 코드 | 테스트 | 완료조건 |
|---|---|---|---|---|---|
| **5A** | 공급업체 기준정보 | **migration 1건** `ItemSupplier` | 서비스/액션/입력 UI, 기본 공급업체 교체, tenant 검증 | 단일 default 보장, tenant 격리, 권한 | 품목별 기본/후보 공급업체·LT·MOQ·배수 입력·조회 |
| **5B** | 입고예정(미입고 PO) 시간축 MRP | 없음 | 엔진 이벤트 확장, 로더 +1쿼리, View/UI 컬럼, 지연/제외 경고 | 예 1·예 2, 동일일 순서, 외주 제외, 상태별, Golden 불변, 쿼리 수 | 입고예정 반영 결품일/해소일 표시, EXCEL_COMPAT 무시 |
| **5C** | 발주제안 + DRAFT PO | 없음 | 제안 계산(순수), 공급사 선택, 업체별 그룹 transaction 생성, 채번 공용화, 감사 | 그룹핑/채번 충돌/권한/tenant/원자성/중복 경고 | 선택 항목 → 업체별 DRAFT PO, 확정 불가 |
| **5D** | 안전재고/리드타임/MOQ/배수 | **migration 1건** `Item.safetyStock` | 제안 수식(§M), 발주필요일, 입력 UI | 수식 표 전부, 경계 | 제안량·발주필요일 계산, 리드타임 부족 표시 |
| **5E** | 반제품 netting | 없음(정책 확정 후) | 엔진 동적 전개, 옵션 플래그 | 회귀 3종 + 신규 | 정책 3건 확정 후 별도 승인 |

권장 순서: 5A와 5B는 서로 독립(병행 가능)이나 **5A를 먼저**(입력 데이터 준비에 시간이 걸리고 migration 승인·수동 적용이 필요) → 5B → 5C → 5D → 5E. 5C 전에 §Y의 선결 이슈 3건 해소.

## Y. 위험요소

| 위험 | 영향 | 대응 |
|---|---|---|
| PARTIAL_RECEIVED 잔량 종결 수단 없음(`CLOSED` UI 없음) | 입고예정이 영구히 부풀려져 결품을 숨김 | 종결 액션 신설(5B 선행) 또는 경과일 초과 시 경고/제외 |
| PO 상태 자유 변경(상태 머신 없음) | 잘못된 상태로 예정입고 오인정 | MRP는 상태+잔량만 신뢰, 상태 전이 제한은 별도 과제 |
| MRP DRAFT의 임의 +14일 `expectedDate` | 가짜 ETA | 5C에서 사용자 확인 필수 |
| 외주발주가 `PurchaseOrder`에 혼재(prefix/note 규칙) | 외주 WIP가 자재 입고예정으로 오인 | `workOrderOperationId`+prefix+note로 제외, 기존 `calculateMRP`도 점검 |
| 불합격 잔량이 미입고로 남음 | 재납품 미정이어도 예정으로 계산 | 경고 표시, 필요 시 PO 수정/종결 |
| PO 채번 1,000건 한계 | 연 1,000번째 발주 생성 불가 | 5C에서 채번 공용화·숫자 기준 최대값 |
| `ItemPrice` 액션 tenant 검증 누락 | 타 tenant 가격 수정/삭제 가능성 | 5A 전 별도 FIX |
| 신규 테이블 RLS 누락 | PostgREST 노출 | migration에 `ENABLE ROW LEVEL SECURITY` 포함 |
| partial unique index drift | `migrate dev` 경고 | SQL 주석·테스트, 서비스 방어 |
| 코드가 migration보다 먼저 배포 | 런타임 오류 | 수동 migrate → 배포 순서 문서화 |
| PO ETA 헤더 단위 | 분할 납품 표현 불가 | 한계로 명시, 필요 시 PO 분할 |
| 반제품 WIP 이중 관리 | netting 정확도 | 5E 선결 정책 |
| 마스터 입력 부담(자재 273 × 공급처) | 기능 미사용 | Excel 이관(설정!E→기본 공급업체)로 초기값 제공 |
| 휴일/영업일 미반영 리드타임 | 발주필요일 오차 | 달력일 기준으로 명시, 후속 |

## Z. 최종 추천

1. 공급업체 모델은 **`ItemSupplier`(안 B)** + 가격은 기존 `ItemPrice` 유지.
2. 입고예정은 **`PurchaseOrderItem.qty − receivedQty`**, 날짜는 **`PurchaseOrder.expectedDate`**, 상태는 **ORDERED/PARTIAL_RECEIVED**(외주 제외).
3. 같은 날은 **입고 우선**, 예정일 경과·미정 잔량은 **더하지 않고 경고**.
4. 엔진은 **이벤트 입력 additive 확장**(기본 OFF, `EXCEL_COMPAT` 무시).
5. 발주는 **업체별 DRAFT만**, 임의 +14일/첫 공급업체/`Date.now()` 채번 폐기.
6. 반제품 netting은 **Phase 5와 분리**(5E).
7. migration은 **2건**(`ItemSupplier`, `Item.safetyStock`).
