/**
 * 품질검사 "재발방지관리" code-path test.
 *
 * defect-recurrence-prevention.helpers.ts는 DB에 의존하지 않는 순수 함수라
 * 직접 검증한다(defect-corrective-action.helpers.ts와 동일 방식). tenant
 * 재검증/담당자·검증담당자 검증/선행조건(원인분석·완료된 조치)/상태전이
 * 순서/효과성 검증/AuditLog 기록처럼 DB(Prisma) 호출이 필수인 로직은, 실제
 * 배포된 소스 파일 텍스트를 읽어 정확한 패턴(where 절 체인, 트랜잭션 순서,
 * updateMany 낙관적 락)이 존재하는지 구조적으로 검증한다("code-path" = 순수
 * 함수 직접 호출, "source-check" = 실제 배포 소스 구조 검증 —
 * scripts/test-corrective-action.ts와 동일한 라벨 규칙).
 *
 * 실행:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/test-recurrence-prevention.ts
 */
import * as fs from "fs"
import {
  normalizePreventionContent,
  normalizeDueDate,
  normalizeVerificationContent,
  buildRecurrencePreventionStatusWhere,
  isOverdue,
  serializeDefectRecurrencePreventionRow,
  type DefectRecurrencePreventionRecordLike,
} from "../src/lib/actions/defect-recurrence-prevention.helpers"

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
  overrides: Partial<DefectRecurrencePreventionRecordLike> & { id: string }
): DefectRecurrencePreventionRecordLike {
  return {
    id: overrides.id,
    preventionContent: overrides.preventionContent ?? "작업표준서 개정 및 초물검사 항목 추가",
    assigneeId: overrides.assigneeId === undefined ? "profile-1" : overrides.assigneeId,
    assignee: overrides.assignee === undefined ? { name: "김생산" } : overrides.assignee,
    dueDate: overrides.dueDate ?? new Date("2026-09-20T00:00:00.000Z"),
    status: overrides.status ?? ("OPEN" as never),
    verificationContent: overrides.verificationContent === undefined ? null : overrides.verificationContent,
    verificationResult: overrides.verificationResult === undefined ? null : overrides.verificationResult,
    verifierId: overrides.verifierId === undefined ? null : overrides.verifierId,
    verifier: overrides.verifier === undefined ? null : overrides.verifier,
    verifiedAt: overrides.verifiedAt === undefined ? null : overrides.verifiedAt,
    completedAt: overrides.completedAt === undefined ? null : overrides.completedAt,
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
      correctiveActions: [
        { id: "ca-1", actionContent: "지그 교체", status: "COMPLETED", completedAt: new Date("2026-08-25T00:00:00.000Z") },
      ],
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

// ─── T1~T3: preventionContent / dueDate / verificationContent 정규화 ────────
assertEqual(normalizePreventionContent("  표준서 개정  "), "표준서 개정", "T1. preventionContent 정상 trim")
assertThrows(() => normalizePreventionContent("   "), "T2. 빈 preventionContent(공백만) 차단")
assertThrows(() => normalizePreventionContent(""), "T2. 빈 preventionContent(빈 문자열) 차단")

assertThrows(() => normalizeDueDate(""), "T3. 빈 dueDate 차단")
assertThrows(() => normalizeDueDate(undefined), "T3. dueDate 미입력 차단")
assertThrows(() => normalizeDueDate("not-a-date"), "T3. 파싱 불가능한 dueDate 차단")
assertTrue(normalizeDueDate("2026-09-20") instanceof Date, "T3. 정상 dueDate는 Date로 변환")

assertEqual(normalizeVerificationContent("  효과 확인됨  "), "효과 확인됨", "T3. verificationContent 정상 trim")
assertThrows(() => normalizeVerificationContent(""), "T3. 빈 verificationContent 차단")
assertThrows(() => normalizeVerificationContent(undefined), "T3. verificationContent 미입력 차단")

// ─── T4~T5: 기한초과(overdue) 계산 — DB 컬럼 없이 조회 시점 계산 ────────────
{
  const now = new Date("2026-09-04T00:00:00.000Z")
  assertTrue(isOverdue("2026-09-01", "OPEN" as never, now), "T4. dueDate가 과거 + 미완료(OPEN)면 기한초과")
  assertTrue(isOverdue("2026-09-01", "IN_PROGRESS" as never, now), "T4. dueDate가 과거 + 미완료(IN_PROGRESS)면 기한초과")
  assertTrue(isOverdue("2026-09-01", "VERIFYING" as never, now), "T4. dueDate가 과거 + 미완료(VERIFYING)면 기한초과")
  assertTrue(!isOverdue("2026-09-01", "COMPLETED" as never, now), "T5. dueDate가 과거라도 COMPLETED면 기한초과 아님")
  assertTrue(!isOverdue("2026-09-20", "OPEN" as never, now), "T5. dueDate가 미래면 기한초과 아님")
}

// ─── T6~T7: 상태 필터 where절 조립 ───────────────────────────────────────────
assertEqual(buildRecurrencePreventionStatusWhere("ALL"), {}, "T6. 상태 ALL은 필터 없음")
assertEqual(buildRecurrencePreventionStatusWhere(undefined), {}, "T6. 상태 미지정도 필터 없음")
assertEqual(buildRecurrencePreventionStatusWhere("OPEN"), { status: "OPEN" }, "T7. OPEN은 status 컬럼 필터")
assertEqual(buildRecurrencePreventionStatusWhere("IN_PROGRESS"), { status: "IN_PROGRESS" }, "T7. IN_PROGRESS는 status 컬럼 필터")
assertEqual(buildRecurrencePreventionStatusWhere("VERIFYING"), { status: "VERIFYING" }, "T7. VERIFYING은 status 컬럼 필터")
assertEqual(buildRecurrencePreventionStatusWhere("COMPLETED"), { status: "COMPLETED" }, "T7. COMPLETED는 status 컬럼 필터")
assertEqual(buildRecurrencePreventionStatusWhere("OVERDUE"), {}, "T7. OVERDUE는 DB where절로 표현 불가 — 애플리케이션에서 별도 계산(actions.ts에서 필터링)")

// ─── T8: 직렬화 — 조치 이력 요약(총/완료 건수)이 원본 배열로부터 정확히 계산됨 ─
{
  const record = makeRecord({
    id: "p-1",
    defectRecord: {
      ...makeRecord({ id: "tmp" }).defectRecord,
      correctiveActions: [
        { id: "ca-1", actionContent: "지그 교체", status: "COMPLETED", completedAt: new Date("2026-08-25T00:00:00.000Z") },
        { id: "ca-2", actionContent: "작업자 재교육", status: "IN_PROGRESS", completedAt: null },
      ],
    },
  })
  const row = serializeDefectRecurrencePreventionRow(record, new Date("2026-09-04T00:00:00.000Z"))
  assertTrue(
    row.correctiveActionTotal === 2 && row.correctiveActionCompleted === 1 && row.correctiveActions.length === 2,
    "T8. 조치 이력 총 건수/완료 건수가 defectRecord.correctiveActions 배열로부터 정확히 계산되고 상세 목록도 그대로 노출됨"
  )
}

// ─── T9: 직렬화 — 검증 전(verifier/verificationResult 없음) 정상 처리 ────────
{
  const record = makeRecord({ id: "p-2", status: "IN_PROGRESS" as never })
  const row = serializeDefectRecurrencePreventionRow(record, new Date("2026-09-04T00:00:00.000Z"))
  assertTrue(
    row.verificationResult === null && row.verifierId === null && row.verifierName === null && row.verifiedAt === null,
    "T9. 검증 전 상태에서는 verificationResult/verifier/verifiedAt이 모두 null로 정상 직렬화"
  )
}

// ─── T10: 직렬화 — EFFECTIVE 검증 완료 건은 completedAt/verifiedAt 모두 포함 ──
{
  const record = makeRecord({
    id: "p-3",
    status: "COMPLETED" as never,
    verificationContent: "재발 없음 확인",
    verificationResult: "EFFECTIVE" as never,
    verifierId: "profile-2",
    verifier: { name: "박품질" },
    verifiedAt: new Date("2026-09-03T05:00:00.000Z"),
    completedAt: new Date("2026-09-03T05:00:00.000Z"),
  })
  const row = serializeDefectRecurrencePreventionRow(record, new Date("2026-09-04T00:00:00.000Z"))
  assertTrue(
    row.status === "COMPLETED" &&
      row.verificationResult === "EFFECTIVE" &&
      row.verifierName === "박품질" &&
      row.verifiedAt !== null &&
      row.completedAt !== null &&
      !row.overdue,
    "T10. EFFECTIVE 검증으로 완료된 건은 verifier/verifiedAt/completedAt이 모두 채워지고 기한초과로 계산되지 않음"
  )
}

// ─── T11~T22: source-check — actions.ts 실제 구조 검증 ──────────────────────
const actionsSource = fs.readFileSync("src/lib/actions/defect-recurrence-prevention.actions.ts", "utf8")

// T11: 선행조건 — 원인분석 없으면 등록 차단
{
  const fnStart = actionsSource.indexOf("async function assertRecurrencePreventionPrerequisites")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\n/**", fnStart + 1) === -1 ? actionsSource.indexOf("\nasync function assertTenantUserValid") : actionsSource.indexOf("\n/**", fnStart + 1))
  const hasCauseAnalysisCheck = /!record\.causeAnalysis/.test(fnBody)
  assertTrue(hasCauseAnalysisCheck, "T11. assertRecurrencePreventionPrerequisites가 원인분석(causeAnalysis) 미등록 시 등록을 차단")
}

// T12: 선행조건 — 조치 없음/완료된 조치 없음 모두 차단
{
  const fnStart = actionsSource.indexOf("async function assertRecurrencePreventionPrerequisites")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\nasync function assertTenantUserValid"))
  const hasNoActionCheck = /correctiveActions\.length\s*===\s*0/.test(fnBody)
  const hasNoCompletedCheck = /correctiveActions\.some\(\(a\)\s*=>\s*a\.status\s*===\s*"COMPLETED"\)/.test(fnBody)
  assertTrue(
    hasNoActionCheck && hasNoCompletedCheck,
    "T12. 조치가 아예 없거나, 있어도 COMPLETED 상태인 조치가 하나도 없으면 재발방지 등록을 차단(최소 1건 완료 조치 선행 정책)"
  )
}

// T13: cross-tenant defect 차단 — 4-hop tenant 체인 (선행조건 확인 쿼리 안에 포함)
{
  const pattern = /qualityInspection:\s*\{\s*workOrderOperation:\s*\{\s*workOrder:\s*\{\s*tenantId\s*\}\s*\}\s*\}/
  assertTrue(pattern.test(actionsSource), "T13. assertRecurrencePreventionPrerequisites가 DefectRecord→QualityInspection→WorkOrderOperation→WorkOrder→tenantId 체인으로 cross-tenant 불량을 차단")
}

// T14: cross-tenant 담당자/검증담당자 차단 — 활성 TenantUser만 허용, 담당자·검증담당자 공용 검증 함수
{
  const hasUserCheck = /tenantUser\.findFirst\(\{\s*where:\s*\{\s*profileId:\s*userId,\s*tenantId,\s*isActive:\s*true\s*\}/.test(actionsSource)
  const usedForAssignee = /assertTenantUserValid\(tenantId,\s*assigneeId\)/.test(actionsSource)
  const usedForVerifier = /assertTenantUserValid\(tenantId,\s*verifierId\)/.test(actionsSource)
  assertTrue(
    hasUserCheck && usedForAssignee && usedForVerifier,
    "T14. assertTenantUserValid가 {profileId, tenantId, isActive:true} 조건으로 담당자/검증담당자 모두에 대해 cross-tenant/비활성 사용자를 차단"
  )
}

// T15: create — DB 생성 + AuditLog CREATE가 같은 트랜잭션 안에서 실행, 기본 상태 OPEN
{
  const fnStart = actionsSource.indexOf("export async function createDefectRecurrencePrevention")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\nexport async function", fnStart + 1))
  const hasCreate = /tx\.defectRecurrencePrevention\.create\(/.test(fnBody)
  const hasAudit = /action:\s*"CREATE"/.test(fnBody)
  const hasDefaultOpen = /status:\s*"OPEN"/.test(fnBody)
  const checksPrereq = /assertRecurrencePreventionPrerequisites\(/.test(fnBody)
  assertTrue(
    hasCreate && hasAudit && hasDefaultOpen && checksPrereq,
    "T15. createDefectRecurrencePrevention이 선행조건을 확인한 뒤 status 기본값 OPEN으로 생성하고 같은 트랜잭션에서 AuditLog CREATE를 기록"
  )
}

// T16: update — 소유권 확인 후에만 수정, 상태/검증 필드는 이 함수로 바꾸지 않음
{
  const fnStart = actionsSource.indexOf("export async function updateDefectRecurrencePrevention")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\nexport async function", fnStart + 1))
  const hasOwnershipCheck = /defectRecurrencePrevention\.findFirst\(\{\s*where:\s*\{\s*id,\s*tenantId\s*\}\s*\}\)/.test(fnBody)
  const hasUpdateCall = /tx\.defectRecurrencePrevention\.update\(/.test(fnBody)
  const touchesStatus = /data:\s*\{[^}]*status/.test(fnBody)
  const touchesVerification = /data:\s*\{[^}]*verification/.test(fnBody)
  assertTrue(
    hasOwnershipCheck && hasUpdateCall && !touchesStatus && !touchesVerification,
    "T16. updateDefectRecurrencePrevention은 {id, tenantId} 소유권 확인 후에만 preventionContent/assignee/dueDate를 수정하고 status·검증 필드는 건드리지 않음"
  )
}

// T17: 상태전이 OPEN→IN_PROGRESS — 낙관적 락(updateMany + status 가드) + AuditLog
{
  const fnStart = actionsSource.indexOf("export async function startDefectRecurrencePrevention")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\nexport async function", fnStart + 1))
  const hasGuardedUpdate = /updateMany\(\{\s*where:\s*\{\s*id:\s*current\.id,\s*tenantId,\s*status:\s*"OPEN"\s*\}/.test(fnBody)
  const hasRaceCheck = /claimed\.count\s*!==\s*1/.test(fnBody)
  const setsInProgress = /status:\s*"IN_PROGRESS"/.test(fnBody)
  assertTrue(
    hasGuardedUpdate && hasRaceCheck && setsInProgress,
    "T17. startDefectRecurrencePrevention이 status:'OPEN' 조건부 updateMany(낙관적 락)로만 IN_PROGRESS 전이를 허용하고 동시성 충돌을 감지"
  )
}

// T18: 상태전이 IN_PROGRESS→VERIFYING — 낙관적 락(updateMany + status 가드)
{
  const fnStart = actionsSource.indexOf("export async function submitDefectRecurrencePreventionForVerification")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\nexport async function", fnStart + 1))
  const hasGuardedUpdate = /updateMany\(\{\s*where:\s*\{\s*id:\s*current\.id,\s*tenantId,\s*status:\s*"IN_PROGRESS"\s*\}/.test(fnBody)
  const setsVerifying = /status:\s*"VERIFYING"/.test(fnBody)
  assertTrue(
    hasGuardedUpdate && setsVerifying,
    "T18. submitDefectRecurrencePreventionForVerification이 status:'IN_PROGRESS' 조건부 updateMany로만 VERIFYING 전이를 허용(대책 수행과 효과성 검증을 구분)"
  )
}

// T19: 효과성 검증 — VERIFYING 조건부 updateMany, EFFECTIVE→COMPLETED + completedAt 자동기록, INEFFECTIVE→IN_PROGRESS(미완료 유지)
{
  const fnStart = actionsSource.indexOf("export async function verifyDefectRecurrencePrevention")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\nexport type", fnStart + 1) === -1 ? actionsSource.length : actionsSource.indexOf("\nexport type", fnStart + 1))
  const hasGuardedUpdate = /updateMany\(\{\s*where:\s*\{\s*id:\s*current\.id,\s*tenantId,\s*status:\s*"VERIFYING"\s*\}/.test(fnBody)
  const branchesOnResult = /nextStatus\s*=\s*data\.verificationResult\s*===\s*"EFFECTIVE"\s*\?\s*"COMPLETED"\s*:\s*"IN_PROGRESS"/.test(fnBody)
  const setsCompletedAtOnlyWhenEffective = /completedAt\s*=\s*nextStatus\s*===\s*"COMPLETED"\s*\?\s*verifiedAt\s*:\s*null/.test(fnBody)
  const requiresVerifier = /검증담당자를 선택해 주세요/.test(fnBody)
  assertTrue(
    hasGuardedUpdate && branchesOnResult && setsCompletedAtOnlyWhenEffective && requiresVerifier,
    "T19. verifyDefectRecurrencePrevention이 status:'VERIFYING' 조건부 updateMany로만 검증을 허용하고, EFFECTIVE면 COMPLETED+completedAt 자동기록, INEFFECTIVE면 IN_PROGRESS로 되돌리며(completedAt은 null 유지) completedAt을 사용자가 직접 입력할 수 없음. 검증담당자 필수 입력도 강제됨"
  )
}

// T20: EFFECTIVE 검증 전 최종 완료 차단 — COMPLETED로의 유일한 경로가 verify 함수뿐임(별도 강제완료 함수 없음)
{
  const hasSeparateCompleteFn = /export async function completeDefectRecurrencePrevention/.test(actionsSource)
  assertTrue(
    !hasSeparateCompleteFn,
    "T20. 별도의 '강제 완료' 함수가 없어 COMPLETED 전이는 오직 verifyDefectRecurrencePrevention의 EFFECTIVE 분기를 통해서만 가능함(효과성 검증 없이 종료 불가)"
  )
}

// T21: 삭제 기능 미제공 — DefectCauseAnalysis/DefectCorrectiveAction과 동일 정책
{
  const hasDelete = /export async function delete/i.test(actionsSource)
  assertTrue(!hasDelete, "T21. defect-recurrence-prevention.actions.ts는 delete 함수를 export하지 않음(물리 삭제 미제공, 상태전이/수정/검증만 가능)")
}

// ─── T22: deleteQualityInspection은 downstream 재발방지 이력을 cascade 삭제하지 않고 guard로 차단함(source-check) ─
{
  const qualityActionsSource = fs.readFileSync("src/lib/actions/quality.actions.ts", "utf8")
  const fnStart = qualityActionsSource.indexOf("export async function deleteQualityInspection")
  const fnBody = qualityActionsSource.slice(fnStart, qualityActionsSource.indexOf("\nexport async function", fnStart + 1))
  assertTrue(
    /assertInspectionHistoryMutable\(tx, id, tenantId\)/.test(fnBody) &&
      !/defectRecurrencePrevention\.deleteMany/.test(fnBody) &&
      !/defectCauseAnalysis\.deleteMany/.test(fnBody) &&
      !/defectCorrectiveAction\.deleteMany/.test(fnBody),
    "T22. deleteQualityInspection은 DefectRecord 하위 원인분석/시정조치/재발방지를 cascade 삭제하지 않고 이력 guard로 차단함"
  )
}

// ─── T23: migration에 두 enum과 필수 인덱스가 존재 ──────────────────────────
{
  const migrationSql = fs.readFileSync(
    "prisma/migrations_legacy_nmes/20260904010000_add_defect_recurrence_prevention/migration.sql",
    "utf8"
  )
  const hasStatusEnum = /CREATE TYPE "RecurrencePreventionStatus" AS ENUM \('OPEN', 'IN_PROGRESS', 'VERIFYING', 'COMPLETED'\)/.test(migrationSql)
  const hasResultEnum = /CREATE TYPE "VerificationResult" AS ENUM \('EFFECTIVE', 'INEFFECTIVE'\)/.test(migrationSql)
  const hasTenantStatusIndex = /CREATE INDEX "DefectRecurrencePrevention_tenantId_status_idx"/.test(migrationSql)
  const hasTenantDueDateIndex = /CREATE INDEX "DefectRecurrencePrevention_tenantId_dueDate_idx"/.test(migrationSql)
  const hasAssigneeIndex = /CREATE INDEX "DefectRecurrencePrevention_assigneeId_idx"/.test(migrationSql)
  const hasDefectRecordIndex = /CREATE INDEX "DefectRecurrencePrevention_defectRecordId_idx"/.test(migrationSql)
  const hasVerifierFk = /DefectRecurrencePrevention_verifierId_fkey/.test(migrationSql)
  assertTrue(
    hasStatusEnum && hasResultEnum && hasTenantStatusIndex && hasTenantDueDateIndex && hasAssigneeIndex && hasDefectRecordIndex && hasVerifierFk,
    "T23. migration에 RecurrencePreventionStatus(4단계)/VerificationResult(2값) enum과 조회 패턴에 필요한 최소 인덱스, verifierId FK가 존재"
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
