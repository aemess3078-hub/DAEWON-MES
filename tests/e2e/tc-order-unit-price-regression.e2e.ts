/**
 * 수주 단가 자동 계산 변경의 회귀 확인 — 로컬 격리 테스트 DB·로컬 서버 전용.
 *  - 로그인 화면 로그인 → 출하 화면 → [출하예정 등록] 시트가 열리고 품목 행 입력이 동작하는지 확인
 *  - 수주 등록 시트에서 총금액 미입력 시 기존 등록 방식(단가 직접 입력)이 그대로 저장되는지 확인
 *  - 저장 후 DB 재조회로 값 대조
 */
import { test, expect, type Page } from "@playwright/test"
import * as fs from "node:fs"
import * as path from "node:path"
import { assertSafeE2eEnvironment, adminCredentials } from "./guard"
import { db, closeDb } from "./support/o2s-lib"

assertSafeE2eEnvironment()

type Data = { tenantId: string; customer: { id: string; code: string }; items: { fg: { id: string; code: string } } }
const D: Data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "test-results/e2e/o2s-data.json"), "utf8").replace(/^﻿/, ""))
const T = D.tenantId

async function login(page: Page) {
  const c = adminCredentials()
  await page.goto("/login")
  await page.getByRole("button", { name: /시스템모드/ }).click()
  await page.locator("#loginId").fill(c.loginId)
  await page.locator("#password").fill(c.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/app/, { timeout: 60_000 })
}

test.afterAll(async () => {
  await closeDb()
})

test("로그인 후 출하 화면 → 출하예정 등록 시트 열림", async ({ page }) => {
  await login(page)
  await page.goto("/app/mes/shipments", { waitUntil: "domcontentloaded", timeout: 90_000 })
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {})
  await page.getByRole("tab", { name: /출하 목록/ }).click().catch(() => {})
  await page.getByRole("button", { name: /^출하예정 등록$/ }).first().click()
  const dlg = page.getByRole("dialog")
  await expect(dlg.getByText("출하예정 등록", { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(dlg.getByText("완제품 LOT를 예약합니다.")).toBeVisible()
})

test("수주 등록: 총금액 미입력 → 단가 직접 입력 방식으로 저장, DB 재조회 일치", async ({ page }) => {
  await login(page)
  const startedAt = new Date()
  await page.goto("/app/mes/sales-orders", { waitUntil: "domcontentloaded", timeout: 90_000 })
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {})
  await page.getByRole("button", { name: /^수주 등록$/ }).click()
  const dlg = page.getByRole("dialog")
  await expect(dlg.getByText("새로운 수주를 등록합니다.")).toBeVisible({ timeout: 20_000 })
  await dlg.getByRole("combobox").first().click()
  await page.getByRole("option", { name: new RegExp(D.customer.code) }).click()
  await dlg.locator('input[type="date"]').nth(1).fill("2027-04-30")
  await dlg.getByRole("button", { name: /품목 추가/ }).click()
  await dlg.getByRole("combobox").filter({ hasText: "품목 선택" }).first().click()
  await page.getByRole("option", { name: new RegExp(D.items.fg.code) }).click()
  await dlg.locator("input.tabular-nums").nth(0).fill("7")
  await dlg.locator("input.tabular-nums").nth(1).fill("12345")
  await expect(dlg.getByTestId("so-price-auto")).toHaveCount(0)
  await expect(dlg.getByTestId("so-amount-mismatch")).toHaveCount(0)
  await dlg.getByRole("button", { name: "등록", exact: true }).click()
  await expect(dlg).toBeHidden({ timeout: 30_000 })

  const so = await db().salesOrder.findFirstOrThrow({
    where: { tenantId: T, createdAt: { gte: startedAt } },
    orderBy: { createdAt: "desc" },
    include: { items: true },
  })
  expect(so.totalAmount).toBeNull()
  expect(so.items.length).toBe(1)
  expect(Number(so.items[0].qty)).toBe(7)
  expect(Number(so.items[0].unitPrice)).toBe(12345)
  expect(so.status).toBe("CONFIRMED")
})
