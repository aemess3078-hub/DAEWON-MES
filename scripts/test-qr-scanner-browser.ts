/**
 * 공통 카메라 QR 스캐너 브라우저 테스트 (실제 Chrome + 가짜 카메라 + API 모킹). 서버/DB/로그인 불필요.
 *
 * 사전 조건: 서버 실행(next start 또는 dev, localhost) / Chrome 설치
 *   LABEL_TEST_URL=http://localhost:3119 npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true}' --project tsconfig.json scripts/test-qr-scanner-browser.ts
 *
 * 가짜 카메라: Chrome 의 --use-file-for-fake-video-capture 에 QR 이미지를 담은 y4m 영상을 넣어, 실제 getUserMedia → <video> →
 * 프레임 디코딩 → 파서 → 콜백 전체 경로를 검증한다(카메라 하드웨어만 가짜).
 * 한계: 실제 Android 기기/실제 카메라(후면 선택, 초점, 조명, 저사양 성능)와 Android 의 권한 UI 는 검증하지 못한다.
 */
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Module from "node:module"
import { chromium, devices, type Browser, type BrowserContext, type Page } from "playwright-core"

const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}
const svg = require("../src/lib/qr/qr-svg") as typeof import("../src/lib/qr/qr-svg")
const lotLib = require("../src/lib/qr/lot-qr") as typeof import("../src/lib/qr/lot-qr")

const BASE = process.env.LABEL_TEST_URL ?? "http://localhost:3119"
const SCAN = `${BASE}/label-print/scan?decoder=jsqr`
const OUT = join(process.cwd(), "docs", "qr-scanner-samples")
const WORK = join(tmpdir(), "daewon-qr-scanner-test")

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}

// ─── 가짜 카메라 영상(y4m) 생성 ────────────────────────────────────────────────
function makeY4m(payload: string, file: string) {
  const W = 640
  const H = 480
  const data = svg.buildQrSvgData(payload)
  const scale = Math.floor(400 / data.viewBoxSize)
  const qr = svg.renderQrRgba(data, scale)
  const y = Buffer.alloc(W * H, 235)
  const ox = Math.floor((W - qr.width) / 2)
  const oy = Math.floor((H - qr.height) / 2)
  for (let r = 0; r < qr.height; r++) {
    for (let c = 0; c < qr.width; c++) {
      y[(oy + r) * W + ox + c] = qr.data[(r * qr.width + c) * 4] === 0 ? 16 : 235
    }
  }
  const u = Buffer.alloc((W / 2) * (H / 2), 128)
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, u, u])
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`)
  writeFileSync(file, Buffer.concat([header, ...Array.from({ length: 20 }, () => frame)]))
}

const LOT_PAYLOAD = lotLib.encodeLotQr("TEST-20261027-001")
const WIP_PAYLOAD = lotLib.encodeWipQr("TEST-WIP-20261027-001")
const VIDEOS = {
  lot: join(WORK, "lot.y4m"),
  wip: join(WORK, "wip.y4m"),
  text: join(WORK, "text.y4m"),
  batch: join(WORK, "batch.y4m"),
}

const TRACK_INIT = `
  window.__streams = [];
  window.__errors = [];
  (function () {
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) return;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async function (c) { const s = await orig(c); window.__streams.push(s); return s; };
  })();
`

async function launch(video: string): Promise<Browser> {
  return chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-fake-device-for-media-stream=device-count=2", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${video}`],
  })
}

async function newPage(browser: Browser, init: string[] = [TRACK_INIT], options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["camera"], ...options })
  for (const script of init) await context.addInitScript(script)
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(String(e)))
  return { context, page, errors }
}

const live = (page: Page) =>
  page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length)
const total = (page: Page) => page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getTracks()).length)
const waitScanning = (page: Page, scope = "") => page.waitForSelector(`${scope} [data-testid="qr-scanner-view"][data-status="scanning"]`, { timeout: 15000 })
async function text(page: Page, testId: string) {
  return (await page.locator(`[data-testid="${testId}"]`).first().innerText()).trim()
}
async function waitFor(fn: () => Promise<boolean>, timeoutMs = 10000, stepMs = 100) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return false
}

async function main() {
  mkdirSync(WORK, { recursive: true })
  mkdirSync(OUT, { recursive: true })
  makeY4m(LOT_PAYLOAD, VIDEOS.lot)
  makeY4m(WIP_PAYLOAD, VIDEOS.wip)
  makeY4m("HELLO WORLD", VIDEOS.text)
  makeY4m("DAEWON|BATCH|1|TEST-BATCH-001", VIDEOS.batch)

  // ═══ A. LOT QR 가짜 카메라 ═══════════════════════════════════════════════════
  {
    const browser = await launch(VIDEOS.lot)
    const { page, errors } = await newPage(browser)
    await page.goto(SCAN)
    ok((await text(page, "env-secure")) === "예" && (await text(page, "env-media")) === "지원", "A1 테스트 화면: 보안 연결(localhost) · 카메라 API 지원 표시")
    ok((await text(page, "result-empty")).includes("없습니다"), "A2 초기 상태: 인식 결과 없음")

    await page.click('[data-testid="open-scanner"]')
    await page.waitForSelector('[data-testid="qr-scanner-view"]', { timeout: 5000 })
    // 스캔 성공(LOT): 콜백 1회, 종류/버전/식별값/원본 표시
    ok(await waitFor(async () => (await text(page, "scan-count")) === "1", 15000), "A3 [최초 카메라 실행] 카메라 시작 → QR 자동 인식 → 콜백 1회")
    ok((await text(page, "result-kind")) === "LOT" && (await text(page, "result-version")) === "1" && (await text(page, "result-id")) === "TEST-20261027-001" && (await text(page, "result-raw")) === LOT_PAYLOAD, "A4 결과: 종류 LOT · 버전 1 · 식별값 · 원본 QR 문자열")
    ok(await waitFor(async () => (await live(page)) === 0, 3000), "A5 [카메라 종료] 인식 성공 후 모든 카메라 track 이 종료됨(LED 꺼짐)")
    ok((await page.locator('[data-testid="qr-scanner-view"]').count()) === 0, "A6 성공 후 대화상자가 닫힌다(closeOnScan)")
    await page.waitForTimeout(1500)
    ok((await text(page, "scan-count")) === "1", "A7 [중복 스캔] 같은 QR 이 계속 보여도 콜백은 1회뿐")
    ok((await text(page, "result-kind")).length > 0 && (await text(page, "result-raw")) === LOT_PAYLOAD, "A8 LOT QR 은 원자재/완제품 구분 없이 LOT 로만 표시")

    // 재실행
    await page.click('[data-testid="open-scanner"]')
    ok(await waitFor(async () => (await text(page, "scan-count")) === "2", 15000), "A9 [재실행] 닫힌 뒤 다시 열어도 정상 스캔(콜백 2회)")
    ok(await waitFor(async () => (await live(page)) === 0, 3000) && (await total(page)) >= 2, `A10 재실행 후에도 카메라 해제(스트림 ${await total(page)}개 모두 종료)`)

    // 여러 번 열고 닫기(성공 전 닫기) — 인식 직전 빠르게 닫아도 오류/잔여 스트림 없음
    for (let i = 0; i < 5; i++) {
      await page.click('[data-testid="open-scanner"]')
      await page.waitForSelector('[data-testid="qr-scanner-view"]', { timeout: 5000 })
      await page.click('[data-testid="qr-scanner-close"]').catch(() => {})
      await page.waitForTimeout(60)
    }
    await page.waitForTimeout(800)
    ok(await waitFor(async () => (await live(page)) === 0, 4000), "A11 [여러 번 열고 닫기] 5회 반복 후에도 살아있는 카메라 스트림 없음")
    ok(errors.length === 0, `A12 페이지 오류 없음 ${errors.join(" | ")}`)

    // 카메라 선택(가짜 카메라 2대)
    const baseCount = Number(await text(page, "scan-count"))
    await page.click('[data-testid="toggle-inline"]')
    ok(await waitFor(async () => Number(await text(page, "scan-count")) === baseCount + 1, 15000), "A13 인라인 스캐너도 동작(콜백 +1)")
    ok(await waitFor(async () => (await live(page)) === 0, 3000), "A14 인라인: 인식 성공 시 화면에 남아 있어도 카메라는 종료된다(언마운트가 아니라 성공 시점에 해제)")
    ok((await page.locator('[data-testid="inline-scanner"] [data-testid="qr-scanner-start"]').innerText()).includes("다시 스캔"), "A15 성공 후 [다시 스캔] 버튼 표시")
    await page.click('[data-testid="inline-scanner"] [data-testid="qr-scanner-start"]')
    ok(await waitFor(async () => Number(await text(page, "scan-count")) === baseCount + 2, 15000), "A16 [다시 스캔] 버튼으로 재실행(콜백 +1)")
    await page.click('[data-testid="toggle-inline"]')
    ok(await waitFor(async () => (await live(page)) === 0, 3000), "A20 인라인 숨김(언마운트) 후에도 살아있는 스트림 없음")
    ok(errors.length === 0, `A21 전체 시나리오 페이지 오류 없음 ${errors.join(" | ")}`)
    await browser.close()
  }

  // ═══ A2. 카메라 선택 (가짜 카메라 2대 — 파일 캡처를 쓰지 않아 영상은 테스트 패턴, QR 은 없음) ═══
  {
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--use-fake-device-for-media-stream=device-count=2", "--use-fake-ui-for-media-stream"],
    })
    const { page, context, errors } = await newPage(browser)
    await page.goto(SCAN)
    await page.click('[data-testid="toggle-inline"]')
    await waitScanning(page, '[data-testid="inline-scanner"]')
    const optionValues = await page.locator('[data-testid="qr-scanner-camera-select"] option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))
    ok(optionValues.length === 2, `G1 [카메라 선택] 카메라가 2대면 선택 목록 표시(${optionValues.length}개)`)
    const labels = await page.locator('[data-testid="qr-scanner-camera-select"] option').allInnerTexts()
    ok(labels.every((l) => l.trim().length > 0), `G2 카메라 이름 표시(${labels.join(", ")})`)
    const firstActive = await page.locator('[data-testid="qr-scanner-camera-select"]').inputValue()
    const activeTrackId = () =>
      page.evaluate(() => {
        const streams = (window as unknown as { __streams: MediaStream[] }).__streams
        const last = streams[streams.length - 1]
        return last.getVideoTracks()[0].getSettings().deviceId ?? ""
      })
    ok((await activeTrackId()) === firstActive, "G3 선택 목록의 현재 값 = 실제로 열린 카메라")
    const other = optionValues.find((v) => v !== firstActive) as string
    await page.selectOption('[data-testid="qr-scanner-camera-select"]', other)
    await waitScanning(page, '[data-testid="inline-scanner"]')
    ok((await activeTrackId()) === other, "G4 카메라를 바꾸면 선택한 카메라로 다시 시작")
    ok((await live(page)) === 1, "G5 이전 카메라 스트림은 종료되고 새 카메라 1개만 켜져 있다")
    ok((await page.evaluate(() => window.localStorage.getItem("daewon:qr-camera"))) === other, "G6 선택한 카메라를 기억")
    await page.click('[data-testid="toggle-inline"]')
    ok(await waitFor(async () => (await live(page)) === 0, 3000), "G7 닫으면 카메라 종료")
    // 다시 열면 기억한 카메라를 우선 사용
    await page.click('[data-testid="toggle-inline"]')
    await waitScanning(page, '[data-testid="inline-scanner"]')
    ok((await activeTrackId()) === other, "G8 다시 열면 마지막으로 선택한 카메라를 우선 사용")
    await page.click('[data-testid="toggle-inline"]')
    ok(await waitFor(async () => (await live(page)) === 0, 3000) && errors.length === 0, "G9 정리 후 스트림 없음 · 페이지 오류 없음")
    await context.close()
    await browser.close()
  }

  // ═══ B. WIP QR ══════════════════════════════════════════════════════════════
  {
    const browser = await launch(VIDEOS.wip)
    const { page } = await newPage(browser)
    await page.goto(SCAN)
    await page.click('[data-testid="open-scanner"]')
    ok(await waitFor(async () => (await text(page, "scan-count")) === "1", 15000), "B1 WIP QR 인식")
    ok((await text(page, "result-kind")) === "WIP" && (await text(page, "result-version")) === "1" && (await text(page, "result-id")) === "TEST-WIP-20261027-001" && (await text(page, "result-raw")) === WIP_PAYLOAD, "B2 결과: 종류 WIP · 버전 1 · 식별값 · 원본")
    await browser.close()
  }

  // ═══ C. 잘못된 QR 은 거부하고 스캔 유지 · 닫기/언마운트 해제 ═══════════════════
  for (const [name, video, message] of [
    ["일반 텍스트", VIDEOS.text, "대원정밀 MES QR 형식이 아닙니다"],
    ["지원하지 않는 종류(BATCH)", VIDEOS.batch, "지원하지 않는 QR 종류"],
  ] as const) {
    const browser = await launch(video)
    const { page, errors } = await newPage(browser)
    await page.goto(SCAN)
    await page.click('[data-testid="open-scanner"]')
    await waitScanning(page)
    ok(await waitFor(async () => (await page.locator('[data-testid="qr-scanner-invalid"]').count()) > 0, 10000), `C1 ${name}: 거부 안내 표시`)
    ok((await text(page, "qr-scanner-invalid")).includes(message), `C2 ${name}: 안내 문구 "${message}"`)
    await page.waitForTimeout(1200)
    ok((await page.locator('[data-testid="qr-scanner-view"]').getAttribute("data-status")) === "scanning" && (await text(page, "scan-count")) === "0", `C3 ${name}: 스캔을 유지하고 콜백은 호출하지 않는다`)
    ok((await live(page)) >= 1, `C4 ${name}: 스캔 중에는 카메라가 켜져 있다`)
    await page.click('[data-testid="qr-scanner-close"]')
    ok(await waitFor(async () => (await live(page)) === 0, 3000), `C5 ${name}: [닫기] → 카메라 스트림 종료`)
    // 인라인: 스캔 중 화면에서 제거(언마운트) → 카메라 해제
    await page.click('[data-testid="toggle-inline"]')
    await waitScanning(page, '[data-testid="inline-scanner"]')
    ok((await live(page)) >= 1, `C6 ${name}: 인라인 스캔 중 카메라 켜짐`)
    await page.click('[data-testid="toggle-inline"]')
    ok(await waitFor(async () => (await live(page)) === 0, 3000), `C7 ${name}: [컴포넌트 언마운트] 즉시 카메라 해제`)
    ok(errors.length === 0, `C8 ${name}: 페이지 오류 없음 ${errors.join(" | ")}`)
    await browser.close()
  }

  // ═══ D. API 모킹: 권한 거부 / 카메라 없음 / 사용 중 / 미지원 / 비보안 ═══════════
  {
    const browser = await launch(VIDEOS.lot)
    const mocks: Array<[string, string, string, string]> = [
      ["권한 거부", `navigator.mediaDevices.getUserMedia = async () => { const e = new Error("denied"); e.name = "NotAllowedError"; throw e }`, "PERMISSION_DENIED", "권한이 거부"],
      ["카메라 없음", `navigator.mediaDevices.getUserMedia = async () => { const e = new Error("none"); e.name = "NotFoundError"; throw e }`, "NO_CAMERA", "카메라를 찾지 못"],
      ["카메라 사용 중", `navigator.mediaDevices.getUserMedia = async () => { const e = new Error("busy"); e.name = "NotReadableError"; throw e }`, "CAMERA_BUSY", "카메라를 사용할 수 없습니다"],
      ["브라우저 미지원", `Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true })`, "UNSUPPORTED", "지원하지 않습니다"],
      ["비보안(HTTP)", `Object.defineProperty(window, "isSecureContext", { value: false, configurable: true })`, "INSECURE_CONTEXT", "HTTPS"],
      ["기타 실행 실패", `navigator.mediaDevices.getUserMedia = async () => { const e = new Error("x"); e.name = "WeirdError"; throw e }`, "START_FAILED", "시작하지 못했습니다"],
    ]
    for (const [name, script, code, snippet] of mocks) {
      const { page, errors } = await newPage(browser, [script])
      await page.goto(SCAN)
      await page.click('[data-testid="open-scanner"]')
      await page.waitForSelector('[data-testid="qr-scanner-error"]', { timeout: 8000 })
      ok((await page.locator('[data-testid="qr-scanner-error"]').getAttribute("data-code")) === code, `D1 ${name}: 오류 코드 ${code}`)
      ok((await text(page, "qr-scanner-error")).includes(snippet), `D2 ${name}: 한국어 안내에 "${snippet}" 포함`)
      ok((await page.locator('[data-testid="qr-scanner-view"]').getAttribute("data-status")) === "error" && (await text(page, "scan-count")) === "0", `D3 ${name}: 오류 상태 · 콜백 없음`)
      ok((await page.locator('[data-testid="qr-scanner-start"]').innerText()).includes("다시 시도") && (await page.locator('[data-testid="qr-scanner-close"]').count()) === 1, `D4 ${name}: [다시 시도]/[닫기] 제공`)
      ok(errors.length === 0, `D5 ${name}: 페이지 오류 없음(오류를 안전하게 처리)`)
      await page.context().close()
    }

    // 권한 거부 후 허용으로 바뀌면 [다시 시도]로 복구
    {
      const script = `
        window.__allow = false; window.__streams = [];
        const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (c) => {
          if (!window.__allow) { const e = new Error("denied"); e.name = "NotAllowedError"; throw e }
          const s = await real(c); window.__streams.push(s); return s;
        };`
      const { page } = await newPage(browser, [script])
      await page.goto(SCAN)
      await page.click('[data-testid="open-scanner"]')
      await page.waitForSelector('[data-testid="qr-scanner-error"]', { timeout: 8000 })
      await page.evaluate(() => ((window as unknown as { __allow: boolean }).__allow = true))
      await page.click('[data-testid="qr-scanner-start"]')
      ok(await waitFor(async () => (await text(page, "scan-count")) === "1", 15000), "D6 권한 거부 → 설정에서 허용 → [다시 시도]로 정상 스캔")
      await page.context().close()
    }

    // 선택해 둔 카메라가 사라진 경우(Overconstrained) 기본 카메라로 재시도
    {
      const { page } = await newPage(browser)
      await page.addInitScript(() => window.localStorage.setItem("daewon:qr-camera", "device-that-no-longer-exists"))
      await page.goto(SCAN)
      await page.click('[data-testid="open-scanner"]')
      ok(await waitFor(async () => (await text(page, "scan-count")) === "1", 15000), "D7 저장된 카메라가 없어져도 기본 카메라로 대체해 스캔")
      ok((await page.evaluate(() => window.localStorage.getItem("daewon:qr-camera"))) !== "device-that-no-longer-exists", "D8 사라진 카메라 선택값은 지운다")
      await page.context().close()
    }

    // 권한 대기 중 닫기 → 늦게 열린 스트림도 즉시 종료(누수 없음)
    {
      const script = `
        window.__streams = [];
        const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (c) => { await new Promise(r => setTimeout(r, 1500)); const s = await real(c); window.__streams.push(s); return s; };`
      const { page, errors } = await newPage(browser, [script])
      await page.goto(SCAN)
      await page.click('[data-testid="open-scanner"]')
      await page.waitForSelector('[data-testid="qr-scanner-view"][data-status="starting"]', { timeout: 5000 })
      await page.click('[data-testid="qr-scanner-close"]')
      await page.waitForTimeout(2600)
      ok((await total(page)) >= 1 && (await live(page)) === 0, "D9 권한 대기 중 닫아도 나중에 열린 카메라 스트림이 즉시 종료된다(누수 없음)")
      ok((await text(page, "scan-count")) === "0" && errors.length === 0, "D10 닫은 뒤에는 콜백이 호출되지 않는다")
      await page.context().close()
    }

    // 디코더: BarcodeDetector 가 있으면 사용, 실행 중 오류면 jsQR 로 영구 전환
    {
      const nativeOk = `
        window.__streams = [];
        window.BarcodeDetector = class { static async getSupportedFormats() { return ["qr_code"] } constructor() {} async detect() { return [{ rawValue: "DAEWON|WIP|1|NATIVE-DETECTOR-1" }] } };`
      const { page } = await newPage(browser, [TRACK_INIT, nativeOk])
      await page.goto(`${BASE}/label-print/scan`)
      await page.click('[data-testid="open-scanner"]')
      ok(await waitFor(async () => (await text(page, "scan-count")) === "1", 15000) && (await text(page, "result-id")) === "NATIVE-DETECTOR-1" && (await text(page, "result-kind")) === "WIP", "D11 BarcodeDetector 가 있으면 내장 디코더 사용(결과도 같은 파서로 검증)")
      ok((await text(page, "env-detector")).startsWith("있음"), "D12 환경 표시: BarcodeDetector 있음")
      await page.context().close()

      const nativeBroken = `
        window.__streams = [];
        window.BarcodeDetector = class { static async getSupportedFormats() { return ["qr_code"] } constructor() {} async detect() { throw new Error("detect failed") } };`
      const broken = await newPage(browser, [TRACK_INIT, nativeBroken])
      await broken.page.goto(`${BASE}/label-print/scan`)
      await broken.page.click('[data-testid="open-scanner"]')
      ok(await waitFor(async () => (await text(broken.page, "scan-count")) === "1", 15000) && (await text(broken.page, "result-id")) === "TEST-20261027-001", "D13 BarcodeDetector 가 실행 중 실패해도 jsQR 로 전환해 계속 인식")
      await broken.context.close()

      const noQr = `window.BarcodeDetector = class { static async getSupportedFormats() { return ["code_128"] } };`
      const none = await newPage(browser, [TRACK_INIT, noQr])
      await none.page.goto(`${BASE}/label-print/scan`)
      await none.page.click('[data-testid="open-scanner"]')
      ok(await waitFor(async () => (await text(none.page, "scan-count")) === "1", 15000), "D14 BarcodeDetector 가 qr_code 를 지원하지 않으면 jsQR 사용(BarcodeDetector 단독 구조 아님)")
      await none.context.close()
    }
    await browser.close()
  }

  // ═══ E. 모바일/태블릿/데스크톱 레이아웃 (스캔 중 상태) ═══════════════════════════
  {
    const browser = await launch(VIDEOS.text) // 잘못된 QR → 스캔 상태 유지
    const viewports: Array<[string, Parameters<Browser["newContext"]>[0]]> = [
      ["Android 스마트폰 세로(Pixel 5)", { ...devices["Pixel 5"] }],
      ["Android 스마트폰 가로", { ...devices["Pixel 5 landscape"] }],
      ["산업용 태블릿 세로(800×1280)", { viewport: { width: 800, height: 1280 }, hasTouch: true, isMobile: true }],
      ["산업용 태블릿 가로(1280×800)", { viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true }],
      ["Windows PC(1366×768)", { viewport: { width: 1366, height: 768 } }],
    ]
    let shot = 0
    for (const [name, options] of viewports) {
      const { page, context } = await newPage(browser, [TRACK_INIT], options)
      await page.goto(SCAN)
      await page.click('[data-testid="open-scanner"]')
      await waitScanning(page)
      await page.waitForTimeout(400)
      const m = await page.evaluate(() => {
        const view = document.querySelector<HTMLElement>('[data-testid="qr-scanner-view"]')!
        const video = document.querySelector<HTMLVideoElement>('[data-testid="qr-scanner-video"]')!
        const close = document.querySelector<HTMLElement>('[data-testid="qr-scanner-close"]')!
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
        const vr = video.getBoundingClientRect()
        const cr = close.getBoundingClientRect()
        const dr = dialog.getBoundingClientRect()
        return {
          innerW: window.innerWidth,
          innerH: window.innerHeight,
          docOverflowX: document.documentElement.scrollWidth - window.innerWidth,
          dialogLeft: dr.left,
          dialogRight: dr.right,
          dialogTop: dr.top,
          dialogBottom: dr.bottom,
          dialogScrollable: dialog.scrollHeight > dialog.clientHeight + 1,
          videoRatio: vr.width / vr.height,
          videoNatural: video.videoWidth / video.videoHeight,
          objectFit: getComputedStyle(video).objectFit,
          closeW: cr.width,
          closeH: cr.height,
          closeVisible: cr.top >= 0 && cr.bottom <= window.innerHeight && cr.left >= 0 && cr.right <= window.innerWidth,
          viewVisible: view.getBoundingClientRect().width > 0,
        }
      })
      ok(m.docOverflowX <= 1 && m.dialogLeft >= -1 && m.dialogRight <= m.innerW + 1, `E1 ${name}: 가로 넘침 없음(${m.innerW}×${m.innerH})`)
      ok(m.dialogTop >= -1 && m.dialogBottom <= m.innerH + 1 && !m.dialogScrollable, `E2 ${name}: 대화상자가 화면 안에 들어가고 스크롤이 필요 없다`)
      ok(m.closeVisible && m.closeH >= 44 && m.closeW >= 80, `E3 ${name}: [닫기] 버튼이 화면 안에 보이고 터치 크기(${Math.round(m.closeW)}×${Math.round(m.closeH)}px ≥ 44)`)
      ok(m.objectFit === "cover" && m.videoNatural > 1.2 && m.videoRatio > 0.5, `E4 ${name}: 카메라 영상은 object-cover 로 비율 유지(늘어남 없음)`)
      await page.screenshot({ path: join(OUT, `scanner-${++shot}.png`) })
      await page.click('[data-testid="qr-scanner-close"]')
      ok(await waitFor(async () => (await live(page)) === 0, 3000), `E5 ${name}: 닫으면 카메라 종료`)
      await context.close()
    }
    await browser.close()
  }

  // ═══ F. 기존 라벨 페이지 회귀(샘플 페이지는 그대로) ═════════════════════════════
  {
    const browser = await launch(VIDEOS.lot)
    const { page } = await newPage(browser)
    await page.goto(`${BASE}/label-print/samples`)
    await page.waitForSelector("[data-label-state=ready]", { timeout: 20000 })
    const types = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("[data-label-type]")).map((e) => e.dataset.labelType).join())
    ok(types === "RAW_LOT,WIP,FG_LOT", "F1 기존 라벨 샘플 페이지(/label-print/samples) 정상 — 라벨 3종 그대로")
    await browser.close()
  }

  console.log(`\n${passed} browser checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
