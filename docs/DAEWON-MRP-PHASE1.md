# DAEWON MRP Phase 1 — 수주 기반 호환 MRP 순수 엔진

범위: DB 비의존 순수 계산 엔진 + 자동 테스트. UI·Prisma schema·DB·Server Action 변경 없음.
기존 `calculateMRP`(생산계획 기반)와 `/app/mes/mrp` 는 그대로 유지된다.

## 파일

| 파일 | 역할 |
|---|---|
| `src/lib/mrp/types.ts` | 입력/옵션/결과 타입, 용어 정의 |
| `src/lib/mrp/order-mrp-engine.ts` | `runOrderMrp`, `resolveOrderMrpOptions`, `createBomExploder` |
| `src/lib/mrp/period.ts` | date-only 유틸 (`toDateOnly`, `isWithinPeriod`, `excelSerialToDateOnly`) |
| `scripts/test-order-mrp-engine.ts` | S0~S11 + 안전성 테스트 (`npm run test:order-mrp-engine`) |
| `scripts/generate-order-mrp-golden-fixture.ts` | Excel → 익명화 fixture 생성기(원본 읽기 전용) |
| `scripts/fixtures/order-mrp/*.json` | 익명화 Golden fixture (고객명 없음, PO/제품 순번화) |

## API

```ts
runOrderMrp(input: { demands, boms, stocks, componentInfo? }, options: { mode, from?, to?, ... }): OrderMrpResult
```

- **Demand**: 수주 라인 1건. `itemId`/`itemCode`(MES Item.code)로 식별, `remainingQty`(미출하 잔량), `cancelled`, `completed`, `shipped`(Excel 출고일), `deliveryDate`(date-only).
- **BOM**: 호출자가 품목당 사용할 BOM 라인만 전달(`parentItemId`, `componentItemId`, `qtyPer`, `scrapRate`, `componentItemType`).
- **Stock**: `{ componentItemId, quantity }` — 엔진은 재고를 읽지 않고 입력받는다(D4).

### 옵션 기본값

| 옵션 | NORMAL | EXCEL_COMPAT |
|---|---|---|
| 정렬 | 납기 → (고객PO\|orderNo) → orderNo → orderLineNo → 입력순 | 납기 → 입력(시트)순. `ordering: "INPUT_ORDER"` 로 Excel MRP 기간작성 행 순서 재현 가능 |
| 수요 수량 | `remainingQty ?? orderQty`, 0 이하 제외 | `orderQty`, `shipped`/`completed` 이면 라인 전체 제외, 0 수량은 열 유지 |
| BOM 전개 | 다단계(`SEMI_FINISHED`, 깊이 10, 순환 방지) | 단일 레벨 |
| 스크랩 | 반영 `qtyPer × (1+scrapRate)` | 미반영 |
| 기간 | `from <= 납기 <= to` 양끝 포함, 미지정=무제한 | 동일 + `legacyUpperBound`(호출자가 "오늘" 전달) |
| 납기 미정 | 기간 미지정 시 마지막, 기간 지정 시 제외 | 기간 미지정 시 맨 앞(Excel 빈 날짜=0) |
| stockProviderType | `ACTUAL` | `EXCEL_THEORETICAL` (결과 기록용) |

`INPUT_ORDER`, `legacyUpperBound` 는 NORMAL 에서 RangeError.

## 알고리즘

1. 수주 라인 적격 판정 → 제외 사유를 `excludedOrderLines` 에 기록 (`CANCELLED`, `COMPLETED`, `SHIPPED`, `NO_REMAINING_QTY`, `INVALID_QUANTITY`, `OUT_OF_PERIOD`, `MISSING_DELIVERY_DATE`, `INVALID_DELIVERY_DATE`, `MISSING_BOM`, `INVALID_BOM`)
2. 확정 정렬
3. 자재별 `requirement = demandQty × Σ(동일 자재 qtyPer)` (BOM 라인은 mutate/dedupe 하지 않음)
4. 순차 차감 `balanceAfter = balanceBefore − requirement` (음수 허용, 0 클램프 없음)
5. 결품 지표: 수주별 `shortageItemCount`/`cumulativeNegativeItemCount`, 자재별 `firstShortage`(직전/직후 잔량 포함)·`shortageDemandCount`·`finalShortageQty`, 전체 `summary.firstShortage`

## 경고(warnings)

`MISSING_BOM`(계산 제외·직전 BOM 대입 없음), `POSSIBLE_DUPLICATE_DEMAND`(모두 계산, 병합 없음), `DUPLICATE_ORDER_LINE_ID`, `DUPLICATE_BOM_COMPONENT`(INFO), `INVALID_BOM_QUANTITY`, `BOM_CYCLE_DETECTED`, `BOM_DEPTH_EXCEEDED`, `NEGATIVE_OPENING_STOCK`, `INVALID_STOCK_QUANTITY`, `INVALID_DEMAND_QUANTITY`, `INVALID_DELIVERY_DATE`, `MISSING_DELIVERY_DATE`

## Golden Test

| 기준선 | Excel 시트 | 비교 | 결과 |
|---|---|---|---|
| A | 출고예정소요량 | 134수주 × 273자재 = 36,582셀 | 불일치 0 |
| B | MRP작성 | 9수주 × 273자재 소요량 2,457 + 잔량 2,457, 결품수/누계 9/9, 총소요·예상재고 273/273 | 불일치 0 |

- 기준선 B 의 BOM 은 캐시 소요량÷수량으로 역산한 값이다(당시 BOM). 따라서 B 의 소요량 셀은 입력과 일치하는 것이 구조적이며, **독립 검증 대상은 순서·순차 차감·결품수/누계·총소요/예상재고**다. 소요량 계산 자체의 독립 검증은 기준선 A(현재 DB 시트 BOM 사용)가 담당한다.
- 재생성: `npx ts-node --compiler-options "{\"module\":\"commonjs\"}" --project tsconfig.json scripts/generate-order-mrp-golden-fixture.ts "<xlsm 경로>"`
- 현재 Excel 파일에는 입고·출하 실데이터가 없어 재고 0 기준선이다. 재고 유입/차감 시나리오는 합성 단위 테스트(S1, S9)로 검증한다.

## 알려진 한계 / 후속

- Excel MRP 기간작성의 "정렬 미적용"은 캐시 증거(납기 비오름차순)에 근거한 것으로, 원본 Excel 실측(분석 문서 Y1~Y4)은 별도 확인 대상이다. 엔진은 두 동작을 모두 옵션으로 재현한다.
- `SEMI_FINISHED` 재고가 있어도 하위 자재 소요를 차감하지 않는다(기존 `explodeBOM` 과 동일 의미). 반제품 재고 반영은 Phase 2 이후 정책 결정 사항.
- 공급업체·리드타임·MOQ 는 계산에 쓰지 않는다(결과 메타 `supplierId/supplierName` 확장 여지만 제공).
- DB 어댑터(수주/BOM/재고 조회), 권한, UI 는 Phase 2.
