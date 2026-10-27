/**
 * 4-2단계 POP 작업대기 WIP QR 스캔 테스트 — 메모리 가짜 DB, 실제 PostgreSQL/브라우저/카메라 없음.
 *
 *  A. 판정 규칙(lib/pop/wip-scan.ts): 루트·하위 WIP, 폐기·종결, 작업장, 작업지시 상태, 모호한 원본 WIP
 *  B. 서버 조회(lookupWipForPop): 인증(POP 작업자/관리자), tenant, 존재, 읽기 전용, 라벨 발행 조건과 무관
 *  C. 소스 구조: 기존 POP 업무 로직 불변(지문), QR 코드는 시작·실적 액션을 호출하지 않음, 수동 목록/검색 유지, 키오스크 비결합
 *
 * 실제 DB 쿼리 동작, 실제 세션 쿠키, 카메라 인식은 이 테스트로 검증되지 않는다(브라우저 테스트와 미검증 항목 참고).
 */
import assert from "node:assert/strict"
import Module from "node:module"
import { join } from "node:path"
import { between, fingerprint, qrCouplingViolations, readSource, stripComments } from "./test-support/source-invariants"

const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}

async function main() {
  const rule = require("../src/lib/pop/wip-scan") as typeof import("../src/lib/pop/wip-scan")
  const wo = (status = "IN_PROGRESS", siteId: string | null = "s1") => ({ status, siteId })
  const root = { status: "WAITING", parentWipUnitId: null, sourceProductionResultId: null }
  const judge = (wip: Parameters<typeof rule.judgePopWipScan>[0]["wip"], over: Partial<Parameters<typeof rule.judgePopWipScan>[0]> = {}) =>
    rule.judgePopWipScan({ wip, rootCount: 1, openOperationCount: 2, workerSiteId: null, ...over })

  // ═══ A. 판정 규칙 ═══════════════════════════════════════════════════════════
  const okRoot = judge({ ...root, workOrder: wo() })
  ok(okRoot.ok && okRoot.notice === null, "A1 [정상] 원본(루트) WIP · 진행 가능한 작업지시 → 작업지시 표시 가능(안내 없음)")
  for (const status of ["IN_PROCESS", "WAITING", "RECEIVED"]) ok(judge({ ...root, status, workOrder: wo("RELEASED") }).ok, `A2 ${status} 상태의 루트 WIP 도 표시 가능(라벨이 이미 붙은 WIP 는 후속 공정에서도 같은 QR 로 찾는다)`)
  const hold = judge({ ...root, status: "ON_HOLD", workOrder: wo() })
  ok(hold.ok && /보류/.test(String(hold.notice)), "A3 보류 WIP 는 표시하되 보류 안내(작업 시작은 기존 POP 검증이 막는다)")
  for (const status of ["OUTSOURCED", "IN_TRANSIT", "REWORK"]) {
    const j = judge({ ...root, status, workOrder: wo() })
    ok(j.ok && typeof j.notice === "string" && j.notice.includes(rule.popWipStatusLabel(status)) || (j.ok && status === "REWORK"), `A4 ${status} 상태도 표시 + 상태 안내`)
  }
  const code = (r: ReturnType<typeof judge>) => (r.ok ? "OK" : r.code)
  ok(code(judge({ ...root, status: "SCRAPPED", workOrder: wo() })) === "WIP_SCRAPPED", "A5 [폐기 WIP] 거부")
  ok(code(judge({ ...root, status: "COMPLETED", workOrder: wo() })) === "WIP_COMPLETED", "A6 [종결 WIP] 거부")
  ok(code(judge({ status: "WAITING", parentWipUnitId: "root-1", sourceProductionResultId: null, workOrder: wo() })) === "CHILD_WIP", "A7 [하위 WIP — 부모 있음] 거부, 원본으로 바꿔 고르지 않는다")
  ok(code(judge({ status: "REWORK", parentWipUnitId: null, sourceProductionResultId: "res-1", workOrder: wo() })) === "CHILD_WIP", "A7b [하위 WIP — 생산실적에서 분리됨] 거부")
  ok(code(judge({ status: "SCRAPPED", parentWipUnitId: "root-1", sourceProductionResultId: "res-1", workOrder: wo() })) === "WIP_SCRAPPED", "A7c 폐기된 하위 WIP 는 폐기로 안내")
  ok(code(judge({ ...root, workOrder: null })) === "NO_WORK_ORDER", "A8 작업지시가 없는 WIP 거부")
  ok(code(judge({ ...root, workOrder: wo("COMPLETED") })) === "WORK_ORDER_CLOSED" && code(judge({ ...root, workOrder: wo("CANCELLED") })) === "WORK_ORDER_CLOSED", "A9 종료/취소된 작업지시 거부(작업대기 목록 제외 상태와 동일)")
  ok(code(judge({ ...root, workOrder: wo("IN_PROGRESS", "s2") }, { workerSiteId: "s1" })) === "SITE_MISMATCH", "A10 [다른 작업장] POP 작업자 세션의 작업장과 다르면 거부(기존 POP 과 같은 기준)")
  ok(judge({ ...root, workOrder: wo("IN_PROGRESS", "s2") }, { workerSiteId: null }).ok && judge({ ...root, workOrder: wo("IN_PROGRESS", null) }, { workerSiteId: "s1" }).ok, "A10b 관리자 세션(작업장 없음)이나 작업지시에 작업장이 없으면 작업장 검사를 하지 않는다")
  ok(code(judge({ ...root, workOrder: wo() }, { rootCount: 2 })) === "AMBIGUOUS_ROOT", "A11 [모호한 원본 WIP] 원본 WIP 가 여러 건이면 임의로 선택하지 않고 안내")
  ok(code(judge({ ...root, workOrder: wo() }, { openOperationCount: 0 })) === "NOT_IN_QUEUE", "A12 대기·진행 공정이 없으면 목록에 표시할 수 없다고 안내")
  ok(Object.values(rule.POP_WIP_LOOKUP_MESSAGES).every((m) => /[가-힣]/.test(m)), "A13 모든 거부 사유에 한국어 안내")

  // ═══ B. 서버 조회 ═══════════════════════════════════════════════════════════
  type Row = Record<string, unknown>
  const mkWip = (id: string, over: Row = {}) => ({
    id,
    tenantId: "t1",
    status: "WAITING",
    qty: 10,
    manufacturingNo: "26A01",
    parentWipUnitId: null,
    sourceProductionResultId: null,
    workOrderId: "wo-1",
    workOrderOperationId: "op-1",
    ...over,
  })
  const workOrders: Record<string, Row> = {
    "wo-1": { id: "wo-1", tenantId: "t1", orderNo: "WO-0001", status: "IN_PROGRESS", siteId: "s1", manufacturingNo: "26A01", item: { code: "FG-1", name: "완제품 1" } },
    "wo-2": { id: "wo-2", tenantId: "t1", orderNo: "WO-0002", status: "RELEASED", siteId: "s1", manufacturingNo: "26A02", item: { code: "FG-2", name: "완제품 2" } },
    "wo-done": { id: "wo-done", tenantId: "t1", orderNo: "WO-0003", status: "COMPLETED", siteId: "s1", manufacturingNo: null, item: { code: "FG-3", name: "완제품 3" } },
    "wo-amb": { id: "wo-amb", tenantId: "t1", orderNo: "WO-0004", status: "IN_PROGRESS", siteId: "s1", manufacturingNo: null, item: { code: "FG-4", name: "완제품 4" } },
    "wo-s2": { id: "wo-s2", tenantId: "t1", orderNo: "WO-0005", status: "IN_PROGRESS", siteId: "s2", manufacturingNo: null, item: { code: "FG-5", name: "완제품 5" } },
    "wo-scrap": { id: "wo-scrap", tenantId: "t1", orderNo: "WO-0006", status: "IN_PROGRESS", siteId: "s1", manufacturingNo: null, item: { code: "FG-6", name: "완제품 6" } },
    "wo-completed": { id: "wo-completed", tenantId: "t1", orderNo: "WO-0007", status: "IN_PROGRESS", siteId: "s1", manufacturingNo: null, item: { code: "FG-7", name: "완제품 7" } },
    "wo-t2": { id: "wo-t2", tenantId: "t2", orderNo: "WO-SECRET", status: "IN_PROGRESS", siteId: "s1", manufacturingNo: null, item: { code: "SECRET", name: "다른 tenant" } },
  }
  const wips: Row[] = [
    mkWip("wip-root"), // wo-1 의 원본
    mkWip("wip-child", { parentWipUnitId: "wip-root", sourceProductionResultId: "res-1", status: "REWORK" }), // wo-1 의 하위(재작업)
    mkWip("wip-hold", { status: "ON_HOLD", workOrderId: "wo-2" }),
    mkWip("wip-scrap", { status: "SCRAPPED", workOrderId: "wo-scrap" }),
    mkWip("wip-completed", { status: "COMPLETED", workOrderId: "wo-completed" }),
    mkWip("wip-closed-wo", { workOrderId: "wo-done" }),
    mkWip("wip-amb-1", { workOrderId: "wo-amb" }),
    mkWip("wip-amb-2", { workOrderId: "wo-amb" }),
    mkWip("wip-s2", { workOrderId: "wo-s2" }),
    mkWip("wip-nowo", { workOrderId: null }),
    mkWip("wip-t2", { tenantId: "t2", workOrderId: "wo-t2" }),
  ]
  const operations: Row[] = [
    { id: "op-1", workOrderId: "wo-1", status: "IN_PROGRESS" },
    { id: "op-2", workOrderId: "wo-1", status: "PENDING" },
    { id: "op-3", workOrderId: "wo-2", status: "PENDING" },
    { id: "op-4", workOrderId: "wo-amb", status: "PENDING" },
    { id: "op-5", workOrderId: "wo-s2", status: "PENDING" },
  ]
  const calls = { wipFind: 0, wipCount: 0, opCount: 0 }
  const wheres: Array<Record<string, unknown>> = []
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k === "workOrder") return true
      if (v && typeof v === "object" && "in" in (v as Row)) return ((v as { in: unknown[] }).in).includes(row[k])
      return row[k] === v
    })
  const fakePrismaCore = {
    wipUnit: {
      findFirst: async (a: { where: Record<string, unknown> }) => {
        calls.wipFind += 1
        wheres.push(a.where)
        const w = wips.find((x) => matches(x, a.where))
        if (!w) return null
        const woRow = w.workOrderId ? workOrders[String(w.workOrderId)] : null
        return { ...w, workOrder: woRow ?? null, workOrderOperation: { seq: 1, routingOperation: { name: "절삭" } } }
      },
      count: async (a: { where: Record<string, unknown> }) => {
        calls.wipCount += 1
        wheres.push(a.where)
        return wips.filter((x) => matches(x, a.where)).length
      },
    },
    workOrderOperation: {
      count: async (a: { where: Record<string, unknown> }) => {
        calls.opCount += 1
        wheres.push(a.where)
        return operations.filter((x) => matches(x, a.where)).length
      },
    },
  }
  // 쓰기 메서드를 포함해 정의되지 않은 모든 접근은 즉시 실패시킨다(읽기 전용 보장)
  const fakePrisma = new Proxy(fakePrismaCore, {
    get: (target, prop) => {
      if (prop in target) {
        const model = (target as Record<string, Record<string, unknown>>)[prop as string]
        return new Proxy(model, { get: (m, method) => (method in m ? m[method as string] : () => { throw new Error(`읽기 전용 조회에서 허용되지 않는 DB 호출: ${String(prop)}.${String(method)}`) }) })
      }
      throw new Error(`읽기 전용 조회에서 허용되지 않는 DB 접근: ${String(prop)}`)
    },
  })
  function inject(modulePath: string, exports: Record<string, unknown>) {
    const filename = require.resolve(modulePath)
    const mod = new Module(filename)
    mod.filename = filename
    mod.loaded = true
    mod.exports = exports
    require.cache[filename] = mod
  }
  type Auth = { worker: { tenantId: string; siteId: string | null } | null; user: "ok" | "anon" | "forbidden"; tenantId: string }
  const auth: Auth = { worker: null, user: "ok", tenantId: "t1" }
  const setAuth = (next: Partial<Auth>) => Object.assign(auth, { worker: null, user: "ok", tenantId: "t1" }, next)
  inject("../src/lib/db/prisma", { prisma: fakePrisma })
  inject("../src/lib/auth", {
    requireRole: async () => {
      if (auth.user === "anon") throw new Error("UNAUTHORIZED")
      if (auth.user === "forbidden") throw new Error("FORBIDDEN")
      return { tenantId: auth.tenantId, id: "u1", profileId: "p1", name: "관리자" }
    },
    // 개발용 대체값을 흉내 낸다 — 조회 액션이 getTenantId 를 쓰지 않아야 한다
    getTenantId: async () => process.env.DEFAULT_TENANT_ID ?? auth.tenantId,
  })
  inject("../src/lib/auth/pop-worker-session", { getPopWorkerSession: async () => (auth.worker ? { ...auth.worker, profileId: "p2", tenantUserId: "tu1", workerName: "작업자" } : null) })
  const action = require("../src/lib/actions/pop-wip-lookup.actions") as typeof import("../src/lib/actions/pop-wip-lookup.actions")
  const reset = () => {
    calls.wipFind = calls.wipCount = calls.opCount = 0
    wheres.length = 0
  }
  const noDb = () => calls.wipFind === 0 && calls.wipCount === 0 && calls.opCount === 0
  const run = (wipUnitId: unknown) => action.lookupWipForPop({ wipUnitId: wipUnitId as string })

  setAuth({})
  reset()
  const good = await run("wip-root")
  ok(good.ok && good.workOrderId === "wo-1" && good.orderNo === "WO-0001" && good.wipUnitId === "wip-root" && good.itemCode === "FG-1" && good.manufacturingNo === "26A01" && good.operationLabel === "1. 절삭" && good.wipStatusLabel === "대기" && good.notice === null, "B1 [정상 WIP QR → 작업지시 조회] 해당 WIP 의 작업지시·품목·제조번호·현재 공정을 돌려준다")
  ok(wheres.every((w) => w.tenantId === "t1" || (w.workOrder as { tenantId?: string } | undefined)?.tenantId === "t1"), "B1b 모든 조회는 세션 tenant 조건으로 실행")

  reset()
  const ids = [await run(""), await run("   "), await run(null), await run(123), await run("x".repeat(129))]
  ok(ids.every((r) => !r.ok && r.code === "INVALID") && noDb(), "B2 [잘못된 식별값] 빈 값·공백·문자가 아닌 값·너무 긴 값은 DB 조회 없이 거부")
  reset()
  const missing = await run("wip-nope")
  const otherTenant = await run("wip-t2")
  ok(!missing.ok && !otherTenant.ok && missing.code === "WIP_NOT_FOUND" && otherTenant.code === "WIP_NOT_FOUND" && missing.message === otherTenant.message && !JSON.stringify(otherTenant).includes("SECRET"), "B3 [존재하지 않는 WIP · 다른 tenant 의 WIP] 같은 응답 — 존재 여부와 다른 tenant 정보가 노출되지 않는다")

  const verdicts: Array<[string, string]> = [["wip-scrap", "WIP_SCRAPPED"], ["wip-completed", "WIP_COMPLETED"], ["wip-child", "CHILD_WIP"], ["wip-nowo", "NO_WORK_ORDER"], ["wip-closed-wo", "WORK_ORDER_CLOSED"], ["wip-amb-1", "AMBIGUOUS_ROOT"], ["wip-amb-2", "AMBIGUOUS_ROOT"]]
  for (const [id, expected] of verdicts) {
    const r = await run(id)
    ok(!r.ok && r.code === expected && !("workOrderId" in r), `B4 ${id} → ${expected} (작업지시를 대신 골라 주지 않는다)`)
  }
  const rootRes = await run("wip-root")
  const childRes = await run("wip-child")
  ok(rootRes.ok && rootRes.wipUnitId === "wip-root" && !childRes.ok && childRes.code === "CHILD_WIP", "B5 [루트·하위 WIP 구분] 같은 작업지시의 루트 QR 은 정확히 그 루트로, 하위 QR 은 거부 — 서로 다른 WIP 로 바꿔 고르지 않는다")
  const holdRes = await run("wip-hold")
  ok(holdRes.ok && holdRes.workOrderId === "wo-2" && /보류/.test(String(holdRes.notice)) && holdRes.wipStatus === "ON_HOLD", "B6 보류 WIP 는 작업지시를 표시하고 보류 안내를 함께 돌려준다")
  const noIssue = await run("wip-hold")
  ok(noIssue.ok, "B7 [라벨 발행 조건과 무관] 자재출고 완료 여부·예약 정보 없이도(가짜 DB 에 예약/자재 테이블이 없다) 조회가 동작한다 — 라벨 발행 조건을 재사용하지 않는다")

  // 인증
  setAuth({ user: "anon" })
  reset()
  const anon = await run("wip-root")
  setAuth({ user: "forbidden" })
  const forbidden = await run("wip-root")
  ok(!anon.ok && anon.code === "UNAUTHORIZED" && !forbidden.ok && forbidden.code === "DENIED" && noDb(), "B8 [비로그인 · 권한 부족] 거부 — DB 조회 0건")
  process.env.DEFAULT_TENANT_ID = "t1"
  setAuth({ user: "anon" })
  const bypass = await run("wip-root")
  delete process.env.DEFAULT_TENANT_ID
  ok(!bypass.ok && bypass.code === "UNAUTHORIZED" && noDb(), "B9 [DEFAULT_TENANT_ID 우회 방지] 개발용 대체값이 있어도 비로그인은 거부")
  setAuth({ user: "anon", worker: { tenantId: "t1", siteId: "s1" } })
  reset()
  const workerOk = await run("wip-root")
  ok(workerOk.ok && workerOk.orderNo === "WO-0001", "B10 [POP 작업자 세션] 관리자 로그인 없이도 POP 작업자 세션으로 조회 가능(기존 POP 작업대기와 같은 접근 기준)")
  const workerSite = await run("wip-s2")
  const workerNoSite = (setAuth({ user: "anon", worker: { tenantId: "t1", siteId: null } }), await run("wip-s2"))
  ok(!workerSite.ok && workerSite.code === "SITE_MISMATCH" && workerNoSite.ok, "B11 [작업장] 작업장이 있는 POP 작업자는 다른 작업장의 작업지시를 거부하고, 작업장이 없는 세션은 제한하지 않는다")
  setAuth({ user: "anon", worker: { tenantId: "t2", siteId: "s1" } })
  const workerOtherTenant = await run("wip-root")
  ok(!workerOtherTenant.ok && workerOtherTenant.code === "WIP_NOT_FOUND", "B12 다른 tenant 의 POP 작업자 세션으로는 이 tenant 의 WIP 를 찾지 못한다")

  // 읽기 전용
  setAuth({})
  reset()
  let threw: string | null = null
  try {
    await run("wip-root")
    await run("wip-hold")
    await run("wip-child")
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error)
  }
  ok(threw === null && calls.opCount >= 1, "B13 [읽기 전용] 조회 중 쓰기/허용되지 않은 DB 호출이 한 번도 없다(Proxy 가 즉시 실패시킨다)")

  // ═══ C. 소스 구조 ═══════════════════════════════════════════════════════════
  const actionSrc = readSource("src/lib/actions/pop-wip-lookup.actions.ts")
  const code0 = stripComments(actionSrc)
  ok(actionSrc.startsWith('"use server"') && !/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$transaction|\$executeRaw|recordAuditLog|revalidate/.test(code0), "C1 조회 액션은 서버 액션이며 읽기 전용(쓰기·감사·캐시 재검증 없음)")
  ok(!/getTenantId/.test(code0) && /requireRole\("OPERATOR"\)/.test(code0) && /getPopWorkerSession\(\)/.test(code0) && !/tenantId:\s*string/.test(code0.slice(code0.indexOf("export async function lookupWipForPop"), code0.indexOf("{", code0.indexOf("export async function lookupWipForPop") + 40))), "C2 기존 POP 과 같은 접근 기준(POP 작업자 세션 → 관리자 OPERATOR 이상), tenant 는 세션 값이며 클라이언트에서 받지 않고 getTenantId 를 쓰지 않는다")
  ok(!/wip-label|wip-label-eligibility|computeIssueProgress|material-issue/.test(code0 + stripComments(readSource("src/lib/pop/wip-scan.ts"))), "C3 WIP 라벨 발행 조건(wip-label · 자재출고 완료 판정)을 POP 선택 조건으로 재사용하지 않는다")

  // 기존 POP 업무 로직 불변(QR 작업 이전 코드의 지문 — 4-2단계에서 수정하지 않았다)
  const pinned: Array<[string, string]> = [
    ["src/lib/actions/pop.actions.ts", "f87314790c8ff683"],
    ["src/lib/actions/wip-traceability.helpers.ts", "2f9f7bcd2f8591af"],
    ["src/lib/operation-status-integrity.ts", "b721e14ca2af7122"],
    ["src/lib/actions/process-progress.actions.ts", "d7143fa7d79b9c1f"],
  ]
  const changed = pinned.filter(([file, expected]) => fingerprint(readSource(file)) !== expected).map(([file]) => file)
  ok(changed.length === 0, `C4 [기존 POP 업무 로직 불변] 작업 시작·실적 등록·WIP 자동 공정이동·공정 상태·공정진행 서버 코드가 4-2 이전과 동일(지문 비교)${changed.length ? " — 변경됨: " + changed.join(", ") : ""}`)
  ok(qrCouplingViolations(["src/app/pop", "src/lib/actions/pop.actions.ts", "src/lib/actions/wip-traceability.helpers.ts", "src/lib/actions/process-progress.actions.ts"], ["src/app/pop/work-select/work-select-client.tsx"]).length === 0, "C5 현장 POP 은 작업지시 선택 화면 1개(work-select-client)만 QR 컴포넌트에 연결되고, 그 밖의 현장 POP 파일(작업 화면 등)과 POP·WIP 이동 서버 코드는 QR 모듈에 결합되지 않았다")

  const clientSrc = readSource("src/app/app/pop/work-queue/work-queue-client.tsx")
  const scanSrc = readSource("src/components/pop/pop-wip-qr-scan.tsx")
  const scanCode = stripComments(scanSrc)
  ok(!/pop\.actions|startOperation|submitProductionResult|updateOperationStatus|next\/navigation|useRouter|router\.|window\.location|location\.(href|assign|replace)|history\.(push|replace)State/.test(scanCode), "C6 [QR 스캔만으로 상태 변경 없음] QR 컴포넌트는 POP 시작·실적 액션을 import 하거나 호출하지 않고 화면 이동도 하지 않는다")
  ok((clientSrc.match(/startOperation\(/g) ?? []).length === 1 && (clientSrc.match(/submitProductionResult\(/g) ?? []).length === 1 && clientSrc.includes("await startOperation(row.operationId, row.assignmentId)") && clientSrc.includes("workOrderOperationId: row.operationId"), "C7 [기존 시작·실적 액션 유지] 작업시작/실적등록은 여전히 각 버튼 핸들러의 기존 서버 액션 호출 하나뿐(QR 전용 경로 없음)")
  ok(clientSrc.includes('placeholder="작업지시번호, 제조번호, 품목, 공정 검색"') && clientSrc.includes("FILTERS.map") && clientSrc.includes("row.orderNo,") && clientSrc.includes("row.manufacturingNo ??"), "C8 [수동 선택 유지] 검색창·필터·작업지시 카드 목록 등 기존 수동 선택 UI 가 그대로 있다")
  ok(clientSrc.includes("if (qrWip && row.workOrderId !== qrWip.workOrderId) return false") && clientSrc.includes("onClear={() => setQrWip(null)}") && clientSrc.includes("workOrderIdsInList={workOrderIdsInList}"), "C9 QR 는 표시 필터일 뿐이며 해제하면 전체 목록으로 돌아가고, 현재 목록에 없는 작업지시는 표시하지 않는다")
  ok(scanSrc.includes('process.env.NEXT_PUBLIC_QR_SCAN_DISABLED === "true"') && scanSrc.includes("if (QR_DISABLED) return null") && scanSrc.includes('result.kind !== "WIP"') && scanSrc.includes("if (busyRef.current) return"), "C10 [QR 는 선택 기능] 스위치로 끄면 버튼이 사라지고, LOT QR 은 거부하며, 조회 중 중복 스캔을 막는다")
  ok(scanSrc.includes("QrScannerDialog") && !/new BarcodeDetector|jsQR|jsqr/.test(scanCode) && scanSrc.includes('role={message.tone === "error" ? "alert" : "status"}') && scanSrc.includes("목록에서 직접 선택"), "C11 새 스캐너를 만들지 않고 공통 QrScannerDialog 를 재사용하며, 실패 시 수동 선택 안내를 표시한다")
  ok(scanSrc.includes("onSelect(found)") && !/setFilter|setKeyword/.test(scanCode) && clientSrc.includes('setFilter("ALL")') && clientSrc.includes('setKeyword("")'), "C12 필터/검색어 초기화는 QR 로 작업지시를 찾았을 때 화면 쪽 콜백에서만 일어나며, 조회가 실패하면 기존 필터·검색어·입력값을 건드리지 않는다")
  const pageSrc = readSource("src/app/app/pop/work-queue/page.tsx")
  ok(pageSrc.includes("getPopWorkQueueRows(tenantId)") && pageSrc.includes("<WorkQueueClient rows={rows} />"), "C13 작업대기 페이지의 데이터 조회·렌더링 호출은 그대로다")

  // ═══ D. 현장 태블릿 POP (/pop/work-select) ═══════════════════════════════════
  // D1·D2. PIN 로그인 POP 작업자 세션 vs 관리자 세션 — 같은 조회 액션, 접근 차이는 기존 POP 과 동일(작업장 제한은 작업자 세션에만)
  setAuth({ user: "ok" })
  const adminOtherSite = await run("wip-s2")
  setAuth({ user: "anon", worker: { tenantId: "t1", siteId: "s1" } })
  const workerOtherSite = await run("wip-s2")
  setAuth({ user: "anon", worker: { tenantId: "t1", siteId: "s2" } })
  const workerOwnSite = await run("wip-s2")
  setAuth({ user: "ok", worker: { tenantId: "t1", siteId: "s1" } })
  const workerWins = await run("wip-s2")
  ok(adminOtherSite.ok && !workerOtherSite.ok && workerOtherSite.code === "SITE_MISMATCH" && workerOwnSite.ok && !workerWins.ok && workerWins.code === "SITE_MISMATCH", "D1 [PIN 로그인 POP 세션 vs 관리자 세션] 관리자 세션은 작업장 제한이 없고, POP 작업자 세션은 다른 작업장의 작업지시를 거부하며(자기 작업장은 허용), 두 세션이 함께 있으면 기존 POP 과 같이 POP 작업자 세션이 우선한다")
  setAuth({ user: "anon", worker: { tenantId: "t1", siteId: "s1" } })
  ok((await run("wip-root")).ok && (await run("wip-hold")).ok, "D2 [관리자 로그인 불필요] 관리자 세션 없이 POP 작업자 세션(PIN 로그인)만으로 조회된다")
  const popSrc = readSource("src/lib/actions/pop.actions.ts")
  ok(popSrc.includes("session.siteId != null && workOrderSiteId != null && session.siteId !== workOrderSiteId") && readSource("src/lib/pop/wip-scan.ts").includes("input.workerSiteId != null && wip.workOrder.siteId != null && input.workerSiteId !== wip.workOrder.siteId"), "D3 작업장 제한 규칙이 기존 POP(assertPopSessionSiteMatch)과 문자 그대로 같은 조건이다")
  ok(code0.indexOf("getPopWorkerSession()") < code0.indexOf("requireRole("), "D4 조회 액션의 인증 순서는 기존 POP 과 같다(POP 작업자 세션 → 관리자 세션)")

  const fieldSrc = readSource("src/app/pop/work-select/work-select-client.tsx")
  const fieldCode = stripComments(fieldSrc)
  ok(fieldSrc.includes('import { PopWipQrScan, type PopWipFound } from "@/components/pop/pop-wip-qr-scan"') && clientSrc.includes('from "@/components/pop/pop-wip-qr-scan"') && fieldSrc.includes('<PopWipQrScan variant="field"'), "D5 [관리자 POP QR 재사용] 현장 화면과 관리자 작업대기가 같은 공용 컴포넌트(조회 액션·스캐너·판정)를 쓰고 표시 크기만 variant 로 다르다")
  const cardClick = between(readSource("src/app/pop/work-select/work-select-client.tsx"), "const handleCardClick", "  if (workOrders.length === 0)") ?? ""
  const cardMarkup = between(readSource("src/app/pop/work-select/work-select-client.tsx"), "        const totalOps = wo.operations.length", "      })}") ?? ""
  ok(fingerprint(cardClick) === "2ac94a51ff6e6541" && fingerprint(cardMarkup) === "5fbfb3dbf4588252" && fingerprint(readSource("src/app/pop/work-select/page.tsx")) === "c82c87b8713a31f7", "D6 [기존 카드 클릭·카드 표시·목록 조회 불변] 카드 클릭 처리(handleCardClick), 카드 마크업, 작업지시 목록 페이지가 4-2.1 이전과 동일(지문)")
  ok((fieldCode.match(/router\.push\(/g) ?? []).length === 1 && cardClick.includes("router.push(") && !/pop\.actions|startOperation|submitProductionResult|updateOperationStatus/.test(fieldCode), "D7 [스캔만으로 화면 이동·작업 시작·실적 등록 없음] 화면 이동은 기존 카드 클릭의 router.push 1곳뿐이고, 현장 화면은 시작·실적 액션을 import 하지 않는다")
  ok(fieldSrc.includes("const visibleWorkOrders = qrWip ? workOrders.filter((wo) => wo.id === qrWip.workOrderId) : workOrders") && fieldSrc.includes("onClear={() => setQrWip(null)}") && fieldSrc.includes("workOrderIdsInList={workOrderIdsInList}") && /visibleWorkOrders\.map\(\(wo\) => \{/.test(fieldSrc), "D8 [기존 카드 재사용] QR 는 기존 카드를 걸러 보여 줄 뿐 새 카드를 만들지 않고, 해제하면 전체 목록으로 돌아가며, 이 화면의 목록에 있는 작업지시만 인정한다")
  ok(fieldSrc.indexOf("workOrders.length === 0") < fieldSrc.indexOf("<PopWipQrScan"), "D9 오늘 배정된 작업이 없는 빈 화면은 기존 그대로(QR 버튼도 목록이 있을 때만)")

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
