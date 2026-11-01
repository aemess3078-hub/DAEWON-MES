/**
 * 통합 흐름(UI): 품목 등록 → BOM 등록 → 라우팅 등록 → 검사표준 등록 → 생산계획 등록 → 작업지시 생성
 * 단계마다 DB 에서 품목 ID·BOM·라우팅·공정 순서·검사표준 참조, 테넌트 격리, 정합성을 확인한다.
 * 이어서 참조 중인 BOM/라우팅/검사표준의 변경·삭제 제한(DW-TC-040, 077, 085)을 검증한다.
 * 로컬 테스트 DB 한정. 데이터는 E2E-BR- 접두사, 정리는 seed-bomflow.ts REMOVE=1.
 */
import { test, expect, type Page } from "@playwright/test"
import { assertSafeE2eEnvironment } from "./guard"
import { login, gotoMenu, dialog, rowOf, openRowAction, tcOf, tcTitle, collectDialogs } from "./tc-helpers"
import { db, loadData, uniq, record, submitBtn, settle, openCreate, pickLabeled, pickByPlaceholder, dec, visibleMessages } from "./support/bomflow-lib"

assertSafeE2eEnvironment()

const D = loadData()
const RM1 = D.items.rm1
const RM2 = D.items.rm2
const WC1 = D.workCenters.wc1
const WC2 = D.workCenters.wc2
const EQ1 = D.equipments.eq1
const ITEM = { code: `E2E-BR-FLOW-${uniq}`, name: `E2E-BR 흐름 완제품 ${uniq}` }
const BOM_VER = `F-${uniq}`
const RT = { code: `E2E-BR-RT-${uniq}-F`, name: `E2E-BR 흐름 라우팅 ${uniq}` }
const SPEC_VER = `FQ-${uniq}`
const PLAN_NO = `E2E-BR-PP-${uniq}`
const WO_NO = `E2E-BR-WO-${uniq}`
const MFG_NO = `E2E-BR-MFG-${uniq}`
const QTY = 100
let planNoAuto = ""

const ids: { itemId?: string; bomId?: string; routingId?: string; ops?: string[]; specId?: string; planId?: string; planItemId?: string; woId?: string } = {}

// 실패한 테스트 뒤에는 워커가 새로 뜨면서 모듈 변수가 초기화되므로, 매 테스트 전에 결정적 코드로 DB 에서 식별자를 복원한다.
async function getIds() {
  const t = D.tenantId
  const item = await db.item.findFirst({ where: { tenantId: t, code: ITEM.code } })
  const bom = item ? await db.bOM.findFirst({ where: { tenantId: t, itemId: item.id, version: BOM_VER } }) : null
  const rt = await db.routing.findFirst({ where: { tenantId: t, code: RT.code }, include: { operations: { orderBy: { seq: "asc" } } } })
  const spec = item ? await db.inspectionSpec.findFirst({ where: { tenantId: t, itemId: item.id, version: SPEC_VER } }) : null
  const plan = item ? await db.productionPlan.findFirst({ where: { tenantId: t, items: { some: { itemId: item.id } }, planNo: { not: { startsWith: PLAN_NO } } }, include: { items: true } }) : null
  const wo = item ? await db.workOrder.findFirst({ where: { tenantId: t, itemId: item.id } }) : null
  return { itemId: item?.id, bomId: bom?.id, routingId: rt?.id, ops: rt?.operations.map((o) => o.id), specId: spec?.id, planId: plan?.id, planItemId: plan?.items[0]?.id, woId: wo?.id }
}

const dbItem = () => db.item.findFirst({ where: { tenantId: D.tenantId, code: ITEM.code } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

test.describe("통합 흐름 — 품목→BOM→라우팅→검사표준→생산계획→작업지시", () => {
  test.beforeEach(async () => { Object.assign(ids, await getIds()) })
  test.afterAll(async () => { await db.$disconnect() })

  test("[FLOW-1] 품목 등록(완제품, 분류·품목군 지정)", async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, "/app/mes/items")
    await openCreate(page, /품목 등록/)
    await dialog(page).getByLabel(/^품목코드/).fill(ITEM.code)
    await dialog(page).getByLabel(/^품목명/).fill(ITEM.name)
    await dialog(page).getByLabel(/^품목분류/).first().click()
    await page.getByRole("option", { name: new RegExp(D.categories.fg.name) }).first().click()
    await dialog(page).getByLabel(/^단위/).first().click()
    await page.getByRole("option", { name: /^EA/ }).first().click()
    await submitBtn(page).click()
    await expect(dialog(page), `저장 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
    const it = await dbItem()
    expect(it, "품목 생성").not.toBeNull()
    ids.itemId = it!.id
    expect(it!.itemType, "분류의 시스템 유형(완제품)에 따라 품목유형 결정").toBe("FINISHED")
    expect(it!.tenantId).toBe(D.tenantId)
    record("FLOW", null, { step: "item", itemId: it!.id, code: ITEM.code })
  })

  test("[FLOW-2] BOM 등록(구성품 2종·활성·기본) → 품목 ID 연결", async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, "/app/mes/bom")
    await openCreate(page, /BOM 등록/)
    await pickLabeled(page, "대상 품목", new RegExp(ITEM.code))
    await dialog(page).getByLabel("버전").fill(BOM_VER)
    await pickLabeled(page, "상태", "활성")
    await dialog(page).getByRole("switch").first().click()
    for (const [i, c] of [[0, RM1], [1, RM2]] as const) {
      await dialog(page).getByRole("button", { name: /자재 추가/ }).click()
      await pickByPlaceholder(page, "자재 선택", new RegExp(c.code))
      await dialog(page).locator('input[type="number"]').nth(i).fill(String(i === 0 ? 2 : 3))
    }
    await submitBtn(page).click()
    await expect(dialog(page), `저장 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
    const bom = await db.bOM.findFirst({ where: { tenantId: D.tenantId, itemId: ids.itemId!, version: BOM_VER }, include: { bomItems: { orderBy: { seq: "asc" } } } })
    expect(bom, "BOM 생성").not.toBeNull()
    ids.bomId = bom!.id
    expect(bom!.itemId, "BOM 의 품목 ID = 1단계 품목").toBe(ids.itemId)
    expect(bom!.bomItems.map((b) => [b.componentItemId, dec(b.qtyPer)])).toEqual([[RM1.id, 2], [RM2.id, 3]])
    record("FLOW", null, { step: "bom", bomId: bom!.id })
  })

  test("[FLOW-3] 라우팅 등록(품목 전용·기본·공정 2개) → 품목 ID·공정 순서", async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, "/app/mes/routing")
    await openCreate(page, /라우팅 등록/)
    await dialog(page).getByLabel("라우팅 코드").fill(RT.code)
    await dialog(page).getByLabel("라우팅 명").fill(RT.name)
    await dialog(page).getByLabel("버전").fill("1.0")
    await pickLabeled(page, "상태", "활성")
    await dialog(page).getByRole("combobox").filter({ hasText: /반제품 검색|개 품목 선택됨/ }).first().click()
    await page.getByRole("button", { name: new RegExp(ITEM.code) }).first().click()
    await page.getByRole("combobox").filter({ hasText: /개 품목 선택됨/ }).first().click()
    await dialog(page).getByRole("switch").first().click()
    for (const [i, wc, tm] of [[0, WC1, 5], [1, WC2, 8]] as const) {
      await dialog(page).getByRole("button", { name: /공정 추가/ }).click()
      await pickByPlaceholder(page, "공정 선택", new RegExp(wc.code))
      await dialog(page).locator('input[type="number"]').nth(i).fill(String(tm))
    }
    await submitBtn(page).click()
    await expect(dialog(page), `저장 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
    const rt = await db.routing.findFirst({ where: { tenantId: D.tenantId, code: RT.code }, include: { operations: { orderBy: { seq: "asc" } }, items: true } })
    expect(rt, "라우팅 생성").not.toBeNull()
    ids.routingId = rt!.id
    ids.ops = rt!.operations.map((o) => o.id)
    expect(rt!.items.map((i) => [i.itemId, i.isDefault]), "라우팅의 품목 ID = 1단계 품목, 기본").toEqual([[ids.itemId, true]])
    expect(rt!.operations.map((o) => [o.seq, o.workCenterId])).toEqual([[1, WC1.id], [2, WC2.id]])
    record("FLOW", null, { step: "routing", routingId: rt!.id, ops: ids.ops })
  })

  test("[FLOW-4] 검사표준 등록(라우팅 1번 공정) → 품목·공정 참조", async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, "/app/mes/master/inspection-standards")
    await openCreate(page, /검사표준 등록/)
    await pickLabeled(page, "품목", new RegExp(ITEM.code))
    await pickLabeled(page, "공정", new RegExp(`\\[${RT.code}\\].*seq\\.1\\)`))
    await dialog(page).getByLabel("버전").fill(SPEC_VER)
    await pickLabeled(page, "상태", "활성")
    await dialog(page).getByRole("button", { name: /항목 추가/ }).click()
    await dialog(page).getByPlaceholder("항목명").first().fill("외경")
    await dialog(page).locator('input[type="number"]').nth(1).fill("9.95")
    await dialog(page).locator('input[type="number"]').nth(2).fill("10.05")
    await dialog(page).getByPlaceholder("mm").first().fill("mm")
    await submitBtn(page).click()
    await expect(dialog(page), `저장 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
    const spec = await db.inspectionSpec.findFirst({ where: { tenantId: D.tenantId, itemId: ids.itemId!, version: SPEC_VER }, include: { inspectionItems: true } })
    expect(spec, "검사표준 생성").not.toBeNull()
    ids.specId = spec!.id
    expect(spec!.routingOperationId, "검사 공정 = 라우팅 1번 공정").toBe(ids.ops![0])
    expect(spec!.inspectionItems.length).toBe(1)
    record("FLOW", null, { step: "inspectionSpec", specId: spec!.id })
  })

  test("[FLOW-5] 생산계획 등록(확정) — 품목 BOM·라우팅 자동 연결", async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, "/app/mes/production-plan")
    await openCreate(page, /생산계획 등록/)
    // 계획번호는 서버가 채번한다(createPlan 이 폼 값을 무시) — 시트가 자동 채번으로 초기화될 때까지 기다린 뒤 나머지를 입력한다
    await expect(dialog(page).getByLabel("계획번호")).not.toHaveValue("", { timeout: 20_000 })
    await page.waitForTimeout(500)
    await pickLabeled(page, "공장", new RegExp(D.site.code))
    await pickLabeled(page, "상태", "확정")
    await dialog(page).locator('input[type="date"]').nth(0).fill("2026-11-02")
    await dialog(page).locator('input[type="date"]').nth(1).fill("2026-11-06")
    await dialog(page).getByRole("button", { name: /품목 추가/ }).click()
    const row = dialog(page).locator("tbody tr").first()
    await row.getByRole("combobox").first().click()
    await page.getByRole("option", { name: new RegExp(ITEM.code) }).first().click()
    await page.waitForTimeout(1500)
    // BOM 은 기본 BOM 을 선택, 라우팅은 자동 선택(품목 전용 기본) 되는지 확인
    await row.getByRole("combobox").nth(1).click()
    await page.getByRole("option", { name: new RegExp(BOM_VER) }).first().click()
    const routingText = await row.getByRole("combobox").nth(2).innerText()
    expect(routingText, "라우팅이 품목 전용 기본 라우팅으로 자동 선택됨").toContain(RT.code)
    await row.locator("input").first().fill(String(QTY))
    await submitBtn(page).click()
    await expect(dialog(page), `저장 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
    const plan = await db.productionPlan.findFirst({ where: { tenantId: D.tenantId, items: { some: { itemId: ids.itemId! } }, planNo: { not: { startsWith: PLAN_NO } } }, include: { items: true } })
    expect(plan, "생산계획 생성").not.toBeNull()
    planNoAuto = plan!.planNo
    ids.planId = plan!.id
    expect(plan!.status).toBe("CONFIRMED")
    expect(plan!.items.length).toBe(1)
    const pi = plan!.items[0]
    ids.planItemId = pi.id
    expect([pi.itemId, pi.bomId, pi.routingId], "계획 품목의 품목·BOM·라우팅 참조").toEqual([ids.itemId, ids.bomId, ids.routingId])
    expect(dec(pi.plannedQty)).toBe(QTY)
    record("FLOW", null, { step: "plan", planId: plan!.id, planItemId: pi.id })
  })

  test("[FLOW-6] 작업지시 생성(확정 생산계획 선택·설비 지정) — 공정 순서·참조 일관성", async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, "/app/mes/work-orders")
    await openCreate(page, /작업지시 (등록|생성)/)
    await dialog(page).getByRole("combobox").filter({ hasText: /생산계획 없이 등록|확정된 생산계획 선택/ }).first().click()
    const planOpts = await page.getByRole("option").allInnerTexts()
    const planNo = (await db.productionPlan.findFirst({ where: { id: ids.planId! } }))!.planNo
    expect(planOpts.some((t) => t.includes(planNo)), "확정된 생산계획이 선택 목록에 나옴").toBe(true)
    await page.getByRole("option", { name: new RegExp(planNo) }).first().click()
    await page.waitForTimeout(2000)
    await expect(dialog(page).getByLabel("작업지시번호")).not.toHaveValue("", { timeout: 20_000 })
    await dialog(page).getByLabel("작업지시번호").fill(WO_NO)
    await dialog(page).getByLabel("제조번호").fill(MFG_NO)
    // 첫 공정에 설비 지정(작업장 E2E-BR-WC-1 소속 설비만 노출되어야 함)
    const eqSelect = dialog(page).getByRole("combobox").filter({ hasText: "설비 없음" }).first()
    await eqSelect.click()
    const eqOpts = await page.getByRole("option").allInnerTexts()
    expect(eqOpts.some((t) => t.includes(EQ1.code)), "1번 공정 작업장의 설비 노출").toBe(true)
    expect(eqOpts.some((t) => t.includes("E2E-T2")), "타 테넌트 설비 비노출").toBe(false)
    await page.getByRole("option", { name: new RegExp(EQ1.code) }).first().click()
    const comboTexts = await dialog(page).getByRole("combobox").allInnerTexts()
    record("FLOW", null, { step: "workOrder-form-before-submit", comboTexts, qty: await dialog(page).getByLabel("계획수량").inputValue() })
    await submitBtn(page).click()
    await page.waitForTimeout(3000)
    const msgs = await visibleMessages(page)
    // 작업지시번호도 서버가 채번하므로(createWorkOrder → generateOrderNo) 품목으로 조회한다
    const wo = await db.workOrder.findFirst({ where: { tenantId: D.tenantId, itemId: ids.itemId! }, include: { operations: { orderBy: { seq: "asc" }, include: { assignments: true } } } })
    expect(wo, `작업지시 생성 (alert=${JSON.stringify(dialogs)}, 화면=${JSON.stringify(msgs)})`).not.toBeNull()
    ids.woId = wo!.id
    record("FLOW", null, { step: "workOrder", woId: wo!.id, orderNo: wo!.orderNo, manufacturingNo: wo!.manufacturingNo, typedOrderNo: WO_NO, typedMfgNo: MFG_NO })
    expect([wo!.itemId, wo!.bomId, wo!.routingId, wo!.productionPlanItemId], "작업지시의 품목·BOM·라우팅·계획 품목 참조").toEqual([ids.itemId, ids.bomId, ids.routingId, ids.planItemId])
    expect(dec(wo!.plannedQty), "계획수량 = 계획 품목 수량").toBe(QTY)
    expect(wo!.operations.map((o) => o.routingOperationId), "작업지시 공정 = 라우팅 공정(순서 동일)").toEqual(ids.ops)
    expect(wo!.operations.map((o) => o.seq)).toEqual([1, 2])
    expect(wo!.operations.map((o) => dec(o.plannedQty)), "공정별 계획수량").toEqual([QTY, QTY])
    const op1Eq = wo!.operations[0].equipmentId ?? wo!.operations[0].assignments[0]?.equipmentId
    expect(op1Eq, "1번 공정에 설비 연결").toBe(EQ1.id)
    // 테넌트 일관성: 연결된 모든 행이 같은 테넌트
    const refs = await db.$queryRaw<{ n: bigint }[]>`select count(*) n from "Item" i, "BOM" b, "Routing" r where i.id=${ids.itemId} and b.id=${ids.bomId} and r.id=${ids.routingId} and i."tenantId"=${D.tenantId} and b."tenantId"=${D.tenantId} and r."tenantId"=${D.tenantId}`
    expect(Number(refs[0].n), "품목·BOM·라우팅이 모두 같은 테넌트").toBe(1)
  })

  // ───────── 참조 중인 마스터의 변경·삭제 제한 ─────────
  test("[FLOW-7] 사용 중 라우팅 — 공정 목록 변경/삭제 차단, 작업지시 공정 불변 (DW-TC-040)", async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, "/app/mes/routing")
    const opsBefore = (await db.workOrderOperation.findMany({ where: { workOrderId: ids.woId }, orderBy: { seq: "asc" } })).map((o) => [o.id, o.routingOperationId, o.seq])
    // 공정 변경 시도: 1번 공정 삭제
    await openRowAction(page, RT.code, "수정")
    await expect(dialog(page)).toBeVisible()
    await dialog(page).locator('button[class*="hover:text-destructive"]').first().click()
    await submitBtn(page).click()
    await page.waitForTimeout(3500)
    const stillOpen = await dialog(page).isVisible().catch(() => false)
    if (stillOpen) await page.keyboard.press("Escape")
    const rt = await db.routing.findFirst({ where: { id: ids.routingId }, include: { operations: { orderBy: { seq: "asc" } } } })
    expect(rt!.operations.map((o) => o.id), "사용 중 라우팅의 공정은 변경되지 않음").toEqual(ids.ops)
    expect(dialogs.join(" "), `사용 중 안내 표시 (alert=${JSON.stringify(dialogs)})`).toMatch(/사용 중/)
    // 삭제 시도
    await settle(page)
    await openRowAction(page, RT.code, "삭제")
    await page.waitForTimeout(3000)
    expect(await db.routing.count({ where: { id: ids.routingId } }), "사용 중 라우팅은 삭제되지 않음").toBe(1)
    const opsAfter = (await db.workOrderOperation.findMany({ where: { workOrderId: ids.woId }, orderBy: { seq: "asc" } })).map((o) => [o.id, o.routingOperationId, o.seq])
    expect(opsAfter, "작업지시 공정 불변").toEqual(opsBefore)
    record("FLOW", null, { step: "routing-in-use", alerts: dialogs })
  })

  test("[FLOW-8] 참조 중인 BOM 삭제 시 데이터 보호 (작업지시·생산계획 참조)", async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, "/app/mes/bom")
    await openRowAction(page, BOM_VER, "삭제")
    await page.waitForTimeout(3500)
    await settle(page)
    const bom = await db.bOM.findUnique({ where: { id: ids.bomId }, include: { bomItems: true } })
    const wo = await db.workOrder.findUnique({ where: { id: ids.woId } })
    const pi = await db.productionPlanItem.findUnique({ where: { id: ids.planItemId } })
    record("FLOW", null, { step: "bom-in-use", bomExists: !!bom, woBom: wo?.bomId, planItemBom: pi?.bomId, alerts: dialogs })
    expect(bom, `작업지시가 참조하는 BOM 은 삭제되지 않음 (alert=${JSON.stringify(dialogs)})`).not.toBeNull()
    expect(bom!.bomItems.length, "BOM 구성품 유지").toBe(2)
    expect(wo!.bomId).toBe(ids.bomId)
    expect(pi!.bomId, "생산계획 품목의 BOM 참조 유지").toBe(ids.bomId)
    // 삭제는 막혔지만 사용자에게 이유를 알려야 한다
    const alerts = dialogs.filter((d) => d.startsWith("alert:"))
    expect.soft(alerts.length, `삭제 불가 사유 안내 없음 (confirm 외 alert 없음: ${JSON.stringify(dialogs)})`).toBeGreaterThan(0)
  })

  test("[FLOW-9] 계획만 참조하는 BOM 삭제 시 계획의 BOM 참조가 조용히 끊기지 않는다", async ({ page }) => {
    const dialogs = collectDialogs(page)
    // 작업지시 없이 생산계획 품목만 참조하는 BOM 을 DB 로 준비(테스트 픽스처)
    const spare = await db.bOM.create({ data: { tenantId: D.tenantId, itemId: ids.itemId!, version: `FS-${uniq}`, status: "DRAFT", isDefault: false, bomItems: { create: [{ componentItemId: RM1.id, seq: 1, qtyPer: 1, scrapRate: 0 }] } } })
    const plan2 = await db.productionPlan.create({ data: { tenantId: D.tenantId, siteId: D.site.id, planNo: `${PLAN_NO}-S`, planType: "WEEKLY", status: "DRAFT", startDate: new Date("2026-11-09"), endDate: new Date("2026-11-13") } })
    const pi2 = await db.productionPlanItem.create({ data: { planId: plan2.id, itemId: ids.itemId!, bomId: spare.id, routingId: ids.routingId, plannedQty: 5 } })
    await login(page)
    await gotoMenu(page, "/app/mes/bom")
    await openRowAction(page, `FS-${uniq}`, "삭제")
    await page.waitForTimeout(3500)
    const bomAfter = await db.bOM.findUnique({ where: { id: spare.id } })
    const piAfter = await db.productionPlanItem.findUnique({ where: { id: pi2.id } })
    record("FLOW", null, { step: "bom-plan-only", bomDeleted: !bomAfter, planItemBomAfter: piAfter?.bomId ?? null, alerts: dialogs })
    // 정책: 계획이 참조하는 BOM 은 삭제가 제한되어야 한다(삭제되면 계획의 BOM 참조가 null 로 바뀌어 소요량 전개가 달라진다)
    expect(bomAfter, `계획이 참조 중인 BOM 이 삭제됨 → 계획 품목 bomId=${piAfter?.bomId ?? "null"} (alert=${JSON.stringify(dialogs)})`).not.toBeNull()
  })

  test("[FLOW-10] 검사표준 ↔ 생산·품질검사 연계 — 작업지시 공정에서 적용 표준 조회", async ({ page }) => {
    // 생산·품질검사 메뉴(초중종검사)가 작업지시 공정을 기준으로 검사표준을 찾는 서버 로직을 DB 기준으로 대조한다.
    const op1Id = (await db.workOrderOperation.findFirst({ where: { workOrderId: ids.woId, seq: 1 } }))!.id
    const wop = await db.workOrderOperation.findUnique({ where: { id: op1Id }, include: { routingOperation: true } })
    const specs = await db.inspectionSpec.findMany({ where: { tenantId: D.tenantId, itemId: ids.itemId!, routingOperationId: wop!.routingOperationId, status: "ACTIVE" }, include: { inspectionItems: true } })
    record("FLOW", null, { step: "inspection-link", woOperation: op1Id, specs: specs.map((s) => [s.id, s.version, s.inspectionItems.length]) })
    expect(specs.map((s) => s.id), "작업지시 1번 공정에 적용되는 활성 검사표준 = 4단계 등록 표준").toEqual([ids.specId])
    expect(specs[0].inspectionItems.length).toBe(1)
    await login(page)
    const resp = await gotoMenu(page, "/app/mes/inspection-stages")
    expect(resp?.status(), "초중종검사 화면 정상").toBeLessThan(400)
  })

  // ───────── 검사표준 ↔ 검사실적 참조 (DW-TC-085 삭제 제한, DW-TC-088 적용 표준 연결) ─────────
  test("[FLOW-11] 검사실적이 있는 검사표준 — 삭제·검사항목 교체 차단, 실적의 표준 연결 유지", async ({ page }) => {
    const dialogs = collectDialogs(page)
    // 검사실적 1건(+측정 1건)을 DB 로 준비한다(검사실적 등록 화면 자체는 후속 배치의 검증 대상 — 여기서는 표준의 보호 규칙만 확인)
    const cred = await db.userCredential.findFirst({ where: { tenantId: D.tenantId, loginId: process.env.SEED_ADMIN_LOGIN_ID } })
    const wop = await db.workOrderOperation.findFirst({ where: { workOrderId: ids.woId!, seq: 1 } })
    const spec = await db.inspectionSpec.findUnique({ where: { id: ids.specId! }, include: { inspectionItems: true } })
    expect(cred && wop && spec, "선행 데이터").toBeTruthy()
    const qi = await db.qualityInspection.create({ data: { workOrderOperationId: wop!.id, inspectionSpecId: spec!.id, inspectorId: cred!.profileId, stage: "MID", result: "PASS", inspectedQty: 1 } })
    const it0 = spec!.inspectionItems[0]
    await db.inspectionMeasurement.create({ data: { tenantId: D.tenantId, qualityInspectionId: qi.id, inspectionItemId: it0.id, numericValue: 10, lowerLimitSnapshot: it0.lowerLimit, upperLimitSnapshot: it0.upperLimit, itemNameSnapshot: it0.name, inputTypeSnapshot: it0.inputType, unitSnapshot: it0.unit, judgement: "PASS" } })
    await login(page)
    await gotoMenu(page, "/app/mes/master/inspection-standards")
    const rowIcon = async (text: string, which: "edit" | "delete") => {
      const row = rowOf(page, text).first()
      await expect(row).toBeVisible({ timeout: 20_000 })
      const btns = row.getByRole("button")
      const n = await btns.count()
      await btns.nth(which === "edit" ? n - 2 : n - 1).click()
    }
    // (a) 삭제 시도 → 차단
    await rowIcon(SPEC_VER, "delete")
    await page.waitForTimeout(3000)
    expect(await db.inspectionSpec.count({ where: { id: spec!.id } }), "검사실적이 있는 표준은 삭제되지 않음").toBe(1)
    expect(await db.qualityInspection.count({ where: { id: qi.id } }), "검사실적 보존").toBe(1)
    const delAlerts = dialogs.filter((d) => d.startsWith("alert:"))
    // (b) 검사항목 교체 시도 → 측정 이력으로 차단
    await settle(page)
    await rowIcon(SPEC_VER, "edit")
    await expect(dialog(page)).toBeVisible()
    await dialog(page).getByPlaceholder("항목명").first().fill("외경(변경시도)")
    await submitBtn(page).click()
    await page.waitForTimeout(3000)
    if (await dialog(page).isVisible().catch(() => false)) await page.keyboard.press("Escape")
    const itemsAfter = await db.inspectionItem.findMany({ where: { inspectionSpecId: spec!.id } })
    expect(itemsAfter.map((i) => i.name), "측정 이력이 있는 표준의 검사항목은 변경되지 않음").toEqual([it0.name])
    // (c) 실적의 적용 표준 연결 + 측정 당시 기준 스냅샷 유지
    const meas = await db.inspectionMeasurement.findFirst({ where: { qualityInspectionId: qi.id } })
    const qiAfter = await db.qualityInspection.findUnique({ where: { id: qi.id } })
    expect(qiAfter!.inspectionSpecId, "검사실적의 적용 표준 연결 유지").toBe(spec!.id)
    expect([meas!.itemNameSnapshot, dec(meas!.lowerLimitSnapshot), dec(meas!.upperLimitSnapshot)], "측정 당시 기준 스냅샷 유지").toEqual([it0.name, 9.95, 10.05])
    record("FLOW", null, { step: "inspection-record-protect", delAlerts, allDialogs: dialogs })
    expect.soft(delAlerts.length, `삭제 차단 사유 안내 (alert=${JSON.stringify(dialogs)})`).toBeGreaterThan(0)
  })
})
