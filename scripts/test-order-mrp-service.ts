/**
 * 수주 기반 MRP 서비스/어댑터 테스트 (fake DB 주입 · 실제 DB 접속/쓰기 없음)
 *
 * 실행: npm run test:order-mrp-service
 *
 *  A 어댑터→엔진 매핑      B 부분출하(100-40=60)   C CANCELLED 제외     D Default BOM 선택
 *  E BOM 없음 노출         F Default BOM 다중 오류  G openingStock=qtyAvailable
 *  H 예약재고 이중차감 없음 I tenant 격리           J 권한 없는 접근 차단 K N+1 없음
 *  M M4 BOM 업로드 Default 정책
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decideImportDefaultFlags } from "../src/lib/bom-default-policy"
import { executeOrderMrpRequest, normalizeOrderMrpParams, type OrderMrpDb } from "../src/lib/services/mrp-order.service"

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

// ─── fake DB (where 절을 실제로 평가) ────────────────────────────────────────

type Row = Record<string, unknown>
const OPS = ["in", "not", "gt", "gte", "lt", "lte", "equals"]

function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    const keys = Object.keys(cond as object)
    if (keys.length > 0 && keys.every((k) => OPS.includes(k))) {
      const c = cond as Record<string, any>
      return keys.every((k) => {
        const v = c[k]
        const a = actual as any
        switch (k) {
          case "in":
            return (v as unknown[]).includes(actual)
          case "not":
            return a !== v
          case "equals":
            return a === v
          case "gt":
            return a > v
          case "gte":
            return a >= v
          case "lt":
            return a < v
          default:
            return a <= v
        }
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
function pick(row: Row, path: Row): unknown {
  const [k, v] = Object.entries(path)[0]
  const inner = row[k]
  return typeof v === "object" && v !== null ? pick(inner as Row, v as Row) : inner
}

type Call = { model: string; where: Row }
function makeDb(tables: Record<string, Row[]>) {
  const calls: Call[] = []
  const model = (name: string) => ({
    findMany: async (args: { where?: Row; orderBy?: Row[] }) => {
      calls.push({ model: name, where: args.where ?? {} })
      let rows = tables[name].filter((r) => (args.where ? matches(r, args.where) : true))
      if (args.orderBy) {
        rows = [...rows].sort((a, b) => {
          for (const o of args.orderBy as Row[]) {
            const va = String(pick(a, o))
            const vb = String(pick(b, o))
            if (va !== vb) return va < vb ? -1 : 1
          }
          return 0
        })
      }
      return rows
    },
  })
  // 허용된 3개 모델 외(예: shipmentOrder, shipmentItem)에 접근하면 즉시 실패 → PLANNED 출하 미조회 증명
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

// ─── 데이터 구성 ─────────────────────────────────────────────────────────────

const T1 = "tenant-1"
const T2 = "tenant-2"
const item = (id: string, code: string, tenantId = T1) => ({ id, code, name: code + " 이름", tenantId })
const comp = (code: string, itemType = "RAW_MATERIAL") => ({ code, name: code + " 자재", spec: code + " 규격", uom: "EA", itemType })
const bomItem = (componentItemId: string, code: string, seq: number, qtyPer: number, itemType = "RAW_MATERIAL", scrapRate = 0) => ({
  componentItemId,
  seq,
  qtyPer,
  scrapRate,
  componentItem: comp(code, itemType),
})
const bom = (
  id: string,
  itemId: string,
  over: Partial<{ tenantId: string; status: string; isDefault: boolean; version: string }>,
  bomItems: ReturnType<typeof bomItem>[]
) => ({ id, tenantId: T1, itemId, version: "1", status: "ACTIVE", isDefault: true, ...over, bomItems })
const line = (
  id: string,
  salesOrder: { id: string; tenantId?: string; orderNo: string; status: string; deliveryDate?: Date },
  it: ReturnType<typeof item>,
  qty: number,
  shippedQty: number,
  due: string | null
) => ({
  id,
  qty,
  shippedQty,
  deliveryDate: due ? new Date(due + "T00:00:00Z") : null,
  itemId: it.id,
  item: it,
  salesOrder: {
    tenantId: salesOrderTenant(salesOrder),
    deliveryDate: new Date("2026-12-31T00:00:00Z"),
    customer: { name: "고객사" },
    ...salesOrder,
  },
})
function salesOrderTenant(s: { tenantId?: string }) {
  return s.tenantId ?? T1
}
const bal = (
  itemId: string,
  over: { tenantId?: string; onHand: number; hold?: number; avail: number; lot?: string | null; lotStatus?: string }
) => ({
  tenantId: over.tenantId ?? T1,
  itemId,
  item: { tenantId: over.tenantId ?? T1 },
  qtyOnHand: over.onHand,
  qtyHold: over.hold ?? 0,
  qtyAvailable: over.avail,
  lotId: over.lot ?? null,
  lot: over.lot ? { tenantId: over.tenantId ?? T1, status: over.lotStatus ?? "ACTIVE" } : null,
})

const fgA = item("fgA", "FG-A")
const fgB = item("fgB", "FG-B")
const fgX = item("fgX", "FG-X") // BOM 없음
const fgM = item("fgM", "FG-M") // Default 2개
const fgE = item("fgE", "FG-E") // Default BOM 에 라인 없음
const fgA2 = item("fgA2", "FG-A2", T2)

function world(extraLines: ReturnType<typeof line>[] = []) {
  const SO1 = { id: "so1", orderNo: "SO-1", status: "CONFIRMED" }
  const SO2 = { id: "so2", orderNo: "SO-2", status: "PARTIAL_SHIPPED" }
  const SO3 = { id: "so3", orderNo: "SO-3", status: "CANCELLED" }
  const SO4 = { id: "so4", orderNo: "SO-4", status: "SHIPPED" }
  const SO5 = { id: "so5", orderNo: "SO-5", status: "CONFIRMED" }
  const SO6 = { id: "so6", orderNo: "SO-6", status: "DRAFT" }
  const SO7 = { id: "so7", orderNo: "SO-7", status: "CONFIRMED" }
  const SOT2 = { id: "soT2", orderNo: "SO-T2", status: "CONFIRMED", tenantId: T2 }
  return {
    salesOrderItem: [
      line("l1", SO1, fgA, 100, 40, "2026-06-10"), // 잔량 60
      line("l2", SO2, fgA, 10, 0, "2026-06-05"),
      line("l3", SO2, fgB, 5, 0, "2026-06-20"),
      line("l4", SO3, fgA, 999, 0, "2026-06-01"), // CANCELLED
      line("l5", SO4, fgA, 5, 5, "2026-06-02"), // SHIPPED
      line("l6", SO5, fgX, 1, 0, "2026-06-12"),
      line("l7", SO5, fgM, 1, 0, "2026-06-12"),
      line("l8", SO5, fgE, 1, 0, "2026-06-12"),
      line("l9", SO6, fgA, 7, 0, "2026-06-30"), // DRAFT
      line("l10", SO7, fgA, 3, 3, "2026-06-01"), // 잔량 0
      line("lT2", SOT2, fgA2, 500, 0, "2026-06-03"), // 다른 tenant
      ...extraLines,
    ],
    bOM: [
      bom("b-a", "fgA", {}, [bomItem("r1", "R1", 1, 1), bomItem("r2", "R2", 2, 2)]),
      bom("b-a-v2", "fgA", { version: "2", isDefault: false }, [bomItem("r1", "R1", 1, 9)]), // ACTIVE non-default
      bom("b-a-old", "fgA", { version: "0", status: "INACTIVE" }, [bomItem("r1", "R1", 1, 100)]), // INACTIVE default
      bom("b-a-t2", "fgA", { tenantId: T2, version: "t2" }, [bomItem("r1", "R1", 1, 50)]), // 다른 tenant default
      bom("b-b", "fgB", {}, [bomItem("sf1", "SF-1", 1, 2, "SEMI_FINISHED"), bomItem("r1", "R1", 2, 1)]),
      bom("b-sf1", "sf1", {}, [bomItem("r3", "R3", 1, 3)]),
      bom("b-m1", "fgM", { version: "1" }, [bomItem("r1", "R1", 1, 1)]),
      bom("b-m2", "fgM", { version: "2" }, [bomItem("r1", "R1", 1, 2)]),
      bom("b-e", "fgE", {}, []),
    ],
    inventoryBalance: [
      bal("r1", { onHand: 100, hold: 30, avail: 70 }),
      bal("r1", { onHand: 20, avail: 20, lot: "lot-ok" }),
      bal("r1", { onHand: 50, avail: 50, lot: "lot-q", lotStatus: "QUARANTINE" }),
      bal("r1", { tenantId: T2, onHand: 1000, avail: 1000 }),
      bal("r2", { onHand: 10, avail: 10 }),
    ],
  } as Record<string, Row[]>
}

const authorizeT1 = async () => ({ tenantId: T1 })
const fixedNow = () => new Date("2026-06-01T00:00:00Z")
const mat = (view: { materials: Array<{ code: string }> }, code: string) => {
  const m = view.materials.find((x) => x.code === code)
  assert.ok(m, `material ${code}`)
  return m as any
}

async function main() {
  // ── A·B·C·D·G·H·I ──────────────────────────────────────────────────────────
  section("A 어댑터 → 엔진 매핑 / B 부분출하 / C 취소 / D Default BOM / G·H 재고 / I tenant")
  const { db, calls } = makeDb(world())
  const out = await executeOrderMrpRequest({ authorize: authorizeT1, db, now: fixedNow }, {})
  const v = out.view
  eq(out.view.mode, "NORMAL", "A 기본 모드 NORMAL")
  eq(out.calculatedAt, "2026-06-01T00:00:00.000Z", "A 계산 시각은 주입된 now")

  // 납기순: l2(06-05) → l1(06-10) → l3(06-20)
  const r1 = mat(v, "R1")
  eq(r1.steps.map((s: any) => s.orderLineId), ["l2", "l1", "l3"], "A 납기순 처리(l2, l1, l3)")
  eq(r1.steps.map((s: any) => s.demandQty), [10, 60, 5], "B 수주 100 − 출하확정 40 = 60 (l1)")
  eq(r1.steps.map((s: any) => s.requirement), [10, 60, 5], "B 소요량에 잔량 60 반영")
  eq(
    v.materials.some((m) => m.steps.some((s) => s.orderLineId === "l4")),
    false,
    "C CANCELLED 수주 제외"
  )
  eq(
    v.materials.some((m) => m.steps.some((s) => ["l5", "l10"].includes(s.orderLineId))),
    false,
    "B 전량 출하/잔량 0 라인 제외"
  )
  eq(v.excludedCounts["NO_REMAINING_QTY"], 1, "B 잔량 0 라인은 엔진에서 NO_REMAINING_QTY 로 집계")
  eq(
    v.materials.some((m) => m.steps.some((s) => s.orderLineId === "l9")),
    false,
    "A DRAFT 수주는 기본 제외"
  )
  eq(
    v.materials.some((m) => m.steps.some((s) => s.orderLineId === "lT2")),
    false,
    "I 다른 tenant 수주 제외"
  )

  // D Default BOM: ACTIVE+default+tenant 일치만 → R1×1 (v2 non-default ×9, INACTIVE ×100, 타 tenant ×50 미사용)
  eq(r1.totalRequirement, 10 + 60 + 5, "D ACTIVE+Default+tenant BOM 만 사용 (R1 합계 75)")
  eq(mat(v, "R2").totalRequirement, 2 * (10 + 60), "D R2 소요 = 2 × (10+60)")
  // 다단계: fgB → SF-1 ×2 → R3 ×3, 수량 5
  eq(mat(v, "SF-1").totalRequirement, 10, "D 반제품 SF-1 소요 2×5")
  eq(mat(v, "R3").totalRequirement, 30, "D 다단계 전개 R3 = 5×2×3")

  // G 가용재고 = qtyAvailable 합계(격리 LOT·타 tenant 제외)
  eq(r1.qtyAvailable, 90, "G openingStock = qtyAvailable 합 (70+20, 격리 LOT 50 제외)")
  eq(r1.steps[0].balanceBefore, 90, "G 첫 수주 차감 전 잔량 = 가용재고 90")
  eq(r1.steps.map((s: any) => s.balanceAfter), [80, 20, 15], "G 순차 차감 80 / 20 / 15")
  eq(r1.qtyExcludedByLot, 50, "G 격리 LOT 수량은 제외하고 별도 표시")
  // H 예약재고 이중 차감 없음
  eq([r1.qtyOnHand, r1.qtyHold, r1.qtyAvailable], [120, 30, 90], "H 현재고/예약재고/가용재고 구분 표시")
  ok(r1.steps[0].balanceBefore !== 60 && r1.steps[0].balanceBefore !== 120, "H qtyHold 를 다시 빼거나 qtyOnHand 를 쓰지 않음")
  eq(r1.finalBalance, 15, "H 최종 예상재고 90 − 75 = 15")

  // 부족/원인 PO
  const r2 = mat(v, "R2")
  eq([r2.qtyAvailable, r2.finalBalance, r2.shortageQty], [10, -130, 130], "G R2 가용 10, 최종 -130")
  eq(r2.firstShortageDate, "2026-06-05", "최초 결품일 2026-06-05")
  eq(r2.firstShortageOrderNo, "SO-2", "최초 결품 PO = SO-2")
  eq(r2.shortageOrderNos, ["SO-2", "SO-1"], "부족 유발 PO 목록(처리 순서)")
  eq(r2.shortageDemandCount, 2, "결품 수주건수 2")
  eq(r2.steps.map((s: any) => [s.balanceBefore, s.balanceAfter, s.isShortage]), [[10, -10, true], [-10, -130, true]], "수주별 순차 차감 상세(차감전/후/결품)")
  eq(v.materials[0].shortageQty > 0, true, "부족 자재가 목록 앞쪽에 정렬")

  // E·F BOM 문제 노출
  section("E BOM 없음 / F Default BOM 다중")
  const issues = v.excludedLines.filter((l) => l.isBomIssue)
  eq(
    issues.map((l) => [l.orderLineId, l.reason]).sort(),
    [["l6", "MISSING_DEFAULT_BOM"], ["l7", "MULTIPLE_DEFAULT_BOM"], ["l8", "EMPTY_DEFAULT_BOM"]],
    "E/F 누락·다중·빈 BOM 이 사유와 함께 노출"
  )
  const missing = issues.find((l) => l.orderLineId === "l6")!
  eq([missing.orderNo, missing.itemCode, missing.deliveryDate, missing.orderQty], ["SO-5", "FG-X", "2026-06-12", 1], "E 누락 목록에 PO/제품코드/납기/수량")
  ok(missing.itemName.length > 0 && missing.reasonLabel.length > 0, "E 제품명·제외 이유 포함")
  eq(
    v.materials.some((m) => m.steps.some((s) => ["l6", "l7", "l8"].includes(s.orderLineId))),
    false,
    "F 다중 Default 는 임의 선택하지 않고 계산 제외"
  )
  eq(v.kpi.bomIssueLineCount, 3, "E KPI BOM 누락 수주 3")
  eq(v.kpi.demandLineCount, 3, "KPI 대상 수주라인 3")
  eq(v.kpi.shortageMaterialCount, 3, "KPI 부족 자재 3 (R2, R3, SF-1)")
  eq(v.kpi.requiredMaterialCount, 4, "KPI 필요 자재 4")
  eq(v.kpi.shortageDemandCount, 3, "KPI 결품 발생 수주 3")
  ok(v.warnings.every((w) => w.code !== "MISSING_BOM"), "E 엔진 MISSING_BOM 은 MISSING_DEFAULT_BOM 로 대체")

  // 기간·DRAFT 파라미터
  section("기간 / DRAFT 옵션")
  {
    const f = makeDb(world())
    const withDraft = await executeOrderMrpRequest({ authorize: authorizeT1, db: f.db }, { includeDraft: true })
    eq(withDraft.view.kpi.demandLineCount, 4, "DRAFT 포함 시 대상 라인 4")
    const g = makeDb(world())
    const one = await executeOrderMrpRequest({ authorize: authorizeT1, db: g.db }, { from: "2026-06-10", to: "2026-06-10" })
    eq(one.view.kpi.demandLineCount, 1, "기간 양끝 포함: 06-10 하루 = 1건")
    eq(one.view.excludedCounts["OUT_OF_PERIOD"], 5, "기간 밖 라인 집계(l2, l3, l6, l7, l8)")
  }
  eq(normalizeOrderMrpParams({ from: "", to: null }), { from: null, to: null, includeDraft: false }, "빈 기간 = 전체")
  assert.throws(() => normalizeOrderMrpParams({ from: "2026-6-1" }), /YYYY-MM-DD/)
  assert.throws(() => normalizeOrderMrpParams({ from: "2026-07-01", to: "2026-06-01" }), /늦습니다/)
  passed += 2
  console.log("PASS 잘못된 기간 형식/역전 거부")

  // ── I tenant ───────────────────────────────────────────────────────────────
  section("I tenant 격리 / J 권한")
  {
    const whereTenants = calls.map((c) => JSON.stringify(c.where))
    ok(calls.every((c) => JSON.stringify(c.where).includes(`"${T1}"`)), "I 모든 쿼리 where 에 인증된 tenantId 포함")
    ok(!whereTenants.some((w) => w.includes(T2)), "I 어떤 쿼리에도 다른 tenant 값 없음")

    // 요청 파라미터로 tenantId 를 보내도 무시
    const f = makeDb(world())
    const forged = await executeOrderMrpRequest({ authorize: authorizeT1, db: f.db }, { tenantId: T2, from: null })
    eq(forged.view.kpi.demandLineCount, 3, "I 파라미터 tenantId 는 무시(T1 데이터)")
    ok(f.calls.every((c) => !JSON.stringify(c.where).includes(T2)), "I 위조 tenantId 가 쿼리에 반영되지 않음")

    // tenant-2 로 인증된 사용자는 자기 데이터만 본다(수주 1건, BOM 없음)
    const f2 = makeDb(world())
    const asT2 = await executeOrderMrpRequest({ authorize: async () => ({ tenantId: T2 }), db: f2.db }, {})
    eq(
      [asT2.view.kpi.demandLineCount, asT2.view.kpi.bomIssueLineCount],
      [0, 1],
      "I T2 사용자: 자기 수주 1건만(BOM 없음), T1 데이터 비노출"
    )

    // J 권한 없음 → DB 접근 전에 차단
    const f3 = makeDb(world())
    await assert.rejects(
      executeOrderMrpRequest(
        {
          authorize: async () => {
            throw new Error("ROLE_PERMISSION_DENIED")
          },
          db: f3.db,
        },
        {}
      ),
      /ROLE_PERMISSION_DENIED/
    )
    eq(f3.calls.length, 0, "J 권한 거부 시 DB 쿼리 0회")

    // 액션 소스: 인증 컨텍스트 기반, tenantId 파라미터 없음, READ 권한
    const src = readFileSync(join(process.cwd(), "src/lib/actions/mrp-order.actions.ts"), "utf8")
    ok(/requireResourcePermission\("MRP", "READ"\)/.test(src), "J 액션이 MRP READ 권한을 요구")
    ok(!/tenantId/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "J 액션 시그니처/본문에 tenantId 파라미터 없음")
    ok(/"use server"/.test(src), "J 서버 액션 선언")
  }

  // ── K N+1 ──────────────────────────────────────────────────────────────────
  section("K N+1 없음")
  {
    const small = makeDb(world())
    const a = await executeOrderMrpRequest({ authorize: authorizeT1, db: small.db }, {})
    const many: ReturnType<typeof line>[] = []
    for (let i = 0; i < 300; i++) {
      many.push(line(`x${i}`, { id: `sox${i}`, orderNo: `SO-X${String(i).padStart(3, "0")}`, status: "CONFIRMED" }, i % 2 ? fgA : fgB, 1, 0, "2026-06-15"))
    }
    const big = makeDb(world(many))
    const b = await executeOrderMrpRequest({ authorize: authorizeT1, db: big.db }, {})
    eq(b.view.kpi.demandLineCount, 303, "K 수주 303건 처리")
    eq(a.diagnostics.queryCount, b.diagnostics.queryCount, "K 수주 3건 vs 303건 쿼리 수 동일")
    eq(b.diagnostics.queryCount, big.calls.length, "K 보고된 쿼리 수 = 실제 호출 수")
    eq(b.diagnostics.queryCount, 4, "K 수주 1 + BOM 2레벨(완제품, 반제품) + 재고 1 = 4")
    eq(big.calls.map((c) => c.model), ["salesOrderItem", "bOM", "bOM", "inventoryBalance"], "K 쿼리 구성")
    ok(big.calls.length < 10, "K 쿼리 수는 수주·자재 건수와 무관(상수)")
  }

  // ── M4 ─────────────────────────────────────────────────────────────────────
  section("M4 BOM 업로드 Default 정책")
  {
    const g = (key: string, parentItemId: string, status: string) => ({ key, parentItemId, status })
    const none = new Set<string>()
    eq(
      Array.from(decideImportDefaultFlags([g("a@1", "A", "ACTIVE")], none).entries()),
      [["a@1", true]],
      "M4 신규 품목 ACTIVE BOM → Default 지정"
    )
    eq(
      Array.from(decideImportDefaultFlags([g("a@1", "A", "ACTIVE")], new Set(["A"])).entries()),
      [["a@1", false]],
      "M4 이미 ACTIVE Default 가 있으면 Default 를 추가하지 않음"
    )
    eq(
      Array.from(decideImportDefaultFlags([g("a@1", "A", "INACTIVE")], none).entries()),
      [["a@1", false]],
      "M4 INACTIVE BOM 은 Default 아님"
    )
    eq(
      Array.from(decideImportDefaultFlags([g("a@1", "A", "ACTIVE"), g("a@2", "A", "ACTIVE"), g("b@1", "B", "ACTIVE")], none).entries()),
      [["a@1", true], ["a@2", false], ["b@1", true]],
      "M4 같은 파일 내 같은 품목은 첫 ACTIVE 만 Default"
    )
    // Phase 2.5: import 본문은 bom-import.service.ts 로 이동(정책 동일), 액션은 권한 + 위임만 수행
    const svc = readFileSync(join(process.cwd(), "src/lib/services/bom-import.service.ts"), "utf8")
    const act = readFileSync(join(process.cwd(), "src/lib/actions/bom-excel.actions.ts"), "utf8")
    ok(!/isDefault:\s*false/.test(svc) && !/isDefault:\s*false/.test(act), "M4 import 가 isDefault:false 를 하드코딩하지 않음")
    ok(/tx\.bOM\.findMany\(\{\s*where:\s*\{\s*tenantId,\s*status:\s*"ACTIVE",\s*isDefault:\s*true/.test(svc), "M4 기존 Default 를 tenant·ACTIVE 로 조회(트랜잭션 내)")
    ok(/requireResourcePermission\("BOM", "CREATE"\)/.test(act) && /\$transaction/.test(svc), "M4 권한·트랜잭션 유지")
  }

  console.log(`\n✅ order-mrp-service: ${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
