/**
 * MRP / BOM Import 보안 hardening 테스트 (fake DB 주입 · 실제 DB 접속/쓰기 없음)
 *
 * 실행: npm run test:mrp-security
 *
 *  Tenant A / Tenant B 두 개가 있다고 가정한다.
 *  A 외부 parent itemId BOM import → 실패        B 외부 componentItemId → 실패
 *  C 외부 supplier/site/item 으로 PO 생성 → 실패  D tenantId 위조 → 여전히 Tenant A
 *  E 권한 없는 runMRP → 실패(DB 0)               F 권한 없는 PO 생성 → 실패(쓰기 0)
 *  G 정상 입력 → 기존과 동일하게 성공
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { executeRunMrpRequest, type PlanMrpDb } from "../src/lib/services/mrp-plan.service"
import { createPurchaseOrdersFromMrp, type MrpPurchaseDb } from "../src/lib/services/mrp-purchase.service"
import {
  IMPORT_TENANT_MISMATCH_MESSAGE,
  importBomGroups,
  type BomImportDb,
  type BomImportGroup,
} from "../src/lib/services/bom-import.service"

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
    if (k === "NOT") return !matches(row, cond as Row)
    return matchValue(row[k], cond)
  })
}

type Write = { model: string; data: Row }
function makeDb(tables: Record<string, Row[]>) {
  const reads: Array<{ model: string; op: string; where: Row }> = []
  const writes: Write[] = []
  const filter = (name: string, where?: Row) => tables[name].filter((r) => (where ? matches(r, where) : true))
  const model = (name: string) => ({
    findMany: async (a: { where?: Row }) => {
      reads.push({ model: name, op: "findMany", where: a.where ?? {} })
      return filter(name, a.where)
    },
    findFirst: async (a: { where?: Row }) => {
      reads.push({ model: name, op: "findFirst", where: a.where ?? {} })
      return filter(name, a.where)[0] ?? null
    },
    aggregate: async (a: { where?: Row; _sum: Record<string, boolean> }) => {
      reads.push({ model: name, op: "aggregate", where: a.where ?? {} })
      const rows = filter(name, a.where)
      const _sum: Record<string, number | null> = {}
      for (const k of Object.keys(a._sum)) _sum[k] = rows.length ? rows.reduce((s, r) => s + Number(r[k]), 0) : null
      return { _sum }
    },
    create: async (a: { data: Row }) => {
      writes.push({ model: name, data: a.data })
      return { id: "new-" + writes.length, ...a.data }
    },
  })
  const target: Record<string, unknown> = {}
  const db = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === "$transaction") return async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
      if (!(prop in tables)) throw new Error(`unexpected model access: ${prop}`)
      return model(prop)
    },
  })
  return { db: db as any, reads, writes }
}

const A = "tenant-A"
const B = "tenant-B"
const authA = async () => ({ tenantId: A })
const denied = async () => {
  throw new Error("ROLE_PERMISSION_DENIED")
}

// ─── M1: runMRP ─────────────────────────────────────────────────────────────
const comp = (code: string, itemType = "RAW_MATERIAL") => ({ code, name: code + " 자재", uom: "EA", itemType })
function planWorld() {
  return {
    productionPlan: [
      {
        id: "planA",
        tenantId: A,
        planNo: "PP-A",
        items: [{ itemId: "fgA", plannedQty: 10, item: { id: "fgA", code: "FG-A" } }],
      },
      {
        id: "planB",
        tenantId: B,
        planNo: "PP-B",
        items: [{ itemId: "fgB", plannedQty: 99, item: { id: "fgB", code: "FG-B" } }],
      },
    ],
    bOM: [
      // 다른 tenant 의 같은 itemId 기본 BOM 이 먼저 오도록 배치(tenant 필터가 없으면 이것이 선택된다)
      { id: "bX", tenantId: B, itemId: "fgA", isDefault: true, bomItems: [{ componentItemId: "rawA1", qtyPer: 100, scrapRate: 0, componentItem: comp("RAW-A1") }] },
      { id: "bA", tenantId: A, itemId: "fgA", isDefault: true, bomItems: [{ componentItemId: "rawA1", qtyPer: 2, scrapRate: 0.1, componentItem: comp("RAW-A1") }] },
      { id: "bB", tenantId: B, itemId: "fgB", isDefault: true, bomItems: [{ componentItemId: "rawB1", qtyPer: 1, scrapRate: 0, componentItem: comp("RAW-B1") }] },
    ],
    inventoryBalance: [
      { tenantId: B, itemId: "rawA1", qtyOnHand: 1000, qtyAvailable: 1000 },
      { tenantId: A, itemId: "rawA1", qtyOnHand: 8, qtyAvailable: 5 },
    ],
    purchaseOrderItem: [
      { itemId: "rawA1", qty: 50, receivedQty: 0, purchaseOrder: { tenantId: B, status: "ORDERED" } },
      { itemId: "rawA1", qty: 4, receivedQty: 1, purchaseOrder: { tenantId: A, status: "ORDERED" } },
    ],
  } as Record<string, Row[]>
}

async function main() {
  section("G(정상) / E(권한) / D(tenant 위조) — runMRP")
  {
    const f = makeDb(planWorld())
    const r = await executeRunMrpRequest({ authorize: authA, db: f.db as PlanMrpDb }, "planA")
    const gross = 10 * 2 * (1 + 0.1)
    eq(r.planNo, "PP-A", "G 정상: Tenant A 계획 계산")
    eq(r.items.length, 1, "G 구성품 1종")
    eq(
      [r.items[0].grossRequirement, r.items[0].currentStock, r.items[0].availableStock, r.items[0].onOrder],
      [gross, 8, 5, 3],
      "G 총소요·재고·가용·발주중이 기존 알고리즘과 동일 (10×2×1.1, 8, 5, 4−1)"
    )
    eq(r.items[0].netRequirement, gross - 5 - 3, "G 순소요량 = 총소요 − 가용 − 발주중")
    eq(r.items[0].status, "CRITICAL", "G 상태 판정 동일(CRITICAL)")
    ok(f.reads.every((q) => JSON.stringify(q.where).includes(`"${A}"`)), "D 모든 MRP 조회에 인증 tenant 조건 포함(계획/BOM/재고/PO)")
    ok(f.reads.every((q) => !JSON.stringify(q.where).includes(B)), "D 다른 tenant 값이 쿼리에 없음")

    // 다른 tenant 의 계획 ID 로 호출 → 존재 여부를 노출하지 않는 동일한 오류
    const f2 = makeDb(planWorld())
    await assert.rejects(executeRunMrpRequest({ authorize: authA, db: f2.db }, "planB"), /생산계획을 찾을 수 없습니다\./)
    passed += 1
    console.log("PASS D Tenant A 가 Tenant B 계획 ID 로 호출 → '찾을 수 없음'")
    await assert.rejects(executeRunMrpRequest({ authorize: authA, db: makeDb(planWorld()).db }, "no-such-plan"), /생산계획을 찾을 수 없습니다\./)
    passed += 1
    console.log("PASS D 존재하지 않는 ID 와 타 tenant ID 의 오류 메시지가 동일(존재 여부 비노출)")
    eq(f2.reads.filter((q) => q.model !== "productionPlan").length, 0, "D 타 tenant 계획 조회 시 BOM/재고/PO 조회 0회")

    // E 권한 없음 → DB 0
    const f3 = makeDb(planWorld())
    await assert.rejects(executeRunMrpRequest({ authorize: denied, db: f3.db }, "planA"), /ROLE_PERMISSION_DENIED/)
    passed += 1
    console.log("PASS E 권한 없는 사용자 runMRP 차단")
    eq(f3.reads.length, 0, "E 권한 거부 시 DB 조회 0회")
  }

  section("M2 — createPurchaseOrdersFromMRP")
  const poWorld = (): Record<string, Row[]> => ({
    item: [
      { id: "rawA1", tenantId: A },
      { id: "rawA2", tenantId: A },
      { id: "rawB1", tenantId: B },
    ],
    // 다른 tenant 의 공급사/사이트가 먼저 오도록 배치
    businessPartner: [
      { id: "supB", tenantId: B, partnerType: "SUPPLIER" },
      { id: "supA", tenantId: A, partnerType: "SUPPLIER" },
    ],
    site: [
      { id: "siteB", tenantId: B },
      { id: "siteA", tenantId: A },
    ],
    purchaseOrder: [],
  })
  const call = (f: ReturnType<typeof makeDb>, items: any[], siteId: string, authorize = authA) =>
    createPurchaseOrdersFromMrp({ authorize, db: f.db as MrpPurchaseDb, nowMs: () => 1_700_000_000_000 }, items, siteId)
  {
    const f = makeDb(poWorld())
    const r = await call(f, [{ itemId: "rawA1", qty: 5 }, { itemId: "rawA2", qty: 2 }], "siteA")
    eq([r.success, r.orderNo], [true, "PO-MRP-1700000000000"], "G 정상: 발주 생성 성공")
    eq(f.writes.length, 1, "G 쓰기는 PurchaseOrder 1건")
    const d = f.writes[0].data
    eq([d.tenantId, d.supplierId, d.siteId, d.status], [A, "supA", "siteA", "DRAFT"], "G Tenant A 의 공급사/사이트 사용, DRAFT")
    eq(d.items.create.map((i: any) => [i.itemId, i.qty, i.unitPrice]), [["rawA1", 5, 0], ["rawA2", 2, 0]], "G 품목/수량 기존과 동일(단가 0)")
    eq(f.reads.filter((q) => q.model === "item").length, 1, "품목 소유 검증은 배치 1회(N+1 없음)")
  }
  {
    const f = makeDb(poWorld())
    const r = await call(f, [{ itemId: "rawB1", qty: 5 }], "siteA")
    eq(r.success, false, "C 타 tenant 품목으로 발주 → 실패")
    eq(f.writes.length, 0, "C DB 쓰기 0건")
    ok(!JSON.stringify(r).includes("rawB1") && !JSON.stringify(r).includes(B), "C 오류에 타 tenant 식별 정보 없음")
  }
  {
    const f = makeDb(poWorld())
    const r = await call(f, [{ itemId: "rawA1", qty: 1 }, { itemId: "rawB1", qty: 1 }], "siteA")
    eq([r.success, f.writes.length], [false, 0], "C 정상 품목+타 tenant 품목 혼합 → 전체 실패(쓰기 0)")
  }
  {
    const f = makeDb(poWorld())
    const r = await call(f, [{ itemId: "rawA1", qty: 1 }], "siteB")
    eq([r.success, f.writes.length], [false, 0], "C 타 tenant 사이트 지정 → 명시적 실패, 첫 사이트로 대체하지 않음, 쓰기 0")
  }
  {
    // Tenant A 에 공급사가 없고 B 에만 있다: B 공급사로 발주되면 안 된다
    const w = poWorld()
    w.businessPartner = [{ id: "supB", tenantId: B, partnerType: "SUPPLIER" }]
    const f = makeDb(w)
    const r = await call(f, [{ itemId: "rawA1", qty: 1 }], "siteA")
    eq([r.success, r.error, f.writes.length], [false, "등록된 공급사가 없습니다.", 0], "C 타 tenant 공급사는 사용 불가(쓰기 0)")
  }
  {
    const f = makeDb(poWorld())
    const r = await call(f, [{ itemId: "rawA1", qty: -3 }], "siteA")
    eq([r.success, f.writes.length], [false, 0], "수량 오류 입력 → 실패(쓰기 0)")
    const e = await call(makeDb(poWorld()), [], "siteA")
    eq(e.error, "발주할 자재가 없습니다.", "빈 목록 메시지 유지")
  }
  {
    const f = makeDb(poWorld())
    await assert.rejects(call(f, [{ itemId: "rawA1", qty: 1 }], "siteA", denied), /ROLE_PERMISSION_DENIED/)
    passed += 1
    console.log("PASS F 권한 없는 사용자 PO 생성 차단")
    eq([f.reads.length, f.writes.length], [0, 0], "F 권한 거부 시 DB 조회 0 / 쓰기 0")
  }
  {
    // D: 클라이언트 tenantId 위조 — 코어는 tenantId 입력 자체가 없고, 액션은 두 번째 인자를 무시한다
    const src = readFileSync(join(process.cwd(), "src/lib/actions/mrp.actions.ts"), "utf8")
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    ok(/_tenantId:\s*string \| undefined/.test(noComments), "D 액션의 tenantId 인자는 _tenantId(무시) 로만 존재")
    ok(!/[^_]tenantId\b(?!:)/.test(noComments.replace(/user\.tenantId/g, "")), "D 액션 본문에서 클라이언트 tenantId 를 참조하지 않음")
    ok(!/getTenantId/.test(noComments), "D mrp.actions 가 쿠키 기반 getTenantId 에 의존하지 않음")
    ok(/requireResourcePermission\("MRP", "CREATE"\)/.test(noComments) && /requireResourcePermission\("PURCHASE_ORDER", "CREATE"\)/.test(noComments), "발주 생성은 MRP CREATE + PURCHASE_ORDER CREATE 권한 필요")
    ok(/requireResourcePermission\("MRP", "READ"\)/.test(noComments), "조회/계산은 MRP READ 권한 필요")
    const f = makeDb(poWorld())
    const r = await call(f, [{ itemId: "rawA1", qty: 1 }], "siteA")
    eq(f.writes[0].data.tenantId, A, "D 어떤 경우에도 쓰기 tenant = 인증 tenant")
    ok(r.success, "D 정상 처리")
  }

  section("M3 — importValidatedBoms")
  const bomWorld = (): Record<string, Row[]> => ({
    item: [
      { id: "iA1", tenantId: A, code: "FG-A" },
      { id: "iA2", tenantId: A, code: "RAW-A" },
      { id: "iA3", tenantId: A, code: "RAW-A3" },
      { id: "iB1", tenantId: B, code: "FG-B" },
      { id: "iB2", tenantId: B, code: "RAW-B" },
    ],
    bOM: [],
    auditLog: [],
  })
  const authActor = async () => ({ id: "profile-A", name: "작업자A", tenantId: A })
  const group = (over: Partial<BomImportGroup> = {}): BomImportGroup => ({
    key: "FG-A@1",
    parentCode: "FG-A",
    parentItemId: "iA1",
    version: "1",
    status: "ACTIVE",
    items: [{ componentItemId: "iA2", seq: 1, qtyPer: 2, scrapRate: 0 }],
    ...over,
  })
  const imp = (f: ReturnType<typeof makeDb>, groups: BomImportGroup[], authorize = authActor) =>
    importBomGroups({ authorize, db: f.db as BomImportDb }, groups)
  {
    const f = makeDb(bomWorld())
    const r = await imp(f, [group()])
    eq(r, { success: true, importedBomCount: 1, importedItemCount: 1, defaultAssignedCount: 1 }, "G 정상 import 성공 + M4 Default 지정")
    const create = f.writes.find((w) => w.model === "bOM")!
    eq([create.data.tenantId, create.data.itemId, create.data.isDefault], [A, "iA1", true], "G Tenant A 로 BOM 생성, Default")
    ok(f.writes.some((w) => w.model === "auditLog" && w.data.tenantId === A), "G AuditLog 기록 유지")
    eq(f.reads.filter((q) => q.model === "item").length, 1, "품목 소유 검증은 배치 1회")
    eq(f.reads.find((q) => q.model === "item")!.where, { tenantId: A, id: { in: ["iA1", "iA2"] } }, "검증 쿼리 = tenant + id in (부모·구성품 전체)")
  }
  {
    const f = makeDb(bomWorld())
    const r = await imp(f, [group({ parentItemId: "iB1", parentCode: "FG-B", key: "FG-B@1" })])
    eq([r.success, f.writes.length], [false, 0], "A 타 tenant parent itemId → 실패, 쓰기 0")
    ok(!JSON.stringify(r).includes("iB1") && !JSON.stringify(r).includes("FG-B"), "A 오류에 타 tenant 식별 정보 없음")
    eq((r as any).error, IMPORT_TENANT_MISMATCH_MESSAGE, "A 일반화된 오류(IMPORT_TENANT_MISMATCH)")
  }
  {
    const f = makeDb(bomWorld())
    const r = await imp(f, [group({ items: [{ componentItemId: "iB2", seq: 1, qtyPer: 1, scrapRate: 0 }] })])
    eq([r.success, f.writes.length], [false, 0], "B 타 tenant componentItemId → 실패, 쓰기 0")
  }
  {
    const f = makeDb(bomWorld())
    const r = await imp(f, [
      group(),
      group({ key: "FG-A@2", version: "2", items: [{ componentItemId: "iB2", seq: 1, qtyPer: 1, scrapRate: 0 }] }),
    ])
    eq([r.success, f.writes.length], [false, 0], "B 일부 그룹만 위조 → 전체 중단, 부분 Import 없음")
  }
  {
    const f = makeDb(bomWorld())
    const r = await imp(f, [group({ items: [{ componentItemId: "no-such-id", seq: 1, qtyPer: 1, scrapRate: 0 }] })])
    eq([r.success, (r as any).error], [false, IMPORT_TENANT_MISMATCH_MESSAGE], "존재하지 않는 ID 와 타 tenant ID 의 오류가 동일")
  }
  {
    // 클라이언트 key 위조로 기존 BOM 충돌 검사를 우회할 수 없다(서버 키 = Item.code@version)
    const w = bomWorld()
    w.bOM = [{ id: "ex1", tenantId: A, itemId: "iA1", version: "1", status: "ACTIVE", isDefault: true }]
    const f = makeDb(w)
    const r = await imp(f, [group({ key: "FORGED@999" })])
    eq(r.success, false, "클라이언트 key 위조로 충돌 검사를 우회할 수 없음")
    ok(/이미 등록된 BOM/.test((r as any).error), "서버 기준 충돌 메시지")
    eq(f.writes.length, 0, "충돌 시 쓰기 0")
  }
  {
    // M4 유지: 기존 ACTIVE Default 가 있으면 새 BOM 은 Default 아님
    const w = bomWorld()
    w.bOM = [{ id: "ex1", tenantId: A, itemId: "iA1", version: "1", status: "ACTIVE", isDefault: true }]
    const f = makeDb(w)
    const r = await imp(f, [group({ key: "FG-A@2", version: "2" })])
    eq([r.success, (r as any).defaultAssignedCount], [true, 0], "M4 유지: 기존 Default 있으면 중복 Default 미생성")
    eq(f.writes.find((x) => x.model === "bOM")!.data.isDefault, false, "M4 isDefault=false 기록")
  }
  {
    const f = makeDb(bomWorld())
    await assert.rejects(imp(f, [group()], denied as any), /ROLE_PERMISSION_DENIED/)
    passed += 1
    console.log("PASS 권한 없는 사용자 import 차단")
    eq([f.reads.length, f.writes.length], [0, 0], "권한 거부 시 DB 조회/쓰기 0")
  }
  {
    const src = readFileSync(join(process.cwd(), "src/lib/actions/bom-excel.actions.ts"), "utf8")
    ok(/importBomGroups\(/.test(src) && /requireRole\("OPERATOR"\)/.test(src) && /requireResourcePermission\("BOM", "CREATE"\)/.test(src), "액션: 서비스 위임 + OPERATOR 역할 + BOM CREATE 권한")
    const fn = src.slice(src.indexOf("export async function importValidatedBoms"), src.indexOf("export async function getBomExportData"))
    ok(!/getTenantId/.test(fn), "importValidatedBoms 가 쿠키 기반 getTenantId 대신 인증 사용자 tenant 사용")
  }

  console.log(`\n✅ mrp-security: ${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
