/**
 * 품질검사 "조치관리" code-path test.
 *
 * defect-corrective-action.helpers.ts는 DB에 의존하지 않는 순수 함수라 직접
 * 검증한다(defect-cause-analysis.helpers.ts와 동일 방식). tenant 재검증/
 * assignee 검증/상태전이 순서/AuditLog 기록처럼 DB(Prisma) 호출이 필수인
 * 로직은, 실제 배포된 소스 파일 텍스트를 읽어 정확한 패턴(where 절 체인,
 * 트랜잭션 순서, updateMany 낙관적 락)이 존재하는지 구조적으로 검증한다
 * ("code-path" = 순수 함수 직접 호출, "source-check" = 실제 배포 소스 구조
 * 검증 — scripts/test-defect-cause-analysis.ts와 동일한 라벨 규칙).
 *
 * 실행:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/test-corrective-action.ts
 */
import * as fs from "fs"
import {
  normalizeActionContent,
  normalizeCompletionNote,
  normalizeDueDate,
  buildCorrectiveActionStatusWhere,
  isOverdue,
  serializeDefectCorrectiveActionRow,
  type DefectCorrectiveActionRecordLike,
} from "../src/lib/actions/defect-corrective-action.helpers"

let passed = 0
let failed = 0

function assertEqual<T>(actual: T, expected: T, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  }
}

function assertThrows(fn: () => void, label: string) {
  try {
    fn()
    failed++
    console.error(`FAIL: ${label} (에러가 발생하지 않음)`)
  } catch {
    passed++
  }
}

function assertTrue(cond: boolean, label: string) {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

function makeRecord(
  overrides: Partial<DefectCorrectiveActionRecordLike> & { id: string }
): DefectCorrectiveActionRecordLike {
  return {
    id: overrides.id,
    actionContent: overrides.actionContent ?? "지그 마모 부위 교체",
    assigneeId: overrides.assigneeId === undefined ? "profile-1" : overrides.assigneeId,
    assignee: overrides.assignee === undefined ? { name: "김생산" } : overrides.assignee,
    dueDate: overrides.dueDate ?? new Date("2026-09-10T00:00:00.000Z"),
    status: overrides.status ?? ("OPEN" as never),
    completedAt: overrides.completedAt === undefined ? null : overrides.completedAt,
    completionNote: overrides.completionNote === undefined ? null : overrides.completionNote,
    createdBy: overrides.createdBy ?? { name: "이품질" },
    updatedBy: overrides.updatedBy ?? { name: "이품질" },
    createdAt: overrides.createdAt ?? new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-09-01T00:00:00.000Z"),
    defectRecord: overrides.defectRecord ?? {
      id: "dr-1",
      qty: "5.000000",
      severity: "MAJOR" as never,
      disposition: null,
      defectCode: { code: "DIM-001", name: "치수 초과" },
      causeAnalysis: { rootCause: "지그 마모", analysisDetail: null },
      qualityInspection: {
        inspectedAt: new Date("2026-08-20T02:00:00.000Z"),
        stage: "MID" as never,
        workOrderOperation: {
          routingOperation: { name: "검사공정" },
          workOrder: { orderNo: "WO-1", manufacturingNo: "MFG-1", item: { code: "ITEM-1", name: "테스트품목" } },
        },
      },
    },
  }
}

// ─── T1~T3: actionContent / completionNote / dueDate 정규화 ────────────────
assertEqual(normalizeActionContent("  지그 교체  "), "지그 교체", "T1. actionContent 정상 trim")
assertThrows(() => normalizeActionContent("   "), "T2. 빈 actionContent(공백만) 차단")
assertThrows(() => normalizeActionContent(""), "T2. 빈 actionContent(빈 문자열) 차단")
assertEqual(normalizeCompletionNote("  완료됨  "), "완료됨", "T3. completionNote 정상 trim")
assertEqual(normalizeCompletionNote("   "), null, "T3. completionNote 공백만이면 null")
assertEqual(normalizeCompletionNote(undefined), null, "T3. completionNote 미입력이면 null")
assertEqual(normalizeCompletionNote(null), null, "T3. completionNote null이면 null 유지")

// ─── T4: dueDate 필수 검증 ───────────────────────────────────────────────────
assertThrows(() => normalizeDueDate(""), "T4. 빈 dueDate 차단")
assertThrows(() => normalizeDueDate(undefined), "T4. dueDate 미입력 차단")
assertThrows(() => normalizeDueDate("not-a-date"), "T4. 파싱 불가능한 dueDate 차단")
assertTrue(normalizeDueDate("2026-09-10") instanceof Date, "T4. 정상 dueDate는 Date로 변환")

// ─── T5~T6: 기한초과(overdue) 계산 — DB 컬럼 없이 조회 시점 계산 ────────────
{
  const now = new Date("2026-09-04T00:00:00.000Z")
  assertTrue(isOverdue("2026-09-01", "OPEN" as never, now), "T5. dueDate가 과거 + 미완료(OPEN)면 기한초과")
  assertTrue(isOverdue("2026-09-01", "IN_PROGRESS" as never, now), "T5. dueDate가 과거 + 미완료(IN_PROGRESS)면 기한초과")
  assertTrue(!isOverdue("2026-09-01", "COMPLETED" as never, now), "T6. dueDate가 과거라도 COMPLETED면 기한초과 아님")
  assertTrue(!isOverdue("2026-09-10", "OPEN" as never, now), "T6. dueDate가 미래면 기한초과 아님")
}

// ─── T7~T9: 상태 필터 where절 조립 ──────────────────────────────────────────
assertEqual(buildCorrectiveActionStatusWhere("ALL"), {}, "T7. 상태 ALL은 필터 없음")
assertEqual(buildCorrectiveActionStatusWhere(undefined), {}, "T7. 상태 미지정도 필터 없음")
assertEqual(buildCorrectiveActionStatusWhere("OPEN"), { status: "OPEN" }, "T8. OPEN은 status 컬럼 필터")
assertEqual(buildCorrectiveActionStatusWhere("IN_PROGRESS"), { status: "IN_PROGRESS" }, "T8. IN_PROGRESS는 status 컬럼 필터")
assertEqual(buildCorrectiveActionStatusWhere("COMPLETED"), { status: "COMPLETED" }, "T8. COMPLETED는 status 컬럼 필터")
assertEqual(buildCorrectiveActionStatusWhere("OVERDUE"), {}, "T9. OVERDUE는 DB where절로 표현 불가 — 애플리케이션에서 별도 계산(actions.ts에서 필터링)")

// ─── T10: 직렬화 — 원인분석 있음/없음 모두 정상 처리 ────────────────────────
{
  const withAnalysis = makeRecord({ id: "a-1" })
  const rowWith = serializeDefectCorrectiveActionRow(withAnalysis, new Date("2026-09-04T00:00:00.000Z"))
  assertTrue(
    rowWith.rootCause === "지그 마모" && rowWith.defectQty === 5 && rowWith.assigneeName === "김생산",
    "T10. 원인분석이 있으면 rootCause를 참조만 하고 그대로 노출(수정 아님), Decimal qty는 Number로 변환"
  )

  const withoutAnalysis = makeRecord({
    id: "a-2",
    defectRecord: { ...withAnalysis.defectRecord, causeAnalysis: null },
  })
  const rowWithout = serializeDefectCorrectiveActionRow(withoutAnalysis, new Date("2026-09-04T00:00:00.000Z"))
  assertTrue(
    rowWithout.rootCause === null && rowWithout.analysisDetail === null,
    "T10. 원인분석이 아직 없어도 예외 없이 null로 정상 직렬화(원인분석 선행을 강제하지 않음, §5)"
  )
}

// ─── T11: 직렬화 — 담당자 미지정도 정상 처리 ────────────────────────────────
{
  const unassigned = makeRecord({ id: "a-3", assigneeId: null, assignee: null })
  const row = serializeDefectCorrectiveActionRow(unassigned, new Date("2026-09-04T00:00:00.000Z"))
  assertTrue(row.assigneeId === null && row.assigneeName === null, "T11. 담당자 미지정이어도 예외 없이 null로 직렬화")
}

// ─── T12: 직렬화 — completedAt/completionNote 포함 여부 ─────────────────────
{
  const completed = makeRecord({
    id: "a-4",
    status: "COMPLETED" as never,
    completedAt: new Date("2026-09-03T05:00:00.000Z"),
    completionNote: "재발 방지를 위해 초물검사 강화",
  })
  const row = serializeDefectCorrectiveActionRow(completed, new Date("2026-09-04T00:00:00.000Z"))
  assertTrue(
    row.status === "COMPLETED" && row.completedAt !== null && row.completionNote === "재발 방지를 위해 초물검사 강화" && !row.overdue,
    "T12. 완료 처리된 조치는 completedAt/completionNote가 직렬화 결과에 포함되고 기한초과로 계산되지 않음"
  )
}

// ─── T13~T20: source-check — actions.ts 실제 구조 검증 ──────────────────────
const actionsSource = fs.readFileSync("src/lib/actions/defect-corrective-action.actions.ts", "utf8")

// T13: cross-tenant DefectRecord 차단 — 4-hop tenant 체인
{
  const pattern = /qualityInspection:\s*\{\s*workOrderOperation:\s*\{\s*workOrder:\s*\{\s*tenantId\s*\}\s*\}\s*\}/
  assertTrue(pattern.test(actionsSource), "T13. assertDefectRecordInTenant가 DefectRecord→QualityInspection→WorkOrderOperation→WorkOrder→tenantId 체인으로 검증")
}

// T14: cross-tenant assignee 차단 — 활성 TenantUser만 허용
{
  const hasAssigneeCheck = /tenantUser\.findFirst\(\{\s*where:\s*\{\s*profileId:\s*assigneeId,\s*tenantId,\s*isActive:\s*true\s*\}/.test(actionsSource)
  assertTrue(hasAssigneeCheck, "T14. assertAssigneeValid가 {profileId, tenantId, isActive:true} 조건으로 다른 tenant/비활성 담당자를 차단")
}

// T15: create — DB 생성 + AuditLog CREATE가 같은 트랜잭션 안에서 실행
{
  const fnStart = actionsSource.indexOf("export async function createDefectCorrectiveAction")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\nexport async function", fnStart + 1))
  const hasCreate = /tx\.defectCorrectiveAction\.create\(/.test(fnBody)
  const hasAudit = /action:\s*"CREATE"/.test(fnBody)
  const hasDefaultOpen = /status:\s*"OPEN"/.test(fnBody)
  assertTrue(hasCreate && hasAudit && hasDefaultOpen, "T15. createDefectCorrectiveAction이 status 기본값 OPEN으로 생성하고 같은 트랜잭션에서 AuditLog CREATE를 기록")
}

// T16: update — 소유권 확인 후에만 수정, 상태는 이 함수로 바꾸지 않음(전이 함수로 분리)
{
  const fnStart = actionsSource.indexOf("export async function updateDefectCorrectiveAction")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\nexport async function", fnStart + 1))
  const hasOwnershipCheck = /defectCorrectiveAction\.findFirst\(\{\s*where:\s*\{\s*id,\s*tenantId\s*\}\s*\}\)/.test(fnBody)
  const hasUpdateCall = /tx\.defectCorrectiveAction\.update\(/.test(fnBody)
  const touchesStatus = /data:\s*\{[^}]*status/.test(fnBody)
  assertTrue(
    hasOwnershipCheck && hasUpdateCall && !touchesStatus,
    "T16. updateDefectCorrectiveAction은 {id, tenantId} 소유권 확인 후에만 content/assignee/dueDate를 수정하고 status는 건드리지 않음"
  )
}

// T17: 상태전이 OPEN→IN_PROGRESS — 낙관적 락(updateMany + status 가드) + AuditLog
{
  const fnStart = actionsSource.indexOf("export async function startDefectCorrectiveAction")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\nexport async function", fnStart + 1))
  const hasGuardedUpdate = /updateMany\(\{\s*where:\s*\{\s*id:\s*current\.id,\s*tenantId,\s*status:\s*"OPEN"\s*\}/.test(fnBody)
  const hasRaceCheck = /claimed\.count\s*!==\s*1/.test(fnBody)
  const setsInProgress = /status:\s*"IN_PROGRESS"/.test(fnBody)
  assertTrue(
    hasGuardedUpdate && hasRaceCheck && setsInProgress,
    "T17. startDefectCorrectiveAction이 status:'OPEN' 조건부 updateMany(낙관적 락)로만 IN_PROGRESS 전이를 허용하고 동시성 충돌을 감지"
  )
}

// T18: 상태전이 IN_PROGRESS→COMPLETED — completedAt 자동 기록 + 낙관적 락
{
  const fnStart = actionsSource.indexOf("export async function completeDefectCorrectiveAction")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\nexport async function", fnStart + 1))
  const hasGuardedUpdate = /updateMany\(\{\s*where:\s*\{\s*id:\s*current\.id,\s*tenantId,\s*status:\s*"IN_PROGRESS"\s*\}/.test(fnBody)
  const setsCompletedAt = /completedAt(,|\s*:\s*completedAt)/.test(fnBody) && /const completedAt = new Date\(\)/.test(fnBody)
  const setsCompleted = /status:\s*"COMPLETED"/.test(fnBody)
  assertTrue(
    hasGuardedUpdate && setsCompletedAt && setsCompleted,
    "T18. completeDefectCorrectiveAction이 status:'IN_PROGRESS' 조건부 updateMany로만 COMPLETED 전이를 허용하고 completedAt을 서버에서 자동 기록"
  )
}

// T19: 상태 역행/직행 차단 — OPEN에서 바로 COMPLETED 불가, COMPLETED 재완료 불가
{
  const startFnBody = actionsSource.slice(
    actionsSource.indexOf("export async function startDefectCorrectiveAction"),
    actionsSource.indexOf("\nexport async function completeDefectCorrectiveAction")
  )
  const completeFnBody = actionsSource.slice(actionsSource.indexOf("export async function completeDefectCorrectiveAction"))
  const startBlocksNonOpen = /current\.status\s*!==\s*"OPEN"/.test(startFnBody)
  const completeBlocksAlreadyDone = /current\.status\s*===\s*"COMPLETED"/.test(completeFnBody)
  const completeRequiresInProgress = /current\.status\s*!==\s*"IN_PROGRESS"/.test(completeFnBody)
  assertTrue(
    startBlocksNonOpen && completeBlocksAlreadyDone && completeRequiresInProgress,
    "T19. OPEN→IN_PROGRESS→COMPLETED 순서를 강제 — OPEN에서 바로 완료 불가, 이미 완료된 조치 재완료 불가"
  )
}

// T20: 삭제 기능 미제공 — DefectCauseAnalysis와 동일 정책(품질 추적성/감사 증빙)
{
  const hasDelete = /export async function delete/i.test(actionsSource)
  assertTrue(!hasDelete, "T20. defect-corrective-action.actions.ts는 delete 함수를 export하지 않음(물리 삭제 미제공, 상태전이/수정만 가능)")
}

// ─── T21: 조치이력(DefectCorrectiveAction)이 있는 검사는 삭제가 차단됨(source-check) ─
// 설계 변경(F07 이력 보존): 예전에는 삭제 시 조치이력을 먼저 지웠지만, 지금은 불량 기록이 있는 검사 삭제 자체를 막는다.
// 조치이력은 불량 기록의 하위이므로 삭제가 막혀 RESTRICT FK 위반도, 조치이력 유실도 생기지 않는다.
{
  const qualityActionsSource = fs.readFileSync("src/lib/actions/quality.actions.ts", "utf8")
  const helperSource = fs.readFileSync("src/lib/actions/quality-inspection-integrity.helpers.ts", "utf8")
  const fnStart = qualityActionsSource.indexOf("export async function deleteQualityInspection")
  const fnBody = qualityActionsSource.slice(fnStart, qualityActionsSource.indexOf("\nexport async function", fnStart + 1))
  const helperStart = helperSource.indexOf("export async function assertInspectionHistoryMutable")
  const helperBody = helperSource.slice(helperStart, helperSource.indexOf("\n}\n", helperStart))
  const idxGuard = fnBody.indexOf("assertInspectionHistoryMutable(tx, id, tenantId)")
  const idxDefectRecord = fnBody.indexOf("defectRecord.deleteMany")
  const idxInspectionDelete = fnBody.indexOf("qualityInspection.delete(")
  assertTrue(
    helperBody.includes("correctiveActions: { select") &&
      helperBody.includes("inspection.defectRecords.length > 0") &&
      idxGuard >= 0 &&
      idxGuard < idxDefectRecord &&
      idxDefectRecord < idxInspectionDelete &&
      !fnBody.includes("defectCorrectiveAction.deleteMany"),
    "T21. 조치이력(DefectCorrectiveAction)이 달린 불량 기록이 있는 검사는 삭제가 차단되어(이력 보호 검사가 모든 delete 보다 먼저) 참조무결성과 조치이력이 보존됨"
  )
}

// ─── T22: migration에 CorrectiveActionStatus enum과 필수 인덱스가 존재 ──────
{
  const migrationSql = fs.readFileSync(
    "prisma/migrations_legacy_nmes/20260904000000_add_defect_corrective_action/migration.sql",
    "utf8"
  )
  const hasEnum = /CREATE TYPE "CorrectiveActionStatus" AS ENUM \('OPEN', 'IN_PROGRESS', 'COMPLETED'\)/.test(migrationSql)
  const hasTenantStatusIndex = /CREATE INDEX "DefectCorrectiveAction_tenantId_status_idx"/.test(migrationSql)
  const hasTenantDueDateIndex = /CREATE INDEX "DefectCorrectiveAction_tenantId_dueDate_idx"/.test(migrationSql)
  const hasAssigneeIndex = /CREATE INDEX "DefectCorrectiveAction_assigneeId_idx"/.test(migrationSql)
  const hasDefectRecordIndex = /CREATE INDEX "DefectCorrectiveAction_defectRecordId_idx"/.test(migrationSql)
  assertTrue(
    hasEnum && hasTenantStatusIndex && hasTenantDueDateIndex && hasAssigneeIndex && hasDefectRecordIndex,
    "T22. migration에 CorrectiveActionStatus enum(OPEN/IN_PROGRESS/COMPLETED 3단계)과 조회 패턴에 필요한 최소 인덱스(tenantId+status, tenantId+dueDate, assigneeId, defectRecordId)가 존재"
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
