/**
 * 출하예정 등록 [QR 스캔] 연동 브라우저 테스트 — 실제 Chrome + 가짜 카메라 + 내장 QR 디코더 모킹. 서버/DB/로그인 불필요.
 *
 * 점검 화면(/label-print/scan/shipment-lot)은 실제 출하 화면과 같은 FgLotQrScan·공통 QR 스캐너·LOT 반영 규칙(planScannedFgLot)을 쓰고
 * 서버 조회만 가짜 응답으로 대체한다(서버 검증 자체는 scripts/test-shipment-fg-qr.ts 가 가짜 DB 로 검증).
 * 점검 화면은 개발용이라 `next start` 시 ENABLE_QR_DEV_PAGES=true 가 필요하다.
 *
 *   LABEL_TEST_URL=http://localhost:3123 npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true}' --project tsconfig.json scripts/test-shipment-fg-qr-browser.ts
 *
 * 한계: 실제 출하 화면(로그인/DB/react-hook-form 연결)의 클릭 흐름, 실제 Android 기기·카메라는 검증하지 못한다.
 */
import assert from "node:assert/strict"
import { chromium, type Browser, type Page } from "playwright-core"

const BASE = process.env.LABEL_TEST_URL ?? "http://localhost:3123"
const URL_PAGE = `${BASE}/label-print/scan/shipment-lot`

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}

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

type Item = "fg-a" | "fg-b"
const btn = (item: Item) => `[data-testid="harness-item-${item}"] [data-testid="shipment-qr-scan-button"]`
const msgSel = (item: Item) => `[data-testid="harness-item-${item}"] [data-testid="shipment-qr-message"]`

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
const rowCount = (page: Page, item: Item) => page.locator(`[data-testid^="harness-${item}-row-"][data-testid$="-select"]`).count()
const rowValue = (page: Page, item: Item, i: number) => page.locator(`[data-testid="harness-${item}-row-${i}-select"]`).inputValue()
const rowQty = (page: Page, item: Item, i: number) => page.locator(`[data-testid="harness-${item}-row-${i}-qty"]`).inputValue()
const state = (page: Page) => text(page, "state-snapshot")

/** 스캐너를 열고 QR 값을 인식시킨다(성공하면 대화상자가 자동으로 닫힌다). */
async function scan(page: Page, item: Item, raw: string) {
  await page.evaluate((v) => ((window as unknown as { __nextQr: string | null }).__nextQr = v), raw)
  await page.click(btn(item))
}
async function stopScan(page: Page) {
  await page.evaluate(() => ((window as unknown as { __nextQr: string | null }).__nextQr = null))
}
async function newPage(browser: Browser, extra = "", query = "") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["camera"] })
  await context.addInitScript(INIT + extra)
  const page = await context.newPage()
  const errors: string[] = []
  // Server Action 은 읽기 전용 조회라도 POST(Next-Action 헤더)로 전달된다. 요청 id 를 모아 종류를 구분한다.
  const posts: string[] = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.headers()["next-action"] ?? "(next-action 없음)")
  })
  await page.goto(URL_PAGE + query)
  await page.waitForSelector(btn("fg-a"))
  return { context, page, errors, posts }
}
async function messageIs(page: Page, item: Item, tone: string, includes: string, timeout = 8000) {
  return waitFor(async () => {
    const el = page.locator(msgSel(item))
    if ((await el.count()) === 0) return false
    return (await el.getAttribute("data-tone")) === tone && (await el.innerText()).includes(includes)
  }, timeout)
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream=device-count=2", "--use-fake-ui-for-media-stream"] })

  let qrState = ""
  {
    const { context, page, errors, posts } = await newPage(browser)
    ok((await rowCount(page, "fg-a")) === 1 && (await rowValue(page, "fg-a", 0)) === "" && (await rowQty(page, "fg-a", 0)) === "0", "1 초기: 기존 LOT 선택 행 1개 · LOT 미선택")
    ok((await page.locator(btn("fg-a")).innerText()).includes("QR 스캔") && (await page.locator(btn("fg-b")).count()) === 1, "2 [QR 스캔] 버튼이 LOT 관리 품목 행마다 'LOT 추가' 옆에 있다")
    const bb = await page.locator(btn("fg-a")).boundingBox()
    ok(bb !== null && bb.height >= 36, `3 버튼 높이 ≥ 36px (${bb?.height}px)`)

    // 정상: 완제품 LOT QR → 기존 LOT 선택 UI 반영
    await scan(page, "fg-a", lot("FG-LOT-1"))
    ok(await messageIs(page, "fg-a", "success", "FG-LOT-1"), "4 [정상 완제품 LOT QR] 서버 조회 성공 → 선택 안내")
    const msg = await text(page, "harness-item-fg-a").then(() => page.locator(msgSel("fg-a")).innerText())
    ok(msg.includes("[FG-A]") && msg.includes("완제품 A") && msg.includes("완제품창고") && msg.includes("가용 100"), `5 안내에 품목코드·품목명·LOT·창고·가용수량 표시: ${msg.slice(0, 70)}…`)
    ok(msg.includes("출하가 등록·확정되지 않습니다"), "6 안내에 'QR 스캔만으로는 출하가 등록·확정되지 않는다'고 명시")
    ok((await rowValue(page, "fg-a", 0)) === "id-FG-LOT-1", "7 [품목 일치 · 기존 LOT 선택 UI 반영] 기존 LOT 선택 상자에 반영(수동 선택과 같은 값)")
    ok((await rowQty(page, "fg-a", 0)) === "100", "8 수량은 수동 선택과 같은 제안값(min(가용 100, 미출하 150))이며 사용자가 수정할 수 있다")
    ok((await calls(page)) === 1, "9 서버 조회는 정확히 1회")
    ok((await text(page, "register-count")) === "0", "10 [스캔만으로 출하 등록/확정 없음] 출하예정 등록 호출 0")
    ok(posts.length === 0, `11 (가짜 조회 모드 한정) 점검 화면은 조회를 주입한 가짜 함수로 처리하므로 네트워크 POST 가 없다 — 이는 실제 조회 Server Action 의 요청 수를 말하지 않는다(실제 액션의 요청 모양은 아래 '?real=1' 시나리오, 서버 쓰기 없음은 단위 테스트 B25/B26) — POST ${posts.length}건`)
    ok(await waitFor(async () => (await live(page)) === 0, 3000), "12 스캔 성공 후 카메라 종료")
    await stopScan(page)
    await page.fill('[data-testid="harness-fg-a-row-0-qty"]', "70")
    ok((await rowQty(page, "fg-a", 0)) === "70", "13 [QR 선택 후 수량 수정] 출하수량을 직접 수정할 수 있다")

    // 중복
    await scan(page, "fg-a", lot("FG-LOT-1"))
    ok(await messageIs(page, "fg-a", "info", "이미 선택된 LOT"), "14 [동일 LOT 중복 선택 방지] 이미 선택된 LOT 안내")
    ok((await rowCount(page, "fg-a")) === 1 && (await rowQty(page, "fg-a", 0)) === "70", "15 중복 시 행 추가/수량 변경 없음")
    await stopScan(page)

    // Multi-LOT
    await scan(page, "fg-a", lot("FG-LOT-2"))
    ok(await messageIs(page, "fg-a", "success", "FG-LOT-2"), "16 [Multi-LOT] 두 번째 LOT 도 선택")
    ok((await rowCount(page, "fg-a")) === 2 && (await rowValue(page, "fg-a", 1)) === "id-FG-LOT-2" && (await rowValue(page, "fg-a", 0)) === "id-FG-LOT-1" && (await rowQty(page, "fg-a", 0)) === "70", "17 새 LOT 행이 추가되고 기존 행의 LOT/수량(70)은 그대로")
    ok((await rowQty(page, "fg-a", 1)) === "40", "18 새 행 수량 제안 = min(가용 40, 미출하 150 − 다른 행 70 = 80) = 40 — 다른 LOT 수량을 바꾸지 않는다")
    await stopScan(page)
    qrState = await state(page)

    // 수동 병행
    await page.click('[data-testid="harness-fg-a-add-row"]')
    await page.selectOption('[data-testid="harness-fg-a-row-2-select"]', "id-FG-LOT-MANUAL")
    ok((await rowCount(page, "fg-a")) === 3 && (await rowValue(page, "fg-a", 2)) === "id-FG-LOT-MANUAL" && (await rowQty(page, "fg-a", 2)) === "40", "19 [기존 수동 LOT 선택 정상] QR 선택과 수동 선택을 함께 쓸 수 있다(수동 선택 수량 제안 = min(60, 150−110))")
    ok((await calls(page)) === 3, "20 수동 선택은 서버 조회를 일으키지 않는다(QR 조회 3회)")

    // 거부 사례 — 모두 선택/수량 변경 없음
    const before = await calls(page)
    await scan(page, "fg-a", `DAEWON|WIP|1|wip-1`)
    ok(await messageIs(page, "fg-a", "error", "WIP QR 은 출하 화면에서 사용할 수 없습니다"), "21 [WIP QR 거부] 출하 화면 사용 불가 안내")
    ok((await calls(page)) === before, "22 WIP QR 은 서버 조회도 하지 않는다")
    await stopScan(page)
    const state0 = await state(page)
    for (const [raw, snippet] of [
      ["HELLO", "대원정밀 MES QR 형식이 아닙니다"],
      ["DAEWON|BATCH|1|X", "지원하지 않는 QR 종류"],
      ["DAEWON|LOT|9|FG-LOT-1", "지원하지 않는 QR 버전"],
      ["DAEWON|LOT|1|", "식별값이 올바르지 않습니다"],
    ] as const) {
      await scan(page, "fg-a", raw)
      await page.waitForSelector('[data-testid="qr-scanner-invalid"]', { timeout: 8000 })
      ok((await text(page, "qr-scanner-invalid")).includes(snippet), `23 [잘못된 QR 거부] ${raw} → 스캐너가 "${snippet}" 안내 · 스캔 유지`)
      ok((await calls(page)) === before, "24 거부된 QR 은 서버 조회로 이어지지 않는다")
      await page.click('[data-testid="qr-scanner-close"]')
      await stopScan(page)
    }
    for (const [value, label, snippet] of [
      ["FG-LOT-NOPE", "존재하지 않는 LOT / 다른 tenant 의 LOT", "등록되지 않은 LOT"],
      ["RM-LOT-1", "원자재 LOT", "원자재·소모품 LOT 는 출하 대상이 아닙니다"],
      ["FG-B-1", "다른 품목 LOT", "다른 품목의 LOT"],
      ["FG-LOT-QUAR", "사용이 제한된 LOT", "사용이 제한된 LOT"],
      ["FG-LOT-QFAIL", "최종검사로 출하 제한된 LOT", "최종검사 불합격"],
      ["FG-LOT-NOSTOCK", "출하 가능 재고가 없는 LOT", "출하 가능한(가용·미예약) 재고가 없는"],
      ["FG-LOT-WH2", "다른 창고 LOT", "다른 창고에 있는 LOT"],
      ["FG-LOT-STALE", "화면 가용 LOT 목록에 없는 LOT", "현재 화면의 가용 LOT 목록에 없습니다"],
    ] as const) {
      await scan(page, "fg-a", lot(value))
      ok(await messageIs(page, "fg-a", "error", snippet), `25 [${label}] 거부 안내: "${snippet}"`)
      ok((await state(page)) === state0, `26 [${label}] 기존 LOT 선택·수량은 그대로`)
      await stopScan(page)
    }
    await scan(page, "fg-a", lot("FG-LOT-ERROR"))
    ok(await messageIs(page, "fg-a", "error", "목록에서 직접 선택"), "27 서버 조회 오류 시 수동 선택 안내")
    ok((await state(page)) === state0, "28 서버 오류에도 작성 중인 데이터 유지")
    await stopScan(page)
    ok((await text(page, "register-count")) === "0", "29 어떤 스캔도 출하예정 등록 동작(점검용 [출하예정 등록] 핸들러)을 실행하지 않았다")
    ok(errors.length === 0, `30 페이지 오류 없음 ${errors.join(" | ")}`)
    await context.close()
  }

  // QR 선택 결과 = 수동 선택 결과
  {
    const { context, page } = await newPage(browser)
    await page.selectOption('[data-testid="harness-fg-a-row-0-select"]', "id-FG-LOT-1")
    await page.click('[data-testid="harness-fg-a-add-row"]')
    await page.selectOption('[data-testid="harness-fg-a-row-1-select"]', "id-FG-LOT-2")
    const manualState = JSON.parse(await state(page)) as Record<string, Array<{ lotId: string; qty: number }>>
    await context.close()
    const { context: c2, page: p2 } = await newPage(browser)
    await scan(p2, "fg-a", lot("FG-LOT-1"))
    await messageIs(p2, "fg-a", "success", "FG-LOT-1")
    await stopScan(p2)
    await scan(p2, "fg-a", lot("FG-LOT-2"))
    await messageIs(p2, "fg-a", "success", "FG-LOT-2")
    const viaQr = JSON.parse(await state(p2)) as Record<string, Array<{ lotId: string; qty: number }>>
    const strip = (s: Record<string, Array<{ lotId: string; qty: number }>>) => JSON.stringify(s["fg-a"].map((r) => ({ lotId: r.lotId, qty: r.qty })))
    ok(strip(manualState) === strip(viaQr), `31 [QR 결과 = 수동 결과] 같은 LOT 들을 QR 로 고른 결과(${strip(viaQr)})가 수동으로 고른 결과와 같다`)
    ok(qrState.includes("id-FG-LOT-1") && qrState.includes("id-FG-LOT-2"), "32 (참고) 앞선 시나리오의 QR 결과도 같은 LOT 구성")
    await c2.close()
  }

  // 입력 수량 보존: LOT 를 안 골랐지만 수량을 먼저 입력한 행
  {
    const { context, page } = await newPage(browser)
    await page.fill('[data-testid="harness-fg-a-row-0-qty"]', "30")
    await scan(page, "fg-a", lot("FG-LOT-1"))
    await messageIs(page, "fg-a", "success", "FG-LOT-1")
    ok((await rowValue(page, "fg-a", 0)) === "id-FG-LOT-1" && (await rowQty(page, "fg-a", 0)) === "30", "33 [기존 수량 보존] 수량(30)을 먼저 입력한 빈 LOT 행에 QR 로 LOT 를 고르면 수량은 그대로(제안값으로 덮어쓰지 않음)")
    await context.close()
  }

  // 품목별 행: 다른 품목 행에는 반영되지 않는다
  {
    const { context, page } = await newPage(browser)
    await scan(page, "fg-b", lot("FG-LOT-1"))
    ok(await messageIs(page, "fg-b", "error", "다른 품목의 LOT"), "34 [다른 품목 LOT] 품목 B 행에서 품목 A 의 LOT 는 거부")
    ok((await rowValue(page, "fg-b", 0)) === "" && (await rowValue(page, "fg-a", 0)) === "", "35 어느 품목 행에도 반영되지 않는다")
    await stopScan(page)
    await scan(page, "fg-b", lot("FG-B-1"))
    ok(await messageIs(page, "fg-b", "success", "FG-B-1") && (await rowValue(page, "fg-b", 0)) === "id-FG-B-1" && (await rowQty(page, "fg-b", 0)) === "25" && (await rowValue(page, "fg-a", 0)) === "", "36 품목 B 의 LOT 는 품목 B 행에만 반영(수량 제안 min(25,25))")
    await context.close()
  }

  // 창고: 다른 창고 LOT 는 창고를 맞춘 뒤에야 선택 가능 / 조회 중 창고 변경
  {
    const { context, page } = await newPage(browser)
    await page.selectOption('[data-testid="harness-warehouse"]', "wh-2")
    await scan(page, "fg-a", lot("FG-LOT-WH2"))
    ok(await messageIs(page, "fg-a", "success", "FG-LOT-WH2") && (await rowValue(page, "fg-a", 0)) === "id-FG-LOT-WH2", "37 [창고 일치] 출하 창고를 그 창고로 선택하면 같은 LOT 가 선택된다")
    await stopScan(page)
    await context.close()
  }
  {
    const { context, page } = await newPage(browser)
    await scan(page, "fg-a", lot("FG-LOT-SLOW"))
    ok(await waitFor(async () => (await page.locator(btn("fg-a")).innerText()).includes("조회 중"), 3000), "38 조회 중 상태 표시([조회 중…])")
    ok(await page.locator(btn("fg-a")).isDisabled(), "39 조회 중에는 스캔 버튼 비활성(중복 요청 방지)")
    await page.selectOption('[data-testid="harness-warehouse"]', "wh-2") // 조회 중 창고 변경
    ok(await messageIs(page, "fg-a", "error", "출하 창고 또는 품목이 바뀌어", 6000), "40 [조회 중 창고 변경] 오래된 결과를 반영하지 않고 다시 스캔하도록 안내")
    ok((await rowValue(page, "fg-a", 0)) === "" && (await calls(page)) === 1, "41 선택 변경 없음 · 서버 조회 1회")
    await context.close()
  }
  {
    // 같은 QR 이 계속 인식되는 상태에서도 조회 1회
    const { context, page } = await newPage(browser)
    await scan(page, "fg-a", lot("FG-LOT-1"))
    await page.waitForTimeout(2000)
    ok((await calls(page)) === 1, "42 [중복 스캔] 연속 인식 상태에서도 조회 1회(성공 즉시 카메라 종료)")
    await context.close()
  }

  // 카메라 권한 거부 / 카메라 API 없음 — 수동 업무 가능
  {
    const deny = `navigator.mediaDevices.getUserMedia = async () => { const e = new Error("denied"); e.name = "NotAllowedError"; throw e }`
    const { context, page, errors } = await newPage(browser, deny)
    await page.fill('[data-testid="harness-fg-a-row-0-qty"]', "20")
    await page.click(btn("fg-a"))
    await page.waitForSelector('[data-testid="qr-scanner-error"]', { timeout: 8000 })
    ok((await page.locator('[data-testid="qr-scanner-error"]').getAttribute("data-code")) === "PERMISSION_DENIED", "43 [카메라 권한 거부] 안내 표시")
    await page.click('[data-testid="qr-scanner-close"]')
    ok((await rowQty(page, "fg-a", 0)) === "20" && (await calls(page)) === 0, "44 권한 거부 후에도 작성 중이던 입력값 유지 · 서버 조회 없음")
    await page.selectOption('[data-testid="harness-fg-a-row-0-select"]', "id-FG-LOT-MANUAL")
    await page.click('[data-testid="harness-register"]')
    ok((await rowValue(page, "fg-a", 0)) === "id-FG-LOT-MANUAL" && (await text(page, "register-count")) === "1", "45 [QR 없이 기존 방식으로 출하 가능] 카메라 오류 뒤에도 수동 LOT 선택 → [출하예정 등록] 정상")
    ok(errors.length === 0, "46 권한 거부 시나리오 페이지 오류 없음")
    await context.close()
  }
  {
    const none = `Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true })`
    const { context, page } = await newPage(browser, none)
    await page.click(btn("fg-a"))
    await page.waitForSelector('[data-testid="qr-scanner-error"]', { timeout: 8000 })
    await page.click('[data-testid="qr-scanner-close"]')
    await page.selectOption('[data-testid="harness-fg-a-row-0-select"]', "id-FG-LOT-1")
    await page.click('[data-testid="harness-register"]')
    ok((await text(page, "register-count")) === "1", "47 카메라 API 가 없는 환경에서도 수동 출하 가능")
    await context.close()
  }

  // 실제 조회 Server Action(?real=1): QR 조회 요청은 허용되는 읽기 전용 POST 1건뿐이고, 등록·확정·재고 변경 요청은 없다.
  // 로그인/DB 가 없는 환경이라 서버는 조회를 거부한다(성공 경로는 단위 테스트와 실제 환경 검증 몫).
  {
    const { context, page, posts, errors } = await newPage(browser, "", "?real=1")
    await scan(page, "fg-a", lot("FG-LOT-1"))
    ok(await waitFor(async () => (await page.locator(msgSel("fg-a")).count()) > 0 && (await page.locator(msgSel("fg-a")).getAttribute("data-tone")) !== "info", 15000), "49 [실제 조회 액션] 스캔 1회 → 조회 결과(거부/오류) 안내가 표시된다")
    await page.waitForTimeout(1500)
    ok(posts.length === 1 && posts[0] !== "(next-action 없음)", `50 [QR 조회 요청] 스캔 1회당 읽기 전용 조회 Server Action POST 정확히 1건(next-action ${posts[0]?.slice(0, 12)}…) — 그 외 POST 없음(등록·확정·재고 변경 요청 0건)`)
    ok((await rowValue(page, "fg-a", 0)) === "" && (await text(page, "register-count")) === "0", "51 조회가 거부되어도 LOT 선택·수량은 그대로, 등록 동작 없음")
    // 빌드 산출물(.next)에서 요청된 Server Action id 가 어떤 export 인지 확인한다(`.next/server/...page.js` 의 id → 내보낸 함수 이름 매핑).
    const fs = await import("node:fs/promises")
    const manifest = JSON.parse(await fs.readFile(".next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { workers: Record<string, unknown> }> }
    const idsOnPage = Object.entries(manifest.node).filter(([, v]) => Object.keys(v.workers).some((w) => w.includes("label-print/scan/shipment-lot"))).map(([id]) => id)
    const pageJs = await fs.readFile(".next/server/app/label-print/scan/shipment-lot/page.js", "utf8")
    const exportName = new RegExp(`"${posts[0]}":\\(\\)=>Promise\\.resolve\\(\\)\\.then\\(\\w+\\.bind\\(\\w+,\\d+\\)\\)\\.then\\(\\w+=>\\w+\\.(\\w+)\\)`).exec(pageJs)?.[1]
    ok(exportName === "lookupLotForShipment", `52 [QR 조회 요청 = 읽기 전용 조회 액션] 요청된 Server Action 의 export 이름: ${exportName}`)
    ok(idsOnPage.length === 1 && idsOnPage[0] === posts[0], `53 점검 화면에서 호출 가능한 Server Action 은 이 조회 액션 하나뿐 — 출하예정 등록·확정·삭제·재고 변경 액션은 이 화면의 QR 경로에 연결되어 있지 않다(${idsOnPage.length}개)`)
    ok(errors.length === 0, `54 페이지 오류 없음 ${errors.join(" | ")}`)
    await context.close()
  }

  // 모바일 레이아웃
  {
    const context = await browser.newContext({ viewport: { width: 393, height: 727 }, hasTouch: true, isMobile: true, permissions: ["camera"] })
    await context.addInitScript(INIT)
    const page = await context.newPage()
    await page.goto(URL_PAGE)
    await page.waitForSelector(btn("fg-a"))
    const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth }))
    ok(m.overflow <= 1, "55 모바일 폭(393px) 가로 넘침 없음")
    await context.close()
  }

  await browser.close()
  console.log(`\n${passed} browser checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
