import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  calculateWorkDurationMinutes,
  resolveProductionResultTime,
} from "../src/lib/pop-worktime-operator"

let passed = 0
let failed = 0
function assert(condition: boolean, label: string) {
  if (condition) passed++
  else { failed++; console.error(`FAIL: ${label}`) }
}
function assertThrows(run: () => unknown, includes: string, label: string) {
  try { run(); assert(false, label) }
  catch (error) { assert(error instanceof Error && error.message.includes(includes), label) }
}

const start = new Date("2026-09-07T01:00:00.000Z")
const assignmentStart = new Date("2026-09-07T01:05:00.000Z")
const previousEnd = new Date("2026-09-07T01:30:00.000Z")
const end = new Date("2026-09-07T02:00:00.000Z")

assert(resolveProductionResultTime({ endedAt: end, operationStartedAt: start }).startedAt === start, "작업 시작시각을 첫 실적에 보존")
assert(resolveProductionResultTime({ endedAt: end, operationStartedAt: start }).endedAt === end, "실적 등록시각을 종료시각으로 보존")
assert(resolveProductionResultTime({ endedAt: end, operationStartedAt: start }).endedAt >= start, "종료시각은 시작시각 이후")
assert(resolveProductionResultTime({ endedAt: end, operationStartedAt: start }).startedAt !== end, "등록시점으로 시작시각을 덮어쓰지 않음")
assert(resolveProductionResultTime({ endedAt: end, operationStartedAt: start, assignmentStartedAt: assignmentStart }).startedAt === assignmentStart, "설비배정 시작시각 우선")
assert(resolveProductionResultTime({ endedAt: end, operationStartedAt: start, previousResultEndedAt: previousEnd }).startedAt === previousEnd, "다중 실적은 직전 종료부터 시작")
assert(resolveProductionResultTime({ endedAt: end, operationStartedAt: start, assignmentStartedAt: assignmentStart, previousResultEndedAt: previousEnd }).startedAt === previousEnd, "설비별 다중 실적 중복시간 방지")
assert(resolveProductionResultTime({ endedAt: end, operationStartedAt: null }).startedAt === null, "기존 nullable 시작시각 호환")
assertThrows(() => resolveProductionResultTime({ endedAt: start, operationStartedAt: end }), "빠를 수 없습니다", "역전 시간 차단")
assert(calculateWorkDurationMinutes(start, end) === 60, "작업시간 분 계산")
assert(calculateWorkDurationMinutes(null, end) === null, "시작시각 없는 작업시간은 null")
assert(calculateWorkDurationMinutes(end, start) === null, "음수 작업시간 제외")

const root = process.cwd()
const pop = readFileSync(join(root, "src/lib/actions/pop.actions.ts"), "utf8")
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const resultAction = readFileSync(join(root, "src/lib/actions/production-result.actions.ts"), "utf8")
const resultColumns = readFileSync(join(root, "src/app/app/mes/production-results/columns.tsx"), "utf8")
const reportHelper = readFileSync(join(root, "src/lib/actions/report.helpers.ts"), "utf8")
const reportUi = readFileSync(join(root, "src/app/app/mes/reports/production-daily/production-daily-report-client.tsx"), "utf8")

assert(pop.includes('data: { status: "IN_PROGRESS", startedAt }'), "작업 시작 시 서버 startedAt 저장")
assert(pop.includes('data: { status: "IN_PROGRESS", startedAt }') && pop.includes("workOrderOperationAssignment.update"), "설비배정 시작시각 저장")
assert(pop.includes("operatorId: authCtx.profileId"), "실적 작업자는 인증 context에서 저장")
assert(pop.includes("isActive: true"), "비활성 작업자 차단")
assert(pop.includes("id: authCtx.session.tenantUserId"), "POP PIN TenantUser 정본 확인")
assert(pop.indexOf("if (popWorkerSession)") < pop.indexOf('const user = await requireRole("OPERATOR")'), "일반 로그인보다 POP PIN 작업자 우선")
assert(pop.includes("tenantId: authCtx.tenantId") && pop.includes("profileId: authCtx.profileId"), "다른 tenant 작업자 주입 차단")
assert(!pop.includes("operatorId: data."), "클라이언트 operatorId 주입 없음")
assert(schema.includes("operatorId                     String?"), "기존 실적 nullable 작업자 호환")
assert(schema.includes("startedAt          DateTime?"), "공정 시작시각 nullable schema")
assert(resultAction.includes("operator: { select: { id: true, name: true } }"), "생산실적 조회 작업자 연결")
assert(resultAction.includes("calculateWorkDurationMinutes"), "생산실적 조회 작업시간 연결")
assert(resultColumns.includes('title="작업자"') && resultColumns.includes('title="작업시간"'), "생산실적 화면 작업자·작업시간 표시")
assert(reportHelper.includes("operatorName: r.operator?.name ?? null"), "생산일보 작업자 정본 재사용")
assert(reportUi.includes("formatKstDateTime(r.startedAt)"), "생산일보 KST 표시")
assert(pop.includes("assertOperationStartAllowed") && pop.includes("assertOperationResultAllowed"), "F03 검증 유지")

console.log(`pop-worktime-operator: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
