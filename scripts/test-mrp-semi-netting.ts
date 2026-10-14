/**
 * Phase 5E — 반제품 재고 Netting 테스트 (fake DB 주입 · 실제 DB 접속/쓰기 없음)
 *
 * 실행: npm run test:mrp-semi-netting
 *
 *  NT1  기준 예제: 완제품 10 → 반제품 20 − 재고 8 = 순소요 12 → 원자재 3 × 12 = 36
 *  NT2  복수 수요: 같은 반제품 재고는 공용 pool(수주별 이중 사용 금지, 납기순)
 *  NT3  다단계: 반제품 Level 마다 Gross → Netting → Net 만 하위 전개
 *  NT4  재고 0 / 스크랩: 기존 계산과 완전히 동일(플래그 off 결과와 비교)
 *  NT5  재고가 전량 충당: 하위 소요 0
 *  NT6  확정 구매입고(ORDERED/PARTIAL)만 pool 증가(수요 이후 입고는 불가, DRAFT·WIP 제외)
 *  NT7  EXCEL_COMPAT 은 Netting OFF / 옵션 검증
 *  NT8  재고 정책: qtyAvailable 만, ACTIVE LOT 만, qtyHold 재차감/안전재고 차감 없음, WIP 미포함
 *  NT9  기간 MRP: 기간 밖 수요는 pool 을 소진하지 않음
 *  NT10 What-if: 가상 수요도 공용 pool 을 입력 순서대로 소진
 *  NT11 화면 근거(View): 총 필요 → 재고 사용 → 순소요 → 하위 소요
 *  + 쿼리 수, 정적 점검(엔진/스키마)
 */
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { resolveOrderMrpOptions, runOrderMrp } from "../src/lib/mrp/order-mrp-engine"
import type { MrpBomLine, MrpDemandLine, MrpScheduledReceipt, OrderMrpOptions } from "../src/lib/mrp/types"
import { loadAndRunOrderMrp, type OrderMrpDb } from "../src/lib/services/mrp-order.service"
import { executeSimulationRequest, type SimulationDb } from "../src/lib/services/mrp-simulation.service"
import { makeFakeDb, type Row } from "./helpers/fake-db"

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
// 엔진(순수)
// ═════════════════════════════════════════════════════════════════════════════

const bomLine = (parent: string, comp: string, qtyPer: number, type: string, scrap = 0): MrpBomLine => ({
  parentItemId: parent,
  componentItemId: comp,
  componentCode: comp,
  componentItemType: type,
  qtyPer,
  scrapRate: scrap,
})
function demand(id: string, itemId: string, qty: number, due: string | null): MrpDemandLine {
  return { orderId: "o" + id, orderNo: "SO-" + id, orderLineId: "l" + id, itemId, itemCode: itemId, orderQty: qty, remainingQty: qty, deliveryDate: due }
}
const stocks = (m: Record<string, number>) => Object.entries(m).map(([componentItemId, quantity]) => ({ componentItemId, quantity }))
const mat = (r: ReturnType<typeof runOrderMrp>, id: string) => r.materials.find((m) => m.componentItemId === id)!

const BOM_FG_SF_RM: MrpBomLine[] = [bomLine("FG", "SF", 2, "SEMI_FINISHED"), bomLine("SF", "RM", 3, "RAW_MATERIAL")]

section("NT1 기준 예제: 10 → 20 − 8 = 12 → 36")
{
  const r = runOrderMrp(
    { demands: [demand("1", "FG", 10, "2026-10-12")], boms: BOM_FG_SF_RM, stocks: stocks({ SF: 8 }) },
    { mode: "NORMAL" }
  )
  eq([mat(r, "SF").totalRequirement, mat(r, "SF").nettedUsedQty, mat(r, "SF").nettedNetQty], [20, 8, 12], "NT1 반제품: 총 필요 20 / 재고 사용 8 / 순소요 12")
  eq([mat(r, "SF").finalBalance, mat(r, "SF").finalShortageQty], [-12, 12], "NT1 반제품 행: 최종 예상재고 −12(= 순소요 12 부족)")
  eq(mat(r, "RM").totalRequirement, 36, "NT1 원자재 소요 = 12 × 3 = 36 (기존 60 에서 감소)")
  eq(r.demands[0].semiNetting, [{ componentItemId: "SF", componentCode: "SF", grossQty: 20, usedQty: 8, netQty: 12 }], "NT1 수주 결과에 Netting 근거 기록")
  const old = runOrderMrp(
    { demands: [demand("1", "FG", 10, "2026-10-12")], boms: BOM_FG_SF_RM, stocks: stocks({ SF: 8 }) },
    { mode: "NORMAL", netSemiFinished: false }
  )
  eq(mat(old, "RM").totalRequirement, 60, "NT1 (비교) netSemiFinished=false 이면 기존 60")
  eq(mat(old, "SF").nettedUsedQty, 0, "NT1 (비교) 플래그 off: 반제품 재고 사용 기록 없음")
}

section("NT2 복수 수요: 공용 pool, 납기순, 이중계상 금지")
{
  // SEMI 재고 10, PO1 필요 8, PO2 필요 7 → PO1 8 사용(잔여 2) → PO2 2 사용, 순소요 5
  const r = runOrderMrp(
    {
      demands: [demand("2", "FG", 3.5, "2026-10-20"), demand("1", "FG", 4, "2026-10-10")],
      boms: [bomLine("FG", "SF", 2, "SEMI_FINISHED"), bomLine("SF", "RM", 1, "RAW_MATERIAL")],
      stocks: stocks({ SF: 10 }),
    },
    { mode: "NORMAL" }
  )
  const byNo = new Map(r.demands.map((d) => [d.orderNo, d]))
  eq(byNo.get("SO-1")!.semiNetting?.[0], { componentItemId: "SF", componentCode: "SF", grossQty: 8, usedQty: 8, netQty: 0 }, "NT2 납기 빠른 PO1: 8 사용(순소요 0)")
  eq(byNo.get("SO-2")!.semiNetting?.[0], { componentItemId: "SF", componentCode: "SF", grossQty: 7, usedQty: 2, netQty: 5 }, "NT2 PO2: 잔여 2 사용, 순소요 5")
  eq(mat(r, "RM").totalRequirement, 5, "NT2 하위 원자재는 5 개분만 전개(재고 10 을 각 수주가 따로 쓰지 않음)")
  eq([mat(r, "SF").nettedUsedQty, mat(r, "SF").nettedNetQty], [10, 5], "NT2 총 사용 10 = 재고 전량, 순소요 합계 5")
  eq(mat(r, "SF").movements.map((m) => m.balanceAfter), [2, -5], "NT2 반제품 행 잔량 10 → 2 → −5")
  // 같은 입력: 수요 입력 순서가 달라도 결과 동일(결정적 정렬)
  const r2 = runOrderMrp(
    {
      demands: [demand("1", "FG", 4, "2026-10-10"), demand("2", "FG", 3.5, "2026-10-20")],
      boms: [bomLine("FG", "SF", 2, "SEMI_FINISHED"), bomLine("SF", "RM", 1, "RAW_MATERIAL")],
      stocks: stocks({ SF: 10 }),
    },
    { mode: "NORMAL" }
  )
  eq(mat(r2, "RM").totalRequirement, mat(r, "RM").totalRequirement, "NT2 입력 순서와 무관한 결정적 결과")
}

section("NT3 다단계: Level 마다 Gross → Netting → Net")
{
  // PRODUCT → A(2) → B(3 per A) → RAW(4 per B).  수요 10, A 재고 5, B 재고 10
  const boms = [bomLine("P", "A", 2, "SEMI_FINISHED"), bomLine("A", "B", 3, "SEMI_FINISHED"), bomLine("B", "RAW", 4, "RAW_MATERIAL")]
  const r = runOrderMrp({ demands: [demand("1", "P", 10, "2026-10-12")], boms, stocks: stocks({ A: 5, B: 10 }) }, { mode: "NORMAL" })
  eq([mat(r, "A").totalRequirement, mat(r, "A").nettedUsedQty, mat(r, "A").nettedNetQty], [20, 5, 15], "NT3 A: 총 20 / 사용 5 / 순소요 15")
  eq([mat(r, "B").totalRequirement, mat(r, "B").nettedUsedQty, mat(r, "B").nettedNetQty], [45, 10, 35], "NT3 B: 총 45(= 15 × 3) / 사용 10 / 순소요 35")
  eq(mat(r, "RAW").totalRequirement, 140, "NT3 RAW = 35 × 4 = 140 (netting 없으면 10×2×3×4 = 240)")
  const none = runOrderMrp({ demands: [demand("1", "P", 10, "2026-10-12")], boms, stocks: stocks({ A: 5, B: 10 }) }, { mode: "NORMAL", netSemiFinished: false })
  eq(mat(none, "RAW").totalRequirement, 240, "NT3 (비교) 플래그 off = 240")
  eq(r.demands[0].semiNetting?.map((e) => [e.componentCode, e.grossQty, e.usedQty, e.netQty]), [["A", 20, 5, 15], ["B", 45, 10, 35]], "NT3 Level 별 근거 순서(A → B)")
  // 스크랩 반영
  const scrap = [bomLine("P", "A", 2, "SEMI_FINISHED", 0.1), bomLine("A", "RAW", 3, "RAW_MATERIAL", 0.05)]
  const rs = runOrderMrp({ demands: [demand("1", "P", 10, "2026-10-12")], boms: scrap, stocks: stocks({ A: 11 }) }, { mode: "NORMAL" })
  // A gross = 10 × 2 × 1.1 = 22, 재고 11 사용 → 순소요 11, RAW = 11 × 3 × 1.05 = 34.65
  eq([mat(rs, "A").totalRequirement, mat(rs, "A").nettedNetQty, Math.round(mat(rs, "RAW").totalRequirement * 1e6) / 1e6], [22, 11, 34.65], "NT3b 스크랩 반영: 총 22 → 순소요 11 → RAW 34.65")
}

section("NT4 재고 0: 기존 계산과 동일 (플래그 off 비교)")
{
  const boms = [bomLine("P", "A", 2, "SEMI_FINISHED", 0.1), bomLine("A", "RAW", 3, "RAW_MATERIAL", 0.05), bomLine("P", "R2", 1.5, "RAW_MATERIAL")]
  const input = { demands: [demand("1", "P", 7, "2026-10-12"), demand("2", "P", 3, "2026-10-14")], boms, stocks: stocks({ R2: 4 }) }
  const a = runOrderMrp(input, { mode: "NORMAL" })
  const b = runOrderMrp(input, { mode: "NORMAL", netSemiFinished: false })
  eq(a.materials.map((m) => [m.componentItemId, m.totalRequirement, m.finalBalance]), b.materials.map((m) => [m.componentItemId, m.totalRequirement, m.finalBalance]), "NT4 반제품 재고 없음 → 소요/잔량이 기존과 완전히 동일")
  eq(a.demands.every((d) => d.semiNetting === undefined), true, "NT4 재고를 쓰지 않은 수주는 Netting 기록 없음(정적 전개 그대로)")
}

section("NT5 재고가 전량 충당 → 하위 소요 0")
{
  const r = runOrderMrp({ demands: [demand("1", "FG", 10, "2026-10-12")], boms: BOM_FG_SF_RM, stocks: stocks({ SF: 50 }) }, { mode: "NORMAL" })
  eq([mat(r, "SF").nettedUsedQty, mat(r, "SF").nettedNetQty, mat(r, "RM").totalRequirement], [20, 0, 0], "NT5 반제품 20 전량 사용 → RM 소요 0")
  eq([mat(r, "SF").finalBalance, mat(r, "RM").finalBalance], [30, 0], "NT5 반제품 잔량 30 / RM 0")
}

section("NT6 확정 구매입고만 pool 증가 (수요 이후 입고 불가)")
{
  const rec = (qty: number, date: string): MrpScheduledReceipt => ({
    componentItemId: "SF", quantity: qty, expectedDate: date, purchaseOrderId: "po", purchaseOrderNo: "PO-1", purchaseOrderItemId: "poi-1",
  })
  const input = (receipts: MrpScheduledReceipt[]) => ({
    demands: [demand("1", "FG", 10, "2026-10-12")],
    boms: BOM_FG_SF_RM,
    stocks: stocks({ SF: 0 }),
    scheduledReceipts: receipts,
  })
  const before = runOrderMrp(input([rec(15, "2026-10-10")]), { mode: "NORMAL" })
  eq([mat(before, "SF").nettedUsedQty, mat(before, "SF").nettedNetQty, mat(before, "RM").totalRequirement], [15, 5, 15], "NT6 수요 전 확정 입고 15: 사용 15 / 순소요 5 / RM 15")
  const sameDay = runOrderMrp(input([rec(15, "2026-10-12")]), { mode: "NORMAL" })
  eq(mat(sameDay, "RM").totalRequirement, 15, "NT6 같은 날 입고도 수요 전에 반영(입고 → 수요)")
  const after = runOrderMrp(input([rec(15, "2026-10-15")]), { mode: "NORMAL" })
  eq([mat(after, "SF").nettedUsedQty, mat(after, "RM").totalRequirement], [0, 60], "NT6 수요 이후 입고는 사용 불가: RM 60(같은 부족을 중복 해소하지 않음)")
  eq([mat(after, "SF").finalBalance], [-20 + 15], "NT6 반제품 행 최종 −5(입고는 최종 예상재고에만 반영)")
  const none = runOrderMrp(input([]), { mode: "NORMAL" })
  eq(mat(none, "RM").totalRequirement, 60, "NT6 (비교) 입고 없음 RM 60")
}

section("NT7 EXCEL_COMPAT / 옵션 검증")
{
  const compat = runOrderMrp(
    { demands: [demand("1", "FG", 10, "2026-10-12")], boms: BOM_FG_SF_RM, stocks: stocks({ SF: 8 }) },
    { mode: "EXCEL_COMPAT", bomExplosion: "MULTI_LEVEL" }
  )
  eq([mat(compat, "SF").nettedUsedQty, mat(compat, "RM").totalRequirement], [0, 60], "NT7 호환 모드(다단계여도) Netting OFF: RM 60")
  assert.throws(() => resolveOrderMrpOptions({ mode: "EXCEL_COMPAT", netSemiFinished: true }), /EXCEL_COMPAT/)
  passed += 1
  console.log("PASS NT7 호환 모드에서 netSemiFinished=true 요청 거부")
  eq(resolveOrderMrpOptions({ mode: "NORMAL" }).netSemiFinished, true, "NT7 NORMAL 기본 ON")
  eq(resolveOrderMrpOptions({ mode: "NORMAL", bomExplosion: "SINGLE_LEVEL" }).netSemiFinished, false, "NT7 단일 레벨은 하위 전개가 없어 OFF")
  eq(resolveOrderMrpOptions({ mode: "NORMAL", netSemiFinished: false }).netSemiFinished, false, "NT7 명시적 OFF")
  eq(resolveOrderMrpOptions({ mode: "EXCEL_COMPAT" }).netSemiFinished, false, "NT7 호환 기본 OFF")
}

section("NT9 기간 MRP: 기간 밖 수요는 pool 을 소진하지 않음")
{
  const opts: OrderMrpOptions = { mode: "NORMAL", from: "2026-10-10", to: "2026-10-31" }
  const r = runOrderMrp(
    {
      demands: [demand("early", "FG", 3, "2026-09-20"), demand("in", "FG", 4, "2026-10-12")],
      boms: [bomLine("FG", "SF", 2, "SEMI_FINISHED"), bomLine("SF", "RM", 1, "RAW_MATERIAL")],
      stocks: stocks({ SF: 6 }),
    },
    opts
  )
  eq(r.demands.length, 1, "NT9 기간 내 수요 1건만 포함")
  eq([mat(r, "SF").nettedUsedQty, mat(r, "SF").nettedNetQty, mat(r, "RM").totalRequirement], [6, 2, 2], "NT9 기간 밖 수요(3×2=6)가 재고를 선점하지 않음: 8 − 6 = 2 → RM 2")
}

// ═════════════════════════════════════════════════════════════════════════════
// 서비스/어댑터 (fake DB)
// ═════════════════════════════════════════════════════════════════════════════

const T1 = "tenant-1"
const NOW = () => new Date("2026-10-01T03:00:00Z")
const params = { from: null, to: null, includeDraft: false }
const itemRow = (id: string, code: string, itemType: string, safetyStock = 0) => ({ id, tenantId: T1, code, name: code + " 이름", itemType, uom: "EA", status: "ACTIVE", safetyStock })
const FG = itemRow("fg", "FG-A", "FINISHED")
const comp = (code: string, itemType: string, safetyStock = 0) => ({ code, name: code + " 자재", spec: null, uom: "EA", itemType, safetyStock })
const bomRow = (id: string, itemId: string, items: Array<[string, number, ReturnType<typeof comp>]>) => ({
  id,
  tenantId: T1,
  itemId,
  version: "1",
  status: "ACTIVE",
  isDefault: true,
  bomItems: items.map(([componentItemId, qtyPer, componentItem], i) => ({ componentItemId, seq: i + 1, qtyPer, scrapRate: 0, componentItem })),
})
const soLine = (id: string, orderNo: string, qty: number, due: string, item = FG) => ({
  id,
  qty,
  shippedQty: 0,
  deliveryDate: new Date(due + "T00:00:00Z"),
  itemId: item.id,
  item,
  salesOrder: { id: "so-" + id, tenantId: T1, orderNo, status: "CONFIRMED", deliveryDate: new Date("2026-12-31T00:00:00Z"), customer: { name: "고객사" } },
})
const bal = (itemId: string, over: { onHand: number; hold?: number; avail: number; lot?: string | null; lotStatus?: string }) => ({
  tenantId: T1,
  itemId,
  item: { tenantId: T1 },
  qtyOnHand: over.onHand,
  qtyHold: over.hold ?? 0,
  qtyAvailable: over.avail,
  lotId: over.lot ?? null,
  lot: over.lot ? { tenantId: T1, status: over.lotStatus ?? "ACTIVE" } : null,
})
function poi(id: string, poNo: string, status: string, itemId: string, qty: number, expected: string) {
  const po = { id: "po-" + id, tenantId: T1, orderNo: poNo, status, expectedDate: new Date(expected + "T00:00:00Z"), note: null, supplier: { id: "s", name: "공급사" } }
  return { id: "poi-" + id, purchaseOrderId: po.id, itemId, qty, receivedQty: 0, workOrderOperationId: null, item: { tenantId: T1 }, purchaseOrder: po }
}
function world(over: Partial<Record<string, Row[]>> = {}, semiSafety = 0): Record<string, Row[]> {
  return {
    salesOrderItem: [soLine("l1", "SO-1", 10, "2026-10-12")],
    bOM: [
      bomRow("b-fg", "fg", [["sf", 2, comp("SF-1", "SEMI_FINISHED", semiSafety)]]),
      bomRow("b-sf", "sf", [["rm", 3, comp("RM-1", "RAW_MATERIAL")]]),
    ],
    inventoryBalance: [bal("sf", { onHand: 8, avail: 8 })],
    purchaseOrderItem: [],
    ...over,
  } as Record<string, Row[]>
}
const run = async (tables: Record<string, Row[]>, withReceipts = false) => {
  const f = makeFakeDb(tables)
  const p = await loadAndRunOrderMrp(f.db as OrderMrpDb, T1, withReceipts ? { ...params, includeScheduledReceipts: true } : params, NOW)
  return { p, f, view: p.view, byCode: (code: string) => p.view.materials.find((m) => m.code === code)! }
}

async function main() {
  section("NT11 서비스/화면: 예제 근거 추적")
  {
    const { view, byCode, p, f } = await run(world())
    const sf = byCode("SF-1")
    const rm = byCode("RM-1")
    eq([sf.totalRequirement, sf.qtyAvailable, sf.netting], [20, 8, { grossQty: 20, usedQty: 8, netQty: 12 }], "NT11 반제품 행: 총 필요 20 / 가용 8 / 사용 8 / 순소요 12")
    eq([sf.shortageQty, sf.finalBalance], [12, -12], "NT11 반제품 부족 = 순소요 12")
    eq([rm.totalRequirement, rm.steps[0].requirement], [36, 36], "NT11 원자재 소요 36")
    eq(rm.steps[0].netting, [{ parentCode: "SF-1", parentGross: 20, parentUsed: 8, parentNet: 12, qtyPer: 3, requirement: 36 }], "NT11 원자재 근거: SF-1 총 20 − 재고 8 = 순소요 12 × 3 = 36")
    eq(sf.steps[0].semiNetting, { grossQty: 20, usedQty: 8, netQty: 12 }, "NT11 반제품 수주 근거")
    eq(p.diagnostics.queryCount, f.reads.length, "쿼리 수 보고 = 실제 호출 수")
    eq(view.kpi.shortageMaterialCount, 2, "KPI 부족 자재 2: 반제품(순소요 12) + 원자재(재고 0, 소요 36)")
    eq(view.materials.map((m) => m.code).sort(), ["RM-1", "SF-1"], "자재 목록: 반제품과 원자재")
  }

  section("NT6(서비스) 확정 구매입고만 / DRAFT·WIP 제외")
  {
    const base = { inventoryBalance: [bal("sf", { onHand: 0, avail: 0 })] }
    const ordered = await run(world({ ...base, purchaseOrderItem: [poi("1", "PO-2026-000001", "ORDERED", "sf", 15, "2026-10-10")] }), true)
    eq([ordered.byCode("SF-1").netting, ordered.byCode("RM-1").totalRequirement], [{ grossQty: 20, usedQty: 15, netQty: 5 }, 15], "ORDERED 반제품 구매입고 15 → pool 15 사용, RM 15")
    const partial = await run(world({ ...base, purchaseOrderItem: [{ ...poi("1", "PO-2026-000001", "PARTIAL_RECEIVED", "sf", 20, "2026-10-10"), receivedQty: 5 }] }), true)
    eq(partial.byCode("RM-1").totalRequirement, 15, "PARTIAL_RECEIVED 잔량(20−5=15)만 사용 → RM 15")
    const draft = await run(world({ ...base, purchaseOrderItem: [poi("1", "PO-2026-000001", "DRAFT", "sf", 15, "2026-10-10")] }), true)
    eq(draft.byCode("RM-1").totalRequirement, 60, "DRAFT 구매는 pool 에 가산하지 않음(RM 60)")
    const closed = await run(world({ ...base, purchaseOrderItem: [poi("1", "PO-2026-000001", "CLOSED", "sf", 15, "2026-10-10")] }), true)
    eq(closed.byCode("RM-1").totalRequirement, 60, "CLOSED/RECEIVED/CANCELLED 구매는 제외(RM 60)")
    const late = await run(world({ ...base, purchaseOrderItem: [poi("1", "PO-2026-000001", "ORDERED", "sf", 15, "2026-10-20")] }), true)
    eq(late.byCode("RM-1").totalRequirement, 60, "수요 이후(10/20) 입고는 netting 에 쓰지 않음")
    ok(!ordered.f.reads.some((r) => r.model === "wipUnit"), "재공(WipUnit)은 조회하지 않음")
  }

  section("NT8 반제품 가용재고 정책: qtyAvailable / ACTIVE LOT / qtyHold·안전재고 비차감")
  {
    // qtyHold 는 이미 qtyAvailable 에 반영되어 있다: onHand 10, hold 3, available 7 → 7 사용(다시 빼지 않음)
    const hold = await run(world({ inventoryBalance: [bal("sf", { onHand: 10, hold: 3, avail: 7 })] }))
    eq(hold.byCode("SF-1").netting?.usedQty, 7, "qtyAvailable 7 을 그대로 사용(qtyHold 재차감 없음)")
    eq(hold.byCode("SF-1").qtyOnHand, 10, "qtyOnHand 는 표시용")
    // 안전재고 5 가 있어도 물리 netting 수량에서 차감하지 않는다
    const safety = await run(world({}, 5))
    eq(safety.byCode("SF-1").netting?.usedQty, 8, "안전재고 5 여도 가용 8 을 모두 netting 에 사용")
    // LOT 상태: ACTIVE 만 (QUARANTINE / ON_HOLD / EXPIRED / CONSUMED 제외)
    const lots = await run(
      world({
        inventoryBalance: [
          bal("sf", { onHand: 5, avail: 5, lot: "lot-a", lotStatus: "ACTIVE" }),
          bal("sf", { onHand: 4, avail: 4, lot: "lot-q", lotStatus: "QUARANTINE" }),
          bal("sf", { onHand: 3, avail: 3, lot: "lot-h", lotStatus: "ON_HOLD" }),
          bal("sf", { onHand: 2, avail: 2, lot: "lot-e", lotStatus: "EXPIRED" }),
          bal("sf", { onHand: 1, avail: 1, lot: "lot-c", lotStatus: "CONSUMED" }),
        ],
      })
    )
    eq([lots.byCode("SF-1").qtyAvailable, lots.byCode("SF-1").netting?.usedQty, lots.byCode("RM-1").totalRequirement], [5, 5, 45], "ACTIVE LOT 5 만 사용: 순소요 15 → RM 45")
    eq(lots.byCode("SF-1").qtyExcludedByLot, 10, "제외된 LOT 재고는 표시(10)")
  }

  section("NT10 What-if: 가상 수요도 공용 pool 을 입력 순서대로 소진")
  {
    const SF = itemRow("sf", "SF-1", "SEMI_FINISHED")
    const FG2 = itemRow("fg2", "FG-B", "FINISHED")
    const tables: Record<string, Row[]> = {
      item: [FG, FG2, SF],
      bOM: [
        bomRow("b-fg", "fg", [["sf", 2, comp("SF-1", "SEMI_FINISHED")]]),
        bomRow("b-fg2", "fg2", [["sf", 1, comp("SF-1", "SEMI_FINISHED")]]),
        bomRow("b-sf", "sf", [["rm", 3, comp("RM-1", "RAW_MATERIAL")]]),
      ],
      inventoryBalance: [bal("sf", { onHand: 10, avail: 10 })],
    }
    const f = makeFakeDb(tables)
    const res = await executeSimulationRequest(
      { authorize: async () => ({ tenantId: T1 }), db: f.db as SimulationDb, now: NOW },
      { items: [{ itemId: "fg", qty: 4 }, { itemId: "fg2", qty: 5 }] }
    )
    const sf = res.view.materials.find((m) => m.code === "SF-1")!
    const rm = res.view.materials.find((m) => m.code === "RM-1")!
    // FG 4 × 2 = 8, FG2 5 × 1 = 5 → 총 13, 재고 10 → 사용 10 (SIM-001 8, SIM-002 2) → 순소요 3 → RM 9
    eq([sf.totalRequirement, sf.netting], [13, { grossQty: 13, usedQty: 10, netQty: 3 }], "NT10 반제품 총 13 / 사용 10 / 순소요 3")
    eq(rm.totalRequirement, 9, "NT10 RM = 3 × 3 = 9 (netting 없으면 39)")
    eq(rm.sources.map((s) => [s.itemCode, s.requirement]), [["FG-B", 9]], "NT10 입력 순서대로 소진: 첫 제품은 재고로 충당, 순소요는 두 번째 제품에서 발생")
    ok((rm.sources[0].netting?.[0]?.parentUsed ?? 0) === 2, "NT10 두 번째 제품 근거: 재고 2 사용(잔여 pool)")
  }

  section("쿼리 수 / 정적 점검")
  {
    const lines = Array.from({ length: 300 }, (_, i) => soLine("b" + i, "SO-B" + i, 1, "2026-10-12"))
    const small = await run(world({ salesOrderItem: lines.slice(0, 3) }))
    const big = await run(world({ salesOrderItem: lines }))
    eq(small.p.diagnostics.queryCount, big.p.diagnostics.queryCount, "수주 3건 vs 300건 쿼리 수 동일(netting 추가 쿼리 없음)")
    const root = join(__dirname, "..")
    const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8")
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    const engine = code(read("src", "lib", "mrp", "order-mrp-engine.ts"))
    ok(/netSemiFinished/.test(engine) && /pool/.test(engine), "엔진: 반제품 공용 pool Netting 구현")
    ok(!/wipUnit|WipUnit|safetyStock/.test(engine), "엔진: WIP/안전재고를 사용하지 않음")
    ok(!/Date\.now|new Date\(/.test(engine), "엔진: 현재 시각 비의존")
    const loaders = code(read("src", "lib", "services", "mrp-loaders.ts"))
    ok(!/wipUnit|wipMovement/i.test(loaders), "로더: 재공(WIP) 조회 없음")
    // 5E 는 migration 을 추가하지 않는다(5D 까지 4건). Phase 6 migration 은 이 시점 이후이므로 제외하고 센다.
    const migs = readdirSync(join(root, "prisma", "migrations")).filter((n) => /^\d{14}_/.test(n) && n < "20261014020000")
    ok(migs.length === 4 && migs[migs.length - 1] === "20261014010000_add_item_safety_stock", "5E 는 migration 추가 없음(5D 까지 4건)")
    const planService = read("src", "lib", "services", "mrp-plan.service.ts")
    ok(!/netSemiFinished|semiNetting/.test(planService), "기존 생산계획 MRP(calculateMRP)는 변경하지 않음")
  }

  console.log(`\n✅ mrp-semi-netting: ${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
