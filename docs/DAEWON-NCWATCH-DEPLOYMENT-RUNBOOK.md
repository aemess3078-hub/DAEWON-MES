# NCWatch 전용 최소 배포 — 범위·의존성·배포·롤백 런북

브랜치: `feat/daewon-ncwatch-minimal` (기준: 운영 `main` = `116e748`) · 상태: **PR 검토 중 — 운영 배포 미승인**
관련: `docs/DAEWON-PHASE12-NCWATCH-INTEGRATION.md` (전체 Phase 12 보고), PR #1 (Phase 10~12 전체, **보존·병합 금지**)

---

## 1. 분리 결과 — main 대비 변경 범위

두 개의 커밋으로 구성한다. **롤백 시 첫 커밋(A)만 남기면 해시 인증이 유지된다**(§6).

| 커밋 | 내용 | 파일 |
|---|---|---|
| **A** `c01d1ea` | Gateway 키 SHA-256 저장·해시 검증 (Phase 10 중 NCWatch 인증 부분만, **파일 내용이 PR #1 과 동일**) | `src/lib/ncwatch/agent-key.ts`(신규), `src/lib/ncwatch/auth.ts`, `src/app/api/lms/ncwatch/status/route.ts`·`report-daily/route.ts`(본문·건수 상한), `src/lib/actions/equipment-integration.actions.ts`(Gateway 생성 키 해시화·목록에서 키 값 미반환만) |
| **B** `0989abd` | Phase 12 NCWatch 수정 + Agent v3 + 운영 도구 | `src/lib/ncwatch/transform.ts`, `src/lib/ncwatch/provision.ts`(신규), `equipment-integration.actions.ts`(공용 Gateway 생성·하트비트 만료 표시), `scripts/ncwatch-ops.ts`, `scripts/test-ncwatch-phase12.ts`, `package.json`(스크립트 2줄), `.gitignore`, `docs/…PHASE12…`, `tools/ncwatch-agent/**` |

- 변경된 **기존 런타임 코드는 NCWatch 경로와 Gateway 키 처리뿐**이다: `auth.ts`, NCWatch 수신 라우트 2개, `transform.ts`, `equipment-integration.actions.ts`.
- 제외한 것: Phase 10 의 나머지(전 서버 액션 인증 가드, Edge JWT, 테넌트 격리, 업로드, 미들웨어, 권한 등), Phase 11 LOT/QR 전체, Gateway 폼 문구 변경, `package-lock.json`.
- Prisma 스키마·마이그레이션 변경 **0**, 신규 의존성(웹앱) **0**.
- PR #1 과 파일 내용이 동일하므로 이후 PR #1 을 병합해도 충돌이 생기지 않는다.

## 2. 의존성 분석 (Phase 12 → Phase 10/11)

| 대상 | 의존 여부 | 근거 |
|---|---|---|
| Phase 11 (LOT/QR) | **없음** | NCWatch 파일은 LOT/QR 모듈을 import 하지 않는다. 제외 후 `tsc`·빌드 통과 |
| Phase 10 해시 인증 (`agent-key.ts`, `auth.ts`) | **필요 — 분리 가능** | 두 파일은 `crypto`·`prisma` 만 사용하는 독립 모듈. 이것만 가져와 동작 검증됨. 운영 DB 키가 해시이므로 **이 부분이 없으면 인증 불가** |
| Phase 10 나머지 (액션 가드·JWT·격리) | **없음** | `equipment-integration.actions.ts` 의 `assertDeveloperOnly`/`requireResourcePermission`/`requireDeveloper` 는 **이미 main 에 존재**. Phase 12 코드는 Phase 10 의 추가 모듈(`action-guards`, `daewon-scope`, `edge-jwt`)을 사용하지 않는다 |

결론: **분리 가능.** 필요한 의존성은 Phase 10 중 `agent-key.ts` + `auth.ts`(+ 이를 쓰는 수신 라우트의 상한, Gateway 키 발급 해시화) 뿐이다.

## 3. 운영 DB 호환성 (읽기 전용 점검, 쓰기 0)

`npm run ncwatch:ops -- verify-key --key-file <키파일>` (키·해시 값 출력 없음)

| 점검 | 결과 |
|---|---|
| 새 키 → `NCWatch Agent` Gateway 식별 (해시 조회) | ✅ 동일 Gateway, tenant `daewon-001`, site 일치 |
| 저장 키 형식 | ✅ `sha256:` 해시 (평문 아님) |
| 해시값 자체를 키로 제시 / 임의 키 / 데모 키 | ✅ 모두 식별 안 됨 |
| **현재 운영 배포본(평문 조회)** | ⛔ 새 키 식별 안 됨 → 401 (그래서 이 배포가 선행되어야 함) |
| 설비 4대 · 매핑 4 · 연결 4 · NCWATCH 태그 60 | ✅ 변환 경로와 같은 조건으로 조회 시 설비당 활성 태그 15개, 설비 테넌트 일치 |
| 수신 경로 테이블 접근 | ✅ NcwatchStatus/History/SyncLog/ReportDaily/EquipmentEvent/TagCurrentValue/TagSnapshot 조회 정상 |

기존 데이터(설비·매핑·연결·태그·Gateway·키)는 **변경·재생성하지 않았고**, 키는 재발급하지 않는다. 새 코드는 기존 데이터를 그대로 사용한다.

## 4. 테스트 결과 (이 브랜치)

### 4.1 결과 요약

| 항목 | 결과 |
|---|---|
| `tsc --noEmit` | ✅ |
| `npm run build` | ✅ (exit 0) |
| NCWatch 서버 회귀 `test:ncwatch-phase12` (인증·해시·401·테넌트 격리·매핑·상태 이력·이벤트·태그·KST) | ✅ 82 단언 |
| Agent v3 단위·시나리오 `npm test` | ✅ 28건 |
| 기존 `test:*` 51개 스크립트 (이 브랜치) | ✅ 41 통과 / ⚠️ 10 실패 |
| 실패 10개를 `main` 에서 동일하게 실행 | **10개 모두 main 에서도 동일하게 실패** (출력 비교: 경로 문자열 차이 외 동일) → 이 변경과 무관한 **기존 실패**. 신규 실패 0 |
| 비밀 유출 검사 (환경 비밀·DB 비밀번호·신/구 Gateway 키 10종 → 커밋·메시지·작업트리) | ✅ 0건 |

기존 실패 10개(main 과 동일): `role-permission-enforcement`, `cause-analysis`, `corrective-action`, `report-output`, `production-plan-workorder-integrity`(누락 파일 `scripts/test-production-plan-sales-link.ts`), `bom-material-sufficiency`(같은 원인), `inventory-concurrency-integrity`, `pop-tool-usage-integrity`, `f22-browser-smoke`, `f25-master-menu-cleanup-integrity`.

### 4.2 요청 영역별 검증 현황

| 영역 | 근거 | 판정 |
|---|---|---|
| NCWatch API 인증 / 설비 상태 저장 / 이력 / 이벤트·태그 저장 | `test:ncwatch-phase12` + 운영 DB 읽기 전용 호환 점검 | ✅ (로컬 Fake DB, 운영 서버는 배포 후) |
| 설비관리 | `equipment-downtime-maintenance-integrity`, `equipment-result-attribution` | ✅ (모듈 테스트) |
| POP 생산실적 | `pop-worktime-operator`, `operation-status-integrity`, `next-work-navigation` | ✅ 일부 / `pop-tool-usage-integrity` 는 **기존 실패(main 동일)** |
| 생산계획·작업지시 | `operation-status-integrity` ✅ / `production-plan-workorder-integrity` | ⚠️ 후자는 **기존 실패(main 동일, 누락 파일)** — 통과로 보고하지 않음 |
| 자재·재고 | `f27-inventory-adjustment-integrity`, `lot-lineage-integrity`, `purchase-order-close`, `item-*` ✅ / `inventory-concurrency-integrity`, `bom-material-sufficiency` | ⚠️ 후자 2건은 **기존 실패(main 동일)** |
| 로그인·세션·사용자 권한 | `role-permission-enforcement` 가 **기존 실패(main 동일)**, 이 변경은 로그인·세션·권한 코드를 건드리지 않음(파일 목록 §1 참조) | ⛔ **자동 테스트로 확인 불가 — 미검증** |

### 4.3 실제 Next 서버 스모크 (`next start`, 운영 DB 미접속: 연결 불가한 가짜 DB 주소 사용)
- `GET /login` → 200, 세션 없이 `/app/mes/equipment-monitor` → 307 → `/login`
- `GET` 수신 API 3종 → 405
- `POST heartbeat` 키 없음 / `POST status` 잘못된 키 / 해시 문자열을 키로 제시 → 모두 401, 본문 `{"error":"Unauthorized"}`
- 한계: DB 가 없으므로 "올바른 키 → 200" 과 로그인 성공은 이 방식으로 확인할 수 없다 (해당 경로는 위 Fake DB 테스트와 읽기 전용 점검으로 확인).

### 4.4 Preview 환경
Vercel Preview 는 Deployment Protection(SSO) 뒤에 있어 인증 없이 접근할 수 없다. Preview 의 **빌드 성공 여부는 GitHub 체크로 확인**하지만, **Preview 에서의 로그인·세션·화면 접근 검증은 ⛔ 미검증**이다 (우회 토큰 또는 사용자의 직접 로그인 필요).

### 4.5 검증 불가 / 미검증 (통과로 처리하지 않음)
- ⛔ **Preview 환경의 실제 로그인·세션 유지·화면 접근**: Vercel Preview 가 Deployment Protection(SSO) 뒤에 있어 인증 없이는 접근할 수 없다. (우회 토큰 또는 사용자의 직접 로그인 필요) 로컬에서 운영 DB 에 붙여 로그인하면 로그인 이력이 기록되어 **운영 DB 변경 금지** 조건에 어긋나므로 수행하지 않았다.
- ⛔ 운영 서버에 대한 실제 하트비트/상태 수신 (배포 후 최초 Agent 연결 시 확인)
- ⛔ 현장 PC 의 작업 스케줄러 등록·부팅 자동 실행, 실제 NCWatch PostgreSQL 대상 시험

## 5. 운영 배포 절차 (최종 승인 후)

사전: 현재 Production 배포(`1683f17` 기반)의 Vercel 배포 ID 를 메모해 둔다(즉시 롤백 지점).

1. PR 승인 → `main` 병합 (A, B 두 커밋 유지: squash 금지, **merge commit 또는 rebase** 사용)
2. Vercel `daewon-mes` 프로젝트의 Production 배포 완료 확인 (빌드 성공)
3. 배포 확인 (비밀 불필요)
   - `GET https://daewon-mes.vercel.app/api/lms/ncwatch/status` → **405**
   - `POST …/api/lms/ncwatch/heartbeat` (키 없음 또는 임의 키) → **401** `{"error":"Unauthorized"}`
4. 기존 기능 스모크: 로그인, 대시보드, 설비 모니터링/설비 연결 설정/게이트웨이 화면이 열리는지 확인 (게이트웨이 화면에서 키 값이 표시되지 않음)
5. 현장 Agent v3 설치 (§7) → 첫 하트비트가 성공하면 Gateway `NCWatch Agent` 가 온라인
6. 24시간 모니터링: `NcwatchSyncLog` 오류, Gateway 마지막 통신, 설비 4대 수신 시각

## 6. 장애 시 롤백

원칙: **DB 의 Gateway 키를 평문으로 되돌리지 않는다.** 서버 롤백은 해시 인증을 지원하는 코드(커밋 A 이상)를 기준으로 한다.

| 상황 | 조치 | Gateway 해시 인증 | 영향 |
|---|---|---|---|
| NCWatch 변환(B) 문제: 이벤트/태그 오류 등 | `git revert 0989abd` PR → 재배포 (또는 커밋 `c01d1ea` 로 빌드한 배포를 Vercel 에서 Promote) | **유지** (커밋 A 포함) | 수신·인증 계속 동작, 변환만 이전 동작으로 복귀 |
| 서버 전체 문제(A 포함) | 원인 수정 후 재배포(fix-forward). 급하면 **현장 Agent 를 먼저 `stop-agent.ps1` 로 중지** 후 이전 배포로 롤백 | 이전(평문 조회) 배포로 돌아가면 해시 키 인증 불가 → Agent 가 401 이므로 **반드시 중지** | MES 로의 전송만 중단. NCWatch/NCWatch DB·설비 영향 없음. 중단 중에는 MES 의 설비 이벤트 이력이 비는 구간이 생김(NCWatch 자체 이력은 현장 DB 에 보존, Agent 는 현재 상태만 전송) |
| 설비/매핑 데이터 자체 문제 | 로컬 보안 폴더의 `pre-state-*.json`, `*.created.json` 의 ID 로 승인 후 개별 정리 | — | 운영 DB 변경이므로 별도 승인 필요 |

- 이 배포는 **스키마·데이터를 변경하지 않으므로** 서버 롤백 시 DB 복구 작업이 없다. Agent 시작 후 쌓인 NcwatchStatus/History/Event/Tag/SyncLog 행은 추가 데이터일 뿐이며 정리하지 않아도 무해하다.
- 롤백 후 Agent 재개: `start-agent.ps1`. 인증키 재발급은 필요 없다.

## 7. 현장 Agent v3 적용 절차 (서버 배포 확인 후)

상세: `tools/ncwatch-agent/README.md`

1. 서버 배포 확인(§5-3) 후 진행 — 배포 전에는 Agent 를 실행하지 않는다
2. 현장 PC: 기존 `C:\NCWatch\ncwatch-agent` 백업 → `ncwatch-agent-v3.0.0.zip` 복사 (NCWatch.exe/설정 불변)
3. `.env` 확인: DB 접속값, `NCWATCH_MACHINES=CNC-1,CNC-8,CNC-9,MCT-6`, `MES_API_URL=https://daewon-mes.vercel.app`
4. 키 전달: 암호화 USB 등 안전한 경로로 키 파일 이동(이메일/메신저/Git 금지) → 관리자 PowerShell `.\set-agent-key.ps1 -KeyFile <경로> -DeleteKeyFile`
5. `node check-connection.js` (DB 조회 + 하트비트 인증)
6. `.\install-agent.ps1 -WhatIf` → `.\install-agent.ps1`
7. `.\check-agent.ps1`, MES 에서 Gateway 온라인·4대 수신 시각 확인
8. 재부팅 / 인터넷 단절 / 프로세스 종료 시험
