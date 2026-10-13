# F18 — POP 선택 공구 실제 사용이력

## 기준과 범위

- 정본: `C:\Dev\NMES`, `feat/cheongun-pop-tool-usage`.
- PR #90 merge / 시작 SHA: `95df1493624a33b98ba2582312f098a851f20ea6`.
- 해당 SHA Vercel status: SUCCESS. F18만 변경하며 신규 PR은 merge하지 않는다.
- CNS MEDICAL, AI/CMM, F19 이후 작업 없음.

## 기존 Tool domain 감사

| 항목 | 현재 정본 / 관계 | 실제 사용처 및 F18 결정 |
|---|---|---|
| Master | Equipment; tenantId/siteId/workCenterId | 기존 공구관리 유지 |
| 유형 | EquipmentType TOOL/JIG/FIXTURE | 복수 동시선택 지원 |
| 상태 | EquipmentStatus; ACTIVE만 POP 후보/서버 허용 | 수명 초과 자체로 새로운 차단 정책을 만들지 않음 |
| 계획 공구 | EquipmentOperationMap → RoutingOperation | 후보일 뿐 actual 사용으로 자동 확정하지 않음 |
| 실제 설비 | ProductionResult → WorkOrderOperationAssignment → Equipment | F09 정본 유지; 공구와 머신 사이 별도 배정 relation은 없음 |
| 실제 이력 | EquipmentUsageHistory | 기존 수동 등록 유지, nullable productionResultId FK 추가 (CASE B) |
| 사용 단위 | usageCount/currentUsage 정수, 기존 화면의 사용횟수(회) | 선택 공구별 성공한 실적 segment 1건을 사용 1회로 기록. 생산수량을 타수로 추측하지 않음 |
| 수명 | lifeLimit; 잔여=lifeLimit-currentUsage; 사용률=currentUsage/lifeLimit | 기존 계산 재사용. 미설정 nullable 유지 |
| 작업자/시각 | operatorId, usedAt | 해당 ProductionResult의 작업자와 endedAt 사용 |
| 점검/수리 | EquipmentDailyCheck / EquipmentRepairRequest | 기존 기능 유지 |
| 이력 보호 | 공구 삭제 참조 검사 | 기존 수동/자동 이력 모두 기존 참조 보호 대상 |
| 관리 권한 | 기존 tool.actions의 RolePermission/role guard | POP에는 TOOL UPDATE 관리권한을 추가 요구하지 않음 |

## 최종 동작

기본은 공구 미선택/사용 안 함이다. 계획 공구가 하나 또는 여러 개 있어도 자동 선택하지 않는다. 미선택이면 공구 조회·사용이력 생성·currentUsage 변경 없이 기존 생산실적 등록을 수행한다. requiredTool 필드나 새 공구 도메인은 만들지 않는다.

선택 공구는 서버에서 tenant/site/ACTIVE/TOOL·JIG·FIXTURE/현재 RoutingOperation 배정을 재검증한다. 중복 선택 ID는 정규화한다. 매 ProductionResult마다 새 선택을 받으므로 A→B 교체와 복수 공구 동시사용을 기록할 수 있다. 양품/불량/재작업 구성과 무관하게 성공한 segment의 선택 공구별 사용 1회다. 생산수량은 ProductionResult를 통해 별도로 추적한다.

ProductionResult와 EquipmentUsageHistory 생성, currentUsage atomic increment는 기존 POP transaction 안에서 수행한다. 실패 attempt의 모든 쓰기는 함께 rollback된다. `(productionResultId, equipmentId)` unique index는 동일 실적/공구의 중복 이력을 차단한다. 별도 클라이언트 요청 재전송 idempotency key는 추가하지 않았다. 독립적으로 성공한 새 실적은 별개의 실제 사용이다.

공구 상세 사용이력에서 작업지시, 공정, 실제 배정 설비, 작업자, 사용일, 생산실적 수량, 사용횟수를 표시한다. 실제 설비는 assignment가 있는 실적만 표시하며 계획 설비로 추측하지 않는다. F04/F09/F14/F17의 기존 관계와 흐름을 유지한다. 자동 공구이력 AuditLog를 중복 생성하지 않으며 기존 F15 코드는 수정하지 않았다.

## Migration

- `20260910090000_link_tool_usage_to_production_result`
- nullable FK, ON DELETE SET NULL, 조회 index 및 실적/공구 unique index.
- 기존 수동 이력은 null로 유지. 이력 시각/공정만으로 여러 실적을 정확히 구분할 수 없어 최소 FK를 추가했다.
- (NMES 개발 DB에 적용됨 — 대원정밀 DB 에는 migration 으로 적용)
- Prisma migrate CLI pooler 대기 후 직접 transaction 적용 방식 사용.
- `_prisma_migrations.finished_at`: `2026-09-10T10:01:16.403Z`.
- SQL SHA256: `ca239ca57e7f5c3860f43e9cf4aa587bc67935f3953857d022a12d37af426ffd` (실제 DB 기록과 일치).
- column/FK/index 및 migration 완료 기록 확인. db push/reset 없음.

## 검증

- F18 static + 실제 Server Action 실행(격리된 transaction/auth adapter): 38 PASS.
- 이 테스트의 mock은 기존 WIP/자재 gate 검증을 대체하지 않는다. 해당 gate는 기존 회귀검사와 실제 브라우저 경로로 검증한다.
- 실제 브라우저 + 청운 개발 DB: 미선택 5개 → 이력 0/사용량 0; TOOL-A 30개 → A 1회; TOOL-B 20개 → B 1회. C 0회 유지.
- 미배정 TOOL-C를 POST에 주입 → 서버 거절, ProductionResult/ToolUsage 추가 없음.
- 실적별 FK, 실제 설비 assignment, 작업자, 시작/종료시각 확인. 두 브라우저 동시 등록에서 실적 2건/공구 사용 2회 추가되어 lost update 없음. 공구 상세 조회 및 작업대기 인라인 선택사항 UI도 확인. 생성한 전용 fixture만 정리.
- tool-management 45 PASS; next-work-navigation 19 PASS.
- 지정 F01~F17 회귀 18 scripts PASS: tool-management, next-work-navigation, equipment-downtime-maintenance-integrity, core-audit-log, history-retention-integrity, outsource-order-linkage, lot-lineage-integrity, inventory-concurrency-integrity, bom-material-sufficiency, equipment-result-attribution, role-permission-enforcement, quality-history-integrity, shipment-state-integrity, quality-release-gate, pop-worktime-operator, operation-status-integrity, production-plan-workorder-integrity, production-plan-sales-link.
- type-check, check:server-actions (78 files), build PASS. lint는 기존 problem-type-form-sheet.tsx의 useEffect dependency 경고 1건.
- 추가로 실행됐던 구형 `test:cause-analysis` C15~C17은 F07 이전 inline tenant 검사/원인분석 연쇄삭제를 기대해 실패한다. 현재 `assertInspectionHistoryMutable`는 tenant 확인 후 불량이력 존재 시 삭제를 차단한다. F18에서 기존 품질 코드/구형 테스트를 바꾸지 않았으며 지정 `test:quality-history-integrity`는 PASS다.
- 전체 검증 후 이력 조회 필드 및 browser test 확인문을 보완하여 해당 type-check/tool-management/build만 추가 확인했다. 기존 회귀 전체를 반복하지 않았다.

PR URL, 최종 SHA, Vercel Preview 결과는 PR 및 최종 작업 보고를 참조한다.
