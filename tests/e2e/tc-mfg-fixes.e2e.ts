/**
 * 제조 업무 결함 수정(N-02·N-04·N-07·N-09·N-10, S-09 중 createBom) 회귀·검증 스펙
 *  - 수정 전/후 동작을 DB 로 확인한다. 정상 업무(변경 없는 라우팅 재저장, 한쪽 한도만 있는 규격 등)가 막히지 않는지도 함께 본다.
 *  - 선행: seed-bomflow.ts(E2E-BR- 기준정보), seed-roles.ts(역할 계정 + 테넌트2 샘플). 로컬 테스트 DB 한정.
 *  - 생성 행은 E2E-BR- 접두사/품목 참조 기준으로 seed-bomflow.ts REMOVE=1 이 정리한다.
 */
import { test, expect, type Page } from "@playwright/test"
import { assertSafeE2eEnvironment, E2E_BASE } from "./guard"
import { login, gotoMenu, dialog, rowOf, openRowAction, collectDialogs } from "./tc-helpers"
import { db, loadData, uniq, record, submitBtn, settle, pickLabeled, dec } from "./support/bomflow-lib"
import { buildActionMap, apiLogin, roleCreds, type ActionInfo } from "./support/perm-lib"

assertSafeE2eEnvironment()

const D = loadData()
const FG = D.items.fg1
const RM1 = D.items.rm1
const RM2 = D.items.rm2
const WC1 = D.workCenters.wc1
const WC2 = D.workCenters.wc2
const T2 = "e2e-tenant-002"
const toPath = (key: string) => "/" + key.replace(/^app\//, "").replace(/\/page$/, "").split("/").filter((s) => !/^\(.*\)$/.test(s)).join("/")

async function post(cookie: string, pagePath: string, a: ActionInfo, args: unknown[]) {
  const r = await fetch(`${E2E_BASE}${pagePath}`, {
    method: "POST",
    headers: { "next-action": a.id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", cookie },
    body: JSON.stringify(args),
    redirect: "manual",
  })
  return { status: r.status, text: await r.text() }
}
let MAP: ActionInfo[] = []
const act = (name: string, fileRe: RegExp) => MAP.find((a) => a.name === name && a.files.some((f) => fileRe.test(f)))

let adminCookie = ""
test.beforeAll(async () => {
  const c = roleCreds("ADMIN")
  adminCookie = (await apiLogin(c.loginId, c.password)).cookie ?? ""
  if (!adminCookie) throw new Error("ADMIN 로그인 실패(seed-roles 확인)")
  for (const p of ["/app/mes/bom", "/app/mes/measurement"]) { try { await fetch(`${E2E_BASE}${p}`, { headers: { cookie: adminCookie } }) } catch { /* 계속 */ } }
  MAP = buildActionMap()
})
test.afterAll(async () => { await db.$disconnect() })

const mkRouting = (code: string, seqs: [number, number]) =>
  db.routing.create({
    data: {
      tenantId: D.tenantId, code, name: `${code} 검증용`, version: "1.0", status: "ACTIVE", scope: "COMMON",
      operations: { create: [
        { seq: seqs[0], operationCode: WC1.code, name: WC1.name, workCenterId: WC1.id, standardTime: 1 },
        { seq: seqs[1], operationCode: WC2.code, name: WC2.name, workCenterId: WC2.id, standardTime: 2 },
      ] },
    },
    include: { operations: { orderBy: { seq: "asc" } } },
  })

// ───────── N-07 ─────────
test("[N-07a] 순서값이 연속이 아닌 기존 라우팅(1,3)을 변경 없이 저장해도 공정이 그대로 유지된다", async ({ page }) => {
  const dialogs = collectDialogs(page)
  const code = `E2E-BR-RT-${uniq}-M1`
  const rt = await mkRouting(code, [1, 3])
  await login(page)
  await gotoMenu(page, "/app/mes/routing")
  await openRowAction(page, code, "수정")
  await expect(dialog(page)).toBeVisible()
  await submitBtn(page).click()
  await expect(dialog(page), `저장 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
  const after = await db.routing.findUnique({ where: { id: rt.id }, include: { operations: { orderBy: { seq: "asc" } } } })
  record("MFG-N07a", null, { seqs: after!.operations.map((o) => o.seq) })
  expect(after!.operations.map((o) => o.seq), "변경 없는 저장은 공정(순서값·ID)을 건드리지 않음").toEqual([1, 3])
  expect(after!.operations.map((o) => o.id)).toEqual(rt.operations.map((o) => o.id))
})

test("[N-07b] 공정 아래로 이동 → 순서가 바뀌어 저장되고 순서값은 1..n 으로 정리된다", async ({ page }) => {
  const dialogs = collectDialogs(page)
  const code = `E2E-BR-RT-${uniq}-M2`
  const rt = await mkRouting(code, [1, 2])
  await login(page)
  await gotoMenu(page, "/app/mes/routing")
  await openRowAction(page, code, "수정")
  await expect(dialog(page)).toBeVisible()
  await dialog(page).getByRole("button", { name: "공정 아래로 이동" }).first().click()
  await submitBtn(page).click()
  await expect(dialog(page), `저장 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
  const after = await db.routing.findUnique({ where: { id: rt.id }, include: { operations: { orderBy: { seq: "asc" } } } })
  record("MFG-N07b", null, { order: after!.operations.map((o) => [o.seq, o.workCenterId === WC1.id ? "WC1" : "WC2"]) })
  expect(after!.operations.map((o) => [o.seq, o.workCenterId])).toEqual([[1, WC2.id], [2, WC1.id]])
})

// ───────── N-09 / N-10 : 검사표준 ─────────
async function specWithHistory(tag: string) {
  const routing = await mkRouting(`E2E-BR-RT-${uniq}-${tag}`, [1, 2])
  const bom = await db.bOM.create({ data: { tenantId: D.tenantId, itemId: FG.id, version: `M-${tag}-${uniq}`, status: "DRAFT", isDefault: false, bomItems: { create: [{ componentItemId: RM1.id, seq: 1, qtyPer: 1, scrapRate: 0 }] } } })
  const wo = await db.workOrder.create({
    data: {
      tenantId: D.tenantId, siteId: D.site.id, itemId: FG.id, bomId: bom.id, routingId: routing.id, orderNo: `E2E-BR-WO-${uniq}-${tag}`, plannedQty: 1, status: "RELEASED",
      operations: { create: [{ routingOperationId: routing.operations[0].id, seq: 1, plannedQty: 1 }] },
    },
    include: { operations: true },
  })
  const spec = await db.inspectionSpec.create({
    data: {
      tenantId: D.tenantId, itemId: FG.id, routingOperationId: routing.operations[0].id, version: `MS-${tag}-${uniq}`, status: "ACTIVE",
      inspectionItems: { create: [{ seq: 10, name: "치수", inputType: "NUMERIC", lowerLimit: 1, upperLimit: 2, unit: "mm" }] },
    },
    include: { inspectionItems: true },
  })
  const cred = await db.userCredential.findFirstOrThrow({ where: { tenantId: D.tenantId, loginId: process.env.SEED_ADMIN_LOGIN_ID } })
  const qi = await db.qualityInspection.create({ data: { workOrderOperationId: wo.operations[0].id, inspectionSpecId: spec.id, inspectorId: cred.profileId, stage: "MID", result: "PASS", inspectedQty: 1 } })
  const it0 = spec.inspectionItems[0]
  await db.inspectionMeasurement.create({ data: { tenantId: D.tenantId, qualityInspectionId: qi.id, inspectionItemId: it0.id, numericValue: 1.5, lowerLimitSnapshot: 1, upperLimitSnapshot: 2, itemNameSnapshot: it0.name, inputTypeSnapshot: "NUMERIC", unitSnapshot: "mm", judgement: "PASS" } })
  return { spec, routing }
}
async function rowIcon(page: Page, text: string, which: "edit" | "delete") {
  const row = rowOf(page, text).first()
  await expect(row).toBeVisible({ timeout: 20_000 })
  const btns = row.getByRole("button")
  const n = await btns.count()
  await btns.nth(which === "edit" ? n - 2 : n - 1).click()
}

test("[N-09a] 측정 이력이 있는 검사표준: 버전만 바꾸면 저장되고, 검사항목까지 바꾸면 헤더 변경도 함께 롤백된다", async ({ page }) => {
  const dialogs = collectDialogs(page)
  const { spec } = await specWithHistory("M3")
  await login(page)
  await gotoMenu(page, "/app/mes/master/inspection-standards")
  // (1) 버전만 변경 → 항목은 그대로이므로 저장 성공
  await rowIcon(page, spec.version, "edit")
  await expect(dialog(page)).toBeVisible()
  await dialog(page).getByLabel("버전").fill(`${spec.version}R`)
  await submitBtn(page).click()
  await expect(dialog(page), `버전만 변경 저장 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
  const v1 = await db.inspectionSpec.findUnique({ where: { id: spec.id } })
  expect(v1!.version, "버전 변경 반영").toBe(`${spec.version}R`)
  // (2) 항목명까지 변경 → 측정 이력 때문에 거부 + 버전 변경도 롤백
  await settle(page)
  await rowIcon(page, `${spec.version}R`, "edit")
  await expect(dialog(page)).toBeVisible()
  await dialog(page).getByLabel("버전").fill(`${spec.version}X`)
  await dialog(page).getByPlaceholder("항목명").first().fill("치수(변경시도)")
  await submitBtn(page).click()
  await page.waitForTimeout(3000)
  if (await dialog(page).isVisible().catch(() => false)) await page.keyboard.press("Escape")
  const v2 = await db.inspectionSpec.findUnique({ where: { id: spec.id }, include: { inspectionItems: true } })
  record("MFG-N09a", null, { version: v2!.version, items: v2!.inspectionItems.map((i) => i.name), dialogs })
  expect(v2!.version, "항목 변경이 거부되면 헤더(버전)도 바뀌지 않음").toBe(`${spec.version}R`)
  expect(v2!.inspectionItems.map((i) => i.name)).toEqual(["치수"])
  expect(dialogs.filter((d) => d.startsWith("alert:")).join(" "), "측정 이력 안내").toMatch(/측정 이력/)
})

test("[N-10a] 한쪽 한도만 있는 규격·같은 값 규격은 허용되고, 수치가 아닌 항목의 한도는 비워진다", async ({ page }) => {
  const dialogs = collectDialogs(page)
  const routing = await mkRouting(`E2E-BR-RT-${uniq}-M4`, [1, 2])
  await login(page)
  await gotoMenu(page, "/app/mes/master/inspection-standards")
  await page.getByRole("button", { name: /검사표준 등록/ }).first().click()
  await expect(dialog(page)).toBeVisible()
  await pickLabeled(page, "품목", new RegExp(FG.code))
  await pickLabeled(page, "공정", new RegExp(`\\[${routing.code}\\].*seq\\.1\\)`))
  await dialog(page).getByLabel("버전").fill(`MN-${uniq}`)
  const rows: { name: string; lower?: string; upper?: string }[] = [{ name: "하한만", lower: "5" }, { name: "상한만", upper: "9" }, { name: "같은값", lower: "3", upper: "3" }]
  for (let i = 0; i < rows.length; i++) {
    await dialog(page).getByRole("button", { name: /항목 추가/ }).click()
    await dialog(page).getByPlaceholder("항목명").nth(i).fill(rows[i].name)
    if (rows[i].lower) await dialog(page).locator('input[type="number"]').nth(3 * i + 1).fill(rows[i].lower!)
    if (rows[i].upper) await dialog(page).locator('input[type="number"]').nth(3 * i + 2).fill(rows[i].upper!)
  }
  await submitBtn(page).click()
  await expect(dialog(page), `저장 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
  const spec = await db.inspectionSpec.findFirst({ where: { tenantId: D.tenantId, itemId: FG.id, version: `MN-${uniq}` }, include: { inspectionItems: { orderBy: { seq: "asc" } } } })
  expect(spec, "등록됨").not.toBeNull()
  expect(spec!.inspectionItems.map((i) => [i.name, i.lowerLimit === null ? null : dec(i.lowerLimit), i.upperLimit === null ? null : dec(i.upperLimit)])).toEqual([["하한만", 5, null], ["상한만", null, 9], ["같은값", 3, 3]])
})

test("[N-10b] 측정 화면 경로(upsertInspectionItems 직접 호출)도 하한 > 상한·순서 중복을 서버에서 거부한다", async () => {
  const { spec } = await specWithHistory("M5")
  // 측정 이력이 있는 표준이면 항목 교체 자체가 거부되므로, 이력 없는 표준을 별도로 만든다
  const routing = await mkRouting(`E2E-BR-RT-${uniq}-M6`, [1, 2])
  const clean = await db.inspectionSpec.create({ data: { tenantId: D.tenantId, itemId: FG.id, routingOperationId: routing.operations[0].id, version: `MC-${uniq}`, status: "DRAFT" } })
  const a = act("upsertInspectionItems", /quality\.actions/)
  expect(a, "액션 등록").toBeTruthy()
  const p = toPath(a!.pages.find((k) => /measurement|inspection-standards/.test(k)) ?? a!.pages[0])
  const bad = await post(adminCookie, p, a!, [clean.id, [{ seq: 10, name: "역전", inputType: "NUMERIC", lowerLimit: 10, upperLimit: 5, unit: "mm" }]])
  const dup = await post(adminCookie, p, a!, [clean.id, [{ seq: 10, name: "A", inputType: "NUMERIC" }, { seq: 10, name: "B", inputType: "NUMERIC" }]])
  const ok = await post(adminCookie, p, a!, [clean.id, [{ seq: 10, name: "정상", inputType: "NUMERIC", lowerLimit: 1, upperLimit: 2, unit: "mm" }]])
  const items = await db.inspectionItem.findMany({ where: { inspectionSpecId: clean.id } })
  record("MFG-N10b", null, { bad: bad.text.slice(0, 160), dup: dup.text.slice(0, 160), okStatus: ok.status, specIgnored: spec.id })
  expect(/하한|상한/.test(bad.text) && /\d+:E\{/.test(bad.text), "하한>상한 거부").toBe(true)
  expect(/중복/.test(dup.text) && /\d+:E\{/.test(dup.text), "순서 중복 거부").toBe(true)
  expect(items.map((i) => i.name), "정상 입력만 저장됨(거부된 요청은 항목을 바꾸지 않음)").toEqual(["정상"])
})

// ───────── N-02 / S-09(createBom) ─────────
test("[N-02] createBom/updateBom: 같은 구성자재 중복·자기 참조는 서버가 거부하고 정상 BOM 은 저장된다", async () => {
  const a = act("createBom", /bom\.actions/)
  const u = act("updateBom", /bom\.actions/)
  expect(a && u, "BOM 액션 등록").toBeTruthy()
  const p = toPath(a!.pages[0])
  const ver = (t: string) => `E2E-BR-${t}-${uniq}`
  const line = (id: string, seq: number, qty = 1) => ({ componentItemId: id, seq, qtyPer: qty, scrapRate: 0 })
  const dupRes = await post(adminCookie, p, a!, [{ itemId: FG.id, version: ver("DUP"), isDefault: false, status: "DRAFT", bomItems: [line(RM1.id, 1), line(RM1.id, 2, 4)] }])
  const selfRes = await post(adminCookie, p, a!, [{ itemId: FG.id, version: ver("SELF"), isDefault: false, status: "DRAFT", bomItems: [line(FG.id, 1)] }])
  const okRes = await post(adminCookie, p, a!, [{ itemId: FG.id, version: ver("OK"), isDefault: false, status: "DRAFT", bomItems: [line(RM1.id, 1), line(RM2.id, 2)] }])
  const exist = (v: string) => db.bOM.findFirst({ where: { tenantId: D.tenantId, itemId: FG.id, version: v }, include: { bomItems: true } })
  expect(await exist(ver("DUP")), `중복 구성자재 BOM 거부 (${dupRes.text.slice(0, 120)})`).toBeNull()
  expect(await exist(ver("SELF")), "자기 참조 BOM 거부").toBeNull()
  const good = await exist(ver("OK"))
  expect(good?.bomItems.length, `정상 BOM 은 저장됨 (${okRes.text.slice(0, 120)})`).toBe(2)
  // 수정 경로: 중복으로 바꾸려 하면 거부되고 기존 구성품은 그대로
  const upRes = await post(adminCookie, p, u!, [good!.id, { itemId: FG.id, version: ver("OK"), isDefault: false, status: "DRAFT", bomItems: [line(RM2.id, 1), line(RM2.id, 2)] }])
  const after = await exist(ver("OK"))
  record("MFG-N02", null, { dup: dupRes.text.slice(0, 200), up: upRes.text.slice(0, 200) })
  expect(after!.bomItems.map((b) => b.componentItemId).sort(), "수정 거부 시 기존 구성품 유지").toEqual([RM1.id, RM2.id].sort())
})

test("[S-09 일부] createBom: 다른 테넌트 소유 품목을 상위/구성자재로 지정하면 거부된다", async () => {
  const t2Fg = await db.item.findFirstOrThrow({ where: { tenantId: T2, code: "E2E-T2-FG" } })
  const t2Rm = await db.item.findFirstOrThrow({ where: { tenantId: T2, code: "E2E-T2-ITEM" } })
  const a = act("createBom", /bom\.actions/)!
  const p = toPath(a.pages[0])
  const v1 = `E2E-BR-X1-${uniq}`
  const v2 = `E2E-BR-X2-${uniq}`
  await post(adminCookie, p, a, [{ itemId: t2Fg.id, version: v1, isDefault: false, status: "DRAFT", bomItems: [{ componentItemId: RM1.id, seq: 1, qtyPer: 1, scrapRate: 0 }] }])
  await post(adminCookie, p, a, [{ itemId: FG.id, version: v2, isDefault: false, status: "DRAFT", bomItems: [{ componentItemId: t2Rm.id, seq: 1, qtyPer: 1, scrapRate: 0 }] }])
  const leaked1 = await db.bOM.findFirst({ where: { version: v1 } })
  const leaked2 = await db.bOM.findFirst({ where: { version: v2 } })
  record("MFG-S09-bom", null, { parentForeign: !!leaked1, componentForeign: !!leaked2 })
  if (leaked1) { await db.bOMItem.deleteMany({ where: { bomId: leaked1.id } }); await db.bOM.delete({ where: { id: leaked1.id } }) }
  if (leaked2) { await db.bOMItem.deleteMany({ where: { bomId: leaked2.id } }); await db.bOM.delete({ where: { id: leaked2.id } }) }
  expect(leaked1, "타 테넌트 품목을 상위 품목으로 한 BOM 이 생성되면 안 됨").toBeNull()
  expect(leaked2, "타 테넌트 품목을 구성자재로 한 BOM 이 생성되면 안 됨").toBeNull()
})
