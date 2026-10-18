# DAEWON-MES Phase 9 — 전체 기능 Final GAP Audit / Go-Live Readiness

> **성격**: ANALYSIS / AUDIT ONLY. 기능 개발·버그 수정·리팩터링·스키마/마이그레이션 변경·Production write·배포 유도 **모두 수행하지 않았다.**
> **작성 기준일**: 2026-10-14 · **기준 commit**: `5d7b74cc48b23b799b29bb009ff6412df87050e6` (`main` = `origin/main`)
> **산출물**: 이 문서 1개(`docs/DAEWON-PHASE9-FINAL-GAP-AUDIT.md`) — commit/push 하지 않음, 사용자 승인 후 진행.

---

## A. Executive Summary

### A-1. 한 줄 결론

**Go-Live 판정: NOT READY.** MRP 는 승인 상태이나, MRP 앞/뒤(수주 → … → 출하)의 *코드 경로는 대부분 연결되어 있음에도* ① 운영 DB 의 품목 LOT 정책·생산 기준정보가 비어 있어 가동 즉시 막히는 구간(P0 2건)이 있고, ② 사업계획서가 약속한 LOT 단위 바코드/스캔·역추적·수주 확장 필드·계측기 검교정·설비 에이전트가 미구현이며, ③ 읽기 서버 액션 다수가 비인증이다.

### A-2. 숫자

| 항목 | 값 |
|---|---|
| 사업계획서 요구사항(ID 부여) | **80건** (분모 75건 = NOT_REQUIRED 5건 제외) |
| Fully Implemented | **42건 (56.0%)** |
| Partial | **21건 (28.0%)** |
| Missing (MISSING+BUG) | **2건 (2.7%)** |
| Field Test / Ops Confirm Required | **10건 (13.3%)** |
| GAP 총계 | **47건** |
| P0 / P1 / P2 / P3 / INFO | **2 / 16 / 19 / 6 / 4** |
| 상태 FIELD_TEST_REQUIRED GAP | 3건 (+ 요구사항 중 현장 시험 대상 10건) |
| 상태 OPS_CONFIRM_REQUIRED GAP | 2건 |
| Go-Live Blocker 'Y' | 15건 (조건부 항목 별도) |
| Production write (이번 감사) | **0** (READ ONLY 트랜잭션, `transaction_read_only=on` 확인) |

> **완성도 해석**: 화면/액션 존재 기준 *구현 56.0%* 이지만, **E2E 가 현재 운영 설정으로 끝까지 흐르지 못한다**(E2E 7개 시나리오 중 PASS 1 · PARTIAL 4 · FAIL 1 · FIELD_TEST 1). 기능 수보다 *설정·데이터·정합성·보안* 이 Go-Live 를 막는다.

### A-3. 가장 큰 Risk 10개

| # | Risk | GAP |
|---|---|---|
| 1 | **품목 LOT 정책 미설정** — 427건 전부 `isLotTracked=false`. 완제품 입고 후 *출하 불가*, 원자재 LOT 추적 비활성 | DG-001 |
| 2 | **생산 기준정보 미적재** — 라우팅·설비·검사표준 0건 → 작업지시 생성 자체 불가 | DG-002 |
| 3 | **비인증 읽기 서버 액션 104개** + 미인증 시 기본 테넌트 폴백, 일부는 tenant 필터조차 없음 | DG-013 |
| 4 | **LOT 역/정방향 추적 단절** — 완제품 LOT → 원자재 LOT/공급사, 원자재 LOT → 출하/고객 미연결 | DG-006/007 |
| 5 | **바코드/스캔이 LOT 미포함 + 카메라 스캔 없음** — '촬영·인식'(갤럭시탭) 약속 불충족 | DG-004/005 |
| 6 | **수주 조선기자재 확장 필드(호선·블록·도면·선급·고객PO·인수부서) 미구현** | DG-008 |
| 7 | **설비 연동 에이전트(FOCAS/NCWatch) 미개발** — 사업 KPI(비가동 계측) 근거 부재 | DG-010 |
| 8 | **기초재고·Open SO/PO 이관 기능 없음** — 가동 시점 데이터 적재 불가 | DG-012 |
| 9 | **KPI 정의·접근 문제** — 개발자 전용, PPM·납기준수율 미산출, 불량률 정의 5종 | DG-011 |
| 10 | **계측기 검교정관리 미구현**(사업계획서 '신규') | DG-009 |

그 외 P1: 자재출고 서버 검증 누락(DG-014), 재작업 종결 개발자 전용(DG-015), 불량 원인·조치 화면 숨김(DG-016), 운영 계정(test/dev-pop/공통 admin, DG-017), 백업·자격증명·WAF 확인(DG-018).

### A-4. 다행인 점 (강점)

- 수량 정합 로직은 견고하다: 입고·출고·완제품입고·출하·실적 모두 **단일 트랜잭션 + row lock + 조건부 update(`gte`)** 로 구현(`receiving/material-issue/finished-goods/shipment/pop.actions.ts`).
- 출하는 PLANNED(예약)→SHIPPED(확정) 2단계, LOT 단위 예약·품질 게이트·수주 `shippedQty`/상태 전이까지 연결(부분출하 지원).
- 외주: 발주→WIP 출고→입고→검사(합격/불량/재외주 분리)가 WIP 이동 이력과 함께 구현.
- DB 보안: RLS **115/115**, 마이그레이션 5건 적용, 트랜잭션 데이터 0(Production READ ONLY 재확인).
- MRP Phase 1~8 승인 상태(재검증 제외).

---

## B. Baseline

| 항목 | 값 |
|---|---|
| Commit | `5d7b74cc48b23b799b29bb009ff6412df87050e6` — "test: finalize Daewon MRP Excel reconciliation" |
| Branch | `main` (`origin/main` 와 ahead 0 / behind 0, `git ls-remote` 일치) |
| Working tree | 추적 변경 없음. 미추적: `docs/DAEWON-MRP-GAP-ANALYSIS.md` (+ 이번 산출물 1개) |
| 코드 규모 | src ts/tsx 693개 · 페이지 125개 · `'use server'` 파일 82개(export 520) · 추적 파일 861 · 커밋 19 |
| Schema | `prisma/schema.prisma` 3,737줄 · **114 model / 76 enum** · Production public 테이블 115개(=114+`_prisma_migrations`) |
| Migration | 5건 모두 `finished`(rolled_back 없음): `20261013000000_daewon_initial_baseline` · `…000100_supabase_public_hardening` · `20261014000000_add_item_supplier` · `…010000_add_item_safety_stock` · `…020000_add_mrp_run_history` |
| RLS | public 115 / 115 활성 |
| DB | PostgreSQL 17.11 (Supabase, ap-northeast-2) |
| Production Master | Item **427** (FINISHED 163 / RAW 264) · BOM **134** · BOMItem **909** · BusinessPartner 20 (Customer 1 / Supplier **19**) · ItemSupplier **264** |
| Production 기타 마스터 | Tenant 1 · Site 1 · Warehouse 3 · Location 3 · WorkCenter 5 · DefectCode 5 · CommonCode 17 · RolePermission 639 · FeatureDefinition 28 / TenantFeature 26 · Profile/TenantUser/UserCredential 각 3 |
| Production Transaction | **전부 0** — Lot·InventoryBalance·InventoryTransaction·SalesOrder·PurchaseOrder·WorkOrder·ProductionResult·WipUnit·ShipmentOrder·QualityInspection·MrpRun 등 92개 테이블 0행(AuditLog 1행 = MasterImport) |
| MRP | Phase 1~8 COMPLETE · Golden A/B mismatch 0 · Legacy Excel Retirement APPROVED (재검증 제외) |
| 배포 | Production 최신 배포 `1683f17`(success). **HEAD `5d7b74c` 배포 기록 없음** — 변경은 scripts/docs/CLI 라이브러리뿐(DG-044) |
| CI | GitHub Actions 0 · main 보호 없음 |

> **Master baseline hash** (`f435535b…8c10b2`) 는 이번에 재계산하지 않았다. 단 DG-001(품목 LOT 정책 갱신)을 수행하면 Item 행이 바뀌므로 **hash 가 달라진다** — 갱신 전 baseline 재정의 절차가 필요하다.

---

## C. Business Plan Coverage (사업계획서 ↔ 코드 1:1)

**기준 문서**: `2026_사업계획서_상생형_대원정밀_v10.docx`(2026-07-31, 최종 제출본 `v10_최종_보완.pdf` 와 동일 계열) + `애플리케이션_기능_구성.docx` + `현장평가 대응 준비자료.docx`.
구판 PDF(`정부일반형…최종(보완수정완료).pdf`)는 한글 폰트 임베딩 문제로 텍스트 추출이 불가했고 OPC-UA/ZEISS 등 구형 내용이 섞여 있어 **v10 을 기준**으로 삼았다(DG-046).

### C-1. 커버리지

| 구분 | 건수 | 비율(분모 75) |
|---|---|---|
| Fully Implemented | 42 | 56.0% |
| Partial | 21 | 28.0% |
| Missing (MISSING+BUG) | 2 | 2.7% |
| Field Test / Ops Confirm Required | 10 | 13.3% |
| (제외) NOT_REQUIRED | 5 | — |

> **판정 규칙**: 화면/테이블/액션 존재만으로 IMPLEMENTED 로 올리지 않았다. UI → Action → DB → 상태전이 → 타 모듈 연결까지 확인된 것만 IMPLEMENTED, 코드는 있으나 Production 설정/데이터 때문에 막히는 것은 별도 GAP(DG-001/002)로 분리하고 요구사항은 코드 기준으로 판정했다.

### C-2. 요구사항 1:1 표

| ID | 모듈 | 요구사항 | 판정 | 근거 / 비고 |
|---|---|---|---|---|
| BP-MASTER-001 | 기준정보 | 고객사관리 | **IMPLEMENTED** | `/app/mes/customers` · BusinessPartner(CUSTOMER) · Excel 업/다운로드(`business-partner-excel.actions.ts`, 최대 1,000행·단일 트랜잭션) · 삭제 참조검사. Production: 고객 1건 |
| BP-MASTER-002 | 기준정보 | 거래처관리 (품목별 단가 연계) | **IMPLEMENTED** | `/app/mes/vendors` · ItemSupplier 264건(단가·MOQ·리드타임) · PO 생성 시 단가 연계. Production: 공급사 19건 |
| BP-MASTER-003 | 기준정보 | 설비관리 | **IMPLEMENTED** | `/app/mes/master/equipment` — 화면/CRUD 구현. Production Equipment=0 (DG-002) |
| BP-MASTER-004 | 기준정보 | 공정관리 | **IMPLEMENTED** | `/app/mes/work-centers` · Excel. Production WorkCenter=5(가공·검사·세척·포장·완제품입고) — 후공정 미등록 (DG-002) |
| BP-MASTER-005 | 기준정보 | 라우팅관리 | **IMPLEMENTED** | `/app/mes/routing` · Excel. Production Routing=0 (DG-002) |
| BP-MASTER-006 | 기준정보 | 사용자관리 (가입승인) | **IMPLEMENTED** | `/app/mes/users` · `signup-request` · RolePermission 639행 · 로그인 이력/잠금 |
| BP-MASTER-007 | 기준정보 | 사업장관리 | **IMPLEMENTED** | `/app/mes/sites` · Site 1건(FAC-01) |
| BP-MASTER-008 | 기준정보 | 로케이션관리 | **IMPLEMENTED** | `/app/mes/locations` · Warehouse 3 / Location 3 |
| BP-MASTER-009 | 기준정보 | 품목관리 | **IMPLEMENTED** | `/app/mes/items` · Item 427건. ⚠ LOT 정책 기본값(DG-001), 엑셀은 신규등록 전용(일괄수정 없음) |
| BP-MASTER-010 | 기준정보 | BOM관리 (다단계) | **IMPLEMENTED** | `/app/mes/bom` · BOM 134/BOMItem 909(구성품 100% RAW_MATERIAL). FINISHED 29건 BOM 없음 |
| BP-MASTER-011 | 기준정보 | 검사표준관리 | **IMPLEMENTED** | `/app/mes/master/inspection-standards` · `/app/mes/measurement`. Production InspectionSpec=0 (DG-002) |
| BP-SALES-001 | 수주납품 | 수주등록 (조선기자재 확장 필드) | **PARTIAL** | 기본 수주 CRUD 구현. 호선번호·블록번호·도면번호·선급검사기관·고객발주번호·인수부서 필드 없음 (DG-008) |
| BP-SALES-002 | 수주납품 | 수주현황 (호선/블록/선급 필터) | **PARTIAL** | 수주 대비 출하/잔량 조회 구현. 확장 필드 기준 필터 없음 (DG-008) |
| BP-SALES-003 | 수주납품 | 납품정보등록 (재고 자동 차감) | **IMPLEMENTED** | `createShipment`(PLANNED 예약)→`confirmShipment`(재고 차감·shippedQty·수주 상태). ⚠ 전제: 품목 isLotTracked=true (DG-001) |
| BP-SALES-004 | 수주납품 | 납품현황 | **IMPLEMENTED** | `getDeliveryStatusRows` · `/app/mes/sales/delivery-status` |
| BP-MAT-001 | 자재 | 자재발주현황 (MRP→발주 연계) | **IMPLEMENTED** | PO CRUD · MRP 제안→DRAFT PO 전환(`mrp-purchase-suggestion`) |
| BP-MAT-002 | 자재 | 자재입고현황 (검사·LOT 자동채번·재고반영) | **PARTIAL** | 입고검사 합/불·재고 반영·부분입고 구현. LOT 자동채번은 차단(DG-003), 검사결과↔LOT 미연결(DG-019) |
| BP-MAT-003 | 자재 | 자재출고현황 (다중 LOT 분할출고) | **PARTIAL** | 다중 LOT·WorkOrderMaterialLot·WipUnitMaterialLot 구현. 서버 검증 누락(DG-014) |
| BP-MAT-004 | 자재 | 자재재고현황 (실사조정·감사로그) | **PARTIAL** | 조회·실사조정(MANAGER)·감사로그 구현. 기초재고 입력 기능 없음(DG-012) |
| BP-MAT-005 | 자재 | 자재소요량계획(MRP) | **IMPLEMENTED** | MRP Phase 1~8 완료 — 재검증 제외(요청 11절) |
| BP-INV-001 | 재고 | 재고현황 | **IMPLEMENTED** | `/app/mes/inventory` — InventoryBalance(qtyOnHand/Available/Hold) |
| BP-INV-002 | 재고 | 전체입출고내역 | **IMPLEMENTED** | `/app/mes/inventory-transactions` — InventoryTransaction(RECEIPT/ISSUE/ADJUST…) |
| BP-INV-003 | 재고 | 재공품재고 | **IMPLEMENTED** | `/app/mes/production/wip-inventory` — WipUnit/WipMovement 기반 |
| BP-PROD-001 | 생산 | 생산계획관리 | **IMPLEMENTED** | `/app/mes/production-plan` · 수주→계획 생성(`requestProductionFromSalesOrder`) |
| BP-PROD-002 | 생산 | 작업지시 (BOM·라우팅·설비배정) | **IMPLEMENTED** | `createWorkOrder`/`releaseWorkOrder`. ⚠ 제조번호 자동채번 차단 → 수동 입력 필수(DG-003) |
| BP-PROD-003 | 생산 | 작업일지(실적) | **IMPLEMENTED** | `/app/mes/production-results` — ProductionResult 조회 |
| BP-PROD-004 | 생산 | 완제품입고 (LOT/제조이력 자동 연결) | **PARTIAL** | WO COMPLETED만 입고·LOT=제조번호 기반 생성·재고 반영. RAW→FG 계보 미생성(DG-006)·라벨에 LOT 없음(DG-004) |
| BP-PROD-005 | 생산 | 외주관리 (WIP 출고·입고·검사) | **IMPLEMENTED** | 발주→WIP 외주출고→외주입고→검사(합격/불량/재외주 분리) 구현. 후속 공정 연결은 수동 단계(DG-036) |
| BP-QUAL-001 | 품질 | 불량통계(자주검사) | **IMPLEMENTED** | `/app/mes/quality/defect-stats`. 분모 정의 불일치(DG-011) |
| BP-QUAL-002 | 품질 | 초중종검사 LIST | **IMPLEMENTED** | `/app/mes/inspection-stages` · `/app/mes/final-inspection` · 출하/입고 품질 게이트 |
| BP-QUAL-003 | 품질 | 작업표준서관리 | **IMPLEMENTED** | `/app/mes/quality/work-standards` · private 버킷 + signed URL(POP 4h) |
| BP-QUAL-004 | 품질 | 변경관리(ECN) | **IMPLEMENTED** | `/app/mes/ecn` |
| BP-QUAL-005 | 품질 | 계측기검교정관리 (신규) | **MISSING** | 메뉴 '준비중'(`nav-config.ts:121`)만 존재 — 모델/화면/액션 없음 (DG-009) |
| BP-LOT-001 | 이력 | LOT관리 (상태 변경, 삭제 없음) | **IMPLEMENTED** | `/app/mes/lot` · ACTIVE/QUARANTINE/ON_HOLD/CONSUMED/EXPIRED. 상태변경 감사로그 없음(DG-030/042) |
| BP-LOT-002 | 이력 | LOT/제조이력추적 (정·역방향) | **PARTIAL** | `/app/mes/traceability` 단일 화면. 정방향 PARTIAL·역방향 BROKEN (DG-006/007). `/trace-reverse`·`/lot-history` 는 '준비 중' 스텁 |
| BP-MON-001 | 모니터링 | 현황모니터링 (PLC 연동) | **FIELD_TEST_REQUIRED** | UI·ingest API 3종 구현. 수집 에이전트 미개발·현장 미연결(DG-010/037) |
| BP-MON-002 | 모니터링 | 분석모니터링 (가동률·알람·타임라인) | **FIELD_TEST_REQUIRED** | `/app/mes/equipment-monitor` 오늘/7일/이번 달 + 타임라인 구현. 데이터 없음 |
| BP-POP-001 | POP | 작업자 로그인 (4자리 PIN, 10h 세션) | **IMPLEMENTED** | `popLogin` · fingerprint+bcrypt · IP 10분 30회 제한. PIN 4자리 한계 (DG-017 계정) |
| BP-POP-002 | POP | 작업대기 조회 (자재출고 여부) | **IMPLEMENTED** | `getPopWorkQueueRows` — materialIssuanceReady 표시 |
| BP-POP-003 | POP | 공정상세/실적이력 조회 | **IMPLEMENTED** | `getOperationDetail` — 설비배정·불량코드·WIP·최근 실적·작업표준서 |
| BP-POP-004 | POP | 작업 시작 처리 | **IMPLEMENTED** | `startOperation` — 공정/배정 상태·WIP 상태 전환 |
| BP-POP-005 | POP | 생산실적 등록 (양/불/재작업·자주검사 연동) | **PARTIAL** | 단일 트랜잭션 구현. 불량 입력은 검사표준 필수(DG-031), 재작업 종결은 개발자 전용(DG-015) |
| BP-POP-006 | POP | 당일 생산실적 조회 | **IMPLEMENTED** | `getTodayProductionResults` → `/pop/production` |
| BP-POP-007 | POP | 생산실적정보 (논리파일) | **IMPLEMENTED** | ProductionResult(operatorId·assignment→equipment·시간) |
| BP-TOBE-001 | TO-BE | 수주·납기 변경이력 통합 관리 | **IMPLEMENTED** | SalesOrder 감사로그 6건 지점 + `/app/mes/audit-log` |
| BP-TOBE-002 | TO-BE | 원자재 입고 시 LOT별 바코드 발행 | **PARTIAL** | 라벨 출력 구현, 바코드에 LOT 미인코딩(DG-004) |
| BP-TOBE-003 | TO-BE | 투입 시 바코드 스캔→재고 차감·사용 LOT↔작업지시 연결 | **PARTIAL** | 스캔은 품목 행 강조만, LOT은 드롭다운 선택(DG-004/005) |
| BP-TOBE-004 | TO-BE | CNC 키오스크: 작업지시·도면·작업기준 전산 제공 | **PARTIAL** | 작업표준서 PDF ✓, 도면 별도 제공 ✗ |
| BP-TOBE-005 | TO-BE | 작업 시작·종료·양/불·비가동 사유 현장 입력 | **PARTIAL** | 비가동 사유 입력 없음(DG-023) |
| BP-TOBE-006 | TO-BE | 주력 CNC 4대 가동·생산·알람 자동 수집 | **FIELD_TEST_REQUIRED** | 서버 ingest ✓ / 에이전트·현장 연결 ✗(DG-010/037) |
| BP-TOBE-007 | TO-BE | 미연동 설비는 작업자 입력 운영 | **IMPLEMENTED** | POP 실적 입력 |
| BP-TOBE-008 | TO-BE | 검사기준 등록 + 작업지시·품목·LOT별 검사결과 통합 | **IMPLEMENTED** | InspectionSpec/Item/Measurement + QualityInspection(lotId 선택) |
| BP-TOBE-009 | TO-BE | 스마트패드 외관·치수·유압 테스트 결과 현장 등록 | **PARTIAL** | 측정 입력은 관리자 웹, 유압 전용 입력 없음(DG-025/035) |
| BP-TOBE-010 | TO-BE | 불량 유형·원인·조치·재검사 이력화 | **PARTIAL** | 코드 구현, 화면/액션 범위 밖 숨김(DG-016) |
| BP-TOBE-011 | TO-BE | 외주 출고~재입고 진행상태 조회 | **IMPLEMENTED** | `/app/mes/production/outsourcing` |
| BP-TOBE-012 | TO-BE | 후공정(도장·용접/조립·유압·세척·포장) 실적·재공 관리 | **PARTIAL** | 기능 구현, 후공정 공정 마스터 미등록(DG-002) |
| BP-TOBE-013 | TO-BE | 완제품 입고 시 품목·LOT·수량 바코드 발행 | **PARTIAL** | 라벨은 itemCode만 인코딩(DG-004) |
| BP-TOBE-014 | TO-BE | 출하 시 바코드 스캔→자동 차감·고객/품목/LOT/출하일 기록 | **PARTIAL** | 차감·기록 ✓, 스캔은 품목 단위(DG-004) |
| BP-TOBE-015 | TO-BE | 현황판+대시보드: 작업지시·실적·재공·불량·설비·납기 통합 | **PARTIAL** | /kiosk 는 설비+KPI 4종뿐, 재공·납기·계획대비 없음(DG-024) |
| BP-TOBE-016 | TO-BE | 지연·비가동·품질이상 알림 + 조치결과 기록 | **MISSING** | 대시보드 이상 표시/조치 기록 기능 없음 |
| BP-TOBE-017 | TO-BE | 작업자 모바일 즉시 알람(push/SMS) | **NOT_REQUIRED** | 사업계획서가 '사업 이후 고도화'로 명시 |
| BP-TOBE-018 | TO-BE | MRP 결과→발주 반자동 전환 | **IMPLEMENTED** | MRP 제안→DRAFT PO(담당자 확인 후 ORDERED) |
| BP-TOBE-019 | TO-BE | FOCAS 에이전트 → REST 3종(heartbeat·status·report-daily) | **PARTIAL** | 서버 3종 ✓(X-Agent-Key), 에이전트 ✗(DG-010) |
| BP-TOBE-020 | TO-BE | DataTag/TagCurrentValue/TagSnapshot 확장 태그 수집 | **IMPLEMENTED** | 모델·액션 구현(개발자 전용 설정 화면) |
| BP-TOBE-021 | TO-BE | POP 착수 조건(자재출고 완료) 확인 | **IMPLEMENTED** | `assertOperationResultAllowed` materialIssuanceReady |
| BP-TOBE-022 | TO-BE | 실적·작업지시·설비배정·재공·품질 단일 트랜잭션 | **IMPLEMENTED** | `submitProductionResult` 단일 `$transaction` + FOR UPDATE |
| BP-TOBE-023 | TO-BE | 단일 PostgreSQL 통합(약 86개 모델) | **IMPLEMENTED** | 실제 114 모델/76 enum (문서 수치 정정 필요 — DG-046) |
| BP-KPI-001 | KPI | 시간당 생산량 (39→44개) | **PARTIAL** | UPH 산출 존재하나 정의가 계획서(명목 176h)와 다르고 개발자 전용(DG-011) |
| BP-KPI-002 | KPI | 공정 불량률 (2,897→2,752 PPM) | **PARTIAL** | PPM 미산출·분모 불일치·개발자 전용(DG-011) |
| BP-HW-001 | H/W | 산업용 키오스크 2대 (MCT·CNC POP) | **FIELD_TEST_REQUIRED** | /pop/work-select (PIN) — 현장 설치·터치 시험 필요 |
| BP-HW-002 | H/W | 산업용 스마트패드 4대 (측정·창고·프레스·도장) | **FIELD_TEST_REQUIRED** | POP + 관리자 웹 화면. 카메라 스캔 미구현(DG-005) |
| BP-HW-003 | H/W | 바코드프린터 2대 (Brother QL-820NWB) | **FIELD_TEST_REQUIRED** | 브라우저 인쇄 기반 SOFTWARE 준비, 실장비 시험 없음(DG-034) |
| BP-HW-004 | H/W | 현황판 1대 (65") | **FIELD_TEST_REQUIRED** | /kiosk 30초 폴링 — 전체화면/상시 구동 시험 필요 |
| BP-HW-005 | H/W | 설비데이터 처리용 PC 1대 (FOCAS 허브) | **FIELD_TEST_REQUIRED** | 에이전트 SW 미개발(DG-010) |
| BP-NW-001 | N/W | 설비 신호취득/현장배선 4식 | **FIELD_TEST_REQUIRED** | 현장 공사 항목 — 코드 범위 아님(DG-037) |
| BP-NW-002 | N/W | 무선 AP·현장 단말 N/W 공사 | **FIELD_TEST_REQUIRED** | 현장 공사 항목 |
| BP-INNOV-001 | 혁신활동 | 원자재 보관 5S3정(랙·구획·라벨 위치) | **NOT_REQUIRED** | 물리 현장 활동 — MES 범위 밖(LOT 라벨 부착 위치 지정만 MES 연계) |
| BP-INNOV-002 | 혁신활동 | 공구·치공구 보관 5S3정 | **NOT_REQUIRED** | 물리 현장 활동 — MES 범위 밖 |
| BP-FUT-001 | 고도화 | 전 설비 연동·SPC·push 알림 (고도화1) | **NOT_REQUIRED** | 사업 종료 후 단계 |
| BP-FUT-002 | 고도화 | AI 수요예측·예지보전·품질원인분석 (고도화2) | **NOT_REQUIRED** | 중장기 단계 |

---

## D. Module Audit

> 범례: ✅ 연결 확인 · ⚠ 부분/조건부 · ❌ 단절/미구현 · 🔧 현장 시험 필요

### D-1. Master (기준정보)
- ✅ 고객·거래처(`BusinessPartner`, 단일 모델 CUSTOMER/SUPPLIER/BOTH) · 사업장·로케이션(Warehouse/Location) · 공정(WorkCenter) · 라우팅 · 설비 · 품목 · BOM · 검사표준 CRUD + 삭제 참조검사(`reference-check.server.ts`).
- ✅ Excel 업로드: 품목/BOM/거래처/라우팅/공정(미리보기·서버 재검증·오류행 리포트·감사 1건, 최대 1,000행). 권한은 해당 리소스 CREATE 로 강화됨.
- ⚠ 품목 일괄 *수정* 수단 없음(엑셀은 중복 코드 거부) — LOT 정책 427건 수정 불가(DG-001).
- ❌ Production: Routing 0 · Equipment 0 · InspectionSpec 0 · 후공정 공정 미등록 · FINISHED 29건 BOM 없음(DG-002).
- Tenant/Site isolation: 쓰기 액션은 대체로 `user.tenantId` 사용, 읽기 일부는 DG-013.

### D-2. Sales (수주·납품)
- ✅ 수주 CRUD·수주번호 채번·고객/납기·상태 전이(DRAFT→CONFIRMED→IN_PRODUCTION→PARTIAL_SHIPPED→SHIPPED) · 생산요청(`requestProductionFromSalesOrder`: 수주→계획→상태 IN_PRODUCTION).
- ✅ 출하 2단계(`createShipment` PLANNED → `confirmShipment`), LOT 단위 예약 합산·품질 게이트(`assertLotQualityReleaseAllowed`), `shippedQty` 증가·수주 상태 재계산, PLANNED 삭제 가능.
- ❌ 호선/블록/도면/선급/고객PO/인수부서 필드(DG-008).
- ⚠ `SalesOrderItem.producedQty` 는 어떤 코드도 기록하지 않음(수주 상세는 별도 진행 서비스로 계산) — STALE(DG-040).
- ⚠ 완제품입고는 WO COMPLETED 후에만 가능 → 수주 전체 분할 납품은 '작업지시 분할' 운영 전제(DG-022).

### D-3. Purchasing (발주)
- ✅ MRP → DRAFT 발주 → (화면에서 상태를 '발주완료'로 변경) → 입고 → PARTIAL_RECEIVED/RECEIVED → 잔량 종결(`closePurchaseOrderRemainder`).
- ⚠ 발주 상태가 자유 입력(상태머신 없음), FK 소유 미검증(DG-021).
- ⚠ 발주서 출력/전송 기능 없음(사업계획서 범위 밖으로 판단).

### D-4. Material (입고·출고)
- ✅ 입고: 창고-사이트 일치·잔량 검증·합/불 수량 검증·LOT 예약/채번 원장·재고/수불/감사 단일 트랜잭션.
- ⚠ LOT 자동채번 차단 → 공급사 LOT 수동 입력만 가능(DG-003). 입고검사 결과가 LOT 와 FK 로 연결되지 않음(DG-019).
- ✅ 출고: 다중 LOT 분할·중복 LOT 차단·가용재고 조건부 차감·WorkOrderMaterialLot/WipUnitMaterialLot 연결·WIP 지연 생성.
- ❌ 서버 검증 누락(BOM 구성품/작업지시 상태/잔량/Lot.status/reservation 소유, DG-014), 취소·정정 없음(DG-020).

### D-5. Inventory
- ✅ `InventoryBalance(onHand/available/hold)` · `InventoryTransaction(RECEIPT/ISSUE/ADJUST/RETURN/SCRAP/SUPPLIER_RETURN)` · 실사조정(MANAGER+사유+감사).
- **재고 항등식**(기초 + 입고 + 완제품입고 ± 조정 − 불출 − 출하 = 현재고): 각 이동이 *동일 트랜잭션에서 balance 와 tx 를 같이 갱신*하므로 구조상 성립(입고 `RECEIPT` / 출고 `ISSUE(WORK_ORDER)` / 완제품 `RECEIPT(WORK_ORDER)` / 출하 `ISSUE(SHIPMENT_ITEM)` / 조정 `ADJUST`). 단 **기초재고 항(OPENING)을 넣는 경로가 없다**(DG-012).
- ⚠ 완제품입고는 항상 LOT 키 balance, 출하(비LOT 품목)는 lotId=null balance 조회 → 품목 설정에 따라 불일치(DG-001).

### D-6. Production (계획·작업지시·실적·완제품)
- ✅ 계획(수주 기반·확정/취소/상태 동기화) · 작업지시(라우팅 검증·설비배정 검증·계획 수량 상한·릴리즈) · 완제품입고(WIP COMPLETED root·pendingQty 서버 재계산·품질 게이트·LOT 생성).
- ✅ 전체 흐름 코드 추적: 계획 → 작업지시 → 공정/설비배정 → (자재출고로 WIP 생성) → POP → 실적 → WIP 이동 → 최종공정 → 완제품입고. **수동 DB 수정이 필요한 구간은 코드상 없음**(단, 데이터 전제: DG-001/002/003).
- ⚠ 후속 공정은 선행 공정 COMPLETED 후에만 착수(공정 간 부분 이관 불가, DG-022).

### D-7. POP
(요청 F절 20개 항목 판정)

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| 1 | 작업자 PIN 로그인 | IMPLEMENTED | `popLogin` — fingerprint 조회 + bcrypt, IP 10분 30회 제한 |
| 2 | 현장 단말 전용 인증 | IMPLEMENTED | 별도 세션 쿠키(10h), 사업장(site) 일치 검증 |
| 3 | 작업대기 조회 | IMPLEMENTED | `getPopWorkQueueRows`(세션 tenant 일치) |
| 4 | 작업지시/공정 조회 | IMPLEMENTED | `getOperationDetail` |
| 5 | 자재출고 완료 여부 | IMPLEMENTED | materialIssuanceReady (루트 WIP 존재) |
| 6 | 설비 배정 | IMPLEMENTED | assignment 별 시작/실적 |
| 7 | 투입 가능 WIP | IMPLEMENTED | 전공정 양품 기준 availableInput 계산 |
| 8 | 최근 실적 | IMPLEMENTED | productionResults 목록 |
| 9 | 작업 시작 | IMPLEMENTED | `startOperation` |
| 10 | 작업 중 상태 | IMPLEMENTED | op/assignment IN_PROGRESS |
| 11 | 양품 등록 | IMPLEMENTED | 정수 BigInt 스케일 검증 |
| 12 | 불량 등록 | PARTIAL | 불량코드 합계 일치 필수, **검사표준 없으면 실패**(DG-031) |
| 13 | 재작업 등록 | PARTIAL | 입력은 되나 **종결은 개발자 전용**(DG-015) |
| 14 | 불량코드 | IMPLEMENTED | Production DefectCode 5건 |
| 15 | 실적 저장 | IMPLEMENTED | 단일 트랜잭션 + FOR UPDATE |
| 16 | 공정 완료 판단 | IMPLEMENTED | 계획수량 도달 or WIP 소진 |
| 17 | 다음 공정 WIP | IMPLEMENTED | `advanceWipUnitOnOperationComplete` |
| 18 | 자주검사 연동 | PARTIAL | 불량 건만 QualityInspection(FAIL) 생성 — 양품은 검사 미생성 |
| 19 | 당일 생산실적 조회 | IMPLEMENTED | `/pop/production` |
| 20 | 현장 작업 종료 흐름 | FIELD_TEST_REQUIRED | 터치 UI(h-14~16)·넘버패드 있음, 오프라인/전체화면/세션만료 처리 없음 |

### D-8. Quality
- ✅ 검사표준·측정값(스냅샷)·SPC 계산·초중종검사 이력·불량코드·출하/입고 품질 게이트(`evaluateQualityRelease`: FINAL 검사 PASS 필요, **검사표준이 없으면 NOT_REQUIRED 로 통과**).
- ✅ 연결: ProductionResult 불량 → QualityInspection(workOrderOperation 단위, `lotId` 없음). Receiving → ReceivingInspection(PO 품목 단위, LOT FK 없음). FINAL 검사 → 입고/출하 게이트.
- 검사결과가 연결하는 대상: WorkOrder ✅(op 경유) · Process ✅ · Item ✅(spec) · LOT ⚠(선택 필드 `lotId`, POP 자동 생성 건은 미설정) · Equipment ❌(직접 FK 없음, op/assignment 경유 추정) · Worker ✅(`inspectorId`).
- ❌ 계측기 검교정(DG-009) · 성적서 출력/유압 테스트(DG-025) · 불량 원인/조치/재발방지 화면 숨김(DG-016).

### D-9. LOT / 제조이력 → **F 섹션 참조**

### D-10. Outsource
- ✅ `createOutsourcingOrder` → `issueWipUnitToOutsourcing`(수량 ≤ 발주수량, 상태 선점 updateMany) → `receiveWipUnitFromOutsourcing` → `inspectOutsourcedWipUnit`(합격=복귀, 불량=SCRAPPED 분리, 재외주=REWORK 분리, 중복검사 차단).
- ⚠ 복귀 후 해당 공정은 동일 operation 에서 IN_PROCESS → POP 에서 실적/완료를 별도로 처리해야 다음 공정으로 진행(DG-036). 외주 공정 지정 플래그가 RoutingOperation 에 없음(WIP 단위 수동 지정). 단가 0.

### D-11. Equipment / PLC
- ✅ 서버: `EdgeGateway/EquipmentConnection/DataTag/TagCurrentValue/TagSnapshot/EquipmentEvent` + NCWatch 매핑 + ingest 3종(heartbeat/status/report-daily, X-Agent-Key 로 tenant/site 확정, payload tenant 불신).
- ❌ 에이전트(FOCAS) 미개발 · NCWatch 사용 미확정 · Production EdgeGateway/Equipment 0(DG-010).
- 판정: 코드 **IMPLEMENTED(서버) / FIELD_TEST_REQUIRED**. 현장 배선·PLC·재연결·offline 판정은 코드 미구현이 아니라 현장 작업(DG-037) — 단, 에이전트 측 reconnect/heartbeat 는 에이전트 개발 시 포함 필요.
- 참고: 설비 가동 *카운트*(NCWatch partCount)는 화면 표시용이며 작업지시/실적과 자동 연계되지 않는다(실적은 POP 수동 입력).

### D-12. Monitoring
- ✅ 현황(`/app/lms/monitoring/status`, 30초 폴링 경량 API) · 분석(`/app/mes/equipment-monitor`: 오늘/최근 7일/이번 달, 타임라인) · 현황판(`/kiosk`, 비로그인).
- ⚠ 현황판은 설비+KPI 4종만(DG-024). Kiosk/fullscreen/auto-refresh: 30초 폴링은 있으나 전체화면·wake-lock 없음.

### D-13. KPI → DG-011 (아래 K 섹션과 M 섹션 참조)

| KPI | 필요한 Source | DB 필드 | 현재 산출 | 판정 |
|---|---|---|---|---|
| 시간당 생산량 | 양품수량, 작업시간 | ProductionResult.goodQty / startedAt·endedAt | `fetchUph`: Σ양품 ÷ Σ(실작업시간). 계획서 기준은 월 생산량 ÷ **명목 176h**(정의 상이) | PARTIAL |
| 공정불량률(PPM) | 총생산, 불량 | ProductionResult.defectQty / DefectRecord.qty | `fetchDefectRate`: 불량 ÷ **검사수량**(불량 발생 건만 검사 생성 → 분모 과소). PPM 미산출. 일보/설비출력/키오스크는 생산량 분모 | PARTIAL |
| 작업공수 | 작업시간 | ProductionResult 시간 | `fetchLaborEffort` (시간 합) — 인원 수 미반영 | PARTIAL |
| 납기준수율 | 납기일, 출하일 | SalesOrder(Item).deliveryDate / ShipmentOrder.shippedDate | **미산출**(납품 리드타임만) — 데이터는 존재 | NOT_MEASURABLE(산출 로직 없음) |

모든 KPI 화면/액션은 `assertDaewonFeatureScope` 로 **개발자 계정만** 사용 가능 → 사업 최종평가 증빙을 Daewon 담당자가 직접 추출 불가.

### D-14. Barcode / Label → **F-3 QR TRACEABILITY READINESS**

### D-15. User / Permission
- ✅ RBAC(OWNER/ADMIN/MANAGER/OPERATOR/VIEWER) + RolePermission 리소스·액션 매트릭스(639행) + 범위 allow-list(3겹) + 로그인 잠금/IP 제한 + POP 별도 세션.
- ⚠ 자재출고/입고 권한이 `PURCHASE_ORDER` 리소스에 결합 → 창고 담당자에게 발주 생성 권한이 함께 부여됨(권한 분리 불가, P3 설계 사항).
- ⚠ OPERATOR 는 PURCHASE_ORDER UPDATE 없음 → 외주 출고/입고는 MANAGER 이상 필요(현장 운영 역할 설계 필요).
- ❌ DG-013(비인증 읽기)·DG-017(계정 정책).

### D-16. Audit
- ✅ `AuditLog`(actor/before/after/IP/UA/menu) — 입고·출고·완제품입고·출하·수주·발주·작업지시·품목·BOM·재고조정·권한·사용자 등 핵심 변경 기록.
- ❌ 누락: POP 시작/실적, LOT 상태변경/생성, 공정마스터, 작업표준서, 재작업 종결, 채번규칙(DG-030).

### D-17. Reports
- 생산일보/품질리포트/설비리포트(Excel·인쇄)는 구현되어 있으나 허용 경로 밖(숨김) — 담당자 사용 불가.

### D-18. Import / Export
(DG-027/043) 업로드 5종 ✅ / 수주·발주·재고·설비·검사표준 업로드 ❌ / 내보내기: 품목·BOM·거래처·라우팅·공정·감사로그·로그인이력·리포트 3종 ✅, 수주·재고·MRP·LOT추적·KPI ❌.

### D-19. 중복 / 죽은 로직 (요청 7절)

| 유형 | 내용 | GAP |
|---|---|---|
| POLICY_DRIFT | 불량률 5종 정의(검사수량 vs 생산량) | DG-011 |
| POLICY_DRIFT | 설비 가동률 2종 이상(NCWatch 일보 vs EquipmentEvent RUN vs 분석) | DG-038 |
| DUPLICATE_LOGIC | LOT 번호 생성 경로 3곳(`generateReceivingLotNo`/`generateLotNo`/`generateCns*`) 모두 CNS 규칙 | DG-003 |
| STALE_CODE | `SalesOrderItem.producedQty` 미기록 · `MaterialConsumption` 미기록(원가가 읽음) | DG-040 |
| UNUSED_ACTION | `getLotForwardTrace/BackwardTrace` 무호출·무인증 | DG-040 |
| UNUSED_ROUTE | `/lot-history` `/trace-reverse` `/outsourcing` '준비 중' 스텁(허용 목록 포함) | DG-039 |

(이번 Phase 에서 제거하지 않음.)

---

## E. End-to-End Scenario Audit

| ID | 시나리오 | 판정 | 요약 |
|---|---|---|---|
| E2E-01 | 정상 생산 | **PARTIAL** | 코드 경로 전 구간 연결. 막히는 곳: ①LOT 자동채번 차단(DG-003) ②출하는 품목 LOT 설정 전제(DG-001) ③라우팅 0(DG-002) ④입고검사↔LOT 비연결(DG-019) |
| E2E-02 | 불량 | **PARTIAL** | 불량(폐기) 경로 ✅ — 검사표준 필요(DG-031). 재작업 경로 ❌ — 종결이 개발자 전용(DG-015) |
| E2E-03 | 부분 생산 | **PARTIAL** | 같은 공정 내 분할 실적(40 → +60 → 완료) ✅. **선행 공정 부분 수량을 다음 공정으로 넘기는 것 ❌**(순차 정책, DG-022) |
| E2E-04 | 부분 출하 | **PASS** | 수주 100 → 40 출하(PLANNED→SHIPPED) → shippedQty 40·잔량 60·PARTIAL_SHIPPED → MRP 수요 60(Phase 8 확정) → 60 출하 → SHIPPED. (전제: DG-001) |
| E2E-05 | 외주 | **PARTIAL** | 출고·입고·검사·복귀 ✅, 복귀 후 공정 완료는 POP 수동(DG-036) |
| E2E-06 | LOT 역추적 | **FAIL** | 출하→완제품 LOT→작업지시→설비/작업자 ✅, **원자재 LOT/공급사 ❌**(DG-006) |
| E2E-07 | 설비연동 | **FIELD_TEST_REQUIRED** | 서버/화면 ✅, 에이전트·현장 ❌. 작업지시↔설비 카운트 자동 연계 없음(수동 실적) |

### E-1. E2E-01 단계별

| # | 단계 | 코드 연결 | 비고 |
|---|---|---|---|
| 1 | 수주 | ✅ `createSalesOrder` | 확장 필드 없음(DG-008) |
| 2 | MRP | ✅ Phase 8 | |
| 3 | 발주 | ✅ DRAFT→ORDERED(수동 상태변경) | 상태머신 없음(DG-021) |
| 4 | 입고 | ✅ `createReceivingInspection` | LOT 수동(DG-003) |
| 5 | 입고검사 | ⚠ ReceivingInspection | LOT FK 없음(DG-019) |
| 6 | 자재 LOT | ⚠ isLotTracked=true 일 때만 | DG-001 |
| 7 | 생산계획 | ✅ | |
| 8 | 작업지시 | ✅ | 라우팅·제조번호 필요 |
| 9 | 자재출고 | ✅ | 검증 누락(DG-014) |
| 10 | POP 작업시작 | ✅ | |
| 11 | 생산실적 | ✅ | |
| 12 | 검사 | ⚠ 검사표준 존재 시 FINAL 게이트 | DG-002 |
| 13 | 다음공정 | ✅(순차) | DG-022 |
| 14 | 완제품입고 | ✅ | LOT=제조번호 |
| 15 | 출하지시/출하 | ⚠ 품목 LOT 설정 전제 | DG-001 |
| 16 | 수주완료 | ✅ SHIPPED(자동) | CLOSED 는 별도 |

---

## F. LOT Traceability Audit

### F-1. 판정

| 방향 | 판정 | 한 줄 사유 |
|---|---|---|
| **Forward** (Raw LOT → … → Customer) | **PARTIAL** | Raw LOT → 입고(RECEIPT tx) ✅ → 출고 ✅ → 작업지시/공정/작업자/설비 ✅ → 검사 ⚠ → **완제품 LOT·출하·고객 ❌**(원자재 LOT 조회에서 이어지지 않음) |
| **Reverse** (Customer → … → Raw LOT) | **BROKEN** | Shipment → 완제품 LOT ✅ → 작업지시/공정/작업자/설비 ✅ → 검사 ⚠ → **원자재 LOT/입고/공급사 ❌**(조회 경로 단절) |

### F-2. FK / Transaction chain 추적 (스키마 기준)

```
[Customer] SalesOrder.customerId
   ↑ ShipmentOrder.salesOrderId ── ShipmentItem.lotId ──→ Lot(FG)          ✅ FK
Lot(FG) ←─ FinishedGoodsReceipt.lotId / .workOrderId ──→ WorkOrder          ✅ FK
WorkOrder ─→ WorkOrderOperation ─→ ProductionResult(operatorId)             ✅ FK
          └→ WorkOrderOperationAssignment.equipmentId                        ✅ FK
          └→ QualityInspection(workOrderOperationId, lotId?, inspectorId)    ⚠ lotId 선택
WorkOrder ─→ WorkOrderMaterialLot(workOrderId, materialLotNo=string,
              inventoryTransactionId→InventoryTransaction.lotId)             ⚠ lotNo 는 문자열, Lot FK 는 tx 경유
InventoryTransaction(RECEIPT, lotId, refType=PURCHASE_ORDER, refId=PO)       ✅
PurchaseOrder.supplierId → BusinessPartner                                    ✅
ReceivingInspection.purchaseOrderItemId   (lotId 없음)                        ❌ LOT 직접 연결 없음
LotGenealogy(parent→child, INPUT)  — FG 입고 시 SEMI_FINISHED 구성품만 생성   ⚠ 대원정밀 BOM=RAW 100% → 링크 0건
```

- **데이터는 존재한다**: WorkOrder 를 다리로 *완제품 LOT ↔ 원자재 LOT* 는 WO 단위로 연결 가능. 그러나 `getLotLineageByNo` 는 조회 LOT 자신의 `inventoryTransaction.lotId`/`receipt.lotId` 만 사용해 FG→WO→원자재 홉을 탐색하지 않는다(DG-006), 원자재→WO→FG→출하 홉도 없다(DG-007).
- 수량 단위 LOT 배분은 WO 단위(하나의 WO 가 여러 FG LOT 를 만들면 모든 FG LOT 가 WO 의 모든 원자재 LOT 와 연결) — 이 정밀도가 업무상 충분한지 확인 필요.
- `WipUnit.lotId` 는 최초 FG LOT 1건만 기록(다회차는 FinishedGoodsReceipt 로 추적).
- 반제품 LOT 는 불필요: 공정 간 이동이 WO 당 단일 root WipUnit + WipMovement 로 추적되며 BOM 에 반제품이 없다(WIP QR 은 NOT_REQUIRED).

### F-3. QR TRACEABILITY READINESS (요청 H-QR절)

| 항목 | 판정 | 근거 |
|---|---|---|
| QR Generation | **PARTIAL** | CODE128 **1D 바코드**만 생성(`jsbarcode`). `qrcode` 패키지 설치만 되어 있고 import 0건. 인코딩 값=`itemCode`(또는 `itemCode\|lotId`) — 입고/완제품 라벨은 lotId 미전달로 itemCode 만 |
| Label Printing | **FIELD_TEST_REQUIRED** | `react-to-print` 브라우저 인쇄(SOFTWARE_READY 수준). Brother QL-820NWB 실장비·62mm 규격 미검증. Printer SDK 불필요 가능, 무인(무대화상자) 출력이 필요하면 Brother 모바일 SDK/로컬 에이전트 검토 |
| Tablet Camera Scan | **MISSING** | getUserMedia/BarcodeDetector/디코더 0건. 입력은 USB 키보드 웨지(Enter) |
| Raw LOT Scan | **FAIL** | 입고 라벨에 LOT 미인코딩, 스캔 시 LOT 해석 로직 없음 |
| Material Issue Scan | **PARTIAL** | 스캔→품목 행 강조만. LOT 은 드롭다운 선택. 오스캔(타 품목) 경고 ✅, 타 작업지시 자재/잔량/LOT 상태 검증 ❌(서버), 중복 스캔 방지 ❌ |
| WIP Scan | **NOT_REQUIRED** | 공정 간 LOT 분리 없음(WO 단위 root WIP) — 근거 F-2 |
| Finished LOT Scan | **FAIL** | 완제품 라벨 = itemCode 만 |
| Shipment Scan | **PARTIAL** | 스캔→품목 행 강조만, LOT 은 드롭다운. 부분출하 시 하나의 LOT 를 여러 출하에 사용 가능(예약 합산) ✅ |
| Forward Trace | **PARTIAL** | F-1 |
| Reverse Trace | **BROKEN** | F-1 |
| Reprint Control | **FAIL** | 재출력 이력/횟수/사용자/사유/폐기 LOT 차단 없음(DG-026) |
| **Go-Live QR Readiness** | **NOT READY** | DG-004/005/006/007/026 |

QR 원칙 준수 여부: 현재 바코드 값은 불변 식별자만 담도록 설계되어 있어(mutable 값 미포함) 방향은 맞다. 다만 LOT 식별자가 빠져 있다. LOT 상태(ACTIVE/QUARANTINE/ON_HOLD/CONSUMED/EXPIRED)는 존재하지만 출고 시 검증하지 않는다(DG-014).

---

## G. Security Audit

| # | 점검 | 결과 | GAP |
|---|---|---|---|
| 1 | Authentication | /app 은 쿠키 **존재**만 middleware 확인, 레이아웃에서 서명 검증. Server Action POST 는 레이아웃보다 먼저 실행되므로 액션 자체 가드가 유일한 방어 | DG-013 |
| 2 | Authorization(리소스 권한) | 쓰기 액션은 `requireResourcePermission + requireRole` 일관. 읽기 액션 104개는 가드 없음 | DG-013 |
| 3 | Tenant isolation | 쓰기: 세션 tenant 사용이 대부분. 읽기 73개가 클라이언트 tenantId 를 신뢰, `getLots/getWorkOrders/getWorkOrderById/getEquipments` 는 tenant 필터 자체가 없음 | DG-013 |
| 4 | Site isolation | POP 세션 사업장 일치 검증 ✅. 외주 등 일부는 `site.findFirst({tenantId})` 로 첫 사업장 사용(단일 사업장 가정) | DG-036 |
| 5 | 클라이언트 tenantId 신뢰 | 위 3 + `createLot(data, tenantId)` | DG-013/042 |
| 6 | IDOR | `getWorkOrderById(id)` · `getLotForwardTrace(lotId)` 무인증·무소유검증 | DG-013 |
| 7 | 관리자 전용 기능 | 개발자 가드(`assertDeveloperOnly`) 서명 검증 기반 ✅ | — |
| 8 | POP 작업자 권한 | PIN 4자리·IP 제한 30/10분. 사업장 불일치 차단 ✅ | DG-017 |
| 9 | AuditLog | 핵심 변경 대부분 ✅, 누락 지점 존재 | DG-030 |
| 10 | RLS | 115/115 ✅ (앱은 Prisma owner 로 접속하므로 RLS 는 PostgREST 노출 방어용 — 애플리케이션 권한과 별개) | — |
| 11 | 비밀/세션 | JWT 8h·httpOnly·sameSite=strict·secure(prod) ✅. 계정: 공통 admin·test·dev-pop | DG-017 |
| 12 | 공개 엔드포인트 | /kiosk, /api/mes/equipment-monitor/light, /signup-request(스팸 제한 없음) | DG-024/018 |
| 13 | 에이전트 키 | cuid() 기본값·평문 | DG-033 |
| 14 | 업로드 | 확장자·크기·PDF 시그니처 검증 + private 버킷 + signed URL ✅ | — |
| 15 | 주입 | `$queryRawUnsafe` 앱 코드 0건, `Prisma.raw` 는 고정 식별자만 | — |

> **주의**: DG-013 은 *코드 기준 확정*이며 런타임 재현은 하지 않았다(운영 환경 호출 금지 원칙). 비운영 환경에서 '임의 쿠키 + Next-Action POST' black-box 검증을 권고한다.

---

## H. Performance Audit (정적)

| 항목 | 관찰 | GAP |
|---|---|---|
| 무페이지 전체 조회 | `findMany` 406건 중 `take/skip` 44건. 재고/수불/LOT/작업지시/실적 목록이 전량 로드 후 클라이언트 테이블 | DG-028 |
| N+1 | `getWorkOrdersForReceipt` — COMPLETED WO 전체 각각 품질 게이트 조회(기간 필터 없음, 완제품입고·최종검사 두 화면) | DG-028 |
| 폴링 | 현황 30초 경량 API(select 최소화) ✅, `router.refresh` 대체 | — |
| Excel | 1,000행 단일 interactive 트랜잭션(5s 기본) | DG-043 |
| 직렬 처리 | ingest 는 설비별 순차 upsert(4대 수준 문제 없음), 페이로드 크기 제한 없음 | DG-033 |
| 부하 | 미수행(요청 범위 아님). 운영 위험 경로는 위 표 | — |

---

## I. Field Device / Equipment Readiness

### I-1. 장비별 운영 화면 (요청 N절)

| 장비(사업계획) | 수량 | 사용 URL / 화면 | 상태 |
|---|---|---|---|
| 산업용 키오스크(MCT·CNC) | 2 | `/pop/work-select` → `/pop/production/[operationId]` (PIN) | 🔧 FIELD_TEST |
| 산업용 스마트패드(측정·창고·프레스·도장) | 4 | POP + 관리자 웹: `/app/mes/material-receipt` · `material-issue` · `finished-goods-receipt` · `shipments` · `inspection-stages` | ⚠ 관리자 웹은 데스크톱 레이아웃, 카메라 스캔 없음(DG-005/035) |
| 현황판(65") | 1 | `/kiosk` (비로그인, 30초 폴링) | ⚠ 표시 항목 부족(DG-024) |
| 바코드프린터(QL-820NWB) | 2 | `BarcodePrintDialog` — 입고/출고/완제품/출하 화면의 브라우저 인쇄 | 🔧 FIELD_TEST(DG-034) |
| 설비데이터 처리 PC | 1 | `POST /api/lms/ncwatch/{heartbeat,status,report-daily}` + `X-Agent-Key` | ❌ 에이전트 미개발(DG-010) |

> 사업계획서 안에서도 스마트패드 배치 설명이 2종('측정실·조립실·테스트실·창고' vs '완제품 창고·원자재 보관소·프레스·도장실')으로 다르다 — **장비별 운영 화면/위치 확정이 필요**(GAP 로 기록: DG-035, DG-046).

### I-2. 현장 UX (요청 9절, 취향 평가 제외)
- POP: 버튼 h-14~16·넘버패드·`inputMode` 지정 ✅ / 오프라인·재연결·wake-lock·전체화면·세션 만료 안내 ❌.
- 자재출고/입고/출하 다이얼로그: 키보드 입력/드롭다운 중심, 태블릿 최적화 근거 없음.
- 바코드 입력 포커스 유지 ✅(스캔 후 재포커스).

---

## J. Deployment / Operations Readiness

| 항목 | 확인 결과 |
|---|---|
| Git Integration | GitHub(`aemess3078-hub/DAEWON-MES` private) ↔ Vercel(bot) — Production 배포 레코드 연속 존재(최근 10건 전부 `vercel[bot]`) |
| Production 현재 commit | `1683f17` (2026-10-14 03:07Z, state=success) |
| HEAD 배포 | `5d7b74c` **레코드/상태/체크런 0건** → DG-044. 변경 파일: `docs, package.json(scripts), scripts/*, src/lib/master-migration/audit.ts` — 앱 런타임 번들에 영향 없음 |
| Production Branch / Ignored Build Step | `vercel.json`: framework·regions(icn1)만, `ignoreCommand` 없음 → 코드상 건너뛰기 설정 없음. 대시보드 값은 **OPS_CONFIRM_REQUIRED** |
| 환경변수 | 문서상 필수 목록 존재(`DEPLOYMENT-VERCEL.md` 2절). Vercel 실제 값은 확인 불가 → **OPS_CONFIRM_REQUIRED** |
| Build | 로컬 빌드는 실행하지 않음(변경 금지 원칙). CI 없음(DG-032) |
| Backup / PITR | **OPS_CONFIRM_REQUIRED** (Supabase 플랜·백업·복구 리허설 미확인, DG-018) |
| 자격증명 교체 | 문서상 '배포 전 필수' — 완료 여부 **OPS_CONFIRM_REQUIRED** |
| WAF/Rate limit | 문서상 '아직 설정하지 않음' (5-2절) |
| 모니터링/알림 | 없음(Sentry·로그 수집 없음, error.tsx 1개) |
| 마이그레이션 관리 | `prisma/migrations` 5건, legacy 이력 격리 보관 ✅. 롤백 전략 문서 없음 |

---

## K. GAP Master List

> Severity 순. 각 GAP 은 요청 5절 의 14개 속성을 모두 기재. 한눈에 보는 요약표 → 상세.

### K-0. 요약표

| ID | Sev | Status | Type | Module | 요약 | Size | Blocker |
|---|---|---|---|---|---|---|---|
| DG-001 | P0 | MISSING | DATA | Master/LOT | Production Item 427건 전부 isLotTracked=false · lotNumberingType=DEFAUL… | S | Y |
| DG-002 | P0 | MISSING | DATA | Master | 생산 필수 기준정보 미적재: Routing 0 · RoutingOperation 0 · ItemRouting 0 · Equ… | M | Y |
| DG-003 | P1 | PARTIAL | PROCESS | LOT | LOT/제조번호 자동채번 fail-closed — 대원정밀 규칙 미확정으로 MANUAL 외 모든 자동 채번이 오류 | M | 조건부(수동 채번 수용 시 N) |
| DG-004 | P1 | PARTIAL | CODE | Barcode | 라벨/스캔이 품목 단위 — 바코드에 LOT 미포함, 스캔은 해당 품목 행 강조만 수행 | M | 조건부(수동 LOT 선택으로 대체 가능) |
| DG-005 | P1 | MISSING | CODE | Barcode | 태블릿 카메라 스캔(QR/바코드 디코더) 미구현 — 입력은 USB 키보드 웨지(Enter)만 | M | 조건부 |
| DG-006 | P1 | BUG | CODE | Traceability | 역추적(완제품 LOT → 원자재 LOT/공급사) 단절 — 완제품 LOT 조회 시 투입 원자재가 나오지 않음 | M | Y |
| DG-007 | P1 | PARTIAL | CODE | Traceability | 정방향(원자재 LOT → 완제품 LOT → 출하 → 고객) 미연결 — 작업지시/공정/실적/작업자/설비까지만 표시, 완제품 … | M | Y |
| DG-008 | P1 | MISSING | DB | Sales | 조선기자재 확장 필드(호선번호·블록번호·도면번호·선급검사기관·고객발주번호·인수부서) 없음 | L | Y |
| DG-009 | P1 | MISSING | CODE | Quality | 계측기 검교정관리 미구현(메뉴 '준비중') | L | Y |
| DG-010 | P1 | MISSING | DEVICE | Equipment | FOCAS 수집 에이전트 미개발, NCWatch 사용 여부 미확정(제어기 기종 미확인) | L | Y |
| DG-011 | P1 | PARTIAL | CODE | KPI | KPI 접근/정의 문제: (a) KPI 화면·액션 개발자 전용 (b) PPM 미산출 (c) 불량률 분모 정의 불일치 (d)… | M | Y |
| DG-012 | P1 | MISSING | CODE | Data cutover | 기초재고/Open SO·PO/WIP/LOT 초기값 이관 기능 없음 — 실사조정은 기존 balanceId 필수 | L | Y |
| DG-013 | P1 | BUG | SECURITY | Security | 비인증 읽기 서버 액션 104개(정적 스캔), 인증 없는 호출 시 DEFAULT_TENANT_ID 로 폴백, 클라이언트 t… | M | Y |
| DG-014 | P1 | BUG | CODE | Material issue | 자재출고 서버 검증 누락: BOM 구성품 여부·작업지시 상태·필요수량 상한·Lot.status·reservation 소유 … | S | Y |
| DG-015 | P1 | BUG | CONFIG | POP/Rework | POP 재작업 수량 입력 → 재작업 종결(completeRework/getReworkPendingList)이 개발자 전용 … | S | Y |
| DG-016 | P1 | PARTIAL | CONFIG | Quality | 불량 원인분석·시정조치·재발방지·품질현황 화면이 범위 밖(숨김) + 액션 개발자 전용 | S | Y |
| DG-017 | P1 | PARTIAL | SECURITY | Security | 운영 계정 정책 위험: 공급사 공통 admin(mustChangePw=false), 개발자 'test'(OWNER·숨김 기… | S | Y |
| DG-018 | P1 | OPS_CONFIRM_REQUIRED | OPS | Ops | 백업/PITR·DB·service role 키 교체 완료·WAF/레이트리밋 적용 여부를 코드로 확인할 수 없음 | S | Y |
| DG-019 | P2 | PARTIAL | DB | Receiving/Quality | 입고검사(ReceivingInspection)가 LOT 와 FK 연결되지 않음 (PO 품목만 참조) | S | N |
| DG-020 | P2 | MISSING | CODE | Inventory | 입고·출고·완제품입고 취소/정정(역분개) 기능 없음 — 정정은 실사조정(MANAGER)뿐이며 WorkOrderMateria… | M | N |
| DG-021 | P2 | BUG | CODE | Purchasing | 발주 상태 자유 변경(RECEIVED/CLOSED 임의 설정 가능) 및 siteId/supplierId/itemId 소유 … | S | N |
| DG-022 | P2 | PARTIAL | PROCESS | Production | 공정 간 부분 이관 불가(선행 공정 COMPLETED 후에만 후속 착수), 완제품입고는 WO COMPLETED 후에만 | M | N |
| DG-023 | P2 | MISSING | CODE | POP | POP 에 비가동 사유 입력 없음(비가동사유 마스터 화면은 숨김) | M | N |
| DG-024 | P2 | PARTIAL | UI | Monitoring | 현황판(/kiosk): 재공·납기·계획대비 미표시, 비로그인 공개(일 생산/불량 수량 노출), 헤더 문구 'SIZL-MES' | M | N |
| DG-025 | P2 | MISSING | CODE | Quality | 검사성적서 출력·유압 테스트 전용 입력 없음(검사표준 수치 항목으로 수용 가능 여부 미검증) | M | N |
| DG-026 | P2 | MISSING | CODE | Barcode | 라벨 재출력 통제·출력 이력(누가/언제/횟수)·동일 LOT 중복 라벨 정책·폐기 LOT 스캔 차단 없음 | M | N |
| DG-027 | P2 | PARTIAL | CODE | Import/Export | 업로드: 수주·발주·재고·설비·검사표준 없음 / 내보내기: 수주·재고·MRP·LOT추적 등 없음 / 품목·BOM 등은 1,… | M | N |
| DG-028 | P2 | PARTIAL | CODE | Performance | 목록 전체 조회(findMany 406건 중 take/skip 44건), getWorkOrdersForReceipt 가 C… | M | N |
| DG-029 | P2 | MISSING | CODE | Resilience | 서버측 멱등키/중복 제출 방지 및 오프라인 큐 없음(잔량 한도·row lock 으로만 제한) | M | N |
| DG-030 | P2 | PARTIAL | CODE | Audit | 감사로그 누락 지점: POP 시작/실적(13 writes/0 audit), LOT 상태변경·생성, 공정마스터, 작업표준서,… | S | N |
| DG-031 | P2 | BUG | CODE | POP | POP 불량 등록이 검사표준(InspectionSpec) 존재에 종속 — 없으면 실적 전체 롤백 | S | N(DG-002 해소 시) |
| DG-032 | P2 | MISSING | OPS | Ops | CI/자동 테스트 파이프라인·에러 모니터링·구조화 로그 없음 | M | N |
| DG-033 | P2 | PARTIAL | SECURITY | Security | EdgeGateway.apiKey 가 cuid() 기본값·평문 저장, ingest 페이로드 건수/크기 제한 없음 | S | N |
| DG-034 | P2 | FIELD_TEST_REQUIRED | DEVICE | Barcode | Brother QL-820NWB 인쇄: 브라우저 인쇄(@page size:auto, 라벨 폭 240px 고정) — 용지 규… | S | 조건부 |
| DG-035 | P2 | FIELD_TEST_REQUIRED | DEVICE | Field UX | 스마트패드/키오스크 현장 UX 미검증 — 입고·출고·출하·검사는 관리자 웹 다이얼로그(데스크톱 레이아웃), POP 은 터치… | M | 조건부 |
| DG-036 | P2 | PARTIAL | PROCESS | Outsource | 외주 복귀 후 공정 완료는 POP 수동 단계, 외주 단가 0·성적서 미연결, 외주 PO 를 'OS-'/[OUTSOURCIN… | M | N |
| DG-037 | P2 | FIELD_TEST_REQUIRED | NETWORK | Equipment | 설비 신호취득/현장배선 4식·네트워크 공사 — 현장 작업(코드 범위 아님) | L | 조건부(DG-010) |
| DG-038 | P3 | PARTIAL | CODE | Duplicate logic | 동일 KPI 다중 정의: 설비 가동률 산출 경로 2종 이상(NCWatch 일보 vs EquipmentEvent RUN vs… | M | N |
| DG-039 | P3 | DEPRECATED | UI | Stale routes | '준비 중' 스텁이 허용 경로에 포함: /lot-history, /trace-reverse, /outsourcing | S | N |
| DG-040 | P3 | DEPRECATED | CODE | Dead code | 미사용/미기록: SalesOrderItem.producedQty(기록 코드 없음), MaterialConsumption(기… | S | N |
| DG-041 | P3 | PARTIAL | CODE | Legacy residue | NMES/CNS 잔재: 쿠키 nmes-*, 'SIZL-MES' 문구, siteId ?? 'site-a' 폴백, Cns* 명… | S | N |
| DG-042 | P3 | BUG | CODE | LOT | LOT 상태 변경이 임의 문자열 허용·감사로그 없음, createLot 은 tenantId/itemId 를 클라이언트 값 신뢰 | S | N |
| DG-043 | P3 | PARTIAL | CODE | Import | 엑셀 import 가 단일 interactive 트랜잭션(Prisma 기본 5s) — 1,000행에서 타임아웃 가능, 부분… | S | N |
| DG-044 | INFO | OPS_CONFIRM_REQUIRED | OPS | Deployment | HEAD 5d7b74c 는 Vercel 배포 기록 없음. Production 은 1683f17(success). 5d7b7… | S | N |
| DG-045 | INFO | IMPLEMENTED | DB | DB | RLS 115/115 · 마이그레이션 5건 모두 적용(finished) · 트랜잭션 테이블 전부 0 · Master 수치(… | - | N |
| DG-046 | INFO | PARTIAL | DOCUMENT | Document | 사업계획서 정합: v10 KPI 는 2종(요청서는 4종), '약 86개 데이터모델'(실제 114), 구판 PDF 에 OPC… | S | N |
| DG-047 | INFO | IMPLEMENTED | CONFIG | Stack | PostgreSQL 17.11 · Next 14.2.35 · Prisma 5.x · Node engines 22.x(로컬 … | - | N |

### K-1. 상세

#### P0 (2건)

##### DG-001 · Master/LOT — Production Item 427건 전부 isLotTracked=false · lotNumberingType=DEFAULT · manual…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-001 / Master/LOT |
| Requirement | BP-MASTER-009 · BP-SALES-003 · BP-TOBE-002/003/014 |
| Current Implementation | Production Item 427건 전부 isLotTracked=false · lotNumberingType=DEFAULT · manualLotPolicy=ALLOWED |
| Evidence | Production READ ONLY 조회(FINISHED 163 / RAW 264 모두 lot_tracked=false); `receiving.actions.ts:155`(LOT은 isLotTracked=true 일 때만 생성); `shipment.actions.ts:590-604`(비LOT 품목은 lotId=null 재고만 출하) ↔ `finished-goods.actions.ts:484-549`(완제품 입고는 항상 LOT 키 재고 생성); `item-excel.actions.ts:261-263`(일괄등록은 DEFAULT 고정, 일괄수정 기능 없음) |
| Status / Severity / Type | **MISSING** / **P0** / DATA |
| Risk | 이대로 가동하면 ① 완제품은 입고돼도 출하 화면에서 '출하 가능한 재고가 없습니다' 로 출하 불가 ② 원자재 LOT 추적(WorkOrderMaterialLot) 전면 비활성 |
| Recommended Fix | LOT 정책 확정 후(원자재·완제품 isLotTracked=true, lotNumberingType=MANUAL 또는 확정 규칙) 통제된 일괄 갱신(dry-run → 승인 → apply, 감사로그, master baseline hash 재산정) |
| Estimated Size | S |
| Dependency | DG-003 결정 |
| Go-Live Blocker | Y |

##### DG-002 · Master — 생산 필수 기준정보 미적재: Routing 0 · RoutingOperation 0 · ItemRouting 0 · Equipment 0 ·…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-002 / Master |
| Requirement | BP-MASTER-003/004/005/011 · BP-TOBE-012 |
| Current Implementation | 생산 필수 기준정보 미적재: Routing 0 · RoutingOperation 0 · ItemRouting 0 · Equipment 0 · InspectionSpec/Item 0 · 후공정 공정(도장·용접·조립·유압·프레스) 미등록 · FINISHED 29건 BOM 없음 |
| Evidence | Production READ ONLY 조회; `work-order.actions.ts:905`(validateRoutingForItem — 라우팅 없으면 작업지시 불가); WorkCenter 5건(WC-MACH/INSP/WASH/PACK/STORE) |
| Status / Severity / Type | **MISSING** / **P0** / DATA |
| Risk | 작업지시 생성 불가 → POP·실적·입고·출하 전 구간 시작 불가. 검사표준 없으면 POP 불량 등록도 실패(DG-031) |
| Recommended Fix | 품목별 라우팅/공정/설비/검사표준 이관(엑셀 업로드 기능은 이미 존재) — 데이터 이관 Phase 에서 현장 확정 후 적재 |
| Estimated Size | M |
| Dependency | 현장 라우팅 확정(작업공정도) |
| Go-Live Blocker | Y |


#### P1 (16건)

##### DG-003 · LOT — LOT/제조번호 자동채번 fail-closed — 대원정밀 규칙 미확정으로 MANUAL 외 모든 자동 채번이 오류

| 항목 | 내용 |
|---|---|
| ID / Module | DG-003 / LOT |
| Requirement | BP-MAT-002 · BP-PROD-002 · BP-TOBE-002 |
| Current Implementation | LOT/제조번호 자동채번 fail-closed — 대원정밀 규칙 미확정으로 MANUAL 외 모든 자동 채번이 오류 |
| Evidence | `lot-brand-guard.ts:19-26` · `lot-rule-resolver.ts:54` · `receiving.actions.ts:301-302`(AUTO) · `work-order.actions.ts:924-926`(제조번호 자동생성) · docs/DAEWON-TODO.md 3절 |
| Status / Severity / Type | **PARTIAL** / **P1** / PROCESS |
| Risk | 사업계획서 '입고 시 LOT 자동 채번' 불충족. 수동 입력 운영은 가능하나 중복/오기 위험, 작업지시마다 제조번호 직접 입력 |
| Recommended Fix | 규칙 확정(원자재 입고 LOT·제조번호·완제품 LOT·협력사 LOT 보존·자릿수) → guard 제거·규칙 모듈 교체(호출부 6곳) |
| Estimated Size | M |
| Dependency | 고객 결정 |
| Go-Live Blocker | 조건부(수동 채번 수용 시 N) |

##### DG-004 · Barcode — 라벨/스캔이 품목 단위 — 바코드에 LOT 미포함, 스캔은 해당 품목 행 강조만 수행

| 항목 | 내용 |
|---|---|
| ID / Module | DG-004 / Barcode |
| Requirement | BP-TOBE-002/003/013/014 · BP-MAT-003 |
| Current Implementation | 라벨/스캔이 품목 단위 — 바코드에 LOT 미포함, 스캔은 해당 품목 행 강조만 수행 |
| Evidence | `barcode-label.tsx:33`(lotId 있을 때만 itemCode\|lotId) · `receiving-form-dialog.tsx:678-690`(lotNo만 전달·lotId 미전달) · `receipt-dialog.tsx:236-247`(itemCode만) · `issue-form-dialog.tsx:168-177` · `shipment-form-sheet.tsx:273-290`(parsed.itemCode만 사용) |
| Status / Severity / Type | **PARTIAL** / **P1** / CODE |
| Risk | LOT 식별 불가 라벨 → 오투입/오출하 방지·LOT 연결 약속 미충족 |
| Recommended Fix | QR/바코드에 불변 식별자(lotNo 또는 ID)만 인코딩 + MES 조회로 상태·잔량·품목 검증, 스캔 시 LOT 자동 선택·중복 스캔 차단·수동 입력 fallback |
| Estimated Size | M |
| Dependency | DG-003 |
| Go-Live Blocker | 조건부(수동 LOT 선택으로 대체 가능) |

##### DG-005 · Barcode — 태블릿 카메라 스캔(QR/바코드 디코더) 미구현 — 입력은 USB 키보드 웨지(Enter)만

| 항목 | 내용 |
|---|---|
| ID / Module | DG-005 / Barcode |
| Requirement | BP-HW-002 · BP-TOBE-003 |
| Current Implementation | 태블릿 카메라 스캔(QR/바코드 디코더) 미구현 — 입력은 USB 키보드 웨지(Enter)만 |
| Evidence | grep getUserMedia/BarcodeDetector/facingMode 0건 · `qrcode` 패키지 import 0건(미사용) · `barcode-scan-input.tsx:36-55` |
| Status / Severity / Type | **MISSING** / **P1** / CODE |
| Risk | 갤럭시탭 액티브5에는 하드웨어 스캐너가 없어 사업계획서의 '바코드를 촬영·인식' 불가, 수동 입력만 가능 |
| Recommended Fix | PWA 카메라 스캔 컴포넌트(후면 카메라 우선·연속 스캔·중복 차단·성공/실패 피드백·수동 입력 fallback) — HTTPS는 Vercel 제공 |
| Estimated Size | M |
| Dependency | DG-004, 실기기 시험 |
| Go-Live Blocker | 조건부 |

##### DG-006 · Traceability — 역추적(완제품 LOT → 원자재 LOT/공급사) 단절 — 완제품 LOT 조회 시 투입 원자재가 나오지 않음

| 항목 | 내용 |
|---|---|
| ID / Module | DG-006 / Traceability |
| Requirement | BP-LOT-002 · BP-TOBE-014 · E2E-06 |
| Current Implementation | 역추적(완제품 LOT → 원자재 LOT/공급사) 단절 — 완제품 LOT 조회 시 투입 원자재가 나오지 않음 |
| Evidence | `lot-lineage.actions.ts:44-52`(materialIssues는 inventoryTransaction.lotId=조회 LOT 인 건만) · :109-136(관련 작업지시는 조회 LOT 의 issue/receipt/wip 에서만 도출) · `finished-goods.actions.ts:460-481`(RAW→FG LotGenealogy 는 SEMI_FINISHED 구성품만 연결; 대원정밀 BOM 은 100% RAW_MATERIAL) · `traceability-client.tsx:149-173` |
| Status / Severity / Type | **BUG** / **P1** / CODE |
| Risk | 클레임(핵심 도입 목적) 시 원자재 LOT·공급사 역추적 불가. 데이터(WorkOrderMaterialLot)는 존재하나 조회 경로가 없음 |
| Recommended Fix | FG LOT → FinishedGoodsReceipt → WorkOrder → WorkOrderMaterialLot(workOrderId) → 원자재 LOT → 입고 RECEIPT tx → PO → 공급사 경로로 조회 확장(스키마 변경 불필요); 필요 시 입고 시 RAW→FG LotGenealogy(INPUT) 생성 |
| Estimated Size | M |
| Dependency | DG-001 |
| Go-Live Blocker | Y |

##### DG-007 · Traceability — 정방향(원자재 LOT → 완제품 LOT → 출하 → 고객) 미연결 — 작업지시/공정/실적/작업자/설비까지만 표시, 완제품 LOT·출하·고객 …

| 항목 | 내용 |
|---|---|
| ID / Module | DG-007 / Traceability |
| Requirement | BP-LOT-002 · E2E-06 |
| Current Implementation | 정방향(원자재 LOT → 완제품 LOT → 출하 → 고객) 미연결 — 작업지시/공정/실적/작업자/설비까지만 표시, 완제품 LOT·출하·고객 미표시 |
| Evidence | `lot-lineage.actions.ts:53-74`(receipts/shipments 는 조회 LOT id 기준만) · `traceability-client.tsx:175-204` · `/app/mes/trace-reverse` `/app/mes/lot-history` 는 '준비 중' 스텁 |
| Status / Severity / Type | **PARTIAL** / **P1** / CODE |
| Risk | 원자재 불량 통보 시 영향 완제품·납품처 범위를 시스템이 산출하지 못함 |
| Recommended Fix | 원자재 LOT → WO → FinishedGoodsReceipt.lotId → ShipmentItem.lotId → SalesOrder.customer 확장 + 전용 화면/엑셀 |
| Estimated Size | M |
| Dependency | DG-006 |
| Go-Live Blocker | Y |

##### DG-008 · Sales — 조선기자재 확장 필드(호선번호·블록번호·도면번호·선급검사기관·고객발주번호·인수부서) 없음

| 항목 | 내용 |
|---|---|
| ID / Module | DG-008 / Sales |
| Requirement | BP-SALES-001/002 |
| Current Implementation | 조선기자재 확장 필드(호선번호·블록번호·도면번호·선급검사기관·고객발주번호·인수부서) 없음 |
| Evidence | `schema.prisma:2491-2540`(SalesOrder/SalesOrderItem) · customerPoNo 는 MRP 어댑터의 null 상수뿐(`order-mrp-adapter.ts:131`, `simulation-adapter.ts:253`) |
| Status / Severity / Type | **MISSING** / **P1** / DB |
| Risk | 기존 수기 미납관리 대체 불가(호선/블록/선급 필터·실제 발주양식 일치 불가) — 사업계획서 '개선' 약속 미이행 |
| Recommended Fix | SalesOrder/Item 컬럼 확장 + 등록폼·현황 필터·엑셀·출하/MRP 표시 (스키마 변경 Phase 필요) |
| Estimated Size | L |
| Dependency | 고객 발주양식 확정 |
| Go-Live Blocker | Y |

##### DG-009 · Quality — 계측기 검교정관리 미구현(메뉴 '준비중')

| 항목 | 내용 |
|---|---|
| ID / Module | DG-009 / Quality |
| Requirement | BP-QUAL-005 |
| Current Implementation | 계측기 검교정관리 미구현(메뉴 '준비중') |
| Evidence | `nav-config.ts:121` · docs/DAEWON-TODO.md 1절 · 원본 자료 '2025 계측기 검교정 LIST 최종본.xlsx' 존재 |
| Status / Severity / Type | **MISSING** / **P1** / CODE |
| Risk | 사업계획서 '신규' 개발 항목 — 감리 대상. 검사 신뢰성(만료 계측기 사용 경고) 기능 부재 |
| Recommended Fix | 계측기 마스터 + 검교정 이력(주기·성적서 첨부) + 만료임박 식별 + 검사 입력 시 만료 경고 (신규 모델 1~2개) |
| Estimated Size | L |
| Dependency | 교정 대상·주기 정책 결정 |
| Go-Live Blocker | Y |

##### DG-010 · Equipment — FOCAS 수집 에이전트 미개발, NCWatch 사용 여부 미확정(제어기 기종 미확인)

| 항목 | 내용 |
|---|---|
| ID / Module | DG-010 / Equipment |
| Requirement | BP-TOBE-006/019 · BP-HW-005 · BP-MON-001 |
| Current Implementation | FOCAS 수집 에이전트 미개발, NCWatch 사용 여부 미확정(제어기 기종 미확인) |
| Evidence | docs/DAEWON-TODO.md 4절 · 서버 ingest 3종 구현(`api/lms/ncwatch/*`) · 외부 `agent.js`(CNS용)는 NCWatch DB(TBL_*_STATUS) 폴링 방식이며 FOCAS 직접 연동 아님 · Production EdgeGateway 0 / Equipment 0 |
| Status / Severity / Type | **MISSING** / **P1** / DEVICE |
| Risk | 사업 KPI(비가동 계측 기반 UPH 개선)의 근거 데이터가 수집되지 않음 |
| Recommended Fix | 제어기 기종/NCWatch 보유 확인 → (a) NCWatch 설치 후 기존 에이전트 적용 또는 (b) FOCAS 에이전트 신규(Windows PC), 게이트웨이 키 발급·설비 매핑 |
| Estimated Size | L |
| Dependency | 현장 설비·네트워크(DG-037) |
| Go-Live Blocker | Y |

##### DG-011 · KPI — KPI 접근/정의 문제: (a) KPI 화면·액션 개발자 전용 (b) PPM 미산출 (c) 불량률 분모 정의 불일치 (d) UPH=실작업시간…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-011 / KPI |
| Requirement | BP-KPI-001/002 |
| Current Implementation | KPI 접근/정의 문제: (a) KPI 화면·액션 개발자 전용 (b) PPM 미산출 (c) 불량률 분모 정의 불일치 (d) UPH=실작업시간 vs 계획서=명목 176h (e) 납기준수율 미산출 |
| Evidence | `daewon-scope.ts:17-80`(허용 목록에 /kpi·/dashboard·/reports 없음) · `kpi.actions.ts:494` · :147-198(분모=검사수량: 불량 발생 건만 검사 생성되어 과대) · `self-inspection.helpers.ts:74` · 일보/설비출력/키오스크는 생산량 분모 · grep ppm=0 · 납기준수 산출 0건 |
| Status / Severity / Type | **PARTIAL** / **P1** / CODE |
| Risk | 사업 최종평가 증빙(2 KPI) 및 요청서의 4 KPI 를 MES 데이터로 일관되게 제시할 수 없음. 값이 화면마다 달라 신뢰 저하 |
| Recommended Fix | KPI 정의 확정(분모·시간 기준·기간) → 단일 산출 서비스 + PPM·납기준수율·작업공수 + 기간필터·엑셀 + 허용 경로 개방 |
| Estimated Size | M |
| Dependency | KPI 정의 합의(계획서 KPI 근거와 일치) |
| Go-Live Blocker | Y |

##### DG-012 · Data cutover — 기초재고/Open SO·PO/WIP/LOT 초기값 이관 기능 없음 — 실사조정은 기존 balanceId 필수

| 항목 | 내용 |
|---|---|
| ID / Module | DG-012 / Data cutover |
| Requirement | BP-MAT-004 · 요청 12절 |
| Current Implementation | 기초재고/Open SO·PO/WIP/LOT 초기값 이관 기능 없음 — 실사조정은 기존 balanceId 필수 |
| Evidence | `inventory.actions.ts:511-560`(adjustInventoryStock) · TransactionType 에 OPENING 없음 · 엑셀 액션은 item/bom/partner/routing/work-center 5종뿐 |
| Status / Severity / Type | **MISSING** / **P1** / CODE |
| Risk | 가동 시점 재고/미납/발주잔량 이관 불가. 임시 PO·조정으로 우회하면 감사추적·수불 오염 |
| Recommended Fix | 기초재고(창고·LOT별) 일괄 이관(OPENING tx·승인·감사·dry-run/rollback) + 수주/발주 잔량 이관 도구 |
| Estimated Size | L |
| Dependency | DG-001, DG-002 |
| Go-Live Blocker | Y |

##### DG-013 · Security — 비인증 읽기 서버 액션 104개(정적 스캔), 인증 없는 호출 시 DEFAULT_TENANT_ID 로 폴백, 클라이언트 tenantId 신뢰…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-013 / Security |
| Requirement | 요청 O절 |
| Current Implementation | 비인증 읽기 서버 액션 104개(정적 스캔), 인증 없는 호출 시 DEFAULT_TENANT_ID 로 폴백, 클라이언트 tenantId 신뢰 73개, 일부는 tenant 필터 자체가 없음 |
| Evidence | 정적 스캔(82 'use server' 파일/520 export): `getInventoryBalances`(inventory.actions.ts:58) · `getLots`(lot.actions.ts:52 — tenant 필터 없음) · `getWorkOrders/getWorkOrderById`(work-order.actions.ts:223,463 — tenant 필터 없음) · `getSalesOrders(tenantId)`(sales-order.actions.ts:15) · `auth.ts:58-72` · `middleware.ts:12-16`(쿠키 '존재'만 확인, 서명 미검증) |
| Status / Severity / Type | **BUG** / **P1** / SECURITY |
| Risk | 로그인 없이(임의 쿠키값으로 /app 경로 통과) 서버 액션 POST 로 재고·수주·LOT·작업지시 조회 가능성. 런타임 재현은 이번 Phase 에서 수행하지 않음. 클라이언트 번들에서 참조되지 않는 액션은 ID 가 노출되지 않을 수 있어 실제 노출 범위는 비운영 환경 black-box 검증으로 확정 필요 |
| Recommended Fix | 모든 read 액션에 requireResourcePermission + 세션 tenant 만 사용(tenantId 인자 제거), getTenantId 폴백 제거, middleware JWT 서명 검증, 정적 가드 스캔을 CI 테스트로 고정 |
| Estimated Size | M |
| Dependency | - |
| Go-Live Blocker | Y |

##### DG-014 · Material issue — 자재출고 서버 검증 누락: BOM 구성품 여부·작업지시 상태·필요수량 상한·Lot.status·reservation 소유 미검증

| 항목 | 내용 |
|---|---|
| ID / Module | DG-014 / Material issue |
| Requirement | BP-MAT-003 · BP-TOBE-003 · QR 3절 |
| Current Implementation | 자재출고 서버 검증 누락: BOM 구성품 여부·작업지시 상태·필요수량 상한·Lot.status·reservation 소유 미검증 |
| Evidence | `material-issue.actions.ts:248-357`(작업지시는 tenant 만 확인) · :437-466(LOT 필수는 isLotTracked 품목만) · :617-649(reservationId 소유 미검증) · `getLotStockByItems:208-244`(Lot.status 미필터: QUARANTINE/ON_HOLD LOT 도 qtyAvailable>0 이면 출고) |
| Status / Severity / Type | **BUG** / **P1** / CODE |
| Risk | 다른 품목/다른 작업지시용 자재·격리 LOT 오투입 → 제조이력 오염 |
| Recommended Fix | 서버에서 BOM 구성품·WO 상태(RELEASED/IN_PROGRESS)·잔량·Lot.status=ACTIVE·reservation↔WO 소유 검증, 초과출고는 승인 |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | Y |

##### DG-015 · POP/Rework — POP 재작업 수량 입력 → 재작업 종결(completeRework/getReworkPendingList)이 개발자 전용 → 완제품입고 영구…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-015 / POP/Rework |
| Requirement | BP-POP-005 · E2E-02 |
| Current Implementation | POP 재작업 수량 입력 → 재작업 종결(completeRework/getReworkPendingList)이 개발자 전용 → 완제품입고 영구 차단 |
| Evidence | `process-progress.actions.ts:158-161,341-344`(assertDaewonFeatureScope) · `wip-receipt.helpers.ts`(UNRESOLVED_REWORK_ERROR 로 입고 차단) · `nav-config.ts:196`(재작업/보류관리 숨김) |
| Status / Severity / Type | **BUG** / **P1** / CONFIG |
| Risk | 재작업이 1건이라도 입력된 작업지시는 일반 사용자 권한으로 종결 불가(개발자 계정 'test' 개입 필요) |
| Recommended Fix | 재작업 종결/보류 화면·액션을 허용 범위에 포함(MANAGER 권한) 또는 POP 재작업 입력 비활성 |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | Y |

##### DG-016 · Quality — 불량 원인분석·시정조치·재발방지·품질현황 화면이 범위 밖(숨김) + 액션 개발자 전용

| 항목 | 내용 |
|---|---|
| ID / Module | DG-016 / Quality |
| Requirement | BP-TOBE-010 |
| Current Implementation | 불량 원인분석·시정조치·재발방지·품질현황 화면이 범위 밖(숨김) + 액션 개발자 전용 |
| Evidence | `nav-config.ts:199-204` · `daewon-scope.ts` 허용 목록에 quality/cause-analysis·corrective-action·recurrence-prevention·dashboard 없음 · docs/DAEWON-TODO.md 11절 |
| Status / Severity / Type | **PARTIAL** / **P1** / CONFIG |
| Risk | 계획서가 반복 강조한 '불량 원인·조치 이력화' 약속(현장평가 Q5) 미제공 |
| Recommended Fix | 허용 목록·메뉴 노출 + 권한 매핑 + 교육 |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | Y |

##### DG-017 · Security — 운영 계정 정책 위험: 공급사 공통 admin(mustChangePw=false), 개발자 'test'(OWNER·숨김 기능 전체) 운영 D…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-017 / Security |
| Requirement | BP-POP-001 · 요청 O절 |
| Current Implementation | 운영 계정 정책 위험: 공급사 공통 admin(mustChangePw=false), 개발자 'test'(OWNER·숨김 기능 전체) 운영 DB 존재, 개발용 'dev-pop'(PIN 보유 OPERATOR) 운영 DB 존재 |
| Evidence | Production users 조회(admin/test/dev-pop) · docs/DEPLOYMENT-VERCEL.md 5절 · `daewon-scope.ts:14`(loginId==='test' 하드코딩) · POP PIN 4자리 |
| Status / Severity / Type | **PARTIAL** / **P1** / SECURITY |
| Risk | 계정/비밀번호 1개 노출 시 전 기능·숨김 기능 접근. dev-pop 은 운영 데이터에 POP 실적 기록 가능 |
| Recommended Fix | 업체별 고유 비밀번호·변경 강제, test 계정 비활성/IP 제한/비밀 로테이션, dev-pop 삭제, 개발자 판정을 loginId 하드코딩 대신 플래그로 |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | Y |

##### DG-018 · Ops — 백업/PITR·DB·service role 키 교체 완료·WAF/레이트리밋 적용 여부를 코드로 확인할 수 없음

| 항목 | 내용 |
|---|---|
| ID / Module | DG-018 / Ops |
| Requirement | 요청 S/T절 |
| Current Implementation | 백업/PITR·DB·service role 키 교체 완료·WAF/레이트리밋 적용 여부를 코드로 확인할 수 없음 |
| Evidence | 백업 화면 숨김(Supabase Management 토큰 필요) · docs/DEPLOYMENT-VERCEL.md 4절(교체 필수)·5-2절('아직 설정하지 않음') |
| Status / Severity / Type | **OPS_CONFIRM_REQUIRED** / **P1** / OPS |
| Risk | 장애/오조작 시 복구 불가, 자격증명 노출 상태 지속 가능 |
| Recommended Fix | Supabase 플랜·일일 백업·PITR 확인 + 복구 리허설, 자격증명 교체 확인, Vercel WAF/Rate limit |
| Estimated Size | S |
| Dependency | 운영 담당 확인 |
| Go-Live Blocker | Y |


#### P2 (19건)

##### DG-019 · Receiving/Quality — 입고검사(ReceivingInspection)가 LOT 와 FK 연결되지 않음 (PO 품목만 참조)

| 항목 | 내용 |
|---|---|
| ID / Module | DG-019 / Receiving/Quality |
| Requirement | BP-MAT-002 · QR 2절 |
| Current Implementation | 입고검사(ReceivingInspection)가 LOT 와 FK 연결되지 않음 (PO 품목만 참조) |
| Evidence | `schema.prisma:2655-2670` · `receiving.actions.ts:359-369` · MANUAL LOT 경로는 LotNumberReservation 도 생성하지 않음 |
| Status / Severity / Type | **PARTIAL** / **P2** / DB |
| Risk | Raw LOT → 입고검사 결과 조회가 시간 근접 추정에 의존 |
| Recommended Fix | ReceivingInspection.lotId 추가 또는 InventoryTransaction 과 연결 |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-020 · Inventory — 입고·출고·완제품입고 취소/정정(역분개) 기능 없음 — 정정은 실사조정(MANAGER)뿐이며 WorkOrderMaterialLot/Mater…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-020 / Inventory |
| Requirement | QR 3절(취소/정정) |
| Current Implementation | 입고·출고·완제품입고 취소/정정(역분개) 기능 없음 — 정정은 실사조정(MANAGER)뿐이며 WorkOrderMaterialLot/MaterialReservation 을 되돌리지 않음 |
| Evidence | grep 취소/반납/cancelIssue 0건 · `adjustInventoryStock` |
| Status / Severity / Type | **MISSING** / **P2** / CODE |
| Risk | 오입고/오출고 정정 시 수불·LOT 연결 불일치 |
| Recommended Fix | 사유·승인 포함 역분개 트랜잭션(LOT 연결 역전) |
| Estimated Size | M |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-021 · Purchasing — 발주 상태 자유 변경(RECEIVED/CLOSED 임의 설정 가능) 및 siteId/supplierId/itemId 소유 미검증

| 항목 | 내용 |
|---|---|
| ID / Module | DG-021 / Purchasing |
| Requirement | BP-MAT-001 |
| Current Implementation | 발주 상태 자유 변경(RECEIVED/CLOSED 임의 설정 가능) 및 siteId/supplierId/itemId 소유 미검증 |
| Evidence | `purchase-order.actions.ts:290-352`(status 임의 설정) · :215-222(createPurchaseOrder 의 siteId 등 FK 소유 미검증) |
| Status / Severity / Type | **BUG** / **P2** / CODE |
| Risk | MRP 입고예정·발주잔량 계산 왜곡, 타 테넌트 FK 혼입 |
| Recommended Fix | 상태머신(DRAFT→ORDERED→PARTIAL/RECEIVED→CLOSED) + 소유 검증 |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-022 · Production — 공정 간 부분 이관 불가(선행 공정 COMPLETED 후에만 후속 착수), 완제품입고는 WO COMPLETED 후에만

| 항목 | 내용 |
|---|---|
| ID / Module | DG-022 / Production |
| Requirement | E2E-03 |
| Current Implementation | 공정 간 부분 이관 불가(선행 공정 COMPLETED 후에만 후속 착수), 완제품입고는 WO COMPLETED 후에만 |
| Evidence | `operation-status-integrity.ts:36,61` · `finished-goods.actions.ts:143-145` |
| Status / Severity / Type | **PARTIAL** / **P2** / PROCESS |
| Risk | 다품종 소량 현장에서 분할 납품/공정 중첩 불가(정책이면 문제 아님) |
| Recommended Fix | 현장 정책 확정 → 작업지시 분할 운영 또는 부분 이관 허용 |
| Estimated Size | M |
| Dependency | 현장 정책 |
| Go-Live Blocker | N |

##### DG-023 · POP — POP 에 비가동 사유 입력 없음(비가동사유 마스터 화면은 숨김)

| 항목 | 내용 |
|---|---|
| ID / Module | DG-023 / POP |
| Requirement | BP-TOBE-005 |
| Current Implementation | POP 에 비가동 사유 입력 없음(비가동사유 마스터 화면은 숨김) |
| Evidence | grep downtime/비가동 in app/pop = 0건 · `nav-config.ts:207` |
| Status / Severity / Type | **MISSING** / **P2** / CODE |
| Risk | 계획서 KPI 개선 메커니즘(비가동 요인 분석)의 현장 입력 근거 부족 |
| Recommended Fix | POP 비가동 사유 입력 + 설비 이벤트 연계 |
| Estimated Size | M |
| Dependency | DG-010 |
| Go-Live Blocker | N |

##### DG-024 · Monitoring — 현황판(/kiosk): 재공·납기·계획대비 미표시, 비로그인 공개(일 생산/불량 수량 노출), 헤더 문구 'SIZL-MES'

| 항목 | 내용 |
|---|---|
| ID / Module | DG-024 / Monitoring |
| Requirement | BP-TOBE-015 · BP-HW-004 |
| Current Implementation | 현황판(/kiosk): 재공·납기·계획대비 미표시, 비로그인 공개(일 생산/불량 수량 노출), 헤더 문구 'SIZL-MES' |
| Evidence | `kiosk-client.tsx:127-130` · `equipment-monitor.actions.ts:467-530` · docs/DEPLOYMENT-VERCEL.md 6절 |
| Status / Severity / Type | **PARTIAL** / **P2** / UI |
| Risk | 계획서가 약속한 통합 현황 미충족, 외부 노출 정책 미결 |
| Recommended Fix | 표시 항목 확장·접근키 도입·브랜드 문구 정리 |
| Estimated Size | M |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-025 · Quality — 검사성적서 출력·유압 테스트 전용 입력 없음(검사표준 수치 항목으로 수용 가능 여부 미검증)

| 항목 | 내용 |
|---|---|
| ID / Module | DG-025 / Quality |
| Requirement | BP-TOBE-009 |
| Current Implementation | 검사성적서 출력·유압 테스트 전용 입력 없음(검사표준 수치 항목으로 수용 가능 여부 미검증) |
| Evidence | grep 성적서/유압/hydraulic 0건 · docs/DAEWON-TODO.md 2절 |
| Status / Severity / Type | **MISSING** / **P2** / CODE |
| Risk | 고객 제출 성적서 작성 효율 기대효과 미달 |
| Recommended Fix | 수치형 검사표준 템플릿 검증 → 성적서 PDF 출력 |
| Estimated Size | M |
| Dependency | DG-002 |
| Go-Live Blocker | N |

##### DG-026 · Barcode — 라벨 재출력 통제·출력 이력(누가/언제/횟수)·동일 LOT 중복 라벨 정책·폐기 LOT 스캔 차단 없음

| 항목 | 내용 |
|---|---|
| ID / Module | DG-026 / Barcode |
| Requirement | QR 8절·9절 |
| Current Implementation | 라벨 재출력 통제·출력 이력(누가/언제/횟수)·동일 LOT 중복 라벨 정책·폐기 LOT 스캔 차단 없음 |
| Evidence | printedAt 은 입고 LOT 예약 전용(`schema.prisma:1550`) · PrintLog 모델 없음 · `barcode-print-dialog.tsx`(브라우저 인쇄) |
| Status / Severity / Type | **MISSING** / **P2** / CODE |
| Risk | 훼손 라벨 재출력·무효화 이력 없음 |
| Recommended Fix | PrintLog(LOT·사용자·시각·사유) + 재출력 승인 + 상태(CONSUMED/EXPIRED/QUARANTINE) 스캔 차단 |
| Estimated Size | M |
| Dependency | DG-004 |
| Go-Live Blocker | N |

##### DG-027 · Import/Export — 업로드: 수주·발주·재고·설비·검사표준 없음 / 내보내기: 수주·재고·MRP·LOT추적 등 없음 / 품목·BOM 등은 1,000행 단일 in…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-027 / Import/Export |
| Requirement | 요청 Q절 |
| Current Implementation | 업로드: 수주·발주·재고·설비·검사표준 없음 / 내보내기: 수주·재고·MRP·LOT추적 등 없음 / 품목·BOM 등은 1,000행 단일 interactive 트랜잭션 |
| Evidence | `*-excel.actions.ts` 5종 · `item-excel.actions.ts:10,248` · `export-excel.ts`(리포트 3종만 사용) |
| Status / Severity / Type | **PARTIAL** / **P2** / CODE |
| Risk | 대량 이관·증빙 자료 추출 한계, 트랜잭션 타임아웃(기본 5s) 롤백 가능 |
| Recommended Fix | 청크/타임아웃 상향·오류행 리포트·누락 업/다운로드 추가 |
| Estimated Size | M |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-028 · Performance — 목록 전체 조회(findMany 406건 중 take/skip 44건), getWorkOrdersForReceipt 가 COMPLETED W…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-028 / Performance |
| Requirement | 요청 8절 |
| Current Implementation | 목록 전체 조회(findMany 406건 중 take/skip 44건), getWorkOrdersForReceipt 가 COMPLETED WO 전체에 대해 N+1 품질 게이트 조회 |
| Evidence | `finished-goods.actions.ts:143-229` · `inventory.actions.ts:58` · `lot.actions.ts:52` · `work-order.actions.ts:223` |
| Status / Severity / Type | **PARTIAL** / **P2** / CODE |
| Risk | 운영 데이터 누적 시 입고/최종검사/재고/LOT 화면 지연 |
| Recommended Fix | 서버 페이지네이션·기간 필터·게이트 일괄 조회 |
| Estimated Size | M |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-029 · Resilience — 서버측 멱등키/중복 제출 방지 및 오프라인 큐 없음(잔량 한도·row lock 으로만 제한)

| 항목 | 내용 |
|---|---|
| ID / Module | DG-029 / Resilience |
| Requirement | 요청 R절 |
| Current Implementation | 서버측 멱등키/중복 제출 방지 및 오프라인 큐 없음(잔량 한도·row lock 으로만 제한) |
| Evidence | `pop.actions.ts:924-1435` · `receiving.actions.ts` · grep navigator.onLine 0건 |
| Status / Severity / Type | **MISSING** / **P2** / CODE |
| Risk | 네트워크 재시도/더블탭 시 잔량 범위 내 중복 실적·입출고 가능 |
| Recommended Fix | 요청 ID 기반 멱등 처리 + 클라이언트 재시도 정책 |
| Estimated Size | M |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-030 · Audit — 감사로그 누락 지점: POP 시작/실적(13 writes/0 audit), LOT 상태변경·생성, 공정마스터, 작업표준서, 재작업 종결, 채…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-030 / Audit |
| Requirement | 요청 P절 |
| Current Implementation | 감사로그 누락 지점: POP 시작/실적(13 writes/0 audit), LOT 상태변경·생성, 공정마스터, 작업표준서, 재작업 종결, 채번규칙 |
| Evidence | src/lib/actions 쓰기/감사 호출 비교 스캔: pop.actions.ts · lot.actions.ts · work-center.actions.ts · work-standards.actions.ts · process-progress.actions.ts · numbering-rule.actions.ts |
| Status / Severity / Type | **PARTIAL** / **P2** / CODE |
| Risk | 누가/언제/무엇을 변경했는지 추적 불가 구간 |
| Recommended Fix | 해당 액션에 recordAuditLog 추가(실적은 ProductionResult.operatorId 가 부분 보완) |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-031 · POP — POP 불량 등록이 검사표준(InspectionSpec) 존재에 종속 — 없으면 실적 전체 롤백

| 항목 | 내용 |
|---|---|
| ID / Module | DG-031 / POP |
| Requirement | BP-POP-005 · E2E-02 |
| Current Implementation | POP 불량 등록이 검사표준(InspectionSpec) 존재에 종속 — 없으면 실적 전체 롤백 |
| Evidence | `self-inspection.helpers.ts:93-97` · `pop.actions.ts:1208,1364` |
| Status / Severity / Type | **BUG** / **P2** / CODE |
| Risk | 검사표준 미등록 품목에서 불량이 있는 실적 등록 불가(현장 입력 차단) |
| Recommended Fix | 표준 없으면 불량 기록만 저장하고 검사 연동은 건너뛰거나 경고 |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | N(DG-002 해소 시) |

##### DG-032 · Ops — CI/자동 테스트 파이프라인·에러 모니터링·구조화 로그 없음

| 항목 | 내용 |
|---|---|
| ID / Module | DG-032 / Ops |
| Requirement | 요청 R/S절 |
| Current Implementation | CI/자동 테스트 파이프라인·에러 모니터링·구조화 로그 없음 |
| Evidence | .github 없음(workflows 0) · main 브랜치 보호 없음 · Sentry류 없음 · tests/*.spec.ts 2개(CNS 유래, playwright 설정 없음) · scripts/test-*.ts 49개는 수동 실행 |
| Status / Severity / Type | **MISSING** / **P2** / OPS |
| Risk | 회귀·배포 사고 탐지 지연 |
| Recommended Fix | GitHub Actions(type-check/lint/check:server-actions/test:*)·에러 수집·알림 |
| Estimated Size | M |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-033 · Security — EdgeGateway.apiKey 가 cuid() 기본값·평문 저장, ingest 페이로드 건수/크기 제한 없음

| 항목 | 내용 |
|---|---|
| ID / Module | DG-033 / Security |
| Requirement | BP-TOBE-019 |
| Current Implementation | EdgeGateway.apiKey 가 cuid() 기본값·평문 저장, ingest 페이로드 건수/크기 제한 없음 |
| Evidence | `schema.prisma:2371` · `lib/ncwatch/auth.ts` · `status/route.ts` |
| Status / Severity / Type | **PARTIAL** / **P2** / SECURITY |
| Risk | 키 추측/유출 시 설비 데이터 위조 |
| Recommended Fix | 암호학적 난수·해시 저장·로테이션·본문 크기 제한 |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-034 · Barcode — Brother QL-820NWB 인쇄: 브라우저 인쇄(@page size:auto, 라벨 폭 240px 고정) — 용지 규격·드라이버·자동 …

| 항목 | 내용 |
|---|---|
| ID / Module | DG-034 / Barcode |
| Requirement | BP-HW-003 |
| Current Implementation | Brother QL-820NWB 인쇄: 브라우저 인쇄(@page size:auto, 라벨 폭 240px 고정) — 용지 규격·드라이버·자동 컷 미검증 |
| Evidence | `barcode-print-dialog.tsx:58-67` · `barcode-label.tsx:51` |
| Status / Severity / Type | **FIELD_TEST_REQUIRED** / **P2** / DEVICE |
| Risk | 라벨 잘림/배율/다량 출력 실패 |
| Recommended Fix | 62mm DK 롤 기준 템플릿 + 실기기 시험(필요 시 Brother 모바일 SDK/로컬 에이전트) |
| Estimated Size | S |
| Dependency | 실기기 |
| Go-Live Blocker | 조건부 |

##### DG-035 · Field UX — 스마트패드/키오스크 현장 UX 미검증 — 입고·출고·출하·검사는 관리자 웹 다이얼로그(데스크톱 레이아웃), POP 은 터치 최적(h-14~1…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-035 / Field UX |
| Requirement | BP-HW-001/002 · 요청 9절 |
| Current Implementation | 스마트패드/키오스크 현장 UX 미검증 — 입고·출고·출하·검사는 관리자 웹 다이얼로그(데스크톱 레이아웃), POP 은 터치 최적(h-14~16)이나 오프라인/전체화면/세션 만료 처리 없음 |
| Evidence | `app/pop/components/pop-number-pad.tsx` · `production-client.tsx:636-676` · grep wakeLock/requestFullscreen/onLine 0건 |
| Status / Severity / Type | **FIELD_TEST_REQUIRED** / **P2** / DEVICE |
| Risk | 현장 입력 오류·장애 시 작업 중단 |
| Recommended Fix | 태블릿 전용 입출고/검사 화면 또는 POP 통합, 실기기 시험 |
| Estimated Size | M |
| Dependency | DG-005 |
| Go-Live Blocker | 조건부 |

##### DG-036 · Outsource — 외주 복귀 후 공정 완료는 POP 수동 단계, 외주 단가 0·성적서 미연결, 외주 PO 를 'OS-'/[OUTSOURCING] 명명으로 식별

| 항목 | 내용 |
|---|---|
| ID / Module | DG-036 / Outsource |
| Requirement | BP-PROD-005 · E2E-05 |
| Current Implementation | 외주 복귀 후 공정 완료는 POP 수동 단계, 외주 단가 0·성적서 미연결, 외주 PO 를 'OS-'/[OUTSOURCING] 명명으로 식별 |
| Evidence | `outsourcing.actions.ts:313-324`(unitPrice 0) · :169-171 · :596-599(복귀 시 동일 공정 IN_PROCESS) |
| Status / Severity / Type | **PARTIAL** / **P2** / PROCESS |
| Risk | 외주 공정 완료 누락·원가 추적 불가 |
| Recommended Fix | 복귀·검사 합격 시 공정 완료 연결 옵션, 구분 플래그 컬럼 |
| Estimated Size | M |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-037 · Equipment — 설비 신호취득/현장배선 4식·네트워크 공사 — 현장 작업(코드 범위 아님)

| 항목 | 내용 |
|---|---|
| ID / Module | DG-037 / Equipment |
| Requirement | BP-NW-001/002 · BP-TOBE-006 |
| Current Implementation | 설비 신호취득/현장배선 4식·네트워크 공사 — 현장 작업(코드 범위 아님) |
| Evidence | 3자 협약 후 N/W 구축 일정(통화기록 2026-09-14) · 사업비 N/W 1,800만원 |
| Status / Severity / Type | **FIELD_TEST_REQUIRED** / **P2** / NETWORK |
| Risk | 설비 데이터 수집 불가 |
| Recommended Fix | 현장 공사 및 신호 시험 |
| Estimated Size | L |
| Dependency | 현장 일정 |
| Go-Live Blocker | 조건부(DG-010) |


#### P3 (6건)

##### DG-038 · Duplicate logic — 동일 KPI 다중 정의: 설비 가동률 산출 경로 2종 이상(NCWatch 일보 vs EquipmentEvent RUN vs 분석 화면), 불…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-038 / Duplicate logic |
| Requirement | 요청 7절 |
| Current Implementation | 동일 KPI 다중 정의: 설비 가동률 산출 경로 2종 이상(NCWatch 일보 vs EquipmentEvent RUN vs 분석 화면), 불량률 5종(DG-011) |
| Evidence | `equipment-monitor.actions.ts:494-516` · `kpi.actions.ts:423-480` · `equipment-analysis.actions.ts` |
| Status / Severity / Type | **PARTIAL** / **P3** / CODE |
| Risk | 화면 간 수치 불일치 |
| Recommended Fix | 단일 산출 서비스로 통합 |
| Estimated Size | M |
| Dependency | DG-011 |
| Go-Live Blocker | N |

##### DG-039 · Stale routes — '준비 중' 스텁이 허용 경로에 포함: /lot-history, /trace-reverse, /outsourcing

| 항목 | 내용 |
|---|---|
| ID / Module | DG-039 / Stale routes |
| Requirement | 요청 7절 |
| Current Implementation | '준비 중' 스텁이 허용 경로에 포함: /lot-history, /trace-reverse, /outsourcing |
| Evidence | `daewon-scope.ts:61,73-74` · 해당 page.tsx |
| Status / Severity / Type | **DEPRECATED** / **P3** / UI |
| Risk | 현장 사용자 혼선 |
| Recommended Fix | 허용 목록에서 제거 또는 구현 |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-040 · Dead code — 미사용/미기록: SalesOrderItem.producedQty(기록 코드 없음), MaterialConsumption(기록 없음·원가가 읽…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-040 / Dead code |
| Requirement | 요청 7절 |
| Current Implementation | 미사용/미기록: SalesOrderItem.producedQty(기록 코드 없음), MaterialConsumption(기록 없음·원가가 읽음), getLotForwardTrace/BackwardTrace(무호출·무인증) |
| Evidence | grep 결과 · `lot.actions.ts:258-268` |
| Status / Severity / Type | **DEPRECATED** / **P3** / CODE |
| Risk | 오해·원가 계산 공백 |
| Recommended Fix | 정리 또는 실제 연결 |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-041 · Legacy residue — NMES/CNS 잔재: 쿠키 nmes-*, 'SIZL-MES' 문구, siteId ?? 'site-a' 폴백, Cns* 명명, 청운 전용 모델

| 항목 | 내용 |
|---|---|
| ID / Module | DG-041 / Legacy residue |
| Requirement | 요청 7절 |
| Current Implementation | NMES/CNS 잔재: 쿠키 nmes-*, 'SIZL-MES' 문구, siteId ?? 'site-a' 폴백, Cns* 명명, 청운 전용 모델 |
| Evidence | `pop.actions.ts:472` · `kiosk-client.tsx:130` · docs/DAEWON-TODO.md 7절 |
| Status / Severity / Type | **PARTIAL** / **P3** / CODE |
| Risk | 혼선·잘못된 폴백 |
| Recommended Fix | 단계적 정리 |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-042 · LOT — LOT 상태 변경이 임의 문자열 허용·감사로그 없음, createLot 은 tenantId/itemId 를 클라이언트 값 신뢰

| 항목 | 내용 |
|---|---|
| ID / Module | DG-042 / LOT |
| Requirement | BP-LOT-001 |
| Current Implementation | LOT 상태 변경이 임의 문자열 허용·감사로그 없음, createLot 은 tenantId/itemId 를 클라이언트 값 신뢰 |
| Evidence | `lot.actions.ts:101-138` |
| Status / Severity / Type | **BUG** / **P3** / CODE |
| Risk | 잘못된 상태값·소유 미검증 |
| Recommended Fix | enum 검증·감사로그·소유 검증 |
| Estimated Size | S |
| Dependency | DG-013 |
| Go-Live Blocker | N |

##### DG-043 · Import — 엑셀 import 가 단일 interactive 트랜잭션(Prisma 기본 5s) — 1,000행에서 타임아웃 가능, 부분 성공/청크 없음

| 항목 | 내용 |
|---|---|
| ID / Module | DG-043 / Import |
| Requirement | 요청 Q절 |
| Current Implementation | 엑셀 import 가 단일 interactive 트랜잭션(Prisma 기본 5s) — 1,000행에서 타임아웃 가능, 부분 성공/청크 없음 |
| Evidence | `item-excel.actions.ts:248` |
| Status / Severity / Type | **PARTIAL** / **P3** / CODE |
| Risk | 대량 적재 롤백 |
| Recommended Fix | 타임아웃 상향/청크 |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | N |


#### INFO (4건)

##### DG-044 · Deployment — HEAD 5d7b74c 는 Vercel 배포 기록 없음. Production 은 1683f17(success). 5d7b74c 는 scrip…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-044 / Deployment |
| Requirement | 요청 S절 |
| Current Implementation | HEAD 5d7b74c 는 Vercel 배포 기록 없음. Production 은 1683f17(success). 5d7b74c 는 scripts/docs/CLI 라이브러리만 변경 → 런타임 영향 없음 |
| Evidence | GitHub API deployments(Production, vercel[bot]) 최신 1683f17 · commit status/check-run 0건 · git show --stat 5d7b74c |
| Status / Severity / Type | **OPS_CONFIRM_REQUIRED** / **INFO** / OPS |
| Risk | 대시보드 확인 전까지 원인 불명(Git 연동/빌드 건너뜀 등) |
| Recommended Fix | Vercel 대시보드에서 배포 로그/Ignored Build Step 확인(재배포 금지) |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-045 · DB — RLS 115/115 · 마이그레이션 5건 모두 적용(finished) · 트랜잭션 테이블 전부 0 · Master 수치(Item 427/B…

| 항목 | 내용 |
|---|---|
| ID / Module | DG-045 / DB |
| Requirement | 요청 0절 |
| Current Implementation | RLS 115/115 · 마이그레이션 5건 모두 적용(finished) · 트랜잭션 테이블 전부 0 · Master 수치(Item 427/BOM 134/BOMItem 909/Supplier 19/ItemSupplier 264) 일치 |
| Evidence | Production READ ONLY(SET TRANSACTION READ ONLY, transaction_read_only=on) |
| Status / Severity / Type | **IMPLEMENTED** / **INFO** / DB |
| Risk | - |
| Recommended Fix | - |
| Estimated Size | - |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-046 · Document — 사업계획서 정합: v10 KPI 는 2종(요청서는 4종), '약 86개 데이터모델'(실제 114), 구판 PDF 에 OPC-UA/ZEISS …

| 항목 | 내용 |
|---|---|
| ID / Module | DG-046 / Document |
| Requirement | 요청 10절 |
| Current Implementation | 사업계획서 정합: v10 KPI 는 2종(요청서는 4종), '약 86개 데이터모델'(실제 114), 구판 PDF 에 OPC-UA/ZEISS 문구 잔존, 설비 PC 위치 설명이 문서 내 2종(원자재 보관소/중앙) |
| Evidence | 2026_사업계획서_상생형_대원정밀_v10.docx · 현장평가 대응 준비자료.docx |
| Status / Severity / Type | **PARTIAL** / **INFO** / DOCUMENT |
| Risk | 감리 시 수치/범위 불일치 지적 |
| Recommended Fix | 문서 정정/합의 |
| Estimated Size | S |
| Dependency | - |
| Go-Live Blocker | N |

##### DG-047 · Stack — PostgreSQL 17.11 · Next 14.2.35 · Prisma 5.x · Node engines 22.x(로컬 24.x)

| 항목 | 내용 |
|---|---|
| ID / Module | DG-047 / Stack |
| Requirement | 요청 0절 |
| Current Implementation | PostgreSQL 17.11 · Next 14.2.35 · Prisma 5.x · Node engines 22.x(로컬 24.x) |
| Evidence | Production 조회 · package.json |
| Status / Severity / Type | **IMPLEMENTED** / **INFO** / CONFIG |
| Risk | - |
| Recommended Fix | - |
| Estimated Size | - |
| Dependency | - |
| Go-Live Blocker | N |


---

## L. Recommended Development Order (GAP 결과 기반 재설계)

> 사전 고정된 Phase 구성이 아니라 이번 GAP 의존관계에서 도출한 **제안**이다. 순서 근거: ① 보안·무결성(데이터가 들어오기 전에 막아야 함) → ② LOT/추적(데이터 모델 결정을 먼저 확정) → ③ 업무 필드·이관 도구 → ④ KPI/품질 문서 → ⑤ 설비 연동(현장 일정 의존) → ⑥ 운영 인프라.

### Phase 10 — 보안·무결성·범위 하드닝 (스키마 변경 없음)
| 항목 | 내용 |
|---|---|
| 목표 | 데이터가 들어오기 전에 비인증 읽기·검증 누락·개발자 전용 차단점·운영 계정 문제 해소 |
| 포함 GAP | DG-013, DG-014, DG-015, DG-016, DG-017, DG-021, DG-031, DG-033, DG-042 |
| 예상 변경 파일 | `src/lib/actions/*.actions.ts`(읽기 104개 가드·tenantId 인자 제거), `src/lib/auth.ts`(폴백 제거), `src/middleware.ts`(서명 검증), `src/lib/auth/daewon-scope.ts`·`nav-config.ts`(재작업/원인·조치 개방), `material-issue.actions.ts`, `self-inspection.helpers.ts`, `purchase-order.actions.ts` |
| DB 변경 | 없음 |
| 위험 | 권한 회귀(화면 일부가 비어 보임) — `test-role-permission-enforcement` 확장 필요 |
| 규모 | M |
| 완료조건 | 정적 가드 스캔 unguarded 0(허용목록 명시) · 역할별 접근 테스트 통과 · 재작업 종결 일반 사용자 가능 · 자재출고 서버검증 테스트 · 비운영 black-box 로 비인증 호출 차단 확인 |

### Phase 11 — LOT 정책·채번·라벨/스캔·추적성 완성
| 항목 | 내용 |
|---|---|
| 목표 | LOT 규칙 확정 → 품목 정책 일괄 적용 → LOT 단위 QR/바코드·카메라 스캔 → 정/역추적 → 재출력 통제 |
| 포함 GAP | DG-001(스크립트), DG-003, DG-004, DG-005, DG-006, DG-007, DG-019, DG-020, DG-026, DG-034 |
| 예상 변경 파일 | `src/lib/lot-numbering/*`, `components/common/barcode/*`(+카메라 스캔), `lot-lineage.actions.ts`, `receiving/material-issue/finished-goods/shipment 다이얼로그`, 품목 LOT 정책 일괄 갱신 스크립트 |
| DB 변경 | 소규모: `ReceivingInspection.lotId`, `LabelPrintLog`(재출력 이력) — migration 1건 |
| 위험 | master baseline hash 변경, 채번 규칙 결정 지연 |
| 규모 | L |
| 완료조건 | 테스트 데이터로 Raw→Receiving→Issue→Result→FG→Shipment→Customer 양방향 추적 PASS · 카메라 스캔 실기기 시험 · 재출력 이력 |

### Phase 12 — 수주 확장 필드 + 데이터 이관 도구
| 항목 | 내용 |
|---|---|
| 목표 | 수주 조선기자재 필드·필터, 기초재고/Open SO·PO/WIP 이관(dry-run·승인·감사) |
| 포함 GAP | DG-008, DG-012, DG-027, DG-043, DG-002(이관 실행은 별도 승인) |
| 예상 변경 파일 | `schema.prisma`(SalesOrder/Item), `sales-order.*`, 엑셀 업/다운로드, 신규 `opening-balance.*` |
| DB 변경 | 있음(컬럼 추가, OPENING 거래유형 또는 ADJUST 규약) |
| 위험 | 이관 오류의 수불 오염 → dry-run/rollback 필수 |
| 규모 | L |
| 완료조건 | 이관 리허설 후 재고 합계 = 원본, 수주 현황 필터/출력 시연 |

### Phase 13 — KPI·품질 문서·현황판
| 항목 | 내용 |
|---|---|
| 목표 | 사업 KPI 산출 정의 확정·단일 서비스화, 계측기 검교정, 성적서, 비가동 사유, 현황판 확장 |
| 포함 GAP | DG-009, DG-011, DG-023, DG-024, DG-025, DG-038 |
| 예상 변경 파일 | `kpi.actions.ts` → 신규 KPI 서비스, 계측기 모델/화면, 성적서 PDF, `kiosk-client.tsx` |
| DB 변경 | 있음(계측기 모델 1~2) |
| 위험 | KPI 정의 합의(분모·시간) 지연 |
| 규모 | L |
| 완료조건 | 계획서 산식과 일치하는 KPI 2종 + 납기준수율·작업공수 산출·엑셀, 검교정 임박 식별 |

### Phase 14 — 설비 연동 (에이전트 + 현장 시험)
| 항목 | 내용 |
|---|---|
| 목표 | 제어기 확인 → NCWatch 또는 FOCAS 에이전트 → 4대 연동 → 가동/알람/카운트 검증 |
| 포함 GAP | DG-010, DG-037, DG-033, DG-036 |
| 예상 변경 파일 | 에이전트(별도 리포), `api/lms/ncwatch/*` 보강, 설비 매핑 |
| DB 변경 | 없음(또는 키 해시 컬럼) |
| 위험 | 현장 네트워크/배선 일정 |
| 규모 | L |
| 완료조건 | 4대 heartbeat·status·alarm 24h 수집, offline 판정·재연결 시험 |

### Phase 15 — 운영 인프라·성능·현장 시험(UAT)
| 항목 | 내용 |
|---|---|
| 목표 | CI·모니터링·백업 리허설·WAF·성능·태블릿/키오스크/프린터 UAT·교육 |
| 포함 GAP | DG-018, DG-028, DG-029, DG-030, DG-032, DG-034, DG-035, DG-044 |
| 예상 변경 파일 | `.github/workflows`, 페이지네이션 적용 화면, 멱등키, 감사로그 보강 |
| DB 변경 | 최소(멱등키 테이블) |
| 위험 | 일정 |
| 규모 | M |
| 완료조건 | CI green · 복구 리허설 문서화 · 현장 시험 체크리스트 통과 |

---

## M. Go-Live Checklist

| 영역 | 판정 | 비고 |
|---|---|---|
| Master | **NOT READY** | 라우팅·설비·검사표준·후공정 공정 미적재, LOT 정책 미설정(DG-001/002) |
| Sales | **NOT READY** | 확장 필드(DG-008), Open SO 이관 도구(DG-012) |
| Material | **NOT READY** | LOT 채번(DG-003), 출고 검증(DG-014), 기초재고(DG-012) |
| Inventory | **NOT READY** | 기초재고 이관 기능(DG-012), 취소/정정(DG-020) |
| Production | **NOT READY** | 작업지시 생성 불가(DG-002), 재작업 종결(DG-015) |
| POP | **FIELD TEST** | 코드 구현 ✅, 실기기/오프라인 시험, 계정/PIN 발급(운영 작업자 0명) |
| Quality | **NOT READY** | 검교정(DG-009)·성적서(DG-025)·원인/조치 공개(DG-016) |
| LOT | **NOT READY** | 추적 단절(DG-006/007) |
| Shipment | **NOT READY** | 품목 LOT 설정 전제(DG-001) — 설정 후 코드는 READY |
| Equipment | **NOT READY** | 에이전트 미개발(DG-010) + 현장 공사 |
| Barcode | **NOT READY** | LOT 미포함·카메라 스캔(DG-004/005) + 프린터 시험 |
| Security | **NOT READY** | DG-013, DG-017 |
| Backup | **NOT READY (OPS 확인)** | DG-018 |
| Monitoring | **FIELD TEST** | UI ✅, 데이터 없음, 현황판 항목 보강(DG-024) |
| KPI | **NOT READY** | DG-011 |
| Training | **NOT READY** | 사용자/관리자 교육 자료·매뉴얼 저장소 내 없음(사업계획서상 교육 이수는 별도 계획) |

---

## N. 반드시 답해야 할 질문 20개

**1. 사업계획서에 약속한 기능 중 미구현 기능은 정확히 무엇인가?**
- **MISSING**: 계측기 검교정관리(BP-QUAL-005) · 지연/비가동/품질이상 알림·조치 기록(BP-TOBE-016) · 카메라 기반 바코드 촬영·인식(BP-HW-002/TOBE-003) · POP 비가동 사유 입력(BP-TOBE-005) · FOCAS 수집 에이전트(BP-TOBE-019) · 유압 테스트 전용 입력/검사성적서(BP-TOBE-009).
- **부분**: 수주 조선기자재 확장 필드(호선·블록·도면·선급·고객PO·인수부서), LOT 단위 바코드, LOT 자동 채번, KPI(PPM·납기준수율).

**2. 부분 구현됐지만 실제 운영에서 끊기는 기능은?**
LOT 자동 채번(차단) · LOT 바코드/스캔(품목 단위) · 역/정방향 추적(WO 홉 미탐색) · 재작업 종결(개발자 전용) · 현황판(재공·납기 없음) · 불량 원인/조치(숨김) · 외주 복귀 후 공정 완료(수동).

**3. 수주부터 출하까지 E2E 가 코드상 완전히 연결되어 있는가?**
**연결되어 있다(코드 기준)** — 수주 → 계획 → 작업지시 → 자재출고(WIP 생성) → POP → 완제품입고 → 출하 → 수주 `shippedQty`/상태. 단 현재 운영 설정(LOT 정책·라우팅·채번)으로는 흐르지 않는다(DG-001/002/003). 수동 DB 수정이 필요한 코드 구간은 발견되지 않았다.

**4. 자재 발주부터 입고·재고·불출까지 완전히 연결되어 있는가?**
**예(코드)**: MRP → DRAFT PO → ORDERED → 입고(재고·수불·감사) → 출고(LOT 분할). 약점: 입고검사↔LOT 비연결, 출고 서버 검증 누락, 취소/정정 없음, 기초재고 이관 없음.

**5. 작업지시부터 POP·WIP·완제품입고까지 완전히 연결되어 있는가?**
**예(코드)**. 약점: 재작업 종결 차단, 불량 등록의 검사표준 의존, 공정 간 부분 이관 불가, 완제품입고는 WO 완료 후에만.

**6. 품질검사가 생산실적 및 LOT 와 연결되어 있는가?**
**부분**: 불량 → QualityInspection(작업지시 공정 단위, 자주검사) ✅, FINAL 검사 → 입고/출하 게이트 ✅. 그러나 `QualityInspection.lotId` 는 선택 필드이며 POP 자동 생성 건은 미설정, 입고검사는 LOT FK 가 없다. 설비는 직접 FK 없이 공정/배정 경유.

**7. Raw LOT 부터 고객 출하까지 Forward Trace 가 가능한가?**
**PARTIAL** — 원자재 LOT → 작업지시·공정·실적·작업자·설비까지만 화면에 표시, 완제품 LOT·출하·고객은 이어지지 않는다(DG-007).

**8. 고객 출하에서 Raw LOT 까지 Reverse Trace 가 가능한가?**
**BROKEN(현 UI)** — 출하 → 완제품 LOT → 작업지시/설비/작업자는 가능하나 투입 원자재 LOT/공급사는 조회되지 않는다. 데이터(WorkOrderMaterialLot)는 존재하므로 조회 확장(스키마 변경 없음)으로 해소 가능(DG-006).

**9. 외주공정이 정상적인 생산 Flow 의 일부로 구현되어 있는가?**
**부분 예**: WIP 외주출고/입고/검사/재외주 분리는 정식 구현. 복귀 후 공정 완료와 단가/성적서 연결은 수동·미구현(DG-036).

**10. POP 는 실제 현장 Tablet/Kiosk 에서 쓸 준비가 되어 있는가?**
**소프트웨어는 대부분 준비, 현장 시험 필요**: 터치 UI·PIN·세션·트랜잭션 ✅. 미비: 오프라인/전체화면, 카메라 스캔, 운영 작업자 계정/PIN 미발급(운영 DB 작업자 0명, dev-pop 만 존재), 불량 등록의 검사표준 의존(DG-031), 재작업 종결(DG-015).

**11. Barcode/Label 기능은 실제 현장 Test 만 남은 상태인가?**
**아니다.** LOT 미인코딩·스캔 LOT 미해석·재출력 통제 없음 등 *소프트웨어 개발이 먼저*(DG-004/005/026). 그 후 프린터 현장 시험(DG-034).

**12. CNC/MCT 설비연동은 코드가 준비된 상태인가, 추가 개발이 필요한가?**
서버 ingest 는 준비. **수집 에이전트(FOCAS 또는 NCWatch 기반)는 추가 개발/설치가 필요**하고 제어기 기종 확인이 선행된다(DG-010).

**13. 설비 Monitoring 은 실제 신호 연결만 남았는가?**
화면/집계는 준비. 신호 연결 외에 **에이전트 + Equipment 마스터 + 게이트웨이 키 + NCWatch/태그 매핑**이 남아 있다.

**14. 사업 KPI 4종을 MES 데이터로 측정할 수 있는가?**
**데이터는 충분, 산출은 미완**: UPH·작업공수는 PARTIAL(정의 상이), 불량률은 PARTIAL(분모·PPM), 납기준수율은 NOT_MEASURABLE(로직 없음). 모두 개발자 전용 화면이다. (v10 계획서 공식 KPI 는 2종.)

**15. 각 중요 Server Action 의 Tenant/Permission 보호가 충분한가?**
쓰기 액션은 충분한 편(리소스 권한+세션 tenant). **읽기 액션 104개는 부족**하고 일부는 tenant 필터가 없다(DG-013).

**16. LOT/재고/생산/출하에서 데이터 무결성 위험은 없는가?**
수량 로직은 견고하나 ① 자재출고 검증 누락(DG-014) ② FG 입고(LOT 키)↔출하(비LOT 키) 불일치(DG-001) ③ 멱등키 없음(DG-029) ④ PO 상태 자유 변경(DG-021) ⑤ 취소/정정 없음(DG-020)이 위험이다.

**17. 중복 계산 로직이나 서로 다른 정책을 가진 코드가 존재하는가?**
예 — 불량률 5종, 설비 가동률 2종 이상, LOT 번호 생성 3경로, 죽은 필드/액션(D-19, DG-011/038/040).

**18. Go-Live 를 막는 P0/P1 은 무엇인가?**
P0: DG-001, DG-002. P1: DG-003~DG-018(16건) — 특히 DG-013(비인증 읽기)·DG-006/007(추적)·DG-008·DG-009·DG-010·DG-011·DG-012.

**19. 실제 데이터 이관 전 반드시 수정해야 할 것은?**
DG-013(보안) → DG-014/015/016/017(무결성·범위·계정) → LOT 정책 결정 및 일괄 적용(DG-001/003) → 기초재고/Open SO·PO 이관 도구(DG-012) → 라우팅/설비/검사표준 적재(DG-002). 순서가 바뀌면 오염된 데이터를 되돌리기 어렵다(취소/정정 기능 없음, DG-020).

**20. 실제 데이터 이관 없이 지금 할 수 있는 다음 개발 작업의 최적 순서는?**
Phase 10(보안·무결성·범위) → Phase 11(LOT/라벨/스캔/추적, 스키마 소규모) → Phase 12(수주 확장·이관 도구) → Phase 13(KPI·검교정·성적서) → Phase 14(설비 에이전트) → Phase 15(CI·백업·UAT). 근거는 L 섹션.

---

## O. 방법·한계

- **방법**: git/schema/migration 읽기, route·Server Action 전수 정적 스캔(82 파일/520 export), 핵심 흐름 코드 정독(receiving·material-issue·pop·finished-goods·shipment·outsourcing·lot-lineage·kpi), Production READ ONLY 조회 2회(`SET TRANSACTION READ ONLY`, SELECT 만), GitHub deployments/status API(GET) 조회, 사업계획서 DOCX 3종 텍스트 추출.
- **하지 않은 것**: 실행/빌드/테스트 실행, Vercel·Supabase 대시보드 확인(토큰/접근 없음), 실기기·브라우저·프린터 시험, 부하 시험, 비인증 호출의 런타임 재현.
- **정적 스캔 한계**: 가드 판정은 함수 본문 내 `require*/authorize*/assert*` 토큰 휴리스틱(헬퍼를 통한 간접 가드는 수동 확인한 범위에서만 보정). 실제 개별 함수는 Phase 10 에서 재확인한다.
- **요청서 vs 계획서 차이**: 요청서는 KPI 4종·'설비 PLC' 문구이나 v10 최종 계획서는 KPI 2종·'FOCAS' 로 기술(DG-046).

---

## P. 최종 요약 (요청 14절 포맷)

```
DAEWON-MES PHASE 9 FINAL GAP AUDIT

Baseline:
- Commit: 5d7b74cc48b23b799b29bb009ff6412df87050e6
- Branch: main (origin/main 일치, ahead 0 / behind 0)
- Working tree: tracked clean (untracked: docs/DAEWON-MRP-GAP-ANALYSIS.md, 본 산출물)

MRP:
- Phase 1~8 COMPLETE
- Legacy Excel Retirement APPROVED

Business Plan Coverage:
- Total requirements: 80 (분모 75, NOT_REQUIRED 5 제외)
- Implemented: 42 (56.0%)
- Partial: 21 (28.0%)
- Missing: 2 (2.7%)
- Field test: 10 (13.3%)
- Coverage(Implemented 기준): 56.0%

GAP:
- P0: 2
- P1: 16
- P2: 19
- P3: 6
- INFO: 4

E2E:
- Normal Production: PARTIAL
- Defect/Rework: PARTIAL
- Partial Production: PARTIAL
- Partial Shipment: PASS
- Outsource: PARTIAL
- LOT Reverse Trace: FAIL
- Equipment Integration: FIELD_TEST_REQUIRED

LOT Traceability:
- Forward: PARTIAL
- Reverse: BROKEN

Security:
- Result: 쓰기 액션 양호 / 읽기 액션 104개 비인증(DG-013) / 계정 정책(DG-017) — NOT READY

Performance:
- Result: 정적 점검상 무페이지 전체 조회·N+1 존재(DG-028) — 운영 누적 시 위험, 부하 시험 미수행

Field Readiness:
- POP: 소프트웨어 준비 / 현장 시험 필요 (FIELD_TEST_REQUIRED)
- Tablet: 카메라 스캔 미구현 (MISSING)
- Kiosk: 표시 항목 부족 (PARTIAL)
- Barcode: LOT 미포함·재출력 통제 없음 (PARTIAL → 개발 선행)
- Equipment: 에이전트 미개발 (MISSING)
- Monitoring: UI 준비 / 데이터 없음 (FIELD_TEST_REQUIRED)

Deployment:
- Production commit: 1683f17
- Latest Vercel deployment: 1683f17 (success) — HEAD 5d7b74c 배포 기록 없음
- Git integration: 정상(vercel[bot] 연속 배포)
- Result: HEAD 미배포(런타임 영향 없음) — 대시보드 확인 필요 (OPS_CONFIRM_REQUIRED)

GO-LIVE READINESS: NOT READY

TOP 10 BLOCKERS:
1. DG-001 품목 LOT 정책 미설정 (출하 불가 / 추적 비활성)
2. DG-002 생산 필수 기준정보 미적재 (작업지시 불가)
3. DG-013 비인증 읽기 서버 액션 / 기본 테넌트 폴백
4. DG-006/007 LOT 정·역추적 단절
5. DG-004/005 바코드 LOT 미포함 + 카메라 스캔 없음
6. DG-008 수주 조선기자재 확장 필드
7. DG-010 설비 연동 에이전트
8. DG-012 기초재고·Open SO/PO 이관 도구
9. DG-011 KPI 정의·접근
10. DG-009 계측기 검교정관리

Recommended Next Phase:
Phase: 10
Scope: 보안·무결성·범위 하드닝 (DG-013/014/015/016/017/021/031/033/042) — 스키마 변경 없음

Production Write: 0 expected
Schema Change: 0 expected (Phase 10)
Migration Change: 0 expected (Phase 10)
```
