/**
 * 실제 화면 검증: LOT 자동채번(번호 규칙 관리 · 원자재 입고 · LOT 관리 · 완제품 입고) + MRP(AI 제거 · 일반 기능).
 *
 * - 실제 Next production 서버(next start, NEXT_PUBLIC_BRAND=daewon 빌드) + 실제 Chrome(Playwright) + 실제 대원정밀 Supabase(테스트 환경).
 * - 로그인 화면에서 비밀번호를 입력하지 않는다: 앱이 쓰는 것과 같은 서명 세션 쿠키(JWT)를 하네스가 만들어 주입한다(db-it/06 과 동일).
 *   번호 규칙 관리 화면(개발자 전용)은 개발자 계정(test)의 세션, 그 외 화면은 ZT5 테스트 관리자 세션을 쓴다.
 * - 라벨은 "미리보기"만 연다. 실제 인쇄 버튼은 누르지 않는다(프린터 출력 없음). QR 은 화면에 그려진 SVG 를 jsQR 로 디코드해 LOT 번호와 비교한다.
 * - 테스트 데이터는 ZT5/ZT6 접두(품목 ZT5-RM-A/ZT5-FG-A, 발주 ZT6-PO-UI-*, 작업지시 ZT5 제조번호). 사용자가 저장한 번호 규칙은 수정하지 않는다.
 * 사전: 서버가 UI_BASE(기본 http://localhost:3130)에서 실행 중이어야 한다. 스크린샷은 UI_SHOTS 폴더에 저장한다.
 */
import jsQR from "jsqr"
import { chromium, type BrowserContext, type Page } from "playwright-core"
import { assertTarget, check, fixtures, info, prisma, summary, TENANT_ID, uniq } from "./lib"

const BASE = process.env.UI_BASE ?? "http://localhost:3130"
const SHOTS = process.env.UI_SHOTS ?? "."
const PART = process.env.UI_PART ?? "all"

type Fx = Awaited<ReturnType<typeof fixtures>>
const jwt = () => require("../../src/lib/jwt") as typeof import("../../src/lib/jwt")
const biz = () => require("../../src/lib/business-numbering") as typeof import("../../src/lib/business-numbering")

function sessionToken(fx: Fx, who: "dev" | "admin") {
  return who === "dev"
    ? jwt().signAuthToken({ profileId: "profile-daewon-developer-001", tenantId: TENANT_ID, loginId: "test", email: "test@daewon-mes.internal", name: "개발자(유지보수)", role: "OWNER", mustChangePw: false })
    : jwt().signAuthToken({ profileId: fx.admin.profileId, tenantId: TENANT_ID, loginId: fx.admin.loginId, email: fx.admin.email, name: fx.admin.name, role: "ADMIN", mustChangePw: false })
}

async function newContext(browser: import("playwright-core").Browser, token: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  await context.addCookies([{ name: "nmes-session", value: token, url: BASE, httpOnly: true, sameSite: "Strict" }])
  return context
}

const dialogs: string[] = []
const aiRequests: string[] = []
function watch(page: Page) {
  page.on("dialog", (d) => {
    dialogs.push(d.message())
    void d.accept()
  })
  page.on("request", (r) => {
    const u = r.url()
    if (/openai|anthropic|\/api\/ai-|ai-chat|ai-report/i.test(u)) aiRequests.push(u)
  })
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => undefined)

/** 화면에 그려진 라벨(SVG QR)을 jsQR 로 디코드한다. (브라우저 쪽 코드는 문자열로 넘겨 ts 다운레벨 헬퍼(__awaiter) 의존을 피한다) */
const RASTER_SCRIPT = `new Promise(function (resolve) {
  var label = document.querySelector('[role="dialog"] [data-label-kind="LOT_QR"]') || document.querySelector('[data-label-kind="LOT_QR"]');
  if (!label) return resolve(null);
  var svgs = Array.prototype.slice.call(label.querySelectorAll("svg"));
  svgs.sort(function (a, b) { return b.getBoundingClientRect().width - a.getBoundingClientRect().width; });
  var svg = svgs[0];
  if (!svg) return resolve({ texts: label.innerText, w: 0, h: 0, data: [] });
  var xml = new XMLSerializer().serializeToString(svg);
  var img = new Image();
  var url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
  img.onload = function () {
    var size = 480, canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size); ctx.drawImage(img, 0, 0, size, size);
    resolve({ texts: label.innerText, w: size, h: size, data: Array.from(ctx.getImageData(0, 0, size, size).data) });
  };
  img.onerror = function () { resolve({ texts: label.innerText, w: 0, h: 0, data: [] }); };
  img.src = url;
})`
async function decodeLabelQr(page: Page): Promise<{ payload: string | null; texts: string }> {
  const raster = (await page.evaluate(RASTER_SCRIPT)) as { texts: string; w: number; h: number; data: number[] } | null
  if (!raster) return { payload: null, texts: "" }
  const decoded = raster.w ? jsQR(Uint8ClampedArray.from(raster.data), raster.w, raster.h) : null
  return { payload: decoded?.data ?? null, texts: raster.texts }
}

async function maxSeq(stem: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number | null }>>(
    `select max(s)::int as n from (select substring("lotNo" from ${stem.length + 1})::int s from "Lot" where "tenantId"=$1 and "lotNo" ~ $2 union all select substring("lotNo" from ${stem.length + 1})::int s from "LotNumberReservation" where "tenantId"=$1 and "lotNo" ~ $2) t`,
    TENANT_ID,
    `^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d{3}$`,
  )
  return rows[0]?.n ?? 0
}

// ═══ 1. 번호 규칙 관리 ═══════════════════════════════════════════════════════════
async function ruleScreen(browser: import("playwright-core").Browser, fx: Fx) {
  const ctx = await newContext(browser, sessionToken(fx, "dev"))
  const page = await ctx.newPage()
  watch(page)
  const before = await prisma.numberingRule.findUniqueOrThrow({ where: { tenantId_type: { tenantId: TENANT_ID, type: "LOT" } } })
  const res = await page.goto(`${BASE}/app/mes/lot-rules`, { waitUntil: "networkidle", timeout: 60000 })
  await shot(page, "01-lot-rules")
  const text = await page.locator("body").innerText()
  check("U1", res?.status() === 200 && text.includes("번호 규칙 관리") && text.includes("LOT 번호 규칙"), "번호 규칙 관리 화면 표시(개발자 세션)")
  // LOT 규칙 영역: 시리얼 규칙 영역 앞부분만 본다
  const lotPart = text.split("시리얼 번호 규칙")[0]
  const order = ["품목코드", "연도(2자리)", "월(2자리)", "하이픈(-)", "순번(3자리)"]
  const idx = order.map((t) => lotPart.lastIndexOf(t))
  check("U2", idx.every((i) => i >= 0) && idx.every((v, i) => i === 0 || v > idx[i - 1]), "저장된 규칙 토큰이 순서대로 표시: 품목코드 → 연도(2자리) → 월(2자리) → 하이픈(-) → 순번(3자리)", idx)
  check("U3", /\{ITEM_CODE\}\d{4}-001/.test(lotPart), "규칙 빌더 미리보기는 자리표시자({ITEM_CODE}YYMM-001) — 실제 발행 번호가 아니다")
  await page.reload({ waitUntil: "networkidle" })
  const text2 = (await page.locator("body").innerText()).split("시리얼 번호 규칙")[0]
  check("U4", order.every((t) => text2.includes(t)), "새로고침 후에도 규칙 표시 유지")
  const after = await prisma.numberingRule.findUniqueOrThrow({ where: { tenantId_type: { tenantId: TENANT_ID, type: "LOT" } } })
  check("U5", after.isActive && after.updatedAt.getTime() === before.updatedAt.getTime() && JSON.stringify(after.tokens) === JSON.stringify(before.tokens), "화면 조회 중 규칙은 수정되지 않음(활성 유지, updatedAt·토큰 동일)")
  await ctx.close()
}

// ═══ 2. 원자재 입고 ══════════════════════════════════════════════════════════════
async function receivingScreen(browser: import("playwright-core").Browser, fx: Fx) {
  const { year2, monthText } = biz().kstDateParts()
  const stemA = `${fx.rmA.code}${year2}${monthText}-`
  const supplier = await prisma.businessPartner.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: "ZT5-SUP" } })
  const po = await prisma.purchaseOrder.create({
    data: { tenantId: TENANT_ID, siteId: fx.site.id, supplierId: supplier.id, orderNo: `ZT6-PO-UI-${uniq()}`, orderDate: new Date(), expectedDate: new Date(Date.now() + 86400000), status: "ORDERED",
      // note 는 일부러 비워(NULL) 둔다 — 스크립트·일괄 입력으로 만든 발주도 자재입고현황에 보여야 한다(14-po-null-note 수정 회귀).
      items: { create: [{ itemId: fx.rmA.id, qty: 1000, unitPrice: 10 }] } },
    include: { items: true },
  })
  const ctx = await newContext(browser, sessionToken(fx, "admin"))
  const page = await ctx.newPage()
  watch(page)

  const openDialog = async () => {
    await page.goto(`${BASE}/app/mes/material-receipt`, { waitUntil: "networkidle", timeout: 60000 })
    const row = page.locator("div.grid").filter({ hasText: po.orderNo }).first()
    await row.getByRole("button", { name: "입고처리" }).click()
    await page.getByRole("dialog").first().waitFor()
    return page.getByRole("dialog").first()
  }
  const lotInput = (dlg: ReturnType<Page["getByRole"]>) => dlg.locator('input[type="text"]').first()
  const qtyInput = (dlg: ReturnType<Page["getByRole"]>) => dlg.locator('input[type="number"]').first()

  // 2-1. 화면 → 자동채번 → 미리보기(예약만 생성, 순번 소비 없음)
  const baseSeq = await maxSeq(stemA)
  const seqRowsBefore = await prisma.numberingSequence.count()
  let dlg = await openDialog()
  await shot(page, "02-receiving-dialog")
  const dlgText = await dlg.innerText()
  check("U6", dlgText.includes(fx.rmA.code) && dlgText.includes("입고 창고") && !dlgText.includes("26A01-1"), "실제 입고 화면: 품목 표시·입고 창고 선택 영역, CNS 예시 문구(26A01-1) 없음")
  const whBox = dlg.locator('button[role="combobox"]').first()
  await page.waitForFunction(() => { const b = document.querySelector('[role="dialog"] button[role="combobox"]'); return !!b && !/창고 선택/.test((b as HTMLElement).innerText) }, null, { timeout: 8000 }).catch(() => undefined)
  let whText = (await whBox.innerText()).trim()
  const defaultApplied = !/창고 선택/.test(whText)
  if (!defaultApplied) {
    await whBox.click()
    await page.getByRole("option", { name: /ZT5-WH-RM/ }).first().click()
    whText = (await whBox.innerText()).trim()
  }
  check("U7", /ZT5-WH-RM/.test(whText), `입고 창고 선택됨(${defaultApplied ? "품목 기본창고 자동 적용" : "화면에서 직접 선택"}: ${whText})`)
  await qtyInput(dlg).fill("10")
  await dlg.getByRole("button", { name: "자동채번" }).click()
  await page.waitForFunction((sel) => (document.querySelector(sel) as HTMLInputElement | null)?.value?.length! > 0, 'input[type="text"].font-mono', { timeout: 20000 }).catch(() => undefined)
  const reserved = (await lotInput(dlg).inputValue()).trim()
  const expectedFirst = `${stemA}${String(baseSeq + 1).padStart(3, "0")}`
  check("U8", reserved === expectedFirst, `자동채번 → ${reserved} (기대 ${expectedFirst}): 실제 품목코드 ${fx.rmA.code} + YY${year2} + MM${monthText} + - + 순번3`, reserved)
  check("U9", !reserved.includes("{") && !reserved.includes("ITEM_CODE"), "발행 번호에 {ITEM_CODE} 자리표시자가 남지 않음")
  const resRow = await prisma.lotNumberReservation.findFirst({ where: { tenantId: TENANT_ID, lotNo: reserved } })
  check("U10", resRow?.status === "RESERVED" && !resRow.printedAt && (await prisma.lot.count({ where: { tenantId: TENANT_ID, lotNo: reserved } })) === 0, "예약 행만 생성(RESERVED, 미출력), Lot 는 아직 없음")
  await shot(page, "03-receiving-reserved")

  // 2-2. 라벨 미리보기: QR == LOT 번호, 미리보기만으로 순번 소비 없음, 인쇄 버튼은 누르지 않음
  await dlg.getByRole("button", { name: "LOT 라벨 미리보기" }).click()
  await page.locator('[data-label-kind="LOT_QR"]').first().waitFor({ timeout: 15000 })
  await page.waitForFunction(() => document.querySelector('[data-label-kind="LOT_QR"]')?.getAttribute("data-label-state") === "ready", null, { timeout: 15000 })
  const prev = await decodeLabelQr(page)
  check("U11", prev.payload === `DAEWON|LOT|1|${reserved}` && prev.texts.includes(reserved), `확정 전 라벨 미리보기: QR 디코드 = ${prev.payload}, 라벨 텍스트에 LOT 번호 표시`, prev)
  await shot(page, "04-label-preview-before-confirm")
  const resAfterPreview = await prisma.lotNumberReservation.findFirst({ where: { tenantId: TENANT_ID, lotNo: reserved } })
  check("U12", resAfterPreview?.printedAt === null && (await maxSeq(stemA)) === baseSeq + 1 && (await prisma.numberingSequence.count()) === seqRowsBefore, "미리보기만으로 순번이 소모되지 않음(예약 미출력·최대 순번 그대로·NumberingSequence 변동 없음)")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)

  // 2-3. 취소 → 미출력 예약은 삭제되어 번호 재사용
  await page.getByRole("dialog").first().getByRole("button", { name: "취소" }).click().catch(() => undefined)
  await page.waitForTimeout(1500)
  const afterCancel = await prisma.lotNumberReservation.count({ where: { tenantId: TENANT_ID, lotNo: reserved } })
  check("U13", afterCancel === 0, "입고 창을 취소하면 미출력 예약이 정리되어(삭제) 번호가 재사용 가능")

  // 2-4. 다시 열어 자동채번 → 같은 번호 → 입고 확정
  dlg = await openDialog()
  await qtyInput(dlg).fill("10")
  await dlg.getByRole("button", { name: "자동채번" }).click()
  await page.waitForFunction((v) => Array.from(document.querySelectorAll('[role="dialog"] input[type="text"]')).some((i) => (i as HTMLInputElement).value === v), reserved, { timeout: 20000 }).catch(() => undefined)
  const again = (await lotInput(dlg).inputValue()).trim()
  check("U14", again === reserved, `취소 후 재자동채번 → 같은 번호 재사용(${again})`)
  await dlg.getByRole("button", { name: "입고 확정" }).click()
  await page.locator('[data-label-kind="LOT_QR"]').first().waitFor({ timeout: 40000 })
  await page.waitForFunction(() => document.querySelector('[data-label-kind="LOT_QR"]')?.getAttribute("data-label-state") === "ready", null, { timeout: 15000 })
  const confirmed = await decodeLabelQr(page)
  await shot(page, "05-label-after-confirm")
  const lot1 = await prisma.lot.findFirst({ where: { tenantId: TENANT_ID, lotNo: reserved } })
  const bal1 = lot1 ? await prisma.inventoryBalance.aggregate({ where: { tenantId: TENANT_ID, lotId: lot1.id }, _sum: { qtyOnHand: true } }) : null
  const res1 = await prisma.lotNumberReservation.findFirst({ where: { tenantId: TENANT_ID, lotNo: reserved } })
  check("U15", !!lot1 && lot1.itemId === fx.rmA.id && lot1.status === "ACTIVE" && Number(bal1?._sum.qtyOnHand) === 10 && res1?.status === "CONSUMED", `입고 확정 → Lot 생성(${reserved}, ${fx.rmA.code}), 재고 10, 예약 CONSUMED`)
  check("U16", confirmed.payload === `DAEWON|LOT|1|${lot1?.lotNo}` && confirmed.texts.includes(reserved), `확정 후 라벨 QR 디코드(${confirmed.payload}) = DB 의 LOT 번호`)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(1000)

  // 2-5. 수동 LOT 입력
  const manualNo = `ZT6-UI-MAN-${uniq()}`
  dlg = await openDialog()
  await qtyInput(dlg).fill("5")
  await lotInput(dlg).fill(manualNo)
  await dlg.getByRole("button", { name: "입고 확정" }).click()
  await page.locator('[data-label-kind="LOT_QR"]').first().waitFor({ timeout: 40000 })
  const manualLabel = await decodeLabelQr(page)
  const manualLot = await prisma.lot.findFirst({ where: { tenantId: TENANT_ID, lotNo: manualNo } })
  const manualBal = manualLot ? await prisma.inventoryBalance.aggregate({ where: { tenantId: TENANT_ID, lotId: manualLot.id }, _sum: { qtyOnHand: true } }) : null
  check("U17", !!manualLot && Number(manualBal?._sum.qtyOnHand) === 5 && manualLabel.payload === `DAEWON|LOT|1|${manualNo}`, "수동 LOT 입력 입고: 입력한 번호로 Lot·재고 생성, 라벨 QR 일치")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(1000)

  // 2-6. 버튼을 누르지 않은 AUTO 확정(서버 발행)
  const seqBeforeAuto = await maxSeq(stemA)
  dlg = await openDialog()
  await qtyInput(dlg).fill("7")
  await dlg.getByRole("button", { name: "입고 확정" }).click()
  await page.locator('[data-label-kind="LOT_QR"]').first().waitFor({ timeout: 40000 })
  const autoLabel = await decodeLabelQr(page)
  const expectedAuto = `${stemA}${String(seqBeforeAuto + 1).padStart(3, "0")}`
  const autoLot = await prisma.lot.findFirst({ where: { tenantId: TENANT_ID, lotNo: expectedAuto } })
  check("U18", !!autoLot && autoLot.itemId === fx.rmA.id && autoLabel.payload === `DAEWON|LOT|1|${expectedAuto}`, `LOT 미입력 입고 확정 → 서버가 규칙대로 발행(${expectedAuto}), 라벨 QR 일치`, autoLabel.payload)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(1000)
  check("U19", (await prisma.numberingSequence.count()) === seqRowsBefore, "전 과정에서 NumberingSequence 카운터는 사용되지 않음")
  await ctx.close()
  return { stemA, poNo: po.orderNo }
}

// ═══ 3. LOT 관리 화면 ════════════════════════════════════════════════════════════
async function lotScreen(browser: import("playwright-core").Browser, fx: Fx) {
  const { year2, monthText } = biz().kstDateParts()
  const stemB = `${fx.rmB.code}${year2}${monthText}-`
  const ctx = await newContext(browser, sessionToken(fx, "admin"))
  const page = await ctx.newPage()
  watch(page)
  await page.goto(`${BASE}/app/mes/lot`, { waitUntil: "networkidle", timeout: 60000 })
  const latest = await prisma.lot.findFirst({ where: { tenantId: TENANT_ID, itemId: fx.rmA.id, lotNo: { startsWith: `${fx.rmA.code}${year2}${monthText}-` } }, orderBy: { createdAt: "desc" } })
  const body = await page.locator("body").innerText()
  check("U20", !!latest && body.includes(latest.lotNo), `LOT 관리 화면에 입고로 생성된 자동채번 LOT 표시(${latest?.lotNo})`)
  await shot(page, "06-lot-management")

  const base = await maxSeq(stemB)
  await page.getByRole("button", { name: /LOT 등록/ }).first().click()
  const sheet = page.getByRole("dialog").first()
  await sheet.waitFor()
  await sheet.getByRole("combobox").first().click()
  await page.getByRole("option", { name: new RegExp(fx.rmB.code) }).first().click()
  await sheet.getByRole("button", { name: /자동생성/ }).click()
  const lotField = sheet.locator('input[name="lotNo"]')
  await page.waitForFunction(() => (document.querySelector('[role="dialog"] input[name="lotNo"]') as HTMLInputElement | null)?.value?.length! > 0, null, { timeout: 20000 })
  const generated = (await lotField.inputValue()).trim()
  const expected = `${stemB}${String(base + 1).padStart(3, "0")}`
  check("U21", generated === expected && !generated.includes("{"), `LOT 등록 화면 자동생성 → ${generated} (기대 ${expected}), 품목코드 입력 단계 없이 서버 품목값 사용`)
  await shot(page, "07-lot-register-autogen")
  // 같은 번호를 두 번 눌러도 순번 소비 없음(저장 전 재생성 → 같은 번호)
  await sheet.getByRole("button", { name: /자동생성/ }).click()
  await page.waitForTimeout(2500)
  check("U22", (await lotField.inputValue()).trim() === expected && (await maxSeq(stemB)) === base, "자동생성을 다시 눌러도 같은 번호 — 저장 전에는 순번이 소모되지 않음")
  await sheet.getByRole("button", { name: /저장|등록/ }).last().click()
  await page.waitForTimeout(3000)
  const saved = await prisma.lot.findFirst({ where: { tenantId: TENANT_ID, lotNo: expected } })
  check("U23", !!saved && saved.itemId === fx.rmB.id, "LOT 등록 저장 → 해당 번호로 Lot 생성")
  await ctx.close()
}

async function main() {
  assertTarget()
  const fx = await fixtures()
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  try {
    if (PART === "all" || PART === "lot") {
      await ruleScreen(browser, fx)
      await receivingScreen(browser, fx)
      await lotScreen(browser, fx)
    }
    if (PART === "all" || PART === "fg") await (await import("./13-ui-fg-mrp")).run(browser, fx, { BASE, SHOTS, sessionToken, newContext, watch, shot, decodeLabelQr, maxSeq, dialogs, aiRequests })
    info("UI", `다이얼로그/경고 메시지 ${dialogs.length}건: ${dialogs.slice(0, 5).join(" | ").slice(0, 300)}`)
  } finally {
    await browser.close()
  }
  summary("13 실제 화면(LOT·MRP)")
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error("실패:", e instanceof Error ? e.stack?.split("\n").slice(0, 8).join("\n") : e)
  process.exitCode = 1
  await prisma.$disconnect()
})
export type { BrowserContext }
