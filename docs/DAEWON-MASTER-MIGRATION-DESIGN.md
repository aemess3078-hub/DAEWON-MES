# DAEWON Master Migration — Phase 7A 설계 / Dry-Run 보고

대원정밀 기존 Excel(MRP_자재소요량_엑셀프로그램V09.xlsm)에서 **기준정보(Master)만** 추출·검증하고,
개발용 Master seed 와 운영 승인형 Master import 가 **같은 파이프라인**을 쓰도록 한 설계/도구 문서다.

> **Phase 7A 범위: 분석 + 검증 도구 + seed 프레임워크 + Dry-Run.** 운영 DB 에는 아무것도 쓰지 않았다(읽기 전용 조회만).
> 실제 운영 Master import 는 Phase 7B(사용자 승인 후)이며 이 문서의 §9 절차를 따른다.
> 이 문서에는 실제 거래처명/품명/품번/연락처를 적지 않는다(건수만). 상세 산출물은 Git 밖에 둔다.

## 1. 핵심 원칙

| 구분 | 내용 |
|---|---|
| Excel 의 용도 | ① Master 출처 ② 기존 MRP 계산 회귀검증(Golden) 자료. **운영 정보의 원천으로 쓰지 않는다** |
| 이관 대상 | MASTER: Item, BOM, Customer/Supplier, ItemSupplier (장기 유지 기준정보) |
| 이관/seed 금지 | 현재 재고·가용재고·LOT 재고·기초재고, 수주/미출하/납기잔량, 구매발주/미입고 잔량, 입출고·자재사용 이력, 작업지시/생산실적/WIP, 검사결과/불량현황, 기존 MRP 결과 |
| 개발 seed | Excel 의 오래된 운영 정보를 seed 에도 복사하지 않는다. 필요하면 실제 Master 를 참조하는 **가상** DEMO 데이터를 별도 생성(§8) |
| 날짜 | 시트의 최신 날짜는 "자료가 얼마나 오래됐는가"를 보고하는 용도일 뿐, 운영 정보 이관 근거가 아니다 |
| 자동 수정 금지 | `"."`→1, 단위 추정, 코드 생성, 고객/공급업체 자동 병합, BOM 누락 자동 생성, Default 공급업체 지정 없음 |
| 분류 | 모든 후보를 SAFE / REVIEW / REJECT 로 나누고, 기존 MES 와 대조해 CREATE / MATCH / CONFLICT / REJECT 로 나눈다 |

## 2. 파이프라인 (한 벌, seed 와 import 가 공유)

```
Workbook(저장된 값만, 매크로 미실행)
  → extract      (src/lib/master-migration/extract.ts)    시트 레이아웃 → 원시 후보 + provenance(시트/행/열)
  → normalize    (text.ts)                                 식별자는 원본 보존, 문제는 "진단"만
  → validate     (analyze.ts)                              SAFE/REVIEW/REJECT, BOM 그래프(순환/깊이/중복)
  → reconcile    (reconcile.ts)                            기존 MES 대비 CREATE/MATCH/CONFLICT/REJECT
  → dataset      (dataset.ts)                              SAFE + 사람이 승인한 REVIEW → Approved Master Dataset(JSON, sha256)
  ├─ DEV/TEST  → apply.ts  (seed:daewon-master, seed-guard.ts 필수)
  └─ PRODUCTION → apply.ts (Phase 7B 명시적 import — 지금은 dry-run 만)
```

- `apply.ts` 는 **item / bOM / bOMItem / businessPartner / itemSupplier** 5개 모델에만 쓴다(타입 + 테스트로 고정).
- 같은 데이터셋을 다시 적용해도 중복 생성 없음(identity 로 MATCH). CONFLICT 는 overwrite 하지 않고 기본 ABORT(쓰기 0, 보고).
- `dryRun=true` 는 조회만 한다. 하나의 트랜잭션이며 실패 시 전체 롤백.
- Excel 을 직접 읽는 곳은 CLI(`scripts/master-migration.ts analyze`)뿐이다. seed/import 는 **검증된 데이터셋 JSON** 만 입력으로 받는다(해시 검증, 운영 정보 키 거부).

## 3. Workbook 시트 분류 (V09, 13개 시트)

| 시트 | 역할 | 분류 | 사용 행 | 날짜 범위(보고용) | Phase 7 | Seed | Prod Import |
|---|---|---|---:|---|---|---|---|
| 설정 | 사용 부품(자재 코드/품명/규격/거래처/단위) | **MASTER** | 273 | — | Item·공급업체·ItemSupplier 원천 | 검증 통과분 | **후보** |
| DB | 제품 목록 + 제품별 BOM 블록(번호 k → 5k..5k+4 열) | **MASTER** | 제품 163 | — | 제품·BOM 원천 | 검증 통과분 | **후보** |
| 수주관리대장 | 수주 입력(관리번호/제품/수량/납기/고객) | TRANSACTION | 167 | 납기 2026-06-01 ~ 06-30 | 식별자(제품코드/고객명)만 REVIEW 후보 | 사용 안 함 | 아니오 |
| 입고관리대장 | 자재 입고 입력(헤더만) | TRANSACTION | 0 | — | 사용 안 함 | 사용 안 함 | 아니오 |
| 출고관리대장 | 일자별 출고(소요) 계산 | CALCULATION | 273 | — | 사용 안 함 | 사용 안 함 | 아니오 |
| 출고예정소요량 | 수주 × 자재 소요 계산 | CALCULATION | 273 | 납기 머리글 2026-03-31 ~ 06-30 | Golden 회귀 자료 | 사용 안 함 | 아니오 |
| 재고관리대장 | 자재별 재고 현황 + 자재 목록 사본 | **CURRENT_STATE** | 273 | **작성일자 2024-01-05** | 식별 정보 교차검증만(수량 이관 안 함) | 사용 안 함 | 아니오 |
| 예상소요량(기간) | 기간별 예상 소요 계산 | CALCULATION | 273 | 2024-02-01 ~ 02-20 | 사용 안 함 | 사용 안 함 | 아니오 |
| 예상소요량(품목) | 품목별 예상 소요 계산 | CALCULATION | 273 | — | 사용 안 함 | 사용 안 함 | 아니오 |
| MRP작성 | MRP 계산 결과 | CALCULATION | 273 | 작성일자 2024-02-20 | Golden 회귀 자료 | 사용 안 함 | 아니오 |
| BOM작성 | BOM 편집 작업 영역(현재 편집 1개 제품) | REFERENCE_ONLY | 273 | — | 사용 안 함(저장 BOM 은 DB 시트) | 사용 안 함 | 아니오 |
| SETT | 프로그램 내부 설정(기간 선택값) | REFERENCE_ONLY | 23 | 2026-06-01 ~ 06-08 | 사용 안 함 | 사용 안 함 | 아니오 |
| Help | 사용 설명 | REFERENCE_ONLY | 20 | — | 사용 안 함 | 사용 안 함 | 아니오 |

**데이터가 서로 다른 시점에 만들어졌다**: 수주(2026-06) / 재고·MRP 결과(2024-01~02). 재고관리대장은 2년 이상 전 상태이므로 어떤 운영 정보도
신뢰할 수 없다 — 위 원칙이 옳다는 직접 근거다. 설정 시트의 V/W·M/N 열은 드롭다운/예시 목록이며 사용하지 않는다.

## 4. 검증 규칙

### Item (후보 = 설정 ∪ DB 제품 목록)
| 등급 | 조건 |
|---|---|
| SAFE | 코드/품명/규격 존재, 단위가 MES enum 과 **정확히** 일치, 코드 진단 없음, 중복·충돌 없음, 유형이 BOM 규칙으로 결정됨 |
| REVIEW | 품명/규격/단위 없음, 단위가 `"EA "`/소문자 등 정확히 일치하지 않음(제안만), BOM 줄 속성과 불일치, 코드 중복·근접 중복(대소문자/전각/공백), 숫자 셀 코드(선행 0 손실 위험), 앞뒤 공백/숨은 문자, 어떤 BOM 에도 안 쓰임(유형 불명), 수주/재고 시트에만 나타남 |
| REJECT | 코드 없음(품명으로 코드를 대체하지 않음) |

유형 규칙: 최상위 BOM 상위 = FINISHED / 상위이면서 구성품 = SEMI_FINISHED / 구성품으로만 = RAW_MATERIAL. 제안값은 `suggestions` 에만 두고 승인 전에는 쓰지 않는다.

### BOM (상위 제품 단위, 줄 단위 검증 후 BOM 전체 등급 = 가장 나쁜 줄)
- REJECT: 수량 `"."`/빈칸/0/음수/문자/숫자 문자열, 구성품 코드 없음, 구성품 Item 없음(Item 임의 생성 안 함), 자기 참조, 순환(Tarjan SCC).
  REJECT 줄이 하나라도 있으면 **BOM 전체를 가져오지 않는다**(부분 BOM 방지).
- REVIEW: 같은 BOM 에 같은 구성품 중복(줄 삭제/합산 안 함 — 합계 후보만 보고, 합산은 승인 필요).
- BOM 이 없는 제품은 BOM 후보를 만들지 않고 목록으로만 보고(자동 생성 금지).
- 의존성: 상위/구성품 Item 이 데이터셋에 포함되지 않으면 BOM 도 제외(droppedDependents).

### 거래처
- Excel 에 **코드·사업자번호·연락처가 없다**(이름만). 따라서 모든 거래처는 REVIEW(`PARTNER_CODE_MISSING`, 현재 거래 여부 불명).
- 고객 후보는 수주관리대장 고객명(운영 정보에서 유래), 공급업체 후보는 설정 시트의 거래처명.
- 법인 표기/공백만 다른 이름은 근접 중복으로 보고(자동 병합 안 함). 같은 이름이 양쪽이면 BOTH 후보(REVIEW, 이름만 같음).

### ItemSupplier
- 설정 시트의 자재별 거래처(1개)만 근거. `isDefault=false`, LT/MOQ/발주배수는 비움(추정 안 함). 거래처 코드 승인 전에는 REVIEW.

## 5. Dry-Run 결과 (2026-10-14 실행, workbook sha256 = b9726465…0f8e)

### Item 후보 439건
| | 건수 |
|---|---:|
| 설정(자재) | 273 |
| DB 제품 목록 | 163 |
| 수주관리대장에만 있는 제품 코드(운영 정보 유래) | 3 |
| **SAFE** | **262** (모두 RAW_MATERIAL) |
| REVIEW | 177 |
| REJECT | 0 |

- 유형: FINISHED 163, SEMI_FINISHED 0, RAW_MATERIAL 269, 유형 불명 7(미참조 자재 4 + 수주 전용 제품 3).
- FINISHED 163건은 **품명/규격/단위가 Excel 에 없어** 모두 REVIEW(제안: 품명=제품코드). 승인 방식은 §7.
- RAW 7건 REVIEW: BOM 줄의 규격/품명과 불일치 5, 단위 표기가 정확하지 않음("EA " 등) 2. 이들을 쓰는 BOM 은 30개.
- 같은 품명이 서로 다른 코드에 쓰인 그룹 8(16품목) — 품명으로 병합하지 않고 별개 품목으로 둔다(정보용).
- 코드 진단(공백/숨은 문자/전각/숫자 셀/대소문자 근접 중복): 0건. 설정↔재고관리대장 식별 정보 불일치: 0건.

### BOM
| | 건수 |
|---|---:|
| 상위 제품(Parent) | **163** |
| BOM 줄 | **1,312** (제품당 1~18줄) |
| 최대 깊이 | 2(제품 → 자재, 반제품 없음) |
| BOM SAFE / REVIEW / REJECT | 162 / 0 / 1 |
| 줄 SAFE / REJECT | 1,311 / 1 |
| 수량 오류(`"."`) | 1줄 (DB 시트 62번 제품 블록 11행) |
| 구성품 누락 / 자기 참조 / 순환 / 중복 구성품 | 0 / 0 / 0 / 0 |
| BOM 없는 제품 | 3 (수주관리대장에만 있는 제품) |

### 거래처 / ItemSupplier
- 후보 20: 고객 1, 공급업체 19, BOTH 0, 근접 중복 0. 전부 REVIEW(코드 없음, 최신성 불명). Excel 에는 사업자번호/연락처/주소가 **없다**.
- ItemSupplier 후보 272(품목 272 × 공급업체 19) — 전부 REVIEW, isDefault=false.

### 운영 DB(읽기 전용) 현황과 대조
Item 0 / BOM 0 / BusinessPartner 0 / ItemSupplier 0 / Routing 0 / Equipment 0 / InspectionSpec 0 (WorkCenter 5, Warehouse 3 은 기본 seed).
재고·수주·발주도 0. → 대조 결과 **전부 CREATE**, MATCH 0, CONFLICT 0, REJECT 1(BOM).

### 개발 seed 미리보기
| | 승인 없음(SAFE 만) | 일괄 정책 승인 시(미리보기) |
|---|---:|---:|
| Item | 262 (RAW) | 425 (RAW 262 + FINISHED 163) |
| BOM / 줄 | 0 / 0 (상위 제품이 승인 전) | 132 / 877 |
| 고객 / 공급업체 | 0 / 0 | 1 / 19 |
| ItemSupplier | 0 | 262 |
| **운영 정보 행**(재고/수주/발주/입출고/생산/WIP) | **0** | **0** |

일괄 정책 미리보기 = `{finishedUseCodeAsName, finishedDefaultUom:EA, allowMissingSpec, partnerCodeRule C###/S###, acceptItemSuppliersOfAcceptedPartners, acceptBomsWithoutRejectedLines}`.
132 이외의 30개 BOM 은 REVIEW 상태의 자재 7종을 쓰기 때문에 그 자재를 개별 결정해야 포함된다.

## 6. 승인 결정(Decisions)

REVIEW 항목은 사람이 `decisions.json` 으로 명시 승인해야 데이터셋에 들어간다.

- 개별: `items["코드"] = {accept:true, name?, spec?, uom?, itemType?}`, `boms["상위코드"]`, `partners["TYPE|이름"] = {accept:true, code}`, `itemSuppliers["품목|거래처"]`.
- 일괄(`bulk`): 사람이 한 번 정한 정책을 같은 종류의 REVIEW 에 적용 — 제품 품명=제품코드, 제품 기본 단위, 규격 없음 허용, 거래처 코드 규칙, ItemSupplier/BOM 일괄 포함.
- 승인해도 **재검증**한다(단위 enum, 필수 속성, 거래처 코드 중복). `accept=false`/없음 = 제외. REJECT 는 승인할 수 없다.
- `analyze` 가 `decisions.template.json`(REVIEW 항목 + 제안값, accept=false)을 만든다.

## 7. Seed 구조

| 역할 | 구현 | 상태 |
|---|---|---|
| seed:base (Tenant/관리자/Site/Warehouse/공통코드) | 기존 `prisma/seed-daewon.ts` (`npm run db:seed`) | 변경 없음 |
| seed:daewon-master (검증된 실제 Master) | `npm run seed:daewon-master -- --dataset <json> [--dry-run]` | **신규** |
| seed:demo (가상 운영 데이터) | 설계만 — §8 | 미구현 |

`seed:daewon-master` 가드(`seed-guard.ts`): `MASTER_SEED_CONFIRM=DEV_ONLY`, 대상 DB 는 별도 변수 `MASTER_SEED_DATABASE_URL`,
그 호스트가 `DATABASE_URL`/`DIRECT_URL` 과 같으면 거부, Vercel / NODE_ENV=production 에서 거부. `prisma db seed` 에는 연결하지 않았다.
Vercel 빌드(`prisma generate && next build`)는 seed/import/migrate 를 실행하지 않는다.

## 8. seed:demo 설계(미구현)

실제 Master(Item/BOM/거래처)만 참조해 **명백한 가상** 운영 데이터를 만든다: `SO-DEMO-###`(오늘 + 7일, 100EA), 재고 50EA, `PO-DEMO-###` 구매발주 30EA 등.
번호에 DEMO/TEST 를 넣어 운영 데이터와 구분하고, 과거 실제 수주를 날짜만 바꿔 복제하지 않는다. 운영 DB 에는 실행 금지(같은 가드).

## 9. 운영 Master import 절차 (Phase 7B — 승인 후)

1. `master:analyze` 로 최신 Excel + 운영 현황(`master:export-existing`, SELECT 전용)을 대조한 Dry-Run 보고서 작성.
2. 사용자가 REVIEW 항목(제품 품명/단위 정책, 거래처 코드/활성 여부, 7종 자재, BOM 0 인 제품)을 결정 → `decisions.json`.
3. `Approved Master Dataset`(sha256) 생성 → 사용자가 건수/미리보기 확인·승인.
4. 운영 import: 승인된 dataset 만 입력, CONFLICT 는 ABORT, 단일 트랜잭션, AuditLog 기록(7B 에서 추가).
5. 사후 검증: 건수/MATCH 재실행(두 번째 실행은 전부 MATCH) / 운영 정보 행 0 확인.

## 10. 개인정보 / Git

- `.master-migration-out/`, `master-data-out/` 는 gitignore. 상세 산출물(실제 품번/거래처명/provenance)은 저장소 밖(`--out`)에 둔다.
- 테스트 fixture 는 익명 합성 데이터만(실제 Excel 은 Git 에 없음).
- `docs/DAEWON-MRP-GAP-ANALYSIS.md`(고객 데이터)는 계속 untracked.

## 11. 테스트

`npm run test:master-migration` — MD1~MD25(Item/BOM/거래처/대조/운영 정보 제외/seed 멱등) + 승인 결정 + 해시 변조 + seed 가드 + 정적 점검(147 checks).
MRP 엔진·Golden 은 변경하지 않는다.

## 12. 남은 일 (Phase 7B 이후)

- 운영 import CLI(승인 UI/AuditLog 포함), Process/Routing/Equipment/Inspection Master(별도 자료 확보 필요, 이번 Excel 에는 없음)
- 거래처 사업자번호/연락처(별도 자료), 품목 기본 창고/LOT 추적 정책, 제품 품명/규격 확보
- 기초재고: Excel 수량을 이관하지 않고 Go-Live 시점의 **실사 후 등록**
