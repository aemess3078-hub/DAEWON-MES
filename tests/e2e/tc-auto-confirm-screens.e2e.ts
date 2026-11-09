/**
 * 수주 등록·생산계획 화면의 자동 확정 실제 Chrome(헤드리스) 검증 — 로컬 테스트 DB·로컬 서버 전용.
 *  - 수주 등록 화면에 상태 선택이 없고, 등록하면 CONFIRMED 로 저장되며 목록에 "확정" 으로 보인다.
 *  - 등록 직후 별도 확정 없이 수주 처리 화면에서 생산의뢰 → 생산계획이 확정으로 생기고 계획 화면에 "확정" 으로 보인다.
 *  - 생산계획 등록 화면에도 상태 선택이 없다(재고 생산계획은 등록 즉시 확정).
 *  - 기존 초안 수주·계획은 수정 화면에서 개별 확정할 수 있다.
 *  - 1440×900 / 1024×768 / 768×1024 에서 잘림·가로 넘침이 없고 스크린샷을 남긴다(test-results/e2e/auto-confirm-*.png).
 */
import { test, expect, type Page } from "@playwright/test"
import * as path from "node:path"
import { assertSafeE2eEnvironment, adminCredentials, developerCredentials } from "./guard"
import { apiLogin } from "./support/perm-lib"
import { loadData, db, closeDb, num, call, findAction, warm, iso, addDays, rid, legacyDraftSalesOrder, legacyDraftStockPlan } from "./support/o2s-lib"

assertSafeE2eEnvironment()
const D = loadData()
const T = D.tenantId
const RUN = Date.now().toString(36).toUpperCase()
const SHOTS = path.join(process.cwd(), "test-results", "e2e")
const A = (n: string, re: RegExp) => findAction(n, re)

let adminCookie = ""
test.beforeAll(async () => {
  const a = adminCredentials(), d = developerCredentials()
  adminCookie = (await apiLogin(a.loginId, a.password)).cookie ?? ""
  const dev = (await apiLogin(d.loginId, d.password)).cookie ?? ""
  await warm(dev, ["/app/mes/sales-orders", "/app/mes/production-plan", "/app/mes/work-orders", "/login"])
})
test.afterAll(async () => { await closeDb() })

async function login(page: Page) {
  const c = adminCredentials()
  await page.goto("/login")
  await page.getByRole("button", { name: /시스템모드/ }).click()
  await page.locator("#loginId").fill(c.loginId)
  await page.locator("#password").fill(c.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/app/, { timeout: 60_000 })
}
async function gotoMenu(page: Page, p: string) {
  await page.goto(p, { waitUntil: "domcontentloaded", timeout: 90_000 })
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {})
}
const noHorizontalOverflow = async (page: Page, label: string) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(over, `${label}: 가로 넘침`).toBeLessThanOrEqual(1)
}
async function findRow(page: Page, placeholder: string, key: string) {
  await page.getByPlaceholder(placeholder).fill(key)
  const row = page.locator("tbody tr", { hasText: key }).first()
  await expect(row, `행 ${key}`).toBeVisible({ timeout: 20_000 })
  return row
}

test("[SC-01] 수주 등록 화면 — 상태 선택 없음·등록하면 확정(DB·목록), 등록 직후 별도 확정 없이 생산의뢰 → 확정 생산계획이 계획 화면에 표시", async ({ page }) => {
  const consoleErrors: string[] = []
  page.on("pageerror", (e) => consoleErrors.push(String(e)))
  await login(page)
  await gotoMenu(page, "/app/mes/sales-orders")
  await page.getByRole("button", { name: "수주 등록" }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByText("수주 등록").first()).toBeVisible()
  await page.waitForTimeout(800)
  // 상태 선택(초안·확정 등) 항목이 없고, 자동 확정 안내만 있다
  await expect(sheet.getByLabel("상태")).toHaveCount(0)
  await expect(sheet.getByTestId("so-status-auto")).toContainText("확정")
  await expect(sheet.getByTestId("so-status-auto")).toContainText("등록하면 바로 확정됩니다")
  await expect(sheet.getByRole("option", { name: "초안" })).toHaveCount(0)
  await sheet.getByRole("combobox").first().click() // 고객사(수주 폼의 Select 는 라벨과 연결되어 있지 않아 순서로 찾는다)
  await page.getByRole("option", { name: new RegExp(D.customer.code) }).first().click()
  await sheet.locator('input[type="date"]').nth(1).fill("2026-12-20")
  await sheet.getByRole("button", { name: /품목 추가/ }).click()
  await sheet.getByText("품목 선택").first().click()
  await page.getByRole("option", { name: new RegExp(D.items.fg.code) }).first().click()
  await sheet.locator("input.text-right").first().fill("77")
  await page.screenshot({ path: path.join(SHOTS, "auto-confirm-so-create.png") })
  await noHorizontalOverflow(page, "수주 등록 시트")
  const before = await db().salesOrder.count({ where: { tenantId: T } })
  await page.getByRole("button", { name: "등록", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 })
  expect(await db().salesOrder.count({ where: { tenantId: T } }), "수주 1건 등록").toBe(before + 1)
  const so = await db().salesOrder.findFirstOrThrow({ where: { tenantId: T }, orderBy: { createdAt: "desc" }, include: { items: true } })
  expect([so.status, num(so.items[0].qty)], "화면에서 등록한 수주는 CONFIRMED").toEqual(["CONFIRMED", 77])
  // 목록에 확정으로 표시
  await gotoMenu(page, "/app/mes/sales-orders")
  const row = await findRow(page, "수주번호 검색...", so.orderNo)
  await expect(row).toContainText("확정")
  await expect(row).not.toContainText("초안")
  await page.screenshot({ path: path.join(SHOTS, "auto-confirm-so-list.png") })
  // 별도 확정 작업 없이 바로 수주 처리 → 생산의뢰
  await row.getByRole("button").last().click()
  await page.getByRole("menuitem", { name: /수주처리/ }).click()
  const dlg = page.getByRole("dialog")
  await expect(dlg.getByText("수주 처리")).toBeVisible()
  await expect(page.getByTestId("pr-form")).toBeVisible({ timeout: 30_000 })
  await page.getByTestId(`pr-alloc-${so.items[0].id}`).fill("77")
  await page.screenshot({ path: path.join(SHOTS, "auto-confirm-so-process.png") })
  await page.getByTestId("pr-submit").click()
  await expect(page.getByTestId("pr-success")).toBeVisible({ timeout: 30_000 })
  const planNo = (await page.getByTestId("pr-success-planno").first().innerText()).trim()
  const plan = await db().productionPlan.findFirstOrThrow({ where: { tenantId: T, planNo }, include: { items: true } })
  expect([plan.status, plan.items[0].productionKind, num(plan.items[0].plannedQty)], "생산의뢰로 생긴 계획은 확정").toEqual(["CONFIRMED", "ORDER", 77])
  expect((await db().salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status, "수주는 기존 정책대로 생산중").toBe("IN_PRODUCTION")
  // 계획 화면에서 확정으로 보인다
  await gotoMenu(page, "/app/mes/production-plan")
  const prow = await findRow(page, "계획번호", planNo)
  await expect(prow).toContainText("확정")
  await expect(prow).not.toContainText("초안")
  await page.screenshot({ path: path.join(SHOTS, "auto-confirm-plan-list.png") })
  expect(consoleErrors, "페이지 오류 없음").toEqual([])
})

test("[SC-02] 생산계획 등록 화면(재고 생산) — 상태 선택 없음·등록하면 확정, 수정 화면은 기존 초안 개별 확정 경로(초안·확정) 유지", async ({ page }) => {
  await login(page)
  await gotoMenu(page, "/app/mes/production-plan")
  await page.getByRole("button", { name: "생산계획 등록" }).click()
  const sheet = page.getByRole("dialog")
  await page.waitForTimeout(800)
  await expect(sheet.getByTestId("pf-status")).toHaveCount(0)
  await expect(sheet.getByLabel("상태")).toHaveCount(0)
  await expect(sheet.getByTestId("pf-status-auto")).toContainText("등록하면 바로 확정되어 작업지시를 만들 수 있습니다")
  await expect(sheet.getByTestId("pf-status-guide")).toContainText("진행중·완료 상태는 작업지시와 POP 생산실적에 따라 자동으로 바뀝니다")
  await sheet.getByLabel("공장").first().click()
  await page.getByRole("option", { name: new RegExp(D.site.code) }).first().click()
  await sheet.locator('input[type="date"]').nth(0).fill("2026-11-03")
  await sheet.locator('input[type="date"]').nth(1).fill("2026-11-10")
  await sheet.getByTestId("pf-add-item").click()
  await sheet.getByTestId("pf-item-0").getByRole("combobox").first().click()
  await page.getByRole("listbox").getByText(D.items.fg.code).first().click()
  await sheet.getByTestId("pf-planned-input-0").fill("33")
  await sheet.getByTestId("pf-note-0").fill(`자동확정 화면 ${RUN}`)
  await page.screenshot({ path: path.join(SHOTS, "auto-confirm-plan-create.png") })
  await noHorizontalOverflow(page, "생산계획 등록 시트")
  await page.getByRole("button", { name: "등록", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 })
  const plan = await db().productionPlan.findFirstOrThrow({ where: { tenantId: T, items: { some: { note: `자동확정 화면 ${RUN}` } } }, include: { items: true } })
  expect([plan.status, plan.items[0].productionKind, num(plan.items[0].plannedQty)], "화면에서 등록한 재고 생산계획은 CONFIRMED").toEqual(["CONFIRMED", "STOCK", 33])
  // 확정 계획에서 바로 작업지시 화면의 확정 계획 목록으로 연결(작업지시 자동 생성 없음)
  expect(await db().workOrder.count({ where: { productionPlanItemId: plan.items[0].id } })).toBe(0)
})

test("[SC-03] 기존 초안 수주·생산계획 — 목록에 초안으로 보이고 수정 화면에서 개별 확정할 수 있다(등록 화면과 달리 상태 선택 노출)", async ({ page }) => {
  const legSo = await legacyDraftSalesOrder(D, 14)
  const legPlan = await legacyDraftStockPlan(D, 9, `E2E-SC legacy ${RUN}`)
  await login(page)
  // 수주
  await gotoMenu(page, "/app/mes/sales-orders")
  const soRow = await findRow(page, "수주번호 검색...", legSo.no)
  await expect(soRow, "기존 초안 수주는 초안으로 조회").toContainText("초안")
  await soRow.getByRole("button").last().click()
  await page.getByRole("menuitem", { name: "수정" }).click()
  const sheet = page.getByRole("dialog")
  await page.waitForTimeout(800)
  await expect(sheet.getByTestId("so-status-auto")).toHaveCount(0)
  await sheet.getByRole("combobox").nth(1).click() // 고객사 다음이 상태
  expect((await page.getByRole("option").allInnerTexts()).map((s) => s.trim())).toEqual(["초안", "확정", "취소"])
  await page.getByRole("option", { name: "확정" }).click()
  await page.screenshot({ path: path.join(SHOTS, "auto-confirm-so-edit-legacy.png") })
  await page.getByRole("button", { name: "저장", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 })
  expect((await db().salesOrder.findUniqueOrThrow({ where: { id: legSo.id } })).status, "초안 수주 개별 확정").toBe("CONFIRMED")
  // 생산계획
  await gotoMenu(page, "/app/mes/production-plan")
  const pRow = await findRow(page, "계획번호", legPlan.planNo)
  await expect(pRow, "기존 초안 계획은 초안으로 조회").toContainText("초안")
  await pRow.getByRole("button", { name: "메뉴 열기" }).click()
  await page.getByRole("menuitem", { name: "수정" }).click()
  await page.waitForTimeout(800)
  await expect(page.getByTestId("pf-status")).toBeVisible()
  await page.getByRole("dialog").getByLabel("상태").first().click()
  await page.getByRole("option", { name: "확정" }).click()
  await page.getByRole("button", { name: "저장", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 })
  expect((await db().productionPlan.findUniqueOrThrow({ where: { id: legPlan.id } })).status, "초안 계획 개별 확정").toBe("CONFIRMED")
})

for (const vp of [{ w: 1440, h: 900 }, { w: 1024, h: 768 }, { w: 768, h: 1024 }]) {
  test(`[SC-04] 화면 크기 ${vp.w}×${vp.h} — 수주 등록·생산계획 등록 시트가 잘리거나 가로로 넘치지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h })
    await login(page)
    await gotoMenu(page, "/app/mes/sales-orders")
    await page.getByRole("button", { name: "수주 등록" }).click()
    await page.waitForTimeout(800)
    const sheet = page.getByRole("dialog")
    await expect(sheet.getByTestId("so-status-auto")).toBeVisible()
    const box = await sheet.getByTestId("so-status-auto").boundingBox()
    expect(box && box.x >= 0 && box.x + box.width <= vp.w, "자동 확정 안내가 화면 안에 있음").toBe(true)
    await noHorizontalOverflow(page, `수주 등록 ${vp.w}`)
    await page.screenshot({ path: path.join(SHOTS, `auto-confirm-so-create-${vp.w}.png`) })
    await page.keyboard.press("Escape")
    await gotoMenu(page, "/app/mes/production-plan")
    await page.getByRole("button", { name: "생산계획 등록" }).click()
    await page.waitForTimeout(800)
    await expect(page.getByTestId("pf-status-auto")).toBeVisible()
    await noHorizontalOverflow(page, `생산계획 등록 ${vp.w}`)
    await page.screenshot({ path: path.join(SHOTS, `auto-confirm-plan-create-${vp.w}.png`) })
  })
}

test("[SC-05] 수주 수정 화면 — 후속 업무가 없는 확정 수주는 품목·수량을 수정하고(줄 납기·비고·헤더 비고 보존), 생산의뢰 후에는 품목 입력이 잠기고 사유가 표시된다", async ({ page }) => {
  await warm(adminCookie, ["/app/mes/sales-orders"])
  const created = await call(adminCookie, findAction("createSalesOrder", /sales-order\.actions/), [T, D.site.id, { customerId: D.customer.id, orderDate: iso(new Date()), deliveryDate: iso(addDays(20)), note: "초기 비고", items: [{ itemId: D.items.fg.id, qty: 40, unitPrice: 9, deliveryDate: iso(addDays(15)), note: "줄 비고" }] }])
  expect(created.ok, created.error ?? "").toBe(true)
  const so = await db().salesOrder.findFirstOrThrow({ where: { tenantId: T }, orderBy: { createdAt: "desc" }, include: { items: true } })
  expect(so.status).toBe("CONFIRMED")
  await login(page)
  await gotoMenu(page, "/app/mes/sales-orders")
  let row = await findRow(page, "수주번호 검색...", so.orderNo)
  await row.getByRole("button").last().click()
  await page.getByRole("menuitem", { name: "수정" }).click()
  let sheet = page.getByRole("dialog")
  await page.waitForTimeout(800)
  await expect(sheet.getByTestId("so-item-locked")).toHaveCount(0)
  await expect(sheet.getByRole("button", { name: /품목 추가/ })).toBeVisible()
  const qty = sheet.locator("input.text-right").first()
  await expect(qty).toBeEnabled()
  await qty.fill("55")
  await page.screenshot({ path: path.join(SHOTS, "auto-confirm-so-edit-confirmed.png") })
  await page.getByRole("button", { name: "저장", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 })
  const edited = await db().salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: true } })
  expect([edited.status, edited.items.length, edited.items[0].id, num(edited.items[0].qty), num(edited.items[0].unitPrice)], "수량만 바뀌고 줄 ID·단가·상태 유지").toEqual(["CONFIRMED", 1, so.items[0].id, 55, 9])
  expect([edited.note, edited.items[0].note, edited.items[0].deliveryDate?.toISOString().slice(0, 10)], "헤더 비고·줄 비고·줄 납기 보존").toEqual(["초기 비고", "줄 비고", so.items[0].deliveryDate?.toISOString().slice(0, 10)])
  // 생산의뢰 후에는 품목 잠금
  const rq = await call(adminCookie, findAction("requestProductionFromSalesOrder", /sales-order\.actions/), [so.id, [{ salesOrderItemId: so.items[0].id, itemId: D.items.fg.id, qty: 55 }], T, D.site.id, rid("sc05")])
  expect(rq.ok && rq.value?.ok, rq.error ?? "").toBeTruthy()
  await gotoMenu(page, "/app/mes/sales-orders")
  row = await findRow(page, "수주번호 검색...", so.orderNo)
  await row.getByRole("button").last().click()
  await page.getByRole("menuitem", { name: "수정" }).click()
  sheet = page.getByRole("dialog")
  await page.waitForTimeout(800)
  await expect(sheet.getByTestId("so-item-locked")).toContainText(rq.value.planNo)
  await expect(sheet.getByTestId("so-item-locked")).toContainText("품목·수량을 수정할 수 없습니다")
  await expect(sheet.locator("input.text-right").first()).toBeDisabled()
  await expect(sheet.getByRole("button", { name: /품목 추가/ })).toHaveCount(0)
  await page.screenshot({ path: path.join(SHOTS, "auto-confirm-so-edit-locked.png") })
  await noHorizontalOverflow(page, "수주 수정 시트(잠금)")
})
