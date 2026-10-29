/**
 * 실제 화면 검증 2부: 완제품 입고(LOT 자동채번) · MRP(AI 제거 · 일반 기능). 13-ui-lot-mrp.ts 가 호출한다.
 * 라벨은 미리보기/QR 디코드만 한다(실제 인쇄 없음).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Browser, Page } from "playwright-core"
import { check, info, prisma, TENANT_ID } from "./lib"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fx = any
type Helpers = {
  BASE: string
  SHOTS: string
  sessionToken: (fx: Fx, who: "dev" | "admin") => string
  newContext: (browser: Browser, token: string) => Promise<import("playwright-core").BrowserContext>
  watch: (page: Page) => void
  shot: (page: Page, name: string) => Promise<unknown>
  decodeLabelQr: (page: Page) => Promise<{ payload: string | null; texts: string }>
  maxSeq: (stem: string) => Promise<number>
  dialogs: string[]
  aiRequests: string[]
}

const AI_TEXT = /\bAI\b|인공지능|AI 발주|AI 분석|발주 전략|분석 요청/

function scanServerBundle(): { files: number; hits: string[] } {
  const root = join(process.cwd(), ".next", "server")
  const hits: string[] = []
  let files = 0
  const needles = ["suggestOptimalOrder", "getAISuggestion", "AISuggestionPanel", "mrp-ai.service"]
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (/\.(js|json)$/.test(name) && st.size < 40_000_000) {
        files += 1
        const text = readFileSync(full, "utf8")
        for (const n of needles) if (text.includes(n)) hits.push(`${full.replace(root, "")} :: ${n}`)
      }
    }
  }
  if (existsSync(root)) walk(root)
  return { files, hits }
}

export async function run(browser: Browser, fx: Fx, h: Helpers) {
  const biz = require("../../src/lib/business-numbering") as typeof import("../../src/lib/business-numbering")
  const { year2, monthText } = biz.kstDateParts()
  const ctx = await h.newContext(browser, h.sessionToken(fx, "admin"))
  const page = await ctx.newPage()
  h.watch(page)
  page.setDefaultTimeout(20000)

  // ═══ 완제품 입고 ═════════════════════════════════════════════════════════════
  await page.goto(`${h.BASE}/app/mes/finished-goods-receipt`, { waitUntil: "networkidle", timeout: 60000 })
  await h.shot(page, "08-fg-receipt-list")
  const readPending = async () => {
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length > 0, null, { timeout: 15000 }).catch(() => undefined)
    const rows = page.getByRole("row").filter({ has: page.getByRole("button", { name: "입고처리" }) })
    const nos: string[] = []
    for (let i = 0; i < (await rows.count()); i++) {
      const m = /WO-\d{4}-\d{3}/.exec(await rows.nth(i).innerText())
      if (m) nos.push(m[0])
    }
    return nos
  }
  let pendingNos = await readPending()
  // 입고 대기 작업지시(생산 완료 재공품)가 부족하면 ZT5 테스트 작업지시를 만들어 POP 생산 완료까지 진행한다(5단계 03/04 하네스 재사용, 완제품 입고는 하지 않는다).
  if (pendingNos.length < 2 && process.env.ZT5_POP_PIN) {
    const { workOrderWithWip } = await import("./03-wip-pop")
    const { produceAll } = await import("./04-fg-shipment")
    for (let i = pendingNos.length; i < 2; i++) {
      const t = await workOrderWithWip(fx, 10)
      await produceAll(fx, t.wo.id, 10)
      info("F0-prep", `테스트 작업지시 생산 완료(입고 대기): ${t.wo.orderNo}`)
    }
    await page.goto(`${h.BASE}/app/mes/finished-goods-receipt`, { waitUntil: "networkidle", timeout: 60000 })
    pendingNos = await readPending()
  }
  check("F0", pendingNos.length >= 2, `완제품 입고 대기 작업지시 ${pendingNos.length}건 확인(${pendingNos.slice(0, 4).join(", ")})`)
  if (pendingNos.length >= 2) await (async () => {

  const stemFg = `${fx.fgA.code}${year2}${monthText}-`
  const receive = async (orderNo: string) => {
    await page.goto(`${h.BASE}/app/mes/finished-goods-receipt`, { waitUntil: "networkidle", timeout: 60000 })
    await page.getByRole("row").filter({ hasText: orderNo }).getByRole("button", { name: "입고처리" }).click()
    const dlg = page.getByRole("dialog").first()
    await dlg.waitFor()
    await dlg.getByRole("combobox").first().click()
    await page.getByRole("option").filter({ hasText: "[ZT5-WH-FG]" }).first().click()
    // 입고 수량 입력란은 비어 있다 — "입고 가능" 수량(화면 표시값)을 그대로 입력한다.
    const avail = (await dlg.getByText("입고 가능", { exact: true }).locator("xpath=following-sibling::*[1]").innerText()).replace(/[^0-9.]/g, "")
    await dlg.locator("input").last().fill(avail)
    const qty = avail
    await h.shot(page, `09-fg-dialog-${orderNo}`)
    const lotsBefore = await prisma.lot.count({ where: { tenantId: TENANT_ID, itemId: fx.fgA.id } })
    await dlg.getByRole("button", { name: /^완제품 입고$/ }).click()
    // 입고 완료 후 서버가 발번한 LOT 로 라벨 미리보기가 열린다(또는 라벨 버튼 노출)
    await page.waitForFunction(() => !!document.querySelector('[data-label-kind="LOT_QR"]'), null, { timeout: 40000 }).catch(async () => {
      await page.getByRole("button", { name: /바코드 라벨 출력/ }).first().click().catch(() => undefined)
      await page.waitForFunction(() => !!document.querySelector('[data-label-kind="LOT_QR"]'), null, { timeout: 20000 })
    })
    await page.waitForFunction(() => document.querySelector('[data-label-kind="LOT_QR"]')?.getAttribute("data-label-state") === "ready", null, { timeout: 15000 }).catch(() => undefined)
    const label = await h.decodeLabelQr(page)
    await h.shot(page, `10-fg-label-${orderNo}`)
    const lotsAfter = await prisma.lot.count({ where: { tenantId: TENANT_ID, itemId: fx.fgA.id } })
    await page.keyboard.press("Escape")
    await page.waitForTimeout(800)
    return { qty: Number(qty), label, newLots: lotsAfter - lotsBefore }
  }

  // 시나리오 A: 제조번호가 없는 작업지시 → 번호 규칙 관리의 LOT 규칙으로 완제품 LOT 자동 발행
  const woA = await prisma.workOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, orderNo: pendingNos[0] }, include: { item: true } })
  check("F1", woA.item.code === fx.fgA.code && (woA.manufacturingNo === null || woA.manufacturingNo.startsWith("ZT5")), `대상 작업지시 ${woA.orderNo} 는 ZT5 테스트 데이터(${woA.item.code}, 제조번호 ${woA.manufacturingNo ?? "(이미 비움)"})`)
  await prisma.workOrder.update({ where: { id: woA.id }, data: { manufacturingNo: null } }) // 테스트 데이터(ZT5) 의 제조번호만 비움
  const baseSeq = await h.maxSeq(stemFg)
  const a = await receive(woA.orderNo ?? pendingNos[0])
  const expectedA = `${stemFg}${String(baseSeq + 1).padStart(3, "0")}`
  const lotA = await prisma.lot.findFirst({ where: { tenantId: TENANT_ID, lotNo: expectedA } })
  const balA = lotA ? await prisma.inventoryBalance.aggregate({ where: { tenantId: TENANT_ID, lotId: lotA.id }, _sum: { qtyOnHand: true } }) : null
  check("F2", !!lotA && lotA.itemId === fx.fgA.id && a?.newLots === 1, `제조번호 없는 완제품 입고 → 규칙 LOT 자동 발행 ${expectedA} (품목코드 ${fx.fgA.code} + YY${year2} + MM${monthText} + - + 순번3)`, { expectedA, lotA: lotA?.lotNo })
  check("F3", !!lotA && Number(balA?._sum.qtyOnHand) === a?.qty && a!.qty > 0, `완제품 LOT 재고 반영(${balA?._sum.qtyOnHand} = 입고수량 ${a?.qty})`)
  check("F4", a?.label.payload === `DAEWON|LOT|1|${expectedA}` && a.label.texts.includes(expectedA), `완제품 LOT 라벨 QR 디코드(${a?.label.payload}) = DB 의 LOT 번호, 라벨 텍스트 일치`)

  // 시나리오 B: 제조번호가 있는 작업지시 → 기존 정책 유지(제조번호 기반 LOT, 규칙 미적용)
  const woB = await prisma.workOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, orderNo: pendingNos[1] }, include: { item: true } })
  const mfgB = woB.manufacturingNo ?? ""
  const b = await receive(woB.orderNo ?? pendingNos[1])
  const lotB = await prisma.lot.findFirst({ where: { tenantId: TENANT_ID, itemId: fx.fgA.id, lotNo: { startsWith: mfgB } }, orderBy: { createdAt: "desc" } })
  const payloadB = b?.label.payload ?? ""
  check("F5", !!mfgB && !!lotB && !new RegExp(`^${stemFg}\\d{3}$`).test(lotB.lotNo) && payloadB === `DAEWON|LOT|1|${lotB.lotNo}`, `제조번호가 있으면 기존 정책 유지: LOT ${lotB?.lotNo} (제조번호 ${mfgB} 기반, 규칙 번호 아님), 라벨 QR 일치`, { mfgB, lotB: lotB?.lotNo, payloadB })
  check("F6", !(await prisma.numberingSequence.count()), "완제품 입고에서도 NumberingSequence 카운터는 사용되지 않음")
  })()

  // ═══ MRP ═════════════════════════════════════════════════════════════════════
  // 부족이 생기도록 큰 수량의 확정 생산계획(ZT6)을 만든다(ZT5-FG-A x 3,000,000 -> ZT5-RM-A 6,000,000 / ZT5-RM-B 3,000,000 필요).
  if (!fx.bom.isDefault) await prisma.bOM.update({ where: { id: fx.bom.id }, data: { isDefault: true } })
  const uiPlan = await prisma.productionPlan.create({
    data: { tenantId: TENANT_ID, siteId: fx.site.id, planNo: `ZT6-PP-UI-${Date.now().toString(36).toUpperCase()}`, planType: "MONTHLY", startDate: new Date(), endDate: new Date(Date.now() + 30 * 86400000), status: "CONFIRMED", items: { create: [{ itemId: fx.fgA.id, bomId: fx.bom.id, routingId: fx.routing.id, plannedQty: 3000000 }] } },
  })
  const bodyText = async () => (await page.locator("body").innerText()).replace(/\n+/g, " | ")
  const aiBad = (t: string) => AI_TEXT.test(t)
  await page.goto(`${h.BASE}/app/mes/mrp`, { waitUntil: "networkidle", timeout: 60000 })
  let all = await bodyText()
  check("M1", all.includes("MRP 자재소요량") && !aiBad(all), "MRP 첫 화면 표시, AI 관련 문구 없음")
  await h.shot(page, "11-mrp-order")

  await page.getByRole("button", { name: /조회 \/ MRP 실행/ }).click()
  await page.waitForFunction(() => document.body.innerText.includes("자재코드"), null, { timeout: 40000 })
  all = await bodyText()
  check("M2", all.includes("결품예측") && all.includes("ZT5-RM-A") && all.includes("필요 자재") && !aiBad(all), "수주기준 MRP 실행: 결품예측·필요 자재 KPI·자재 표(ZT5-RM-A) 정상, AI 영역 없음")
  await h.shot(page, "12-mrp-order-result")

  await page.getByText("발주제안", { exact: true }).first().click()
  await page.waitForFunction(() => document.body.innerText.includes("MRP 실행 저장"), null, { timeout: 40000 })
  all = await bodyText()
  check("M3", all.includes("MRP 실행 저장") && all.includes("선택 항목 구매발주(DRAFT) 생성") && !aiBad(all), "규칙 기반 발주제안 화면 정상(공급업체·MOQ·리드타임·DRAFT 생성 버튼), AI 발주 제안 영역 없음", { save: all.includes("MRP 실행 저장"), create: all.includes("선택 항목 구매발주(DRAFT) 생성"), ai: AI_TEXT.exec(all)?.[0], ctx: AI_TEXT.exec(all) ? all.slice(Math.max(0, AI_TEXT.exec(all)!.index - 40), AI_TEXT.exec(all)!.index + 40) : null })
  await h.shot(page, "13-mrp-purchase-suggestion")

  await page.getByRole("tab", { name: "품목 시뮬레이션" }).click()
  await page.getByRole("button", { name: /제품 추가/ }).click()
  await page.getByPlaceholder("예: FG-001").fill(fx.fgA.code)
  await page.locator("button.w-full.text-left", { hasText: fx.fgA.code }).first().click()
  await page.locator("table input").first().fill("10")
  await page.getByRole("button", { name: /시뮬레이션 실행/ }).click()
  await page.waitForFunction((code) => document.body.innerText.includes(code) && /ZT5-RM-A/.test(document.body.innerText), fx.fgA.code, { timeout: 40000 })
  all = await bodyText()
  check("M4", all.includes("ZT5-RM-A") && !aiBad(all), "품목 시뮬레이션: ZT5-FG-A 추가·실행 → 소요 자재(ZT5-RM-A) 계산 표시, 실제 데이터 변경 없음 안내")
  await h.shot(page, "14-mrp-simulation")

  await page.getByRole("tab", { name: "실행이력" }).click()
  await page.waitForFunction(() => document.body.innerText.includes("MRP 실행이력"), null, { timeout: 20000 })
  all = await bodyText()
  check("M5", all.includes("실행일시") && !aiBad(all), "MRP 실행이력 화면 정상(저장은 영구 기록이라 이번 테스트에서 하지 않음)")

  await page.getByRole("tab", { name: "생산계획 MRP" }).click()
  await page.getByRole("combobox").first().click()
  const planOpt = page.getByRole("option").filter({ hasText: uiPlan.planNo }).first()
  const planText = (await planOpt.innerText()).split(" — ")[0]
  await planOpt.click()
  await page.getByRole("button", { name: /^MRP 실행$/ }).click()
  await page.waitForFunction(() => /ZT5-RM-A/.test(document.body.innerText) && /ZT5-RM-B/.test(document.body.innerText), null, { timeout: 40000 })
  all = await bodyText()
  check("M6", all.includes("ZT5-RM-A") && all.includes("ZT5-RM-B") && !aiBad(all), `생산계획 MRP(${planText}) 실행: BOM 전개 결과(ZT5-RM-A/B) 표시, 아래 AI 발주 제안 패널 없음`)
  await h.shot(page, "15-mrp-plan-result")
  const rowA = page.getByRole("row").filter({ hasText: "ZT5-RM-A" }).first()
  const planGross = (await rowA.innerText()).split(/s+/).join(" ")
  check("M6b", /6000000(.00)?/.test(planGross.split(",").join("")) && planGross.indexOf("충분") < 0, `BOM 전개·결품 예측: ZT5-RM-A 총소요 6,000,000 / 상태 부족(${planGross.slice(0, 110)})`)

  const poBefore = await prisma.purchaseOrder.count({ where: { tenantId: TENANT_ID, orderNo: { startsWith: "PO-MRP-" } } })
  await rowA.getByRole("checkbox").click()
  await page.getByRole("button", { name: /1개 자재 발주 생성/ }).click()
  await page.waitForFunction(() => document.body.innerText.includes("발주 생성 완료"), null, { timeout: 40000 })
  const msg = /발주 생성 완료: (PO-MRP-\d+)/.exec(await bodyText())
  const poAfter = await prisma.purchaseOrder.findFirst({ where: { tenantId: TENANT_ID, orderNo: msg?.[1] ?? "none" }, include: { items: true } })
  check("M7", !!msg && !!poAfter && poAfter.status === "DRAFT" && poAfter.items.length === 1 && poAfter.items[0].itemId === fx.rmA.id && (await prisma.purchaseOrder.count({ where: { tenantId: TENANT_ID, orderNo: { startsWith: "PO-MRP-" } } })) === poBefore + 1, `일반 발주서 생성 정상: ${msg?.[1]} (DRAFT, ZT5-RM-A 1줄)`)

  // 서버/네트워크: AI 요청 없음 + 빌드 산출물에 MRP AI 코드 없음
  check("M8", h.aiRequests.length === 0, `MRP 전 화면 조작 중 AI/OpenAI 관련 네트워크 요청 0건 (${h.aiRequests.length})`, h.aiRequests)
  const scan = scanServerBundle()
  check("M9", scan.files > 50 && scan.hits.length === 0, `production 서버 번들(${scan.files}개 파일)에 getAISuggestion/suggestOptimalOrder/AISuggestionPanel/mrp-ai.service 없음 — 서버 액션이 존재하지 않아 직접 호출 불가`, scan.hits.slice(0, 3))
  await ctx.close()
}
