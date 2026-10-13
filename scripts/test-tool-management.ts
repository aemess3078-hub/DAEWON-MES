/**
 * 사업계획서 "설비관리 > 공구관리" code-path test.
 *
 * tool.helpers.ts는 DB에 의존하지 않는 순수 함수라 직접 검증한다
 * (defect-corrective-action.helpers.ts와 동일 방식). tenant 재검증/적용품목·
 * 작업자 검증/삭제 참조검사/사용량 누적/DISCARDED 역행 차단처럼 DB(Prisma)
 * 호출이 필수인 로직은, 실제 배포된 소스 파일 텍스트를 읽어 정확한 패턴이
 * 존재하는지 구조적으로 검증한다("code-path"/"source-check" 라벨 규칙은
 * scripts/test-corrective-action.ts와 동일).
 *
 * 실행:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/test-tool-management.ts
 */
import * as fs from "fs"
import {
  normalizeToolCode,
  normalizeToolName,
  normalizeLifeLimit,
  normalizeUsageCount,
  computeRemainingLife,
  computeUsageRate,
  buildToolStatusWhere,
  buildToolTypeWhere,
  serializeToolRow,
  type ToolRecordLike,
} from "../src/lib/actions/tool.helpers"

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

function makeRecord(overrides: Partial<ToolRecordLike> & { id: string }): ToolRecordLike {
  return {
    id: overrides.id,
    code: overrides.code ?? "TOOL-001",
    name: overrides.name ?? "드릴 지그 A형",
    equipmentType: overrides.equipmentType ?? ("JIG" as never),
    status: overrides.status ?? ("ACTIVE" as never),
    siteId: overrides.siteId ?? "site-1",
    site: overrides.site ?? { name: "본사" },
    workCenterId: overrides.workCenterId ?? "wc-1",
    workCenter: overrides.workCenter ?? { name: "기계가공반" },
    lifeLimit: overrides.lifeLimit === undefined ? 100000 : overrides.lifeLimit,
    currentUsage: overrides.currentUsage ?? 82500,
    updatedAt: overrides.updatedAt ?? new Date("2026-09-01T00:00:00.000Z"),
    appliedItems: overrides.appliedItems ?? [{ item: { id: "item-1", code: "FG-001", name: "완제품 A형" } }],
    usageHistories: overrides.usageHistories ?? [{ usedAt: new Date("2026-08-30T00:00:00.000Z") }],
  }
}

// ─── T1~T2: 공구번호/공구명 정규화 — identifier이므로 trim만, 포맷 변환 없음 ─
assertEqual(normalizeToolCode("  TOOL-001  "), "TOOL-001", "T1. 공구번호 정상 trim(값 자체는 변형하지 않음 — comma formatting 대상 아님)")
assertThrows(() => normalizeToolCode("   "), "T1. 빈 공구번호(공백만) 차단")
assertThrows(() => normalizeToolCode(""), "T1. 빈 공구번호(빈 문자열) 차단")
assertEqual(normalizeToolName("  드릴 지그  "), "드릴 지그", "T2. 공구명 정상 trim")
assertThrows(() => normalizeToolName(""), "T2. 빈 공구명 차단")

// ─── T3: 수명기준(lifeLimit) — 선택값, 입력 시 1 이상 정수만 허용 ───────────
assertEqual(normalizeLifeLimit(null), null, "T3. lifeLimit 미입력(null)은 수명 관리 안 함으로 정상 처리")
assertEqual(normalizeLifeLimit(undefined), null, "T3. lifeLimit 미입력(undefined)은 수명 관리 안 함으로 정상 처리")
assertEqual(normalizeLifeLimit(""), null, "T3. lifeLimit 빈 문자열도 수명 관리 안 함으로 처리")
assertEqual(normalizeLifeLimit("100000"), 100000, "T3. lifeLimit 문자열 입력은 정수로 변환")
assertThrows(() => normalizeLifeLimit(0), "T3. lifeLimit 0 이하 차단")
assertThrows(() => normalizeLifeLimit(-5), "T3. lifeLimit 음수 차단")
assertThrows(() => normalizeLifeLimit(1.5), "T3. lifeLimit 소수 차단")

// ─── T4: 사용이력의 사용량(usageCount) — 1 이상 정수만 허용 ─────────────────
assertEqual(normalizeUsageCount(500), 500, "T4. usageCount 정상값 통과")
assertEqual(normalizeUsageCount("500"), 500, "T4. usageCount 문자열 입력은 정수로 변환")
assertThrows(() => normalizeUsageCount(0), "T4. usageCount 0 차단")
assertThrows(() => normalizeUsageCount(-1), "T4. usageCount 음수 차단")
assertThrows(() => normalizeUsageCount(1.5), "T4. usageCount 소수 차단")

// ─── T5~T6: 잔여수명/사용률 계산 — DB 컬럼 없이 조회 시점 계산 ──────────────
assertEqual(computeRemainingLife(100000, 82500), 17500, "T5. 잔여수명 = 수명기준 - 현재사용량")
assertEqual(computeRemainingLife(null, 82500), null, "T5. 수명기준 미설정이면 잔여수명 계산 안 함(null)")
assertEqual(computeRemainingLife(100000, 120000), -20000, "T5. 수명 초과 시 잔여수명은 음수로 계산(별도 상태 컬럼으로 저장하지 않음)")
assertEqual(computeUsageRate(100000, 82500), 82.5, "T6. 사용률 = 현재사용량 / 수명기준 * 100")
assertEqual(computeUsageRate(null, 82500), null, "T6. 수명기준 미설정이면 사용률 계산 안 함(null)")
assertEqual(computeUsageRate(0, 100), null, "T6. 수명기준 0으로 나누기 방지")

// ─── T7~T8: 상태/유형 필터 where절 조립 ──────────────────────────────────────
assertEqual(buildToolStatusWhere("ALL"), {}, "T7. 상태 ALL은 필터 없음")
assertEqual(buildToolStatusWhere(undefined), {}, "T7. 상태 미지정도 필터 없음")
assertEqual(buildToolStatusWhere("ACTIVE" as never), { status: "ACTIVE" }, "T7. ACTIVE는 status 컬럼 필터")
assertEqual(buildToolStatusWhere("DISCARDED" as never), { status: "DISCARDED" }, "T7. DISCARDED도 status 컬럼 필터")
assertEqual(buildToolTypeWhere("ALL"), {}, "T8. 유형 ALL은 필터 없음")
assertEqual(buildToolTypeWhere("JIG"), { equipmentType: "JIG" }, "T8. JIG는 equipmentType 컬럼 필터")

// ─── T9~T10: 직렬화 — 수명 계산값/적용품목/최근사용일 매핑 ──────────────────
{
  const record = makeRecord({ id: "eq-1" })
  const row = serializeToolRow(record)
  assertTrue(
    row.remainingLife === 17500 && row.usageRate === 82.5 && row.appliedItems.length === 1 && row.appliedItems[0].name === "완제품 A형",
    "T9. 직렬화 결과에 잔여수명/사용률이 정확히 계산되고 적용품목이 그대로 매핑됨"
  )
  assertEqual(row.lastUsedAt, "2026-08-30T00:00:00.000Z", "T9. 최근사용일은 usageHistories의 첫 번째(최신) 항목에서 추출")
}
{
  const record = makeRecord({ id: "eq-2", lifeLimit: null, appliedItems: [], usageHistories: [] })
  const row = serializeToolRow(record)
  assertTrue(
    row.remainingLife === null && row.usageRate === null && row.appliedItems.length === 0 && row.lastUsedAt === null,
    "T10. 수명기준/적용품목/사용이력이 전부 없어도 예외 없이 null/빈 배열로 정상 직렬화"
  )
}

// ─── T11~T20: source-check — tool.actions.ts 실제 구조 검증 ─────────────────
const actionsSource = fs.readFileSync("src/lib/actions/tool.actions.ts", "utf8")

// T11: cross-tenant 공구 차단 — tenantId 직접 재검증
{
  const fnStart = actionsSource.indexOf("async function assertToolInTenant")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\n/**", fnStart + 1))
  const hasTenantCheck = /equipment\.findFirst\(\{\s*where:\s*\{\s*id,\s*tenantId,\s*equipmentType:\s*\{\s*in:\s*\[\.\.\.TOOL_TYPES\]\s*\}\s*\}/.test(fnBody)
  assertTrue(hasTenantCheck, "T11. assertToolInTenant이 {id, tenantId, equipmentType in TOOL_TYPES} 조건으로 cross-tenant 공구를 차단")
}

// T12: cross-tenant 적용품목 차단 — 개수 비교로 존재하지 않거나 다른 tenant 품목 검출
{
  const fnStart = actionsSource.indexOf("async function assertItemsInTenant")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\n/**", fnStart + 1))
  const hasCountCheck = /item\.count\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*itemIds\s*\},\s*tenantId\s*\}/.test(fnBody)
  const comparesCount = /count\s*!==\s*itemIds\.length/.test(fnBody)
  assertTrue(hasCountCheck && comparesCount, "T12. assertItemsInTenant이 tenant 소속 품목 개수를 비교해 cross-tenant/존재하지 않는 품목을 차단")
}

// T13: cross-tenant 작업자 차단 — 활성 TenantUser만 허용(사용이력 등록 시 재사용)
{
  const hasUserCheck = /tenantUser\.findFirst\(\{\s*where:\s*\{\s*profileId:\s*userId,\s*tenantId,\s*isActive:\s*true\s*\}/.test(actionsSource)
  const usedInUsageHistory = /assertTenantUserValid\(tenantId,\s*operatorId\)/.test(actionsSource)
  assertTrue(hasUserCheck && usedInUsageHistory, "T13. assertTenantUserValid가 {profileId, tenantId, isActive:true} 조건으로 사용이력의 작업자 cross-tenant 지정을 차단")
}

// T14: create — 신규 공구는 status 기본값 ACTIVE, 적용품목은 같은 트랜잭션에서 함께 생성, AuditLog CREATE
{
  const fnStart = actionsSource.indexOf("export async function createTool")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\n// ─── 수정", fnStart + 1))
  const hasCreate = /tx\.equipment\.create\(/.test(fnBody)
  const setsActive = /status:\s*"ACTIVE"/.test(fnBody)
  const createsAppliedItems = /tx\.equipmentAppliedItem\.createMany\(/.test(fnBody)
  const hasAudit = /action:\s*"CREATE"/.test(fnBody)
  const checksCodeUnique = /equipment\.findUnique\(\{\s*where:\s*\{\s*siteId_code:/.test(fnBody)
  assertTrue(
    hasCreate && setsActive && createsAppliedItems && hasAudit && checksCodeUnique,
    "T14. createTool이 공구번호 중복(사이트 내)을 사전 확인하고, status 기본값 ACTIVE로 생성하며, 적용품목을 같은 트랜잭션에서 함께 생성하고 AuditLog CREATE를 기록"
  )
}

// T15: update — DISCARDED에서 다른 상태로의 역행 전이를 명시적으로 차단
{
  const fnStart = actionsSource.indexOf("export async function updateTool")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\n// ─── 삭제", fnStart + 1))
  const blocksRevert = /existing\.status\s*===\s*"DISCARDED"\s*&&\s*data\.status\s*&&\s*data\.status\s*!==\s*"DISCARDED"/.test(fnBody)
  assertTrue(blocksRevert, "T15. updateTool이 이미 DISCARDED(폐기)인 공구를 다른 상태로 되돌리는 요청을 명시적으로 차단")
}

// T16: update — 적용품목은 replace 방식(기존 삭제 후 재생성)으로 갱신, AuditLog UPDATE
{
  const fnStart = actionsSource.indexOf("export async function updateTool")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\n// ─── 삭제", fnStart + 1))
  const deletesOld = /tx\.equipmentAppliedItem\.deleteMany\(\{\s*where:\s*\{\s*equipmentId:\s*id\s*\}\s*\}\)/.test(fnBody)
  const createsNew = /tx\.equipmentAppliedItem\.createMany\(/.test(fnBody)
  const hasAudit = /action:\s*"UPDATE"/.test(fnBody)
  assertTrue(deletesOld && createsNew && hasAudit, "T16. updateTool이 적용품목을 전체 삭제 후 재생성하는 방식으로 갱신하고 AuditLog UPDATE를 기록")
}

// T17: delete — 사용/점검/수리 이력 또는 작업지시 배정이 있으면 물리 삭제 차단
{
  const fnStart = actionsSource.indexOf("export async function deleteTool")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\n// ─── 사용이력", fnStart + 1))
  const checksUsage = /equipmentUsageHistory\.count\(/.test(fnBody)
  const checksRepair = /equipmentRepairRequest\.count\(/.test(fnBody)
  const checksCheck = /equipmentDailyCheck\.count\(/.test(fnBody)
  const checksOp = /workOrderOperation\.count\(/.test(fnBody)
  const blocksWhenRefsExist = /totalRefs\s*>\s*0/.test(fnBody)
  assertTrue(
    checksUsage && checksRepair && checksCheck && checksOp && blocksWhenRefsExist,
    "T17. deleteTool이 사용이력/수리이력/점검이력/작업지시 배정 4가지를 모두 확인해 이력이 하나라도 있으면 물리 삭제를 차단(추적성 보존, mold.actions.ts의 deleteMold와 동일 정책)"
  )
}

// T18: delete — 이력이 없을 때만 실제 삭제 + AuditLog DELETE, 적용품목은 함께 정리
{
  const fnStart = actionsSource.indexOf("export async function deleteTool")
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\n// ─── 사용이력", fnStart + 1))
  const cleansAppliedItems = /tx\.equipmentAppliedItem\.deleteMany\(\{\s*where:\s*\{\s*equipmentId:\s*id\s*\}\s*\}\)/.test(fnBody)
  const deletesEquipment = /tx\.equipment\.deleteMany\(\{\s*where:\s*\{\s*id,\s*tenantId\s*\}\s*\}\)/.test(fnBody)
  const hasAudit = /action:\s*"DELETE"/.test(fnBody)
  assertTrue(cleansAppliedItems && deletesEquipment && hasAudit, "T18. deleteTool이 이력이 없는 공구는 적용품목 연결까지 정리한 뒤 물리 삭제하고 AuditLog DELETE를 기록")
}

// T19: 사용이력 등록 — 등록과 동시에 같은 트랜잭션에서 currentUsage를 누적, AuditLog CREATE
{
  const fnStart = actionsSource.indexOf("export async function createToolUsageHistory")
  const fnBody = actionsSource.slice(fnStart)
  const createsUsage = /tx\.equipmentUsageHistory\.create\(/.test(fnBody)
  const incrementsUsage = /currentUsage:\s*\{\s*increment:\s*usageCount\s*\}/.test(fnBody)
  const hasAudit = /entityType:\s*"EquipmentUsageHistory"/.test(fnBody) && /action:\s*"CREATE"/.test(fnBody)
  assertTrue(
    createsUsage && incrementsUsage && hasAudit,
    "T19. createToolUsageHistory가 사용이력 생성과 Equipment.currentUsage 누적을 같은 트랜잭션에서 처리하고 AuditLog CREATE를 기록(사용자가 currentUsage를 직접 입력하지 않음)"
  )
}

// T20: 사용이력은 append-only — update/delete 함수를 export하지 않음(InventoryTransaction/WipMovement와 동일 이력 정책)
{
  const hasUpdateUsage = /export async function update.*UsageHistory/i.test(actionsSource)
  const hasDeleteUsage = /export async function delete.*UsageHistory/i.test(actionsSource)
  assertTrue(!hasUpdateUsage && !hasDeleteUsage, "T20. 사용이력(EquipmentUsageHistory)은 등록만 가능한 append-only 이력이며 수정/삭제 함수를 export하지 않음")
}

// ─── T21: 기존 설비수리/점검이력 기능을 재사용(중복 재구현 금지) ────────────
{
  const importsExisting = /import\s*\{\s*getRepairRequests,\s*getDailyChecks\s*\}\s*from\s*"\.\/equipment-management\.actions"/.test(actionsSource)
  const callsExisting = /getRepairRequests\(\{\s*equipmentId:\s*id\s*\}\)/.test(actionsSource) && /getDailyChecks\(\{\s*equipmentId:\s*id\s*\}\)/.test(actionsSource)
  const noOwnRepairModel = !/model\s+ToolRepair|model\s+ToolInspection/.test(fs.readFileSync("prisma/schema.prisma", "utf8"))
  assertTrue(
    importsExisting && callsExisting && noOwnRepairModel,
    "T21. tool.actions.ts가 새 수리/점검 이력 모델을 만들지 않고 기존 equipment-management.actions.ts의 getRepairRequests/getDailyChecks를 그대로 재사용"
  )
}

// ─── T22: identifier(공구번호) 보존 — 목록 컬럼에서 comma formatter를 적용하지 않음 ─
{
  const columnsSource = fs.readFileSync("src/app/app/mes/equipment-tools/columns.tsx", "utf8")
  const codeColumnBlock = columnsSource.slice(
    columnsSource.indexOf('accessorKey: "code"'),
    columnsSource.indexOf('accessorKey: "name"')
  )
  const wrapsWithFormatQuantity = /formatQuantity\(row\.original\.code\)/.test(codeColumnBlock)
  const rendersRaw = /row\.original\.code/.test(codeColumnBlock)
  assertTrue(!wrapsWithFormatQuantity && rendersRaw, "T22. 공구번호(identifier) 컬럼은 formatQuantity 등 숫자 콤마 포맷터를 절대 적용하지 않고 원본 문자열 그대로 렌더링")
}

// ─── T23: migration에 DISCARDED enum 값과 신규 테이블/인덱스/FK가 존재 ──────
{
  const migrationSql = fs.readFileSync(
    "prisma/migrations_legacy_nmes/20260904020000_add_equipment_tool_management/migration.sql",
    "utf8"
  )
  const addsDiscarded = /ALTER TYPE "EquipmentStatus" ADD VALUE 'DISCARDED'/.test(migrationSql)
  const addsLifeFields = /ADD COLUMN\s+"currentUsage" INTEGER NOT NULL DEFAULT 0/.test(migrationSql) && /ADD COLUMN\s+"lifeLimit" INTEGER/.test(migrationSql)
  const hasAppliedItemTable = /CREATE TABLE "EquipmentAppliedItem"/.test(migrationSql)
  const hasUsageHistoryTable = /CREATE TABLE "EquipmentUsageHistory"/.test(migrationSql)
  const hasAppliedItemUnique = /CREATE UNIQUE INDEX "EquipmentAppliedItem_equipmentId_itemId_key"/.test(migrationSql)
  const hasUsageTenantIndex = /CREATE INDEX "EquipmentUsageHistory_tenantId_idx"/.test(migrationSql)
  const hasUsageEquipmentIndex = /CREATE INDEX "EquipmentUsageHistory_equipmentId_idx"/.test(migrationSql)
  assertTrue(
    addsDiscarded && addsLifeFields && hasAppliedItemTable && hasUsageHistoryTable && hasAppliedItemUnique && hasUsageTenantIndex && hasUsageEquipmentIndex,
    "T23. migration이 EquipmentStatus.DISCARDED 추가, Equipment.lifeLimit/currentUsage 컬럼 추가, EquipmentAppliedItem/EquipmentUsageHistory 테이블과 필요한 최소 인덱스를 포함"
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
