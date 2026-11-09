/**
 * POP 공정별 조회 · 통합 검색 단위 테스트(순수 로직 + 소스 점검). 실행: npm run test:pop-process-filter
 */
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import Module from "node:module"
import { join } from "node:path"

const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const F = require("../src/lib/pop-process-filter") as typeof import("../src/lib/pop-process-filter")

let pass = 0
const ok = (cond: unknown, name: string) => {
  assert.ok(cond, name)
  pass += 1
  console.log(`PASS ${name}`)
}
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8")

type Op = import("../src/lib/pop-process-filter").PopOperationLite
const op = (id: string, seq: number, status: string, name: string, equipment: string | null = null, assignments: { id: string; status: string; eq: string | null }[] = []): Op => ({
  id, seq, status,
  routingOperation: { name },
  equipment: equipment ? { name: equipment } : null,
  assignments: assignments.map((a) => ({ id: a.id, status: a.status, equipment: a.eq ? { name: a.eq } : null })),
})
type Wo = import("../src/lib/pop-process-filter").PopWorkOrderLite
const wo = (id: string, orderNo: string, mfg: string | null, code: string, name: string, operations: Op[]): Wo => ({ id, orderNo, manufacturingNo: mfg, item: { code, name }, operations })

const list: Wo[] = [
  // WO-1: 절단 진행중 → 가공 대기(설비 미배정) → 검사 대기
  wo("w1", "WO-2026-001", "A1229-26", "FG-BRK", "브라켓", [op("o11", 10, "IN_PROGRESS", "절단", "CUT-01"), op("o12", 20, "PENDING", "가공"), op("o13", 30, "PENDING", "검사")]),
  // WO-2: 절단 완료 → 가공 진행중(설비 2대 배정: 한 대 완료, 한 대 진행중)
  wo("w2", "WO-2026-002", "261109-01", "FG-AXL", "액슬 샤프트", [
    op("o21", 10, "COMPLETED", "절단", "CUT-01"),
    op("o22", 20, "IN_PROGRESS", "가공", null, [{ id: "a1", status: "COMPLETED", eq: "CNC-01" }, { id: "a2", status: "IN_PROGRESS", eq: "CNC-02" }]),
    op("o23", 30, "PENDING", "검사"),
  ]),
  // WO-3: 절단 대기
  wo("w3", "WO-2026-003", null, "FG-PIN", "핀", [op("o31", 10, "PENDING", "절단"), op("o32", 20, "PENDING", "가공")]),
]
const names = (r: Wo[]) => r.map((w) => w.id).join()

// ─── 검색어 ───
ok(F.matchesPopKeyword(["WO-2026-001", null], "") && F.matchesPopKeyword(["a"], "   "), "K1 빈 검색어는 전체")
ok(F.matchesPopKeyword(["Bracket-A"], "bRaCK") && !F.matchesPopKeyword(["Bracket-A"], "zzz"), "K2 대소문자 무시 부분 일치")
ok(F.matchesPopKeyword(["WO-001", "브라켓"], "wo-001 브라켓") && !F.matchesPopKeyword(["WO-001", "브라켓"], "wo-001 핀"), "K3 공백으로 나눈 검색어는 모두(AND) 일치, 항목은 하나 이상")
ok(F.matchesPopKeyword(["50%_A"], "%_") && !F.matchesPopKeyword(["50AB"], "%_"), "K4 특수문자는 일반 문자열(와일드카드 아님)")

// ─── 공정 선택지 ───
const options = F.getProcessOptions(list)
ok(options.map((o) => o.name).join() === "절단,가공,검사", "O1 등록된 공정정보 기준 · 공정 순서(seq)대로")
ok(JSON.stringify(options.find((o) => o.name === "가공")) === JSON.stringify({ name: "가공", total: 3, inProgress: 1, pending: 2 }), "O2 공정별 진행중/대기 건수(열린 공정만, 완료 제외)")
ok(options.find((o) => o.name === "절단")?.total === 2, "O3 완료된 공정(WO-2 절단)은 건수에서 제외")

// ─── 공정·상태·검색 조합 ───
const f = (process: string, status: "ALL" | "IN_PROGRESS" | "PENDING", keyword = "") => names(F.filterWorkOrders(list, { process, status, keyword }))
ok(f("ALL", "ALL") === "w1,w2,w3", "C1 전체 공정·전체 상태 = 전체")
ok(f("절단", "ALL") === "w1,w3", "C2 공정 선택: 그 공정이 열려 있는 작업지시만")
ok(f("가공", "ALL") === "w1,w2,w3", "C3 가공: 세 작업지시 모두 가공 공정이 열려 있음")
ok(f("가공", "IN_PROGRESS") === "w2" && f("가공", "PENDING") === "w1,w3", "C4 공정 + 작업 상태(선택 공정 기준) AND")
ok(f("ALL", "IN_PROGRESS") === "w1,w2" && f("ALL", "PENDING") === "w3", "C5 전체 공정 + 상태는 기본(첫 열린) 공정 기준")
ok(f("검사", "ALL") === "w1,w2" && f("없는공정", "ALL") === "", "C6 해당 공정이 없으면 결과 없음")
ok(f("가공", "ALL", "a1229") === "w1" && f("가공", "ALL", "FG-AXL") === "w2", "C7 공정 + 검색어(제조번호/품목코드) AND")
ok(f("ALL", "ALL", "브라켓") === "w1" && f("ALL", "ALL", "wo-2026-003") === "w3", "C8 작업지시번호·품목명 검색")
ok(f("ALL", "ALL", "cnc-02") === "w2" && f("ALL", "ALL", "cut-01") === "w1,w2", "C9 설비명 검색(공정 설비 + 설비배정 설비)")
ok(f("ALL", "ALL", "가공 cnc") === "w2" && f("ALL", "ALL", "핀 cnc") === "", "C10 공정명 + 설비명 다중 검색어 AND")
ok(f("가공", "ALL", "cut-01") === "", "C11 공정을 선택하면 설비명 검색도 그 공정 기준(WO-1 의 절단 설비 CUT-01 은 가공 선택 시 제외)")
ok(f("절단", "ALL", "cut-01") === "w1" && f("절단", "PENDING", "cut-01") === "", "C12 공정+상태+검색어 세 조건 모두 AND")
ok(f("ALL", "ALL", "검사 핀") === "", "C13 서로 다른 작업지시의 값이면 결과 없음(AND)")
ok(f("ALL", "ALL", "260000") === "" && f("ALL", "ALL", "A1229-26") === "w1", "C14 제조번호 검색(제조번호 없는 작업지시는 제외)")

// ─── 이동 대상 ───
const w1 = list[0], w2 = list[1], w3 = list[2]
ok(F.operationHref(F.targetOperation(w1, "ALL")!) === "/pop/production/o11", "N1 전체: 기존과 같이 첫 번째 열린 공정(진행중 절단) 화면")
ok(F.operationHref(F.targetOperation(w1, "가공")!) === "/pop/production/o12", "N2 공정 선택: 그 공정(가공) 작업 화면으로 이동 — 첫 공정이 아님")
ok(F.operationHref(F.targetOperation(w1, "검사")!) === "/pop/production/o13", "N3 뒤쪽 공정 선택도 그 공정 화면")
ok(F.targetOperation(w2, "절단") === undefined, "N4 완료된 공정은 대상 없음(카드도 표시되지 않음)")
ok(F.operationHref(F.targetOperation(w2, "가공")!) === "/pop/production/o22?assignmentId=a2", "N5 설비배정 작업: 진행중 배정(assignmentId)과 함께 이동, 완료된 배정은 건너뜀")
ok(F.operationHref(F.targetOperation(w1, "가공")!) === "/pop/production/o12" && !F.operationHref(F.targetOperation(w3, "절단")!).includes("assignmentId"), "N6 설비 미배정 작업은 assignmentId 없이 이동")
ok(F.targetAssignmentId(w2.operations[0]) === null, "N7 배정 없는 공정은 null")
const multi = wo("w9", "WO-9", null, "X", "X", [op("p1", 10, "PENDING", "가공"), op("p2", 20, "IN_PROGRESS", "가공")])
ok(F.targetOperation(multi, "가공")?.id === "p2", "N8 같은 공정명이 여럿이면 진행중 우선")

// ─── 작업대기 행 ───
type Row = import("../src/lib/pop-process-filter").PopQueueRowLite
const row = (orderNo: string, mfg: string | null, code: string, name: string, process: string, eq: string | null, status: string, canWork: boolean): Row => ({ orderNo, manufacturingNo: mfg, itemCode: code, itemName: name, processName: process, equipmentName: eq, status, canWork })
const rows: Row[] = [
  row("WO-1", "A1229-26", "FG-BRK", "브라켓", "절단", "CUT-01", "IN_PROGRESS", true),
  row("WO-1", "A1229-26", "FG-BRK", "브라켓", "가공", null, "PENDING", false), // 선행 공정 미완료 등으로 작업 불가
  row("WO-2", "261109-01", "FG-AXL", "액슬", "가공", "CNC-02", "IN_PROGRESS", true),
  row("WO-3", null, "FG-PIN", "핀", "가공", "CNC-01", "PENDING", true),
]
const q = (status: "ALL" | "PENDING" | "IN_PROGRESS" | "AVAILABLE" | "BLOCKED", process: string, keyword = "") => F.filterQueueRows(rows, { status, process, keyword }).map((r) => `${r.orderNo}/${r.processName}`).join()
ok(q("ALL", "ALL").split(",").length === 4, "Q1 전체")
ok(q("ALL", "가공") === "WO-1/가공,WO-2/가공,WO-3/가공", "Q2 공정 선택: 그 공정 행만")
ok(q("AVAILABLE", "가공") === "WO-2/가공,WO-3/가공" && q("BLOCKED", "가공") === "WO-1/가공", "Q3 공정 + 작업가능/불가(서버 canWork) AND")
ok(q("IN_PROGRESS", "가공") === "WO-2/가공" && q("PENDING", "가공") === "WO-1/가공,WO-3/가공", "Q4 공정 + 진행중/대기 AND")
ok(q("ALL", "가공", "cnc") === "WO-2/가공,WO-3/가공" && q("AVAILABLE", "가공", "cnc-02") === "WO-2/가공", "Q5 공정 + 상태 + 설비 검색 AND")
ok(q("ALL", "ALL", "브라켓 가공") === "WO-1/가공" && q("ALL", "ALL", "a1229") === "WO-1/절단,WO-1/가공", "Q6 다중 검색어(AND) · 제조번호")
ok(q("ALL", "ALL", "fg-pin") === "WO-3/가공" && q("ALL", "절단", "fg-pin") === "", "Q7 품목코드 · 공정 선택과 AND")
const sum = F.summarizeQueueByProcess(rows)
ok(JSON.stringify(sum.find((s) => s.name === "가공")) === JSON.stringify({ name: "가공", total: 3, available: 2, inProgress: 1, pending: 2 }), "Q8 공정별 작업가능·진행중·대기 건수")
ok(F.displayProcessName("후처리A") === "후처리공정" && F.displayProcessName("가공") === "가공", "Q9 기존 공정명 표시 규칙 유지")

// ─── 소스 점검: 서버 로직 불변 · 화면 연결 ───
const diff = execSync("git diff --name-only origin/main...HEAD && git diff --name-only", { cwd: process.cwd() }).toString()
ok(!/src\/lib\/actions\/pop\.actions\.ts|pop-wip-lookup\.actions|src\/app\/pop\/production\//.test(diff), "S1 서버 액션(pop.actions·WIP 조회)·작업 시작/실적 화면은 수정하지 않았다")
const sel = read("src/app/pop/work-select/work-select-client.tsx")
const queue = read("src/app/app/pop/work-queue/work-queue-client.tsx")
ok(sel.includes("filterWorkOrders(") && sel.includes("operationHref(targetOp)") && sel.includes("PopWipQrScan") && sel.includes('variant="field"'), "S2 작업선택: 공정 필터·통합 검색 연결, 선택 공정 화면으로 이동, WIP QR 유지")
ok(queue.includes("filterQueueRows(") && queue.includes("startOperation(row.operationId, row.assignmentId)") && queue.includes("submitProductionResult(") && queue.includes("PopWipQrScan"), "S3 작업대기: 필터 연결, 작업 시작·실적 등록 호출·WIP QR 유지")
ok(!/\.(create|update|delete)\(/.test(read("src/lib/pop-process-filter.ts")) && !/prisma/.test(read("src/lib/pop-process-filter.ts")), "S4 필터 모듈은 DB 접근이 없는 표시 전용")
ok(sel.includes("min-h-[44px]") && queue.includes("h-11 rounded-full"), "S5 태블릿 터치 크기(44px 이상) 유지")

console.log(`\n${pass} passed`)
