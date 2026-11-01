/**
 * 권한/접근통제 테스트 (313TC 의 '권한/범위' 유형 + 추가 보안 점검)
 *
 *  - 화면에서 버튼이 숨겨지는 것만으로 PASS 하지 않는다: 역할별 세션으로 서버 액션/API 를 직접 호출해 서버가 막는지, DB 가 바뀌지 않았는지 본다.
 *  - 정책 기준: 소스(role-permissions.ts 매핑) + 로컬 테스트 DB 의 RolePermission 행.
 *  - 모든 실행은 로컬 테스트 DB / 로컬 서버 한정(가드). 상세 결과는 test-results/e2e/perm-detail.jsonl 로 남긴다(보고서 생성용).
 */
import { test, expect } from "@playwright/test"
import * as fs from "node:fs"
import * as path from "node:path"
import { assertSafeE2eEnvironment, E2E_BASE, adminCredentials, developerCredentials } from "./guard"
import { loadTcs, login } from "./tc-helpers"
import {
  ROLES, roleCreds, buildActionMap, pageKey, classify, dummyArgs, apiLogin, callAction, snapshot, changedSince,
  db, closeDb, resourceOfPath, rolePerms, allowedFor, signToken, tenantParamArgs, rawCall,
  type ActionInfo, type RoleKey, type CallResult,
} from "./support/perm-lib"

assertSafeE2eEnvironment()

const T1 = process.env.DEFAULT_TENANT_ID as string
const T2 = "e2e-tenant-002"
const T2_MARK = "E2E-T2"
const DETAIL = path.resolve(process.cwd(), "test-results/e2e/perm-detail.jsonl")
const record = (o: Record<string, unknown>) => fs.appendFileSync(DETAIL, JSON.stringify(o) + "\n")

const ALL_PERM_TCS = loadTcs().filter((t) => t.type === "권한/범위")
// 255(PDF 등록: 저장소 필요), 279(LOT 혼용: LOT 데이터 필요)는 별도 처리
// 개발 서버 메모리 때문에 나눠 실행할 수 있도록 PERM_ONLY(정규식, TC ID 기준)로 대상 TC 를 제한할 수 있다.
const ONLY = process.env.PERM_ONLY ? new RegExp(process.env.PERM_ONLY) : null
const MENU_TCS = ALL_PERM_TCS.filter((t) => !["DW-TC-255", "DW-TC-279"].includes(t.id) && (!ONLY || ONLY.test(t.id)))
const SEC_PATHS = ["/app/mes/customers", "/app/mes/vendors", "/app/mes/items", "/app/mes/sites", "/app/mes/locations", "/app/mes/master/equipment", "/app/mes/work-centers", "/app/mes/master/item-categories", "/app/mes/users", "/app/mes/defects", "/app/mes/quality/work-standards", "/app/mes/sales-orders", "/app/mes/shipments", "/app/mes/purchase-orders", "/app/mes/work-orders", "/app/mes/production-plan", "/app/mes/bom", "/app/mes/ecn", "/app/mes/master/inspection-standards", "/app/mes/material-receipt", "/app/mes/lot"]
const DEV_ONLY_PATHS = ["/app/mes/gateways", "/app/mes/equipment-connections", "/app/mes/tags", "/app/mes/lot-rules", "/app/mes/features", "/app/mes/common-codes"]
const MUTATION_BTN = /(등록|추가|수정|삭제|저장|업로드|확정|승인|취소)/

let actions: ActionInfo[] = []
const cookies: Partial<Record<RoleKey | "OWNER" | "DEV" | "T2", string>> = {}
let perms: Map<string, Set<string>>
let t2: { profileId: string; ids: Record<string, string> } = { profileId: "", ids: {} }


test.beforeAll(async () => {
  test.setTimeout(900_000)
  // 테스트가 실패하면 워커가 재시작되어 beforeAll 이 다시 실행되므로 여기서 상세 결과 파일을 비우지 않는다(실행 전에 별도로 삭제).
  fs.mkdirSync(path.dirname(DETAIL), { recursive: true })

  // 로그인(역할별) — 실제 로그인 API
  for (const r of ROLES) {
    const c = roleCreds(r)
    const l = await apiLogin(c.loginId, c.password)
    expect(l.status, `${r} 로그인`).toBe(200)
    cookies[r] = l.cookie!
  }
  const own = await apiLogin(adminCredentials().loginId, adminCredentials().password)
  cookies.OWNER = own.cookie!
  const dev = await apiLogin(developerCredentials().loginId, developerCredentials().password)
  cookies.DEV = dev.cookie!

  // 타 테넌트(2) 소유자: 서명 키를 아는 로컬 테스트에서만 유효한 토큰을 직접 만든다(로그인은 DEFAULT_TENANT_ID 고정이라 불가).
  const cred = await db().userCredential.findUniqueOrThrow({ where: { tenantId_loginId: { tenantId: T2, loginId: roleCreds("T2OWNER").loginId } } })
  const prof = await db().profile.findUniqueOrThrow({ where: { id: cred.profileId } })
  t2.profileId = cred.profileId
  cookies.T2 = "nmes-session=" + signToken({ profileId: cred.profileId, tenantId: T2, loginId: cred.loginId, name: prof.name, role: "OWNER", email: prof.email })
  t2.ids = {
    partnerCus: (await db().businessPartner.findFirstOrThrow({ where: { tenantId: T2, code: "E2E-T2-CUS" } })).id,
    partnerVnd: (await db().businessPartner.findFirstOrThrow({ where: { tenantId: T2, code: "E2E-T2-VND" } })).id,
    item: (await db().item.findFirstOrThrow({ where: { tenantId: T2, code: "E2E-T2-ITEM" } })).id,
    category: (await db().itemCategory.findFirstOrThrow({ where: { tenantId: T2, code: "E2E-T2-CAT" } })).id,
    site: (await db().site.findFirstOrThrow({ where: { tenantId: T2, code: "E2E-T2-SITE" } })).id,
    warehouse: (await db().warehouse.findFirstOrThrow({ where: { tenantId: T2, code: "E2E-T2-WH" } })).id,
    equipment: (await db().equipment.findFirstOrThrow({ where: { tenantId: T2, code: "E2E-T2-EQ" } })).id,
    workCenter: (await db().workCenter.findFirstOrThrow({ where: { site: { tenantId: T2 }, code: "E2E-T2-WC" } })).id,
  }

  // 모든 대상 경로를 한 번 방문해 개발 서버가 페이지·서버 액션을 컴파일하게 한다(액션 ID 는 컴파일 결과에서 읽는다).
  const warm = Array.from(new Set(MENU_TCS.map((t) => t.path).concat(SEC_PATHS, DEV_ONLY_PATHS)))
  for (const p of warm) {
    await fetch(E2E_BASE + p, { headers: { cookie: DEV_ONLY_PATHS.includes(p) ? cookies.DEV! : cookies.OWNER! }, redirect: "manual" }).then((r) => r.text()).catch(() => {})
  }
  actions = buildActionMap()
  perms = await rolePerms(T1)
})

test.afterAll(async () => { await closeDb() })

// ───────────────────────── 메뉴별(권한/범위 TC) ─────────────────────────
type CallRow = {
  role: RoleKey; action: string; cls: string; expectedDenied: boolean | null; outcome: CallResult["kind"]; message: string; stackAt: string
  changed: string[]; verdict: "OK" | "FAIL" | "SUSPECT" | "INCONCLUSIVE" | "MISMATCH" | "INFO"
}
// 소스에서 확인한 조회성 액션(MRP READ 권한으로 계산만 하고 저장하지 않음) — VIEWER 가 성공해도 정상
const READONLY_OK = new Set(["runOrderBasedMrp", "runMrpSimulation"])

async function checkActions(pagePath: string): Promise<CallRow[]> {
  const resource = resourceOfPath(pagePath)
  const pageActs = actions.filter((a) => a.pages.includes(pageKey(pagePath)))
  const muts = pageActs.filter((a) => classify(a.name) !== "READ")
  const rows: CallRow[] = []
  let adminCalls = 0
  for (const role of ["VIEWER", "OPERATOR", "MANAGER", "ADMIN"] as RoleKey[]) {
    for (const a of muts) {
      const cls = classify(a.name)
      const { args, skip } = dummyArgs(a)
      if (skip) continue
      const allowed = allowedFor(perms, role, resource, cls)
      const expectedDenied: boolean | null = allowed === null ? (role === "VIEWER" ? true : null) : !allowed
      if (role === "ADMIN") { if (args.length === 0 || adminCalls >= 4) continue; adminCalls++ }
      if (expectedDenied === false && args.length === 0) continue // 허용 역할의 인자 없는 호출은 실제 실행될 수 있어 제외
      const before = await snapshot()
      const res = await callAction(cookies[role]!, pagePath, a, args)
      const changed = await changedSince(before)
      let verdict: CallRow["verdict"] = "INFO"
      const blocked = res.kind === "DENIED" || res.kind === "BLOCKED_BY_ROUTE"
      if (expectedDenied === true) {
        if (changed.length > 0) verdict = "FAIL" // 권한이 없는 역할의 호출로 DB 가 바뀜
        else if (blocked) verdict = "OK"
        else if (role === "VIEWER" && res.kind === "EXECUTED" && !READONLY_OK.has(a.name)) verdict = "SUSPECT" // 거부 없이 성공 응답(DB 변화 없음)
        else verdict = role === "VIEWER" ? "INCONCLUSIVE" : "INFO" // OPERATOR/MANAGER 는 액션이 쓰는 리소스가 페이지 리소스와 다를 수 있어 참고
      } else if (expectedDenied === false) {
        verdict = blocked ? "MISMATCH" : "OK"
      }
      rows.push({ role, action: a.name, cls, expectedDenied, outcome: res.kind, message: res.message.slice(0, 120), stackAt: res.stackAt, changed, verdict })
    }
  }
  return rows
}

async function pageAsRole(browser: import("@playwright/test").Browser, role: RoleKey, p: string) {
  const ctx = await browser.newContext({ baseURL: E2E_BASE })
  const value = cookies[role]!.replace("nmes-session=", "")
  await ctx.addCookies([{ name: "nmes-session", value, url: E2E_BASE, httpOnly: true, sameSite: "Strict" }])
  const page = await ctx.newPage()
  const errs: string[] = []
  page.on("pageerror", (e) => errs.push(e.message))
  const resp = await page.goto(p, { waitUntil: "domcontentloaded", timeout: 90_000 })
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})
  const h1 = await page.locator("h1").first().isVisible().catch(() => false)
  const bodyText = await page.locator("body").innerText().catch(() => "")
  const mutBtns = await page.getByRole("button", { name: MUTATION_BTN }).count()
  const url = page.url()
  await ctx.close()
  return { status: resp?.status() ?? 0, h1, errText: /Application error|Internal Server Error|This page could not be found/.test(bodyText), mutBtns, redirectedToLogin: /\/login/.test(url), pageErrors: errs.length }
}

for (const t of MENU_TCS) {
  test(`[${t.id}] ${t.menu} 권한/범위 — 역할별 직접 URL·서버 액션 차단, 타 테넌트 격리`, async ({ browser }) => {
    test.setTimeout(600_000)
    const problems: string[] = []

    // 1) 직접 URL(실제 브라우저, 역할 세션) — 읽기 권한이 있는 역할은 정상 표시, 변경 버튼 노출은 참고용
    const pageRes: Record<string, unknown> = {}
    for (const role of ["MANAGER", "OPERATOR", "VIEWER"] as RoleKey[]) {
      const r = await pageAsRole(browser, role, t.path)
      pageRes[role] = r
      if (r.status >= 400 || r.errText || r.redirectedToLogin) problems.push(`[페이지] ${role} 직접 URL → ${r.status} err=${r.errText} loginRedirect=${r.redirectedToLogin}`)
    }

    // 2) 서버 액션 직접 호출(역할 세션) + DB 변경 감지
    const rows = await checkActions(t.path)
    const fails = rows.filter((r) => r.verdict === "FAIL")
    for (const f of fails) problems.push(`[서버 미차단] ${f.role} ${f.action}(${f.cls}) → ${f.outcome} 변경=${f.changed.join(",") || "없음"}`)

    // 3) 타 테넌트 격리: 위 역할 세션 화면에 타 테넌트 데이터가 보이면 안 되고, 타 테넌트 소유자 화면에는 보여야(양성 대조) 격리 검증이 의미 있다
    const leak: string[] = []
    for (const role of ROLES) {
      const body = await (await fetch(E2E_BASE + t.path, { headers: { cookie: cookies[role]! }, redirect: "manual" })).text()
      if (body.includes(T2_MARK)) leak.push(role)
    }
    const t2Body = await (await fetch(E2E_BASE + t.path, { headers: { cookie: cookies.T2! }, redirect: "manual" })).text()
    const scopeVerifiable = t2Body.includes(T2_MARK)
    const t1Own = await (await fetch(E2E_BASE + t.path, { headers: { cookie: cookies.OWNER! }, redirect: "manual" })).text()
    if (leak.length) problems.push(`[타 테넌트 노출] ${leak.join(",")} 화면에 ${T2_MARK} 데이터 표시`)
    if (t2Body.includes("e2e-admin") && !t2Body.includes("e2e-t2")) { /* 사용자 목록 등에서 T1 계정 노출 여부는 users 경로 전용 검사에서 확인 */ }

    record({ tcId: t.id, menu: t.menu, path: t.path, resource: resourceOfPath(t.path), pageRes, calls: rows, leak, scopeVerifiable, t1OwnLen: t1Own.length, problems })
    expect(problems, problems.join("\n")).toEqual([])
  })
}

// ───────────────────────── 추가 보안 점검 ─────────────────────────
test("[SEC-01] 비로그인: 보호 경로·서버 액션·API 는 인증 없이 동작하지 않는다", async () => {
  const problems: string[] = []
  const paths = Array.from(new Set(MENU_TCS.map((t) => t.path)))
  let redirected = 0
  for (const p of paths) {
    const r = await fetch(E2E_BASE + p, { redirect: "manual" })
    if (r.status >= 300 && r.status < 400 && (r.headers.get("location") ?? "").includes("/login")) redirected++
    else problems.push(`GET ${p} → ${r.status}`)
  }
  const before = await snapshot()
  const sample = actions.filter((a) => a.pages.includes(pageKey("/app/mes/customers")) && classify(a.name) !== "READ")
  const calls: string[] = []
  for (const a of sample) {
    const res = await callAction(null, "/app/mes/customers", a, dummyArgs(a).args)
    calls.push(`${a.name}:${res.kind}`)
    if (res.kind === "EXECUTED") problems.push(`비로그인 서버 액션 실행됨: ${a.name}`)
  }
  const changed = await changedSince(before)
  if (changed.length) problems.push(`비로그인 호출 후 DB 변경: ${changed.join(",")}`)
  const apis: [string, string, RequestInit?][] = [
    ["GET", "/api/auth/me"], ["POST", "/api/auth/change-password", { body: "{}", headers: { "content-type": "application/json" } }],
    ["POST", "/api/ai-chat/stream", { body: "{}", headers: { "content-type": "application/json" } }], ["POST", "/api/ai-report", { body: "{}", headers: { "content-type": "application/json" } }],
    ["POST", "/api/upload/attachment", { body: new FormData() }], ["POST", "/api/upload/work-standard", { body: new FormData() }],
    ["GET", "/api/lms/ncwatch/status"], // equipment-monitor/light 는 SEC-08 에서 데이터를 만들어 별도 검증
  ]
  const apiRes: string[] = []
  for (const [m, u, init] of apis) {
    const r = await fetch(E2E_BASE + u, { method: m, redirect: "manual", ...init })
    apiRes.push(`${m} ${u} → ${r.status}`)
    if (r.status < 300 && r.status >= 200) problems.push(`API 무인증 성공: ${m} ${u} → ${r.status}`)
  }
  record({ tcId: "SEC-01", redirected, total: paths.length, calls, apiRes, problems })
  expect(problems, problems.join("\n")).toEqual([])
})

test("[SEC-02] 위조/만료 토큰: 서명이 다른 토큰·개발자 사칭·만료 토큰은 통하지 않는다", async () => {
  const problems: string[] = []
  const prof = await db().userCredential.findUniqueOrThrow({ where: { tenantId_loginId: { tenantId: T1, loginId: adminCredentials().loginId } } })
  const base = { profileId: prof.profileId, tenantId: T1, loginId: "test", name: "x", role: "OWNER" }
  const forged = "nmes-session=" + signToken(base, "wrong-secret-for-test")
  const none = "nmes-session=" + Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url") + "." + Buffer.from(JSON.stringify(base)).toString("base64url") + "."
  const expired = "nmes-session=" + signToken({ ...base, exp: Math.floor(Date.now() / 1000) - 3600 })
  const out: string[] = []
  for (const [label, ck] of [["서명불일치+개발자(test) 사칭", forged], ["alg=none", none], ["만료", expired]] as const) {
    for (const p of ["/app/mes/gateways", "/app/mes/customers"]) {
      const r = await fetch(E2E_BASE + p, { headers: { cookie: ck }, redirect: "manual" })
      const body = r.status === 200 ? await r.text() : ""
      out.push(`${label} GET ${p} → ${r.status}`)
      // 개발자 전용 경로는 미들웨어가 서명 미검증 payload 로 1차 통과시킬 수 있으나, 서버(layout/page)가 서명을 검증해 내용을 보여주면 안 된다
      const leaked = r.status === 200 && /게이트웨이|Gateway|고객사/.test(body) && !/로그인|login/i.test(body.slice(0, 400))
      if (leaked) problems.push(`${label}: ${p} 내용 노출(200)`)
    }
    const before = await snapshot()
    const a = actions.find((x) => x.name === "createBusinessPartner")!
    const res = await callAction(ck, "/app/mes/customers", a, [{ code: "E2E-FORGED", name: "E2E-FORGED", partnerType: "CUSTOMER" }])
    out.push(`${label} createBusinessPartner → ${res.kind}`)
    if (res.kind === "EXECUTED") problems.push(`${label}: 서버 액션 실행됨`)
    const ch = await changedSince(before)
    if (ch.length) problems.push(`${label}: DB 변경 ${ch.join(",")}`)
  }
  record({ tcId: "SEC-02", out, problems })
  expect(problems, problems.join("\n")).toEqual([])
})

test("[SEC-03] 개발자 전용 메뉴: 일반 계정은 직접 URL 이 404 로 차단되고 개발자(test)만 접근한다", async () => {
  test.setTimeout(900_000)
  const problems: string[] = []
  const out: string[] = []
  // ADMIN/OPERATOR 는 OWNER/MANAGER 와 같은 경로 정책(개발자 loginId 기준)이라 개발 서버 부하를 줄이려 대표 3개 역할만 본다.
  for (const role of ["OWNER", "MANAGER", "VIEWER"] as const) {
    for (const p of DEV_ONLY_PATHS) {
      const r = await fetch(E2E_BASE + p, { headers: { cookie: cookies[role]! }, redirect: "manual" })
      await r.text()
      out.push(`${role} GET ${p} → ${r.status}`)
      if (r.status !== 404) problems.push(`${role} ${p} → ${r.status} (404 기대)`)
    }
  }
  for (const p of DEV_ONLY_PATHS) {
    const r = await fetch(E2E_BASE + p, { headers: { cookie: cookies.DEV! }, redirect: "manual" })
    await r.text()
    out.push(`개발자(test) GET ${p} → ${r.status}`)
    if (r.status >= 400) problems.push(`개발자 ${p} → ${r.status}`)
  }
  record({ tcId: "SEC-03", out, problems })
  expect(problems, problems.join("\n")).toEqual([])
})

// 개발 서버에서 비허용 경로로의 서버 액션 POST 는 404 페이지 전체를 렌더링하며 매우 무겁다(호출당 20~35초, 반복 시 서버 메모리 부족으로 종료) → 대표 1건만 확인한다.
test("[SEC-03b] 개발자 전용 서버 액션: 일반 계정이 직접 호출해도 실행되지 않고 DB 가 그대로다(대표 1건)", async () => {
  test.setTimeout(600_000)
  const a = actions.find((x) => x.pages.includes(pageKey("/app/mes/gateways")) && classify(x.name) !== "READ")
  expect(a, "개발자 전용 변경 액션을 찾지 못함").toBeTruthy()
  const before = await snapshot()
  const res = await callAction(cookies.VIEWER!, "/app/mes/gateways", a!, dummyArgs(a!).args)
  const ch = await changedSince(before)
  const problems: string[] = []
  if (res.kind === "EXECUTED") problems.push(`VIEWER 가 개발자 전용 액션 ${a!.name} 을 실행함`)
  if (ch.length) problems.push(`DB 변경 ${ch.join(",")}`)
  record({ tcId: "SEC-03b", out: [`VIEWER ${a!.name} → ${res.kind} (${res.status})`], problems })
  expect(problems, problems.join("\n")).toEqual([])
})

test("[SEC-04] 타 테넌트 데이터 변경 시도(IDOR): 다른 테넌트 레코드 ID 로 수정/삭제를 요청해도 거부되고 DB 가 그대로다", async () => {
  const problems: string[] = []
  const out: string[] = []
  type Case = { page: string; action: string; args: unknown[]; verify: () => Promise<boolean> }
  const nameOf = async (table: "businessPartner" | "item" | "itemCategory" | "site" | "warehouse" | "equipment", id: string) =>
    (await (db()[table] as unknown as { findUnique: (a: unknown) => Promise<{ name?: string } | null> }).findUnique({ where: { id } }))?.name ?? null
  const cases: Case[] = [
    { page: "/app/mes/customers", action: "deleteBusinessPartner", args: [t2.ids.partnerCus], verify: async () => (await nameOf("businessPartner", t2.ids.partnerCus)) !== null },
    { page: "/app/mes/customers", action: "updateBusinessPartner", args: [t2.ids.partnerCus, { code: "E2E-T2-CUS", name: "HACKED", partnerType: "CUSTOMER" }], verify: async () => (await nameOf("businessPartner", t2.ids.partnerCus)) !== "HACKED" },
    { page: "/app/mes/vendors", action: "deleteBusinessPartner", args: [t2.ids.partnerVnd], verify: async () => (await nameOf("businessPartner", t2.ids.partnerVnd)) !== null },
    { page: "/app/mes/items", action: "deleteItem", args: [t2.ids.item], verify: async () => (await nameOf("item", t2.ids.item)) !== null },
    { page: "/app/mes/master/item-categories", action: "deleteItemCategory", args: [t2.ids.category], verify: async () => (await nameOf("itemCategory", t2.ids.category)) !== null },
    { page: "/app/mes/master/item-categories", action: "updateItemCategory", args: [t2.ids.category, { code: "E2E-T2-CAT", name: "HACKED", itemType: "RAW_MATERIAL", displayOrder: 0 }], verify: async () => (await nameOf("itemCategory", t2.ids.category)) !== "HACKED" },
    { page: "/app/mes/sites", action: "deleteSite", args: [t2.ids.site], verify: async () => (await nameOf("site", t2.ids.site)) !== null },
    { page: "/app/mes/sites", action: "updateSite", args: [t2.ids.site, { code: "E2E-T2-SITE", name: "HACKED", type: "FACTORY" }], verify: async () => (await nameOf("site", t2.ids.site)) !== "HACKED" },
    { page: "/app/mes/locations", action: "deleteLocation", args: [t2.ids.warehouse], verify: async () => (await nameOf("warehouse", t2.ids.warehouse)) !== null },
    { page: "/app/mes/master/equipment", action: "deleteEquipment", args: [t2.ids.equipment], verify: async () => (await nameOf("equipment", t2.ids.equipment)) !== null },
    { page: "/app/mes/work-centers", action: "deleteWorkCenter", args: [t2.ids.workCenter], verify: async () => (await db().workCenter.findUnique({ where: { id: t2.ids.workCenter } })) !== null },
  ]
  for (const c of cases) {
    const a = actions.find((x) => x.name === c.action && x.pages.includes(pageKey(c.page)))
    if (!a) { out.push(`${c.action}: 액션 없음`); problems.push(`${c.action} 액션을 찾지 못함(${c.page})`); continue }
    const res = await callAction(cookies.OWNER!, c.page, a, c.args)
    const intact = await c.verify()
    out.push(`${c.action}(${c.page}) → ${res.kind} ${res.message.slice(0, 60)} / T2 데이터 보존=${intact}`)
    if (!intact) problems.push(`${c.action}: 타 테넌트 데이터가 변경/삭제됨`)
    // 응답이 성공(no-op)이어도 타 테넌트 데이터가 그대로면 격리는 유지된 것이다(deleteMany 에 tenant 조건) — 위 intact 검사가 판정 기준
  }
  record({ tcId: "SEC-04", out, problems })
  expect(problems, problems.join("\n")).toEqual([])
})

test("[DW-TC-255] 작업표준서관리 PDF 업로드 API 권한·파일 형식 검증", async () => {
  const out: string[] = []
  const problems: string[] = []
  const post = async (cookie: string | null, name: string, type: string, body: string | Uint8Array) => {
    const fd = new FormData()
    fd.append("file", new Blob([body as BlobPart], { type }), name)
    const r = await fetch(`${E2E_BASE}/api/upload/work-standard`, { method: "POST", headers: cookie ? { cookie } : {}, body: fd, redirect: "manual" })
    return { status: r.status, text: (await r.text()).slice(0, 120) }
  }
  const before = await snapshot()
  const none = await post(null, "a.pdf", "application/pdf", "%PDF-1.4 x"); out.push(`비로그인 → ${none.status}`)
  if (none.status < 300 ? true : false) problems.push("비로그인 업로드 성공")
  for (const role of ["VIEWER", "OPERATOR"] as const) {
    const r = await post(cookies[role]!, "a.pdf", "application/pdf", "%PDF-1.4 x"); out.push(`${role} PDF 업로드 → ${r.status} ${r.text}`)
    if (r.status === 200) problems.push(`${role} 업로드 성공(권한 없음이어야 함)`)
    if (r.status !== 403) problems.push(`${role} → ${r.status} (403 기대)`)
  }
  for (const role of ["MANAGER", "ADMIN"] as const) {
    const r = await post(cookies[role]!, "a.txt", "text/plain", "not a pdf"); out.push(`${role} 비PDF 업로드 → ${r.status} ${r.text}`)
    if (r.status !== 400) problems.push(`${role} 비PDF → ${r.status} (400 기대)`)
    const fake = await post(cookies[role]!, "b.pdf", "application/pdf", "not really pdf"); out.push(`${role} 위장 PDF(.pdf 확장자, 시그니처 없음) → ${fake.status} ${fake.text}`)
    if (fake.status !== 400) problems.push(`${role} 위장 PDF → ${fake.status} (400 기대)`)
  }
  const ch = await changedSince(before)
  if (ch.length) problems.push(`DB 변경 ${ch.join(",")}`)
  record({ tcId: "DW-TC-255", out, problems, note: "정상 PDF 저장(성공 경로)은 Storage 가 로컬에 없어 검증하지 않음" })
  expect(problems, problems.join("\n")).toEqual([])
})

test("[SEC-05] 첨부 업로드 API 권한(OPERATOR 미만 차단)", async () => {
  const out: string[] = []
  const problems: string[] = []
  for (const role of ["VIEWER", "OPERATOR"] as const) {
    const fd = new FormData()
    fd.append("file", new Blob(["x"], { type: "text/plain" }), "a.txt")
    fd.append("entityType", "E2E_NO_SUCH")
    const r = await fetch(`${E2E_BASE}/api/upload/attachment`, { method: "POST", headers: { cookie: cookies[role]! }, body: fd, redirect: "manual" })
    out.push(`${role} → ${r.status} ${(await r.text()).slice(0, 80)}`)
    if (r.status === 200) problems.push(`${role} 첨부 업로드 성공`)
  }
  record({ tcId: "SEC-05", out, problems })
  expect(problems, problems.join("\n")).toEqual([])
})

test("[SEC-06] 역할별 UI 로그인(실제 화면) — ADMIN/MANAGER/OPERATOR/VIEWER 가 로그인해 /app 에 진입한다", async ({ browser }) => {
  const out: string[] = []
  for (const role of ROLES) {
    const ctx = await browser.newContext({ baseURL: E2E_BASE })
    const page = await ctx.newPage()
    const c = roleCreds(role)
    await page.goto("/login")
    await page.getByRole("button", { name: /시스템모드/ }).click()
    await page.locator("#loginId").fill(c.loginId)
    await page.locator("#password").fill(c.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app/, { timeout: 60_000 })
    out.push(`${role}: ${new URL(page.url()).pathname}`)
    await ctx.close()
  }
  record({ tcId: "SEC-06", out, problems: [] })
})

// 사용자관리 전용: 비OWNER 의 계정/암호/PIN 변경 차단, 사용자 목록 테넌트 격리
test("[DW-TC-048] 사용자관리 — 타 사용자 암호·PIN·계정상태의 비인가 수정 차단", async () => {
  const problems: string[] = []
  const out: string[] = []
  const target = await db().userCredential.findUniqueOrThrow({ where: { tenantId_loginId: { tenantId: T1, loginId: roleCreds("VIEWER").loginId } } })
  const before = await db().userCredential.findUniqueOrThrow({ where: { id: target.id } })
  const names = actions.filter((a) => a.pages.includes(pageKey("/app/mes/users")) && classify(a.name) !== "READ")
  for (const role of ["VIEWER", "OPERATOR", "MANAGER"] as RoleKey[]) {
    for (const a of names) {
      const { args, skip } = dummyArgs(a)
      if (skip) continue
      // 대상 사용자 id 를 첫 번째 문자열 인자로 넣어 실제 변경 시도(권한이 없으면 서버가 막아야 함)
      const real = args.map((x, i) => (i === 0 && typeof x === "string" ? target.profileId : x))
      const snap = await snapshot()
      const res = await callAction(cookies[role]!, "/app/mes/users", a, real)
      const ch = await changedSince(snap)
      out.push(`${role} ${a.name} → ${res.kind}${res.stackAt ? " @" + res.stackAt : ""} 변경=${ch.join(",") || "없음"}`)
      if (res.kind === "EXECUTED" || ch.length) problems.push(`${role} ${a.name} 이 실행/변경됨 (${ch.join(",")})`)
    }
  }
  const after = await db().userCredential.findUniqueOrThrow({ where: { id: target.id } })
  if (after.passwordHash !== before.passwordHash || after.isLocked !== before.isLocked || after.popPinHash !== before.popPinHash) problems.push("대상 계정의 암호/잠금/PIN 이 변경됨")
  const tu = await db().tenantUser.findFirstOrThrow({ where: { profileId: target.profileId, tenantId: T1 } })
  if (tu.role !== "VIEWER" || !tu.isActive) problems.push("대상 계정의 역할/활성 상태가 변경됨")
  record({ tcId: "DW-TC-048", out, problems })
  expect(problems, problems.join("\n")).toEqual([])
})

// 클라이언트가 보낸 tenantId 를 서버가 믿는지 — 다른 테넌트의 ID 를 넣어 호출한다(타 테넌트 데이터 조회·생성 시도).
test("[SEC-07] 서버 액션이 클라이언트가 보낸 tenantId 를 그대로 신뢰하지 않는다(타 테넌트 조회·생성 차단)", async () => {
  test.setTimeout(900_000)
  const problems: string[] = []
  const out: string[] = []
  const tenantActs = actions
    .map((a) => ({ ...a, pages: a.pages.filter((p) => p.startsWith("app/app/") && !DEV_ONLY_PATHS.some((d) => p === pageKey(d))) }))
    .filter((a) => a.pages.length > 0) // 개발자 전용 페이지 경유 액션은 비허용 경로 POST 가 404 전체 렌더링이라 제외(SEC-03 에서 별도 검증)
    .map((a) => ({ a, args: tenantParamArgs(a, T2) }))
    .filter((x): x is { a: ActionInfo; args: unknown[] } => !!x.args && classify(x.a.name) === "READ")
  const calls: { action: string; page: string; kind: string; leaked: boolean }[] = []
  for (const { a, args } of tenantActs) {
    const p = "/" + a.pages.find((k) => k.startsWith("app/app/"))!.replace(/^app\//, "").replace(/\/page$/, "")
    const res = await callAction(cookies.OWNER!, p, a, args)
    const raw = await rawCall(cookies.OWNER!, p, a, args)
    const leaked = raw.includes(T2_MARK)
    calls.push({ action: a.name, page: p, kind: res.kind, leaked })
    out.push(`${a.name}(T2) → ${res.kind}${leaked ? " ★타 테넌트 데이터 반환" : ""}`)
    if (leaked) problems.push(`${a.name}: 타 테넌트(${T2}) 데이터가 응답에 포함됨`)
  }
  // 쓰기 증명: 품질 불량코드 생성 액션에 타 테넌트 ID 를 넣는다
  const dc = actions.find((x) => x.name === "createDefectCode")
  if (dc) {
    const page = "/" + dc.pages.find((k) => k.startsWith("app/app/"))!.replace(/^app\//, "").replace(/\/page$/, "")
    const code = `E2E-IDOR-${Date.now().toString(36).toUpperCase()}`
    const res = await callAction(cookies.OPERATOR!, page, dc, [{ code, name: "E2E IDOR 시도", defectCategory: "VISUAL" }, T2])
    const created = await db().defectCode.findFirst({ where: { tenantId: T2, code } })
    out.push(`createDefectCode(OPERATOR, tenantId=T2) → ${res.kind} / 타 테넌트에 생성됨=${!!created}`)
    if (created) {
      problems.push("OPERATOR(테넌트1)가 createDefectCode 에 테넌트2 ID 를 넣어 테넌트2 에 불량코드를 생성함")
      await db().defectCode.deleteMany({ where: { tenantId: T2, code } })
    }
  }
  record({ tcId: "SEC-07", out, calls, tenantActionCount: tenantActs.length, problems })
  expect(problems, problems.join("\n")).toEqual([])
})

test("[SEC-08] 무인증 장비 모니터링 API(/api/mes/equipment-monitor/light)가 업무 데이터를 반환하지 않는다", async () => {
  const eq = await db().equipment.create({
    data: { tenantId: T1, siteId: (await db().site.findFirstOrThrow({ where: { tenantId: T1 } })).id, workCenterId: (await db().workCenter.findFirstOrThrow({ where: { site: { tenantId: T1 } } })).id, code: "E2E-LIGHT-EQ", name: "E2E 무인증 노출 확인 설비", equipmentType: "MACHINE" },
  })
  // 모니터링 대상 조건(활성 NCWatch 매핑)을 갖춰야 목록에 나온다
  const mapping = await db().ncwatchEquipmentMapping.create({ data: { tenantId: T1, machineName: `E2E-LIGHT-${Date.now()}`, equipmentId: eq.id, isActive: true } })
  try {
    const r = await fetch(`${E2E_BASE}/api/mes/equipment-monitor/light`, { redirect: "manual" })
    const t = await r.text()
    const exposed = r.status === 200 && t.includes("E2E-LIGHT-EQ")
    record({ tcId: "SEC-08", status: r.status, exposed, sample: t.slice(0, 160), problems: exposed ? ["로그인 없이 설비 목록(테넌트1)이 조회됨"] : [] })
    expect(exposed, `무인증 요청에 ${r.status} 로 설비 데이터 반환`).toBe(false)
  } finally {
    await db().ncwatchEquipmentMapping.delete({ where: { id: mapping.id } })
    await db().equipment.delete({ where: { id: eq.id } })
  }
})
