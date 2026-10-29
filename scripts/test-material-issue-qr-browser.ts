/**
 * 자재출고 [QR 스캔] 연동 브라우저 테스트 — 실제 Chrome + 가짜 카메라 + 내장 QR 디코더 모킹. 서버/DB/로그인 불필요.
 *
 * 점검 화면(/label-print/scan/issue-lot)은 실제 자재출고 화면과 같은 LotQrScanSection·공통 QR 스캐너·LOT 반영 규칙을 쓰고
 * 서버 조회만 가짜 응답으로 대체한다(서버 검증 자체는 scripts/test-material-issue-qr.ts 가 가짜 DB 로 검증).
 *
 *   LABEL_TEST_URL=http://localhost:3123 npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true}' --project tsconfig.json scripts/test-material-issue-qr-browser.ts
 *
 * 한계: 실제 자재출고 화면(로그인/DB)의 클릭 흐름, 실제 Android 기기·카메라는 검증하지 못한다.
 */
import assert from "node:assert/strict"
import { chromium, type Browser, type Page } from "playwright-core"

const BASE = process.env.LABEL_TEST_URL ?? "http://localhost:3123"
const URL_PAGE = `${BASE}/label-print/scan/issue-lot`

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
const rowCount = (page: Page) => page.locator('[data-testid="harness-rows"] [data-testid^="harness-row-"][data-testid$="select"]').count()
const rowValue = (page: Page, i: number) => page.locator(`[data-testid="harness-row-${i}-select"]`).inputValue()
const rowQty = (page: Page, i: number) => page.locator(`[data-testid="harness-row-${i}-qty"]`).inputValue()

/** 스캐너를 열고 QR 값을 인식시킨다(성공하면 대화상자가 자동으로 닫힌다). */
async function scan(page: Page, raw: string) {
  await page.evaluate((v) => ((window as unknown as { __nextQr: string | null }).__nextQr = v), raw)
  await page.click('[data-testid="issue-qr-scan-button"]')
}
async function stopScan(page: Page) {
  await page.evaluate(() => ((window as unknown as { __nextQr: string | null }).__nextQr = null))
}
async function newPage(browser: Browser, extra = "") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["camera"] })
  await context.addInitScript(INIT + extra)
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(String(e)))
  await page.goto(URL_PAGE)
  await page.waitForSelector('[data-testid="issue-qr-scan-button"]')
  return { context, page, errors }
}
async function messageIs(page: Page, tone: string, includes: string, timeout = 8000) {
  return waitFor(async () => {
    const el = page.locator('[data-testid="issue-qr-message"]')
    if ((await el.count()) === 0) return false
    return (await el.getAttribute("data-tone")) === tone && (await el.innerText()).includes(includes)
  }, timeout)
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream=device-count=2", "--use-fake-ui-for-media-stream"] })

  {
    const { context, page, errors } = await newPage(browser)
    ok((await page.locator('[data-testid="issue-qr-scan-button"]').boundingBox())!.height >= 44, "1 [QR 스캔] 버튼은 터치하기 쉬운 크기(≥44px)")
    ok((await rowCount(page)) === 1 && (await rowQty(page, 0)) === "50" && (await rowValue(page, 0)) === "", "2 초기: 기존 LOT 선택 행 1개 · 출고 수량 50 입력")

    // 1·2·11. 정상 LOT 인식 → 기존 LOT 선택 UI 반영 → 수량 입력
    await scan(page, lot("LOT-A-1"))
    ok(await messageIs(page, "success", "LOT-A-1"), "3 [정상 원자재 LOT QR] 서버 조회 성공 → 선택 안내(품목·LOT·창고·가용수량)")
    const msg = await text(page, "issue-qr-message")
    ok(msg.includes("[RM-A]") && msg.includes("원자재 A") && msg.includes("창고 1") && msg.includes("가용 100 KG"), `4 안내에 품목코드·품목명·LOT·창고·가용수량 표시: ${msg.slice(0, 70)}…`)
    ok((await rowValue(page, 0)) === "id-LOT-A-1:wh-1", "5 기존 LOT 선택 상자에 반영(수동 선택과 같은 값 형식)")
    ok((await rowQty(page, 0)) === "50", "6 [기존 입력 수량 유지] 스캔한 LOT 의 재고(100)를 출고 수량으로 자동 확정하지 않는다")
    ok((await calls(page)) === 1, "7 서버 조회는 정확히 1회")
    ok((await text(page, "confirm-count")) === "0" && (await text(page, "stock-snapshot")).includes("100"), "8 [스캔만으로 출고/재고 변경 없음] 출고 처리 호출 0 · 재고 값 그대로")
    ok(await waitFor(async () => (await live(page)) === 0, 3000), "9 스캔 성공 후 카메라 종료")
    await stopScan(page)
    // 수량 입력은 그대로 가능
    await page.fill('[data-testid="harness-row-0-qty"]', "35")
    ok((await rowQty(page, 0)) === "35", "10 [QR 선택 후 출고 수량 입력] 수량을 직접 수정할 수 있다")

    // 9. 중복 선택 방지
    await scan(page, lot("LOT-A-1"))
    ok(await messageIs(page, "info", "이미 선택된 LOT"), "11 [동일 LOT 중복 선택 방지] 이미 선택된 LOT 안내")
    ok((await rowCount(page)) === 1 && (await rowQty(page, 0)) === "35", "12 중복 시 행 추가/수량 변경 없음")
    await stopScan(page)

    // 10. Multi-LOT: 모든 행에 LOT 가 있으니 새 행 추가(수량 비움)
    await scan(page, lot("LOT-A-3"))
    ok(await messageIs(page, "success", "LOT-A-3"), "13 [Multi-LOT] 두 번째 LOT 도 선택")
    ok((await rowCount(page)) === 2 && (await rowValue(page, 1)) === "id-LOT-A-3:wh-1" && (await rowQty(page, 1)) === "" && (await rowValue(page, 0)) === "id-LOT-A-1:wh-1" && (await rowQty(page, 0)) === "35", "14 새 LOT 행이 추가되고(수량 비움) 기존 행/수량은 그대로")
    await stopScan(page)

    // 13. 수동 선택 병행
    await page.click('[data-testid="harness-add-row"]')
    await page.selectOption('[data-testid="harness-row-2-select"]', "id-LOT-MANUAL-1:wh-1")
    await page.fill('[data-testid="harness-row-2-qty"]', "5")
    ok((await rowCount(page)) === 3 && (await rowValue(page, 2)) === "id-LOT-MANUAL-1:wh-1" && (await rowQty(page, 2)) === "5", "15 [기존 수동 LOT 선택 정상] QR 선택과 수동 선택을 함께 쓸 수 있다")
    ok((await calls(page)) === 3, "16 수동 선택은 서버 조회를 일으키지 않는다(QR 조회 3회)")

    // 3·4. WIP QR 거부, 잘못된 QR 거부(스캐너 단계)
    const before = await calls(page)
    await scan(page, `DAEWON|WIP|1|wip-1`)
    ok(await messageIs(page, "error", "WIP QR 은 원자재 출고 화면에서 사용할 수 없습니다"), "17 [WIP QR 거부] 원자재 출고 화면 사용 불가 안내")
    ok((await calls(page)) === before && (await rowCount(page)) === 3, "18 WIP QR 은 서버 조회도 하지 않고 선택도 바꾸지 않는다")
    await stopScan(page)
    for (const [raw, snippet] of [
      ["HELLO", "대원정밀 MES QR 형식이 아닙니다"],
      ["DAEWON|BATCH|1|X", "지원하지 않는 QR 종류"],
      ["DAEWON|LOT|9|LOT-A-1", "지원하지 않는 QR 버전"],
      ["DAEWON|LOT|1|", "식별값이 올바르지 않습니다"],
    ] as const) {
      await scan(page, raw)
      await page.waitForSelector('[data-testid="qr-scanner-invalid"]', { timeout: 8000 })
      ok((await text(page, "qr-scanner-invalid")).includes(snippet), `19 [잘못된 QR 거부] ${raw} → 스캐너가 "${snippet}" 안내 · 스캔 유지`)
      ok((await calls(page)) === before, "20 거부된 QR 은 서버 조회로 이어지지 않는다")
      await page.click('[data-testid="qr-scanner-close"]')
      await stopScan(page)
    }

    // 5~8. 서버가 거부하는 LOT — 선택/행/수량 변경 없음
    const snapshot = async () => JSON.stringify({ n: await rowCount(page), v: [await rowValue(page, 0), await rowValue(page, 1), await rowValue(page, 2)], q: [await rowQty(page, 0), await rowQty(page, 1), await rowQty(page, 2)] })
    const state0 = await snapshot()
    for (const [value, label, snippet] of [
      ["LOT-NOTFOUND", "존재하지 않는 LOT", "등록되지 않은 LOT"],
      ["LOT-OTHERTENANT", "다른 tenant 의 LOT", "등록되지 않은 LOT"],
      ["LOT-NOTBOM", "다른 품목/BOM 자재가 아닌 LOT", "BOM 구성품)가 아닌"],
      ["LOT-RESTRICTED", "사용이 제한된 LOT", "사용이 제한된 LOT"],
      ["LOT-NOSTOCK", "출고 가능 재고가 없는 LOT", "출고 가능한 재고가 없는"],
    ] as const) {
      await scan(page, lot(value))
      ok(await messageIs(page, "error", snippet), `21 [${label}] 거부 안내: "${snippet}"`)
      ok((await snapshot()) === state0, `22 [${label}] 기존 LOT 선택·수량은 그대로`)
      await stopScan(page)
    }
    // 화면 쪽 선택 가능 자재 판단
    for (const [value, snippet] of [
      ["LOT-FULL", "이미 모두 출고"],
      ["LOT-NONLOT", "LOT 관리 품목이 아니어서"],
      ["LOT-OTHERLIST", "자재 목록에 없는 품목"],
    ] as const) {
      await scan(page, lot(value))
      ok(await messageIs(page, "error", snippet), `23 [${value}] 선택 불가 안내: "${snippet}"`)
      ok((await snapshot()) === state0, `24 [${value}] 기존 선택/수량 그대로`)
      await stopScan(page)
    }
    // 서버 오류(예외) — 안내 + 수동 선택 안내, 입력 유지
    await scan(page, lot("LOT-ERROR"))
    ok(await messageIs(page, "error", "목록에서 직접 선택"), "25 서버 조회 오류 시 수동 선택 안내")
    ok((await snapshot()) === state0, "26 서버 오류에도 작성 중인 데이터 유지")
    await stopScan(page)
    ok((await text(page, "confirm-count")) === "0", "27 어떤 스캔도 출고 처리를 실행하지 않았다")
    ok(errors.length === 0, `28 페이지 오류 없음 ${errors.join(" | ")}`)
    await context.close()
  }

  // 복수 창고: 사용자가 선택
  {
    const { context, page } = await newPage(browser)
    await scan(page, lot("LOT-A-2"))
    ok(await waitFor(async () => (await page.locator('[data-testid="issue-qr-choice"]').count()) === 1, 8000), "29 [복수 창고] 같은 LOT 가 두 창고에 있으면 선택 목록 표시")
    ok((await page.locator('[data-testid="issue-qr-choice-option"]').count()) === 2 && (await rowValue(page, 0)) === "", "30 임의로 고르지 않는다(선택 전까지 LOT 행은 비어 있음)")
    const labels = await page.locator('[data-testid="issue-qr-choice-option"]').allInnerTexts()
    ok(labels[0].includes("창고 1") && labels[0].includes("가용 40") && labels[1].includes("창고 2") && labels[1].includes("가용 60"), `31 창고·가용수량 표시: ${labels.join(" / ")}`)
    await stopScan(page)
    await page.locator('[data-testid="issue-qr-choice-option"]').nth(1).click()
    ok((await rowValue(page, 0)) === "id-LOT-A-2:wh-2" && (await rowQty(page, 0)) === "50", "32 선택한 창고의 재고가 LOT 선택에 반영 · 수량 유지")
    ok((await page.locator('[data-testid="issue-qr-choice"]').count()) === 0, "33 선택 후 목록 닫힘")
    // 취소 경로
    await scan(page, lot("LOT-A-2"))
    await page.waitForSelector('[data-testid="issue-qr-message"][data-tone="info"]')
    ok(await messageIs(page, "info", "이미 선택된 LOT"), "34 같은 LOT 를 다른 창고로 다시 선택하려 해도 중복으로 막는다(서버의 동일 LOT 중복 규칙과 동일)")
    await context.close()
  }
  {
    const { context, page } = await newPage(browser)
    await scan(page, lot("LOT-A-2"))
    await page.waitForSelector('[data-testid="issue-qr-choice"]')
    await stopScan(page)
    await page.click('[data-testid="issue-qr-choice-cancel"]')
    ok((await rowValue(page, 0)) === "" && (await rowQty(page, 0)) === "50", "35 선택 취소 시 아무것도 바뀌지 않는다")
    await context.close()
  }

  // 15. 연속 스캔/조회 중 중복 요청 방지
  {
    const { context, page } = await newPage(browser)
    await scan(page, lot("LOT-SLOW"))
    ok(await waitFor(async () => (await text(page, "issue-qr-scan-button")).includes("조회 중"), 3000), "36 조회 중 상태 표시([조회 중…])")
    ok(await page.locator('[data-testid="issue-qr-scan-button"]').isDisabled(), "37 조회 중에는 스캔 버튼 비활성(중복 요청 방지)")
    ok(await messageIs(page, "success", "LOT-SLOW", 6000), "38 조회 완료 후 선택 반영")
    ok((await calls(page)) === 1, "39 [스캔 연속 실행] 같은 QR 이 계속 보여도 서버 조회는 1회")
    await context.close()
  }
  {
    // 같은 QR 이 계속 인식되는 상태(내장 디코더가 매 프레임 같은 값 반환)에서도 콜백/조회 1회
    const { context, page } = await newPage(browser)
    await scan(page, lot("LOT-A-1"))
    await page.waitForTimeout(2000)
    ok((await calls(page)) === 1, "40 연속 인식 상태에서도 조회 1회(성공 즉시 카메라 종료)")
    await context.close()
  }

  // 14. 카메라 권한 거부 — 수동 업무 가능
  {
    const deny = `navigator.mediaDevices.getUserMedia = async () => { const e = new Error("denied"); e.name = "NotAllowedError"; throw e }`
    const { context, page, errors } = await newPage(browser, deny)
    await page.fill('[data-testid="harness-row-0-qty"]', "20")
    await page.click('[data-testid="issue-qr-scan-button"]')
    await page.waitForSelector('[data-testid="qr-scanner-error"]', { timeout: 8000 })
    ok((await page.locator('[data-testid="qr-scanner-error"]').getAttribute("data-code")) === "PERMISSION_DENIED", "41 [카메라 권한 거부] 안내 표시")
    await page.click('[data-testid="qr-scanner-close"]')
    ok((await rowQty(page, 0)) === "20" && (await calls(page)) === 0, "42 권한 거부 후에도 작성 중이던 입력값 유지 · 서버 조회 없음")
    await page.selectOption('[data-testid="harness-row-0-select"]', "id-LOT-MANUAL-2:wh-1")
    await page.click('[data-testid="harness-confirm"]')
    ok((await rowValue(page, 0)) === "id-LOT-MANUAL-2:wh-1" && (await text(page, "confirm-count")) === "1", "43 [QR 없이 기존 방식으로 업무 완료] 수동 LOT 선택 → [출고 처리] 정상")
    ok(errors.length === 0, "44 권한 거부 시나리오 페이지 오류 없음")
    await context.close()
  }
  {
    const none = `Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true })`
    const { context, page } = await newPage(browser, none)
    await page.click('[data-testid="issue-qr-scan-button"]')
    await page.waitForSelector('[data-testid="qr-scanner-error"]', { timeout: 8000 })
    await page.click('[data-testid="qr-scanner-close"]')
    await page.selectOption('[data-testid="harness-row-0-select"]', "id-LOT-MANUAL-1:wh-1")
    await page.click('[data-testid="harness-confirm"]')
    ok((await text(page, "confirm-count")) === "1", "45 카메라 API 가 없는 환경(키오스크/구형 브라우저)에서도 수동 출고 가능")
    await context.close()
  }

  // QR 로 선택한 결과와 수동 선택 결과의 값이 동일(같은 LOT·창고 → 같은 선택 값)
  {
    const { context, page } = await newPage(browser)
    await scan(page, lot("LOT-A-1"))
    await messageIs(page, "success", "LOT-A-1")
    const viaQr = await rowValue(page, 0)
    await stopScan(page)
    await page.click('[data-testid="harness-add-row"]')
    await page.selectOption('[data-testid="harness-row-1-select"]', viaQr)
    ok((await rowValue(page, 1)) === viaQr, "46 [두 방식의 결과 동일] 수동 선택 상자에서 같은 값을 고를 수 있다(QR 선택 값 = 수동 선택 값)")
    await context.close()
  }

  // 모바일 레이아웃(버튼/메시지)
  {
    const context = await browser.newContext({ viewport: { width: 393, height: 727 }, hasTouch: true, isMobile: true, permissions: ["camera"] })
    await context.addInitScript(INIT)
    const page = await context.newPage()
    await page.goto(URL_PAGE)
    await page.waitForSelector('[data-testid="issue-qr-scan-button"]')
    const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth }))
    ok(m.overflow <= 1, "47 모바일 폭(393px) 가로 넘침 없음")
    await context.close()
  }

  await browser.close()
  console.log(`\n${passed} browser checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
