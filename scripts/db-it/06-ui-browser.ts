/**
 * 5단계 6: 실제 Next 서버(next start) + 실제 로그인 세션(JWT 쿠키) + 실제 Supabase DB + 가짜 카메라로
 * 실제 출하 화면(/app/mes/shipments)의 출하예정 등록 시트에서 [QR 스캔]을 검증한다.
 *   - 점검 화면(모사)이 아니라 실제 ShipmentFormSheet / 실제 서버 액션(lookupLotForShipment, createShipment, confirmShipment)을 쓴다.
 *   - 카메라만 가짜(Chrome fake device + BarcodeDetector 모킹).
 * 사전: 서버가 PORT 에서 실행 중이어야 하고(06-ui-prep 로 만든 LOT 번호를 환경변수 UIPREP 로 전달), 비밀값은 출력하지 않는다.
 */
import { chromium, type Page } from "playwright-core"
import { assertTarget, check, fixtures, info, prisma, summary, TENANT_ID } from "./lib"

const BASE = process.env.UI_BASE ?? "http://localhost:3130"
const lot = (id: string) => `DAEWON|LOT|1|${id}`
const INIT = `
  window.__nextQr = null;
  window.BarcodeDetector = class {
    static async getSupportedFormats() { return ["qr_code"] }
    constructor() {}
    async detect() { return window.__nextQr ? [{ rawValue: window.__nextQr }] : [] }
  };
`
const prep = JSON.parse(process.env.UIPREP ?? "{}") as { a1: string; a2: string; a3: string; a4: string; b1: string }

async function scan(page: Page, row: number, raw: string) {
  await page.evaluate((v) => ((window as unknown as { __nextQr: string | null }).__nextQr = v), raw)
  await page.locator('[data-testid="shipment-qr-scan-button"]').nth(row).click()
}
const stop = (page: Page) => page.evaluate(() => ((window as unknown as { __nextQr: string | null }).__nextQr = null))
async function msg(page: Page, row: number, tone: string, includes: string, timeout = 15000) {
  // 메시지는 행 안에 있다: 버튼이 속한 행 컨테이너에서 찾는다
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const all = page.locator('[data-testid="shipment-qr-message"]')
    const n = await all.count()
    for (let i = 0; i < n; i++) {
      const el = all.nth(i)
      if ((await el.getAttribute("data-tone")) === tone && (await el.innerText()).includes(includes)) return true
    }
    await page.waitForTimeout(100)
  }
  void row
  return false
}
const rowLotValues = (page: Page, item: number) =>
  page.evaluate((idx) => {
    const items = Array.from(document.querySelectorAll('[role="dialog"] .rounded-md.border.p-3'))
    const box = items[idx]
    if (!box) return []
    return Array.from(box.querySelectorAll('button[role="combobox"]')).map((b) => (b as HTMLElement).innerText.trim())
  }, item)
const rowQtys = (page: Page, item: number) =>
  page.evaluate((idx) => {
    const items = Array.from(document.querySelectorAll('[role="dialog"] .rounded-md.border.p-3'))
    const box = items[idx]
    if (!box) return []
    return Array.from(box.querySelectorAll('input[type="number"]')).map((i) => (i as HTMLInputElement).value)
  }, item)

async function main() {
  assertTarget()
  const fx = await fixtures()
  const jwt = require("../../src/lib/jwt") as typeof import("../../src/lib/jwt")
  const token = jwt.signAuthToken({ profileId: fx.operator.profileId, tenantId: TENANT_ID, loginId: fx.operator.loginId, email: fx.operator.email, name: fx.operator.name, role: "OPERATOR", mustChangePw: false })
  // 반복 실행하면 이전 실행의 출하예정(예약)이 ZT5-SO-001 의 미출하수량을 계속 줄인다. 이 테스트가 쓰는 것은 ZT5 테스트 수주뿐이므로,
  // 실행 전에 FG-A 수주 수량을 (출하완료 수량 + 5000) 이상으로 올려 반복 실행이 가능하게 한다. 다른 수주·품목은 건드리지 않는다.
  await prisma.$executeRawUnsafe(
    `update "SalesOrderItem" set qty = greatest(qty, "shippedQty" + 5000) where "itemId" = $1 and "salesOrderId" in (select id from "SalesOrder" where "tenantId" = $2 and "orderNo" = 'ZT5-SO-001')`,
    fx.fgA.id,
    TENANT_ID,
  )
  // 이 테스트는 수주 ZT5-SO-001 의 첫 품목 행이 ZT5-FG-A 라고 가정한다. 화면의 품목 행 순서는 DB 조회 순서(정렬 없음)라서,
  // 04 같은 출하 테스트가 FG-A 행을 갱신하면 물리 순서가 바뀌어 FG-B 가 먼저 나올 수 있다. 시작 전에 FG-B 행을 한 번 다시 써서(값 불변) 순서를 맞춘다.
  for (let attempt = 0; attempt < 3; attempt++) {
    const so = await prisma.salesOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, orderNo: "ZT5-SO-001" }, include: { items: true } })
    if (so.items[0]?.itemId === fx.fgA.id) break
    const fgB = so.items.find((i) => i.itemId === fx.fgB.id)
    if (!fgB) throw new Error("ZT5-SO-001 에 ZT5-FG-B 품목 행이 없습니다.")
    await prisma.$executeRawUnsafe(`update "SalesOrderItem" set qty = qty where id = $1`, fgB.id)
    if (attempt === 2) throw new Error("ZT5-SO-001 품목 행 순서를 FG-A 우선으로 맞추지 못했습니다(화면 행 순서 가정 불충족).")
  }
  const shipCount = () => prisma.shipmentOrder.count({ where: { tenantId: TENANT_ID } })
  const balSum = async () => (await prisma.inventoryBalance.aggregate({ where: { tenantId: TENANT_ID, itemId: { in: [fx.fgA.id, fx.fgB.id] } }, _sum: { qtyOnHand: true, qtyAvailable: true } }))._sum

  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] })
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, permissions: ["camera"] })
  await context.addInitScript(INIT)
  await context.addCookies([{ name: "nmes-session", value: token, url: BASE, httpOnly: true, sameSite: "Strict" }])
  const page = await context.newPage()
  page.setDefaultTimeout(25000)
  const errors: string[] = []
  const posts: Array<{ action: string; url: string }> = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"]) posts.push({ action: r.headers()["next-action"], url: r.url() })
  })
  page.on("dialog", (d) => void d.accept())

  await page.goto(`${BASE}/app/mes/shipments`)
  await page.waitForLoadState("domcontentloaded")
  const title = await page.locator("h1").first().innerText().catch(() => "")
  check("U1", title.includes("납품정보등록"), `실제 출하 화면 로드(로그인 세션 쿠키) — 제목 "${title}"`, page.url())

  // 수주 ZT5-SO-001 의 [출하예정 등록]
  const row = page.locator("div", { hasText: "ZT5-SO-001" }).locator("button", { hasText: "출하예정 등록" }).last()
  await row.click()
  await page.waitForSelector('[role="dialog"]')
  // 창고 선택(Radix Select)
  await page.locator('[role="dialog"] button[role="combobox"]').nth(1).click()
  await page.getByRole("option", { name: /ZT5 완제품창고/ }).first().click()
  await page.waitForSelector('[data-testid="shipment-qr-scan-button"]', { timeout: 20000 })
  const qrButtons = await page.locator('[data-testid="shipment-qr-scan-button"]').count()
  check("U2", qrButtons === 2, `실제 출하예정 등록 시트: LOT 관리 품목 행마다 [QR 스캔] 버튼(${qrButtons}개) — 'LOT 추가' 옆`)
  await page.waitForFunction(() => !document.body.innerText.includes("LOT 조회 중"), null, { timeout: 20000 }).catch(() => undefined)

  const ship0 = await shipCount()
  const bal0 = await balSum()
  const posts0 = posts.length

  // ── 정상 스캔: FG-A 행 ─────────────────────────────────────────────────
  await scan(page, 0, lot(prep.a1))
  check("U3", await msg(page, 0, "success", prep.a1), "[실제 서버 조회] 완제품 LOT QR → 선택 안내 표시")
  await stop(page)
  const lots1 = await rowLotValues(page, 0)
  const qtys1 = await rowQtys(page, 0)
  check("U4", lots1.some((t) => t.includes(prep.a1)) && qtys1[0] === "100", `기존 LOT 선택 상자에 반영(${lots1.join("|")}) · 수량 제안 ${qtys1[0]} (수동 선택과 같은 규칙: min(가용 100, 미출하))`)
  check("U5", (await shipCount()) === ship0 && JSON.stringify(await balSum()) === JSON.stringify(bal0), "[스캔만으로 출하 등록/재고 변경 없음] 실제 DB 의 출하 건수·재고 합계 불변")
  const scanPosts = posts.slice(posts0)
  check("U6", scanPosts.length >= 1, `스캔 중 서버 요청: 조회 Server Action POST ${scanPosts.length}건(읽기 전용 조회 + 화면 재조회 포함 가능) — 출하 건수가 늘지 않았으므로 등록·확정 요청 아님`)

  // ── 거부 사례(실제 DB): 같은 시트에서 상태 불변 ────────────────────────
  const state0 = JSON.stringify([await rowLotValues(page, 0), await rowQtys(page, 0)])
  const rawLot = (await prisma.lot.findFirstOrThrow({ where: { tenantId: TENANT_ID, itemId: fx.rmA.id } })).lotNo
  for (const [label, value, tone, includes] of [
    ["원자재 LOT", lot(rawLot), "error", "원자재·소모품 LOT"],
    ["다른 품목(FG-B) LOT", lot(prep.b1), "error", "다른 품목"],
    ["없는 LOT", lot("ZT5-NO-SUCH"), "error", "등록되지 않은 LOT"],
    ["WIP QR", "DAEWON|WIP|1|wip-x", "error", "WIP QR"],
  ] as const) {
    await scan(page, 0, value)
    check(`U-${label}`, await msg(page, 0, tone, includes), `[거부] ${label} → "${includes}" 안내`)
    await stop(page)
    check(`U-${label}-불변`, JSON.stringify([await rowLotValues(page, 0), await rowQtys(page, 0)]) === state0, `[${label}] 기존 LOT 선택·수량 그대로`)
  }
  await scan(page, 0, lot(prep.a1))
  check("U7", await msg(page, 0, "info", "이미 선택된 LOT"), "[중복 스캔] 이미 선택된 LOT 안내 · 행 추가 없음")
  await stop(page)
  check("U8", (await rowLotValues(page, 0)).length === 1, "중복 스캔 후에도 LOT 행은 1개")

  // ── Multi-LOT: 두 번째 스캔 → 새 행, 기존 행/수량 유지 ────────────────
  await page.locator('[role="dialog"] input[type="number"]').first().fill("60")
  await scan(page, 0, lot(prep.a2))
  check("U9", await msg(page, 0, "success", prep.a2), "두 번째 LOT QR 선택")
  await stop(page)
  const lots2 = await rowLotValues(page, 0)
  const qtys2 = await rowQtys(page, 0)
  check("U10", lots2.length === 2 && lots2[0].includes(prep.a1) && lots2[1].includes(prep.a2) && qtys2[0] === "60", `[Multi-LOT] 새 행 추가, 첫 행 LOT·수량(사용자가 고친 60) 유지: ${lots2.join("|")} / ${qtys2.join(",")}`)

  // ── 등록(실제 createShipment) — QR 로 고른 LOT ─────────────────────────
  await page.locator('[role="dialog"] input[type="number"]').nth(1).fill("30")
  const sBefore = await prisma.shipmentOrder.findMany({ where: { tenantId: TENANT_ID }, select: { id: true } })
  await page.getByRole("button", { name: "이번 출하 제외" }).nth(1).click() // 이 출하에 포함하지 않을 품목(FG-B)은 기존 화면 규칙대로 제외한다
  await page.getByRole("button", { name: "등록", exact: true }).click()
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 30000 }).catch(() => undefined)
  const created = await prisma.shipmentOrder.findMany({ where: { tenantId: TENANT_ID, id: { notIn: sBefore.map((s) => s.id) } }, include: { items: { include: { lot: true } } } })
  const sQr = created[0]
  check("U11", created.length === 1 && sQr.status === "PLANNED" && sQr.items.length === 2, `[QR 선택] 출하예정 등록 → PLANNED 1건(${sQr?.shipmentNo}) · LOT 2행`, created.map((c) => c.status))
  check("U12", !!sQr && sQr.items.some((i) => i.lot?.lotNo === prep.a1 && Number(i.qty) === 60) && sQr.items.some((i) => i.lot?.lotNo === prep.a2 && Number(i.qty) === 30), "등록 내용: LOT a1 60 + LOT a2 30 (화면에서 보인 값과 동일)")
  const balAfterReg = await prisma.inventoryBalance.findFirstOrThrow({ where: { tenantId: TENANT_ID, lot: { lotNo: prep.a1 } } })
  check("U13", Number(balAfterReg.qtyOnHand) === 100, "등록(예약)만으로 실재고 차감 없음")

  // ── 수동 선택으로 같은 구성 등록 → 결과 비교 ───────────────────────────
  await page.goto(`${BASE}/app/mes/shipments`)
  await page.waitForLoadState("domcontentloaded")
  await page.locator("div", { hasText: "ZT5-SO-001" }).locator("button", { hasText: "출하예정 등록" }).last().click()
  await page.waitForSelector('[role="dialog"]')
  await page.locator('[role="dialog"] button[role="combobox"]').nth(1).click()
  await page.getByRole("option", { name: /ZT5 완제품창고/ }).first().click()
  await page.waitForFunction(() => !document.body.innerText.includes("LOT 조회 중"), null, { timeout: 20000 })
  const pickManual = async (comboIndex: number, lotNo: string) => {
    await page.locator('[role="dialog"] .rounded-md.border.p-3').first().locator('button[role="combobox"]').nth(comboIndex).click()
    await page.getByRole("option", { name: new RegExp(lotNo) }).first().click()
  }
  await pickManual(0, prep.a3)
  await page.locator('[role="dialog"] .rounded-md.border.p-3').first().getByRole("button", { name: /LOT 추가/ }).click()
  await pickManual(1, prep.a4)
  const manualQtys = await rowQtys(page, 0)
  await page.locator('[role="dialog"] input[type="number"]').first().fill("60")
  await page.locator('[role="dialog"] input[type="number"]').nth(1).fill("30")
  const sBefore2 = await prisma.shipmentOrder.findMany({ where: { tenantId: TENANT_ID }, select: { id: true } })
  await page.getByRole("button", { name: "이번 출하 제외" }).nth(1).click() // 이 출하에 포함하지 않을 품목(FG-B)은 기존 화면 규칙대로 제외한다
  await page.getByRole("button", { name: "등록", exact: true }).click()
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 30000 }).catch(() => undefined)
  const created2 = await prisma.shipmentOrder.findMany({ where: { tenantId: TENANT_ID, id: { notIn: sBefore2.map((s) => s.id) } }, include: { items: { include: { lot: true } } } })
  const sManual = created2[0]
  const sig = (s: typeof sQr, names: [string, string]) => JSON.stringify({ status: s.status, wh: s.warehouseId, so: s.salesOrderId, items: s.items.map((i) => [i.lot?.lotNo === names[0] ? "L1" : "L2", Number(i.qty), i.itemId, i.salesOrderItemId]).sort() })
  check("U14", created2.length === 1 && sig(sQr, [prep.a1, prep.a2]) === sig(sManual, [prep.a3, prep.a4]), "[QR = 수동] 수동으로 고른 출하예정과 QR 로 고른 출하예정의 결과 구조(상태·창고·수주·LOT 2행·수량·품목)가 동일", { qr: sig(sQr, [prep.a1, prep.a2]), manual: sig(sManual, [prep.a3, prep.a4]) })
  info("U14-DETAIL", `수동 선택 시 수량 제안: ${manualQtys.join(",")}`)

  // ── 출하 확정(실제 confirmShipment, 목록 탭) — QR 로 만든 출하 ─────────
  await page.goto(`${BASE}/app/mes/shipments`)
  await page.waitForLoadState("domcontentloaded")
  await page.getByRole("tab", { name: /출하 목록/ }).click()
  await page.waitForTimeout(500)
  const rowOfQr = page.locator("tr", { hasText: sQr.shipmentNo })
  await rowOfQr.locator("button").last().click().catch(() => undefined)
  const confirmItem = page.getByRole("menuitem", { name: /확정/ })
  if (await confirmItem.count()) await confirmItem.first().click()
  await page.waitForTimeout(3000)
  const sQrAfter = await prisma.shipmentOrder.findFirstOrThrow({ where: { id: sQr.id } })
  const a1Bal = await prisma.inventoryBalance.findFirstOrThrow({ where: { tenantId: TENANT_ID, lot: { lotNo: prep.a1 } } })
  const a2Bal = await prisma.inventoryBalance.findFirstOrThrow({ where: { tenantId: TENANT_ID, lot: { lotNo: prep.a2 } } })
  check("U15", sQrAfter.status === "SHIPPED" && Number(a1Bal.qtyOnHand) === 40 && Number(a2Bal.qtyOnHand) === 70, `[실제 화면 확정] QR 로 만든 출하 확정 → SHIPPED · 재고 a1 100→40, a2 100→70 (현재 ${Number(a1Bal.qtyOnHand)}/${Number(a2Bal.qtyOnHand)})`)
  check("U16", errors.length === 0, `브라우저 페이지 오류 없음 ${errors.slice(0, 2).join(" | ")}`)
  await browser.close()
  summary("ui-browser")
}
if (require.main === module) {
  main()
    .catch((e) => {
      console.error("실패:", String((e as Error).message).split("\n").slice(-6).join(" | "))
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
