# DAEWON-MES Phase 10 — Security / Integrity / Scope Hardening

> 작성: 2026-10-14 · 작업 브랜치 `fix/daewon-phase10-security-hardening` · **미커밋/미푸시(사용자 승인 대기)**
> 범위: Phase 9 권고 GAP DG-013 / 014 / 015 / 016 / 017 / 021 / 031 / 033 / 042
> 원칙: Prisma schema 변경 0 · migration 0 · Production write 0 · 신규 업무기능 없음 · MRP 엔진 미변경

---

## A. Baseline

| 항목 | 값 |
|---|---|
| Baseline commit | `116e74898bfe69f552bcb3fbb27ed066ffe3b84e` — docs: add Daewon Phase 9 final gap audit |
| 작업 브랜치 | `fix/daewon-phase10-security-hardening` (main 에서 분기, main 직접 개발 없음) |
| origin/main 대비 | main 이 1 commit ahead(Phase 9 문서, 미푸시) — 본 브랜치는 그 위에서 시작 |
| 미추적 | `docs/DAEWON-MRP-GAP-ANALYSIS.md` — 건드리지 않음(stage/수정/삭제 없음) |
| 변경 규모 | 수정 51 파일(+625/−130) + 신규 7 파일(가드 3, 순수 모듈 1, 테스트 1, 문서 2) |
| Schema / Migration | **변경 0 / 0** (`prisma/` 미수정) |
| Production | **write 0**. 이번 Phase 에서 Production 접근 없음(빌드 시 DB URL 을 더미로 덮어 연결 자체를 차단) |

### 수정 전 취약점 재현 (Baseline `116e748` 소스를 별도 디렉터리로 export 해 동일 harness 로 실행)

| 호출 | 수정 전 결과 | 수정 후 |
|---|---|---|
| 비인증 `getLots()` | **성공 — 3건(타 tenant LOT 포함)** | UNAUTHORIZED |
| 비인증 `getSalesOrders("tenant-B")` | **성공 — 1건** | UNAUTHORIZED |
| 비인증 `getInventoryBalances()` | **성공(인증 없이 조회 수행)** | UNAUTHORIZED |
| 비인증 `getWorkOrders()/getWorkOrderById("wo-B1")` | **조회 수행**(직렬화 단계 fixture 한계로 오류, 인증 오류 아님) | UNAUTHORIZED / 타 tenant ID → null |
| tenant-A MANAGER `getLots()` | **타 tenant LOT 포함** | 세션 tenant LOT 만 |
| tenant-A MANAGER `getSalesOrders("tenant-B")` | **성공 — 타 tenant 수주 1건** | FORBIDDEN |
| 자재출고: BOM 외 품목 + QUARANTINE LOT + COMPLETED 작업지시 | 검증 없이 진행(재고 부족 때문에만 실패) | 상태/BOM/LOT 상태 검증으로 즉시 거부 |

---

## B. Target GAP (수정 전 정리표)

| DG | Phase 9 설명 | 원인(코드 위치) | Severity | Blocker | 수정 파일 | schema | DB write | 테스트 | 결과 |
|---|---|---|---|---|---|---|---|---|---|
| DG-013 | 비인증 읽기 액션 104개, tenantId 폴백/클라이언트 신뢰, tenant 필터 없음 | 액션에 가드 없음, `getTenantId()` 폴백, `middleware.ts` 가 쿠키 존재만 확인 | P1 | Y | `lib/actions/*` 28개, `lib/auth/action-guards.ts`(신규), `lib/auth/edge-jwt.ts`(신규), `middleware.ts` | 불필요 | 불필요 | SEC-01~06, 정적 가드 스캔 | **PASS** |
| DG-014 | 자재출고 서버 검증 누락 | `material-issue.actions.ts` 가 작업지시 tenant 만 확인 | P1 | Y | `material-issue.actions.ts` | 불필요 | 불필요 | SEC-12, DG-014 | **PASS** |
| DG-015 | 재작업 종결이 개발자 전용 | `process-progress.actions.ts` 의 `assertDaewonFeatureScope`, 화면 범위 밖 | P1 | Y | `process-progress.actions.ts`, `wip-hold.actions.ts`, `daewon-scope.ts`, `nav-config.ts`, `pop.actions.ts` | 불필요 | 불필요 | DG-015 | **PASS(결정 필요 1건 — O절)** |
| DG-016 | 원인분석·조치·재발방지·품질현황 숨김+개발자 전용 | 범위 allow-list/액션 가드 | P1 | Y | `defect-*.actions.ts` 3, `quality-dashboard.actions.ts`, `daewon-scope.ts`, `nav-config.ts`, `api/upload/attachment/route.ts` | 불필요 | 불필요 | 정적 스캔 | **PASS** |
| DG-017 | 운영 개발/공통 계정 | `loginId==='test'` 하드코딩, 운영 DB 에 test/dev-pop | P1 | Y | `developer.ts`, `daewon-scope.ts`, Runbook | 불필요 | **운영 데이터 조치는 미수행** | DG-017 | **DEFERRED(코드 위험 해소·운영 조치는 Runbook)** |
| DG-021 | 발주 상태 자유 변경, FK 소유 미검증 | `purchase-order.actions.ts` | P2 | N | `purchase-order.actions.ts`, `purchase-order-status.ts`(신규) | 불필요 | 불필요 | SEC-11/12, DG-021 | **PASS** |
| DG-031 | 검사표준 없으면 POP 실적 전체 롤백 | `self-inspection.helpers.ts` throw | P2 | N | `self-inspection.helpers.ts`, `pop.actions.ts` | 불필요 | 불필요 | DG-031 | **PASS** |
| DG-033 | 에이전트 키 cuid/평문, 수집 입력 상한 없음 | schema 기본값, `ncwatch/auth.ts` | P2 | N | `ncwatch/agent-key.ts`(신규), `ncwatch/auth.ts`, `equipment-integration.actions.ts`, 수집 route 2 | 불필요(컬럼 재사용) | 불필요 | DG-033 | **PASS** |
| DG-042 | LOT 상태 임의 문자열·감사 없음, createLot tenantId 신뢰 | `lot.actions.ts` | P3 | N | `lot.actions.ts` | 불필요 | 불필요 | SEC-04/07/11 | **PASS** |

---

## C. Authentication Audit

방법: `'use server'` 82 파일 / export 520개를 정적 스캔(`scripts/test-phase10-security.ts` 의 가드 스캔과 동일 규칙)하고, 함수별 call chain(내부 호출·페이지·API 라우트 사용처)을 확인해 아래로 분류했다.

| 분류 | 의미 | 조치 |
|---|---|---|
| A. WRITE | 생성/수정/삭제/상태전이 | 기존에 리소스 권한 가드 존재 — tenant/관계 ID 소유 검증만 보강 |
| B. READ | 조회·참조 목록·번호 미리보기 | **100개에 가드 추가**(리소스 READ 또는 세션 사용자) |
| C. PUBLIC 의도 | 비로그인 현황판 | `getEquipmentMonitorLive`, `getProductionKPIs` **2개만** allow-list(주석·테스트에 명시) |
| D. 내부 helper | 액션 파일이 export 한 서버 내부 함수 | `assertAttachmentEntityOwnership` 등 3개에 세션/tenant 가드, `getItemCurrentStock` 내부용 비공개 로더 분리(N+1 방지) |
| E. 미사용 | 호출처 없음 | `getLotForwardTrace/BackwardTrace` — 삭제 대신 가드+tenant 필터(범위 최소화) |

| 지표 | 수정 전 | 수정 후 |
|---|---|---|
| 가드 없는 server action export | **100**(Phase 9 정적 104) | **2**(현황판 공개 의도, allow-list) |
| 클라이언트 tenantId 를 세션 확인 없이 사용 | 73 → 상세 21개 함수(쓰기 포함) | **0**(`assertSessionTenant` 또는 세션 tenant 사용) |
| tenant 필터 없는 findMany/findUnique(`getLots`, `getWorkOrders`, `getWorkOrderById`, `getEquipments`, `getSites` 등) | 8개 함수 | **0** |
| Edge middleware | 쿠키 존재만 확인, payload 서명 미검증 | **HS256 서명·만료 검증**(Web Crypto), 임의 쿠키로 `/app`·서버 액션 POST 통과 불가 |

가드 설계(기존 표준 재사용, 신규 인증 체계 없음):
- `requireResourcePermission(resource, "READ")`(기존) — 단일 리소스
- `requireReadActor([...])`(신규, 스냅샷 1회 조회 후 any-of) — 여러 화면이 공유하는 조회
- `requireActor()`(신규, `getCurrentUser` 래퍼) — tenant 범위 참조 목록
- `assertSessionTenant(actor, tenantId)`(신규) — 클라이언트가 보낸 tenantId 가 세션과 다르면 FORBIDDEN, 이후 쿼리는 세션 tenant 사용

---

## D. Tenant Isolation Audit

| 대상 | 수정 전 | 수정 |
|---|---|---|
| WorkOrder 목록/단건 | tenant 필터 없음, id 만으로 조회(IDOR) | `where tenantId = 세션` |
| LOT 목록/추적(트리)/검색 | tenant 필터 없음, LOT id 만으로 정·역 트리 조회 | 세션 tenant + 트리 순회 중 `parentLot/childLot.tenantId` |
| LOT 생성/상태변경 | `createLot` 이 클라이언트 tenantId·itemId 신뢰, 상태 임의 문자열 | 세션 tenant, 품목 소유 검증, enum 검증, 감사로그 |
| 수주/출하/발주/입고 조회 | 클라이언트 tenantId 로 조회 | `assertSessionTenant` |
| ECN | `isAdmin`/`profileId` 를 클라이언트가 지정(권한 상승) | 세션 사용자·역할로 서버가 결정 |
| 재작업 종결 | WipUnit 을 id 만으로 조회·수정(타 tenant 변경 가능) | `tenantId` 조건 추가 |
| 발주 생성/수정 | siteId/supplierId/itemId 소유 미검증 | 세션 tenant 소유 + 공급처 유형 검증 |
| 검사표준/불량코드 생성 | 클라이언트 tenantId, 타 tenant 품목/공정 ID 수용 | 세션 검증 + 관계 소유 검증 |
| 첨부 소유 검증 함수 3종 | 비인증 + 클라이언트 tenantId 로 존재 여부 판별(oracle) | 세션 + tenant 일치 |
| 번호규칙/제조이력/ECN 개발자 액션 | 클라이언트 tenantId | `assertSessionTenant` 추가 |

## E. Site Isolation Audit

단일 사업장(FAC-01) 운영이다. 사업장 정책의 현황: POP 세션은 작업지시 `siteId` 와 일치해야 한다(기존, `assertPopSessionSiteMatch`). 이번에 추가:
- 자재출고: 요청 `siteId` 가 작업지시 사업장과 다르면 거부.
- 발주 생성: `siteId` 가 세션 tenant 소유 사업장인지 검증.
- 전 쿼리에 임의로 `siteId` 를 붙이지 않음(기존 정상 흐름 보존).
판정: **PASS(해당 범위)**. 다사업장 도입 시 읽기 액션의 사업장 필터는 별도 정책이 필요 → P절.

## F. Direct Action Bypass

- 서버 액션 진입에서 UI 와 무관하게 인증/리소스 권한/tenant 를 검증(위 C~D).
- 개발자 전용/범위 밖 기능(KPI 등)은 `assertDaewonFeatureScope` 로 직접 호출도 FORBIDDEN(SEC-06 에서 MANAGER 의 KPI 호출 거부 확인).
- Edge: 위조·만료·alg=none·다른 비밀키·payload 변조 토큰 모두 거부(8개 테스트).
- 주의: Next 서버 액션 ID 도달성(클라이언트 번들에 없는 액션 호출 가능 여부)은 이번에 런타임 검증하지 않았다. 모든 액션이 자체 가드를 가지므로 도달 가능성과 무관하게 거부되도록 만든 것이 본 Phase 의 방식이다.

## G. Rework Integrity (DG-015)

현 코드 재확인 결과 두 가지 문제가 있었다.
1. `getReworkPendingList` / `completeRework` 가 `assertDaewonFeatureScope`(개발자 전용) — 일반 Role 이 종결 불가. 또한 `completeRework` 는 WipUnit 을 **tenant 조건 없이** 조회·수정.
2. `completeRework` 는 최종 공정 재작업 WIP 만 종결 가능("중간공정은 후속 routing 반영 전까지 종결 불가")인데, POP 은 중간 공정에서도 재작업 수량을 받는다 → 한 번 입력하면 완제품입고가 **영구 차단**(데드엔드).

조치:
- 종결/조회를 기존 권한 체계로 전환: `WORK_RESULT UPDATE`(MANAGER 이상, OPERATOR 는 거부) + tenant 조건. 개발자 bypass 를 일반 기능으로 복사하지 않음.
- `재작업/보류관리` 화면(`/app/mes/rework`)을 허용 경로·메뉴(생산관리)에 포함. 같은 화면의 보류(hold) 액션도 개발자 전용 가드를 걷어내고 기존 `WORK_RESULT` 권한으로 동작(화면이 한 단위이므로).
- 데드엔드 방지: POP 에서 **최종 공정이 아닌 공정의 재작업 수량 입력을 입력 단계에서 차단**하고 "불량으로 등록" 안내.

흐름 검증(fake DB 위 실제 액션 실행): 자기 tenant 재작업 child 종결 성공(복귀 2 + 폐기 1 → 부모 qty 7→9, MERGE/SCRAP 이동 이력), 중복 종결 거부, 타 tenant 거부, OPERATOR 거부.

> **결정 필요**: 중간 공정 재작업(가공 공정 후 재투입)은 후속 routing 반영 로직이 없어 이번엔 입력 차단으로 데드엔드만 막았다. 가공 공정에서 재작업이 실제 발생한다면 별도 Phase 의 라우팅 설계가 필요하다.

## H. InspectionSpec / POP Integrity (DG-031)

원인 재현: `recordSelfInspectionDefects` 가 검사표준이 없으면 `throw` → 같은 트랜잭션(양품/불량 실적·WIP 분리·공구 이력)이 전부 롤백. 
정책 결정 근거: 출하/입고 품질 게이트(`evaluateQualityRelease`)는 검사표준이 없으면 `NOT_REQUIRED` 로 통과 = **검사표준은 선택 정책**이며, 불량 수량·WIP SCRAP 분리는 `ProductionResult`/`WipMovement` 가 정본으로 기록한다 → 정책 B 채택(검사 연동만 선택적).

- 검사표준 없음: 실적 정상 저장, 자주검사(QualityInspection/DefectRecord)만 생략하고 불량코드 내역을 DEFECT 이동 이력 note 에 보존(스키마 변경 없이 정보 손실 방지), 응답에 `warning` 반환.
- 검사표준 있음: 기존과 동일하게 자주검사 기록(정책 약화 없음).
- 불량코드 미등록/타 tenant 코드: 여전히 오류(입력 검증 유지). 부분 저장 없음(같은 트랜잭션).

## I. Production Account Risk (DG-017)

코드 점검: seed 는 `DAEWON_SEED_CONFIRM=YES`+`SEED_ADMIN_*` 없이는 실행 불가, 개발자 계정은 `SEED_DEVELOPER_PASSWORD` 가 있을 때만 생성, 하드코딩 비밀번호/PIN 없음(정적 테스트), `dev-pop` 을 만드는 코드는 저장소에 없음, 운영에서 데모 테넌트 폴백 없음(+POP 로그인도 운영에서 클라이언트 tenantId 미사용으로 보강).
조치: `DAEWON_DISABLE_DEVELOPER_ACCESS=1` 스위치(코드 2곳 단일 기준) — DB 변경 없이 Go-Live 시 `test` 의 개발자 권한 상승을 끌 수 있다.
**Production 계정은 삭제/수정하지 않았다.** 실제 정리 절차: `docs/DAEWON-GO-LIVE-ACCOUNT-RUNBOOK.md`.
판정: 코드 위험 PASS, 운영 데이터 조치 **DEFERRED**(Go-Live 직전 담당자 수행).

## J. Input Validation

| 항목 | 반영 |
|---|---|
| 수량 ≤0 / NaN / Infinity | 발주 수량·단가(음수/NaN 거부), 자재출고(기존 finite 검증 + 필요수량 상한) |
| 빈 ID / 잘못된 enum | LOT 번호 trim·필수, LOT 상태 enum, 재작업 대상 ID 필수 |
| tenant/관계 ID 불일치 | 발주(사업장·공급처·품목), 검사표준(품목·공정), ECN(대상 품목), LOT(품목) |
| 중복 | 같은 품목 중복 발주 라인 거부, 재작업 중복 종결 거부(기존) |
| 필요수량 초과 | 자재출고 누적 > BOM 필요수량이면 MANAGER 이상만 허용 |

## K. State Transition

| 대상 | 규칙 |
|---|---|
| 발주 | 사용자가 지정 가능한 상태: DRAFT/ORDERED/CANCELLED. PARTIAL_RECEIVED/RECEIVED 는 입고 처리, CLOSED 는 잔량 종결 액션으로만. ORDERED→DRAFT/CANCELLED 는 입고·외주·반품 이력 없을 때만. 순수 모듈 `purchase-order-status.ts` |
| 자재출고 | 작업지시 RELEASED/IN_PROGRESS 만 |
| LOT | ACTIVE 가 아닌 LOT(QUARANTINE/ON_HOLD/CONSUMED/EXPIRED)는 출고 후보·출고에서 제외 |
| 재작업 | REWORK 상태만 종결, 이미 종결된 WIP 재종결 거부 |
| 출하/작업지시 | 기존 로직 양호(Phase 9) — 변경 없음 |

## L. Transaction / Concurrency

- 기존 양호 판정 코드(입고·출고·실적·출하 트랜잭션/락)는 재작성하지 않았다.
- 추가된 검증은 모두 **쓰기 이전**(출고: 작업지시/BOM/LOT 상태 검사는 재고 차감·수불 기록 이전) 또는 같은 트랜잭션 안에서 수행되어 부분 저장이 없다(SEC-12: 거부 시 수불/LOT 연결 write 0).
- LOT 상태 변경은 업데이트+감사로그를 한 트랜잭션으로 묶음.
- 성능: 권한 스냅샷은 호출당 1회. 발주 생성의 품목별 현재고 조회는 내부 로더로 분리해 품목마다 권한 쿼리를 반복하지 않는다.
- 서버측 멱등키(중복 제출)는 Phase 9 DG-029 로 별도 이월(이번 범위 아님).

## M. Tests

신규 `npm run test:phase10-security` — **122 assertions PASS**. 실제 server action 모듈을 로드하고 DB 만 메모리 fake 로 대체(실제 인증 코드가 fake DB 위에서 그대로 동작).

| ID | 내용 | 결과 |
|---|---|---|
| SEC-01 | 비인증 읽기 거부(9개 액션 + 위조 쿠키 + 다른 비밀키) | PASS |
| SEC-02 | 비인증 쓰기 거부 + DB write 0 | PASS |
| SEC-03 | 타 tenant 읽기 거부(목록 격리/ID IDOR/인자 불일치) | PASS |
| SEC-04 | 타 tenant 쓰기 거부(LOT 상태·생성·재작업 종결) | PASS |
| SEC-05 | 사업장 불일치 출고 거부 | PASS |
| SEC-06 | OPERATOR/VIEWER/범위 밖(KPI) 직접 호출 거부 | PASS |
| SEC-07 | MANAGER 정상 흐름(LOT 생성/상태/감사) | PASS |
| SEC-08 | OPERATOR 정상(LOT READ, 출고 조회)·제한 | PASS |
| SEC-09/10 | POP 세션 쿠키만으로 관리자 조회/쓰기 거부 | PASS |
| SEC-11 | 타 tenant 관계 ID 거부(공급처·사업장·품목·검사표준) | PASS |
| SEC-12 | COMPLETED 작업지시 출고·BOM 외 품목·격리 LOT·발주 상태 임의 변경 거부 | PASS |
| DG-013 | Edge JWT 8케이스 + 정적 가드 스캔(미보호 export 0) | PASS |
| DG-015 | 범위·권한·종결 실행(복귀/폐기/중복/타 tenant/OPERATOR) | PASS |
| DG-017 | 개발자 스위치·seed·하드코딩 | PASS |
| DG-021 | 상태 전이표 7케이스 | PASS |
| DG-031 | 검사표준 없음/있음/불량코드 오류 | PASS |
| DG-033 | 키 발급·해시·해시 제시 우회·legacy 호환·상한 | PASS |

정적 가드 스캔은 CI 에서 같은 스크립트로 회귀를 막는다(새 액션이 가드 없이 추가되면 실패 — 실제로 작업 중 한 건의 누락을 이 스캔이 잡았다).

## N. Regression

| 항목 | Baseline | After |
|---|---|---|
| `npm run test:*` (51 → 52 스크립트) | 41 PASS / 10 FAIL | **42 PASS / 10 FAIL** (신규 1 PASS) |
| 실패 10건 | role-permission-enforcement, cause-analysis, corrective-action, report-output, production-plan-workorder-integrity, bom-material-sufficiency, inventory-concurrency-integrity, pop-tool-usage-integrity, f22-browser-smoke, f25-master-menu-cleanup-integrity | **동일 10건·동일 사유**(NMES 유래 stale 단언 / 삭제된 파일 / DB·브라우저 필요) — 이번 변경으로 새로 깨진 테스트 0 |
| MRP Phase 1~8 테스트(test:mrp-*, order-mrp, master-migration, phase8) | PASS | **PASS** |
| `tsc --noEmit` | PASS | **PASS** |
| `next lint` | error 0 | **error 0** (기존 warning 1) |
| `npm run build` | — | 아래 O절 결과 참조 |

> baseline 실패 10건은 이번 범위가 아니므로 수정하지 않았다(`role-permission-enforcement` 는 삭제된 `createTransaction` 을 단언하는 stale 테스트). 정적 가드 보증은 신규 테스트가 대체한다.

## O. Remaining Risks

| # | 위험 | 비고 |
|---|---|---|
| 1 | **중간 공정 재작업**: 입력 차단으로 데드엔드만 방지. 실제 재작업 후 재투입 라우팅은 미구현 | 현장 정책 결정 필요 |
| 2 | **운영 계정 정리 미수행**(test/dev-pop/공통 admin) | Runbook, Go-Live 직전 |
| 3 | Edge JWT 검증은 `JWT_SECRET` 이 Edge 런타임에 노출되어야 함(Vercel 환경변수는 노출됨) — 비운영 환경에서 로그인→이동 1회 확인 권장. 미설정이면 전원 로그인 화면(fail-closed) | 배포 전 smoke |
| 4 | 개발자 전용 액션(게이트웨이/태그/채번규칙)은 개발자 계정이 `assertSessionTenant` 만으로 격리 | `DAEWON_DISABLE_DEVELOPER_ACCESS` 로 운영 시 차단 |
| 5 | 읽기 권한 세분화: 일부 조회는 any-of 리소스 READ(예: 사업자 목록은 발주·고객 관리 중 하나). 커스텀 역할 사용 시 화면별 READ 매핑 점검 필요 | 역할 설계 시 확인 |
| 6 | 서버 액션 ID 도달성의 런타임 black-box 미실시(자체 가드로 무관하게 방어) | 비운영 환경 확인 |
| 7 | 공개 현황판(`/kiosk`, `/api/mes/equipment-monitor/light`) 노출 범위 | DG-024(접근 키) 이월 |
| 8 | PIN 4자리·WAF/레이트리밋·백업/PITR | DG-018(운영 확인) |

## P. Deferred to later Phase

Phase 9 의 나머지: **P0** DG-001(품목 LOT 정책)·DG-002(기준정보 적재 — 데이터), **P1** DG-003~012·018, P2 중 DG-019/020/022~030/032/034~037, P3 일부. 대표적으로 LOT 정책 일괄 적용(스크립트·baseline hash 재산정), 라벨/스캔·추적 확장, 수주 확장 필드, KPI/계측기, 설비 에이전트, CI/백업/멱등키 — Phase 9 문서의 L절 순서 유지.
Phase 10 에서 Phase 9 의 "개발자 판정을 DB 플래그로" 는 schema 변경이 필요해 보류.

---

## 변경 파일 요약

| 구분 | 파일 |
|---|---|
| 신규 | `src/lib/auth/action-guards.ts`, `src/lib/auth/edge-jwt.ts`, `src/lib/ncwatch/agent-key.ts`, `src/lib/purchase-order-status.ts`, `scripts/test-phase10-security.ts`, `docs/DAEWON-GO-LIVE-ACCOUNT-RUNBOOK.md`, 본 문서 |
| 인증/범위 | `src/middleware.ts`, `src/lib/auth/daewon-scope.ts`, `src/lib/developer.ts`, `src/lib/nav-config.ts`, `src/lib/ncwatch/auth.ts` |
| 액션(가드/tenant/무결성) | `src/lib/actions/` 의 attachment, bom, business-partner, daily-production, defect-*(3), ecn, equipment*, finished-goods, inspection-stages, inventory, item*, location, lot, lot-lineage, manufacturing-traceability, material-issue, numbering-rule, outsourcing, permission, pop, process-progress, production-result, purchase-order, quality(+dashboard), receiving, routing, sales-order, self-inspection.helpers, shipment, site, wip-hold, work-center, work-order |
| API | `src/app/api/lms/ncwatch/{status,report-daily}/route.ts`, `src/app/api/upload/attachment/route.ts` |
| 기타 | `package.json`(test 스크립트 1줄) |
