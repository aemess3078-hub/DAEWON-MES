# DAEWON-MES TODO / 미결정 사항

이 프로젝트는 NMES-DEV(`cloud-mes`)를 기준으로 복제한 대원정밀 전용 MES다.
아래는 **1차 생성 단계에서 의도적으로 구현하지 않은 항목**과 결정이 필요한 사항이다.

## 1. 계측기 검교정관리

- **현재 상태:** 관리 화면 구현됨(`/app/mes/quality/calibration`, 계측기 관리대장 / 검교정 일정관리 / 검교정 이력관리 3탭). 설계·운영 적용 절차는 `docs/DAEWON-CALIBRATION.md` 참고.
- **이번 범위에서 제외(미구현):** 교정 성적서 **파일 첨부**(성적서 "번호"만 관리), **품질검사 화면 연동**(검사 입력 시 교정 만료 계측기 경고/차단). 사용 가능 여부 공통 로직(`evaluateInstrumentUsability`, `src/lib/instrument-calibration.ts`)은 만들어 두었으므로 추후 검사 화면에서 재사용한다.
- **남은 결정:** 만료 알림 방식(메일/푸시 등), 부적합 계측기로 측정한 LOT 처리 정책, 성적서 파일 첨부 도입 여부.

## 2. 유압 테스트

- **현재 상태:** 코드에 유압/누설 시험 관련 모델·화면 없음(grep 확인).
- **필요한 결정:** 시험 항목(압력, 유지시간, 누설량 등), 합부 기준, 전수/샘플 여부, 성적서 양식, NRV 품목별 기준값.
- **관련 기존 코드:** `InspectionSpec`/`InspectionItem`/`InspectionMeasurement`(측정값+판정), `QualityInspection`(`InspectionStage`), `src/app/app/mes/measurement`, `inspection-measurement.helpers.ts`, `spc-calculations.ts`.
- **예상 개발 범위:** 우선 검사표준 항목 템플릿(수치형)으로 수용 가능한지 검증 → 부족하면 시험 유형 enum 추가 + 입력 화면(POP 포함) + 성적서 출력.

## 3. 대원정밀 LOT 채번

- **적용됨 (LOT 번호):** 번호 규칙 관리(`NumberingRule`, type=LOT, 활성)에 저장한 토큰 규칙으로 자동 발행한다 (`src/lib/lot-numbering/tenant-lot-rule.ts`). 대상: 원자재 입고(예약·AUTO 확정), LOT 등록 화면 자동생성(`generateLotNumberForItem`), 제조번호가 없는 완제품 LOT. 순번은 `NumberingSequence` 가 아니라 발행 원장(`Lot` ∪ `LotNumberReservation`)의 최대 순번 + 1 로 계산하며(품목코드·연월이 stem 에 포함되면 품목별·월별로 001 부터), 미리보기는 순번을 소비하지 않는다. 규칙이 없거나 비활성이면 안내 오류, MANUAL 품목은 직접 입력. 예시 규칙(품목코드+YY+MM+"-"+순번3) → `DW-72610-001`.
- **여전히 미확정 (제조번호):** 작업지시 제조번호는 LOT 규칙을 쓰지 않고 계속 직접 입력한다(`manufacturing-no-policy.ts`). CNS 규칙(`cns-lot-rules.ts`)은 대원정밀에 적용되지 않는다(`lot-brand-guard.ts`).
- **아래는 규칙 적용 전 상태(과거 기록) — 제조번호/CNS 가드에 관해서만 유효하다.**
- **이전 상태:** CNS 전용 규칙(`cns-lot-rules.ts`)으로는 번호가 **생성되지 않는다.** 모든 자동 채번 경로의 공통 진입점(`resolveCnsLotRule`)에서 `src/lib/lot-numbering/lot-brand-guard.ts` 가 차단하며, `NEXT_PUBLIC_BRAND=newmes` 가 아니면(대원정밀 포함, 미설정 시에도) "대원정밀 LOT 채번 규칙이 설정되지 않았습니다." 오류가 난다.
- **영향 경로:** 자재입고 LOT(`receiving.actions`, LOT 예약 `lot-reservation.actions`), 제조번호(작업지시 생성, `work-order.actions`), 완제품입고 LOT(`finished-goods-lot.helpers`), LOT 화면의 자동 채번 버튼(`lot.actions`).
- **임시 운영안:** 품목의 LOT 정책을 `MANUAL`(직접 입력)로 두면 입고/제조번호를 수동 입력으로 진행할 수 있다(가드 대상 아님). LOT 계보·추적·재고 구조는 영향 없음.
- **필요한 결정:** 원자재 입고 LOT, 가공 제조번호(작업지시/공정별), 완제품 LOT, 세척/포장 이후 LOT 승계 여부, 협력사 LOT 보존 방식, 자릿수/날짜 체계.
- **관련 기존 코드:** `src/lib/lot-numbering/*`(cns-lot-rules, lot-rule-resolver, lot-number-generator, lot-reservation), 호출부: `receiving.actions.ts`, `lot.actions.ts`, `work-order.actions.ts`, `finished-goods-lot.helpers.ts`, `lot-reservation.actions.ts`. 모델: `NumberingRule`, `LotNumberReservation`, `Item.lotNumberingType/lotPrefix/manualLotPolicy`. 화면: 번호 규칙(`/app/mes/lot-rules`, 개발자 전용).
- **예상 개발 범위:** 규칙 확정 후 `lot-brand-guard.ts` 호출을 제거하고 `cns-lot-rules.ts` 를 대원정밀 규칙으로 교체하고 `Cns*` 명칭을 일반화(호출부 6곳). DB 모델·LOT 추적 로직은 변경 불필요.
- **관련 테스트:** NMES 의 `test-code-numbering-integrity.ts` 는 특정 고객 DB 에 고정되어 있어 복사하지 않았다. 규칙 확정 후 대원정밀용으로 재작성.

## 4. MCT/CNC 설비 연계 (수집 Agent)

- **현재 상태:** 신규 Agent 미개발. NCWatch 코드·DB 모델(`Ncwatch*`)과 `EdgeGateway/EquipmentConnection/DataTag/TagSnapshot/TagCurrentValue` 는 그대로 유지. 설비연동 설정 메뉴는 개발자 전용으로만 노출.
- **필요한 결정:** 대원정밀 CNC/MCT 제조사·컨트롤러 기종(FANUC/Mitsubishi/Siemens 등)·대수, NCWatch 사용 가능 여부, 수집 항목(가동/정지/알람/생산수량/스핀들 부하), 네트워크 구성.
- **관련 기존 코드:** `src/app/api/lms/ncwatch/*`(heartbeat/status/report-daily), `src/lib/ncwatch/*`, `docs/ncwatch-*.md`, `equipment-monitor.actions.ts`, `/app/lms/monitoring/status`, `/app/mes/equipment-monitor`.
- **예상 개발 범위:** NCWatch 사용 시 설비 매핑(`NcwatchEquipmentMapping`) 등록 + 에이전트 키(`EdgeGateway.apiKey`) 발급. 미사용 시 기종별 수집 Agent 신규 개발. 현황/분석 모니터링 화면은 데이터가 들어오기 전까지 비어 있다.

## 5. POP 당일 생산실적 조회 전용 화면

- **현재 상태:** POP 작업대기 → 공정상세 → 작업시작 → 실적등록은 NMES 구조 그대로 유지. 당일 실적 조회가 별도 화면으로 필요한지 미확인.
- **필요한 결정:** 작업자별/설비별/공정별 조회 기준, 정정 가능 여부, 노출 항목.
- **관련 기존 코드:** `src/app/pop/production/[operationId]/production-client.tsx`, `pop.actions.ts`, `production-result.actions.ts`, `daily-production.actions.ts`.
- **예상 개발 범위:** POP 하위 조회 화면 1개 + 서버 액션 1개(기존 `ProductionResult` 조회 재사용).

## 6. 실제 로고 / 기준정보 입력

- **로고:** ✅ 적용 완료 — `public/brand/daewon-logo.png`(투명 배경 960px), `src/components/brand-logo.tsx`(로그인/홈/비밀번호 변경/사이드바/POP 헤더), 파비콘 `src/app/icon.png`·`apple-icon.png`. 어두운 배경(POP 헤더)은 `tone="onDark"` 흰색 칩. 원본 벡터(SVG/AI)를 확보하면 `public/brand/` 에 교체.
- **기준정보:** 품목/BOM/라우팅/검사기준/설비/거래처는 seed 에 넣지 않았다. 고객 자료(엑셀) 확보 후 화면의 엑셀 업로드(품목·BOM·라우팅·공정·거래처)로 반영하는 방식을 권장.
- **공정:** seed 는 흐름 구분만(가공/검사/세척/포장/완제품입고). 세부 공정은 고객 확인 후 등록.

## 7. 정리 항목 (기능 영향 없음)

- 코드 내 `NMES`/`NewMES`/"청운커팅 사업계획서" 주석, AI 문구(`NMES AI 어시스턴트`), 쿠키 이름 `nmes-session`/`nmes-pop-worker-session`, 헤더 `x-nmes-pathname` 은 내부 식별자라 1차에서 변경하지 않았다(인증 코드 최소 변경 원칙).
- `NEXT_PUBLIC_BRAND=newmes` 분기(생산현황 화면)는 유지. 대원정밀 값은 `daewon`.
- `[PERF-TEMP]` 성능 로그는 제거했다(auth.ts, app/layout.tsx, dashboard, 수주/납품현황).
- `DEFAULT_TENANT_ID` 미설정 시 NMES 데모 테넌트(`tenant-demo-001`)로 fallback 하던 동작은 개발 환경에서만 허용하고, 운영(`NODE_ENV=production`)에서는 오류 처리한다(`auth.ts`, `api/auth/login`). 남은 참고용 fallback: 로그인 화면의 작업자 로그인 클라이언트 쿠키 기본값(서버 `DEFAULT_TENANT_ID` 가 우선하므로 영향 없음), `scripts/set-owner.ts`(NMES 데모 전용, 대원정밀 DB 에서 실행하지 말 것).
- 숨긴 메뉴 목록: `DAEWON_HIDDEN_NAV` (`src/lib/nav-config.ts`). URL 직접 접근은 막지 않는다 — 필요하면 `MENU_CODE_RESOURCE_MAP`/권한으로 제한.
- NMES 개발용 테스트 스크립트 중 특정 고객 DB 에 고정된 것은 복사하지 않았다(`docs` 참고, 대원정밀 가드로 재작성 필요).

## 8. 고객 Supabase 확보 후 실행 순서 (참고)

> 실제 DB 접속 전 대상 프로젝트가 **대원정밀 전용**인지 `DATABASE_URL` 호스트/ref 로 반드시 확인.

1. `.env.local` 작성(`.env.example` 참고): DB URL 2개, `JWT_SECRET`, `POP_*`, `DEFAULT_TENANT_ID`(대원정밀 전용 값), Storage 용 URL/service_role.
2. `npx prisma migrate deploy` (또는 `npm run db:deploy`) — 이제 `prisma/migrations/` 에는 대원정밀 baseline 2개(`20261013000000_daewon_initial_baseline`, `20261013000100_supabase_public_hardening`)만 있다. NMES 과거 이력은 `prisma/migrations_legacy_nmes/`(보관 전용, 실행 금지). `db push`/`db pull`/`migrate resolve` 금지.
3. Storage 버킷 확인(첨부파일/작업표준서). 코드가 없으면 자동 생성하는 부분 포함 — 동작 확인.
4. seed(1회): `SEED_ADMIN_*`, `DAEWON_SEED_CONFIRM=YES` 설정 후 `npm run db:seed`. 완료 후 해당 변수 제거.
5. 로그인 확인 → 최초 비밀번호 변경 → 사용자관리에서 계정 생성(필요 시 POP PIN 설정).
6. 기준정보 입력(설비/품목/BOM/라우팅/검사표준) → 테스트 흐름(수주→생산계획→작업지시→POP 실적→검사→출하) 검증.
7. Vercel 프로젝트는 **신규 대원정밀 전용**으로 생성하고 환경변수 입력 후 배포.

## 9. 비밀번호 초기화 (처리 완료)

- 기존 NMES 의 고정 초기화 비밀번호(CNS 접두 값)는 제거했다.
- 현재 방식: 사용자관리 > 비밀번호 초기화 시 **관리자가 임시 비밀번호를 직접 입력**(확인 입력 포함)하고, 서버가 `validatePassword` + bcrypt 해시로 저장한다. `mustChangePw=true`, 잠금 해제, `failCount` 초기화는 기존과 동일. 평문은 DB/로그/감사로그에 남기지 않는다.
- 임시 비밀번호는 사용자에게 별도 경로로 안전하게 전달해야 한다. 첫 로그인에서 변경이 강제되며, 새 비밀번호는 임시 비밀번호와 달라야 한다.
- 최초 관리자는 seed(`SEED_ADMIN_*`)로 별도 생성한다.

## 10. 복사하지 않은 NMES 전용 테스트

특정 고객 테넌트/DB, 데모 계정(고정 비밀번호), 타 고객 Supabase ref 에 고정된 아래 테스트는 대원정밀 저장소에서 제외했다. 필요하면 대원정밀 전용 가드(테넌트/DB ref 확인)로 재작성한다.
`test-production-plan-sales-link`, `test-attachment-management`, `test-backup-management`, `test-code-numbering-integrity`, `test-progress-semantics-integrity`, `test-sales-plan-progress-integrity`, `test-sop-pop-integrity`, `f23-browser-smoke`, `tests/f17-next-work-navigation-smoke.spec.ts`, `tests/f18-pop-tool-usage-smoke.spec.ts`.

## 11. 구축 범위 접근 정책 (URL 직접 접근 차단)

- **정책 파일:** `src/lib/auth/daewon-scope.ts` — 허용 목록(allow-list). 목록에 없는 `/app/**` 는 일반 사용자에게 404. 개발자 계정(`test`)은 전 경로 허용. 개발자 전용 경로(gateways, equipment-connections, tags, lot-rules, features, common-codes)는 개발자만. `NEXT_PUBLIC_BRAND=newmes` 에서는 미적용(그 외 모두 적용, fail-closed).
- **적용 위치(3겹):** ① `src/middleware.ts`(1차, 페이지 이동/서버 액션 POST 모두 통과하는 지점 — 서명 미검증 payload 로 개발자 예외만 판단) ② `src/app/app/layout.tsx`(서명 검증된 사용자 기준 재확인) ③ 숨김 기능 전용 서버 액션/AI API 진입 가드(`daewon-scope.server.ts`, JWT 서명 검증).
- **서버 액션 가드 대상(파일 내 모든 export):** project-*, quotation, costing, item-price, material-return, wip-hold, spc, defect-cause/corrective/recurrence, quality-dashboard, kpi, report, equipment-statistics/-output/-management, tag-current-value, mold, tool, downtime-reason, manufacturing-traceability, support-request, backup, ai-chat (+ `/api/ai-chat`, `/api/ai-report`). 개발자 전용: equipment-integration, feature, common-code, numbering-rule 의 lot-rules 전용 3개 함수.
- **공유 액션 4개 파일은 함수 단위로 처리했다.** `quality.actions` 는 공정검사 전용 7개(getQualityInspections, createQualityInspection, updateInspectionResult, deleteQualityInspection, getWorkOrderOperationsForInspection, getInspectionSpecByOperation, getProfilesForInspection)만 가드하고, 불량코드(defects)와 검사표준(inspection-standards, measurement) 함수는 허용 화면과 공유하므로 기존 RolePermission 유지. `process-progress.actions` 는 재작업 전용 2개(getReworkPendingList, completeRework)만 가드(getOperationProgressList, updateOperationStatusAction, dispositionDefects 는 process-progress 허용 화면에서 사용). `production-plan.actions`, `sales-order.actions` 는 모든 함수가 허용 화면(생산계획/수주)에서 쓰이거나 POP·work-order 내부 호출(syncProductionPlanStatus*)이라 가드하지 않았다.
- **UI 링크 정리:** 허용 화면 안의 차단 route 링크는 `isLinkVisible()`(daewon-scope.ts)로 숨겼다 — 설비 목록 행 메뉴의 수리요청/점검등록/통계보기, 작업지시 목록의 제조번호 추적 조회·공정검사 버튼, 불량통계의 제조번호 링크(텍스트로 표시). 개발자 계정도 해당 링크는 보이지 않으며 URL 로 직접 접근한다.
- **랜딩:** 로그인/비밀번호 변경 후 이동 경로를 `/app/mes/dashboard`(차단) → `/app`(홈)으로 변경. `/app/mes` 는 `/app` 으로 redirect.
- **허용 목록 변경 방법:** 메뉴를 추가/노출하려면 `nav-config.ts` 와 `daewon-scope.ts` 의 `DAEWON_ALLOWED_ROUTES` 를 함께 수정한다.
- **seed:** MANAGER/OPERATOR/VIEWER 에는 범위 밖 리소스(QUOTATION, COSTING, PROJECT_*, ITEM_PRICE)를 부여하지 않는다.

## 12. 애플리케이션 권한/보안 점검 결과 (Supabase 연결 전)

**수정한 항목**
- 엑셀 일괄 등록/검증/내보내기(item, bom, business-partner, routing, work-center): `requireRole("OPERATOR")` 만 있어 현장작업자도 마스터 대량 생성이 가능했음 → 해당 리소스 CREATE(내보내기는 READ) 권한 추가.
- `numbering-rule.generateNumber`(시퀀스 증가 쓰기): 인증 없음 → LOT CREATE 권한.
- `/api/upload/work-standard`: OPERATOR 면 누구나 **공개 버킷**에 업로드 가능 → WORK_STANDARD CREATE/UPDATE 필요, PDF 시그니처(`%PDF-`) 검증, 경로 난수를 `Math.random` → `randomUUID`.
- `/api/upload/attachment`: 구축 범위 밖 업무유형(원인분석/조치/재발방지/설비수리) 업로드는 개발자만.
- 테넌트 소유권 확인 추가(id 만으로 update/delete 하던 곳): 불량코드 수정/삭제, 검사표준 수정/삭제/항목 교체·삭제, LOT 상태 변경, 공정부적합 처리(dispositionDefects).
- 사용자관리: ADMIN 이 OWNER 계정을 강등/비활성화/재활성화할 수 없도록(OWNER 또는 유지보수 계정만).
- **POP PIN 로그인**: PIN(4자리) 단독 로그인에 시도 제한이 없었음 → 같은 IP 10분 내 실패 30회 초과 시 거부(LoginHistory 재사용, 스키마 변경 없음). 디버그 로그에서 로그인 ID/이름/지문 제거.
- **가입 신청 PIN 조회 창구 제거**: `checkSignupPopPinAvailability`/`createSignupRequest` 가 비로그인 사용자에게 "사용 중인 PIN" 여부를 알려줘 PIN 로 POP 계정을 탈취할 수 있었음 → 형식 검증만 하고 중복 여부는 승인 단계에서 관리자가 확인(중복이면 재신청 안내).
- **`src/lib/auth.ts` 의 `'use server'` 제거**: getTenantId/getCurrentUser/requireRole 등이 비로그인 포함 클라이언트 호출 가능한 서버 액션으로 노출되던 문제.
- `syncProductionPlanStatus*` 를 `src/lib/production-plan-sync.ts`(일반 모듈)로 분리: POP 공개 페이지에 production-plan/routing 액션 전체가 함께 등록되던 것을 차단(공개 POP 페이지 노출 액션 36 → 8개).
- `getPopWorkQueueRows`: 인증 없이 tenantId 인자만으로 작업 대기열 반환 → 세션 인증 + 세션 tenant 일치 확인.
- `recordAttachmentStorageCleanupFailure` export 제거(임의 감사로그 기록 가능했음).

**남은 위험(결정/조치 필요)**
- `/kiosk` 와 `/api/mes/equipment-monitor/light` 는 **비로그인 공개**(현황판 설계). 설비 상태/생산 KPI 가 URL 만 알면 조회된다. 필요 시 접근 키/IP 제한/로그인 도입 결정.
- `/signup-request` 는 비로그인 + 요청 수 제한 없음(PENDING 스팸 가능). 배포 단계에서 Vercel WAF/Rate limit 권장.
- ~~작업표준서 버킷 public~~ → **해결**: private 버킷 + 서버 발급 signed URL(`src/lib/storage/work-standard-storage.ts`).
- POP PIN 이 4자리 숫자(1만 조합). 시도 제한은 넣었지만 6자리 이상 확대 권장.
- 첨부 업로드의 Content-Type 은 클라이언트 값을 저장한다(확장자 allow-list + private 버킷 + signed URL 로 완화됨).
- `generateXxxNo` 류(다음 번호 미리보기) 조회 함수와 `bulkCheck*ForDelete` 일부는 권한 검사가 없다(조회 전용, 영향 낮음).
- 인증 쿠키 이름 `nmes-*`, `GET /api/auth/clear-session` 이 GET 으로 세션 쿠키를 지움(로그아웃 CSRF, 영향 낮음).

**Supabase Storage 버킷**
| 버킷 | 공개 | 생성 | 사용처 |
|---|---|---|---|
| `attachments` | private | 코드가 없으면 service_role 로 자동 생성(`attachment-storage.ts`) — 권한 확인만 | 첨부파일 관리(`/api/upload/attachment`, signed URL 다운로드) |
| `work-standards` | private | 업로드 시 코드가 없으면 private 으로 생성(이미 public 이면 업로드를 거부) | 작업표준서 PDF — DB 에는 저장소 참조(`storage://work-standards/<path>`)만 저장, 열람 시 서버가 signed URL 발급(웹 1시간 / POP 4시간) |

## 13. 작업표준서 저장소(private) 구현 메모

- 업로드: `/api/upload/work-standard` → private 버킷 `work-standards`, 응답 `url` 은 저장소 참조(`storage://work-standards/<tenant>/<date>-<uuid>-<name>.pdf`).
- 열람: `getWorkStandards()`(웹, 1시간), `getWorkStandardsForOperationContext()`(POP, 4시간)가 목록 조회 때 일괄 signed URL 발급. 외부 링크(http/https)는 그대로 통과, 과거 public URL 형식도 signed URL 로 변환.
- 주의: signed URL 은 만료되므로 DB 에 저장하지 않는다(편집 폼은 `fileUrl` 원본을 저장하고 `fileHref` 는 표시 전용).
- 서명 발급 실패 시: 웹은 "링크 생성 실패" 표시, POP 은 해당 표준서를 목록에서 제외하고 서버 로그에 기록.

## 14. Migration 이력 정리 (2026-10-13)

- NMES 이력 53개는 `db push` 로 만든 객체(테이블 6개, enum 7개)가 섞여 있어 빈 DB 에서 재생되지 않았다(`20260328150000` 에서 실패, `20260910000000` 에서 `CheckResult` 미존재).
- `prisma/migrations_legacy_nmes/` 로 이동·보관하고(삭제 안 함, 실행 금지), `schema.prisma` 기준 clean baseline 으로 새로 시작했다.
- `20261013000100_supabase_public_hardening`: Supabase 기본 권한 때문에 public 테이블이 anon key 로 PostgREST 에 노출되는 것을 막는다(기본 권한 회수 + 전 테이블 RLS 활성화, 정책 없음). 앱은 Prisma(owner)와 서버 service_role 만 사용하므로 영향 없음.
- 이후 새 테이블은 기본 권한 회수로 anon/authenticated 에 노출되지 않는다. 그래도 새 테이블 추가 migration 에는 `ENABLE ROW LEVEL SECURITY` 를 함께 넣는 것을 권장.

## 15. Supabase 최초 구축 현황 (2026-10-13)

- 대상 프로젝트: `aquqetajewvhyirmewfy` (ap-northeast-2). 로컬 앱과 연결해 로그인/조회까지 확인함. **Vercel 배포는 아직 하지 않음.**
- DB: `prisma/migrations` 2개(baseline + supabase hardening) 적용, drift 없음. 테이블 110개, enum 76개, FK 316개. 모든 public 테이블 RLS 활성화, anon/authenticated 권한 없음.
- seed(`prisma/seed-daewon.ts`)로 Tenant `daewon-001`, 사업장/창고/로케이션/공정/기본 불량코드/공통코드/권한/기능 카탈로그, 관리자 `admin`(OWNER) 생성.
- 실행 방법(재현): `.env.local` 값은 Prisma CLI 가 읽지 않으므로 셸 환경변수로 주입해야 한다(`prisma migrate deploy`, `npm run db:seed` 모두 동일). seed 는 `DAEWON_SEED_CONFIRM=YES`, `SEED_ADMIN_LOGIN_ID`, `SEED_ADMIN_PASSWORD` 필요.
- **관리자 정책(소유자 결정):** 업체 공통 유지보수 계정 `admin` 은 `mustChangePw=false`(첫 로그인 비밀번호 변경 강제 없음). 비밀번호가 업체 공통 값이면 인터넷에 노출되는 순간 전 업체가 같은 위험을 공유한다. **배포 전에 이 계정의 비밀번호를 업체별로 다르게 설정하거나 mustChangePw 정책을 재검토할 것.**
- 노출된 자격증명(채팅 이력)에 대한 재발급: DB 비밀번호, service role key(JWT secret 재생성). 배포 전 완료 권장.
- 참고: `supabase_admin` 이 만드는 객체의 public 기본 권한(anon 포함)은 Supabase 관리 영역이라 변경하지 않았다. 앱은 Prisma(`postgres`)로만 테이블을 만들므로 영향 없음. Supabase 대시보드 SQL 편집기로 테이블을 만들 때는 RLS 를 켤 것.

## 16. 계정 정책 및 로그인 보호 (2026-10-13)

- **admin**: 고객 운영/유지보수 OWNER. 개발자 전용 기능 접근 불가. 정책상 `mustChangePw=false`.
- **test**: 개발/유지보수 전용 개발자 계정(OWNER, 전역, `mustChangePw=false`). 코드가 `loginId === 'test'` 로 개발자를 판정하므로 이 ID 를 유지한다.
  범위 밖(숨김) 화면과 개발자 전용 6개 화면(gateways, equipment-connections, tags, lot-rules, features, common-codes)에 접근 가능.
  - 생성: `prisma/seed-daewon.ts` 가 환경변수(`SEED_DEVELOPER_PASSWORD`, 선택 `SEED_DEVELOPER_LOGIN_ID=test`)로 생성한다. 비밀번호는 소스/문서에 두지 않고 bcrypt 해시만 DB 에 저장한다.
  - 이미 seed 된 DB 에 계정만 추가: `SEED_ONLY=developer` (Tenant 확인 후 개발자 단계만 실행, 멱등).
  - ⚠ 이 계정은 모든 숨김/개발자 기능을 열 수 있다. 배포 전 비밀번호 정책(공통 값 여부)을 재검토할 것.
- **로그인 실패 잠금**: 5회 연속 실패 → 15분 자동 잠금 후 재시도 가능. 수동 잠금은 자동 해제되지 않는다. 동일 IP 10분 20회 실패 시 일시 거부. 응답은 항상 일반 실패 메시지.
  - 자동 잠금 서명: `isLocked && lockedAt != null && failCount >= 5` (`src/lib/login-lock.ts`). POP PIN 로그인도 같은 기준으로 자동 잠금 만료를 허용한다.
- 개발자/관리자 계정 비밀번호 값은 어떤 문서/소스에도 기재하지 않는다(`.env.local` 의 `SEED_*` 에서만 관리).
