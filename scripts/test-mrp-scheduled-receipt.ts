/**
 * Phase 5B — 예정입고(Scheduled Receipt) 시간축 MRP 테스트 (fake DB 주입 · 실제 DB 접속/쓰기 없음)
 *
 * 실행: npm run test:mrp-scheduled-receipt
 *
 *  SR1  입고 먼저 → 결품 없음              SR2  수요 후 입고 → 일시 결품 + 회복
 *  SR3  같은 날 입고 → 수요 순서           SR4  부분입고 잔량(100-40=60 …)
 *  SR5  CLOSED 제외    SR6 DRAFT 제외    SR7 CANCELLED 제외    SR8 RECEIVED 제외
 *  SR9  예정일 경과 제외 + 경고            SR10 외주 PO 제외
 *  SR11 다중 PO 합산                        SR12 타 tenant PO 제외
 *  P    기간 MRP 조합(기간 시작 전 입고, 종료 후 입고)   X  EXCEL_COMPAT 무시 / 입력 없음 = 기존 동일
 *  Q    쿼리 수(+1, N+1 없음)               V  화면 View(타임라인/경고/KPI)
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { runOrderMrp } from "../src/lib/mrp/order-mrp-engine"
import { classifyScheduledReceipts, type PurchaseOrderItemRow } from "../src/lib/mrp/scheduled-receipt"
import { executeOrderMrpRequest, loadAndRunOrderMrp, type OrderMrpDb } from "../src/lib/services/mrp-order.service"
import type { MrpDemandLine, MrpScheduledReceipt, OrderMrpInput } from "../src/lib/mrp/types"

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

// ═════════════════════════════════════════════════════════════════════════════
// A. 엔진 (순수)
// ═════════════════════════════════════════════════════════════════════════════

const BOM = [{ parentItemId: "FG", componentItemId: "R1", componentCode: "R1", qtyPer: 1 }]
function demand(id: string, qty: number, due: string | null, orderNo = "SO-" + id): MrpDemandLine {
  return { orderId: "o" + id, orderNo, orderLineId: "l" + id, itemId: "FG", itemCode: "FG", orderQty: qty, remainingQty: qty, deliveryDate: due }
}
function receipt(po: string, qty: number, date: string, extra: Partial<MrpScheduledReceipt> = {}): MrpScheduledReceipt {
  return { componentItemId: "R1", quantity: qty, expectedDate: date, purchaseOrderId: "id-" + po, purchaseOrderNo: po, purchaseOrderItemId: "poi-" + po, ...extra }
}
function run(
  opening: number,
  demands: MrpDemandLine[],
  receipts?: MrpScheduledReceipt[],
  options: Parameters<typeof runOrderMrp>[1] = { mode: "NORMAL" }
) {
  const input: OrderMrpInput = {
    demands,
    boms: BOM,
    stocks: [{ componentItemId: "R1", quantity: opening }],
    ...(receipts ? { scheduledReceipts: receipts } : {}),
  }
  return runOrderMrp(input, options)
}
const mat = (r: ReturnType<typeof run>) => r.materials.find((m) => m.componentItemId === "R1")!

section("SR1 입고 먼저: 50 + 30(10/10) → 수요 60(10/12) = 20, 결품 없음")
{
  const r = run(50, [demand("1", 60, "2026-10-12")], [receipt("PO-1", 30, "2026-10-10")])
  const m = mat(r)
  eq(m.timeline.map((e) => [e.type, e.date, e.balanceBefore, e.balanceAfter]), [
    ["SCHEDULED_RECEIPT", "2026-10-10", 50, 80],
    ["DEMAND", "2026-10-12", 80, 20],
  ], "SR1 timeline")
  eq([m.finalBalance, m.finalShortageQty, m.hadShortage, m.peakShortageQty, m.firstShortage], [20, 0, false, 0, null], "SR1 결품 없음")
  eq([m.scheduledReceiptQty, m.scheduledReceiptCount, m.totalRequirement], [30, 1, 60], "SR1 입고 30 / 총소요 60 (소요는 입고로 줄지 않음)")
  eq(r.summary.shortageComponentCount, 0, "SR1 부족 자재 0")
}

section("SR2 수요 후 입고: 50 → 수요 60(10/12)=-10 결품 → 입고 +30(10/15)=20")
{
  const r = run(50, [demand("1", 60, "2026-10-12")], [receipt("PO-1", 30, "2026-10-15")])
  const m = mat(r)
  eq(m.timeline.map((e) => [e.type, e.date, e.balanceBefore, e.balanceAfter]), [
    ["DEMAND", "2026-10-12", 50, -10],
    ["SCHEDULED_RECEIPT", "2026-10-15", -10, 20],
  ], "SR2 timeline")
  eq(m.timeline[0].isShortage, true, "SR2 10/12 결품 표시")
  eq(m.firstShortage?.deliveryDate, "2026-10-12", "SR2 최초 결품일 10/12")
  eq([m.hadShortage, m.peakShortageQty, m.finalBalance, m.finalShortageQty], [true, 10, 20, 0], "SR2 기간 중 결품 있음 / 최대 10 / 최종 20 / 최종 부족 0")
  eq(m.shortageRecoveredAt, "2026-10-15", "SR2 결품 회복일 10/15")
  eq([r.summary.shortageComponentCount, r.summary.temporaryShortageComponentCount], [0, 1], "SR2 최종 부족 0 이지만 일시 결품 1")
  eq(m.movements[0].isShortage, true, "SR2 기존 movements 도 결품 단계를 보존")
}

section("SR3 같은 날: 입고 먼저 → 수요")
{
  const r = run(0, [demand("1", 30, "2026-10-12")], [receipt("PO-1", 30, "2026-10-12")])
  const m = mat(r)
  eq(m.timeline.map((e) => e.type), ["SCHEDULED_RECEIPT", "DEMAND"], "SR3 같은 날 입고 → 수요")
  eq([m.finalBalance, m.hadShortage], [0, false], "SR3 같은 날 입고로 결품 없음")
  // 입고가 하루 늦으면 결품
  const late = run(0, [demand("1", 30, "2026-10-12")], [receipt("PO-1", 30, "2026-10-13")])
  eq([mat(late).hadShortage, mat(late).firstShortage?.deliveryDate, mat(late).finalBalance], [true, "2026-10-12", 0], "SR3 하루 늦으면 10/12 결품(최종 0)")
}

section("회복 예: 100 → 수요 130 = -30 → 입고 50 = 20")
{
  const r = run(100, [demand("1", 130, "2026-10-10")], [receipt("PO-1", 50, "2026-10-20")])
  const m = mat(r)
  eq([m.peakShortageQty, m.finalBalance, m.shortageRecoveredAt, m.hadShortage], [30, 20, "2026-10-20", true], "회복 지표")
  // 일부만 회복
  const partial = run(100, [demand("1", 130, "2026-10-10")], [receipt("PO-1", 10, "2026-10-20")])
  eq([mat(partial).finalBalance, mat(partial).finalShortageQty, mat(partial).shortageRecoveredAt, mat(partial).peakShortageQty], [-20, 20, null, 30], "일부만 회복: 최종 부족 20, 회복일 없음, 최대 30")
}

section("SR11 다중 PO 합산 + 결정적 순서")
{
  const rs = [receipt("PO-B", 10, "2026-10-10"), receipt("PO-A", 5, "2026-10-10"), receipt("PO-C", 20, "2026-10-08")]
  const r = run(0, [demand("1", 25, "2026-10-12")], rs)
  const m = mat(r)
  eq(m.scheduledReceiptQty, 35, "SR11 합계 35")
  eq(m.timeline.filter((e) => e.type === "SCHEDULED_RECEIPT").map((e) => e.purchaseOrderNo), ["PO-C", "PO-A", "PO-B"], "SR11 일자 → 발주번호 순")
  eq(JSON.stringify(run(0, [demand("1", 25, "2026-10-12")], [...rs].reverse())), JSON.stringify(r), "SR11 입력 순서가 달라도 같은 결과(결정적)")
}

section("무관 자재 입고 무시 / 유효하지 않은 입고 경고")
{
  const r = run(10, [demand("1", 5, "2026-10-12")], [{ ...receipt("PO-X", 99, "2026-10-10"), componentItemId: "OTHER" }])
  eq([mat(r).scheduledReceiptQty, r.materials.length], [0, 1], "수요 없는 자재 입고는 결과에 영향 없음")
  const bad = run(10, [demand("1", 5, "2026-10-12")], [receipt("PO-1", 0, "2026-10-10"), receipt("PO-2", 5, "2026/10/10"), receipt("PO-3", Number.NaN, "2026-10-10")])
  eq(bad.warnings.filter((w) => w.code === "INVALID_SCHEDULED_RECEIPT").length, 3, "유효하지 않은 입고 3건 경고")
  eq(mat(bad).scheduledReceiptQty, 0, "유효하지 않은 입고는 반영하지 않음(음수/0 입고 생성 금지)")
}

section("납기 미정 수요 / 마지막 수요 이후 입고")
{
  const r = run(10, [demand("1", 15, "2026-10-10"), demand("2", 10, null)], [receipt("PO-1", 100, "2026-10-20")])
  const m = mat(r)
  // 10/10 수요(15): 10-15=-5 결품. 납기 미정 수요(10)는 날짜 근거가 없어 10/20 입고를 앞당겨 쓰지 않는다
  eq(m.movements.map((x) => x.balanceAfter), [-5, -15], "납기 미정 수요는 이후 입고를 반영하지 않음(보수적)")
  eq(m.finalBalance, 85, "마지막 수요 이후 입고는 최종 예상재고에 반영")
  eq(m.timeline.map((e) => e.type), ["DEMAND", "DEMAND", "SCHEDULED_RECEIPT"], "타임라인: 수요, 수요(미정), 입고")
}

section("P 기간 MRP: 기간 시작 전 입고는 반영 / 종료일 이후 입고는 제외")
{
  const opt = { mode: "NORMAL" as const, from: "2026-10-10", to: "2026-10-31" }
  const demands = [demand("1", 80, "2026-10-12"), demand("pre", 999, "2026-09-20"), demand("post", 999, "2026-11-10")]
  // 기준일 10/01 이후, 기간 시작(10/10) 이전인 10/05 입고 +50 → 10/12 수요 처리 전에 반영
  const r = run(40, demands, [receipt("PO-1", 50, "2026-10-05"), receipt("PO-2", 500, "2026-11-05")], opt)
  const m = mat(r)
  eq(r.demands.length, 1, "P 기간 내 수요 1건만 포함(기간 밖 수요 제외)")
  eq(m.timeline.map((e) => [e.type, e.date, e.balanceAfter]), [
    ["SCHEDULED_RECEIPT", "2026-10-05", 90],
    ["DEMAND", "2026-10-12", 10],
  ], "P 기간 시작 전 입고(10/05)가 기간 첫 수요 전에 반영")
  eq([m.finalBalance, m.scheduledReceiptQty], [10, 50], "P 종료일(10/31) 이후 입고(11/05)는 기간 시간축 밖 → 제외")
  // 기간 상한 없음(전체)이면 11/05 입고도 최종 예상재고에 포함
  const all = run(40, [demand("1", 80, "2026-10-12")], [receipt("PO-1", 50, "2026-10-05"), receipt("PO-2", 500, "2026-11-05")])
  eq(mat(all).finalBalance, 510, "P 전체 기간은 이후 입고도 최종 예상재고에 반영")
  // 입고가 없으면 같은 기간이 결품
  const none = run(40, demands, [], opt)
  eq([mat(none).finalBalance, mat(none).hadShortage], [-40, true], "P 입고 없으면 10/12 결품(비교)")
}

section("X EXCEL_COMPAT 무시 / 입력 없음 = 기존 동일")
{
  const base = run(50, [demand("1", 60, "2026-10-12")], undefined, { mode: "EXCEL_COMPAT" })
  const withR = run(50, [demand("1", 60, "2026-10-12")], [receipt("PO-1", 30, "2026-10-10")], { mode: "EXCEL_COMPAT" })
  eq(mat(withR).finalBalance, mat(base).finalBalance, "X 호환 모드는 입고예정을 계산에 반영하지 않음")
  eq([mat(withR).scheduledReceiptQty, mat(withR).timeline.length], [0, 0], "X 호환 모드: 입고 0 / 타임라인 비어 있음")
  ok(withR.warnings.some((w) => w.code === "SCHEDULED_RECEIPTS_IGNORED"), "X 무시 안내(INFO)")
  eq(JSON.stringify(run(50, [demand("1", 60, "2026-10-12")], [])), JSON.stringify(run(50, [demand("1", 60, "2026-10-12")])), "X scheduledReceipts=[] 는 미전달과 완전히 동일")
  const noRec = run(50, [demand("1", 60, "2026-10-12")])
  eq([mat(noRec).timeline, mat(noRec).scheduledReceiptQty, mat(noRec).hadShortage, mat(noRec).peakShortageQty], [[], 0, true, 10], "X 입고 입력 없음: 기존 결과 + 추가 지표만")
  eq(mat(noRec).finalBalance, -10, "X 입력 없음: 최종 -10 (기존 동일)")
}

// ═════════════════════════════════════════════════════════════════════════════
// B. 예정입고 분류 (순수)
// ═════════════════════════════════════════════════════════════════════════════

const T = "tenant-1"
function poRow(
  id: string,
  over: Partial<{
    status: string
    qty: number
    received: number
    expected: Date | string | null
    orderNo: string
    note: string | null
    tenantId: string
    itemId: string
    woOp: string | null
  }> = {}
): PurchaseOrderItemRow {
  const orderNo = over.orderNo ?? "PO-" + id
  return {
    id: "poi-" + id,
    itemId: over.itemId ?? "R1",
    qty: over.qty ?? 100,
    receivedQty: over.received ?? 0,
    workOrderOperationId: over.woOp ?? null,
    purchaseOrder: {
      id: "po-" + id,
      tenantId: over.tenantId ?? T,
      orderNo,
      status: over.status ?? "ORDERED",
      expectedDate: over.expected === undefined ? new Date("2026-10-10T00:00:00Z") : over.expected,
      note: over.note ?? null,
      supplier: { id: "s1", name: "공급사A" },
    },
  }
}
const BASE = "2026-10-01"
const classify = (rows: PurchaseOrderItemRow[], baseDate = BASE) => classifyScheduledReceipts(rows, { tenantId: T, baseDate })

section("SR4 부분입고: 100-40=60, 추가 입고 20 → 40, 완료 → 0")
{
  eq(classify([poRow("a", { status: "PARTIAL_RECEIVED", received: 40 })]).receipts[0].quantity, 60, "SR4 100-40 = 60")
  eq(classify([poRow("a", { status: "PARTIAL_RECEIVED", received: 60 })]).receipts[0].quantity, 40, "SR4 입고 20 추가 → 40")
  eq(classify([poRow("a", { status: "RECEIVED", received: 100 })]).receipts.length, 0, "SR4 완전입고(RECEIVED) → 0")
  eq(classify([poRow("a", { status: "PARTIAL_RECEIVED", received: 100 })]).receipts.length, 0, "SR4 상태가 남아 있어도 잔량 0 이면 입고예정 없음")
  const c = classify([poRow("a", { status: "ORDERED" })])
  eq([c.receipts[0].quantity, c.receipts[0].expectedDate, c.details[0].supplierName], [100, "2026-10-10", "공급사A"], "SR4 ORDERED 전량 미입고 100 / 예정일 / 공급사")
}

section("SR5~SR8 상태 필터")
for (const [code, status] of [["SR5", "CLOSED"], ["SR6", "DRAFT"], ["SR7", "CANCELLED"], ["SR8", "RECEIVED"]] as const) {
  const c = classify([poRow("x", { status, received: 40 })])
  eq([c.receipts.length, c.overdue.length, c.issues.length], [0, 0, 0], `${code} ${status} 제외`)
}

section("SR9 예정일 경과: 가산하지 않고 경고, 기준일 당일은 인정")
{
  const c = classify([poRow("old", { expected: new Date("2026-09-30T00:00:00Z"), received: 40 }), poRow("today", { expected: new Date("2026-10-01T00:00:00Z") })])
  eq(c.receipts.map((r) => r.purchaseOrderNo), ["PO-today"], "SR9 기준일 당일 입고는 인정, 어제는 제외")
  eq([c.overdue.length, c.overdue[0].openQty, c.issues[0].code], [1, 60, "OVERDUE_SCHEDULED_RECEIPT"], "SR9 경과 60 / OVERDUE 안내")
  // KST 경계: UTC 2026-09-30T16:00Z = KST 10/01 01:00 → 기준일 당일
  eq(classify([poRow("kst", { expected: new Date("2026-09-30T16:00:00Z") })]).receipts.length, 1, "SR9 KST 달력일 기준(UTC 전날 16:00 = KST 10/01)")
}

section("SR10 외주발주 제외")
{
  const c = classify([
    poRow("os1", { orderNo: "OS-20261001-0001" }),
    poRow("os2", { note: "[OUTSOURCING] 도금" }),
    poRow("os3", { woOp: "op-1" }),
    poRow("ok1"),
  ])
  eq(c.receipts.map((r) => r.purchaseOrderNo), ["PO-ok1"], "SR10 OS- / [OUTSOURCING] / 공정 연결 행 제외")
  eq(c.excludedOutsourcingCount, 3, "SR10 제외 건수 3")
}

section("SR12 타 tenant / 날짜·수량 이상")
{
  eq(classify([poRow("t2", { tenantId: "tenant-2" })]).receipts.length, 0, "SR12 타 tenant PO 제외(방어적)")
  const noDate = classify([poRow("nd", { expected: null }), poRow("bad", { expected: "not-a-date" })])
  eq([noDate.receipts.length, noDate.issues.map((i) => i.code)], [0, ["MISSING_RECEIPT_DATE", "MISSING_RECEIPT_DATE"]], "ETA 없음/해석 불가 → 가산하지 않고 경고")
  const over = classify([poRow("ov", { qty: 100, received: 130, status: "PARTIAL_RECEIVED" })])
  eq([over.receipts.length, over.issues[0].code, over.issues[0].openQty], [0, "RECEIVED_QTY_EXCEEDS_ORDER", 0], "입고 > 발주: 음수 입고예정 없이 경고")
  eq(classify([poRow("s", { expected: "2026-10-12" })]).receipts[0].expectedDate, "2026-10-12", "date-only 문자열 예정일 허용")
  assert.throws(() => classify([], "2026-1-1"), /baseDate/)
  passed += 1
  console.log("PASS baseDate 형식 검증")
}

// ═════════════════════════════════════════════════════════════════════════════
// C. 서비스(DB 주입) — 쿼리 수 / 옵트인 / tenant / 화면 View
// ═════════════════════════════════════════════════════════════════════════════

type Row = Record<string, any>
const OPS = ["in", "not", "gt", "gte", "lt", "lte", "equals"]
function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    const keys = Object.keys(cond as object)
    if (keys.length > 0 && keys.every((k) => OPS.includes(k))) {
      const c = cond as Record<string, any>
      return keys.every((k) => {
        const v = c[k]
        const a = actual as any
        if (k === "in") return (v as unknown[]).includes(actual)
        if (k === "not") return a !== v
        if (k === "equals") return a === v
        if (k === "gt") return a > v
        if (k === "gte") return a >= v
        if (k === "lt") return a < v
        return a <= v
      })
    }
    if (actual === null || actual === undefined) return false
    return matches(actual as Row, cond as Row)
  }
  return actual === cond
}
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Row[]).some((c) => matches(row, c))
    if (k === "AND") return (cond as Row[]).every((c) => matches(row, c))
    if (k === "NOT") return !matches(row, cond as Row)
    return matchValue(row[k], cond)
  })
}
function makeDb(tables: Record<string, Row[]>) {
  const calls: Array<{ model: string; where: Row }> = []
  const model = (name: string) => ({
    findMany: async (args: { where?: Row; orderBy?: unknown }) => {
      calls.push({ model: name, where: args.where ?? {} })
      return tables[name].filter((r) => (args.where ? matches(r, args.where) : true))
    },
  })
  const db = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (!(prop in tables)) throw new Error(`unexpected model access: ${prop}`)
        return model(prop)
      },
    }
  ) as unknown as OrderMrpDb
  return { db, calls }
}

const T1 = "tenant-1"
const fg = { id: "fgA", code: "FG-A", name: "제품A", tenantId: T1 }
const soLine = (id: string, orderNo: string, qty: number, due: string, status = "CONFIRMED") => ({
  id,
  qty,
  shippedQty: 0,
  deliveryDate: new Date(due + "T00:00:00Z"),
  itemId: "fgA",
  item: fg,
  salesOrder: {
    id: "so-" + id,
    tenantId: T1,
    orderNo,
    status,
    deliveryDate: new Date("2026-12-31T00:00:00Z"),
    customer: { name: "고객사" },
  },
})
const comp = (code: string) => ({ code, name: code + " 자재", spec: null, uom: "EA", itemType: "RAW_MATERIAL" })
const bomA = {
  id: "b-a",
  tenantId: T1,
  itemId: "fgA",
  version: "1",
  status: "ACTIVE",
  isDefault: true,
  bomItems: [{ componentItemId: "r1", seq: 1, qtyPer: 1, scrapRate: 0, componentItem: comp("R1") }],
}
const bal = (itemId: string, avail: number) => ({
  tenantId: T1,
  itemId,
  item: { tenantId: T1 },
  qtyOnHand: avail,
  qtyHold: 0,
  qtyAvailable: avail,
  lotId: null,
  lot: null,
})
function poi(
  id: string,
  poNo: string,
  status: string,
  qty: number,
  recv: number,
  expected: string,
  over: { tenantId?: string; note?: string | null; woOp?: string | null; itemId?: string } = {}
) {
  const tenantId = over.tenantId ?? T1
  return {
    id: "poi-" + id,
    itemId: over.itemId ?? "r1",
    qty,
    receivedQty: recv,
    workOrderOperationId: over.woOp ?? null,
    item: { tenantId },
    purchaseOrder: {
      id: "po-" + id,
      tenantId,
      orderNo: poNo,
      status,
      expectedDate: new Date(expected + "T00:00:00Z"),
      note: over.note ?? null,
      supplier: { id: "sup", name: "공급사A" },
    },
  }
}

const NOW = () => new Date("2026-10-01T03:00:00Z") // KST 2026-10-01
const params = { from: null, to: null, includeDraft: false }
const withReceipts = { ...params, includeScheduledReceipts: true }
const tables = (pois: Row[], lines = [soLine("l1", "SO-1", 60, "2026-10-12")], stock = 50) => ({
  salesOrderItem: lines,
  bOM: [bomA],
  inventoryBalance: [bal("r1", stock)],
  purchaseOrderItem: pois,
})
const materialR1 = (p: Awaited<ReturnType<typeof loadAndRunOrderMrp>>) => p.view.materials.find((m) => m.code === "R1")!

async function main() {
  section("옵트인: includeScheduledReceipts 없음 → 구매발주 조회 0건, 기존 결과")
  {
    const f = makeDb(tables([poi("1", "PO-1", "ORDERED", 30, 0, "2026-10-10")]))
    const p = await loadAndRunOrderMrp(f.db, T1, params, NOW)
    eq(f.calls.some((c) => c.model === "purchaseOrderItem"), false, "미지정 시 purchaseOrderItem 조회 없음")
    eq(p.diagnostics.queryCount, f.calls.length, "쿼리 수 보고 = 실제 호출 수")
    const m = materialR1(p)
    eq([m.finalBalance, m.shortageQty, m.scheduledReceiptQty, m.timeline.length], [-10, 10, 0, 0], "입고예정 미반영: 50-60 = -10")
    eq(p.view.scheduledReceipts.enabled, false, "scheduledReceipts.enabled=false")
  }

  section("SR1/SR2 (서비스): 입고 반영 + 쿼리 +1")
  {
    const base = makeDb(tables([poi("1", "PO-1", "ORDERED", 30, 0, "2026-10-10")]))
    const without = await loadAndRunOrderMrp(base.db, T1, params, NOW)
    const f = makeDb(tables([poi("1", "PO-1", "ORDERED", 30, 0, "2026-10-10")]))
    const p = await loadAndRunOrderMrp(f.db, T1, withReceipts, NOW)
    eq(p.diagnostics.queryCount, without.diagnostics.queryCount + 1, "예정입고 조회는 쿼리 +1")
    eq(p.diagnostics.queryCount, f.calls.length, "보고된 쿼리 수 = 실제 호출 수")
    const m = materialR1(p)
    eq([m.finalBalance, m.shortageQty, m.hadShortage, m.scheduledReceiptQty, m.nextReceiptDate], [20, 0, false, 30, "2026-10-10"], "SR1 서비스: 50+30-60=20, 결품 없음")
    eq(m.timeline.map((e) => [e.type, e.referenceNo, e.signedQuantity, e.balanceAfter]), [
      ["SCHEDULED_RECEIPT", "PO-1", 30, 80],
      ["DEMAND", "SO-1", -60, 20],
    ], "SR1 View 타임라인(발주/수주 번호)")
    eq(m.timeline[0].partyName, "공급사A", "입고 이벤트에 공급사 표시")
    eq(p.view.scheduledReceipts.baseDate, "2026-10-01", "기준일 = KST 오늘(date-only)")
    eq([p.view.kpi.scheduledReceiptMaterialCount, p.view.kpi.temporaryShortageMaterialCount, p.view.kpi.shortageMaterialCount], [1, 0, 0], "KPI")
    // where 조건: tenant + 상태 + 구성품
    const q = f.calls.find((c) => c.model === "purchaseOrderItem")!
    ok(JSON.stringify(q.where).includes(T1), "구매발주 조회 where 에 인증 tenant 포함")
    eq((q.where as any).purchaseOrder.status.in, ["ORDERED", "PARTIAL_RECEIVED"], "상태 조건 ORDERED/PARTIAL_RECEIVED")

    const late = makeDb(tables([poi("1", "PO-1", "ORDERED", 30, 0, "2026-10-15")]))
    const pl = await loadAndRunOrderMrp(late.db, T1, withReceipts, NOW)
    const ml = materialR1(pl)
    eq([ml.hadShortage, ml.firstShortageDate, ml.peakShortageQty, ml.finalBalance, ml.temporaryShortage, ml.shortageRecoveredAt], [true, "2026-10-12", 10, 20, true, "2026-10-15"], "SR2 서비스: 10/12 결품 → 10/15 회복(일시 결품)")
    eq([pl.view.kpi.temporaryShortageMaterialCount, pl.view.kpi.shortageMaterialCount], [1, 0], "SR2 KPI: 일시 결품 1 / 최종 부족 0")
    eq(ml.timeline.map((e) => e.isShortage), [true, false], "SR2 결품 이벤트 표시")
  }

  section("SR5~SR8, SR10, SR12 (서비스): 제외 규칙이 결과에 반영")
  {
    const excluded: Array<[string, Row]> = [
      ["SR5 CLOSED", poi("1", "PO-1", "CLOSED", 30, 0, "2026-10-10")],
      ["SR6 DRAFT", poi("1", "PO-1", "DRAFT", 30, 0, "2026-10-10")],
      ["SR7 CANCELLED", poi("1", "PO-1", "CANCELLED", 30, 0, "2026-10-10")],
      ["SR8 RECEIVED", poi("1", "PO-1", "RECEIVED", 30, 30, "2026-10-10")],
      ["SR10 외주(OS-)", poi("1", "OS-20261001-1", "ORDERED", 30, 0, "2026-10-10")],
      ["SR10 외주([OUTSOURCING])", poi("1", "PO-1", "ORDERED", 30, 0, "2026-10-10", { note: "[OUTSOURCING] 열처리" })],
      ["SR12 타 tenant", poi("1", "PO-1", "ORDERED", 30, 0, "2026-10-10", { tenantId: "tenant-2" })],
    ]
    for (const [label, row] of excluded) {
      const f = makeDb(tables([row]))
      const m = materialR1(await loadAndRunOrderMrp(f.db, T1, withReceipts, NOW))
      eq([m.scheduledReceiptQty, m.finalBalance], [0, -10], `${label}: 입고예정 반영 없음 (결품 유지)`)
    }
    // CLOSED 전환 전/후 비교: ORDERED 잔량 20 → 입고예정 +20 → Close 후 0
    const before = materialR1(await loadAndRunOrderMrp(makeDb(tables([poi("1", "PO-1", "PARTIAL_RECEIVED", 100, 80, "2026-10-10")])).db, T1, withReceipts, NOW))
    const after = materialR1(await loadAndRunOrderMrp(makeDb(tables([poi("1", "PO-1", "CLOSED", 100, 80, "2026-10-10")])).db, T1, withReceipts, NOW))
    eq([before.scheduledReceiptQty, before.finalBalance, after.scheduledReceiptQty, after.finalBalance], [20, 10, 0, -10], "SR5 종결 전 +20 → 종결 후 0 (qty/received 는 그대로 100/80)")
  }

  section("SR9 (서비스): 예정일 경과 미입고 — 가산 안 함 + 안내, KST 기준일")
  {
    const f = makeDb(tables([poi("1", "PO-OLD", "PARTIAL_RECEIVED", 100, 50, "2026-09-25")]))
    const p = await loadAndRunOrderMrp(f.db, T1, withReceipts, NOW)
    const m = materialR1(p)
    eq([m.scheduledReceiptQty, m.finalBalance, m.overdueReceiptQty, m.overdueReceiptCount], [0, -10, 50, 1], "경과 미입고 50 은 +50 하지 않음")
    eq(p.view.scheduledReceipts.overdue.map((o) => [o.purchaseOrderNo, o.openQty, o.daysOverdue, o.expectedDate]), [["PO-OLD", 50, 6, "2026-09-25"]], "경과 목록(발주/잔량/경과일)")
    ok(p.view.warnings.some((w) => w.code === "OVERDUE_SCHEDULED_RECEIPT" && w.itemCode === "R1"), "OVERDUE_SCHEDULED_RECEIPT 경고")
    eq(p.view.kpi.overdueReceiptCount, 1, "KPI 경과 건수")
    // 기준일 경계: 같은 PO, now 가 KST 10/02 이면 10/01 예정은 경과
    const tbl = tables([poi("1", "PO-1", "ORDERED", 30, 0, "2026-10-01")])
    const kstNextDay = () => new Date("2026-10-01T16:00:00Z") // KST 2026-10-02 01:00
    const pk = await loadAndRunOrderMrp(makeDb(tbl).db, T1, withReceipts, kstNextDay)
    eq([materialR1(pk).scheduledReceiptQty, pk.view.scheduledReceipts.baseDate], [0, "2026-10-02"], "KST 10/02 기준 10/01 예정은 경과")
    const pt = await loadAndRunOrderMrp(makeDb(tbl).db, T1, withReceipts, NOW)
    eq(materialR1(pt).scheduledReceiptQty, 30, "KST 10/01 기준 10/01 예정은 오늘 입고로 인정")
  }

  section("P (서비스): 기간 MRP 조합")
  {
    const lines = [soLine("l1", "SO-1", 80, "2026-10-12"), soLine("l2", "SO-2", 999, "2026-09-20"), soLine("l3", "SO-3", 999, "2026-11-10")]
    const f = makeDb(tables([poi("1", "PO-1", "ORDERED", 50, 0, "2026-10-05"), poi("2", "PO-2", "ORDERED", 500, 0, "2026-11-05")], lines, 40))
    const p = await loadAndRunOrderMrp(f.db, T1, { from: "2026-10-10", to: "2026-10-31", includeDraft: false, includeScheduledReceipts: true }, NOW)
    const m = materialR1(p)
    eq([p.view.kpi.demandLineCount, m.totalRequirement], [1, 80], "기간 내 수요 80 (수요 자체는 입고예정으로 변하지 않음)")
    eq([m.finalBalance, m.scheduledReceiptQty, m.hadShortage], [10, 50, false], "기간 시작(10/10) 전 10/05 입고 +50 반영, 11/05 입고는 기간 밖")
    eq(m.timeline.map((e) => e.referenceNo), ["PO-1", "SO-1"], "기간 시간축: 입고 → 수주")
  }

  section("Q 쿼리 수: 수주 3건 vs 303건 동일(+1)")
  {
    const small = Array.from({ length: 3 }, (_, i) => soLine("s" + i, "SO-S" + i, 1, "2026-10-12"))
    const big = Array.from({ length: 303 }, (_, i) => soLine("b" + i, "SO-B" + i, 1, "2026-10-12"))
    const a = makeDb(tables([poi("1", "PO-1", "ORDERED", 30, 0, "2026-10-10")], small))
    const b = makeDb(tables([poi("1", "PO-1", "ORDERED", 30, 0, "2026-10-10")], big))
    const pa = await loadAndRunOrderMrp(a.db, T1, withReceipts, NOW)
    const pb = await loadAndRunOrderMrp(b.db, T1, withReceipts, NOW)
    eq(pa.diagnostics.queryCount, pb.diagnostics.queryCount, "Q 수주 3건 vs 303건 쿼리 수 동일")
    eq([pb.diagnostics.queryCount, b.calls.length], [4, 4], "Q 수주 1 + BOM 1 + 재고 1 + 구매발주 1 = 4 (입력 건수와 무관)")
    eq(b.calls.filter((c) => c.model === "purchaseOrderItem").length, 1, "Q 구매발주 조회는 1회")
  }

  section("권한/보안: 요청의 tenantId·baseDate 는 무시, 권한 실패 시 DB 0")
  {
    const f = makeDb(tables([poi("1", "PO-1", "ORDERED", 30, 0, "2026-10-10")]))
    const spoof = await executeOrderMrpRequest(
      { authorize: async () => ({ tenantId: T1 }), db: f.db, now: NOW },
      { includeScheduledReceipts: true, tenantId: "tenant-2", baseDate: "2020-01-01" }
    )
    eq(spoof.view.scheduledReceipts.baseDate, "2026-10-01", "클라이언트 baseDate 무시(서버 KST 오늘)")
    ok(f.calls.every((c) => !JSON.stringify(c.where).includes("tenant-2")), "위조 tenantId 가 쿼리에 반영되지 않음")
    const denied = makeDb(tables([]))
    await assert.rejects(
      () => executeOrderMrpRequest({ authorize: async () => { throw new Error("권한 없음") }, db: denied.db, now: NOW }, { includeScheduledReceipts: true }),
      /권한 없음/
    )
    passed += 1
    eq(denied.calls.length, 0, "권한 실패 시 DB 조회 0건")
  }

  section("정적 점검")
  {
    const root = join(__dirname, "..")
    const loaders = readFileSync(join(root, "src", "lib", "services", "mrp-loaders.ts"), "utf8")
    ok(/purchaseOrder: \{ tenantId, status: \{ in:/.test(loaders), "로더: tenant + 상태 조건")
    ok(!/contains/.test(loaders.split("loadScheduledReceiptRows")[1] ?? ""), "로더: note contains(NULL 누락 위험)를 DB 조건에 사용하지 않음")
    const engine = readFileSync(join(root, "src", "lib", "mrp", "order-mrp-engine.ts"), "utf8")
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    ok(!/Date\.now|new Date\(/.test(code(engine)), "엔진은 현재 시각을 읽지 않음")
    const sr = readFileSync(join(root, "src", "lib", "mrp", "scheduled-receipt.ts"), "utf8")
    ok(!/Date\.now|new Date\(\)/.test(code(sr)), "분류 모듈은 현재 시각을 읽지 않음(baseDate 주입)")
    ok(!/prisma/i.test(code(sr)), "분류 모듈은 DB 비의존")
    const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8")
    ok(!/model ScheduledReceipt/.test(schema), "schema 변경 없음(ScheduledReceipt 모델 미추가)")
  }

  console.log(`\n✅ mrp-scheduled-receipt: ${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
