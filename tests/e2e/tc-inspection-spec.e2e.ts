/**
 * TC 엑셀 기반: 검사표준관리 — 등록/유지 · 검색/필터 · 입력검증 · 수정/삭제 · 업무규칙(검사 항목·상하한 규격)
 * 선행 데이터: 시드 품목(E2E-BR-FG-001/002)과 공정이 2개인 픽스처 라우팅(E2E-BR-RT-<suffix>-Q, FG-001 전용)은 Prisma 로 만든다
 * (라우팅 화면 자체는 tc-routing 이 검증). 로컬 테스트 DB 한정.
 * 검사표준에 연결된 검사실적(생산·품질검사 메뉴 연계)은 tc-flow-integration 에서 확인한다.
 */
import { test, expect, type Page } from "@playwright/test"
import { assertSafeE2eEnvironment } from "./guard"
import { login, gotoMenu, dialog, rowOf, tcOf, tcTitle, collectDialogs } from "./tc-helpers"
import { db, loadData, uniq, record, submitBtn, settle, openCreate, pickLabeled, searchBox, dec } from "./support/bomflow-lib"

assertSafeE2eEnvironment()

const D = loadData()
const PATH = "/app/mes/master/inspection-standards"
const CREATE = /검사표준 등록/
const FG = D.items.fg1
const FG2 = D.items.fg2
const RT = `E2E-BR-RT-${uniq}-Q`
const VER1 = `Q1-${uniq}`
const T = (type: string, kw?: RegExp) => tcOf("검사표준관리", type, kw)

const specOf = (itemId: string, opId: string, version: string) =>
  db.inspectionSpec.findFirst({ where: { tenantId: D.tenantId, itemId, routingOperationId: opId, version }, include: { inspectionItems: { orderBy: { seq: "asc" } } } })

// 이 화면의 행 동작은 아이콘 버튼(연필/휴지통, 접근성 이름 없음 — 결함 D-02 유형)이라 위치로 찾는다
async function rowIcon(page: Page, rowText: string, which: "edit" | "delete") {
  const row = rowOf(page, rowText).first()
  await expect(row, `행 '${rowText}'`).toBeVisible({ timeout: 20_000 })
  const btns = row.getByRole("button")
  const n = await btns.count()
  await btns.nth(which === "edit" ? n - 2 : n - 1).click()
}

let op1 = "" // 픽스처 라우팅의 1번 공정 id
let op2 = ""

type Row = { name: string; type?: "수치" | "텍스트" | "합불" | "선택"; lower?: string; upper?: string; unit?: string; seq?: string }
async function addRows(page: Page, rows: Row[]) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    await dialog(page).getByRole("button", { name: /항목 추가/ }).click()
    if (r.seq !== undefined) await dialog(page).locator('input[type="number"]').nth(3 * i).fill(r.seq)
    await dialog(page).getByPlaceholder("항목명").nth(i).fill(r.name)
    if (r.type) {
      await dialog(page).getByRole("combobox").nth(3 + i).click()
      await page.getByRole("option", { name: r.type }).first().click()
    }
    if (r.lower !== undefined) await dialog(page).locator('input[type="number"]').nth(3 * i + 1).fill(r.lower)
    if (r.upper !== undefined) await dialog(page).locator('input[type="number"]').nth(3 * i + 2).fill(r.upper)
    if (r.unit) await dialog(page).getByPlaceholder("mm").nth(i).fill(r.unit)
  }
}
async function fillSpec(page: Page, o: { item?: { code: string } | null; opSeq?: 1 | 2; version?: string; status?: "초안" | "활성" | "비활성"; rows?: Row[] }) {
  if (o.item !== null) await pickLabeled(page, "품목", new RegExp((o.item ?? FG).code))
  if (o.opSeq !== null) await pickLabeled(page, "공정", new RegExp(`\\[${RT}\\].*seq\\.${o.opSeq ?? 1}\\)`))
  if (o.version !== undefined) await dialog(page).getByLabel("버전").fill(o.version)
  if (o.status) await pickLabeled(page, "상태", o.status)
  if (o.rows) await addRows(page, o.rows)
}

test.describe("검사표준관리", () => {
  test.beforeAll(async () => {
    // 픽스처 라우팅(공정 2개, FG-001 전용·활성) — 이미 있으면 재사용
    let rt = await db.routing.findFirst({ where: { tenantId: D.tenantId, code: RT }, include: { operations: { orderBy: { seq: "asc" } } } })
    if (!rt) {
      rt = await db.routing.create({
        data: {
          tenantId: D.tenantId, code: RT, name: `E2E-BR 검사표준용 라우팅 ${uniq}`, version: "1.0", status: "ACTIVE", scope: "ITEM_SPECIFIC",
          operations: { create: [
            { seq: 1, operationCode: D.workCenters.wc1.code, name: D.workCenters.wc1.name, workCenterId: D.workCenters.wc1.id, standardTime: 5 },
            { seq: 2, operationCode: D.workCenters.wc2.code, name: D.workCenters.wc2.name, workCenterId: D.workCenters.wc2.id, standardTime: 8 },
          ] },
        },
        include: { operations: { orderBy: { seq: "asc" } } },
      })
      await db.itemRouting.create({ data: { tenantId: D.tenantId, itemId: FG.id, routingId: rt.id, isDefault: false } })
    }
    op1 = rt.operations[0].id
    op2 = rt.operations[1].id
    record("INSPECTION-fixture", null, { routingId: rt.id, code: RT, op1, op2 })
  })
  test.afterAll(async () => { await db.$disconnect() })

  // ───────── 등록/유지 ─────────
  test(tcTitle(T("등록/유지"), "신규 등록(품목·공정·검사항목 수치/합불) → 저장 → 영속, 기준값 정합"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    await fillSpec(page, { version: VER1, status: "활성", rows: [
      { name: "외경", type: "수치", lower: "9.95", upper: "10.05", unit: "mm" },
      { name: "외관", type: "합불" },
    ] })
    await submitBtn(page).click()
    await expect(dialog(page), `저장 후 시트 닫힘 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
    await settle(page)
    await expect(rowOf(page, FG.code).first()).toContainText(VER1)
    const spec = await specOf(FG.id, op1, VER1)
    expect(spec, "DB 에 검사표준 생성").not.toBeNull()
    record("INSPECTION", T("등록/유지")?.id ?? null, { specId: spec!.id, version: VER1, itemId: FG.id, operationId: op1 })
    expect(spec!.status).toBe("ACTIVE")
    expect(spec!.inspectionItems.map((i) => [i.seq, i.name, i.inputType, i.lowerLimit === null ? null : dec(i.lowerLimit), i.upperLimit === null ? null : dec(i.upperLimit), i.unit]),
      "검사항목·기준값").toEqual([[10, "외경", "NUMERIC", 9.95, 10.05, "mm"], [20, "외관", "BOOLEAN", null, null, null]])
  })

  // ───────── 검색/필터 ─────────
  test(tcTitle(T("검색/필터"), "품목 검색 → 일치 건만 → 0건 → 초기화"), async ({ page }) => {
    await login(page)
    await gotoMenu(page, PATH)
    await searchBox(page, FG.code)
    await expect(rowOf(page, VER1).first()).toBeVisible()
    await searchBox(page, `NO-SUCH-${uniq}`)
    await expect(rowOf(page, VER1)).toHaveCount(0)
    await searchBox(page, "")
    await expect(rowOf(page, VER1).first()).toBeVisible()
  })

  // ───────── 입력검증 ─────────
  test(tcTitle(T("입력검증"), "품목·공정 미선택, 버전 공란, 항목명 공란 차단, DB 미반영"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    const before = await db.inspectionSpec.count({ where: { tenantId: D.tenantId } })
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    await dialog(page).getByLabel("버전").fill("")
    await submitBtn(page).click()
    await expect(dialog(page), "저장되지 않고 유지").toBeVisible()
    const t = await dialog(page).innerText()
    expect(t).toMatch(/품목을 선택하세요/)
    expect(t).toMatch(/공정을 선택하세요/)
    expect(t).toMatch(/버전을 입력하세요/)
    // 항목명 공란
    await fillSpec(page, { version: `QX-${uniq}`, rows: [{ name: "" }] })
    await submitBtn(page).click()
    await page.waitForTimeout(1500)
    expect(dialogs.join("|"), "항목명 공란 안내").toMatch(/항목명을 입력/)
    await page.keyboard.press("Escape")
    await settle(page)
    expect(await db.inspectionSpec.count({ where: { tenantId: D.tenantId } }), "잘못된 입력은 DB 미반영").toBe(before)
  })

  test(tcTitle(T("입력검증"), "동일 품목·공정·버전 중복 등록 차단 + 사용자 안내"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    await fillSpec(page, { version: VER1, status: "초안" })
    await submitBtn(page).click()
    await page.waitForTimeout(3000)
    if (await dialog(page).isVisible().catch(() => false)) await page.keyboard.press("Escape")
    expect(await db.inspectionSpec.count({ where: { tenantId: D.tenantId, itemId: FG.id, routingOperationId: op1, version: VER1 } }), "중복 표준은 1건").toBe(1)
    record("INSPECTION-dup", T("입력검증")?.id ?? null, { dialogs })
    expect(dialogs.length, `중복 안내 표시 (alert=${JSON.stringify(dialogs)})`).toBeGreaterThan(0)
    expect.soft(dialogs.join(" "), `영문 시스템 문구가 그대로 노출됨: ${JSON.stringify(dialogs)}`).not.toMatch(/The same item\/process\/version/)
  })

  test(tcTitle(T("입력검증"), "검사항목 순서(seq) 중복 입력 시 표준만 빈 채로 저장되지 않는다(부분 저장 방지)"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    await fillSpec(page, { opSeq: 2, version: `QS-${uniq}`, status: "초안", rows: [
      { name: "항목A", seq: "10", lower: "1", upper: "2" },
      { name: "항목B", seq: "10", lower: "1", upper: "2" },
    ] })
    await submitBtn(page).click()
    await page.waitForTimeout(3500)
    if (await dialog(page).isVisible().catch(() => false)) await page.keyboard.press("Escape")
    const spec = await specOf(FG.id, op2, `QS-${uniq}`)
    record("INSPECTION-dup-seq", T("입력검증")?.id ?? null, { dialogs, specSaved: !!spec, itemCount: spec?.inspectionItems.length ?? null })
    // 항목 저장이 실패하면 표준 헤더도 남지 않아야 한다(원자성). 안내(alert)는 있어야 한다.
    expect(dialogs.length, `오류 안내 표시 (alert=${JSON.stringify(dialogs)})`).toBeGreaterThan(0)
    expect(spec, `항목 저장 실패 후 빈 검사표준이 남음 (표준 저장=${!!spec}, 항목=${spec?.inspectionItems.length ?? "-"})`).toBeNull()
  })

  // ───────── 업무규칙: 검사 항목·상하한 규격 ─────────
  test(tcTitle(T("업무규칙", /상하한/), "상한 < 하한 규격은 저장 차단"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    await fillSpec(page, { opSeq: 2, version: `QR-${uniq}`, status: "초안", rows: [{ name: "역전규격", type: "수치", lower: "10", upper: "5", unit: "mm" }] })
    await submitBtn(page).click()
    await page.waitForTimeout(3000)
    const stillOpen = await dialog(page).isVisible().catch(() => false)
    if (stillOpen) await page.keyboard.press("Escape")
    const spec = await specOf(FG.id, op2, `QR-${uniq}`)
    record("INSPECTION-range", T("업무규칙", /상하한/)?.id ?? null, { saved: !!spec, items: spec?.inspectionItems.map((i) => [i.lowerLimit && dec(i.lowerLimit), i.upperLimit && dec(i.upperLimit)]), dialogs })
    expect(spec, `하한 10 > 상한 5 규격이 저장됨 (alert=${JSON.stringify(dialogs)})`).toBeNull()
  })

  test(tcTitle(T("업무규칙", /상하한/), "품목에 연결되지 않은 라우팅 공정으로 검사표준을 만들 수 없다(품목-라우팅 정합)"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    // 라우팅은 FG-001 전용인데 FG-002 로 등록 시도
    await fillSpec(page, { item: FG2, opSeq: 1, version: `QM-${uniq}`, status: "초안" })
    await submitBtn(page).click()
    await page.waitForTimeout(3000)
    if (await dialog(page).isVisible().catch(() => false)) await page.keyboard.press("Escape")
    const spec = await specOf(FG2.id, op1, `QM-${uniq}`)
    record("INSPECTION-item-routing", T("업무규칙", /상하한/)?.id ?? null, { saved: !!spec, dialogs })
    expect(spec, `FG-002 가 연결되지 않은 FG-001 전용 라우팅 공정에 검사표준이 저장됨 (alert=${JSON.stringify(dialogs)})`).toBeNull()
  })

  // ───────── 수정/삭제 ─────────
  test(tcTitle(T("수정/삭제"), "수정(버전·상태·검사항목 교체) 반영 → 삭제 → 타 표준 불변"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    const base = await specOf(FG.id, op1, VER1)
    expect(base, "선행: 등록된 표준").not.toBeNull()
    // 수정 대상은 별도 표준 하나를 새로 만들어 쓴다
    await openCreate(page, CREATE)
    const verE = `QE-${uniq}`
    await fillSpec(page, { opSeq: 2, version: verE, status: "초안", rows: [{ name: "두께", type: "수치", lower: "1", upper: "2", unit: "mm" }] })
    await submitBtn(page).click()
    await expect(dialog(page)).toBeHidden({ timeout: 20_000 })
    await settle(page)
    await rowIcon(page, verE, "edit")
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).getByRole("combobox").first(), "수정 시 품목은 변경 불가").toBeDisabled()
    await dialog(page).getByLabel("버전").fill(`${verE}-R`)
    await pickLabeled(page, "상태", "활성")
    await dialog(page).getByPlaceholder("항목명").first().fill("두께(개정)")
    await dialog(page).locator('input[type="number"]').nth(2).fill("2.5")
    await submitBtn(page).click()
    await expect(dialog(page), `수정 저장 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
    await settle(page)
    const edited = await specOf(FG.id, op2, `${verE}-R`)
    expect(edited, "수정된 버전 반영").not.toBeNull()
    expect(edited!.status).toBe("ACTIVE")
    expect(edited!.inspectionItems.map((i) => [i.name, dec(i.upperLimit)])).toEqual([["두께(개정)", 2.5]])

    await rowIcon(page, `${verE}-R`, "delete")
    await page.waitForTimeout(2500)
    await settle(page)
    expect(await db.inspectionSpec.findUnique({ where: { id: edited!.id } }), `삭제 후 표준 없음 (alert=${JSON.stringify(dialogs)})`).toBeNull()
    expect(await db.inspectionItem.count({ where: { inspectionSpecId: edited!.id } }), "검사항목 함께 삭제").toBe(0)
    const baseAfter = await specOf(FG.id, op1, VER1)
    expect(baseAfter!.inspectionItems.length, "다른 표준 불변").toBe(base!.inspectionItems.length)
  })
})
