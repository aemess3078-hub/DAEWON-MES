/**
 * ItemSupplier(품목별 공급업체) 서비스 테스트 (fake DB 주입 · 실제 DB 접속/쓰기 없음)
 *
 * 실행: npm run test:item-supplier
 *
 *  IS1 정상 추가            IS2 같은 item+supplier 중복 차단     IS3 customer-only 차단
 *  IS4 타 tenant item 차단  IS5 타 tenant supplier 차단          IS6 default 1개 보장
 *  IS7 default 변경 시 기존 해제  IS8 default 비활성 시 default 해제  IS9 priority
 *  IS10 leadTimeDays 검증   IS11 MOQ 검증   IS12 orderMultiple 검증
 *  IS13 inactive relation   IS14 권한 없음 → DB write 0          IS15 batch 조회 N+1 없음
 *  + 동시성 충돌 매핑, 트랜잭션 롤백, 타 tenant relation 접근, 단가 읽기 전용, 후보 검색
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  createItemSupplier,
  getDefaultSuppliersForItems,
  getSupplierPoliciesForItems,
  ITEM_SUPPLIER_ERROR_MESSAGES,
  isValidLeadTimeDays,
  isValidPositiveDecimal,
  isValidPriority,
  listItemSuppliers,
  loadSupplierPolicies,
  removeItemSupplier,
  searchSupplierCandidates,
  setDefaultItemSupplier,
  setItemSupplierActive,
  updateItemSupplier,
  type ItemSupplierDb,
} from "../src/lib/services/item-supplier.service"
import { makeFakeMasterDb } from "./helpers/fake-master-db"

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

const A = { id: "user-a", name: "A 사용자", tenantId: "tenant-A" }
const authorize = async () => A
const readAuthorize = async () => ({ tenantId: "tenant-A" })

function seed(extra?: { itemSupplier?: Record<string, any>[]; itemPrice?: Record<string, any>[] }) {
  const f = makeFakeMasterDb({
    item: [
      { id: "item-1", tenantId: "tenant-A", code: "RM-001", name: "원자재 1" },
      { id: "item-2", tenantId: "tenant-A", code: "RM-002", name: "원자재 2" },
      { id: "item-3", tenantId: "tenant-A", code: "RM-003", name: "원자재 3" },
      { id: "item-B1", tenantId: "tenant-B", code: "RM-B1", name: "B 원자재" },
    ],
    businessPartner: [
      { id: "sup-1", tenantId: "tenant-A", code: "S001", name: "가나 공급", partnerType: "SUPPLIER", status: "ACTIVE" },
      { id: "sup-2", tenantId: "tenant-A", code: "S002", name: "다라 상사", partnerType: "BOTH", status: "ACTIVE" },
      { id: "sup-3", tenantId: "tenant-A", code: "S003", name: "마바 금속", partnerType: "SUPPLIER", status: "ACTIVE" },
      { id: "cust-1", tenantId: "tenant-A", code: "C001", name: "고객사", partnerType: "CUSTOMER", status: "ACTIVE" },
      { id: "sup-off", tenantId: "tenant-A", code: "S900", name: "폐업 공급", partnerType: "SUPPLIER", status: "INACTIVE" },
      { id: "sup-B1", tenantId: "tenant-B", code: "SB1", name: "B 공급", partnerType: "SUPPLIER", status: "ACTIVE" },
    ],
    itemSupplier: extra?.itemSupplier ?? [],
    itemPrice: extra?.itemPrice ?? [],
  })
  return f
}
function deps(f: ReturnType<typeof seed>) {
  return { authorize, db: f.db as ItemSupplierDb }
}
function rel(over: Record<string, any>) {
  return {
    id: "rel-x",
    tenantId: "tenant-A",
    itemId: "item-1",
    supplierId: "sup-1",
    isDefault: false,
    priority: 100,
    leadTimeDays: null,
    moq: null,
    orderMultiple: null,
    isActive: true,
    ...over,
  }
}
function activeDefaults(f: ReturnType<typeof seed>, itemId: string) {
  return f.tables.itemSupplier.filter((r) => r.itemId === itemId && r.isDefault && r.isActive)
}

async function main() {
  // ───────────────────────────────────────────────────────────────────────────
  section("IS1 정상 supplier 추가")
  {
    const f = seed()
    const r = await createItemSupplier(deps(f), "item-1", {
      supplierId: "sup-1", isDefault: true, priority: 10, leadTimeDays: 7, moq: 100, orderMultiple: 50,
    })
    ok(r.success, "IS1 created")
    const row = f.tables.itemSupplier[0]
    eq(
      [row.tenantId, row.itemId, row.supplierId, row.isDefault, row.isActive, row.priority, row.leadTimeDays, row.moq, row.orderMultiple],
      ["tenant-A", "item-1", "sup-1", true, true, 10, 7, 100, 50],
      "IS1 stored values"
    )
    eq(f.tables.auditLog.length, 1, "IS1 audit written")
    eq(f.tables.auditLog[0].entityType, "ItemSupplier", "IS1 audit entityType")
    eq(f.tables.auditLog[0].action, "CREATE", "IS1 audit action")

    // BOTH 도 공급업체 자격이 있다 + 미설정 값은 null/기본 priority
    const r2 = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-2" })
    ok(r2.success, "IS1 BOTH partner accepted")
    const row2 = f.tables.itemSupplier[1]
    eq([row2.priority, row2.leadTimeDays, row2.moq, row2.orderMultiple, row2.isDefault], [100, null, null, null, false], "IS1 defaults: priority 100, 나머지 null(미설정), default 아님")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IS2 같은 item+supplier 중복 차단")
  {
    const f = seed({ itemSupplier: [rel({ id: "rel-1" })] })
    const r = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-1" })
    ok(!r.success && r.code === "DUPLICATE_SUPPLIER", "IS2 duplicate rejected")
    eq(f.tables.itemSupplier.length, 1, "IS2 no extra row")
    ok(r.success === false && r.error === ITEM_SUPPLIER_ERROR_MESSAGES.DUPLICATE_SUPPLIER, "IS2 business message (not raw DB error)")
    // 같은 supplier 를 다른 품목에는 등록할 수 있다
    const r2 = await createItemSupplier(deps(f), "item-2", { supplierId: "sup-1" })
    ok(r2.success, "IS2 same supplier on another item OK")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IS3 customer-only partner 차단 (+ 비활성 거래처)")
  {
    const f = seed()
    const r = await createItemSupplier(deps(f), "item-1", { supplierId: "cust-1" })
    ok(!r.success && r.code === "SUPPLIER_NOT_ELIGIBLE", "IS3 CUSTOMER rejected")
    const r2 = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-off" })
    ok(!r2.success && r2.code === "SUPPLIER_INACTIVE", "IS3 INACTIVE partner rejected")
    eq(f.countWrites("itemSupplier"), 0, "IS3 no writes")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IS4 타 tenant item 차단")
  {
    const f = seed()
    const r = await createItemSupplier(deps(f), "item-B1", { supplierId: "sup-1" })
    ok(!r.success && r.code === "INVALID_REFERENCE", "IS4 foreign item rejected (generic)")
    const nope = await createItemSupplier(deps(f), "no-such-item", { supplierId: "sup-1" })
    ok(!nope.success && nope.code === "INVALID_REFERENCE" && nope.error === (r as any).error, "IS4 nonexistent → identical response")
    eq(f.countWrites(), 0, "IS4 no writes (audit 포함)")
    const list = await listItemSuppliers({ authorize: readAuthorize, db: f.db as ItemSupplierDb }, "item-B1")
    ok(!list.success && list.code === "INVALID_REFERENCE", "IS4 list foreign item rejected")
    const cand = await searchSupplierCandidates({ authorize: readAuthorize, db: f.db as ItemSupplierDb }, "item-B1", "")
    ok(!cand.success && cand.code === "INVALID_REFERENCE", "IS4 candidate search foreign item rejected")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IS5 타 tenant supplier 차단")
  {
    const f = seed()
    const r = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-B1" })
    ok(!r.success && r.code === "INVALID_REFERENCE", "IS5 foreign supplier rejected (generic, 존재 여부 비노출)")
    eq(f.countWrites(), 0, "IS5 no writes")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IS6 default 1개 보장")
  {
    const f = seed()
    await createItemSupplier(deps(f), "item-1", { supplierId: "sup-1", isDefault: true })
    await createItemSupplier(deps(f), "item-1", { supplierId: "sup-2", isDefault: true })
    await createItemSupplier(deps(f), "item-1", { supplierId: "sup-3" })
    eq(activeDefaults(f, "item-1").map((r) => r.supplierId), ["sup-2"], "IS6 exactly one active default (latest)")
    // 다른 품목의 default 는 독립
    await createItemSupplier(deps(f), "item-2", { supplierId: "sup-1", isDefault: true })
    eq(activeDefaults(f, "item-2").length, 1, "IS6 other item has its own default")
    eq(activeDefaults(f, "item-1").length, 1, "IS6 item-1 still exactly one")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IS7 default 변경 시 기존 default 해제")
  {
    const f = seed({
      itemSupplier: [
        rel({ id: "r1", supplierId: "sup-1", isDefault: true, priority: 1 }),
        rel({ id: "r2", supplierId: "sup-2", isDefault: false, priority: 2 }),
      ],
    })
    const r = await setDefaultItemSupplier(deps(f), "r2")
    ok(r.success, "IS7 set default succeeded (no unique error surfaced)")
    eq(f.tables.itemSupplier.find((x) => x.id === "r1")!.isDefault, false, "IS7 previous default cleared")
    eq(f.tables.itemSupplier.find((x) => x.id === "r2")!.isDefault, true, "IS7 new default set")
    eq(activeDefaults(f, "item-1").length, 1, "IS7 one default")
    const again = await setDefaultItemSupplier(deps(f), "r2")
    ok(again.success, "IS7 idempotent")
    eq(f.tables.auditLog.some((l) => l.action === "UPDATE"), true, "IS7 audit UPDATE")

    // 비활성 관계 / 비활성 거래처는 기본이 될 수 없다
    const g = seed({
      itemSupplier: [
        rel({ id: "r1", supplierId: "sup-1", isDefault: true }),
        rel({ id: "r3", supplierId: "sup-3", isActive: false }),
        rel({ id: "r4", supplierId: "sup-off", itemId: "item-1" }),
      ],
    })
    const bad = await setDefaultItemSupplier(deps(g), "r3")
    ok(!bad.success && bad.code === "SUPPLIER_INACTIVE", "IS7 inactive relation cannot become default")
    const bad2 = await setDefaultItemSupplier(deps(g), "r4")
    ok(!bad2.success && bad2.code === "SUPPLIER_INACTIVE", "IS7 inactive partner cannot become default")
    eq(activeDefaults(g, "item-1").map((r) => r.id), ["r1"], "IS7 default unchanged after rejection")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IS8 default 비활성 시 default 해제")
  {
    const f = seed({ itemSupplier: [rel({ id: "r1", isDefault: true }), rel({ id: "r2", supplierId: "sup-2" })] })
    const r = await setItemSupplierActive(deps(f), "r1", false)
    ok(r.success, "IS8 deactivated")
    const row = f.tables.itemSupplier.find((x) => x.id === "r1")!
    eq([row.isActive, row.isDefault], [false, false], "IS8 inactive relation keeps no default flag")
    eq(activeDefaults(f, "item-1").length, 0, "IS8 no default now")
    // 재활성화해도 default 로 자동 복원하지 않는다
    const re = await setItemSupplierActive(deps(f), "r1", true)
    ok(re.success, "IS8 reactivated")
    eq(f.tables.itemSupplier.find((x) => x.id === "r1")!.isDefault, false, "IS8 reactivation does not restore default")
    // 비활성 관계에 대해 update 로 isDefault=true 요청 → 거부
    await setItemSupplierActive(deps(f), "r2", false)
    const bad = await updateItemSupplier(deps(f), "r2", { isDefault: true })
    ok(!bad.success, "IS8 cannot set default via update on inactive relation")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IS9 priority")
  {
    const f = seed()
    const none = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-1" })
    ok(none.success, "IS9 default priority create")
    eq(f.tables.itemSupplier[0].priority, 100, "IS9 default priority 100")
    for (const bad of [-1, 1.5, 10000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-2", priority: bad })
      ok(!r.success && r.code === "INVALID_INPUT", `IS9 invalid priority ${bad} rejected`)
    }
    const zero = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-2", priority: 0 })
    ok(zero.success, "IS9 priority 0 allowed (highest)")
    const up = await updateItemSupplier(deps(f), f.tables.itemSupplier[0].id, { priority: 5 })
    ok(up.success, "IS9 priority update")
    eq(f.tables.itemSupplier[0].priority, 5, "IS9 updated")
    // 작을수록 우선: 목록/정책 정렬
    const list = await listItemSuppliers({ authorize: readAuthorize, db: f.db as ItemSupplierDb }, "item-1")
    ok(list.success && list.data.map((x) => x.priority).join() === "0,5", "IS9 sorted ascending by priority")
    ok(isValidPriority(0) && isValidPriority(9999) && !isValidPriority(10000), "IS9 validator bounds")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IS10 leadTimeDays validation")
  {
    const f = seed()
    for (const bad of [-1, 1.2, 3651, Number.NaN]) {
      const r = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-1", leadTimeDays: bad })
      ok(!r.success && r.code === "INVALID_INPUT", `IS10 invalid leadTimeDays ${bad}`)
    }
    const zero = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-1", leadTimeDays: 0 })
    ok(zero.success && f.tables.itemSupplier[0].leadTimeDays === 0, "IS10 0 allowed (당일) and stored as 0")
    const cleared = await updateItemSupplier(deps(f), f.tables.itemSupplier[0].id, { leadTimeDays: null })
    ok(cleared.success && f.tables.itemSupplier[0].leadTimeDays === null, "IS10 null = 미설정")
    ok(isValidLeadTimeDays(0) && isValidLeadTimeDays(3650) && !isValidLeadTimeDays(-1), "IS10 validator")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IS11 MOQ validation")
  {
    const f = seed()
    for (const bad of [0, -5, Number.NaN, 1e12, 0.0000001]) {
      const r = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-1", moq: bad })
      ok(!r.success && r.code === "INVALID_INPUT", `IS11 invalid moq ${bad}`)
    }
    const good = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-1", moq: 12.5 })
    ok(good.success && f.tables.itemSupplier[0].moq === 12.5, "IS11 decimal MOQ accepted")
    const cleared = await updateItemSupplier(deps(f), f.tables.itemSupplier[0].id, { moq: null })
    ok(cleared.success && f.tables.itemSupplier[0].moq === null, "IS11 null clears")
    ok(isValidPositiveDecimal(0.000001) && !isValidPositiveDecimal(0), "IS11 validator")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IS12 orderMultiple validation")
  {
    const f = seed()
    for (const bad of [0, -1, Number.POSITIVE_INFINITY]) {
      const r = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-1", orderMultiple: bad })
      ok(!r.success && r.code === "INVALID_INPUT", `IS12 invalid orderMultiple ${bad}`)
    }
    const good = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-1", orderMultiple: 50 })
    ok(good.success && f.tables.itemSupplier[0].orderMultiple === 50, "IS12 accepted")
    const bad = await updateItemSupplier(deps(f), f.tables.itemSupplier[0].id, { orderMultiple: 0 })
    ok(!bad.success && bad.code === "INVALID_INPUT", "IS12 update 0 rejected (미설정은 null)")
    eq(f.tables.itemSupplier[0].orderMultiple, 50, "IS12 value unchanged after rejection")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IS13 inactive relation")
  {
    const f = seed({
      itemSupplier: [
        rel({ id: "r1", supplierId: "sup-1", isDefault: true, priority: 1 }),
        rel({ id: "r2", supplierId: "sup-2", isActive: false, priority: 0 }),
      ],
    })
    const policies = await loadSupplierPolicies(f.db, "tenant-A", ["item-1"])
    const p = policies.get("item-1")!
    eq(p.suppliers.map((s) => s.relationId), ["r1"], "IS13 inactive relation excluded from MRP policy")
    eq(p.defaultSupplier?.supplierId, "sup-1", "IS13 default supplier resolved")
    // 비활성 거래처(관계는 활성)도 정책에서 제외
    const g = seed({ itemSupplier: [rel({ id: "r9", supplierId: "sup-off", isDefault: true })] })
    const gp = await loadSupplierPolicies(g.db, "tenant-A", ["item-1"])
    eq(gp.get("item-1")!.suppliers.length, 0, "IS13 inactive partner excluded from policy")
    // 목록에는 비활성도 보이되 활성 먼저
    const list = await listItemSuppliers({ authorize: readAuthorize, db: f.db as ItemSupplierDb }, "item-1")
    ok(list.success && list.data.map((x) => x.id).join() === "r1,r2", "IS13 list shows inactive last")
    // 비활성화 대상이 자기 tenant 가 아니면 거부
    const foreign = seed({ itemSupplier: [rel({ id: "rB", tenantId: "tenant-B", itemId: "item-B1", supplierId: "sup-B1" })] })
    const r = await setItemSupplierActive(deps(foreign), "rB", false)
    ok(!r.success && r.code === "INVALID_REFERENCE", "IS13 foreign relation deactivate rejected")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IS14 권한 없음 → DB read/write 0")
  {
    const f = seed({ itemSupplier: [rel({ id: "r1" })] })
    const denied = async () => {
      throw new Error("이 기능을 사용할 권한이 없습니다.")
    }
    const dd = { authorize: denied, db: f.db as ItemSupplierDb }
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ["create", () => createItemSupplier(dd, "item-1", { supplierId: "sup-2" })],
      ["update", () => updateItemSupplier(dd, "r1", { priority: 1 })],
      ["setDefault", () => setDefaultItemSupplier(dd, "r1")],
      ["setActive", () => setItemSupplierActive(dd, "r1", false)],
      ["remove", () => removeItemSupplier(dd, "r1")],
      ["list", () => listItemSuppliers(dd, "item-1")],
      ["candidates", () => searchSupplierCandidates(dd, "item-1", "")],
      ["policies", () => getSupplierPoliciesForItems(dd, ["item-1"])],
    ]
    for (const [name, fn] of attempts) {
      await assert.rejects(fn, /권한/, `IS14 ${name} throws`)
      passed += 1
      console.log(`PASS IS14 ${name} rejected before any DB access`)
    }
    eq(f.countReads() + f.countWrites(), 0, "IS14 no DB access at all")
    eq(f.tables.itemSupplier.length, 1, "IS14 data unchanged")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IS15 batch supplier lookup → N+1 없음")
  {
    const items = Array.from({ length: 300 }, (_, i) => ({ id: `bi-${i}`, tenantId: "tenant-A", code: `B${i}`, name: `n${i}` }))
    const rels = items.flatMap((it, i) => [
      rel({ id: `d-${i}`, itemId: it.id, supplierId: "sup-1", isDefault: true, priority: 1, leadTimeDays: 7, moq: 10, orderMultiple: 5 }),
      rel({ id: `s-${i}`, itemId: it.id, supplierId: "sup-2", priority: 2 }),
    ])
    const f = makeFakeMasterDb({
      item: items,
      businessPartner: [
        { id: "sup-1", tenantId: "tenant-A", code: "S001", name: "가나", partnerType: "SUPPLIER", status: "ACTIVE" },
        { id: "sup-2", tenantId: "tenant-A", code: "S002", name: "다라", partnerType: "BOTH", status: "ACTIVE" },
      ],
      itemSupplier: rels,
    })
    f.resetStats()
    const map = await loadSupplierPolicies(f.db, "tenant-A", items.map((i) => i.id))
    eq(f.countReads(), 1, "IS15 300 items → 1 query")
    eq(map.size, 300, "IS15 every item has a policy entry")
    const p = map.get("bi-7")!
    eq(
      [p.defaultSupplier?.supplierId, p.defaultSupplier?.leadTimeDays, p.defaultSupplier?.moq, p.defaultSupplier?.orderMultiple, p.suppliers.length],
      ["sup-1", 7, 10, 5, 2],
      "IS15 policy content"
    )
    f.resetStats()
    const small = await loadSupplierPolicies(f.db, "tenant-A", ["bi-1", "bi-1", "unknown"])
    eq(f.countReads(), 1, "IS15 3 ids (dup) → still 1 query")
    eq(small.get("unknown")!.defaultSupplier, null, "IS15 item without relation → empty policy")
    f.resetStats()
    const empty = await loadSupplierPolicies(f.db, "tenant-A", [])
    eq([empty.size, f.countReads()], [0, 0], "IS15 empty input → 0 queries")
    // 인증 래퍼 / 기본 공급업체 map
    f.resetStats()
    const viaAuth = await getSupplierPoliciesForItems({ authorize: readAuthorize, db: f.db as ItemSupplierDb }, ["bi-1", "bi-2"])
    ok(viaAuth.success && viaAuth.data.length === 2, "IS15 authorized wrapper")
    const defaults = await getDefaultSuppliersForItems(f.db, "tenant-A", ["bi-1", "bi-2"])
    eq([defaults.get("bi-1")?.supplierId, defaults.get("bi-2")?.supplierName], ["sup-1", "가나"], "IS15 default supplier map")
    // 타 tenant 관계는 조회되지 않는다
    const cross = await loadSupplierPolicies(f.db, "tenant-B", ["bi-1"])
    eq(cross.get("bi-1")!.suppliers.length, 0, "IS15 other tenant sees nothing")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("추가: 타 tenant relation / 롤백 / 동시성 / 후보 / 단가 / 삭제")
  {
    // 타 tenant relation update / remove
    const f = seed({ itemSupplier: [rel({ id: "rB", tenantId: "tenant-B", itemId: "item-B1", supplierId: "sup-B1", priority: 5 })] })
    const u = await updateItemSupplier(deps(f), "rB", { priority: 1 })
    ok(!u.success && u.code === "INVALID_REFERENCE", "foreign relation update rejected")
    const d = await removeItemSupplier(deps(f), "rB")
    ok(!d.success && d.code === "INVALID_REFERENCE", "foreign relation remove rejected")
    eq([f.tables.itemSupplier.length, f.tables.itemSupplier[0].priority, f.countWrites()], [1, 5, 0], "foreign relation untouched, 0 writes")
  }
  {
    // 감사로그 실패 → 트랜잭션 롤백(관계가 남지 않는다)
    const f = seed()
    f.failNext.auditLog = true
    const r = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-1", isDefault: true })
    ok(!r.success && r.code === "FAILED", "audit failure → generic FAILED (no raw error)")
    eq(f.tables.itemSupplier.length, 0, "rollback: relation not persisted")
  }
  {
    // 기존 default 해제 후 신규 default 생성 중 실패해도 기존 default 가 유지된다(원자성)
    const f = seed({ itemSupplier: [rel({ id: "r1", supplierId: "sup-1", isDefault: true })] })
    f.failNext.auditLog = true
    const r = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-2", isDefault: true })
    ok(!r.success, "failure during default swap")
    eq(activeDefaults(f, "item-1").map((x) => x.id), ["r1"], "rollback: previous default preserved")
  }
  {
    // DB 제약(P2002) 충돌은 업무 오류(CONFLICT)로 변환되고 raw 메시지를 노출하지 않는다
    const f = seed()
    const original = f.db.itemSupplier.create
    f.db.itemSupplier.create = async () => {
      throw Object.assign(new Error('Unique constraint failed on the fields: ("tenantId","itemId")'), { code: "P2002" })
    }
    const r = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-1", isDefault: true })
    f.db.itemSupplier.create = original
    ok(!r.success && r.code === "CONFLICT", "P2002 → CONFLICT")
    ok(!r.success && !/Unique constraint|tenantId/.test(r.error), "P2002 raw message hidden")
  }
  {
    // 후보 검색: SUPPLIER/BOTH + ACTIVE + 이미 등록된 것 제외 + 이름/코드 검색 + 상한
    const f = seed({ itemSupplier: [rel({ id: "r1", supplierId: "sup-1" })] })
    const dd = { authorize: readAuthorize, db: f.db as ItemSupplierDb }
    const all = await searchSupplierCandidates(dd, "item-1", "")
    ok(all.success && all.data.map((c) => c.id).sort().join() === "sup-2,sup-3", "candidates: eligible, active, not yet registered, own tenant")
    const byCode = await searchSupplierCandidates(dd, "item-1", "s003")
    ok(byCode.success && byCode.data.map((c) => c.id).join() === "sup-3", "candidates: code search (case-insensitive)")
    const byName = await searchSupplierCandidates(dd, "item-1", "다라")
    ok(byName.success && byName.data.map((c) => c.id).join() === "sup-2", "candidates: name search")
    // 다른 품목에서는 sup-1 도 후보
    const other = await searchSupplierCandidates(dd, "item-2", "")
    ok(other.success && other.data.some((c) => c.id === "sup-1"), "candidates: per-item exclusion only")
  }
  {
    // 현재 단가: ItemPrice(PURCHASE) 읽기 전용, includePrices=false 면 조회하지 않는다
    const today = new Date("2026-10-14T00:00:00Z")
    const f = seed({
      itemSupplier: [rel({ id: "r1", supplierId: "sup-1" }), rel({ id: "r2", supplierId: "sup-2" })],
      itemPrice: [
        { id: "p1", tenantId: "tenant-A", itemId: "item-1", partnerId: "sup-1", priceType: "PURCHASE", unitPrice: 100, currency: "KRW", effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
        { id: "p2", tenantId: "tenant-A", itemId: "item-1", partnerId: "sup-1", priceType: "PURCHASE", unitPrice: 120, currency: "KRW", effectiveFrom: new Date("2026-09-01"), effectiveTo: null },
        { id: "p3", tenantId: "tenant-A", itemId: "item-1", partnerId: "sup-2", priceType: "SALES", unitPrice: 999, currency: "KRW", effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
        { id: "p4", tenantId: "tenant-A", itemId: "item-1", partnerId: "sup-2", priceType: "PURCHASE", unitPrice: 50, currency: "KRW", effectiveFrom: new Date("2025-01-01"), effectiveTo: new Date("2025-12-31") },
      ],
    })
    f.resetStats()
    const noPrice = await listItemSuppliers({ authorize: readAuthorize, db: f.db as ItemSupplierDb, now: () => today }, "item-1")
    ok(noPrice.success && noPrice.data.every((v) => v.currentPrice === null), "prices hidden without ITEM_PRICE read")
    eq(f.countReads("itemPrice"), 0, "no ItemPrice query when not permitted")
    const withPrice = await listItemSuppliers({ authorize: readAuthorize, db: f.db as ItemSupplierDb, includePrices: true, now: () => today }, "item-1")
    ok(withPrice.success, "list with prices")
    if (withPrice.success) {
      const byId = new Map(withPrice.data.map((v) => [v.id, v]))
      eq(byId.get("r1")!.currentPrice, { unitPrice: 120, currency: "KRW", effectiveFrom: "2026-09-01" }, "latest effective PURCHASE price")
      eq(byId.get("r2")!.currentPrice, null, "expired / SALES prices ignored")
    }
    eq(f.countWrites(), 0, "listing never writes")
  }
  {
    // 삭제: 본인 tenant 관계만 / audit DELETE
    const f = seed({ itemSupplier: [rel({ id: "r1", isDefault: true })] })
    const r = await removeItemSupplier(deps(f), "r1")
    ok(r.success && f.tables.itemSupplier.length === 0, "remove own relation")
    eq(f.tables.auditLog.at(-1)!.action, "DELETE", "remove audit DELETE")
  }
  {
    // tenantId/actor 위조 입력은 무시된다
    const f = seed()
    const r = await createItemSupplier(deps(f), "item-1", { supplierId: "sup-1", tenantId: "tenant-B" } as any)
    ok(r.success && f.tables.itemSupplier[0].tenantId === "tenant-A", "client tenantId ignored")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("정적 점검: migration / schema / 액션 권한")
  {
    const root = join(__dirname, "..")
    const sql = readFileSync(join(root, "prisma", "migrations", "20261014000000_add_item_supplier", "migration.sql"), "utf8")
    ok(/CREATE TABLE "ItemSupplier"/.test(sql), "migration creates ItemSupplier")
    ok(/CREATE UNIQUE INDEX "ItemSupplier_tenantId_itemId_supplierId_key"/.test(sql), "migration: (tenant,item,supplier) unique")
    ok(
      /CREATE UNIQUE INDEX "ItemSupplier_one_active_default_per_item"[\s\S]*WHERE "isDefault" = true AND "isActive" = true/.test(sql),
      "migration: partial unique index for ACTIVE default"
    )
    ok(/ENABLE ROW LEVEL SECURITY/.test(sql), "migration: RLS enabled")
    ok(/REVOKE ALL ON TABLE public\."ItemSupplier"/.test(sql), "migration: revoke anon/authenticated")
    ok(!/DROP |TRUNCATE|DELETE FROM|ALTER TABLE "(?!ItemSupplier)/.test(sql), "migration is additive (no DROP/TRUNCATE/other tables)")
    const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8")
    ok(/model ItemSupplier \{/.test(schema), "schema has ItemSupplier")
    // 안전재고는 공급업체마다 다른 값이 아니므로 ItemSupplier 에 두지 않는다(Phase 5D 에서 Item.safetyStock 으로 추가됨)
    const supplierModel = /model ItemSupplier \{[\s\S]*?\n\}/.exec(schema.replace(/\r/g, ""))?.[0] ?? ""
    ok(supplierModel.length > 0 && !/^\s+safetyStock\s/m.test(supplierModel), "safetyStock 은 ItemSupplier 필드가 아니다")
    const actions = readFileSync(join(root, "src", "lib", "actions", "item-supplier.actions.ts"), "utf8")
    ok(/requireResourcePermission\("ITEM", "UPDATE"\)/.test(actions), "actions: mutations require ITEM UPDATE")
    ok(/requireResourcePermission\("ITEM", "DELETE"\)/.test(actions), "actions: physical delete requires ITEM DELETE")
    ok(/requireResourcePermission\("PARTNER_MANAGEMENT", "READ"\)/.test(actions), "actions: candidate search requires PARTNER_MANAGEMENT READ")
    ok(!/export async function \w+\([^)]*tenantId/.test(actions), "actions: exported functions take no tenantId parameter")
  }

  console.log(`\nALL PASS (${passed} checks)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
