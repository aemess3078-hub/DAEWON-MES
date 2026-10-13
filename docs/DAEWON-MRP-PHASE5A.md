# DAEWON MRP Phase 5A — 품목별 공급업체 기준정보

Phase 5B(입고예정 시간축 MRP)·5C(발주제안)·5D(리드타임/MOQ/배수 사용)가 읽을 **공급업체 기준정보**를 만든다.
**MRP 계산 결과는 바뀌지 않는다**(엔진·어댑터·MRP 서비스 변경 없음, ItemSupplier 를 계산에 사용하지 않음).

설계 근거: [DAEWON-MRP-PHASE5-DESIGN.md](./DAEWON-MRP-PHASE5-DESIGN.md) (안 B: 신규 `ItemSupplier` 관계 모델).

## 1. 선행 FIX — ItemPrice tenant 보안

| 문제(Phase 5-0 확인) | 수정 |
|---|---|
| `createItemPrice(tenantId, data)` 가 클라이언트 tenantId 와 `...data` 를 그대로 사용(`data.tenantId` 로도 덮어쓰기 가능) | tenantId 인자 제거, 인증 사용자 tenant 사용, 저장 필드를 명시적으로 선택 |
| `updateItemPrice` / `deleteItemPrice` 가 id 만으로 수정·삭제 | where 에 tenantId 포함(`findFirst` → `updateMany/deleteMany` + count 확인) |
| itemId / partnerId 소유 미검증 | 현재 tenant 소유 서버 검증, 타 tenant·미존재는 같은 일반 오류(`유효하지 않은 참조입니다.`) + DB write 0 |
| `getItemPrices(tenantId)` / `getAllPartners(tenantId)` 가 클라이언트 tenantId 로 조회(교차 tenant 읽기) | tenantId 인자 제거, 인증 tenant 한정 |

구조: `item-price.actions.ts`(인증/권한/revalidate) → `item-price.service.ts`(DB 주입형 코어, 테스트 가능).
기존 정상 CRUD 동작(필드, 감사로그 `품목 가격 관리`, 권한 `ITEM_PRICE` + `assertDaewonFeatureScope`)은 유지.
품목 단가 화면 자체는 대원정밀 허용 라우트 밖(개발자 계정 전용) 그대로다.

## 2. ItemSupplier 모델

| 필드 | 타입 | 정책 |
|---|---|---|
| id / tenantId / itemId / supplierId | String | `@@unique([tenantId, itemId, supplierId])` |
| isDefault | Boolean(false) | 품목당 **ACTIVE Default 최대 1개** |
| priority | Int(100) | 0~9999, **작을수록 우선** |
| leadTimeDays | Int? | null=미설정, 0=당일, 최대 3650 |
| moq | Decimal(18,6)? | null=미설정, > 0 (0 으로 미설정을 표현하지 않음) |
| orderMultiple | Decimal(18,6)? | null=미설정, > 0 |
| isActive | Boolean(true) | 비활성 시 isDefault 도 해제 |
| createdAt / updatedAt | DateTime | |

- 공급업체 자격: `BusinessPartner.partnerType ∈ {SUPPLIER, BOTH}` 이고 `status = ACTIVE`(CUSTOMER 전용·비활성 거래처는 등록/활성화/기본 지정 불가).
- 가격은 저장하지 않는다. 현재 유효 구매단가(`ItemPrice` PURCHASE, `effectiveFrom ≤ 오늘 ≤ effectiveTo`)는 **읽기 전용**으로만 표시하며 `ITEM_PRICE READ` 권한이 있을 때만 조회한다.
- FK: 품목 삭제 시 CASCADE(품목 삭제는 이미 이력 참조 검사를 통과해야 함), 거래처 삭제는 RESTRICT(기존 "연관된 데이터가 있을 수 있습니다" 안내 사용).
- 안전재고는 추가하지 않았다(Phase 5D `Item.safetyStock`).

## 3. 정책

| 항목 | 정책 |
|---|---|
| Default 변경 | 같은 transaction 에서 기존 Default 해제 → 신규 지정. 사용자에게 유니크 오류를 노출하지 않음 |
| 이중 방어 | DB partial unique index `ItemSupplier_one_active_default_per_item` + 서비스 로직 + CHECK(`inactive ⇒ not default`) |
| 동시성 충돌 | DB 제약(P2002) → 업무 오류 `CONFLICT`("다른 사용자가 동시에 변경했습니다…"), 원문 DB 오류 비노출 |
| 비활성화 | `isActive=false` + `isDefault=false` 동시 처리. 재활성화해도 Default 자동 복원 없음 |
| 삭제 | 비활성화 권장. 물리 삭제는 `ITEM DELETE` 권한 필요(MANAGER 는 비활성화만) — PO/이력 FK 가 없어 데이터 정합성 문제 없음 |
| 자동 배정 | 없음. 첫 공급업체 등록 시 UI 가 "기본 공급업체로 지정"을 제안만 한다 |
| 감사로그 | 기존 `AuditLog`(entityType `ItemSupplier`, 메뉴 `품목 공급업체`)에 CREATE/UPDATE/DELETE. 변경과 같은 transaction |

## 4. 권한 (새 RolePermission resource 없음)

| 동작 | 권한 |
|---|---|
| 조회 | `ITEM READ` (단가 표시는 추가로 `ITEM_PRICE READ`) |
| 등록 / 수정 / 기본 지정 / 활성 전환 | `ITEM UPDATE` + role OPERATOR 이상 |
| 공급업체 후보 검색 | `ITEM UPDATE` + `PARTNER_MANAGEMENT READ` |
| 물리 삭제 | `ITEM DELETE` + role OPERATOR 이상 |

tenantId 는 인증 컨텍스트에서만 결정(입력으로 받지 않음). itemId / supplierId / relationId 는 모두 tenant 소유 검증,
타 tenant·미존재는 구분 없이 `INVALID_REFERENCE`.

## 5. 서비스 / API

`src/lib/services/item-supplier.service.ts` (DB 주입형) · `src/lib/actions/item-supplier.actions.ts` (서버 액션)

| 함수 | 용도 |
|---|---|
| `listItemSuppliers` | 품목의 관계 목록(비활성 포함) — 쿼리 item 1 + itemSupplier 1 (+ itemPrice 1) |
| `searchSupplierCandidates` | ACTIVE SUPPLIER/BOTH 중 미등록 거래처, 코드/이름 검색, 최대 20건 |
| `createItemSupplier` / `updateItemSupplier` / `setDefaultItemSupplier` / `setItemSupplierActive` / `removeItemSupplier` | 변경 |
| `loadSupplierPolicies(db, tenantId, itemIds)` | **MRP 용 Batch**: 품목 수와 무관하게 쿼리 1회, ACTIVE 관계 + ACTIVE 거래처만, 기본/후보/LT/MOQ/배수 반환 |
| `getSupplierPoliciesForItems` / `getDefaultSuppliersForItems` | 인증 래퍼 / 기본 공급업체 map |

반환은 `{ success: true, data } | { success: false, code, error }` — 업무 오류는 코드와 한국어 메시지로 반환한다(권한 오류만 throw).

## 6. UI

품목관리(`/app/mes/items`) 행 메뉴 → **공급업체 관리**(조회 전용 사용자는 "공급업체 보기") → 우측 Sheet.
표: 공급업체 · 기본 · 우선순위 · 리드타임(일) · MOQ · 발주배수 · (현재 단가, 권한이 있을 때) · 상태 · 작업.
추가/수정 폼은 Sheet 내부 패널(공급업체 combobox 검색, 기본 지정 체크, 숫자 4종). 빈 상태 안내:
"등록된 공급업체가 없습니다. / MRP 발주제안을 사용하려면 품목별 공급업체를 등록하세요."
신규 최상위 메뉴 없음.

## 7. Migration

`prisma/migrations/20261014000000_add_item_supplier/migration.sql` — **additive, 신규 테이블 1개**.
CREATE TABLE + unique/index + FK 3개 + partial unique index + CHECK 5개 + `ENABLE ROW LEVEL SECURITY` + anon/authenticated `REVOKE`
(기존 `supabase_public_hardening` 은 당시 존재 테이블에만 RLS 를 켰으므로 신규 테이블에 직접 적용).
기존 migration/테이블/데이터는 변경하지 않는다. 적용 순서: **수동 `prisma migrate deploy` → 코드 배포**(역순 금지).

> partial unique index / CHECK 는 Prisma schema 로 표현되지 않아 이후 `migrate dev`/`migrate diff` 에서 drift 로 보일 수 있다.
> 의도된 수기 제약이며 SQL 주석에 명시했다. 삭제하지 말 것.

## 8. 테스트

| 명령 | 내용 |
|---|---|
| `npm run test:item-price-security` | IP1~IP5 + 권한/조회 경계(36) |
| `npm run test:item-supplier` | IS1~IS15 + 롤백/동시성/후보/단가/정적 점검(130) |
| 임시 Postgres(PGlite, 운영 DB 미접속)에 migration 체인 적용 | 테이블/FK/인덱스/partial unique/CHECK/RLS/권한 29개 점검 |
| 회귀 | order-mrp-engine 182(Golden 0 mismatch) · order-mrp-service 66 · mrp-security 54 · mrp-period 98 · mrp-simulation 71 |

## 9. 남은 GAP

- 입고예정(미입고 PO) 반영, PARTIAL_RECEIVED 잔량 종결 수단 → Phase 5B
- PO 채번(연 1,000건 한계), 발주제안, DRAFT PO 생성 개선 → Phase 5C
- 안전재고 → Phase 5D, 리드타임/MOQ/발주배수는 **저장만** 하고 계산에 사용하지 않음(5C/5D)
- 반제품 netting → Phase 5E
- 품목 Excel 업로드에 공급업체 컬럼 없음(Phase 7 이관 도구)
- `getItemsForSales(tenantId)` 등 다른 액션의 클라이언트 tenantId 신뢰는 별도 점검 대상(이번 범위 밖)
