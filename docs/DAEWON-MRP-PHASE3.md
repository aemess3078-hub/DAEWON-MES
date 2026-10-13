# DAEWON MRP Phase 3 — 기간 MRP + 예상소요량(기간)

Phase 1 엔진 / Phase 2 DB 어댑터를 그대로 재사용한다. **계산 알고리즘·DB 쿼리·schema 변경 없음.**
기간은 엔진 옵션 `from/to`, 예상소요량은 같은 실행 결과(`OrderMrpView`)를 다른 관점으로 변환한 것이다.

## Excel 기능 대응

| Excel | MES |
|---|---|
| MRP 기간작성 (`MRP_Calcu`) | 수주기준 MRP + 기간 → 납기 `[from,to]` 수주만 납기순 순차 차감 (같은 엔진) |
| 예상소요량(기간) (`YeReq_Wol`) | "기간 예상소요량" 보기 — 기간 내 수주의 자재 소요 합계·수요 상세 (재고 반영은 참고 정보) |
| 년/월/분기/반기 ▲▼ | 프리셋(이번 달·다음 달·이번 분기·다음 분기·상반기·하반기·올해) + 이전/다음 이동, 이동 즉시 재계산 |
| 기간 입력(H5:H6, E4:E5) | 납기 시작일/종료일 직접 입력(= "직접 선택") |
| "MRP 전체작성" | "전체 미출하" |

Excel 과의 의도된 차이(버그 비복제):
- 이동 범위: Excel 은 최초 수주월~오늘까지만 이동 가능, MES 는 제한 없음.
- 전체 기간: Excel 은 사실상 "오늘까지"(분석 X2), MES 는 현재 존재하는 모든 미충족 수요.
- 정렬: Excel 기간작성은 납기 정렬이 적용되지 않은 시트 순서(분석 X1), MES 는 납기 → PO → 라인 순서.

## 기간 정책

| 항목 | 정책 |
|---|---|
| 기준일 | `SalesOrderItem.deliveryDate ?? SalesOrder.deliveryDate` → KST date-only |
| 경계 | `from <= 납기 <= to`, 양끝 포함 |
| 단위 | 달력 기준. 월 1일~말일(윤년 반영), 분기 Q1~Q4, 상/하반기, 연 |
| 부분출하 | 잔량(`qty − shippedQty`)만 대상 |
| 취소 | 제외 (조회 단계에서 제외) |
| DRAFT | 기본 제외, 체크 시 포함 |
| 납기 미등록 | `SalesOrder.deliveryDate` 가 NOT NULL 이라 DB 에서는 발생하지 않음. 엔진에 값이 없으면 기간 지정 시 제외 + 경고 |
| 기간 밖 선행 수주 | 기간 MRP 는 기간 내 수주만 차감한다. 기간 이전 납기의 미출하 수주는 재고를 선점하지 않음(화면에 안내 표시) |

## 구조

- `src/lib/mrp/period.ts` — 순수 유틸: `unitRange / shiftUnit / unitFromDate / matchUnit / presetSelection / moveSelection / selectionFromRange`. 현재 시각을 읽지 않으며 기준일은 caller 가 전달.
- `src/lib/mrp/order-mrp-adapter.ts` — View 에 기간 소요량 필드 추가(`demandLineCount, productCount, firstNeedDate, lastNeedDate, bomQtyPerUnit, kpi.productCount, kpi.requirementLineCount`).
- UI: `period-selector.tsx`(프리셋/이동/날짜), `period-requirement-table.tsx`(기간 예상소요량), `order-mrp-panel.tsx`(보기 전환·필터·URL 상태).
- URL: `?from=YYYY-MM-DD&to=YYYY-MM-DD&draft=1&view=requirement` 를 `history.replaceState` 로 반영하고 마운트 시 복원(새로고침/공유).

## 테스트

`npm run test:mrp-period` — 98 checks (기간 유틸 P1~P11, 기간 MRP 경계·부분출하·취소·BOM 누락, 예상소요량 집계/상세, 쿼리 수).
