# DAEWON-MES — Vercel 배포 준비 문서

> 상태: **배포 전 준비 단계** (GitHub 원격 저장소와 Vercel 프로젝트는 아직 만들지 않음).
> 이 문서에는 실제 비밀값을 적지 않는다. 점검은 `npm run preflight:*` 로 한다(값은 출력되지 않음).

대상 Supabase 프로젝트: `aquqetajewvhyirmewfy` (ap-northeast-2) · Tenant `daewon-001`

---

## 1. 빌드/배포 구조

| 항목 | 값 |
|---|---|
| Framework | Next.js 14.2 (App Router) |
| Install | 기본(`npm install`) — `postinstall` 없음 |
| Build | `npm run build` = `prisma generate && next build` (기본 Build Command 그대로) |
| Start | `next start` (Vercel 이 자동 처리) |
| Output | `.next` 기본값 |
| Node | `package.json` `engines.node = "22.x"` (Vercel 이 이 값으로 선택) |
| Region | `vercel.json` `regions: ["icn1"]` (Supabase ap-northeast-2 와 동일 권역) |
| Root Directory | 저장소 루트(`./`) |

**빌드가 하는 일:** `prisma generate`(클라이언트 생성)와 `next build` 뿐이다.
**빌드가 하지 않는 일:** `migrate deploy`, `db push`, seed, DB 초기화 — 어떤 lifecycle 스크립트(`postinstall`/`prebuild`/`vercel-build` 등)에도 없다.
검증: DB 에 접속할 수 없는 값으로 `npm run build` 를 실행해도 통과한다(빌드가 DB 를 쓰지 않음).

> DB migration 은 **항상 수동**이다: 로컬/관리 PC 에서 `DIRECT_URL`(5432) 로 `npx prisma migrate deploy`.
> 순서: ① migration 적용(기존 코드와 호환되는 변경만) → ② 코드 배포. `db push`/`db pull`/`migrate resolve` 금지.

---

## 2. 환경변수 분류

코드(`src`, `prisma`)에서 실제로 읽는 변수 전체를 검색한 결과다.

### A. Production 필수 (Vercel → Production)
| 변수 | 종류 | 비고 |
|---|---|---|
| `DATABASE_URL` | secret | Supabase **Transaction pooler 6543**. 런타임이 `pgbouncer=true`/커넥션 제한을 코드에서 보정함 |
| `NEXT_PUBLIC_SUPABASE_URL` | 공개 | `https://aquqetajewvhyirmewfy.supabase.co`. 서버 코드에서만 사용(Storage) |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret(서버 전용)** | Storage 업로드/서명 URL 전용. `NEXT_PUBLIC_` 금지 |
| `NEXT_PUBLIC_BRAND` | 공개 | `daewon`. **빌드 시점에 번들에 고정** → 변경 시 재빌드 필요. 누락 시에도 범위 정책은 fail-closed |
| `DEFAULT_TENANT_ID` | 설정값 | `daewon-001`. 누락 시 운영에서 로그인 500 (의도된 fail-closed) |
| `JWT_SECRET` | secret | 세션 JWT 서명. 누락 시 로그인 불가 |
| `POP_PIN_SECRET` | secret | POP PIN 지문(HMAC) |
| `POP_WORKER_SESSION_SECRET` | secret | POP 작업자 세션 서명 |

세 시크릿은 서로 다른 64바이트 이상 난수여야 한다. 값을 바꾸면 기존 세션이 무효화되고 **POP PIN 지문이 달라져 모든 POP PIN 로그인이 불가**해진다(재설정 필요) → `POP_PIN_SECRET` 은 운영 시작 후 바꾸지 말 것.

### B. Preview
**권장: Preview 에는 DB/Storage 변수를 넣지 않는다.** 현재 DB 는 운영 1개뿐이라 Preview 가 같은 값을 가지면 Preview 배포가 운영 데이터를 읽고/쓴다.
- Preview 가 필요하면: 별도 Supabase 프로젝트를 만들어 그 값을 넣거나, Vercel Deployment Protection(Vercel Authentication)을 Preview 에 켜고 읽기 전용으로만 사용.
- 어떤 경우든 `NEXT_PUBLIC_BRAND=daewon` 은 필요(없어도 fail-closed 동작이지만 로고/제목이 기본값).

### C. 개발 전용 (로컬 `.env.local` 만)
`DIRECT_URL`(5432, migrate 용), `PRISMA_*`(튜닝), `AI_ENABLED`/`OPENAI_*`(AI 기능 UI 미연결), `NCWATCH_SNAPSHOT_INTERVAL_MS`(연계 방식 미확정).

### D. seed 전용 — **Vercel 에 넣지 않는다**
`SEED_ADMIN_LOGIN_ID`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL`, `DAEWON_SEED_CONFIRM`
→ `prisma/seed-daewon.ts` 만 읽는다. 앱 런타임은 읽지 않으므로 운영 환경에 있을 이유가 없다(있으면 노출면만 늘어남).

### E. 사용 안 함
`NEXT_PUBLIC_SUPABASE_ANON_KEY`(Supabase Auth/PostgREST 미사용), `SUPABASE_MANAGEMENT_ACCESS_TOKEN`(백업관리 화면 숨김), `OPENAI_API_KEY`/`OPENAI_MODEL*`(AI 비활성).
`NODE_ENV` 는 Vercel 이 `production` 으로 자동 설정.

### DIRECT_URL 을 Production 에 두지 않아도 되는가
**두지 않아도 된다.** `schema.prisma` 의 `directUrl` 은 Prisma CLI(migrate) 전용이고 `PrismaClient` 런타임은 `DATABASE_URL` 만 사용한다.
검증: `DIRECT_URL` 을 빈 값으로 두고 `next start` 후 로그인, `/app`, 사용자·사업장·작업표준서 화면, `/kiosk` 가 모두 정상 동작. (`npm run build` 도 `DIRECT_URL` 없이 통과) — 제거 여부는 사용자 결정.

---

## 3. 시크릿 노출 점검

- `NEXT_PUBLIC_*` 는 `BRAND`, `SUPABASE_URL` 2개뿐이며 비밀이 아니다.
- `'use client'` 파일 중 비밀 변수를 읽거나 서버 전용 모듈(`@/lib/jwt`, `@/lib/auth`, `@/lib/storage/*`, `@/lib/db/prisma`)을 import 하는 파일은 없다.
- 인증 헬퍼(`src/lib/auth.ts`)는 `'use server'` 가 아니다(비로그인 호출 가능한 액션으로 노출되지 않음).

재검증 방법(빌드 후):
```bash
npm run build
npm run preflight:bundle      # .next/static 및 프리렌더 HTML 에서 비밀 '값'과 비밀 변수 '이름' 검색
npm run preflight:env         # 필수 변수/형식/NEXT_PUBLIC_ 비밀 여부
npm run preflight:supabase    # 읽기 전용: DB 2종 연결, migration 상태, RLS, Storage 버킷 private
```
`preflight:bundle` 은 `.env.local`/`process.env` 의 값을 읽어 산출물에서만 찾고, 결과에는 값을 출력하지 않는다. Vercel 빌드 로그에서 `NEXT_PUBLIC_BRAND` 외 변수가 번들에 들어가지 않는지 확인하는 CI 단계로도 쓸 수 있다.

---

## 4. 노출된 자격증명 교체 절차 (배포 전 필수)

이전 작업 중 **DB 비밀번호와 service role key 가 대화 기록에 노출**되었다. 배포 전에 교체한다. (이 문서/코드는 자동으로 교체하지 않는다.)

### 4-1. DB 비밀번호
1. Supabase → Project Settings → Database → **Reset database password** (영문·숫자만 권장, 특수문자 인코딩 문제 방지).
2. 새 연결 문자열(Transaction pooler 6543 / Session pooler 5432)을 복사.
3. **갱신 위치**
   - 로컬 `.env.local`: `DATABASE_URL`, `DIRECT_URL`
   - Vercel **Production**: `DATABASE_URL` (+ `DIRECT_URL` 을 두는 경우)
   - Vercel **Preview**: DB 변수를 넣었다면 동일하게(권장: 넣지 않음)
   - 필요 시 Development 환경
4. 확인: `npm run preflight:supabase` → 두 연결 모두 PASS.

### 4-2. service role key
1. Supabase → Project Settings → API (JWT/API Keys) → service_role key 재발급. **JWT secret 을 재생성하면 anon/service_role 이 모두 바뀐다**(신규 프로젝트라 영향 작음).
   - 새 형식의 secret key(`sb_secret_…`)로 바꾸는 경우, Storage REST 가 해당 키를 `Authorization: Bearer` 로 받아들이는지 업로드/서명 URL 테스트 후 사용.
2. **갱신 위치**: 로컬 `.env.local`, Vercel Production `SUPABASE_SERVICE_ROLE_KEY` (Preview 에 넣었다면 동일).
3. 확인: `npm run preflight:supabase` 의 "service role key 로 Storage 접근 성공", 이후 작업표준서 업로드→열람.

### 4-3. 앱 시크릿(JWT/POP)
대화에 노출되지 않았다(생성 후 출력 안 함). 교체 불필요. 새 환경(Vercel)에서는 **로컬과 다른 새 난수**를 쓰는 것을 권장(로컬과 운영 세션 분리). 단 운영 시작 후 `POP_PIN_SECRET` 은 변경 금지(§2-A).

교체 후에는 Vercel **재배포**가 필요하다(환경변수는 새 배포부터 적용).

---

## 5. 관리자 계정 정책과 인터넷 노출 시 보호

**정책(소유자 결정, 변경 안 함):** 공급기업 유지보수 OWNER `admin` / (정책으로 정해진 공통 비밀번호 — 문서에는 기재하지 않음), `mustChangePw=false`.
인터넷에 열리는 순간 이 조합은 가장 먼저 시도되는 값이므로, 아래 보호 현황과 필요 조치를 구분해 둔다.

### 5-1. 현재 애플리케이션 수준 보호
| 경로 | 현재 보호 | 한계 |
|---|---|---|
| `POST /api/auth/login` | 계정별 비밀번호 5회 연속 실패 시 **자동 잠금 → 15분 후 다시 시도 가능**(수동 잠금은 시간이 지나도 해제되지 않음). **동일 IP 10분 내 실패 20회 이상이면 일시 거부**. 잠금/제한 여부는 응답에 드러내지 않고 일반 실패 메시지만 반환. 로그인 이력(IP/UA) 기록. | 분산(다수 IP) 공격은 IP 제한으로 막지 못함 → WAF 필요. 자동 잠금 cooldown 중에는 정상 사용자도 15분간 로그인 불가(공격이 계속되면 반복 가능). |
| POP PIN 로그인(서버 액션, `/login`·`/pop/*`) | 같은 IP 에서 10분 내 실패 30회 초과 시 거부(LoginHistory 기반). 응답은 실패 사유 비노출. | 4자리 PIN(1만 조합). 공장 공용 IP 를 고려해 한도를 넉넉히 잡아 전수 대입을 완전히 막지는 못함. |
| `/signup-request`(가입 신청) | PIN/아이디 중복을 응답으로 알려주지 않도록 정리(PIN 은 관리자 승인 단계에서 확인). | **요청 수 제한 없음** → PENDING 스팸 가능. |
| 서버 액션/업로드 API | 로그인 + 리소스 권한, 업로드는 인증·권한·파일 검증. | — |

### 5-2. Vercel 수준(WAF/Rate limit)에서 추가가 필요한 것 — **아직 설정하지 않음**
| 대상 | 권장 규칙 |
|---|---|
| `POST /api/auth/login` | IP 당 분당 10~20회 제한, 초과 시 challenge/deny |
| `POST /login`, `POST /pop/*` (PIN 로그인은 서버 액션이 이 경로로 POST 됨) | IP 당 분당 제한 |
| `POST /signup-request` | IP 당 시간당 소수 제한 (+ 필요 시 CAPTCHA/Bot protection) |
| 전체 | Bot Protection 활성화, 필요하면 사업장 IP 대역 allow 규칙 |

### 5-3. 코드 수준 보완 (적용 완료 / 보류)
1. ✅ **잠금 자동 해제**: 자동 잠금 서명(`isLocked` + `lockedAt` + `failCount≥5`)인 계정만 15분 후 해제. `src/lib/login-lock.ts`.
2. ✅ **로그인 IP 제한**: LoginHistory 기반(스키마 변경 없음), 동일 IP 10분 20회. POP PIN 로그인(10분 30회)과 별도 집계.
3. 보류: 복구용 두 번째 OWNER 계정은 만들지 않기로 결정(개발자 계정 `test` 가 있어 사용자관리에서 OWNER 계정 초기화 가능).
4. 보류: 업체별 admin 비밀번호 분리 — 공통 값이면 한 곳에서 노출 시 전 업체가 위험.
5. 수동 잠금 기능을 만들 때는 `lockedAt` 을 null 로 두거나 `failCount` 를 임계치 미만으로 유지할 것(그래야 자동 해제 대상이 되지 않음).

---

## 6. Kiosk 공개 범위 (유지)

`/kiosk` 와 `GET /api/mes/equipment-monitor/light` 는 비로그인 공개(현장 현황판). 노출 데이터:

- 설비: 내부 id, 코드, 이름, 유형, 상태, 소속 공정명, 최근 가동 이벤트(유형/시각), 당일 부품 수, **등록된 표시 태그**(이름/단위/최신값/시각)
- KPI: 진행 중 작업지시 건수, 당일 양품·불량 수량, 불량률, 설비 가동률

포함되지 않음: 거래처/고객명, 작업자 이름·PIN, 품목/LOT/작업지시 번호, 단가, 사용자 정보.
→ 설비 상태와 단순 생산 현황 수준이라 **유지**. 주의: 태그를 등록할 때 표시 태그(`isVisible`)에 공정 파라미터/프로그램 번호처럼 민감한 값이 들어가지 않게 관리할 것. 일일 생산·불량 수량이 외부에 보여도 되는지는 고객 확인 사항.

---

## 7. GitHub 저장소 준비

- 독립 저장소(NMES 와 분리). 현재 로컬: branch `main`, remote 없음, working tree clean.
- 이력 점검(전 커밋): 서비스 키/JWT·POP 시크릿/DB 비밀번호 **0건**, 비밀 패턴 0건, `.env*` 추적 없음(`.env.example` 만).
- `prisma/seed.ts`(NMES demo seed, 데모 계정 값에 admin 공통 비밀번호와 같은 문자열 포함)는 현재 트리에서 제거했다. **이력에서의 제거는 첫 push 전에 `git filter-repo` 로 수행한다**(이 PC 에는 미설치 — 설치 전까지 push 금지).
- 첫 push 는 `origin` 추가 후 `git push -u origin main` (force push 금지).

## 8. Vercel 프로젝트 계획

- 새 독립 프로젝트(예: `daewon-mes`). 기존 NMES / CNS Medical 프로젝트와 연결·덮어쓰기 금지.
- Git 연동: 새 GitHub 저장소만. Production Branch = `main`.
- 설정: Framework Next.js, Root `./`, Build `npm run build`(기본), Install 기본, Node 22.x, Region `icn1`(vercel.json).
- 환경변수: §2-A 를 Production 에만 입력. Preview 는 §2-B 정책. seed 변수는 입력하지 않음.
- **플랜:** Hobby 는 비상업 용도 — 고객사 운영 서비스는 Pro 이상 필요.
- 자동 배포: `main` push 가 곧 Production 배포가 되므로 첫 배포는 수동 승인 후, migration 은 별도 수동 단계(§1).
- 도메인/WAF/Deployment Protection 은 첫 배포 후 §5-2 대로 설정.

## 9. DB 연결 전략

| 용도 | 변수 | 대상 | 사용처 |
|---|---|---|---|
| Vercel runtime | `DATABASE_URL` | Transaction pooler **6543** | 앱(서버리스). `pgbouncer=true`, `connection_limit` 기본 2(`PRISMA_CONNECTION_LIMIT` 로 조정) |
| migration/관리 | `DIRECT_URL` | Session pooler **5432** | `prisma migrate deploy/status`, `migrate diff` (로컬/관리 PC) |

Vercel Production 에 `DIRECT_URL` 불필요(§2). 서버리스 인스턴스가 늘 때 풀러 한도를 넘지 않도록 `PRISMA_CONNECTION_LIMIT` 은 기본 2 유지 후 모니터링.

---

## 10. 사용자 결정이 필요한 항목

1. GitHub 저장소 URL(독립 private 저장소) — 생성/제공 필요
2. ~~prisma/seed.ts 처리~~ → 결정됨: 현재 트리에서 제거 완료, 이력 제거는 filter-repo 설치 후 첫 push 전에 수행(`prisma/seed-demo-data.ts` 는 별도 — 미사용 NMES demo 데이터, 필요 시 같은 방식으로 제거)
3. ~~§5-3 코드 보완~~ → 적용 완료(잠금 자동 해제, IP 제한). 복구용 OWNER 는 만들지 않기로 결정
4. Preview 환경 정책(§2-B)
5. Vercel 플랜, 도메인
6. 자격증명 교체 완료 시점(§4)

---

## 11. 최초 배포 후 Smoke Test (실데이터 생성 없음)

| # | 항목 | 기대 결과 |
|---|---|---|
| 1 | `GET /login` | 200, "DAEWON PRECISION / 대원정밀 MES" |
| 2 | `admin` 로그인 | 성공, 비밀번호 변경 화면 없이 진행(mustChangePw=false) |
| 3 | `/app` | 200, 홈 카드 5개 |
| 4 | Tenant | 사용자관리/사업장 화면에 대원정밀 데이터만 |
| 5 | 메뉴 권한 | 허용 메뉴 표시, 숨김 메뉴(프로젝트/견적/SPC/KPI/리포트 등) 미표시 |
| 6 | 사용자관리 | `admin`(OWNER) 1명 표시 |
| 7 | 사업장 | 본공장 |
| 8 | 창고/로케이션 | 원자재·재공품·완제품 창고, 기본 로케이션 |
| 9 | 공정 | 가공·검사·세척·포장·완제품입고 |
| 10 | 작업표준서 | 화면 진입 200, 테스트 PDF 업로드→목록 표시(테스트 후 삭제) |
| 11 | signed URL | "PDF 보기" 로 열림, 만료 후 거부, 공개 URL 직접 접근 불가 |
| 12 | `/pop/work-select` | 200 (PIN 입력 화면) |
| 13 | `/kiosk` | 200, 설비 0건/KPI 0 |
| 14 | 차단 route | `/app/mes/spc`, `/app/mes/project-orders`, `/app/mes/dashboard` → 404 |
| 15 | 개발자 route | `/app/mes/gateways`, `/app/mes/features`, `/app/mes/common-codes` → admin 으로 404 |
| 16 | logout | 세션 쿠키 삭제, `/app` 접근 시 `/login` |
| 17 | 세션 만료 | JWT 8시간 만료/유휴 로그아웃 후 `/login?reason=session-expired` |

배포 직전/직후 자동 점검: `npm run preflight:env`, `npm run preflight:bundle`, `npm run preflight:supabase`.
