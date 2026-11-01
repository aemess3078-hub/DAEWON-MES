/**
 * S-08 검증: 정적 점검에서 "테넌트 조건/권한 확인이 없어 보이는" 서버 액션을 실제로 호출해 재현한다.
 *  - 피해자: 테넌트2(E2E-T2-*) 데이터(seed-roles.ts + seed-s08.ts)
 *  - 공격자: 테넌트1 ADMIN / VIEWER / 개발자 계정(test) / 비로그인. 대조군: 테넌트2 소유자(읽기 가능한 화면 한정)
 *  - 판정: 읽기=응답에 타 테넌트 표식이 포함되면 노출, 쓰기=DB 상태가 바뀌면 변경됨. 확인되지 않으면 '검증 필요'로 남긴다.
 *  - 서버 액션 호출은 실제 컴파일된 액션 ID 로 해당 액션이 등록된 모든 페이지 경로에 POST(= 실제 공격 경로와 동일).
 * 로컬 테스트 DB 한정(가드). 쓰기 프로브가 만든 피해자 행은 REMOVE(seed-s08/seed-roles)로 정리한다.
 */
import { test, expect } from "@playwright/test"
import * as fs from "node:fs"
import * as path from "node:path"
import { assertSafeE2eEnvironment, developerCredentials, E2E_BASE } from "./guard"
import { buildActionMap, apiLogin, roleCreds, db, closeDb, signToken, type ActionInfo } from "./support/perm-lib"

assertSafeE2eEnvironment()

const T2 = "e2e-tenant-002"
const FX = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "test-results/e2e/s08-fixtures.json"), "utf8")) as Record<string, string>
const RESULT_FILE = path.resolve(process.cwd(), "test-results/e2e/s08-results.jsonl")
const WARM = ["/app/mes/locations", "/app/mes/master/equipment", "/app/mes/bom", "/app/mes/ecn", "/app/mes/costing", "/app/mes/quotations", "/app/mes/support-requests", "/app/lms/equipment/parameters", "/app/mes/work-centers", "/app/mes/work-orders"]

type Who = "ADMIN" | "VIEWER" | "DEV" | "UNAUTH" | "T2OWNER"
const cookies: Partial<Record<Who, string | null>> = {}
let MAP: ActionInfo[] = []

const toPath = (key: string) => "/" + key.replace(/^app\//, "").replace(/\/page$/, "").split("/").filter((s) => !/^\(.*\)$/.test(s)).join("/")

async function post(cookie: string | null, pagePath: string, a: ActionInfo, args: unknown[]) {
  const headers: Record<string, string> = { "next-action": a.id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }
  if (cookie) headers.cookie = cookie
  try {
    const r = await fetch(`${E2E_BASE}${pagePath}`, { method: "POST", headers, body: JSON.stringify(args), redirect: "manual", signal: AbortSignal.timeout(60_000) })
    return { status: r.status, text: await r.text(), loc: r.headers.get("location") ?? "" }
  } catch (e) { return { status: 0, text: String((e as Error).message), loc: "" } }
}
function act(name: string, fileRe: RegExp): ActionInfo | null {
  return MAP.find((a) => a.name === name && a.files.some((f) => fileRe.test(f))) ?? null
}
const denied = (t: string) => /FORBIDDEN|UNAUTHORIZED|권한이 없|이 기능을 사용할 권한|인증이 필요|로그인이 필요/.test(t)

const log = (o: Record<string, unknown>) => fs.appendFileSync(RESULT_FILE, JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n", "utf8")

test.beforeAll(async () => {
  // 결과 파일은 러너가 실행 전에 지운다(실패 뒤 워커가 재시작되면 beforeAll 이 다시 실행돼 앞선 기록이 사라지기 때문)
  const a = roleCreds("ADMIN"), v = roleCreds("VIEWER"), t2 = roleCreds("T2OWNER"), d = developerCredentials()
  cookies.ADMIN = (await apiLogin(a.loginId, a.password)).cookie
  cookies.VIEWER = (await apiLogin(v.loginId, v.password)).cookie
  // 로그인 API 는 기본 테넌트로만 로그인하므로 테넌트2 소유자는 로컬 JWT 비밀키로 서명한 세션을 쓴다(권한 스펙과 동일 방식)
  const t2c = await db().userCredential.findUniqueOrThrow({ where: { tenantId_loginId: { tenantId: T2, loginId: t2.loginId } } })
  const t2p = await db().profile.findUniqueOrThrow({ where: { id: t2c.profileId } })
  cookies.T2OWNER = "nmes-session=" + signToken({ profileId: t2c.profileId, tenantId: T2, loginId: t2c.loginId, name: t2p.name, role: "OWNER", email: t2p.email })
  cookies.DEV = (await apiLogin(d.loginId, d.password)).cookie
  cookies.UNAUTH = null
  for (const [k, c] of Object.entries(cookies)) if (k !== "UNAUTH" && !c) throw new Error(`${k} 로그인 실패(시드 확인)`)
  // 액션이 등록된 페이지를 컴파일시켜 서버 참조 매니페스트에 올린다(개발자 쿠키로 전부 접근 가능)
  for (const p of WARM) { try { await fetch(`${E2E_BASE}${p}`, { headers: { cookie: cookies.DEV! }, signal: AbortSignal.timeout(120_000) }) } catch { /* 다음 */ } }
  MAP = buildActionMap()
})
test.afterAll(async () => { await closeDb() })

// ───────── 읽기 프로브 ─────────
type Read = { id: string; name: string; file: RegExp; args: () => unknown[]; marker: RegExp; control?: boolean; devOnly: boolean }
const READS: Read[] = [
  { id: "R01", name: "getECNById", file: /ecn\.actions/, args: () => [FX.ecnId], marker: /E2E-T2/, control: true, devOnly: false },
  { id: "R02", name: "getCurrentBOM", file: /ecn\.actions/, args: () => [FX.itemFg], marker: /E2E-T2/, control: true, devOnly: false },
  { id: "R03", name: "getCurrentRouting", file: /ecn\.actions/, args: () => [FX.itemFg], marker: /E2E-T2/, control: true, devOnly: false },
  { id: "R04", name: "getBomsForItem", file: /costing\.actions/, args: () => [FX.itemFg], marker: /E2E-T2/, devOnly: true },
  { id: "R05", name: "getWorkOrdersForItem", file: /costing\.actions/, args: () => [FX.itemFg], marker: /E2E-T2/, devOnly: true },
  { id: "R06", name: "getQuotations", file: /quotation\.actions/, args: () => [], marker: /E2E-T2/, devOnly: true },
  { id: "R07", name: "getQuotationById", file: /quotation\.actions/, args: () => [FX.quotationId], marker: /E2E-T2/, devOnly: true },
  { id: "R08", name: "getCustomersForQuotation", file: /quotation\.actions/, args: () => [], marker: /E2E-T2/, devOnly: true },
  { id: "R09", name: "getFinishedItems", file: /quotation\.actions/, args: () => [], marker: /E2E-T2/, devOnly: true },
  { id: "R10", name: "getItemPriceForCustomer", file: /quotation\.actions/, args: () => [FX.itemFg, FX.customerId], marker: /1234/, devOnly: true },
  { id: "R11", name: "getSupportRequestById", file: /support-request\.actions/, args: () => [FX.supportRequestId], marker: /E2E-T2/, devOnly: true },
  { id: "R12", name: "getCurrentTagValuesByEquipment", file: /tag-current-value\.actions/, args: () => [FX.equipmentId], marker: /E2E-T2/, devOnly: true },
  { id: "R13", name: "getCurrentTagValuesByTags", file: /tag-current-value\.actions/, args: () => [[FX.tagId]], marker: /E2E-T2/, devOnly: true },
  { id: "R14", name: "getWorkOrders", file: /work-order\.actions/, args: () => [], marker: /E2E-T2/, control: true, devOnly: false },
  { id: "R15", name: "getWorkOrderById", file: /work-order\.actions/, args: () => [FX.workOrderId], marker: /E2E-T2/, control: true, devOnly: false },
]
for (const r of READS) {
  test(`[S08-${r.id}] ${r.name} — 타 테넌트 데이터 비노출`, async () => {
    const a = act(r.name, r.file)
    expect(a, `${r.name} 액션이 매니페스트에 없음(페이지 컴파일 실패?)`).not.toBeNull()
    const pages = a!.pages.map(toPath)
    const leaks: string[] = []
    const matrix: unknown[] = []
    // 개발자 전용 화면 경로에 비개발자 POST 를 반복하면 개발 서버가 404 페이지를 렌더링하다 종료된다(S-05). 비개발자의 경로 차단은 SEC-03/03b 에서 별도 검증하므로 개발자 전용 함수는 개발자·비로그인만 호출한다.
    const attackers: Who[] = r.devOnly ? ["DEV", "UNAUTH"] : ["ADMIN", "VIEWER", "DEV", "UNAUTH"]
    for (const who of attackers) {
      for (const p of pages) {
        const res = await post(cookies[who] ?? null, p, a!, r.args())
        const leaked = res.status === 200 && r.marker.test(res.text) && !denied(res.text)
        matrix.push({ who, page: p, status: res.status, leaked, denied: denied(res.text) })
        if (leaked) leaks.push(`${who}@${p}`)
      }
    }
    let control: string | null = null
    if (r.control) {
      const p = pages[0]
      const res = await post(cookies.T2OWNER!, p, a!, r.args())
      control = res.status === 200 && r.marker.test(res.text) ? "T2 소유자는 자기 데이터 조회 가능(대조 정상)" : `대조 실패(status=${res.status})`
    }
    log({ kind: "read", id: r.id, name: r.name, devOnly: r.devOnly, pages, leaks, control, matrix })
    expect(leaks, `${r.name}: 타 테넌트 데이터 노출 ${JSON.stringify(leaks)}`).toEqual([])
  })
}

// ───────── 쓰기 프로브(피해자 행을 새로 만들어 호출 → DB 상태 확인) ─────────
let seq = 0
const ecnVictim = (status: "DRAFT" | "SUBMITTED") => db().engineeringChange.create({ data: { tenantId: T2, ecnNo: `E2E-T2-ECN-W${Date.now().toString(36)}${seq++}`, title: "E2E-T2 쓰기 프로브", reason: "r", changeType: "BOM", targetItemId: FX.itemFg, status, requestedBy: FX.ownerProfileId } })

const ECN_WRITES: { id: string; name: string; start: "DRAFT" | "SUBMITTED"; args: (id: string) => unknown[]; changed: (before: { status: string; title: string }, after: { status: string; title: string } | null) => boolean }[] = [
  { id: "W01", name: "deleteECN", start: "DRAFT", args: (id) => [id], changed: (_b, a) => a === null },
  { id: "W02", name: "submitECN", start: "DRAFT", args: (id) => [id], changed: (b, a) => !!a && a.status !== b.status },
  { id: "W03", name: "approveECN", start: "SUBMITTED", args: (id) => [id, FX.ownerProfileId], changed: (b, a) => !!a && a.status !== b.status },
  { id: "W04", name: "rejectECN", start: "SUBMITTED", args: (id) => [id, FX.ownerProfileId], changed: (b, a) => !!a && a.status !== b.status },
  { id: "W05", name: "implementECN", start: "SUBMITTED", args: (id) => [id], changed: (b, a) => !!a && a.status !== b.status },
  { id: "W06", name: "updateECN", start: "DRAFT", args: (id) => [id, { title: "HACKED-BY-T1", reason: "x", changeType: "BOM", targetItemId: FX.itemFg, details: [] }], changed: (b, a) => !!a && a.title !== b.title },
]
for (const w of ECN_WRITES) {
  test(`[S08-${w.id}] ${w.name} — 타 테넌트 ECN 변경 차단`, async () => {
    const a = act(w.name, /ecn\.actions/)
    expect(a, `${w.name} 액션이 매니페스트에 없음`).not.toBeNull()
    const changed: string[] = []
    for (const who of ["ADMIN", "VIEWER", "DEV", "UNAUTH"] as Who[]) {
      for (const p of a!.pages.map(toPath)) {
        const v = await ecnVictim(w.start)
        const before = { status: v.status, title: v.title }
        await post(cookies[who] ?? null, p, a!, w.args(v.id))
        const after = await db().engineeringChange.findUnique({ where: { id: v.id }, select: { status: true, title: true } })
        if (w.changed(before, after as { status: string; title: string } | null)) changed.push(`${who}@${p}`)
      }
    }
    log({ kind: "write", id: w.id, name: w.name, changed })
    expect(changed, `${w.name}: 타 테넌트 ECN 이 변경됨 ${JSON.stringify(changed)}`).toEqual([])
  })
}

test("[S08-W07] deleteQuotation — 타 테넌트 견적 삭제 차단", async () => {
  const a = act("deleteQuotation", /quotation\.actions/)
  expect(a).not.toBeNull()
  const changed: string[] = []
  for (const who of ["DEV", "UNAUTH"] as Who[]) {
    for (const p of a!.pages.map(toPath)) {
      const q = await db().quotation.create({ data: { tenantId: T2, siteId: FX.siteId, customerId: FX.customerId, quotationNo: `E2E-T2-QT-W${Date.now().toString(36)}${seq++}`, quotationDate: new Date("2026-11-01"), validUntil: new Date("2026-12-01"), status: "DRAFT" } })
      await post(cookies[who] ?? null, p, a!, [q.id])
      if (!(await db().quotation.findUnique({ where: { id: q.id } }))) changed.push(`${who}@${p}`)
    }
  }
  log({ kind: "write", id: "W07", name: "deleteQuotation", changed })
  expect(changed, `deleteQuotation: 타 테넌트 견적이 삭제됨 ${JSON.stringify(changed)}`).toEqual([])
})

test("[S08-W08] updateSupportRequest — 타 테넌트 문의 변경 차단", async () => {
  const a = act("updateSupportRequest", /support-request\.actions/)
  expect(a).not.toBeNull()
  const changed: string[] = []
  for (const who of ["DEV", "UNAUTH"] as Who[]) {
    for (const p of a!.pages.map(toPath)) {
      const s = await db().supportRequest.create({ data: { tenantId: T2, authorId: FX.ownerProfileId, type: "OTHER", priority: "NORMAL", title: `E2E-T2 쓰기 프로브 ${seq++}`, content: "c" } })
      await post(cookies[who] ?? null, p, a!, [{ id: s.id, status: "COMPLETED", answer: "HACKED-BY-T1", adminNote: "x" }])
      const after = await db().supportRequest.findUnique({ where: { id: s.id } })
      if (after && (after.answer === "HACKED-BY-T1" || after.status !== s.status)) changed.push(`${who}@${p}`)
    }
  }
  log({ kind: "write", id: "W08", name: "updateSupportRequest", changed })
  expect(changed, `updateSupportRequest: 타 테넌트 문의가 변경됨 ${JSON.stringify(changed)}`).toEqual([])
})

test("[S08-W09] upsertTagCurrentValue — 타 테넌트 설비 태그 값 변경 차단", async () => {
  const a = act("upsertTagCurrentValue", /tag-current-value\.actions/)
  expect(a).not.toBeNull()
  const changed: string[] = []
  for (const who of ["DEV", "UNAUTH"] as Who[]) {
    for (const p of a!.pages.map(toPath)) {
      await db().tagCurrentValue.update({ where: { tagId: FX.tagId }, data: { value: "7" } })
      await post(cookies[who] ?? null, p, a!, [FX.tagId, "HACKED-BY-T1", null, "GOOD", new Date().toISOString()])
      const after = await db().tagCurrentValue.findUnique({ where: { tagId: FX.tagId } })
      if (after?.value === "HACKED-BY-T1") changed.push(`${who}@${p}`)
    }
  }
  await db().tagCurrentValue.update({ where: { tagId: FX.tagId }, data: { value: "7" } })
  log({ kind: "write", id: "W09", name: "upsertTagCurrentValue", changed })
  expect(changed, `upsertTagCurrentValue: 타 테넌트 태그 값이 변경됨 ${JSON.stringify(changed)}`).toEqual([])
})

test("[S08-W10] createWorkCenter — 타 테넌트 사업장에 작업장 생성 차단", async () => {
  const a = act("createWorkCenter", /work-center\.actions/)
  expect(a).not.toBeNull()
  const created: string[] = []
  const evidence: string[] = []
  for (const who of ["ADMIN", "VIEWER", "DEV", "UNAUTH"] as Who[]) {
    for (const p of a!.pages.map(toPath)) {
      // 코드는 실행마다 고유해야 한다(이전 실행의 잔여 행을 "방금 생성됨"으로 오판하지 않도록)
      const code = `E2E-T2-WCX-${Date.now().toString(36)}-${seq++}`
      const res = await post(cookies[who] ?? null, p, a!, [{ siteId: FX.siteId, code, name: "HACK", kind: "MACHINING" }])
      evidence.push(`${who}@${p}: ${res.status} ${res.text.slice(0, 160).replace(/s+/g, " ")}`)
      if (await db().workCenter.findFirst({ where: { siteId: FX.siteId, code } })) created.push(`${who}@${p}`)
    }
  }
  log({ kind: "write", id: "W10", name: "createWorkCenter", created, evidence })
  expect(created, `createWorkCenter: 타 테넌트 사업장에 작업장이 생성됨 ${JSON.stringify(created)}`).toEqual([])
})

// ───────── 비로그인 접근면: 로그인 없이 도달 가능한 페이지(/app 밖)에 등록된 액션 ─────────
test("[S08-U01] 로그인 전 페이지(/login·/signup-request·/pop·/kiosk·/label-print)에 등록된 액션은 인증 없이 실행되지 않는다", async () => {
  for (const p of ["/login", "/signup-request", "/pop/work-select", "/pop/production", "/kiosk", "/label-print"]) { try { await fetch(`${E2E_BASE}${p}`, { signal: AbortSignal.timeout(90_000) }) } catch { /* 계속 */ } }
  MAP = buildActionMap()
  // 의도된 공개 흐름: POP 로그인, 가입신청(PIN 형식 확인은 사용 여부를 알려주지 않음). 그 밖의 액션은 세션이 없으면 오류/빈 결과여야 한다.
  const OPEN_BY_DESIGN = new Set(["popLogin", "createSignupRequest", "checkSignupPopPinAvailability"])
  // 세션이 없을 때 데이터 없이 빈 배열/null 만 돌려주는 응답은 노출이 아니다(fail-closed)
  const EMPTY = /\n1:(\[\]|null)\s*$/
  const unauthPages = (a: ActionInfo) => a.pages.filter((k) => !/^app\/app\//.test(k)).map(toPath)
  const exposed: { name: string; page: string; status: number; sample: string }[] = []
  const probed: string[] = []
  for (const a of MAP) {
    const pages = unauthPages(a)
    if (!pages.length) continue
    probed.push(`${a.name}@${pages.join(",")}`)
    if (OPEN_BY_DESIGN.has(a.name)) continue
    for (const p of pages) {
      const res = await post(null, p, a, [])
      if (res.status === 200 && !denied(res.text) && !EMPTY.test(res.text) && !/"(?:success|ok)":false/.test(res.text) && !/\d+:E\{/.test(res.text)) exposed.push({ name: a.name, page: p, status: res.status, sample: res.text.slice(0, 120) })
    }
  }
  log({ kind: "unauth-surface", probed, exposed })
  expect(exposed, `인증 없이 실행되는 액션: ${JSON.stringify(exposed)}`).toEqual([])
})

// ───────── 대조군: 동일 테넌트(테넌트1) 자기 데이터는 수정 후에도 정상 조회·변경된다 ─────────
test("[S08-C01] 동일 테넌트 정상 조회·변경 유지 (수정으로 정상 업무가 막히지 않았는지)", async () => {
  const C = FX.control as unknown as Record<string, string>
  const results: Record<string, string> = {}
  const okRead = async (name: string, file: RegExp, who: Who, args: unknown[], marker: RegExp) => {
    const a = act(name, file)
    if (!a) { results[name] = "액션 없음"; return false }
    for (const p of a.pages.map(toPath)) {
      const res = await post(cookies[who] ?? null, p, a, args)
      if (res.status === 200 && marker.test(res.text) && !denied(res.text)) { results[name] = `정상(${who}@${p})`; return true }
    }
    results[name] = "조회 실패"
    return false
  }
  const checks = [
    await okRead("getECNById", /ecn\.actions/, "ADMIN", [C.ecnId], /E2E-T1-/),
    await okRead("getCurrentBOM", /ecn\.actions/, "ADMIN", [C.itemFg], /E2E-T1-/),
    await okRead("getBomsForItem", /costing\.actions/, "DEV", [C.itemFg], /E2E-T1-V1/),
    await okRead("getQuotations", /quotation\.actions/, "DEV", [], /E2E-T1-/),
    await okRead("getQuotationById", /quotation\.actions/, "DEV", [C.quotationId], /E2E-T1-/),
    await okRead("getCustomersForQuotation", /quotation\.actions/, "DEV", [], /E2E-T1-/),
    await okRead("getFinishedItems", /quotation\.actions/, "DEV", [], /E2E-T1-/),
    await okRead("getSupportRequestById", /support-request\.actions/, "DEV", [C.supportRequestId], /E2E-T1-/),
    await okRead("getCurrentTagValuesByEquipment", /tag-current-value\.actions/, "DEV", [C.equipmentId], /E2E-T1-/),
    await okRead("getCurrentTagValuesByTags", /tag-current-value\.actions/, "DEV", [[C.tagId]], /E2E-T1-/),
    await okRead("getWorkOrders", /work-order\.actions/, "ADMIN", [], /"orderNo"|\[\]/),
  ]
  // 쓰기: 자기 테넌트 데이터는 변경 가능해야 한다
  const wq = act("deleteQuotation", /quotation\.actions/)!
  const q = await db().quotation.create({ data: { tenantId: process.env.DEFAULT_TENANT_ID!, siteId: C.siteId, customerId: C.customerId, quotationNo: `E2E-T1-QT-W${Date.now().toString(36)}`, quotationDate: new Date("2026-11-01"), validUntil: new Date("2026-12-01"), status: "DRAFT" } })
  await post(cookies.DEV!, toPath(wq.pages[0]), wq, [q.id])
  results.deleteQuotation = (await db().quotation.findUnique({ where: { id: q.id } })) ? "삭제 안 됨(회귀)" : "정상 삭제"
  const wu = act("updateSupportRequest", /support-request\.actions/)!
  await post(cookies.DEV!, toPath(wu.pages[0]), wu, [{ id: C.supportRequestId, status: "IN_PROGRESS", adminNote: "E2E-T1 처리" }])
  results.updateSupportRequest = (await db().supportRequest.findUnique({ where: { id: C.supportRequestId } }))?.adminNote === "E2E-T1 처리" ? "정상 변경" : "변경 안 됨(회귀)"
  const wt = act("upsertTagCurrentValue", /tag-current-value\.actions/)!
  await post(cookies.DEV!, toPath(wt.pages[0]), wt, [C.tagId, "9", 9, "GOOD", new Date().toISOString()])
  results.upsertTagCurrentValue = (await db().tagCurrentValue.findUnique({ where: { tagId: C.tagId } }))?.value === "9" ? "정상 변경" : "변경 안 됨(회귀)"
  const wc = act("createWorkCenter", /work-center\.actions/)!
  const wcCode = `E2E-T1-WC-${Date.now().toString(36)}`
  await post(cookies.ADMIN!, toPath(wc.pages[0]), wc, [{ siteId: C.siteId, code: wcCode, name: "E2E-T1 작업장", kind: "MACHINING" }])
  const created = await db().workCenter.findFirst({ where: { siteId: C.siteId, code: wcCode } })
  results.createWorkCenter = created ? "정상 생성" : "생성 안 됨(회귀)"
  if (created) await db().workCenter.delete({ where: { id: created.id } })
  log({ kind: "control", results })
  expect(checks.every(Boolean) && !Object.values(results).some((v) => /회귀|실패|없음/.test(v)), `동일 테넌트 정상 흐름 점검: ${JSON.stringify(results)}`).toBe(true)
})

// ───────── 같은 계열 관찰(S-09 후보): 클라이언트가 보낸 '다른 테넌트 소유 참조 ID' 를 검증 없이 저장하는가 ─────────
// 이 배치에서는 수정하지 않고 재현 여부만 기록한다(assert 없음 → 결과는 s08-results.jsonl 의 kind=observe).
test("[S09-OBS] 참조 소속 미검증 관찰: createLocation / createEquipment / createBom 에 타 테넌트 ID 전달", async () => {
  const out: Record<string, string> = {}
  const tag = Date.now().toString(36)
  const loc = act("createLocation", /location\.actions/)
  if (loc) {
    await post(cookies.ADMIN!, toPath(loc.pages[0]), loc, [{ siteId: FX.siteId, code: `E2E-OBS-L${tag}`, name: "관찰" }])
    const w = await db().warehouse.findFirst({ where: { siteId: FX.siteId, code: `E2E-OBS-L${tag}` } })
    out.createLocation = w ? `타 테넌트 사업장(${T2})에 창고 생성됨(소유 tenantId=${w.tenantId})` : "차단"
    if (w) await db().warehouse.delete({ where: { id: w.id } })
  }
  const eq = act("createEquipment", /equipment\.actions/)
  if (eq) {
    await post(cookies.ADMIN!, toPath(eq.pages[0]), eq, [{ siteId: FX.siteId, workCenterId: FX.workCenterId, code: `E2E-OBS-E${tag}`, name: "관찰", equipmentType: "MACHINE" }])
    const e = await db().equipment.findFirst({ where: { siteId: FX.siteId, code: `E2E-OBS-E${tag}` } })
    out.createEquipment = e ? `타 테넌트 사업장/작업장에 설비 생성됨(소유 tenantId=${e.tenantId})` : "차단"
    if (e) await db().equipment.delete({ where: { id: e.id } })
  }
  const bom = act("createBom", /bom\.actions/)
  if (bom) {
    await post(cookies.ADMIN!, toPath(bom.pages[0]), bom, [{ itemId: FX.itemFg, version: `E2E-OBS-${tag}`, isDefault: false, status: "DRAFT", bomItems: [{ componentItemId: FX.itemRm, seq: 1, qtyPer: 1, scrapRate: 0 }] }])
    const b = await db().bOM.findFirst({ where: { itemId: FX.itemFg, version: `E2E-OBS-${tag}` } })
    out.createBom = b ? `타 테넌트 품목을 참조하는 BOM 생성됨(소유 tenantId=${b.tenantId})` : "차단"
    if (b) { await db().bOMItem.deleteMany({ where: { bomId: b.id } }); await db().bOM.delete({ where: { id: b.id } }) }
  }
  log({ kind: "observe", id: "S09", out })
  test.info().annotations.push({ type: "observe", description: JSON.stringify(out) })
})
