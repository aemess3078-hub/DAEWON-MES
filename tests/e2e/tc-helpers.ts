import { expect, test, type Page, type Locator } from "@playwright/test"
import * as XLSX from "xlsx"
import * as path from "node:path"
import { adminCredentials, developerCredentials } from "./guard"

export type Tc = {
  id: string
  group: string
  menu: string
  path: string
  priority: string
  type: string
  steps: string
  expected: string
}

const TC_FILE = process.env.TC_XLSX ?? path.resolve(process.cwd(), "대원정밀_MES_메뉴별_단위기능테스트_313TC.xlsx")

/** 기준 문서(313TC 엑셀)의 TC_상세 시트를 그대로 읽는다 — 케이스를 코드에 베끼지 않는다. */
export function loadTcs(): Tc[] {
  const wb = XLSX.readFile(TC_FILE)
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets["TC_상세"], { range: 3, defval: "" })
  return rows
    .filter((r) => r["TC ID"])
    .map((r) => ({ id: r["TC ID"], group: r["대분류"], menu: r["메뉴"], path: r["접속 경로"], priority: r["중요도"], type: r["유형"], steps: r["실행절차"], expected: r["기대결과"] }))
}

const ALL = loadTcs()

/** 메뉴+유형(+기대결과 키워드)으로 TC ID 를 찾는다. 없으면 null. */
export function tcOf(menu: string, type: string, keyword?: RegExp): Tc | null {
  return ALL.find((t) => t.menu === menu && t.type === type && (!keyword || keyword.test(t.expected))) ?? null
}
export const tcTitle = (tc: Tc | null, fallback: string) => (tc ? `[${tc.id}] ${tc.menu} ${tc.type} — ${fallback}` : `[NO-TC] ${fallback}`)
export const tcsOfType = (type: string) => ALL.filter((t) => t.type === type)

export async function login(page: Page, asDeveloper = false) {
  const { loginId, password } = asDeveloper ? developerCredentials() : adminCredentials()
  await page.goto("/login")
  await page.getByRole("button", { name: /시스템모드/ }).click()
  await page.locator("#loginId").fill(loginId)
  await page.locator("#password").fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/app/, { timeout: 60_000 })
}

export async function gotoMenu(page: Page, p: string) {
  const resp = await page.goto(p, { waitUntil: "domcontentloaded", timeout: 90_000 })
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {})
  return resp
}

/** 시트/다이얼로그(role=dialog) */
export const dialog = (page: Page) => page.getByRole("dialog")

/** 목록의 특정 텍스트가 있는 행 */
export const rowOf = (page: Page, text: string): Locator => page.locator("tbody tr", { hasText: text })

export async function openRowAction(page: Page, rowText: string, action: "수정" | "삭제" | "상세보기") {
  const row = rowOf(page, rowText).first()
  await expect(row, `행 '${rowText}'`).toBeVisible({ timeout: 20_000 })
  const item = page.getByRole("menuitem", { name: action })
  // 일부 표(사업장/로케이션/공정)는 행 메뉴 버튼에 접근성 이름이 없어(아이콘만) 마지막 버튼을 쓴다.
  // 페이지가 hydrate 되기 전에 누른 클릭은 메뉴를 열지 못하므로, 메뉴 항목이 보일 때까지 다시 누른다(횟수는 주석으로 남긴다).
  let attempts = 0
  while (attempts < 5) {
    attempts += 1
    const named = row.getByRole("button", { name: "메뉴 열기" })
    if (await named.count()) await named.click()
    else await row.getByRole("button").last().click()
    if (await item.first().waitFor({ state: "visible", timeout: 4_000 }).then(() => true, () => false)) break
    await page.keyboard.press("Escape").catch(() => {})
  }
  if (attempts > 1) {
    try { test.info().annotations.push({ type: "row-menu-retry", description: `${rowText} → ${action}: ${attempts}회 시도` }) } catch { /* test 밖 */ }
  }
  await item.click()
}

/** Radix Select: 라벨로 트리거를 찾아 옵션 선택(옵션명은 부분 일치) */
export async function pickSelect(scope: Locator, page: Page, label: string | RegExp, option: string | RegExp) {
  await scope.getByLabel(label).first().click()
  await page.getByRole("option", { name: option }).first().click()
}

/** 서버가 보낸 오류 메시지/알림을 모아 반환(토스트, 폼 오류, alert) */
export function collectDialogs(page: Page): string[] {
  const msgs: string[] = []
  page.on("dialog", (d) => {
    msgs.push(`${d.type()}:${d.message()}`)
    d.accept().catch(() => {})
  })
  return msgs
}
