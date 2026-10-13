/**
 * Phase 3 테스트: 기간 유틸 + 기간 MRP + 예상소요량(기간) (fake DB 주입 · 실제 DB 없음)
 *
 * 실행: npm run test:mrp-period
 *
 *  P1 월 / P2 윤년 2월 / P3 분기 / P4 반기 / P5 연 / P6~P9 이전·다음 이동 / P10 양끝 포함 / P11 KST
 *  PM 기간 MRP(경계·부분출하·취소·BOM 누락 조합)   RQ 예상소요량(기간) 집계·상세·쿼리 수
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  isWithinPeriod,
  matchUnit,
  moveSelection,
  presetSelection,
  selectionFromRange,
  selectionLabel,
  selectionRange,
  shiftUnit,
  toDateOnly,
  unitFromDate,
  unitLabel,
  unitRange,
  type PeriodUnit,
} from "../src/lib/mrp/period"
import { executeOrderMrpRequest, type OrderMrpDb } from "../src/lib/services/mrp-order.service"

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
const U = (kind: PeriodUnit["kind"], year: number, index: number): PeriodUnit => ({ kind, year, index })

// ─── 기간 유틸 ───────────────────────────────────────────────────────────────
section("P1 월 시작/종료")
eq(unitRange(U("MONTH", 2026, 1)), { from: "2026-01-01", to: "2026-01-31" }, "P1 1월")
eq(unitRange(U("MONTH", 2026, 4)), { from: "2026-04-01", to: "2026-04-30" }, "P1 4월(30일)")
eq(unitRange(U("MONTH", 2026, 12)), { from: "2026-12-01", to: "2026-12-31" }, "P1 12월")
eq(unitRange(U("MONTH", 2026, 2)), { from: "2026-02-01", to: "2026-02-28" }, "P1 2026-02 → 02-28")
section("P2 윤년")
eq(unitRange(U("MONTH", 2028, 2)), { from: "2028-02-01", to: "2028-02-29" }, "P2 2028-02 → 02-29")
eq(unitRange(U("MONTH", 2100, 2)), { from: "2100-02-01", to: "2100-02-28" }, "P2 2100 은 평년(100년 규칙)")
eq(unitRange(U("MONTH", 2000, 2)), { from: "2000-02-01", to: "2000-02-29" }, "P2 2000 은 윤년(400년 규칙)")
section("P3 분기 / P4 반기 / P5 연")
eq(unitRange(U("QUARTER", 2026, 1)), { from: "2026-01-01", to: "2026-03-31" }, "P3 Q1")
eq(unitRange(U("QUARTER", 2026, 2)), { from: "2026-04-01", to: "2026-06-30" }, "P3 Q2")
eq(unitRange(U("QUARTER", 2026, 3)), { from: "2026-07-01", to: "2026-09-30" }, "P3 Q3")
eq(unitRange(U("QUARTER", 2026, 4)), { from: "2026-10-01", to: "2026-12-31" }, "P3 Q4")
eq(unitRange(U("HALF", 2026, 1)), { from: "2026-01-01", to: "2026-06-30" }, "P4 상반기")
eq(unitRange(U("HALF", 2026, 2)), { from: "2026-07-01", to: "2026-12-31" }, "P4 하반기")
eq(unitRange(U("YEAR", 2026, 1)), { from: "2026-01-01", to: "2026-12-31" }, "P5 연도")
assert.throws(() => unitRange(U("MONTH", 2026, 13)), RangeError)
assert.throws(() => unitRange(U("QUARTER", 2026, 0)), RangeError)
passed += 2
console.log("PASS P3 index 범위 오류는 RangeError")
eq(unitFromDate("QUARTER", "2026-06-30"), U("QUARTER", 2026, 2), "P3 06-30 은 Q2")
eq(unitFromDate("QUARTER", "2026-07-01"), U("QUARTER", 2026, 3), "P3 07-01 은 Q3")
eq(unitFromDate("HALF", "2026-06-30"), U("HALF", 2026, 1), "P4 06-30 은 상반기")
eq(unitFromDate("MONTH", "2026-10-14"), U("MONTH", 2026, 10), "월 판정")

section("P6~P9 이전/다음 이동")
eq(shiftUnit(U("MONTH", 2026, 12), 1), U("MONTH", 2027, 1), "P6 12월 → 다음 = 다음 해 1월")
eq(shiftUnit(U("MONTH", 2026, 1), -1), U("MONTH", 2025, 12), "P6 1월 → 이전 = 전년 12월")
eq(shiftUnit(U("MONTH", 2026, 10), 14), U("MONTH", 2027, 12), "P6 +14개월")
eq(shiftUnit(U("MONTH", 2026, 3), -15), U("MONTH", 2024, 12), "P6 −15개월")
eq(shiftUnit(U("QUARTER", 2026, 4), 1), U("QUARTER", 2027, 1), "P7 Q4 → 다음 = 다음 해 Q1")
eq(shiftUnit(U("QUARTER", 2026, 1), -1), U("QUARTER", 2025, 4), "P7 Q1 → 이전 = 전년 Q4")
eq(shiftUnit(U("HALF", 2026, 2), 1), U("HALF", 2027, 1), "P8 하반기 → 다음 = 다음 해 상반기")
eq(shiftUnit(U("HALF", 2026, 1), -1), U("HALF", 2025, 2), "P8 상반기 → 이전 = 전년 하반기")
eq(shiftUnit(U("YEAR", 2026, 1), 1), U("YEAR", 2027, 1), "P9 다음 연도")
eq(shiftUnit(U("YEAR", 2026, 1), -1), U("YEAR", 2025, 1), "P9 이전 연도")
// 왕복 불변
let u = U("MONTH", 2026, 7)
for (let i = 0; i < 40; i++) u = shiftUnit(u, 1)
for (let i = 0; i < 40; i++) u = shiftUnit(u, -1)
eq(u, U("MONTH", 2026, 7), "P6 40회 이동 왕복 후 원위치")
// 연속 월 이동이 빈틈/겹침 없이 이어진다
{
  let m = U("MONTH", 2027, 11)
  let prevTo = unitRange(m).to
  let contiguous = true
  for (let i = 0; i < 26; i++) {
    m = shiftUnit(m, 1)
    const r = unitRange(m)
    const next = new Date(Date.UTC(Number(prevTo.slice(0, 4)), Number(prevTo.slice(5, 7)) - 1, Number(prevTo.slice(8, 10)) + 1))
      .toISOString()
      .slice(0, 10)
    if (r.from !== next) contiguous = false
    prevTo = r.to
  }
  ok(contiguous, "P6 26개월 연속 이동 시 기간이 빈틈·겹침 없이 이어짐(윤년 포함)")
}
eq(unitLabel(U("MONTH", 2026, 10)), "2026년 10월", "라벨 월")
eq(unitLabel(U("QUARTER", 2026, 4)), "2026년 4분기", "라벨 분기")
eq(unitLabel(U("HALF", 2026, 2)), "2026년 하반기", "라벨 반기")
eq(unitLabel(U("YEAR", 2026, 1)), "2026년", "라벨 연도")

section("프리셋 / 선택 상태")
const base = "2026-10-14"
eq(selectionRange(presetSelection("THIS_MONTH", base)), { from: "2026-10-01", to: "2026-10-31" }, "이번 달")
eq(selectionRange(presetSelection("NEXT_MONTH", base)), { from: "2026-11-01", to: "2026-11-30" }, "다음 달")
eq(selectionRange(presetSelection("THIS_QUARTER", base)), { from: "2026-10-01", to: "2026-12-31" }, "이번 분기")
eq(selectionRange(presetSelection("NEXT_QUARTER", base)), { from: "2027-01-01", to: "2027-03-31" }, "다음 분기(연도 경계)")
eq(selectionRange(presetSelection("H1", base)), { from: "2026-01-01", to: "2026-06-30" }, "상반기")
eq(selectionRange(presetSelection("H2", base)), { from: "2026-07-01", to: "2026-12-31" }, "하반기")
eq(selectionRange(presetSelection("THIS_YEAR", base)), { from: "2026-01-01", to: "2026-12-31" }, "올해")
eq(selectionRange(presetSelection("ALL", base)), { from: null, to: null }, "전체 미출하는 기간 없음")
eq(selectionRange(presetSelection("NEXT_MONTH", "2026-12-31")), { from: "2027-01-01", to: "2027-01-31" }, "12-31 기준 다음 달 = 다음 해 1월")
eq(selectionRange(moveSelection(presetSelection("THIS_MONTH", base), -1)), { from: "2026-09-01", to: "2026-09-30" }, "이번 달에서 이전 이동")
eq(moveSelection({ mode: "ALL" }, 1), { mode: "ALL" }, "전체 선택은 이동하지 않음")
eq(moveSelection({ mode: "CUSTOM", from: "2026-06-05", to: "2026-06-20" }, 1), { mode: "CUSTOM", from: "2026-06-05", to: "2026-06-20" }, "직접 선택은 이동하지 않음")
eq(selectionFromRange("2026-06-01", "2026-06-30"), { mode: "UNIT", unit: U("MONTH", 2026, 6) }, "범위가 정확히 월이면 월 프리셋으로 복원")
eq(selectionFromRange("2026-07-01", "2026-09-30"), { mode: "UNIT", unit: U("QUARTER", 2026, 3) }, "범위가 분기이면 분기로 복원")
eq(selectionFromRange("2026-01-01", "2026-12-31"), { mode: "UNIT", unit: U("YEAR", 2026, 1) }, "범위가 연이면 연도로 복원")
eq(selectionFromRange("2026-06-05", "2026-06-20"), { mode: "CUSTOM", from: "2026-06-05", to: "2026-06-20" }, "임의 범위는 CUSTOM")
eq(selectionFromRange(null, null), { mode: "ALL" }, "둘 다 없으면 ALL")
eq(matchUnit("2026-06-01", "2026-06-29"), null, "하루 모자라면 월이 아님")
eq(selectionLabel({ mode: "CUSTOM", from: "2026-06-05", to: "2026-06-20" }), "2026-06-05 ~ 2026-06-20", "직접 선택 라벨")

section("P10 양끝 포함 / P11 KST")
{
  const p = { from: "2026-06-01", to: "2026-06-30" }
  ok(isWithinPeriod("2026-06-01", p), "P10 시작일 포함")
  ok(isWithinPeriod("2026-06-30", p), "P10 종료일 포함")
  ok(!isWithinPeriod("2026-05-31", p) && !isWithinPeriod("2026-07-01", p), "P10 하루 밖은 제외")
  eq(toDateOnly(new Date("2026-06-30T14:59:59Z")), "2026-06-30", "P11 KST 06-30 23:59:59 → 06-30")
  eq(toDateOnly(new Date("2026-06-30T15:00:00Z")), "2026-07-01", "P11 KST 07-01 00:00:00 → 07-01(하루 밀림 없음)")
  eq(toDateOnly(new Date("2026-12-31T15:00:00Z")), "2027-01-01", "P11 연말 경계")
  eq(toDateOnly(new Date("2028-02-28T15:00:00Z")), "2028-02-29", "P11 윤일 경계")
  const src = readFileSync(join(process.cwd(), "src/lib/mrp/period.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
  ok(!/Date\.now|new Date\(\)|process\.env|Math\.random/.test(src), "period.ts 는 현재 시각/환경을 읽지 않음(순수)")
}

// ─── fake DB ─────────────────────────────────────────────────────────────────
type Row = Record<string, any>
const OPS = ["in", "not", "gt", "gte", "lt", "lte", "equals"]
function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    const keys = Object.keys(cond as object)
    if (keys.length > 0 && keys.every((k) => OPS.includes(k))) {
      const c = cond as Record<string, any>
      return keys.every((k) => {
        const a = actual as any
        const v = c[k]
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
    return matchValue(row[k], cond)
  })
}
function makeDb(tables: Record<string, Row[]>) {
  const calls: string[] = []
  const db = new Proxy(
    {},
    {
      get(_t, name: string) {
        if (!(name in tables)) throw new Error(`unexpected model access: ${name}`)
        return {
          findMany: async (a: { where?: Row }) => {
            calls.push(name)
            return tables[name].filter((r) => (a.where ? matches(r, a.where) : true))
          },
        }
      },
    }
  ) as unknown as OrderMrpDb
  return { db, calls }
}

const T = "tenant-1"
const mkItem = (id: string, code: string) => ({ id, code, name: code + " 제품", tenantId: T })
const fgA = mkItem("fgA", "FG-A")
const fgB = mkItem("fgB", "FG-B")
const fgX = mkItem("fgX", "FG-X") // BOM 없음
const fgD = mkItem("fgD", "FG-D") // 동일 자재 BOM 반복
const comp = (code: string) => ({ code, name: code + " 자재", spec: code + " 규격", uom: "EA", itemType: "RAW_MATERIAL" })
const bi = (componentItemId: string, code: string, seq: number, qtyPer: number) => ({
  componentItemId,
  seq,
  qtyPer,
  scrapRate: 0,
  componentItem: comp(code),
})
const bom = (id: string, itemId: string, items: ReturnType<typeof bi>[]) => ({
  id,
  tenantId: T,
  itemId,
  version: "1",
  status: "ACTIVE",
  isDefault: true,
  bomItems: items,
})
let seq = 0
const line = (
  orderNo: string,
  status: string,
  it: ReturnType<typeof mkItem>,
  qty: number,
  shipped: number,
  due: string
) => {
  seq += 1
  return {
    id: "l" + seq,
    qty,
    shippedQty: shipped,
    deliveryDate: new Date(due.length === 10 ? due + "T00:00:00Z" : due),
    itemId: it.id,
    item: it,
    salesOrder: {
      id: "so" + seq,
      tenantId: T,
      orderNo,
      status,
      deliveryDate: new Date("2026-12-31T00:00:00Z"),
      customer: { name: "고객" },
    },
  }
}
function world(): Record<string, Row[]> {
  seq = 0
  return {
    salesOrderItem: [
      line("SO-1", "CONFIRMED", fgA, 10, 0, "2026-06-01"), // l1
      line("SO-2", "CONFIRMED", fgB, 5, 0, "2026-06-15"), // l2
      line("SO-3", "CONFIRMED", fgA, 4, 0, "2026-06-30"), // l3
      line("SO-4", "CONFIRMED", fgA, 100, 0, "2026-07-01"), // l4 (6월 밖)
      line("SO-5", "CANCELLED", fgA, 50, 0, "2026-06-10"), // l5 취소
      line("SO-6", "PARTIAL_SHIPPED", fgB, 20, 15, "2026-06-20"), // l6 잔량 5
      line("SO-7", "CONFIRMED", fgX, 1, 0, "2026-06-10"), // l7 BOM 없음(기간 내)
      line("SO-8", "CONFIRMED", fgX, 1, 0, "2026-07-05"), // l8 BOM 없음(기간 밖)
      line("SO-9", "CONFIRMED", fgA, 1, 0, "2026-06-30T15:00:00Z"), // l9 KST 07-01
      line("SO-10", "CONFIRMED", fgA, 1, 0, "2026-06-30T14:59:59Z"), // l10 KST 06-30
    ],
    bOM: [
      bom("bA", "fgA", [bi("m1", "MAT1", 1, 2), bi("m2", "MAT2", 2, 3)]),
      bom("bB", "fgB", [bi("m1", "MAT1", 1, 4)]),
      bom("bD", "fgD", [bi("m1", "MAT1", 1, 1), bi("m1", "MAT1", 2, 2)]),
    ],
    inventoryBalance: [
      { tenantId: T, itemId: "m1", item: { tenantId: T }, qtyOnHand: 30, qtyHold: 0, qtyAvailable: 30, lotId: null, lot: null },
      { tenantId: T, itemId: "m2", item: { tenantId: T }, qtyOnHand: 100, qtyHold: 0, qtyAvailable: 100, lotId: null, lot: null },
    ],
  }
}
const auth = async () => ({ tenantId: T })
const run = (tables: Record<string, Row[]>, params: object) => {
  const f = makeDb(tables)
  return executeOrderMrpRequest({ authorize: auth, db: f.db }, params).then((payload) => ({ payload, calls: f.calls }))
}
const mat = (v: any, code: string) => {
  const m = v.materials.find((x: any) => x.code === code)
  assert.ok(m, "material " + code)
  return m
}

async function main() {
  section("PM 기간 MRP — 경계·부분출하·취소·BOM 누락 조합")
  const june = await run(world(), { from: "2026-06-01", to: "2026-06-30" })
  const v = june.payload.view
  const ids = (m: any) => m.steps.map((s: any) => s.orderLineId)
  // MAT1 을 쓰는 라인 = fgA/fgB 대상 라인
  eq(
    ids(mat(v, "MAT1")),
    ["l1", "l2", "l6", "l10", "l3"],
    "PM 6월: 06-01·06-15·06-20(부분출하 잔량)·06-30(KST) 포함, 07-01(KST 자정)/07-05 제외, 취소 제외, 납기순"
  )
  eq(v.kpi.demandLineCount, 5, "PM 대상 수주라인 5")
  ok(!ids(mat(v, "MAT1")).includes("l4"), "PM 07-01 납기(l4) 제외 — 종료일 경계")
  ok(!ids(mat(v, "MAT1")).includes("l9"), "PM KST 07-01 00:00 (UTC 06-30 15:00) 는 6월에서 제외 — 하루 밀림 없음")
  ok(ids(mat(v, "MAT1")).includes("l10"), "PM KST 06-30 23:59:59 는 6월 포함 — 종료일 포함")
  ok(!ids(mat(v, "MAT1")).includes("l5"), "PM 취소 수주 제외")
  eq(mat(v, "MAT1").steps.find((s: any) => s.orderLineId === "l6").demandQty, 5, "PM 부분출하: 20 − 15 = 5 만 대상")
  // 순차 차감: 가용 30, 소요 20(l1) → 10, 20(l2) → -10, 20(l6) → -30, 2(l10) → -32, 8(l3) → -40
  eq(
    mat(v, "MAT1").steps.map((s: any) => [s.orderLineId, s.requirement, s.balanceAfter]),
    [["l1", 20, 10], ["l2", 20, -10], ["l6", 20, -30], ["l10", 2, -32], ["l3", 8, -40]],
    "PM 기간 내 수주만 납기순 순차 차감(06-30 동률은 PO 번호순)"
  )
  eq([mat(v, "MAT1").finalBalance, mat(v, "MAT1").firstShortageOrderNo, mat(v, "MAT1").firstShortageDate], [-40, "SO-2", "2026-06-15"], "PM 최종 예상재고·최초 결품 수주/일자")
  eq(v.excludedLines.filter((l) => l.isBomIssue).map((l) => l.orderLineId), ["l7"], "PM BOM 누락은 기간 내 라인(l7)만 노출, 기간 밖(l8)은 노출 안 함")
  eq(v.excludedCounts["OUT_OF_PERIOD"], 3, "PM 기간 밖 라인 집계(l4, l8, l9)")

  section("PM 다른 기간 / 전체")
  {
    const july = await run(world(), { from: "2026-07-01", to: "2026-07-31" })
    const jv = july.payload.view
    eq(mat(jv, "MAT1").steps.map((s: any) => s.orderLineId), ["l4", "l9"], "PM 7월: 07-01 납기 2건 포함(동률은 PO 번호순 l4, l9), KST 자정 라인 포함")
    eq(jv.excludedLines.filter((l) => l.isBomIssue).map((l) => l.orderLineId), ["l8"], "PM 7월 BOM 누락 = l8")
    const all = await run(world(), {})
    eq(all.payload.view.kpi.demandLineCount, 7, "PM 전체 미출하: 7라인(l1~l4, l6, l9, l10)")
    eq(all.payload.view.kpi.bomIssueLineCount, 2, "PM 전체: BOM 누락 2건(l7, l8)")
    // 같은 알고리즘: 전체 결과에서 기간 내 라인만 골라도 기간 MRP 와 처리 순서가 같다
    const allIds = mat(all.payload.view, "MAT1").steps.map((s: any) => s.orderLineId).filter((id: string) => ["l1", "l2", "l6", "l10", "l3"].includes(id))
    eq(allIds, ids(mat(v, "MAT1")), "PM 전체 MRP 와 기간 MRP 의 처리 순서 동일(같은 엔진·같은 정렬)")
    const none = await run(world(), { from: "2027-01-01", to: "2027-01-31" })
    eq([none.payload.view.kpi.demandLineCount, none.payload.view.materials.length], [0, 0], "PM 대상 없는 기간 → 빈 결과(오류 아님)")
  }

  section("RQ 예상소요량(기간)")
  {
    const w = world()
    // 예시: A 10EA(MAT1 2, MAT2 3), B 5EA(MAT1 4) → MAT1 = 40, MAT2 = 30
    w.salesOrderItem = [line("P-1", "CONFIRMED", fgA, 10, 0, "2026-10-03"), line("P-2", "CONFIRMED", fgB, 5, 0, "2026-10-08")]
    const r = await run(w, { from: "2026-10-01", to: "2026-10-31" })
    const rv = r.payload.view
    const m1 = mat(rv, "MAT1")
    const m2 = mat(rv, "MAT2")
    eq([m1.totalRequirement, m2.totalRequirement], [40, 30], "RQ MAT1 = 10×2 + 5×4 = 40, MAT2 = 10×3 = 30")
    eq([m1.demandLineCount, m1.productCount, m2.demandLineCount, m2.productCount], [2, 2, 1, 1], "RQ 수주 라인 수 / 제품 수")
    eq([m1.firstNeedDate, m1.lastNeedDate], ["2026-10-03", "2026-10-08"], "RQ 최초/최종 필요일")
    eq(
      m1.steps.map((s: any) => [s.deliveryDate, s.orderNo, s.itemCode, s.demandQty, s.bomQtyPerUnit, s.requirement]),
      [["2026-10-03", "P-1", "FG-A", 10, 2, 20], ["2026-10-08", "P-2", "FG-B", 5, 4, 20]],
      "RQ 상세: 납기/PO/제품/수주잔량/제품당 BOM 소요/자재 소요"
    )
    eq([m1.qtyAvailable, m1.finalBalance, m1.shortageQty], [30, -10, 10], "RQ 현재 가용재고 / 기간 종료 예상재고 / 부족")
    eq([rv.kpi.demandLineCount, rv.kpi.productCount, rv.kpi.requiredMaterialCount, rv.kpi.requirementLineCount, rv.kpi.shortageMaterialCount], [2, 2, 2, 3, 1], "RQ KPI(수량 합산 없음)")
    ok(
      m1.steps.reduce((s: number, st: any) => s + st.requirement, 0) === m1.totalRequirement,
      "RQ 상세 합계 = 기간 총소요(추적 가능)"
    )
  }
  {
    // 동일 자재가 BOM 여러 라인 → 합산 (1 + 2) × 4 = 12
    const w = world()
    w.salesOrderItem = [line("P-3", "CONFIRMED", fgD, 4, 0, "2026-10-05")]
    const r = await run(w, { from: "2026-10-01", to: "2026-10-31" })
    eq(mat(r.payload.view, "MAT1").totalRequirement, 12, "RQ BOM 동일 자재 반복 라인은 합산 (1+2)×4")
    eq(mat(r.payload.view, "MAT1").steps[0].bomQtyPerUnit, 3, "RQ 제품당 BOM 소요 = 합산값 3")
  }

  section("성능 — 기간/예상소요 화면도 추가 쿼리 없음")
  {
    const a = await run(world(), { from: "2026-06-01", to: "2026-06-30" })
    const b = await run(world(), {})
    eq(a.payload.diagnostics.queryCount, a.calls.length, "보고 쿼리 수 = 실제 호출 수")
    eq(a.payload.diagnostics.queryCount, b.payload.diagnostics.queryCount, "기간 MRP 와 전체 MRP 의 쿼리 수 동일")
    eq(a.calls, ["salesOrderItem", "bOM", "inventoryBalance"], "수주 1 + BOM 1레벨 + 재고 1 (기간소요 뷰는 같은 결과에서 파생)")
    ok(
      a.payload.view.materials.every((m) => typeof m.demandLineCount === "number" && m.steps.length === m.demandLineCount),
      "기간소요 필드(수주 라인/제품 수/필요일)가 같은 응답에 포함"
    )
  }

  section("보안 회귀 — 기간 파라미터")
  {
    const f = makeDb(world())
    await assert.rejects(executeOrderMrpRequest({ authorize: auth, db: f.db }, { from: "2026-6-1" }), /YYYY-MM-DD/)
    await assert.rejects(executeOrderMrpRequest({ authorize: auth, db: f.db }, { from: "2026-07-01", to: "2026-06-01" }), /늦습니다/)
    passed += 2
    console.log("PASS 잘못된 기간 형식 / 시작>종료 거부 (쿼리 전 차단)")
    eq(f.calls.length, 0, "검증 실패 시 DB 조회 0회")
    const denied = makeDb(world())
    await assert.rejects(
      executeOrderMrpRequest(
        {
          authorize: async () => {
            throw new Error("ROLE_PERMISSION_DENIED")
          },
          db: denied.db,
        },
        { from: "2026-06-01", to: "2026-06-30" }
      ),
      /ROLE_PERMISSION_DENIED/
    )
    passed += 1
    console.log("PASS 권한 없음 → 기간 조회도 차단")
    eq(denied.calls.length, 0, "권한 거부 시 DB 조회 0회")
  }

  console.log(`\n✅ mrp-period: ${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
