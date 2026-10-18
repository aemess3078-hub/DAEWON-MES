# Phase 12 — NCWatch 설비 데이터 연동 구축 및 운영 안정화

작성: 2026-10-18 · 브랜치: `feat/daewon-phase11-lot-qr-traceability` 위에서 작업(미커밋) · 대상: 대원정밀 MES 전용

> **상태 요약**
> - 코드/Agent/스크립트 구현 및 로컬 검증: **완료**
> - 운영 DB: 2026-10-18 승인 후 **설비 4대·매핑·연결·태그 60개 생성, Gateway 키 교체 완료** (§5, 비밀은 로컬 보안 폴더에만 보관) · 운영 배포: **미수행** · Agent 실행/현장 PC 설치: **미수행**
> - 운영 적용은 아래 §8 의 승인 단계를 거쳐 진행해야 한다.
> - 표시 규칙: ✅ 검증됨 / ⚠️ 부분 검증 / ⛔ **미검증**

---

## ① 현재 구현되어 있던 기능 (재개발하지 않고 재사용)

| 구성 | 위치 | 내용 |
|---|---|---|
| 인증 | `src/lib/ncwatch/auth.ts`, `agent-key.ts` | `X-Agent-Key` → `EdgeGateway.apiKey`(sha256 해시, 구형 평문은 읽기 호환 후 해시 전환) → tenant/site/gateway 확정. payload 의 tenant 는 신뢰하지 않음 |
| 수신 API | `src/app/api/lms/ncwatch/{status,heartbeat,report-daily}/route.ts` | POST 전용. 본문 256KB·50건 상한 |
| 변환 | `src/lib/ncwatch/transform.ts` | NcwatchStatus upsert → 상태 변경 시 History → Mapping 조회 → EquipmentEvent(3=RUN, 5=ALARM, 그 외 STOP) → TagCurrentValue/TagSnapshot |
| 매핑/연결 | `equipment-integration.actions.ts` | NcwatchEquipmentMapping + `NCWATCH_AGENT` EquipmentConnection + 기본 태그 15종 자동 생성 |
| 화면 | `/app/mes/gateways`, `/app/mes/equipment-connections` | Gateway 관리, NCWatch Agent 매핑 |
| 생산실적 정책 | — | PARTCOUNT 는 태그 참고값으로만 저장, ProductionResult 자동 생성 없음 → **유지** (테스트로 고정) |

## ② 발견한 문제점

### 운영 DB 현황 (읽기 전용 조회, `scripts/ncwatch-ops.ts inspect`)

| 항목 | 결과 |
|---|---|
| 테넌트 | `daewon-001` / 대원정밀 ✅ |
| 사업장 | 1건: `site-daewon-factory-001` / FAC-01 / 본공장 |
| **MES 설비** | **0건 — CNC-1, CNC-8, CNC-9, MCT-6 모두 미등록** → 매핑 불가. 임의 설비 연결 금지 원칙에 따라 중단 |
| 작업장 | 5건 (`WC-MACH` 가공, `WC-INSP` 검사, `WC-WASH` 세척, `WC-PACK` 포장, `WC-STORE` 완제품입고) |
| Gateway | `NCWatch Agent` 1건 (연결 0건, 하트비트 없음, OFFLINE). **키가 구형 평문(cuid) 저장** |
| NCWatch 매핑 / 연결 / 수신 데이터 | 모두 0건 (Agent 가 대원정밀 서버로 한 번도 전송하지 않음) |
| DB enum `ConnectionProtocol` | `NCWATCH_AGENT` 포함 ✅ (스키마 변경 불필요) |

### 코드/Agent 문제

| # | 구분 | 문제 | 조치 |
|---|---|---|---|
| 1 | 서버 | 자동 생성되는 가상 `NCWatch Agent` Gateway 가 **cuid 기본키(평문, 추측 가능한 형식)** 로 생성됨 | 공용 `ensureNcwatchGateway` 로 통합, 난수 해시 키로 생성 |
| 2 | 서버 | Gateway 관리 화면 생성과 매핑 자동 생성이 **서로 다른 로직** → 이름이 다르면 Gateway 중복 생성 | 이름 상수 `NCWATCH_GATEWAY_NAME` 와 생성 로직 공유 (`src/lib/ncwatch/provision.ts`) |
| 3 | 서버 | `parseNcwatchTs` 가 소수초(`11:39:21.123`)·`/` 구분 시각을 못 읽고 서버 시간대(UTC)로 해석 → **9시간 어긋남** | 정규식 확장 (KST 해석) |
| 4 | 서버 | statusCode 가 비어 있으면 STOP 으로 간주해 이벤트 생성 | 상태를 알 수 없는 수신은 이벤트 미생성 |
| 5 | 서버 | 매핑이 상태 수신보다 늦게 생기면(CNC-1 후속 연결 등) 상태 변화가 없는 한 EquipmentEvent 가 영원히 생성되지 않음 | 열린 이벤트가 없으면 현재 상태 이벤트 1회 생성, 같은 타입 이벤트 중복 방지 |
| 6 | 서버 | 10초마다 설비 수+1 행의 SyncLog(하루 약 4.3만 행), 15태그×4설비 upsert+조회(하루 약 100만 쿼리) | 값·시각 동일 시 TagCurrentValue/스냅샷 쓰기 생략, SyncLog 정상 반복은 5분 간격 |
| 7 | 서버 | Gateway 가 하트비트 중단 후에도 DB 상 ONLINE 으로 남음 | 목록 표시 시 마지막 통신 3분 초과면 오프라인으로 표시(저장값 불변) |
| 8 | Agent v2 | fetch **제한시간 없음** (서버 무응답 시 무한 대기), `setInterval` 로 요청이 **겹쳐 실행 가능** | AbortController 15초, 완료 후 다음 실행 예약, 실행 중 재진입 차단 |
| 9 | Agent v2 | 시작 시 DB 연결 실패면 `process.exit(1)` (부팅 직후 DB 지연 시 영구 종료) | 종료하지 않고 재시도 |
| 10 | Agent v2 | `db.js` 에 **기본 DB 비밀번호 하드코딩**, 설비명을 SQL 에 그대로 결합 | 기본값 제거(미설정 시 시작 거부), 설비명 화이트리스트 검증 |
| 11 | Agent v2 | STATUS 컬럼이 비면 `0`(READY)으로 간주, 로그 파일·마스킹 없음, 중복 실행 방지 없음, REPORT 날짜(UTC) | UNKNOWN(null) 처리, 파일 로그+비밀값 마스킹, 127.0.0.1 포트 잠금, KST 날짜 |
| 12 | 운영 | 현장 PC 의 `MES_AGENT_KEY` 는 New MES 데모 키, MES_API_URL 은 `newmes.vercel.app` 기본값 | 데모 키 거부 로직 + 운영 키 입력 절차(`set-agent-key.ps1`) |

> 참고: OFFLINE(STATUS=4)은 `STOP` 이벤트(message=OFFLINE)로 저장되며 `ALARM` 이 아니다. 알람/고장 통계는 ALARM·WARNING 만 집계하고,
> 가동률은 RUN 이벤트만 사용하므로 **CNC-1 미연결이 장애 통계나 알림으로 번지지 않는다.** 별도 푸시 알림 시스템은 코드에 없다. (✅ 코드 확인)

## ③ 수정/추가한 파일

| 구분 | 파일 |
|---|---|
| 서버 수정 | `src/lib/ncwatch/transform.ts`, `src/lib/actions/equipment-integration.actions.ts` |
| 서버 신규 | `src/lib/ncwatch/provision.ts` (Gateway 이름·기본 태그·`ensureNcwatchGateway`·하트비트 만료 판정) |
| 운영 도구 | `scripts/ncwatch-ops.ts` (`inspect` / `provision`) |
| 테스트 | `scripts/test-ncwatch-phase12.ts`, `tools/ncwatch-agent/test/*.test.js` |
| 설정 | `package.json`(스크립트 2개), `.gitignore` |
| Agent 패키지 | `tools/ncwatch-agent/**` (index/src/*.js, `*.ps1` 8종, `.env.example`, README) |
| 배포 패키지 | `tools/ncwatch-agent/make-package.ps1` → `tools/ncwatch-agent/dist/ncwatch-agent-v3.0.0.zip` (git 제외, SHA256 `EB6B921E49DE2201487E46DA06C1CE6EA2BF70BE7B66521AA280D1FA7B6C1B82`) |
| UI | `gateway-form-sheet.tsx` (이름 입력 안내 문구 1줄) |
| 문서 | 이 문서 |

Prisma 스키마 변경 **없음** (마이그레이션 불필요).

## ④ Gateway 생성 및 인증키 처리 결과

- 기존 `NCWatch Agent` Gateway(`cmvdae0n000028gdljgn85g8x`, `site-daewon-factory-001`)가 **이미 있으므로 재사용**한다. 새로 만들지 않는다.
  - 매핑 자동 생성 로직과 `ncwatch-ops provision` 은 모두 `(tenant, site, name="NCWatch Agent")` 로 동일 Gateway 를 찾는다.
  - Gateway 관리 화면에서 NCWatch 용 Gateway 를 새로 만들 때도 이름을 `NCWatch Agent` 로 해야 같은 Gateway 로 취급된다.
- 이 Gateway 의 키는 구형 평문 저장이며 값을 아는 사람이 없다 → **운영 키 신규 발급(교체)이 필요**하다.
  - 영향: 연결 0건·하트비트 이력 없음 → 교체해도 기존 서비스 영향 없음 ✅ (조회 결과 기준)
  - 발급: `provision --rotate-key --issue-key <파일>` → 256bit 난수 `dwk_…`, DB 에는 `sha256:` 해시만 저장, **평문은 지정한 파일에만 기록(콘솔·로그·보고서 출력 없음)**
- 하드코딩/로그 노출 점검: 소스·스크립트·Agent 에 키 문자열 없음, 로그 마스킹 테스트 통과 ✅
- Vercel 환경변수 추가: **불필요** (서버는 DB 의 Gateway 키로 인증) ✅
- **Heartbeat 인증 테스트 및 Gateway ONLINE 갱신**
  - 로컬 Fake DB 에 대한 실제 라우트 실행: ✅ (잘못된 키 401, 올바른 키 200, 해당 Gateway 만 ONLINE)
  - **운영 서버에 대한 실제 호출: ⛔ 미검증** (운영 키 발급 전)

## ⑤ CNC 4대 매핑 결과

| NCWatch | MES 설비 | 상태 |
|---|---|---|
| CNC-1 | CNC-1 (`cmvdbo1300002399zdeho0tg6`) | ✅ 등록·매핑·연결·태그 15종 |
| CNC-8 | CNC-8 (`cmvdbo1vc0012399zqdj72dab`) | ✅ 동일 |
| CNC-9 | CNC-9 (`cmvdbo2mj0022399zrbe0j1sx`) | ✅ 동일 |
| MCT-6 | MCT-6 (`cmvdbo3c90032399zdbkog6cf`) | ✅ 동일 |

**운영 DB 적용 결과 (2026-10-18, 승인 후 실행)**: 테넌트 `daewon-001`/대원정밀, 사업장 `site-daewon-factory-001`(FAC-01 본공장), 작업장 `wc-daewon-machining-001`(WC-MACH 가공). 설비는 `MACHINE/ACTIVE`, 코드=이름=NCWatch 기계명(기존 설비 0건·코드 정책 충돌 없음). 단일 트랜잭션으로 설비 4 + 매핑 4 + `NCWATCH_AGENT` 연결 4 + 태그 60(4×15) 생성, 기존 `NCWatch Agent` Gateway(`cmvdae0n000028gdljgn85g8x`) 재사용(추가 생성 0, Gateway 수 1 유지), 키는 256bit 난수로 교체해 해시 저장 후 새 키로 동일 Gateway 식별 확인. 복구용 사전 상태/생성 ID 는 로컬 보안 폴더에 기록. 하트비트 이력 없음(Agent 미실행).

- (적용 전 상태) 운영 DB 에 설비가 0건이라 매핑을 만들 수 없었고 임의 연결은 하지 않았다.
- 적용한 절차: `provision --create-equipment --work-center WC-MACH` — 설비 4대를 `MACHINE/ACTIVE`, 코드=이름=NCWatch 기계명, 작업장 `WC-MACH(가공)` 으로 **신규 등록**하고, 매핑·`NCWATCH_AGENT` 연결·기본 태그 15종을 생성한다. 기종/제조사 등 상세 정보는 설비관리 화면에서 보완한다. 설비를 MES 화면에서 직접 등록한 뒤 `provision` 만 실행해도 된다(권장 대안).
- CNC-1 은 통신 미연결이어도 **설비·매핑·Agent 수집 대상에 모두 포함**한다. 데이터가 오면 별도 수정 없이 반영됨 ✅(로컬 시나리오 테스트: 미매핑 → 매핑 생성 → 즉시 OK + 현재 상태 이벤트 1회 생성).
- 기본 태그 15종 ✅ (테스트 + 운영 DB 연결당 15개 생성 확인).

## ⑥ API 테스트 결과 (로컬, Fake Prisma 위에서 실제 라우트 실행)

`npm run test:ncwatch-phase12` → **66개 단언 통과** ✅ (운영 서버/DB 에 대한 검증이 아님)

| 시나리오 | 결과 |
|---|---|
| 인증: 키 없음/데모 키/해시값 제시/잘못된 키 → 401, 저장 0건 | ✅ |
| Heartbeat → 해당 Gateway 만 ONLINE + lastHeartbeat, 다른 테넌트 불변 | ✅ |
| 4대 OFFLINE 수신(현장 실측값) → NcwatchStatus 4행, History 4, Event 4(STOP/OFFLINE), 태그 '오프라인' | ✅ |
| 동일 값 재전송 → 이력·이벤트·태그·스냅샷 추가 없음, receivedAt 갱신 | ✅ |
| 상태 변경(가동→알람) → 이전 이벤트 종료(endedAt/duration), 열린 이벤트 항상 1건, 알람 메시지 | ✅ |
| 미매핑 → UNMAPPED(오류 아님, staging 저장), 이후 매핑 생성 시 즉시 반영 | ✅ |
| 다른 테넌트 설비로 매핑 → INVALID_MAPPING 거부 | ✅ |
| 시각: KST 해석(소수초 포함) | ✅ |
| REPORT_DAILY: 정상/형식오류 분리, 400, 401 | ✅ |
| PARTCOUNT → 태그 참고값만, ProductionResult 미생성 | ✅ |
| POST 인증 + 저장의 **운영 서버 실제 호출** | ⛔ 미검증 |
| GET 405 (운영 서버) | ✅ 사용자 확인 (코드상 POST 핸들러만 존재) |

기타 회귀: `tsc --noEmit` ✅, `check:server-actions` ✅, `test:phase10-security`(122 단언) ✅, `npm run build` ✅ (exit 0, 기존 무관 경고 1건).

## ⑦ MES 설비 데이터 반영 결과

- 운영 반영: ⛔ **미수행** (설비 미등록·Agent 미설치·운영 키 미발급)
- 반영 흐름(코드/로컬 테스트로 확인): Agent → `NcwatchStatus` → `NcwatchStatusHistory` → `NcwatchEquipmentMapping` → `EquipmentEvent` → `TagCurrentValue` → `TagSnapshot` → 설비 모니터링 화면
- 마지막 수신시각 = `NcwatchStatus.receivedAt`(매핑 화면), Agent 하트비트 = Gateway `마지막 통신`.
- 설비 모니터링 **화면** 표시는 브라우저로 확인하지 못했다 ⛔ (운영 데이터 없음).

## ⑧ 운영 적용 절차 (각 ★ 는 사용자 승인 후 진행)

**A. 서버 배포 (코드 변경 3개 파일, 스키마 변경 없음)**
1. 이 브랜치 커밋/PR → 리뷰 → 머지 ★
2. Vercel `daewon-mes` 프로젝트 배포 ★ (다른 프로젝트/저장소 영향 없음)
3. 배포 후 `GET /api/lms/ncwatch/status` → 405 확인

**B. 운영 DB 준비 (DB 쓰기 — 실행 전 dry-run 결과를 확인한 뒤 승인)** ★
```bash
# 1) 현황 조회 (읽기 전용)
npm run ncwatch:ops -- inspect
# 2) 설비를 MES 화면에서 등록했다면 생략 / 코드로 등록하려면 아래에 --create-equipment --work-center WC-MACH 추가
npm run ncwatch:ops -- provision --issue-key C:\secure\dwk.txt --rotate-key
# 3) dry-run 결과(설비/매핑/Gateway/키 교체 여부)를 확인하고 승인되면:
npm run ncwatch:ops -- provision --tenant daewon-001 --apply --confirm-tenant daewon-001 --issue-key C:\secure\dwk.txt --rotate-key
```
- dry-run 이 기본이며 `--apply` 와 `--confirm-tenant` 가 모두 있어야 쓰기. 기존 데이터는 수정/삭제하지 않고(없는 것만 생성), 다른 설비에 이미 연결된 매핑은 자동 변경 없이 중단.
- 키 파일은 현장 전달 후 즉시 삭제.

**C. 현장 PC** (`tools/ncwatch-agent/README.md` 참조)
1. 기존 폴더 백업 → 패키지 복사 → `.env` 확인 → `set-agent-key.ps1` → `node check-connection.js` → `install-agent.ps1` → `check-agent.ps1`
2. 재부팅/인터넷 단절/프로세스 종료 시험

**D. 최종 검증**: MES 에서 Gateway 온라인, 4대 수신시각, 설비 모니터링 표시, 24시간 후 `NcwatchSyncLog`/`TagSnapshot` 증가량 확인

## ⑨ 남은 현장 확인 사항

- 설비 가동 시 상태 코드 실측: STATUS 0·1·2·3·5·6, RUN, MODE, MESSAGE 값 (**현재 4=OFFLINE 만 실측**) ⛔
- `REPORT_DAILY` DATA_1~12 컬럼 의미(가동률/수량) ⛔
- CNC-1 의 NCWatch↔설비 통신 연결 후 STATUS 변화·`ALIVECOUNT` 증가 확인 (현재 DB 조회 성공 ≠ 설비 통신 정상) ⛔
- 현장 Agent 폴더의 실제 버전/`.env` 값 대조(이 저장소에는 v2 소스만 있었음) ⛔
- Windows 작업 스케줄러 실제 등록·부팅 자동 실행·로그인 없이 실행·재시작 동작 (관리자 권한 필요, 이 개발 PC 에서는 시험하지 못함) ⛔
- 사내 방화벽에서 `daewon-mes.vercel.app:443` 아웃바운드 허용 여부 ⛔
- 설비 4대의 정확한 명칭·기종·제조사·작업장 (MES 설비 등록 시 필요)

## ⑩ 운영 적용 및 배포 상태 / 검증 현황

| 항목 | 상태 |
|---|---|
| Agent 단위·시나리오 테스트 28건(`tools/ncwatch-agent`, `npm test`) | ✅ (타임아웃, 401, 5xx, 연결 거부, 중복 방지, 지수 백오프, 인터넷 단절→복구, 변경 감지, KST, 로그 마스킹, 설정 검증) |
| Agent 실제 프로세스 시험(모의 MES 서버, DB 없음) | ⚠️ 하트비트 전송·DB 장애 중 생존·중복 실행 종료코드 3·설정 오류 종료코드 2·`kill` 후 10초 내 자동 재시작 확인 / **실제 NCWatch PostgreSQL 대상 시험은 현장 필요** ⛔ |
| PowerShell 8개 스크립트 구문(Windows PowerShell 5.1 파서) | ✅ |
| `install/stop/uninstall -WhatIf` 영향도 출력, 비관리자 거부, `check-agent.ps1` 실행 | ✅ |
| 예약 작업 등록 객체(트리거·설정·주체) 생성 | ✅ / **실제 등록·부팅 후 자동 실행** ⛔ |
| 배포 패키지 zip: 슬래시 경로 표준 zip, `.env`/로그/상태/테스트 제외, 비밀 문자열 검사 통과, 압축 해제본 단독 실행(`check-connection --config-only`) | ✅ |
| 운영 DB 쓰기 | 승인 범위만: 설비 4·매핑 4·연결 4·태그 60 생성, Gateway apiKey 1건 교체 (그 외 변경/삭제 없음) |
| 운영 배포 | 미수행 |

---

## ⑪ 인증키 호환성 및 배포 선행조건 (중요)

| 서버 코드 | 인증 방식 | 새 운영 키(해시 저장) |
|---|---|---|
| **현재 운영 배포본** (Production = `1683f17`, `main` 계열) | `findUnique({ apiKey: <제시한 키 원문> })` 평문 조회만 | ⛔ **인증 불가 → 401** (DB 에는 `sha256:` 해시만 있음) |
| 이 브랜치 (Phase 10 `14ecc30` 이후) | ① `sha256(제시 키)` 조회 → ② 구형 평문 행 호환 조회(성공 시 해시로 전환) | ✅ 인증 가능 |

- `auth.ts` 의 평문 조회는 이 브랜치에서도 **2단계 구형 호환용**으로만 남아 있으며, 해시 저장 행은 1단계에서 먼저 매칭된다. `sha256:` 접두 문자열을 키로 제시하는 우회는 차단된다.
- 따라서 **Phase 10 이상의 서버 코드를 운영에 배포하기 전에는 현장 Agent 가 인증에 실패한다 (구조적으로 서버 배포가 선행되어야 함).** 구버전 서버에서 이 키가 동작하게 하려면 평문 저장이 필요하나, 보안상(Phase 10 DG-033) 채택하지 않았다. 키 재발급은 불필요하다.
- `Phase 10 auth 커밋(14ecc30)` 은 `main` 에 아직 없다. 이 브랜치는 Phase 10 → 11 → 12 가 쌓여 있어 `main` 대상 PR 은 세 단계를 함께 포함한다 (스키마/마이그레이션 변경 0).
- 읽기 전용 점검 `npm run ncwatch:ops -- verify-key --key-file <키파일>` 결과 (키·해시 값은 출력하지 않음):
  - 신규 방식: 새 키 → 기존 `NCWatch Agent` Gateway 식별 ✅, tenant `daewon-001`·site 일치 ✅, 저장 해시값을 키로 제시하면 거부 ✅, 임의 키/데모 키 식별 안 됨 ✅
  - 구 운영 방식(평문 조회): 새 키 식별 **안 됨** (= 401 예상)
  - 다른 테넌트 Gateway 0건, 수신 경로 테이블 접근 정상
- 회귀 테스트(`test:ncwatch-phase12`, 82 단언): 256bit 키 형식, DB 저장값=sha256(키), 신규 방식 200, 구 방식 조회 불가, 미등록 키 401(고정 메시지), 다른 테넌트 키의 테넌트 격리(payload `tenantId` 무시, 대원정밀 이벤트/태그 불변), 키별 Gateway 하트비트 분리.
