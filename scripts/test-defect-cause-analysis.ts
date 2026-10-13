/**
 * PR #55 "원인분석" code-path test.
 *
 * defect-cause-analysis.helpers.ts는 DB에 의존하지 않는 순수 함수라 직접 검증한다
 * (scripts/test-measurement-validation.ts / test-spc-calculations.ts와 동일 방식).
 *
 * 이번 라운드는 migration을 아직 deploy하지 않아 실제 DB 접근 테스트는 할 수 없다.
 * tenant 재검증/중복 차단/삭제 순서처럼 DB(Prisma) 호출이 필수인 로직은, 실제
 * 배포된 소스 파일 텍스트를 읽어 정확한 패턴(where 절 체인, catch 처리, 트랜잭션
 * 순서)이 존재하는지 구조적으로 검증한다 — 이 라운드에서 가능한 최선의 code-path
 * 검증이며, 실제 실행 검증은 후속 DB smoke 승인 후 진행한다. 각 테스트 라벨에
 * "code-path"(순수 함수 직접 호출) 또는 "source-check"(실제 배포 소스 구조 검증)로
 * 구분해 표시한다.
 *
 * 실행:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/test-defect-cause-analysis.ts
 */
import * as fs from "fs"
import {
  normalizeRootCause,
  normalizeAnalysisDetail,
  buildAnalysisStatusWhere,
  serializeDefectCauseAnalysisRow,
  type DefectRecordLike,
} from "../src/lib/actions/defect-cause-analysis.helpers"
import { resolveKstDateRangeFilter } from "../src/lib/date/kst"

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

function makeRecord(overrides: Partial<DefectRecordLike> & { id: string }): DefectRecordLike {
  return {
    id: overrides.id,
    qty: overrides.qty ?? "5.000000",
    severity: overrides.severity ?? ("MAJOR" as never),
    disposition: overrides.disposition ?? null,
    defectCode: overrides.defectCode ?? { id: "dc-1", code: "DIM-001", name: "치수 초과" },
    qualityInspection: overrides.qualityInspection ?? {
      id: "qi-1",
      inspectedAt: new Date("2026-08-20T02:00:00.000Z"),
      stage: "MID" as never,
      workOrderOperation: {
        routingOperation: { name: "검사공정" },
        workOrder: { orderNo: "WO-1", manufacturingNo: "MFG-1", item: { code: "ITEM-1", name: "테스트품목" } },
      },
    },
    causeAnalysis: overrides.causeAnalysis === undefined ? null : overrides.causeAnalysis,
  }
}

// ─── C1~C2: rootCause 정규화 ─────────────────────────────────────────────────
assertEqual(normalizeRootCause("  지그 마모로 인한 치수 이탈  "), "지그 마모로 인한 치수 이탈", "C1. rootCause 정상 trim")
assertThrows(() => normalizeRootCause("   "), "C2. 빈 rootCause(공백만) 차단")
assertThrows(() => normalizeRootCause(""), "C2. 빈 rootCause(빈 문자열) 차단")
assertEqual(normalizeAnalysisDetail("  상세 내용  "), "상세 내용", "C1. analysisDetail 정상 trim")
assertEqual(normalizeAnalysisDetail("   "), null, "C1. analysisDetail 공백만이면 null")
assertEqual(normalizeAnalysisDetail(undefined), null, "C1. analysisDetail 미입력이면 null")

// ─── C3: DefectRecord 1건당 분석 1건 정책 (source-check: migration unique index) ─
{
  const migrationSql = fs.readFileSync(
    "prisma/migrations_legacy_nmes/20260903000000_add_defect_cause_analysis/migration.sql",
    "utf8"
  )
  const hasUniqueIndex = /CREATE UNIQUE INDEX "DefectCauseAnalysis_defectRecordId_key" ON "DefectCauseAnalysis"\("defectRecordId"\)/.test(
    migrationSql
  )
  assertTrue(hasUniqueIndex, "C3. migration에 defectRecordId unique index 존재(1:0..1 정책의 DB-level 보증)")
}

const actionsSource = fs.readFileSync("src/lib/actions/defect-cause-analysis.actions.ts", "utf8")
const qualityActionsSource = fs.readFileSync("src/lib/actions/quality.actions.ts", "utf8")

// ─── C4: 동일 defectRecord duplicate 차단 (source-check) ────────────────────
{
  const hasP2002Catch = /isUniqueConstraintError\(error\)/.test(actionsSource)
  const hasFriendlyMessage = actionsSource.includes("이미 원인분석이 등록된 불량입니다.")
  assertTrue(hasP2002Catch && hasFriendlyMessage, "C4. createDefectCauseAnalysis가 P2002를 catch해 friendly error로 변환")
}

// ─── C5: cross-tenant defectRecord 차단 로직 (source-check) ─────────────────
{
  const pattern = /qualityInspection:\s*\{\s*workOrderOperation:\s*\{\s*workOrder:\s*\{\s*tenantId\s*\}\s*\}\s*\}/
  assertTrue(pattern.test(actionsSource), "C5. assertDefectRecordInTenant가 DefectRecord→QualityInspection→WorkOrderOperation→WorkOrder→tenantId 체인으로 검증")
}

// ─── C6: update 정상 (source-check) ──────────────────────────────────────────
{
  const hasUpdateCall = /tx\.defectCauseAnalysis\.update\(/.test(actionsSource)
  const hasUpdateAudit = /action:\s*"UPDATE"/.test(actionsSource)
  assertTrue(hasUpdateCall && hasUpdateAudit, "C6. updateDefectCauseAnalysis가 실제 update + AuditLog UPDATE를 기록")
}

// ─── C7: cross-tenant analysis update 차단 (source-check) ───────────────────
{
  const updateFnBody = actionsSource.slice(actionsSource.indexOf("export async function updateDefectCauseAnalysis"))
  const hasOwnershipCheck = /defectCauseAnalysis\.findFirst\(\{\s*where:\s*\{\s*id,\s*tenantId\s*\}\s*\}\)/.test(updateFnBody)
  assertTrue(hasOwnershipCheck, "C7. updateDefectCauseAnalysis가 {id, tenantId} 소유권 검증 후에만 수정")
}

// ─── C8~C10: 분석여부 필터 ───────────────────────────────────────────────────
assertEqual(buildAnalysisStatusWhere("ALL"), {}, "C8. 분석여부 ALL은 필터 없음")
assertEqual(buildAnalysisStatusWhere(undefined), {}, "C8. 분석여부 미지정도 필터 없음")
assertEqual(buildAnalysisStatusWhere("ANALYZED"), { causeAnalysis: { isNot: null } }, "C9. ANALYZED는 causeAnalysis 존재 조건")
assertEqual(buildAnalysisStatusWhere("UNANALYZED"), { causeAnalysis: null }, "C10. UNANALYZED는 causeAnalysis 없음 조건")

// ─── C11: 한 QualityInspection에 DefectRecord 여러 건 → 각각 독립 flatten ───
{
  const sharedInspection = {
    id: "qi-shared",
    inspectedAt: new Date("2026-08-20T02:00:00.000Z"),
    stage: "MID" as never,
    workOrderOperation: {
      routingOperation: { name: "검사공정" },
      workOrder: { orderNo: "WO-1", manufacturingNo: "MFG-1", item: { code: "ITEM-1", name: "테스트품목" } },
    },
  }
  const r1 = makeRecord({ id: "dr-1", qualityInspection: sharedInspection, defectCode: { id: "dc-1", code: "DIM-001", name: "치수 초과" } })
  const r2 = makeRecord({ id: "dr-2", qualityInspection: sharedInspection, defectCode: { id: "dc-2", code: "VIS-001", name: "외관 불량" } })
  const row1 = serializeDefectCauseAnalysisRow(r1)
  const row2 = serializeDefectCauseAnalysisRow(r2)
  assertTrue(
    row1.defectRecordId === "dr-1" && row2.defectRecordId === "dr-2" && row1.defectCode !== row2.defectCode,
    "C11. 같은 검사(qi-shared)라도 DefectRecord별로 독립된 row(서로 다른 defectRecordId/defectCode)로 직렬화됨"
  )
}

// ─── C12: 동일 defectCode가 같은 검사에 중복되어도 DefectRecord.id 기준 분리 ─
{
  const sameDefectCode = { id: "dc-1", code: "DIM-001", name: "치수 초과" }
  const analyzed = {
    id: "analysis-1",
    rootCause: "지그 마모",
    analysisDetail: null,
    updatedAt: new Date("2026-08-21T00:00:00.000Z"),
    updatedBy: { name: "김품질" },
  }
  const r1 = makeRecord({ id: "dr-a", defectCode: sameDefectCode, causeAnalysis: analyzed })
  const r2 = makeRecord({ id: "dr-b", defectCode: sameDefectCode, causeAnalysis: null })
  const row1 = serializeDefectCauseAnalysisRow(r1)
  const row2 = serializeDefectCauseAnalysisRow(r2)
  assertTrue(
    row1.defectCode === row2.defectCode &&
      row1.defectRecordId !== row2.defectRecordId &&
      row1.analysisStatus === "ANALYZED" &&
      row2.analysisStatus === "UNANALYZED",
    "C12. 동일 defectCode(DIM-001)라도 DefectRecord.id가 다르면 분석 상태가 독립적으로 유지됨(dr-a만 분석완료)"
  )
}

// ─── C13: KST 기간 경계 helper 사용 확인 ─────────────────────────────────────
{
  const { fromDate, toDate } = resolveKstDateRangeFilter(30, "2026-09-02", "2026-09-02")
  assertEqual(fromDate.toISOString(), "2026-09-01T15:00:00.000Z", "C13. KST 00:00:00.000 시작 경계")
  assertEqual(toDate.toISOString(), "2026-09-02T14:59:59.999Z", "C13. KST 23:59:59.999 종료 경계")

  const fallback = resolveKstDateRangeFilter(30, "2026-02-30", "2026-09-02", new Date("2026-09-02T03:00:00.000Z"))
  assertEqual(fallback.from, "2026-08-03", "C13. 잘못된 날짜 입력 시 기본 30일 범위로 안전하게 대체")
}

// ─── C14: 기존 defect에 analysis 없음 상태도 정상 조회 ──────────────────────
{
  const unanalyzed = makeRecord({ id: "dr-legacy", causeAnalysis: null })
  const row = serializeDefectCauseAnalysisRow(unanalyzed)
  assertTrue(
    row.analysisStatus === "UNANALYZED" &&
      row.analysisId === null &&
      row.rootCause === null &&
      row.analysisDetail === null &&
      row.updatedByName === null &&
      row.updatedAt === null,
    "C14. causeAnalysis가 없어도 예외 없이 UNANALYZED로 정상 직렬화"
  )
}

// ─── C15~C17: deleteQualityInspection tenant 검증 + 삭제 순서 (source-check) ─
{
  const fnStart = qualityActionsSource.indexOf("export async function deleteQualityInspection")
  const nextFnStart = qualityActionsSource.indexOf("\nexport async function", fnStart + 1)
  const fnBody = qualityActionsSource.slice(fnStart, nextFnStart > 0 ? nextFnStart : fnStart + 1600)

  const idxGetTenantId = fnBody.indexOf("getTenantId()")
  const idxOwnershipCheck = fnBody.indexOf("tx.qualityInspection.findFirst(")
  const idxThrow = fnBody.indexOf('throw new Error("검사 기록을 찾을 수 없습니다.")')
  const idxCauseAnalysis = fnBody.indexOf("defectCauseAnalysis.deleteMany")
  const idxMeasurement = fnBody.indexOf("inspectionMeasurement.deleteMany")
  const idxDefectRecord = fnBody.indexOf("defectRecord.deleteMany")
  const idxInspectionDelete = fnBody.indexOf("qualityInspection.delete(")

  const ownershipWherePattern = /where:\s*\{\s*id,\s*workOrderOperation:\s*\{\s*workOrder:\s*\{\s*tenantId\s*\}\s*\}\s*\}/
  const hasOwnershipWhere = ownershipWherePattern.test(fnBody)

  // C16: 정상 케이스 — tenant 소속 확인(getTenantId + {id, workOrderOperation.workOrder.tenantId}
  // 조회)이 실제 삭제들보다 먼저 실행되고, 통과하면 그 뒤로 삭제가 이어지는 구조인지 확인.
  assertTrue(
    idxGetTenantId >= 0 &&
      idxOwnershipCheck >= 0 &&
      hasOwnershipWhere &&
      idxCauseAnalysis >= 0 &&
      idxOwnershipCheck < idxCauseAnalysis,
    "C16. tenant 소속 확인(getTenantId + {id, workOrderOperation.workOrder.tenantId} 조회)이 삭제들보다 먼저 실행되고, 통과 시 실제 삭제로 이어짐"
  )

  // C17: cross-tenant 차단 — 소유권 조회 결과가 없으면(다른 tenant의 id) 어떤 delete보다도 먼저 throw한다.
  assertTrue(
    idxThrow >= 0 &&
      idxThrow > idxOwnershipCheck &&
      idxThrow < idxCauseAnalysis &&
      idxThrow < idxMeasurement &&
      idxThrow < idxDefectRecord &&
      idxThrow < idxInspectionDelete,
    'C17. 소유권 조회 실패 시 "검사 기록을 찾을 수 없습니다." throw가 모든 delete보다 먼저 실행되어(같은 트랜잭션 내) 다른 tenant의 삭제를 원천 차단'
  )

  // C15: defectCauseAnalysis → (measurement/defectRecord) → qualityInspection 순으로 삭제(RESTRICT FK 위반 없이)
  assertTrue(
    idxCauseAnalysis >= 0 && idxCauseAnalysis < idxDefectRecord && idxDefectRecord < idxInspectionDelete && idxMeasurement < idxInspectionDelete,
    "C15. deleteQualityInspection이 defectCauseAnalysis → (measurement/defectRecord) → qualityInspection 순으로 삭제(RESTRICT FK 위반 없이)"
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
