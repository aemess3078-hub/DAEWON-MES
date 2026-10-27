/**
 * POP 작업대기 [WIP QR 스캔] 브라우저 테스트 — 실제 Chrome + 가짜 카메라 + 내장 QR 디코더 모킹. 서버/DB/로그인 불필요.
 *
 * 점검 화면(/label-print/scan/pop-wip)은 실제 POP 작업대기 컴포넌트(WorkQueueClient)·공통 QR 스캐너·WIP 판정 규칙을 그대로 쓰고
 * 목록 데이터와 서버 조회만 가짜로 대체한다. [작업시작]/[실적등록]은 실제 서버 액션을 그대로 호출하므로(로그인이 없어 처리는 실패한다)
 * "스캔만으로는 서버 액션 요청이 한 건도 나가지 않는다"를 네트워크 요청으로 직접 확인한다.
 * production build 로 돌릴 때는 서버를 ENABLE_QR_DEV_PAGES=true 로 띄운다.
 *
 *   LABEL_TEST_URL=http://localhost:3123 npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true}' --project tsconfig.json scripts/test-pop-wip-qr-browser.ts
 *
 * 한계: 로그인/DB 가 있는 실제 POP 작업대기 화면, 실제 Android 기기·카메라, 실제 라벨 인식 품질은 검증하지 못한다.
 */
import assert from "node:assert/strict"
import { chromium, type Browser, type Page, type Request } from "playwright-core"

const BASE = process.env.LABEL_TEST_URL ?? "http://localhost:3123"
const URL_PAGE = `${BASE}/label-print/scan/pop-wip`

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}

const wip = (id: string) => `DAEWON|WIP|1|${id}`
const lot = (id: string) => `DAEWON|LOT|1|${id}`

const INIT = `
  window.__nextQr = null;
  window.__streams = [];
  window.BarcodeDetector = class {
    static async getSupportedFormats() { return ["qr_code"] }
    constructor() {}
    async detect() { return window.__nextQr ? [{ rawValue: window.__nextQr }] : [] }
  };
  (function () {
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) return;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async function (c) { const s = await orig(c); window.__streams.push(s); return s; };
  })();
`

async function text(page: Page, testId: string) {
  return (await page.locator(`[data-testid="${testId}"]`).first().innerText()).trim()
}
async function waitFor(fn: () => Promise<boolean>, timeoutMs = 10000, stepMs = 80) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return false
}
const live = (page: Page) => page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length)
const calls = async (page: Page) => Number(await text(page, "lookup-calls"))
const cards = (page: Page) => page.locator("article[data-workorder-id]").count()
const cardOrders = async (page: Page) => Array.from(new Set(await page.locator("article[data-workorder-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-workorder-id")))))

async function scan(page: Page, raw: string) {
  await page.evaluate((v) => ((window as unknown as { __nextQr: string | null }).__nextQr = v), raw)
  await page.click('[data-testid="pop-wip-qr-button"]')
}
async function stopScan(page: Page) {
  await page.evaluate(() => ((window as unknown as { __nextQr: string | null }).__nextQr = null))
}
async function newPage(browser: Browser, extra = "") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["camera"] })
  await context.addInitScript(INIT + extra)
  const page = await context.newPage()
  const errors: string[] = []
  const actionRequests: string[] = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("request", (req: Request) => {
    // 서버 액션 호출은 Next-Action 헤더가 붙은 POST 다
    if (req.method() === "POST" && req.headers()["next-action"]) actionRequests.push(req.headers()["next-action"])
  })
  await page.goto(URL_PAGE)
  await page.waitForSelector('[data-testid="pop-wip-qr-button"]')
  return { context, page, errors, actionRequests }
}
async function messageIs(page: Page, tone: string, includes: string, timeout = 8000) {
  return waitFor(async () => {
    const el = page.locator('[data-testid="pop-wip-qr-message"]')
    if ((await el.count()) === 0) return false
    return (await el.getAttribute("data-tone")) === tone && (await el.innerText()).includes(includes)
  }, timeout)
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream=device-count=2", "--use-fake-ui-for-media-stream"] })

  {
    const { context, page, errors, actionRequests } = await newPage(browser)
    ok((await page.locator('[data-testid="pop-wip-qr-button"]').boundingBox())!.height >= 44, "1 [WIP QR 스캔] 버튼은 터치하기 쉬운 크기(≥44px)")
    ok((await cards(page)) === 4 && (await cardOrders(page)).length === 3, "2 초기: 기존 작업대기 목록 — 공정 카드 4개(작업지시 3건)")
    // 스캔 전에 필터/검색어를 걸어 둔다 → 찾은 작업지시가 가려지지 않아야 한다
    await page.click('button:has-text("진행중")')
    await page.fill('input[placeholder*="작업지시번호"]', "WO-0002")
    ok((await cards(page)) === 1, "3 수동 검색/필터는 기존처럼 동작(진행중 + WO-0002 → 1건)")

    // 1·2. 정상 WIP QR → 그 작업지시를 목록에 표시
    await scan(page, wip("WIP-ROOT-1"))
    ok(await messageIs(page, "success", "WO-0001"), "4 [정상 WIP QR] 서버 조회 성공 → 작업지시 WO-0001 표시 안내")
    const msg = await text(page, "pop-wip-qr-message")
    ok(msg.includes("QR 스캔만으로는 작업이 시작되지 않습니다") && msg.includes("[작업시작]"), "5 안내에 '스캔만으로 작업이 시작되지 않는다'와 직접 눌러야 할 버튼을 명시")
    ok((await cards(page)) === 2 && (await cardOrders(page)).join() === "wo-1", "6 목록에는 그 WIP 의 작업지시(wo-1)의 공정 카드 2개만 표시된다")
    ok((await page.locator('input[placeholder*="작업지시번호"]').inputValue()) === "", "7 찾은 작업지시가 가려지지 않도록 검색어는 비워지고 전체 보기로 돌아간다")
    const chip = await text(page, "pop-wip-qr-selected")
    ok(chip.includes("WO-0001") && chip.includes("[FG-1]") && chip.includes("제조번호 26A01") && chip.includes("WIP 대기") && chip.includes("1. 절삭"), `8 선택 칩에 작업지시·품목·제조번호·WIP 상태·현재 공정 표시: ${chip.replace(/\s+/g, " ")}`)
    ok((await calls(page)) === 1, "9 서버 조회는 정확히 1회")
    ok(actionRequests.length === 0, "10 [QR 스캔만으로 작업 상태 변경 없음] 서버 액션 요청(작업시작·실적등록 등)이 한 건도 나가지 않았다")
    ok(await waitFor(async () => (await live(page)) === 0, 3000), "11 스캔 성공 후 카메라 종료")
    await stopScan(page)

    // 해제 → 전체 목록
    await page.click('[data-testid="pop-wip-qr-clear"]')
    ok((await cards(page)) === 4 && (await page.locator('[data-testid="pop-wip-qr-selected"]').count()) === 0, "12 [QR 표시 해제] 전체 작업대기 목록으로 돌아간다")

    // 3. LOT QR 거부
    const before = await calls(page)
    await scan(page, lot("LOT-A-1"))
    ok(await messageIs(page, "error", "LOT QR 은 POP 작업지시 선택에 사용할 수 없습니다"), "13 [LOT QR 거부] POP 에서 사용할 수 없다는 안내")
    ok((await calls(page)) === before && (await cards(page)) === 4, "14 LOT QR 은 서버 조회도 하지 않고 목록도 바꾸지 않는다")
    await stopScan(page)

    // 잘못된 QR 형식(스캐너 단계 거부)
    for (const [raw, snippet] of [
      ["HELLO", "대원정밀 MES QR 형식이 아닙니다"],
      ["DAEWON|BATCH|1|X", "지원하지 않는 QR 종류"],
      ["DAEWON|WIP|9|WIP-ROOT-1", "지원하지 않는 QR 버전"],
      ["DAEWON|WIP|1|", "식별값이 올바르지 않습니다"],
    ] as const) {
      await scan(page, raw)
      await page.waitForSelector('[data-testid="qr-scanner-invalid"]', { timeout: 8000 })
      ok((await text(page, "qr-scanner-invalid")).includes(snippet), `15 [잘못된 QR 거부] ${raw} → "${snippet}" · 스캔 유지`)
      ok((await calls(page)) === before, "16 거부된 QR 은 서버 조회로 이어지지 않는다")
      await page.click('[data-testid="qr-scanner-close"]')
      await stopScan(page)
    }

    // 서버가 거부하는 WIP — 목록/필터/검색어 변경 없음
    await page.fill('input[placeholder*="작업지시번호"]', "WO-0003")
    const state0 = JSON.stringify({ n: await cards(page), o: await cardOrders(page), k: await page.locator('input[placeholder*="작업지시번호"]').inputValue() })
    for (const [value, label, snippet] of [
      ["WIP-GONE", "존재하지 않는/다른 tenant 의 WIP", "등록되지 않은 WIP"],
      ["WIP-CHILD", "하위(재작업) WIP", "하위 WIP"],
      ["WIP-SCRAP", "폐기 WIP", "폐기된 WIP"],
      ["WIP-DONE", "종결 WIP", "종결된 WIP"],
      ["WIP-AMB", "원본 WIP 가 여러 건인 작업지시", "여러 건"],
      ["WIP-NOT-IN-LIST", "현재 목록에 없는 작업지시", "작업 목록에 없습니다"],
    ] as const) {
      await scan(page, wip(value))
      ok(await messageIs(page, "error", snippet), `17 [${label}] 거부 안내: "${snippet}"`)
      ok(JSON.stringify({ n: await cards(page), o: await cardOrders(page), k: await page.locator('input[placeholder*="작업지시번호"]').inputValue() }) === state0 && (await page.locator('[data-testid="pop-wip-qr-selected"]').count()) === 0, `18 [${label}] 기존 목록·검색어는 그대로, 다른 작업지시를 대신 고르지 않는다`)
      await stopScan(page)
    }
    // 서버 오류(예외)
    await scan(page, wip("WIP-ERROR"))
    ok(await messageIs(page, "error", "목록에서 직접 선택"), "19 서버 조회 오류 시 수동 선택 안내")
    ok(JSON.stringify({ n: await cards(page), k: await page.locator('input[placeholder*="작업지시번호"]').inputValue() }) === JSON.stringify({ n: 1, k: "WO-0003" }), "20 서버 오류에도 기존 검색어/목록 유지")
    await stopScan(page)
    ok(actionRequests.length === 0, "21 거부·오류 경로에서도 서버 액션 요청이 한 건도 없다")

    // 보류 WIP: 표시하되 보류 안내
    await scan(page, wip("WIP-HOLD"))
    ok(await messageIs(page, "success", "보류 중입니다"), "22 [보류 WIP] 작업지시는 표시하고 '보류 중' 안내")
    ok((await cardOrders(page)).join() === "wo-3", "23 보류 WIP 의 작업지시(wo-3)만 표시")
    await stopScan(page)
    ok(errors.length === 0, `24 페이지 오류 없음 ${errors.join(" | ")}`)
    await context.close()
  }

  // QR 로 작업지시를 표시한 뒤에도 작업 시작은 수동 클릭 + 기존 서버 액션 1회
  {
    const { context, page, actionRequests } = await newPage(browser)
    await scan(page, wip("WIP-ROOT-1"))
    await messageIs(page, "success", "WO-0001")
    await stopScan(page)
    ok(actionRequests.length === 0, "25 QR 선택 직후까지 서버 액션 요청 0건")
    const startButtons = page.locator('button:has-text("작업시작")')
    ok((await startButtons.count()) === 1, "26 표시된 작업지시의 작업 가능한 공정에 기존 [작업시작] 버튼이 그대로 있다(자동 시작 없음)")
    await startButtons.first().click()
    ok(await waitFor(async () => actionRequests.length === 1, 8000), "27 [작업시작]을 직접 누르면 기존 서버 액션이 정확히 1회 호출된다(QR 전용 경로 없음)")
    await context.close()
  }
  {
    // 비교: QR 없이 수동으로 같은 버튼을 눌러도 동일(요청 1회)
    const { context, page, actionRequests } = await newPage(browser)
    await page.fill('input[placeholder*="작업지시번호"]', "WO-0001")
    await page.locator('button:has-text("작업시작")').first().click()
    ok(await waitFor(async () => actionRequests.length === 1, 8000) && (await calls(page)) === 0, "28 [QR 없이 기존 방식] 검색 → [작업시작] 도 같은 서버 액션 1회 · WIP 조회 0회")
    await context.close()
  }

  // 조회 중 중복 요청 방지 / 연속 인식
  {
    const { context, page } = await newPage(browser)
    await scan(page, wip("WIP-SLOW"))
    ok(await waitFor(async () => (await text(page, "pop-wip-qr-button")).includes("조회 중"), 3000), "29 조회 중 상태 표시([조회 중…])")
    ok(await page.locator('[data-testid="pop-wip-qr-button"]').isDisabled(), "30 조회 중에는 스캔 버튼 비활성(중복 요청 방지)")
    ok(await messageIs(page, "success", "WO-0001", 6000), "31 조회 완료 후 작업지시 표시")
    ok((await calls(page)) === 1, "32 [스캔 연속 실행] 같은 QR 이 계속 보여도 서버 조회는 1회")
    await context.close()
  }
  {
    const { context, page } = await newPage(browser)
    await scan(page, wip("WIP-ROOT-2"))
    await page.waitForTimeout(2000)
    ok((await calls(page)) === 1 && (await cardOrders(page)).join() === "wo-2", "33 연속 인식 상태에서도 조회 1회(성공 즉시 카메라 종료) · 진행중 작업지시 wo-2 표시")
    await context.close()
  }

  // 카메라 권한 거부 / 카메라 없음 — 수동 업무 가능
  {
    const deny = `navigator.mediaDevices.getUserMedia = async () => { const e = new Error("denied"); e.name = "NotAllowedError"; throw e }`
    const { context, page, errors, actionRequests } = await newPage(browser, deny)
    await page.fill('input[placeholder*="작업지시번호"]', "WO-0002")
    await page.click('[data-testid="pop-wip-qr-button"]')
    await page.waitForSelector('[data-testid="qr-scanner-error"]', { timeout: 8000 })
    ok((await page.locator('[data-testid="qr-scanner-error"]').getAttribute("data-code")) === "PERMISSION_DENIED", "34 [카메라 권한 거부] 안내 표시")
    await page.click('[data-testid="qr-scanner-close"]')
    ok((await page.locator('input[placeholder*="작업지시번호"]').inputValue()) === "WO-0002" && (await cards(page)) === 1 && (await calls(page)) === 0, "35 권한 거부 후에도 입력한 검색어·목록 유지 · 서버 조회 없음")
    await page.fill('input[placeholder*="작업지시번호"]', "WO-0003")
    await page.locator('button:has-text("작업시작")').first().click()
    ok(await waitFor(async () => actionRequests.length === 1, 8000), "36 [QR 인식 실패 후 수동 선택] 검색으로 작업지시를 고르고 기존 [작업시작]으로 업무를 진행할 수 있다")
    ok(errors.length === 0, "37 권한 거부 시나리오 페이지 오류 없음")
    await context.close()
  }
  {
    const none = `Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true })`
    const { context, page } = await newPage(browser, none)
    await page.click('[data-testid="pop-wip-qr-button"]')
    await page.waitForSelector('[data-testid="qr-scanner-error"]', { timeout: 8000 })
    await page.click('[data-testid="qr-scanner-close"]')
    await page.fill('input[placeholder*="작업지시번호"]', "WO-0001")
    ok((await cards(page)) === 2, "38 카메라 API 가 없는 환경(키오스크/구형 브라우저)에서도 기존 검색으로 작업지시 선택 가능")
    await context.close()
  }

  // 모바일 레이아웃
  {
    const context = await browser.newContext({ viewport: { width: 393, height: 727 }, hasTouch: true, isMobile: true, permissions: ["camera"] })
    await context.addInitScript(INIT)
    const page = await context.newPage()
    await page.goto(URL_PAGE)
    await page.waitForSelector('[data-testid="pop-wip-qr-button"]')
    await scan(page, wip("WIP-ROOT-1"))
    await messageIs(page, "success", "WO-0001")
    const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth }))
    ok(m.overflow <= 1, "39 모바일 폭(393px) 가로 넘침 없음(스캔 결과 표시 후에도)")
    await context.close()
  }

  await browser.close()
  console.log(`\n${passed} browser checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
