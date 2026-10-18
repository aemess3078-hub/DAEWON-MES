# DAEWON-MES Go-Live 운영 계정 정리 Runbook

> 작성: Phase 10 (DG-017). **이 문서는 절차서다. Phase 10 에서는 Production 계정을 삭제/수정하지 않았다.**
> 실제 실행은 Go-Live 직전에 담당자(OWNER)가 수행하고, 실행 전후 결과를 이 문서의 체크리스트에 기록한다.

## 1. 배경 (Phase 9 확인 사실)

Production(READ ONLY 조회, 2026-10-14) 사용자:

| loginId | role | mustChangePw | POP PIN | 비고 |
|---|---|---|---|---|
| `admin` | OWNER | false | 없음 | 공급사 공통 유지보수 OWNER(정책상 mustChangePw=false) |
| `test` | OWNER | false | 없음 | **개발자 계정** — loginId==='test' 이면 숨김/개발자 전용 기능 전체 사용 |
| `dev-pop` | OPERATOR | false | 있음 | 개발 중 만든 POP 테스트 계정 — 운영 작업자 아님 |

운영 작업자(POP)·MANAGER 계정은 0명이다.

## 2. 코드 측 위험 점검 결과 (Phase 10)

| 점검 | 결과 |
|---|---|
| 코드/seed 가 계정을 자동 생성하는가 | `prisma/seed-daewon.ts` 는 `DAEWON_SEED_CONFIRM=YES` + `SEED_ADMIN_*` 가 있어야 동작하고, 개발자 계정은 `SEED_DEVELOPER_PASSWORD` 가 있을 때만 생성. `dev-pop` 을 만드는 코드/스크립트는 저장소에 없음(수동 생성으로 추정) |
| 운영에서 테스트 계정이 다시 생길 가능성 | seed 를 환경변수와 함께 다시 실행하는 경우뿐. 운영 DB 에 대해 seed 를 실행하지 않는다(아래 4절 가드 참고) |
| 하드코딩된 비밀번호/PIN | 없음(seed·소스 정적 점검 — `npm run test:phase10-security`) |
| 기본 계정/개발용 우회 | `loginId==='test'` 개발자 판정 1곳(`src/lib/developer.ts`, `src/lib/auth/daewon-scope.ts`). **Phase 10 에서 환경변수 스위치 추가**: `DAEWON_DISABLE_DEVELOPER_ACCESS=1` 이면 test 계정도 개발자 권한이 적용되지 않음 |
| 운영에서 데모 테넌트 폴백 | `getTenantId`/로그인 API 는 운영(`NODE_ENV=production`)에서 `DEFAULT_TENANT_ID` 미설정 시 오류. POP `popLogin` 은 운영에서 클라이언트가 보낸 tenantId 를 사용하지 않음(Phase 10) |

## 3. Go-Live 전 실행 절차 (BEFORE GO-LIVE)

사전 조건: 아래 4개 환경변수/조치가 Vercel **Production** 에 반영 가능해야 한다. (환경변수 변경 후 재배포 필요 — 재배포는 사용자가 판단)

1. **운영 계정 먼저 만든다 (잠금 방지)**
   - [ ] 실제 OWNER 확인: 대원정밀 담당자 이름의 OWNER 계정 1개 이상 생성(사용자관리) — 업체 공통 `admin` 과 별개
   - [ ] 실제 MANAGER 계정 생성(생산/품질/자재 담당) — 재작업 종결·재고조정·출하 확정 등 `WORK_RESULT UPDATE`/MANAGER 필요 기능 수행
   - [ ] 실제 OPERATOR/POP 작업자 계정 생성 및 **POP PIN 개별 발급**(4자리, 작업자별 중복 불가)
   - [ ] 임시 비밀번호는 별도 경로로 전달, 첫 로그인에서 변경 확인(`mustChangePw=true`)
2. **공통/개발 계정 정리**
   - [ ] `admin`: 업체별 고유 비밀번호로 변경(또는 대원정밀 OWNER 로 대체 후 비활성). `mustChangePw=false` 정책 재검토
   - [ ] `dev-pop`: 사용자관리에서 비활성/삭제, POP PIN 제거
   - [ ] `test`: ① Vercel Production 에 `DAEWON_DISABLE_DEVELOPER_ACCESS=1` 설정(개발자 권한 상승 즉시 해제) ② 유지보수가 필요 없으면 계정 비활성. 필요 시에만 임시로 켜고 작업 후 다시 끈다
3. **환경변수 확인(Vercel Production)**
   - [ ] `DEFAULT_TENANT_ID` = 대원정밀 전용 tenant (데모 값 아님)
   - [ ] `JWT_SECRET`, `POP_PIN_SECRET`, `POP_WORKER_SESSION_SECRET` 은 로컬과 다른 값. **운영 시작 후 `POP_PIN_SECRET` 변경 금지**(PIN 지문 무효화)
   - [ ] `SEED_*` 변수는 Vercel 에 두지 않는다
4. **seed 재실행 방지**
   - [ ] 운영 DB 에 대해 `npm run db:seed` 를 실행하지 않는다(실행 시 `SEED_ADMIN_*` 가 없으면 중단됨)
5. **검증**
   - [ ] 일반 사용자(비OWNER)로 로그인해 `/app/mes/gateways`, `/app/mes/features` 가 404 인지 확인
   - [ ] `test` 로 로그인했을 때 개발자 메뉴가 보이지 않는지 확인(스위치 ON 상태)
   - [ ] POP 작업자 PIN 로그인 → 작업대기 조회 정상, 다른 작업자 PIN 으로 로그인 불가 확인
   - [ ] 로그인 이력(LoginHistory)에 정리 작업 이후 비정상 시도가 없는지 확인

## 4. 권고 (후속)

- 개발자 판정을 `loginId==='test'` 대신 DB 플래그/별도 역할로 바꾸는 것은 스키마 변경이 필요해 Phase 10 범위에서 제외했다.
- 4자리 PIN(1만 조합)은 IP 단위 시도 제한(10분 30회)만 있다 → WAF/레이트리밋(운영, DG-018) 병행 권장, 6자리 확대는 별도 Phase.
- 운영 DB 계정 현황은 Go-Live 직전에 READ ONLY 로 다시 확인한다.
