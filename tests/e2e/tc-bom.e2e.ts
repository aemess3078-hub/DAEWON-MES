/**
 * TC 엑셀 기반: BOM관리 — 등록/유지 · 검색/필터 · 입력검증 · 수정/삭제 · 업무규칙(소요량·기본 BOM 정책·MRP 반영)
 * 대상 품목은 시드(E2E-BR-FG-001 / RM-001 / RM-002). 로컬 테스트 DB 한정(가드), UI 로 만든 BOM 은 seed-bomflow.ts REMOVE=1 이 정리.
 */
import { test, expect, type Page } from "@playwright/test"
import { assertSafeE2eEnvironment } from "./guard"
import { login, gotoMenu, dialog, rowOf, openRowAction, tcOf, tcTitle, collectDialogs } from "./tc-helpers"
import { db, loadData, uniq, record, submitBtn, settle, openCreate, pickLabeled, pickByPlaceholder, searchBox, visibleMessages, dec } from "./support/bomflow-lib"
import { executeSimulationRequest } from "../../src/lib/services/mrp-simulation.service"

assertSafeE2eEnvironment()

const D = loadData()
const PATH = "/app/mes/bom"
const CREATE = /BOM 등록/
const FG = D.items.fg1
const RM1 = D.items.rm1
const RM2 = D.items.rm2
const VER_A = `A-${uniq}`
const VER_B = `B-${uniq}`
const VER_C = `C-${uniq}`

const T = (type: string, kw?: RegExp) => tcOf("BOM관리", type, kw)
const bomsOf = (itemId: string) => db.bOM.findMany({ where: { tenantId: D.tenantId, itemId }, include: { bomItems: { orderBy: { seq: "asc" } } }, orderBy: { createdAt: "asc" } })
const findBom = (version: string) => db.bOM.findFirst({ where: { tenantId: D.tenantId, itemId: FG.id, version }, include: { bomItems: { orderBy: { seq: "asc" } } } })
const sim = (qty: number) => executeSimulationRequest({ authorize: async () => ({ tenantId: D.tenantId }), db }, { items: [{ itemId: FG.id, qty }] })

type Comp = { rm: { code: string }; qty: number | string }
async function fillBom(page: Page, o: { version: string; status?: "초안" | "활성" | "비활성"; isDefault?: boolean; comps: Comp[]; item?: { code: string } | null }) {
  if (o.item !== null) await pickLabeled(page, "대상 품목", new RegExp((o.item ?? FG).code))
  await dialog(page).getByLabel("버전").fill(o.version)
  if (o.status) await pickLabeled(page, "상태", o.status)
  if (o.isDefault) await dialog(page).getByRole("switch").first().click()
  for (let i = 0; i < o.comps.length; i++) {
    await dialog(page).getByRole("button", { name: /자재 추가/ }).click()
    const c = o.comps[i]
    if (c.rm.code) await pickByPlaceholder(page, "자재 선택", new RegExp(c.rm.code))
    await dialog(page).locator('input[type="number"]').nth(i).fill(String(c.qty))
  }
}

// 결함성 검증이 실패해도 뒤 테스트가 건너뛰어지지 않도록 serial 대신 기본 모드(workers=1, 파일 내 순차 실행)를 쓴다
test.describe("BOM관리", () => {
  test.afterAll(async () => { await db.$disconnect() })

  // ───────── 등록/유지 ─────────
  test(tcTitle(T("등록/유지"), "신규 등록(구성품 2종·소요량) → 저장 → 새로고침 영속, DB 정합"), async ({ page }) => {
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    await fillBom(page, { version: VER_A, status: "활성", isDefault: true, comps: [{ rm: RM1, qty: 2 }, { rm: RM2, qty: 3 }] })
    await submitBtn(page).click()
    await expect(dialog(page)).toBeHidden({ timeout: 20_000 })
    await settle(page)
    await expect(rowOf(page, VER_A).first()).toContainText(FG.name)
    const bom = await findBom(VER_A)
    expect(bom, "DB 에 BOM 생성").not.toBeNull()
    record("BOM", T("등록/유지")?.id ?? null, { bomId: bom!.id, version: VER_A, itemId: FG.id })
    expect(bom!.tenantId).toBe(D.tenantId)
    expect(bom!.status).toBe("ACTIVE")
    expect(bom!.isDefault).toBe(true)
    expect(bom!.bomItems.map((b) => [b.componentItemId, dec(b.qtyPer)])).toEqual([[RM1.id, 2], [RM2.id, 3]])
    expect(bom!.bomItems.map((b) => b.seq), "순서 1,2").toEqual([1, 2])
    await expect(rowOf(page, VER_A).first(), "자재 수 2 표시").toContainText("2개")
  })

  // ───────── 검색/필터 ─────────
  test(tcTitle(T("검색/필터"), "품목명 검색 → 일치 건만 → 0건 → 초기화"), async ({ page }) => {
    await login(page)
    await gotoMenu(page, PATH)
    await searchBox(page, FG.name)
    await expect(rowOf(page, VER_A).first()).toBeVisible()
    await searchBox(page, `NO-SUCH-${uniq}`)
    await expect(rowOf(page, VER_A)).toHaveCount(0)
    await searchBox(page, "")
    await expect(rowOf(page, VER_A).first()).toBeVisible()
  })

  // ───────── 입력검증 ─────────
  test(tcTitle(T("입력검증"), "필수값 공란·구성품 없음·소요량 0/음수·자재 미선택 차단, DB 미반영"), async ({ page }) => {
    const before = await bomsOf(FG.id)
    await login(page)
    await gotoMenu(page, PATH)

    // (a) 완전 공란
    await openCreate(page, CREATE)
    await dialog(page).getByLabel("버전").fill("")
    await submitBtn(page).click()
    await expect(dialog(page), "저장되지 않고 유지").toBeVisible()
    const m1 = (await dialog(page).innerText())
    expect(m1, "품목 선택 안내").toMatch(/품목을 선택하세요/)
    expect(m1, "버전 입력 안내").toMatch(/버전을 입력하세요/)
    expect(m1, "구성품 최소 1개 안내").toMatch(/자재를 최소 1개 이상 추가하세요/)

    // (b) 소요량 0, (c) 음수
    await pickLabeled(page, "대상 품목", new RegExp(FG.code))
    await dialog(page).getByLabel("버전").fill(VER_C)
    await dialog(page).getByRole("button", { name: /자재 추가/ }).click()
    await pickByPlaceholder(page, "자재 선택", new RegExp(RM1.code))
    for (const bad of ["0", "-1"]) {
      await dialog(page).locator('input[type="number"]').first().fill(bad)
      await submitBtn(page).click()
      await expect(dialog(page).getByText(/소요량은 양수여야 합니다/).first(), `소요량 ${bad} 차단 안내`).toBeVisible({ timeout: 10_000 })
    }
    // (d) 자재 미선택
    await dialog(page).getByRole("button", { name: /자재 추가/ }).click()
    await dialog(page).locator('input[type="number"]').first().fill("1")
    await submitBtn(page).click()
    await expect(dialog(page).getByText(/자재를 선택하세요/).first(), "자재 미선택 안내").toBeVisible({ timeout: 10_000 })
    await page.keyboard.press("Escape")
    await settle(page)
    const after = await bomsOf(FG.id)
    expect(after.length, "잘못된 입력은 DB 미반영").toBe(before.length)
    expect(await findBom(VER_C)).toBeNull()
  })

  test(tcTitle(T("입력검증"), "동일 품목·동일 버전 중복 등록 차단 + 사용자 안내"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    await fillBom(page, { version: VER_A, status: "초안", comps: [{ rm: RM1, qty: 1 }] })
    await submitBtn(page).click()
    await page.waitForTimeout(3000)
    const shown = (await visibleMessages(page)).filter((t) => /이미|중복|존재|exist|duplicate|unique|실패|오류/i.test(t))
    const stillOpen = await dialog(page).isVisible().catch(() => false)
    if (stillOpen) await page.keyboard.press("Escape")
    const rows = await db.bOM.count({ where: { tenantId: D.tenantId, itemId: FG.id, version: VER_A } })
    expect(rows, "같은 품목·버전 BOM 은 1건만").toBe(1)
    record("BOM-dup-version", T("입력검증")?.id ?? null, { dialogs, shown, stillOpen })
    expect(shown.length > 0 || dialogs.length > 0, `중복 안내 표시 (화면=${JSON.stringify(shown)}, alert=${JSON.stringify(dialogs)}, 시트 유지=${stillOpen})`).toBe(true)
  })

  // ───────── 업무규칙: 소요량·수량 ─────────
  test(tcTitle(T("업무규칙", /소요량/), "상위품목/구성자재 유형 제한 + 소요량×생산수량 전개(MRP 시뮬레이션) 일치"), async ({ page }) => {
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    // 상위 품목은 완제품/반제품만, 구성자재는 원자재/반제품/소모품만
    await dialog(page).getByLabel("대상 품목").first().click()
    const parentOpts = await page.getByRole("option").allInnerTexts()
    await page.keyboard.press("Escape")
    expect(parentOpts.some((t) => t.includes(FG.code)), "완제품은 상위 품목으로 선택 가능").toBe(true)
    expect(parentOpts.some((t) => t.includes(RM1.code)), "원자재는 상위 품목 목록에 없어야 함").toBe(false)
    await dialog(page).getByRole("button", { name: /자재 추가/ }).click()
    await dialog(page).locator('button[role="combobox"]').filter({ hasText: "자재 선택" }).first().click()
    const compOpts = await page.getByRole("option").allInnerTexts()
    await page.keyboard.press("Escape")
    expect(compOpts.some((t) => t.includes(RM1.code)), "원자재는 구성자재로 선택 가능").toBe(true)
    expect(compOpts.some((t) => t.includes(FG.code)), "완제품은 구성자재 목록에 없어야 함").toBe(false)
    await page.keyboard.press("Escape")

    // 소요량 = 단위당 소요량 × 생산수량 (BOM A: RM1=2, RM2=3)
    for (const qty of [1, 10, 7]) {
      const r = await sim(qty)
      const need = (code: string) => r.view.materials.find((m) => m.code === code)?.totalRequirement
      expect(r.view.excluded.map((e) => e.reasonLabel), `생산수량 ${qty}: 제외 사유 없음`).toEqual([])
      expect(need(RM1.code), `생산수량 ${qty} → RM1 소요`).toBe(2 * qty)
      expect(need(RM2.code), `생산수량 ${qty} → RM2 소요`).toBe(3 * qty)
    }
  })

  test(tcTitle(T("업무규칙", /소요량/), "동일 구성자재를 한 BOM 에 중복 등록하면 차단된다"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    // 화면은 이미 고른 자재를 다른 행에서 선택하지 못하게 막는다(N-02). 막혀 있으면 두 번째 행에서 같은 자재 옵션이 비활성이다.
    await pickLabeled(page, "대상 품목", new RegExp(FG.code))
    await dialog(page).getByLabel("버전").fill(VER_C)
    await dialog(page).getByRole("button", { name: /자재 추가/ }).click()
    await pickByPlaceholder(page, "자재 선택", new RegExp(RM1.code))
    await dialog(page).locator('input[type="number"]').nth(0).fill("1")
    await dialog(page).getByRole("button", { name: /자재 추가/ }).click()
    await dialog(page).locator('button[role="combobox"]').filter({ hasText: "자재 선택" }).first().click()
    const dupOpt = page.getByRole("option", { name: new RegExp(RM1.code) }).first()
    const optionDisabled = (await dupOpt.getAttribute("aria-disabled")) === "true" || (await dupOpt.getAttribute("data-disabled")) !== null
    await page.keyboard.press("Escape")
    record("BOM-dup-component-ui", T("업무규칙", /소요량/)?.id ?? null, { optionDisabled })
    expect(optionDisabled, "이미 선택한 자재는 다른 행에서 선택할 수 없어야 함").toBe(true)
    // 그래도 서버로 중복이 전달되는 경우(직접 호출)는 tc-mfg-fixes [N-02] 에서 확인한다. 여기서는 이 시도가 BOM 을 만들지 않았는지만 확인한다.
    await submitBtn(page).click()
    await page.waitForTimeout(3000)
    const shown = (await visibleMessages(page)).filter((t) => /중복|이미|동일|duplicate/i.test(t))
    const stillOpen = await dialog(page).isVisible().catch(() => false)
    if (stillOpen) await page.keyboard.press("Escape")
    const created = await findBom(VER_C)
    record("BOM-dup-component", T("업무규칙", /소요량/)?.id ?? null, { created: created?.id ?? null, lines: created?.bomItems.length ?? 0, dialogs, shown })
    expect(created, `중복 구성자재 BOM 이 저장되면 안 됨 (저장됨: 구성자재 ${created?.bomItems.length ?? 0}줄, 안내=${JSON.stringify(shown)})`).toBeNull()
  })

  test(tcTitle(T("업무규칙", /소요량/), "품목당 기본 BOM(ACTIVE) 은 1건 — 두 번째 기본 BOM 지정 시 차단 또는 기존 해제"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    await fillBom(page, { version: VER_B, status: "활성", isDefault: true, comps: [{ rm: RM1, qty: 5 }] })
    await submitBtn(page).click()
    await page.waitForTimeout(3000)
    if (await dialog(page).isVisible().catch(() => false)) await page.keyboard.press("Escape")
    const all = await bomsOf(FG.id)
    const defaults = all.filter((b) => b.isDefault && b.status === "ACTIVE")
    const r = await sim(10)
    const excl = r.view.excluded.map((e) => `${e.reason}:${e.reasonLabel}`)
    record("BOM-default-policy", T("업무규칙", /소요량/)?.id ?? null, { boms: all.map((b) => ({ v: b.version, def: b.isDefault, st: b.status })), defaults: defaults.length, simExcluded: excl, dialogs })
    expect(defaults.length, `ACTIVE 기본 BOM 은 품목당 1건이어야 함 (현재 ${defaults.length}건; MRP 시뮬레이션 제외 사유=${JSON.stringify(excl)})`).toBe(1)
    // N-03 정책: 새 기본 BOM 이 기본이 되고, 기존 기본 BOM 은 기본 지정만 해제되며 ACTIVE 상태는 유지된다.
    expect(defaults[0].version, "새로 지정한 BOM 이 기본").toBe(VER_B)
    const a = all.find((b) => b.version === VER_A)!
    expect(a.status, "기존 기본 BOM 의 ACTIVE 상태 유지").toBe("ACTIVE")
    expect(a.isDefault, "기존 기본 BOM 의 기본 지정 해제").toBe(false)
    expect(excl.filter((x) => /MULTIPLE_DEFAULT_BOM/.test(x)), "MRP 가 기본 BOM 중복으로 제품을 제외하지 않음").toEqual([])
  })

  // ───────── 수정/삭제 ─────────
  test(tcTitle(T("수정/삭제"), "소요량 수정·구성품 변경 반영 → MRP 전개 반영(BOM 개정) → 삭제 → 타 BOM 불변"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    const bomA = await findBom(VER_A)
    expect(bomA).not.toBeNull()
    const before2 = await bomsOf(FG.id)
    // 수정: RM1 2 → 2.5, RM2 제거
    await openRowAction(page, VER_A, "수정")
    await expect(dialog(page)).toBeVisible()
    await dialog(page).locator('input[type="number"]').first().fill("2.5")
    await dialog(page).locator('button[class*="hover:text-destructive"]').last().click()
    await submitBtn(page).click()
    await expect(dialog(page)).toBeHidden({ timeout: 20_000 })
    await settle(page)
    const edited = await findBom(VER_A)
    expect(edited!.id, "수정은 같은 BOM 행").toBe(bomA!.id)
    expect(edited!.bomItems.map((b) => [b.componentItemId, dec(b.qtyPer)]), "수정 반영: RM1=2.5, RM2 제거").toEqual([[RM1.id, 2.5]])
    // BOM 개정 → MRP 전개 반영. 앞선 정책 테스트에서 기본 BOM 이 B 로 바뀌었으므로(N-03 정책),
    // 개정한 A 를 MRP 가 쓰도록 기본 지정을 A 로 되돌린다(테스트 데이터 조정; 품목당 기본 1건 유지).
    await db.bOM.updateMany({ where: { tenantId: D.tenantId, itemId: FG.id, version: VER_B }, data: { isDefault: false } })
    await db.bOM.updateMany({ where: { tenantId: D.tenantId, itemId: FG.id, version: VER_A }, data: { isDefault: true } })
    const r = await sim(10)
    const m = r.view.materials
    record("BOM-revision-mrp", T("업무규칙", /MRP/)?.id ?? null, { materials: m.map((x) => [x.code, x.totalRequirement]), excluded: r.view.excluded.map((e) => e.reason) })
    expect(m.find((x) => x.code === RM1.code)?.totalRequirement, "개정된 소요량 2.5×10 이 MRP 전개에 반영").toBe(25)
    expect(m.find((x) => x.code === RM2.code), "제거된 구성품은 MRP 전개에서 빠짐").toBeUndefined()

    // 삭제: 미사용 BOM(B 또는 별도) 삭제 — 없으면 새로 만들어 삭제
    const spare = await db.bOM.create({ data: { tenantId: D.tenantId, itemId: FG.id, version: `S-${uniq}`, status: "DRAFT", isDefault: false, bomItems: { create: [{ componentItemId: RM2.id, seq: 1, qtyPer: 1, scrapRate: 0 }] } } })
    await settle(page)
    await openRowAction(page, `S-${uniq}`, "삭제")
    await page.waitForTimeout(2500)
    await settle(page)
    expect(await db.bOM.findUnique({ where: { id: spare.id } }), `삭제 후 BOM 없음 (alert=${JSON.stringify(dialogs)})`).toBeNull()
    expect(await db.bOMItem.count({ where: { bomId: spare.id } }), "구성품 행도 함께 삭제").toBe(0)
    const after = await bomsOf(FG.id)
    expect(after.filter((b) => b.version !== `S-${uniq}`).length, "다른 BOM 영향 없음").toBe(before2.length)
  })
  // ───────── 업무규칙: BOM 개정 → MRP 반영 ─────────
  test(tcTitle(T("업무규칙", /MRP/), "BOM 개정(소요량 재수정)이 MRP 전개에 즉시 반영된다 — 자재출고 연계는 수주~출하 배치에서 확인"), async ({ page }) => {
    await login(page)
    await gotoMenu(page, PATH)
    await db.bOM.updateMany({ where: { tenantId: D.tenantId, itemId: FG.id, version: { not: VER_A } }, data: { isDefault: false } })
    await db.bOM.updateMany({ where: { tenantId: D.tenantId, itemId: FG.id, version: VER_A }, data: { isDefault: true } })
    const before = (await sim(10)).view.materials.find((m) => m.code === RM1.code)?.totalRequirement
    await openRowAction(page, VER_A, "수정")
    await expect(dialog(page)).toBeVisible()
    await dialog(page).locator('input[type="number"]').first().fill("4")
    await submitBtn(page).click()
    await expect(dialog(page)).toBeHidden({ timeout: 20_000 })
    await settle(page)
    const after = (await sim(10)).view.materials.find((m) => m.code === RM1.code)?.totalRequirement
    record("BOM-revision-mrp-2", T("업무규칙", /MRP/)?.id ?? null, { before, after, note: "자재출고(BOM 개정 반영)는 이 배치에서 미검증" })
    expect(before, "개정 전 MRP 소요").toBe(25)
    expect(after, "개정 후 MRP 소요(4×10)").toBe(40)
  })
})
