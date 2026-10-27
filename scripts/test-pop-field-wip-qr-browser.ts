/**
 * 현장 태블릿 POP(/pop/work-select) [WIP QR 스캔] 브라우저 테스트 — 실제 Chrome + 가짜 카메라 + 내장 QR 디코더 모킹. 서버/DB/로그인 불필요.
 *
 * 점검 화면(/label-print/scan/pop-field)은 실제 현장 화면 컴포넌트(WorkSelectClient)·공통 QR 스캐너·WIP 판정 규칙을 그대로 쓰고
 * 작업지시 목록과 서버 조회만 가짜로 대체한다. 카드를 누르면 실제 화면처럼 /pop/production/<공정ID> 로 이동하므로
 * "스캔만으로 화면 이동·서버 액션이 없다"와 "카드를 직접 누르면 수동 선택과 똑같이 이동한다"를 URL·네트워크 요청으로 직접 확인한다.
 * production build 로 돌릴 때는 서버를 ENABLE_QR_DEV_PAGES=true 로 띄운다.
 *
 *   LABEL_TEST_URL=http://localhost:3123 npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true}' --project tsconfig.json scripts/test-pop-field-wip-qr-browser.ts
 *
 * 한계: POP 작업자 PIN 로그인 세션·DB 가 있는 실제 현장 화면, 실제 Android 태블릿·카메라, 라벨 인식 품질은 검증하지 못한다.
 *       (POP 작업자 세션과 관리자 세션의 서버 조회 차이는 scripts/test-pop-wip-qr.ts 가 가짜 DB 로 검증한다.)
 */
import assert from "node:assert/strict"
import { chromium, type Browser, type Page, type Request } from "playwright-core"

const BASE = process.env.LABEL_TEST_URL ?? "http://localhost:3123"
const URL_PAGE = `${BASE}/label-print/scan/pop-field`

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
// 작업지시 카드 = 기존 카드 버튼(rounded-2xl)
const cards = (page: Page) => page.locator("button.rounded-2xl")
const cardCount = (page: Page) => cards(page).count()
const cardOrderNos = async (page: Page) => (await cards(page).allInnerTexts()).map((t) => /WO-\d{4}/.exec(t)?.[0] ?? "?")

async function scan(page: Page, raw: string) {
  await page.evaluate((v) => ((window as unknown as { __nextQr: string | null }).__nextQr = v), raw)
  await page.click('[data-testid="pop-wip-qr-button"]')
}
async function stopScan(page: Page) {
  await page.evaluate(() => ((window as unknown as { __nextQr: string | null }).__nextQr = null))
}
async function newPage(browser: Browser, extra = "", viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, permissions: ["camera"] })
  await context.addInitScript(INIT + extra)
  const page = await context.newPage()
  const errors: string[] = []
  const actionRequests: string[] = []
  const navigations: string[] = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("request", (req: Request) => {
    if (req.method() === "POST" && req.headers()["next-action"]) actionRequests.push(req.headers()["next-action"])
  })
  await page.goto(URL_PAGE)
  await page.waitForSelector('[data-testid="pop-wip-qr-button"]')
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url())
  })
  return { context, page, errors, actionRequests, navigations }
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
    const { context, page, errors, actionRequests, navigations } = await newPage(browser)
    const startUrl = page.url()
    ok((await page.locator('[data-testid="pop-wip-qr-button"]').boundingBox())!.height >= 52, "1 [WIP QR 스캔] 버튼은 현장 태블릿용 큰 터치 영역(≥52px)")
    ok((await cardCount(page)) === 3 && (await cardOrderNos(page)).join() === "WO-0001,WO-0002,WO-0003", "2 초기: 기존 작업지시 카드 3개")

    // 정상 WIP QR → 기존 카드만 표시(새 카드를 만들지 않는다)
    await scan(page, wip("WIP-ROOT-1"))
    ok(await messageIs(page, "success", "WO-0001"), "3 [정상 WIP QR] 서버 조회 성공 → 작업지시 WO-0001 표시 안내")
    const msg = await text(page, "pop-wip-qr-message")
    ok(msg.includes("카드를 직접 눌러") && msg.includes("QR 스캔만으로는 작업이 시작되지 않습니다"), "4 안내에 '카드를 직접 눌러 이동'과 '스캔만으로 작업이 시작되지 않는다'를 명시")
    ok((await cardCount(page)) === 1 && (await cardOrderNos(page)).join() === "WO-0001", "5 [기존 카드 재사용] 그 WIP 의 작업지시 카드 1개만 표시된다(새 카드 없음)")
    const cardText = (await cards(page).first().innerText()).replace(/\s+/g, " ")
    ok(cardText.includes("완제품 1") && cardText.includes("절삭 → 연마") && cardText.includes("대기"), `6 표시된 카드는 기존 카드와 같은 내용(품목·공정 흐름·상태): ${cardText.slice(0, 60)}`)
    const chip = await text(page, "pop-wip-qr-selected")
    ok(chip.includes("WO-0001") && chip.includes("제조번호 26A01") && chip.includes("QR 검색 해제"), `7 선택 칩에 작업지시·제조번호·[QR 검색 해제] 버튼: ${chip.replace(/\s+/g, " ")}`)
    ok((await calls(page)) === 1, "8 서버 조회는 정확히 1회")
    ok(page.url() === startUrl && navigations.length === 0, "9 [스캔만으로 화면 이동 없음] 스캔 후에도 같은 화면(URL 변경·페이지 이동 0회)")
    ok(actionRequests.length === 0, "10 [스캔만으로 작업 시작·실적 등록 없음] 서버 액션 요청이 한 건도 나가지 않았다")
    ok(await waitFor(async () => (await live(page)) === 0, 3000), "11 스캔 성공 후 카메라 종료")
    await stopScan(page)

    // QR 검색 해제 → 전체 목록
    await page.click('[data-testid="pop-wip-qr-clear"]')
    ok((await cardCount(page)) === 3 && (await page.locator('[data-testid="pop-wip-qr-selected"]').count()) === 0, "12 [QR 검색 해제] 전체 작업지시 목록으로 돌아간다")

    // LOT QR 거부 / 잘못된 QR
    const before = await calls(page)
    await scan(page, lot("LOT-A-1"))
    ok(await messageIs(page, "error", "LOT QR 은 POP 작업지시 선택에 사용할 수 없습니다"), "13 [LOT QR 거부] 안내")
    ok((await calls(page)) === before && (await cardCount(page)) === 3, "14 LOT QR 은 서버 조회도 목록 변경도 하지 않는다")
    await stopScan(page)
    for (const [raw, snippet] of [
      ["HELLO", "대원정밀 MES QR 형식이 아닙니다"],
      ["DAEWON|BATCH|1|X", "지원하지 않는 QR 종류"],
      ["DAEWON|WIP|9|WIP-ROOT-1", "지원하지 않는 QR 버전"],
      ["DAEWON|WIP|1|", "식별값이 올바르지 않습니다"],
    ] as const) {
      await scan(page, raw)
      await page.waitForSelector('[data-testid="qr-scanner-invalid"]', { timeout: 8000 })
      ok((await text(page, "qr-scanner-invalid")).includes(snippet) && (await calls(page)) === before, `15 [잘못된 QR 거부] ${raw} → "${snippet}" · 서버 조회 없음`)
      await page.click('[data-testid="qr-scanner-close"]')
      await stopScan(page)
    }

    // 서버가 거부하는 WIP — 목록 그대로, 다른 작업지시를 대신 고르지 않는다
    for (const [value, label, snippet] of [
      ["WIP-GONE", "존재하지 않는/다른 tenant 의 WIP", "등록되지 않은 WIP"],
      ["WIP-OTHER-SITE", "다른 작업장의 WIP", "해당 작업장의 작업만 처리"],
      ["WIP-CHILD", "하위(재작업) WIP", "하위 WIP"],
      ["WIP-SCRAP", "폐기 WIP", "폐기된 WIP"],
      ["WIP-DONE", "종결 WIP", "종결된 WIP"],
      ["WIP-AMB", "원본 WIP 가 여러 건인 작업지시", "여러 건"],
      ["WIP-NOT-IN-LIST", "이 화면 목록에 없는 작업지시", "작업 목록에 없습니다"],
    ] as const) {
      await scan(page, wip(value))
      ok(await messageIs(page, "error", snippet), `16 [${label}] 거부 안내: "${snippet}"`)
      ok((await cardCount(page)) === 3 && (await page.locator('[data-testid="pop-wip-qr-selected"]').count()) === 0, `17 [${label}] 기존 목록 3개 그대로 · 다른 작업지시를 대신 고르지 않는다`)
      await stopScan(page)
    }
    await scan(page, wip("WIP-ERROR"))
    ok(await messageIs(page, "error", "목록에서 직접 선택") && (await cardCount(page)) === 3, "18 서버 조회 오류 시 수동 선택 안내 · 목록 유지")
    await stopScan(page)
    ok(actionRequests.length === 0 && page.url() === startUrl && navigations.length === 0, "19 거부·오류 경로에서도 서버 액션 요청 0건 · 화면 이동 0회")

    // 보류 WIP
    await scan(page, wip("WIP-HOLD"))
    ok(await messageIs(page, "success", "보류 중입니다") && (await cardOrderNos(page)).join() === "WO-0003", "20 [보류 WIP] 작업지시 카드는 표시하고 '보류 중' 안내")
    await stopScan(page)
    ok(errors.length === 0, `21 페이지 오류 없음 ${errors.join(" | ")}`)
    await context.close()
  }

  // QR 로 표시한 카드를 직접 누르면 수동 선택과 똑같이 이동
  {
    const qr = await newPage(browser)
    await scan(qr.page, wip("WIP-ROOT-1"))
    await messageIs(qr.page, "success", "WO-0001")
    await stopScan(qr.page)
    ok(qr.page.url() === `${BASE}/label-print/scan/pop-field` || qr.page.url() === URL_PAGE, "22 QR 로 카드를 표시한 직후에도 아직 이동하지 않았다")
    await qr.page.locator("button.rounded-2xl").first().click()
    const viaQr = await waitFor(async () => qr.page.url().includes("/pop/production/"), 10000)
    const qrUrl = new URL(qr.page.url())
    await qr.context.close()

    const manual = await newPage(browser)
    await manual.page.locator("button.rounded-2xl", { hasText: "WO-0001" }).first().click()
    const viaManual = await waitFor(async () => manual.page.url().includes("/pop/production/"), 10000)
    const manualUrl = new URL(manual.page.url())
    ok(viaQr && viaManual && qrUrl.pathname === manualUrl.pathname && qrUrl.search === manualUrl.search && qrUrl.pathname === "/pop/production/op-1" && qrUrl.search === "?assignmentId=asg-1", `23 [QR 선택 = 수동 선택] 카드를 직접 누르면 두 방식 모두 같은 주소(${qrUrl.pathname}${qrUrl.search})로 이동한다 — 이동 로직 동일`)
    await manual.context.close()
  }

  // 조회 중 중복 요청 방지 / 연속 인식
  {
    const { context, page } = await newPage(browser)
    await scan(page, wip("WIP-SLOW"))
    ok(await waitFor(async () => (await text(page, "pop-wip-qr-button")).includes("조회 중"), 3000) && (await page.locator('[data-testid="pop-wip-qr-button"]').isDisabled()), "24 조회 중에는 [조회 중…] 표시 · 스캔 버튼 비활성(중복 요청 방지)")
    ok(await messageIs(page, "success", "WO-0001", 6000) && (await calls(page)) === 1, "25 [스캔 연속 실행] 같은 QR 이 계속 보여도 서버 조회는 1회")
    await context.close()
  }
  {
    const { context, page } = await newPage(browser)
    await scan(page, wip("WIP-ROOT-2"))
    await page.waitForTimeout(2000)
    ok((await calls(page)) === 1 && (await cardOrderNos(page)).join() === "WO-0002", "26 연속 인식 상태에서도 조회 1회 · 진행중 작업지시 WO-0002 표시")
    await context.close()
  }

  // 카메라 권한 거부 / 카메라 없음 — 기존 목록으로 업무 가능
  {
    const deny = `navigator.mediaDevices.getUserMedia = async () => { const e = new Error("denied"); e.name = "NotAllowedError"; throw e }`
    const { context, page, errors } = await newPage(browser, deny)
    await page.click('[data-testid="pop-wip-qr-button"]')
    await page.waitForSelector('[data-testid="qr-scanner-error"]', { timeout: 8000 })
    ok((await page.locator('[data-testid="qr-scanner-error"]').getAttribute("data-code")) === "PERMISSION_DENIED", "27 [카메라 권한 거부] 안내 표시")
    await page.click('[data-testid="qr-scanner-close"]')
    ok((await cardCount(page)) === 3 && (await calls(page)) === 0, "28 권한 거부 후에도 기존 작업지시 목록 3개 그대로 · 서버 조회 없음")
    await page.locator("button.rounded-2xl", { hasText: "WO-0002" }).first().click()
    ok(await waitFor(async () => page.url().includes("/pop/production/op-3"), 10000), "29 [QR 없이 기존 방식으로 업무 진행] 카드를 눌러 작업 화면(/pop/production/op-3)으로 이동")
    ok(errors.filter((e) => !e.includes("production")).length === 0, "30 권한 거부 시나리오 페이지 오류 없음(작업 화면 자체의 서버 오류는 제외)")
    await context.close()
  }
  {
    const none = `Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true })`
    const { context, page } = await newPage(browser, none)
    await page.click('[data-testid="pop-wip-qr-button"]')
    await page.waitForSelector('[data-testid="qr-scanner-error"]', { timeout: 8000 })
    await page.click('[data-testid="qr-scanner-close"]')
    await page.locator("button.rounded-2xl", { hasText: "WO-0003" }).first().click()
    ok(await waitFor(async () => page.url().includes("/pop/production/op-4"), 10000), "31 카메라 API 가 없는 기기에서도 카드를 눌러 기존처럼 작업 화면으로 이동할 수 있다")
    await context.close()
  }

  // 세로 태블릿(768x1024) / 모바일 레이아웃
  for (const viewport of [{ width: 768, height: 1024 }, { width: 393, height: 727 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, permissions: ["camera"] })
    await context.addInitScript(INIT)
    const page = await context.newPage()
    await page.goto(URL_PAGE)
    await page.waitForSelector('[data-testid="pop-wip-qr-button"]')
    await scan(page, wip("WIP-ROOT-1"))
    await messageIs(page, "success", "WO-0001")
    const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth }))
    ok(m.overflow <= 1, `32 ${viewport.width}px 폭 가로 넘침 없음(스캔 결과 표시 후에도)`)
    await context.close()
  }

  await browser.close()
  console.log(`\n${passed} browser checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
