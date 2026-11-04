/**
 * N-03 검증: 품목당 ACTIVE 기본(Default) BOM 은 최대 1건
 *  - 일반 BOM 변경: 새 기본 BOM → 기존 기본 BOM 은 기본 지정만 해제(ACTIVE 유지), 과거 계획·작업지시 BOM 참조 유지
 *  - ECN 개정: 정확한 기존 기본 BOM 만 비활성화(+기본 해제), 활성 비기본 BOM 은 보존, 실패 시 전체 롤백
 *  - Excel 업로드: 기존 기본 BOM 을 바꾸지 않는 정책 유지
 *  - MRP: 기본 BOM 중복이 없으면 제품이 제외되지 않음, 기존 중복 데이터는 자동 수정하지 않음
 *  - 동시 요청: 같은 품목의 기본 BOM 을 동시에 바꿔도 ACTIVE 기본 BOM 은 1건
 * 선행: seed-bomflow.ts(E2E-BR- 기준정보), seed-roles.ts(역할 계정). 로컬 테스트 DB 한정(가드).
 * 품목·BOM·ECN·계획·작업지시는 E2E-BR- 접두사(품목 코드 기준)로 seed-bomflow.ts REMOVE=1 이 정리한다.
 */
import { test, expect } from "@playwright/test"
import { assertSafeE2eEnvironment, E2E_BASE } from "./guard"
import { login, gotoMenu, dialog, rowOf, collectDialogs } from "./tc-helpers"
import { db, loadData, uniq, record, submitBtn, settle, openCreate, pickLabeled, pickByPlaceholder } from "./support/bomflow-lib"
import { buildActionMap, apiLogin, roleCreds, callAction, type ActionInfo } from "./support/perm-lib"
import { executeSimulationRequest } from "../../src/lib/services/mrp-simulation.service"

assertSafeE2eEnvironment()

const D = loadData()
const RM1 = D.items.rm1
const RM2 = D.items.rm2
const toPath = (key: string) => "/" + key.replace(/^app\//, "").replace(/\/page$/, "").split("/").filter((s) => !/^\(.*\)$/.test(s)).join("/")

let MAP: ActionInfo[] = []
let adminCookie = ""
test.beforeAll(async () => {
  const c = roleCreds("ADMIN")
  adminCookie = (await apiLogin(c.loginId, c.password)).cookie ?? ""
  if (!adminCookie) throw new Error("ADMIN 로그인 실패(seed-roles 확인)")
  for (const p of ["/app/mes/bom", "/app/mes/ecn"]) { try { await fetch(`${E2E_BASE}${p}`, { headers: { cookie: adminCookie } }) } catch { /* 계속 */ } }
  MAP = buildActionMap()
})
test.afterAll(async () => { await db.$disconnect() })

async function run(name: string, fileRe: RegExp, args: unknown[]) {
  const a = MAP.find((x) => x.name === name && x.files.some((f) => fileRe.test(f)))
  if (!a) throw new Error(`액션을 찾을 수 없음: ${name}`)
  return callAction(adminCookie, toPath(a.pages[0]), a, args)
}
const createBom = (i: BomIn) => run("createBom", /bom\.actions/, [i])
const updateBom = (id: string, i: BomIn) => run("updateBom", /bom\.actions/, [id, i])
const implementEcn = (id: string) => run("implementECN", /ecn\.actions/, [id])
const importBoms = (groups: unknown[]) => run("importValidatedBoms", /bom-excel\.actions/, [groups])

type BomIn = { itemId: string; version: string; isDefault: boolean; status: "DRAFT" | "ACTIVE" | "INACTIVE"; bomItems: { componentItemId: string; seq: number; qtyPer: number; scrapRate: number }[] }
const line = (componentItemId: string, qtyPer = 1, seq = 1) => ({ componentItemId, seq, qtyPer, scrapRate: 0 })
const bomIn = (itemId: string, version: string, o: Partial<BomIn> = {}): BomIn => ({ itemId, version, isDefault: false, status: "ACTIVE", bomItems: [line(RM1.id)], ...o })

let seq = 0
async function mkItem(tag: string) {
  return db.item.create({
    data: { tenantId: D.tenantId, code: `E2E-BR-ND-${uniq}-${tag}${seq++}`, name: `E2E-BR 기본BOM ${tag}`, itemType: "FINISHED", categoryId: D.categories.fg.id, itemGroupId: D.group.id },
  })
}
const mkBom = (itemId: string, version: string, o: { status?: "DRAFT" | "ACTIVE" | "INACTIVE"; isDefault?: boolean; comp?: string; qty?: number } = {}) =>
  db.bOM.create({
    data: {
      tenantId: D.tenantId, itemId, version, status: o.status ?? "ACTIVE", isDefault: o.isDefault ?? false,
      bomItems: { create: [{ componentItemId: o.comp ?? RM1.id, seq: 1, qtyPer: o.qty ?? 1, scrapRate: 0 }] },
    },
  })
const boms = (itemId: string) => db.bOM.findMany({ where: { tenantId: D.tenantId, itemId }, include: { bomItems: { orderBy: { seq: "asc" } } }, orderBy: { version: "asc" } })
const activeDefaults = async (itemId: string) => (await boms(itemId)).filter((b) => b.isDefault && b.status === "ACTIVE")
const snap = (list: Awaited<ReturnType<typeof boms>>) => list.map((b) => `${b.version}:${b.status}:${b.isDefault ? "D" : "-"}`)

let adminProfileId = ""
async function profileId() {
  if (!adminProfileId) adminProfileId = (await db.userCredential.findFirstOrThrow({ where: { tenantId: D.tenantId, loginId: process.env.SEED_ADMIN_LOGIN_ID } })).profileId
  return adminProfileId
}
async function mkEcn(itemId: string, tag: string, o: { changeType?: string; status?: "APPROVED" | "SUBMITTED"; details?: { changeTarget: string; actionType: string; afterValue: unknown }[] } = {}) {
  return db.engineeringChange.create({
    data: {
      tenantId: D.tenantId, ecnNo: `E2E-BR-ECN-${uniq}-${tag}`, title: `E2E-BR ECN ${tag}`, reason: "N-03 검증", changeType: o.changeType ?? "BOM", targetItemId: itemId,
      status: o.status ?? "APPROVED", requestedBy: await profileId(), approvedBy: await profileId(), approvedAt: new Date(),
      details: o.details ? { create: o.details.map((d) => ({ changeTarget: d.changeTarget, actionType: d.actionType, afterValue: d.afterValue as object })) } : undefined,
    },
  })
}
const ecnStatus = async (id: string) => (await db.engineeringChange.findUniqueOrThrow({ where: { id } })).status
const sim = (itemId: string, qty = 10) => executeSimulationRequest({ authorize: async () => ({ tenantId: D.tenantId }), db }, { items: [{ itemId, qty }] })

// ───────── 1~4. 화면에서 기본 BOM 등록·변경 ─────────
test("[N03-01] 최초 기본 BOM 등록(화면): ACTIVE 기본 BOM 1건이 만들어진다", async ({ page }) => {
  const dialogs = collectDialogs(page)
  const item = await mkItem("U1")
  await login(page)
  await gotoMenu(page, "/app/mes/bom")
  await openCreate(page, /BOM 등록/)
  await pickLabeled(page, "대상 품목", new RegExp(item.code))
  await dialog(page).getByLabel("버전").fill("1.0")
  await pickLabeled(page, "상태", "활성")
  await expect(dialog(page), "기본 BOM 설명에 해제 안내가 보인다").toContainText("기본 지정만 해제")
  await dialog(page).getByRole("switch").first().click()
  await dialog(page).getByRole("button", { name: /자재 추가/ }).click()
  await pickByPlaceholder(page, "자재 선택", new RegExp(RM1.code))
  await dialog(page).locator('input[type="number"]').nth(0).fill("2")
  await submitBtn(page).click()
  await expect(dialog(page), `저장 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
  const list = await boms(item.id)
  record("N03-01", null, { boms: snap(list) })
  expect(snap(list)).toEqual(["1.0:ACTIVE:D"])
  expect((await activeDefaults(item.id)).length).toBe(1)
})

test("[N03-02~04] 기본 BOM 이 있는 품목에 새 기본 BOM 등록(화면): 새 BOM 이 기본, 기존 BOM 은 ACTIVE 유지·기본만 해제", async ({ page }) => {
  const dialogs = collectDialogs(page)
  const item = await mkItem("U2")
  const v1 = await mkBom(item.id, "1.0", { status: "ACTIVE", isDefault: true })
  await login(page)
  await gotoMenu(page, "/app/mes/bom")
  await openCreate(page, /BOM 등록/)
  await pickLabeled(page, "대상 품목", new RegExp(item.code))
  await dialog(page).getByLabel("버전").fill("2.0")
  await pickLabeled(page, "상태", "활성")
  await dialog(page).getByRole("switch").first().click()
  await dialog(page).getByRole("button", { name: /자재 추가/ }).click()
  await pickByPlaceholder(page, "자재 선택", new RegExp(RM2.code))
  await dialog(page).locator('input[type="number"]').nth(0).fill("3")
  await submitBtn(page).click()
  await expect(dialog(page), `저장 (alert=${JSON.stringify(dialogs)})`).toBeHidden({ timeout: 20_000 })
  await settle(page)
  const list = await boms(item.id)
  record("N03-02", null, { boms: snap(list) })
  expect(snap(list), "새 BOM 기본, 기존 BOM ACTIVE 유지·기본 해제").toEqual(["1.0:ACTIVE:-", "2.0:ACTIVE:D"])
  const old = list.find((b) => b.id === v1.id)!
  expect(old.bomItems.map((b) => [b.componentItemId, Number(b.qtyPer)]), "기존 BOM 구성은 그대로").toEqual([[RM1.id, 1]])
  await expect(rowOf(page, "2.0").first()).toBeVisible()
  const audit = await db.auditLog.findFirst({ where: { tenantId: D.tenantId, entityType: "BOM", entityId: list.find((b) => b.version === "2.0")!.id, action: "CREATE" } })
  expect(JSON.stringify(audit?.afterData), "감사 로그에 해제된 기본 BOM 기록").toContain(v1.id)
})

test("[N03-03] 기존 BOM 을 기본으로 변경(수정): 다른 기본 BOM 은 기본만 해제되고 ACTIVE 유지", async () => {
  const item = await mkItem("A1")
  const v1 = await mkBom(item.id, "1.0", { isDefault: true })
  const v2 = await mkBom(item.id, "2.0", { isDefault: false })
  const res = await updateBom(v2.id, bomIn(item.id, "2.0", { isDefault: true }))
  record("N03-03", null, { kind: res.kind, boms: snap(await boms(item.id)) })
  expect(res.kind, res.message).toBe("EXECUTED")
  expect(snap(await boms(item.id))).toEqual(["1.0:ACTIVE:-", "2.0:ACTIVE:D"])
  expect((await db.bOM.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe("ACTIVE")
})

test("[N03-04] 기본이 될 수 없는 상태(초안·비활성)로 저장하면 기존 기본 BOM 은 그대로 유지된다", async () => {
  const item = await mkItem("A2")
  await mkBom(item.id, "1.0", { isDefault: true })
  const r1 = await createBom(bomIn(item.id, "2.0", { isDefault: true, status: "DRAFT" }))
  const r2 = await createBom(bomIn(item.id, "3.0", { isDefault: false, status: "ACTIVE" }))
  expect(r1.kind, r1.message).toBe("EXECUTED")
  expect(r2.kind, r2.message).toBe("EXECUTED")
  const ds = await activeDefaults(item.id)
  record("N03-04", null, { boms: snap(await boms(item.id)) })
  expect(ds.map((b) => b.version), "ACTIVE 기본 BOM 은 기존 1.0 하나").toEqual(["1.0"])
})

// ───────── 5~7. ECN ─────────
test("[N03-05/06] ECN 적용: 기존 활성 기본 BOM 만 비활성(+기본 해제), 활성 비기본 BOM 은 보존, 새 버전 중복 회피", async () => {
  const item = await mkItem("E1")
  const v1 = await mkBom(item.id, "1.0", { isDefault: true, comp: RM1.id, qty: 4 })
  const v2 = await mkBom(item.id, "2.0", { isDefault: false, comp: RM2.id, qty: 9 }) // 활성 비기본 — ECN 이 건드리면 안 됨. 다음 버전 번호(2.0)와도 겹친다
  const v9 = await mkBom(item.id, "9.0", { status: "DRAFT" })
  const ecn = await mkEcn(item.id, "E1")
  const res = await implementEcn(ecn.id)
  const list = await boms(item.id)
  record("N03-05", null, { kind: res.kind, msg: res.message, boms: snap(list) })
  expect(res.kind, res.message).toBe("EXECUTED")
  const byId = (id: string) => list.find((b) => b.id === id)!
  expect([byId(v1.id).status, byId(v1.id).isDefault], "기존 기본 BOM: 비활성 + 기본 해제").toEqual(["INACTIVE", false])
  expect([byId(v2.id).status, byId(v2.id).isDefault], "활성 비기본 BOM 보존").toEqual(["ACTIVE", false])
  expect(byId(v2.id).bomItems.map((b) => [b.componentItemId, Number(b.qtyPer)])).toEqual([[RM2.id, 9]])
  expect([byId(v9.id).status, byId(v9.id).isDefault], "초안 BOM 보존").toEqual(["DRAFT", false])
  const created = list.filter((b) => ![v1.id, v2.id, v9.id].includes(b.id))
  expect(created.length, "새 BOM 1건").toBe(1)
  expect([created[0].version, created[0].status, created[0].isDefault], "새 BOM: 2.0 은 이미 있어 3.0, ACTIVE 기본").toEqual(["3.0", "ACTIVE", true])
  expect(created[0].bomItems.map((b) => [b.componentItemId, Number(b.qtyPer)]), "구성은 기존 기본 BOM 에서 복사").toEqual([[RM1.id, 4]])
  expect((await activeDefaults(item.id)).length).toBe(1)
  expect(await ecnStatus(ecn.id)).toBe("IMPLEMENTED")
})

test("[N03-05b] ECN 적용 화면: 확인 → 적용 완료 안내 → 기본 BOM 교체", async ({ page }) => {
  const dialogs = collectDialogs(page)
  const item = await mkItem("E2")
  const v1 = await mkBom(item.id, "1.0", { isDefault: true })
  const keep = await mkBom(item.id, "5.0", { isDefault: false })
  const ecn = await mkEcn(item.id, "E2")
  await login(page)
  await gotoMenu(page, "/app/mes/ecn")
  const row = rowOf(page, ecn.ecnNo).first()
  await expect(row).toBeVisible({ timeout: 20_000 })
  const named = row.getByRole("button", { name: "메뉴 열기" })
  if (await named.count()) await named.click(); else await row.getByRole("button").last().click()
  await page.getByRole("menuitem", { name: /BOM\/Routing에 적용/ }).click()
  await expect.poll(async () => ecnStatus(ecn.id), { timeout: 20_000 }).toBe("IMPLEMENTED")
  const list = await boms(item.id)
  record("N03-05b", null, { dialogs, boms: snap(list) })
  expect(dialogs.join("|")).toContain("현재 활성 기본 BOM")
  expect(dialogs.join("|")).toContain("적용이 완료되었습니다")
  expect(snap(list)).toEqual(["1.0:INACTIVE:-", "2.0:ACTIVE:D", "5.0:ACTIVE:-"])
  expect(list.find((b) => b.id === keep.id)!.status).toBe("ACTIVE")
  expect(list.find((b) => b.id === v1.id)!.isDefault).toBe(false)
})

test("[N03-07] ECN 실패 시 전체 롤백 — (a) 라우팅 단계 실패 (b) 존재하지 않는 구성자재", async () => {
  // (a) BOTH: BOM 처리 뒤 라우팅 단계에서 실패(새 라우팅 코드 충돌) → 이미 바꾼 BOM 도 되돌아와야 한다
  const item = await mkItem("R1")
  const v1 = await mkBom(item.id, "1.0", { isDefault: true })
  const wc = D.workCenters.wc1
  const rtCode = `E2E-BR-RT-${uniq}-N03`
  const rt = await db.routing.create({
    data: {
      tenantId: D.tenantId, code: rtCode, name: "N03 롤백", version: "1.0", status: "ACTIVE", scope: "COMMON",
      operations: { create: [{ seq: 1, operationCode: wc.code, name: wc.name, workCenterId: wc.id, standardTime: 1 }] },
    },
  })
  await db.itemRouting.create({ data: { tenantId: D.tenantId, itemId: item.id, routingId: rt.id, isDefault: true } })
  // 다음 버전 라우팅 코드(`<코드>-V20`)를 미리 선점 → 라우팅 생성 단계에서 유니크 위반
  await db.routing.create({ data: { tenantId: D.tenantId, code: `${rtCode}-V20`, name: "충돌용", version: "1.0", status: "INACTIVE", scope: "COMMON" } })
  const ecnA = await mkEcn(item.id, "R1", { changeType: "BOTH" })
  const resA = await implementEcn(ecnA.id)
  const afterA = await boms(item.id)
  record("N03-07a", null, { kind: resA.kind, msg: resA.message.slice(0, 120), boms: snap(afterA) })
  expect(resA.kind, "라우팅 단계 실패는 오류로 전달").not.toBe("EXECUTED")
  expect(snap(afterA), "BOM 변경이 롤백되어 기존 기본 BOM 그대로").toEqual(["1.0:ACTIVE:D"])
  expect(afterA[0].id).toBe(v1.id)
  expect(await ecnStatus(ecnA.id), "ECN 상태 APPROVED 유지").toBe("APPROVED")
  expect((await db.routing.findUniqueOrThrow({ where: { id: rt.id } })).status, "라우팅도 변경 없음").toBe("ACTIVE")

  // (b) 구성자재가 존재하지 않는 품목 → 명확한 오류 + 기존 기본 BOM 유지
  const item2 = await mkItem("R2")
  await mkBom(item2.id, "1.0", { isDefault: true })
  const ecnB = await mkEcn(item2.id, "R2", { details: [{ changeTarget: "BOM_ITEM", actionType: "UPDATE", afterValue: { componentItemId: "no-such-item", seq: 1, qtyPer: 1, scrapRate: 0 } }] })
  const resB = await implementEcn(ecnB.id)
  const afterB = await boms(item2.id)
  record("N03-07b", null, { kind: resB.kind, msg: resB.message.slice(0, 120), boms: snap(afterB) })
  expect(resB.kind).not.toBe("EXECUTED")
  expect(resB.message).toMatch(/구성자재|존재하지 않는/)
  expect(snap(afterB)).toEqual(["1.0:ACTIVE:D"])
  expect(await ecnStatus(ecnB.id)).toBe("APPROVED")
})

test("[N03-07c] ECN 대상이 불명확하면(활성 기본 BOM 없음/2건 이상) 아무것도 바꾸지 않고 거부한다", async () => {
  // 활성 기본 BOM 없음 + 활성 비기본 BOM 만 있음 → 이전 동작은 임의의 활성 BOM 을 비활성화했다
  const noDef = await mkItem("N0")
  await mkBom(noDef.id, "1.0", { isDefault: false })
  const e0 = await mkEcn(noDef.id, "N0")
  const r0 = await implementEcn(e0.id)
  // 기존 중복 데이터(활성 기본 2건): 어느 쪽인지 알 수 없으므로 거부, 데이터는 건드리지 않는다
  const dup = await mkItem("N2")
  await mkBom(dup.id, "1.0", { isDefault: true })
  await mkBom(dup.id, "2.0", { isDefault: true })
  const e2 = await mkEcn(dup.id, "N2")
  const r2 = await implementEcn(e2.id)
  record("N03-07c", null, { none: [r0.kind, r0.message.slice(0, 80), snap(await boms(noDef.id))], dup: [r2.kind, r2.message.slice(0, 80), snap(await boms(dup.id))] })
  expect(r0.kind).not.toBe("EXECUTED")
  expect(r0.message).toMatch(/활성 기본 BOM/)
  expect(snap(await boms(noDef.id)), "활성 비기본 BOM 이 임의로 비활성화되지 않음").toEqual(["1.0:ACTIVE:-"])
  expect(await ecnStatus(e0.id)).toBe("APPROVED")
  expect(r2.kind).not.toBe("EXECUTED")
  expect(r2.message).toMatch(/2건|하나로 정리/)
  expect(snap(await boms(dup.id)), "기존 중복 데이터는 자동 수정하지 않음").toEqual(["1.0:ACTIVE:D", "2.0:ACTIVE:D"])
  expect(await ecnStatus(e2.id)).toBe("APPROVED")
})

// ───────── 8. 기존 계획·작업지시 BOM 참조 ─────────
test("[N03-08] 기본 BOM 교체(화면 경로·ECN) 후에도 기존 생산계획·작업지시의 BOM 참조는 그대로", async () => {
  const item = await mkItem("P1")
  const v1 = await mkBom(item.id, "1.0", { isDefault: true })
  const wc = D.workCenters.wc1
  const rt = await db.routing.create({
    data: {
      tenantId: D.tenantId, code: `E2E-BR-RT-${uniq}-P1`, name: "N03 참조", version: "1.0", status: "ACTIVE", scope: "COMMON",
      operations: { create: [{ seq: 1, operationCode: wc.code, name: wc.name, workCenterId: wc.id, standardTime: 1 }] },
    },
    include: { operations: true },
  })
  const plan = await db.productionPlan.create({
    data: { tenantId: D.tenantId, siteId: D.site.id, planNo: `E2E-BR-PP-${uniq}-P1`, planType: "WEEKLY", status: "DRAFT", startDate: new Date("2026-11-09"), endDate: new Date("2026-11-13"), items: { create: [{ itemId: item.id, bomId: v1.id, routingId: rt.id, plannedQty: 5 }] } },
    include: { items: true },
  })
  const wo = await db.workOrder.create({
    data: { tenantId: D.tenantId, siteId: D.site.id, itemId: item.id, bomId: v1.id, routingId: rt.id, orderNo: `E2E-BR-WO-${uniq}-P1`, plannedQty: 5, status: "RELEASED", operations: { create: [{ routingOperationId: rt.operations[0].id, seq: 1, plannedQty: 5 }] } },
  })
  // (1) 새 기본 BOM 등록 → v1 은 기본만 해제
  const r1 = await createBom(bomIn(item.id, "2.0", { isDefault: true }))
  expect(r1.kind, r1.message).toBe("EXECUTED")
  // (2) ECN → 현재 기본(2.0) 비활성화 + 3.0 생성
  const ecn = await mkEcn(item.id, "P1")
  const r2 = await implementEcn(ecn.id)
  expect(r2.kind, r2.message).toBe("EXECUTED")
  const planItem = await db.productionPlanItem.findUniqueOrThrow({ where: { id: plan.items[0].id } })
  const woAfter = await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } })
  record("N03-08", null, { boms: snap(await boms(item.id)), planBom: planItem.bomId === v1.id, woBom: woAfter.bomId === v1.id })
  expect(planItem.bomId, "생산계획 BOM 참조 유지").toBe(v1.id)
  expect(woAfter.bomId, "작업지시 BOM 참조 유지").toBe(v1.id)
  expect(snap(await boms(item.id))).toEqual(["1.0:ACTIVE:-", "2.0:INACTIVE:-", "3.0:ACTIVE:D"])
})

// ───────── 9. Excel 업로드 정책 ─────────
test("[N03-09] Excel 업로드 정책 유지: 기존 기본 BOM 불변, 같은 파일 안 중복 기본 없음, 기존 중복 데이터 불변", async () => {
  const withDef = await mkItem("X1")
  const v1 = await mkBom(withDef.id, "1.0", { isDefault: true })
  const fresh = await mkItem("X2")
  const legacy = await mkItem("X3")
  await mkBom(legacy.id, "1.0", { isDefault: true })
  await mkBom(legacy.id, "2.0", { isDefault: true })
  const group = (item: { id: string; code: string }, version: string) => ({ key: `${item.code}@${version}`, parentCode: item.code, parentItemId: item.id, version, status: "ACTIVE", items: [line(RM2.id, 2)] })
  const res = await importBoms([group(withDef, "2.0"), group(fresh, "1.0"), group(fresh, "2.0"), group(legacy, "3.0")])
  const a = await boms(withDef.id), f = await boms(fresh.id), l = await boms(legacy.id)
  record("N03-09", null, { kind: res.kind, msg: res.message.slice(0, 120), withDef: snap(a), fresh: snap(f), legacy: snap(l) })
  expect(res.kind, res.message).toBe("EXECUTED")
  expect(res.message).toContain('"success":true')
  expect(snap(a), "기존 기본 BOM 유지, 업로드 BOM 은 비기본").toEqual(["1.0:ACTIVE:D", "2.0:ACTIVE:-"])
  expect(a.find((b) => b.id === v1.id)!.isDefault).toBe(true)
  expect(snap(f), "기본이 없던 품목은 같은 파일 안에서 첫 ACTIVE 만 기본").toEqual(["1.0:ACTIVE:D", "2.0:ACTIVE:-"])
  expect(snap(l), "기존 중복 데이터는 업로드가 건드리지 않음(비기본 추가만)").toEqual(["1.0:ACTIVE:D", "2.0:ACTIVE:D", "3.0:ACTIVE:-"])
})

// ───────── 10. MRP 연계 ─────────
test("[N03-10] MRP: 기본 BOM 중복은 제외(임의 선택 없음) → 화면 경로로 기본 BOM 을 지정하면 정리되고 정상 전개, 비기본 저장은 기존 중복을 건드리지 않음", async () => {
  const item = await mkItem("M1")
  // 기존(수정 전 코드나 직접 입력으로 생긴) 중복 데이터를 로컬 DB 에 직접 구성
  const a = await mkBom(item.id, "1.0", { isDefault: true, comp: RM1.id, qty: 2 })
  const b = await mkBom(item.id, "2.0", { isDefault: true, comp: RM1.id, qty: 3 })
  const before = await sim(item.id)
  const excludedBefore = before.view.excluded.map((e) => e.reason)
  // 비기본 BOM 저장은 기존 중복에 손대지 않는다
  const nd = await createBom(bomIn(item.id, "2.5", { isDefault: false, status: "DRAFT", bomItems: [line(RM2.id, 1)] }))
  expect(nd.kind, nd.message).toBe("EXECUTED")
  expect((await activeDefaults(item.id)).map((x) => x.version), "기존 중복 데이터 자동 수정 없음").toEqual(["1.0", "2.0"])
  // 새 기본 BOM 지정 → 기존 두 기본이 모두 해제되고 1건만 남는다
  const r = await createBom(bomIn(item.id, "3.0", { isDefault: true, bomItems: [line(RM2.id, 7)] }))
  expect(r.kind, r.message).toBe("EXECUTED")
  const after = await sim(item.id)
  const need = (code: string) => after.view.materials.find((m) => m.code === code)?.totalRequirement
  record("N03-10", null, { excludedBefore, boms: snap(await boms(item.id)), excludedAfter: after.view.excluded.map((e) => e.reason), rm2: need(RM2.code) })
  expect(excludedBefore, "중복 기본 BOM 은 MRP 에서 제외(임의 선택 안 함)").toContain("MULTIPLE_DEFAULT_BOM")
  expect((await activeDefaults(item.id)).map((x) => x.version)).toEqual(["3.0"])
  const old = await db.bOM.findMany({ where: { id: { in: [a.id, b.id] } } })
  expect(old.map((x) => `${x.status}:${x.isDefault}`), "기존 두 BOM: ACTIVE 유지, 기본 지정만 해제").toEqual(["ACTIVE:false", "ACTIVE:false"])
  expect(after.view.excluded.map((e) => e.reason), "정리 후 제외 사유 없음").toEqual([])
  expect(need(RM2.code), "새 기본 BOM(RM2×7) 로 전개").toBe(70)
  expect(need(RM1.code), "이전 기본 BOM 의 RM1 은 전개되지 않음").toBeUndefined()
})

// ───────── 11. 동시성 ─────────
test("[N03-11a] 동시 등록: 같은 품목에 기본 BOM 8건을 동시에 등록해도 ACTIVE 기본 BOM 은 1건", async () => {
  const item = await mkItem("C1")
  await mkBom(item.id, "0.1", { isDefault: true })
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => createBom(bomIn(item.id, `C-${i + 1}`, { isDefault: true, bomItems: [line(RM1.id, i + 1)] }))))
  const list = await boms(item.id)
  const ds = list.filter((b) => b.isDefault && b.status === "ACTIVE")
  record("N03-11a", null, { kinds: results.map((r) => r.kind), boms: snap(list) })
  expect(results.map((r) => r.kind + ":" + r.message.slice(0, 60)), "모든 요청이 오류 없이 직렬 처리").toEqual(results.map(() => expect.stringMatching(/^EXECUTED/)))
  expect(list.length, "9건(기존 1 + 신규 8) 모두 저장").toBe(9)
  expect(ds.length, `ACTIVE 기본 BOM = ${snap(ds)}`).toBe(1)
  expect(list.filter((b) => b.status === "ACTIVE").length, "해제된 BOM 도 모두 ACTIVE 유지").toBe(9)
})

test("[N03-11b] 동시 변경: 기존 BOM 5건을 동시에 기본으로 수정해도 ACTIVE 기본 BOM 은 1건", async () => {
  const item = await mkItem("C2")
  const made = []
  for (let i = 0; i < 5; i++) made.push(await mkBom(item.id, `U-${i + 1}`, { isDefault: i === 0 }))
  const results = await Promise.all(made.map((b) => updateBom(b.id, bomIn(item.id, b.version, { isDefault: true }))))
  const list = await boms(item.id)
  const ds = list.filter((b) => b.isDefault && b.status === "ACTIVE")
  record("N03-11b", null, { kinds: results.map((r) => r.kind), boms: snap(list) })
  expect(results.every((r) => r.kind === "EXECUTED"), JSON.stringify(results.map((r) => r.message.slice(0, 80)))).toBe(true)
  expect(ds.length, `ACTIVE 기본 BOM = ${snap(ds)}`).toBe(1)
})

test("[N03-11c] 동시 혼합: 화면 등록 + ECN 적용 + Excel 업로드가 동시에 들어와도 ACTIVE 기본 BOM 은 1건", async () => {
  const item = await mkItem("C3")
  await mkBom(item.id, "1.0", { isDefault: true })
  const ecn = await mkEcn(item.id, "C3")
  const ecn2 = await mkEcn(item.id, "C3B")
  const group = { key: `${item.code}@IMP`, parentCode: item.code, parentItemId: item.id, version: "IMP", status: "ACTIVE", items: [line(RM2.id, 2)] }
  const results = await Promise.all([
    createBom(bomIn(item.id, "N-1", { isDefault: true })),
    implementEcn(ecn.id),
    importBoms([group]),
    createBom(bomIn(item.id, "N-2", { isDefault: true })),
    implementEcn(ecn2.id),
  ])
  const list = await boms(item.id)
  const ds = list.filter((b) => b.isDefault && b.status === "ACTIVE")
  record("N03-11c", null, { results: results.map((r) => `${r.kind}:${r.message.slice(0, 50)}`), boms: snap(list) })
  expect(ds.length, `ACTIVE 기본 BOM = ${snap(list)}`).toBe(1)
  // 직렬화되어 기본 BOM 이 항상 존재하므로 ECN 두 건도 모두 성공해야 한다
  expect(results[1].kind, results[1].message).toBe("EXECUTED")
  expect(results[4].kind, results[4].message).toBe("EXECUTED")
})
