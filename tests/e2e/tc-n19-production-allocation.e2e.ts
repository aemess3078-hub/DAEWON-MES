/**
 * N-19 / 생산 유형·수주 충당 수량 분리 검증 (서버 액션 실호출 + DB 직접 대조, 로컬 테스트 DB 전용)
 * 정책: 생산 계획 수량(plannedQty)은 수주 수량을 넘을 수 있다(여유 생산·재고 생산 허용, 여유 사유 필수).
 *       수주 품목별 충당 수량(allocatedQty) 합계(취소 계획 제외)는 수주 수량을 넘을 수 없다(이중 배정 거부).
 *       생산 유형: ORDER(계획=충당) / ORDER_EXTRA(계획>충당, 사유 필수) / STOCK(수주 연결 없음, 충당 0).
 * 선행: seed-o2s.ts(품목·BOM·라우팅·검사표준·POP 작업자). 신규 DB 제약(CHECK·트리거)도 직접 확인한다.
 */
import { test, expect } from "@playwright/test"
import { assertSafeE2eEnvironment, adminCredentials, developerCredentials } from "./guard"
import { apiLogin } from "./support/perm-lib"
import { loadData, logDetail, db, closeDb, num, call, findAction, warm, rid, iso, addDays, counts, diffCounts, stockOf, sumOnHand } from "./support/o2s-lib"

assertSafeE2eEnvironment()
const D = loadData()
const T = D.tenantId
let admin = ""
const A = (n: string, re: RegExp) => findAction(n, re)
const note = (id: string, o: Record<string, unknown>) => logDetail({ id, ...o })
const ok = (r: { ok: boolean; value: any }) => r.ok && r.value?.ok !== false && r.value?.success !== false
const errOf = (r: { value: any; error: string | null }) => String(r.value?.error ?? r.error ?? "")
const RUN = Date.now().toString(36).toUpperCase()
let seq = 0

test.beforeAll(async () => {
  const a = adminCredentials(), d = developerCredentials()
  admin = (await apiLogin(a.loginId, a.password)).cookie ?? ""
  const dev = (await apiLogin(d.loginId, d.password)).cookie ?? ""
  await warm(dev, ["/app/mes/sales-orders", "/app/mes/production-plan", "/app/mes/mrp", "/app/mes/material-issue", "/app/mes/work-orders", "/app/mes/inspection-stages", "/app/mes/final-inspection", "/app/mes/finished-goods-receipt", "/app/mes/shipments", "/pop/work-select", "/login"])
})
test.afterAll(async () => { await closeDb() })

async function mkSo(qty: number, status: "CONFIRMED" | "DRAFT" = "CONFIRMED") {
  const r = await call(admin, A("createSalesOrder", /sales-order\.actions/), [T, D.site.id, { customerId: D.customer.id, orderDate: iso(new Date()), deliveryDate: iso(addDays(10)), status, items: [{ itemId: D.items.fg.id, qty, unitPrice: 1, deliveryDate: iso(addDays(10)) }] }])
  expect(r.ok, r.error ?? "").toBe(true)
  const so = await db().salesOrder.findFirstOrThrow({ where: { tenantId: T }, orderBy: { createdAt: "desc" }, include: { items: true } })
  return { id: so.id, no: so.orderNo, itemId: so.items[0].id }
}
type So = Awaited<ReturnType<typeof mkSo>>
type Over = { extraQty?: number | null; extraReason?: string | null }
const request = (so: So, qty: number, over: Over = {}, requestId: string | null = rid("pr")) =>
  call(admin, A("requestProductionFromSalesOrder", /sales-order\.actions/), [so.id, [{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty, ...over }], T, D.site.id, ...(requestId ? [requestId] : [])])

/** DB 오라클: 수주 품목에 연결된 계획 줄 */
async function rowsOf(soItemId: string) {
  const rows = await db().productionPlanItem.findMany({ where: { salesOrderItemId: soItemId }, include: { plan: { select: { id: true, status: true, planNo: true } } }, orderBy: { plan: { createdAt: "asc" } } })
  const active = rows.filter((r) => r.plan.status !== "CANCELLED")
  const f = (r: (typeof rows)[number]) => ({ id: r.id, planId: r.planId, planNo: r.plan.planNo, planStatus: r.plan.status, planned: num(r.plannedQty), alloc: num(r.allocatedQty), kind: r.productionKind, reason: r.extraReason, approval: r.extraApprovalStatus })
  return { rows: rows.map(f), active: active.map(f), activeAlloc: active.reduce((s, r) => s + num(r.allocatedQty), 0), activePlanned: active.reduce((s, r) => s + num(r.plannedQty), 0) }
}
const rowByPlanNo = async (planNo: string) => db().productionPlanItem.findFirstOrThrow({ where: { plan: { planNo, tenantId: T } }, include: { plan: true } })

async function updatePlan(rowId: string, over: { plannedQty: number; allocatedQty?: number | null; extraReason?: string | null; status?: "DRAFT" | "CONFIRMED" }) {
  const row = await db().productionPlanItem.findUniqueOrThrow({ where: { id: rowId }, include: { plan: true } })
  const item: Record<string, unknown> = { productionPlanItemId: row.id, itemId: row.itemId, bomId: row.bomId ?? D.bom.id, routingId: row.routingId ?? D.routing.id, plannedQty: over.plannedQty }
  if (row.salesOrderItemId) item.salesOrderItemId = row.salesOrderItemId
  if (over.allocatedQty !== undefined) item.allocatedQty = over.allocatedQty
  if (over.extraReason !== undefined) item.extraReason = over.extraReason
  return call(admin, A("updatePlan", /production-plan\.actions/), [row.planId, { siteId: row.plan.siteId, planNo: row.plan.planNo, planType: row.plan.planType, startDate: "2026-11-02", endDate: "2026-11-30", status: over.status ?? (row.plan.status === "CONFIRMED" ? "CONFIRMED" : "DRAFT"), note: row.plan.note, items: [item] }])
}

async function createStockPlan(qty: number, extra: Record<string, unknown> = {}) {
  const r = await call(admin, A("createPlan", /production-plan\.actions/), [{ siteId: D.site.id, planNo: "", planType: "DAILY", startDate: "2026-11-02", endDate: "2026-11-30", status: "DRAFT", note: `E2E-N19 stock ${RUN}-${++seq}`, items: [{ itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, plannedQty: qty, ...extra }] }, T])
  return r
}
const latestPlanRow = async () => db().productionPlanItem.findFirstOrThrow({ where: { plan: { tenantId: T, note: { contains: `E2E-N19 stock ${RUN}-${seq}` } } }, include: { plan: true } })

// ───────────────────────── DB 제약 ─────────────────────────
test("[N19-00] DB 제약 — ORDER 줄의 계획 수량만 올리는 UPDATE·사유 없는 ORDER_EXTRA·연결 없는 ORDER_EXTRA 충당 초과는 DB 가 거부, 연결 줄 INSERT 기본값(트리거)", async () => {
  const so = await mkSo(100)
  const q = await request(so, 100)
  expect(ok(q), errOf(q)).toBe(true)
  const row = (await rowsOf(so.itemId)).rows[0]
  const bad = async (sql: string) => { try { await db().$executeRawUnsafe(sql); return "허용" } catch (e) { return /ProductionPlanItem_allocation_check/.test(String(e)) ? "CHECK 거부" : `기타 오류: ${String(e).slice(0, 120)}` } }
  expect(await bad(`update "ProductionPlanItem" set "plannedQty"=150 where id='${row.id}'`), "ORDER 줄의 계획 수량만 증가(N-19 우회)").toBe("CHECK 거부")
  expect(await bad(`update "ProductionPlanItem" set "plannedQty"=150, "productionKind"='ORDER_EXTRA' where id='${row.id}'`), "사유 없는 ORDER_EXTRA").toBe("CHECK 거부")
  expect(await bad(`update "ProductionPlanItem" set "allocatedQty"=120 where id='${row.id}'`), "충당 > 계획").toBe("CHECK 거부")
  expect(await bad(`update "ProductionPlanItem" set "productionKind"='STOCK', "allocatedQty"=0 where id='${row.id}'`), "수주 연결 줄을 STOCK 으로").toBe("CHECK 거부")
  expect((await rowsOf(so.itemId)).rows[0], "거부된 변경은 값을 바꾸지 않음").toMatchObject({ planned: 100, alloc: 100, kind: "ORDER" })
  // 이전 코드 호환: 유형·충당 없이 연결 줄을 INSERT 하면 트리거가 ORDER / 충당=계획 으로 채운다
  const plan = await db().productionPlan.findFirstOrThrow({ where: { id: row.planId } })
  const p2 = await db().productionPlan.create({ data: { tenantId: T, siteId: D.site.id, planNo: `E2E-N19-LEG-${RUN}`, planType: "DAILY", startDate: new Date(), endDate: new Date(), status: "CANCELLED" } })
  await db().$executeRawUnsafe(`insert into "ProductionPlanItem"(id,"planId","itemId","plannedQty","salesOrderItemId") values ('e2e-n19-leg-${RUN}','${p2.id}','${D.items.fg.id}',33,'${so.itemId}')`)
  const leg = await db().productionPlanItem.findUniqueOrThrow({ where: { id: `e2e-n19-leg-${RUN}` } })
  note("N19-00", { legacyInsert: [leg.productionKind, num(leg.plannedQty), num(leg.allocatedQty)], plan: plan.planNo })
  expect([leg.productionKind, num(leg.plannedQty), num(leg.allocatedQty)]).toEqual(["ORDER", 33, 33])
  await db().productionPlanItem.delete({ where: { id: leg.id } }); await db().productionPlan.delete({ where: { id: p2.id } })
})

// ───────────────────────── 시나리오 1~5 ─────────────────────────
test("[N19-01][시나리오1] 수주 100 → 정상 생산 100: ORDER, 계획=충당=100, 사유·승인 없음", async () => {
  const so = await mkSo(100)
  const r = await request(so, 100)
  expect(ok(r), errOf(r)).toBe(true)
  const o = await rowsOf(so.itemId)
  expect(o.rows).toHaveLength(1)
  expect(o.rows[0]).toMatchObject({ planned: 100, alloc: 100, kind: "ORDER", reason: null, approval: "NOT_REQUIRED", planStatus: "DRAFT" })
  expect((await db().salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("IN_PRODUCTION")
})

test("[N19-02][시나리오2] 수주 100 → 충당 100 + 여유 10(사유): 계획 110 정상 허용, 사유 누락·잘못된 여유 수량은 거부(DB 불변)", async () => {
  const so = await mkSo(100)
  const before = await counts()
  const noReason = await request(so, 100, { extraQty: 10 })
  const blankReason = await request(so, 100, { extraQty: 10, extraReason: "   " })
  const negative = await request(so, 100, { extraQty: -1, extraReason: "x" })
  const tooPrecise = await request(so, 100, { extraQty: 0.1234567, extraReason: "x" })
  const tooLong = await request(so, 100, { extraQty: 10, extraReason: "가".repeat(501) })
  note("N19-02", { noReason: errOf(noReason), negative: errOf(negative) })
  for (const [name, r] of [["사유 없음", noReason], ["공백 사유", blankReason], ["음수 여유", negative], ["소수 7자리", tooPrecise], ["사유 501자", tooLong]] as const) expect(ok(r), `${name} 요청이 허용됨`).toBe(false)
  expect(errOf(noReason), "사유 필수 안내").toMatch(/여유 생산 사유/)
  expect(diffCounts(before, await counts()), "거부된 요청은 DB 불변").toEqual([])
  const r = await request(so, 100, { extraQty: 10, extraReason: "불량 대비 여유 생산(과거 불량률 8%)" })
  expect(ok(r), errOf(r)).toBe(true)
  const o = await rowsOf(so.itemId)
  expect(o.rows).toHaveLength(1)
  expect(o.rows[0]).toMatchObject({ planned: 110, alloc: 100, kind: "ORDER_EXTRA", reason: "불량 대비 여유 생산(과거 불량률 8%)", approval: "NOT_REQUIRED" })
  expect([o.activeAlloc, o.activePlanned], "충당 100(=수주), 계획 110").toEqual([100, 110])
  // SalesOrderItem.producedQty(생산실적 컬럼)는 충당 수량으로 재사용하지 않는다
  expect(num((await db().salesOrderItem.findUniqueOrThrow({ where: { id: so.itemId } })).producedQty), "producedQty 불변").toBe(0)
  // 감사로그에 충당/계획 합계와 여유 사유가 남는다
  const log = await db().auditLog.findFirst({ where: { tenantId: T, entityType: "ProductionPlan", action: "CREATE", entityId: o.rows[0].planId } })
  expect(JSON.stringify(log?.afterData ?? {})).toMatch(/불량 대비 여유 생산/)
})

test("[N19-03][시나리오3] 수주 100 → 이미 100 충당 후 추가 충당 50 거부(중복 배정), 충당 잔량 0 에서는 충당 1 + 여유도 거부", async () => {
  const so = await mkSo(100)
  expect(ok(await request(so, 100, { extraQty: 10, extraReason: "여유" }))).toBe(true)
  const before = await counts()
  const dup = await request(so, 50)
  const dupWithExtra = await request(so, 1, { extraQty: 10, extraReason: "여유" })
  note("N19-03", { dup: errOf(dup) })
  expect(ok(dup), "이미 충당된 수주 수량의 중복 배정").toBe(false)
  expect(errOf(dup)).toMatch(/수주 수량 100.*이미 의뢰 100.*가능 잔량 0.*요청 50/)
  expect(ok(dupWithExtra), "여유를 붙여도 충당 초과는 거부").toBe(false)
  expect(diffCounts(before, await counts())).toEqual([])
  const o = await rowsOf(so.itemId)
  expect([o.active.length, o.activeAlloc, o.activePlanned], "계획 1건·충당 100·계획 110 유지").toEqual([1, 100, 110])
})

test("[N19-04][시나리오4] 동일 수주의 복수 생산계획: 40 + 60(+여유 5) = 충당 100 / 계획 105, 합계 초과 요청 거부", async () => {
  const so = await mkSo(100)
  expect(ok(await request(so, 40))).toBe(true)
  expect(ok(await request(so, 60, { extraQty: 5, extraReason: "치공구 손실 보전" }))).toBe(true)
  let o = await rowsOf(so.itemId)
  expect(o.active.map((r) => [r.planned, r.alloc, r.kind]).sort()).toEqual([[40, 40, "ORDER"], [65, 60, "ORDER_EXTRA"]].sort())
  expect([new Set(o.active.map((r) => r.planId)).size, o.activeAlloc, o.activePlanned]).toEqual([2, 100, 105])
  const more = await request(so, 1)
  expect(ok(more), "충당 합계(100) 초과 1").toBe(false)
  o = await rowsOf(so.itemId)
  expect([o.activeAlloc, o.activePlanned], "거부 후 불변").toEqual([100, 105])
})

test("[N19-05][시나리오5] 수주 없는 재고 생산 200: STOCK, 충당 0, 수주 영향 없음 — 수주 연결·충당 지정은 거부", async () => {
  const so = await mkSo(100)
  const before = await counts()
  const withAlloc = await createStockPlan(200, { allocatedQty: 10 })
  const withLink = await createStockPlan(200, { salesOrderItemId: so.itemId })
  const zero = await createStockPlan(0)
  const neg = await createStockPlan(-5)
  const fine7 = await createStockPlan(0.1234567)
  note("N19-05", { withAlloc: errOf(withAlloc), withLink: errOf(withLink), zero: errOf(zero) })
  for (const [name, r] of [["충당 수량 지정", withAlloc], ["수주 연결 지정", withLink], ["수량 0", zero], ["음수", neg], ["소수 7자리", fine7]] as const) expect(ok(r), `${name} 이 허용됨`).toBe(false)
  expect(diffCounts(before, await counts()), "거부된 요청은 DB 불변").toEqual([])
  const r = await createStockPlan(200)
  expect(ok(r), errOf(r)).toBe(true)
  const row = await latestPlanRow()
  expect([row.productionKind, num(row.plannedQty), num(row.allocatedQty), row.salesOrderItemId, row.extraReason, row.extraApprovalStatus]).toEqual(["STOCK", 200, 0, null, null, "NOT_REQUIRED"])
  expect((await rowsOf(so.itemId)).rows, "수주 품목 충당 불변").toHaveLength(0)
  expect((await db().salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status, "수주 상태 불변").toBe("CONFIRMED")
})

// ───────────────────────── 시나리오 6~7: 수정 경로 ─────────────────────────
test("[N19-06][시나리오6] 계획수량 증가·감소(updatePlan): 사유 없는 증가 거부 → 사유와 함께 증가 → 감소 시 유형·사유 자동 정리, 재고 생산은 자유 수정", async () => {
  const so = await mkSo(100)
  expect(ok(await request(so, 100))).toBe(true)
  const row0 = (await rowsOf(so.itemId)).rows[0]
  const before = await counts()
  const noReason = await updatePlan(row0.id, { plannedQty: 110 })
  note("N19-06", { noReason: errOf(noReason) })
  expect(ok(noReason), "사유 없이 수주 충당보다 많은 계획 수량").toBe(false)
  expect(errOf(noReason)).toMatch(/여유 생산 사유/)
  const zero = await updatePlan(row0.id, { plannedQty: 0 }), neg = await updatePlan(row0.id, { plannedQty: -1 }), frac = await updatePlan(row0.id, { plannedQty: 100.1234567 })
  for (const [n, r] of [["0", zero], ["음수", neg], ["소수 7자리", frac]] as const) expect(ok(r), `계획 수량 ${n}`).toBe(false)
  expect(diffCounts(before, await counts())).toEqual([])
  expect((await rowsOf(so.itemId)).rows[0]).toMatchObject({ planned: 100, alloc: 100, kind: "ORDER" })

  const up = await updatePlan(row0.id, { plannedQty: 110, extraReason: "후공정 불량 대비" })
  expect(ok(up), errOf(up)).toBe(true)
  expect((await rowsOf(so.itemId)).rows[0], "110 허용(수주 수량 초과 자체는 거부 사유가 아님)").toMatchObject({ planned: 110, alloc: 100, kind: "ORDER_EXTRA", reason: "후공정 불량 대비" })
  const up2 = await updatePlan(row0.id, { plannedQty: 130 })
  expect(ok(up2), `사유 유지한 추가 증가: ${errOf(up2)}`).toBe(true)
  expect((await rowsOf(so.itemId)).rows[0], "충당은 100 그대로, 사유 유지").toMatchObject({ planned: 130, alloc: 100, kind: "ORDER_EXTRA", reason: "후공정 불량 대비" })

  const down = await updatePlan(row0.id, { plannedQty: 105 })
  expect(ok(down), errOf(down)).toBe(true)
  expect((await rowsOf(so.itemId)).rows[0]).toMatchObject({ planned: 105, alloc: 100, kind: "ORDER_EXTRA" })
  const back = await updatePlan(row0.id, { plannedQty: 100 })
  expect(ok(back), errOf(back)).toBe(true)
  expect((await rowsOf(so.itemId)).rows[0], "여유가 없어지면 ORDER, 사유·승인 초기화").toMatchObject({ planned: 100, alloc: 100, kind: "ORDER", reason: null, approval: "NOT_REQUIRED" })
  const shrink = await updatePlan(row0.id, { plannedQty: 80 })
  expect(ok(shrink), errOf(shrink)).toBe(true)
  expect((await rowsOf(so.itemId)).rows[0], "충당 수량 지정 없이 계획이 충당보다 작아지면 충당도 함께 줄어 ORDER 유지").toMatchObject({ planned: 80, alloc: 80, kind: "ORDER" })
  const rest = await request(so, 20)
  expect(ok(rest), `줄어든 충당 20 은 다시 의뢰 가능: ${errOf(rest)}`).toBe(true)
  expect((await rowsOf(so.itemId)).activeAlloc).toBe(100)

  // 재고 생산: 자유 수정
  const st = await createStockPlan(200); expect(ok(st), errOf(st)).toBe(true)
  const sr = await latestPlanRow()
  for (const q of [300, 50, 1000]) { const r = await updatePlan(sr.id, { plannedQty: q }); expect(ok(r), errOf(r)).toBe(true); expect(num((await db().productionPlanItem.findUniqueOrThrow({ where: { id: sr.id } })).plannedQty)).toBe(q) }
  const stk = await db().productionPlanItem.findUniqueOrThrow({ where: { id: sr.id } })
  expect([stk.productionKind, num(stk.allocatedQty)]).toEqual(["STOCK", 0])
})

test("[N19-07][시나리오7] 수주 충당 수량 변경: 다른 계획이 가져간 수량 중복 배정 거부, 충당↓ 후 다른 계획 충당↑ 허용, 충당>계획·재고생산 충당 지정 거부", async () => {
  const so = await mkSo(100)
  expect(ok(await request(so, 60))).toBe(true)
  expect(ok(await request(so, 40))).toBe(true)
  const [a, b] = (await rowsOf(so.itemId)).rows
  expect([a.alloc, b.alloc]).toEqual([60, 40])
  const before = await counts()
  const dup = await updatePlan(a.id, { plannedQty: 70, allocatedQty: 70 })
  note("N19-07", { dup: errOf(dup) })
  expect(ok(dup), "A 의 충당을 70 으로(다른 계획 40 포함 110)").toBe(false)
  expect(errOf(dup)).toMatch(/수주 충당 수량 초과.*수주 수량 100.*다른 계획이 이미 충당 40.*충당 가능 60.*요청 충당 70/)
  const explicit = await updatePlan(a.id, { plannedQty: 70, allocatedQty: 61, extraReason: "x" })
  expect(ok(explicit), "명시한 충당 61 도 합계 101 이라 거부").toBe(false)
  const over = await updatePlan(a.id, { plannedQty: 60, allocatedQty: 65, extraReason: "x" })
  expect(ok(over), "충당 > 계획 거부").toBe(false)
  const negAlloc = await updatePlan(a.id, { plannedQty: 60, allocatedQty: -1, extraReason: "x" })
  expect(ok(negAlloc), "음수 충당 거부").toBe(false)
  expect(diffCounts(before, await counts())).toEqual([])
  expect((await rowsOf(so.itemId)).activeAlloc).toBe(100)
  // A 의 충당을 50 으로 낮추되 계획 수량은 60 유지(차이 10 은 여유, 사유 필요)
  const needReason = await updatePlan(a.id, { plannedQty: 60, allocatedQty: 50 })
  expect(ok(needReason), "충당↓ 로 여유가 생기면 사유 필요").toBe(false)
  const lower = await updatePlan(a.id, { plannedQty: 60, allocatedQty: 50, extraReason: "충당 일부를 B 로 이전, 잔여는 재고 보충" })
  expect(ok(lower), errOf(lower)).toBe(true)
  expect((await rowsOf(so.itemId)).rows[0]).toMatchObject({ planned: 60, alloc: 50, kind: "ORDER_EXTRA" })
  const raiseB = await updatePlan(b.id, { plannedQty: 50, allocatedQty: 50 })
  expect(ok(raiseB), `B 충당 40→50: ${errOf(raiseB)}`).toBe(true)
  const raiseB2 = await updatePlan(b.id, { plannedQty: 51, allocatedQty: 51 })
  expect(ok(raiseB2), "B 충당 51 은 합계 101 이라 거부").toBe(false)
  const o = await rowsOf(so.itemId)
  expect([o.activeAlloc, o.activePlanned, o.rows.map((r) => r.alloc)], "충당 합계 100, 계획 합계 110").toEqual([100, 110, [50, 50]])
  const stock = await createStockPlan(80); expect(ok(stock), errOf(stock)).toBe(true)
  const sr = await latestPlanRow()
  const sAlloc = await updatePlan(sr.id, { plannedQty: 80, allocatedQty: 10 })
  expect(ok(sAlloc), "재고 생산 계획에 충당 지정 거부").toBe(false)
})

// ───────────────────────── 시나리오 8: 동시성 ─────────────────────────
test("[N19-08][시나리오8] 동시 생산의뢰·생산계획 수정: 충당 합계 불변식 유지 — (a) 충당 70 의뢰 2건 + 충당 70 수정 1건 중 1건만 성공, (b) 같은 요청 ID 10건은 1건, (c) 여유 포함 의뢰 10건 동시", async () => {
  let updateWins = 0, requestWins = 0
  for (let round = 0; round < 8; round++) {
    const so = await mkSo(100)
    expect(ok(await request(so, 30))).toBe(true)
    const base = (await rowsOf(so.itemId)).rows[0]
    const rs = await Promise.all([request(so, 70), request(so, 70), updatePlan(base.id, { plannedQty: 70, allocatedQty: 70 })])
    const okN = rs.filter((r) => ok(r)).length
    const o = await rowsOf(so.itemId)
    note("N19-08a", { round, ok: rs.map((r) => ok(r)), errors: rs.filter((r) => !ok(r)).map(errOf), alloc: o.activeAlloc, rows: o.active.map((r) => [r.planned, r.alloc, r.kind]) })
    expect(okN, `round ${round}: 70 을 배정할 수 있는 요청은 정확히 1건`).toBe(1)
    expect(o.activeAlloc, `round ${round}: 충당 합계 ≤ 수주 수량`).toBeLessThanOrEqual(100)
    // 수정이 먼저 반영되면 충당 70(요청 2건은 잔량 30 이라 거부), 요청이 먼저 반영되면 30+70=100(수정은 거부)
    const updateOk = ok(rs[2])
    if (updateOk) updateWins++; else requestWins++
    expect(o.activeAlloc, `round ${round}: 성공한 쪽에 맞는 충당 합계`).toBe(updateOk ? 70 : 100)
    expect(o.active.every((r) => (r.kind === "ORDER" ? r.planned === r.alloc : r.planned > r.alloc)), "유형·수량 일관").toBe(true)
  }
  note("N19-08a", { rounds: 8, updateWins, requestWins })
  // (b) 같은 요청 ID 10건(여유 포함)
  const so2 = await mkSo(100)
  const id = rid("par")
  const same = await Promise.all(Array.from({ length: 10 }, () => request(so2, 100, { extraQty: 10, extraReason: "동시 요청 점검" }, id)))
  const plans = await rowsOf(so2.itemId)
  note("N19-08b", { ok: same.filter(ok).length, replayed: same.filter((r) => r.value?.replayed).length, rows: plans.rows.length })
  expect(plans.rows, "같은 요청 ID 는 계획 1건").toHaveLength(1)
  expect(plans.rows[0]).toMatchObject({ planned: 110, alloc: 100, kind: "ORDER_EXTRA" })
  expect(same.every((r) => ok(r)), "재전송은 모두 성공(처음 결과)").toBe(true)
  // (c) 서로 다른 ID 10건, 각 충당 20 + 여유 5: 충당 100 → 5건만
  const so3 = await mkSo(100)
  const rs3 = await Promise.all(Array.from({ length: 10 }, () => request(so3, 20, { extraQty: 5, extraReason: "동시 여유" })))
  const o3 = await rowsOf(so3.itemId)
  note("N19-08c", { ok: rs3.filter(ok).length, alloc: o3.activeAlloc, planned: o3.activePlanned })
  expect(rs3.filter(ok).length, "충당 20 × 5건").toBe(5)
  expect([o3.activeAlloc, o3.activePlanned, o3.active.length]).toEqual([100, 125, 5])
})

// ───────────────────────── 시나리오 9: 취소 후 재의뢰 ─────────────────────────
test("[N19-09][시나리오9] 취소 후 재의뢰: 취소된 계획의 충당은 합계에서 빠져 재의뢰 가능, 취소 이력(유형·충당·사유)은 보존, 재의뢰 후 다시 중복은 거부", async () => {
  const so = await mkSo(100)
  const first = await request(so, 100, { extraQty: 10, extraReason: "1차 여유" })
  expect(ok(first), errOf(first)).toBe(true)
  const r0 = (await rowsOf(so.itemId)).rows[0]
  const cancel = await call(admin, A("cancelProductionPlan", /production-plan\.actions/), [r0.planId, "E2E-N19 취소 후 재의뢰"])
  expect(cancel.ok, cancel.error ?? "").toBe(true)
  let o = await rowsOf(so.itemId)
  expect([o.activeAlloc, o.rows.length]).toEqual([0, 1])
  expect(o.rows[0], "취소 이력 보존").toMatchObject({ planStatus: "CANCELLED", planned: 110, alloc: 100, kind: "ORDER_EXTRA", reason: "1차 여유" })
  const second = await request(so, 100, { extraQty: 20, extraReason: "2차 여유" })
  expect(ok(second), errOf(second)).toBe(true)
  o = await rowsOf(so.itemId)
  expect([o.rows.length, o.activeAlloc, o.activePlanned]).toEqual([2, 100, 120])
  const dup = await request(so, 100)
  expect(ok(dup), "재의뢰 후 중복 충당").toBe(false)
  expect((await rowsOf(so.itemId)).activeAlloc).toBe(100)
})

// ───────────────────────── 시나리오 10: MRP ─────────────────────────
test("[N19-10][시나리오10] 계획 기준 MRP 는 실제 계획 수량(여유 포함) 기준 — 110 → 원자재 220/330, 재고 생산 200 → 400/600, 충당 수량·수주 수량은 소요량에 영향 없음", async () => {
  const so = await mkSo(100)
  expect(ok(await request(so, 100, { extraQty: 10, extraReason: "MRP 점검" }))).toBe(true)
  const stock = await createStockPlan(200); expect(ok(stock), errOf(stock)).toBe(true)
  const order100 = await mkSo(100); expect(ok(await request(order100, 100))).toBe(true)
  const gross = async (planId: string) => {
    const r = await call(admin, A("runMRP", /mrp\.actions/), [planId], { pagePath: "/app/mes/mrp" })
    expect(r.ok, errOf(r)).toBe(true)
    return Object.fromEntries((r.value?.items ?? []).map((i: any) => [i.itemCode, i.grossRequirement]))
  }
  const extraRow = (await rowsOf(so.itemId)).rows[0]
  const g110 = await gross(extraRow.planId)
  const g100 = await gross((await rowsOf(order100.itemId)).rows[0].planId)
  const gStock = await gross((await latestPlanRow()).planId)
  note("N19-10", { g110, g100, gStock })
  expect([g110[D.items.rm1.code], g110[D.items.rm2.code]], "계획 110").toEqual([220, 330])
  expect([g100[D.items.rm1.code], g100[D.items.rm2.code]], "계획 100").toEqual([200, 300])
  expect([gStock[D.items.rm1.code], gStock[D.items.rm2.code]], "재고 생산 200").toEqual([400, 600])
  // 충당 수량을 줄여도(계획 수량 유지) 소요량은 계획 수량 기준으로 유지된다
  const lower = await updatePlan(extraRow.id, { plannedQty: 110, allocatedQty: 90, extraReason: "충당 이전" })
  expect(ok(lower), errOf(lower)).toBe(true)
  const gAfter = await gross(extraRow.planId)
  expect([gAfter[D.items.rm1.code], gAfter[D.items.rm2.code]], "충당 90/계획 110 → 여전히 110 기준").toEqual([220, 330])
})

// ───────────────────────── 시나리오 11~12: 생산 → 재고 → 출하 ─────────────────────────
const WH_RAW = () => D.warehouses.raw.id
async function seedRawStock(tag: string, qty1: number, qty2: number) {
  const mk = async (item: { id: string }, qty: number, label: string) => {
    const lot = await db().lot.create({ data: { tenantId: T, itemId: item.id, lotNo: `E2E-N19-${RUN}-${tag}-${label}`, status: "ACTIVE" } })
    await db().inventoryBalance.create({ data: { tenantId: T, siteId: D.site.id, itemId: item.id, lotId: lot.id, warehouseId: WH_RAW(), qtyOnHand: qty, qtyAvailable: qty, qtyHold: 0 } })
    await db().inventoryTransaction.create({ data: { tenantId: T, itemId: item.id, lotId: lot.id, toLocationId: WH_RAW(), txNo: `E2E-N19-${RUN}-${tag}-${label}-RCV`, txType: "RECEIPT", qty, refType: "E2E_FIXTURE", refId: lot.lotNo } })
    return lot
  }
  return { l1: await mk(D.items.rm1, qty1, "R1"), l2: await mk(D.items.rm2, qty2, "R2") }
}

/** 계획 줄 → 확정 → 작업지시 → 릴리즈 → 자재 출고 → POP 실적(전량 양품) → 최종검사 → 완제품 입고(분할 없음) */
async function produce(rowId: string, qty: number, tag: string) {
  const row = await db().productionPlanItem.findUniqueOrThrow({ where: { id: rowId }, include: { plan: true } })
  const conf = await updatePlan(rowId, { plannedQty: num(row.plannedQty), status: "CONFIRMED" })
  expect(ok(conf), `계획 확정: ${errOf(conf)}`).toBe(true)
  const MFG = `E2E-N19-${RUN}-${tag}`
  const woRes = await call(admin, A("createWorkOrder", /work-order\.actions/), [{
    siteId: D.site.id, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, orderNo: "", manufacturingNo: MFG, plannedQty: qty, status: "DRAFT", dueDate: iso(addDays(14)), productionPlanItemId: rowId,
    operations: [
      { routingOperationId: D.routing.ops[0], seq: 1, plannedQty: qty, equipmentId: D.equipments.eq1.id, assignments: [{ equipmentId: D.equipments.eq1.id, assignedQty: qty }] },
      { routingOperationId: D.routing.ops[1], seq: 2, plannedQty: qty },
    ],
  }, T])
  expect(woRes.value?.success, `작업지시 생성: ${errOf(woRes)}`).toBe(true)
  const wo = await db().workOrder.findFirstOrThrow({ where: { tenantId: T, manufacturingNo: MFG }, include: { operations: { orderBy: { seq: "asc" }, include: { assignments: true } } } })
  expect((await call(admin, A("releaseWorkOrder", /work-order\.actions/), [wo.id])).ok).toBe(true)
  const raw = await seedRawStock(tag, qty * 2, qty * 3)
  const iss = await call(admin, A("issueMaterialsForWorkOrder", /material-issue\.actions/), [{ workOrderId: wo.id, siteId: D.site.id, items: [
    { itemId: D.items.rm1.id, lots: [{ lotId: raw.l1.id, warehouseId: WH_RAW(), quantity: qty * 2 }], issueQty: qty * 2, requiredQty: qty * 2, reservationId: null },
    { itemId: D.items.rm2.id, lots: [{ lotId: raw.l2.id, warehouseId: WH_RAW(), quantity: qty * 3 }], issueQty: qty * 3, requiredQty: qty * 3, reservationId: null },
  ] }, T])
  expect(iss.value?.ok, `자재 출고: ${errOf(iss)}`).toBe(true)
  const pop = await call(null, A("popLogin", /pop\.actions/), [D.worker.pin, T])
  const m = /nmes-pop-worker-session=([^;]+)/.exec(pop.setCookie)
  expect(m, "POP 로그인").toBeTruthy()
  const pc = `nmes-pop-worker-session=${m![1]}`
  const [op1, op2] = wo.operations
  const pp1 = { pagePath: `/pop/production/${op1.id}` }, pp2 = { pagePath: `/pop/production/${op2.id}` }
  expect((await call(pc, A("startOperation", /pop\.actions/), [op1.id, op1.assignments[0].id], pp1)).value?.success).toBe(true)
  const s1 = await call(pc, A("submitProductionResult", /pop\.actions/), [{ workOrderOperationId: op1.id, assignmentId: op1.assignments[0].id, goodQty: qty, defectQty: 0, reworkQty: 0 }], pp1)
  expect(s1.value?.success, `1공정 실적: ${s1.value?.error}`).toBe(true)
  expect((await call(pc, A("startOperation", /pop\.actions/), [op2.id, null], pp2)).value?.success).toBe(true)
  const s2 = await call(pc, A("submitProductionResult", /pop\.actions/), [{ workOrderOperationId: op2.id, goodQty: qty, defectQty: 0, reworkQty: 0 }], pp2)
  expect(s2.value?.success, `2공정 실적: ${s2.value?.error}`).toBe(true)
  await new Promise((r) => setTimeout(r, 1100))
  const ins = A("createStagedInspection", /inspection-stages\.actions/)
  for (const stage of ["FIRST", "MID"] as const) expect((await call(admin, ins, [{ workOrderOperationId: op1.id, inspectionSpecId: D.specs.op1, stage, result: "PASS", inspectedQty: 5 }])).ok).toBe(true)
  expect((await call(admin, ins, [{ workOrderOperationId: op2.id, inspectionSpecId: D.specs.op2, stage: "FINAL", result: "PASS", inspectedQty: qty }])).ok).toBe(true)
  const rcv = await call(admin, A("createFinishedGoodsReceiptAction", /finished-goods\.actions/), [{ workOrderId: wo.id, itemId: D.items.fg.id, siteId: D.site.id, warehouseId: D.warehouses.fg.id, receiptQty: qty }])
  expect(rcv.value?.ok, `완제품 입고: ${rcv.value?.error}`).toBe(true)
  return { woId: wo.id, lotNo: rcv.value.lotNo as string, mfg: MFG }
}
/** 원장(RECEIPT − ISSUE) 합 = 잔고, 음수 없음 */
async function ledgerMatchesBalance(itemId: string) {
  const q = await db().$queryRawUnsafe<{ lotId: string; ledger: string; bal: string; avail: string }[]>(
    `select b."lotId", coalesce(sum(case when t."txType" in ('RECEIPT','RETURN') then t.qty when t."txType" in ('ISSUE','SCRAP','SUPPLIER_RETURN') then -t.qty else 0 end),0)::text ledger, b."qtyOnHand"::text bal, b."qtyAvailable"::text avail
     from "InventoryBalance" b left join "InventoryTransaction" t on t."tenantId"=b."tenantId" and t."itemId"=b."itemId" and t."lotId" is not distinct from b."lotId"
     where b."tenantId"='${T}' and b."itemId"='${itemId}' group by b.id, b."lotId", b."qtyOnHand", b."qtyAvailable"`)
  return q.filter((x) => Math.abs(Number(x.ledger) - Number(x.bal)) > 1e-9 || Number(x.bal) < 0 || Number(x.avail) < 0)
}

test("[N19-11][시나리오11] 여유 생산 후 완제품 재고 반영: 수주 100 + 여유 10 = 110 생산·입고 → 재고 110(원장 일치), 작업지시는 계획 수량(110)까지만, 계획 초과 작업지시 거부", async () => {
  const fgBefore = await sumOnHand(T, D.items.fg.id)
  const so = await mkSo(100)
  expect(ok(await request(so, 100, { extraQty: 10, extraReason: "불량 대비" }))).toBe(true)
  const row = (await rowsOf(so.itemId)).rows[0]
  // 계획 수량(110)을 넘는 작업지시는 거부 — 확정 후 확인
  const conf = await updatePlan(row.id, { plannedQty: 110, status: "CONFIRMED" })
  expect(ok(conf), errOf(conf)).toBe(true)
  const over = await call(admin, A("createWorkOrder", /work-order\.actions/), [{ siteId: D.site.id, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, orderNo: "", manufacturingNo: `E2E-N19-${RUN}-OVER`, plannedQty: 111, status: "DRAFT", dueDate: iso(addDays(14)), productionPlanItemId: row.id, operations: [{ routingOperationId: D.routing.ops[0], seq: 1, plannedQty: 111 }, { routingOperationId: D.routing.ops[1], seq: 2, plannedQty: 111 }] }, T])
  expect(over.value?.success, `계획 수량(110) 초과 작업지시 거부: ${errOf(over)}`).toBe(false)
  expect(await db().workOrder.count({ where: { productionPlanItemId: row.id } })).toBe(0)
  const p = await produce(row.id, 110, "X110")
  const receipts = await db().finishedGoodsReceipt.findMany({ where: { tenantId: T, workOrderId: p.woId }, include: { lot: true } })
  expect(receipts.map((r) => [num(r.receiptQty), r.lot?.lotNo])).toEqual([[110, p.lotNo]])
  expect((await sumOnHand(T, D.items.fg.id)) - fgBefore, "완제품 재고 +110").toBe(110)
  const bal = (await stockOf(T, D.items.fg.id)).find((b) => b.lotNo === p.lotNo)!
  expect([bal.onHand, bal.avail, bal.wh]).toEqual([110, 110, "WH-FG"])
  expect(await ledgerMatchesBalance(D.items.fg.id), "원장 합계 = 잔고").toEqual([])
  // 수주 충당(100)과 계획 수량(110)은 입고 후에도 그대로이고 SalesOrderItem.producedQty 는 건드리지 않는다
  expect((await rowsOf(so.itemId)).rows[0]).toMatchObject({ planned: 110, alloc: 100, kind: "ORDER_EXTRA" })
  expect(num((await db().salesOrderItem.findUniqueOrThrow({ where: { id: so.itemId } })).producedQty)).toBe(0)
  // 입고 후 추가 입고는 거부(전량 입고)
  const more = await call(admin, A("createFinishedGoodsReceiptAction", /finished-goods\.actions/), [{ workOrderId: p.woId, itemId: D.items.fg.id, siteId: D.site.id, warehouseId: D.warehouses.fg.id, receiptQty: 1 }])
  expect(more.value?.ok).toBe(false)
  // 수주 100 출하 → 재고 10 잔류
  const ship = await call(admin, A("createShipment", /shipment\.actions/), [T, { salesOrderId: so.id, plannedDate: iso(addDays(1)), warehouseId: D.warehouses.fg.id, items: [{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty: 100, lotId: (await db().lot.findFirstOrThrow({ where: { tenantId: T, lotNo: p.lotNo } })).id }] }])
  expect(ship.ok, ship.error ?? "").toBe(true)
  const sh = await db().shipmentOrder.findFirstOrThrow({ where: { tenantId: T, salesOrderId: so.id } })
  const cf = await call(admin, A("confirmShipment", /shipment\.actions/), [sh.id])
  expect(cf.ok, cf.error ?? "").toBe(true)
  expect((await sumOnHand(T, D.items.fg.id)) - fgBefore, "출하 후 잔류 재고 10").toBe(10)
  expect(num((await db().salesOrderItem.findUniqueOrThrow({ where: { id: so.itemId } })).shippedQty)).toBe(100)
  expect((await db().salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("SHIPPED")
  expect(await ledgerMatchesBalance(D.items.fg.id), "출하 후에도 원장 = 잔고").toEqual([])
  const rem = (await stockOf(T, D.items.fg.id)).find((b) => b.lotNo === p.lotNo)!
  expect([rem.onHand, rem.avail]).toEqual([10, 10])
  note("N19-11", { lotNo: p.lotNo, remaining: rem.onHand })
})

test("[N19-12][시나리오12] 재고 생산품의 출하 연결: 수주 없이 STOCK 60 생산·입고 → 새 수주 50 이 그 LOT 로 출하, 재고 10 잔류·원장 일치, 수주 연결 이력은 출하 품목으로만 남는다", async () => {
  const fgBefore = await sumOnHand(T, D.items.fg.id)
  const st = await createStockPlan(60); expect(ok(st), errOf(st)).toBe(true)
  const row = await latestPlanRow()
  const p = await produce(row.id, 60, "S60")
  expect((await sumOnHand(T, D.items.fg.id)) - fgBefore, "재고 생산 +60").toBe(60)
  const stk = await db().productionPlanItem.findUniqueOrThrow({ where: { id: row.id } })
  expect([stk.productionKind, num(stk.allocatedQty), stk.salesOrderItemId], "재고 생산 줄은 수주와 연결되지 않음").toEqual(["STOCK", 0, null])
  const so = await mkSo(50)
  expect((await rowsOf(so.itemId)).rows, "수주에는 생산계획이 없다(재고로 충족)").toHaveLength(0)
  const lot = await db().lot.findFirstOrThrow({ where: { tenantId: T, lotNo: p.lotNo } })
  const ship = await call(admin, A("createShipment", /shipment\.actions/), [T, { salesOrderId: so.id, plannedDate: iso(addDays(1)), warehouseId: D.warehouses.fg.id, items: [{ salesOrderItemId: so.itemId, itemId: D.items.fg.id, qty: 50, lotId: lot.id }] }])
  expect(ship.ok, ship.error ?? "").toBe(true)
  const sh = await db().shipmentOrder.findFirstOrThrow({ where: { tenantId: T, salesOrderId: so.id }, include: { items: true } })
  expect(sh.items.map((i) => [i.lotId, num(i.qty)])).toEqual([[lot.id, 50]])
  const cf = await call(admin, A("confirmShipment", /shipment\.actions/), [sh.id])
  expect(cf.ok, cf.error ?? "").toBe(true)
  const bal = (await stockOf(T, D.items.fg.id)).find((b) => b.lotNo === p.lotNo)!
  expect([bal.onHand, bal.avail]).toEqual([10, 10])
  expect((await sumOnHand(T, D.items.fg.id)) - fgBefore, "재고 +60 −50").toBe(10)
  const soi = await db().salesOrderItem.findUniqueOrThrow({ where: { id: so.itemId } })
  expect([num(soi.shippedQty), (await db().salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status]).toEqual([50, "SHIPPED"])
  expect(await ledgerMatchesBalance(D.items.fg.id), "원장 = 잔고").toEqual([])
  // 출하 이력 추적: 재고 생산 LOT → 출하 → 수주
  const tx = await db().inventoryTransaction.findMany({ where: { tenantId: T, lotId: lot.id }, orderBy: { txAt: "asc" } })
  expect(tx.map((t) => [t.txType, num(t.qty)]), "LOT 수불: 입고 60, 출하 50").toEqual([["RECEIPT", 60], ["ISSUE", 50]])
})
