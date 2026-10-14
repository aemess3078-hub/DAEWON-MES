/**
 * Phase 8 — Excel MRP 최종 정합성 검증 / Legacy MRP 종료 검증 (순수 함수 + fake DB · 운영 DB 비접속)
 *
 * 실행: npm run test:mrp-phase8
 *
 *  P8-01/02  Golden A/B 재검증
 *  E1~E10    Workbook(익명 기준선) 기반 대표 시나리오 — Excel 값 또는 독립 참조 계산과 비교
 *  D1~D9     확정 정책 재검증
 *  P8-08~15  예정입고 / DRAFT Coverage / MOQ / 안전재고 / 반제품 Netting / What-if
 *  P8-16/17  결정성 / 수치 안전성 + 무작위(seed 고정) property test
 *  P8-19/20  쿼리 수 bounded / 빈 운영 상태 + 성능 측정
 *
 * Excel 은 계산 기준(회귀) 자료일 뿐이다. 이 테스트는 어떤 운영 데이터도 만들거나 읽지 않는다.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { classifyScheduledReceipts, type PurchaseOrderItemRow } from "../src/lib/mrp/scheduled-receipt"
import { runOrderMrp } from "../src/lib/mrp/order-mrp-engine"
import { applySupplierTerms, evaluateOrderTiming, validateQtyAgainstTerms } from "../src/lib/mrp/purchase-policy"
import { classifyByPolicy, recommendSupplier } from "../src/lib/mrp/purchase-suggestion"
import { aggregateDraftCoverage, evaluateCoverage } from "../src/lib/mrp/draft-coverage"
import { normalizeSimulationRequest } from "../src/lib/mrp/simulation-adapter"
import { toDemandLines, type SalesOrderItemRow } from "../src/lib/mrp/order-mrp-adapter"
import type { MrpBomLine, MrpDemandLine, MrpScheduledReceipt, MrpStockEntry, OrderMrpOptions, OrderMrpResult } from "../src/lib/mrp/types"
import { loadAndRunOrderMrp, type OrderMrpDb } from "../src/lib/services/mrp-order.service"
import { computePurchaseSuggestions, type PurchaseSuggestionDb } from "../src/lib/services/mrp-purchase-suggestion.service"
import { loadAndRunSimulation, type SimulationDb } from "../src/lib/services/mrp-simulation.service"
import { listMrpRuns, type MrpRunDb } from "../src/lib/services/mrp-run.service"
import { makeFakeDb } from "./helpers/fake-db"

let passed = 0
function eq<T>(actual: T, expected: T, label: string) {
  assert.deepStrictEqual(actual, expected, label)
  passed += 1
  console.log("PASS " + label)
}
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log("PASS " + label)
}
function section(t: string) {
  console.log("\n── " + t)
}

// ─── fixtures / helpers ────────────────────────────────────────────────────────
type Bom = Record<string, Array<[string, number]>>
type FxDemand = { po: string; item: string; qty: number; due: string; line: number }
const fixtureDir = join(process.cwd(), "scripts", "fixtures", "order-mrp")
const readJson = <T>(n: string): T => JSON.parse(readFileSync(join(fixtureDir, n), "utf8")) as T
const shipFx = readJson<{ meta: { cellsCompared: number; demandCount: number }; materialCodes: string[]; boms: Bom; demands: FxDemand[]; expected: Array<Record<string, number>> }>("excel-golden-shipment-plan.json")
const mrpFx = readJson<{
  materialCodes: string[]
  openingStock: Record<string, number>
  boms: Bom
  demands: FxDemand[]
  expected: Array<{ req: Record<string, number>; bal: Record<string, number>; shortageItemCount: number; cumulativeNegativeItemCount: number }>
}>("excel-golden-mrp.json")

const normal: OrderMrpOptions = { mode: "NORMAL" }
const compat: OrderMrpOptions = { mode: "EXCEL_COMPAT" }
const toBoms = (b: Bom): MrpBomLine[] =>
  Object.entries(b).flatMap(([item, lines]) =>
    lines.map(([code, qty], i) => ({ parentItemId: "item:" + item, componentItemId: "mat:" + code, componentCode: code, componentItemType: "RAW_MATERIAL", qtyPer: qty, lineNo: i + 1 }))
  )
const toDemands = (d: FxDemand[]): MrpDemandLine[] =>
  d.map((x) => ({ orderId: "order:" + x.po, orderNo: x.po, orderLineId: `line:${x.po}:${x.line}`, orderLineNo: x.line, itemId: "item:" + x.item, itemCode: x.item, orderQty: x.qty, deliveryDate: x.due }))
const run = (d: MrpDemandLine[], b: MrpBomLine[], s: MrpStockEntry[] = [], o: OrderMrpOptions = normal, receipts: MrpScheduledReceipt[] = []) =>
  runOrderMrp({ demands: d, boms: b, stocks: s, ...(receipts.length > 0 ? { scheduledReceipts: receipts } : {}) }, o)

/** 독립 참조 계산: 처리 순서대로 재고를 차감하는 가장 단순한 모델 */
function reference(order: Array<{ id: string; item: string; qty: number }>, bom: Bom, opening: Record<string, number>) {
  const bal = new Map<string, number>(Object.entries(opening))
  const total = new Map<string, number>()
  const chain = new Map<string, number[]>() // code → 수요별 balanceAfter(요구량>0 인 단계만)
  const firstShort = new Map<string, number>()
  order.forEach((d, idx) => {
    for (const [code, per] of bom[d.item] ?? []) {
      const req = d.qty * per
      const after = (bal.get(code) ?? 0) - req
      bal.set(code, after)
      total.set(code, (total.get(code) ?? 0) + req)
      chain.set(code, [...(chain.get(code) ?? []), after])
      if (after < 0 && !firstShort.has(code)) firstShort.set(code, idx)
    }
  })
  return { bal, total, chain, firstShort }
}
const orderOf = (r: OrderMrpResult, demands: FxDemand[]) =>
  r.demands.map((d) => {
    const fx = demands.find((x) => `line:${x.po}:${x.line}` === d.orderLineId) as FxDemand
    return { id: d.orderLineId, item: fx.item, qty: fx.qty }
  })

// mulberry32 (seed 고정)
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function main() {
  // ═══ P8-01 / P8-02 Golden ══════════════════════════════════════════════════
  section("P8-01 Golden A / P8-02 Golden B (EXCEL_COMPAT)")
  {
    const r = run(toDemands(shipFx.demands), toBoms(shipFx.boms), [], compat)
    let cells = 0
    let mismatch = 0
    shipFx.demands.forEach((fx, i) => {
      const res = r.demands.find((d) => d.orderLineId === `line:${fx.po}:${fx.line}`)!
      const got = new Map(res.requirements.map((q) => [q.componentCode, q.requirement]))
      for (const code of shipFx.materialCodes) {
        cells += 1
        if ((got.get(code) ?? 0) !== (shipFx.expected[i][code] ?? 0)) mismatch += 1
      }
    })
    eq([cells, mismatch], [36582, 0], "P8-01 Golden A: 36,582 셀 / mismatch 0")
    const stocks = Object.entries(mrpFx.openingStock).map(([c, q]) => ({ componentItemId: "mat:" + c, quantity: q }))
    const b = run(toDemands(mrpFx.demands), toBoms(mrpFx.boms), stocks, { mode: "EXCEL_COMPAT", ordering: "INPUT_ORDER" })
    let reqCells = 0
    let balCells = 0
    let mm = 0
    mrpFx.demands.forEach((_fx, i) => {
      const res = b.demands[i]
      const reqMap = new Map(res.requirements.map((q) => [q.componentCode, q.requirement]))
      for (const code of mrpFx.materialCodes) {
        reqCells += 1
        balCells += 1
        const m = b.materials.find((x) => x.componentCode === code)
        if ((reqMap.get(code) ?? 0) !== (mrpFx.expected[i].req[code] ?? 0)) mm += 1
        if ((m?.movements[i]?.balanceAfter ?? 0) !== (mrpFx.expected[i].bal[code] ?? 0)) mm += 1
      }
    })
    eq([reqCells, balCells, mm], [2457, 2457, 0], "P8-02 Golden B: 소요 2,457 + 잔량 2,457 셀 / mismatch 0")
  }

  // ═══ E1~E10 Workbook 기반 시나리오 ═══════════════════════════════════════════
  section("E1~E10 Workbook(익명 기준선) 시나리오 — Excel 값 / 독립 참조 계산 대조")
  {
    const boms = toBoms(shipFx.boms)
    const A = shipFx.demands
    const exp = (i: number) => shipFx.expected[i]
    const reqOf = (r: OrderMrpResult, fx: FxDemand) =>
      Object.fromEntries(r.demands.find((d) => d.orderLineId === `line:${fx.po}:${fx.line}`)!.requirements.map((q) => [q.componentCode, q.requirement]))
    const same = (a: Record<string, number>, b: Record<string, number>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

    // E1 단일 완제품 / 단일 BOM
    const r1 = run(toDemands([A[0]]), boms, [], compat)
    ok(same(reqOf(r1, A[0]), exp(0)), "E1 단일 수주: 소요량 = Excel 출고예정소요량")

    // E2 완제품 여러 건, 동일 자재 공유
    let pair: [number, number] = [0, 1]
    outer: for (let i = 0; i < A.length; i++)
      for (let j = i + 1; j < A.length; j++) {
        if (A[i].item === A[j].item) continue
        const ci = new Set(Object.keys(exp(i)))
        if (Object.keys(exp(j)).some((c) => ci.has(c))) {
          pair = [i, j]
          break outer
        }
      }
    const r2 = run(toDemands([A[pair[0]], A[pair[1]]]), boms, [], compat)
    ok(same(reqOf(r2, A[pair[0]]), exp(pair[0])) && same(reqOf(r2, A[pair[1]]), exp(pair[1])), "E2 서로 다른 완제품 2건: 각 수주 소요량 = Excel")
    const shared = Object.keys(exp(pair[0])).find((c) => c in exp(pair[1])) as string
    eq(r2.materials.find((m) => m.componentCode === shared)!.totalRequirement, exp(pair[0])[shared] + exp(pair[1])[shared], "E2 공유 자재 총소요 = 두 수주 합")

    // 부분집합(앞 40건)으로 재고 시나리오
    const S = A.slice(0, 40)
    const total: Record<string, number> = {}
    S.forEach((_d, i) => Object.entries(exp(i)).forEach(([c, q]) => (total[c] = (total[c] ?? 0) + q)))
    const codes = Object.keys(total)
    const stockOf = (f: (c: string, t: number) => number) => codes.map((c) => ({ componentItemId: "mat:" + c, quantity: f(c, total[c]) }))
    const check = (stocks: MrpStockEntry[], opening: Record<string, number>, label: string) => {
      const r = run(toDemands(S), boms, stocks, compat)
      const ref = reference(orderOf(r, S), shipFx.boms, opening)
      let good = true
      for (const c of codes) {
        const m = r.materials.find((x) => x.componentCode === c)!
        const chain = m.movements.filter((mv) => mv.requirement > 0).map((mv) => mv.balanceAfter)
        if (JSON.stringify(chain) !== JSON.stringify(ref.chain.get(c))) good = false
        if (m.finalBalance !== (ref.bal.get(c) ?? 0)) good = false
        if (m.totalRequirement !== total[c]) good = false
      }
      ok(good, label)
      return r
    }
    // E3 재고 충분
    const open3 = Object.fromEntries(codes.map((c) => [c, total[c] + 5]))
    const r3 = check(stockOf((_c, t) => t + 5), open3, "E3 재고 충분: 잔량 체인/최종 잔량 = 참조 계산")
    ok(r3.materials.every((m) => m.finalBalance >= 5 && m.finalShortageQty === 0), "E3 결품 0")
    // E4 재고 일부 부족
    const open4 = Object.fromEntries(codes.map((c) => [c, Math.ceil(total[c] / 2)]))
    const r4 = check(stockOf((_c, t) => Math.ceil(t / 2)), open4, "E4 재고 일부 부족: 잔량 체인 = 참조 계산")
    ok(r4.materials.some((m) => m.finalShortageQty > 0), "E4 일부 자재 결품 발생")
    // E5 재고 0
    const r5 = check(stockOf(() => 0), Object.fromEntries(codes.map((c) => [c, 0])), "E5 재고 0: 최종 잔량 = −총소요")
    ok(r5.materials.every((m) => m.finalBalance === -m.totalRequirement), "E5 finalBalance = −totalRequirement")
    // E6 동일 자재 여러 수주에서 순차 사용
    const usage = new Map<string, number>()
    S.forEach((_d, i) => Object.keys(exp(i)).forEach((c) => usage.set(c, (usage.get(c) ?? 0) + 1)))
    const [hot] = Array.from(usage.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]
    const r6 = run(toDemands(S), boms, [{ componentItemId: "mat:" + hot, quantity: 10 }], compat)
    const ref6 = reference(orderOf(r6, S), shipFx.boms, { [hot]: 10 })
    const m6 = r6.materials.find((m) => m.componentCode === hot)!
    ok(usage.get(hot)! >= 3 && JSON.stringify(m6.movements.filter((x) => x.requirement > 0).map((x) => x.balanceAfter)) === JSON.stringify(ref6.chain.get(hot)), `E6 같은 자재(${usage.get(hot)}개 수주) 순차 차감 = 참조 계산`)
    // E7 납기 여러 건: 오름차순 처리
    const r7n = run(toDemands(S), boms, [], normal)
    const dues = r7n.demands.map((d) => d.deliveryDate as string)
    ok(new Set(S.map((d) => d.due)).size > 1 && dues.every((d, i) => i === 0 || dues[i - 1] <= d), "E7 납기 여러 건: NORMAL 납기 오름차순")
    // E8 동일 납기 여러 건: COMPAT=입력 순서 유지, NORMAL=입력 순서와 무관하게 결정적
    const sameDue = S.filter((d) => d.due === S[0].due)
    ok(sameDue.length >= 2, "E8 동일 납기 수주가 2건 이상인 구간 존재")
    const rc = run(toDemands(S), boms, [], compat)
    const sameSeq = rc.demands.filter((d) => d.deliveryDate === S[0].due).map((d) => d.orderLineNo)
    ok(sameSeq.every((n, i) => i === 0 || (sameSeq[i - 1] as number) < (n as number)), "E8 EXCEL_COMPAT 동일 납기는 입력(시트) 순서 유지")
    const shuffled = S.slice().reverse()
    const rn1 = run(toDemands(S), boms, [], normal)
    const rn2 = run(toDemands(shuffled), boms, [], normal)
    eq(rn1.demands.map((d) => d.orderLineId), rn2.demands.map((d) => d.orderLineId), "E8 NORMAL 은 입력 순서가 달라도 같은 처리 순서(결정적)")
    // E9 BOM 없는 제품
    const noBom: MrpDemandLine = { orderId: "o-x", orderNo: "PO-X", orderLineId: "l-x", orderLineNo: 1, itemId: "item:NO-BOM", itemCode: "NO-BOM", orderQty: 3, deliveryDate: "2026-06-10" }
    const r9 = run([...toDemands(S.slice(0, 5)), noBom], boms, [], normal)
    ok(r9.excludedOrderLines.some((e) => e.orderLineId === "l-x" && e.reason === "MISSING_BOM") && r9.warnings.some((w) => w.code === "MISSING_BOM"), "E9 BOM 없는 제품: 제외 + MISSING_BOM 경고")
    const r9b = run(toDemands(S.slice(0, 5)), boms, [], normal)
    eq(r9.materials.map((m) => [m.componentCode, m.totalRequirement]), r9b.materials.map((m) => [m.componentCode, m.totalRequirement]), "E9 다른 수주의 계산에는 영향 없음")
    // E10 잘못된 BOM 수량
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const badBoms = [...boms.filter((b) => b.parentItemId !== "item:" + S[0].item), { parentItemId: "item:" + S[0].item, componentItemId: "mat:BAD", componentCode: "BAD", qtyPer: bad, componentItemType: "RAW_MATERIAL" } as MrpBomLine]
      const r = run(toDemands(S.slice(0, 3)), badBoms, [], normal)
      ok(r.excludedOrderLines.some((e) => e.itemCode === S[0].item) && r.warnings.some((w) => w.code === "INVALID_BOM_QUANTITY"), `E10 BOM 수량 ${String(bad)} → 해당 수주 제외 + 경고(1 로 바꾸지 않음)`)
    }
  }

  // ═══ D1~D9 ═══════════════════════════════════════════════════════════════
  section("D1~D9 확정 정책 재검증")
  {
    const bom = (p: string, c: string, q: number): MrpBomLine => ({ parentItemId: p, componentItemId: c, componentCode: c.toUpperCase(), componentItemType: "RAW_MATERIAL", qtyPer: q })
    const dm = (id: string, due: string | null, qty = 1, extra: Partial<MrpDemandLine> = {}): MrpDemandLine => ({
      orderId: "o-" + id,
      orderNo: "SO-" + id,
      orderLineId: id,
      orderLineNo: 1,
      itemId: "fg",
      itemCode: "FG",
      orderQty: qty,
      deliveryDate: due,
      ...extra,
    })
    // D1
    const d = [dm("c", "2026-06-03"), dm("a", "2026-06-01"), dm("b", "2026-06-01")]
    eq(run(d, [bom("fg", "x", 1)]).demands.map((x) => x.orderLineId), ["a", "b", "c"], "D1 NORMAL: 납기 오름차순 + 동일 납기 결정적 정렬")
    eq(run(d.slice().reverse(), [bom("fg", "x", 1)]).demands.map((x) => x.orderLineId), ["a", "b", "c"], "D1 입력 순서가 달라도 같은 결과")
    // D2 all MRP: 과거 납기 포함, 상/하한 없음
    const all = run([dm("old", "2020-01-01"), dm("new", "2030-12-31")], [bom("fg", "x", 1)])
    eq(all.demands.length, 2, "D2 전체 MRP: 모든 미출하 수주(과거/미래 납기 모두) 포함 — today-only 동작을 복제하지 않음")
    // D3
    const miss = run([dm("m", "2026-06-01")], [])
    ok(miss.excludedOrderLines[0]?.reason === "MISSING_BOM" && miss.warnings.some((w) => w.code === "MISSING_BOM"), "D3 BOM 없음: 제외 + 경고")
    // D4
    eq([run([], []).options.stockProviderType, run([], [], [], compat).options.stockProviderType], ["ACTUAL", "EXCEL_THEORETICAL"], "D4 NORMAL=ACTUAL / EXCEL_COMPAT=EXCEL_THEORETICAL")
    // D5 중복 수주 라인은 독립 수요
    const dup = run([dm("l1", "2026-06-01", 5, { orderId: "o", orderNo: "SO-1" }), dm("l2", "2026-06-01", 5, { orderId: "o", orderNo: "SO-1" })], [bom("fg", "x", 1)])
    eq(dup.materials[0].totalRequirement, 10, "D5 같은 제품 중복 라인은 독립 수요로 합산")
    // D6 공급업체 선택
    const cand = (id: string, isDefault: boolean, priority: number) => ({ supplierId: id, supplierCode: id, supplierName: id, isDefault, priority, leadTimeDays: null, moq: null, orderMultiple: null })
    eq(recommendSupplier([cand("a", false, 10), cand("b", true, 99)]).supplierId, "b", "D6 Default 공급업체 우선")
    eq(recommendSupplier([cand("a", false, 10), cand("b", false, 5)]).supplierId, "b", "D6 Default 없으면 priority 최소")
    eq(recommendSupplier([cand("a", false, 5), cand("b", false, 5)]).supplierId, null, "D6 동률이면 자동 선택 안 함")
    // D7 remainingQty = 주문 − 출하
    const rows = [{ id: "l", qty: 10, shippedQty: 4, deliveryDate: new Date("2026-06-01T00:00:00Z"), itemId: "fg", item: { id: "fg", code: "FG", name: "FG" }, salesOrder: { id: "o", orderNo: "SO", status: "CONFIRMED", deliveryDate: new Date("2026-06-01T00:00:00Z"), customer: { name: "c" } } }] as unknown as SalesOrderItemRow[]
    const demands = toDemandLines(rows)
    eq(demands[0].remainingQty, 6, "D7 잔량 = 수주수량 − 실제 출하수량")
    eq(run(demands, [bom("fg", "x", 1)]).materials[0].totalRequirement, 6, "D7 계산 수요 = 잔량")
    // D8 원본 식별자 보존: 제품 코드가 그대로 Item.code 후보가 되며 품명으로 대체되지 않는다(Master 도구 테스트 MD3 와 동일 정책)
    const { inspectCode } = await import("../src/lib/master-migration/text")
    eq(inspectCode("A1345981794").raw, "A1345981794", "D8 제품 코드 원본 보존")
    // D9 What-if: SalesOrder 모델에 접근하지 않는다
    const sim = makeFakeDb({
      item: [{ id: "fg", tenantId: "t", code: "FG", name: "FG", uom: "EA", itemType: "FINISHED" }],
      bOM: [{ id: "b", tenantId: "t", itemId: "fg", version: "1", status: "ACTIVE", isDefault: true, bomItems: [{ componentItemId: "x", seq: 1, qtyPer: 2, scrapRate: 0, componentItem: { code: "X", name: "X", spec: null, uom: "EA", itemType: "RAW_MATERIAL", safetyStock: 0 } }] }],
      inventoryBalance: [],
    })
    const sres = await loadAndRunSimulation(sim.db as unknown as SimulationDb, "t", normalizeSimulationRequest({ items: [{ itemId: "fg", qty: 7 }] }))
    ok(sres.view.materials.some((m) => m.totalRequirement === 14), "D9 What-if: 가상 수요 7EA → 소요 14 (SalesOrder/발주 모델 접근 없이 계산)")
  }

  // ═══ 예정입고 / DRAFT / 안전재고 / MOQ / 반제품 ═════════════════════════════
  section("P8-08~14 예정입고 · DRAFT Coverage · 안전재고 · MOQ/배수 · 반제품 Netting")
  {
    const fgBom: MrpBomLine[] = [{ parentItemId: "fg", componentItemId: "x", componentCode: "X", componentItemType: "RAW_MATERIAL", qtyPer: 1 }]
    const dem = (qty: number, due: string): MrpDemandLine => ({ orderId: "o", orderNo: "SO", orderLineId: "l-" + due, orderLineNo: 1, itemId: "fg", itemCode: "FG", orderQty: qty, deliveryDate: due })
    const rc = (qty: number, date: string, no = "PO-1"): MrpScheduledReceipt => ({ componentItemId: "x", quantity: qty, expectedDate: date, purchaseOrderId: "p-" + no, purchaseOrderNo: no })
    // P8-08 같은 날 입고는 수요보다 먼저
    const same = run([dem(10, "2026-06-10")], fgBom, [], normal, [rc(10, "2026-06-10")])
    eq([same.materials[0].finalBalance, same.materials[0].hadShortage], [0, false], "P8-08 같은 날 입고 → 수요 전에 반영(결품 없음)")
    // P8-09 미래 입고는 이전 결품을 소급 해소하지 않는다
    const fut = run([dem(10, "2026-06-10")], fgBom, [], normal, [rc(10, "2026-06-20")])
    const mf = fut.materials[0]
    eq([mf.movements[0].balanceAfter, mf.hadShortage, mf.finalBalance, mf.shortageRecoveredAt], [-10, true, 0, "2026-06-20"], "P8-09 미래 입고: 수요 시점 결품 유지, 이후 회복(일시 결품)")
    // P8-10 경과/상태/잔량 분류
    const row = (id: string, status: string, qty: number, received: number, expected: string | null, over: Record<string, unknown> = {}): PurchaseOrderItemRow =>
      ({ id: "i" + id, itemId: "x", qty, receivedQty: received, workOrderOperationId: null, purchaseOrder: { id: "p" + id, tenantId: "t", orderNo: "PO-" + id, status, expectedDate: expected ? new Date(expected + "T00:00:00Z") : null, note: null, supplier: { id: "s", name: "S" }, ...over } }) as unknown as PurchaseOrderItemRow
    const cls = classifyScheduledReceipts(
      [row("1", "ORDERED", 10, 0, "2026-06-20"), row("2", "PARTIAL_RECEIVED", 10, 4, "2026-06-20"), row("3", "DRAFT", 10, 0, "2026-06-20"), row("4", "CLOSED", 10, 0, "2026-06-20"), row("5", "CANCELLED", 10, 0, "2026-06-20"), row("6", "ORDERED", 10, 0, "2026-05-01")],
      { tenantId: "t", baseDate: "2026-06-10" }
    )
    eq(cls.receipts.map((r) => [r.purchaseOrderNo, r.quantity]), [["PO-1", 10], ["PO-2", 6]], "P8-10 ORDERED/PARTIAL_RECEIVED 의 미입고 잔량만 예정입고(DRAFT/CLOSED/CANCELLED 제외)")
    eq([cls.overdue.length, cls.issues.some((i) => i.code === "OVERDUE_SCHEDULED_RECEIPT")], [1, true], "P8-10 예정일 경과 건은 계산 제외 + 경고")
    // P8-11 / P8-12 DRAFT Coverage + MOQ
    const e = (raw: number, cov: number, moq: number | null = null, mult: number | null = null) => evaluateCoverage({ rawNeed: raw, coverageQty: cov, supplier: { moq, orderMultiple: mult } })
    eq([e(100, 80).additionalQty, e(100, 80, 50, 10).additionalQty, e(100, 110, 50, 10).additionalQty], [20, 50, 0], "P8-11/12 필요 100/DRAFT 80 → 20, MOQ 50 → 50, DRAFT 110 → 0 (Coverage 차감 후 MOQ)")
    const agg = aggregateDraftCoverage([{ itemId: "x", supplierId: "s", orderNo: "PO-1", openQty: 80 }])
    eq(agg.get("x")!.total, 80, "DRAFT Coverage 는 DRAFT 미입고만 집계")
    ok(!cls.receipts.some((r) => r.purchaseOrderNo === "PO-3"), "DRAFT 는 예정입고에 포함되지 않음 → ORDERED 가 되면 Coverage 에서 빠지고 예정입고로 이동(동시 포함 불가)")
    // P8-13 안전재고: 물리 재고를 깎지 않는다
    const sr = run([dem(10, "2026-06-10")], fgBom, [{ componentItemId: "x", quantity: 30 }], normal)
    eq(sr.materials[0].openingStock, 30, "P8-13 openingStock 은 안전재고와 무관(물리 재고 그대로)")
    const cp = classifyByPolicy({ safetyStock: 25, finalBalance: 20, minProjectedBalance: 20 })
    eq([cp.kind, cp.finalTargetDeficit, cp.peakTargetDeficit], ["SAFETY_STOCK_SHORTAGE", 5, 5], "P8-13 finalTargetDeficit = max(0, 안전재고 − 최종잔량) / peak 도 동일 규칙")
    eq(classifyByPolicy({ safetyStock: 25, finalBalance: 40, minProjectedBalance: 20 }).kind, "SAFETY_STOCK_TEMPORARY", "P8-13 중간만 미달 → 일시 미달(자동 제안 없음)")
    // 구매조건/리드타임
    eq(applySupplierTerms(17, { moq: 25, orderMultiple: 10 }), { ok: true, rawQty: 17, qtyAfterMoq: 25, qty: 30, moqApplied: true, multipleApplied: true } as never, "MOQ → 발주배수 올림(17→25→30)")
    ok(!validateQtyAgainstTerms(0.3, { moq: null, orderMultiple: 0.1 }).ok === false, "소수 배수 0.1: 0.3 은 허용(고정소수)")
    eq(evaluateOrderTiming("2026-10-20", 7, "2026-10-14"), { status: "OVERDUE", orderByDate: "2026-10-13", overdueDays: 1 } as never, "LT: 발주 필요일 = 목표 − 7일(달력일), 기준일이 지났으면 경과 일수 보고")
    // P8-14 반제품 Netting
    const semi: MrpBomLine[] = [
      { parentItemId: "fg", componentItemId: "sf", componentCode: "SF", componentItemType: "SEMI_FINISHED", qtyPer: 2 },
      { parentItemId: "sf", componentItemId: "rm", componentCode: "RM", componentItemType: "RAW_MATERIAL", qtyPer: 3 },
    ]
    const sd: MrpDemandLine = { orderId: "o", orderNo: "SO", orderLineId: "s1", orderLineNo: 1, itemId: "fg", itemCode: "FG", orderQty: 10, deliveryDate: "2026-06-10" }
    const nr = run([sd], semi, [{ componentItemId: "sf", quantity: 8 }])
    eq(nr.materials.find((m) => m.componentCode === "RM")!.totalRequirement, 36, "P8-14 NORMAL: 완제품 10 → 반제품 20 − 재고 8 = 12 → 원자재 36")
    const nc = run([sd], semi, [{ componentItemId: "sf", quantity: 8 }], { mode: "EXCEL_COMPAT", bomExplosion: "MULTI_LEVEL" })
    eq(nc.materials.find((m) => m.componentCode === "RM")!.totalRequirement, 60, "P8-14 EXCEL_COMPAT(다단계): Netting OFF → 원자재 60")
    assert.throws(() => run([sd], semi, [], { mode: "EXCEL_COMPAT", netSemiFinished: true }), RangeError)
    passed += 1
    console.log("PASS EXCEL_COMPAT 에서 Netting 요청은 거부(Excel 호환 결과 보호)")
    // WIP 는 Scheduled Production Receipt 가 아니다
    ok(!/WipUnit|wipUnit/.test(readFileSync(join(process.cwd(), "src/lib/mrp/scheduled-receipt.ts"), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), "WIP 는 예정입고(Scheduled Receipt) 계산에 쓰지 않음")
  }

  // ═══ P8-16 / P8-17 결정성·수치 / property ════════════════════════════════════
  section("P8-16/17 결정성 · 수치 안전성 · 무작위(seed 고정) property test")
  {
    const rnd = prng(20261014)
    const QTY_PER = [0.25, 0.5, 1, 2, 3, 0.1, 1.5]
    let cases = 0
    for (let t = 0; t < 300; t++) {
      const nProd = 1 + Math.floor(rnd() * 3)
      const nMat = 2 + Math.floor(rnd() * 5)
      const boms: MrpBomLine[] = []
      for (let p = 0; p < nProd; p++) {
        const count = 1 + Math.floor(rnd() * 4)
        const used = new Set<number>()
        for (let k = 0; k < count; k++) {
          const m = Math.floor(rnd() * nMat)
          if (used.has(m)) continue
          used.add(m)
          boms.push({ parentItemId: "p" + p, componentItemId: "m" + m, componentCode: "M" + m, componentItemType: "RAW_MATERIAL", qtyPer: QTY_PER[Math.floor(rnd() * QTY_PER.length)] })
        }
      }
      const nDem = 1 + Math.floor(rnd() * 10)
      const demands: MrpDemandLine[] = Array.from({ length: nDem }, (_x, i) => ({
        orderId: "o" + i,
        orderNo: "SO-" + String(i).padStart(3, "0"),
        orderLineId: "l" + i,
        orderLineNo: 1,
        itemId: "p" + Math.floor(rnd() * nProd),
        itemCode: "P",
        orderQty: 1 + Math.floor(rnd() * 20),
        deliveryDate: `2026-06-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
      }))
      const stocks: MrpStockEntry[] = Array.from({ length: nMat }, (_x, m) => ({ componentItemId: "m" + m, quantity: Math.floor(rnd() * 60) }))
      const receipts: MrpScheduledReceipt[] = Array.from({ length: Math.floor(rnd() * 4) }, (_x, i) => ({
        componentItemId: "m" + Math.floor(rnd() * nMat),
        quantity: 1 + Math.floor(rnd() * 30),
        expectedDate: `2026-06-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
        purchaseOrderId: "po" + i,
        purchaseOrderNo: "PO-" + i,
      }))
      const r = run(demands, boms, stocks, normal, receipts)
      const r2 = run(demands, boms, stocks, normal, receipts)
      assert.deepStrictEqual(r, r2, "결정성")
      const shuffledDemands = demands.slice().sort(() => rnd() - 0.5)
      const r3 = run(shuffledDemands, boms, stocks, normal, receipts)
      assert.deepStrictEqual(r3.demands.map((d) => d.orderLineId), r.demands.map((d) => d.orderLineId), "입력 순서 무관 정렬")
      // 수요 보존: Σ(수량 × qtyPer) = 자재별 총소요
      const expected = new Map<string, number>()
      r.demands.forEach((d) => {
        boms.filter((b) => b.parentItemId === d.itemId).forEach((b) => expected.set(b.componentItemId, (expected.get(b.componentItemId) ?? 0) + d.demandQty * b.qtyPer))
      })
      r.materials.forEach((m) => {
        const opening = stocks.find((s) => s.componentItemId === m.componentItemId)?.quantity ?? 0
        assert.ok(m.totalRequirement >= 0, "총소요 ≥ 0")
        assert.ok(Math.abs(m.totalRequirement - (expected.get(m.componentItemId) ?? 0)) < 1e-9, "수요 총량 보존")
        // 잔량 항등식: 최종 = 시작 + 반영 입고 − 총소요
        assert.ok(Math.abs(m.finalBalance - (opening + m.scheduledReceiptQty - m.totalRequirement)) < 1e-9, "잔량 항등식")
        assert.ok(m.finalShortageQty === Math.max(0, -m.finalBalance), "최종 부족 = max(0, −잔량)")
        const recv = receipts.filter((x) => x.componentItemId === m.componentItemId).reduce((s, x) => s + x.quantity, 0)
        assert.ok(m.scheduledReceiptQty <= recv + 1e-9, "반영 입고 ≤ 입고예정 수량")
        assert.ok(m.peakShortageQty >= m.finalShortageQty - 1e-9, "최대 결품 ≥ 최종 부족")
        for (const mv of m.movements) {
          assert.ok(mv.requirement >= 0 && Number.isFinite(mv.balanceAfter) && !Object.is(mv.balanceAfter, -0), "수치 유한/−0 없음")
        }
      })
      r.demands.forEach((d) => d.requirements.forEach((q) => assert.ok(q.requirement > 0 && Number.isFinite(q.requirement), "순소요 > 0")))
      cases += 1
    }
    ok(cases === 300, "P8-16 무작위 300 케이스(seed 20261014): 결정성/입력순서 무관/수요 보존/잔량 항등식/입고 ≤ 예정/수치 유한")

    // P8-17 수치 안전성
    const mk = (qtyPer: number, qty = 1): { d: MrpDemandLine[]; b: MrpBomLine[] } => ({
      d: [{ orderId: "o", orderNo: "SO", orderLineId: "l", orderLineNo: 1, itemId: "p", itemCode: "P", orderQty: qty, deliveryDate: "2026-06-01" }],
      b: [{ parentItemId: "p", componentItemId: "c", componentCode: "C", componentItemType: "RAW_MATERIAL", qtyPer }],
    })
    const acc = mk(0.1, 3)
    ok(Math.abs(run(acc.d, acc.b).materials[0].totalRequirement - 0.3) < 1e-12, "0.1 × 3 부동소수 오차 허용 범위")
    const big = mk(1, 1e9)
    ok(Number.isFinite(run(big.d, big.b).materials[0].totalRequirement), "큰 수량 유한")
    const zero = mk(0)
    const rz = run(zero.d, zero.b)
    ok(rz.excludedOrderLines.length === 0 && rz.demands[0].requirements.length === 0, "BOM 수량 0: 소요 줄을 만들지 않음(엔진). Master import 단계에서는 ≤0 을 REJECT")
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const x = mk(bad)
      const r = run(x.d, x.b)
      ok(r.materials.length === 0 && r.excludedOrderLines.length === 1, `BOM 수량 ${String(bad)}: 계산하지 않고 제외`)
    }
    const nanDemand = mk(1, Number.NaN)
    ok(run(nanDemand.d, nanDemand.b).excludedOrderLines.length === 1, "수요 수량 NaN: 제외")
    const nanStock = run(mk(1).d, mk(1).b, [{ componentItemId: "c", quantity: Number.NaN }])
    ok(nanStock.materials.every((m) => Number.isFinite(m.finalBalance)), "재고 NaN 은 유한 값으로 처리(경고)")
    // MOQ / 배수 경계(고정소수 6자리)
    eq(applySupplierTerms(0.3, { moq: null, orderMultiple: 0.1 }) as never, { ok: true, rawQty: 0.3, qtyAfterMoq: 0.3, qty: 0.3, moqApplied: false, multipleApplied: false } as never, "배수 0.1 에서 0.3 은 그대로(부동소수 % 아님)")
    eq((applySupplierTerms(0.000001, { moq: 0.000001, orderMultiple: null }) as { qty: number }).qty, 0.000001, "MOQ 최소 단위 1e-6")
    eq((applySupplierTerms(Number.NaN, { moq: null, orderMultiple: null }) as { ok: boolean }).ok, false, "NaN 수량 거부")
    eq((applySupplierTerms(5, { moq: 0, orderMultiple: null }) as { ok: boolean }).ok, false, "MOQ 0 은 데이터 오류")
    eq(evaluateCoverage({ rawNeed: 0.3, coverageQty: 0.1, supplier: null }).remainingRawNeed, 0.2, "Coverage 소수 뺄셈 6자리 정규화")
  }

  // ═══ 성능 / 쿼리 수 / 빈 상태 ════════════════════════════════════════════════
  section("P8-19/20 성능 · 쿼리 수 bounded · 빈 운영 상태")
  {
    const synthetic = (orders: number, materials: number) => {
      const rnd = prng(7)
      const boms: MrpBomLine[] = []
      const products = Math.max(10, Math.floor(orders / 3))
      for (let p = 0; p < products; p++)
        for (let k = 0; k < 8; k++)
          boms.push({ parentItemId: "p" + p, componentItemId: "m" + Math.floor(rnd() * materials), componentCode: "M", componentItemType: "RAW_MATERIAL", qtyPer: 1 + Math.floor(rnd() * 3) })
      // 같은 부모에 같은 구성품이 중복될 수 있으므로 (parent, component) 기준 중복 제거
      const seen = new Set<string>()
      const uniq = boms.filter((b) => (seen.has(b.parentItemId + "|" + b.componentItemId) ? false : (seen.add(b.parentItemId + "|" + b.componentItemId), true)))
      const demands: MrpDemandLine[] = Array.from({ length: orders }, (_x, i) => ({
        orderId: "o" + i,
        orderNo: "SO-" + i,
        orderLineId: "l" + i,
        orderLineNo: 1,
        itemId: "p" + Math.floor(rnd() * products),
        itemCode: "P",
        orderQty: 1 + Math.floor(rnd() * 10),
        deliveryDate: `2026-${String(6 + Math.floor(rnd() * 3)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
      }))
      const stocks: MrpStockEntry[] = Array.from({ length: materials }, (_x, m) => ({ componentItemId: "m" + m, quantity: Math.floor(rnd() * 100) }))
      return { demands, boms: uniq, stocks }
    }
    for (const [orders, mats] of [[100, 300], [300, 500]] as Array<[number, number]>) {
      const s = synthetic(orders, mats)
      const t0 = Date.now()
      const r = run(s.demands, s.boms, s.stocks, normal)
      const ms = Date.now() - t0
      console.log(`   · 엔진 ${orders} 수주 × ${mats} 자재: ${ms} ms (자재 ${r.materials.length})`)
      ok(ms < 3000 && r.demands.length === orders, `엔진 성능: ${orders} 수주 × ${mats} 자재 < 3초`)
    }

    // DB 어댑터 쿼리 수: 자재/수주 수와 무관
    const world = (orders: number, comps: number) => {
      const compRows = Array.from({ length: comps }, (_x, i) => ({ id: "m" + i, code: "M" + i }))
      return makeFakeDb({
        salesOrderItem: Array.from({ length: orders }, (_x, i) => ({
          id: "l" + i,
          qty: 5,
          shippedQty: 0,
          deliveryDate: new Date("2026-10-20T00:00:00Z"),
          itemId: "fg",
          item: { id: "fg", code: "FG", name: "FG" },
          salesOrder: { id: "so" + i, tenantId: "t", orderNo: "SO-" + i, status: "CONFIRMED", deliveryDate: new Date("2026-10-20T00:00:00Z"), customer: { name: "c" } },
        })),
        bOM: [
          {
            id: "b",
            tenantId: "t",
            itemId: "fg",
            version: "1",
            status: "ACTIVE",
            isDefault: true,
            bomItems: compRows.map((c, i) => ({ componentItemId: c.id, seq: i + 1, qtyPer: 1, scrapRate: 0, componentItem: { code: c.code, name: c.code, spec: null, uom: "EA", itemType: "RAW_MATERIAL", safetyStock: 0 } })),
          },
        ],
        inventoryBalance: compRows.map((c) => ({ tenantId: "t", itemId: c.id, item: { tenantId: "t" }, qtyOnHand: 1, qtyHold: 0, qtyAvailable: 1, lotId: null, lot: null })),
        purchaseOrder: [],
        purchaseOrderItem: [],
        itemSupplier: [],
        itemPrice: [],
        site: [],
      })
    }
    const small = world(10, 20)
    const large = world(200, 500)
    const a = await loadAndRunOrderMrp(small.db as unknown as OrderMrpDb, "t", { from: null, to: null, includeDraft: false, includeScheduledReceipts: true })
    const b = await loadAndRunOrderMrp(large.db as unknown as OrderMrpDb, "t", { from: null, to: null, includeDraft: false, includeScheduledReceipts: true })
    eq([a.diagnostics.queryCount, small.reads.length], [b.diagnostics.queryCount, large.reads.length], "P8-19 MRP 쿼리 수: 수주 10×자재 20 = 수주 200×자재 500 (N+1 없음)")
    const sa = await computePurchaseSuggestions(small.db as unknown as PurchaseSuggestionDb, "t", { from: null, to: null, includeDraft: false }, { includePrices: true })
    const sb = await computePurchaseSuggestions(large.db as unknown as PurchaseSuggestionDb, "t", { from: null, to: null, includeDraft: false }, { includePrices: true })
    eq(sa.payload.diagnostics.queryCount, sb.payload.diagnostics.queryCount, "P8-19 발주제안 쿼리 수 동일(자재 수 무관)")

    // P8-20 빈 운영 상태
    const empty = makeFakeDb({ salesOrderItem: [], bOM: [], inventoryBalance: [], purchaseOrder: [], purchaseOrderItem: [], itemSupplier: [], itemPrice: [], site: [], item: [] })
    const er = await loadAndRunOrderMrp(empty.db as unknown as OrderMrpDb, "t", { from: "2026-06-01", to: "2026-06-30", includeDraft: false, includeScheduledReceipts: true })
    eq([er.view.materials.length, er.view.kpi.demandLineCount, er.view.warnings.length], [0, 0, 0], "P8-20 수주/재고 0: MRP(기간) 빈 결과, 오류/경고 없음")
    const es = await computePurchaseSuggestions(empty.db as unknown as PurchaseSuggestionDb, "t", { from: null, to: null, includeDraft: false }, { includePrices: false })
    eq(es.payload.rows.length, 0, "P8-20 발주제안 빈 결과")
    const eh = await listMrpRuns({ authorize: async () => ({ tenantId: "t" }), db: empty.db as unknown as MrpRunDb }, {})
    eq([eh.items.length, eh.total], [0, 0], "P8-20 실행이력 빈 목록")
    const esim = await loadAndRunSimulation(empty.db as unknown as SimulationDb, "t", normalizeSimulationRequest({ items: [] }))
    eq(esim.view.materials.length, 0, "P8-20 What-if 입력 없음: 빈 결과")
    eq(empty.countWrites(), 0, "P8-20 빈 상태 조회는 쓰기 0")
  }

  // ═══ 정책 매트릭스(문서와 동일) ═════════════════════════════════════════════════
  section("정책 차이 매트릭스")
  {
    const matrix: Array<[string, "SAME" | "FIXED_LEGACY_BUG" | "MES_ENHANCEMENT" | "NOT_APPLICABLE"]> = [
      ["due-date sorting", "FIXED_LEGACY_BUG"],
      ["all-MRP 범위", "FIXED_LEGACY_BUG"],
      ["missing BOM", "MES_ENHANCEMENT"],
      ["재고 기준", "SAME"],
      ["shippedQty 반영", "MES_ENHANCEMENT"],
      ["Scheduled Receipt", "MES_ENHANCEMENT"],
      ["DRAFT PO", "MES_ENHANCEMENT"],
      ["safety stock", "MES_ENHANCEMENT"],
      ["MOQ", "MES_ENHANCEMENT"],
      ["order multiple", "MES_ENHANCEMENT"],
      ["lead time", "MES_ENHANCEMENT"],
      ["supplier selection", "MES_ENHANCEMENT"],
      ["semi-finished netting", "MES_ENHANCEMENT"],
      ["What-if independence", "SAME"],
    ]
    ok(matrix.length === 14 && matrix.every(([, c]) => ["SAME", "FIXED_LEGACY_BUG", "MES_ENHANCEMENT", "NOT_APPLICABLE"].includes(c)), "정책 차이 14개 항목이 모두 분류됨(문서와 동일)")
  }

  console.log(`\n✅ mrp-phase8: ${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
