# DAEWON MRP Phase 5C — 공급업체별 발주제안 · DRAFT PO 생성 · PO 채번 개선

수주기준 MRP 의 부족 자재를 **구매 발주제안**으로 보여 주고, 사용자가 검토·수정한 항목을 **공급업체별 DRAFT 구매발주**로 생성한다.
**DB schema / migration 변경 없음.** 자동 발주확정은 없다(항상 DRAFT).
MOQ / 발주배수 / 안전재고 / 리드타임 계산은 적용하지 않는다(Phase 5D). 반제품 netting 은 5E.

설계 근거: [DAEWON-MRP-PHASE5-DESIGN.md](./DAEWON-MRP-PHASE5-DESIGN.md) §L~P, Q · Phase 5A(ItemSupplier) · 5B(예정입고).

## 1. 제안 유형과 수량

| 유형 | 조건 | 기본 제안수량 | 표시 |
|---|---|---|---|
| FINAL_SHORTAGE | 예정입고(ORDERED/PARTIAL_RECEIVED)를 반영해도 최종 예상재고 < 0 | `peakShortageQty` | 최종 부족 |
| TEMPORARY_SHORTAGE | 기간 중 결품이 있으나 기존 확정 발주의 후속 입고로 최종 ≥ 0 | **0** (자동 제안 없음) | 일시 결품 — 납기 당김 / 긴급조달 검토 |
| 그 외 | 결품 없음 | — | 제안 불필요(표에 나오지 않음) |

### 제안수량의 의미 (peak vs final)

시간축 잔량을 `B(t)` 라 할 때, 새 공급 `Q` 가 **필요 입고일(결품예정일)** 에 도착하면(같은 날은 입고 → 수요) 이후 모든 잔량이 `+Q` 된다.
전 기간 결품을 없애는 최소 `Q` 는 `−min B(t) = peakShortageQty` 이다.

- 기존 확정 입고는 이미 `B(t)` 에 들어 있어 **중복 공급되지 않는다**(제안량에서 자동으로 빠진다).
- `finalShortageQty` 만 사면 최종 잔량은 0 이 되지만 후속 입고 전 구간의 일시 결품(`peak − final`)이 남는다.
  → 화면에 "최대결품 기준(최종부족 N)" 으로 차이를 표시한다.
- 새 공급이 필요 입고일보다 늦으면 일시 결품이 남는다. 리드타임 반영(발주 필요일 계산)은 Phase 5D 이므로 여기서는 계산하지 않는다.
- 필요일 표현은 "발주 필요일" 이 아니라 **결품예정일 / 필요 입고일** 이다.
- 사용자는 수량을 자유롭게 수정할 수 있다(> 0). 서버는 수량을 shortage 와 일치하도록 강제하지 않는다(구매 결정은 사용자 몫).

## 2. 공급업체 추천 (ItemSupplier, ACTIVE 관계 + ACTIVE SUPPLIER/BOTH 거래처만)

1. `isDefault` 가 있으면 그 공급업체
2. Default 가 없으면 `priority` 최소가 **정확히 1개**일 때 그 공급업체
3. 최저 priority 동률 / Default 중복(데이터 이상) → **자동 선택하지 않음**(사용자가 선택)
4. 관계 없음 → 공급업체 미지정(생성 불가)

"tenant 의 첫 공급업체" 와 최근 PO 는 자동 선택에 쓰지 않는다. 사용자는 **같은 품목의 다른 ACTIVE ItemSupplier** 만 선택할 수 있다
(전체 거래처 선택 불가 — 없으면 품목관리 > 공급업체 관리에서 등록).

## 3. 단가

- 기존 `ItemPrice`(PURCHASE) 를 읽기 전용으로 사용한다. 선택 규칙은 기존 발주 화면(`getItemPrice`)과 동일:
  `effectiveFrom ≤ 기준시각`, `effectiveTo` 없음 또는 `≥ 기준시각`, 최신 `effectiveFrom`. **선택한 공급업체의 가격만** 사용한다.
- 조회는 일괄 1쿼리. 표시 권한: `ITEM_PRICE READ` 또는 `PURCHASE_ORDER CREATE`.
- 생성 시 단가는 **서버가 다시 조회**한다(클라이언트가 보낸 단가는 없음). 단가가 없으면 기존 발주 폼 정책(`unitPrice ≥ 0`)과 같이
  0 으로 저장하고 품목 비고에 `단가 미등록(MRP 발주제안)` 을 남긴다. 합계금액은 모든 라인에 단가가 있을 때만 저장(없으면 null).
- 한 공급업체 발주에 서로 다른 통화가 섞이면 생성을 거부한다(통화 단순 합산 금지).

## 4. 입고예정일(헤더) / 그룹

- 발주서는 헤더 `expectedDate` 1개만 가진다(품목별 ETA 없음).
- 공급업체별 PO 1건. 기본 헤더 날짜 = 선택 라인 **필요 입고일 중 가장 빠른 날짜**(보수적). 사용자가 확인 Dialog 에서 수정 가능.
- 날짜가 없는 수동 행은 사용자가 날짜를 입력해야 생성된다. **임의 `today + 14일` 은 사용하지 않는다.**
- 같은 (품목, 공급업체) 중복 라인은 수량을 합산한다. 같은 품목을 서로 다른 공급업체에 나누어 발주하는 것은 허용.

## 5. DRAFT 생성 (서버 검증)

- 권한: `MRP CREATE` + `PURCHASE_ORDER CREATE` + role OPERATOR 이상. 권한 검사는 DB 접근 전에. tenantId 는 인증 컨텍스트.
- 서버는 화면 결과를 신뢰하지 않는다: 품목/공급업체/사이트 tenant 소유, (품목, 공급업체) 가 **ACTIVE ItemSupplier + ACTIVE SUPPLIER/BOTH** 인지,
  수량(> 0, 소수 6자리, 상한), 날짜 형식을 모두 재검증한다. 타 tenant/미등록은 구분 없이 같은 일반 오류, DB write 0.
- 전체를 하나의 트랜잭션으로 생성. 하나라도 실패하면 전체 롤백(부분 PO 없음). 감사로그(`PurchaseOrder CREATE`, source `MRP_PURCHASE_SUGGESTION`,
  공급업체/품목 수/총수량/입고예정일/발주번호/상태)는 같은 트랜잭션.
- 상태는 항상 `DRAFT`. 자동 ORDERED 전환/전송 없음. **DRAFT 는 MRP 예정입고에 가산되지 않는다**(5B 정책 유지) — 대신 발주제안 표에
  "DRAFT 발주 N 존재(미확정 · 입고예정 미반영)" 를 참고 정보로 표시한다.
- 업무 중복 방지(같은 부족을 다시 생성)는 MRP 실행 이력이 없어 이번 Phase 에서 완전히 보장하지 못한다(Phase 6 과 함께 검토).

## 6. 발주번호 채번

| 항목 | 이전 | 현재 |
|---|---|---|
| 형식 | `PO-YYYY-###`(3자리), MRP: `PO-MRP-${Date.now()}` | `PO-YYYY-######`(6자리 이상) — 예 `PO-2026-000101` |
| 다음 번호 | 문자열 desc 정렬 1건 + 1 (연 1,000건째 `999 > 1000` 오판 → 같은 번호 반복) | 같은 연도 접두어 번호의 **숫자 최대값 + 1** (3/4/6자리 혼재 OK, 비숫자 접미어·다른 접두어 무시) |
| 동시성 | unique + 최대 5회 재시도 | `pg_advisory_xact_lock(hashtext('PO_NO|tenant|year'))` 로 (tenant, 연도) 직렬화 + unique 제약이 마지막 방어선 + 호출부 재시도 |
| 다건 | — | 한 트랜잭션에서 N개 연속 확보(공급업체 3곳 → n+1, n+2, n+3) |
| tenant | tenant 범위 unique | tenant 별 독립 순번(타 tenant 번호 무영향), 연도가 바뀌면 1부터 |

기존 번호는 변경하지 않는다. 적용 경로: 일반 구매발주 등록(`createPurchaseOrder`), 발주제안 DRAFT 생성.
외주발주(`OS-`)와 수주(`SO-`) 채번은 이번 범위가 아니다.

## 7. 구조

```
order-mrp-panel.tsx ─ [발주제안] 탭 ─▶ purchase-suggestion-panel.tsx
                                         ├▶ getPurchaseSuggestions            (MRP READ)
                                         │    └▶ mrp-purchase-suggestion.service  [MRP 4 + 정책 1 + 단가 1 + DRAFT 1 + 사이트 1]
                                         │         └▶ mrp/purchase-suggestion.ts  (순수: 유형/제안량/공급업체 추천)
                                         └▶ createDraftPurchaseOrdersFromMrpSuggestions (MRP CREATE + PURCHASE_ORDER CREATE)
                                              └▶ mrp-purchase-draft.service ─▶ purchase-order-number.service
```

쿼리: 자재/수주 건수와 무관하게 8쿼리(수주 3건·303건·자재 300종 동일). N+1 없음.

## 8. 기존 코드

- 생산계획 MRP 의 `createPurchaseOrdersFromMRP`(첫 공급업체 / `PO-MRP-Date.now` / +14일 / 단가 0)는 **변경하지 않았다**.
  신규 수주기준 경로는 그 로직을 사용하지 않는다. 해당 경로의 정리는 별도 GAP.
- 5B 입고예정 정책(ORDERED/PARTIAL_RECEIVED 만), 엔진, Golden 결과는 그대로.

## 9. 테스트

| 명령 | 내용 |
|---|---|
| `npm run test:mrp-purchase-suggestion` | PS(공급업체 추천) / PQ(제안량·검증) / PG(그룹·날짜) / PN(채번·동시성) / PC(생성·롤백·감사·권한·타 tenant·DRAFT 비포함) / 쿼리 수 / 정적(122) |
| `npm run test:mrp-purchase-suggestion-ui` | 발주제안 표 SSR 렌더(23) |
| 회귀 | engine 182(Golden 0) · service 66 · security 54 · period 98 · simulation 71 · item-price 36 · item-supplier 130 · close 53 · scheduled-receipt 101 · UI 20 |

## 10. 남은 GAP

- 리드타임 기반 발주 필요일, MOQ, 발주배수, 안전재고 → Phase 5D
- 같은 부족에 대한 DRAFT 중복 발주 방지, MRP 실행 이력/Snapshot, 제안 재현성 → Phase 6
- 반제품 netting → Phase 5E
- 품목별 ETA(발주서는 헤더 날짜 1개)
- 생산계획 MRP 의 구매발주 생성 경로 정리(첫 공급업체/임의 납기/채번)
- 외주발주·수주 채번의 동일 한계(수주 `SO-YYYY-###`)
