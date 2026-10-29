/**
 * LOT/Serial 관리 [라벨 출력] 실제 화면 검증: 실제 Next 서버(next start) + 실제 로그인 세션(JWT 쿠키) + 실제 Supabase DB(ZT5 테스트 데이터) + 실제 Chrome.
 *   - 실제 /app/mes/lot 화면에서 검색 → [라벨 출력] → 기존 라벨 미리보기(BarcodePrintDialog) → [인쇄] → 기존 /label-print 페이지.
 *   - 실제 프린터 출력은 하지 않는다(window.print 를 빈 함수로 대체 — 인쇄 대화상자 없음).
 *   - 쓰기: ZT7 접두어 테스트 LOT 3개(원자재 입고 3건·수동 LOT 1) + AuditLog(LotLabel). 삭제하지 않는다.
 * 사전: 서버가 UI_BASE(기본 http://localhost:3130)에서 실행 중이어야 한다.
 * 실행: DAEWON_DB_IT_CONFIRM=aquqetajewvhyirmewfy npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/db-it/17-ui-lot-label.ts
 */
import { chromium, type Page } from "playwright-core"
import { assertTarget, check, fixtures, info, loginAs, preflight, prisma, summary, TENANT_ID, uniq } from "./lib"

const BASE = process.env.UI_BASE ?? "http://localhost:3130"
let openBrowser: import("playwright-core").Browser | null = null
type Fx = Awaited<ReturnType<typeof fixtures>>
const a = {
  receiving: () => require("../../src/lib/actions/receiving.actions") as typeof import("../../src/lib/actions/receiving.actions"),
  lot: () => require("../../src/lib/actions/lot.actions") as typeof import("../../src/lib/actions/lot.actions"),
  spec: () => require("../../src/lib/label/label-spec") as typeof import("../../src/lib/label/label-spec"),
}

async function receive(fx: Fx, itemId: string, qty: number, lotNo: string) {
  const poItem = fx.po.items.find((i) => i.itemId === itemId)!
  const r = await a.receiving().createReceivingInspection({ purchaseOrderItemId: poItem.id, purchaseOrderId: fx.po.id, warehouseId: fx.wRm.id, siteId: fx.site.id, receivedQty: qty, acceptedQty: qty, rejectedQty: 0, result: "PASS", requestId: `zt7-ui-${uniq()}-${uniq()}`, lotNo })
  if (!r.success) throw new Error(`입고 실패 ${JSON.stringify(r).slice(0, 200)}`)
}
async function snapshot(lotId: string, poId: string) {
  const [lot, balances, txs, po, wip, ship] = await Promise.all([
    prisma.lot.findUniqueOrThrow({ where: { id: lotId } }),
    prisma.inventoryBalance.findMany({ where: { lotId }, orderBy: { id: "asc" }, select: { id: true, qtyOnHand: true, qtyAvailable: true } }),
    prisma.inventoryTransaction.findMany({ where: { lotId }, orderBy: { txNo: "asc" }, select: { txNo: true, txType: true, qty: true } }),
    prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, select: { status: true, items: { select: { id: true, receivedQty: true }, orderBy: { id: "asc" } } } }),
    prisma.wipUnit.count({ where: { lotId } }),
    prisma.shipmentItem.count({ where: { lotId } }),
  ])
  return JSON.stringify({ lot, balances, txs, po, wip, ship })
}
const audit = (lotId: string) => prisma.auditLog.findMany({ where: { tenantId: TENANT_ID, entityType: "LotLabel", entityId: lotId }, orderBy: { actedAt: "asc" }, select: { afterData: true } })

async function main() {
  assertTarget()
  await preflight("LOT 라벨 출력 실화면 테스트(17)")
  const fx = await fixtures()
  loginAs(fx.operator)
  const run = uniq()
  const today = a.spec().formatLabelDate()

  // 준비: 실제 입고 처리로 LOT 생성 (입고 후 라벨 출력은 하지 않은 상태 = 라벨 창을 닫은 상황)
  const lotNo1 = `ZT7-UI-${run}-1`
  const lotNo2 = `ZT7-UI-${run}-2`
  const lotNo3 = `ZT7-UI-${run}-3`
  await receive(fx, fx.rmA.id, 18, lotNo1)
  await receive(fx, fx.rmB.id, 25, lotNo2)
  await receive(fx, fx.rmB.id, 9, lotNo2) // 같은 LOT 의 2번째 입고
  loginAs(fx.admin)
  await a.lot().createLot({ itemId: fx.rmA.id, lotNo: lotNo3, qty: 0 }, TENANT_ID)
  loginAs(fx.operator)
  const lot1 = await prisma.lot.findFirstOrThrow({ where: { tenantId: TENANT_ID, lotNo: lotNo1 } })
  const lot2 = await prisma.lot.findFirstOrThrow({ where: { tenantId: TENANT_ID, lotNo: lotNo2 } })
  const lot3 = await prisma.lot.findFirstOrThrow({ where: { tenantId: TENANT_ID, lotNo: lotNo3 } })
  const fgReceipt = await prisma.finishedGoodsReceipt.findFirst({ where: { tenantId: TENANT_ID, lotId: { not: null }, item: { code: "ZT5-FG-A" } }, orderBy: { receiptAt: "desc" }, include: { lot: true } })
  info("SETUP", `원자재 LOT ${lotNo1}(입고 18), ${lotNo2}(입고 25+9), 수동 LOT ${lotNo3}, 완제품 LOT ${fgReceipt?.lot?.lotNo ?? "없음"}`)
  const before1 = await snapshot(lot1.id, fx.po.id)
  const before2 = await snapshot(lot2.id, fx.po.id)

  // ── 브라우저 ────────────────────────────────────────────────────────────────
  const jwt = require("../../src/lib/jwt") as typeof import("../../src/lib/jwt")
  const token = jwt.signAuthToken({ profileId: fx.operator.profileId, tenantId: TENANT_ID, loginId: fx.operator.loginId, email: fx.operator.email, name: fx.operator.name, role: "OPERATOR", mustChangePw: false })
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  openBrowser = browser
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } })
  await context.addInitScript(() => {
    window.print = () => {} // 실제 인쇄 대화상자/프린터 출력 없음
  })
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

  // 선택 창 → 미리보기 창으로 넘어갈 때 앞 창이 닫히는 애니메이션 중에도 DOM 에 남으므로, 열려 있는 창만 본다.
  const dlg = page.locator('[role="dialog"][data-state="open"]')
  async function openLabel(lotNo: string) {
    const search = page.getByPlaceholder("LOT번호 / 품목명 검색...")
    await search.fill("")
    await search.fill(lotNo)
    const row = page.locator("tr", { hasText: lotNo })
    await row.first().waitFor()
    await row.first().locator('[data-testid="lot-label-print-button"]').click()
  }
  const closeDialog = async () => {
    await page.keyboard.press("Escape")
    await dlg.waitFor({ state: "hidden" })
  }
  const preview = async () => ({
    title: await dlg.locator("h2").first().innerText(),
    qr: await dlg.locator("[data-qr-payload]").first().getAttribute("data-qr-payload"),
    text: await dlg.locator("[data-label-text]").first().innerText(),
    hasReason: (await page.locator("#label-reprint-reason").count()) > 0,
  })
  async function printAndGetPopup() {
    const [popup] = await Promise.all([context.waitForEvent("page"), dlg.getByRole("button", { name: /^(인쇄|재출력)$/ }).click()])
    await popup.waitForURL(/\/label-print\?job=/, { timeout: 20000 })
    await popup.waitForSelector("[data-label-state=ready]", { timeout: 20000 })
    return {
      qr: await popup.locator("[data-qr-payload]").first().getAttribute("data-qr-payload"),
      text: await popup.locator("[data-label-text]").first().innerText(),
      popup,
    }
  }

  await page.goto(`${BASE}/app/mes/lot`)
  await page.getByPlaceholder("LOT번호 / 품목명 검색...").waitFor()
  check("U1", (await page.locator("h1").first().innerText()).includes("LOT/Serial 관리"), "실제 LOT/Serial 관리 화면이 로그인 세션으로 열린다")
  const buttons = await page.locator('[data-testid="lot-label-print-button"]').count()
  check("U2", buttons > 0 && (await page.locator('[data-testid="lot-label-print-button"]').first().innerText()).includes("라벨 출력"), `LOT 행마다 [라벨 출력] 버튼이 있다(현재 페이지 ${buttons}개)`)

  // ── 시나리오 1·2: 입고 후 출력 없이 닫은 LOT → LOT 관리에서 최초 출력(사유 없음) ───────────
  await openLabel(lotNo1)
  await dlg.locator("[data-qr-payload]").first().waitFor()
  const p1 = await preview()
  check("U3", p1.qr === `DAEWON|LOT|1|${lotNo1}` && p1.title.includes(lotNo1) && !p1.title.includes("재출력") && !p1.hasReason, "[최초 출력] 기존 라벨 미리보기가 열리고 QR=DAEWON|LOT|1|<LOT번호>, 재출력 사유 입력란 없음", p1)
  check("U4", p1.text.includes(`수량 18 ${fx.rmA.uom}`) && p1.text.includes(`입고일 ${today}`) && p1.text.includes(fx.rmA.code), "라벨의 수량은 원래 입고수량(18), 일자는 입고 시각의 한국 날짜, 품목코드는 서버 저장값", p1.text)
  const pop1 = await printAndGetPopup()
  check("U5", pop1.qr === p1.qr && pop1.text.includes(`수량 18`) && !pop1.text.includes("재출력"), "[인쇄] → 기존 /label-print 페이지가 열리고 같은 QR·수량으로 준비 완료(재출력 표시 없음)")
  await pop1.popup.close()
  await page.waitForTimeout(500)
  const rows1 = await audit(lot1.id)
  const d1 = rows1[0]?.afterData as { event?: string; reason?: string; context?: string } | undefined
  check("U6", rows1.length === 1 && d1?.event === "LABEL_PRINT" && !d1.reason && (d1.context ?? "").includes("LOT관리 라벨 출력"), "감사 이력에 최초 출력 요청(LABEL_PRINT)이 1건 기록된다(사유 없음)", d1)
  await closeDialog()

  // ── 시나리오 3·6: 같은 LOT 다시 출력 = 재출력(사유 필수), QR 동일 ─────────────────────────
  await openLabel(lotNo1)
  await dlg.locator("[data-qr-payload]").first().waitFor()
  const p1b = await preview()
  check("U7", p1b.title.includes("(재출력)") && p1b.hasReason && p1b.text.includes("수량 18") && p1b.qr === p1.qr, "[재출력] 이전 출력 이력이 있으면 '(재출력)' 표시·사유 입력란이 나타나고 QR·수량은 동일", p1b)
  const pagesBefore = context.pages().length
  const alertsBefore = alerts.length
  await dlg.getByRole("button", { name: /^재출력$/ }).click()
  await page.waitForTimeout(800)
  check("U8", alerts.length === alertsBefore + 1 && alerts[alerts.length - 1].includes("사유") && context.pages().length === pagesBefore && (await audit(lot1.id)).length === 1, "사유 없이 [재출력]을 누르면 안내만 표시되고 인쇄 창·감사 이력은 생기지 않는다", alerts.slice(-1))
  await page.locator("#label-reprint-reason").fill("라벨 인쇄 실패 후 재출력")
  const pop2 = await printAndGetPopup()
  check("U9", pop2.qr === p1.qr && pop2.text.includes("재출력") && pop2.text.includes("수량 18"), "사유 입력 후 재출력 → 인쇄 페이지에 같은 QR, '재출력' 표시, 수량 동일")
  await pop2.popup.close()
  await page.waitForTimeout(500)
  const rows2 = await audit(lot1.id)
  const d2 = rows2[1]?.afterData as { event?: string; reason?: string; qrPayload?: string } | undefined
  check("U10", rows2.length === 2 && d2?.event === "LABEL_REPRINT" && d2.reason === "라벨 인쇄 실패 후 재출력" && d2.qrPayload === p1.qr, "감사 이력에 재출력 요청(LABEL_REPRINT) + 사유가 기록되고 QR 값은 최초와 같다", d2)
  await closeDialog()
  check("U11", (await snapshot(lot1.id, fx.po.id)) === before1, "[불변] 화면에서 최초 출력·재출력을 마친 뒤에도 LOT·재고·수불·발주 입고수량·WIP·출하가 출력 전과 동일")

  // ── 입고 이력이 여러 건인 LOT: 입고 건 선택 ─────────────────────────────────────────────
  await openLabel(lotNo2)
  await page.locator('[data-testid="lot-label-select"]').waitFor()
  const options = await page.locator('[data-testid="lot-label-receipt-option"]').count()
  const noneOption = await page.locator('[data-testid="lot-label-receipt-none"]').count()
  const optionTexts = await page.locator('[data-testid="lot-label-receipt-option"]').evaluateAll((els) => els.map((e) => (e.closest("label") as HTMLElement).innerText))
  const previewDisabled = await page.locator('[data-testid="lot-label-open-preview"]').isDisabled()
  check("U12", options === 2 && noneOption === 1 && previewDisabled && optionTexts[0].includes("25") && optionTexts[1].includes("9") && optionTexts.every((t) => t.includes(fx.po.orderNo)), "[입고 이력 2건] 입고 건(수량 25, 9·발주번호)을 고르게 하고, 고르기 전에는 미리보기를 열 수 없다", optionTexts)
  await page.locator('[data-testid="lot-label-receipt-option"]').nth(1).check()
  await page.locator('[data-testid="lot-label-open-preview"]').click()
  await dlg.locator("[data-qr-payload]").first().waitFor()
  const p2 = await preview()
  check("U13", p2.qr === `DAEWON|LOT|1|${lotNo2}` && p2.text.includes(`수량 9 ${fx.rmB.uom}`) && !p2.text.includes("수량 34"), "두 번째 입고 건을 고르면 그 건의 수량(9)이 표시되고 현재 재고(34)는 쓰지 않는다", p2.text)
  const pop3 = await printAndGetPopup()
  await pop3.popup.close()
  await page.waitForTimeout(500)
  const rows3 = await audit(lot2.id)
  const d3 = rows3[0]?.afterData as { event?: string; context?: string } | undefined
  check("U14b", pop3.text.includes(`수량 9 ${fx.rmB.uom}`) && pop3.text.includes(`입고일 ${today}`) && !pop3.text.includes("수량 34"), "인쇄 페이지의 라벨에도 선택한 입고 건의 수량(9)·입고일이 정확히 표시된다", pop3.text)
  check("U14", pop3.qr === p2.qr && rows3.length === 1 && d3?.event === "LABEL_PRINT" && (d3.context ?? "").includes("9 "),"선택한 입고 건 기준으로 출력되고 감사 이력 맥락에 그 입고 건(수량 9)이 남는다", d3)
  await closeDialog()
  await openLabel(lotNo2)
  await page.locator('[data-testid="lot-label-select"]').waitFor()
  await page.locator('[data-testid="lot-label-receipt-none"]').check()
  await page.locator('[data-testid="lot-label-open-preview"]').click()
  await dlg.locator("[data-qr-payload]").first().waitFor()
  const p2n = await preview()
  check("U15", !p2n.text.includes("수량") && !p2n.text.includes("입고일") && p2n.qr === p2.qr && p2n.title.includes("(재출력)"), "'수량·일자 없이' 선택 시 수량·입고일이 표시되지 않고 QR 은 같으며, 이미 출력한 LOT 이므로 재출력으로 표시된다", p2n)
  await closeDialog()
  check("U16", (await snapshot(lot2.id, fx.po.id)) === before2, "[불변] 입고 이력 2건 LOT 도 출력 전후 재고·수불·발주 입고수량이 동일")

  // ── 입고 이력이 없는 수동 등록 LOT ────────────────────────────────────────────────────
  await openLabel(lotNo3)
  await page.locator('[data-testid="lot-label-no-receipt"]').waitFor()
  await page.locator('[data-testid="lot-label-open-preview"]').click()
  await dlg.locator("[data-qr-payload]").first().waitFor()
  const p3 = await preview()
  check("U17", p3.qr === `DAEWON|LOT|1|${lotNo3}` && !p3.text.includes("수량") && !p3.text.includes("입고일") && !p3.text.includes("생산일"), "[원본 입고정보 없음] 안내 후 미리보기: LOT 번호·QR·품목만 있고 수량·일자는 만들어 표시하지 않는다", p3.text)
  // 인쇄 페이지(실제 라벨 페이지)에서도 존재하지 않는 입고일·수량·출력 당일이 나오지 않는다
  const pop4 = await printAndGetPopup()
  await pop4.popup.close()
  await page.waitForTimeout(500)
  const rows4 = await audit(lot3.id)
  const d4 = rows4[0]?.afterData as { event?: string; context?: string } | undefined
  check("U17b", pop4.qr === p3.qr && !pop4.text.includes("수량") && !pop4.text.includes("입고일") && !pop4.text.includes("생산일") && !pop4.text.includes("일자") && !pop4.text.includes(today) && rows4.length === 1 && d4?.event === "LABEL_PRINT" && (d4.context ?? "").includes("수량·일자 없음"), "[날짜 누락] 입고 이력 없는 LOT 의 인쇄 페이지 라벨에 수량·일자·출력 당일이 나오지 않고, 최초 출력 이력(맥락: 수량·일자 없음)이 남는다", { text: pop4.text, d4 })
  await closeDialog()

  // ── 완제품 LOT ─────────────────────────────────────────────────────────────────────────
  if (!fgReceipt?.lot) {
    info("U18", "기존 ZT5 완제품 LOT 가 없어 완제품 화면 확인을 건너뜀")
  } else {
    await openLabel(fgReceipt.lot.lotNo)
    // 입고(생산입고) 이력이 1건이면 바로 미리보기, 여러 건이면 선택 단계
    await Promise.race([dlg.locator("[data-qr-payload]").first().waitFor(), page.locator('[data-testid="lot-label-select"]').waitFor()])
    if (await page.locator('[data-testid="lot-label-select"]').count()) {
      await page.locator('[data-testid="lot-label-receipt-option"]').first().check()
      await page.locator('[data-testid="lot-label-open-preview"]').click()
      await dlg.locator("[data-qr-payload]").first().waitFor()
    }
    const pf = await preview()
    check("U18", pf.qr === `DAEWON|LOT|1|${fgReceipt.lot.lotNo}` && pf.text.includes("완제품") && pf.text.includes("생산일") && /수량 [\d,.]+ /.test(pf.text), "[완제품 LOT] 같은 QR 형식 · 완제품 유형 · 생산일 · 생산입고 수량이 표시된다", pf.text)
    await closeDialog()
  }

  check("U19", errors.length === 0, "화면 스크립트 오류 없음", errors)
  await browser.close()
  summary("lot-label-reprint-ui")
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error("실패:", (e as Error).message.split("\n").slice(0, 6).join(" | "))
  process.exitCode = 1
  await openBrowser?.close().catch(() => undefined) // 실패해도 브라우저가 남아 프로세스가 끝나지 않는 일이 없게 한다
  await prisma.$disconnect()
})
