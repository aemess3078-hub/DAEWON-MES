# DAEWON MRP Phase 5E — 반제품 재고 Netting

반제품(SEMI_FINISHED)의 가용재고를 먼저 사용하고 **순소요만 하위 BOM 으로 전개**한다.
**DB schema / migration 변경 없음**, 운영 데이터 write 없음. EXCEL_COMPAT 과 Golden 결과는 바뀌지 않는다.

## 1. 기준 예제 (정상 목표 동작)

```
완제품 수요          10
완제품당 반제품       2
반제품 총 필요량(Gross)   20
반제품 qtyAvailable         8
반제품 순소요(Net)         12
반제품당 원자재             3
원자재 소요              12 × 3 = 36      (이전: 20 × 3 = 60)
```

## 2. 정책

| 항목 | 정책 |
|---|---|
| 사용 재고 | `InventoryBalance.qtyAvailable`(구성품 재고 집계, ACTIVE LOT 만). QUARANTINE / ON_HOLD / EXPIRED / CONSUMED 제외. `qtyHold` 재차감 없음, `qtyOnHand` 는 표시용, **안전재고(Item.safetyStock)는 netting 수량에서 차감하지 않음** |
| WIP | `WipUnit`/생산 진행 중 재공은 포함하지 않는다. 향후 완료예정을 가상의 생산입고로 만들지 않는다 |
| 복수 수요 | 반제품 재고는 itemId 별 **공용 pool 1개**. 기존 NORMAL 결정적 납기순으로 pool 을 차감(이중계상 없음). 예: 재고 10, PO1 필요 8 → 8 사용(잔여 2), PO2 필요 7 → 2 사용, 순소요 5 → 하위 5개분만 전개 |
| 다단계 | 반제품 Level 마다 `Gross → pool 사용 → Net → Net 만 하위 전개`. PRODUCT → SEMI-A → SEMI-B → RAW 에서 A, B 각각 netting |
| 확정 구매입고 | 반제품 pool 에는 Phase 5B 의 **ORDERED / PARTIAL_RECEIVED 잔량이 입고일 이후의 수요에만** 더해진다(같은 날 입고 → 수요). DRAFT/CLOSED/CANCELLED/RECEIVED 제외. 수요 이후 입고는 그 수요에 쓰지 않는다 |
| 내부 생산 입고 | 만들지 않는다. 순소요는 "생산/구매로 채워야 할 양"이며 같은 부족을 하위에 중복 전개하지 않는다 |
| 적용 | 수주기준 MRP NORMAL / 기간 MRP NORMAL / 품목 What-if NORMAL = ON. `EXCEL_COMPAT` = OFF(옵션으로 켜면 RangeError). `SINGLE_LEVEL` = 하위 전개가 없어 OFF. 생산계획 MRP(`calculateMRP`)는 변경하지 않음 |
| 반제품 행 | 총 소요(Gross) 기준 순차 차감은 그대로이므로 반제품 행의 부족 = **순소요**(예: 8 − 20 = −12). 원자재 행의 재고/예정입고/수요 시간축 계산은 그대로 |

### 시간축 의미 (구매 반제품 입고)

- 반제품 행의 잔량 시간축(`balance`)은 총 소요 기준이라 순소요가 음수 잔량으로 남는다(생산/구매로 채워야 할 양).
- netting pool 은 별도로 "시작 가용재고 + 처리 시점까지 도착한 확정 입고 − 사용분(0 미만 없음)"이다. 순소요를 생산으로 채운 경우 pool 은 0 에서 다시 시작하므로
  이후 도착하는 구매입고 전량이 다음 수요에 쓰인다(음수 잔량 때문에 입고분을 과소 사용하지 않는다).
- 수요 시점에 입고가 아직 없으면 그 수요는 순소요 전체를 하위로 전개한다(보수적, 나중 입고로 소급 해소하지 않음).

## 3. 구현

- `runOrderMrp`: `OrderMrpOptions.netSemiFinished`(기본 NORMAL+MULTI_LEVEL = true). 수요 처리 시 반제품 pool 을 차감하며 하위를 동적 전개한다.
  재고를 한 번도 쓰지 않은 수요는 기존 정적 전개 값을 그대로 쓴다(부동소수까지 이전 결과와 동일).
- 결과(additive): 수주 `semiNetting`(반제품별 총 필요/사용/순소요), `nettingContributions`(하위 소요의 출처), 자재 `nettedUsedQty` / `nettedNetQty`.
- View: 반제품 행 `netting`(총 필요 / 사용 / 순소요), 단계별 `semiNetting` / `netting`(상위 반제품 총 − 재고 = 순소요 × 1단위당 소요 = 소요).
- UI: 결품예측(자재 행 요약 + 상세 + 근거 열 / 시간축 보기 근거), 기간 예상소요량, 품목 시뮬레이션(안내 문구 갱신 + 근거).
- 쿼리 추가 없음(재고는 기존 구성품 재고 조회 1회, 입고는 5B 조회 1회).

## 4. 회귀 / 변경된 기대값

NORMAL 에서 반제품 재고가 있는 **기존 테스트 fixture 는 없었다**(기존 fixture 의 반제품 재고는 0 이거나 하위 BOM 이 없는 구매 반제품).
따라서 기존 테스트 기대값 변경은 0건이며(Before/After 표 없음), 새로운 동작은 신규 테스트가 고정한다.

| 시나리오 | Before(5D) | After(5E) | 이유 |
|---|---|---|---|
| 완제품 10, 반제품 2/개, 반제품 재고 8, 원자재 3/개 | 원자재 60 | **36** | 반제품 재고 8 사용 → 순소요 12 |
| 2단계(P→A 2→B 3→RAW 4), 수요 10, A 재고 5, B 재고 10 | RAW 240 | **140** | A 순소요 15, B 총 45 − 재고 10 = 35 |
| 재고 10 을 쓰는 2개 수주(필요 8, 7) | RAW 15 | **5** | 공용 pool: 8 + 2 사용, 순소요 5 |

- EXCEL_COMPAT Golden A 36,582셀 / B 2,457 + 2,457셀: mismatch 0(netting OFF).
- 재고 0 / 반제품 재고 없음: 기존 계산과 완전히 동일(플래그 off 결과와 비교 테스트).

## 5. 테스트

| 명령 | 내용 |
|---|---|
| `npm run test:mrp-semi-netting` | NT1~NT11: 기준 예제, 공용 pool, 다단계/스크랩, 재고 0 동일, 전량 충당, 구매입고(ORDERED/PARTIAL/DRAFT/CLOSED/수요 이후), 호환/옵션, 재고 정책(LOT/qtyHold/안전재고/WIP), 기간 MRP, What-if, 화면 근거, 쿼리 수, 정적(65) |
| `npm run test:mrp-semi-netting-ui` | 반제품 요약/상세/근거 열/시간축 보기/기간 예상소요량 렌더(8) |

## 6. 남은 GAP

- 생산계획 MRP(`calculateMRP`)의 반제품 재고 netting(이번 범위 밖, 의도적으로 미변경)
- WIP(재공) 완료예정을 반제품 공급으로 보는 기능(Scheduled Production Receipt)
- 반제품 재고를 특정 수주에 예약/할당하는 기능, 납기 이전 입고 한정 같은 고급 배분 규칙
- 반제품 자체의 발주제안에서 "순소요" 기준 MOQ/배수 적용은 5D 규칙 그대로(순소요 = 반제품 행 부족)
- MRP 실행 이력/Snapshot → Phase 6
