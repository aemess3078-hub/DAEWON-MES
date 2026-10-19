# DAEWON-MES — 자재입고 중복·재고 정합성 최종 검증

> 작성: 2026-10-19 · 기준 브랜치 `fix/daewon-stabilization-phase1` @ `22ba926` + 후속 커밋 · PR #5 (Draft 유지)
> 범위: 코드 정적 분석 + Fake 기반 테스트. **실제 DB 에서는 아무것도 실행하지 않았다(미검증).** DB 쓰기·migration·운영 접속 없음.

---

## 1. 중복 입고 시나리오별 방어 수준

방어 계층: **[C]** 클라이언트에서만 방지 · **[S]** 서버에서 방지 · **[X]** 현재 방지하지 못함

| 시나리오 | 결과 | 근거 |
|---|---|---|
| A. A 성공 → B 실패 → 같은 창에서 재시도 | **[C]** 방지 | `runReceivingBatch` 가 done 품목 재전송 금지, 입력 잠금. 서버는 같은 요청이 와도 잔량 이내면 다시 받아들인다 |
| B. A 성공 → 화면 새로고침(F5) | **[S 부분]** | 창 상태는 사라지지만 서버 데이터가 갱신되어 잔여수량이 줄어든다. 기본 입력값은 "잔여수량"이라 전량 입고였다면 0 이 된다. **사용자가 같은 부분 수량을 다시 입력하면 서버는 막지 못한다 [X]** |
| C. A 성공 → 창 닫기 → 다시 열기 | **[S 부분]** | B 와 동일. 열 때 상위 목록의 최신 값을 쓰므로 `router.refresh()` 가 끝난 뒤에는 잔여수량이 정확. 새로고침 직후 즉시 다시 열면 낡은 잔여수량이 보일 수 있으나, 서버의 잔량 검증이 **초과 입고는 차단** |
| D. 서버 성공 → 네트워크 응답 실패 | **[C]** 같은 창에서는 방지 (해당 품목 `unknown` 잠금, 자동 재전송 금지) / 창을 닫고 다시 열어 같은 수량을 직접 입력하면 **[X]** | 서버에 멱등 키가 없어 "같은 요청의 재전송"을 식별할 수 없다 |
| E. 서로 다른 두 사용자가 같은 품목 동시 입고 | **[S]** 직렬화 | `lockPurchaseOrderItemsForUpdate`(SELECT … FOR UPDATE) 후 잔량 재계산·검증. 잔량 이내의 두 건은 둘 다 정상 입고(업무상 구분 불가), 합계가 잔량을 넘으면 뒤 요청이 거절 |
| F. 다른 발주로 이동 시 이전 입력값/상태 잔존 | 수정 전 **잠재 위험**, 수정 후 **[C]** 방지 | 입고 창은 모달이라 UI 로 직접 전환은 어렵지만 `useState` 초기값이 prop 변경을 반영하지 않으므로 `key={receivingOrder.id}` 로 재마운트하도록 수정 |

**서버 차원의 멱등성(idempotency): 없음.** `ReceivingInspection` 에 요청 식별자/unique 제약이 없고(`@@index([purchaseOrderItemId])` 만 존재), 서버는 "같은 요청"을 구분하지 못한다. 현재 서버가 보장하는 것은 **누적 입고 ≤ 발주수량(합격 기준)** 이라는 상한뿐이므로, 중복으로 인한 과다 입고는 **최대 잔여수량까지**로 제한된다.

### 재고가 이중 증가하는가
- 한 번의 입고 처리 안에서 `ReceivingInspection` 생성 · `PurchaseOrderItem.receivedQty += 합격수량` · `InventoryBalance += 합격수량` · `InventoryTransaction(RECEIPT)` 이 **한 트랜잭션**이라 서로 어긋나지 않는다 (발주 품목 수량과 재고가 함께 오르거나 함께 롤백).
- 같은 요청이 두 번 처리되면 **두 곳 모두** 두 번 증가한다(어긋나지는 않지만 실물보다 과다). 상한은 발주 잔여수량.

## 2. 수량 개념과 정합성

| 값 | 저장 위치 | 비고 |
|---|---|---|
| 발주수량 | `PurchaseOrderItem.qty` | |
| 금회 입고수량 | `ReceivingInspection.receivedQty` | 합격 + 불합격 |
| 합격 / 불합격 | `ReceivingInspection.acceptedQty / rejectedQty` | 합격+불합격 = 금회 입고 (허용오차 0.001) |
| 누적 입고수량 | `PurchaseOrderItem.receivedQty` | **합격수량만 누적** |
| 잔여수량 | `qty − receivedQty` | 불합격은 잔여에서 차감되지 않음(대체 납품 가능한 정책) |
| 재고 증가 | `InventoryBalance.qtyOnHand/qtyAvailable += 합격수량` | LOT 관리 품목은 LOT 별 |

관찰 사항 (수정하지 않음 — 정책 판단 필요)
1. **불합격 누적 집계가 없다.** 불합격수량은 입고검사 이력 행에만 남고 발주 품목에는 합계가 없다. 전량 불합격이면 발주 상태가 바뀌지 않는다(대체 납품 전제). 불합격 총량 제한이 필요하면 정책 결정이 필요하다.
2. **서버 잔량 검증은 `금회 입고수량(합격+불합격)` 기준**인데 잔여는 합격 기준이다. 잔여 50 에 입고 60(합격 40·불합격 20)은 합격분이 잔여 이내여도 거절된다(보수적).
3. `result`(합격/불합격/조건부)와 합격수량의 일관성은 서버가 검증하지 않는다 (예: 판정=불합격인데 합격수량>0 이면 재고가 증가).
4. ~~합격+불합격 ≈ 입고수량 검증의 허용오차(0.001)~~ → **수정됨(§7)**: 소수점 6자리 정수로 정확히 비교한다(입고 100 · 합격 100.0005 는 거부, 0.3-0.1 잔량에 0.2 입고는 허용).
5. `inspectorId` 는 클라이언트 값이다(FK 만 존재 검증).

### 이번에 발견·수정한 추가 결함
| 결함 | 조치 |
|---|---|
| 서버가 클라이언트의 `purchaseOrderId` 를 발주 품목과 대조하지 않고 입고 후 `purchaseOrder.update({ where: { id: data.purchaseOrderId } })` 에 사용 → 다른 발주(다른 테넌트 포함)의 상태를 바꿀 수 있었음 | 발주 품목의 실제 `purchaseOrderId` 와 다르면 트랜잭션 전에 거절 |
| `NaN`/`Infinity` 수량이 기존 대소 비교 검증을 모두 통과 | 유한한 숫자 검증 추가 |
| 실패/결과 불명으로 중단되면 목록을 새로고침하지 않아 다시 열 때 낡은 수량이 보일 수 있음 | 중단 시에도 `router.refresh()` |
| 입고 창에 `key` 가 없어 발주가 바뀌면 이전 입력 상태가 남을 수 있음 | `key={receivingOrder.id}` |

### 중요한 DB 구조 위험 (미검증 — 운영 DB 확인 필요)
`prisma/migrations/20261013000000_daewon_initial_baseline` 은 `prisma migrate diff --from-empty` 로 만들어져, **Prisma 스키마로 표현할 수 없는 partial unique index 가 빠졌다.** 레거시(NMES) migration 에만 존재:

- `InventoryBalance_tenantId_itemId_warehouseId_null_lot_key` — `WHERE "lotId" IS NULL` (**LOT 미관리 품목 재고 행의 유일성**)
- `TenantUser_global_membership_uidx` / `TenantUser_site_membership_uidx` (사이트 NULL/NOT NULL 별 멤버십 유일성)

현재 활성 migration 에는 `(tenantId, itemId, warehouseId, lotId)` 일반 unique 만 있다. PostgreSQL 은 NULL 을 서로 다른 값으로 취급하므로 **`lotId` 가 NULL 인 행(LOT 미관리 품목)은 유일성이 보장되지 않는다.** 코드(`material-issue.actions.ts`, 입고)는 "partial unique index 가 단일 행을 보장한다"는 전제로 `findFirst → update / create` 한다.

- 영향: 같은 품목·창고에 **최초** 재고 행을 동시에 만드는 두 입고(서로 다른 발주 등)가 둘 다 `create` 하면 재고 행이 둘로 갈라진다. 이후 입고/출고가 `findFirst` 가 고른 한 행만 갱신해 "재고 없음/부족" 오류나 수량 불일치가 생길 수 있다. 순차 처리에서는 발생하지 않고, 동시 최초 생성 구간에서만 발생한다.
- Phase 9 감사 기준 운영 품목 427건이 모두 `isLotTracked=false` 였으므로 **LOT 미관리 경로가 현재 주 경로**일 가능성이 높다 (LOT 지정 후에는 완화).
- 확인(읽기 전용 SQL — **운영 DB 담당자가 실행**, 이 작업에서는 실행하지 않음):
  ```sql
  SELECT indexname, indexdef FROM pg_indexes
   WHERE schemaname='public' AND tablename IN ('InventoryBalance','TenantUser') ORDER BY 1;
  SELECT "tenantId","itemId","warehouseId", count(*) FROM "InventoryBalance"
   WHERE "lotId" IS NULL GROUP BY 1,2,3 HAVING count(*) > 1;
  ```

## 3. 서버 멱등성 설계안 (실행하지 않음 — 승인 필요)

**안 A (권장, 스키마 변경 1건)** — `ReceivingInspection.requestId String?` + `@@unique([purchaseOrderItemId, requestId])`.
- 클라이언트가 (다이얼로그 열림 × 품목)마다 UUID 를 만들고 재시도에도 같은 값을 보낸다.
- 서버는 발주 품목 행 잠금 후 같은 `(purchaseOrderItemId, requestId)` 가 있으면 **재처리 없이 성공 반환**(멱등).
- migration: `ALTER TABLE "ReceivingInspection" ADD COLUMN "requestId" TEXT; CREATE UNIQUE INDEX … ("purchaseOrderItemId","requestId");` — nullable 추가라 기존 행·기존 코드 호환, 테이블 잠금 짧음. 롤백: 인덱스·컬럼 DROP.
- 효과: D 시나리오(응답 유실 후 재시도)와 이중 클릭/이중 탭을 서버에서 차단. 창을 닫고 다시 열어 새 UUID 로 같은 수량을 직접 입력하는 경우는 여전히 의도된 별도 입고로 취급(막을 수 없음).

**안 B (스키마 무변경)** — 감사로그(`AuditLog.afterData.requestId`)를 같은 트랜잭션에서 조회해 중복 판정. 인덱스가 없어 조회가 느릴 수 있고 감사로그 보존정책에 의존하므로 비권장.

## 4. 테스트 DB 구성 가능성 (조사만 — 아무것도 설치/실행하지 않음)

| 항목 | 조사 결과 |
|---|---|
| Docker | **없음** (`docker` 명령 없음) |
| 로컬 PostgreSQL | 설치되어 있지 않음 (`psql/pg_ctl/postgres` 없음, `C:\Program Files\PostgreSQL` 없음) |
| WSL | Ubuntu(WSL2) 배포판 존재(중지 상태) — `apt install postgresql` 로 구성 가능한 후보 |
| Node 내장 DB | `embedded-postgres`/`pglite`/`pg-mem` 등 미설치. Prisma 5.22 는 PGlite 를 기본 지원하지 않음(비권장) |
| 대안 | 별도 Supabase **개발용 프로젝트**(운영과 다른 project ref) 또는 Windows PostgreSQL 설치 |
| `.env.local` | 운영 DB 로 보이는 `DATABASE_URL/DIRECT_URL` 이 존재(값은 출력하지 않음). **테스트 시 이 파일을 변경하지 않고, 셸 환경변수로만 덮어쓴다** (`src/lib/db/prisma.ts` 는 `process.env.DATABASE_URL` 만 읽고 `.env.local` 을 직접 읽지 않음) |
| Prisma migration | `prisma/migrations` = 대원정밀 baseline + 3개 추가 (`migrate deploy` 대상). `migrations_legacy_nmes` 는 Prisma 가 읽지 않으며 **실행 금지**(빈 DB 재생 불가). 혼입 위험: `db-migrate.legacy.js` 사용, `db push`, `migrate resolve` |
| Supabase 전용 SQL | `supabase_public_hardening` 등은 `anon/authenticated` 롤이 있을 때만 동작하도록 `IF EXISTS pg_roles` 로 가드되어 일반 PostgreSQL 에서도 실행됨 (RLS 는 켜지지만 소유자는 영향 없음) |
| 알려진 한계 | baseline 에 partial unique index 가 없다 → **테스트 DB 도 운영과 같은 결함을 재현**한다(오히려 검증에 유리). 위 §2 SQL 로 확인 가능 |
| 기존 DB 테스트의 위험 | `test-inventory-concurrency-integrity.ts` 는 `DATABASE_URL` 이 가리키는 DB 에 테넌트·품목·재고를 만들고 테넌트 단위로 삭제한다. **대상 DB 확인 가드가 없다** → 운영 URL 이 환경변수에 있으면 운영에 쓴다. 테스트 DB 확인 전 실행 금지 |

### 권장 구축 절차 (승인 후 실행)
1. 후보 선택: ① WSL Ubuntu 에 PostgreSQL 16 설치(권장: 비용 0, 운영과 물리적으로 분리) ② 별도 Supabase 개발 프로젝트
2. (WSL 예) `wsl -d Ubuntu -u root -- apt-get install -y postgresql` → `service postgresql start` → `createdb daewon_test` (사용자/비밀번호는 로컬 전용 값)
3. 셸에서만 환경변수 설정 (파일 수정 금지):
   `DATABASE_URL=postgresql://<user>:<pw>@127.0.0.1:5432/daewon_test`, `DIRECT_URL` 동일
4. **대상 확인 가드**: 호스트가 `127.0.0.1/localhost` 이고 DB 이름이 `daewon_test` 인지 먼저 출력·검증(운영 호스트면 중단)하는 래퍼를 둔다
5. `npx prisma migrate deploy` (빈 테스트 DB 에만) → `npx prisma migrate status` 로 5개 적용 확인. `db push`/`migrate reset` 은 사용하지 않는다
6. 데이터: 기존 테스트 스크립트가 자체 테넌트를 만들고 `cleanupTenant` 로 지운다 → 별도 seed 불필요. 입고 시나리오 테스트(동시 2건, 응답 유실 재시도, 최초 재고행 동시 생성)는 신규 작성 필요
7. 종료: 테스트 DB 를 통째로 `DROP DATABASE daewon_test` 후 재생성(데이터 정리의 가장 안전한 방법)

## 5. 기존 실패 7건 원인 분류

| 테스트 | 분류 | 원인 | 운영 영향 |
|---|---|---|---|
| role-permission-enforcement | **A** 테스트만 오래됨 | 기대 목록에 삭제된 `inventory.actions.createTransaction` 이 남아 있어 첫 실패에서 중단. 해당 항목을 뺀 임시 사본으로 돌리면 **나머지 권한 단언이 모두 PASS**. 재고 변경 액션 `adjustInventoryStock` 은 `INVENTORY UPDATE` 권한 + MANAGER 이상 가드가 있음 | 없음(권한 가드 정상). 단, 테스트가 중단되어 후속 단언이 CI 에서 실행되지 않는 상태 |
| cause-analysis (3건) | **B** 정책 변경 | 이력 보존 정책(F07)으로 불량 이력이 있는 검사는 삭제 자체를 거절(`assertInspectionHistoryMutable`). 테스트는 예전 "연쇄 삭제 순서"를 기대. tenant 소속 확인·"검사 기록을 찾을 수 없습니다" 오류는 현행 코드에도 있음 | 없음(오히려 데이터 보호 동작) |
| corrective-action (1건) | **B** | 위와 동일(시정조치 연쇄 삭제 기대) | 없음 |
| report-output (T18) | **A** | 정규식 창(120자)이 `assertDaewonFeatureScope()` 추가로 벗어남. 실제로는 여전히 `getDefectStats` 를 그대로 반환 | 없음 |
| production-plan-workorder-integrity (2건 + 파일 누락) | **A** + **D** | 상태 동기화 로직이 `production-plan-sync.ts` 로 이동(`FINAL_PLAN_STATUSES`, `evaluateProductionPlanWorkOrderCompletion` 그대로 존재)해 구 파일을 grep 하는 단언이 실패. NMES 전용 `test-production-plan-sales-link.ts` 는 대원정밀에 복사되지 않음. 임시 자리표시 파일로 우회해 보면 나머지 35개 단언은 PASS | 없음. 작업지시/생산계획 로직 자체의 결함 근거는 발견되지 않음 |
| bom-material-sufficiency | **D** | 위 NMES 전용 파일(`test-production-plan-sales-link.ts`)에 의존해 첫 단계에서 중단 → **BOM 자재 충족 검증 로직은 이 테스트로 검증되지 않는 상태(미검증)** | 판정 불가 — 재작성 필요 |
| f25-master-menu-cleanup-integrity | **B** | 메뉴 라벨이 `불량코드관리` 로 변경됨(테스트는 `불량관리` 기대) | 없음 |

**C(실제 기능 결함 가능성) 로 확정된 것은 없다.** 다만 bom-material-sufficiency 는 실행되지 않는 검증이라 재고/작업지시 관련 위험을 배제하지 못한다(미검증).

## 6. 이번 검증의 한계
- 실제 PostgreSQL 에서 동시성(행 잠금, 최초 재고행 생성 경합, `$executeRaw` advisory lock)을 실행하지 못했다.
- 운영 DB 의 인덱스 상태(§2)는 확인하지 못했다.
- 브라우저 렌더링은 확인하지 못했다.

---

## 7. 후속 수정: 수량 정밀도 · 커밋 이후 오류 · 결과 불명 (이번 커밋)

| 항목 | 이전 | 수정 |
|---|---|---|
| 수량 정밀도 | 합격+불합격 ≈ 입고수량에 **0.001 허용오차** → 입고 100 · 합격 100.0005 · 불합격 0 통과. 화면은 `received - accepted` 등 float 연산 (0.3-0.1 = 0.19999999999999998) | `src/lib/quantity-scale.ts`(Decimal(18,6) 정책, 소수점 6자리 정수 환산, 기존 자재출고 헬퍼를 공통화)와 `src/lib/receiving-quantity.ts`. 서버 사전 검증과 **트랜잭션 내부 재검증이 같은 함수**를 사용. NaN/Infinity/음수/6자리 초과 거부, 합계 정확 비교, 잔량 정확 비교, 쓰기에는 6자리로 정규화한 값 사용. 화면(불합격 자동계산·초과 판정·합계 검증·기입고/잔여 갱신)도 같은 정확 연산 |
| 커밋 이후 오류 | 입고 트랜잭션 커밋 후 `revalidatePath` 가 throw 하면 바깥 catch 가 "실패" 반환 → 사용자가 재시도하면 중복 입고 | `safeRevalidate`: 후처리 오류는 서버 로그(`post-commit revalidate failed`)에만 남기고 **성공 반환**. 입고·발주 등록·작업지시 등록·자재출고에 적용 |
| 커밋 결과 불명 | DB 연결/응답 오류도 "실패(재시도 가능)"로 안내 | 연결·타임아웃·트랜잭션 통신 오류(`P1001/P1002/P1008/P1017/P2024/P2028`, 연결 끊김 등)는 `outcome: "UNKNOWN"` + 확인 요청 메시지. **성공으로 단정하지 않고, 화면은 해당 품목을 잠가 자동 재전송을 막는다.** 롤백이 확실한 업무/제약 오류는 기존대로 실패(재시도 가능) |

한계: "결과 불명"은 사용자에게 알리고 재전송을 막을 뿐, 서버가 실제 반영 여부를 판정하지는 못한다(§3 멱등 키가 필요).

## 8. 스키마 변경이 필요한 보완안 (설계만 — 적용하지 않음, 승인 필요)

### 8-1. 서버 멱등 키 (`ReceivingInspection.requestId`)
```sql
-- 초안 (migration 으로 만들 경우; 지금은 실행하지 않는다)
ALTER TABLE "ReceivingInspection" ADD COLUMN "requestId" TEXT;
CREATE UNIQUE INDEX "ReceivingInspection_purchaseOrderItemId_requestId_key"
  ON "ReceivingInspection" ("purchaseOrderItemId", "requestId");   -- NULL 은 여러 건 허용(기존 행 영향 없음)
```
- 코드: 다이얼로그가 (열림 × 품목) 별 UUID 를 만들어 재시도에도 동일하게 전송 → 서버는 발주 품목 행 잠금 후 같은 키가 있으면 재처리 없이 성공 반환. `schema.prisma` 에 `requestId String?` + `@@unique([purchaseOrderItemId, requestId])` 추가.
- 운영 영향: nullable 컬럼 추가 + 인덱스 생성(테이블이 작아 짧은 잠금). 기존 코드/데이터와 호환, 롤백은 인덱스·컬럼 DROP. **기존 서버 코드를 먼저 배포해도 안전(키 미전송 = NULL).**
- 해소되는 위험: 응답 유실 후 재전송, 이중 클릭/이중 탭. 해소되지 않는 것: 새 창에서 같은 수량을 의도적으로 다시 입력.

### 8-2. 비LOT 재고 행 유일성 (`InventoryBalance`, `lotId IS NULL`)
```sql
-- 0) 사전 점검(중복이 있으면 인덱스 생성이 실패한다) — 읽기 전용
SELECT "tenantId","itemId","warehouseId", count(*) FROM "InventoryBalance"
 WHERE "lotId" IS NULL GROUP BY 1,2,3 HAVING count(*) > 1;
-- 1) 중복이 없을 때만
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryBalance_tenantId_itemId_warehouseId_null_lot_key"
  ON "InventoryBalance" ("tenantId","itemId","warehouseId") WHERE "lotId" IS NULL;
```
- 코드: 인덱스가 생기면 최초 생성 경합이 `P2002` 로 실패하므로, 입고/완제품입고의 `inventoryBalance.create` 를 "P2002 이면 다시 조회 후 increment" 로 바꿔야 한다(그렇지 않으면 사용자에게 중복 오류로 보임).
- 중복이 이미 있으면: 수량 합산 병합 절차(트랜잭션, 수불 이력 보존)를 별도 승인 후 수행해야 한다. 인덱스 생성 전 반드시 중복 0 확인.
- 운영 영향: 인덱스 생성 중 `InventoryBalance` 쓰기가 잠깐 대기. baseline 에 빠진 `TenantUser` partial unique 2건도 같은 방식으로 복구 검토.
- 이 두 변경은 서로 독립이며 이번 PR 에는 포함하지 않았다(`prisma/migrations` 변경 없음).

## 9. 테스트 DB 현황 재확인 (이번 작업)
- Docker 없음. 로컬/WSL(Ubuntu 26.04) 모두 PostgreSQL 미설치. WSL 일반 사용자(`aemess`)는 `sudo` 에 비밀번호가 필요해 **자동 설치 불가** — 사용자가 직접 설치해야 한다.
- 따라서 실제 DB 검증(발주→입고→LOT→작업지시→출고→투입이력, 동시 입고, 중복 요청)은 **수행하지 못했다(미검증)**.
