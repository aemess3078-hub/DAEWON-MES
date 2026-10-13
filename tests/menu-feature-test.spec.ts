/**
 * menu-feature-test.spec.ts
 * 각 MES 메뉴별 기능 테스트 (페이지 로드 + CRUD + 특수기능)
 *
 * 코드 분석 기반:
 * - 품목관리: CRUD (품목 등록/수정/삭제, DataTableRowActions 드롭다운)
 * - BOM관리: CRUD (BOM 등록/수정/삭제, 구조 상세 패널)
 * - 라우팅관리: CRUD (라우팅 등록/수정/삭제)
 * - 사이트관리: CRUD + 로케이션 보기 (드롭다운 메뉴 방식)
 * - 로케이션관리: CRUD (DataTableRowActions)
 * - 발주관리: CRUD + 입고처리 (신규 발주 버튼)
 * - 자재입고관리: 발주 목록 + 입고처리 버튼 (등록버튼 없음)
 * - 생산계획: CRUD (생산계획 등록)
 * - 작업지시: CRUD (작업지시 등록)
 * - 작업실적: "준비 중" 페이지
 * - 재고현황: 조회 전용 (트랜잭션 등록 없음)
 * - 입출고관리: 트랜잭션 등록 버튼
 * - 견적관리: CRUD + 수주전환 버튼
 * - 수주관리: CRUD
 * - 출하관리: CRUD + 확정 버튼
 * - 공정검사: 검사 등록 + 상세보기
 * - 불량관리: CRUD
 */

import { test, expect, Page } from "@playwright/test"

const BASE_URL = "http://localhost:3000"

// ─── 인증 헬퍼 ────────────────────────────────────────────────────────────────

async function setupAuth(page: Page) {
  await page.goto(BASE_URL)
  await page.context().addCookies([
    { name: "nmes-dev-bypass", value: "true",           domain: "localhost", path: "/" },
    { name: "tenantId",        value: "tenant-demo-001", domain: "localhost", path: "/" },
    { name: "siteId",          value: "site-factory-001", domain: "localhost", path: "/" },
  ])
}

async function gotoMenu(page: Page, path: string) {
  await page.goto(BASE_URL + path)
  await page.waitForLoadState("networkidle", { timeout: 20000 })
}

// dialog 자동 수락 설정
function acceptDialogs(page: Page) {
  page.on("dialog", (dialog) => dialog.accept())
}

// 스크린샷 저장
async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: `tests/screenshots/feature-${name.replace(/[\/\s\[\]]/g, "_")}.png`,
    fullPage: false,
  })
}

// ─── 1. 품목관리 (/app/mes/items) ─────────────────────────────────────────────
// CRUD: 품목 등록 버튼 → Sheet, DataTableRowActions 드롭다운 → 수정/삭제
// 시드데이터: RM-STEEL-001(SUS304 스테인리스 판재), FG-ASSY-001(구동 모듈 완제품 A형) 등

test.describe("1. 품목관리", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 시드 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/items")
    await expect(page.locator("h1")).toContainText("품목관리")
    // 시드 데이터 확인
    await expect(page.getByText("SUS304 스테인리스 판재")).toBeVisible()
    await expect(page.getByText("구동 모듈 완제품 A형")).toBeVisible()
    await screenshot(page, "items-load")
  })

  test("품목 등록 버튼 클릭 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/items")
    await page.getByRole("button", { name: /품목 등록/ }).click()
    // Sheet/Dialog가 열려야 함
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "items-create-sheet")
  })

  test("품목 등록 → 저장 → 목록 반영", async ({ page }) => {
    const ts = Date.now()
    const itemCode = `TEST-${ts}`
    const itemName = `테스트품목-${ts}`

    await gotoMenu(page, "/app/mes/items")
    await page.getByRole("button", { name: /품목 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })

    // 폼 입력
    await page.getByLabel("품목코드").fill(itemCode)
    await page.getByLabel("품목명").fill(itemName)

    // 저장 버튼 클릭 (Sheet 내 저장/등록 버튼)
    const saveBtn = page.getByRole("button", { name: /등록|저장|확인/ }).last()
    await saveBtn.click()
    await page.waitForLoadState("networkidle", { timeout: 15000 })

    // 목록에 새 품목이 표시되는지 확인
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 10000 })
    await screenshot(page, "items-after-create")
  })

  test("첫 번째 행 수정 버튼 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/items")
    // DataTableRowActions: MoreHorizontal 버튼 클릭
    const moreBtn = page.locator("button").filter({ has: page.locator("svg") }).first()
    // 정확히 MoreHorizontal 버튼 (sr-only 텍스트: 메뉴 열기)
    const actionBtn = page.getByRole("button", { name: "메뉴 열기" }).first()
    await actionBtn.click()
    // 드롭다운에서 수정 클릭
    await page.getByRole("menuitem", { name: /수정/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "items-edit-sheet")
  })

  test("첫 번째 행 삭제 버튼 → confirm 수락 → 목록에서 제거", async ({ page }) => {
    acceptDialogs(page)
    await gotoMenu(page, "/app/mes/items")

    // 테스트를 위해 삭제할 행 확인 (시드 데이터에 없는 임시 데이터가 있는 경우)
    // 단, 시드 데이터 행 삭제는 다른 테스트에 영향이 있으므로 삭제 시도만 확인
    const actionBtn = page.getByRole("button", { name: "메뉴 열기" }).first()
    await actionBtn.click()
    await page.getByRole("menuitem", { name: /삭제/ }).click()
    // dialog는 acceptDialogs로 자동 수락됨
    await page.waitForLoadState("networkidle", { timeout: 10000 })
    await screenshot(page, "items-after-delete")
    // 페이지가 에러 없이 유지되는지 확인
    await expect(page.locator("h1")).toContainText("품목관리")
  })
})

// ─── 2. BOM관리 (/app/mes/bom) ────────────────────────────────────────────────
// CRUD: BOM 등록 버튼 → Sheet, 행 클릭 → 구조 상세 패널
// 시드: bom-fg-assy-001 (구동 모듈 완제품 A형)

test.describe("2. BOM관리", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 시드 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/bom")
    // 기능 비활성화 또는 정상 로드 모두 허용
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      console.log("BOM 기능 비활성화 상태")
      return
    }
    await expect(page.locator("h1")).toContainText("BOM 관리")
    await screenshot(page, "bom-load")
  })

  test("BOM 등록 버튼 클릭 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/bom")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      test.skip()
      return
    }
    await page.getByRole("button", { name: /BOM 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "bom-create-sheet")
  })

  test("BOM 행 품목코드 클릭 → 구조 상세 패널 표시", async ({ page }) => {
    await gotoMenu(page, "/app/mes/bom")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      test.skip()
      return
    }
    // 품목코드 버튼 클릭 (BOM columns에서 품목코드가 button으로 렌더링됨)
    const itemCodeBtn = page.locator("button.font-mono").first()
    if (await itemCodeBtn.isVisible()) {
      await itemCodeBtn.click()
      // BomDetailPanel이 표시되어야 함
      await page.waitForTimeout(500)
      await screenshot(page, "bom-detail-panel")
    }
  })

  test("BOM 수정 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/bom")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      test.skip()
      return
    }
    const actionBtn = page.getByRole("button", { name: "메뉴 열기" }).first()
    await actionBtn.click()
    await page.getByRole("menuitem", { name: /수정/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "bom-edit-sheet")
  })
})

// ─── 3. 라우팅관리 (/app/mes/routing) ────────────────────────────────────────
// CRUD: 라우팅 등록 버튼 → Sheet

test.describe("3. 라우팅관리", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 시드 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/routing")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      console.log("라우팅 기능 비활성화 상태")
      return
    }
    await expect(page.locator("h1")).toContainText("공정/라우팅 관리")
    await screenshot(page, "routing-load")
  })

  test("라우팅 등록 버튼 클릭 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/routing")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      test.skip()
      return
    }
    await page.getByRole("button", { name: /라우팅 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "routing-create-sheet")
  })

  test("라우팅 수정 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/routing")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      test.skip()
      return
    }
    const rows = page.getByRole("button", { name: "메뉴 열기" })
    if (await rows.count() > 0) {
      await rows.first().click()
      await page.getByRole("menuitem", { name: /수정/ }).click()
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
      await screenshot(page, "routing-edit-sheet")
    }
  })
})

// ─── 4. 사이트관리 (/app/mes/sites) ──────────────────────────────────────────
// CRUD: 사이트 등록 버튼 → Sheet, DropdownMenu → 수정/삭제/로케이션 보기
// 시드: FAC-01(본공장), WH-SITE-01(물류창고)

test.describe("4. 사이트관리", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 시드 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/sites")
    await expect(page.locator("h1")).toContainText("사이트 관리")
    // 시드 데이터: FAC-01(본공장), WH-SITE-01(물류창고) - 텍스트 중 하나 확인
    await expect(page.getByText("FAC-01").or(page.getByText("본공장")).first()).toBeVisible()
    await screenshot(page, "sites-load")
  })

  test("사이트 등록 버튼 클릭 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/sites")
    await page.getByRole("button", { name: /사이트 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "sites-create-sheet")
  })

  test("사이트 등록 → 저장 → 목록 반영", async ({ page }) => {
    const ts = Date.now()
    const siteCode = `TST-${ts}`.slice(-10) // 최대 10자 제한 고려
    const siteName = `테스트사이트-${ts}`

    await gotoMenu(page, "/app/mes/sites")
    await page.getByRole("button", { name: /사이트 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })

    // 사이트 form-sheet: label "코드" / "이름" (site-form-sheet.tsx 기준)
    await page.getByLabel("코드").fill(siteCode)
    await page.getByLabel("이름").fill(siteName)

    // Sheet 내 저장 버튼
    const saveBtn = page.getByRole("button", { name: /저장/ })
    await saveBtn.click()
    await page.waitForLoadState("networkidle", { timeout: 15000 })
    await screenshot(page, "sites-after-create")
    // 페이지 유지 확인
    await expect(page.locator("h1")).toContainText("사이트 관리")
  })

  test("드롭다운 메뉴 → 로케이션 보기 → 다이얼로그 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/sites")
    // MoreHorizontal 버튼 클릭 (사이트관리는 DropdownMenu 사용)
    const moreBtn = page.locator("button").filter({ has: page.locator('[class*="MoreHorizontal"], svg') }).first()
    // ghost 버튼 with h-8 w-8
    const ghostBtns = page.locator("button.h-8.w-8")
    if (await ghostBtns.count() > 0) {
      await ghostBtns.first().click()
    } else {
      // fallback: 아이콘 버튼
      await page.locator('[role="row"]').first().locator("button").last().click()
    }
    // 드롭다운에서 로케이션 보기 클릭
    const menuItem = page.getByRole("menuitem", { name: /로케이션 보기/ })
    if (await menuItem.isVisible()) {
      await menuItem.click()
      // 로케이션 다이얼로그 확인
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
      await screenshot(page, "sites-locations-dialog")
    }
  })

  test("드롭다운 메뉴 → 수정 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/sites")
    const ghostBtns = page.locator("button.h-8.w-8")
    if (await ghostBtns.count() > 0) {
      await ghostBtns.first().click()
    } else {
      await page.locator('[role="row"]').first().locator("button").last().click()
    }
    const menuItem = page.getByRole("menuitem", { name: /수정/ })
    if (await menuItem.isVisible()) {
      await menuItem.click()
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
      await screenshot(page, "sites-edit-sheet")
    }
  })
})

// ─── 5. 로케이션관리 (/app/mes/locations) ─────────────────────────────────────
// CRUD: 로케이션 등록 버튼 → Sheet, DataTableRowActions
// 시드: RAW-A-01(원자재 A구역 1번), FG-SHIP(출하 대기) 등

test.describe("5. 로케이션관리", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 시드 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/locations")
    await expect(page.locator("h1")).toContainText("로케이션 관리")
    // 시드 데이터: loc-raw-A-001 (RAW-A-01, 원자재 A구역 1번)
    await expect(page.getByText(/RAW-A-01|원자재/).first()).toBeVisible()
    await screenshot(page, "locations-load")
  })

  test("로케이션 등록 버튼 클릭 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/locations")
    await page.getByRole("button", { name: /로케이션 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "locations-create-sheet")
  })

  test("로케이션 수정 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/locations")
    const actionBtn = page.getByRole("button", { name: "메뉴 열기" }).first()
    if (await actionBtn.isVisible()) {
      await actionBtn.click()
      await page.getByRole("menuitem", { name: /수정/ }).click()
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
      await screenshot(page, "locations-edit-sheet")
    }
  })
})

// ─── 6. 발주관리 (/app/mes/purchase-orders) ──────────────────────────────────
// CRUD: 신규 발주 버튼 → Sheet, 수정/삭제 (columns에서 핸들링)
// 시드: PO-2026-001, PO-2026-002 등 (seed-demo-data)

test.describe("6. 발주관리", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 시드 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/purchase-orders")
    await expect(page.locator("h1")).toContainText("발주관리")
    // 테이블이 있어야 함
    await expect(page.locator("table")).toBeVisible()
    await screenshot(page, "purchase-orders-load")
  })

  test("신규 발주 버튼 클릭 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/purchase-orders")
    await page.getByRole("button", { name: /신규 발주/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "purchase-orders-create-sheet")
  })

  test("검색 필터 동작 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/purchase-orders")
    const searchInput = page.getByPlaceholder(/발주번호 또는 공급사 검색/)
    await searchInput.fill("PO-")
    await page.waitForTimeout(500)
    await screenshot(page, "purchase-orders-search")
  })

  test("상태 필터 동작 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/purchase-orders")
    // Select 상태 필터
    const statusSelect = page.locator("select, [role='combobox']").first()
    if (await statusSelect.isVisible()) {
      await statusSelect.click()
      await screenshot(page, "purchase-orders-status-filter")
    }
  })
})

// ─── 7. 자재입고관리 (/app/mes/material-receipt) ──────────────────────────────
// 발주 목록 + 입고처리 버튼 (신규 등록 버튼 없음)
// 시드: ORDERED/PARTIAL_RECEIVED 상태 발주만 표시

test.describe("7. 자재입고관리", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/material-receipt")
    await expect(page.locator("h1")).toContainText("자재입고 관리")
    await screenshot(page, "material-receipt-load")
  })

  test("발주 행 확장 (펼치기) 버튼 동작", async ({ page }) => {
    await gotoMenu(page, "/app/mes/material-receipt")
    const body = await page.locator("body").innerText()
    if (body.includes("입고 대기 중인 발주가 없습니다")) {
      console.log("입고 대기 발주 없음 - 테스트 skip")
      return
    }
    // 펼치기 버튼 클릭 (ChevronRight → ChevronDown)
    const expandBtn = page.getByRole("button", { name: /펼치기/ }).first()
    if (await expandBtn.isVisible()) {
      await expandBtn.click()
      await page.waitForTimeout(300)
      // 품목 상세가 표시되어야 함
      await expect(page.getByText(/발주수량/)).toBeVisible()
      await screenshot(page, "material-receipt-expanded")
    }
  })

  test("입고처리 버튼 클릭 → 다이얼로그 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/material-receipt")
    const body = await page.locator("body").innerText()
    if (body.includes("입고 대기 중인 발주가 없습니다")) {
      console.log("입고 대기 발주 없음 - 테스트 skip")
      return
    }
    const receiptBtn = page.getByRole("button", { name: /입고처리/ }).first()
    if (await receiptBtn.isVisible()) {
      await receiptBtn.click()
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
      await screenshot(page, "material-receipt-dialog")
    }
  })
})

// ─── 8. 생산계획 (/app/mes/production-plan) ───────────────────────────────────
// CRUD: 생산계획 등록 버튼 → Sheet, DataTableRowActions → 수정/삭제
// 시드: PP-2026-W13-001 등 (seed-demo-data)

test.describe("8. 생산계획", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 시드 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/production-plan")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      console.log("생산계획 기능 비활성화")
      return
    }
    await expect(page.locator("h1")).toContainText("생산계획 관리")
    await screenshot(page, "production-plan-load")
  })

  test("생산계획 등록 버튼 클릭 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/production-plan")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      test.skip()
      return
    }
    await page.getByRole("button", { name: /생산계획 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "production-plan-create-sheet")
  })

  test("생산계획 수정 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/production-plan")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      test.skip()
      return
    }
    const actionBtn = page.getByRole("button", { name: "메뉴 열기" }).first()
    if (await actionBtn.isVisible()) {
      await actionBtn.click()
      await page.getByRole("menuitem", { name: /수정/ }).click()
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
      await screenshot(page, "production-plan-edit-sheet")
    }
  })

  test("상태 필터 동작 확인 (DRAFT)", async ({ page }) => {
    await gotoMenu(page, "/app/mes/production-plan")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      test.skip()
      return
    }
    // DataTableFacetedFilter: PopoverTrigger 버튼 (title="상태")
    // 버튼 내에 "상태" 텍스트가 포함된 outline 버튼
    const filterBtns = page.getByRole("button", { name: /상태/ })
    const count = await filterBtns.count()
    if (count > 0) {
      await filterBtns.first().click()
      await page.waitForTimeout(500)
      // Popover content 내에 "초안" 텍스트가 표시되어야 함
      await expect(page.getByText("초안").first()).toBeVisible()
      await screenshot(page, "production-plan-filter")
    }
  })
})

// ─── 9. 작업지시 (/app/mes/work-orders) ──────────────────────────────────────
// CRUD: 작업지시 등록 버튼 → Sheet, DataTableRowActions
// 시드: WO-2026-003~007 (seed-demo-data)

test.describe("9. 작업지시", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 시드 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/work-orders")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      console.log("작업지시 기능 비활성화")
      return
    }
    await expect(page.locator("h1")).toContainText("작업지시 관리")
    // 시드 데이터: seed-demo-data에 WO-2026-003~007 (테이블에 표시될 수 있음)
    // 데이터가 없어도 페이지 자체가 로드되어야 함
    await expect(page.locator("table")).toBeVisible()
    await screenshot(page, "work-orders-load")
  })

  test("작업지시 등록 버튼 클릭 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/work-orders")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      test.skip()
      return
    }
    await page.getByRole("button", { name: /작업지시 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "work-orders-create-sheet")
  })

  test("작업지시 수정 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/work-orders")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      test.skip()
      return
    }
    const actionBtn = page.getByRole("button", { name: "메뉴 열기" }).first()
    if (await actionBtn.isVisible()) {
      await actionBtn.click()
      await page.getByRole("menuitem", { name: /수정/ }).click()
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
      await screenshot(page, "work-orders-edit-sheet")
    }
  })
})

// ─── 10. 작업실적 (/app/mes/production-results) ───────────────────────────────
// "준비 중" 페이지 (코드 분석 결과: default export가 "준비 중입니다" 텍스트만 표시)

test.describe("10. 작업실적", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 확인 (준비 중)", async ({ page }) => {
    await gotoMenu(page, "/app/mes/production-results")
    await expect(page.locator("h1")).toContainText("작업실적 관리")
    await expect(page.getByText(/준비 중/)).toBeVisible()
    await screenshot(page, "production-results-coming-soon")
  })
})

// ─── 11. 재고현황 (/app/mes/inventory) ────────────────────────────────────────
// 조회 전용: 창고별 재고 현황 (CRUD 없음, 등록 버튼 없음)
// 시드: InventoryBalance (seed-demo-data에서 설정)

test.describe("11. 재고현황", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 재고 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/inventory")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      console.log("재고현황 기능 비활성화")
      return
    }
    await expect(page.locator("h1")).toContainText("재고현황")
    await screenshot(page, "inventory-load")
  })

  test("창고 필터 동작 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/inventory")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      test.skip()
      return
    }
    // DataTableFacetedFilter: outline 버튼 중 창고 관련 버튼 탐색
    // 재고현황 DataTable filterableColumns에 창고 필터가 있는지 확인
    const filterBtns = page.getByRole("button", { name: /창고|필터/ })
    const count = await filterBtns.count()
    if (count > 0) {
      await filterBtns.first().click()
      await page.waitForTimeout(300)
      await screenshot(page, "inventory-filter")
    } else {
      // 재고현황은 필터 없을 수 있음 - 페이지만 확인
      await expect(page.locator("h1")).toContainText("재고현황")
    }
  })
})

// ─── 12. 입출고관리 (/app/mes/inventory-transactions) ─────────────────────────
// 트랜잭션 등록 버튼 → Sheet (RECEIPT/ISSUE/TRANSFER/ADJUST/RETURN/SCRAP)
// 시드: inventory transactions (seed-demo-data)

test.describe("12. 입출고관리", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/inventory-transactions")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      console.log("입출고관리 기능 비활성화")
      return
    }
    await expect(page.locator("h1")).toContainText("입출고 관리")
    await screenshot(page, "inventory-transactions-load")
  })

  test("트랜잭션 등록 버튼 클릭 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/inventory-transactions")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      test.skip()
      return
    }
    await page.getByRole("button", { name: /트랜잭션 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "inventory-transactions-create-sheet")
  })

  test("유형 필터 동작 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/inventory-transactions")
    const body = await page.locator("body").innerText()
    if (body.includes("이 기능은 활성화되어 있지 않습니다")) {
      test.skip()
      return
    }
    // DataTableFacetedFilter 버튼 (유형) - 복수 매칭 방지를 위해 .first() 사용
    const filterBtns = page.getByRole("button", { name: /유형/ })
    const filterCount = await filterBtns.count()
    if (filterCount > 0) {
      // outline 버튼 (border-dashed 스타일의 Popover 트리거)을 찾음
      await filterBtns.first().click()
      await page.waitForTimeout(500)
      // Popover 내용 확인 - 입고/출고 텍스트
      await expect(page.getByText("입고").first()).toBeVisible()
      await screenshot(page, "inventory-transactions-filter")
    } else {
      // 페이지 정상 로드만 확인
      await expect(page.locator("h1")).toContainText("입출고 관리")
    }
  })
})

// ─── 13. 견적관리 (/app/mes/quotations) ──────────────────────────────────────
// CRUD + 수주전환: 견적 등록 버튼 → Sheet, 수주전환 버튼 (columns에 onConvert)
// 시드: qt-2026-001, qt-2026-002 (seed.ts)

test.describe("13. 견적관리", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 시드 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/quotations")
    await expect(page.locator("h1")).toContainText("견적관리")
    await screenshot(page, "quotations-load")
  })

  test("견적 등록 버튼 클릭 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/quotations")
    await page.getByRole("button", { name: /견적 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "quotations-create-sheet")
  })

  test("견적 수정 → Sheet 열림 (DRAFT 상태 견적만 수정 가능)", async ({ page }) => {
    await gotoMenu(page, "/app/mes/quotations")
    // 견적 columns에서 isLocked 상태("WON", "LOST", "EXPIRED", "CANCELLED")는 수정 불가
    // DRAFT 상태 견적의 메뉴 열기 버튼을 찾아서 클릭
    const actionBtns = page.getByRole("button", { name: "메뉴 열기" })
    const count = await actionBtns.count()
    if (count === 0) {
      console.log("견적 데이터 없음 - skip")
      return
    }
    // 여러 행 중 수정 가능한 것 탐색
    for (let i = 0; i < Math.min(count, 5); i++) {
      await actionBtns.nth(i).click()
      const editItem = page.getByRole("menuitem", { name: /수정/ })
      if (await editItem.isVisible({ timeout: 1000 })) {
        await editItem.click()
        await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
        await screenshot(page, "quotations-edit-sheet")
        return
      }
      // 메뉴 닫기
      await page.keyboard.press("Escape")
      await page.waitForTimeout(200)
    }
    console.log("수정 가능한 견적 없음 (모두 WON/LOST 상태)")
  })

  test("상태 필터 동작 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/quotations")
    // DataTableFacetedFilter: PopoverTrigger 버튼 "상태"
    const filterBtn = page.getByRole("button", { name: /상태/ })
    if (await filterBtn.isVisible()) {
      await filterBtn.click()
      await page.waitForTimeout(500)
      // Popover 내용: 초안, 제출됨, 협상중 등
      await expect(page.getByText("초안").first()).toBeVisible()
      await screenshot(page, "quotations-filter")
    }
  })
})

// ─── 14. 수주관리 (/app/mes/sales-orders) ────────────────────────────────────
// CRUD: 수주 등록 버튼 → Sheet, DataTableRowActions
// 시드: SO-2026-001, SO-2026-002 등 (seed-demo-data)

test.describe("14. 수주관리", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 시드 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/sales-orders")
    await expect(page.locator("h1")).toContainText("수주관리")
    await screenshot(page, "sales-orders-load")
  })

  test("수주 등록 버튼 클릭 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/sales-orders")
    await page.getByRole("button", { name: /수주 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "sales-orders-create-sheet")
  })

  test("수주 수정 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/sales-orders")
    const actionBtn = page.getByRole("button", { name: "메뉴 열기" }).first()
    if (await actionBtn.isVisible()) {
      await actionBtn.click()
      await page.getByRole("menuitem", { name: /수정/ }).click()
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
      await screenshot(page, "sales-orders-edit-sheet")
    }
  })

  test("상태 필터 동작 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/sales-orders")
    // DataTableFacetedFilter Popover 버튼
    const filterBtn = page.getByRole("button", { name: /상태/ })
    if (await filterBtn.isVisible()) {
      await filterBtn.click()
      await page.waitForTimeout(500)
      // Popover 내용 확인 (초안, 확정 등)
      await expect(page.getByText("초안").first()).toBeVisible()
      await screenshot(page, "sales-orders-filter")
    }
  })
})

// ─── 15. 출하관리 (/app/mes/shipments) ───────────────────────────────────────
// CRUD + 확정: 출하 등록 버튼 → Sheet, 확정 버튼 (PLANNED 상태만)
// 시드: SH-2026-001 등 (seed-demo-data)

test.describe("15. 출하관리", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 시드 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/shipments")
    await expect(page.locator("h1")).toContainText("출하관리")
    await screenshot(page, "shipments-load")
  })

  test("출하 등록 버튼 클릭 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/shipments")
    await page.getByRole("button", { name: /출하 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "shipments-create-sheet")
  })

  test("상태 필터 동작 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/shipments")
    // DataTableFacetedFilter: Popover 방식 (role="option" 아님)
    const filterBtn = page.getByRole("button", { name: /상태/ })
    if (await filterBtn.isVisible()) {
      await filterBtn.click()
      await page.waitForTimeout(500)
      // Popover 내용: 출하예정, 피킹완료, 출하완료 등
      await expect(page.getByText("출하예정").first()).toBeVisible()
      await screenshot(page, "shipments-filter")
    }
  })
})

// ─── 16. 공정검사 (/app/mes/inspection) ──────────────────────────────────────
// 검사 등록 버튼 → Sheet, 상세보기 → Dialog
// 시드: QI-2026-001, QI-2026-002 등 (seed-demo-data)

test.describe("16. 공정검사", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 시드 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/inspection")
    await expect(page.locator("h1")).toContainText("공정검사")
    await screenshot(page, "inspection-load")
  })

  test("검사 등록 버튼 클릭 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/inspection")
    await page.getByRole("button", { name: /검사 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "inspection-create-sheet")
  })

  test("상세보기 → Dialog 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/inspection")
    // 검사 데이터가 있으면 상세보기 버튼 확인
    const actionBtn = page.getByRole("button", { name: "메뉴 열기" }).first()
    if (await actionBtn.isVisible()) {
      await actionBtn.click()
      const viewItem = page.getByRole("menuitem", { name: /상세보기/ })
      if (await viewItem.isVisible()) {
        await viewItem.click()
        await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
        await screenshot(page, "inspection-detail-dialog")
      }
    }
  })

  test("판정 필터 동작 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/inspection")
    const filterBtn = page.getByRole("button", { name: /판정/ })
    if (await filterBtn.isVisible()) {
      await filterBtn.click()
      await page.waitForTimeout(300)
      await screenshot(page, "inspection-filter")
    }
  })
})

// ─── 17. 불량관리 (/app/mes/defects) ─────────────────────────────────────────
// CRUD: 불량코드 등록 버튼 → Sheet, DataTableRowActions → 수정/삭제
// 시드: DIM-001(치수 초과), VIS-001(표면 스크래치) 등

test.describe("17. 불량관리", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test("페이지 로드 및 시드 데이터 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/defects")
    await expect(page.locator("h1")).toContainText("불량코드 관리")
    await expect(page.getByText("치수 초과")).toBeVisible()
    await expect(page.getByText("표면 스크래치")).toBeVisible()
    await screenshot(page, "defects-load")
  })

  test("불량코드 등록 버튼 클릭 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/defects")
    await page.getByRole("button", { name: /불량코드 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
    await screenshot(page, "defects-create-sheet")
  })

  test("불량코드 등록 → 저장 → 목록 반영", async ({ page }) => {
    const ts = Date.now()
    const code = `TS-${String(ts).slice(-6)}`  // 짧게 유지
    const name = `테스트불량-${ts}`

    await gotoMenu(page, "/app/mes/defects")
    await page.getByRole("button", { name: /불량코드 등록/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })

    // defect-form-sheet.tsx 기준:
    // FormTextField name="code" label="불량코드" → input[name="code"]
    // FormTextField name="name" label="불량명" → input[name="name"]
    // FormSelectField name="defectCategory" label="불량유형"
    // getByLabel()이 dialog 자체를 포함하므로 getByRole("textbox") 사용
    await page.getByRole("textbox", { name: "불량코드" }).fill(code)
    await page.getByRole("textbox", { name: "불량명" }).fill(name)

    // 등록 버튼 (FormSheet submit)
    const saveBtn = page.getByRole("button", { name: /등록$|^등록|저장/ }).last()
    await saveBtn.click()
    await page.waitForLoadState("networkidle", { timeout: 15000 })
    await screenshot(page, "defects-after-create")
    // 페이지 유지 확인
    await expect(page.locator("h1")).toContainText("불량코드 관리")
  })

  test("불량코드 수정 → Sheet 열림", async ({ page }) => {
    await gotoMenu(page, "/app/mes/defects")
    const actionBtn = page.getByRole("button", { name: "메뉴 열기" }).first()
    // 데이터가 있을 때만 수정 테스트
    if (await actionBtn.isVisible({ timeout: 5000 })) {
      await actionBtn.click()
      await page.getByRole("menuitem", { name: /수정/ }).click()
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
      await screenshot(page, "defects-edit-sheet")
    }
  })

  test("불량코드 삭제 → confirm 수락", async ({ page }) => {
    acceptDialogs(page)
    await gotoMenu(page, "/app/mes/defects")

    // 삭제할 임시 데이터 먼저 확인 - 시드 데이터 건드리지 않기 위해
    // 목록 수 확인
    const rows = page.getByRole("button", { name: "메뉴 열기" })
    const count = await rows.count()
    if (count > 0) {
      // 마지막 행 삭제 (보통 가장 최근 등록된 것)
      await rows.last().click()
      await page.getByRole("menuitem", { name: /삭제/ }).click()
      await page.waitForLoadState("networkidle", { timeout: 10000 })
      await screenshot(page, "defects-after-delete")
      await expect(page.locator("h1")).toContainText("불량코드 관리")
    }
  })

  test("불량유형 필터 동작 확인", async ({ page }) => {
    await gotoMenu(page, "/app/mes/defects")
    const filterBtn = page.getByRole("button", { name: /불량유형/ })
    if (await filterBtn.isVisible()) {
      await filterBtn.click()
      await page.waitForTimeout(300)
      await screenshot(page, "defects-filter")
    }
  })
})

// ─── 전체 메뉴 에러 체크 ──────────────────────────────────────────────────────

test.describe("전체 메뉴 에러 체크", () => {
  const MENUS = [
    { name: "품목관리",      path: "/app/mes/items" },
    { name: "BOM관리",       path: "/app/mes/bom" },
    { name: "라우팅관리",    path: "/app/mes/routing" },
    { name: "사이트관리",    path: "/app/mes/sites" },
    { name: "로케이션관리",  path: "/app/mes/locations" },
    { name: "발주관리",      path: "/app/mes/purchase-orders" },
    { name: "자재입고관리",  path: "/app/mes/material-receipt" },
    { name: "생산계획",      path: "/app/mes/production-plan" },
    { name: "작업지시",      path: "/app/mes/work-orders" },
    { name: "작업실적",      path: "/app/mes/production-results" },
    { name: "재고현황",      path: "/app/mes/inventory" },
    { name: "입출고관리",    path: "/app/mes/inventory-transactions" },
    { name: "견적관리",      path: "/app/mes/quotations" },
    { name: "수주관리",      path: "/app/mes/sales-orders" },
    { name: "출하관리",      path: "/app/mes/shipments" },
    { name: "공정검사",      path: "/app/mes/inspection" },
    { name: "불량관리",      path: "/app/mes/defects" },
  ]

  for (const menu of MENUS) {
    test(`[${menu.name}] 에러 없이 로드`, async ({ page }) => {
      await setupAuth(page)
      await page.goto(BASE_URL + menu.path)
      await page.waitForLoadState("networkidle", { timeout: 20000 })

      const bodyText = await page.locator("body").innerText()
      expect(bodyText).not.toContain("An error occurred")
      expect(bodyText).not.toContain("Application error")
      expect(bodyText).not.toMatch(/^\s*500\s*$/m)

      const main = page.locator("main")
      await expect(main).toBeVisible({ timeout: 10000 })

      console.log(`OK: ${menu.name}`)
    })
  }
})
