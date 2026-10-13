# DAEWON MRP Phase 5D — 안전재고 · 리드타임 · MOQ · 발주배수

발주제안(5C)에 **품목 안전재고**와 **공급업체 구매조건(리드타임 / MOQ / 발주배수)** 을 반영한다.
MRP 엔진의 물리 재고 시간축과 Excel 호환(Golden) 결과는 바뀌지 않는다. 반제품 netting(5E)·MRP 실행 이력(6)은 범위 밖.

## 1. 스키마 (migration 1건, additive)

`20261014010000_add_item_safety_stock`

```sql
ALTER TABLE "Item" ADD COLUMN "safetyStock" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Item" ADD CONSTRAINT "Item_safetyStock_range_chk" CHECK ("safetyStock" >= 0 AND "safetyStock" < 1000000000000);
```

- 기존 Item 행은 0. 신규 테이블이 아니므로 RLS/권한 변경 없음(기존 Item 상태 유지).
- CHECK 는 음수, NaN, Infinity(PostgreSQL 에서 NaN 은 모든 수보다 크다)와 1e12 이상을 차단한다.
- 품목 Excel 업로드는 변경하지 않았다(컬럼을 보내지 않아도 DB default 0 으로 정상 동작).

### 타입을 Decimal 이 아닌 Float 로 둔 이유

Item 행은 `include: { item: true }`, `prisma.item.findMany()` 등 수십 곳에서 **서버 → 클라이언트 props 로 그대로** 전달된다.
Prisma `Decimal` 은 클래스 인스턴스라 RSC 직렬화가 불가능해(기존 코드가 수량 필드를 모두 `Number()` 로 변환하는 이유) Item 에 Decimal 컬럼을 추가하면
변환을 놓친 모든 화면이 런타임에 깨질 수 있다. MRP 계산은 이미 `Number` 로 수행되고, 입력은 애플리케이션에서
**0 이상, 소수 6자리 이하, 1e12 미만**으로 검증한다(Decimal(18,6) 재고 수량과 같은 범위). MOQ/발주배수 계산은 저장 타입과 무관하게
소수 6자리 고정소수(BigInt)로 수행한다. 필요하면 후속 migration 으로 Decimal 로 바꿀 수 있다(그 경우 Item 노출 지점 변환 작업 필요).

## 2. 안전재고 정책

안전재고는 **물리 재고를 차감하는 값이 아니다.** `openingStock = qtyAvailable` 은 그대로이며, 안전재고는 "예상 잔량이 유지해야 하는 목표 하한"으로만 쓴다.
엔진(`runOrderMrp`)은 안전재고를 알지 못한다(코드에 개념 없음). 발주제안 계층이 기존 결과에서 파생한다.

```
minProjectedBalance = min(openingStock, 모든 수요 단계 이후 잔량)   (입고는 잔량을 올리기만 하므로 최저점이 될 수 없다)
finalTargetDeficit  = max(0, safety − finalBalance)         현재 확정 입고까지 반영한 최종 미달
peakTargetDeficit   = max(0, safety − minProjectedBalance)  시간축에서 하한을 지키려면 필요한 최대 보충량
```

| 케이스 | 조건 | 자동 제안 | 상태 |
|---|---|---|---|
| A | finalTargetDeficit > 0 | **peakTargetDeficit** (구매조건 적용 전 정책 필요량) | 최종 부족(final < 0) / 안전재고 부족(final ≥ 0) |
| B | final = 0 이고 peak > 0 | **0** (기존 확정 입고로 회복) | 일시 결품(min < 0) / 안전재고 일시 미달(min ≥ 0) — 납기 당김·긴급조달 검토 |
| C | 둘 다 0 | — | 제안 불필요 |

- **안전재고 = 0 이면 5C 와 동일**: final = 최종 부족, peak = 최대 결품, 필요일 = 최초 결품일(기존 firstShortageDate).
- 필요 입고일 = **최초 안전재고 침범일**. 시작 재고가 이미 미달이면 기준일(IMMEDIATE), 안전재고 0 이면 최초 결품일.
- 예: 50 → 수요 45 = 5 → 입고 5 = 10, 안전재고 20 → final 미달 10, peak 15 → 제안 15.
- MRP 범위는 "열린 수주의 BOM 구성품"이다. 수요가 전혀 없는 품목은 MRP 결과에 나오지 않으므로 안전재고만으로 제안되지 않는다.
- DRAFT 발주 수량은 예상 잔량/예정입고/안전재고 계산에 가산하지 않는다(ORDERED 이후에만 5B 로 반영).

## 3. 공급업체 구매조건

- **MOQ**: null = 제한 없음. 값이 있으면 `max(필요량, MOQ)`. 0 이하는 데이터 오류(생성 거부).
- **발주배수**: null = 제한 없음. 값이 있으면 `ceil(수량 / 배수) × 배수`.
- **순서**: 필요량 → MOQ → 배수 올림. (17 / MOQ 25 / 배수 10 → 30)
- **Decimal-safe**: 소수 6자리 BigInt 고정소수. `0.1 + 0.2` 도 배수 0.1 에서 0.3, 1.1 은 0.1 의 배수, 2.6 / 배수 0.5 → 3.0. 부동소수 `%` 를 쓰지 않는다.
- **리드타임**: 달력일. `발주 필요일 = 목표 입고일 − 리드타임`(윤년/연 경계 안전, 시간대 무관). 0 이면 목표일과 같은 날. null 이면 계산하지 않고 "리드타임 미등록".
- **입고예정일(헤더 expectedDate)** 은 목표 입고일이며 리드타임으로 바뀌지 않는다. 리드타임은 "언제 발주해야 하는가"만 계산한다.
- **타이밍 상태**: 여유 / 오늘 발주 필요 / 발주 필요일 경과(N일) / 리드타임 미등록. 경과해도 DRAFT 생성은 막지 않고 "납기협의/긴급조달 필요"를 알린다.

## 4. 공급업체 변경

화면은 서버와 같은 순수 함수(`deriveForSupplier`)로 **선택한 공급업체의 LT/MOQ/배수/단가만** 사용해 즉시 재계산한다.
수량을 직접 고친 행은 공급업체를 바꿔도 덮어쓰지 않고 구매조건 위반을 경고한다.

## 5. 서버 검증 (DRAFT PO 생성)

기존 5C 검증에 더해 서버가 ItemSupplier 를 다시 읽어(클라이언트 값 불신) 최종 수량이 `≥ MOQ` 이고 발주배수의 배수인지 확인한다.
위반 시 전체 생성을 거부(DB write 0, 관리자 예외 기능 없음). 감사로그에는 라인별 MOQ / 배수 / 리드타임 / 안전재고 /
필요 입고일 / 발주 필요일과 경과·미등록 건수를 요약한다. 가격·통화·헤더 날짜·DRAFT 고정 정책은 5C 그대로.

## 6. UI

- **품목 등록/수정**: "재고 정책 > 안전재고"(0 이상). 테이블 컬럼은 늘리지 않았다.
- **발주제안 표**: 안전재고 / 최저 예상 / 최종 예상 / 공급업체별 LT·MOQ·배수 / 정책 필요량 → MOQ → 배수 올림 산식 /
  제안수량 / 목표입고일 / 발주 필요일 / 상태(최종 부족, 안전재고 부족, 일시 결품, 안전재고 일시 미달, 공급업체 미지정, 발주 필요일 경과, 리드타임 미등록).
- **KPI**: 최종 부족 / 안전재고 부족 / 일시 결품·미달(검토) / 공급업체 미지정·불명확 / 발주 필요일 경과 / 리드타임 미등록 / 선택.
- 확인 Dialog: 발주 필요일 경과 경고("납기협의 또는 긴급조달이 필요합니다"), 리드타임 미등록 안내.

## 7. 쿼리 / 성능

안전재고는 기존 BOM 구성품 조회(`componentItem` select)에 포함되어 **추가 쿼리가 없다**. 발주제안 조회는 5C 와 같은 8쿼리이며
자재 300종에서도 동일하다(자재별 Item/ItemSupplier/ItemPrice 조회 없음).

## 8. 테스트

| 명령 | 내용 |
|---|---|
| `npm run test:mrp-purchase-policy` | SS1~SS5 / 시작 미달 / LT1~LT6 / MM1~MM8 / 공급업체 변경 / 서버 재검증 / 쿼리 수 / 정적 점검 (115) |
| `npm run test:mrp-purchase-policy-ui` | 정책 컬럼·산식·공급업체 변경·경고 SSR 렌더 (19) |
| migration 체인(임시 Postgres, 운영 미접속) | baseline → hardening → 5A → 5D: 컬럼/기본값/기존 행 0/CHECK(음수·NaN·Infinity·상한)/신규 테이블 없음/RLS·권한 유지 (19) |
| 회귀 | engine 182(Golden 0) · service 66 · security 54 · period 98 · simulation 71 · item-price 36 · item-supplier 130 · close 53 · scheduled-receipt 101 · UI 20 · suggestion 122 · suggestion UI 23 |

5C/5A 테스트 중 "해당 Phase 에서 쓰지 않음"을 단정하던 경계 검사 3건(Phase 5D 계산 미사용 / migration 3건 / safetyStock 필드 없음)은
5D 의 정당한 도입에 맞게 경계를 갱신했다(나머지 단정은 그대로).

## 9. 운영 적용 순서

1. `prisma migrate deploy`(DIRECT_URL, 수동) — `20261014010000_add_item_safety_stock` 1건
2. `prisma migrate status` → up to date, `preflight:supabase` → FAIL 0 / WARN 0 (RLS 대상 테이블 수 불변)
3. 코드 배포(커밋 → push → Vercel). **코드가 먼저 배포되면 Item.safetyStock 을 읽는 MRP/품목 화면이 오류**이므로 순서를 바꾸지 않는다.

## 10. 남은 GAP

- 영업일 달력/휴일 반영 리드타임
- 리드타임 분포·공급업체별 납기 실적 기반 조정
- 반제품 netting → 5E
- MRP 실행 이력/Snapshot, DRAFT 중복 발주 방지 → Phase 6
- 품목 Excel 업로드/템플릿의 안전재고 컬럼 → Phase 7
- 품목별 ETA(발주서 헤더 날짜 1개)
- 안전재고 변경 이력 전용 화면(감사로그에는 기록됨)
