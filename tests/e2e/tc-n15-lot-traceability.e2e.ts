/**
 * N-15 LOT 추적성(일반 'LOT/제조이력추적' 화면의 getLotLineageByNo) 검증 — 서버 액션 실호출 + DB 직접 대조, 로컬 테스트 DB 전용.
 * 연결 체인: 원자재 LOT → 자재출고(WorkOrderMaterialLot) → 작업지시 → 생산실적 → 재공품 → 완제품 LOT(입고) → 출하.
 * 원칙: 제조번호/LOT 번호 문자열이 비슷하다는 이유로 연결하지 않는다. 기대값은 셋업이 아는 수량과 DB 의 외래키 조인(독립 SQL)로 만든다.
 * 선행: seed-o2s.ts + seed-roles.ts(권한·타 테넌트 케이스). 수정 전에는 `traceability` 필드가 없어 실패하고, 수정 후 통과해야 한다.
 */
import { test, expect } from "@playwright/test"
import { assertSafeE2eEnvironment, adminCredentials, developerCredentials } from "./guard"
import { apiLogin, roleCreds, signToken } from "./support/perm-lib"
import { loadData, loadState, saveState, logDetail, db, closeDb, num, call, findAction, warm, rid, iso, addDays } from "./support/o2s-lib"
import type { Page } from "@playwright/test"

// 지원 파일 의존을 줄이기 위한 최소 UI 헬퍼(tc-helpers 는 모듈 로드 시 저장소 루트의 313TC 엑셀을 읽으므로 가져오지 않는다)
async function login(page: Page) {
  const { loginId, password } = adminCredentials()
  await page.goto("/login")
  await page.getByRole("button", { name: /시스템모드/ }).click()
  await page.locator("#loginId").fill(loginId)
  await page.locator("#password").fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/app/,{ timeout: 60_000 })
}
async function gotoMenu(page: Page, p: string) {
  await page.goto(p, { waitUntil: "domcontentloaded", timeout: 90_000 })
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {})
}

assertSafeE2eEnvironment()
const D = loadData()
const T = D.tenantId, T2 = "e2e-tenant-002"
const RAW = D.warehouses.raw.id
let admin = "", dev = "", pop = ""
const A = (n: string, re: RegExp) => findAction(n, re)
const note = (id: string, o: Record<string, unknown>) => logDetail({ id, ...o })
const P = { pagePath: "/app/mes/traceability" }
const TAG = Date.now().toString(36)

test.beforeAll(async () => {
  const a = adminCredentials(), d = developerCredentials()
  admin = (await apiLogin(a.loginId, a.password)).cookie ?? ""
  dev = (await apiLogin(d.loginId, d.password)).cookie ?? ""
  await warm(dev, ["/app/mes/traceability", "/app/mes/manufacturing-traceability", "/app/mes/inspection-stages", "/app/mes/finished-goods-receipt", "/app/mes/shipments", "/app/mes/sales-orders", "/app/mes/work-orders", "/app/mes/material-issue", "/pop/work-select", "/login"])
  const r = await call(null, A("popLogin", /pop\.actions/), [D.worker.pin, T])
  const m = /nmes-pop-worker-session=([^;]+)/.exec(r.setCookie)
  pop = m ? `nmes-pop-worker-session=${m[1]}` : ""
})
test.afterAll(async () => { await closeDb() })

// ───────── 체인 빌더(실제 서버 액션으로 데이터를 만든다) ─────────
async function seedLot(itemId: string, lotNo: string, qty: number) {
  const lot = await db().lot.create({ data: { tenantId: T, itemId, lotNo, status: "ACTIVE" } })
  await db().inventoryBalance.create({ data: { tenantId: T, siteId: D.site.id, itemId, warehouseId: RAW, lotId: lot.id, qtyOnHand: qty, qtyAvailable: qty, qtyHold: 0 } })
  await db().inventoryTransaction.create({ data: { tenantId: T, itemId, lotId: lot.id, toLocationId: RAW, txNo: `N15-RCV-${lotNo}`, txType: "RECEIPT", qty, refType: "PURCHASE_ORDER" } })
  return { id: lot.id, lotNo, qty }
}
type L = { id: string; lotNo: string; qty: number }
type Chain = { tag: string; woId: string; woNo: string; mfgNo: string; fgLots: { lotNo: string; lotId: string; qty: number }[]; soId?: string; soItemId?: string; shipments: { shipmentNo: string; lotNo: string; qty: number }[] }

async function mkWo(tag: string, qty: number) {
  const mfgNo = `E2E-OS-N15-${TAG}-${tag}`
  const r = await call(admin, A("createWorkOrder", /work-order\.actions/), [{ siteId: D.site.id, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, orderNo: "", manufacturingNo: mfgNo, plannedQty: qty, status: "DRAFT", dueDate: iso(addDays(10)), productionPlanItemId: null,
    operations: [{ routingOperationId: D.routing.ops[0], seq: 1, plannedQty: qty }, { routingOperationId: D.routing.ops[1], seq: 2, plannedQty: qty }] }, T])
  expect(r.value?.success, `작업지시: ${r.value?.error}`).toBe(true)
  const wo = await db().workOrder.findFirstOrThrow({ where: { tenantId: T, manufacturingNo: mfgNo }, include: { operations: { orderBy: { seq: "asc" } } } })
  expect((await call(admin, A("releaseWorkOrder", /work-order\.actions/), [wo.id])).ok).toBe(true)
  return { wo, mfgNo }
}
const issue = (woId: string, itemId: string, lots: { l: L; q: number }[]) =>
  call(admin, A("issueMaterialsForWorkOrder", /material-issue\.actions/), [{ workOrderId: woId, siteId: D.site.id, requestId: rid("n15"), items: [{ itemId, lots: lots.map((x) => ({ lotId: x.l.id, warehouseId: RAW, quantity: x.q })), issueQty: lots.reduce((s, x) => s + x.q, 0), requiredQty: 1, reservationId: null }] }, T])

/** qty 계획 · rm1/rm2 투입 LOT 분할 · 양품/불량 · 완제품 입고 분할(합 = 양품) */
async function produce(tag: string, p: { qty: number; rm1: { l: L; q: number }[]; rm2: { l: L; q: number }[]; good: number; defect: number; fgSplits: number[] }): Promise<Chain> {
  const { wo, mfgNo } = await mkWo(tag, p.qty)
  expect((await issue(wo.id, D.items.rm1.id, p.rm1)).value?.ok).toBe(true)
  expect((await issue(wo.id, D.items.rm2.id, p.rm2)).value?.ok).toBe(true)
  const [op1, op2] = wo.operations.map((o) => o.id)
  const sub = (op: string, good: number, defect: number) => call(pop, A("submitProductionResult", /pop\.actions/), [{ workOrderOperationId: op, goodQty: good, defectQty: defect, reworkQty: 0, ...(defect > 0 ? { defectDetails: [{ defectCodeId: D.defectCode.id, qty: defect }] } : {}) }], { pagePath: `/pop/production/${op}` })
  expect((await call(pop, A("startOperation", /pop\.actions/), [op1, null], { pagePath: `/pop/production/${op1}` })).value?.success).toBe(true)
  expect((await sub(op1, p.good, p.defect)).value?.success).toBe(true)
  expect((await call(pop, A("startOperation", /pop\.actions/), [op2, null], { pagePath: `/pop/production/${op2}` })).value?.success).toBe(true)
  expect((await sub(op2, p.good, 0)).value?.success).toBe(true)
  expect((await call(admin, A("createStagedInspection", /inspection-stages\.actions/), [{ workOrderOperationId: op2, inspectionSpecId: D.specs.op2, stage: "FINAL", result: "PASS", inspectedQty: p.good }])).ok).toBe(true)
  const fgLots: Chain["fgLots"] = []
  for (const q of p.fgSplits) {
    const r = await call(admin, A("createFinishedGoodsReceiptAction", /finished-goods\.actions/), [{ workOrderId: wo.id, itemId: D.items.fg.id, siteId: D.site.id, warehouseId: D.warehouses.fg.id, receiptQty: q }])
    expect(r.value?.ok, `완제품 입고 ${q}: ${r.value?.error}`).toBe(true)
    const lot = await db().lot.findFirstOrThrow({ where: { tenantId: T, lotNo: r.value.lotNo } })
    fgLots.push({ lotNo: lot.lotNo, lotId: lot.id, qty: q })
  }
  return { tag, woId: wo.id, woNo: wo.orderNo, mfgNo, fgLots, shipments: [] }
}
async function ship(c: Chain, lotIdx: number, qty: number) {
  if (!c.soId) {
    expect((await call(admin, A("createSalesOrder", /sales-order\.actions/), [T, D.site.id, { customerId: D.customer.id, orderDate: iso(new Date()), deliveryDate: iso(addDays(10)), status: "CONFIRMED", items: [{ itemId: D.items.fg.id, qty: 1000, unitPrice: 1, deliveryDate: iso(addDays(10)) }] }])).ok).toBe(true)
    const so = await db().salesOrder.findFirstOrThrow({ where: { tenantId: T }, orderBy: { createdAt: "desc" }, include: { items: true } })
    c.soId = so.id; c.soItemId = so.items[0].id
  }
  const lot = c.fgLots[lotIdx]
  expect((await call(admin, A("createShipment", /shipment\.actions/), [T, { salesOrderId: c.soId, plannedDate: iso(addDays(1)), warehouseId: D.warehouses.fg.id, items: [{ salesOrderItemId: c.soItemId, itemId: D.items.fg.id, qty, lotId: lot.lotId }] }])).ok).toBe(true)
  const sh = await db().shipmentOrder.findFirstOrThrow({ where: { tenantId: T, items: { some: { lotId: lot.lotId } } } })
  expect((await call(admin, A("confirmShipment", /shipment\.actions/), [sh.id])).ok).toBe(true)
  c.shipments.push({ shipmentNo: sh.shipmentNo, lotNo: lot.lotNo, qty })
}

// 체인 캐시(워커가 재시작돼도 이어지도록 상태 파일에 저장)
type World = { A: L; B: L; C: L; D: L; E: L; X1: L; X2: L; S1: Chain; S2: Chain; S3: Chain; S4: Chain; S5: Chain }
let world: World | null = null
async function getWorld(): Promise<World> {
  if (world) return world
  const saved = loadState().n15 as World | undefined
  if (saved && saved.S1) return (world = saved)
  const mk = (it: { id: string }, n: string, q: number) => seedLot(it.id, `N15-${TAG}-${n}`, q)
  const Al = await mk(D.items.rm1, "A", 35), Bl = await mk(D.items.rm1, "B", 15), Cl = await mk(D.items.rm2, "C", 60)
  const Dl = await mk(D.items.rm1, "D", 10), El = await mk(D.items.rm2, "E", 30), X1 = await mk(D.items.rm1, "X1", 10), X2 = await mk(D.items.rm2, "X2", 15)
  // S1: 20 계획 · 양품 18 + 불량 2 · 원자재1(A25+B15) 원자재2(C60) · 완제품 LOT 2개(12+6) · 1번 LOT 만 출하(부분 생산·분할 출하)
  const S1 = await produce("S1", { qty: 20, rm1: [{ l: Al, q: 25 }, { l: Bl, q: 15 }], rm2: [{ l: Cl, q: 60 }], good: 18, defect: 2, fgSplits: [12, 6] })
  await ship(S1, 0, 12)
  // S2: 10 계획 · 공유 LOT A 10 + D 10, E 30 · 완제품 LOT 1개 전량 출하
  const S2 = await produce("S2", { qty: 10, rm1: [{ l: Al, q: 10 }, { l: Dl, q: 10 }], rm2: [{ l: El, q: 30 }], good: 10, defect: 0, fgSplits: [10] })
  await ship(S2, 0, 10)
  // S3: 무관한 작업지시(디코이). 제조번호/LOT 번호가 S1 과 접두사로 비슷하게 시작한다
  const S3 = await produce("S1-01X", { qty: 5, rm1: [{ l: X1, q: 10 }], rm2: [{ l: X2, q: 15 }], good: 5, defect: 0, fgSplits: [5] })
  await ship(S3, 0, 5)
  // S4/S5: 반제품 체인 재현 — S5 의 완제품 LOT(반제품 역할)가 LotGenealogy(INPUT)로 S4 의 완제품 LOT 에 투입
  const R4a = await mk(D.items.rm1, "R4a", 8), R4b = await mk(D.items.rm2, "R4b", 12), R5a = await mk(D.items.rm1, "R5a", 6), R5b = await mk(D.items.rm2, "R5b", 9)
  const S5 = await produce("S5", { qty: 3, rm1: [{ l: R5a, q: 6 }], rm2: [{ l: R5b, q: 9 }], good: 3, defect: 0, fgSplits: [3] })
  const S4 = await produce("S4", { qty: 4, rm1: [{ l: R4a, q: 8 }], rm2: [{ l: R4b, q: 12 }], good: 4, defect: 0, fgSplits: [4] })
  await ship(S4, 0, 4)
  await db().lotGenealogy.create({ data: { parentLotId: S5.fgLots[0].lotId, childLotId: S4.fgLots[0].lotId, relationType: "INPUT", qty: 3 } })
  world = { A: Al, B: Bl, C: Cl, D: Dl, E: El, X1, X2, S1, S2, S3, S4, S5 }
  saveState({ n15: world, n15R: { R4a, R4b, R5a, R5b } })
  return world
}

const lineage = async (cookie: string | null, lotNo: string, tenant = T) => call(cookie, A("getLotLineageByNo", /lot-lineage\.actions/), [lotNo, tenant], P)
const trace = (r: { value: any }) => r.value?.traceability
const matMap = (rows: any[], depth?: number) => Object.fromEntries(rows.filter((x) => depth === undefined || x.depth === depth).map((x) => [x.lot.lotNo, num(x.qty)]))

/** 독립 오라클: FK 조인만으로 완제품 LOT 의 직접 투입 원자재 LOT(작업지시 단위)를 SQL 로 구한다 */
async function oracleInputs(fgLotId: string) {
  const rows = await db().$queryRawUnsafe<{ lotNo: string; qty: string }[]>(
    `select l."lotNo", sum(wml.qty)::text qty
     from "FinishedGoodsReceipt" r
     join "WorkOrderMaterialLot" wml on wml."workOrderId" = r."workOrderId" and wml."tenantId" = r."tenantId"
     join "InventoryTransaction" tx on tx.id = wml."inventoryTransactionId"
     join "Lot" l on l.id = tx."lotId"
     where r."lotId" = '${fgLotId}' and r."tenantId" = '${T}' group by l."lotNo"`)
  return Object.fromEntries(rows.map((r) => [r.lotNo, Number(r.qty)]))
}

// ───────── 테스트 ─────────
test("[N15-01] 완제품 LOT → 투입 원자재 LOT 역추적(복수 LOT·분할 입고) — DB 참조 관계 기준, 수량·품목 일치", async () => {
  const w = await getWorld()
  for (const fg of w.S1.fgLots) {
    const r = await lineage(admin, fg.lotNo)
    expect(r.ok, r.error ?? "").toBe(true)
    const t = trace(r)
    expect(t, "traceability 필드").toBeTruthy()
    const direct = matMap(t.inputMaterialLots, 0)
    expect(direct, `${fg.lotNo} 직접 투입 원자재 LOT(셋업이 아는 값)`).toEqual({ [w.A.lotNo]: 25, [w.B.lotNo]: 15, [w.C.lotNo]: 60 })
    expect(direct, "독립 SQL 오라클과 일치").toEqual(await oracleInputs(fg.lotId))
    expect(t.inputMaterialLots.every((x: any) => x.resolvedBy === "INVENTORY_TRANSACTION"), "투입 LOT 는 수불(inventoryTransactionId)의 lotId 참조로 확정").toBe(true)
    expect(t.inputMaterialLots.map((x: any) => [x.lot.lotNo, x.lot.item.code].join("|")).sort()).toEqual([`${w.A.lotNo}|${D.items.rm1.code}`, `${w.B.lotNo}|${D.items.rm1.code}`, `${w.C.lotNo}|${D.items.rm2.code}`].sort())
    expect(t.producedByWorkOrders.map((x: any) => x.id), "생산한 작업지시 = S1").toEqual([w.S1.woId])
  }
})

test("[N15-02] 디코이 분리 — 접두사가 비슷한 다른 작업지시(S1-01X)의 원자재·완제품은 S1 결과에 섞이지 않는다(번호 문자열 근접으로 연결 금지)", async () => {
  const w = await getWorld()
  const s3Lot = w.S3.fgLots[0].lotNo
  expect(s3Lot.startsWith(w.S1.fgLots[1].lotNo), "디코이 LOT 번호가 S1 2회차 LOT 번호로 시작").toBe(true)
  const r = await lineage(admin, w.S1.fgLots[1].lotNo)
  const t = trace(r)
  expect(Object.keys(matMap(t.inputMaterialLots)), "S1 결과에 디코이 원자재 없음").not.toContain(w.X1.lotNo)
  expect(Object.keys(matMap(t.inputMaterialLots))).not.toContain(w.X2.lotNo)
  const d = await lineage(admin, s3Lot)
  expect(matMap(trace(d).inputMaterialLots, 0), "디코이 자체 투입").toEqual({ [w.X1.lotNo]: 10, [w.X2.lotNo]: 15 })
  expect(JSON.stringify(trace(d).inputMaterialLots), "디코이 결과에 S1 원자재 없음").not.toContain(w.A.lotNo)
})

test("[N15-03] 원자재 LOT → 정추적: 투입 작업지시 · 생산 완제품 LOT(분할 입고 전부) · 출하(부분 출하는 출하된 LOT 만)", async () => {
  const w = await getWorld()
  const r = await lineage(admin, w.B.lotNo) // B 는 S1 에만 투입
  const t = trace(r)
  expect(t, "traceability 필드").toBeTruthy()
  expect(t.consumedInWorkOrders.map((x: any) => x.workOrder.id), "B 는 S1 에만 투입").toEqual([w.S1.woId])
  expect(num(t.consumedInWorkOrders[0].qty)).toBe(15)
  expect(t.producedLots.filter((x: any) => x.depth === 0).map((x: any) => [x.lot.lotNo, num(x.qty)]).sort(), "S1 의 완제품 LOT 2개 모두(입고 수량 포함)").toEqual(w.S1.fgLots.map((f) => [f.lotNo, f.qty]).sort())
  const ships = t.downstreamShipments.map((s: any) => [s.lotNo, s.shipmentNo, num(s.qty)])
  expect(ships, "출하는 1번 LOT 만(2번 LOT 는 미출하)").toEqual([[w.S1.shipments[0].lotNo, w.S1.shipments[0].shipmentNo, 12]])
  expect(t.downstreamShipments[0].customer?.code, "출하 → 고객").toBe(D.customer.code)
  expect(JSON.stringify(t), "디코이(S3) 비노출").not.toContain(w.S3.fgLots[0].lotNo)
})

test("[N15-04] 여러 작업지시에 나뉘어 투입된 공유 원자재 LOT — 정추적은 두 작업지시와 각 완제품 LOT·출하, 역추적은 각 작업지시별 투입 수량(25/10)", async () => {
  const w = await getWorld()
  const fwd = trace(await lineage(admin, w.A.lotNo))
  expect(fwd.consumedInWorkOrders.map((x: any) => [x.workOrder.id, num(x.qty)]).sort()).toEqual([[w.S1.woId, 25], [w.S2.woId, 10]].sort())
  expect(fwd.producedLots.filter((x: any) => x.depth === 0).map((x: any) => x.lot.lotNo).sort()).toEqual([...w.S1.fgLots.map((f) => f.lotNo), ...w.S2.fgLots.map((f) => f.lotNo)].sort())
  expect(fwd.downstreamShipments.map((s: any) => s.shipmentNo).sort(), "출하 = S1 1건 + S2 1건").toEqual([w.S1.shipments[0].shipmentNo, w.S2.shipments[0].shipmentNo].sort())
  const b1 = trace(await lineage(admin, w.S1.fgLots[0].lotNo)), b2 = trace(await lineage(admin, w.S2.fgLots[0].lotNo))
  expect(matMap(b1.inputMaterialLots, 0)[w.A.lotNo], "S1 의 A 투입").toBe(25)
  expect(matMap(b2.inputMaterialLots, 0), "S2 직접 투입").toEqual({ [w.A.lotNo]: 10, [w.D.lotNo]: 10, [w.E.lotNo]: 30 })
  expect(num(w.A.qty), "A 입고 35 = 25 + 10").toBe(35)
})

test("[N15-05] 불량·재작업 이력 — 불량 폐기 재공은 완제품 LOT 를 만들지 않고, 작업지시 요약에 불량 수량이 표시된다", async () => {
  const w = await getWorld()
  const t = trace(await lineage(admin, w.S1.fgLots[0].lotNo))
  const sum = t.workOrderSummaries.find((x: any) => x.id === w.S1.woId)
  expect([num(sum.plannedQty), num(sum.goodQty), num(sum.defectQty)], "계획 20 / 양품 18 / 불량 2").toEqual([20, 18, 2])
  const scrapped = await db().wipUnit.findMany({ where: { tenantId: T, workOrderId: w.S1.woId, status: "SCRAPPED" } })
  expect(scrapped.reduce((s, x) => s + num(x.qty), 0), "DB: 폐기 재공 2").toBe(2)
  expect(scrapped.every((x) => x.lotId === null), "폐기 재공은 LOT 없음").toBe(true)
  const r = trace(await lineage(admin, w.A.lotNo))
  expect(r.producedLots.filter((x: any) => x.workOrder.id === w.S1.woId).reduce((s: number, x: any) => s + num(x.qty), 0), "산출 LOT 합계 = 입고 18(불량 2 미포함)").toBe(18)
})

test("[N15-06] 반제품 체인(LotGenealogy INPUT) — 역추적은 상위 작업지시의 원자재까지(depth 1), 정추적은 하위 완제품·출하까지", async () => {
  const w = await getWorld()
  const R = (loadState().n15R) as Record<string, L>
  const f4 = w.S4.fgLots[0], s5 = w.S5.fgLots[0]
  const back = trace(await lineage(admin, f4.lotNo))
  expect(matMap(back.inputMaterialLots, 0), "F4 직접 투입(S4 작업지시)").toEqual({ [R.R4a.lotNo]: 8, [R.R4b.lotNo]: 12 })
  expect(matMap(back.inputMaterialLots, 1), "반제품 S5 를 만든 작업지시의 원자재(depth 1)").toEqual({ [R.R5a.lotNo]: 6, [R.R5b.lotNo]: 9 })
  expect(back.inputMaterialLots.filter((x: any) => x.depth === 1).every((x: any) => x.viaLot?.lotNo === s5.lotNo), "경유 LOT = 반제품 LOT").toBe(true)
  const fwd = trace(await lineage(admin, R.R5a.lotNo))
  expect(fwd.producedLots.map((x: any) => [x.lot.lotNo, x.depth]).sort(), "R5a → S5(depth0) → F4(depth1)").toEqual([[s5.lotNo, 0], [f4.lotNo, 1]].sort())
  expect(fwd.downstreamShipments.map((s: any) => s.lotNo), "F4 의 출하까지 도달").toContain(f4.lotNo)
})

test("[N15-07] 순환 참조·중복 방지 — LotGenealogy 순환(S5↔F4)에서도 조회가 끝나고 같은 항목이 중복되지 않는다", async () => {
  const w = await getWorld()
  const f4 = w.S4.fgLots[0], s5 = w.S5.fgLots[0]
  const cyc = await db().lotGenealogy.create({ data: { parentLotId: f4.lotId, childLotId: s5.lotId, relationType: "INPUT", qty: 1 } })
  try {
    const t0 = Date.now()
    const r = await lineage(admin, f4.lotNo)
    expect(r.ok, r.error ?? "").toBe(true)
    expect(Date.now() - t0, "순환에서도 즉시 종료").toBeLessThan(10_000)
    const t = trace(r)
    const keys = t.inputMaterialLots.map((x: any) => `${x.lot.id}|${x.workOrder?.id}|${x.depth}`)
    expect(new Set(keys).size, "중복 행 없음").toBe(keys.length)
    const lots = t.inputMaterialLots.map((x: any) => x.lot.id)
    expect(lots).not.toContain(f4.lotId)
  } finally { await db().lotGenealogy.delete({ where: { id: cyc.id } }) }
})

test("[N15-08] 재작업 관계(LotGenealogy REWORK)도 상위 원자재까지 따라간다", async () => {
  const w = await getWorld()
  const R = (loadState().n15R) as Record<string, L>
  const f4 = w.S4.fgLots[0], s5 = w.S5.fgLots[0]
  await db().lotGenealogy.deleteMany({ where: { parentLotId: s5.lotId, childLotId: f4.lotId, relationType: "INPUT" } })
  const rw = await db().lotGenealogy.create({ data: { parentLotId: s5.lotId, childLotId: f4.lotId, relationType: "REWORK", qty: 3 } })
  try {
    const t = trace(await lineage(admin, f4.lotNo))
    const rows = t.inputMaterialLots.filter((x: any) => x.depth === 1)
    expect(matMap(rows), "재작업 원본(S5)의 원자재").toEqual({ [R.R5a.lotNo]: 6, [R.R5b.lotNo]: 9 })
    expect(rows.every((x: any) => x.relation === "WORK_ORDER_MATERIAL" || x.relation === "LOT_GENEALOGY_REWORK"), "관계 표기").toBe(true)
  } finally {
    await db().lotGenealogy.delete({ where: { id: rw.id } })
    await db().lotGenealogy.create({ data: { parentLotId: s5.lotId, childLotId: f4.lotId, relationType: "INPUT", qty: 3 } })
  }
})

test("[N15-09] LOT 번호 검색 — 정확히 일치하는 LOT 를 우선하고, 부분 일치만 있으면 후보 목록을 함께 준다", async () => {
  const w = await getWorld()
  const exact = await lineage(admin, w.S1.fgLots[1].lotNo)
  expect(exact.value?.lot?.lotNo, "정확 일치 LOT").toBe(w.S1.fgLots[1].lotNo)
  expect(exact.value?.lot?.item?.code).toBe(D.items.fg.code)
  const partial = await lineage(admin, w.S1.fgLots[1].lotNo.slice(0, -1)) // "…-S1-0" (S1 2회차와 디코이 둘 다 포함, 정확 일치 없음)
  note("N15-09", { partial: partial.value?.lot?.lotNo, candidates: (partial.value?.candidates ?? []).map((c: any) => c.lotNo) })
  expect((partial.value?.candidates ?? []).map((c: any) => c.lotNo).sort(), "부분 일치 후보에 S1 2회차와 디코이 LOT").toEqual([w.S1.fgLots[1].lotNo, w.S3.fgLots[0].lotNo].sort())
  const none = await lineage(admin, "N15-NO-SUCH-LOT-ZZZ")
  expect(none.value, "없는 LOT").toBeNull()
})

test("[N15-10] 대량 이력 성능 — 공유 원자재 LOT 1개가 작업지시 40건에 투입(원자재 LOT 200건): 조회 쿼리 수가 건수와 무관하게 일정하고 결과가 정확", async () => {
  const n = 40
  const fgLoc = await db().location.findFirstOrThrow({ where: { warehouseId: D.warehouses.fg.id } })
  const sh = await seedLot(D.items.rm1.id, `N15-${TAG}-PERF-SHARED`, 1000)
  await db().lot.createMany({ data: Array.from({ length: n * 5 }, (_, i) => ({ tenantId: T, itemId: D.items.rm2.id, lotNo: `N15-${TAG}-PERF-${i}`, status: "ACTIVE" as const })) })
  await db().lot.createMany({ data: Array.from({ length: n }, (_, k) => ({ tenantId: T, itemId: D.items.fg.id, lotNo: `N15-${TAG}-PERF-FG-${k}`, status: "ACTIVE" as const })) })
  const lots = await db().lot.findMany({ where: { tenantId: T, lotNo: { startsWith: `N15-${TAG}-PERF-` } } })
  const byNo = new Map(lots.map((l) => [l.lotNo, l.id]))
  await db().workOrder.createMany({ data: Array.from({ length: n }, (_, k) => ({ tenantId: T, siteId: D.site.id, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, orderNo: `N15-${TAG}-PW-${k}`, manufacturingNo: `N15-${TAG}-PM-${k}`, plannedQty: 1, status: "COMPLETED" as const })) })
  const wos = await db().workOrder.findMany({ where: { tenantId: T, orderNo: { startsWith: `N15-${TAG}-PW-` } }, orderBy: { orderNo: "asc" } })
  const txRows: any[] = [], wmlRows: any[] = []
  const tag = (s: string) => `N15-${TAG}-${s}`
  wos.forEach((wo, k) => {
    const k5 = Array.from({ length: 4 }, (_, j) => byNo.get(`N15-${TAG}-PERF-${k * 5 + j}`)!)
    const all = [{ id: sh.id, itemId: D.items.rm1.id, lotNo: sh.lotNo }, ...k5.map((id, j) => ({ id, itemId: D.items.rm2.id, lotNo: `N15-${TAG}-PERF-${k * 5 + j}` }))]
    all.forEach((m, j) => {
      const txId = `n15tx${TAG}${k}x${j}`
      txRows.push({ id: txId, tenantId: T, itemId: m.itemId, lotId: m.id, fromLocationId: RAW, txNo: tag(`PTX-${k}-${j}`), txType: "ISSUE", qty: 1, refType: "WORK_ORDER", refId: wo.id })
      wmlRows.push({ tenantId: T, workOrderId: wo.id, manufacturingNo: wo.manufacturingNo, materialItemId: m.itemId, materialLotNo: m.lotNo, qty: 1, inventoryTransactionId: txId })
    })
  })
  await db().inventoryTransaction.createMany({ data: txRows })
  await db().workOrderMaterialLot.createMany({ data: wmlRows })
  await db().finishedGoodsReceipt.createMany({ data: wos.map((wo, k) => ({ tenantId: T, siteId: D.site.id, workOrderId: wo.id, itemId: D.items.fg.id, lotId: byNo.get(`N15-${TAG}-PERF-FG-${k}`)!, warehouseId: D.warehouses.fg.id, locationId: fgLoc.id, receiptQty: 1 })) })
  const t0 = Date.now()
  const r = await lineage(admin, sh.lotNo)
  const ms = Date.now() - t0
  const t = trace(r)
  note("N15-10", { ms, queryCount: t?.diagnostics?.queryCount, produced: t?.producedLots?.length })
  expect(t, "traceability 필드").toBeTruthy()
  expect(t.producedLots.filter((x: any) => x.depth === 0).length, "공유 LOT → 완제품 LOT 40개").toBe(n)
  expect(t.consumedInWorkOrders.length).toBe(n)
  expect(ms, "응답 시간(로컬, 첫 컴파일 제외)").toBeLessThan(8000)
  expect(t.diagnostics.queryCount, "조회 쿼리 수는 작업지시 수와 무관(레벨 단위 배치 조회)").toBeLessThanOrEqual(30)
  const back = trace(await lineage(admin, `N15-${TAG}-PERF-FG-7`))
  expect(back.inputMaterialLots.length, "작업지시 1건의 투입 LOT 5개").toBe(5)
  expect(matMap(back.inputMaterialLots)[sh.lotNo]).toBe(1)
})

test("[N15-11] 개발자 전용 제조이력(getManufacturingTraceability)과 일반 LOT 추적 화면의 원자재 LOT 결과 대조", async () => {
  const w = await getWorld()
  const man = await call(dev, A("getManufacturingTraceability", /manufacturing-traceability\.actions/), [w.S1.mfgNo, T], { pagePath: "/app/mes/manufacturing-traceability" })
  expect(man.ok, man.error ?? "").toBe(true)
  const devSet = Object.fromEntries((man.value.materialLots as any[]).map((m) => [m.lotNo, num(m.qty)]))
  const gen = matMap(trace(await lineage(admin, w.S1.fgLots[0].lotNo)).inputMaterialLots, 0)
  expect(gen, "일반 화면 = 개발자 화면(제조번호 기준) 투입 LOT").toEqual(devSet)
})

test("[N15-12] 테넌트·권한 — 같은 LOT 번호를 다른 테넌트가 가져도 섞이지 않고, 타 테넌트 ID·비로그인은 거부된다", async () => {
  const w = await getWorld()
  const t2 = roleCreds("T2OWNER")
  const cred = await db().userCredential.findUniqueOrThrow({ where: { tenantId_loginId: { tenantId: T2, loginId: t2.loginId } } })
  const prof = await db().profile.findUniqueOrThrow({ where: { id: cred.profileId } })
  const t2c = "nmes-session=" + signToken({ profileId: cred.profileId, tenantId: T2, loginId: cred.loginId, name: prof.name, role: "OWNER", email: prof.email })
  const t2item = await db().item.findFirstOrThrow({ where: { tenantId: T2, code: "E2E-T2-ITEM" } })
  const sameNo = w.S1.fgLots[0].lotNo
  await db().lot.create({ data: { tenantId: T2, itemId: t2item.id, lotNo: sameNo, status: "ACTIVE" } })
  const own = await lineage(t2c, sameNo, T2)
  expect(own.value?.lot?.item?.code, "T2 소유자는 T2 의 같은 번호 LOT").toBe("E2E-T2-ITEM")
  expect(JSON.stringify(own.value), "T2 결과에 T1 데이터 없음").not.toContain(w.A.lotNo)
  expect(trace(own).inputMaterialLots.length, "T2 LOT 는 투입 이력 없음").toBe(0)
  const mine = await lineage(admin, sameNo)
  expect(mine.value?.lot?.item?.code, "T1 은 T1 의 LOT").toBe(D.items.fg.code)
  expect(matMap(trace(mine).inputMaterialLots, 0)[w.A.lotNo], "T1 결과는 T1 투입 이력").toBe(25)
  const forged = await lineage(admin, sameNo, T2)
  expect(forged.ok && forged.value?.lot?.item?.code === "E2E-T2-ITEM", "T1 세션이 T2 tenantId 로 조회 → 거부").toBe(false)
  const anon = await lineage(null, sameNo)
  expect(anon.ok && !!anon.value?.lot, "비로그인 거부").toBe(false)
  // 권한이 있는 다른 역할(VIEWER)의 결과는 같은 데이터(읽기 권한 정책은 기존 그대로)
  const v = roleCreds("VIEWER")
  const vk = (await apiLogin(v.loginId, v.password)).cookie
  const vr = await lineage(vk, sameNo)
  note("N15-12", { viewer: vr.ok ? "허용" : vr.error })
  if (vr.ok && vr.value?.lot) expect(matMap(trace(vr).inputMaterialLots, 0)[w.A.lotNo], "VIEWER 도 같은 이력").toBe(25)
})

test("[N15-13] 화면(UI) — 완제품 LOT 검색은 투입 원자재 LOT·출하를, 원자재 LOT 검색은 투입 작업지시·완제품 LOT·출하를 보여 준다", async ({ page }) => {
  const w = await getWorld()
  await login(page)
  await gotoMenu(page, "/app/mes/traceability")
  const input = page.getByPlaceholder("LOT 번호 입력")
  const search = async (q: string) => { await input.fill(q); await input.press("Enter"); await page.waitForTimeout(2500); return page.locator("body").innerText() }
  const fg = await search(w.S1.fgLots[0].lotNo)
  for (const l of [w.A, w.B, w.C]) expect(fg.includes(l.lotNo), `완제품 LOT 화면에 원자재 LOT ${l.lotNo}`).toBe(true)
  expect(fg.includes(w.S1.shipments[0].shipmentNo), "출하번호").toBe(true)
  expect(fg.includes(w.X1.lotNo) || fg.includes(w.D.lotNo), "무관한 LOT 비노출").toBe(false)
  const rm = await search(w.A.lotNo)
  for (const f of [...w.S1.fgLots, ...w.S2.fgLots]) expect(rm.includes(f.lotNo), `원자재 LOT 화면에 완제품 LOT ${f.lotNo}`).toBe(true)
  expect(rm.includes(w.S1.shipments[0].shipmentNo) && rm.includes(w.S2.shipments[0].shipmentNo), "출하번호 2건").toBe(true)
  expect(rm.includes(w.S3.fgLots[0].lotNo), "무관한 완제품 LOT 비노출").toBe(false)
})

test("[N15-14] 번호 우연 일치로 연결하지 않는다 — 제조번호 = 다른 LOT 번호여도 참조가 없으면 무연결, 수불 참조가 없는 레거시 투입 행만 (테넌트·품목·LOT 번호)로 보완하고 표시한다", async ({ page }) => {
  const fgLoc = await db().location.findFirstOrThrow({ where: { warehouseId: D.warehouses.fg.id } })
  const mkWoRow = (orderNo: string, mfg: string) => db().workOrder.create({ data: { tenantId: T, siteId: D.site.id, itemId: D.items.fg.id, bomId: D.bom.id, routingId: D.routing.id, orderNo, manufacturingNo: mfg, plannedQty: 1, status: "COMPLETED" } })
  // (a) 제조번호 문자열 = 원자재 LOT 번호, 하지만 투입 참조가 없다
  const q = await seedLot(D.items.rm1.id, `N15-${TAG}-COINC`, 5)
  const woA = await mkWoRow(`N15-${TAG}-WOA`, q.lotNo)
  const fgA = await db().lot.create({ data: { tenantId: T, itemId: D.items.fg.id, lotNo: `N15-${TAG}-COINC-FG`, status: "ACTIVE" } })
  await db().finishedGoodsReceipt.create({ data: { tenantId: T, siteId: D.site.id, workOrderId: woA.id, itemId: D.items.fg.id, lotId: fgA.id, warehouseId: D.warehouses.fg.id, locationId: fgLoc.id, receiptQty: 1 } })
  const tq = trace(await lineage(admin, q.lotNo))
  expect(tq.consumedInWorkOrders, "제조번호가 같아도 투입 참조가 없으면 연결 안 됨").toEqual([])
  expect(tq.producedLots).toEqual([])
  const tf = trace(await lineage(admin, fgA.lotNo))
  expect(tf.inputMaterialLots, "완제품 LOT 에 원자재 연결 없음").toEqual([])
  expect(tf.producedByWorkOrders.map((x: any) => x.id), "생산 작업지시는 입고 참조로 확인").toEqual([woA.id])
  // (b) 수불 거래·재공 연결 참조가 없는 레거시 투입 행: (테넌트, 품목, LOT 번호)로 보완하며 resolvedBy 로 표시
  const r = await seedLot(D.items.rm1.id, `N15-${TAG}-LEGACY`, 5)
  const woB = await mkWoRow(`N15-${TAG}-WOB`, `N15-${TAG}-MFG-B`)
  const fgB = await db().lot.create({ data: { tenantId: T, itemId: D.items.fg.id, lotNo: `N15-${TAG}-LEGACY-FG`, status: "ACTIVE" } })
  await db().finishedGoodsReceipt.create({ data: { tenantId: T, siteId: D.site.id, workOrderId: woB.id, itemId: D.items.fg.id, lotId: fgB.id, warehouseId: D.warehouses.fg.id, locationId: fgLoc.id, receiptQty: 1 } })
  await db().workOrderMaterialLot.create({ data: { tenantId: T, workOrderId: woB.id, manufacturingNo: woB.manufacturingNo, materialItemId: D.items.rm1.id, materialLotNo: r.lotNo, qty: 2 } })
  const tb = trace(await lineage(admin, fgB.lotNo))
  expect(tb.inputMaterialLots.map((x: any) => [x.lot.lotNo, num(x.qty), x.resolvedBy])).toEqual([[r.lotNo, 2, "LOT_NO_FALLBACK"]])
  // 화면: 근거가 과거 데이터 보완인지 DB 참조인지 구분해 표시한다
  await login(page)
  await gotoMenu(page, "/app/mes/traceability")
  const input = page.getByPlaceholder("LOT 번호 입력")
  await input.fill(fgB.lotNo); await input.press("Enter"); await page.waitForTimeout(2500)
  expect(await page.locator("body").innerText(), "레거시 보완 행은 '과거 데이터 보완' 으로 표시").toContain("과거 데이터 보완")
  const w = await getWorld()
  await input.fill(w.S1.fgLots[0].lotNo); await input.press("Enter"); await page.waitForTimeout(2500)
  const body = await page.locator("body").innerText()
  expect(body, "수불 참조로 확정된 행은 'DB 참조 확정'").toContain("DB 참조 확정")
  expect(body.includes("과거 데이터 보완"), "정상 이력에는 보완 표시 없음").toBe(false)
  // 같은 번호라도 다른 품목이면 보완하지 않는다
  await db().workOrderMaterialLot.updateMany({ where: { workOrderId: woB.id }, data: { materialItemId: D.items.rm2.id } })
  expect(trace(await lineage(admin, fgB.lotNo)).inputMaterialLots, "품목이 다르면 같은 LOT 번호라도 연결 안 됨").toEqual([])
})
