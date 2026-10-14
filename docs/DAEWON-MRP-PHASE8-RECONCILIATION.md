# DAEWON MRP Phase 8 — Excel MRP 최종 정합성 검증 / Legacy MRP 종료 검증

Excel(MRP_자재소요량_엑셀프로그램V09.xlsm)의 계산과 DAEWON-MES MRP 를 최종 대조하고,
Excel 을 **운영 계산 Source 에서 제외해도 되는지** 판단한다. 검증 Phase 이므로 운영 DB write·schema·migration 은 0 이다.
이 문서에는 실제 품번/업체명/민감정보를 적지 않는다(건수와 정책만).

## 1. Excel 의 역할 / 자료 시점

Excel 은 **Legacy 계산 기준 + 회귀 검증 + 정책 비교 자료**이며 운영 Source of Truth 가 아니다. VBA 는 실행하지 않았고 저장된 셀 값과
이전에 분석한 VBA 의미만 사용했다. 원본 파일은 수정/삭제하지 않고 감사·회귀 자료로 보존한다.

| 시트 | 자료 시점 |
|---|---|
| 수주관리대장 | 납기 2026-06-01 ~ 06-30 |
| 재고관리대장 | 작성일자 **2024-01-05** |
| MRP작성 | 작성일자 **2024-02-20** (기간 2024-02-01 ~ 02-20) |
| 예상소요량(기간) | 2024-02 |

한 Workbook 안에서도 수주(2026-06)와 재고/MRP 결과(2024-01~02)의 시점이 다르다 → **Excel 값을 현재 운영 Source 로 쓸 수 없다**.
Excel 의 수주/재고/입출고는 운영 DB 로 import 하지 않았고, 계산 비교는 격리된 테스트 harness(메모리/fixture)에서만 수행했다.

## 2. 계산 모드

| 모드 | 용도 |
|---|---|
| `EXCEL_COMPAT` | Excel 과 같은 입력/정책에서 결과를 재현하는 회귀 모드(단일 레벨, 스크랩 미반영, Netting OFF, 입력 순서 옵션) |
| `NORMAL` | 현재 운영 정책: 실제 잔량(주문−출하), 실제 가용재고, 예정입고, DRAFT Coverage 분리, 안전재고, 공급업체 LT/MOQ/배수, 반제품 Netting, 납기 결정적 정렬, BOM 누락 경고, 다단계 전개 |

두 모드 결과가 다른 것은 오류가 아니라 §6 의 "의도된 정책 차이"로 분류한다.

## 3. Golden / 추가 시나리오

| 기준선 | 비교 | 결과 |
|---|---|---|
| Golden A (출고예정소요량) | 134 수주 × 273 자재 = 36,582 셀 | mismatch **0** |
| Golden B (MRP작성) | 9 수주 × 273 자재: 소요 2,457 + 잔량 2,457 셀, 결품수/누계 | mismatch **0** |

Workbook 기준선에서 선정한 대표 시나리오(`npm run test:mrp-phase8`): Excel 값이 있는 것(E1, E2)은 Excel 과, 재고 시나리오(E3~E6)는 독립 참조 계산(처리 순서대로 차감하는 단순 모델)과 대조했다.

| ID | 시나리오 | 결과 |
|---|---|---|
| E1 | 단일 완제품/단일 BOM | Excel 소요량과 일치 |
| E2 | 서로 다른 완제품 2건, 자재 공유 | 수주별 Excel 일치, 공유 자재 총소요 = 합 |
| E3 | 재고 충분 | 잔량 체인/최종 잔량 = 참조, 결품 0 |
| E4 | 재고 일부 부족 | 체인 = 참조, 일부 자재 결품 |
| E5 | 재고 0 | 최종 잔량 = −총소요 |
| E6 | 동일 자재 여러 수주 순차 사용 | 체인 = 참조 |
| E7 | 납기 여러 건 | NORMAL 납기 오름차순 |
| E8 | 동일 납기 여러 건 | COMPAT 입력순 유지 / NORMAL 입력순서 무관 결정적 |
| E9 | BOM 없는 제품 | 제외 + `MISSING_BOM`, 다른 수주 영향 없음 |
| E10 | 잘못된 BOM 수량(NaN/음수/Infinity) | 해당 수주 제외 + `INVALID_BOM_QUANTITY`(1 로 바꾸지 않음). 0 은 엔진에서 소요 줄 없음, Master import 에서는 REJECT |

## 4. 승인 BOM ↔ 운영 Master

운영 134 BOM / 909 line 을 Excel 승인 BOM 과 줄 단위로 대조(`npm run master:phase8-verify`, SELECT 전용):

| 구분 | 건수 |
|---|---:|
| 상위 제품 MATCH | **134** |
| 줄 MATCH | **909** (QTY_MISMATCH 0 / COMPONENT_MISMATCH 0 / MISSING 0 / EXTRA 0) |
| KNOWN_EXCLUSION — 수량 `"."` 원본 오류 | 1 |
| KNOWN_EXCLUSION — RAW REVIEW 로 차단 | 28 |
| 운영 BOM 중 Excel 에 없음(EXTRA) / 승인 BOM 누락(MISSING) | 0 / 0 |

BOM 없는 FINISHED 29 건은 MRP 엔진 결함이 아니라 Master Review 상태다. 이 제품에 수요가 들어오면 `MISSING_DEFAULT_BOM` 경고가 나는 것이 정상이다.

## 5. 정책 매트릭스 (Legacy Excel ↔ NORMAL)

| 항목 | 분류 | 설명 |
|---|---|---|
| due-date sorting | FIXED_LEGACY_BUG | NORMAL 은 납기 오름차순 + 결정적 정렬. Excel MRP 기간작성은 시트 순서로 계산(캐시 납기 비오름차순)되어 COMPAT `INPUT_ORDER` 에서만 재현 |
| all-MRP 범위 | FIXED_LEGACY_BUG | Excel "전체기간"은 오늘까지만 보는 성격 → NORMAL 은 상/하한 없는 전체. COMPAT 에서만 `legacyUpperBound` 재현 |
| missing BOM | MES_ENHANCEMENT | 제외 + 경고(직전 BOM 대입 없음) |
| 재고 기준 | SAME | 순차 차감, 음수 허용(NORMAL=실제 재고, COMPAT=이론 재고) |
| shippedQty 반영 | MES_ENHANCEMENT | 수요 = 주문수량 − 실제 출하수량 |
| Scheduled Receipt | MES_ENHANCEMENT | ORDERED / PARTIAL_RECEIVED 의 미입고 잔량만 |
| DRAFT PO | MES_ENHANCEMENT | 재고/예정입고 아님, 중복 발주 방지용 Coverage 로만 표시 |
| safety stock | MES_ENHANCEMENT | 물리 재고에서 차감하지 않고 구매정책 목표 하한 |
| MOQ / order multiple | MES_ENHANCEMENT | Coverage 차감 후 MOQ → 배수 올림(6자리 고정소수) |
| lead time | MES_ENHANCEMENT | 발주 필요일 = 목표 입고일 − LT(달력일) |
| supplier selection | MES_ENHANCEMENT | ItemSupplier Default → priority 최소, 동률은 자동 선택 안 함 |
| semi-finished netting | MES_ENHANCEMENT | 총 필요 → 가용 반제품 → 순소요 → 하위 전개(COMPAT 은 OFF) |
| What-if independence | SAME | 수주/발주와 독립(제품·수량 가상 입력) |

## 6. Legacy 동작의 취급

Golden 을 맞추기 위해 NORMAL 에 되살리지 않는다. 재현이 필요하면 `EXCEL_COMPAT` 옵션(`ordering: INPUT_ORDER`, `legacyUpperBound`,
`stockProviderType: EXCEL_THEORETICAL`)에서만 가능하며, NORMAL 에서 이 옵션들은 RangeError 다.
Excel 도움말과 실제 VBA 동작이 다른 부분(예: YeReq_Item)은 문서화만 하고 NORMAL 정책은 유지한다.

## 7. D1~D9 / Phase 5 정책 / 수치

| 항목 | 검증 |
|---|---|
| D1 | NORMAL 납기 오름차순, 입력 순서가 달라도 같은 처리 순서 |
| D2 | 전체 MRP: 과거/미래 납기 모두 포함 |
| D3 | BOM 없음: 제외 + 경고 |
| D4 | NORMAL=ACTUAL / EXCEL_COMPAT=EXCEL_THEORETICAL |
| D5 | 중복 수주 라인은 독립 수요 합산 |
| D6 | Default → priority → 동률 시 미선택 |
| D7 | 잔량 = 주문 − 실제 출하 |
| D8 | 제품 코드는 Item.code 로 원본 보존 |
| D9 | What-if 는 SalesOrder 모델 접근 없이 계산 |
| 예정입고 | 같은 날 입고는 수요 전에 반영, 미래 입고는 이전 결품을 소급 해소하지 않음, 경과/CLOSED/CANCELLED/DRAFT 제외, 부분입고는 잔량만 |
| DRAFT Coverage | 필요 100/DRAFT 80 → 20, MOQ 50 → 50, DRAFT 110 → 0, DRAFT 와 예정입고 동시 포함 불가 |
| 안전재고 | openingStock 불변, finalTargetDeficit/peakTargetDeficit 규칙 |
| 반제품 | 10 → 20 − 재고 8 → 12 → 원자재 36(COMPAT OFF → 60) |
| 수치 | NaN/Infinity/−0 없음, 소수 0.1×3, MOQ 1e-6, 배수 0.1 경계, 무작위 300 케이스(seed 고정) 항등식/보존/결정성 |

## 8. 성능 / 쿼리 수

- 엔진: 100 수주 × 300 자재 ≈ 5 ms, 300 수주 × 500 자재 ≈ 14 ms.
- DB 어댑터: 수주 10 × 자재 20 과 수주 200 × 자재 500 의 쿼리 수가 같다(MRP, 발주제안 모두 bounded, N+1 없음).

## 9. 운영 Master 읽기 전용 검증 / 빈 상태

- Master baseline hash `f435535b…10b2` 일치(2026-10-14).
- 운영 Master + 메모리상 가상 수요(1 / 10 / 100 EA): 수요 134줄, 소요 줄 909, 자재 243종, 독립 계산 불일치 0, BOM 없는 29제품은 제외 보고.
- 운영 Transaction 0(수주/재고/발주/생산/MRP 실행): MRP(전체/기간), 발주제안, 실행이력, What-if 가 오류 없이 빈 결과.
  빈 상태는 정상이며 write 버튼은 누르지 않았고 MrpRun 도 만들지 않았다.

## 10. Legacy Workbook Retirement 판단

| 조건 | 결과 |
|---|---|
| R1 Golden mismatch 0 | 충족 |
| R2 승인 BOM mismatch 0 | 충족(134/909 MATCH, 알려진 제외 29) |
| R3 NORMAL 정책 테스트 | 충족 |
| R4 Scheduled Receipt | 충족 |
| R5 DRAFT Coverage | 충족 |
| R6 Safety Stock / MOQ / LT | 충족 |
| R7 Semi Netting | 충족 |
| R8 What-if | 충족 |
| R9 Tenant / Permission | 충족(회귀 스위트: security 54, run history 200 등) |
| R10 Query / Performance | 충족 |
| R11 Production Master read-only | 충족 |

**결론: Excel MRP 를 운영 계산 Source 에서 제외해도 된다.** 원본 Excel 은 과거 자료·감사 근거·회귀 자료로 보존한다.
단 Go-Live 에는 실사 재고, 최신 미출하 수주, Open PO 의 최신 자료 확보와 Master 보완(Phase 7C Review Pack)이 선행되어야 한다.
