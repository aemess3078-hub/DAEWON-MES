# DAEWON MRP Phase 6 — 실행이력 · Snapshot · DRAFT 중복 발주 방지

MRP 결과를 **불변 Snapshot**으로 저장해 나중에 "그때 무엇이 필요했고, 무엇을 발주했는가"를 추적하고,
이미 만들어 둔 **DRAFT 구매발주 때문에 같은 부족을 중복 발주하지 않도록** 한다.
MRP 엔진 / Golden(Excel 호환) 결과와 5B 입고예정 정책은 바뀌지 않는다.

> **운영 migration 적용 대기** — 이 문서의 schema(`20261014020000_add_mrp_run_history`)는 운영 DB 에 아직 적용되지 않았다.
> 적용 전에는 commit / push / 배포하지 않는다(적용 절차는 §12).

## 1. 핵심 정책

| 항목 | 정책 |
|---|---|
| DRAFT 구매발주 | **확정 공급이 아니다.** 재고 / 입고예정(Scheduled Receipt) / 예상잔량(Projected Balance)에 **절대 가산하지 않는다.** 입고예정은 5B 그대로 `ORDERED` / `PARTIAL_RECEIVED` 만 |
| Draft Coverage | 중복 발주 방지를 위한 **별도 표시**: `MRP 정책 필요량 100 / 기존 DRAFT 80 / 추가 DRAFT 필요 20` |
| 계산 순서 | `remaining = max(0, 정책 필요량 − 기존 DRAFT)` → **그 다음** 공급업체 MOQ → 발주배수. remaining = 0 이면 MOQ 를 적용하지 않고 0 |
| DRAFT → ORDERED | Draft Coverage 에서 빠지고 입고예정에 들어간다(둘 다에 있는 경우 없음). 취소/종결/입고완료/삭제도 Coverage 에서 빠진다 |
| Snapshot | 사용자가 명시적으로 "MRP 실행 저장"을 누르거나, DRAFT 발주 생성 시점에 **서버가** 보장한다. 일반 조회/SSR 은 아무것도 쓰지 않는다 |
| 이력 | 수정/삭제 기능 없음. DB trigger 가 UPDATE 도 거부한다. 저장된 값을 보여 줄 뿐 재계산하지 않는다 |

## 2. Schema (additive, migration 1건)

`20261014020000_add_mrp_run_history` — 기존 테이블 변경/삭제 없음, 신규 테이블 3개.

| 테이블 | 역할 | 주요 제약 |
|---|---|---|
| `MrpRun` | 실행 1건 = Snapshot(JSON) + 목록/검색용 요약 컬럼(기준일, 기간, 건수) + `sourceHash`/`resultHash` | `UNIQUE(tenantId, requestKey)`(NULL 허용), `INDEX(tenantId, createdAt)`, CHECK(status/runType/mode/건수) |
| `MrpRunSuggestion` | Snapshot 의 자재별 발주제안 행(정책 필요량, 제안량, 기존 DRAFT, 추가량, 추천 공급업체) | `UNIQUE(runId, itemId)`, `INDEX(tenantId, itemId)`, CHECK(qty ≥ 0) |
| `MrpRunPurchase` | Snapshot → DRAFT PO 연결(라인 근거, override 사유, 결과 DTO) | `UNIQUE(tenantId, requestKey, supplierId)`, `UNIQUE(purchaseOrderId)`, `INDEX(tenantId, runId)`, CHECK(override 시 사유 필수) |

- 품목/공급업체는 **FK 없이** id + 당시 코드/이름을 복사한다(마스터 변경/삭제와 무관한 이력).
- `MrpRunPurchase.purchaseOrderId` 는 `ON DELETE SET NULL`: DRAFT PO 가 삭제돼도 발주번호/공급업체/품목 라인 근거는 남는다.
- 불변 trigger `mrp_run_history_immutable_guard`: UPDATE 시 허용 컬럼 외 변경을 거부한다
  (`MrpRun` = 작성자 삭제로 인한 `createdById` NULL 만, `MrpRunPurchase` = `purchaseOrderId`(SET NULL)/`createdById` 만, `MrpRunSuggestion` = 없음).
- 신규 테이블 3개 모두 `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL FROM anon, authenticated`(운영 RLS 112 → 115 테이블).
- DELETE 는 DB 에서 막지 않는다(애플리케이션에 삭제 기능이 없고, 자식 FK 는 RESTRICT).

## 3. Snapshot 저장 정책

저장 내용(화이트리스트 필드만 복사): 실행 메타(기준일/기간/DRAFT 수주 포함/모드), 요약 KPI, 입고예정 반영 요약(+예정일 경과 목록),
경고/제외 라인, 자재별 재고·소요·최종 예상·부족·안전재고·**반제품 Netting 누계**·반영된 입고예정(발주번호/일자/수량),
수주 단계(주문/고객/제품/납기/수량/소요/잔량 전·후), 발주제안(정책 필요량/MRP 제안/기존 DRAFT/추가 DRAFT/추천 공급업체 LT·MOQ·배수/필요일).

- 실행자/시각은 컬럼(`createdById`, `createdByName`, `createdAt`)에 있다.
- **넣지 않는 것**: DB URL, JWT, Supabase key, 세션, 비밀번호, tenantId, 사용자 id, **단가**(가격 조회 권한 분리).
- `sourceHash` = 입력(수요/재고/예정입고/공급업체 정책/DRAFT Coverage) sha256, `resultHash` = 생성 시각 제외 전체 sha256(canonical JSON, 키 정렬).
- 서버가 입력 파라미터(기간, 임시 수주 포함 여부)만으로 다시 계산해 저장한다. 클라이언트가 보낸 결과/tenantId 는 받지 않는다.

## 4. Snapshot 크기

실제 파이프라인(수주 66건 × BOM 자재 273종, 수요 단계 18,018건, 제안 273건)으로 측정: **1,374 KB**(상한 6 MB).

- 수요 단계는 컬럼 배열(tuple)로 저장한다(키 이름 반복 없음).
- 상한을 넘으면 "결품/제안 대상이 아닌 자재"의 수요 단계만 생략하고(`compacted=true`, 화면에 표시), 그래도 넘으면 저장하지 않는다(`TOO_LARGE`).
- 저장 쿼리는 자재 수와 무관하다: 트랜잭션 1회 = `MrpRun` 1 + `MrpRunSuggestion` createMany 1 + AuditLog 1.

## 5. DRAFT Coverage

- 대상: 같은 tenant 의 `PurchaseOrder.status = DRAFT` 품목 행 중 미입고(`qty − receivedQty`) > 0. 외주발주(`OS-`, `[OUTSOURCING]`, 공정 연결) 제외.
- 쿼리 1회로 일괄 조회(5C 의 DRAFT 조회를 확장: 품목 합계 + 공급업체별 + 발주서별). 자재 3종/300종 쿼리 수 동일.
- 기본은 **품목 전체** Coverage(어떤 공급업체의 DRAFT 든). 화면은 선택 공급업체 DRAFT 와 "다른 공급업체 DRAFT 존재"를 분리해 보여 준다.
- `suggestedQty` / `rawSuggestedQty` 는 DRAFT 를 고려하지 않은 **MRP 제안**으로 유지하고, `additionalQty` / `remainingRawNeed` / `coverageStatus` 를 추가했다.

| 시나리오 | 정책 필요 | 기존 DRAFT | MOQ / 배수 | 남은 필요 | 추가 DRAFT |
|---|---|---|---|---|---|
| 일부 충족 | 100 | 80 | 없음 | 20 | **20** |
| MOQ/배수 | 100 | 80 | 50 / 10 | 20 | **50** (MRP 제안은 100) |
| 초과 충족 | 100 | 110 | 50 / 10 | 0 | **0** (MOQ 미적용, 상태 "기존 DRAFT 발주로 제안량 충족") |

## 6. 중복 발주 방지 · 멱등 · override · 동시성

서버(`createDraftPurchaseOrdersFromSuggestions`, 서버 액션은 항상 `history` 를 주입)가 생성 직전 **같은 트랜잭션에서** 다시 검증한다.
화면이 보낸 Coverage/MOQ/배수/공급업체 관계 값은 쓰지 않는다.

1. tenant 단위 advisory lock(`MRP_DRAFT|{tenantId}`) → 이후 채번 잠금(`PO_NO|…`) — 항상 같은 순서(교착 없음).
2. **멱등**: 같은 `(tenant, requestKey)` 의 연결 행이 있으면,
   - **같은 의미의 요청**(정규화한 라인·공급업체별 입고예정일·사이트·근거(run/MRP 기간)·override 사유의 결정적 sha256 `requestHash` 일치)이면 새로 만들지 않고 처음 결과를 `replayed=true` 로 돌려준다(더블클릭/재시도, 라인 순서·병합 무관).
   - **다른 요청**이면 replay 하지 않고 `IDEMPOTENCY_KEY_REUSE_MISMATCH` 로 거부한다(쓰기 0). 같은 키가 이미 "실행 저장"에 쓰였을 때도 같다.
   - `requestHash` 는 `MrpRunPurchase.result`(삽입 시 기록)에 저장 — schema/migration 변경 없음. 시각/난수는 해시에 포함하지 않는다.
   - 실행 저장(`saveMrpRun`)도 같은 키 + 다른 기간/DRAFT 수주 포함 여부면 거부한다(저장된 `MrpRun` 컬럼과 비교).
3. Coverage 를 다시 읽어 `정책 필요량 − Coverage ≤ 0` 이면 `DUPLICATE_DRAFT`.
   `runId` 로 생성하는 경우, 같은 실행에서 이미 만든 (품목, 공급업체) 는 그 PO 가 ORDERED 가 되어 Coverage 에서 빠졌어도 `DUPLICATE_RUN_LINE`.
4. **override**: 품목별 사유(필수, ≤ 200자)가 있어야만 통과. 연결 행에 `overrideUsed/overrideReason`, 감사로그(`MRP_PURCHASE_CREATE_OVERRIDE`)에 기록.
5. 근거 Snapshot: `runId` 가 없으면 같은 트랜잭션에서 저장(PO 와 근거가 함께 생기거나 함께 사라진다), 있으면 해당 실행(소유 tenant 검증)에 연결.
6. 하나라도 실패하면 전체 롤백(PO/Snapshot/제안/연결 0건) — 같은 키로 재시도 가능.

동시성 검증: 같은 키 10건 → PO 1건, 서로 다른 키 10건 → 성공 1 + `DUPLICATE_DRAFT` 9, DRAFT PO 1건.
새 실행은 이전 실행이 있다는 이유만으로 막히지 않는다(DRAFT 수정/취소/ORDERED 는 현재 Coverage 를 바꾼다. Snapshot 은 그대로).

알려진 한계: 한 번의 요청에서 사용자가 제안량보다 **더 많은 수량을 직접 입력**하는 것은 허용된다(5C 정책 유지, MOQ/배수 검증만).
감사/연결 라인에 `rawNeed`/`draftCoverageQty`/`qty` 가 남는다. 같은 키로 **다른 본문**을 보내면 거부된다(응답이 유실된 뒤 내용을 바꿔 재시도한 경우도 거부되므로, 화면 새로고침 후 새 키로 다시 시도하고 발주 목록을 확인한다).

## 7. PO 연결 보존

`MrpRunPurchase` 가 (실행, 발주번호, 공급업체, 품목 수, 총수량, 라인 근거, override, 결과 DTO)를 보존한다.
상세 화면은 연결된 PO 의 **현재 상태**(DRAFT/발주완료/부분입고/입고완료/종결/취소)를 보여 주고, PO 가 삭제됐으면 "삭제됨"으로 표시하되 이력은 유지한다.

## 8. 권한 / Tenant / Audit

| 동작 | 권한 |
|---|---|
| 실행 저장 | MRP CREATE |
| 목록 / 상세 | MRP READ |
| DRAFT 발주 생성 | MRP CREATE + PURCHASE_ORDER CREATE + role OPERATOR 이상(기존 유지) |

- tenantId 는 인증 컨텍스트에서만 결정. 다른 tenant 의 run id 는 없는 id 와 **동일한 응답**(NOT_FOUND / RUN_NOT_FOUND).
- AuditLog: `MrpRun` CREATE(source=SAVE | DRAFT_PO_CREATE, 건수/해시/바이트/요청키), `MrpRunPurchase` CREATE(override 포함), `PurchaseOrder` CREATE(+`mrpRunId`, `requestKey`).

## 9. UI

- **실행이력 탭**(신규): 목록(실행일시/실행자/유형/기간/자재 수/구매 필요 자재/경고/생성 PO/상태, 페이지네이션) + 상세(KPI, 발주제안, 결품·반제품 Netting, 입고예정 요약, 경고, 생성된 DRAFT PO 와 현재 상태).
  상세 상단에 "저장된 실행 결과 — 저장 당시 값이며 다시 계산하지 않는다"를 표시한다.
- **발주제안**: "MRP 정책 필요량 / 기존 DRAFT(미확정) / 추가 DRAFT 필요" 분해, "DRAFT 는 입고예정/재고가 아닙니다", 충족/일부 충족 칩,
  다른 공급업체 DRAFT 안내, "MRP 실행 저장" 버튼, 충족 품목 선택 시 확인 + 사유 입력, 생성 요청마다 `requestKey`.
  기본 수량과 "공급업체 정해진 최종 부족 모두 선택"은 추가 DRAFT 가 0 이면 자동으로 제외된다.

## 10. 쿼리 / 페이지네이션

- 발주제안: 기존 8쿼리 그대로(DRAFT 조회를 Coverage 로 확장했을 뿐 추가 쿼리 0). 300종도 동일.
- 목록: 3쿼리(count + 페이지 + 연결 PO 일괄), Snapshot JSON 미조회. pageSize 기본 20, 최대 100.
- 상세: run 1 + 연결 1.

## 11. 테스트

| 명령 | 내용 |
|---|---|
| `npm run test:mrp-run-history` | DC1~DC8(Coverage), RH1~RH7(저장/불변/해시/비밀/목록/상세/테넌트/크기), DP1~DP5(중복 방지/override/같은 run/동시성/멱등/롤백), PL1~PL4(권한/정적) — 154 checks |
| `npm run test:mrp-run-history-ui` | 목록/상세/발주제안 표 렌더(Coverage, override, 13px 미만 글꼴 없음) — 45 checks |
| (scratchpad) PGlite 마이그레이션 체인 | 5개 migration 순차 적용, 테이블 +3, RLS/REVOKE, unique/CHECK, 불변 trigger, PO 삭제 SET NULL — 30 checks |

기존 테스트 변경: 5D/5E 테스트의 "migration 4건" 단정을 "해당 Phase 시점(≤ 5D)의 migration" 으로 한정(Phase 6 migration 추가에 따른 기대값 갱신, 동작 변경 없음).
`scripts/helpers/fake-db.ts`: 트랜잭션 롤백을 스냅샷 복원에서 트랜잭션별 undo 로그로 변경(동시 트랜잭션이 커밋한 행을 지우지 않음), unique 검사/count/createMany/skip 추가.

## 12. 운영 migration 절차 (아직 실행하지 않음)

1. `npx prisma migrate status` — 적용 완료 4건, 대기 1건(`20261014020000_add_mrp_run_history`)만이어야 한다.
2. 대기 migration 이 예상한 1건뿐이고 preflight 가 FAIL 0 / WARN 0 일 때만 `npx prisma migrate deploy`.
3. 적용 후: 테이블 3개 / RLS 115 of 115 / anon·authenticated 권한 없음 / `migrate status` up to date 확인.
4. 그 다음 commit → push → Vercel 배포. (적용 전에는 배포하지 않는다: 새 코드가 없는 테이블을 조회한다.)

금지: `db push`, `migrate reset`, `migrate resolve`, `migrate dev`, seed, 수동 DDL, 기존 migration 수정.

## 13. 남은 GAP

- Snapshot 비교(두 실행 diff), 실행 이력 보존기간/아카이브(자동 삭제 없음), 실행 이력 Excel 내보내기
- 기간 MRP / 품목 시뮬레이션 결과의 실행 저장(이번 범위는 수주기준 MRP 발주제안)
- DRAFT 수정/취소 시 연결 이력의 "현재 상태" 외 변경 이벤트 기록
- Phase 7(이관/Go-Live)은 시작하지 않았다.
