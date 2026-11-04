/**
 * 2-B 수주 처리 화면(생산의뢰: 수주 충당 + 여유 생산) 검증 — 로컬 테스트 DB·로컬 서버 전용.
 *  - HTTP: 실제 로그인 세션 쿠키로 2-A 조회 서버 액션 호출(화면이 사용하기 시작해 서버 액션 목록에 등록됨)
 *  - 브라우저: 실제 Chrome(헤드리스)으로 수주 처리 다이얼로그 조작, 화면 수량 ↔ 서버(HTTP)·DB 직접 대조
 */
import { test, expect, type Page } from "@playwright/test"
import { assertSafeE2eEnvironment, adminCredentials, developerCredentials } from "./guard"
import { apiLogin, roleCreds } from "./support/perm-lib"
import { loadData, logDetail, db, closeDb, num, call, findAction, warm, rid, iso, addDays } from "./support/o2s-lib"

assertSafeE2eEnvironment()
const D = loadData()
const T = D.tenantId
let admin = ""
const A = (n: string, re: RegExp) => findAction(n, re)
const note = (id: string, o: Record<string, unknown>) => logDetail({ id, ...o })
const okv = (r: { ok: boolean; value: any }) => r.ok && r.value?.ok !== false && r.value?.success !== false
const errOf = (r: { value: any; error: string | null }) => String(r.value?.error ?? r.error ?? "")
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

test.beforeAll(async () => {
  const a = adminCredentials(), d = developerCredentials()
  admin = (await apiLogin(a.loginId, a.password)).cookie ?? ""
  const dev = (await apiLogin(d.loginId, d.password)).cookie ?? ""
  await warm(dev, ["/app/mes/sales-orders", "/app/mes/production-plan", "/app/mes/shipments", "/login"])
})
test.afterAll(async () => { await closeDb() })

// ───────────────────────── 데이터 ─────────────────────────
async function mkSo(qty: number) {
  const r = await call(admin, A("createSalesOrder", /sales-order\.actions/), [T, D.site.id, { customerId: D.customer.id, orderDate: iso(new Date()), deliveryDate: iso(addDays(10)), status: "CONFIRMED", items: [{ itemId: D.items.fg.id, qty, unitPrice: 1, deliveryDate: iso(addDays(10)) }] }])
  expect(r.ok, r.error ?? "").toBe(true)
  const so = await db().salesOrder.findFirstOrThrow({ where: { tenantId: T }, orderBy: { createdAt: "desc" }, include: { items: true } })
  return { id: so.id, no: so.orderNo, itemId: so.items[0].id }
}
type So = Awaited<ReturnType<typeof mkSo>>
const apiRequest = (so: So, qty: number, over: { extraQty?: number; extraReason?: string } = {}) =>
  call(admin, A("requestProductionFromSalesOrder", /sales-order\.actions/), [so.id, [{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty, ...over }], T, D.site.id, rid("sd")])
const apiReq = async (so: So, qty: number, over: { extraQty?: number; extraReason?: string } = {}) => { const r = await apiRequest(so, qty, over); expect(okv(r), errOf(r)).toBe(true); return r }
const rowsOf = (soItemId: string) => db().productionPlanItem.findMany({ where: { salesOrderItemId: soItemId }, include: { plan: true }, orderBy: { plan: { createdAt: "asc" } } })
let seq = 0
async function seedFgBalance(status: "ACTIVE" | "QUARANTINE", qty: number) {
  const lot = await db().lot.create({ data: { tenantId: T, itemId: D.items.fg.id, lotNo: `E2E-SD-${Date.now().toString(36).toUpperCase()}-${++seq}`, status } })
  await db().inventoryBalance.create({ data: { tenantId: T, siteId: D.site.id, itemId: D.items.fg.id, lotId: lot.id, warehouseId: D.warehouses.fg.id, qtyOnHand: qty, qtyAvailable: qty, qtyHold: 0 } })
  await db().inventoryTransaction.create({ data: { tenantId: T, itemId: D.items.fg.id, lotId: lot.id, toLocationId: D.warehouses.fg.id, txNo: `${lot.lotNo}-RCV`, txType: "RECEIPT", qty, refType: "E2E_FIXTURE", refId: lot.lotNo } })
}
const apiQuantities = async (cookie: string | null, soId: string) =>
  call(cookie, A("getSalesOrderProductionQuantities", /production-quantity\.actions/), [soId], { pagePath: "/app/mes/sales-orders" })

// ───────────────────────── 브라우저 도우미 ─────────────────────────
// (tc-helpers 는 저장소에 없는 313TC 엑셀을 읽으므로 쓰지 않고 필요한 로그인·이동만 이 파일에 둔다)
async function gotoMenu(page: Page, p: string) {
  await page.goto(p, { waitUntil: "domcontentloaded", timeout: 90_000 })
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {})
}
const login = async (page: Page) => { const c = adminCredentials(); await loginAs(page, c.loginId, c.password) }
async function loginAs(page: Page, loginId: string, password: string) {
  await page.goto("/login")
  await page.getByRole("button", { name: /시스템모드/ }).click()
  await page.locator("#loginId").fill(loginId)
  await page.locator("#password").fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/app/, { timeout: 60_000 })
}
async function openProcessDialog(page: Page, orderNo: string) {
  await gotoMenu(page, "/app/mes/sales-orders")
  await page.getByPlaceholder("수주번호 검색...").fill(orderNo)
  const row = page.locator("tbody tr", { hasText: orderNo }).first()
  await expect(row, `행 ${orderNo}`).toBeVisible({ timeout: 20_000 })
  await row.getByRole("button").last().click()
  await page.getByRole("menuitem", { name: /수주처리/ }).click()
  const dlg = page.getByRole("dialog")
  await expect(dlg.getByText("수주 처리")).toBeVisible()
  return dlg
}
const text = async (page: Page, testId: string) => ((await page.getByTestId(testId).first().innerText()).trim())
const numOf = (t: string) => Number(t.replace(/,/g, "").split("~")[0].replace(/[^\d.\-]/g, ""))
/** 화면 수량 ↔ 서버(HTTP) 조회 값 대조 */
async function expectScreenMatchesServer(page: Page, so: So) {
  const r = await apiQuantities(admin, so.id)
  expect(okv(r), errOf(r)).toBe(true)
  const v = r.value.items[0]
  const id = so.itemId
  const f = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 6 })
  const rng = (a: number, b: number, exact: boolean) => (exact || a === b ? f(a) : `${f(a)}~${f(b)}`)
  await expect(page.getByTestId(`qty-${id}-ordered`)).toHaveText(f(v.orderedQty))
  await expect(page.getByTestId(`qty-${id}-shipped`)).toHaveText(f(v.shippedQty))
  await expect(page.getByTestId(`qty-${id}-outstanding`)).toHaveText(f(v.outstandingQty))
  await expect(page.getByTestId(`qty-${id}-allocated`)).toHaveText(f(v.allocatedQty))
  await expect(page.getByTestId(`qty-${id}-unallocated`)).toHaveText(f(v.unallocatedQty))
  await expect(page.getByTestId(`qty-${id}-pending`)).toHaveText(rng(v.pendingAllocatedReceipt.minQty, v.pendingAllocatedReceipt.maxQty, v.pendingAllocatedReceipt.exact))
  await expect(page.getByTestId(`qty-${id}-shippable`)).toHaveText(f(v.stock.shippableQty))
  await expect(page.getByTestId(`qty-${id}-review`)).toHaveText(rng(v.shortage.proposed.shortageMinQty, v.shortage.proposed.shortageMaxQty, v.shortage.proposed.exact))
  await expect(page.getByTestId(`qty-${id}-extra`)).toHaveText(f(v.extraQty))
  await expect(page.getByTestId(`qty-${id}-planned`)).toHaveText(f(v.plannedQty))
  return v
}

// ───────────────────────── SD-01 HTTP ─────────────────────────
test("[SD-01] 서버 액션 HTTP — 실제 로그인 세션으로 2-A 조회 액션 호출, 값은 DB 와 일치, 비로그인·위조 쿠키·권한 제한 거부", async () => {
  const so = await mkSo(100)
  await apiReq(so, 40, { extraQty: 5, extraReason: "HTTP 시험" })
  const r = await apiQuantities(admin, so.id)
  expect(okv(r), errOf(r)).toBe(true)
  const v = r.value.items[0]
  const rows = await rowsOf(so.itemId)
  expect([v.orderedQty, v.allocatedQty, v.plannedQty, v.extraQty, v.unallocatedQty, v.salesOrderItemId]).toEqual([100, num(rows[0].allocatedQty), num(rows[0].plannedQty), 5, 60, so.itemId])
  expect([v.allocatedQty, v.plannedQty]).toEqual([40, 45])
  expect(v.pendingAllocatedReceipt).toEqual({ minQty: 40, maxQty: 40, exact: true })
  expect(v.lines[0]).toMatchObject({ productionKind: "ORDER_EXTRA", extraReason: "HTTP 시험", approval: { status: "NOT_REQUIRED", approved: false, policyApplied: false } })
  // 기존 부족수량 액션은 그대로(같은 응답의 legacy 값과 일치)
  const legacy = await call(admin, A("checkInventoryForSalesOrder", /sales-order\.actions/), [so.id, T], { pagePath: "/app/mes/sales-orders" })
  expect(okv(legacy), errOf(legacy)).toBe(true)
  expect([legacy.value[0].remainingQty, legacy.value[0].availableStock, legacy.value[0].shortageQty]).toEqual([v.shortage.legacy.remainingQty, v.shortage.legacy.availableStock, v.shortage.legacy.shortageQty])
  // 계획 화면용 액션도 같은 세션으로 호출 가능
  const pq = await call(admin, A("getProductionPlanQuantities", /production-quantity\.actions/), [[rows[0].planId]], { pagePath: "/app/mes/sales-orders" })
  expect(okv(pq), errOf(pq)).toBe(true)
  expect(pq.value[0].lines[0]).toMatchObject({ plannedQty: 45, allocatedQty: 40, extraQty: 5 })
  // 거부: 비로그인
  const anon = await apiQuantities(null, so.id)
  expect(okv(anon), "비로그인").toBe(false)
  // 거부: 위조 쿠키
  const forged = await apiQuantities("nmes-session=forged.token.value", so.id)
  expect(okv(forged), "위조 쿠키").toBe(false)
  // VIEWER: 읽기 권한이 있으므로 같은 값
  const vr = roleCreds("VIEWER")
  const vk = (await apiLogin(vr.loginId, vr.password)).cookie
  const viewerRes = await apiQuantities(vk, so.id)
  expect(okv(viewerRes), errOf(viewerRes)).toBe(true)
  expect(viewerRes.value.items[0].allocatedQty).toBe(40)
  // 권한 제한: PRODUCTION_PLAN READ 를 끄면 거부, 복원하면 다시 허용
  const rp = await db().rolePermission.findMany({ where: { tenantId: T, role: "VIEWER", resource: "PRODUCTION_PLAN", action: "READ" } })
  await db().rolePermission.updateMany({ where: { id: { in: rp.map((x) => x.id) } }, data: { isAllowed: false } })
  try { expect(okv(await apiQuantities(vk, so.id)), "PRODUCTION_PLAN READ 없음").toBe(false) }
  finally { await db().rolePermission.updateMany({ where: { id: { in: rp.map((x) => x.id) } }, data: { isAllowed: rp[0].isAllowed } }) }
  expect(okv(await apiQuantities(vk, so.id)), "복원 후").toBe(true)
})

// ───────────────────────── SD-02 화면 로딩·수량 표시 ─────────────────────────
test("[SD-02] 화면 — 수주 처리 다이얼로그가 정상 로딩되고, 표시 수량이 서버(HTTP)·DB 와 일치하며, 기존 부족수량은 참고, 재고 예약 없음·승인 정책 미적용·차이 원인을 안내한다", async ({ page }) => {
  await seedFgBalance("ACTIVE", 10); await seedFgBalance("QUARANTINE", 25)
  const so = await mkSo(100)
  await apiReq(so, 40, { extraQty: 5, extraReason: "화면 표시 시험" })
  const rows = await rowsOf(so.itemId)
  await db().productionPlanItem.update({ where: { id: rows[0].id }, data: { extraApprovalStatus: "PENDING" } })
  const errs: string[] = []
  page.on("pageerror", (e) => errs.push(e.message))
  await login(page)
  const dlg = await openProcessDialog(page, so.no)
  await expect(page.getByTestId("qty-panel")).toBeVisible({ timeout: 30_000 })
  const v = await expectScreenMatchesServer(page, so)
  // DB 직접 대조
  expect([v.allocatedQty, v.plannedQty, v.extraQty, v.unallocatedQty]).toEqual([num(rows[0].allocatedQty), num(rows[0].plannedQty), num(rows[0].plannedQty) - num(rows[0].allocatedQty), 100 - num(rows[0].allocatedQty)])
  // 안내 문구
  await expect(page.getByTestId("qty-no-reservation")).toContainText("재고 예약 기능이 없습니다")
  await expect(page.getByTestId(`qty-${so.itemId}-legacy`)).toContainText("기존 화면 부족수량(참고)")
  const reasons = page.getByTestId(`qty-${so.itemId}-reasons`)
  await expect(reasons).toContainText("이미 생산계획에 충당했지만 아직 입고되지 않은 수량")
  await expect(reasons).toContainText("격리·보류·만료·소진 LOT")
  // 승인 상태: PENDING 은 '승인 대기' 이며 승인 완료로 표시하지 않는다. 정책 미적용 안내
  await expect(page.getByTestId(`qty-approval-${rows[0].id}`)).toHaveText("승인 대기")
  await expect(page.getByTestId("qty-approval-notice")).toContainText("승인 정책은 아직 적용되지 않습니다")
  await expect(page.getByTestId("qty-approval-notice")).toContainText("승인 완료가 아닙니다")
  // 기존 재고 현황 표(참고)는 그대로 존재
  await expect(dlg.getByText("품목별 재고 현황")).toBeVisible()
  await expect(dlg.getByText("부족수량", { exact: true })).toBeVisible()
  expect(errs, "페이지 오류 없음").toEqual([])
  note("SD-02", { review: await text(page, `qty-${so.itemId}-review`), shippable: await text(page, `qty-${so.itemId}-shippable`), legacy: await text(page, `qty-${so.itemId}-legacy`) })
  await page.screenshot({ path: "test-results/e2e/artifacts/sd-02-dialog.png", fullPage: false })
})

// ───────────────────────── SD-03 입력 검증 ─────────────────────────
test("[SD-03] 화면 — 충당·여유·사유 입력 검증: 초과·사유 누락·여유만 입력 거부, 충당 60 + 여유 10 = 계획 70(ORDER_EXTRA), 여유 0 = ORDER", async ({ page }) => {
  const so = await mkSo(100)
  await apiReq(so, 40)
  await login(page)
  await openProcessDialog(page, so.no)
  await expect(page.getByTestId("pr-form")).toBeVisible({ timeout: 30_000 })
  const id = so.itemId
  await expect(page.getByTestId(`pr-max-${id}`)).toHaveText("추가 충당 가능 60")
  const alloc = page.getByTestId(`pr-alloc-${id}`), extra = page.getByTestId(`pr-extra-${id}`), submit = page.getByTestId("pr-submit")
  // 충당 > 추가 충당 가능량
  await alloc.fill("61")
  await expect(page.getByTestId(`pr-errors-${id}`)).toContainText("추가 충당 가능량(60)을 초과")
  await expect(submit).toBeDisabled()
  // 충당 60, 여유 10, 사유 없음
  await alloc.fill("60"); await extra.fill("10")
  await expect(page.getByTestId(`pr-errors-${id}`)).toContainText("여유 생산 사유를 입력")
  await expect(submit).toBeDisabled()
  await expect(page.getByTestId(`pr-planned-${id}`)).toHaveText("—")
  // 사유 입력 → 실제 생산계획 수량 70, ORDER_EXTRA
  await page.getByTestId(`pr-reason-${id}`).fill("가공 불량 대비")
  await expect(page.getByTestId(`pr-planned-${id}`)).toHaveText("70")
  await expect(page.getByTestId(`pr-kind-${id}`)).toContainText("ORDER_EXTRA")
  await expect(submit).toBeEnabled()
  await page.getByTestId("pr-form").screenshot({ path: "test-results/e2e/artifacts/sd-03-form.png" })
  // 여유 0 → ORDER
  await extra.fill("0")
  await expect(page.getByTestId(`pr-planned-${id}`)).toHaveText("60")
  await expect(page.getByTestId(`pr-kind-${id}`)).toContainText("(ORDER)")
  await expect(page.getByTestId(`pr-reason-${id}`)).toHaveCount(0)
  // 충당 0 + 여유만 → 거부하고 재고 생산 경로 안내
  await alloc.fill(""); await extra.fill("5"); await page.getByTestId(`pr-reason-${id}`).fill("재고 확보")
  await expect(page.getByTestId(`pr-errors-${id}`)).toContainText("재고 생산")
  await expect(submit).toBeDisabled()
  // 음수·소수 7자리
  await alloc.fill("-1")
  await expect(page.getByTestId(`pr-errors-${id}`)).toContainText("숫자")
  await alloc.fill("1.1234567")
  await expect(page.getByTestId(`pr-errors-${id}`)).toContainText("숫자")
  expect((await rowsOf(so.itemId)).length, "입력 검증 중 서버 요청 없음").toBe(1)
})

// ───────────────────────── SD-04 성공 ─────────────────────────
test("[SD-04] 화면 — 충당 60 + 여유 10(사유) 생산의뢰 성공: 생산계획 70(ORDER_EXTRA)·수주 상태 생산중, 화면 수량이 서버·DB 값으로 갱신, 서버 한도는 화면을 우회해도 유지", async ({ page }) => {
  const so = await mkSo(100)
  await apiReq(so, 40)
  await login(page)
  await openProcessDialog(page, so.no)
  const id = so.itemId
  await expect(page.getByTestId("pr-form")).toBeVisible({ timeout: 30_000 })
  await page.getByTestId(`pr-alloc-${id}`).fill("60")
  await page.getByTestId(`pr-extra-${id}`).fill("10")
  await page.getByTestId(`pr-reason-${id}`).fill("가공 불량 대비")
  await page.getByTestId("pr-submit").click()
  await expect(page.getByTestId("pr-success")).toBeVisible({ timeout: 30_000 })
  const planNo = await text(page, "pr-success-planno")
  const rows = await rowsOf(so.itemId)
  expect(rows.length).toBe(2)
  const created = rows.find((r) => r.plan.planNo === planNo)!
  expect([num(created.plannedQty), num(created.allocatedQty), created.productionKind, created.extraReason, created.extraApprovalStatus, created.plan.status]).toEqual([70, 60, "ORDER_EXTRA", "가공 불량 대비", "NOT_REQUIRED", "DRAFT"])
  expect((await db().salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("IN_PRODUCTION")
  // 성공 후 화면 수량이 서버 값으로 갱신(충당 100, 미충당 0, 계획 110, 여유 10)
  const v = await expectScreenMatchesServer(page, so)
  expect([v.allocatedQty, v.unallocatedQty, v.plannedQty, v.extraQty]).toEqual([100, 0, 110, 10])
  await expect(page.getByTestId("pr-all-allocated")).toBeVisible()
  await expect(page.getByTestId(`pr-alloc-${id}`)).toHaveCount(0)
  // 화면을 우회한 직접 호출도 서버가 거부(N-14·N-19 유지)
  const over = await apiRequest(so, 1)
  expect(okv(over), "충당 잔량 0 에 추가 충당").toBe(false)
  expect(errOf(over)).toMatch(/가능 잔량 0/)
  expect((await rowsOf(so.itemId)).length).toBe(2)
})

// ───────────────────────── SD-05 요청 ID ─────────────────────────
/** 생산의뢰 서버 액션 POST(요청 ID 를 담은 요청)만 수집 */
function watchRequests(page: Page) {
  const ids: string[] = []
  page.on("request", (req) => {
    if (req.method() !== "POST" || !req.headers()["next-action"]) return
    const m = UUID.exec(req.postData() ?? "")
    if (m) ids.push(m[0])
  })
  return ids
}

test("[SD-05a] 요청 ID — 같은 요청 더블클릭은 서버 요청 1건·계획 1건", async ({ page }) => {
  const so = await mkSo(100)
  const ids = watchRequests(page)
  await login(page)
  await openProcessDialog(page, so.no)
  const id = so.itemId
  await expect(page.getByTestId("pr-form")).toBeVisible({ timeout: 30_000 })
  await page.getByTestId(`pr-alloc-${id}`).fill("30")
  await page.getByTestId("pr-submit").dblclick()
  await expect(page.getByTestId("pr-success")).toBeVisible({ timeout: 30_000 })
  expect(ids.length, "서버로 간 생산의뢰 요청 수").toBe(1)
  expect((await rowsOf(so.itemId)).length, "생성된 계획 수").toBe(1)
})

test("[SD-05b] 요청 ID — 응답이 유실된 네트워크 재시도: 같은 요청 ID 로 재전송되고 서버는 중복 계획 없이 처음 결과를 돌려준다", async ({ page }) => {
  const so = await mkSo(100)
  const ids = watchRequests(page)
  await login(page)
  await openProcessDialog(page, so.no)
  const id = so.itemId
  await expect(page.getByTestId("pr-form")).toBeVisible({ timeout: 30_000 })
  await page.getByTestId(`pr-alloc-${id}`).fill("30")
  await page.getByTestId(`pr-extra-${id}`).fill("5")
  await page.getByTestId(`pr-reason-${id}`).fill("네트워크 재시도 시험")
  let lose = true
  await page.route("**/*", async (route) => {
    const req = route.request()
    if (lose && req.method() === "POST" && req.headers()["next-action"] && UUID.test(req.postData() ?? "")) {
      lose = false
      await route.fetch() // 서버는 처리한다
      await route.abort("failed") // 응답은 브라우저에 도착하지 않는다
      return
    }
    await route.continue()
  })
  await page.getByTestId("pr-submit").click()
  await expect(page.getByTestId("pr-error")).toContainText("응답을 확인하지 못했습니다", { timeout: 30_000 })
  expect((await rowsOf(so.itemId)).length, "서버는 이미 처리함").toBe(1)
  await page.getByTestId("pr-submit").click() // 같은 입력으로 재시도
  await expect(page.getByTestId("pr-success")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId("pr-success")).toContainText("중복 생성 없음")
  expect(ids.length).toBe(2)
  expect(ids[0], "재시도는 같은 요청 ID").toBe(ids[1])
  const rows = await rowsOf(so.itemId)
  expect(rows.length, "계획은 1건뿐").toBe(1)
  expect([num(rows[0].plannedQty), num(rows[0].allocatedQty)]).toEqual([35, 30])
  expect(await text(page, "pr-success-planno")).toBe(rows[0].plan.planNo)
})

test("[SD-05c] 요청 ID — 서버가 거부한 뒤 같은 입력의 재시도는 같은 ID, 입력을 바꾸면 새 ID, 성공 후 다음 의뢰는 또 새 ID", async ({ page }) => {
  const so = await mkSo(100)
  const ids = watchRequests(page)
  await login(page)
  await openProcessDialog(page, so.no)
  const id = so.itemId
  await expect(page.getByTestId("pr-form")).toBeVisible({ timeout: 30_000 })
  // 화면이 낡은 상태가 되도록 다른 경로로 80 을 먼저 충당(서버 기준 추가 충당 가능 20)
  await apiReq(so, 80)
  await page.getByTestId(`pr-alloc-${id}`).fill("50")
  await page.getByTestId("pr-submit").click()
  await expect(page.getByTestId("pr-error")).toContainText("생산의뢰 수량 초과", { timeout: 30_000 })
  await page.getByTestId("pr-submit").click() // 같은 입력 재시도
  await expect(page.getByTestId("pr-error")).toContainText("생산의뢰 수량 초과")
  expect(ids.length).toBe(2)
  expect(ids[0], "같은 입력의 재시도는 같은 ID").toBe(ids[1])
  await page.getByTestId(`pr-alloc-${id}`).fill("20") // 입력 변경
  await page.getByTestId("pr-submit").click()
  await expect(page.getByTestId("pr-success")).toBeVisible({ timeout: 30_000 })
  expect(ids.length).toBe(3)
  expect(ids[2], "입력이 바뀌면 새 ID").not.toBe(ids[1])
  expect((await rowsOf(so.itemId)).length, "거부된 요청은 계획을 만들지 않음 (API 80 + 화면 20)").toBe(2)
  expect((await rowsOf(so.itemId)).reduce((s, r) => s + num(r.allocatedQty), 0)).toBe(100)
})

test("[SD-05d] 요청 ID — 성공 후 같은 값으로 다시 의뢰하면 새 요청 ID 로 새 계획이 만들어진다", async ({ page }) => {
  const so = await mkSo(100)
  const ids = watchRequests(page)
  await login(page)
  await openProcessDialog(page, so.no)
  const id = so.itemId
  await expect(page.getByTestId("pr-form")).toBeVisible({ timeout: 30_000 })
  await page.getByTestId(`pr-alloc-${id}`).fill("30")
  await page.getByTestId("pr-submit").click()
  await expect(page.getByTestId("pr-success")).toBeVisible({ timeout: 30_000 })
  const first = await text(page, "pr-success-planno")
  await expect(page.getByTestId(`pr-max-${id}`)).toHaveText("추가 충당 가능 70", { timeout: 30_000 })
  await page.getByTestId(`pr-alloc-${id}`).fill("30") // 같은 값
  await page.getByTestId("pr-submit").click()
  await expect(page.getByTestId("pr-success-planno")).not.toHaveText(first, { timeout: 30_000 })
  expect(ids.length).toBe(2)
  expect(ids[1], "성공 후에는 새 ID").not.toBe(ids[0])
  const rows = await rowsOf(so.itemId)
  expect([rows.length, rows.reduce((s, r) => s + num(r.allocatedQty), 0)]).toEqual([2, 60])
})

// ───────────────────────── SD-06 권한 ─────────────────────────
test("[SD-06] 권한별 화면 — OPERATOR(수주 수정 O, 생산계획 등록 X): 수량 조회 가능·생산의뢰 불가 / VIEWER: 처리 메뉴 없음 / MANAGER: 전체 가능 / 생산계획 조회 권한 제거 시 수량 현황만 안내(권한 완화 없음)", async ({ browser }) => {
  const so = await mkSo(100)
  await apiReq(so, 40)
  const ctx = async (role: "OPERATOR" | "VIEWER" | "MANAGER") => {
    const c = await browser.newContext({ baseURL: process.env.UI_BASE ?? "http://127.0.0.1:3130", viewport: { width: 1440, height: 900 } })
    const p = await c.newPage()
    const cr = roleCreds(role)
    await loginAs(p, cr.loginId, cr.password)
    return { c, p }
  }
  // OPERATOR
  {
    const { c, p } = await ctx("OPERATOR")
    await openProcessDialog(p, so.no)
    await expect(p.getByTestId("qty-panel")).toBeVisible({ timeout: 30_000 })
    await expect(p.getByTestId("pr-no-permission")).toBeVisible()
    await expect(p.getByTestId(`pr-alloc-${so.itemId}`)).toBeDisabled()
    await expect(p.getByTestId("pr-submit")).toBeDisabled()
    await c.close()
  }
  // VIEWER: 수주 처리 메뉴 자체가 없다
  {
    const { c, p } = await ctx("VIEWER")
    await gotoMenu(p, "/app/mes/sales-orders")
    await p.getByPlaceholder("수주번호 검색...").fill(so.no)
    const row = p.locator("tbody tr", { hasText: so.no }).first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    // 행에는 상세보기 버튼 정도만 있고 처리 메뉴(수주처리)는 어떤 경로로도 열리지 않는다
    if (await row.getByRole("button").count()) await row.getByRole("button").last().click()
    await expect(p.getByRole("menuitem", { name: /수주처리/ })).toHaveCount(0)
    await expect(p.getByText("수주 처리", { exact: true })).toHaveCount(0)
    await c.close()
  }
  // MANAGER
  {
    const { c, p } = await ctx("MANAGER")
    await openProcessDialog(p, so.no)
    await expect(p.getByTestId("pr-form")).toBeVisible({ timeout: 30_000 })
    await expect(p.getByTestId(`pr-alloc-${so.itemId}`)).toBeEnabled()
    await expect(p.getByTestId("pr-no-permission")).toHaveCount(0)
    await c.close()
  }
  // MANAGER 의 생산계획 조회 권한을 임시로 제거: 수량 현황 대신 안내, 기존 재고 표·출하는 그대로
  const rp = await db().rolePermission.findMany({ where: { tenantId: T, role: "MANAGER", resource: "PRODUCTION_PLAN", action: "READ" } })
  expect(rp.length).toBeGreaterThan(0)
  await db().rolePermission.updateMany({ where: { id: { in: rp.map((x) => x.id) } }, data: { isAllowed: false } })
  try {
    const { c, p } = await ctx("MANAGER")
    const dlg = await openProcessDialog(p, so.no)
    await expect(p.getByTestId("qty-error")).toContainText("권한", { timeout: 30_000 })
    await expect(p.getByTestId("qty-panel")).toHaveCount(0)
    await expect(p.getByTestId("pr-form")).toHaveCount(0)
    await expect(dlg.getByText("품목별 재고 현황")).toBeVisible()
    await c.close()
  } finally {
    await db().rolePermission.updateMany({ where: { id: { in: rp.map((x) => x.id) } }, data: { isAllowed: rp[0].isAllowed } })
  }
})

// ───────────────────────── SD-07 권한 정책 점검 ─────────────────────────
test("[SD-07] 권한 정책 점검 — 생산의뢰가 가능한 역할(수주 수정 + 생산계획 등록)은 모두 수량 조회에 필요한 두 조회 권한(수주 조회 + 생산계획 조회)도 가지고 있다", async () => {
  const rows = await db().rolePermission.findMany({ where: { tenantId: T, isAllowed: true, resource: { in: ["SALES_ORDER", "PRODUCTION_PLAN"] } } })
  const has = (role: string, res: string, act: string) => rows.some((r) => r.role === role && r.resource === res && r.action === act)
  const matrix: Record<string, Record<string, boolean>> = {}
  for (const role of ["ADMIN", "MANAGER", "OPERATOR", "VIEWER"]) {
    matrix[role] = {
      "SALES_ORDER:READ": has(role, "SALES_ORDER", "READ"), "SALES_ORDER:UPDATE": has(role, "SALES_ORDER", "UPDATE"),
      "PRODUCTION_PLAN:READ": has(role, "PRODUCTION_PLAN", "READ"), "PRODUCTION_PLAN:CREATE": has(role, "PRODUCTION_PLAN", "CREATE"),
    }
    const canRequest = matrix[role]["SALES_ORDER:UPDATE"] && matrix[role]["PRODUCTION_PLAN:CREATE"]
    const canView = matrix[role]["SALES_ORDER:READ"] && matrix[role]["PRODUCTION_PLAN:READ"]
    matrix[role].canRequest = canRequest; matrix[role].canView = canView
    if (canRequest) expect(canView, `${role}: 생산의뢰는 가능한데 수량 조회 권한이 없음`).toBe(true)
  }
  note("SD-07", { matrix })
})
