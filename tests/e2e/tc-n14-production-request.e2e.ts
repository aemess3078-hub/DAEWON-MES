/**
 * N-14 수주 생산의뢰 중복 생성 방지 검증 (서버 액션 실호출 + DB 직접 대조, 로컬 테스트 DB 전용)
 * 정책: 수주 품목별 생산의뢰 가능 잔량 = 수주 수량 − (취소되지 않은 생산계획에 연결된 계획 수량 합계). 잔량 안에서 부분 의뢰 허용, 초과 차단.
 * 취소(CANCELLED)된 계획은 잔량에서 제외되어 재의뢰할 수 있고 취소 이력은 보존된다.
 * 선행: seed-o2s.ts(품목·BOM). 수정 전에는 중복·초과 의뢰가 성공해 실패해야 하고, 수정 후 통과해야 한다.
 */
import { test, expect } from "@playwright/test"
import { assertSafeE2eEnvironment, adminCredentials, developerCredentials } from "./guard"
import { apiLogin } from "./support/perm-lib"
import { loadData, logDetail, db, closeDb, num, call, findAction, warm, rid, iso, addDays, counts, diffCounts, legacyDraftSalesOrder } from "./support/o2s-lib"

assertSafeE2eEnvironment()
const D = loadData()
const T = D.tenantId
let admin = ""
const A = (n: string, re: RegExp) => findAction(n, re)
const note = (id: string, o: Record<string, unknown>) => logDetail({ id, ...o })

test.beforeAll(async () => {
  const a = adminCredentials(), d = developerCredentials()
  admin = (await apiLogin(a.loginId, a.password)).cookie ?? ""
  const dev = (await apiLogin(d.loginId, d.password)).cookie ?? ""
  await warm(dev, ["/app/mes/sales-orders", "/app/mes/production-plan", "/app/mes/mrp"])
})
test.afterAll(async () => { await closeDb() })

async function mkSo(qty: number, status: "CONFIRMED" | "DRAFT" = "CONFIRMED") {
  if (status === "DRAFT") return legacyDraftSalesOrder(D, qty) // 서버는 항상 확정으로 등록하므로 초안은 과거 데이터로 심는다
  const r = await call(admin, A("createSalesOrder", /sales-order\.actions/), [T, D.site.id, { customerId: D.customer.id, orderDate: iso(new Date()), deliveryDate: iso(addDays(10)), status, items: [{ itemId: D.items.fg.id, qty, unitPrice: 1, deliveryDate: iso(addDays(10)) }] }])
  expect(r.ok, r.error ?? "").toBe(true)
  const so = await db().salesOrder.findFirstOrThrow({ where: { tenantId: T }, orderBy: { createdAt: "desc" }, include: { items: true } })
  return { id: so.id, no: so.orderNo, itemId: so.items[0].id }
}
type So = Awaited<ReturnType<typeof mkSo>>
const request = (so: So, qty: number, requestId?: string, over: Record<string, unknown> = {}) =>
  call(admin, A("requestProductionFromSalesOrder", /sales-order\.actions/), [so.id, [{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty, ...over }], T, D.site.id, ...(requestId ? [requestId] : [])])

/** DB 오라클: 수주 품목에 연결된 계획 수량(취소 제외/포함)과 계획 수 */
async function planned(soItemId: string) {
  const rows = await db().productionPlanItem.findMany({ where: { salesOrderItemId: soItemId }, include: { plan: { select: { id: true, status: true, planNo: true } } } })
  const active = rows.filter((r) => r.plan.status !== "CANCELLED")
  return { active: active.reduce((s, r) => s + num(r.plannedQty), 0), all: rows.reduce((s, r) => s + num(r.plannedQty), 0), planCount: new Set(rows.map((r) => r.plan.id)).size, activePlans: new Set(active.map((r) => r.plan.id)).size, rows }
}
const ok = (r: { ok: boolean; value: any }) => r.ok && r.value?.ok !== false

test("[N14-01] 최초 생산의뢰 — 수주 100 에 100 의뢰: 계획(확정 — 등록 즉시 확정) 1건·수주 품목 연결·수량 일치·수주 상태 IN_PRODUCTION", async () => {
  const so = await mkSo(100)
  const r = await request(so, 100)
  expect(ok(r), r.value?.error ?? r.error ?? "").toBe(true)
  const p = await planned(so.itemId)
  expect([p.active, p.activePlans]).toEqual([100, 1])
  const plan = p.rows[0].plan
  expect(plan.status).toBe("CONFIRMED")
  expect(plan.planNo).toMatch(/^PP-REQ-\d{8}-\d{3}$/)
  expect((await db().salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("IN_PRODUCTION")
})

test("[N14-02] 중복 생산의뢰 — 이미 100 의뢰한 수주 품목에 100 을 다시 의뢰하면 거부(한글 안내), 계획·수량 불변", async () => {
  const so = await mkSo(100)
  expect(ok(await request(so, 100))).toBe(true)
  const before = await counts()
  const r = await request(so, 100)
  note("N14-02", { r: r.value ?? r.error })
  expect(ok(r), "잔량 0 인데 의뢰가 허용됨").toBe(false)
  expect(r.value?.error ?? r.error ?? "", "수주 수량·기의뢰·가능 잔량·요청 수량 안내").toMatch(/생산의뢰.*수주 수량 100.*이미 의뢰 100.*가능 잔량 0.*요청 100/)
  const p = await planned(so.itemId)
  expect([p.all, p.planCount], "계획 수량 합계 100, 계획 1건").toEqual([100, 1])
  expect(diffCounts(before, await counts()), "거부된 요청은 DB 불변").toEqual([])
})

test("[N14-03] 부분 생산의뢰 → 잔여량만큼 추가 의뢰 허용 → 잔량 초과(+1) 거부", async () => {
  const so = await mkSo(100)
  expect(ok(await request(so, 40)), "부분 40").toBe(true)
  expect((await planned(so.itemId)).active).toBe(40)
  const over = await request(so, 61)
  expect(ok(over), "잔량 60 에 61 요청은 거부").toBe(false)
  expect(over.value?.error ?? over.error ?? "").toMatch(/가능 잔량 60.*요청 61/)
  expect((await planned(so.itemId)).active, "거부 후에도 40").toBe(40)
  expect(ok(await request(so, 60)), "잔여 60 추가 의뢰").toBe(true)
  const p = await planned(so.itemId)
  expect([p.active, p.activePlans], "합계 100 = 수주 수량, 계획 2건").toEqual([100, 2])
  expect(ok(await request(so, 1)), "수주 수량을 다 의뢰한 뒤 +1 거부").toBe(false)
  expect((await planned(so.itemId)).active).toBe(100)
})

test("[N14-04] 잔량 초과 최초 요청(101) 및 부정 입력(0·음수·소수 7자리) 거부, DB 불변", async () => {
  const so = await mkSo(100)
  const before = await counts()
  const cases: [string, number][] = [["수주 수량 초과 101", 101], ["수량 0", 0], ["음수", -5], ["소수 7자리", 0.1234567]]
  const leaked: string[] = []
  for (const [name, qty] of cases) { const r = await request(so, qty); note("N14-04", { name, r: r.value ?? r.error }); if (ok(r)) leaked.push(name) }
  expect(leaked, `허용되면 안 되는 요청: ${leaked.join(", ")}`).toEqual([])
  expect(diffCounts(before, await counts()), "DB 불변").toEqual([])
  expect((await planned(so.itemId)).all).toBe(0)
})

test("[N14-05] 동일 요청(같은 요청ID) 2회 전송 — 재전송은 새 계획 없이 처음 결과(replayed), 같은 ID 에 다른 내용은 거부", async () => {
  const so = await mkSo(100)
  const id = rid("pr")
  const a = await request(so, 30, id)
  expect(ok(a), a.value?.error ?? "").toBe(true)
  const before = await counts()
  const b = await request(so, 30, id)
  expect([b.value?.ok, b.value?.replayed, b.value?.planNo], "재전송: 성공 + replayed + 같은 계획번호").toEqual([true, true, a.value?.planNo])
  expect(diffCounts(before, await counts()), "재전송은 DB 불변").toEqual([])
  const diff = await request(so, 31, id)
  expect(ok(diff), "같은 ID 다른 수량 거부").toBe(false)
  expect(diff.value?.error ?? "").toMatch(/같은 요청 ID/)
  const bad = await request(so, 5, "short")
  expect(ok(bad), "잘못된 요청ID 형식 거부").toBe(false)
  const p = await planned(so.itemId)
  expect([p.active, p.activePlans]).toEqual([30, 1])
})

test("[N14-06] 동시 요청 10건 — (a) 서로 다른 ID 10×20 은 잔량(100) 만큼 5건만 반영, (b) 같은 ID 10건은 1건만 반영", async () => {
  const so = await mkSo(100)
  const rs = await Promise.all(Array.from({ length: 10 }, () => request(so, 20, rid("par"))))
  const okN = rs.filter((r) => ok(r)).length
  note("N14-06", { ok: okN, errors: Array.from(new Set(rs.filter((r) => !ok(r)).map((r) => r.value?.error ?? r.error))) })
  expect(okN, "성공은 정확히 5건(100/20)").toBe(5)
  const p = await planned(so.itemId)
  expect([p.active, p.activePlans], "DB: 계획 수량 합계 100, 계획 5건").toEqual([100, 5])
  expect(rs.filter((r) => !ok(r)).every((r) => /가능 잔량/.test(String(r.value?.error ?? ""))), "나머지 5건은 잔량 초과 안내").toBe(true)
  const planNos = p.rows.map((r) => r.plan.planNo)
  expect(new Set(planNos).size, "계획번호 중복 없음").toBe(planNos.length)
  const so2 = await mkSo(100)
  const same = rid("parsame")
  const ss = await Promise.all(Array.from({ length: 10 }, () => request(so2, 20, same)))
  const p2 = await planned(so2.itemId)
  expect([p2.active, p2.activePlans], "같은 ID 10건 → 계획 1건(20)").toEqual([20, 1])
  expect(ss.every((r) => ok(r)), "모든 응답 성공(1건 처리 + 9건 replay)").toBe(true)
})

test("[N14-07] 생산계획 취소 후 재의뢰 — 취소된 계획 수량은 잔량에서 제외되어 다시 의뢰할 수 있고, 취소 이력은 보존된다", async () => {
  const so = await mkSo(100)
  const a = await request(so, 100)
  expect(ok(a)).toBe(true)
  const first = (await planned(so.itemId)).rows[0].plan
  expect(ok(await request(so, 1)), "취소 전에는 잔량 0").toBe(false)
  const c = await call(admin, A("cancelProductionPlan", /production-plan\.actions/), [first.id, "N14 테스트 취소"])
  expect(c.ok, c.error ?? "").toBe(true)
  expect((await db().productionPlan.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("CANCELLED")
  expect((await db().salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status, "활성 계획이 없으면 수주 상태 복귀").toBe("CONFIRMED")
  const again = await request(so, 100)
  expect(ok(again), again.value?.error ?? again.error ?? "").toBe(true)
  const p = await planned(so.itemId)
  expect([p.active, p.all, p.planCount, p.activePlans], "활성 100 / 취소 포함 200 / 계획 2건 중 활성 1").toEqual([100, 200, 2, 1])
  const cancelled = await db().productionPlan.findUniqueOrThrow({ where: { id: first.id }, include: { items: true } })
  expect([cancelled.status, cancelled.items.length, num(cancelled.items[0].plannedQty), cancelled.items[0].salesOrderItemId], "취소 계획·품목 이력 보존").toEqual(["CANCELLED", 1, 100, so.itemId])
  expect(await db().auditLog.count({ where: { tenantId: T, entityType: "ProductionPlan", entityId: first.id } }), "감사 로그 보존").toBeGreaterThan(0)
  expect(ok(await request(so, 1)), "재의뢰 후 다시 잔량 0").toBe(false)
})

test("[N14-08] 입력 검증 — 다른 수주의 품목·품목 불일치·같은 줄 중복·종결 수주는 거부되고 DB 불변", async () => {
  const so = await mkSo(100), other = await mkSo(50)
  const before = await counts()
  const call2 = (lines: any[], s: So = so) => call(admin, A("requestProductionFromSalesOrder", /sales-order\.actions/), [s.id, lines, T, D.site.id])
  const cases: [string, any][] = [
    ["다른 수주의 품목 ID", await call2([{ salesOrderItemId: other.itemId, itemId: D.items.fg.id, qty: 10 }])],
    ["품목 불일치", await call2([{ salesOrderItemId: so.itemId, itemId: D.items.rm1.id, qty: 10 }])],
    ["같은 수주 품목 두 줄", await call2([{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty: 10 }, { salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty: 10 }])],
    ["존재하지 않는 수주 품목", await call2([{ salesOrderItemId: "E2E-NO-SUCH", itemId: D.items.fg.id, qty: 10 }])],
  ]
  const leaked = cases.filter(([, r]) => ok(r)).map(([n]) => n)
  expect(leaked, `허용되면 안 되는 요청: ${leaked.join(", ")}`).toEqual([])
  // 취소된 수주
  expect((await call(admin, A("updateSalesOrder", /sales-order\.actions/), [other.id, { status: "CANCELLED" }])).ok).toBe(true)
  const cancelled = await call2([{ salesOrderItemId: other.itemId, itemId: D.items.fg.id, qty: 10 }], other)
  expect(ok(cancelled), "취소된 수주는 생산의뢰 불가").toBe(false)
  expect(diffCounts(before, await counts()).filter((d) => !d.startsWith("AuditLog")), "DB 불변").toEqual([])
})

test("[N14-09] 수량 정합성·MRP — 반복 시도 후에도 수주 품목당 활성 계획 합계 ≤ 수주 수량, 수주기준·계획기준 MRP 소요가 중복 계산되지 않는다", async () => {
  const so = await mkSo(100)
  expect(ok(await request(so, 100))).toBe(true)
  for (let i = 0; i < 3; i++) expect(ok(await request(so, 100)), "반복 시도 거부").toBe(false)
  // 계획 확정(계획기준 MRP 는 확정·진행 계획만 대상)
  const plan = (await planned(so.itemId)).rows[0]
  const full = await db().productionPlan.findUniqueOrThrow({ where: { id: plan.plan.id } })
  const up = await call(admin, A("updatePlan", /production-plan\.actions/), [full.id, { siteId: D.site.id, planNo: full.planNo, planType: full.planType, startDate: "2026-11-02", endDate: "2026-11-30", status: "CONFIRMED", items: [{ productionPlanItemId: plan.id, salesOrderItemId: so.itemId, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, plannedQty: 100 }] }])
  expect(up.ok, up.error ?? "").toBe(true)
  const mrp = await call(admin, A("runOrderBasedMrp", /mrp-order\.actions/), [{}])
  const m1 = (mrp.value.view.materials as any[]).find((m) => m.componentItemId === D.items.rm1.id)
  expect(num(m1.totalRequirement), "수주기준 MRP: 수주 100×BOM 2 = 200 (이전 테스트의 수주 포함 합산이므로 이 수주분만 대조)").toBeGreaterThanOrEqual(200)
  const plans = await call(admin, A("getPlansForMRP", /mrp\.actions/), [])
  const mine = (plans.value as any[]).filter((p) => p.items.some((i: any) => i.salesOrderItemId === so.itemId))
  expect(mine.length, "이 수주에 연결된 확정 계획은 1건").toBe(1)
  const r = await call(admin, A("runMRP", /mrp\.actions/), [mine[0].id])
  const gross = (r.value.items as any[]).find((i) => i.itemId === D.items.rm1.id)?.grossRequirement
  expect(num(gross), "계획기준 MRP: 원자재1 총소요 = 100×2 (중복 계획이 있었다면 400)").toBe(200)
  // 이 수주 품목 전체 대조
  const p = await planned(so.itemId)
  expect(p.active).toBeLessThanOrEqual(100)
})
