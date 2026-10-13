# DAEWON MRP Phase 4 — 품목별 What-if 자재소요 시뮬레이션

실제 수주를 만들지 않고 **제품 × 예상 생산수량 → BOM 전개 → 자재 소요 → 가용재고 → 예상재고/부족**을 계산한다.
읽기 전용(DB write 0). Phase 1 엔진(`runOrderMrp`, NORMAL)을 그대로 재사용하며 엔진·기존 MRP 계산은 변경하지 않았다.

## Excel "예상소요량(품목)" 대응

| 구분 | 내용 |
|---|---|
| 업무 의도(시트 메모) | 수주관리대장과 무관하게, 사용자가 입력한 품목·수량에 대해서만 자재 소요를 계산 |
| VBA 실제 동작(`YeReq_Item`) | 입력 행(2~3행)을 지우고 **미출하 수주 라인**으로 채워 계산(기간·정렬 없음). 시트에 수식이 없어 입력만 바꿔서는 재계산되지 않음. 재고·부족 미표시 |
| MES | 의도 기준 구현: 제품·수량 입력 → 자재 소요 + 가용재고 + 예상재고 + 부족. "현재 수주 기준 소요"는 기존 수주기준 MRP / 기간 예상소요량이 담당 |

Excel 의 버그성 동작(입력 덮어쓰기, 수주 라인 대체)은 복제하지 않았다.

## 정책

| 항목 | 정책 |
|---|---|
| 입력 | `{ itemId, qty }[]` (최대 500). tenantId 는 받지 않음(무시) |
| 제품 대상 | `FINISHED`, `SEMI_FINISHED`(생산계획과 동일). 검색은 ACTIVE 만, 코드/이름 부분일치, 20건 제한 |
| 수량 | 유한한 수 > 0. 소수 허용(기존 정책에 정수 강제 없음), 반올림 없음 |
| 중복 입력 | 같은 제품은 합산(손실 없음) + INFO 안내 |
| BOM | tenant + ACTIVE + isDefault 1개. 없음/다중/빈 BOM/순환/수량 오류는 해당 제품만 제외·표시 |
| 다단계·스크랩 | 엔진 NORMAL(MULTI_LEVEL, scrapRate 반영), 동일 자재 합산 |
| 재고 | `qtyAvailable` 합계(격리/보류 LOT 제외). `qtyOnHand`/`qtyHold` 는 표시용, `qtyHold` 이중 차감 없음 |
| 실제 수요 | 포함하지 않음(가상 생산만 단독 계산). "현재 수주 + 추가 생산"은 후속 후보 |
| 반제품 재고 | 하위 자재 소요에서 차감하지 않음(기존 `explodeBOM`/엔진 NORMAL 과 동일). 화면에 안내 문구 |
| 가상 Demand | `SIM-001…` 식별자, 납기 없음(`deliveryDate=null`) — 임의 날짜를 만들지 않음 |
| 권한 | MRP READ (조회/메모리 계산뿐이므로 READ 로 충분) |
| 오류 노출 | 타 tenant/없는/비생산 품목은 구분 없이 "유효하지 않은 제품", 입력 ID 를 되돌려 주지 않음 |

## 구조

```
simulation-panel.tsx ─▶ runMrpSimulation / searchSimulationProducts   (mrp-simulation.actions.ts, MRP READ)
                          └▶ mrp-simulation.service.ts     [item 1 + BOM 레벨 + 재고 1, 읽기 전용]
                               ├▶ mrp-loaders.ts           [Phase 2 와 공유하는 BOM/재고 로더]
                               └▶ mrp/simulation-adapter.ts [가상 Demand → runOrderMrp → View, 순수]
```

- 쿼리 수: 제품 3개와 303개 모두 `item 1 + bOM(1~2레벨) + inventoryBalance 1`.
- 자재별 근거: 제품 / 예상수량 / 제품당 소요(다단계 전개 후 합산값) / 자재 소요. **다단계 경로(반제품 단계별)는 엔진이 보존하지 않아 제공하지 않음**(제품 단위까지 추적).

## 테스트

`npm run test:mrp-simulation` — 71 checks (W1~W12, 쿼리 수, 권한/tenant 위조, 읽기 전용, 제품 검색,
Excel 출고예정소요량 셀 합계와의 273자재 비교 차이 0).
