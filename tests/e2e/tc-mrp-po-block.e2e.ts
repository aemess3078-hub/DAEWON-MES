/**
 * 2-D-0 MRP 구매발주 생성 차단 서버 검증 (서버 액션 실호출 + DB 직접 대조, 로컬 테스트 DB 전용)
 *  정책: 생산계획 기준·수주 기준 MRP 에서 구매발주를 만드는 두 서버 액션은 신규 생성을 막는다.
 *        MRP 계산·조회와 일반 구매발주 등록(발주관리)은 그대로 동작한다.
 *  검증 방식: 서버 액션 HTTP 직접 호출(화면 우회) 전후로 PurchaseOrder/MrpRun/MrpRunPurchase 행 수와 감사 로그를 대조한다.
 */
import { test, expect } from "@playwright/test"
import { assertSafeE2eEnvironment, adminCredentials, developerCredentials } from "./guard"
import { apiLogin, roleCreds } from "./support/perm-lib"
import { loadData, logDetail, db, closeDb, num, call, findAction, warm, rid, iso, addDays, counts, diffCounts } from "./support/o2s-lib"

assertSafeE2eEnvironment()
const D = loadData()
const T = D.tenantId
let admin = ""
let viewer = ""
const A = (n: string, re: RegExp) => findAction(n, re)
const note = (id: string, o: Record<string, unknown>) => logDetail({ id, ...o })
const errOf = (r: { value: any; error: string | null }) => String(r.value?.error ?? r.error ?? "")
const RUN = Date.now().toString(36).toUpperCase()
const MRP_PAGE = { pagePath: "/app/mes/mrp" }
const BLOCK_MSG = /구매발주.*발주관리/

test.beforeAll(async () => {
  const a = adminCredentials(), d = developerCredentials()
  admin = (await apiLogin(a.loginId, a.password)).cookie ?? ""
  const dev = (await apiLogin(d.loginId, d.password)).cookie ?? ""
  try { const v = roleCreds("VIEWER"); viewer = (await apiLogin(v.loginId, v.password)).cookie ?? "" } catch { viewer = "" }
  await warm(dev, ["/app/mes/mrp", "/app/mes/purchase-orders", "/app/mes/sales-orders", "/app/mes/production-plan", "/login"])
})
test.afterAll(async () => { await closeDb() })

const poCounts = async () => ({
  po: await db().purchaseOrder.count({ where: { tenantId: T } }),
  poItem: await db().purchaseOrderItem.count({ where: { purchaseOrder: { tenantId: T } } }),
  run: await db().mrpRun.count({ where: { tenantId: T } }),
  runPo: await db().mrpRunPurchase.count({ where: { tenantId: T } }),
  runSug: await db().mrpRunSuggestion.count({ where: { tenantId: T } }),
  audit: await db().auditLog.count({ where: { tenantId: T } }),
  mrpPrefix: await db().purchaseOrder.count({ where: { tenantId: T, orderNo: { startsWith: "PO-MRP-" } } }),
})
const sameAs = (a: Record<string, number>, b: Record<string, number>) => Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => `${k}:${a[k]}→${b[k]}`)

async function mkSo(qty: number) {
  const r = await call(admin, A("createSalesOrder", /sales-order\.actions/), [T, D.site.id, { customerId: D.customer.id, orderDate: iso(new Date()), deliveryDate: iso(addDays(10)), status: "CONFIRMED", items: [{ itemId: D.items.fg.id, qty, unitPrice: 1, deliveryDate: iso(addDays(10)) }] }])
  expect(r.ok, r.error ?? "").toBe(true)
}
async function mkConfirmedStockPlan(qty: number) {
  const tag = `E2E-MB stock ${RUN}`
  const r = await call(admin, A("createPlan", /production-plan\.actions/), [{ siteId: D.site.id, planNo: "", planType: "DAILY", startDate: "2026-11-02", endDate: "2026-11-30", status: "CONFIRMED", note: tag, items: [{ itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, plannedQty: qty }] }, T])
  expect(r.ok, errOf(r)).toBe(true)
  return db().productionPlan.findFirstOrThrow({ where: { tenantId: T, note: tag } })
}
const planPoArgs = () => [[{ itemId: D.items.rm1.id, qty: 100 }, { itemId: D.items.rm2.id, qty: 150 }], undefined, D.site.id]
const orderPoInput = (key: string) => ({
  lines: [{ itemId: D.items.rm1.id, supplierId: D.supplier.id, qty: 100, requiredDate: iso(addDays(7)).slice(0, 10) }],
  groupExpectedDates: { [D.supplier.id]: iso(addDays(7)).slice(0, 10) }, siteId: D.site.id, requestKey: key, mrp: {},
})
const callPlanPo = (cookie: string | null) => call(cookie, A("createPurchaseOrdersFromMRP", /mrp\.actions/), planPoArgs(), MRP_PAGE)
const callOrderPo = (cookie: string | null, input: unknown) => call(cookie, A("createDraftPurchaseOrdersFromMrpSuggestions", /mrp-purchase-suggestion\.actions/), [input], MRP_PAGE)

let existingPoId = ""
let existingPoSnapshot = ""
const snapPo = async (id: string) => {
  const p = await db().purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { itemId: "asc" } } } })
  return JSON.stringify({ n: p.orderNo, s: p.status, t: num(p.totalAmount), u: p.updatedAt.toISOString(), i: p.items.map((i) => [i.itemId, num(i.qty), num(i.unitPrice), num(i.receivedQty)]) })
}

test("[MB-01] 생산계획 기준 MRP 계산 정상 — 확정 계획 50개 → 원자재1 100, 원자재2 150, 확정 계획 목록에 표시", async () => {
  const plan = await mkConfirmedStockPlan(50)
  const list = await call(admin, A("getPlansForMRP", /mrp\.actions/), [], MRP_PAGE)
  expect(list.ok, errOf(list)).toBe(true)
  expect((list.value as any[]).some((p) => p.id === plan.id), "확정 계획이 MRP 대상 목록에 있음").toBe(true)
  const r = await call(admin, A("runMRP", /mrp\.actions/), [plan.id], MRP_PAGE)
  expect(r.ok, errOf(r)).toBe(true)
  const g = Object.fromEntries((r.value?.items ?? []).map((i: any) => [i.itemId, num(i.grossRequirement)]))
  note("MB-01", { g })
  expect([g[D.items.rm1.id], g[D.items.rm2.id]]).toEqual([100, 150])
})

test("[MB-02] 수주 기준 MRP 계산·발주제안 조회 정상", async () => {
  await mkSo(40)
  const m = await call(admin, A("runOrderBasedMrp", /mrp-order\.actions/), [{}], MRP_PAGE)
  expect(m.ok, errOf(m)).toBe(true)
  const m1 = (m.value?.view?.materials as any[]).find((x) => x.componentItemId === D.items.rm1.id)
  expect(num(m1?.totalRequirement), "수주 40 × BOM 2 이상").toBeGreaterThanOrEqual(80)
  const s = await call(admin, A("getPurchaseSuggestions", /mrp-purchase-suggestion\.actions/), [{}], MRP_PAGE)
  expect(s.ok, errOf(s)).toBe(true)
  expect(Array.isArray(s.value?.rows), "발주제안 행 배열").toBe(true)
  note("MB-02", { rows: (s.value?.rows ?? []).length })
})

test("[MB-07] 일반 구매발주 등록·조회·확정 정상 (발주관리 경로, MRP 차단과 무관)", async () => {
  const before = await poCounts()
  const r = await call(admin, A("createPurchaseOrder", /purchase-order\.actions/), [T, D.site.id, { supplierId: D.supplier.id, orderDate: iso(new Date()), expectedDate: iso(addDays(5)), status: "DRAFT", currency: "KRW", note: `E2E-MB ${RUN}`, items: [{ itemId: D.items.rm1.id, qty: 10, unitPrice: 100 }] }], { pagePath: "/app/mes/purchase-orders" })
  expect(r.ok && r.value?.success !== false, errOf(r)).toBe(true)
  const po = await db().purchaseOrder.findFirstOrThrow({ where: { tenantId: T, note: `E2E-MB ${RUN}` }, include: { items: true } })
  expect(po.orderNo).toMatch(/^PO-\d{4}-\d{3,}$/)
  expect(po.status).toBe("DRAFT")
  expect([po.items.length, num(po.items[0].qty), num(po.items[0].unitPrice)]).toEqual([1, 10, 100])
  expect(await db().auditLog.count({ where: { tenantId: T, entityType: "PurchaseOrder", entityId: po.id, action: "CREATE" } }), "감사 로그 기록").toBe(1)
  const list = await call(admin, A("getPurchaseOrders", /purchase-order\.actions/), [T], { pagePath: "/app/mes/purchase-orders" })
  expect(list.ok, errOf(list)).toBe(true)
  expect((list.value as any[]).some((p) => p.id === po.id), "목록 조회에 표시").toBe(true)
  const up = await call(admin, A("updatePurchaseOrder", /purchase-order\.actions/), [po.id, { status: "ORDERED" }], { pagePath: "/app/mes/purchase-orders" })
  expect(up.ok, errOf(up)).toBe(true)
  expect((await db().purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("ORDERED")
  const after = await poCounts()
  expect(after.po - before.po, "일반 등록은 발주 1건 증가").toBe(1)
  expect(after.mrpPrefix, "MRP 번호(PO-MRP-) 발주는 없음").toBe(0)
  existingPoId = po.id
  existingPoSnapshot = await snapPo(po.id)
})

test("[MB-03] 생산계획 기준 MRP 구매발주 생성 차단 — 한글 안내, 발주·이력·감사 로그 0건 변화", async () => {
  const before = await poCounts(), fp = await counts()
  const r = await callPlanPo(admin)
  note("MB-03", { value: r.value })
  expect(r.value?.success, "차단 결과").toBe(false)
  expect(String(r.value?.error)).toMatch(BLOCK_MSG)
  expect(r.value?.orderNo, "발주번호 없음").toBeUndefined()
  expect(sameAs(before, await poCounts()), "행 수 변화 없음").toEqual([])
  expect(diffCounts(fp, await counts()), "업무 테이블 변화 없음").toEqual([])
})

test("[MB-04] 수주 기준 MRP 구매발주 생성 차단 — CREATION_DISABLED, 실행이력·발주 0건 변화", async () => {
  const before = await poCounts(), fp = await counts()
  const r = await callOrderPo(admin, orderPoInput(rid("mb4")))
  note("MB-04", { value: r.value })
  expect(r.value?.success).toBe(false)
  expect(r.value?.code).toBe("CREATION_DISABLED")
  expect(String(r.value?.error)).toMatch(BLOCK_MSG)
  expect(sameAs(before, await poCounts()), "MrpRun/MrpRunPurchase/PurchaseOrder 변화 없음").toEqual([])
  expect(diffCounts(fp, await counts())).toEqual([])
})

test("[MB-05] 반복·동시 요청에서도 발주 0건 — 같은 요청 키 재전송, 새 키, 두 경로 병렬 20건", async () => {
  const before = await poCounts()
  const key = rid("mb5")
  for (let i = 0; i < 4; i++) {
    expect((await callOrderPo(admin, orderPoInput(key))).value?.success, `같은 키 ${i + 1}회`).toBe(false)
    expect((await callOrderPo(admin, orderPoInput(rid("mb5n")))).value?.success, `새 키 ${i + 1}회`).toBe(false)
    expect((await callPlanPo(admin)).value?.success, `계획 경로 ${i + 1}회`).toBe(false)
  }
  const par = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? callPlanPo(admin) : callOrderPo(admin, orderPoInput(key)))))
  expect(par.every((r) => r.value?.success === false), "병렬 요청 전부 차단").toBe(true)
  expect(sameAs(before, await poCounts()), "반복·병렬 후에도 변화 없음").toEqual([])
})

test("[MB-06] 우회 호출 차단 — 잘못된 본문·빈 입력·다른 사이트·테넌트 값·비로그인 요청에서도 발주 0건", async () => {
  const before = await poCounts()
  const variants = [
    callOrderPo(admin, { lines: [], requestKey: rid("mb6") }),
    callOrderPo(admin, null),
    callOrderPo(admin, { ...orderPoInput(rid("mb6")), siteId: "no-such-site" }),
    call(admin, A("createPurchaseOrdersFromMRP", /mrp\.actions/), [[], "other-tenant-id", D.site.id], MRP_PAGE),
    call(admin, A("createPurchaseOrdersFromMRP", /mrp\.actions/), [[{ itemId: D.items.rm1.id, qty: -5 }], "other-tenant-id", "no-such-site"], MRP_PAGE),
    call(admin, A("createPurchaseOrdersFromMRP", /mrp\.actions/), ["garbage"], MRP_PAGE),
  ]
  for (const r of await Promise.all(variants)) expect(r.value?.success === true, `성공해서는 안 됨: ${JSON.stringify(r.value).slice(0, 120)}`).toBe(false)
  const anon1 = await callPlanPo(null), anon2 = await callOrderPo(null, orderPoInput(rid("mb6a")))
  note("MB-06", { anon1: anon1.error ?? anon1.value, anon2: anon2.error ?? anon2.value })
  expect(anon1.value?.success === true || anon2.value?.success === true, "비로그인 요청 성공 불가").toBe(false)
  expect(sameAs(before, await poCounts())).toEqual([])
})

test("[MB-08] 기존 발주·이력 보존 — 차단 시도 후에도 기존 발주 내용·감사 로그·MRP 계산 결과 동일", async () => {
  expect(existingPoId).not.toBe("")
  expect(await snapPo(existingPoId), "기존 발주(헤더·품목·수량·수정시각) 불변").toBe(existingPoSnapshot)
  const logs = await db().auditLog.findMany({ where: { tenantId: T, entityType: "PurchaseOrder", entityId: existingPoId }, orderBy: { actedAt: "asc" } })
  expect(logs.length, "일반 등록·확정 감사 로그만 존재").toBeGreaterThanOrEqual(2)
  const plan = await db().productionPlan.findFirstOrThrow({ where: { tenantId: T, note: `E2E-MB stock ${RUN}` } })
  const r = await call(admin, A("runMRP", /mrp\.actions/), [plan.id], MRP_PAGE)
  expect(r.ok, errOf(r)).toBe(true)
  // 일반 발주(ORDERED 10)가 발주중 수량으로 반영되어 순소요가 줄어든다 — 기존 계산 로직 유지
  const rm1 = (r.value.items as any[]).find((i) => i.itemId === D.items.rm1.id)
  expect(num(rm1.onOrder), "확정 발주 미입고 10 반영").toBeGreaterThanOrEqual(10)
})

test("[MB-09] 권한 영향 — 조회 전용(VIEWER) 계정은 두 경로 모두 권한 거부(차단 안내가 아님), 변화 없음", async () => {
  test.skip(!viewer, "ROLE_VIEWER 계정 없음(seed-roles 필요)")
  const before = await poCounts()
  const a = await callPlanPo(viewer), b = await callOrderPo(viewer, orderPoInput(rid("mb9")))
  note("MB-09", { a: a.error ?? a.value, b: b.error ?? b.value })
  for (const r of [a, b]) {
    expect(r.ok, "권한 없는 사용자는 성공 불가").toBe(false)
    expect(JSON.stringify(r.value ?? {}) + String(r.error), "차단 안내 문구가 아니라 권한 거부").not.toMatch(BLOCK_MSG)
  }
  expect(sameAs(before, await poCounts())).toEqual([])
})
