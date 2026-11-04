/**
 * TC 엑셀 기반: 라우팅관리 — 등록/유지 · 검색/필터 · 입력검증 · 수정/삭제 · 업무규칙(품목별 공정 순서·기본 라우팅)
 * 공정 = 작업장 선택(2개 이상, 시드 E2E-BR-WC-1/2), 품목 = E2E-BR-FG-001. 로컬 테스트 DB 한정.
 * 사용 중 라우팅(DW-TC-040)·작업지시 반영은 생산계획/작업지시를 만드는 tc-flow-integration 에서 검증한다.
 */
import { test, expect, type Page } from "@playwright/test"
import { assertSafeE2eEnvironment } from "./guard"
import { login, gotoMenu, dialog, rowOf, openRowAction, tcOf, tcTitle, collectDialogs } from "./tc-helpers"
import { db, loadData, uniq, record, submitBtn, settle, openCreate, pickLabeled, pickByPlaceholder, searchBox, visibleMessages, dec } from "./support/bomflow-lib"

assertSafeE2eEnvironment()

const D = loadData()
const PATH = "/app/mes/routing"
const CREATE = /라우팅 등록/
const FG = D.items.fg1
const WC1 = D.workCenters.wc1
const WC2 = D.workCenters.wc2
const CODE1 = `E2E-BR-RT-${uniq}-1`
const CODE2 = `E2E-BR-RT-${uniq}-2`
const T = (type: string, kw?: RegExp) => tcOf("라우팅관리", type, kw)

const findRt = (code: string) => db.routing.findFirst({ where: { tenantId: D.tenantId, code }, include: { operations: { orderBy: { seq: "asc" } }, items: true } })

type Op = { wc: { code: string }; time: number | string }
async function fillRouting(page: Page, o: { code: string; name: string; version?: string; status?: "초안" | "활성" | "비활성"; isDefault?: boolean; items?: { code: string }[]; ops: Op[] }) {
  await dialog(page).getByLabel("라우팅 코드").fill(o.code)
  await dialog(page).getByLabel("라우팅 명").fill(o.name)
  if (o.version) await dialog(page).getByLabel("버전").fill(o.version)
  if (o.status) await pickLabeled(page, "상태", o.status)
  if (o.items?.length) {
    await dialog(page).getByRole("combobox").filter({ hasText: /반제품 검색|개 품목 선택됨/ }).first().click()
    for (const it of o.items) await page.getByRole("button", { name: new RegExp(it.code) }).first().click()
    // 팝오버(role=dialog)는 Escape 로 닫히지 않으므로 트리거를 다시 눌러 닫는다
    await page.getByRole("combobox").filter({ hasText: /개 품목 선택됨/ }).first().click()
    await expect(page.getByRole("dialog"), "품목 선택 팝오버만 닫히고 시트는 유지").toHaveCount(1)
    if (o.isDefault) await dialog(page).getByRole("switch").first().click()
  }
  for (let i = 0; i < o.ops.length; i++) {
    await dialog(page).getByRole("button", { name: /공정 추가/ }).click()
    if (o.ops[i].wc.code) await pickByPlaceholder(page, "공정 선택", new RegExp(o.ops[i].wc.code))
    await dialog(page).locator('input[type="number"]').nth(i).fill(String(o.ops[i].time))
  }
}

test.describe("라우팅관리", () => {
  test.afterAll(async () => { await db.$disconnect() })

  // ───────── 등록/유지 ─────────
  test(tcTitle(T("등록/유지"), "신규 등록(품목 전용·공정 2개·작업장 연결·기본 라우팅) → 저장 → 영속, DB 정합"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    await fillRouting(page, { code: CODE1, name: `E2E-BR 라우팅 ${uniq}-1`, version: "1.0", status: "활성", isDefault: true, items: [FG], ops: [{ wc: WC1, time: 5 }, { wc: WC2, time: 8.5 }] })
    await submitBtn(page).click()
    await expect(dialog(page), `저장 후 시트 닫힘 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
    await settle(page)
    await expect(rowOf(page, CODE1).first()).toContainText(`E2E-BR 라우팅 ${uniq}-1`)
    const rt = await findRt(CODE1)
    expect(rt, "DB 에 라우팅 생성").not.toBeNull()
    record("ROUTING", T("등록/유지")?.id ?? null, { routingId: rt!.id, code: CODE1, itemId: FG.id })
    expect(rt!.tenantId).toBe(D.tenantId)
    expect(rt!.status).toBe("ACTIVE")
    expect(rt!.scope).toBe("ITEM_SPECIFIC")
    expect(rt!.operations.map((o) => [o.seq, o.workCenterId, dec(o.standardTime)]), "공정 순서·작업장 연결·표준시간").toEqual([[1, WC1.id, 5], [2, WC2.id, 8.5]])
    expect(rt!.operations.map((o) => o.operationCode), "공정코드는 작업장 코드로 채워짐").toEqual([WC1.code, WC2.code])
    expect(rt!.items.map((i) => [i.itemId, i.isDefault]), "품목 연결 + 기본 라우팅").toEqual([[FG.id, true]])
  })

  // ───────── 검색/필터 ─────────
  test(tcTitle(T("검색/필터"), "검색 → 일치 건만 → 0건 → 초기화"), async ({ page }) => {
    await login(page)
    await gotoMenu(page, PATH)
    await searchBox(page, CODE1)
    await expect(rowOf(page, CODE1).first()).toBeVisible()
    await searchBox(page, `NO-SUCH-${uniq}`)
    await expect(rowOf(page, CODE1)).toHaveCount(0)
    await searchBox(page, "")
    await expect(rowOf(page, CODE1).first()).toBeVisible()
  })

  // ───────── 입력검증 ─────────
  test(tcTitle(T("입력검증"), "필수값·공정 없음·품목 미선택·작업장 미선택·표준시간 음수 차단, DB 미반영"), async ({ page }) => {
    const before = await db.routing.count({ where: { tenantId: D.tenantId, code: { startsWith: "E2E-BR-" } } })
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    await dialog(page).getByLabel("버전").fill("")
    await submitBtn(page).click()
    await expect(dialog(page), "저장되지 않고 유지").toBeVisible()
    const text = await dialog(page).innerText()
    expect(text).toMatch(/라우팅 코드를 입력하세요/)
    expect(text).toMatch(/라우팅 명을 입력하세요/)
    expect(text).toMatch(/버전을 입력하세요/)
    expect(text).toMatch(/품목 전용 라우팅은 최소 1개 이상의 품목을 선택해야 합니다/)
    expect(text).toMatch(/공정을 최소 1개 이상 추가하세요/)

    await dialog(page).getByLabel("라우팅 코드").fill(`E2E-BR-RT-${uniq}-X`)
    await dialog(page).getByLabel("라우팅 명").fill("검증용")
    await dialog(page).getByLabel("버전").fill("1.0")
    await dialog(page).getByRole("button", { name: /공정 추가/ }).click()
    await dialog(page).locator('input[type="number"]').first().fill("-3")
    await submitBtn(page).click()
    await expect(dialog(page).getByText(/작업장을 선택하세요|공정코드를 입력하세요/).first(), "작업장 미선택 안내").toBeVisible({ timeout: 10_000 })
    await expect(dialog(page).getByText(/표준시간은 0 이상이어야 합니다/).first(), "표준시간 음수 안내").toBeVisible({ timeout: 10_000 })
    await page.keyboard.press("Escape")
    await settle(page)
    expect(await db.routing.count({ where: { tenantId: D.tenantId, code: { startsWith: "E2E-BR-" } } }), "잘못된 입력은 DB 미반영").toBe(before)
  })

  test(tcTitle(T("입력검증"), "동일 라우팅 코드 재등록 차단 + 이해 가능한 안내(DB 오류 문구 노출 금지)"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    await fillRouting(page, { code: CODE1, name: "중복 코드 시도", version: "9.9", items: [FG], ops: [{ wc: WC1, time: 1 }] })
    await submitBtn(page).click()
    await page.waitForTimeout(3000)
    if (await dialog(page).isVisible().catch(() => false)) await page.keyboard.press("Escape")
    expect(await db.routing.count({ where: { tenantId: D.tenantId, code: CODE1 } }), "같은 코드 라우팅은 1건").toBe(1)
    record("ROUTING-dup-code", T("입력검증")?.id ?? null, { dialogs })
    expect(dialogs.length, `중복 안내 표시 (alert=${JSON.stringify(dialogs)})`).toBeGreaterThan(0)
    expect.soft(dialogs.join(" "), `사용자에게 DB 내부 오류 문구가 그대로 노출됨: ${JSON.stringify(dialogs)}`).not.toMatch(/Prisma|prisma|Unique constraint|Invalid `|invocation/)
  })

  // ───────── 업무규칙: 품목별 공정 순서 ─────────
  test(tcTitle(T("업무규칙", /공정 순서/), "저장한 공정 순서가 재조회(수정 화면)와 일치하고 순서가 중복·누락되지 않는다"), async ({ page }) => {
    await login(page)
    await gotoMenu(page, PATH)
    await openRowAction(page, CODE1, "수정")
    await expect(dialog(page)).toBeVisible()
    const selects = await dialog(page).locator('button[role="combobox"]').allInnerTexts()
    const order = selects.filter((t) => /\[E2E-BR-WC-[12]\]/.test(t)).map((t) => (t.match(/E2E-BR-WC-[12]/) ?? [""])[0])
    await page.keyboard.press("Escape")
    expect(order, "수정 화면 공정 순서 = 저장 순서").toEqual([WC1.code, WC2.code])
    const rt = await findRt(CODE1)
    expect(rt!.operations.map((o) => o.seq), "seq 는 1,2 연속·중복 없음").toEqual([1, 2])
  })

  test(tcTitle(T("업무규칙", /공정 순서/), "공정 순서 수정(공정 삭제 후 재추가) 시 순번이 충돌하지 않고 저장된다"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    await openRowAction(page, CODE1, "수정")
    await expect(dialog(page)).toBeVisible()
    // 1번 공정(WC1) 삭제 → 2번 공정(WC2)만 남음 → WC1 다시 추가해 순서를 [WC2, WC1] 로 바꾼다
    await dialog(page).locator('button[class*="hover:text-destructive"]').first().click()
    await dialog(page).getByRole("button", { name: /공정 추가/ }).click()
    await pickByPlaceholder(page, "공정 선택", new RegExp(WC1.code))
    await dialog(page).locator('input[type="number"]').nth(1).fill("6")
    await submitBtn(page).click()
    await page.waitForTimeout(3500)
    const stillOpen = await dialog(page).isVisible().catch(() => false)
    if (stillOpen) await page.keyboard.press("Escape")
    await settle(page)
    const rt = await findRt(CODE1)
    const seqs = rt!.operations.map((o) => o.seq)
    const wcs = rt!.operations.map((o) => o.workCenterId)
    record("ROUTING-reorder", T("업무규칙", /공정 순서/)?.id ?? null, { dialogs, stillOpen, seqs, wcs: wcs.map((w) => (w === WC1.id ? "WC1" : w === WC2.id ? "WC2" : w)) })
    expect(wcs, `수정 반영: 공정 순서 [WC2, WC1] (alert=${JSON.stringify(dialogs)}, 시트 유지=${stillOpen}, 저장된 seq=${JSON.stringify(seqs)})`).toEqual([WC2.id, WC1.id])
    expect(new Set(seqs).size, "seq 중복 없음").toBe(seqs.length)
  })

  test(tcTitle(T("업무규칙", /공정 순서/), "품목당 기본 라우팅은 1건 — 새 기본 라우팅 지정 시 기존 기본은 해제"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    await openCreate(page, CREATE)
    await fillRouting(page, { code: CODE2, name: `E2E-BR 라우팅 ${uniq}-2`, version: "1.0", status: "활성", isDefault: true, items: [FG], ops: [{ wc: WC1, time: 2 }, { wc: WC2, time: 3 }] })
    await submitBtn(page).click()
    await expect(dialog(page), `저장 후 시트 닫힘 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
    const links = await db.itemRouting.findMany({ where: { tenantId: D.tenantId, itemId: FG.id }, include: { routing: { select: { code: true } } } })
    record("ROUTING-default", T("업무규칙", /공정 순서/)?.id ?? null, { links: links.map((l) => [l.routing.code, l.isDefault]) })
    expect(links.filter((l) => l.isDefault).map((l) => l.routing.code), "기본 라우팅은 품목당 1건(새 라우팅)").toEqual([CODE2])
    expect(links.map((l) => l.routing.code).sort(), "기존 라우팅 연결은 유지").toEqual([CODE1, CODE2].sort())
  })

  // ───────── 수정/삭제 ─────────
  test(tcTitle(T("수정/삭제"), "수정(명칭·상태) 반영 → 미사용 라우팅 삭제 → 타 라우팅 불변"), async ({ page }) => {
    const dialogs = collectDialogs(page)
    await login(page)
    await gotoMenu(page, PATH)
    const rt1Before = await findRt(CODE1)
    await openRowAction(page, CODE2, "수정")
    await expect(dialog(page)).toBeVisible()
    await dialog(page).getByLabel("라우팅 명").fill(`E2E-BR 수정됨 ${uniq}`)
    await pickLabeled(page, "상태", "비활성")
    await submitBtn(page).click()
    await expect(dialog(page), `수정 저장 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
    await settle(page)
    const edited = await findRt(CODE2)
    expect(edited!.name).toBe(`E2E-BR 수정됨 ${uniq}`)
    expect(edited!.status).toBe("INACTIVE")
    expect(edited!.operations.length, "공정 목록 유지").toBe(2)

    const delId = edited!.id
    await openRowAction(page, CODE2, "삭제")
    await page.waitForTimeout(2500)
    await settle(page)
    expect(await db.routing.findUnique({ where: { id: delId } }), `삭제 후 라우팅 없음 (alert=${JSON.stringify(dialogs)})`).toBeNull()
    expect(await db.routingOperation.count({ where: { routingId: delId } }), "공정 행 함께 삭제").toBe(0)
    expect(await db.itemRouting.count({ where: { routingId: delId } }), "품목 연결 함께 삭제").toBe(0)
    const rt1After = await findRt(CODE1)
    expect(rt1After!.operations.map((o) => o.id), "다른 라우팅의 공정 불변").toEqual(rt1Before!.operations.map((o) => o.id))
  })
})
