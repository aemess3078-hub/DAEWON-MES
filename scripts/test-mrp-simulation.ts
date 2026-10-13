/**
 * Phase 4 테스트: 품목별 What-if 시뮬레이션 (fake DB 주입 · 실제 DB 접속/쓰기 없음)
 *
 * 실행: npm run test:mrp-simulation
 *
 *  W1 기본 / W2 복수 제품 / W3 다단계·스크랩 / W4 재고(qtyHold 이중차감 없음)
 *  W5~W8 BOM 오류 / W9 타 tenant 제품 / W10 수량 오류 / W11 중복 입력 / W12 빈 입력
 *  PF 쿼리 수(3 vs 303 제품) · SEC 권한/tenant 위조 · XL Excel(출고예정소요량) 파생 비교 · RO DB write 0
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  executeProductSearchRequest,
  executeSimulationRequest,
  type ProductSearchDb,
  type SimulationDb,
} from "../src/lib/services/mrp-simulation.service"

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

// ─── fake DB (읽기 전용: findMany / count 만 제공, where 평가) ────────────────
type Row = Record<string, any>
const OPS = ["in", "not", "gt", "gte", "lt", "lte", "equals", "contains", "mode"]
function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    const keys = Object.keys(cond as object)
    if (keys.length > 0 && keys.every((k) => OPS.includes(k))) {
      const c = cond as Record<string, any>
      return keys.every((k) => {
        const a = actual as any
        const v = c[k]
        if (k === "mode") return true
        if (k === "contains") {
          return c.mode === "insensitive"
            ? String(a ?? "").toLowerCase().includes(String(v).toLowerCase())
            : String(a ?? "").includes(String(v))
        }
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
  const calls: Array<{ model: string; op: string; where: Row }> = []
  const db = new Proxy(
    {},
    {
      get(_t, name: string) {
        // 허용 모델 외(salesOrder, productionPlan, workOrder, purchaseOrder, shipment, ...) 접근은 즉시 실패
        if (!(name in tables)) throw new Error(`unexpected model access: ${name}`)
        return {
          findMany: async (a: { where?: Row; orderBy?: Row; take?: number }) => {
            calls.push({ model: name, op: "findMany", where: a.where ?? {} })
            let rows = tables[name].filter((r) => (a.where ? matches(r, a.where) : true))
            if (a.orderBy && (a.orderBy as Row).code === "asc") rows = [...rows].sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0))
            if (typeof a.take === "number") rows = rows.slice(0, a.take)
            return rows
          },
          count: async (a: { where?: Row }) => {
            calls.push({ model: name, op: "count", where: a.where ?? {} })
            return tables[name].filter((r) => (a.where ? matches(r, a.where) : true)).length
          },
        }
      },
    }
  ) as any
  return { db, calls }
}

// ─── 데이터 ──────────────────────────────────────────────────────────────────
const A = "tenant-A"
const B = "tenant-B"
const authA = async () => ({ tenantId: A })
const itemRow = (id: string, code: string, itemType = "FINISHED", tenantId = A) => ({
  id,
  code,
  name: code + " 이름",
  uom: "EA",
  itemType,
  status: "ACTIVE",
  tenantId,
})
const comp = (code: string, itemType = "RAW_MATERIAL") => ({ code, name: code + " 자재", spec: code + " 규격", uom: "EA", itemType })
const bi = (componentItemId: string, code: string, seq: number, qtyPer: number, itemType = "RAW_MATERIAL", scrapRate = 0) => ({
  componentItemId,
  seq,
  qtyPer,
  scrapRate,
  componentItem: comp(code, itemType),
})
const bomRow = (id: string, itemId: string, items: ReturnType<typeof bi>[], over: Record<string, unknown> = {}) => ({
  id,
  tenantId: A,
  itemId,
  version: "1",
  status: "ACTIVE",
  isDefault: true,
  bomItems: items,
  ...over,
})
const bal = (itemId: string, onHand: number, hold: number, avail: number, over: Row = {}) => ({
  tenantId: A,
  itemId,
  item: { tenantId: A },
  qtyOnHand: onHand,
  qtyHold: hold,
  qtyAvailable: avail,
  lotId: null,
  lot: null,
  ...over,
})
function world(): Record<string, Row[]> {
  return {
    item: [
      itemRow("pA", "PA"),
      itemRow("pB", "PB"),
      itemRow("pS", "PS"), // 다단계
      itemRow("pK", "PK"), // 스크랩
      itemRow("pX", "PX"), // BOM 없음
      itemRow("pM", "PM"), // Default 2개
      itemRow("pE", "PE"), // 빈 BOM
      itemRow("pC", "PC"), // 순환
      itemRow("sC", "SC", "SEMI_FINISHED"),
      itemRow("pRaw", "RAWITEM", "RAW_MATERIAL"),
      itemRow("pForeign", "FG-B-ONLY", "FINISHED", B),
    ],
    bOM: [
      bomRow("bA", "pA", [bi("m1", "MAT1", 1, 2), bi("m2", "MAT2", 2, 3)]),
      bomRow("bB", "pB", [bi("m1", "MAT1", 1, 4)]),
      bomRow("bS", "pS", [bi("sx", "SEMI-X", 1, 2, "SEMI_FINISHED")]),
      bomRow("bSX", "sx", [bi("m3", "MAT3", 1, 3)]),
      bomRow("bK", "pK", [bi("sx", "SEMI-X", 1, 2, "SEMI_FINISHED", 0.1)]),
      bomRow("bM1", "pM", [bi("m1", "MAT1", 1, 1)], { version: "1" }),
      bomRow("bM2", "pM", [bi("m1", "MAT1", 1, 2)], { version: "2" }),
      bomRow("bE", "pE", []),
      bomRow("bC", "pC", [bi("sC", "SC", 1, 1, "SEMI_FINISHED")]),
      bomRow("bSC", "sC", [bi("pC", "PC", 1, 1, "SEMI_FINISHED")]),
      // 다른 tenant 의 같은 itemId BOM(선택되면 안 됨)
      bomRow("bAx", "pA", [bi("m1", "MAT1", 1, 999)], { tenantId: B }),
    ],
    inventoryBalance: [
      bal("m1", 15, 0, 15),
      bal("m2", 50, 0, 50),
      bal("m3", 10, 0, 10),
      bal("m1", 5000, 0, 5000, { tenantId: B, item: { tenantId: B } }),
    ],
  }
}
const sim = (tables: Record<string, Row[]>, items: unknown[], extra: Record<string, unknown> = {}) => {
  const f = makeDb(tables)
  return executeSimulationRequest(
    { authorize: authA, db: f.db as SimulationDb, now: () => new Date("2026-10-14T00:00:00Z") },
    { items, ...extra }
  ).then((payload) => ({ payload, view: payload.view, calls: f.calls }))
}
const mat = (view: { materials: Array<{ code: string }> }, code: string) => {
  const m = view.materials.find((x) => x.code === code)
  assert.ok(m, "material " + code)
  return m as any
}

async function main() {
  section("W1 기본 시뮬레이션 (제품 A 10, MAT1=2·MAT2=3, 재고 15/50)")
  {
    const { view, payload } = await sim(world(), [{ itemId: "pA", qty: 10 }])
    const m1 = mat(view, "MAT1")
    const m2 = mat(view, "MAT2")
    eq([m1.totalRequirement, m1.qtyAvailable, m1.expectedBalance, m1.shortageQty], [20, 15, -5, 5], "W1 MAT1 소요 20 / 가용 15 / 예상 −5 / 부족 5")
    eq([m2.totalRequirement, m2.qtyAvailable, m2.expectedBalance, m2.shortageQty], [30, 50, 20, 0], "W1 MAT2 소요 30 / 가용 50 / 예상 20 / 부족 0")
    eq(view.kpi.shortageMaterialCount, 1, "W1 부족 자재 1")
    eq(view.materials[0].code, "MAT1", "W1 부족 자재가 목록 맨 앞")
    eq(view.mode, "WHAT_IF", "W1 모드 표시 WHAT_IF")
    eq(payload.calculatedAt, "2026-10-14T00:00:00.000Z", "W1 계산 시각은 주입값")
  }

  section("W2 복수 제품 (A 10, B 5 → MAT1 40, MAT2 30) — Phase 3 와 같은 수학")
  {
    const { view } = await sim(world(), [{ itemId: "pA", qty: 10 }, { itemId: "pB", qty: 5 }])
    eq([mat(view, "MAT1").totalRequirement, mat(view, "MAT2").totalRequirement], [40, 30], "W2 MAT1 = 10×2+5×4 = 40, MAT2 = 30")
    eq(
      mat(view, "MAT1").sources.map((s: any) => [s.itemCode, s.productQty, s.bomQtyPerUnit, s.requirement]),
      [["PA", 10, 2, 20], ["PB", 5, 4, 20]],
      "W2 자재별 제품 근거(제품/예상수량/제품당 소요/자재소요)"
    )
    eq(
      mat(view, "MAT1").sources.reduce((s: number, x: any) => s + x.requirement, 0),
      mat(view, "MAT1").totalRequirement,
      "W2 근거 합계 = 총소요"
    )
    eq([view.kpi.productCount, view.kpi.requiredMaterialCount, view.kpi.requirementLineCount], [2, 2, 3], "W2 KPI(제품 2 / 자재 2 / 소요 라인 3)")
    eq(view.products.map((p) => p.simId), ["SIM-001", "SIM-002"], "W2 가상 식별자 SIM-001, SIM-002 (DB ID 아님)")
  }

  section("W3 다단계 BOM + 스크랩")
  {
    const { view } = await sim(world(), [{ itemId: "pS", qty: 10 }])
    eq(mat(view, "MAT3").totalRequirement, 60, "W3 PRODUCT 10 → SEMI 2 → MAT 3 = 60")
    eq(mat(view, "SEMI-X").totalRequirement, 20, "W3 반제품 자체 소요 20")
    eq(
      mat(view, "MAT3").sources.map((s: any) => [s.itemCode, s.productQty, s.bomQtyPerUnit, s.requirement]),
      [["PS", 10, 6, 60]],
      "W3 다단계 근거: 제품당 소요는 전개 후 합산값(6)"
    )
    const k = await sim(world(), [{ itemId: "pK", qty: 10 }])
    eq(mat(k.view, "MAT3").totalRequirement, 10 * (2 * (1 + 0.1) * 3), "W3 scrapRate 0.1 적용 (10×2×1.1×3)")
    eq(mat(k.view, "SEMI-X").totalRequirement, 10 * (2 * (1 + 0.1)), "W3 반제품 소요에도 스크랩 반영")
  }

  section("W4 재고: qtyAvailable 이 openingStock (qtyHold 이중 차감 없음)")
  {
    const w = world()
    w.inventoryBalance = [bal("m1", 100, 30, 70), bal("m2", 50, 0, 50)]
    w.bOM = [bomRow("bA", "pA", [bi("m1", "MAT1", 1, 8), bi("m2", "MAT2", 2, 3)])]
    const { view } = await sim(w, [{ itemId: "pA", qty: 10 }])
    const m1 = mat(view, "MAT1")
    eq([m1.qtyOnHand, m1.qtyHold, m1.qtyAvailable], [100, 30, 70], "W4 현재고 100 / 예약 30 / 가용 70 표시")
    eq([m1.totalRequirement, m1.expectedBalance, m1.shortageQty], [80, -10, 10], "W4 소요 80 → 예상 −10 → 부족 10")
    ok(m1.expectedBalance !== -40 && m1.expectedBalance !== 20, "W4 qtyHold 를 다시 빼거나(−40) qtyOnHand 를 쓰지(+20) 않음")
    // 격리 LOT 재고 제외
    const w2 = world()
    w2.inventoryBalance = [
      bal("m1", 10, 0, 10),
      bal("m1", 40, 0, 40, { lotId: "lotQ", lot: { status: "QUARANTINE", tenantId: A } }),
      bal("m2", 50, 0, 50),
    ]
    const q = await sim(w2, [{ itemId: "pA", qty: 10 }])
    eq([mat(q.view, "MAT1").qtyAvailable, mat(q.view, "MAT1").qtyExcludedByLot], [10, 40], "W4 격리 LOT 는 가용재고에서 제외하고 별도 표시")
  }

  section("W5~W8 BOM 오류 — 해당 제품만 제외, 정상 제품은 계속")
  {
    const { view } = await sim(world(), [
      { itemId: "pA", qty: 10 },
      { itemId: "pX", qty: 3 },
      { itemId: "pM", qty: 2 },
      { itemId: "pE", qty: 1 },
      { itemId: "pC", qty: 4 },
    ])
    const byCode = (c: string) => view.excluded.find((e) => e.code === c)
    eq(byCode("PX")?.reason, "MISSING_DEFAULT_BOM", "W5 Default BOM 없음")
    eq(byCode("PM")?.reason, "MULTIPLE_DEFAULT_BOM", "W6 Default 다중 → 임의 선택하지 않음")
    eq(byCode("PE")?.reason, "EMPTY_DEFAULT_BOM", "W7 빈 BOM")
    eq(byCode("PC")?.reason, "INVALID_BOM", "W8 순환 BOM")
    ok(view.warnings.some((w) => w.code === "BOM_CYCLE_DETECTED"), "W8 순환 경고")
    eq(
      view.excluded.map((e) => [e.code, e.inputQty]).sort(),
      [["PC", 4], ["PE", 1], ["PM", 2], ["PX", 3]],
      "제외 목록에 제품코드/입력수량 포함"
    )
    eq(view.kpi.bomIssueProductCount, 4, "BOM 오류 제품 KPI 4")
    eq(view.kpi.productCount, 1, "정상 제품 1건은 계속 계산")
    eq(mat(view, "MAT1").totalRequirement, 20, "정상 제품(PA) 소요 20 — 다른 제품 BOM 이 섞이지 않음")
    ok(view.materials.every((m) => m.sources.every((s) => s.itemCode === "PA")), "제외 제품은 근거에도 없음")
  }

  section("W9 타 tenant 제품 / 비생산 품목")
  {
    const { view, payload } = await sim(world(), [
      { itemId: "pForeign", qty: 7 },
      { itemId: "pRaw", qty: 1 },
      { itemId: "no-such-id", qty: 1 },
      { itemId: "pA", qty: 10 },
    ])
    eq(view.excluded.filter((e) => e.reason === "INVALID_PRODUCT").length, 3, "W9 타 tenant / 원자재 / 없는 ID 모두 동일하게 '유효하지 않은 제품'")
    const text = JSON.stringify(payload)
    ok(!text.includes("FG-B-ONLY") && !text.includes(B), "W9 타 tenant 제품 코드·이름·tenant 정보 미노출")
    ok(view.excluded.every((e) => e.itemId === null), "W9 오류 행에 입력 ID 를 되돌려 주지 않음")
    eq(view.kpi.productCount, 1, "W9 정상 제품은 계속 계산")
  }

  section("W10 수량 오류 / W11 중복 입력 / W12 빈 입력")
  {
    const { view } = await sim(world(), [
      { itemId: "pA", qty: 0 },
      { itemId: "pA", qty: -5 },
      { itemId: "pA", qty: Number.NaN },
      { itemId: "pA", qty: Number.POSITIVE_INFINITY },
      { itemId: "pA", qty: "10" },
      { itemId: "pA", qty: null },
      { itemId: "pB", qty: 5 },
    ])
    eq(view.excluded.filter((e) => e.reason === "INVALID_QUANTITY").length, 6, "W10 0 / 음수 / NaN / Infinity / 문자열 / null 모두 수량 오류")
    ok(view.excluded.every((e) => e.code === "PA"), "W10 소유 확인된 제품은 코드 표시")
    eq(view.kpi.productCount, 1, "W10 정상 입력(PB 5)만 계산")
    eq(mat(view, "MAT1").totalRequirement, 20, "W10 PB 5 × 4 = 20")

    const dup = await sim(world(), [{ itemId: "pA", qty: 4 }, { itemId: "pA", qty: 6 }])
    const single = await sim(world(), [{ itemId: "pA", qty: 10 }])
    eq(
      dup.view.materials.map((m) => [m.code, m.totalRequirement, m.expectedBalance, m.shortageQty]),
      single.view.materials.map((m) => [m.code, m.totalRequirement, m.expectedBalance, m.shortageQty]),
      "W11 같은 제품 2행(4+6)의 결과 = 10 단일 입력과 동일(손실 없음)"
    )
    eq(dup.view.kpi.productCount, 1, "W11 제품은 1개로 합산")
    ok(dup.view.warnings.some((w) => w.code === "DUPLICATE_PRODUCT_INPUT"), "W11 합산 안내 INFO")

    const empty = await sim(world(), [])
    eq([empty.view.kpi.productCount, empty.view.materials.length, empty.calls.length], [0, 0, 0], "W12 빈 입력 → 빈 결과, DB 조회 0회")
    const noBody = await executeSimulationRequest({ authorize: authA, db: makeDb(world()).db }, undefined)
    eq(noBody.view.materials.length, 0, "W12 본문 없음도 빈 결과(오류 아님)")
    await assert.rejects(sim(world(), new Array(501).fill({ itemId: "pA", qty: 1 })), /최대 500개/)
    passed += 1
    console.log("PASS W12 입력 상한(500) 초과 거부")
  }

  section("PF 쿼리 수 — 제품 3개 vs 303개")
  {
    const small = await sim(world(), [{ itemId: "pA", qty: 1 }, { itemId: "pB", qty: 1 }, { itemId: "pS", qty: 1 }])
    const w = world()
    const many: unknown[] = []
    for (let i = 0; i < 303; i++) {
      w.item.push(itemRow("bulk" + i, "BULK-" + String(i).padStart(3, "0")))
      w.bOM.push(bomRow("bb" + i, "bulk" + i, [bi("m1", "MAT1", 1, 1)]))
      many.push({ itemId: "bulk" + i, qty: 1 })
    }
    const big = await sim(w, many)
    eq(big.view.kpi.productCount, 303, "PF 303개 제품 계산")
    eq(mat(big.view, "MAT1").totalRequirement, 303, "PF MAT1 = 303")
    eq(big.calls.map((c) => c.model), ["item", "bOM", "inventoryBalance"], "PF 303개도 제품 1 + BOM 1레벨 + 재고 1 (N+1 없음)")
    eq(small.calls.map((c) => c.model), ["item", "bOM", "bOM", "inventoryBalance"], "PF 3개(반제품 포함)는 BOM 2레벨 = 4쿼리")
    eq(big.payload.diagnostics.queryCount, big.calls.length, "PF 보고 쿼리 수 = 실제 호출 수")
    ok(big.calls.length <= small.calls.length, "PF 입력 건수가 늘어도 쿼리 수 증가 없음")
  }

  section("SEC 권한 / tenant 위조 / 읽기 전용")
  {
    const f = makeDb(world())
    await assert.rejects(
      executeSimulationRequest(
        {
          authorize: async () => {
            throw new Error("ROLE_PERMISSION_DENIED")
          },
          db: f.db,
        },
        { items: [{ itemId: "pA", qty: 1 }] }
      ),
      /ROLE_PERMISSION_DENIED/
    )
    passed += 1
    console.log("PASS SEC 권한 없는 사용자 차단")
    eq(f.calls.length, 0, "SEC 권한 거부 시 DB 조회 0회")

    const spoof = await sim(world(), [{ itemId: "pA", qty: 10 }], { tenantId: B })
    eq(mat(spoof.view, "MAT1").totalRequirement, 20, "SEC 요청의 tenantId(B) 위조 무시 → Tenant A 의 BOM(2) 사용")
    ok(spoof.calls.every((c) => JSON.stringify(c.where).includes(A) && !JSON.stringify(c.where).includes(B)), "SEC 모든 쿼리가 인증 tenant 로만 한정")
    ok(spoof.calls.every((c) => c.op === "findMany" || c.op === "count"), "RO 조회(findMany/count) 외 호출 없음")

    const svc = readFileSync(join(process.cwd(), "src/lib/services/mrp-simulation.service.ts"), "utf8")
    const act = readFileSync(join(process.cwd(), "src/lib/actions/mrp-simulation.actions.ts"), "utf8")
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    ok(!/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$transaction|\$executeRaw|\$queryRaw)\(/.test(strip(svc) + strip(act)), "RO 서비스/액션에 쓰기 호출 없음")
    ok(!/salesOrder|productionPlan|workOrder|materialReservation|purchaseOrder|shipment/i.test(strip(svc).replace(/PurchaseOrder/g, "")), "RO 수주/계획/작업지시/예약/발주 모델 미접근")
    ok(/requireResourcePermission\("MRP", "READ"\)/.test(act) && !/tenantId/.test(strip(act)), "SEC 액션: MRP READ + tenantId 파라미터 없음")
  }

  section("제품 검색")
  {
    const f = makeDb(world())
    const r = await executeProductSearchRequest({ authorize: authA, db: f.db as ProductSearchDb }, "p")
    ok(r.items.length > 0 && r.items.every((i) => ["FINISHED", "SEMI_FINISHED"].includes(i.itemType)), "검색: 생산 대상 유형만")
    ok(!r.items.some((i) => i.code === "FG-B-ONLY" || i.code === "RAWITEM"), "검색: 타 tenant / 원자재 미노출")
    eq(r.items.find((i) => i.code === "PA")?.bomState, "OK", "검색: 기본 BOM 있음")
    eq(r.items.find((i) => i.code === "PX")?.bomState, "MISSING", "검색: 기본 BOM 없음 표시")
    eq(r.items.find((i) => i.code === "PM")?.bomState, "MULTIPLE", "검색: Default 다중 표시")
    const byName = await executeProductSearchRequest({ authorize: authA, db: makeDb(world()).db }, "pa 이름")
    eq(byName.items.map((i) => i.code), ["PA"], "검색: 이름 부분일치(대소문자 무시)")
    const w = world()
    for (let i = 0; i < 40; i++) w.item.push(itemRow("s" + i, "ZZ-" + String(i).padStart(2, "0")))
    const lim = await executeProductSearchRequest({ authorize: authA, db: makeDb(w).db }, "ZZ-")
    eq(lim.items.length, 20, "검색: 결과 20건 제한(대량 전송 방지)")
    const none = world()
    none.item = [itemRow("pForeign", "FG-B-ONLY", "FINISHED", B)]
    const empty = await executeProductSearchRequest({ authorize: authA, db: makeDb(none).db }, "")
    eq([empty.items.length, empty.hasAnyProduct], [0, false], "검색: 생산 품목이 없으면 hasAnyProduct=false (Empty State)")
    const g = makeDb(world())
    await assert.rejects(
      executeProductSearchRequest({ authorize: async () => { throw new Error("DENIED") }, db: g.db }, "p"),
      /DENIED/
    )
    passed += 1
    console.log("PASS 검색: 권한 거부 차단")
    eq(g.calls.length, 0, "검색: 권한 거부 시 DB 조회 0회")
  }

  section("XL Excel 파생 비교 (출고예정소요량 시트 값 ↔ 품목 시뮬레이션)")
  {
    type Fx = {
      materialCodes: string[]
      boms: Record<string, Array<[string, number]>>
      demands: Array<{ item: string; qty: number }>
      expected: Array<Record<string, number>>
    }
    const fx = JSON.parse(readFileSync(join(process.cwd(), "scripts/fixtures/order-mrp/excel-golden-shipment-plan.json"), "utf8")) as Fx
    const tables: Record<string, Row[]> = { item: [], bOM: [], inventoryBalance: [] }
    for (const [prod, lines] of Object.entries(fx.boms)) {
      tables.item.push(itemRow("item:" + prod, prod))
      tables.bOM.push(
        bomRow("bom:" + prod, "item:" + prod, lines.map(([code, q], i) => bi("mat:" + code, code, i + 1, q)))
      )
    }
    // 제품별 총 예상수량 = 해당 제품 수주의 수량 합계, Excel 기대값 = 해당 수주 열(셀)의 합계
    const qtyByProduct = new Map<string, number>()
    fx.demands.forEach((d) => qtyByProduct.set(d.item, (qtyByProduct.get(d.item) ?? 0) + d.qty))
    const expectedByMat = new Map<string, number>()
    fx.expected.forEach((cells) => Object.entries(cells).forEach(([code, v]) => expectedByMat.set(code, (expectedByMat.get(code) ?? 0) + v)))
    const r = await sim(tables, Array.from(qtyByProduct.entries()).map(([prod, qty]) => ({ itemId: "item:" + prod, qty })))
    let compared = 0
    let mismatch = 0
    const got = new Map(r.view.materials.map((m) => [m.code, m.totalRequirement]))
    for (const code of fx.materialCodes) {
      compared += 1
      if ((got.get(code) ?? 0) !== (expectedByMat.get(code) ?? 0)) {
        mismatch += 1
        console.log(`  MISMATCH ${code} want=${expectedByMat.get(code) ?? 0} got=${got.get(code) ?? 0}`)
      }
    }
    eq([compared, mismatch], [273, 0], "XL 273자재 총소요: 시뮬레이션 = Excel 출고예정소요량 셀 합계 (차이 0)")
    eq(r.view.kpi.productCount, qtyByProduct.size, "XL 제품 수 일치(" + qtyByProduct.size + ")")
    // 제품 1개 × 수량 1 = DB 시트 BOM 합계(Excel 예상소요량(품목)의 업무 의도)
    const [firstProd, firstLines] = Object.entries(fx.boms)[0]
    const one = await sim(tables, [{ itemId: "item:" + firstProd, qty: 1 }])
    const want = new Map<string, number>()
    firstLines.forEach(([code, q]) => want.set(code, (want.get(code) ?? 0) + q))
    eq(
      one.view.materials.map((m) => [m.code, m.totalRequirement]).sort(),
      Array.from(want.entries()).filter(([, q]) => q > 0).sort(),
      "XL 제품 1개 × 1 = Excel DB 시트 BOM 수량 합계 (동일 자재 합산)"
    )
  }

  console.log(`\n✅ mrp-simulation: ${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
