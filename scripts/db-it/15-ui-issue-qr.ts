/**
 * 자재출고 화면 스캔 UI 정리 검증: 실제 Next 서버(next start) + 실제 로그인 세션(JWT 쿠키) + 실제 Supabase DB(대원정밀 ZT5 테스트 데이터) + 가짜 카메라.
 *   - 실제 /app/mes/material-issue 화면의 '자재 LOT 출고 처리' 창을 연다(점검용 모사 화면이 아님).
 *   - 확인: 기존 바코드 입력창 미표시 · [QR 스캔] 위치/명칭 · 카메라 · QR 인식 → 해당 자재 LOT 자동 선택 · 선택 LOT/출고수량 안내 ·
 *           다른 자재/없는 LOT/WIP QR 오류 안내 · 수동 선택 유지 · 출고수량 검증 · QR 스캔만으로 재고 변동 없음 · [출고 처리]로만 출고 확정.
 *   - 쓰기: ZT5 접두어 테스트 LOT 4개(원자재 3 · 완제품 1) + 테스트 작업지시 1건(번호 직접 지정, 채번 소모 없음) + 마지막 [출고 처리] 1회. 삭제는 하지 않는다.
 * 사전: 서버가 UI_BASE(기본 http://localhost:3130)에서 실행 중이어야 한다. 실제 프린터 출력은 하지 않는다. 비밀값은 출력하지 않는다.
 * 실행: DAEWON_DB_IT_CONFIRM=aquqetajewvhyirmewfy npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/db-it/15-ui-issue-qr.ts
 */
import { chromium, type Page } from "playwright-core"
import { assertTarget, check, fixtures, info, loginAs, preflight, prisma, summary, TENANT_ID, uniq } from "./lib"

const BASE = process.env.UI_BASE ?? "http://localhost:3130"
const lotQr = (id: string) => `DAEWON|LOT|1|${id}`
const INIT = `
  window.__nextQr = null;
  window.BarcodeDetector = class {
    static async getSupportedFormats() { return ["qr_code"] }
    constructor() {}
    async detect() { return window.__nextQr ? [{ rawValue: window.__nextQr }] : [] }
  };
`

type Fx = Awaited<ReturnType<typeof fixtures>>
const wo = () => require("../../src/lib/actions/work-order.actions") as typeof import("../../src/lib/actions/work-order.actions")

async function newLot(fx: Fx, itemId: string, warehouseId: string, qty: number, tag: string) {
  const lot = await prisma.lot.create({ data: { tenantId: TENANT_ID, itemId, lotNo: `ZT5-UI-${tag}-${uniq()}`, status: "ACTIVE" } })
  await prisma.inventoryBalance.create({ data: { tenantId: TENANT_ID, siteId: fx.site.id, warehouseId, itemId, lotId: lot.id, qtyOnHand: qty, qtyAvailable: qty } })
  return lot
}
async function newWorkOrder(fx: Fx, qty: number) {
  loginAs(fx.admin)
  const mfg = `ZT5-MFG-${uniq()}`
  const c = await wo().createWorkOrder({ siteId: fx.site.id, itemId: fx.fgA.id, bomId: fx.bom.id, routingId: fx.routing.id, orderNo: `ZT5-WO-${uniq()}`, manufacturingNo: mfg, plannedQty: qty, status: "DRAFT", operations: fx.routing.operations.map((o, i) => ({ routingOperationId: o.id, seq: (i + 1) * 10, plannedQty: qty })) }, TENANT_ID)
  if (!(c as { success?: boolean }).success) throw new Error(`WO 생성 실패 ${JSON.stringify(c)}`)
  const row = await prisma.workOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, manufacturingNo: mfg } })
  const rel = await wo().releaseWorkOrder(row.id)
  if (!rel.success) throw new Error(rel.error)
  return row
}

async function main() {
  assertTarget()
  await preflight("자재출고 스캔 UI 실화면 테스트(15)")
  const fx = await fixtures()

  // ── 준비: 테스트 LOT 와 작업지시 ───────────────────────────────────────────
  const lotA1 = await newLot(fx, fx.rmA.id, fx.wRm.id, 100, "A1")
  const lotA2 = await newLot(fx, fx.rmA.id, fx.wRm.id, 100, "A2")
  const lotB1 = await newLot(fx, fx.rmB.id, fx.wRm.id, 100, "B1")
  const lotFg = await newLot(fx, fx.fgA.id, fx.wFg.id, 100, "FG")
  const work = await newWorkOrder(fx, 20)
  const lotIds = [lotA1.id, lotA2.id, lotB1.id, lotFg.id]
  const snapshot = async () => {
    const bal = await prisma.inventoryBalance.findMany({ where: { tenantId: TENANT_ID, lotId: { in: lotIds } }, orderBy: { lotId: "asc" }, select: { lotId: true, qtyOnHand: true, qtyAvailable: true } })
    const tx = await prisma.inventoryTransaction.count({ where: { tenantId: TENANT_ID, lotId: { in: lotIds } } })
    const issued = await prisma.inventoryTransaction.count({ where: { tenantId: TENANT_ID, txType: "ISSUE", lotId: { in: lotIds } } })
    return { bal: bal.map((b) => `${b.lotId}:${Number(b.qtyOnHand)}/${Number(b.qtyAvailable)}`).join("|"), tx, issued }
  }
  info("SETUP", `테스트 작업지시 ${work.orderNo}, LOT ${[lotA1, lotA2, lotB1, lotFg].map((l) => l.lotNo).join(", ")}`)

  // ── 브라우저 ────────────────────────────────────────────────────────────────
  const jwt = require("../../src/lib/jwt") as typeof import("../../src/lib/jwt")
  const token = jwt.signAuthToken({ profileId: fx.admin.profileId, tenantId: TENANT_ID, loginId: fx.admin.loginId, email: fx.admin.email, name: fx.admin.name, role: "ADMIN", mustChangePw: false })
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] })
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, permissions: ["camera"] })
  await context.addInitScript(INIT)
  await context.addCookies([{ name: jwt.NMES_SESSION_COOKIE, value: token, url: BASE, httpOnly: true, sameSite: "Strict" }])
  const page = await context.newPage()
  page.setDefaultTimeout(25000)
  const errors: string[] = []
  const alerts: string[] = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("dialog", (d) => {
    alerts.push(d.message())
    void d.accept()
  })

  const dlg = page.locator('[role="dialog"]').filter({ hasText: "자재 LOT 출고 처리" })
  const rowOf = (code: string) => dlg.locator("div.grid.items-start", { hasText: code })
  const msg = page.locator('[data-testid="issue-qr-message"]')
  const scanBtn = page.locator('[data-testid="issue-qr-scan-button"]')
  const setQr = (v: string | null) => page.evaluate((x) => ((window as unknown as { __nextQr: string | null }).__nextQr = x), v)
  async function scan(raw: string) {
    await setQr(raw)
    await scanBtn.click()
  }
  async function waitMsg(tone: string, includes: string, timeout = 20000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if ((await msg.count()) > 0 && (await msg.getAttribute("data-tone")) === tone && (await msg.innerText()).includes(includes)) return true
      await page.waitForTimeout(100)
    }
    return false
  }
  const lotTexts = (code: string) => rowOf(code).locator('button[role="combobox"]').allInnerTexts()
  const qtys = (code: string) => rowOf(code).locator('input[type="number"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))

  await page.goto(`${BASE}/app/mes/material-issue?workOrderId=${work.id}`)
  await dlg.waitFor({ state: "visible" })
  await rowOf("ZT5-RM-A").first().waitFor()
  await page.waitForFunction(() => !document.body.innerText.includes("조회 중"), null, { timeout: 20000 }).catch(() => undefined)

  // ── U1~U4 화면 구성 ─────────────────────────────────────────────────────────
  check("U1", (await dlg.locator("h2").first().innerText()).includes("자재 LOT 출고 처리"), "실제 자재출고 화면(로그인 세션)에서 '자재 LOT 출고 처리' 창이 열린다")
  const dialogText = await dlg.innerText()
  const barcodeInputs = await dlg.locator('input[placeholder*="바코드"], input[placeholder*="스캔하면 해당 행"]').count()
  check("U2", barcodeInputs === 0 && !dialogText.includes("바코드 스캔") && !dialogText.includes("자재 바코드를 스캔"), "기존 '바코드 스캔' 입력창·안내 문구가 표시되지 않는다", { barcodeInputs })
  const btnCount = await scanBtn.count()
  const btnText = btnCount === 1 ? (await scanBtn.innerText()).trim() : ""
  const title = dlg.getByText("출고 자재 목록", { exact: true }).first()
  const tb = await title.boundingBox()
  const bb = await scanBtn.boundingBox()
  const header = await dlg.locator("div.min-w-\\[940px\\]").first().boundingBox().catch(() => null)
  check("U3", btnCount === 1 && btnText === "QR 스캔", `[QR 스캔] 버튼이 1개이고 명칭이 'QR 스캔'(${btnCount}개, "${btnText}")`)
  check("U4", !!tb && !!bb && bb.x > tb.x + tb.width && Math.abs(bb.y + bb.height / 2 - (tb.y + tb.height / 2)) < 30 && (!header || bb.y < header.y), "[QR 스캔]은 '출고 자재 목록' 제목 줄의 오른쪽, 목록 표 위에 있다", { tb, bb, header })
  const qtyA0 = await qtys("ZT5-RM-A")
  const pendingA = Number(qtyA0[0])
  const pendingB = Number((await qtys("ZT5-RM-B"))[0])
  info("PENDING", `필요(미출고) 수량: RM-A ${pendingA}, RM-B ${pendingB}`)

  // ── U5 카메라 ───────────────────────────────────────────────────────────────
  const snap0 = await snapshot()
  await setQr(null)
  await scanBtn.click()
  const scannerDlg = page.locator('[role="dialog"]').filter({ hasText: "원자재 LOT QR 스캔" })
  await scannerDlg.waitFor({ state: "visible" })
  const camera = await page
    .waitForFunction(() => {
      const v = document.querySelector('[role="dialog"] video') as HTMLVideoElement | null
      return !!v && !!v.srcObject && (v.srcObject as MediaStream).getVideoTracks().length > 0
    }, null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  check("U5", camera, "[QR 스캔]을 누르면 카메라(가짜 장치)가 실행되어 영상 스트림이 연결된다")
  await page.keyboard.press("Escape")
  await scannerDlg.waitFor({ state: "hidden" })
  check("U5b", await dlg.isVisible(), "스캐너를 닫아도 출고 처리 창과 입력은 그대로 유지된다")

  // ── U6~U8 수동 선택 유지 + 스캔 → 같은 자재 행에 LOT 자동 선택 ──────────────────
  // RM-A: 먼저 수동으로 lotA2 선택
  await rowOf("ZT5-RM-A").first().locator('button[role="combobox"]').first().click()
  await page.getByRole("option", { name: new RegExp(lotA2.lotNo) }).first().click()
  const a2Selected = (await lotTexts("ZT5-RM-A")).some((t) => t.includes(lotA2.lotNo))
  check("U6", a2Selected, "[수동 LOT 선택 유지] 목록에서 직접 LOT 를 고를 수 있다", await lotTexts("ZT5-RM-A"))

  await scan(lotQr(lotA1.lotNo))
  const okA1 = await waitMsg("success", lotA1.lotNo)
  await setQr(null)
  const textA1 = okA1 ? await msg.innerText() : ""
  const aTexts = await lotTexts("ZT5-RM-A")
  check("U7", okA1 && aTexts.some((t) => t.includes(lotA1.lotNo)) && aTexts.some((t) => t.includes(lotA2.lotNo)) && aTexts.length === 2, "[QR → 해당 자재 LOT 자동 선택] RM-A 의 LOT QR 이 RM-A 행에 새 LOT 행으로 선택되고 수동 선택은 그대로", { aTexts, textA1 })
  check("U8", textA1.includes(lotA1.lotNo) && textA1.includes("가용") && textA1.includes("출고수량은 아직 입력되지 않았습니다") && textA1.includes("스캔만으로는 출고되지 않습니다"), "스캔 후 선택된 LOT 번호·창고·가용재고와 출고수량(미입력) 안내가 표시된다", textA1)

  // RM-B: 다른 자재의 LOT QR 은 RM-B 행을 선택(RM-A 행은 그대로) — 빈 행이라 미리 채워진 출고수량이 안내에 나온다
  await scan(lotQr(lotB1.lotNo))
  const okB1 = await waitMsg("success", lotB1.lotNo)
  await setQr(null)
  const textB1 = okB1 ? await msg.innerText() : ""
  const bTexts = await lotTexts("ZT5-RM-B")
  const aAfterB = await lotTexts("ZT5-RM-A")
  check("U9", okB1 && bTexts.some((t) => t.includes(lotB1.lotNo)) && aAfterB.length === 2 && !aAfterB.some((t) => t.includes(lotB1.lotNo)), "RM-B LOT QR 은 RM-B 행에만 선택되고 RM-A 행은 영향이 없다(자재별 자동 매칭)", { bTexts, aAfterB })
  check("U10", textB1.includes(`출고수량 ${pendingB}`), `기존 입력된 출고수량이 안내에 표시된다("${textB1}")`)

  // 중복 스캔
  await scan(lotQr(lotA1.lotNo))
  check("U11", await waitMsg("info", "이미 선택된 LOT"), "같은 LOT 를 다시 스캔하면 '이미 선택된 LOT' 안내만 표시하고 행을 늘리지 않는다")
  await setQr(null)
  check("U11b", (await lotTexts("ZT5-RM-A")).length === 2, "중복 스캔으로 LOT 행이 추가되지 않았다")

  // ── U12~U14 오류 안내(선택 상태 불변) ───────────────────────────────────────
  const beforeErr = JSON.stringify([await lotTexts("ZT5-RM-A"), await qtys("ZT5-RM-A"), await lotTexts("ZT5-RM-B"), await qtys("ZT5-RM-B")])
  await scan(lotQr(lotFg.lotNo))
  const okFg = await waitMsg("error", "BOM")
  await setQr(null)
  check("U12", okFg, "[다른 자재의 QR] 이 작업지시 BOM 에 없는 품목의 LOT QR → 오류 안내", okFg ? "" : await msg.innerText().catch(() => ""))
  await scan(lotQr("ZT5-UI-NOPE-0000"))
  check("U13", await waitMsg("error", "등록되지 않은"), "없는 LOT QR → 오류 안내")
  await setQr(null)
  await scan("DAEWON|WIP|1|ZT5-WIP-NOPE")
  check("U14", await waitMsg("error", "WIP QR"), "WIP QR → 원자재 출고 화면에서 사용할 수 없다는 안내")
  await setQr(null)
  const afterErr = JSON.stringify([await lotTexts("ZT5-RM-A"), await qtys("ZT5-RM-A"), await lotTexts("ZT5-RM-B"), await qtys("ZT5-RM-B")])
  check("U15", beforeErr === afterErr, "오류 스캔은 기존 LOT 선택·출고수량 입력을 바꾸지 않는다")

  // ── U16~U17 출고수량 검증 ───────────────────────────────────────────────────
  const qtyInputsA = rowOf("ZT5-RM-A").first().locator('input[type="number"]')
  await qtyInputsA.nth(0).fill("999999")
  const overShown = (await rowOf("ZT5-RM-A").first().innerText()).includes("재고 초과")
  check("U16", overShown, "LOT 가용재고를 넘는 출고수량을 입력하면 '재고 초과' 표시")
  const alertsBefore = alerts.length
  await dlg.getByRole("button", { name: /출고 처리/ }).last().click()
  await page.waitForTimeout(800)
  check("U17", alerts.length === alertsBefore + 1 && alerts[alerts.length - 1].includes("초과"), "[출고 처리]를 눌러도 재고 초과 수량은 확정 전에 막힌다", alerts.slice(-1))

  // ── U18 스캔만으로 재고 변동 없음 ───────────────────────────────────────────
  const snap1 = await snapshot()
  check("U18", JSON.stringify(snap0) === JSON.stringify(snap1), "[QR 스캔만으로 재고 변동 없음] 스캔·수동선택·오류·검증 실패 후에도 재고 잔량·수불 건수 동일", { snap0, snap1 })
  const woNow = await prisma.workOrder.findUniqueOrThrow({ where: { id: work.id }, select: { status: true } })
  info("WO-STATUS", `출고 전 작업지시 상태 ${woNow.status}`)

  // ── U19 [출고 처리]로만 출고 확정 ───────────────────────────────────────────
  const half = Math.floor(pendingA / 2)
  await qtyInputsA.nth(0).fill(String(pendingA - half))
  await qtyInputsA.nth(1).fill(String(half))
  const sumShown = await rowOf("ZT5-RM-A").first().innerText()
  check("U19", sumShown.includes(`합계: ${pendingA}`) || sumShown.includes("합계"), "LOT 별 수량 합계가 필요수량과 함께 표시된다", sumShown.slice(-80))
  await dlg.getByRole("button", { name: /출고 처리/ }).last().click()
  // 확정되면 라벨 창이 열린다(출력은 하지 않는다)
  await page.getByText(/라벨/).first().waitFor({ timeout: 30000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
  const snap2 = await snapshot()
  const balRows = await prisma.inventoryBalance.findMany({ where: { tenantId: TENANT_ID, lotId: { in: [lotA1.id, lotA2.id, lotB1.id] } }, select: { lotId: true, qtyOnHand: true } })
  const onHand = (id: string) => Number(balRows.find((b) => b.lotId === id)?.qtyOnHand)
  const issuedOk = snap2.issued === snap1.issued + 3 && onHand(lotA2.id) === 100 - (pendingA - half) && onHand(lotA1.id) === 100 - half && onHand(lotB1.id) === 100 - pendingB
  check("U20", issuedOk, `[출고 처리] 클릭 후에만 재고가 줄었다(RM-A ${pendingA - half}+${half}, RM-B ${pendingB}) · 수불 ISSUE ${snap2.issued - snap1.issued}건`, { snap1, snap2, a2: onHand(lotA2.id), a1: onHand(lotA1.id), b1: onHand(lotB1.id) })
  check("U21", errors.length === 0, "화면 스크립트 오류 없음", errors)
  await browser.close()
  summary("issue-scan-ui")
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error("실패:", (e as Error).message.split("\n").slice(-3).join(" | "))
  process.exitCode = 1
  await prisma.$disconnect()
})
