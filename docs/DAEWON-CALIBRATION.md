# 계측기 검교정관리

품질관리 > **계측기 검교정관리** (`/app/mes/quality/calibration`). 한 화면에서 3개 탭을 전환한다.

| 탭 | 내용 |
| -- | -- |
| 계측기 관리대장 | 목록/검색/필터/정렬, 등록·수정·상세, 폐기·삭제, 엑셀 다운로드, 엑셀 이관 |
| 검교정 일정관리 | 차기교정일·잔여일수·교정상태·진행상태(예정/진행중/완료)·담당자, 일정 지정, 기한초과/임박 집계 |
| 검교정 이력관리 | 교정 실적 등록·수정·취소, 계측기별 누적 이력, 이력 엑셀 다운로드 |

## 범위 제외 (의도적으로 만들지 않음)

- 교정 성적서 **파일 첨부** (UI/API/테이블/스토리지 없음 — 성적서 "번호"만 문자열로 관리)
- **품질검사 연동** (검사 등록 화면·기존 검사 입력 제한/차단 로직은 수정하지 않음)

## 데이터 모델 (`prisma/migrations/20261029000000_add_measuring_instrument_calibration`)

추가 전용 migration. 기존 테이블/데이터를 건드리지 않고 enum 4개 + 테이블 3개만 만든다(RLS 활성화 포함).

| 테이블 | 설명 |
| -- | -- |
| `MeasuringInstrument` | 계측기 마스터. `@@unique([tenantId, managementNo])`, 소프트 삭제(`deletedAt`), 요약값(`lastCalibrationDate`/`nextCalibrationDate`/`currentCalibrationId`) |
| `InstrumentCalibration` | 교정 실적/이력 (1:N). 진행상태, 교정일, 기관, 성적서번호, 결과(적합/부적합, 이관 이력은 NULL), 차기교정일(+직접 수정 사유), 비용, 담당자, 취소(`cancelledAt`), 이관 출처(`source`/`sourceRef`/`sourceKey`) |
| `InstrumentStatusHistory` | 사용상태 변경 이력(이전/이후/사유/변경자) |

교정/계측기 정보의 수정·취소 내역은 기존 `AuditLog`(entityType `MeasuringInstrument` / `InstrumentCalibration`)에 남기고 상세 화면에서 보여 준다.

## 핵심 규칙

- **교정상태는 저장하지 않고 계산한다**(`computeCalibrationState`, 기준일 = KST 오늘): 기한초과(차기교정일 < 오늘) / 교정임박(0~30일) / 정상(31일 이상) / 미등록(차기교정일 없음) / 제외(폐기 또는 교정대상 제외). 진행상태는 별개라 외부 교정 중이어도 기한이 지나면 기한초과로 표시된다.
- **차기교정일 = 교정실시일 + 교정주기**(6개월/1년/2년/사용자 지정 개월). 월말·윤일 보정(예: 2024-02-29 + 1년 = 2025-02-28). 직접 수정하면 사유가 필수.
- **최신 유효 이력 선정**(`summarizeCalibrations`): 취소·미완료·부적합·차기교정일 없는 이력은 제외하고, 교정일이 가장 늦은 이력이 현재 교정이 된다 → 과거 이력을 뒤늦게 등록해도 최근교정일/차기교정일이 과거로 되돌아가지 않는다.
- **부적합**: 차기교정일을 부여하지 않고 정상 교정 완료로 보지 않는다. 최근 결과가 부적합이면 사용가능 계측기는 자동으로 **사용중지**로 전환(상태 이력 기록). 이후 적합 교정을 등록해도 사용가능으로 **자동 복귀하지 않는다**(관리자가 사유와 함께 수동 변경).
- **사용 가능 여부 공통 로직**: `evaluateInstrumentUsability()` — 사용상태 ≠ 사용가능, 최근 결과 부적합, 기한초과, 교정정보 미등록이면 사용 불가. 교정임박은 사용 가능 + 경고. (이번에는 관리 화면에서만 사용)
- **삭제/폐기**: 물리 삭제 없음. 교정이력이 있는 계측기는 삭제할 수 없고 폐기(이력 보존)만 가능. 이력이 없는 잘못 등록된 계측기만 소프트 삭제.
- 관리번호는 등록 후 변경 불가, 대소문자 무관 중복 방지(삭제 처리된 번호도 재사용 불가). Serial No·성적서번호는 문자열.

## 권한

리소스 `INSTRUMENT_CALIBRATION` (메뉴 코드 `calibration`). 화면의 버튼 숨김과 별개로 모든 서버 액션이 서버에서 검증한다.

| 기능 | 필요 권한 |
| -- | -- |
| 조회(목록/상세/이력) | READ |
| 계측기 등록, 교정 실적 등록, 엑셀 이관 | CREATE |
| 계측기 수정, 교정 이력 수정/취소, 교정 일정 | UPDATE |
| 폐기(상태→폐기/폐기 해제), 소프트 삭제 | DELETE (+UPDATE) |
| 엑셀 다운로드(관리대장/이력) | EXPORT |

기본값: OWNER/ADMIN 전체, MANAGER = READ/CREATE/UPDATE/EXPORT(삭제·폐기 없음), OPERATOR·VIEWER = READ.

### 기본 권한 초기화 (사용자관리 화면 진입과 무관)

- **기본값의 유일한 정의는 `src/lib/auth/permission-catalog.ts`** 이다. 사용자관리 화면(`permission.actions.ts`)과 seed 는 이 파일을 import 하며 자체 기본값을 두지 않는다.
- **신규(빈) DB**: `prisma migrate deploy` → `npm run db:seed` 만으로 모든 역할의 기본 권한 행이 만들어진다(시드는 `ensureDefaultPermissions`: `createMany({ skipDuplicates: true })`).
- **기존 DB**: `20261029010000_add_instrument_calibration_permissions` 데이터 migration 이 `migrate deploy` 때 모든 테넌트에 누락된 기본 권한 행만 INSERT 한다(`ON CONFLICT DO NOTHING`). 수동 보완이 필요하면 `DEFAULT_TENANT_ID=… DAEWON_ENSURE_PERMISSIONS_CONFIRM=YES ENSURE_RESOURCES=INSTRUMENT_CALIBRATION npm run db:ensure-permissions`.
- 모두 **멱등·비파괴**: 이미 저장된 행(허용/차단)은 덮어쓰지 않고, 삭제/갱신은 하지 않는다. 사용자관리 화면의 `ensurePermissionMatrix` 는 보조 경로로만 남는다.
- 행이 없으면 **전체 허용으로 처리하지 않는다**(조회만 허용, 쓰기는 거부 — `role-permissions.ts` 동작 불변).
- 새 리소스를 추가할 때: `permission-catalog.ts` 에 기본값을 넣고 → 기존 DB 용 데이터 migration(또는 `db:ensure-permissions`)을 추가한다. `scripts/test-calibration-permissions.ts` 가 migration 과 카탈로그의 불일치를 검사한다.

## 엑셀 이관

`엑셀 이관` 버튼 → 파일 선택 → **미리보기**(신규/기존/중복/오류·경고 건수) → 이관 실행. 서버는 미리보기 결과를 신뢰하지 않고 같은 원본으로 다시 계획을 만들어 하나의 트랜잭션에서 저장한다.

- 계측기 기준정보는 **종합 관리대장 시트**(`계측기 검교정 계획서`)만 사용. 종류별(`A - 캘리퍼스` …)·날짜별(`20240403` …) 시트는 **교정이력 후보**로만 쓰고 계측기를 만들지 않는다. 분류는 종류별 시트명에서 가져온다.
- **교정실시일·적합여부는 엑셀에 없으므로 만들지 않는다.** 이력에는 교정기관·성적서번호·차기교정일만 담고 `calibrationDate`/`result` 는 NULL(화면에 "미기재(이관)"). 시트 이름의 날짜는 교정실시일로 쓰지 않는다. 이후 상세 화면의 "수정"으로 실제 교정일/결과를 보강할 수 있다.
- 사용불가·폐기 → **폐기/사용중지**, `보류` → **보류**, 해석 불가한 제품상태 → **보류 + 경고**. 사용가능으로 이관하는 것은 `사용가능`으로 명시된 행뿐.
- `사용부서(장소)`: `~부`로 끝나면 사용부서, 아니면 사용장소로 저장(부서를 추정하지 않음).
- 이미 있는 관리번호는 **덮어쓰지 않는다**(차이는 미리보기에 표시). 이력 중복 판단 키 = 관리번호 + 성적서번호 + 차기교정일(`sourceKey`) → 같은 파일을 다시 올려도 신규 0건.
- 잘못된 날짜(예: `2026.06.00`)·교정주기 해석 불가·관리번호 형식 오류·중복 행은 오류/경고로 표시하고 해당 행/이력만 제외한다.

### 실제 파일 검증 결과 (`2025 계측기 검교정 LIST 최종본(최신).xlsx`, 로컬 시험 DB)

계측기 80대 (사용가능 73 / 폐기 5 / 보류 2), 교정이력 263건(교정일·결과 없음), 오류 0건·경고 7건, 재이관 시 신규 0건. 경고: Serial No 중복 1건(DW-L01/DW-O01 동일 `500192201`, 그대로 이관), 종류별 시트의 `2026.06.00` 6건(성적서번호 없이 날짜도 잘못되어 이력 제외 — 종합 관리대장에 올바른 값 있음).
엑셀의 차기교정일이 모두 2026-10-29(개발 기준일) 이전이라 이관 직후 활성 75대가 **기한초과**로 표시된다. 이후 교정 실적이 반영되지 않은 시트라면 이관 후 실적을 등록해야 한다.

## 운영 적용 전 필요한 조치

1. **DB 백업 후** `prisma migrate deploy` (추가 전용 migration 2개: 테이블 생성 + 기본 권한 INSERT). 코드보다 먼저 적용한다(코드가 새 테이블을 사용).
2. 권한 행: migration `20261029010000` 이 `migrate deploy` 와 함께 기존 테넌트에 기본 권한을 채운다(기존 설정은 유지). 사용자관리 화면을 열 필요가 없다. 클린 DB 로 재구축하면 seed 가 같은 기본값을 만든다.
3. 엑셀 이관은 운영 화면에서 `계측기 검교정관리 > 엑셀 이관`으로 직접 실행(이 개발에서는 운영 DB에 이관하지 않았다).
4. 이관 후 `사용부서/장소`, 폐기·보류 분류, 교정실시일·결과(실제 성적서 기준) 보강 여부를 현장 확인.
5. Vercel 환경변수 추가 없음.

## 테스트

```bash
CALIBRATION_XLSX="<엑셀 경로>" npm run test:instrument-calibration
```

날짜 계산·교정상태·사용 가능 판단·최신 이력 선정·이관 계획(멱등성 포함)·엑셀 워크북·서버 권한 가드 정적 점검 47건. `CALIBRATION_XLSX` 가 없으면 실제 파일 검증만 건너뛴다.

| 명령 | 내용 | DB |
| -- | -- | -- |
| `npm run test:calibration-permissions` | 역할별 기본 권한 정책표, seed/화면/migration 단일 정의·드리프트, 멱등성 (11건) | 불필요 |
| `npm run test:calibration-server-actions` | 5개 역할 × 조회/등록/수정/삭제·폐기/엑셀 다운로드/이관 + 무세션·위조 세션·타 테넌트·없는 ID·역할 강등 (76건) | 로컬 테스트 DB |
| `npm run test:calibration-import-clean-db` | 클린 DB 에서 엑셀 이관 80대/263건, 원본 대조, 재이관 신규 0건 (21건) | 로컬 테스트 DB |

DB 가 필요한 테스트는 `DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB` 와 `127.0.0.1`/`localhost` 의 `*_test` DB 가 아니면 즉시 중단한다(운영 DB 보호). 사전 준비: 빈 DB → `prisma migrate deploy` → `npm run db:seed`.
서버 액션 테스트는 `next/headers`(쿠키)와 `next/cache` 만 대체하고, 실제 JWT 세션·권한 해석·서버 액션·DB 를 그대로 사용한다. 이관 테스트는 `CALIBRATION_XLSX` 가 필요하며 끝나면 만든 데이터를 모두 지운다.
