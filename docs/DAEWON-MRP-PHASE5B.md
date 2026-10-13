# DAEWON MRP Phase 5B — 예정입고(Scheduled Receipt) · 발주잔량 종결 · 시간축 MRP

수주기준 MRP 가 **확정 구매발주의 미입고 잔량**을 날짜순 이벤트(입고 / 수요)로 반영해 결품 시점과 회복을 정확히 계산한다.
**DB schema / migration 변경 없음**(기존 `PurchaseOrderStatus.CLOSED` 사용). Excel 호환(EXCEL_COMPAT)과 Golden 결과는 바뀌지 않는다.

설계 근거: [DAEWON-MRP-PHASE5-DESIGN.md](./DAEWON-MRP-PHASE5-DESIGN.md) §G~K, I.

## 1. 예정입고 정책

| 항목 | 정책 |
|---|---|
| 미입고 수량 | `PurchaseOrderItem.qty − receivedQty` (> 0 인 경우만). 입고 > 발주 같은 데이터 이상은 0 으로 클램프하고 경고(`RECEIVED_QTY_EXCEEDS_ORDER`) — 음수 입고예정 없음 |
| 인정 상태 | `ORDERED`, `PARTIAL_RECEIVED`. 제외: DRAFT, RECEIVED, CLOSED, CANCELLED |
| 입고예정일 | `PurchaseOrder.expectedDate`(헤더) → KST 달력 날짜. 품목별 ETA 는 없다 |
| 날짜 없음/해석 불가 | 가산하지 않고 `MISSING_RECEIPT_DATE` 경고 |
| 예정일 경과 | 기준일(KST 오늘) **이전**의 미입고는 자동 가산하지 않고 `OVERDUE_SCHEDULED_RECEIPT` 안내(발주·자재·예정일·경과일·잔량). 기준일 당일은 오늘 입고로 인정 |
| 외주발주 제외 | `orderNo` 가 `OS-` 로 시작 / `note` 에 `[OUTSOURCING]` / 품목 행에 `workOrderOperationId` 존재 |
| tenant | DB 조회 where 와 분류 단계에서 모두 인증 tenant 한정 |
| 기준일(baseDate) | 서버가 KST 오늘을 date-only 로 결정해 전달(클라이언트 값 무시). 엔진/분류 모듈은 현재 시각을 읽지 않는다 |
| 옵트인 | `includeScheduledReceipts: true` 일 때만 구매발주를 조회·반영. 기본 false(기존 호출/테스트와 동일) — 화면은 기본 켜짐 |

## 2. 시간축 계산

자재별로 `openingStock(가용재고)` 에서 이벤트를 날짜순 처리한다.

- **같은 날은 입고 → 수요** (수입검사 지연일 0일). 수요 간 순서는 기존 NORMAL 규칙 유지(납기 → PO → 라인 → 입력 순서).
- 입고 간 순서: 일자 → 발주번호 → 발주 품목 행 → 입력 순서(결정적).
- **납기 미정(null) 수요**는 날짜 근거가 없어 이후 입고를 앞당겨 쓰지 않는다(보수적).
- 마지막 수요 이후 남은 입고는 **최종 예상재고**에 반영한다(수요 계산 종료일 `to` 이내).
- 수요 총소요량은 입고예정으로 줄어들지 않는다.

예) 50 + 입고 30(10/10) → 수요 60(10/12) = 20 · 결품 없음 / 50 → 수요 60(10/12) = −10(결품) → 입고 30(10/15) = 20 · **일시 결품, 10/15 회복**.

### 결품 지표 (기존 의미 유지 + 추가)

| 필드 | 의미 |
|---|---|
| `finalBalance` / `finalShortageQty` | 최종 예상재고 / `max(0, −finalBalance)` (예정입고 반영 후) |
| `firstShortage` | 처음 결품이 발생한 수주(= 최초 결품일) — 입고로 회복돼도 남는다 |
| `hadShortage` | 기간 중 한 번이라도 결품(requirement>0 ∧ balanceAfter<0) |
| `peakShortageQty` | 시간축 최저 잔량의 부족 크기(최종 부족과 구분) |
| `shortageRecoveredAt` | 결품 후 입고로 0 이상 회복된 입고일(최종 ≥ 0 일 때) |
| `temporaryShortage`(화면) | `hadShortage && finalBalance ≥ 0` → "입고예정으로 해소" |
| `timeline` | 입고/수요 이벤트(일자, 참조번호, 수량, 이전/이후 잔량, 결품 표시) |

"최종 부족 없음" 과 "기간 중 결품 발생" 은 별도 지표다. 입고예정이 없으면 모든 값이 기존과 동일하다.

## 3. 기간 MRP

- 기준일 이후 **기간 시작 전** 입고도 시간축에 포함한다(기간 첫 수요 처리 전 잔량에 영향).
  예: 기준일 10/01, 조회 10/10~10/31, 10/05 입고 +50 → 10/12 수요 전에 반영.
- 기간 **종료일 이후** 입고는 제외(기간 종료 예상재고에 넣지 않는다). 종료일이 없으면 이후 입고도 최종 예상재고에 포함.
- 기간 이전 납기의 미출하 수주가 재고를 선점하지 않는 기존 정책은 그대로.
- "기간 예상소요량" 보기: 소요량 계산은 불변. `기간 내 입고예정`(참고)과 `기간 종료 예상재고`만 추가.

## 4. 미입고 잔량 종결 (PO Close)

| 항목 | 정책 |
|---|---|
| 의미 | "남은 미입고 수량은 더 이상 입고되지 않는다" — `status = CLOSED` |
| 수량 | `qty` / `receivedQty` 변경 없음(예: 100 / 80 / CLOSED → 미납 20 이 이력으로 남음) |
| 허용 | `ORDERED`, `PARTIAL_RECEIVED` (미입고 잔량 > 0). ORDERED 100/0 도 종결 가능 |
| 거부 | RECEIVED·잔량 0(`NOTHING_TO_CLOSE`), DRAFT(삭제/취소 사용), CANCELLED, 외주발주(외주관리에서 처리) |
| 재실행 | 이미 CLOSED 면 `ALREADY_CLOSED` 안내(변경 없음) |
| 권한 | `PURCHASE_ORDER UPDATE` + OPERATOR 이상. tenantId 는 인증 컨텍스트 |
| 타 tenant | 존재하지 않는 발주와 동일한 `INVALID_REFERENCE`, DB write 0 |
| 동시성 | 입고와 같은 품목 행 잠금(`lockPurchaseOrderItemsForUpdate`) 후 재조회, 상태 조건부 갱신(0건이면 `CONFLICT`) |
| 입고 차단 | `receiving.actions.ts` — CLOSED/CANCELLED 발주에는 입고 불가(사전 검증 + 잠금 후 재검증). 종결이 입고 상태 갱신으로 되살아나지 않게 함 |
| 감사 | `AuditLog`(PurchaseOrder, UPDATE, 메뉴 `발주관리`): 이전/이후 상태, 주문·입고·잔량 합계, 품목별 잔량, 사유(선택, 200자) |
| 사유 저장 | 감사로그에만 기록. 발주 `note` 에는 쓰지 않는다(`[OUTSOURCING]` 표식이 분류에 쓰이므로) |
| 자동 종결 | 없음. 확인 Dialog 에서 사용자가 명시적으로 실행 |

종결 즉시 예정입고에서 제거된다(MRP 로더가 CLOSED 를 조회하지 않음).

## 5. 구조

```
order-mrp-panel.tsx ─▶ runOrderBasedMrp (MRP READ)
                         └▶ mrp-order.service.ts     [수주 1 + BOM 레벨 + 재고 1 (+ 구매발주 1, 옵트인)]
                              ├▶ mrp-loaders.ts      loadScheduledReceiptRows (tenant+상태, 구성품 일괄)
                              └▶ order-mrp-adapter.ts
                                    ├▶ scheduled-receipt.ts   분류(순수): 상태/외주/수량/경과/날짜
                                    └▶ order-mrp-engine.ts    이벤트 시간축(additive, EXCEL_COMPAT 무시)
purchase-orders UI ─▶ closePurchaseOrderRemainder (PURCHASE_ORDER UPDATE)
                         └▶ purchase-order-close.service.ts
```

쿼리: 구매발주 조회가 +1(수주 3건/303건 모두 4쿼리). N+1 없음.

## 6. 호환성 / 범위 결정

| 항목 | 결정 |
|---|---|
| EXCEL_COMPAT | 예정입고 입력이 있어도 무시(+INFO). Golden A 36,582셀 / B 2,457+2,457셀 0 mismatch |
| What-if(품목 시뮬레이션) | **기존 동작 유지**(가상 수요 단독 계산, 예정입고 미반영) — 범위 축소 |
| 생산계획 MRP(`calculateMRP`) | 변경 없음. 외주발주를 onOrder 에 포함하는 기존 문제는 별도 GAP |
| 구매발주 목록 | "미입고 잔량" 컬럼(종결 건은 "미납 N 종결"), 행 메뉴 "미입고 잔량 종결" |

## 7. 테스트

| 명령 | 내용 |
|---|---|
| `npm run test:mrp-scheduled-receipt` | SR1~SR12, 기간 조합, 호환 모드, 쿼리 수, KST 기준일, 서비스/View(101) |
| `npm run test:purchase-order-close` | C1~C7 + 외주/동시성/롤백/입고 가드(53) |
| `npm run test:mrp-scheduled-receipt-ui` | 타임라인/결품 해소/경과 안내/기존 화면 호환 SSR 렌더(20) |
| 회귀 | order-mrp-engine 182(Golden 0) · service 66 · security 54 · period 98 · simulation 71 · item-price 36 · item-supplier 130 |

## 8. 남은 GAP

- PO 채번(연 1,000건 한계), 공급업체별 발주제안, DRAFT PO 생성 개선(MRP DRAFT 의 임의 +14일 납기) → Phase 5C
- ItemSupplier(기본 공급업체/LT/MOQ/발주배수) 적용, 안전재고 → 5C/5D
- 품목별 ETA·분할 납품 일정 없음(헤더 단일 예정일)
- 입고 후 수입검사 지연일(`receiptAvailabilityLagDays`) 옵션 미구현(현재 0일)
- 반제품 netting → 5E
- 발주 상태 자유 변경(상태 머신 없음). 종결 해제 전용 기능은 없으며, 발주 수정 화면에서 상태를 되돌리면 재개된다(감사 이력은 남음)
