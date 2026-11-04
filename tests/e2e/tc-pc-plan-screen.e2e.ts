/**
 * 2-C 생산계획 화면(등록·수정·목록·상세) 실제 Chrome(헤드리스) 검증 — 로컬 테스트 DB·로컬 서버 전용.
 * 화면 수량은 서버(2-A 조회 모델)·DB 값과 대조하고, 3개 화면 크기(1440×900, 1024×768, 768×1024)에서 잘림·가로 넘침을 확인한다.
 */
import { test, expect, type Page, type Locator } from "@playwright/test"
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
const RUN = Date.now().toString(36).toUpperCase()
let seq = 0
const PLAN_PAGE = "/app/mes/production-plan"

test.beforeAll(async () => {
  const a = adminCredentials(), d = developerCredentials()
  admin = (await apiLogin(a.loginId, a.password)).cookie ?? ""
  const dev = (await apiLogin(d.loginId, d.password)).cookie ?? ""
  await warm(dev, ["/app/mes/sales-orders", PLAN_PAGE, "/app/mes/work-orders", "/login"])
})
test.afterAll(async () => { await closeDb() })

// ───────────────────────── 데이터(실제 서버 액션) ─────────────────────────
async function mkSo(qty: number) {
  const r = await call(admin, A("createSalesOrder", /sales-order\.actions/), [T, D.site.id, { customerId: D.customer.id, orderDate: iso(new Date()), deliveryDate: iso(addDays(10)), status: "CONFIRMED", items: [{ itemId: D.items.fg.id, qty, unitPrice: 1, deliveryDate: iso(addDays(10)) }] }])
  expect(r.ok, r.error ?? "").toBe(true)
  const so = await db().salesOrder.findFirstOrThrow({ where: { tenantId: T }, orderBy: { createdAt: "desc" }, include: { items: true } })
  return { id: so.id, no: so.orderNo, itemId: so.items[0].id }
}
type So = Awaited<ReturnType<typeof mkSo>>
async function apiRequest(so: So, qty: number, over: { extraQty?: number; extraReason?: string } = {}) {
  const r = await call(admin, A("requestProductionFromSalesOrder", /sales-order\.actions/), [so.id, [{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty, ...over }], T, D.site.id, rid("pcb")])
  expect(okv(r), errOf(r)).toBe(true)
  return db().productionPlanItem.findFirstOrThrow({ where: { salesOrderItemId: so.itemId, plan: { planNo: r.value.planNo } }, include: { plan: true } })
}
async function apiStockPlan(qty: number, itemId = D.items.fg.id) {
  const tag = `E2E-PCB stock ${RUN}-${++seq}`
  const r = await call(admin, A("createPlan", /production-plan\.actions/), [{ siteId: D.site.id, planNo: "", planType: "DAILY", startDate: "2026-11-02", endDate: "2026-11-30", status: "DRAFT", note: tag, items: [{ itemId, bomId: itemId === D.items.fg.id ? D.bom.id : null, routingId: itemId === D.items.fg.id ? D.routing.id : null, plannedQty: qty, note: "안전재고" }] }, T])
  expect(okv(r), errOf(r)).toBe(true)
  return db().productionPlan.findFirstOrThrow({ where: { tenantId: T, note: tag }, include: { items: true } })
}
const rowsOf = (soItemId: string) => db().productionPlanItem.findMany({ where: { salesOrderItemId: soItemId }, include: { plan: true }, orderBy: { plan: { createdAt: "asc" } } })
async function apiUpdate(planId: string, over: { status?: string; items?: Record<string, unknown>[] }) {
  const p = await db().productionPlan.findUniqueOrThrow({ where: { id: planId }, include: { items: true } })
  const items = over.items ?? p.items.map((r) => ({ productionPlanItemId: r.id, itemId: r.itemId, bomId: r.bomId ?? D.bom.id, routingId: r.routingId ?? D.routing.id, plannedQty: num(r.plannedQty), ...(r.salesOrderItemId ? { salesOrderItemId: r.salesOrderItemId } : {}) }))
  return call(admin, A("updatePlan", /production-plan\.actions/), [planId, { siteId: p.siteId, planNo: p.planNo, planType: p.planType, startDate: "2026-11-02", endDate: "2026-11-30", status: over.status ?? p.status, note: p.note, items }])
}
async function createWo(rowId: string, qty: number, tag: string) {
  const r = await call(admin, A("createWorkOrder", /work-order\.actions/), [{
    siteId: D.site.id, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, orderNo: "", manufacturingNo: `E2E-PCB-${RUN}-${tag}`, plannedQty: qty, status: "DRAFT", dueDate: iso(addDays(14)), productionPlanItemId: rowId,
    operations: [{ routingOperationId: D.routing.ops[0], seq: 1, plannedQty: qty }, { routingOperationId: D.routing.ops[1], seq: 2, plannedQty: qty }],
  }, T])
  expect(r.value?.success, errOf(r)).toBe(true)
}

// ───────────────────────── 브라우저 도우미 ─────────────────────────
async function loginAs(page: Page, loginId: string, password: string) {
  await page.goto("/login")
  await page.getByRole("button", { name: /시스템모드/ }).click()
  await page.locator("#loginId").fill(loginId)
  await page.locator("#password").fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/app/, { timeout: 60_000 })
}
const loginAdmin = (page: Page) => { const c = adminCredentials(); return loginAs(page, c.loginId, c.password) }
/** 화면 이동 후 하이드레이션까지 기다린다(서버 렌더 직후 클릭이 무시되는 것을 막는다) */
async function gotoSalesOrders(page: Page) {
  await page.goto("/app/mes/sales-orders", { waitUntil: "domcontentloaded", timeout: 90_000 })
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {})
}
/** 시트·다이얼로그 슬라이드 애니메이션이 끝나 위치가 고정될 때까지 기다린다 */
const settle = (page: Page) => page.waitForTimeout(800)
async function gotoPlans(page: Page, q = "") {
  await page.goto(PLAN_PAGE + q, { waitUntil: "domcontentloaded", timeout: 90_000 })
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {})
}
async function findPlanRow(page: Page, planNo: string) {
  await page.locator('input[placeholder*="계획번호"]').fill(planNo)
  const row = page.locator("tbody tr", { hasText: planNo }).first()
  await expect(row, `행 ${planNo}`).toBeVisible({ timeout: 20_000 })
  return row
}
async function openRowMenu(page: Page, planNo: string, item: "수정" | "취소" | "삭제") {
  const row = await findPlanRow(page, planNo)
  await row.getByRole("button", { name: "메뉴 열기" }).click()
  await page.getByRole("menuitem", { name: item }).click()
}
async function openDetail(page: Page, planNo: string) {
  const row = await findPlanRow(page, planNo)
  await row.getByRole("button", { name: planNo }).click()
  await expect(page.getByTestId("plan-detail")).toBeVisible()
}
const val = async (loc: Locator) => (await loc.inputValue()).replace(/,/g, "")
const txt = async (page: Page, id: string) => (await page.getByTestId(id).first().innerText()).trim().replace(/,/g, "")
async function pickSelect(scope: Locator, page: Page, label: string | RegExp, option: string | RegExp) {
  await scope.getByLabel(label).first().click()
  await page.getByRole("option", { name: option }).first().click()
}
async function saveSheet(page: Page, name: "저장" | "등록") {
  await page.getByRole("button", { name, exact: true }).click()
}

// ───────────────────────── BT-01 STOCK 등록·조회 ─────────────────────────
test("[BT-01] 재고 생산(STOCK) 등록·조회 — 등록 화면에 유형 안내(수주 생산은 수주 처리 화면으로), 등록 후 목록·상세에 재고 생산·충당 0·수주 연결 없음", async ({ page }) => {
  await loginAdmin(page)
  await gotoPlans(page)
  await page.getByRole("button", { name: "생산계획 등록" }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByTestId("pf-kind-guide")).toBeVisible()
  await expect(sheet.getByTestId("pf-kind-stock")).toContainText("재고 생산 (선택됨)")
  await expect(sheet.getByTestId("pf-kind-order")).toContainText("수주 처리 화면의 생산의뢰에서 등록")
  await expect(sheet.getByTestId("pf-kind-extra")).toContainText("수주+여유 생산")
  await expect(sheet.getByRole("link", { name: /수주 처리 화면으로 이동/ })).toHaveAttribute("href", "/app/mes/sales-orders")
  await pickSelect(sheet, page, "공장", new RegExp(D.site.code))
  await sheet.locator('input[type="date"]').nth(0).fill("2026-11-03")
  await sheet.locator('input[type="date"]').nth(1).fill("2026-11-10")
  await sheet.getByTestId("pf-add-item").click()
  await sheet.getByTestId("pf-item-0").getByRole("combobox").first().click()
  await page.getByRole("listbox").getByText(D.items.fg.code).first().click()
  await sheet.getByTestId("pf-planned-input-0").fill("200")
  await sheet.getByTestId("pf-note-0").fill("안전재고 확보")
  await expect(sheet.getByTestId("pf-kind-0")).toHaveText("재고 생산")
  await saveSheet(page, "등록")
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 })
  // 계획번호는 서버가 부여한다(폼의 값은 미리보기) — 이 시험이 만든 계획을 줄 비고로 찾는다
  const plan = await db().productionPlan.findFirstOrThrow({ where: { tenantId: T, items: { some: { note: "안전재고 확보" } } }, orderBy: { createdAt: "desc" }, include: { items: true } })
  const planNo = plan.planNo
  expect([plan.status, plan.items[0].productionKind, num(plan.items[0].plannedQty), num(plan.items[0].allocatedQty), plan.items[0].salesOrderItemId, plan.items[0].note]).toEqual(["DRAFT", "STOCK", 200, 0, null, "안전재고 확보"])
  await gotoPlans(page)
  const row = await findPlanRow(page, planNo)
  await expect(row.getByTestId(`plan-kind-${planNo}`)).toHaveText("재고 생산")
  await expect(row.getByTestId(`plan-orders-${planNo}`)).toHaveCount(0)
  await expect(row.getByTestId(`plan-alloc-${planNo}`)).toHaveText("0")
  await expect(row.getByTestId(`plan-extra-${planNo}`)).toHaveText("0")
  await expect(row.getByTestId(`plan-planned-${planNo}`)).toHaveText("200")
  await openDetail(page, planNo)
  const itemId = plan.items[0].id
  await expect(page.getByTestId("detail-kind")).toHaveText("재고 생산")
  expect([await txt(page, `detail-alloc-${itemId}`), await txt(page, `detail-extra-${itemId}`), await txt(page, `detail-planned-${itemId}`)]).toEqual(["0", "0", "200"])
  await expect(page.getByTestId(`detail-item-${itemId}`)).toContainText("없음 (재고 생산)")
})

// ───────────────────────── BT-02/03 ORDER·ORDER_EXTRA 조회 ─────────────────────────
test("[BT-02][BT-03][BT-11b] 수주 생산(ORDER)·수주+여유 생산(ORDER_EXTRA) 목록·상세 — 충당·여유·계획 수량이 DB 와 일치, 여유 사유·승인 상태 표시(PENDING 은 승인 아님, 정책 미적용 안내)", async ({ page }) => {
  const s1 = await mkSo(100), s2 = await mkSo(100)
  const r1 = await apiRequest(s1, 100)
  const r2 = await apiRequest(s2, 100, { extraQty: 10, extraReason: "가공 불량 대비" })
  await db().productionPlanItem.update({ where: { id: r2.id }, data: { extraApprovalStatus: "PENDING" } })
  await loginAdmin(page)
  await gotoPlans(page)
  const n1 = r1.plan.planNo, n2 = r2.plan.planNo
  let row = await findPlanRow(page, n1)
  await expect(row.getByTestId(`plan-kind-${n1}`)).toHaveText("수주 생산")
  await expect(row.getByTestId(`plan-orders-${n1}`)).toContainText(s1.no)
  expect([await txt(page, `plan-alloc-${n1}`), await txt(page, `plan-extra-${n1}`), await txt(page, `plan-planned-${n1}`)]).toEqual(["100", "0", "100"])
  row = await findPlanRow(page, n2)
  await expect(row.getByTestId(`plan-kind-${n2}`)).toHaveText("수주+여유 생산")
  expect([await txt(page, `plan-alloc-${n2}`), await txt(page, `plan-extra-${n2}`), await txt(page, `plan-planned-${n2}`)]).toEqual(["100", "10", "110"])
  await expect(row.getByTestId(`plan-approval-${n2}`)).toHaveText("승인 대기")
  await openDetail(page, n2)
  await expect(page.getByTestId("detail-kind")).toHaveText("수주+여유 생산")
  expect([await txt(page, `detail-alloc-${r2.id}`), await txt(page, `detail-extra-${r2.id}`), await txt(page, `detail-planned-${r2.id}`)]).toEqual(["100", "10", "110"])
  await expect(page.getByTestId(`detail-reason-${r2.id}`)).toContainText("가공 불량 대비")
  await expect(page.getByTestId(`detail-approval-${r2.id}`)).toHaveText("승인 대기")
  await expect(page.getByTestId("detail-approval-notice")).toContainText("승인 정책은 아직 적용되지 않습니다")
  await expect(page.getByTestId("detail-approval-notice")).toContainText("승인 완료가 아닙니다")
  await expect(page.getByTestId(`detail-order-${r2.id}`)).toContainText(s2.no)
  // 서버(2-A 모델)와 화면 일치
  const q = await call(admin, A("getProductionPlanQuantities", /production-quantity\.actions/), [[r2.planId]], { pagePath: PLAN_PAGE })
  expect(okv(q), errOf(q)).toBe(true)
  expect([q.value[0].totals.allocatedQty, q.value[0].totals.extraQty, q.value[0].totals.plannedQty]).toEqual([100, 10, 110])
})

// ───────────────────────── BT-04 혼합 · BT-05 유형 필터 ─────────────────────────
test("[BT-04][BT-05] 혼합 유형 표시와 생산 유형 필터 — 한 계획에 수주 줄과 재고 줄이 있으면 '혼합', 필터가 유형별 계획만 남김", async ({ page }) => {
  const so = await mkSo(100)
  const order = await apiRequest(so, 100)
  const extraSo = await mkSo(100)
  const extra = await apiRequest(extraSo, 100, { extraQty: 5, extraReason: "필터 시험" })
  const stock = await apiStockPlan(50)
  const mixedUpdate = await apiUpdate(order.planId, { items: [
    { productionPlanItemId: order.id, salesOrderItemId: so.itemId, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, plannedQty: 100 },
    { itemId: D.items.rm1.id, plannedQty: 7 },
  ] })
  expect(okv(mixedUpdate), errOf(mixedUpdate)).toBe(true)
  await loginAdmin(page)
  await gotoPlans(page)
  await page.locator('input[placeholder*="계획번호"]').fill("")
  const kindOf = async (planNo: string) => (await (await findPlanRow(page, planNo)).getByTestId(`plan-kind-${planNo}`).getAttribute("data-kind"))
  expect(await kindOf(order.plan.planNo)).toBe("MIXED")
  expect(await (await findPlanRow(page, order.plan.planNo)).getByTestId(`plan-kind-${order.plan.planNo}`).innerText()).toBe("혼합")
  expect(await kindOf(extra.plan.planNo)).toBe("ORDER_EXTRA")
  expect(await kindOf(stock.planNo)).toBe("STOCK")
  // 필터
  await page.locator('input[placeholder*="계획번호"]').fill("")
  const pickKind = async (label: string) => {
    await page.getByRole("button", { name: /생산 유형/ }).click()
    await page.getByText(label, { exact: true }).last().click()
    await page.keyboard.press("Escape")
  }
  await pickKind("재고 생산")
  await expect(page.locator('[data-testid^="plan-kind-"]').first()).toBeVisible()
  const kinds = async () => Array.from(new Set(await page.locator('[data-testid^="plan-kind-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")))))
  expect(await kinds(), "재고 생산 필터").toEqual(["STOCK"])
  await pickKind("재고 생산") // 해제
  await pickKind("혼합")
  expect(await kinds(), "혼합 필터").toEqual(["MIXED"])
  await expect(page.locator("tbody tr", { hasText: order.plan.planNo })).toHaveCount(1)
  note("BT-05", { ok: true })
})

// ───────────────────────── BT-06 ~ BT-08 수정 ─────────────────────────
test("[BT-06][BT-07] 수정 — 충당 수량 변경(다른 계획 충당 존중), 여유 증가·감소와 사유 검증, 저장 후 화면·서버·DB 수량 일치", async ({ page }) => {
  const so = await mkSo(100)
  const a = await apiRequest(so, 40)
  const b = await apiRequest(so, 60)
  await loginAdmin(page)
  await gotoPlans(page)
  await openRowMenu(page, a.plan.planNo, "수정")
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByTestId("pf-order-0")).toContainText(so.no)
  expect(await sheet.locator("textarea").first().inputValue(), "비고에 내부 요청 ID 태그가 보이지 않음").not.toContain("[pr:")
  await expect(sheet.getByTestId("pf-max-0")).toContainText("이 줄에 충당 가능한 최대 40")
  await expect(sheet.getByTestId("pf-order-qty-0")).toContainText("다른 계획이 충당 60")
  expect([await val(sheet.getByTestId("pf-alloc-0")), await val(sheet.getByTestId("pf-extra-0")), await txt(page, "pf-planned-0")]).toEqual(["40", "0", "40"])
  // 최대 초과
  await sheet.getByTestId("pf-alloc-0").fill("41")
  await saveSheet(page, "저장")
  await expect(sheet.getByTestId("pf-errors-0")).toContainText("최대(40)")
  expect(num((await rowsOf(so.itemId))[0].allocatedQty), "거부 후 DB 불변").toBe(40)
  // 충당 30 + 여유 10, 사유 없음
  await sheet.getByTestId("pf-alloc-0").fill("30")
  await sheet.getByTestId("pf-extra-0").fill("10")
  expect(await txt(page, "pf-planned-0")).toBe("40")
  await expect(sheet.getByTestId("pf-kind-0")).toHaveText("수주+여유 생산")
  await saveSheet(page, "저장")
  await expect(sheet.getByTestId("pf-errors-0")).toContainText("여유 생산 사유를 입력")
  await sheet.getByTestId("pf-reason-0").fill("충당 일부 이전, 잔여는 불량 대비")
  await saveSheet(page, "저장")
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 })
  let ra = (await rowsOf(so.itemId))[0]
  expect([num(ra.plannedQty), num(ra.allocatedQty), ra.productionKind, ra.extraReason]).toEqual([40, 30, "ORDER_EXTRA", "충당 일부 이전, 잔여는 불량 대비"])
  expect((await db().productionPlan.findUniqueOrThrow({ where: { id: a.planId } })).note, "저장 후에도 요청 ID 태그 보존").toContain("[pr:")
  // 목록 값 = 서버 값 = DB
  await gotoPlans(page)
  const row = await findPlanRow(page, a.plan.planNo)
  await expect(row.getByTestId(`plan-kind-${a.plan.planNo}`)).toHaveText("수주+여유 생산")
  expect([await txt(page, `plan-alloc-${a.plan.planNo}`), await txt(page, `plan-extra-${a.plan.planNo}`), await txt(page, `plan-planned-${a.plan.planNo}`)]).toEqual(["30", "10", "40"])
  // 다시 열면 저장된 값이 그대로
  await openRowMenu(page, a.plan.planNo, "수정")
  expect([await val(page.getByTestId("pf-alloc-0")), await val(page.getByTestId("pf-extra-0")), await txt(page, "pf-planned-0")]).toEqual(["30", "10", "40"])
  await expect(page.getByTestId("pf-reason-0")).toHaveValue("충당 일부 이전, 잔여는 불량 대비")
  // 여유 증가 10 → 20 (사유 유지), 감소 → 0 (ORDER 복귀·사유 초기화)
  await page.getByTestId("pf-extra-0").fill("20")
  await saveSheet(page, "저장")
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 })
  ra = (await rowsOf(so.itemId))[0]
  expect([num(ra.plannedQty), num(ra.allocatedQty), ra.productionKind]).toEqual([50, 30, "ORDER_EXTRA"])
  await gotoPlans(page)
  await openRowMenu(page, a.plan.planNo, "수정")
  await page.getByTestId("pf-extra-0").fill("0")
  expect(await txt(page, "pf-planned-0")).toBe("30")
  await expect(page.getByTestId("pf-kind-0")).toHaveText("수주 생산")
  await expect(page.getByTestId("pf-reason-0")).toHaveCount(0)
  await saveSheet(page, "저장")
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 })
  ra = (await rowsOf(so.itemId))[0]
  expect([num(ra.plannedQty), num(ra.allocatedQty), ra.productionKind, ra.extraReason]).toEqual([30, 30, "ORDER", null])
  // B 계획은 그대로
  const rb = (await rowsOf(so.itemId))[1]
  expect([num(rb.plannedQty), num(rb.allocatedQty)]).toEqual([60, 60])
  expect(b.id).toBe(rb.id)
})

test("[BT-08][BT-14] 서버 수량 초과 거부와 오류 안내 — 화면이 낡았을 때 서버가 거부하면 시트가 열린 채 오류가 표시되고 DB 는 불변. 수주 처리 화면 수치와 일치", async ({ page }) => {
  const so = await mkSo(100)
  const a = await apiRequest(so, 30)
  await apiRequest(so, 40)
  await loginAdmin(page)
  await gotoPlans(page)
  await openRowMenu(page, a.plan.planNo, "수정") // 화면 기준 최대 60
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByTestId("pf-max-0")).toContainText("최대 60")
  await apiRequest(so, 30) // 다른 경로로 30 을 더 충당 → 서버 기준 최대 30
  await sheet.getByTestId("pf-alloc-0").fill("50")
  await saveSheet(page, "저장")
  await expect(sheet.getByTestId("pf-server-error")).toContainText("수주 충당 수량 초과", { timeout: 30_000 })
  await expect(sheet.getByTestId("pf-server-error")).toContainText("충당 가능 30")
  await expect(page.getByRole("dialog")).toHaveCount(1)
  expect(num((await rowsOf(so.itemId))[0].allocatedQty), "거부 후 DB 불변").toBe(30)
  await page.keyboard.press("Escape")
  // 수주 처리 화면의 수치와 계획 화면이 같은 서버 값을 본다
  await gotoSalesOrders(page)
  await page.getByPlaceholder("수주번호 검색...").fill(so.no)
  const orow = page.locator("tbody tr", { hasText: so.no }).first()
  await expect(orow).toBeVisible({ timeout: 20_000 })
  await orow.getByRole("button").last().click()
  await page.getByRole("menuitem", { name: /수주처리/ }).click()
  await expect(page.getByTestId(`qty-${so.itemId}-allocated`)).toHaveText("100")
  await expect(page.getByTestId(`qty-${so.itemId}-unallocated`)).toHaveText("0")
  await expect(page.getByTestId(`qty-${so.itemId}-planned`)).toHaveText("100")
})

test("[BT-09] 재고 생산 계획 수정 — 충당 입력 없이 계획 수량만 수정, 수주 연결·충당 0 유지, 삭제는 가능", async ({ page }) => {
  const plan = await apiStockPlan(80)
  await loginAdmin(page)
  await gotoPlans(page)
  await openRowMenu(page, plan.planNo, "수정")
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByTestId("pf-kind-0")).toHaveText("재고 생산")
  await expect(sheet.getByTestId("pf-alloc-0")).toHaveCount(0)
  await expect(sheet.getByTestId("pf-extra-0")).toHaveCount(0)
  await expect(sheet.getByTestId("pf-item-0")).toContainText("수주 연결 없음 · 충당 0")
  await expect(sheet.getByRole("button", { name: "품목 삭제" })).toBeVisible()
  await sheet.getByTestId("pf-planned-input-0").fill("120")
  await saveSheet(page, "저장")
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 })
  const r = (await db().productionPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { items: true } })).items[0]
  expect([num(r.plannedQty), num(r.allocatedQty), r.productionKind, r.salesOrderItemId]).toEqual([120, 0, "STOCK", null])
})

// ───────────────────────── BT-10 진행 중 · BT-11 상태 선택지 ─────────────────────────
test("[BT-10] 진행 중 계획 수정 제한 — 작업지시가 생기면 자동 진행중, 목록에 수정 메뉴가 없고 서버도 거부", async ({ page }) => {
  const plan = await apiStockPlan(30)
  expect(okv(await apiUpdate(plan.id, { status: "CONFIRMED" }))).toBe(true)
  await createWo(plan.items[0].id, 30, "BT10")
  expect((await db().productionPlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("IN_PROGRESS")
  await loginAdmin(page)
  await gotoPlans(page)
  const row = await findPlanRow(page, plan.planNo)
  await expect(row).toContainText("진행중")
  await expect(row.getByRole("button", { name: "메뉴 열기" })).toHaveCount(0)
  await expect(row.getByRole("link", { name: "작업지시" })).toBeVisible()
  const direct = await apiUpdate(plan.id, { items: [{ productionPlanItemId: plan.items[0].id, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, plannedQty: 99 }] })
  expect(okv(direct)).toBe(false)
  expect(errOf(direct)).toMatch(/수정할 수 없습니다/)
  expect(num((await db().productionPlanItem.findUniqueOrThrow({ where: { id: plan.items[0].id } })).plannedQty)).toBe(30)
})

test("[BT-11] 상태 선택지 — 등록·수정 화면에서 직접 고를 수 있는 상태는 초안·확정뿐이고 진행중·완료는 자동 변경 안내만 표시", async ({ page }) => {
  const plan = await apiStockPlan(15)
  await loginAdmin(page)
  await gotoPlans(page)
  const options = async (sheet: Locator) => {
    await sheet.getByLabel("상태").first().click()
    const names = await page.getByRole("option").allInnerTexts()
    await page.keyboard.press("Escape")
    return names.map((n) => n.trim())
  }
  await page.getByRole("button", { name: "생산계획 등록" }).click()
  expect(await options(page.getByRole("dialog"))).toEqual(["초안", "확정"])
  await expect(page.getByTestId("pf-status-guide")).toContainText("진행중·완료 상태는 작업지시와 POP 생산실적에 따라 자동으로 바뀝니다")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await openRowMenu(page, plan.planNo, "수정")
  expect(await options(page.getByRole("dialog"))).toEqual(["초안", "확정"])
})

// ───────────────────────── BT-12 권한 ─────────────────────────
test("[BT-12] 권한별 화면 — OPERATOR·VIEWER 는 조회만(등록 버튼·행 메뉴 없음, 유형·수량 표시), MANAGER 는 수정 가능, 수주 조회 권한이 없으면 수량 열은 '—'(유형은 표시)", async ({ browser }) => {
  const so = await mkSo(100)
  const r = await apiRequest(so, 100, { extraQty: 10, extraReason: "권한 시험" })
  const planNo = r.plan.planNo
  const ctx = async (role: "OPERATOR" | "VIEWER" | "MANAGER") => {
    const c = await browser.newContext({ baseURL: process.env.UI_BASE ?? "http://127.0.0.1:3130", viewport: { width: 1440, height: 900 } })
    const p = await c.newPage()
    const cr = roleCreds(role)
    await loginAs(p, cr.loginId, cr.password)
    await gotoPlans(p)
    return { c, p }
  }
  for (const role of ["OPERATOR", "VIEWER"] as const) {
    const { c, p } = await ctx(role)
    await expect(p.getByRole("button", { name: "생산계획 등록" })).toHaveCount(0)
    const row = await findPlanRow(p, planNo)
    await expect(row.getByTestId(`plan-kind-${planNo}`)).toHaveText("수주+여유 생산")
    expect([await txt(p, `plan-alloc-${planNo}`), await txt(p, `plan-extra-${planNo}`), await txt(p, `plan-planned-${planNo}`)]).toEqual(["100", "10", "110"])
    await expect(row.getByRole("button", { name: "메뉴 열기" })).toHaveCount(0)
    await c.close()
  }
  {
    const { c, p } = await ctx("MANAGER")
    await expect(p.getByRole("button", { name: "생산계획 등록" })).toBeVisible()
    await openRowMenu(p, planNo, "수정")
    await expect(p.getByTestId("pf-alloc-0")).toBeEnabled()
    await c.close()
  }
  const rp = await db().rolePermission.findMany({ where: { tenantId: T, role: "MANAGER", resource: "SALES_ORDER", action: "READ" } })
  await db().rolePermission.updateMany({ where: { id: { in: rp.map((x) => x.id) } }, data: { isAllowed: false } })
  try {
    const { c, p } = await ctx("MANAGER")
    const row = await findPlanRow(p, planNo)
    await expect(row.getByTestId(`plan-kind-${planNo}`)).toHaveText("수주+여유 생산") // 유형은 계획 줄 값으로 표시
    await expect(row.getByTestId(`plan-alloc-${planNo}`)).toHaveText("—")
    await expect(row.getByTestId(`plan-extra-${planNo}`)).toHaveText("—")
    await c.close()
  } finally {
    await db().rolePermission.updateMany({ where: { id: { in: rp.map((x) => x.id) } }, data: { isAllowed: rp[0].isAllowed } })
  }
})

// ───────────────────────── BT-15 반응형 ─────────────────────────
const SIZES = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "768x1024", width: 768, height: 1024 },
]
/** 페이지·다이얼로그가 가로로 넘치지 않고, 입력창·버튼이 화면 안에 있는지 */
async function expectFits(page: Page, scope: Locator | null, label: string, size: { width: number }) {
  await settle(page)
  const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  expect(doc.sw, `${label}: 페이지 가로 넘침`).toBeLessThanOrEqual(doc.iw + 1)
  if (!scope) return
  const box = await scope.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  expect(box.sw, `${label}: 패널 가로 넘침(scrollWidth ${box.sw} > clientWidth ${box.cw})`).toBeLessThanOrEqual(box.cw + 1)
  const items = scope.locator("input:visible, button:visible, [role=combobox]:visible, textarea:visible")
  const n = await items.count()
  const bad: string[] = []
  for (let i = 0; i < n; i++) {
    const b = await items.nth(i).boundingBox()
    if (!b) continue
    if (b.x < -1 || b.x + b.width > size.width + 1) bad.push(`${(await items.nth(i).getAttribute("data-testid")) ?? (await items.nth(i).innerText()).slice(0, 12)}@${Math.round(b.x)}+${Math.round(b.width)}`)
  }
  expect(bad, `${label}: 화면 밖으로 나간 요소 ${bad.join(", ")}`).toEqual([])
}
test("[BT-15] 반응형 — 1440×900·1024×768·768×1024 에서 목록·등록·수정·상세 시트와 수주 처리 다이얼로그가 잘리지 않는다", async ({ page }) => {
  const so = await mkSo(100)
  const linked = await apiRequest(so, 60, { extraQty: 10, extraReason: "반응형 시험" })
  await apiRequest(so, 40)
  const stock = await apiStockPlan(33)
  const results: Record<string, string> = {}
  await loginAdmin(page)
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height })
    // 목록
    await gotoPlans(page)
    await findPlanRow(page, linked.plan.planNo)
    await expectFits(page, null, `${size.name} 목록`, size)
    const tableBox = await page.locator("tbody").first().locator("xpath=ancestor::div[contains(@class,'overflow-x-auto')][1]").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    if (size.width >= 1024) {
      // 핵심 열(생산 유형·충당·여유·실제 계획수량)은 가로 스크롤 없이 화면 안에 보인다
      const no = linked.plan.planNo
      for (const id of [`plan-kind-${no}`, `plan-alloc-${no}`, `plan-extra-${no}`, `plan-planned-${no}`]) {
        const b = await page.getByTestId(id).boundingBox()
        expect(b && b.x >= 0 && b.x + b.width <= size.width + 1, `${size.name}: ${id} 가 스크롤 없이 보임`).toBe(true)
      }
    }
    results[`${size.name} 목록 표`] = `표 ${tableBox.sw}px / 영역 ${tableBox.cw}px (가로 스크롤 영역 안)`
    await page.screenshot({ path: `test-results/e2e/artifacts/pc-list-${size.name}.png` })
    // 수정 시트(수주 연결 줄)
    await openRowMenu(page, linked.plan.planNo, "수정")
    const sheet = page.getByRole("dialog")
    await expect(sheet.getByTestId("pf-alloc-0")).toBeVisible()
    await expectFits(page, sheet, `${size.name} 수정 시트`, size)
    await sheet.getByTestId("pf-reason-0").scrollIntoViewIfNeeded()
    await expectFits(page, sheet, `${size.name} 수정 시트(사유)`, size)
    await page.screenshot({ path: `test-results/e2e/artifacts/pc-edit-${size.name}.png` })
    await page.getByRole("button", { name: "취소", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    // 등록 시트
    await page.getByRole("button", { name: "생산계획 등록" }).click()
    const create = page.getByRole("dialog")
    await expect(create.getByTestId("pf-kind-guide")).toBeVisible()
    await create.getByTestId("pf-add-item").click()
    await expectFits(page, create, `${size.name} 등록 시트`, size)
    await page.screenshot({ path: `test-results/e2e/artifacts/pc-create-${size.name}.png` })
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    // 상세 시트
    await openDetail(page, linked.plan.planNo)
    await expectFits(page, page.getByTestId("plan-detail"), `${size.name} 상세 시트`, size)
    await page.screenshot({ path: `test-results/e2e/artifacts/pc-detail-${size.name}.png` })
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    // 재고 생산 수정 시트
    await openRowMenu(page, stock.planNo, "수정")
    await expectFits(page, page.getByRole("dialog"), `${size.name} 재고 생산 수정 시트`, size)
    await page.keyboard.press("Escape")
    // 수주 처리 다이얼로그(2-B)
    await gotoSalesOrders(page)
    await page.getByPlaceholder("수주번호 검색...").fill(so.no)
    const orow = page.locator("tbody tr", { hasText: so.no }).first()
    await expect(orow).toBeVisible({ timeout: 20_000 })
    await orow.getByRole("button").last().click()
    await page.getByRole("menuitem", { name: /수주처리/ }).click()
    await expect(page.getByTestId("qty-panel")).toBeVisible({ timeout: 30_000 })
    await expectFits(page, page.getByRole("dialog"), `${size.name} 수주 처리 다이얼로그`, size)
    await page.screenshot({ path: `test-results/e2e/artifacts/pc-so-dialog-${size.name}.png` })
    await page.keyboard.press("Escape")
    results[size.name] = "통과"
  }
  note("BT-15", { results })
})
