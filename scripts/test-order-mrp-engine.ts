/**
 * 수주 기반 MRP 엔진 테스트 (순수 함수 · DB/네트워크 없음)
 *
 * 실행: npm run test:order-mrp-engine
 *
 *  S0  Excel 기준선(Golden): 출고예정소요량 36,582셀 + MRP작성 소요량/잔량/결품수/누계
 *  S1  기본 수주 3건 순차 차감
 *  S2  동일 납기 결정적 정렬
 *  S3  기간 from/to 양끝 포함, date-only
 *  S4  BOM 없는 제품
 *  S5  동일 BOM 자재 반복
 *  S6  동일 수주 중복 라인
 *  S7  부분출하 remainingQty
 *  S8  취소 수주
 *  S9  재고 0 / 음수
 *  S10 소수 qtyPer 반올림 없음
 *  S11 NORMAL vs EXCEL_COMPAT
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { runOrderMrp, resolveOrderMrpOptions } from "../src/lib/mrp/order-mrp-engine"
import { isDateOnly, isWithinPeriod, toDateOnly, excelSerialToDateOnly } from "../src/lib/mrp/period"
import type {
  MrpBomLine,
  MrpDemandLine,
  MrpStockEntry,
  OrderMrpOptions,
  OrderMrpResult,
} from "../src/lib/mrp/types"

let passed = 0
function pass(label: string) {
  passed += 1
  console.log("PASS " + label)
}
function eq<T>(actual: T, expected: T, label: string) {
  assert.deepStrictEqual(actual, expected, label)
  pass(label)
}
function isTrue(value: unknown, label: string) {
  assert.ok(value, label)
  pass(label)
}
function section(title: string) {
  console.log("\n── " + title)
}

// ─── builders ────────────────────────────────────────────────────────────────

function dm(over: Partial<MrpDemandLine> & { orderLineId: string }): MrpDemandLine {
  return {
    orderId: "o-" + over.orderLineId,
    orderNo: "SO-" + over.orderLineId,
    orderLineNo: 1,
    itemId: "fg",
    itemCode: "FG",
    orderQty: 1,
    deliveryDate: "2026-06-01",
    ...over,
  }
}
function bl(parentItemId: string, componentItemId: string, qtyPer: number, over: Partial<MrpBomLine> = {}): MrpBomLine {
  return {
    parentItemId,
    componentItemId,
    componentCode: componentItemId.toUpperCase(),
    componentItemType: "RAW_MATERIAL",
    qtyPer,
    ...over,
  }
}
const normal: OrderMrpOptions = { mode: "NORMAL" }
const compat: OrderMrpOptions = { mode: "EXCEL_COMPAT" }

function run(
  demands: MrpDemandLine[],
  boms: MrpBomLine[],
  stocks: MrpStockEntry[] = [],
  options: OrderMrpOptions = normal
): OrderMrpResult {
  return runOrderMrp({ demands, boms, stocks }, options)
}
function mat(result: OrderMrpResult, id: string) {
  const m = result.materials.find((x) => x.componentItemId === id)
  assert.ok(m, `material ${id} not found`)
  return m
}
const lineIds = (r: OrderMrpResult) => r.demands.map((d) => d.orderLineId)

// ─── S0: Excel Golden ────────────────────────────────────────────────────────

type ShipmentFixture = {
  meta: { demandCount: number; materialCount: number; cellsCompared: number }
  materialCodes: string[]
  boms: Record<string, Array<[string, number]>>
  demands: Array<{ po: string; item: string; qty: number; due: string; line: number }>
  expected: Array<Record<string, number>>
}
type MrpFixture = {
  meta: { demandCount: number; materialCount: number; derivationIssues: string[] }
  materialCodes: string[]
  openingStock: Record<string, number>
  boms: Record<string, Array<[string, number]>>
  demands: Array<{ po: string; item: string; qty: number; due: string; line: number }>
  expected: Array<{
    req: Record<string, number>
    bal: Record<string, number>
    shortageItemCount: number
    cumulativeNegativeItemCount: number
  }>
}
const fixtureDir = join(process.cwd(), "scripts", "fixtures", "order-mrp")
const readJson = <T>(name: string): T => JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as T

function goldenInput(fx: {
  boms: Record<string, Array<[string, number]>>
  demands: Array<{ po: string; item: string; qty: number; due: string; line: number }>
}) {
  const boms: MrpBomLine[] = []
  for (const [item, lines] of Object.entries(fx.boms)) {
    lines.forEach(([code, qty], i) => {
      assert.equal(typeof qty, "number", `fixture BOM qty must be numeric (${item}/${code})`)
      boms.push({
        parentItemId: "item:" + item,
        componentItemId: "mat:" + code,
        componentCode: code,
        componentItemType: "RAW_MATERIAL",
        qtyPer: qty,
        lineNo: i + 1,
      })
    })
  }
  const demands: MrpDemandLine[] = fx.demands.map((d) => ({
    orderId: "order:" + d.po,
    orderNo: d.po,
    orderLineId: `line:${d.po}:${d.line}`,
    orderLineNo: d.line,
    itemId: "item:" + d.item,
    itemCode: d.item,
    orderQty: d.qty,
    deliveryDate: d.due,
  }))
  return { boms, demands }
}

section("S0-A Excel 기준선: 출고예정소요량 (수주 라인 × 자재 소요량)")
const shipFx = readJson<ShipmentFixture>("excel-golden-shipment-plan.json")
let shipCompared = 0
let shipMismatch = 0
{
  const { boms, demands } = goldenInput(shipFx)
  const r = run(demands, boms, [], compat)
  eq(r.demands.length, shipFx.meta.demandCount, "S0-A 134개 수주 라인 전부 계산에 포함")
  eq(r.excludedOrderLines.length, 0, "S0-A 제외된 수주 라인 없음")
  const byLine = new Map(r.demands.map((d) => [d.orderLineId, d]))
  shipFx.demands.forEach((fxd, i) => {
    const res = byLine.get(`line:${fxd.po}:${fxd.line}`)
    assert.ok(res, "result demand exists")
    const actual = new Map(res.requirements.map((q) => [q.componentCode, q.requirement]))
    const expected = shipFx.expected[i]
    for (const code of shipFx.materialCodes) {
      shipCompared += 1
      const want = expected[code] ?? 0
      const got = actual.get(code) ?? 0
      if (want !== got) {
        shipMismatch += 1
        console.log(`  MISMATCH ${fxd.po}/${fxd.item} ${code} want=${want} got=${got}`)
      }
    }
  })
  eq(shipCompared, shipFx.meta.cellsCompared, "S0-A 비교 셀 수 = 36,582 (134수주 × 273자재)")
  eq(shipMismatch, 0, "S0-A Excel 대비 불일치 셀 0건")
  // 열 합계(Excel G열): 자재별 총소요량
  let totalOk = true
  for (const code of shipFx.materialCodes) {
    const sum = shipFx.expected.reduce((s, e) => s + (e[code] ?? 0), 0)
    const m = r.materials.find((x) => x.componentCode === code)
    if ((m?.totalRequirement ?? 0) !== sum) totalOk = false
  }
  isTrue(totalOk, "S0-A 자재별 총소요량(G열) 273/273 일치")
  // Excel 정렬 재현: 납기 오름차순 + 동일 납기는 입력 순서 유지
  const dueSeq = r.demands.map((d) => d.deliveryDate as string)
  isTrue(dueSeq.every((d, i) => i === 0 || dueSeq[i - 1] <= d), "S0-A EXCEL_COMPAT 납기 오름차순 정렬")
  const stable = r.demands.every(
    (d, i) => i === 0 || r.demands[i - 1].deliveryDate !== d.deliveryDate || r.demands[i - 1].orderLineNo! < d.orderLineNo!
  )
  isTrue(stable, "S0-A 동일 납기는 입력(시트) 순서 유지")
}

section("S0-B Excel 기준선: MRP작성 (순차 차감·결품수·누계)")
const mrpFx = readJson<MrpFixture>("excel-golden-mrp.json")
let mrpReqCompared = 0
let mrpBalCompared = 0
let mrpMismatch = 0
{
  eq(mrpFx.meta.derivationIssues, [], "S0-B fixture BOM 역산 이상 없음")
  const { boms, demands } = goldenInput(mrpFx)
  const stocks: MrpStockEntry[] = Object.entries(mrpFx.openingStock).map(([code, quantity]) => ({
    componentItemId: "mat:" + code,
    quantity,
  }))
  // Excel MRP 기간작성은 납기 정렬이 적용되지 않은 시트 순서로 계산되었다(캐시 납기 비오름차순)
  const r = run(demands, boms, stocks, { mode: "EXCEL_COMPAT", ordering: "INPUT_ORDER" })
  eq(r.demands.length, mrpFx.meta.demandCount, "S0-B 9개 수주 라인 계산")
  mrpFx.demands.forEach((fxd, i) => {
    const res = r.demands[i]
    eq(res.orderLineId, `line:${fxd.po}:${fxd.line}`, `S0-B 열 ${i + 1} 순서(시트 순서) 일치`)
    const exp = mrpFx.expected[i]
    const reqMap = new Map(res.requirements.map((q) => [q.componentCode, q.requirement]))
    for (const code of mrpFx.materialCodes) {
      mrpReqCompared += 1
      const m = r.materials.find((x) => x.componentCode === code)
      const mv = m?.movements[i]
      const wantReq = exp.req[code] ?? 0
      const wantBal = exp.bal[code] ?? 0
      if ((reqMap.get(code) ?? 0) !== wantReq) {
        mrpMismatch += 1
        console.log(`  MISMATCH req col${i + 1} ${code} want=${wantReq} got=${reqMap.get(code) ?? 0}`)
      }
      mrpBalCompared += 1
      if ((mv?.balanceAfter ?? 0) !== wantBal) {
        mrpMismatch += 1
        console.log(`  MISMATCH bal col${i + 1} ${code} want=${wantBal} got=${mv?.balanceAfter ?? 0}`)
      }
    }
    eq(res.shortageItemCount, exp.shortageItemCount, `S0-B 열 ${i + 1} 결품품목수 일치(${exp.shortageItemCount})`)
    eq(res.cumulativeNegativeItemCount, exp.cumulativeNegativeItemCount, `S0-B 열 ${i + 1} 누계 일치(${exp.cumulativeNegativeItemCount})`)
  })
  eq(mrpReqCompared, 9 * 273, "S0-B 소요량 비교 셀 2,457")
  eq(mrpBalCompared, 9 * 273, "S0-B 잔량 비교 셀 2,457")
  eq(mrpMismatch, 0, "S0-B Excel 대비 불일치 셀 0건")
  // 요약 열: H = Σ소요, I = G - H
  let hiOk = true
  for (const code of mrpFx.materialCodes) {
    const sum = mrpFx.expected.reduce((s, e) => s + (e.req[code] ?? 0), 0)
    const open = mrpFx.openingStock[code] ?? 0
    const m = r.materials.find((x) => x.componentCode === code)
    if ((m?.totalRequirement ?? 0) !== sum || (m?.finalBalance ?? open) !== open - sum) hiOk = false
  }
  isTrue(hiOk, "S0-B 소요예상량(H)·예상재고(I) 273/273 일치")

  // 같은 입력을 NORMAL(납기순)로 돌리면 열 순서가 달라진다 = 운영 기본은 Excel 정렬 오류를 재현하지 않음
  const n = run(demands, boms, stocks, normal)
  const dues = n.demands.map((d) => d.deliveryDate as string)
  isTrue(dues.every((d, i) => i === 0 || dues[i - 1] <= d), "S0-B NORMAL 은 납기 오름차순(Excel 정렬 미적용 동작을 복제하지 않음)")
  isTrue(JSON.stringify(lineIds(n)) !== JSON.stringify(lineIds(r)), "S0-B NORMAL 과 INPUT_ORDER 호환 결과의 처리 순서가 다름")
}

// ─── S1 ──────────────────────────────────────────────────────────────────────
section("S1 기본 수주 3건 순차 차감 (재고 100: 30 / 50 / 40)")
{
  const demands = [
    dm({ orderLineId: "po1", orderQty: 30, deliveryDate: "2026-06-01" }),
    dm({ orderLineId: "po2", orderQty: 50, deliveryDate: "2026-06-02" }),
    dm({ orderLineId: "po3", orderQty: 40, deliveryDate: "2026-06-03" }),
  ]
  const r = run(demands, [bl("fg", "c1", 1)], [{ componentItemId: "c1", quantity: 100 }])
  const m = mat(r, "c1")
  eq(m.movements.map((x) => x.balanceAfter), [70, 20, -20], "S1 잔량 70 / 20 / -20")
  eq(m.movements.map((x) => x.balanceBefore), [100, 70, 20], "S1 직전잔량 100 / 70 / 20")
  eq(m.movements.map((x) => x.isShortage), [false, false, true], "S1 결품 판정")
  eq(m.movements[2].shortageAtThisDemand, 20, "S1 PO3 결품량 20")
  eq(m.firstShortage?.orderLineId, "po3", "S1 최초 결품 수주 PO3")
  eq(m.firstShortage?.deliveryDate, "2026-06-03", "S1 최초 결품일")
  eq(m.firstShortage?.balanceBefore, 20, "S1 최초 결품 직전잔량 20")
  eq(m.firstShortage?.balanceAfter, -20, "S1 최초 결품 후 잔량 -20")
  eq(m.finalBalance, -20, "S1 최종 예상재고 -20")
  eq(m.finalShortageQty, 20, "S1 최종 부족수량 20")
  eq(m.shortageDemandCount, 1, "S1 결품 수주 수 1")
  eq(m.negativeStepCount, 1, "S1 음수잔량 단계 수 1")
  eq(r.demands.map((d) => d.shortageItemCount), [0, 0, 1], "S1 수주별 결품품목수")
  eq(r.demands.map((d) => d.cumulativeNegativeItemCount), [0, 0, 1], "S1 수주별 누계")
  eq(r.summary.firstShortage?.orderLineId, "po3", "S1 전체 최초 결품 수주")
  eq(r.summary.totalFinalShortageQty, 20, "S1 전체 최종 부족 20")
  // 입력 배열 순서와 무관하게 납기순으로 처리
  const shuffled = run([demands[2], demands[0], demands[1]], [bl("fg", "c1", 1)], [{ componentItemId: "c1", quantity: 100 }])
  eq(lineIds(shuffled), ["po1", "po2", "po3"], "S1 입력 순서를 섞어도 납기순 처리")
  eq(mat(shuffled, "c1").movements.map((x) => x.balanceAfter), [70, 20, -20], "S1 섞은 입력도 동일 결과")
  // 음수 잔량 이후 추가 수주는 전량이 결품
  const r2 = run(
    [...demands, dm({ orderLineId: "po4", orderQty: 10, deliveryDate: "2026-06-04" })],
    [bl("fg", "c1", 1)],
    [{ componentItemId: "c1", quantity: 100 }]
  )
  const m2 = mat(r2, "c1")
  eq(m2.movements[3].balanceAfter, -30, "S1 음수 이후 계속 차감(0 클램프 없음)")
  eq(m2.movements[3].shortageAtThisDemand, 10, "S1 이미 음수면 해당 수주 전량이 결품")
  eq(m2.firstShortage?.orderLineId, "po3", "S1 최초 결품은 변하지 않음")
  eq(m2.finalShortageQty, 30, "S1 최종 부족 30")
}

// ─── S2 ──────────────────────────────────────────────────────────────────────
section("S2 동일 납기 deterministic order")
{
  const same = "2026-06-10"
  const demands = [
    dm({ orderLineId: "z", orderNo: "B-200", orderLineNo: 1, deliveryDate: same }),
    dm({ orderLineId: "y", orderNo: "A-100", orderLineNo: 2, deliveryDate: same }),
    dm({ orderLineId: "x", orderNo: "A-100", orderLineNo: 1, deliveryDate: same }),
    dm({ orderLineId: "w", orderNo: "SO-9", customerPoNo: "A-050", orderLineNo: 1, deliveryDate: same }),
    dm({ orderLineId: "v", orderNo: "A-100", orderLineNo: 1, deliveryDate: same }),
    dm({ orderLineId: "early", orderNo: "Z-999", orderLineNo: 9, deliveryDate: "2026-06-09" }),
  ]
  const boms = [bl("fg", "c1", 1)]
  const r = run(demands, boms)
  eq(lineIds(r), ["early", "w", "x", "v", "y", "z"], "S2 납기 → 고객PO|orderNo → orderNo → 라인번호 → 입력순서")
  const r2 = run([...demands].reverse(), boms)
  // 완전 동률(x, v)은 입력 순서가 최종 키이므로 입력 순서가 바뀌면 그 둘만 바뀐다
  eq(lineIds(r2), ["early", "w", "v", "x", "y", "z"], "S2 완전 동률은 입력 순서가 결정")
  eq(JSON.stringify(run(demands, boms)), JSON.stringify(run(demands, boms)), "S2 같은 입력 → 동일 결과(결정적)")
  // originalIndex 가 있으면 그것이 입력 순서 키
  const withIdx = run(
    [
      dm({ orderLineId: "a", orderNo: "P", deliveryDate: same, originalIndex: 5 }),
      dm({ orderLineId: "b", orderNo: "P", deliveryDate: same, originalIndex: 2 }),
    ],
    boms
  )
  eq(lineIds(withIdx), ["b", "a"], "S2 originalIndex 우선")
  // 납기 미정은 NORMAL 에서 마지막
  const undated = run([dm({ orderLineId: "n", deliveryDate: null }), dm({ orderLineId: "d", deliveryDate: "2026-12-31" })], boms)
  eq(lineIds(undated), ["d", "n"], "S2 NORMAL 납기 미정은 마지막")
  eq(undated.warnings.some((w) => w.code === "MISSING_DELIVERY_DATE" && w.severity === "INFO"), true, "S2 납기 미정 INFO 경고")
}

// ─── S3 ──────────────────────────────────────────────────────────────────────
section("S3 기간 from/to 양끝 포함 · date-only")
{
  const demands = [
    dm({ orderLineId: "d0531", deliveryDate: "2026-05-31" }),
    dm({ orderLineId: "d0601", deliveryDate: "2026-06-01" }),
    dm({ orderLineId: "d0615", deliveryDate: "2026-06-15" }),
    dm({ orderLineId: "d0630", deliveryDate: "2026-06-30" }),
    dm({ orderLineId: "d0701", deliveryDate: "2026-07-01" }),
    dm({ orderLineId: "dnull", deliveryDate: null }),
  ]
  const boms = [bl("fg", "c1", 1)]
  const r = run(demands, boms, [], { mode: "NORMAL", from: "2026-06-01", to: "2026-06-30" })
  eq(lineIds(r), ["d0601", "d0615", "d0630"], "S3 양끝(06-01, 06-30) 포함")
  const out = r.excludedOrderLines.map((e) => `${e.orderLineId}:${e.reason}`).sort()
  eq(out, ["d0531:OUT_OF_PERIOD", "d0701:OUT_OF_PERIOD", "dnull:MISSING_DELIVERY_DATE"], "S3 기간 밖/납기 미정 제외 사유")
  eq(lineIds(run(demands, boms, [], { mode: "NORMAL", from: "2026-06-15" })), ["d0615", "d0630", "d0701"], "S3 from 만 지정(상한 없음)")
  eq(lineIds(run(demands, boms, [], { mode: "NORMAL", to: "2026-06-01" })), ["d0531", "d0601"], "S3 to 만 지정(하한 없음)")
  eq(lineIds(run(demands, boms, [], { mode: "NORMAL" })).length, 6, "S3 기간 없음 = 모든 미출하 수주(납기 미정 포함)")
  eq(lineIds(run(demands, boms, [], { mode: "NORMAL", from: "2026-06-30", to: "2026-06-30" })), ["d0630"], "S3 단일일 기간")
  assert.throws(() => run(demands, boms, [], { mode: "NORMAL", from: "2026-07-01", to: "2026-06-01" }), /늦습니다/)
  pass("S3 from > to 는 RangeError")
  assert.throws(() => run(demands, boms, [], { mode: "NORMAL", from: "2026-6-1" }), /YYYY-MM-DD/)
  pass("S3 잘못된 날짜 형식 거부")
  assert.throws(() => run(demands, boms, [], { mode: "NORMAL", includeOpenEnded: false, from: "2026-06-01" }), /includeOpenEnded/)
  pass("S3 includeOpenEnded=false 이면 from/to 모두 필수")
  // date-only 변환: KST 자정 직후(UTC 전날)도 하루 밀리지 않는다
  eq(toDateOnly(new Date("2026-06-30T15:30:00Z")), "2026-07-01", "S3 KST 기준 date-only (UTC 06-30 15:30 → 07-01)")
  eq(toDateOnly(new Date("2026-06-30T14:59:59Z")), "2026-06-30", "S3 KST 06-30 23:59:59")
  eq(toDateOnly(new Date("2026-06-30T15:30:00Z"), "UTC"), "2026-06-30", "S3 UTC 지정 시 06-30")
  eq(excelSerialToDateOnly(46174), "2026-06-01", "S3 Excel 일련번호 46174 = 2026-06-01")
  isTrue(isDateOnly("2024-02-29") && !isDateOnly("2026-02-29") && !isDateOnly("2026-13-01"), "S3 달력 유효성")
  isTrue(isWithinPeriod("2026-06-01", { from: "2026-06-01", to: null }) && !isWithinPeriod(null, { from: null, to: null }), "S3 isWithinPeriod")
  // 날짜 형식이 잘못된 수주 라인은 제외 + 경고
  const bad = run([dm({ orderLineId: "bad", deliveryDate: "2026/06/01" })], boms)
  eq(bad.excludedOrderLines[0]?.reason, "INVALID_DELIVERY_DATE", "S3 잘못된 납기 라인 제외")
}

// ─── S4 ──────────────────────────────────────────────────────────────────────
section("S4 BOM 없는 제품 (직전 BOM 대입/무시 금지)")
for (const options of [normal, compat]) {
  const demands = [
    dm({ orderLineId: "ok1", itemId: "fg", itemCode: "FG", orderQty: 10, deliveryDate: "2026-06-01" }),
    dm({ orderLineId: "nobom", itemId: "fg-x", itemCode: "FGX", orderNo: "SO-NOBOM", orderQty: 99, deliveryDate: "2026-06-02" }),
    dm({ orderLineId: "ok2", itemId: "fg", itemCode: "FG", orderQty: 5, deliveryDate: "2026-06-03" }),
  ]
  const r = run(demands, [bl("fg", "c1", 2)], [], options)
  const tag = `S4[${options.mode}]`
  eq(lineIds(r), ["ok1", "ok2"], `${tag} 정상 수주는 계속 계산`)
  eq(mat(r, "c1").totalRequirement, 30, `${tag} BOM 없는 수주(99)의 소요량이 직전 BOM 으로 계산되지 않음`)
  eq(r.excludedOrderLines.map((e) => [e.orderLineId, e.reason]), [["nobom", "MISSING_BOM"]], `${tag} excludedOrderLines 기록`)
  const w = r.warnings.filter((x) => x.code === "MISSING_BOM")
  eq(w.length, 1, `${tag} MISSING_BOM 경고 1건`)
  eq([w[0].orderNo, w[0].orderLineId, w[0].itemId, w[0].itemCode], ["SO-NOBOM", "nobom", "fg-x", "FGX"], `${tag} 경고에 orderNo/라인/품목 포함`)
}
{
  const r = run([dm({ orderLineId: "only", itemId: "fg-x", itemCode: "FGX" })], [bl("fg", "c1", 1)])
  eq(r.materials.length, 0, "S4 전부 BOM 없음 → 자재 없음, 오류 없음")
  eq(r.summary.excludedDemandCount, 1, "S4 제외 건수 요약")
}

// ─── S5 ──────────────────────────────────────────────────────────────────────
section("S5 동일 BOM component 반복 (저장 데이터 불변, 계산 시 합산)")
{
  const boms = Object.freeze([
    Object.freeze(bl("fg", "c1", 2, { lineNo: 1 })),
    Object.freeze(bl("fg", "c2", 1, { lineNo: 2 })),
    Object.freeze(bl("fg", "c1", 3, { lineNo: 3 })),
  ]) as MrpBomLine[]
  const demands = Object.freeze([Object.freeze(dm({ orderLineId: "a", orderQty: 4 }))]) as MrpDemandLine[]
  const snapshot = JSON.stringify({ boms, demands })
  const r = run(demands, boms)
  eq(mat(r, "c1").totalRequirement, 20, "S5 c1 = 4 × (2+3) = 20")
  eq(mat(r, "c2").totalRequirement, 4, "S5 c2 = 4")
  eq(r.demands[0].requirements.filter((q) => q.componentItemId === "c1").length, 1, "S5 수주 결과에는 자재당 1행")
  eq(JSON.stringify({ boms, demands }), snapshot, "S5 입력 BOM 라인 mutate/dedupe 없음")
  eq(boms.length, 3, "S5 BOM 라인 3개 유지")
  isTrue(r.warnings.some((w) => w.code === "DUPLICATE_BOM_COMPONENT" && w.componentItemId === "c1"), "S5 반복 자재 INFO 경고")
  // 반복 라인의 입력 순서가 달라도 합 동일
  const reordered = run(demands, [boms[2], boms[1], boms[0]].map((l) => ({ ...l, lineNo: null })))
  eq(mat(reordered, "c1").totalRequirement, 20, "S5 라인 순서가 달라도 합산 동일")
}

// ─── S6 ──────────────────────────────────────────────────────────────────────
section("S6 동일 수주 중복 line (자동 병합 금지)")
{
  const demands = [
    dm({ orderLineId: "l1", orderNo: "PO-1", itemId: "fg", orderQty: 1, deliveryDate: "2026-06-05" }),
    dm({ orderLineId: "l2", orderNo: "PO-1", itemId: "fg", orderQty: 1, deliveryDate: "2026-06-05" }),
    dm({ orderLineId: "l3", orderNo: "PO-2", itemId: "fg", orderQty: 1, deliveryDate: "2026-06-05" }),
  ]
  const r = run(demands, [bl("fg", "c1", 7)], [{ componentItemId: "c1", quantity: 14 }])
  eq(r.demands.length, 3, "S6 3개 라인 모두 계산(병합/삭제 없음)")
  eq(mat(r, "c1").totalRequirement, 21, "S6 소요 7×3 = 21")
  eq(mat(r, "c1").movements.map((m) => m.balanceAfter), [7, 0, -7], "S6 중복 라인 각각 순차 차감")
  eq(lineIds(r), ["l1", "l2", "l3"], "S6 안정 정렬(입력 순서)")
  const w = r.warnings.filter((x) => x.code === "POSSIBLE_DUPLICATE_DEMAND")
  eq(w.length, 1, "S6 POSSIBLE_DUPLICATE_DEMAND 1건")
  eq(w[0].relatedOrderLineIds, ["l1", "l2"], "S6 중복 후보 라인 목록(PO-2 제외)")
  // 같은 orderLineId 두 번: 둘 다 계산 + 경고
  const same = run([dm({ orderLineId: "dup" }), dm({ orderLineId: "dup" })], [bl("fg", "c1", 1)])
  eq(same.demands.length, 2, "S6 동일 orderLineId 도 각각 계산")
  isTrue(same.warnings.some((x) => x.code === "DUPLICATE_ORDER_LINE_ID"), "S6 DUPLICATE_ORDER_LINE_ID 경고")
}

// ─── S7 ──────────────────────────────────────────────────────────────────────
section("S7 부분출하 remainingQty")
{
  const boms = [bl("fg", "c1", 1)]
  const r = run([dm({ orderLineId: "p", orderQty: 100, remainingQty: 60 })], boms)
  eq(r.demands[0].demandQty, 60, "S7 NORMAL: 주문 100, 출하 40 → MRP 대상 60")
  eq(mat(r, "c1").totalRequirement, 60, "S7 소요 60")
  const none = run([dm({ orderLineId: "done", orderQty: 100, remainingQty: 0 })], boms)
  eq(none.excludedOrderLines[0]?.reason, "NO_REMAINING_QTY", "S7 잔량 0 → 제외")
  const completed = run([dm({ orderLineId: "c", orderQty: 100, remainingQty: 10, completed: true })], boms)
  eq(completed.excludedOrderLines[0]?.reason, "COMPLETED", "S7 completed → 제외")
  const fallback = run([dm({ orderLineId: "f", orderQty: 25 })], boms)
  eq(fallback.demands[0].demandQty, 25, "S7 remainingQty 없으면 orderQty")
  const frac = run([dm({ orderLineId: "frac", orderQty: 10, remainingQty: 2.5 })], boms)
  eq(frac.demands[0].demandQty, 2.5, "S7 소수 잔량")
  const neg = run([dm({ orderLineId: "neg", orderQty: 10, remainingQty: -3 })], boms)
  eq(neg.excludedOrderLines[0]?.reason, "INVALID_QUANTITY", "S7 음수 잔량은 제외+경고")
  // EXCEL_COMPAT: 출고일(shipped) 있으면 전체 제외, 없으면 remainingQty 를 쓰지 않고 orderQty
  const c1 = run([dm({ orderLineId: "cp", orderQty: 100, remainingQty: 60 })], boms, [], compat)
  eq(c1.demands[0].demandQty, 100, "S7 EXCEL_COMPAT: 부분출하 개념 없음 → orderQty")
  const c2 = run([dm({ orderLineId: "cs", orderQty: 100, remainingQty: 60, shipped: true })], boms, [], compat)
  eq(c2.excludedOrderLines[0]?.reason, "SHIPPED", "S7 EXCEL_COMPAT: 출고일 존재 → 라인 전체 제외")
  const n2 = run([dm({ orderLineId: "ns", orderQty: 100, remainingQty: 60, shipped: true })], boms)
  eq(n2.demands[0].demandQty, 60, "S7 NORMAL: shipped 플래그는 사용하지 않고 잔량 기준")
}

// ─── S8 ──────────────────────────────────────────────────────────────────────
section("S8 취소 수주")
for (const options of [normal, compat]) {
  const r = run(
    [dm({ orderLineId: "keep", orderQty: 5, deliveryDate: "2026-06-01" }), dm({ orderLineId: "cx", orderQty: 50, cancelled: true })],
    [bl("fg", "c1", 1)],
    [],
    options
  )
  eq(lineIds(r), ["keep"], `S8[${options.mode}] 취소 수주 제외`)
  eq(r.excludedOrderLines[0]?.reason, "CANCELLED", `S8[${options.mode}] 제외 사유 CANCELLED`)
  eq(mat(r, "c1").totalRequirement, 5, `S8[${options.mode}] 취소분 소요 미반영`)
}

// ─── S9 ──────────────────────────────────────────────────────────────────────
section("S9 재고 0 및 음수")
{
  const demands = [
    dm({ orderLineId: "a", orderQty: 3, deliveryDate: "2026-06-01" }),
    dm({ orderLineId: "b", orderQty: 2, deliveryDate: "2026-06-02" }),
  ]
  const boms = [bl("fg", "c1", 1), bl("fg", "c2", 2)]
  const zero = run(demands, boms, [])
  eq(mat(zero, "c1").openingStock, 0, "S9 재고 입력 없음 = 0")
  eq(mat(zero, "c1").movements.map((m) => m.balanceAfter), [-3, -5], "S9 재고 0 → 즉시 결품")
  eq(mat(zero, "c1").firstShortage?.orderLineId, "a", "S9 최초 결품 = 첫 수주")
  eq(zero.demands.map((d) => d.shortageItemCount), [2, 2], "S9 수주별 결품품목수")
  eq(zero.demands.map((d) => d.cumulativeNegativeItemCount), [2, 2], "S9 누계")
  eq(zero.summary.shortageComponentCount, 2, "S9 결품 자재 수 2")

  const neg = run(demands, boms, [{ componentItemId: "c1", quantity: -4 }, { componentItemId: "c9", quantity: -5 }])
  const m = mat(neg, "c1")
  eq(m.movements.map((x) => x.balanceAfter), [-7, -9], "S9 음수 초기재고에서 계속 차감")
  eq(m.movements[0].shortageAtThisDemand, 3, "S9 음수 시작 시 수주 전량이 결품(3)")
  eq(m.finalShortageQty, 9, "S9 최종 부족 = 9 (초기 -4 포함)")
  isTrue(neg.warnings.some((w) => w.code === "NEGATIVE_OPENING_STOCK" && w.componentItemId === "c1"), "S9 음수 재고 경고")
  eq(neg.demands.map((d) => d.cumulativeNegativeItemCount), [3, 3], "S9 수요 없는 음수 재고 자재(c9)도 누계에 포함")
  eq(neg.demands.map((d) => d.shortageItemCount), [2, 2], "S9 결품품목수는 requirement>0 자재만")
  eq(mat(neg, "c9").negativeStepCount, 2, "S9 c9 음수 단계 수")

  const exact = run([dm({ orderLineId: "e", orderQty: 5 })], [bl("fg", "c1", 1)], [{ componentItemId: "c1", quantity: 5 }])
  eq(mat(exact, "c1").finalBalance, 0, "S9 정확히 소진(잔량 0)은 결품 아님")
  eq(exact.summary.shortageComponentCount, 0, "S9 잔량 0 은 결품이 아님")
  const dupStock = run([dm({ orderLineId: "s", orderQty: 1 })], [bl("fg", "c1", 1)], [
    { componentItemId: "c1", quantity: 3 },
    { componentItemId: "c1", quantity: 4 },
  ])
  eq(mat(dupStock, "c1").openingStock, 7, "S9 동일 자재 재고 항목은 합산")
  const bad = run([dm({ orderLineId: "s", orderQty: 1 })], [bl("fg", "c1", 1)], [{ componentItemId: "c1", quantity: Number.NaN }])
  isTrue(bad.warnings.some((w) => w.code === "INVALID_STOCK_QUANTITY"), "S9 비정상 재고 값 경고(0 처리)")
}

// ─── S10 ─────────────────────────────────────────────────────────────────────
section("S10 소수 qtyPer — 반올림 없음")
{
  const r = run([dm({ orderLineId: "f", orderQty: 3 })], [bl("fg", "c1", 0.1)], [{ componentItemId: "c1", quantity: 1 }], compat)
  const m = mat(r, "c1")
  eq(m.totalRequirement, 0.1 * 3, "S10 소요 = 0.1 × 3 (IEEE double 그대로)")
  isTrue(m.totalRequirement !== 0.3, "S10 반올림하지 않음(0.30000000000000004)")
  eq(m.movements[0].balanceAfter, 1 - 0.1 * 3, "S10 잔량 = 1 - 0.30000000000000004")
  const small = run([dm({ orderLineId: "g", orderQty: 7 })], [bl("fg", "c1", 0.000001)], [], compat)
  eq(mat(small, "c1").totalRequirement, 7 * 0.000001, "S10 미세 수량도 보존")
  // 동일 자재 반복 + 소수: (a+b) × qty 순서(Excel SUMPRODUCT)
  const mix = run([dm({ orderLineId: "h", orderQty: 3 })], [bl("fg", "c1", 0.1), bl("fg", "c1", 0.2)], [], compat)
  eq(mat(mix, "c1").totalRequirement, (0.1 + 0.2) * 3, "S10 Σ(qtyPer) × 수량 순서")
}

// ─── S11 ─────────────────────────────────────────────────────────────────────
section("S11 NORMAL vs EXCEL_COMPAT")
{
  // 기본값 해석
  const n = resolveOrderMrpOptions(normal)
  const c = resolveOrderMrpOptions(compat)
  eq(
    [n.stockProviderType, n.bomExplosion, n.applyScrapRate, n.ordering, n.demandQuantityBasis, n.nullDeliveryDatePlacement],
    ["ACTUAL", "MULTI_LEVEL", true, "DUE_DATE", "REMAINING", "LAST"],
    "S11 NORMAL 기본 옵션"
  )
  eq(
    [c.stockProviderType, c.bomExplosion, c.applyScrapRate, c.ordering, c.demandQuantityBasis, c.nullDeliveryDatePlacement],
    ["EXCEL_THEORETICAL", "SINGLE_LEVEL", false, "DUE_DATE", "ORDER_QTY", "FIRST"],
    "S11 EXCEL_COMPAT 기본 옵션"
  )

  // 다단계 + 스크랩
  const boms = [
    bl("fg", "semi", 2, { componentItemType: "SEMI_FINISHED", scrapRate: 0.1 }),
    bl("fg", "raw1", 1),
    bl("semi", "raw2", 3, { componentItemType: "RAW_MATERIAL" }),
  ]
  const demands = [dm({ orderLineId: "m", orderQty: 10 })]
  const rn = run(demands, boms, [], normal)
  const rc = run(demands, boms, [], compat)
  eq(mat(rn, "semi").totalRequirement, 10 * (2 * (1 + 0.1)), "S11 NORMAL: 스크랩 반영 반제품 소요")
  eq(mat(rn, "raw2").totalRequirement, 10 * (2 * 1.1 * 3), "S11 NORMAL: 다단계 전개(raw2)")
  eq(rc.materials.map((x) => x.componentItemId).sort(), ["raw1", "semi"], "S11 EXCEL_COMPAT: 단일 레벨(반제품 하위 미전개)")
  eq(mat(rc, "semi").totalRequirement, 20, "S11 EXCEL_COMPAT: 스크랩 미적용")

  // 정렬 모드
  const unsorted = [
    dm({ orderLineId: "late", orderQty: 1, deliveryDate: "2026-06-30" }),
    dm({ orderLineId: "mid", orderQty: 1, deliveryDate: "2026-06-15" }),
    dm({ orderLineId: "first", orderQty: 1, deliveryDate: "2026-06-01" }),
  ]
  const b1 = [bl("fg", "c1", 1)]
  eq(lineIds(run(unsorted, b1, [], normal)), ["first", "mid", "late"], "S11 NORMAL 납기 오름차순")
  eq(lineIds(run(unsorted, b1, [], compat)), ["first", "mid", "late"], "S11 EXCEL_COMPAT 기본도 납기순(출고예정소요량 시트 동작)")
  eq(
    lineIds(run(unsorted, b1, [], { mode: "EXCEL_COMPAT", ordering: "INPUT_ORDER" })),
    ["late", "mid", "first"],
    "S11 EXCEL_COMPAT INPUT_ORDER: Excel MRP 기간작성 행 순서 재현"
  )
  assert.throws(() => run(unsorted, b1, [], { mode: "NORMAL", ordering: "INPUT_ORDER" }), /EXCEL_COMPAT/)
  pass("S11 NORMAL 에서 INPUT_ORDER 거부")

  // legacy 상한: caller 가 명시적으로 전달 (엔진은 현재 시각을 읽지 않음)
  const lg = run(unsorted, b1, [], { mode: "EXCEL_COMPAT", legacyUpperBound: "2026-06-15" })
  eq(lineIds(lg), ["first", "mid"], "S11 EXCEL_COMPAT legacyUpperBound(오늘까지) 재현")
  eq(lg.excludedOrderLines.map((e) => e.reason), ["OUT_OF_PERIOD"], "S11 상한 초과 라인 제외 사유")
  assert.throws(() => run(unsorted, b1, [], { mode: "NORMAL", legacyUpperBound: "2026-06-15" }), /EXCEL_COMPAT/)
  pass("S11 NORMAL 에서 legacyUpperBound 거부")
  eq(lineIds(run(unsorted, b1, [], normal)).length, 3, "S11 NORMAL 전체 MRP = 모든 미충족 수요(상한 없음)")

  // 개별 override
  const ov = run(demands, boms, [], { mode: "EXCEL_COMPAT", bomExplosion: "MULTI_LEVEL", applyScrapRate: true })
  eq(mat(ov, "raw2").totalRequirement, 10 * (2 * 1.1 * 3), "S11 호환 모드에서도 옵션 override 가능")
}

// ─── 안전성 / 확장 ───────────────────────────────────────────────────────────
section("안전성 · 확장")
{
  // 순환 BOM
  const cyc = run(
    [dm({ orderLineId: "cy", itemId: "a" }), dm({ orderLineId: "okk", itemId: "z", deliveryDate: "2026-06-02" })],
    [
      bl("a", "b", 1, { componentItemType: "SEMI_FINISHED" }),
      bl("b", "a", 1, { componentItemType: "SEMI_FINISHED" }),
      bl("z", "c1", 1),
    ]
  )
  eq(lineIds(cyc), ["okk"], "순환 BOM 라인은 제외, 나머지는 계속 계산(무한 루프 없음)")
  isTrue(cyc.warnings.some((w) => w.code === "BOM_CYCLE_DETECTED"), "BOM_CYCLE_DETECTED 경고")
  eq(cyc.excludedOrderLines[0]?.reason, "INVALID_BOM", "순환 BOM 제외 사유")

  // 비정상 BOM 수량
  const inv = run([dm({ orderLineId: "i" })], [bl("fg", "c1", Number.NaN), bl("fg", "c2", 1)])
  eq(inv.excludedOrderLines[0]?.reason, "INVALID_BOM", "비수치 BOM 수량 → 라인 제외(부분 계산 금지)")
  isTrue(inv.warnings.some((w) => w.code === "INVALID_BOM_QUANTITY"), "INVALID_BOM_QUANTITY 경고")

  // 깊이 초과
  const chain: MrpBomLine[] = []
  for (let i = 0; i < 13; i++) chain.push(bl("n" + i, "n" + (i + 1), 1, { componentItemType: "SEMI_FINISHED" }))
  const deep = run([dm({ orderLineId: "dp", itemId: "n0" })], chain)
  isTrue(deep.warnings.some((w) => w.code === "BOM_DEPTH_EXCEEDED"), "다단계 깊이 초과 경고(기본 10)")
  eq(deep.demands.length, 1, "깊이 초과여도 계산은 계속")

  // What-if 재사용: 실제 수주 없이 가상 라인
  const whatIf = run(
    [dm({ orderLineId: "wi:1", orderId: "whatif", orderNo: "WHATIF", itemId: "fg", orderQty: 12, deliveryDate: null })],
    [bl("fg", "c1", 2)],
    [{ componentItemId: "c1", quantity: 20 }]
  )
  eq([mat(whatIf, "c1").totalRequirement, mat(whatIf, "c1").finalShortageQty], [24, 4], "What-if 재사용: 소요 24, 부족 4")

  // 공급업체 확장 여지
  const sup = runOrderMrp(
    { demands: [dm({ orderLineId: "s" })], boms: [bl("fg", "c1", 1)], stocks: [], componentInfo: { c1: { name: "자재1", uom: "EA", supplierId: "sup-1", supplierName: "업체1" } } },
    normal
  )
  eq([mat(sup, "c1").name, mat(sup, "c1").uom, mat(sup, "c1").supplierId], ["자재1", "EA", "sup-1"], "공급업체/자재 정보는 계산 조건이 아닌 결과 메타로 전달")

  // 빈 입력
  const empty = run([], [])
  eq([empty.demands.length, empty.materials.length, empty.warnings.length], [0, 0, 0], "빈 입력 처리")

  // 수량 0 (Excel 호환: 열은 생성, NORMAL: 제외)
  const z = run([dm({ orderLineId: "z0", orderQty: 0, remainingQty: 0 })], [bl("fg", "c1", 1)], [], compat)
  eq([z.demands.length, mat(z, "c1").totalRequirement], [1, 0], "EXCEL_COMPAT 수량 0 수주는 열 생성·소요 0")

  // 전체 최초 결품 (동시 결품 자재 묶음)
  const multi = run(
    [dm({ orderLineId: "q1", orderQty: 5, deliveryDate: "2026-06-01" }), dm({ orderLineId: "q2", orderQty: 5, deliveryDate: "2026-06-02" })],
    [bl("fg", "c1", 1), bl("fg", "c2", 2)],
    [{ componentItemId: "c1", quantity: 100 }, { componentItemId: "c2", quantity: 10 }]
  )
  eq(multi.summary.firstShortage?.orderLineId, "q2", "전체 최초 결품 수주(c2 가 2번째 수주에서 결품)")
  eq(multi.summary.firstShortage?.materials.map((m) => m.componentCode), ["C2"], "전체 최초 결품 자재 목록")

  // 순수성: 엔진 소스에 외부 의존/비결정 API 없음
  for (const file of ["src/lib/mrp/order-mrp-engine.ts", "src/lib/mrp/period.ts", "src/lib/mrp/types.ts"]) {
    const text = readFileSync(join(process.cwd(), file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    isTrue(!/prisma|supabase|process\.env|Date\.now|new Date\(\)|Math\.random|fetch\(|"use server"|@\/lib/i.test(text), `순수성: ${file}`)
  }
}

console.log(
  `\n✅ order-mrp-engine: ${passed} checks passed` +
    `\n   Golden A(출고예정소요량): ${shipCompared} cells compared, ${shipMismatch} mismatches` +
    `\n   Golden B(MRP작성)       : ${mrpReqCompared} req + ${mrpBalCompared} balance cells compared, ${mrpMismatch} mismatches`
)
