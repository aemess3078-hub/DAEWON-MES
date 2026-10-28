/**
 * 5단계 7: 실제 Next 서버 + 실제 POP PIN 세션/관리자 세션 + 실제 DB + 가짜 카메라로
 * 현장 POP(/pop/work-select)와 관리자 POP(/app/pop/work-queue)의 [WIP QR 스캔]을 검증한다.
 * QR 조회만으로 작업이 시작되거나 실적이 등록되지 않는지 DB 로 확인한다.
 */
import { chromium } from "playwright-core"
import { assertTarget, check, cookieJar, fixtures, loginAs, logout, prisma, summary, TENANT_ID, testPopPin } from "./lib"
import { workOrderWithWip } from "./03-wip-pop"

const BASE = process.env.UI_BASE ?? "http://localhost:3130"
const INIT = `
  window.__nextQr = null;
  window.BarcodeDetector = class {
    static async getSupportedFormats() { return ["qr_code"] }
    constructor() {}
    async detect() { return window.__nextQr ? [{ rawValue: window.__nextQr }] : [] }
  };
`

async function main() {
  assertTarget()
  const fx = await fixtures()
  const pop = require("../../src/lib/actions/pop.actions") as typeof import("../../src/lib/actions/pop.actions")
  const t = await workOrderWithWip(fx, 10)
  const t2 = await workOrderWithWip(fx, 10) // 목록에 다른 작업지시가 함께 있어야 "그 작업지시만 표시"가 의미 있다
  const wipQr = `DAEWON|WIP|1|${t.wip.id}`
  const snap = async () =>
    JSON.stringify({
      ops: await prisma.workOrderOperation.findMany({ where: { workOrderId: { in: [t.wo.id, t2.wo.id] } }, orderBy: { id: "asc" }, select: { id: true, status: true, completedQty: true, startedAt: true } }),
      results: await prisma.productionResult.count({ where: { workOrderOperation: { workOrderId: { in: [t.wo.id, t2.wo.id] } } } }),
      wip: await prisma.wipUnit.findMany({ where: { workOrderId: { in: [t.wo.id, t2.wo.id] } }, orderBy: { id: "asc" }, select: { id: true, status: true } }),
    })
  const s0 = await snap()

  // 실제 PIN 로그인으로 현장 작업자 세션 쿠키 확보(앱 함수가 만든 쿠키 값을 브라우저에 그대로 전달)
  logout()
  const worker = await pop.popLogin(testPopPin(), TENANT_ID)
  const workerCookie = cookieJar().get("nmes-pop-worker-session")
  check("PU0", !!worker && !!workerCookie, "실제 POP PIN 로그인으로 작업자 세션 쿠키 확보")
  const jwt = require("../../src/lib/jwt") as typeof import("../../src/lib/jwt")
  const adminToken = jwt.signAuthToken({ profileId: fx.operator.profileId, tenantId: TENANT_ID, loginId: fx.operator.loginId, email: fx.operator.email, name: fx.operator.name, role: "OPERATOR", mustChangePw: false })
  loginAs(fx.operator)

  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] })
  const run = async (label: string, cookies: Array<{ name: string; value: string }>, path: string, cardText: (page: import("playwright-core").Page) => Promise<string[]>) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, permissions: ["camera"] })
    await context.addInitScript(INIT)
    await context.addCookies(cookies.map((c) => ({ ...c, url: BASE, httpOnly: true, sameSite: "Strict" as const })))
    const page = await context.newPage()
    page.setDefaultTimeout(25000)
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(String(e)))
    await page.goto(`${BASE}${path}`)
    await page.waitForSelector('[data-testid="pop-wip-qr-button"]')
    const before = await cardText(page)
    check(`${label}-1`, before.some((x) => x.includes(t.wo.orderNo)) && before.some((x) => x.includes(t2.wo.orderNo)), `[${label}] 목록에 작업지시 ${t.wo.orderNo}, ${t2.wo.orderNo} 모두 표시(QR 전 ${before.length}건)`)
    await page.evaluate((v) => ((window as unknown as { __nextQr: string | null }).__nextQr = v), wipQr)
    await page.click('[data-testid="pop-wip-qr-button"]')
    await page.waitForSelector('[data-testid="pop-wip-qr-message"][data-tone="success"]', { timeout: 20000 })
    await page.evaluate(() => ((window as unknown as { __nextQr: string | null }).__nextQr = null))
    const after = await cardText(page)
    check(`${label}-2`, after.some((x) => x.includes(t.wo.orderNo)) && (label !== "현장POP" || after.length === 1), `[${label}] 실제 서버 WIP QR 조회 → 그 WIP 의 작업지시 ${t.wo.orderNo} 만 표시`, after)
    const message = await page.locator('[data-testid="pop-wip-qr-message"]').innerText()
    check(`${label}-3`, message.includes("QR 스캔만으로는 작업이 시작되지 않습니다"), `[${label}] 안내: 작업은 직접 시작해야 함`)
    check(`${label}-4`, (await snap()) === s0, `[${label}] [QR 조회만으로 작업 시작/실적 등록 없음] 실제 DB 의 공정 상태·실적·WIP 변화 없음`)
    // 잘못된 QR / LOT QR
    await page.evaluate(() => ((window as unknown as { __nextQr: string | null }).__nextQr = "DAEWON|LOT|1|ZT5-X"))
    await page.click('[data-testid="pop-wip-qr-clear"]')
    await page.click('[data-testid="pop-wip-qr-button"]')
    await page.waitForSelector('[data-testid="pop-wip-qr-message"][data-tone="error"]', { timeout: 20000 })
    check(`${label}-5`, (await page.locator('[data-testid="pop-wip-qr-message"]').innerText()).includes("LOT QR"), `[${label}] LOT QR 는 POP 에서 거부`)
    check(`${label}-6`, errors.length === 0, `[${label}] 페이지 오류 없음 ${errors.slice(0, 1).join("")}`)
    await context.close()
  }
  // 현장 태블릿 POP: 작업지시 카드(button) 목록
  await run("현장POP", [{ name: "nmes-pop-worker-session", value: workerCookie!.valueOf() as string }], "/pop/work-select", (page) => page.locator("button.rounded-2xl").allInnerTexts())
  // 관리자 웹 POP 작업대기
  await run("관리자POP", [{ name: "nmes-session", value: adminToken }], "/app/pop/work-queue", (page) => page.locator("[data-workorder-id]").allInnerTexts())
  await browser.close()
  summary("pop-ui")
}
if (require.main === module) {
  main()
    .catch((e) => {
      console.error("실패:", String((e as Error).message).split("\n").slice(-6).join(" | "))
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
