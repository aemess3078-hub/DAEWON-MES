import { test, expect, Page } from "@playwright/test"

const BASE_URL = "http://localhost:3000"

// dev bypass 쿠키 세팅 (로그인 없이 테스트)
async function setupAuth(page: Page) {
  await page.goto(BASE_URL)
  await page.context().addCookies([
    { name: "nmes-dev-bypass", value: "true", domain: "localhost", path: "/" },
    { name: "tenantId",        value: "tenant-demo-001", domain: "localhost", path: "/" },
    { name: "siteId",          value: "site-factory-001", domain: "localhost", path: "/" },
  ])
}

const MENUS = [
  // 기준정보
  { name: "품목관리",        path: "/app/mes/items" },
  { name: "BOM 관리",        path: "/app/mes/bom" },
  { name: "라우팅 관리",      path: "/app/mes/routing" },
  { name: "사이트 관리",      path: "/app/mes/sites" },
  { name: "로케이션 관리",    path: "/app/mes/locations" },
  // 구매관리
  { name: "발주관리",        path: "/app/mes/purchase-orders" },
  { name: "자재입고 관리",   path: "/app/mes/material-receipt" },
  // 생산관리
  { name: "생산계획",        path: "/app/mes/production-plan" },
  { name: "작업지시",        path: "/app/mes/work-orders" },
  { name: "작업실적",        path: "/app/mes/production-results" },
  // 자재/재고
  { name: "재고현황",        path: "/app/mes/inventory" },
  { name: "입출고 관리",     path: "/app/mes/inventory-transactions" },
  // 영업관리
  { name: "견적관리",        path: "/app/mes/quotations" },
  { name: "수주관리",        path: "/app/mes/sales-orders" },
  { name: "출하관리",        path: "/app/mes/shipments" },
  // 품질관리
  { name: "공정검사",        path: "/app/mes/inspection" },
  { name: "불량관리",        path: "/app/mes/defects" },
  // 시스템
  { name: "공통코드",        path: "/app/mes/common-codes" },
  { name: "권한관리",        path: "/app/mes/users" },
  { name: "기능관리",        path: "/app/mes/features" },
]

test.describe("메뉴 기능 테스트", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  for (const menu of MENUS) {
    test(`[${menu.name}] 페이지 정상 로드`, async ({ page }) => {
      await page.goto(BASE_URL + menu.path)
      await page.waitForLoadState("networkidle", { timeout: 15000 })

      // 에러 페이지 감지
      const bodyText = await page.locator("body").innerText()
      expect(bodyText).not.toContain("An error occurred")
      expect(bodyText).not.toContain("Application error")
      expect(bodyText).not.toMatch(/^\s*500\s*$/m)

      // 페이지가 실제로 콘텐츠를 렌더링했는지 확인
      const main = page.locator("main")
      await expect(main).toBeVisible({ timeout: 10000 })

      // 스크린샷 저장
      await page.screenshot({
        path: `tests/screenshots/${menu.name.replace(/[\/\s]/g, "_")}.png`,
        fullPage: false,
      })

      console.log(`✅ ${menu.name}: OK`)
    })
  }
})
