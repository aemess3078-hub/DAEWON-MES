# DAEWON-MES — PR #5 운영 배포 사전 점검 (Production Pre-deploy Checklist)

> 작성: 2026-10-19 · 대상 PR #5 (`fix/daewon-stabilization-phase1` @ `96ff897`, Draft) · **이 문서는 계획·절차서이며 운영 DB/Vercel 에 어떤 작업도 하지 않았다.**
> 확인 방법 표기: ✅ 실제로 확인함 · ⚠ 확인하지 못함(방법 명시) · 🔒 사용자 승인 필요

---

## 1. 운영 환경 현황

| 항목 | 상태 |
|---|---|
| GitHub `main` | ✅ `aee84bc` (PR #3 병합). 기본 브랜치 `main`, **브랜치 보호 규칙 없음**(누구든 권한이 있으면 main 에 push/병합 가능), 저장소는 **public** |
| Vercel Production | ✅ GitHub Deployment 로 확인: 최신 Production = `aee84bc`, 2026-10-18 15:42Z, `success` (`daewon-10ae8qq0d-…`). **main 과 Production 이 일치**. 이 배포가 PR #5 병합 후의 **Instant Rollback 대상** |
| 자동 배포 | ✅ `main` 으로 병합/push 되는 순간 Production 자동 배포 시작(`docs/DEPLOYMENT-VERCEL.md` §8). 빌드는 `prisma generate && next build` 뿐이며 **migration 은 절대 자동 실행되지 않는다** |
| PR #5 | ✅ Draft · OPEN · mergeable · Vercel Preview `success` (`96ff897`). Preview 배포 7개(c79b58a…96ff897)는 모두 Preview 환경 |
| 다른 열린 PR | ✅ #1 (`feat: Daewon NCWatch integration + Agent v3 (Phase 12)`, "배포 승인 전, 병합 금지") — PR #5 와 **다른 브랜치**, 병합하지 않는다. 먼저 병합되면 충돌 가능 |
| 병합 방식 | ✅ merge commit / squash / rebase 모두 허용. 이전 PR 은 merge commit(`Merge pull request #n`) → **merge commit 권장**(커밋 이력 보존) |
| Production vs Preview 환경변수 분리 | ⚠ **확인하지 못함.** Vercel CLI 미설치·미로그인이며 대시보드 접근 권한이 없다(값은 어차피 출력하지 않는다). 설계 문서 상 정책은 "Preview 에는 DB/Storage 변수를 넣지 않는다"이나 실제 설정 확인 기록은 없다(Phase 10 메모: Preview 가 운영 DB 를 가리킬 가능성 미확인). **확인 방법: Vercel → Project → Settings → Environment Variables 에서 `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `POP_*` 각 변수의 "Environments" 칸에 Preview 가 체크되어 있는지 본다(값 열람 불필요).** 또는 `vercel env ls` 는 이름·환경만 보여 준다 🔒(사용자 수행 또는 승인) |
| Production 필수 변수(문서 기준) | ⚠ `DATABASE_URL`(6543 pooler), `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_BRAND=daewon`, `DEFAULT_TENANT_ID`, `JWT_SECRET`, `POP_PIN_SECRET`, `POP_WORKER_SESSION_SECRET`. `DIRECT_URL` 은 Production 에 불필요(migrate 전용, 관리 PC 의 `.env.local`). 이번 PR 은 **새 환경변수를 요구하지 않는다** |
| 운영 DB | ⚠ 직접 확인하지 않음(승인 전). 과거 작업 기록상 운영 DB 는 Supabase `ap-northeast-2`, tenant `daewon-001`, 마스터 데이터(품목 427·BOM 134·협력사 19) 외 **거래 테이블은 0건**이었고(2026-10-14), 이후 NCWatch 설비/태그 데이터가 들어와 현재도 쓰기 중(스냅샷 15분 주기) |
| 운영 DB 의 Prisma migration 상태 | ⚠ 기록상 `20261013000000`~`20261014020000` 5개 적용(MRP 단계에서 사용자 승인 하에 적용) — **점검 SQL 로 재확인 필요** |

## 2. 적용 예정 Migration (순서 고정)

| 순서 | Migration | 내용 | 기존(운영 중) 코드 `aee84bc` 에 대한 영향 |
|---|---|---|---|
| 6 | `20261019000000_add_receiving_request_idempotency` | 신규 테이블 `ReceivingRequest` + unique/인덱스/FK/CHECK + RLS | 기존 코드는 이 테이블을 모르고 쓰지 않는다 → **무영향**. 반대로 **새 코드는 이 테이블이 없으면 입고가 전부 실패**하므로 코드보다 먼저 적용해야 한다 |
| 7 | `20261019010000_add_inventory_balance_null_lot_unique` | `InventoryBalance (tenantId,itemId,warehouseId) WHERE lotId IS NULL` partial unique index (사전 검증 포함) | 기존 코드는 인덱스를 몰라도 동작한다. 중복이 없다면 정상 흐름은 동일하고, 동시 최초 입고 경합이 생기면 이전엔 중복 행이 생기던 것이 **P2002 오류로 롤백**(데이터 안전, 사용자는 재시도) |

- 앞의 5개(baseline~MRP 이력)는 운영에 이미 적용되어 있어야 한다. `migrate deploy` 는 **미적용 분만** 순서대로 적용한다(6 → 7).
- 둘 다 **additive**: 기존 테이블 컬럼·데이터 변경/삭제 없음, 기존 migration 파일 무수정(PR 에서 신규 폴더 2개만 추가됨).
- **작업 시간(예상)**: 테이블 생성·인덱스 생성 모두 작은 테이블이라 초 단위. 인덱스 생성(`CREATE UNIQUE INDEX`)은 생성 동안 `InventoryBalance` **쓰기를 잠깐 막는다**(읽기는 가능). NCWatch 에이전트는 다른 테이블(TagSnapshot 등)에 쓰므로 영향 없음. 점검 SQL 의 #71(오래 열린 트랜잭션)·#72(테이블 크기)로 확인 후 업무 시간 외 적용 권장.
- **실행 환경**: 관리 PC 에서 `DIRECT_URL`(Session pooler **5432**, 트랜잭션 풀러 6543 금지)로 `npx prisma migrate deploy`. `db push` / `migrate resolve`(실패 복구 외) 금지.
- 롤백성: 두 migration 모두 트랜잭션 — 실패하면 DB 는 변하지 않는다. 7번이 `NULL_LOT_DUPLICATES`(중복 재고 존재)로 실패하면 6번은 이미 적용된 상태로 남고 migration 이력에 7번 실패 기록이 남는다 → 원인(중복) 해소 후 `prisma migrate resolve --rolled-back 20261019010000_add_inventory_balance_null_lot_unique` → `prisma migrate deploy`. 실패한 migration 이 있는 동안 다른 migration 은 P3009 로 막힌다.

### 순서 의존성 요약
- **DB migration → (검증) → main 병합(=Production 자동 배포)** 순서여야 한다. 병합이 곧 배포이므로 "코드 먼저, migration 나중"은 입고 장애를 만든다.
- migration 만 적용된 상태(코드는 아직 구버전)는 안전하게 유지 가능 — 병합을 미뤄도 된다.

## 3. 운영 DB 점검 (🔒 읽기 전용 조회 승인 필요)

운영 DB 조회 권한은 이번 단계에서 승인되지 않았으므로 **접속하지 않았다.** 아래를 사용자(또는 승인받은 담당자)가 실행한다.

**도구**: `scripts/sql/production-predeploy-readonly-checks.sql` — **SELECT 한 문장**(쓰기 없음). 결과표(ord/item/value/expected/status)를 돌려준다.
- psql: `PGOPTIONS="-c default_transaction_read_only=on" psql "<DIRECT_URL>" -X -f scripts/sql/production-predeploy-readonly-checks.sql` (읽기 전용 세션이라 쓰기 시도는 서버가 거부한다 — 로컬에서 `cannot execute DELETE in a read-only transaction` 확인)
- 또는 Supabase SQL Editor 에 파일 내용을 그대로 붙여 실행. 접속 문자열은 화면/로그에 출력하지 않는다.
- 상세 중복 조회: `scripts/sql/inventory-balance-null-lot-duplicates.sql` (역시 SELECT 만).
- 대안: 기존 `npm run preflight:supabase`(읽기 전용, 값 미출력) — migration 상태·RLS·Storage 확인.

**확인 항목 → 판정**
| 항목 | 기대(배포 전) | BLOCK 이면 |
|---|---|---|
| PostgreSQL 버전 | 15 이상 | WARN — migration/점검 SQL 은 PG 11+ 기능만 쓰지만 **실제 검증은 로컬 PG 18 에서만** 했다. 운영 버전이 다르면(특히 15 미만) 결과 공유 후 판단 |
| 실패/미완료 migration 수 | 0 | 먼저 해결(`P3009` 상태에서는 새 migration 불가) |
| migration 1~5 | applied | 미적용이면 6·7 보다 먼저 적용 필요 — 사용자 승인 후 순서대로 |
| migration 6·7 | PENDING (배포 후 applied) | — |
| `ReceivingRequest` 테이블 | 없음 | 이미 있으면 정의 확인(수동 생성 흔적) |
| 동명 인덱스 | 없음 / 있으면 정의 "정상" | 정의가 다르면 migration 7 이 `NULL_LOT_INDEX_MISMATCH` 로 중단(덮어쓰지 않음) → 수동 정리 후 진행 |
| **비LOT 중복 재고 그룹 수** | **0** | **배포 중단** → §5 |
| 음수/불일치 재고, txNo 중복 | 0 | WARN — 원인 파악 후 진행 여부 결정 |
| 업무 데이터 건수(PO/입고/수불/LOT/작업지시) | 참고 | 0 에 가까우면 영향 범위가 작다는 근거 |
| 활성 세션·가장 오래된 트랜잭션·테이블 크기 | 참고 | 인덱스 생성 시 대기 가능성 판단 |

**검증 기록**: 점검 SQL 은 ① 로컬 테스트 DB(배포 후 상태): 6·7 applied, 중복 0 ② 임시 DB 로 만든 "배포 전" 모의 상태(migration 5개 + 비LOT 중복 재고): 6·7 `PENDING`, 중복 `BLOCK` 로 의도대로 동작함을 확인했다.

## 4. 백업 및 복구

### 4-1. 백업 (migration 직전, 🔒 승인 후)
1. **Supabase 자체 백업 확인(⚠ 플랜 미확인)**: 대시보드 Database → Backups 에서 (a) 플랜이 일일 백업/PITR 을 제공하는지 (b) 최신 백업 시각을 기록. Free 플랜이면 자체 백업이 없다 → 2번 필수.
2. **논리 백업(필수 권장)** — DB 담당자가 관리 PC 에서 `DIRECT_URL`(5432)로 실행(접속 문자열은 환경변수로만 전달, 출력 금지):
   ```
   pg_dump --format=custom --no-owner --no-privileges --file=daewon-prod-YYYYMMDD-HHMM.dump "$DIRECT_URL"
   pg_restore --list daewon-prod-YYYYMMDD-HHMM.dump | wc -l      # 덤프 목차 검증(비어 있지 않은지)
   ```
   - `pg_dump` 는 서버와 같거나 **더 높은 메이저 버전**이어야 한다(운영 PG 버전은 점검 SQL #10 으로 확인).
   - 덤프 파일은 저장소/Git/채팅에 올리지 않고 접근 제한된 위치에 보관(고객 데이터·계정 해시 포함).
   - 최소 범위가 필요하면 `-t '"InventoryBalance"' -t '"InventoryTransaction"' -t '"PurchaseOrder"' -t '"PurchaseOrderItem"' -t '"ReceivingInspection"' -t '"Lot"' -t _prisma_migrations` 로 부분 덤프 추가(전체 덤프를 대체하지는 않음).
3. **복원 리허설(권장)**: 위 명령 쌍을 **로컬 테스트 DB 로 실제 수행해 검증**했다 — 덤프 1.6MB, `pg_restore --list` 116개 TABLE DATA, 별도 임시 DB 로 복원 후 `InventoryBalance`/`InventoryTransaction`/`PurchaseOrder`/`ReceivingRequest`/`_prisma_migrations` 행 수 전부 일치, partial index 보존(임시 DB 삭제 완료). 운영 덤프는 **운영 DB 위에 덮어 복원하지 않고** 새 Supabase 프로젝트/임시 DB 에 복원해 검증한다.

### 4-2. 복구 시나리오 (심각도 순)
| 상황 | 조치 | 데이터 영향 |
|---|---|---|
| 새 코드에 결함 (migration 정상) | Vercel **Instant Rollback → `aee84bc` 배포(`daewon-10ae8qq0d-…`)**. 구 코드는 새 테이블/인덱스와 호환(§2) | 없음. 롤백 동안 입고는 구 동작(멱등성·정밀도 보강 없음) |
| migration 7 이 중복으로 실패 | DB 불변. 중복 해소(§5) → `migrate resolve --rolled-back` → 재배포 | 없음 |
| 인덱스가 업무에 문제를 일으킴(예상 낮음) | `DROP INDEX "InventoryBalance_tenantId_itemId_warehouseId_null_lot_key";` (코드는 인덱스 없이도 동작) | 없음 |
| `ReceivingRequest` 제거가 필요 | 코드를 구버전으로 되돌린 **뒤에만** `DROP TABLE "ReceivingRequest";` (보통 불필요 — 남겨도 무해). `_prisma_migrations` 행은 건드리지 않는다 | 멱등 기록 손실(구 코드는 사용 안 함) |
| 데이터 훼손/오삭제 | 4-1 의 덤프를 **새 DB 에 복원 → 필요한 테이블/행만 대조·이관**(전체 덮어쓰기 금지). Supabase PITR 가 있으면 복원 시점 지정 | 복원 시점 이후 데이터(NCWatch 스냅샷 등)는 별도 재수집 필요 |

## 5. 중복 재고가 발견된 경우 (자동 삭제·합산 금지)

- migration 7 은 중복이 있으면 **스스로 중단**하며, 이 저장소의 어떤 코드/스크립트도 중복 행을 삭제·합산하지 않는다.
- 정합성 유지 원칙: `InventoryBalance` 는 **어떤 테이블에서도 FK 로 참조되지 않는 말단 행**(스키마 확인)이므로 합친 뒤 남는 행의 수량 = 중복 행들의 합계가 되어야 하며, 수불 이력(`InventoryTransaction`)은 **그대로 두고 새 수불을 만들지 않는다**(수량 이동이 아니라 행 정리이므로).
- 승인 후 DB 담당자가 수행할 절차(설계):
  1. 백업 확인(§4) 후 업무 정지 시간 확보(입고·출고·반품·출하·재고조정 중단).
  2. 대상 그룹별로 **수불 원장 대조**: `기초재고(원장에 없는 수량) + Σ(RECEIPT − ISSUE ± ADJUST …)` 와 `Σ(중복 행 qtyOnHand)` 를 비교해 합계가 원장과 맞는지 확인. 맞지 않으면 병합 전에 원인(누락된 거래 유형, 과거 오입력)을 먼저 정리.
  3. 한 트랜잭션에서: 그룹의 행을 `ORDER BY id FOR UPDATE` 로 잠금 → 가장 오래된 행을 존속 행으로 선택 → `qtyOnHand/qtyAvailable/qtyHold` 를 합계로 UPDATE → 나머지 행 DELETE → 감사로그(AuditLog)에 병합 전/후 행 JSON 기록 → 합계 재검증 후 COMMIT.
  4. 재점검 SQL 이 `중복 그룹 0` 이 되면 migration 재배포.
- 이 절차는 **실행 SQL 을 제공하지 않는다**(자동화 방지). 필요하면 대상이 확인된 뒤 별도 승인 하에 개별 작성한다.

## 6. 배포 순서 검토

제안하신 10단계는 **적절하다.** 보완 사항만 덧붙인다.

| # | 단계 | 보완 |
|---|---|---|
| 0 | (추가) Vercel 환경변수 분리 확인, 롤백 대상 기록 | §1 ⚠ 항목. 롤백 대상 = `daewon-10ae8qq0d-…`(`aee84bc`) |
| 1 | 운영 DB 백업 | §4-1 — Supabase 백업 확인 + `pg_dump` + `--list` 검증 |
| 2 | 운영 DB 사전 점검 | §3 SQL. **BLOCK 이 하나라도 있으면 중단** |
| 3 | 중복 재고·migration 충돌 확인 | 중복 0, 동명 인덱스 없음/정상 |
| 4 | 업무 영향·작업 시간 확인 | 입고/출고가 진행 중이 아닌 시간대. 점검 SQL #70~#72. 예상 소요 수 분 |
| 5 | 사용자 별도 승인 | migration 적용 승인 / 병합·배포 승인을 **분리**해서 받는다 |
| 6 | Prisma migration 적용 | `DIRECT_URL`(5432) → `npx prisma migrate status`(미적용 2개 확인) → `npx prisma migrate deploy` |
| 7 | 정상 적용 검증 | 점검 SQL 재실행: 6·7 `applied`, `ReceivingRequest` 존재, 인덱스 "정상", `migrate status` = up to date. **이 상태에서 병합을 미뤄도 서비스는 정상**(구 코드 호환) |
| 8 | PR #5 main 병합 | 🔒 Draft → Ready for review 전환 후 **merge commit** 으로 병합 = Production 자동 배포 시작. PR #1 은 병합하지 않음 |
| 9 | Vercel Production 배포 확인 | GitHub Deployment `Production` 의 sha = 병합 커밋, state `success`. 빌드 3~5분. 실패 시 Instant Rollback 불필요(이전 배포가 계속 서비스됨) |
| 10 | 운영 MES 기본 기능 검증 | §7 |
| 11 | (추가) 구버전 화면 안내 | 새 코드는 `requestId` 가 필수라 **배포 직후 열려 있던 화면(캐시된 구버전 JS)에서 입고하면 "요청 식별자 오류"** 가 난다 → 사용자에게 새로고침(Ctrl+F5) 공지 |

## 7. 배포 후 점검 절차

사용자가 직접 로그인해 수행(에이전트는 비밀번호를 입력하지 않는다). 조회만으로 검증할 수 없는 항목은 **실제 운영 데이터를 만들지 않고 별도 승인 항목**으로 분리했다.

### 7-1. 읽기 전용 (승인 없이 가능)
| 항목 | 방법 | 기대 |
|---|---|---|
| 배포 일치 | GitHub Deployments / Vercel 에서 Production sha | 병합 커밋 |
| 로그인 | 기존 계정으로 로그인 → `/app` | 정상, 콘솔 오류 없음 |
| 발주 조회 | 발주관리 목록/상세 | 정상 표시 |
| 재고 조회 | 재고현황·수불내역 | 정상, 수량 변화 없음 |
| 작업지시 조회 | 작업지시 목록 | 정상 |
| 자재입고 화면 | 입고 대상 목록·입고 창 **열기만** | 열림, 품목별 입력 정상(저장하지 않음) |
| 자재출고 화면 | 화면 열기, 재고 초과 경고 표시 위치(입력칸 아래) | 겹침 없음 |
| 점검 SQL 재실행 | §3 | BLOCK/WARN 없음, 6·7 applied |
| Vercel 런타임 로그 | Production 로그 오류 확인 | 신규 오류 없음 |
| NCWatch 수집 | 모니터링 화면/스냅샷 증가 | 영향 없음 |

### 7-2. 🔒 별도 테스트 승인 항목 (운영 데이터가 생기는 검증)
운영 tenant 는 `daewon-001` 하나뿐이라 분리된 테스트 테넌트가 없다. 아래는 **승인 + 정리 방법 합의 후에만** 수행한다.
| 항목 | 이유 | 제안(승인 시) |
|---|---|---|
| 발주 등록 / 번호 채번 | 쓰기 | "TEST-" 접두 비고의 소량 발주 1건, 확인 후 상태 취소. **번호(PO-YYYY-NNNNNN)는 소모됨** |
| 자재입고 + LOT 번호 | 재고·수불·LOT 생성 | 대원정밀은 자동 LOT 채번이 차단(DG-003)이므로 **수동 LOT 입력** 으로만 가능. 소량 입고 후 재고조정으로 원복하면 수불 이력이 남음 |
| 입고 중복 처리 방지 | 같은 입고를 두 번 시도 | 위 입고 1건에서 **저장 버튼 더블클릭** 1회로 재고가 한 번만 늘었는지 확인 |
| 자재출고 | 재고 차감·투입 이력 | 위 시험 입고분에 한해 소량 출고 |
| 작업지시 등록 | 쓰기, 제조번호 수동 입력 | "TEST-" 제조번호 1건 후 취소 |
- 위 쓰기 검증은 **되돌려도 수불·감사 이력이 남는다**는 점을 승인 시 감안해야 한다. 승인하지 않으면 해당 항목은 "미검증 — 로컬 PostgreSQL 에서만 검증됨"으로 남긴다.

## 8. 기존 실패 7건이 운영에 미치는 영향
이번 변경 전후 **실패 시그니처가 동일**한 기존 테스트 실패이며 신규 실패는 없다.
| 테스트 | 원인 분류 | 운영 영향 |
|---|---|---|
| role-permission-enforcement | 테스트 목록에 삭제된 `inventory.actions.createTransaction` 이 남음(재고 변경 액션 `adjustInventoryStock` 은 `INVENTORY UPDATE` + MANAGER 이상 가드 확인) | 없음. 단 이 테스트가 중간에 멈춰 이후 권한 단언이 CI 에서 실행되지 않음(임시 사본으로 나머지 전부 PASS 확인) |
| cause-analysis(3) · corrective-action(1) | 품질 이력 보존 정책으로 삭제가 거절되는데 테스트는 구 방식(연쇄 삭제) 기대 | 없음(오히려 데이터 보호) |
| report-output | 정규식 범위가 가드 추가로 어긋남 | 없음 |
| production-plan-workorder-integrity | 로직이 `production-plan-sync.ts` 로 이동, NMES 전용 테스트 파일 미복사 | 없음(나머지 35개 단언 PASS) |
| bom-material-sufficiency | 같은 NMES 전용 파일에 의존해 중간에 중단 | **BOM 자재 충족 로직이 이 테스트로 검증되지 않음 — 미검증**(운영 영향 판정 불가, 후속 재작성 필요) |
| f25-master-menu-cleanup-integrity | 메뉴 라벨이 `불량코드관리` 로 변경됨 | 없음 |
재고·권한·작업지시 관련 실패도 **기능 결함이 아니라 오래된 테스트**로 분류되었으나, bom-material-sufficiency 한 건만 검증 공백으로 남는다.

## 9. 남은 위험
1. 운영 DB 상태(중복 재고, 동명 인덱스, migration 이력)와 Vercel Preview/Production 환경변수 분리를 **직접 확인하지 못했다.**
2. Supabase 플랜의 백업 제공 범위 미확인 → `pg_dump` 가 사실상 유일한 보장 수단.
3. 반품·출하 경로의 실부하 동시성은 미검증(잠금 순서 분석만). `ADJ-`/`SRT-` 거래번호 채번은 트랜잭션 밖 max+1 방식 그대로.
4. 운영 쓰기 기능(발주 등록·입고·출고·작업지시)은 운영 환경에서 직접 검증하지 못하면 로컬 PostgreSQL 검증에 의존한다.
5. 배포 직후 구버전 화면에서 입고 시도 시 요청 식별자 오류(새로고침으로 해결).
6. `main` 브랜치 보호가 없고 저장소가 public 이다(저장소에 비밀값은 없음 — 이력 점검 기록 있음. 보호 규칙 설정은 별도 권장).
7. PR #1 이 열려 있어 병합 순서에 따라 충돌 가능.

## 10. 실제 배포 승인 전 필요한 사항 (🔒)
1. 운영 DB **읽기 전용 점검** 실행 승인(또는 담당자가 §3 SQL 실행 후 결과 공유)
2. Vercel 환경변수(Production/Preview 분리) 확인 결과 공유
3. **백업** 수행 및 확인(Supabase 백업 상태 + `pg_dump` 파일 검증) 결과
4. migration 적용 **작업 시간** 합의(업무 외 시간) 및 적용 승인(§6-6)
5. PR #5 **Ready for review 전환 + main 병합** 승인(§6-8) — 병합 즉시 Production 배포가 시작됨
6. 배포 후 §7-2 운영 쓰기 검증 수행 여부와 정리 방법 결정
