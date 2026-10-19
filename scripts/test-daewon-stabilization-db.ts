/**
 * 대원정밀 MES 1차 안정화 — 실제 PostgreSQL 통합 검증 (로컬 테스트 DB 전용)
 *
 * 실행 조건 (모두 만족하지 않으면 즉시 중단 — 운영 DB 보호):
 *   - DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB
 *   - DATABASE_URL 이 127.0.0.1/localhost 의 `*_test` 데이터베이스일 것
 *
 * 서버 액션을 그대로 호출하되 인증/캐시만 대체한다 (next/cache, @/lib/auth, @/lib/auth/role-permissions).
 * 테스트 데이터는 테스트마다 새 테넌트에 만들고, 이 스크립트는 테스트 DB 이외에는 아무 곳도 쓰지 않는다.
 */
import { join } from "node:path"
import { writeFileSync } from "node:fs"
import Module from "node:module"
import { AsyncLocalStorage } from "node:async_hooks"

// ── 0. 안전 가드 ──────────────────────────────────────────────────────────────
function guard() {
  const url = process.env.DATABASE_URL ?? ""
  const m = url.match(/^postgres(?:ql)?:\/\/[^@]*@([^:/]+):(\d+)\/([^?]+)/)
  if (process.env.DAEWON_TEST_DB_CONFIRM !== "YES_LOCAL_TEST_DB" || !m || !["127.0.0.1", "localhost"].includes(m[1]) || !/_test$/.test(m[3])) {
    console.error("ABORT: 로컬 테스트 DB(127.0.0.1/localhost 의 *_test)가 확인되지 않아 실행하지 않습니다.")
    process.exit(2)
  }
  console.log(`target DB = ${m[1]}:${m[2]}/${m[3]}`)
}
guard()
process.env.PRISMA_CONNECTION_LIMIT = process.env.PRISMA_CONNECTION_LIMIT ?? "30"
process.env.PRISMA_POOL_TIMEOUT = process.env.PRISMA_POOL_TIMEOUT ?? "60"

// ── 1. 모듈 대체 (인증·캐시) ───────────────────────────────────────────────────
const state = { tenantId: "", revalidateFails: false, revalidateCalls: 0 }
const ModuleInternals = Module as unknown as {
  _resolveFilename: (request: string, ...rest: unknown[]) => string
  _load: (request: string, ...rest: unknown[]) => unknown
}
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}
const originalLoad = ModuleInternals._load
const testProfile = { id: "" }
// 호출별 테넌트 컨텍스트(서로 다른 tenant 의 동시 호출이 전역 상태를 공유하지 않도록)
const als = new AsyncLocalStorage<{ tenantId: string }>()
const activeTenant = () => als.getStore()?.tenantId ?? state.tenantId
const currentUser = () => ({ id: testProfile.id, profileId: testProfile.id, tenantId: activeTenant(), role: "OWNER", name: "DB Test", email: "db-test@example.invalid" })
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/cache") {
    return {
      revalidatePath: () => {
        state.revalidateCalls += 1
        if (state.revalidateFails) throw new Error("Invariant: static generation store missing")
      },
      revalidateTag: () => {},
    }
  }
  if (request === "@/lib/auth") {
    return new Proxy(
      { getTenantId: async () => activeTenant(), requireRole: async () => currentUser(), getCurrentUser: async () => currentUser() },
      { get: (t: Record<string, unknown>, p: string) => t[p] ?? (() => { throw new Error(`unexpected @/lib/auth.${String(p)}`) }) }
    )
  }
  if (request === "@/lib/auth/role-permissions") {
    return { requireResourcePermission: async () => {}, ROLE_PERMISSION_DENIED_MESSAGE: "이 기능을 사용할 권한이 없습니다." }
  }
  return originalLoad.call(this, request, ...rest)
}

/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma } = require("../src/lib/db/prisma") as typeof import("../src/lib/db/prisma")
const { Prisma } = require("@prisma/client") as typeof import("@prisma/client")
const po = require("../src/lib/actions/purchase-order.actions") as typeof import("../src/lib/actions/purchase-order.actions")
const rcv = require("../src/lib/actions/receiving.actions") as typeof import("../src/lib/actions/receiving.actions")
const wo = require("../src/lib/actions/work-order.actions") as typeof import("../src/lib/actions/work-order.actions")
const issue = require("../src/lib/actions/material-issue.actions") as typeof import("../src/lib/actions/material-issue.actions")
const ids = require("../src/lib/receiving-request-id") as typeof import("../src/lib/receiving-request-id")
const numbering = require("../src/lib/services/purchase-order-number.service") as typeof import("../src/lib/services/purchase-order-number.service")

// ── 2. 결과 기록 ──────────────────────────────────────────────────────────────
type Row = { id: string; title: string; status: "PASS" | "FAIL"; detail: string }
const rows: Row[] = []
function record(id: string, title: string, pass: boolean, detail: string) {
  rows.push({ id, title, status: pass ? "PASS" : "FAIL", detail })
  console.log(`${pass ? "PASS" : "FAIL"} [${id}] ${title} — ${detail}`)
}
const runId = `DBT${Date.now().toString(36)}`
let seq = 0
const uniq = (p: string) => `${runId}-${p}-${++seq}`
const D = (v: unknown) => Number(v)
const msgOf = (r: { success: boolean } & { message?: string }) => r.message ?? ""

async function mkCtx(label: string) {
  const tenant = await prisma.tenant.create({ data: { code: uniq(label), name: `${runId} ${label}` } })
  const site = await prisma.site.create({ data: { tenantId: tenant.id, code: "SITE", name: "Site" } })
  const warehouse = await prisma.warehouse.create({ data: { tenantId: tenant.id, siteId: site.id, code: "WH", name: "WH" } })
  const workCenter = await prisma.workCenter.create({ data: { siteId: site.id, code: "WC", name: "WC", kind: "ASSEMBLY" } })
  const supplier = await prisma.businessPartner.create({ data: { tenantId: tenant.id, code: "SUP", name: "Supplier", partnerType: "SUPPLIER" } })
  const mkItem = (code: string, itemType: "RAW_MATERIAL" | "FINISHED", isLotTracked: boolean) =>
    prisma.item.create({ data: { tenantId: tenant.id, code, name: code, itemType, isLotTracked, uom: "EA" } })
  const lotRaw = await mkItem("RAW-LOT", "RAW_MATERIAL", true)
  const plainRaw = await mkItem("RAW-PLAIN", "RAW_MATERIAL", false)
  const fg = await mkItem("FG", "FINISHED", true)
  const routing = await prisma.routing.create({ data: { tenantId: tenant.id, code: "RT", name: "RT", version: "1", status: "ACTIVE", scope: "COMMON" } })
  const routingOperation = await prisma.routingOperation.create({ data: { routingId: routing.id, seq: 10, operationCode: "CUT", name: "CUT", workCenterId: workCenter.id, standardTime: 1 } })
  const bom = await prisma.bOM.create({ data: { tenantId: tenant.id, itemId: fg.id, version: "1", status: "ACTIVE" } })
  await prisma.bOMItem.create({ data: { bomId: bom.id, componentItemId: lotRaw.id, seq: 10, qtyPer: 1, scrapRate: 0 } })
  return { tenant, site, warehouse, workCenter, supplier, lotRaw, plainRaw, fg, routing, routingOperation, bom, mkItem }
}
type Ctx = Awaited<ReturnType<typeof mkCtx>>
const use = (c: Ctx) => { state.tenantId = c.tenant.id }

async function newPO(c: Ctx, items: Array<{ itemId: string; qty: number }>) {
  use(c)
  const before = await prisma.purchaseOrder.count({ where: { tenantId: c.tenant.id } })
  const res = await po.createPurchaseOrder(c.tenant.id, c.site.id, {
    supplierId: c.supplier.id, orderDate: new Date(), expectedDate: new Date(), status: "ORDERED",
    items: items.map((i) => ({ itemId: i.itemId, qty: i.qty, unitPrice: 1 })),
  })
  if (!res.success) throw new Error("PO create failed: " + res.message)
  const order = await prisma.purchaseOrder.findFirstOrThrow({ where: { tenantId: c.tenant.id }, orderBy: { createdAt: "desc" }, include: { items: true } })
  void before
  return order
}
function receive(c: Ctx, order: { id: string }, item: { id: string }, p: { r: number; a: number; j: number; lotNo?: string; wh?: string; inspectorId?: string; requestId?: string }) {
  use(c)
  return als.run({ tenantId: c.tenant.id }, () => rcv.createReceivingInspection({
    purchaseOrderItemId: item.id, purchaseOrderId: order.id, warehouseId: p.wh ?? c.warehouse.id, siteId: c.site.id,
    receivedQty: p.r, acceptedQty: p.a, rejectedQty: p.j, result: "PASS", lotNo: p.lotNo, inspectorId: p.inspectorId,
    requestId: "requestId" in p ? (p.requestId as string) : ids.generateReceivingRequestId(),
  }))
}
const poItem = (id: string) => prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id } })
const stock = async (tenantId: string, itemId: string) => {
  const b = await prisma.inventoryBalance.findMany({ where: { tenantId, itemId } })
  return { rows: b.length, onHand: b.reduce((s, x) => s + D(x.qtyOnHand), 0), avail: b.reduce((s, x) => s + D(x.qtyAvailable), 0) }
}

async function main() {
  console.log(`runId=${runId}`)
  const profile = await prisma.profile.create({ data: { email: `${runId}@example.invalid`, name: "DB Test User" } })
  testProfile.id = profile.id
  // ══ T01 발주 등록 + 자동 채번 ═══════════════════════════════════════════════
  const A = await mkCtx("A")
  const order1 = await newPO(A, [{ itemId: A.lotRaw.id, qty: 100 }])
  record("T01", "발주 등록 및 자동 채번", /^PO-\d{4}-\d{6}$/.test(order1.orderNo) && order1.status === "ORDERED" && order1.items.length === 1, `orderNo=${order1.orderNo}`)

  // ══ T03 pg_advisory_xact_lock — 실제 PostgreSQL 에서 void 문제 재현/해결 ═══════
  {
    let legacyError = ""
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${"legacy-test"}))`)
      })
    } catch (e) { legacyError = e instanceof Error ? e.message : String(e) }
    let fixedOk = true
    try {
      await prisma.$transaction(async (tx) => { await numbering.pgAdvisoryXactLock(tx, "fixed-test") })
    } catch { fixedOk = false }
    record("T03a", "pg_advisory_xact_lock: 기존 $queryRaw 방식은 void 역직렬화 오류", /void/i.test(legacyError), legacyError.split("\n")[0].slice(0, 110) || "오류 없음(재현 안 됨)")
    record("T03b", "pg_advisory_xact_lock: 수정된 $executeRaw 방식은 정상 동작", fixedOk, fixedOk ? "정상" : "실패")
    // 잠금이 실제로 직렬화하는가: tx1 이 잠금을 쥔 동안 tx2 는 대기해야 한다
    let t2Acquired = 0
    const t0 = Date.now()
    const tx1 = prisma.$transaction(async (tx) => {
      await numbering.pgAdvisoryXactLock(tx, "serialize-test")
      await new Promise((r) => setTimeout(r, 800))
    })
    await new Promise((r) => setTimeout(r, 150))
    const tx2 = prisma.$transaction(async (tx) => {
      await numbering.pgAdvisoryXactLock(tx, "serialize-test")
      t2Acquired = Date.now() - t0
    })
    await Promise.all([tx1, tx2])
    record("T03c", "advisory lock 이 같은 키의 두 번째 트랜잭션을 실제로 대기시킴", t2Acquired >= 750, `tx2 획득 시각 ${t2Acquired}ms (tx1 보유 800ms)`)
  }

  // ══ T02 동시 발주 등록 번호 중복 방지 ════════════════════════════════════════
  {
    const B = await mkCtx("B")
    use(B)
    const N = 20
    const results = await Promise.all(Array.from({ length: N }, () =>
      po.createPurchaseOrder(B.tenant.id, B.site.id, { supplierId: B.supplier.id, orderDate: new Date(), expectedDate: new Date(), status: "ORDERED", items: [{ itemId: B.lotRaw.id, qty: 1, unitPrice: 1 }] })
    ))
    const nos = (await prisma.purchaseOrder.findMany({ where: { tenantId: B.tenant.id }, select: { orderNo: true } })).map((x) => x.orderNo).sort()
    const ok = results.filter((r) => r.success).length
    record("T02", `동시 발주 등록 ${N}건 번호 중복 방지`, ok === N && new Set(nos).size === N && nos[0].endsWith("000001") && nos[N - 1].endsWith(String(N).padStart(6, "0")),
      `성공 ${ok}/${N}, 고유 번호 ${new Set(nos).size}, 범위 ${nos[0]} ~ ${nos[nos.length - 1]}`)
    // 테넌트별 분리
    const C = await mkCtx("C")
    const oc = await newPO(C, [{ itemId: C.lotRaw.id, qty: 1 }])
    record("T02b", "발주번호는 테넌트별로 분리(다른 테넌트 첫 발주 = 000001)", oc.orderNo.endsWith("000001"), oc.orderNo)
  }

  // ══ T04 원자재 입고 + LOT 등록 + T05 합격수량만큼 재고 증가 ═══════════════════
  const it1 = order1.items[0]
  {
    const r = await receive(A, order1, it1, { r: 40, a: 40, j: 0, lotNo: "LOT-A1" })
    const lot = await prisma.lot.findFirst({ where: { tenantId: A.tenant.id, lotNo: "LOT-A1" } })
    const st = await stock(A.tenant.id, A.lotRaw.id)
    const bal = lot ? await prisma.inventoryBalance.findFirst({ where: { tenantId: A.tenant.id, itemId: A.lotRaw.id, lotId: lot.id } }) : null
    const tx = await prisma.inventoryTransaction.findMany({ where: { tenantId: A.tenant.id, itemId: A.lotRaw.id, txType: "RECEIPT" } })
    const pi = await poItem(it1.id)
    const poNow = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order1.id } })
    record("T04", "원자재 입고 + LOT 등록 (LOT-A1)", r.success && !!lot && lot.itemId === A.lotRaw.id && lot.status === "ACTIVE" && D(bal?.qtyOnHand) === 40 && tx.length === 1 && poNow.status === "PARTIAL_RECEIVED",
      `success=${r.success} lot=${lot?.lotNo} LOT재고=${D(bal?.qtyOnHand)} 수불=${tx.length}건 발주상태=${poNow.status}`)
    record("T05a", "합격수량만큼 재고 증가 (입고 40 → 재고 40, 누적 40)", st.onHand === 40 && D(pi.receivedQty) === 40, `재고=${st.onHand} 누적입고=${D(pi.receivedQty)}`)
  }

  // ══ T06 불합격수량 처리 ═════════════════════════════════════════════════════
  {
    const r = await receive(A, order1, it1, { r: 30, a: 25, j: 5, lotNo: "LOT-A1" })
    const st = await stock(A.tenant.id, A.lotRaw.id)
    const pi = await poItem(it1.id)
    const insp = await prisma.receivingInspection.findFirst({ where: { purchaseOrderItemId: it1.id, rejectedQty: { gt: 0 } } })
    record("T06a", "일부 불합격 입고: 재고·누적은 합격분(25)만 증가, 불합격 5 는 검사이력에 기록", r.success && st.onHand === 65 && D(pi.receivedQty) === 65 && D(insp?.rejectedQty) === 5 && D(insp?.receivedQty) === 30,
      `재고=${st.onHand} 누적=${D(pi.receivedQty)} 검사이력 입고/합격/불합격=${D(insp?.receivedQty)}/${D(insp?.acceptedQty)}/${D(insp?.rejectedQty)}`)
    const txBefore = await prisma.inventoryTransaction.count({ where: { tenantId: A.tenant.id } })
    const r2 = await receive(A, order1, it1, { r: 10, a: 0, j: 10, lotNo: "LOT-A1" })
    const st2 = await stock(A.tenant.id, A.lotRaw.id)
    const pi2 = await poItem(it1.id)
    const txAfter = await prisma.inventoryTransaction.count({ where: { tenantId: A.tenant.id } })
    record("T06b", "전량 불합격 입고: 재고·누적·수불 변화 없음, 검사이력만 기록", r2.success && st2.onHand === 65 && D(pi2.receivedQty) === 65 && txAfter === txBefore,
      `재고=${st2.onHand} 누적=${D(pi2.receivedQty)} 수불변화=${txAfter - txBefore}`)
  }

  // ══ T07 소수점 정밀도 / T08 잔여수량 초과 ═══════════════════════════════════
  {
    const P = await mkCtx("P")
    const o = await newPO(P, [{ itemId: P.plainRaw.id, qty: 100 }])
    const i = o.items[0]
    const snap = async () => ({ st: await stock(P.tenant.id, P.plainRaw.id), r: D((await poItem(i.id)).receivedQty), n: await prisma.receivingInspection.count({ where: { purchaseOrderItemId: i.id } }) })
    const s0 = await snap()
    const bad1 = await receive(P, o, i, { r: 100, a: 100.0005, j: 0 })
    const bad2 = await receive(P, o, i, { r: NaN, a: NaN, j: 0 })
    const bad3 = await receive(P, o, i, { r: Infinity, a: Infinity, j: 0 })
    const bad4 = await receive(P, o, i, { r: -5, a: -5, j: 0 })
    const bad5 = await receive(P, o, i, { r: 1.0000001, a: 1.0000001, j: 0 })
    const bad6 = await receive(P, o, i, { r: 10, a: 4, j: 5 })
    const s1 = await snap()
    record("T07a", "정밀도: 입고 100 · 합격 100.0005 / NaN / Infinity / 음수 / 7자리 / 합계불일치 모두 거부, DB 변화 없음",
      [bad1, bad2, bad3, bad4, bad5, bad6].every((x) => !x.success) && s0.r === s1.r && s0.n === s1.n && s0.st.onHand === s1.st.onHand,
      `거부 ${[bad1, bad2, bad3, bad4, bad5, bad6].filter((x) => !x.success).length}/6, 검사이력 ${s0.n}→${s1.n}, 재고 ${s0.st.onHand}→${s1.st.onHand}`)
    const g1 = await receive(P, o, i, { r: 99.8, a: 99.8, j: 0 })
    const f = 0.3 - 0.1
    const g2 = await receive(P, o, i, { r: f, a: f, j: 0 })
    const fin = await poItem(i.id)
    const poNow = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: o.id } })
    const stF = await stock(P.tenant.id, P.plainRaw.id)
    record("T07b", "정밀도: 잔량 0.2 에 0.3-0.1(0.19999999999999998) 입고 허용 → 누적 100, 발주 RECEIVED", g1.success && g2.success && D(fin.receivedQty) === 100 && poNow.status === "RECEIVED" && stF.onHand === 100,
      `입고 99.8→${g1.success} 0.19999999999999998→${g2.success} 누적=${D(fin.receivedQty)} 재고=${stF.onHand} 상태=${poNow.status}`)
    const over = await receive(P, o, i, { r: 0.000001, a: 0.000001, j: 0 })
    record("T08a", "잔여수량 0 에서 추가 입고 거부", !over.success && /잔여수량/.test(over.message ?? ""), over.message ?? "")
    const O2 = await newPO(P, [{ itemId: P.plainRaw.id, qty: 10 }])
    const o2i = O2.items[0]
    const ov = await receive(P, O2, o2i, { r: 10.000001, a: 10.000001, j: 0 })
    const okEdge = await receive(P, O2, o2i, { r: 10, a: 10, j: 0 })
    record("T08b", "경계: 10.000001 거부 / 정확히 10 허용", !ov.success && okEdge.success, `${ov.message ?? ""} | 10 → ${okEdge.success}`)
  }

  // ══ T09 동일 품목 동시 입고 ═════════════════════════════════════════════════
  {
    const E = await mkCtx("E")
    const o = await newPO(E, [{ itemId: E.plainRaw.id, qty: 100 }])
    const i = o.items[0]
    const res = await Promise.all(Array.from({ length: 6 }, () => receive(E, o, i, { r: 30, a: 30, j: 0 })))
    const okN = res.filter((r) => r.success).length
    const pi = await poItem(i.id)
    const st = await stock(E.tenant.id, E.plainRaw.id)
    record("T09a", "동일 품목 동시 입고 6건×30 (발주 100): 정확히 3건만 성공, 초과 입고 없음", okN === 3 && D(pi.receivedQty) === 90 && st.onHand === 90,
      `성공 ${okN}/6, 누적=${D(pi.receivedQty)}, 재고=${st.onHand}`)
    const E2 = await mkCtx("E2")
    const o2 = await newPO(E2, [{ itemId: E2.plainRaw.id, qty: 100 }])
    const res2 = await Promise.all(Array.from({ length: 10 }, () => receive(E2, o2, o2.items[0], { r: 10, a: 10, j: 0 })))
    const pi2 = await poItem(o2.items[0].id)
    const st2 = await stock(E2.tenant.id, E2.plainRaw.id)
    const po2 = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: o2.id } })
    record("T09b", "동일 품목 동시 입고 10건×10 (발주 100): 전부 성공, 누적 100 = 재고 100, RECEIVED", res2.every((r) => r.success) && D(pi2.receivedQty) === 100 && st2.onHand === 100 && po2.status === "RECEIVED",
      `성공 ${res2.filter((r) => r.success).length}/10, 누적=${D(pi2.receivedQty)}, 재고=${st2.onHand}, 상태=${po2.status}`)
  }

  // ══ T10 동일 요청 재전송 시 중복 입고 ═══════════════════════════════════════
  {
    const F = await mkCtx("F")
    const o = await newPO(F, [{ itemId: F.plainRaw.id, qty: 100 }])
    const i = o.items[0]
    const ridF = ids.generateReceivingRequestId()
    const a = await receive(F, o, i, { r: 40, a: 40, j: 0, requestId: ridF })
    const b = await receive(F, o, i, { r: 40, a: 40, j: 0, requestId: ridF }) // 완전히 같은 요청(같은 요청 ID) 재전송
    const stF = await stock(F.tenant.id, F.plainRaw.id)
    const n = await prisma.receivingInspection.count({ where: { purchaseOrderItemId: i.id } })
    record("T10a", "동일 요청(같은 요청 ID) 순차 재전송: 서버가 중복을 막는가 (멱등성)", a.success && b.success && stF.onHand === 40 && n === 1,
      `1차=${a.success} 2차=${b.success} → 재고 ${stF.onHand} (1회분 40 이어야 멱등), 검사이력 ${n}건`)
    const F2 = await mkCtx("F2")
    const o2 = await newPO(F2, [{ itemId: F2.plainRaw.id, qty: 100 }])
    const ridF2 = ids.generateReceivingRequestId()
    const same = await Promise.all([receive(F2, o2, o2.items[0], { r: 40, a: 40, j: 0, requestId: ridF2 }), receive(F2, o2, o2.items[0], { r: 40, a: 40, j: 0, requestId: ridF2 })])
    const stF2 = await stock(F2.tenant.id, F2.plainRaw.id)
    record("T10b", "동일 요청(같은 요청 ID) 동시 재전송(이중 클릭/이중 탭): 서버가 중복을 막는가", same.every((r) => r.success) && stF2.onHand === 40, `성공 ${same.filter((r) => r.success).length}/2 → 재고 ${stF2.onHand} (40 이어야 멱등)`)
  }

  // ══ T11 DB 트랜잭션 롤백 ════════════════════════════════════════════════════
  {
    const G = await mkCtx("G")
    const o = await newPO(G, [{ itemId: G.lotRaw.id, qty: 50 }, { itemId: G.plainRaw.id, qty: 50 }])
    const lotItem = o.items.find((x) => x.itemId === G.lotRaw.id)!
    const lotsBefore = await prisma.lot.count({ where: { tenantId: G.tenant.id } })
    // inspectorId 가 존재하지 않는 Profile 이면 검사이력 INSERT 에서 FK 위반 → 앞서 만든 Lot/재고/예약이 모두 롤백되어야 한다
    const r = await receive(G, o, lotItem, { r: 20, a: 20, j: 0, lotNo: "LOT-ROLLBACK", inspectorId: "no-such-profile" })
    const lotsAfter = await prisma.lot.count({ where: { tenantId: G.tenant.id } })
    const st = await stock(G.tenant.id, G.lotRaw.id)
    const piR = await poItem(lotItem.id)
    const insp = await prisma.receivingInspection.count({ where: { purchaseOrderItemId: lotItem.id } })
    record("T11a", "트랜잭션 롤백: FK 위반 시 Lot·재고·누적·검사이력 모두 미반영", !r.success && lotsAfter === lotsBefore && st.onHand === 0 && D(piR.receivedQty) === 0 && insp === 0,
      `success=${r.success} Lot ${lotsBefore}→${lotsAfter} 재고=${st.onHand} 누적=${D(piR.receivedQty)} 검사이력=${insp}`)
    record("T11b", "롤백 시 사용자 메시지에 DB 내부 정보 없음", !!r.message && !/prisma|foreign key|constraint|ReceivingInspection|invocation/i.test(r.message), `"${r.message}"`)
    // 다른 품목의 LOT 번호 재사용 → 거부 + 변화 없음
    await receive(G, o, lotItem, { r: 5, a: 5, j: 0, lotNo: "LOT-X1" })
    const other = o.items.find((x) => x.itemId === G.plainRaw.id)!
    await prisma.item.update({ where: { id: G.plainRaw.id }, data: { isLotTracked: true } })
    const before = await prisma.inventoryTransaction.count({ where: { tenantId: G.tenant.id } })
    const dup = await receive(G, o, other, { r: 5, a: 5, j: 0, lotNo: "LOT-X1" })
    const after = await prisma.inventoryTransaction.count({ where: { tenantId: G.tenant.id } })
    record("T11c", "다른 품목이 쓰는 LOT 번호 재사용 거부, 수불 변화 없음", !dup.success && /다른 품목/.test(dup.message ?? "") && before === after, `${dup.message ?? ""}`)
  }

  // ══ T12 커밋 후 후처리 오류 ═════════════════════════════════════════════════
  {
    const H = await mkCtx("H")
    const o = await newPO(H, [{ itemId: H.plainRaw.id, qty: 100 }])
    state.revalidateFails = true
    const r = await receive(H, o, o.items[0], { r: 25, a: 25, j: 0 })
    const stH = await stock(H.tenant.id, H.plainRaw.id)
    const n = await prisma.receivingInspection.count({ where: { purchaseOrderItemId: o.items[0].id } })
    record("T12a", "입고 커밋 후 revalidatePath 오류: 성공으로 반환, 입고는 정확히 1회 반영", r.success && stH.onHand === 25 && n === 1, `success=${r.success} 재고=${stH.onHand} 검사이력=${n}`)
    const pr = await po.createPurchaseOrder(H.tenant.id, H.site.id, { supplierId: H.supplier.id, orderDate: new Date(), expectedDate: new Date(), status: "ORDERED", items: [{ itemId: H.plainRaw.id, qty: 1, unitPrice: 1 }] })
    const poCount = await prisma.purchaseOrder.count({ where: { tenantId: H.tenant.id } })
    record("T12b", "발주 커밋 후 revalidatePath 오류: 성공 반환, 발주 1건 추가(총 2)", pr.success && poCount === 2, `success=${pr.success} 발주수=${poCount}`)
    state.revalidateFails = false
  }

  // ══ T13 비LOT 품목 최초 재고 생성 동시성 ═════════════════════════════════════
  async function firstStockRace(rounds: number, conc: number) {
    let dupRounds = 0, failed = 0, succeeded = 0, maxRows = 0, mismatch = 0
    const msgs = new Map<string, number>()
    for (let k = 0; k < rounds; k++) {
      const X = await mkCtx(`R${k}`)
      const orders = await Promise.all(Array.from({ length: conc }, () => newPO(X, [{ itemId: X.plainRaw.id, qty: 10 }]).catch(() => null)))
      const valid = orders.filter((o): o is NonNullable<typeof o> => !!o)
      const res = await Promise.all(valid.map((o) => receive(X, o, o.items[0], { r: 10, a: 10, j: 0 })))
      for (const r of res) {
        if (r.success) succeeded += 1
        else { failed += 1; const m = (r.message ?? "").slice(0, 30); msgs.set(m, (msgs.get(m) ?? 0) + 1) }
      }
      const rowsN = await prisma.inventoryBalance.count({ where: { tenantId: X.tenant.id, itemId: X.plainRaw.id, lotId: null } })
      const total = (await stock(X.tenant.id, X.plainRaw.id)).onHand
      maxRows = Math.max(maxRows, rowsN)
      if (rowsN > 1) dupRounds += 1
      if (total !== res.filter((r) => r.success).length * 10) mismatch += 1
    }
    return { dupRounds, failed, succeeded, maxRows, mismatch, msgs: Array.from(msgs.entries()).map(([m, n]) => `${n}×${m}`).join(" | ") }
  }
  {
    const base = await firstStockRace(20, 8)
    record("T13a", "비LOT 최초 재고 생성 동시성(앱 경로, baseline 마이그레이션): 재고 행 1개 유지 + 재고=성공 입고 합계", base.dupRounds === 0 && base.mismatch === 0,
      `20라운드×동시 8건 → 성공 ${base.succeeded}, 실패 ${base.failed}, 중복 행 라운드 ${base.dupRounds}, 합계 불일치 라운드 ${base.mismatch}, 최대 행수 ${base.maxRows}; 실패 사유: ${base.msgs || "없음"}`)
    // DB 수준 증명: 같은 (tenant,item,warehouse) lotId=NULL 행을 두 번 넣을 수 있는가
    const Y = await mkCtx("Y")
    const mk = () => prisma.inventoryBalance.create({ data: { tenantId: Y.tenant.id, siteId: Y.site.id, warehouseId: Y.warehouse.id, itemId: Y.plainRaw.id, lotId: null, qtyOnHand: 1, qtyAvailable: 1, qtyHold: 0 } })
    let second = "허용됨"
    await mk()
    try { await mk() } catch { second = "거부됨" }
    record("T13b", "DB 제약: 같은 (테넌트·품목·창고) lotId=NULL 재고 행을 두 번 만들 수 있는가", second === "거부됨", `두 번째 INSERT ${second} (거부되어야 비LOT 재고 행 유일성 보장)`)
    // 증명용으로 시도한 행 정리(인덱스가 있으므로 중복 행은 생기지 않았다 — 첫 INSERT 한 건만 삭제)
    await prisma.inventoryBalance.deleteMany({ where: { tenantId: Y.tenant.id } })
  }

  // ══ T14 작업지시 + 자재출고 / T15 LOT별 정합성 ══════════════════════════════
  {
    const W = await mkCtx("W")
    const o = await newPO(W, [{ itemId: W.lotRaw.id, qty: 100 }])
    const i = o.items[0]
    await receive(W, o, i, { r: 60, a: 60, j: 0, lotNo: "LOT-W1" })
    await receive(W, o, i, { r: 40, a: 40, j: 0, lotNo: "LOT-W2" })
    use(W)
    const woData = (no: string | null) => ({
      siteId: W.site.id, itemId: W.fg.id, bomId: W.bom.id, routingId: W.routing.id, orderNo: "", manufacturingNo: no,
      plannedQty: 100, status: "RELEASED" as const, dueDate: null,
      operations: [{ routingOperationId: W.routingOperation.id, seq: 10, plannedQty: 100 }],
    })
    const blank = await wo.createWorkOrder(woData(null), W.tenant.id)
    record("T14a", "작업지시: 제조번호 미입력 시 대원정밀 자동 채번 가드 안내(자동 생성 안 함)", !blank.success && /대원정밀 LOT 채번 규칙/.test(msgOf(blank as { success: boolean; message?: string })), msgOf(blank as { success: boolean; message?: string }))
    const w1 = await wo.createWorkOrder(woData(`MFG-${runId}-1`), W.tenant.id)
    const dupNo = await wo.createWorkOrder(woData(`MFG-${runId}-1`), W.tenant.id)
    record("T14b", "작업지시: 수동 제조번호 등록 성공 / 같은 번호 재등록은 DB unique 로 거부 + 안전한 메시지", w1.success && !dupNo.success && msgOf(dupNo as { success: boolean; message?: string }) === "이미 사용 중인 제조번호입니다.", `1차=${w1.success} 중복=${msgOf(dupNo as { success: boolean; message?: string })}`)
    const work = await prisma.workOrder.findFirstOrThrow({ where: { tenantId: W.tenant.id, manufacturingNo: `MFG-${runId}-1` } })
    const lots = await prisma.lot.findMany({ where: { tenantId: W.tenant.id, itemId: W.lotRaw.id }, orderBy: { lotNo: "asc" } })
    const lot1 = lots.find((l) => l.lotNo === "LOT-W1")!
    const lot2 = lots.find((l) => l.lotNo === "LOT-W2")!
    const iss = await issue.issueMaterialsForWorkOrder({
      workOrderId: work.id, siteId: W.site.id,
      items: [{ itemId: W.lotRaw.id, issueQty: 70, requiredQty: 100, reservationId: null, lots: [{ lotId: lot1.id, warehouseId: W.warehouse.id, quantity: 50 }, { lotId: lot2.id, warehouseId: W.warehouse.id, quantity: 20 }] }],
    }, W.tenant.id)
    const bal = async (lotId: string) => D((await prisma.inventoryBalance.findFirst({ where: { tenantId: W.tenant.id, itemId: W.lotRaw.id, lotId } }))?.qtyOnHand)
    const wml = await prisma.workOrderMaterialLot.findMany({ where: { tenantId: W.tenant.id, workOrderId: work.id } })
    const issTx = await prisma.inventoryTransaction.findMany({ where: { tenantId: W.tenant.id, txType: "ISSUE", refId: work.id } })
    const wip = await prisma.wipUnit.count({ where: { tenantId: W.tenant.id, workOrderId: work.id } })
    record("T14c", "자재출고: LOT 분할 출고 성공, LOT별 재고 차감, 수불·투입이력·WIP 생성",
      iss.ok && (await bal(lot1.id)) === 10 && (await bal(lot2.id)) === 20 && issTx.length === 2 && wml.length >= 1 && wip >= 1,
      `ok=${iss.ok}${iss.error ? " " + iss.error : ""} LOT-W1=${await bal(lot1.id)}(60→10) LOT-W2=${await bal(lot2.id)}(40→20) ISSUE수불=${issTx.length} 투입이력=${wml.length}건 WIP=${wip}`)
    const sumWml = wml.reduce((s, x) => s + D(x.qty), 0)
    const byLot = new Map<string, number>()
    for (const t of issTx) byLot.set(t.lotId ?? "", (byLot.get(t.lotId ?? "") ?? 0) + D(t.qty))
    record("T15a", "LOT별 정합성: 투입이력 합계 = ISSUE 수불 합계 = 70, LOT 별 수량 일치", sumWml === 70 && byLot.get(lot1.id) === 50 && byLot.get(lot2.id) === 20 && wml.every((x) => !!x.materialLotNo),
      `투입이력합=${sumWml} LOT-W1=${byLot.get(lot1.id)} LOT-W2=${byLot.get(lot2.id)} 이력LOT=${wml.map((x) => x.materialLotNo).join(",")}`)
    const over = await issue.issueMaterialsForWorkOrder({
      workOrderId: work.id, siteId: W.site.id,
      items: [{ itemId: W.lotRaw.id, issueQty: 15, requiredQty: 100, reservationId: null, lots: [{ lotId: lot1.id, warehouseId: W.warehouse.id, quantity: 15 }] }],
    }, W.tenant.id)
    record("T14d", "LOT 가용재고(10) 초과 출고 거부, 재고·수불 변화 없음", !over.ok && (await bal(lot1.id)) === 10, `${over.error ?? ""}`)
    // 수불 총합 = 재고 총합 (입고 100 - 출고 70 = 30)
    const rec = (await prisma.inventoryTransaction.findMany({ where: { tenantId: W.tenant.id, txType: "RECEIPT" } })).reduce((s, x) => s + D(x.qty), 0)
    const iss2 = (await prisma.inventoryTransaction.findMany({ where: { tenantId: W.tenant.id, txType: "ISSUE" } })).reduce((s, x) => s + D(x.qty), 0)
    const onHand = (await stock(W.tenant.id, W.lotRaw.id)).onHand
    record("T15b", "수불 원장 정합성: 입고합계 - 출고합계 = 재고 합계 (100 - 70 = 30)", rec - iss2 === onHand && onHand === 30, `입고=${rec} 출고=${iss2} 재고=${onHand}`)
    const inc = await issue.issueMaterialsForWorkOrder({ workOrderId: work.id, siteId: W.site.id, items: [{ itemId: W.lotRaw.id, issueQty: 5, requiredQty: 100, reservationId: null, lots: [{ lotId: lot2.id, warehouseId: W.warehouse.id, quantity: 4.5 }] }] }, W.tenant.id)
    record("T14e", "출고 LOT 수량 합계 불일치(5 ≠ 4.5) 거부", !inc.ok, inc.error ?? "")
  }

  // ══ R: 입고거래번호(txNo) 동시성 수정 검증 (트랜잭션 내부 + (tenant,날짜) advisory lock) ═══════
  const { kstDateParts } = require("../src/lib/business-numbering") as typeof import("../src/lib/business-numbering")
  const ymd = kstDateParts().yyyymmdd
  const receiptNos = async (tenantId: string) =>
    (await prisma.inventoryTransaction.findMany({ where: { tenantId, txType: "RECEIPT" }, select: { txNo: true } })).map((x) => x.txNo).sort()
  const isContiguous = (nos: string[]) => nos.length > 0 && nos.every((n, i) => n === `RCV-${ymd}-${String(i + 1).padStart(4, "0")}`)

  {
    // R1 동일 발주품목 동시 입고 (수정 전 T09b: 10건 중 5건 실패)
    const R1 = await mkCtx("R1")
    const o = await newPO(R1, [{ itemId: R1.plainRaw.id, qty: 100 }])
    const res = await Promise.all(Array.from({ length: 10 }, () => receive(R1, o, o.items[0], { r: 10, a: 10, j: 0 })))
    const nos = await receiptNos(R1.tenant.id)
    const pi = await poItem(o.items[0].id)
    const st = await stock(R1.tenant.id, R1.plainRaw.id)
    record("R1", "동일 발주품목 동시 입고 10건×10: 전부 성공, 거래번호 0001~0010 연속·중복 없음", res.every((r) => r.success) && D(pi.receivedQty) === 100 && st.onHand === 100 && st.rows === 1 && isContiguous(nos),
      `성공 ${res.filter((r) => r.success).length}/10, 누적=${D(pi.receivedQty)}, 재고=${st.onHand}(행 ${st.rows}), 거래번호 ${nos[0]}~${nos[nos.length - 1]} (${new Set(nos).size}개)`)

    // R2 서로 다른 발주품목(다른 발주) 동시 입고 — 같은 품목·창고 최초 재고 생성 경합 포함
    const R2 = await mkCtx("R2")
    const orders = []
    for (let k = 0; k < 12; k++) orders.push(await newPO(R2, [{ itemId: R2.plainRaw.id, qty: 10 }]))
    const res2 = await Promise.all(orders.map((x) => receive(R2, x, x.items[0], { r: 10, a: 10, j: 0 })))
    const nos2 = await receiptNos(R2.tenant.id)
    const st2 = await stock(R2.tenant.id, R2.plainRaw.id)
    const rowsNull = await prisma.inventoryBalance.count({ where: { tenantId: R2.tenant.id, itemId: R2.plainRaw.id, lotId: null } })
    record("R2", "서로 다른 발주(12건) 동일 품목 동시 입고: 전부 성공, 재고 120, 거래번호 연속", res2.every((r) => r.success) && st2.onHand === 120 && isContiguous(nos2),
      `성공 ${res2.filter((r) => r.success).length}/12, 재고=${st2.onHand}, 비LOT 재고 행=${rowsNull}, 거래번호 ${nos2[0]}~${nos2[nos2.length - 1]}`)
    record("R2b", "참고: 위 동시 입고에서 비LOT 재고 행 수 (인덱스 없는 baseline, 1 이어야 정상)", rowsNull === 1, `재고 행 ${rowsNull}개`)

    // R3 동일 tenant 다중 품목(LOT/비LOT 혼합) 동시 입고
    const R3 = await mkCtx("R3")
    const plain2 = await R3.mkItem("RAW-PLAIN2", "RAW_MATERIAL", false)
    const items3 = [R3.lotRaw, R3.plainRaw, plain2]
    const orders3 = []
    for (const it of items3) for (let k = 0; k < 5; k++) orders3.push({ it, o: await newPO(R3, [{ itemId: it.id, qty: 10 }]) })
    const res3 = await Promise.all(orders3.map(({ it, o }, i) => receive(R3, o, o.items[0], { r: 10, a: 10, j: 0, lotNo: it.id === R3.lotRaw.id ? `R3-LOT-${i}` : undefined })))
    const nos3 = await receiptNos(R3.tenant.id)
    const sts = await Promise.all(items3.map((it) => stock(R3.tenant.id, it.id)))
    record("R3", "동일 tenant 다중 품목(LOT 1 + 비LOT 2) 15건 동시 입고: 전부 성공, 품목별 재고 50, 거래번호 연속", res3.every((r) => r.success) && sts.every((x) => x.onHand === 50) && isContiguous(nos3),
      `성공 ${res3.filter((r) => r.success).length}/15, 재고 ${sts.map((x) => x.onHand).join("/")}, 거래번호 ${nos3[0]}~${nos3[nos3.length - 1]} (${new Set(nos3).size}개)`)

    // R4 서로 다른 tenant 동시 입고: 각 tenant 번호가 독립적으로 0001 부터
    const T1 = await mkCtx("R4a"), T2 = await mkCtx("R4b")
    const o1 = [], o2 = []
    for (let k = 0; k < 8; k++) { o1.push(await newPO(T1, [{ itemId: T1.plainRaw.id, qty: 10 }])); o2.push(await newPO(T2, [{ itemId: T2.plainRaw.id, qty: 10 }])) }
    const mixed = await Promise.all([...o1.map((x) => receive(T1, x, x.items[0], { r: 10, a: 10, j: 0 })), ...o2.map((x) => receive(T2, x, x.items[0], { r: 10, a: 10, j: 0 }))])
    const n1 = await receiptNos(T1.tenant.id), n2 = await receiptNos(T2.tenant.id)
    record("R4", "서로 다른 tenant 16건 동시 입고: 전부 성공, tenant 별 거래번호가 독립적으로 0001~0008", mixed.every((r) => r.success) && isContiguous(n1) && isContiguous(n2) && n1.length === 8 && n2.length === 8,
      `성공 ${mixed.filter((r) => r.success).length}/16, A ${n1[0]}~${n1[n1.length - 1]}, B ${n2[0]}~${n2[n2.length - 1]}`)

    // R5 다수 동시 요청 (같은 tenant 40건)
    const R5 = await mkCtx("R5")
    const orders5 = []
    for (let k = 0; k < 40; k++) orders5.push(await newPO(R5, [{ itemId: R5.plainRaw.id, qty: 10 }]))
    const t0 = Date.now()
    const res5 = await Promise.all(orders5.map((x) => receive(R5, x, x.items[0], { r: 10, a: 10, j: 0 })))
    const ms5 = Date.now() - t0
    const nos5 = await receiptNos(R5.tenant.id)
    const st5 = await stock(R5.tenant.id, R5.plainRaw.id)
    record("R5", "같은 tenant 40건 동시 입고: 전부 성공, 거래번호 40개 중복 없음·연속, 재고 400", res5.every((r) => r.success) && new Set(nos5).size === 40 && isContiguous(nos5) && st5.onHand === 400,
      `성공 ${res5.filter((r) => r.success).length}/40, 고유 거래번호 ${new Set(nos5).size}, 재고=${st5.onHand}, 소요 ${ms5}ms`)

    // R6 번호 확보 이후(감사로그 단계) DB 오류 → 전체 롤백, 번호도 소모되지 않음
    const R6 = await mkCtx("R6")
    const o6 = await newPO(R6, [{ itemId: R6.plainRaw.id, qty: 100 }])
    await receive(R6, o6, o6.items[0], { r: 10, a: 10, j: 0 }) // 0001
    const realId = testProfile.id
    testProfile.id = "no-such-profile" // recordAuditLog 의 FK 위반 → 번호 확보·재고 반영 이후에 실패
    const failed = await receive(R6, o6, o6.items[0], { r: 10, a: 10, j: 0 })
    testProfile.id = realId
    const afterFail = { st: await stock(R6.tenant.id, R6.plainRaw.id), n: (await receiptNos(R6.tenant.id)).length, insp: await prisma.receivingInspection.count({ where: { purchaseOrderItemId: o6.items[0].id } }), recv: D((await poItem(o6.items[0].id)).receivedQty) }
    const next = await receive(R6, o6, o6.items[0], { r: 10, a: 10, j: 0 })
    const nos6 = await receiptNos(R6.tenant.id)
    record("R6", "번호 확보 이후 DB 오류: 입고검사·재고·수불·누적 모두 롤백, 번호 소모 없음(다음 입고가 0002 연속)", !failed.success && afterFail.st.onHand === 10 && afterFail.n === 1 && afterFail.insp === 1 && afterFail.recv === 10 && next.success && isContiguous(nos6) && nos6.length === 2,
      `실패 후 재고=${afterFail.st.onHand} 수불=${afterFail.n} 검사이력=${afterFail.insp} 누적=${afterFail.recv}; 다음 입고 ${next.success ? "성공" : "실패"} → ${nos6.join(",")}; 메시지="${failed.message}"`)

    // R7 결과 불명(연결 오류): 자동 재시도하지 않는다 (실제 코드, $transaction 만 1회 오류로 대체)
    const R7 = await mkCtx("R7")
    const o7 = await newPO(R7, [{ itemId: R7.plainRaw.id, qty: 100 }])
    const client = prisma as unknown as { $transaction: (...a: unknown[]) => unknown }
    const realTx = client.$transaction.bind(prisma)
    let calls = 0
    client.$transaction = (...a: unknown[]) => { calls += 1; return Promise.reject(Object.assign(new Error("Server has closed the connection."), { name: "PrismaClientUnknownRequestError" })) }
    let r7: Awaited<ReturnType<typeof receive>>
    try { r7 = await receive(R7, o7, o7.items[0], { r: 10, a: 10, j: 0 }) } finally { client.$transaction = realTx }
    const r7n = (await receiptNos(R7.tenant.id)).length
    record("R7", "커밋 결과 불명(연결 오류): outcome=UNKNOWN, 자동 재시도 없음(트랜잭션 호출 1회), DB 변화 없음", !r7.success && r7.outcome === "UNKNOWN" && calls === 1 && r7n === 0,
      `outcome=${r7.outcome} 트랜잭션 호출=${calls}회 수불=${r7n}`)

    // R8 txNo unique 충돌(이중 방어 경로)은 안전하게 재시도되고 입고는 1회만 반영
    const R8 = await mkCtx("R8")
    const o8 = await newPO(R8, [{ itemId: R8.plainRaw.id, qty: 100 }])
    let calls8 = 0
    const realTx8 = client.$transaction.bind(prisma)
    client.$transaction = (...a: unknown[]) => {
      calls8 += 1
      if (calls8 === 1) return Promise.reject(new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`tenantId`,`txNo`)", { code: "P2002", clientVersion: "5.22.0", meta: { target: ["tenantId", "txNo"] } }))
      return (realTx8 as (...x: unknown[]) => unknown)(...a)
    }
    let r8: Awaited<ReturnType<typeof receive>>
    try { r8 = await receive(R8, o8, o8.items[0], { r: 10, a: 10, j: 0 }) } finally { client.$transaction = realTx8 }
    const r8n = await receiptNos(R8.tenant.id)
    const r8insp = await prisma.receivingInspection.count({ where: { purchaseOrderItemId: o8.items[0].id } })
    const r8st = await stock(R8.tenant.id, R8.plainRaw.id)
    record("R8", "txNo unique 충돌 시 재시도: 트랜잭션 2회 호출, 입고검사·수불·재고는 정확히 1회분", r8.success && calls8 === 2 && r8n.length === 1 && r8insp === 1 && r8st.onHand === 10,
      `호출=${calls8}회 성공=${r8.success} 수불=${r8n.length} 검사이력=${r8insp} 재고=${r8st.onHand}`)
  }

  // ══ R9 기존 LOT 자동채번·예약 로직 회귀 (NMES 개발 브랜드에서만 허용되는 경로) ═════════
  {
    const L = await mkCtx("L")
    const oL = await newPO(L, [{ itemId: L.lotRaw.id, qty: 100 }])
    const guardMsg = await receive(L, oL, oL.items[0], { r: 10, a: 10, j: 0 }) // 대원정밀 브랜드: 자동 채번 차단
    record("R9a", "LOT 자동채번 가드 유지(대원정밀): LOT 번호 미입력 입고 거부, DB 변화 없음", !guardMsg.success && /대원정밀 LOT 채번 규칙/.test(guardMsg.message ?? "") && (await stock(L.tenant.id, L.lotRaw.id)).onHand === 0, guardMsg.message ?? "")
    const savedBrand = process.env.NEXT_PUBLIC_BRAND
    process.env.NEXT_PUBLIC_BRAND = "newmes"
    try {
      const a1 = await receive(L, oL, oL.items[0], { r: 10, a: 10, j: 0 })
      const a2 = await receive(L, oL, oL.items[0], { r: 10, a: 10, j: 0 })
      const lotsL = await prisma.lot.findMany({ where: { tenantId: L.tenant.id, itemId: L.lotRaw.id }, orderBy: { lotNo: "asc" } })
      const resv = await prisma.lotNumberReservation.findMany({ where: { tenantId: L.tenant.id } })
      const nosL = await receiptNos(L.tenant.id)
      record("R9b", "LOT 자동채번 회귀(NMES 브랜드): 입고마다 새 LOT 자동 발행·예약 원장 CONSUMED, 거래번호 연속", a1.success && a2.success && lotsL.length === 2 && new Set(lotsL.map((x) => x.lotNo)).size === 2 && resv.length === 2 && resv.every((x) => x.status === "CONSUMED") && isContiguous(nosL),
        `성공 ${a1.success}/${a2.success}, LOT ${lotsL.map((x) => x.lotNo).join(",")}, 예약 ${resv.map((x) => x.status).join(",")}, 거래번호 ${nosL.join(",")}`)
      const dupConc = await Promise.all(Array.from({ length: 6 }, () => receive(L, oL, oL.items[0], { r: 5, a: 5, j: 0 })))
      const lotsAfter = await prisma.lot.findMany({ where: { tenantId: L.tenant.id, itemId: L.lotRaw.id } })
      const nosAfter = await receiptNos(L.tenant.id)
      record("R9c", "LOT 자동채번 동시 6건: 전부 성공, LOT 번호 중복 없음, 거래번호 중복 없음", dupConc.every((r) => r.success) && new Set(lotsAfter.map((x) => x.lotNo)).size === lotsAfter.length && lotsAfter.length === 8 && new Set(nosAfter).size === nosAfter.length && isContiguous(nosAfter),
        `성공 ${dupConc.filter((r) => r.success).length}/6, LOT ${lotsAfter.length}개(고유 ${new Set(lotsAfter.map((x) => x.lotNo)).size}), 거래번호 ${nosAfter.length}개 연속=${isContiguous(nosAfter)}`)
    } finally {
      if (savedBrand === undefined) delete process.env.NEXT_PUBLIC_BRAND
      else process.env.NEXT_PUBLIC_BRAND = savedBrand
    }
  }

  // ══ ID: 서버 멱등성 (requestId) — 실제 PostgreSQL ═══════════════════════════════════
  const rqCount = (tenantId: string) => prisma.receivingRequest.count({ where: { tenantId } })
  const inspCount = (itemId: string) => prisma.receivingInspection.count({ where: { purchaseOrderItemId: itemId } })
  const lotCount = (tenantId: string) => prisma.lot.count({ where: { tenantId } })
  const txCount = (tenantId: string) => prisma.inventoryTransaction.count({ where: { tenantId, txType: "RECEIPT" } })

  {
    // ID1 동일 요청 2회 순차 실행 — 두 번째는 새 입고 없이 기존 결과(replayed)
    const I1 = await mkCtx("I1")
    const o = await newPO(I1, [{ itemId: I1.lotRaw.id, qty: 100 }])
    const it = o.items[0]
    const rid = ids.generateReceivingRequestId()
    const r1 = await receive(I1, o, it, { r: 40, a: 40, j: 0, lotNo: "I1-LOT", requestId: rid })
    const snap1 = { lots: await lotCount(I1.tenant.id), tx: await txCount(I1.tenant.id) }
    const r2 = await receive(I1, o, it, { r: 40, a: 40, j: 0, lotNo: "I1-LOT", requestId: rid })
    const st = await stock(I1.tenant.id, I1.lotRaw.id)
    record("ID1", "동일 요청 2회 순차 실행: 입고 1회만 반영, 2회차는 replayed 성공(새 LOT·거래번호·검사이력 없음)",
      r1.success && r2.success && !(r1 as { replayed?: boolean }).replayed && (r2 as { replayed?: boolean }).replayed === true && st.onHand === 40 && D((await poItem(it.id)).receivedQty) === 40 && (await inspCount(it.id)) === 1 && (await rqCount(I1.tenant.id)) === 1 && (await lotCount(I1.tenant.id)) === snap1.lots && (await txCount(I1.tenant.id)) === snap1.tx,
      `1차=${r1.success} 2차=${r2.success}(replayed=${(r2 as { replayed?: boolean }).replayed}) 재고=${st.onHand} 검사이력=${await inspCount(it.id)} 요청원장=${await rqCount(I1.tenant.id)} LOT ${snap1.lots}→${await lotCount(I1.tenant.id)} 거래 ${snap1.tx}→${await txCount(I1.tenant.id)}`)

    // ID2 동일 요청 10회 동시 실행 (이중 클릭/이중 탭/재전송 폭주)
    const I2 = await mkCtx("I2")
    const o2 = await newPO(I2, [{ itemId: I2.plainRaw.id, qty: 100 }])
    const rid2 = ids.generateReceivingRequestId()
    const res2 = await Promise.all(Array.from({ length: 10 }, () => receive(I2, o2, o2.items[0], { r: 40, a: 40, j: 0, requestId: rid2 })))
    const st2 = await stock(I2.tenant.id, I2.plainRaw.id)
    const nos2 = await receiptNos(I2.tenant.id)
    const replays = res2.filter((r) => (r as { replayed?: boolean }).replayed).length
    record("ID2", "동일 요청 10회 동시 실행: 전부 성공 응답, 실제 입고는 1회(재고 40·검사이력 1·요청원장 1·거래번호 1)",
      res2.every((r) => r.success) && replays === 9 && st2.onHand === 40 && (await inspCount(o2.items[0].id)) === 1 && (await rqCount(I2.tenant.id)) === 1 && nos2.length === 1,
      `성공 ${res2.filter((r) => r.success).length}/10 (replayed ${replays}), 재고=${st2.onHand}, 검사이력=${await inspCount(o2.items[0].id)}, 요청원장=${await rqCount(I2.tenant.id)}, 거래번호 ${nos2.join(",")}`)

    // ID3 정상 분할 입고 — 같은 발주품목, 요청 ID 만 다르면 모두 처리. 이전 요청 재전송은 중복 생성하지 않음
    const I3 = await mkCtx("I3")
    const o3 = await newPO(I3, [{ itemId: I3.plainRaw.id, qty: 200 }])
    const it3 = o3.items[0]
    const ridA = ids.generateReceivingRequestId(), ridB = ids.generateReceivingRequestId()
    const a1 = await receive(I3, o3, it3, { r: 100, a: 100, j: 0, requestId: ridA })
    const b1 = await receive(I3, o3, it3, { r: 50, a: 50, j: 0, requestId: ridB })
    const st3a = await stock(I3.tenant.id, I3.plainRaw.id)
    const a2 = await receive(I3, o3, it3, { r: 100, a: 100, j: 0, requestId: ridA }) // 001 재전송
    const st3b = await stock(I3.tenant.id, I3.plainRaw.id)
    record("ID3", "정상 분할 입고(100 + 50, 다른 요청 ID)는 모두 처리, 첫 요청(100) 재전송은 중복 생성 없음",
      a1.success && b1.success && st3a.onHand === 150 && a2.success && (a2 as { replayed?: boolean }).replayed === true && st3b.onHand === 150 && (await inspCount(it3.id)) === 2 && D((await poItem(it3.id)).receivedQty) === 150,
      `재고 150 → 재전송 후 ${st3b.onHand}, 검사이력 ${await inspCount(it3.id)}건, 누적 ${D((await poItem(it3.id)).receivedQty)}`)

    // ID4 요청 ID 재사용 + 내용 불일치(수량/품목) → 명확한 오류, DB 변화 없음
    const diffQty = await receive(I3, o3, it3, { r: 60, a: 60, j: 0, requestId: ridA })
    const o3b = await newPO(I3, [{ itemId: I3.lotRaw.id, qty: 10 }])
    const diffItem = await receive(I3, o3b, o3b.items[0], { r: 10, a: 10, j: 0, lotNo: "I4-LOT", requestId: ridA })
    const st4 = await stock(I3.tenant.id, I3.plainRaw.id)
    record("ID4", "같은 요청 ID 에 다른 내용(수량/발주품목) → 충돌 오류, DB 변화 없음",
      !diffQty.success && !diffItem.success && /같은 입고 요청 번호로 서로 다른 내용/.test(diffQty.message ?? "") && /같은 입고 요청 번호로 서로 다른 내용/.test(diffItem.message ?? "") && st4.onHand === 150 && (await stock(I3.tenant.id, I3.lotRaw.id)).onHand === 0 && (await rqCount(I3.tenant.id)) === 2,
      `수량 불일치: "${(diffQty.message ?? "").slice(0, 32)}…" 품목 불일치: "${(diffItem.message ?? "").slice(0, 32)}…" 재고 ${st4.onHand}, 요청원장 ${await rqCount(I3.tenant.id)}`)

    // ID5 서로 다른 tenant 의 같은 requestId — 서로 독립
    const I5a = await mkCtx("I5a"), I5b = await mkCtx("I5b")
    const o5a = await newPO(I5a, [{ itemId: I5a.plainRaw.id, qty: 100 }]), o5b = await newPO(I5b, [{ itemId: I5b.plainRaw.id, qty: 100 }])
    const sharedId = ids.generateReceivingRequestId()
    const [r5a, r5b] = await Promise.all([receive(I5a, o5a, o5a.items[0], { r: 30, a: 30, j: 0, requestId: sharedId }), receive(I5b, o5b, o5b.items[0], { r: 30, a: 30, j: 0, requestId: sharedId })])
    record("ID5", "서로 다른 tenant 가 같은 요청 ID 를 써도 각자 정상 처리(서로 replay/충돌로 보지 않음)",
      r5a.success && r5b.success && !(r5a as { replayed?: boolean }).replayed && !(r5b as { replayed?: boolean }).replayed && (await stock(I5a.tenant.id, I5a.plainRaw.id)).onHand === 30 && (await stock(I5b.tenant.id, I5b.plainRaw.id)).onHand === 30,
      `A=${r5a.success} B=${r5b.success}, 재고 A=${(await stock(I5a.tenant.id, I5a.plainRaw.id)).onHand} B=${(await stock(I5b.tenant.id, I5b.plainRaw.id)).onHand}`)

    // ID6 롤백 후 같은 요청 ID 로 정상 재시도 (클레임·LOT·재고가 함께 롤백)
    const I6 = await mkCtx("I6")
    const o6 = await newPO(I6, [{ itemId: I6.lotRaw.id, qty: 100 }])
    const rid6 = ids.generateReceivingRequestId()
    const realId = testProfile.id
    testProfile.id = "no-such-profile" // 번호·LOT·재고 반영 이후 감사로그 FK 위반으로 실패
    const f6 = await receive(I6, o6, o6.items[0], { r: 25, a: 25, j: 0, lotNo: "I6-LOT", requestId: rid6 })
    testProfile.id = realId
    const afterFail = { rq: await rqCount(I6.tenant.id), lots: await lotCount(I6.tenant.id), tx: await txCount(I6.tenant.id), st: (await stock(I6.tenant.id, I6.lotRaw.id)).onHand, insp: await inspCount(o6.items[0].id) }
    const retry6 = await receive(I6, o6, o6.items[0], { r: 25, a: 25, j: 0, lotNo: "I6-LOT", requestId: rid6 })
    const st6 = (await stock(I6.tenant.id, I6.lotRaw.id)).onHand
    record("ID6", "롤백 후 같은 요청 ID 재시도: 실패 시 클레임·LOT·재고·거래 모두 미반영 → 재시도는 정상 처리(replay 아님)",
      !f6.success && afterFail.rq === 0 && afterFail.lots === 0 && afterFail.tx === 0 && afterFail.st === 0 && afterFail.insp === 0 && retry6.success && !(retry6 as { replayed?: boolean }).replayed && st6 === 25 && (await rqCount(I6.tenant.id)) === 1 && isContiguous(await receiptNos(I6.tenant.id)),
      `실패 직후 요청원장=${afterFail.rq} LOT=${afterFail.lots} 거래=${afterFail.tx} 재고=${afterFail.st} | 재시도 ${retry6.success}(replayed=${(retry6 as { replayed?: boolean }).replayed}) 재고=${st6} 거래번호 ${(await receiptNos(I6.tenant.id)).join(",")}`)

    // ID7 커밋 성공 후 응답 실패 — 서버는 처리했는데 호출자는 UNKNOWN 을 받음 → 같은 ID 재전송은 replay
    const I7 = await mkCtx("I7")
    const o7 = await newPO(I7, [{ itemId: I7.lotRaw.id, qty: 100 }])
    const rid7 = ids.generateReceivingRequestId()
    const client7 = prisma as unknown as { $transaction: (...a: unknown[]) => Promise<unknown> }
    const realTx7 = client7.$transaction.bind(prisma)
    client7.$transaction = async (...a: unknown[]) => {
      await realTx7(...a) // 실제로 커밋됨
      throw Object.assign(new Error("Server has closed the connection."), { name: "PrismaClientUnknownRequestError" }) // 그런데 응답은 유실
    }
    let r7: Awaited<ReturnType<typeof receive>>
    try { r7 = await receive(I7, o7, o7.items[0], { r: 30, a: 30, j: 0, lotNo: "I7-LOT", requestId: rid7 }) } finally { client7.$transaction = realTx7 }
    const mid = { st: (await stock(I7.tenant.id, I7.lotRaw.id)).onHand, lots: await lotCount(I7.tenant.id), tx: await txCount(I7.tenant.id), rq: await rqCount(I7.tenant.id) }
    const resend7 = await receive(I7, o7, o7.items[0], { r: 30, a: 30, j: 0, lotNo: "I7-LOT", requestId: rid7 })
    const end = { st: (await stock(I7.tenant.id, I7.lotRaw.id)).onHand, lots: await lotCount(I7.tenant.id), tx: await txCount(I7.tenant.id), rq: await rqCount(I7.tenant.id) }
    record("ID7", "커밋 성공 후 응답 유실: 호출자는 UNKNOWN(성공 단정 안 함), 같은 요청 ID 재전송은 replayed 성공 — 재고·LOT·거래번호 중복 없음",
      !r7.success && r7.outcome === "UNKNOWN" && mid.st === 30 && resend7.success && (resend7 as { replayed?: boolean }).replayed === true && end.st === 30 && end.lots === mid.lots && end.tx === mid.tx && end.rq === 1,
      `응답유실 직후 outcome=${r7.outcome} DB 재고=${mid.st}(이미 반영) | 재전송 ${resend7.success}(replayed=${(resend7 as { replayed?: boolean }).replayed}) 재고=${end.st} LOT ${mid.lots}→${end.lots} 거래 ${mid.tx}→${end.tx} 요청원장=${end.rq}`)

    // ID8 합격수량 0(전량 불합격) 입고검사도 중복 저장되지 않음
    const I8 = await mkCtx("I8")
    const o8 = await newPO(I8, [{ itemId: I8.plainRaw.id, qty: 100 }])
    const rid8 = ids.generateReceivingRequestId()
    const z = await Promise.all([receive(I8, o8, o8.items[0], { r: 10, a: 0, j: 10, requestId: rid8 }), receive(I8, o8, o8.items[0], { r: 10, a: 0, j: 10, requestId: rid8 }), receive(I8, o8, o8.items[0], { r: 10, a: 0, j: 10, requestId: rid8 })])
    record("ID8", "합격수량 0 인 입고검사도 중복 저장되지 않음 (동시 3회 → 검사이력 1건, 재고 변화 없음)",
      z.every((r) => r.success) && (await inspCount(o8.items[0].id)) === 1 && (await stock(I8.tenant.id, I8.plainRaw.id)).onHand === 0 && (await txCount(I8.tenant.id)) === 0,
      `성공 ${z.filter((r) => r.success).length}/3 검사이력=${await inspCount(o8.items[0].id)} 재고=${(await stock(I8.tenant.id, I8.plainRaw.id)).onHand} 수불=${await txCount(I8.tenant.id)}`)

    // ID9 잔량 0(전량 입고 완료) 이후 같은 요청 재전송 — 재검증에 걸려 실패하지 않고 replayed 성공
    const I9 = await mkCtx("I9")
    const o9 = await newPO(I9, [{ itemId: I9.plainRaw.id, qty: 50 }])
    const rid9 = ids.generateReceivingRequestId()
    const f9 = await receive(I9, o9, o9.items[0], { r: 50, a: 50, j: 0, requestId: rid9 })
    const g9 = await receive(I9, o9, o9.items[0], { r: 50, a: 50, j: 0, requestId: rid9 })
    const newReq = await receive(I9, o9, o9.items[0], { r: 50, a: 50, j: 0, requestId: ids.generateReceivingRequestId() })
    record("ID9", "전량 입고 후 같은 요청 재전송은 replayed 성공, 새 요청 ID 의 추가 입고는 잔여수량 초과로 거부",
      f9.success && g9.success && (g9 as { replayed?: boolean }).replayed === true && !newReq.success && /잔여수량/.test(newReq.message ?? "") && (await stock(I9.tenant.id, I9.plainRaw.id)).onHand === 50,
      `최초=${f9.success} 재전송=${g9.success}(replayed=${(g9 as { replayed?: boolean }).replayed}) 새ID추가=${newReq.success}("${(newReq.message ?? "").slice(0, 28)}…") 재고=${(await stock(I9.tenant.id, I9.plainRaw.id)).onHand}`)

    // ID10 요청 ID 누락/형식 오류 거부
    const I10 = await mkCtx("I10")
    const o10 = await newPO(I10, [{ itemId: I10.plainRaw.id, qty: 10 }])
    const bad = await Promise.all(["", "short", "has space has space has", undefined as unknown as string].map((x) => receive(I10, o10, o10.items[0], { r: 5, a: 5, j: 0, requestId: x })))
    record("ID10", "요청 ID 누락·형식 오류는 거부, DB 변화 없음", bad.every((r) => !r.success) && (await inspCount(o10.items[0].id)) === 0 && (await rqCount(I10.tenant.id)) === 0, `거부 ${bad.filter((r) => !r.success).length}/4`)
  }

  // ══ ID12 서로 다른 발주품목에 같은 요청 ID 가 동시에 도착 — DB unique 가 하나만 통과시키고 나머지는 충돌 오류 ═════
  {
    const I12 = await mkCtx("I12")
    const oa = await newPO(I12, [{ itemId: I12.plainRaw.id, qty: 100 }])
    const ob = await newPO(I12, [{ itemId: I12.lotRaw.id, qty: 100 }])
    const sameId = ids.generateReceivingRequestId()
    const [ra, rb] = await Promise.all([
      receive(I12, oa, oa.items[0], { r: 10, a: 10, j: 0, requestId: sameId }),
      receive(I12, ob, ob.items[0], { r: 10, a: 10, j: 0, lotNo: "I12-LOT", requestId: sameId }),
    ])
    const okCount = [ra, rb].filter((r) => r.success).length
    const loser = [ra, rb].find((r) => !r.success)
    const totalStock = (await stock(I12.tenant.id, I12.plainRaw.id)).onHand + (await stock(I12.tenant.id, I12.lotRaw.id)).onHand
    record("ID12", "같은 요청 ID 가 서로 다른 발주품목에 동시 도착: 정확히 1건만 처리, 나머지는 충돌 오류(DB unique), 재고 10",
      okCount === 1 && !!loser && /같은 입고 요청 번호로 서로 다른 내용/.test(loser.message ?? "") && totalStock === 10 && (await rqCount(I12.tenant.id)) === 1 && (await receiptNos(I12.tenant.id)).length === 1,
      `성공 ${okCount}/2, 패자 메시지="${(loser?.message ?? "").slice(0, 30)}…", 재고 합계 ${totalStock}, 요청원장 ${await rqCount(I12.tenant.id)}, 거래 ${(await receiptNos(I12.tenant.id)).length}`)
  }

  // ══ ID11 LOT 자동발행 중복 방지 (NMES 브랜드에서만 자동채번 허용되는 경로) ═══════════════
  {
    const L2 = await mkCtx("L2")
    const oL = await newPO(L2, [{ itemId: L2.lotRaw.id, qty: 100 }])
    const savedBrand = process.env.NEXT_PUBLIC_BRAND
    process.env.NEXT_PUBLIC_BRAND = "newmes"
    try {
      const ridL = ids.generateReceivingRequestId()
      const burst = await Promise.all(Array.from({ length: 6 }, () => receive(L2, oL, oL.items[0], { r: 10, a: 10, j: 0, requestId: ridL })))
      const lots = await prisma.lot.findMany({ where: { tenantId: L2.tenant.id } })
      const resv = await prisma.lotNumberReservation.findMany({ where: { tenantId: L2.tenant.id } })
      const nos = await receiptNos(L2.tenant.id)
      record("ID11a", "LOT 자동발행 + 동일 요청 6회 동시: LOT 1개·예약 CONSUMED 1건·거래번호 1개 (재전송이 새 LOT/번호를 발급하지 않음)",
        burst.every((r) => r.success) && lots.length === 1 && resv.length === 1 && resv[0].status === "CONSUMED" && nos.length === 1 && (await stock(L2.tenant.id, L2.lotRaw.id)).onHand === 10,
        `성공 ${burst.filter((r) => r.success).length}/6, LOT ${lots.map((l) => l.lotNo).join(",")}, 예약 ${resv.map((r) => r.status).join(",")}, 거래번호 ${nos.join(",")}, 재고 ${(await stock(L2.tenant.id, L2.lotRaw.id)).onHand}`)
      const other = await receive(L2, oL, oL.items[0], { r: 10, a: 10, j: 0, requestId: ids.generateReceivingRequestId() })
      const lots2 = await prisma.lot.findMany({ where: { tenantId: L2.tenant.id }, orderBy: { lotNo: "asc" } })
      record("ID11b", "새 요청 ID 의 다음 자동발행 입고는 새 LOT 를 정상 발급(분할 입고 허용)", other.success && lots2.length === 2 && new Set(lots2.map((l) => l.lotNo)).size === 2 && isContiguous(await receiptNos(L2.tenant.id)),
        `LOT ${lots2.map((l) => l.lotNo).join(",")} 거래번호 ${(await receiptNos(L2.tenant.id)).join(",")}`)
    } finally {
      if (savedBrand === undefined) delete process.env.NEXT_PUBLIC_BRAND
      else process.env.NEXT_PUBLIC_BRAND = savedBrand
    }
  }

  // ══ NB: 비LOT 재고 유일성(partial unique index) + 동시 입고 정합성 — 실제 PostgreSQL ═══════════════
  // (NB14 migration 원자성·기존 인덱스 시나리오는 임시 DB 에서 별도 절차로 실행: docs/DAEWON-RECEIVING-INTEGRITY-REVIEW.md §15)
  const { isNullLotBalanceUniqueError } = require("../src/lib/inventory-balance-guard") as typeof import("../src/lib/inventory-balance-guard")
  const inv = require("../src/lib/actions/inventory.actions") as typeof import("../src/lib/actions/inventory.actions")
  const nullRows = (tenantId: string, itemId: string, warehouseId?: string) =>
    prisma.inventoryBalance.findMany({ where: { tenantId, itemId, lotId: null, ...(warehouseId ? { warehouseId } : {}) } })
  const sumQ = (rows: Array<{ qtyOnHand: unknown; qtyAvailable: unknown }>) => ({ onHand: rows.reduce((s, r) => s + D(r.qtyOnHand), 0), avail: rows.reduce((s, r) => s + D(r.qtyAvailable), 0) })
  const uniqueTxNos = async (tenantId: string) => {
    const nos = (await prisma.inventoryTransaction.findMany({ where: { tenantId }, select: { txNo: true } })).map((x) => x.txNo)
    return { total: nos.length, distinct: new Set(nos).size }
  }

  {
    // NB01 최초 입고 / NB02 추가 입고
    const N1 = await mkCtx("NB1")
    const o1 = await newPO(N1, [{ itemId: N1.plainRaw.id, qty: 1000 }])
    const a = await receive(N1, o1, o1.items[0], { r: 100, a: 100, j: 0 })
    const r1 = await nullRows(N1.tenant.id, N1.plainRaw.id)
    record("NB01", "비LOT 최초 입고: 재고 행 1건 생성(100/100/0)", a.success && r1.length === 1 && D(r1[0].qtyOnHand) === 100 && D(r1[0].qtyAvailable) === 100 && D(r1[0].qtyHold) === 0 && (await txCount(N1.tenant.id)) === 1, `행 ${r1.length}, 수량 ${D(r1[0]?.qtyOnHand)}/${D(r1[0]?.qtyAvailable)}`)
    const b = await receive(N1, o1, o1.items[0], { r: 50, a: 50, j: 0 })
    const r2 = await nullRows(N1.tenant.id, N1.plainRaw.id)
    record("NB02", "동일 품목 추가 입고: 같은 행이 150 으로 증가(새 행 없음)", b.success && r2.length === 1 && r2[0].id === r1[0].id && D(r2[0].qtyOnHand) === 150, `행 ${r2.length}(동일 id=${r2[0]?.id === r1[0]?.id}), 수량 ${D(r2[0]?.qtyOnHand)}`)

    // NB03 동일 품목 10건 동시 (같은 발주품목)
    const N3 = await mkCtx("NB3")
    const o3 = await newPO(N3, [{ itemId: N3.plainRaw.id, qty: 200 }])
    const res3 = await Promise.all(Array.from({ length: 10 }, () => receive(N3, o3, o3.items[0], { r: 10, a: 10, j: 0 })))
    const r3 = await nullRows(N3.tenant.id, N3.plainRaw.id)
    record("NB03", "동일 품목 10건 동시 입고(같은 발주품목): 전부 성공, 재고 행 1건·100", res3.every((r) => r.success) && r3.length === 1 && D(r3[0].qtyOnHand) === 100,
      `성공 ${res3.filter((r) => r.success).length}/10, 행 ${r3.length}, 수량 ${D(r3[0]?.qtyOnHand)}`)

    // NB04 서로 다른 발주(100 + 200) 동시 → 300
    const N4 = await mkCtx("NB4")
    const oa = await newPO(N4, [{ itemId: N4.plainRaw.id, qty: 100 }])
    const ob = await newPO(N4, [{ itemId: N4.plainRaw.id, qty: 200 }])
    const res4 = await Promise.all([receive(N4, oa, oa.items[0], { r: 100, a: 100, j: 0 }), receive(N4, ob, ob.items[0], { r: 200, a: 200, j: 0 })])
    const r4 = await nullRows(N4.tenant.id, N4.plainRaw.id)
    record("NB04", "서로 다른 발주(100EA + 200EA) 동시 입고: 재고 행 1건, qtyOnHand=300, qtyAvailable=300", res4.every((r) => r.success) && r4.length === 1 && D(r4[0].qtyOnHand) === 300 && D(r4[0].qtyAvailable) === 300,
      `성공 ${res4.filter((r) => r.success).length}/2, 행 ${r4.length}, ${D(r4[0]?.qtyOnHand)}/${D(r4[0]?.qtyAvailable)}`)
    // 서로 다른 발주 12건 동시(반복) — 경쟁 반복 관찰
    let dupRounds = 0, fails = 0, wrong = 0
    for (let k = 0; k < 8; k++) {
      const X = await mkCtx(`NB4x${k}`)
      const os = []
      for (let j = 0; j < 6; j++) os.push(await newPO(X, [{ itemId: X.plainRaw.id, qty: 10 * (j + 1) }]))
      const rs = await Promise.all(os.map((x, j) => receive(X, x, x.items[0], { r: 10 * (j + 1), a: 10 * (j + 1), j: 0 })))
      fails += rs.filter((r) => !r.success).length
      const rows = await nullRows(X.tenant.id, X.plainRaw.id)
      if (rows.length !== 1) dupRounds += 1
      if (D(rows[0]?.qtyOnHand) !== 210) wrong += 1
    }
    record("NB04b", "서로 다른 발주 6건 동시 입고 × 8라운드: 매 라운드 재고 행 1건·합계 210, 실패 0", dupRounds === 0 && wrong === 0 && fails === 0, `중복 행 라운드 ${dupRounds}, 합계 오류 라운드 ${wrong}, 실패 ${fails}`)

    // NB05 DB 유일성: 직접 INSERT 중복 거부 + 실제 P2002 오류 모양 + 동시 INSERT 1건만
    const N5 = await mkCtx("NB5")
    const mkRow = (c: Ctx, lotId: string | null, whId?: string) => prisma.inventoryBalance.create({ data: { tenantId: c.tenant.id, siteId: c.site.id, warehouseId: whId ?? c.warehouse.id, itemId: c.plainRaw.id, lotId, qtyOnHand: 1, qtyAvailable: 1, qtyHold: 0 } })
    await mkRow(N5, null)
    let realNullLotError: unknown = null
    try { await mkRow(N5, null) } catch (e) { realNullLotError = e }
    const lotX = await prisma.lot.create({ data: { tenantId: N5.tenant.id, itemId: N5.plainRaw.id, lotNo: "NB5-LOT", status: "ACTIVE" } })
    await mkRow(N5, lotX.id)
    let realLotError: unknown = null
    try { await mkRow(N5, lotX.id) } catch (e) { realLotError = e }
    const meta = (e: unknown) => JSON.stringify((e as { meta?: unknown })?.meta)
    record("NB05a", "DB 제약: 같은 (테넌트·품목·창고) lotId=NULL 두 번째 INSERT 는 거부(P2002), 분류 함수가 '비LOT 재고 충돌'로 인식", !!realNullLotError && isNullLotBalanceUniqueError(realNullLotError) && !isNullLotBalanceUniqueError(realLotError) && !!realLotError,
      `비LOT 오류 ${(realNullLotError as { code?: string })?.code} meta=${meta(realNullLotError)} → 분류 ${isNullLotBalanceUniqueError(realNullLotError)} | LOT 중복 meta=${meta(realLotError)} → 분류 ${isNullLotBalanceUniqueError(realLotError)}`)
    const N5b = await mkCtx("NB5b")
    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => mkRow(N5b, null)))
    record("NB05b", "동시 INSERT 10건(같은 비LOT 키): 정확히 1건만 성공, 나머지 9건은 P2002", settled.filter((s) => s.status === "fulfilled").length === 1 && settled.filter((s) => s.status === "rejected" && isNullLotBalanceUniqueError((s as PromiseRejectedResult).reason)).length === 9 && (await nullRows(N5b.tenant.id, N5b.plainRaw.id)).length === 1,
      `성공 ${settled.filter((s) => s.status === "fulfilled").length}, 비LOT 충돌 ${settled.filter((s) => s.status === "rejected" && isNullLotBalanceUniqueError((s as PromiseRejectedResult).reason)).length}`)
    // 서로 다른 lot / 서로 다른 품목은 영향 없음
    const lotY = await prisma.lot.create({ data: { tenantId: N5.tenant.id, itemId: N5.plainRaw.id, lotNo: "NB5-LOT2", status: "ACTIVE" } })
    const okLot = await mkRow(N5, lotY.id).then(() => true, () => false)
    record("NB05c", "LOT 재고 행은 기존 4필드 unique 로 계속 독립(다른 LOT 는 추가 가능, 비LOT 행과 공존)", okLot && (await prisma.inventoryBalance.count({ where: { tenantId: N5.tenant.id, itemId: N5.plainRaw.id } })) === 3, `총 행 ${await prisma.inventoryBalance.count({ where: { tenantId: N5.tenant.id, itemId: N5.plainRaw.id } })}`)

    // NB06 서로 다른 창고 독립
    const N6 = await mkCtx("NB6")
    const wh2 = await prisma.warehouse.create({ data: { tenantId: N6.tenant.id, siteId: N6.site.id, code: "WH2", name: "WH2" } })
    const o6 = await newPO(N6, [{ itemId: N6.plainRaw.id, qty: 100 }])
    const [w1r, w2r] = await Promise.all([receive(N6, o6, o6.items[0], { r: 30, a: 30, j: 0 }), receive(N6, o6, o6.items[0], { r: 20, a: 20, j: 0, wh: wh2.id })])
    const rw1 = await nullRows(N6.tenant.id, N6.plainRaw.id, N6.warehouse.id), rw2 = await nullRows(N6.tenant.id, N6.plainRaw.id, wh2.id)
    record("NB06", "서로 다른 창고 재고는 독립 관리(각 1건: 30 / 20)", w1r.success && w2r.success && rw1.length === 1 && rw2.length === 1 && D(rw1[0].qtyOnHand) === 30 && D(rw2[0].qtyOnHand) === 20, `창고1 ${rw1.length}행/${D(rw1[0]?.qtyOnHand)}, 창고2 ${rw2.length}행/${D(rw2[0]?.qtyOnHand)}`)

    // NB07 서로 다른 tenant 독립 (동시)
    const N7a = await mkCtx("NB7a"), N7b = await mkCtx("NB7b")
    const o7a = await newPO(N7a, [{ itemId: N7a.plainRaw.id, qty: 100 }]), o7b = await newPO(N7b, [{ itemId: N7b.plainRaw.id, qty: 100 }])
    const [t7a, t7b] = await Promise.all([receive(N7a, o7a, o7a.items[0], { r: 40, a: 40, j: 0 }), receive(N7b, o7b, o7b.items[0], { r: 60, a: 60, j: 0 })])
    const ra = await nullRows(N7a.tenant.id, N7a.plainRaw.id), rb = await nullRows(N7b.tenant.id, N7b.plainRaw.id)
    record("NB07", "서로 다른 tenant 재고는 독립(동일 코드의 품목·창고라도 각 tenant 1건: 40 / 60)", t7a.success && t7b.success && ra.length === 1 && rb.length === 1 && D(ra[0].qtyOnHand) === 40 && D(rb[0].qtyOnHand) === 60, `A ${ra.length}행/${D(ra[0]?.qtyOnHand)}, B ${rb.length}행/${D(rb[0]?.qtyOnHand)}`)

    // NB08 LOT 품목 회귀
    const N8 = await mkCtx("NB8")
    const o8 = await newPO(N8, [{ itemId: N8.lotRaw.id, qty: 500 }])
    const l1 = await receive(N8, o8, o8.items[0], { r: 10, a: 10, j: 0, lotNo: "NB8-A" })
    const lc = await Promise.all(Array.from({ length: 6 }, () => receive(N8, o8, o8.items[0], { r: 5, a: 5, j: 0, lotNo: "NB8-A" })))
    const l2 = await receive(N8, o8, o8.items[0], { r: 7, a: 7, j: 0, lotNo: "NB8-B" })
    const lotRows = await prisma.inventoryBalance.findMany({ where: { tenantId: N8.tenant.id, itemId: N8.lotRaw.id }, include: { lot: true } })
    const byLot = Object.fromEntries(lotRows.map((r) => [r.lot?.lotNo ?? "NULL", D(r.qtyOnHand)]))
    record("NB08", "LOT 품목 입고 회귀: 같은 LOT 동시 입고는 한 행에 합산(NB8-A=40), 다른 LOT 는 분리(NB8-B=7), 비LOT 행 없음",
      l1.success && lc.every((r) => r.success) && l2.success && lotRows.length === 2 && byLot["NB8-A"] === 40 && byLot["NB8-B"] === 7 && (await nullRows(N8.tenant.id, N8.lotRaw.id)).length === 0, `행 ${lotRows.length} ${JSON.stringify(byLot)}`)

    // NB09/NB10 멱등성 (비LOT) — 행·수량
    const N9 = await mkCtx("NB9")
    const o9 = await newPO(N9, [{ itemId: N9.plainRaw.id, qty: 500 }])
    const rid = ids.generateReceivingRequestId()
    const s1 = await receive(N9, o9, o9.items[0], { r: 25, a: 25, j: 0, requestId: rid })
    const s2 = await receive(N9, o9, o9.items[0], { r: 25, a: 25, j: 0, requestId: rid })
    const r9 = await nullRows(N9.tenant.id, N9.plainRaw.id)
    record("NB09", "동일 요청 반복(순차): 재고 행 1건·25 (두 번째는 replayed)", s1.success && s2.success && (s2 as { replayed?: boolean }).replayed === true && r9.length === 1 && D(r9[0].qtyOnHand) === 25, `행 ${r9.length}, 수량 ${D(r9[0]?.qtyOnHand)}`)
    const N10 = await mkCtx("NB10")
    const o10 = await newPO(N10, [{ itemId: N10.plainRaw.id, qty: 500 }])
    const rid10 = ids.generateReceivingRequestId()
    const c10 = await Promise.all(Array.from({ length: 10 }, () => receive(N10, o10, o10.items[0], { r: 25, a: 25, j: 0, requestId: rid10 })))
    const r10 = await nullRows(N10.tenant.id, N10.plainRaw.id)
    record("NB10", "동일 요청 10건 동시: 재고 행 1건·25, 입고검사 1건", c10.every((r) => r.success) && r10.length === 1 && D(r10[0].qtyOnHand) === 25 && (await inspCount(o10.items[0].id)) === 1, `성공 ${c10.filter((r) => r.success).length}/10, 행 ${r10.length}, 수량 ${D(r10[0]?.qtyOnHand)}, 검사이력 ${await inspCount(o10.items[0].id)}`)

    // NB11 거래번호 중복 없음 (위 시나리오들의 테넌트 전부)
    const tens = [N1, N3, N4, N6, N7a, N7b, N8, N9, N10]
    const uq = await Promise.all(tens.map((c) => uniqueTxNos(c.tenant.id)))
    const contig = await Promise.all(tens.map(async (c) => isContiguous((await receiptNos(c.tenant.id)))))
    record("NB11", "입고거래번호: 위 시나리오 9개 tenant 모두 중복 없음·0001부터 연속", uq.every((u) => u.total === u.distinct) && contig.every(Boolean), `tenant별 (건수/고유) ${uq.map((u) => `${u.total}/${u.distinct}`).join(" ")}, 연속 ${contig.every(Boolean)}`)

    // NB12 최초 재고 생성 후 오류 → 행 생성까지 롤백, 같은 요청 ID 로 재시도 성공
    const N12 = await mkCtx("NB12")
    const o12 = await newPO(N12, [{ itemId: N12.plainRaw.id, qty: 100 }])
    const rid12 = ids.generateReceivingRequestId()
    const real12 = testProfile.id
    testProfile.id = "no-such-profile" // 재고 행 생성·수불 기록 이후 감사로그 FK 위반
    const f12 = await receive(N12, o12, o12.items[0], { r: 40, a: 40, j: 0, requestId: rid12 })
    testProfile.id = real12
    const after12 = { rows: (await nullRows(N12.tenant.id, N12.plainRaw.id)).length, tx: await txCount(N12.tenant.id), rq: await rqCount(N12.tenant.id), insp: await inspCount(o12.items[0].id) }
    const retry12 = await receive(N12, o12, o12.items[0], { r: 40, a: 40, j: 0, requestId: rid12 })
    const fin12 = await nullRows(N12.tenant.id, N12.plainRaw.id)
    record("NB12", "최초 재고 생성 후 오류: 재고 행·수불·요청원장·검사이력 전부 롤백 → 같은 요청 ID 재시도는 정상 처리(행 1건·40)",
      !f12.success && after12.rows === 0 && after12.tx === 0 && after12.rq === 0 && after12.insp === 0 && retry12.success && fin12.length === 1 && D(fin12[0].qtyOnHand) === 40,
      `실패 후 행=${after12.rows} 수불=${after12.tx} 요청원장=${after12.rq} 검사이력=${after12.insp} | 재시도 ${retry12.success} 행=${fin12.length} 수량=${D(fin12[0]?.qtyOnHand)}`)

    // NB13 재고 ↔ 수불 원장 (초기 재고 + 거래 유형별 부호) — 입고 + 출고 + 재고조정 + 초기재고 시드
    const N13 = await mkCtx("NB13")
    const OPENING = 25 // 수불 없이 시드한 초기 재고 (원장에 없는 수량 → 기초재고로 반영해야 함)
    const seed = await prisma.inventoryBalance.create({ data: { tenantId: N13.tenant.id, siteId: N13.site.id, warehouseId: N13.warehouse.id, itemId: N13.plainRaw.id, lotId: null, qtyOnHand: OPENING, qtyAvailable: OPENING, qtyHold: 0 } })
    const o13 = await newPO(N13, [{ itemId: N13.plainRaw.id, qty: 500 }])
    await receive(N13, o13, o13.items[0], { r: 100, a: 100, j: 0 }) // +100 (기존 시드 행에 합산돼야 함)
    await receive(N13, o13, o13.items[0], { r: 40, a: 30, j: 10 })  // +30 (불합격 10 은 재고 제외)
    use(N13)
    const wo13 = await prisma.workOrder.create({ data: { tenantId: N13.tenant.id, siteId: N13.site.id, itemId: N13.fg.id, bomId: N13.bom.id, routingId: N13.routing.id, orderNo: uniq("WO13"), manufacturingNo: uniq("MFG13"), plannedQty: 50, status: "IN_PROGRESS", operations: { create: [{ routingOperationId: N13.routingOperation.id, seq: 10, plannedQty: 50, status: "IN_PROGRESS", startedAt: new Date() }] } } })
    await prisma.bOMItem.create({ data: { bomId: N13.bom.id, componentItemId: N13.plainRaw.id, seq: 20, qtyPer: 1, scrapRate: 0 } })
    const iss13 = await als.run({ tenantId: N13.tenant.id }, () => issue.issueMaterialsForWorkOrder({ workOrderId: wo13.id, siteId: N13.site.id, items: [{ itemId: N13.plainRaw.id, warehouseId: N13.warehouse.id, issueQty: 35, requiredQty: 50, reservationId: null }] }, N13.tenant.id))
    const adj13 = await als.run({ tenantId: N13.tenant.id }, () => inv.adjustInventoryStock({ balanceId: seed.id, physicalQty: 100, reason: "NB13 실사 조정" }))
    const rows13 = await nullRows(N13.tenant.id, N13.plainRaw.id)
    const txs13 = await prisma.inventoryTransaction.findMany({ where: { tenantId: N13.tenant.id, itemId: N13.plainRaw.id } })
    const SIGN: Record<string, number> = { RECEIPT: 1, ISSUE: -1, ADJUST: 1 /* 조정은 실사-현재고 차이를 부호 포함으로 저장 */ }
    const unhandled = Array.from(new Set(txs13.map((t) => t.txType))).filter((t) => !(t in SIGN))
    const ledger = txs13.reduce((s, t) => s + (SIGN[t.txType] ?? 0) * D(t.qty), 0)
    const expected = OPENING + ledger
    const types = Array.from(new Set(txs13.map((t) => t.txType))).sort().join(",")
    record("NB13", "재고 ↔ 수불 원장(기초재고 25 + 입고 130 − 출고 35 ± 재고조정): 행 1건, 재고 = 기초 + 부호 합계. 처리하지 못한 거래 유형이 있으면 PASS 불가",
      unhandled.length === 0 && iss13.ok && adj13.success && rows13.length === 1 && D(rows13[0].qtyOnHand) === expected && D(rows13[0].qtyOnHand) === 100,
      `행 ${rows13.length}, 재고 ${D(rows13[0]?.qtyOnHand)}, 기초 ${OPENING} + 원장 ${ledger} = ${expected}, 거래유형 [${types}], 미처리 유형 [${unhandled.join(",") || "없음"}], 출고 ok=${iss13.ok}${iss13.error ? " " + iss13.error : ""}, 조정 ok=${adj13.success}${adj13.error ? " " + adj13.error : ""} | 검증 범위: RECEIPT·ISSUE·ADJUST(+기초재고). 미검증: RETURN·SUPPLIER_RETURN·TRANSFER·SCRAP·출하`)
  }

  {
    // NB15 입고 + 출고 + 재고조정 혼합 동시 부하: 교착(deadlock)·직렬화 오류 없음
    const N15 = await mkCtx("NB15")
    await prisma.bOMItem.create({ data: { bomId: N15.bom.id, componentItemId: N15.plainRaw.id, seq: 20, qtyPer: 1, scrapRate: 0 } })
    const base = await newPO(N15, [{ itemId: N15.plainRaw.id, qty: 100000 }])
    await receive(N15, base, base.items[0], { r: 5000, a: 5000, j: 0 })
    const wos = []
    for (let k = 0; k < 5; k++) wos.push(await prisma.workOrder.create({ data: { tenantId: N15.tenant.id, siteId: N15.site.id, itemId: N15.fg.id, bomId: N15.bom.id, routingId: N15.routing.id, orderNo: uniq("WO15"), manufacturingNo: uniq("MFG15"), plannedQty: 100, status: "IN_PROGRESS", operations: { create: [{ routingOperationId: N15.routingOperation.id, seq: 10, plannedQty: 100, status: "IN_PROGRESS", startedAt: new Date() }] } } }))
    const balance = await prisma.inventoryBalance.findFirstOrThrow({ where: { tenantId: N15.tenant.id, itemId: N15.plainRaw.id, lotId: null } })
    const orders = []
    for (let k = 0; k < 12; k++) orders.push(await newPO(N15, [{ itemId: N15.plainRaw.id, qty: 100 }]))
    const errors: string[] = []
    const origErr = console.error
    console.error = (...a: unknown[]) => { errors.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x))).join(" ")) }
    let out: Array<{ kind: string; ok: boolean; msg: string }> = []
    try {
      const jobs: Array<Promise<{ kind: string; ok: boolean; msg: string }>> = []
      orders.forEach((o) => jobs.push(receive(N15, o, o.items[0], { r: 20, a: 20, j: 0 }).then((r) => ({ kind: "RECEIVE", ok: r.success, msg: r.message ?? "" }))))
      wos.forEach((w, k) => { for (let j = 0; j < 3; j++) jobs.push(als.run({ tenantId: N15.tenant.id }, () => issue.issueMaterialsForWorkOrder({ workOrderId: w.id, siteId: N15.site.id, items: [{ itemId: N15.plainRaw.id, warehouseId: N15.warehouse.id, issueQty: 5 + k, requiredQty: 100, reservationId: null }] }, N15.tenant.id)).then((r) => ({ kind: "ISSUE", ok: r.ok, msg: r.error ?? "" }))) })
      for (let k = 0; k < 4; k++) jobs.push(als.run({ tenantId: N15.tenant.id }, () => inv.adjustInventoryStock({ balanceId: balance.id, physicalQty: 4000 + k * 10, reason: `NB15 조정 ${k}` })).then((r) => ({ kind: "ADJUST", ok: r.success, msg: r.error ?? "" })))
      out = await Promise.all(jobs)
    } finally { console.error = origErr }
    const log = errors.join("\n") + "\n" + out.map((o) => o.msg).join("\n")
    const deadlocks = (log.match(/deadlock detected|40P01|P2034|could not serialize/gi) ?? []).length
    const failedKinds = out.filter((o) => !o.ok).reduce<Record<string, number>>((m, o) => { m[o.kind] = (m[o.kind] ?? 0) + 1; return m }, {})
    const unexpected = out.filter((o) => !o.ok && !/중복이 반복|재고조정|동시|다른 작업으로/.test(o.msg))
    const rows15 = await nullRows(N15.tenant.id, N15.plainRaw.id)
    const txs15 = await prisma.inventoryTransaction.findMany({ where: { tenantId: N15.tenant.id, itemId: N15.plainRaw.id } })
    const unhandled15 = Array.from(new Set(txs15.map((t) => t.txType))).filter((t) => !["RECEIPT", "ISSUE", "ADJUST"].includes(t))
    const ledger15 = txs15.reduce((s, t) => s + ({ RECEIPT: 1, ISSUE: -1, ADJUST: 1 } as Record<string, number>)[t.txType] * D(t.qty), 0)
    record("NB15", "입고+출고+재고조정 혼합 동시 부하(12+15+4건): 교착/직렬화 오류 0, 재고 행 1건, 재고 = 수불 원장 합계(초기재고 포함)",
      deadlocks === 0 && unexpected.length === 0 && rows15.length === 1 && unhandled15.length === 0 && D(rows15[0].qtyOnHand) === ledger15,
      `작업 ${out.length}건, 성공 ${out.filter((o) => o.ok).length}, 실패 ${JSON.stringify(failedKinds)}, 교착·직렬화 오류 ${deadlocks}건, 예상 밖 실패 ${unexpected.length}건${unexpected[0] ? ` (예: ${unexpected[0].kind} ${unexpected[0].msg.slice(0, 50)})` : ""}, 행 ${rows15.length}, 재고 ${D(rows15[0]?.qtyOnHand)} vs 원장 ${ledger15}`)
  }

  {
    // NB16 실제 P2002 오류 객체 주입: 비LOT 재고 충돌로 확인된 경우에만 재시도
    const N16 = await mkCtx("NB16")
    const capture = await mkCtx("NB16cap")
    await prisma.inventoryBalance.create({ data: { tenantId: capture.tenant.id, siteId: capture.site.id, warehouseId: capture.warehouse.id, itemId: capture.plainRaw.id, lotId: null, qtyOnHand: 1, qtyAvailable: 1, qtyHold: 0 } })
    let realErr: unknown = null
    try { await prisma.inventoryBalance.create({ data: { tenantId: capture.tenant.id, siteId: capture.site.id, warehouseId: capture.warehouse.id, itemId: capture.plainRaw.id, lotId: null, qtyOnHand: 1, qtyAvailable: 1, qtyHold: 0 } }) } catch (e) { realErr = e }
    const lotCap = await prisma.lot.create({ data: { tenantId: capture.tenant.id, itemId: capture.plainRaw.id, lotNo: "NB16-LOT", status: "ACTIVE" } })
    await prisma.inventoryBalance.create({ data: { tenantId: capture.tenant.id, siteId: capture.site.id, warehouseId: capture.warehouse.id, itemId: capture.plainRaw.id, lotId: lotCap.id, qtyOnHand: 1, qtyAvailable: 1, qtyHold: 0 } })
    let realLotErr: unknown = null
    try { await prisma.inventoryBalance.create({ data: { tenantId: capture.tenant.id, siteId: capture.site.id, warehouseId: capture.warehouse.id, itemId: capture.plainRaw.id, lotId: lotCap.id, qtyOnHand: 1, qtyAvailable: 1, qtyHold: 0 } }) } catch (e) { realLotErr = e }
    const client = prisma as unknown as { $transaction: (...a: unknown[]) => Promise<unknown> }
    const withFirstFailure = async (err: unknown, label: string) => {
      const o = await newPO(N16, [{ itemId: N16.plainRaw.id, qty: 100 }])
      const realTx = client.$transaction.bind(prisma)
      let calls = 0
      client.$transaction = (...a: unknown[]) => { calls += 1; return calls === 1 ? Promise.reject(err) : (realTx as (...x: unknown[]) => Promise<unknown>)(...a) }
      const origErr = console.error; console.error = () => {}
      let r: Awaited<ReturnType<typeof receive>>
      try { r = await receive(N16, o, o.items[0], { r: 10, a: 10, j: 0 }) } finally { client.$transaction = realTx; console.error = origErr }
      const stock16 = (await stock(N16.tenant.id, N16.plainRaw.id)).onHand
      return { label, calls, success: r.success, outcome: r.outcome, insp: await inspCount(o.items[0].id), stock16 }
    }
    const before16 = (await stock(N16.tenant.id, N16.plainRaw.id)).onHand
    const pos = await withFirstFailure(realErr, "비LOT 재고 P2002(실제 오류 객체)")
    const negLot = await withFirstFailure(realLotErr, "LOT 재고 P2002(실제 오류 객체)")
    const negOther = await withFirstFailure(new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`tenantId`,`code`)", { code: "P2002", clientVersion: "5.22.0", meta: { modelName: "Item", target: ["tenantId", "code"] } }), "다른 모델 P2002")
    const negUnknown = await withFirstFailure(Object.assign(new Error("Server has closed the connection."), { name: "PrismaClientUnknownRequestError" }), "결과 불명 오류")
    record("NB16", "P2002 재시도: 실제 비LOT 재고 충돌 오류만 재시도(2회 호출·입고 1회분), LOT 충돌·다른 모델 P2002·결과 불명은 재시도하지 않음(1회 호출)",
      pos.calls === 2 && pos.success && pos.insp === 1 && pos.stock16 === before16 + 10 && negLot.calls === 1 && !negLot.success && negOther.calls === 1 && !negOther.success && negUnknown.calls === 1 && negUnknown.outcome === "UNKNOWN",
      [pos, negLot, negOther, negUnknown].map((x) => `${x.label}: 호출 ${x.calls}회 ${x.success ? "성공" : "실패" + (x.outcome ? `(${x.outcome})` : "")}`).join(" | "))
  }

  // ── 요약 ──
  const summary = rows.map((r) => `${r.status}\t${r.id}\t${r.title}\t${r.detail}`).join("\n")
  writeFileSync(process.env.DAEWON_TEST_DB_RESULT_FILE ?? "db-test-result.tsv", summary, "utf8")
  console.log(`\n== ${rows.filter((r) => r.status === "PASS").length} PASS / ${rows.filter((r) => r.status === "FAIL").length} FAIL ==`)
}

main()
  .catch((e) => { console.error("TEST HARNESS ERROR:", e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
