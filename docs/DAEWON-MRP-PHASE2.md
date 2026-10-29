# DAEWON MRP Phase 2 — 수주기준 MRP 실DB 연결 + 결품예측 화면

Phase 1 순수 엔진(`src/lib/mrp/order-mrp-engine.ts`)을 DB 읽기 어댑터·서버 액션·UI 에 연결한다.
**DB 쓰기·schema·migration 변경 없음.** 기존 생산계획 MRP(`calculateMRP`, `mrp.actions.ts`)는 수정하지 않았다.

## 구조

```
UI  order-mrp-panel.tsx ─▶ Server Action runOrderBasedMrp(params)   [MRP READ 권한, tenant=인증 컨텍스트]
                              └▶ services/mrp-order.service.ts      [DI 로 받은 db 로 READ 쿼리 3종]
                                   └▶ mrp/order-mrp-adapter.ts      [DB 행 → 엔진 입력 → View, 순수]
                                        └▶ mrp/order-mrp-engine.ts  [Phase 1, 변경 없음]
```

## 확정 정책과 Source of Truth

| 항목 | 정책 | 근거(코드) |
|---|---|---|
| 수요 | tenant 일치, 상태 `CONFIRMED / IN_PRODUCTION / PARTIAL_SHIPPED` (+ 선택 시 `DRAFT`). `CANCELLED/SHIPPED/CLOSED` 제외 | `SalesOrder.status` |
| 납기 | `SalesOrderItem.deliveryDate ?? SalesOrder.deliveryDate`, KST date-only | `period.toDateOnly` |
| 출하잔량 | `max(0, SalesOrderItem.qty − SalesOrderItem.shippedQty)`. PLANNED 출하는 조회조차 하지 않음 | `shippedQty` 는 `confirmShipment` 에서만 증가, 감소 경로 없음 |
| BOM | tenant + `status=ACTIVE` + `isDefault=true` 정확히 1개. 0개 `MISSING_DEFAULT_BOM`, 2개↑ `MULTIPLE_DEFAULT_BOM`, 라인 없음 `EMPTY_DEFAULT_BOM` → 해당 수주 라인 계산 제외·화면 노출 | `BOM` |
| 반제품 | `SEMI_FINISHED` 구성품의 기본 BOM 을 레벨별 배치 조회(최대 11레벨) | 엔진 MULTI_LEVEL |
| 재고 | `InventoryBalance.qtyAvailable` 합계 = openingStock. 표시용 `qtyOnHand`, `qtyHold`(예약; schema 에 `qtyReserved` 필드는 없음). LOT 상태가 `ACTIVE` 가 아닌 재고(QUARANTINE/ON_HOLD/EXPIRED/CONSUMED)는 제외 | `qtyAvailable = qtyOnHand − qtyHold` 불변식 |
| 모드 | NORMAL 고정. EXCEL_COMPAT 은 Excel 이론재고 provider 가 없어 UI/서비스에 노출하지 않음 | Phase 3/회귀 단계 |

## 쿼리 수

`수주 1 + BOM 레벨 수(완제품 1 + 반제품 단계당 1) + 재고 1` — 수주·자재 건수와 무관. 일반적으로 4회.

## 기존 생산계획 MRP 와의 계산 차이

| | 기존 `calculateMRP` | 수주기준 MRP |
|---|---|---|
| 입력 | 생산계획 | 미출하 수주 라인 |
| BOM 선택 | `findFirst({itemId, isDefault:true})` (tenant·status 무관) | tenant + ACTIVE + Default, 다중/누락은 오류로 노출 |
| 재고 | 전 LOT `qtyAvailable` 합계 | LOT 상태 ACTIVE 만 |
| 발주중 PO | 차감 | 차감하지 않음(Phase 1 엔진 범위 밖) |
| 시간축 | 없음(총량) | 납기순 순차 차감, 최초 결품일/원인 PO |

## M4 (BOM Excel 업로드)

`importValidatedBoms` 가 항상 `isDefault:false` 로 만들던 것을, 트랜잭션 내에서 같은 tenant·품목의 ACTIVE Default 존재 여부를 조회해
**ACTIVE 이고 기존 Default 가 없을 때만, 그리고 파일 내 첫 ACTIVE BOM 만** Default 로 지정한다(`src/lib/bom-default-policy.ts`).
기존 BOM 은 수정하지 않는다. 클라이언트가 보낸 BOM 그룹의 품목 ID 소유권 검증은 이번 범위 밖(기존 동작).

## 테스트

- `npm run test:order-mrp-engine` — 182 checks (Phase 1)
- `npm run test:order-mrp-service` — 66 checks (fake DB 가 `where` 를 평가: tenant 격리, 상태/Default BOM 필터, N+1, 권한, M4)

## Phase 2.5 보안 hardening 메모

- `runMRP`/`getPlansForMRP`: MRP READ 권한 + 인증 tenant (`services/mrp-plan.service.ts`, 계산 알고리즘 불변, 모든 조회에 tenantId 조건 추가)
- `createPurchaseOrdersFromMRP`: 클라이언트 tenantId 무시, itemId/siteId 소유 검증 (`services/mrp-purchase.service.ts`)
- `importValidatedBoms`: 본문을 `services/bom-import.service.ts` 로 이동, 부모/구성품 ID 전체를 tenant 소유로 배치 검증(M4 정책 동일)
- 테스트: `npm run test:mrp-security` (54 checks)
