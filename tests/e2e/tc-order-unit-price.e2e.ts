/**
 * 수주 등록/수정 화면 총금액 ↔ 단가 자동 계산 검증 — 로컬 격리 테스트 DB·로컬 서버 전용.
 *  - 브라우저(headless Chrome)로 수주 등록/수정 다이얼로그를 조작한다.
 *  - 저장 후에는 격리 테스트 DB 를 직접 조회해 총금액·수량·단가가 그대로 남았는지 대조한다.
 *  - 데이터는 seed-o2s.ts 가 만든 E2E-OS- 마스터(고객사·품목)만 사용한다.
 */
import { test, expect, type Page, type Locator } from "@playwright/test"
import * as fs from "node:fs"
import * as path from "node:path"
import { assertSafeE2eEnvironment, adminCredentials } from "./guard"
import { db, closeDb } from "./support/o2s-lib"

assertSafeE2eEnvironment()

type Data = {
  tenantId: string
  site: { id: string }
  customer: { id: string; code: string }
  items: { fg: { id: string; code: string }; rm1: { id: string; code: string } }
}
const D: Data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "test-results/e2e/o2s-data.json"), "utf8").replace(/^﻿/, ""))
const T = D.tenantId

const DELIVERY = "2027-03-31"
let uiCreated = 0

test.afterAll(async () => {
  await closeDb()
})

// ───────────── 공용 도우미 ─────────────

async function login(page: Page) {
  const c = adminCredentials()
  await page.goto("/login")
  await page.getByRole("button", { name: /시스템모드/ }).click()
  await page.locator("#loginId").fill(c.loginId)
  await page.locator("#password").fill(c.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/app/, { timeout: 60_000 })
}

async function openSalesOrders(page: Page) {
  await page.goto("/app/mes/sales-orders", { waitUntil: "domcontentloaded", timeout: 90_000 })
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {})
}

/** 수주 등록 다이얼로그를 열고 고객사·납기일을 채운다 */
async function openCreateDialog(page: Page): Promise<Locator> {
  await openSalesOrders(page)
  await page.getByRole("button", { name: /^수주 등록$/ }).click()
  const dlg = page.getByRole("dialog")
  await expect(dlg.getByText("새로운 수주를 등록합니다.")).toBeVisible({ timeout: 20_000 })
  await dlg.getByRole("combobox").first().click()
  await page.getByRole("option", { name: new RegExp(D.customer.code) }).click()
  await dlg.locator('input[type="date"]').nth(1).fill(DELIVERY)
  return dlg
}

/** 품목 행을 추가하고 지정 품목(code)을 선택한다. 추가되는 행은 항상 마지막 행이다. */
async function addItemRow(page: Page, dlg: Locator, code: string = D.items.fg.code) {
  await dlg.getByRole("button", { name: /품목 추가/ }).click()
  const trigger = dlg.getByRole("combobox").filter({ hasText: "품목 선택" }).first()
  await trigger.click()
  await page.getByRole("option", { name: new RegExp(code) }).click()
  await expect(dlg.getByRole("combobox").filter({ hasText: "품목 선택" })).toHaveCount(0, { timeout: 10_000 })
}

/** 행 i 의 수량/단가 입력 (행당 수량 input 다음에 단가 input 이 온다) */
const qtyInput = (dlg: Locator, i: number) => dlg.locator("input.tabular-nums").nth(i * 2)
const priceInput = (dlg: Locator, i: number) => dlg.locator("input.tabular-nums").nth(i * 2 + 1)
const totalInput = (dlg: Locator) => dlg.getByPlaceholder("0", { exact: true })

async function setTotal(dlg: Locator, v: string) {
  await totalInput(dlg).fill(v)
}
async function setQty(dlg: Locator, i: number, v: string) {
  await qtyInput(dlg, i).fill(v)
}
async function setPrice(dlg: Locator, i: number, v: string) {
  await priceInput(dlg, i).fill(v)
}

/** 다이얼로그에서 발생한 브라우저 확인창을 기록하고, answer 값으로 응답한다 */
function trackDialogs(page: Page) {
  const seen: string[] = []
  const state = { answer: "dismiss" as "accept" | "dismiss" }
  page.on("dialog", async (d) => {
    seen.push(d.message())
    if (state.answer === "accept") await d.accept()
    else await d.dismiss()
  })
  return { seen, state }
}

const orderCount = () => db().salesOrder.count({ where: { tenantId: T } })

// DB 조회: 이번 실행에서 가장 최근에 만든 수주 (테스트 후 확인용)
async function latestOrder(minCreatedAt: Date) {
  const so = await db().salesOrder.findFirst({
    where: { tenantId: T, createdAt: { gte: minCreatedAt } },
    orderBy: { createdAt: "desc" },
    include: { items: { orderBy: { id: "asc" } } },
  })
  if (!so) throw new Error("이번 실행에서 생성된 수주가 없습니다")
  return so
}
const toNum = (d: unknown) => (d === null || d === undefined ? null : Number(d))

// ───────────── 시나리오 ─────────────

test.describe.serial("수주 단가 자동 계산 (UI + 격리 DB)", () => {
  test("로그인 화면 → 로그인 정상", async ({ page }) => {
    await login(page)
    await expect(page).toHaveURL(/\/app/)
  })

  test("1·2·3: 총금액 먼저 → 수량 입력 시 단가 자동 계산 / 수량 먼저 → 총금액 입력 시에도 동일 / 수량 변경 시 재계산", async ({ page }) => {
    await login(page)

    // 1) 총금액 먼저 — 수량은 비어 있으므로 단가는 계산되지 않는다
    let dlg = await openCreateDialog(page)
    await addItemRow(page, dlg)
    await expect(qtyInput(dlg, 0)).toHaveValue("")
    await setTotal(dlg, "500000")
    await expect(priceInput(dlg, 0)).toHaveValue("")
    await expect(dlg.getByTestId("so-price-auto")).toHaveCount(0)
    await expect(dlg.getByText("수량을 입력하면 단가가 계산됩니다")).toBeVisible()
    await setQty(dlg, 0, "100")
    await expect(priceInput(dlg, 0)).toHaveValue("5,000")
    await expect(dlg.getByTestId("so-price-auto")).toContainText("500,000원 ÷ 100개 = 5,000원")

    // 3) 자동 계산 상태에서 수량 변경 → 재계산
    await setQty(dlg, 0, "200")
    await expect(priceInput(dlg, 0)).toHaveValue("2,500")
    await expect(dlg.getByTestId("so-price-auto")).toContainText("500,000원 ÷ 200개 = 2,500원")

    // 2) 수량 먼저 → 총금액
    dlg = await openCreateDialog(page)
    await addItemRow(page, dlg)
    await setQty(dlg, 0, "100")
    await expect(priceInput(dlg, 0)).toHaveValue("")
    await setTotal(dlg, "500000")
    await expect(priceInput(dlg, 0)).toHaveValue("5,000")
    await expect(dlg.getByTestId("so-price-auto")).toContainText("500,000원 ÷ 100개 = 5,000원")
  })

  test("4·5: 단가 직접 수정 → 수동 값 유지, 수량 변경해도 덮어쓰지 않음, 되돌리기 동작", async ({ page }) => {
    await login(page)
    const dlg = await openCreateDialog(page)
    await addItemRow(page, dlg)
    await setTotal(dlg, "500000")
    await setQty(dlg, 0, "100")
    await expect(priceInput(dlg, 0)).toHaveValue("5,000")

    // 4) 직접 수정
    await setPrice(dlg, 0, "5500")
    await expect(priceInput(dlg, 0)).toHaveValue("5,500")
    await expect(dlg.getByTestId("so-price-manual")).toBeVisible()
    await expect(dlg.getByTestId("so-price-auto")).toHaveCount(0)
    // 금액 불일치 안내 (500,000 ≠ 100 × 5,500 = 550,000)
    await expect(dlg.getByTestId("so-amount-mismatch")).toContainText("차이 50,000원 (합계가 초과)")

    // 5) 수동 입력 후 수량 수정 → 수동 단가 유지
    await setQty(dlg, 0, "250")
    await expect(priceInput(dlg, 0)).toHaveValue("5,500")
    await expect(dlg.getByTestId("so-price-manual")).toBeVisible()

    // 총금액 변경도 수동 단가를 덮어쓰지 않는다
    await setTotal(dlg, "600000")
    await expect(priceInput(dlg, 0)).toHaveValue("5,500")

    // 7) 되돌리기 → 자동 계산 재개 (600,000 ÷ 250 = 2,400)
    await dlg.getByRole("button", { name: /자동 계산으로 되돌리기/ }).click()
    await expect(priceInput(dlg, 0)).toHaveValue("2,400")
    await expect(dlg.getByTestId("so-price-auto")).toContainText("600,000원 ÷ 250개 = 2,400원")
    await expect(dlg.getByTestId("so-price-manual")).toHaveCount(0)
    await expect(dlg.getByTestId("so-amount-mismatch")).toHaveCount(0)
  })

  test("6: 총금액 미입력 → 단가 자동 계산 없이 기존 방식(직접 입력) 그대로", async ({ page }) => {
    await login(page)
    const dlg = await openCreateDialog(page)
    await addItemRow(page, dlg)
    await setQty(dlg, 0, "10")
    await expect(priceInput(dlg, 0)).toHaveValue("")
    await expect(dlg.getByTestId("so-price-auto")).toHaveCount(0)
    await setPrice(dlg, 0, "1234")
    await expect(priceInput(dlg, 0)).toHaveValue("1,234")
    await expect(dlg.getByTestId("so-amount-mismatch")).toHaveCount(0)
  })

  test("8: 다중 품목 — 잔여 금액 계산, 여러 품목 공동 대상은 배분 안 함, 행 삭제 후 재계산", async ({ page }) => {
    await login(page)
    const dlg = await openCreateDialog(page)

    // 두 행 모두 단가가 비어 있으면 총금액을 배분하지 않는다
    await addItemRow(page, dlg)
    await addItemRow(page, dlg)
    await setQty(dlg, 0, "40")
    await setQty(dlg, 1, "60")
    await setTotal(dlg, "500000")
    await expect(priceInput(dlg, 0)).toHaveValue("")
    await expect(priceInput(dlg, 1)).toHaveValue("")
    await expect(dlg.getByTestId("so-price-auto")).toHaveCount(0)

    // 행1 단가 확정(5,000 × 40 = 200,000) → 행2 는 잔여 300,000 ÷ 60 = 5,000
    await setPrice(dlg, 0, "5000")
    await expect(priceInput(dlg, 1)).toHaveValue("5,000")
    await expect(dlg.getByTestId("so-price-auto")).toContainText("300,000원 (잔여) ÷ 60개 = 5,000원")
    await expect(dlg.getByTestId("so-amount-mismatch")).toHaveCount(0)

    // 행1 삭제 → 남은 행2 는 자동 상태 단일 품목이므로 총금액 전체 ÷ 수량으로 재계산
    await dlg.locator('button[class*="hover:text-destructive"]').first().click()
    await expect(priceInput(dlg, 0)).toHaveValue("8,333")
    await expect(dlg.getByTestId("so-price-auto")).toContainText("500,000원 ÷ 60개 = 8,333원")
    // 8,333 × 60 = 499,980 → 차이 20원은 반올림 범위(1원)를 넘으므로 기존 불일치 안내 유지
    await expect(dlg.getByTestId("so-amount-mismatch")).toContainText("차이 20원 (합계가 부족)")
    await expect(dlg.getByTestId("so-amount-rounding")).toHaveCount(0)
  })

  test("9: 반올림 차이(KRW 자동 계산, 1원) — 안내만 표시하고 확인창 없이 저장, DB 재조회 일치", async ({ page }) => {
    await login(page)
    const { seen } = trackDialogs(page)
    const startedAt = new Date()
    const dlg = await openCreateDialog(page)
    await addItemRow(page, dlg)
    await setTotal(dlg, "1000")
    await setQty(dlg, 0, "3")
    await expect(priceInput(dlg, 0)).toHaveValue("333")
    await expect(dlg.getByTestId("so-price-auto")).toContainText("1,000원 ÷ 3개 = 333원")
    // 불일치 경고 대신 반올림 안내만 나온다
    await expect(dlg.getByTestId("so-amount-mismatch")).toHaveCount(0)
    await expect(dlg.getByTestId("so-amount-rounding")).toContainText("1원 차이")

    await dlg.getByRole("button", { name: "등록", exact: true }).click()
    await expect(dlg).toBeHidden({ timeout: 30_000 })
    uiCreated++
    expect(seen).toEqual([])

    const so = await latestOrder(startedAt)
    expect(toNum(so.totalAmount)).toBe(1000)
    expect(so.items.length).toBe(1)
    expect(toNum(so.items[0].qty)).toBe(3)
    expect(toNum(so.items[0].unitPrice)).toBe(333)
  })

  test("10: 실제 저장 (단일 품목, 자동 단가) 후 DB 재조회 — 총금액·수량·단가 유지", async ({ page }) => {
    await login(page)
    const startedAt = new Date()
    const dlg = await openCreateDialog(page)
    await addItemRow(page, dlg)
    await setTotal(dlg, "500000")
    await setQty(dlg, 0, "100")
    await expect(priceInput(dlg, 0)).toHaveValue("5,000")
    await expect(dlg.getByTestId("so-amount-mismatch")).toHaveCount(0)
    await dlg.getByRole("button", { name: "등록", exact: true }).click()
    await expect(dlg).toBeHidden({ timeout: 30_000 })
    uiCreated++

    const so = await latestOrder(startedAt)
    expect(toNum(so.totalAmount)).toBe(500000)
    expect(so.items.length).toBe(1)
    expect(toNum(so.items[0].qty)).toBe(100)
    expect(toNum(so.items[0].unitPrice)).toBe(5000)
    expect(so.items[0].itemId).toBe(D.items.fg.id)
    expect(so.customerId).toBe(D.customer.id)
  })

  test("11: 기존 수주 수정 — 저장된 단가 재계산 없음, 재조회 값 일치, 수량 변경 시 불일치 안내 후 저장", async ({ page }) => {
    await login(page)
    const so = await latestOrder(new Date(Date.now() - 60 * 60 * 1000))
    await openSalesOrders(page)
    await page.getByPlaceholder("수주번호 검색...").fill(so.orderNo)
    const row = page.locator("tbody tr", { hasText: so.orderNo }).first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    await row.getByRole("button").last().click()
    await page.getByRole("menuitem", { name: /수정/ }).click()
    const dlg = page.getByRole("dialog")
    await expect(dlg.getByText("수주 정보를 수정합니다.")).toBeVisible({ timeout: 20_000 })

    // 재조회 값: 저장된 총금액·수량·단가 그대로
    await expect(totalInput(dlg)).toHaveValue("500,000")
    await expect(qtyInput(dlg, 0)).toHaveValue("100")
    await expect(priceInput(dlg, 0)).toHaveValue("5,000")
    await expect(dlg.getByTestId("so-price-auto")).toHaveCount(0)
    await expect(dlg.getByTestId("so-amount-mismatch")).toHaveCount(0)

    // 수량만 변경 → 저장된 단가는 재계산되지 않는다 (수동으로 취급)
    await setQty(dlg, 0, "200")
    await expect(priceInput(dlg, 0)).toHaveValue("5,000")
    await expect(dlg.getByTestId("so-amount-mismatch")).toContainText("차이 500,000원 (합계가 초과)")

    page.once("dialog", async (d) => {
      await d.accept()
    })
    await dlg.getByRole("button", { name: "저장", exact: true }).click()
    await expect(dlg).toBeHidden({ timeout: 30_000 })

    const after = await db().salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: true } })
    expect(toNum(after.totalAmount)).toBe(500000)
    expect(toNum(after.items[0].qty)).toBe(200)
    expect(toNum(after.items[0].unitPrice)).toBe(5000)
  })

  test("11-b: 기존 수주 수정 — 저장된 불일치는 수정 화면에서 자동 계산 대상이 아니므로 기존 확인 절차 유지, 값 보존", async ({ page }) => {
    await login(page)
    // test 9 이 만든 1,000원·3개·단가 333 수주 (같은 실행의 가장 최근 것). 다른 spec 이 만든 수주와 섞이지 않도록 총금액으로 고른다.
    const so = await db().salesOrder.findFirstOrThrow({ where: { tenantId: T, totalAmount: 1000, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } }, orderBy: { createdAt: "desc" }, include: { items: true } })
    const origItem = so.items[0]
    await openSalesOrders(page)
    await page.getByPlaceholder("수주번호 검색...").fill(so.orderNo)
    const row = page.locator("tbody tr", { hasText: so.orderNo }).first()
    await row.getByRole("button").last().click()
    await page.getByRole("menuitem", { name: /수정/ }).click()
    const dlg = page.getByRole("dialog")
    await expect(dlg.getByText("수주 정보를 수정합니다.")).toBeVisible({ timeout: 20_000 })
    // 저장된 단가는 수동 값으로 취급 → 1원 차이여도 불일치 안내 + 확인창 (기존 동작 유지)
    await expect(dlg.getByTestId("so-amount-mismatch")).toContainText("차이 1원 (합계가 부족)")
    await expect(priceInput(dlg, 0)).toHaveValue("333")
    let confirmed = ""
    page.once("dialog", async (d) => {
      confirmed = d.message()
      await d.accept()
    })
    await dlg.getByRole("button", { name: "저장", exact: true }).click()
    await expect(dlg).toBeHidden({ timeout: 30_000 })
    expect(confirmed).toContain("일치하지 않습니다")
    const after = await db().salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: true } })
    expect(toNum(after.totalAmount)).toBe(Number(so.totalAmount))
    expect(toNum(after.items[0].qty)).toBe(Number(origItem.qty))
    expect(toNum(after.items[0].unitPrice)).toBe(Number(origItem.unitPrice))
  })

  test("12: 신규 품목 수량 미입력 → 단가 계산 없음, 저장 차단(확인창 없음), 건수 불변", async ({ page }) => {
    await login(page)
    const { seen } = trackDialogs(page)
    const before = await orderCount()
    const dlg = await openCreateDialog(page)
    await addItemRow(page, dlg)
    await setTotal(dlg, "500000")
    await expect(priceInput(dlg, 0)).toHaveValue("")
    await dlg.getByRole("button", { name: "등록", exact: true }).click()
    await expect(dlg.getByText("수량을 입력하세요")).toBeVisible({ timeout: 10_000 })
    await expect(dlg).toBeVisible()
    expect(seen).toEqual([])
    expect(await orderCount()).toBe(before)
  })

  test("13: 수량 0 입력 → 단가 계산 없음, 저장 차단, 건수 불변", async ({ page }) => {
    await login(page)
    const { seen } = trackDialogs(page)
    const before = await orderCount()
    const dlg = await openCreateDialog(page)
    await addItemRow(page, dlg)
    await setQty(dlg, 0, "0")
    await setTotal(dlg, "500000")
    await expect(priceInput(dlg, 0)).toHaveValue("")
    await expect(dlg.getByTestId("so-price-auto")).toHaveCount(0)
    await dlg.getByRole("button", { name: "등록", exact: true }).click()
    await expect(dlg.getByText("수량은 0보다 커야 합니다")).toBeVisible({ timeout: 10_000 })
    await expect(dlg).toBeVisible()
    expect(seen).toEqual([])
    expect(await orderCount()).toBe(before)
  })

  test("14: 다중 품목 실제 저장 — 확정 행 + 잔여 자동 행, DB 재조회 일치", async ({ page }) => {
    // 품목 선택 목록에는 완제품만 나온다. seed 는 완제품을 1개만 만들므로, 격리 DB 에 E2E-OS- 완제품 2 를 upsert 한다.
    const fg1 = await db().item.findUniqueOrThrow({ where: { tenantId_code: { tenantId: T, code: D.items.fg.code } } })
    const fg2 = await db().item.upsert({
      where: { tenantId_code: { tenantId: T, code: "E2E-OS-FG-002" } },
      update: {},
      create: { tenantId: T, code: "E2E-OS-FG-002", name: "E2E-OS-완제품 2", itemType: "FINISHED", categoryId: fg1.categoryId, uom: "EA", isLotTracked: true },
    })

    await login(page)
    const { seen } = trackDialogs(page)
    const startedAt = new Date()
    const dlg = await openCreateDialog(page)
    await addItemRow(page, dlg, D.items.fg.code)
    await addItemRow(page, dlg, fg2.code)
    await setQty(dlg, 0, "40")
    await setQty(dlg, 1, "60")
    await setTotal(dlg, "500000")
    await setPrice(dlg, 0, "5000")
    await expect(priceInput(dlg, 1)).toHaveValue("5,000")
    await expect(dlg.getByTestId("so-amount-mismatch")).toHaveCount(0)
    await dlg.getByRole("button", { name: "등록", exact: true }).click()
    await expect(dlg).toBeHidden({ timeout: 30_000 })
    uiCreated++
    expect(seen).toEqual([])

    const so = await latestOrder(startedAt)
    expect(toNum(so.totalAmount)).toBe(500000)
    expect(so.items.length).toBe(2)
    const fgLine = so.items.find((i) => i.itemId === fg1.id)
    const fg2Line = so.items.find((i) => i.itemId === fg2.id)
    expect(toNum(fgLine?.qty)).toBe(40)
    expect(toNum(fgLine?.unitPrice)).toBe(5000)
    expect(toNum(fg2Line?.qty)).toBe(60)
    expect(toNum(fg2Line?.unitPrice)).toBe(5000)
  })

  test("15: 수동 단가로 금액 불일치 — 확인창 취소 시 저장 안 됨, 확인 시 저장되고 총금액은 그대로", async ({ page }) => {
    await login(page)
    const tracker = trackDialogs(page)
    const startedAt = new Date()
    const before = await orderCount()
    const dlg = await openCreateDialog(page)
    await addItemRow(page, dlg)
    await setTotal(dlg, "500000")
    await setQty(dlg, 0, "100")
    await expect(priceInput(dlg, 0)).toHaveValue("5,000")
    await setPrice(dlg, 0, "5500")
    await expect(dlg.getByTestId("so-amount-mismatch")).toContainText("차이 50,000원 (합계가 초과)")

    // 취소 → 저장되지 않음
    tracker.state.answer = "dismiss"
    await dlg.getByRole("button", { name: "등록", exact: true }).click()
    await expect.poll(() => tracker.seen.length, { timeout: 10_000 }).toBe(1)
    expect(tracker.seen[0]).toContain("일치하지 않습니다")
    await expect(dlg).toBeVisible()
    expect(await orderCount()).toBe(before)
    expect(await priceInput(dlg, 0).inputValue()).toBe("5,500")

    // 확인 → 저장, 총금액은 임의로 바뀌지 않는다
    tracker.state.answer = "accept"
    await dlg.getByRole("button", { name: "등록", exact: true }).click()
    await expect(dlg).toBeHidden({ timeout: 30_000 })
    uiCreated++
    expect(tracker.seen.length).toBe(2)

    const so = await latestOrder(startedAt)
    expect(toNum(so.totalAmount)).toBe(500000)
    expect(toNum(so.items[0].qty)).toBe(100)
    expect(toNum(so.items[0].unitPrice)).toBe(5500)
  })
})
