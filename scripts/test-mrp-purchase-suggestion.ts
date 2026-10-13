/**
 * Phase 5C — MRP 구매 발주제안 / DRAFT PO 생성 / PO 채번 테스트 (fake DB 주입 · 실제 DB 접속/쓰기 없음)
 *
 * 실행: npm run test:mrp-purchase-suggestion
 *
 *  PS1~PS7  공급업체 추천(Default / 최저 priority / 동률 / 없음 / 비활성 / 자격 / 사용자 변경)
 *  PQ1~PQ5  제안수량(최종 부족 / 일시 결품 / peak > final / 수정 / 0·음수·NaN)
 *  PG1~PG4  공급업체별 그룹(2 PO / 가장 빠른 필요일 / 날짜 override / 공급업체 미지정)
 *  PN1~PN7  PO 채번(999 → 1000 / 혼재 numeric max / 동시 10 / 연속 확보 / tenant 독립 / 연도 / 문자열 정렬 비의존)
 *  PC1~PC10 DRAFT 생성(정상 / 다중 공급업체 / DRAFT / 날짜 / 소유 검증 / 롤백 / 감사 / 권한 / 타 tenant / 예정입고 비포함)
 *  + 쿼리 수(N+1 없음), 단가(같은 공급업체만), 정적 점검
 */
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { buildPurchaseSuggestionRows, recommendSupplier, type SupplierCandidateInput } from "../src/lib/mrp/purchase-suggestion"
import {
  createDraftPurchaseOrdersFromSuggestions,
  normalizeDraftPoInput,
  type MrpPurchaseDraftDb,
} from "../src/lib/services/mrp-purchase-draft.service"
import {
  executePurchaseSuggestionRequest,
  loadPurchaseSuggestions,
  type PurchaseSuggestionDb,
} from "../src/lib/services/mrp-purchase-suggestion.service"
import { loadAndRunOrderMrp } from "../src/lib/services/mrp-order.service"
import {
  allocatePurchaseOrderNumbers,
  formatPurchaseOrderNo,
  parsePurchaseOrderSequence,
} from "../src/lib/services/purchase-order-number.service"
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
// 데이터
// ═════════════════════════════════════════════════════════════════════════════

const T1 = "tenant-1"
const T2 = "tenant-2"
const NOW = () => new Date("2026-10-01T03:00:00Z") // KST 2026-10-01
const params = { from: null, to: null, includeDraft: false }

const supplier = (id: string, code: string, name: string, over: Partial<{ partnerType: string; status: string; tenantId: string }> = {}) => ({
  id,
  code,
  name,
  tenantId: over.tenantId ?? T1,
  partnerType: over.partnerType ?? "SUPPLIER",
  status: over.status ?? "ACTIVE",
})
const S1 = supplier("s1", "S001", "가나공급")
const S2 = supplier("s2", "S002", "다라상사", { partnerType: "BOTH" })
const S3 = supplier("s3", "S003", "마바금속", { status: "INACTIVE" })
const S4 = supplier("s4", "S004", "사아부품")
const C1 = supplier("c1", "C001", "고객사", { partnerType: "CUSTOMER" })
const SB = supplier("sB", "SB01", "타테넌트공급", { tenantId: T2 })

let relSeq = 1
const rel = (itemId: string, s: ReturnType<typeof supplier>, over: Partial<{ isDefault: boolean; priority: number; isActive: boolean; tenantId: string }> = {}) => ({
  id: "rel-" + relSeq++,
  tenantId: over.tenantId ?? T1,
  itemId,
  supplierId: s.id,
  isDefault: over.isDefault ?? false,
  priority: over.priority ?? 100,
  leadTimeDays: null,
  moq: null,
  orderMultiple: null,
  isActive: over.isActive ?? true,
  supplier: s,
})

const fg = { id: "fgA", code: "FG-A", name: "제품A", tenantId: T1 }
const comp = (code: string) => ({ code, name: code + " 자재", spec: code + " 규격", uom: "EA", itemType: "RAW_MATERIAL" })
const bomItem = (id: string, code: string, seq: number) => ({ componentItemId: id, seq, qtyPer: 1, scrapRate: 0, componentItem: comp(code) })
const bomA = (ids: Array<[string, string]>) => ({
  id: "b-a",
  tenantId: T1,
  itemId: "fgA",
  version: "1",
  status: "ACTIVE",
  isDefault: true,
  bomItems: ids.map(([id, code], i) => bomItem(id, code, i + 1)),
})
const soLine = (id: string, orderNo: string, qty: number, due: string) => ({
  id,
  qty,
  shippedQty: 0,
  deliveryDate: new Date(due + "T00:00:00Z"),
  itemId: "fgA",
  item: fg,
  salesOrder: { id: "so-" + id, tenantId: T1, orderNo, status: "CONFIRMED", deliveryDate: new Date("2026-12-31T00:00:00Z"), customer: { name: "고객사" } },
})
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
function poi(id: string, poNo: string, status: string, itemId: string, qty: number, recv: number, expected: string, supplierRow = S1) {
  const po = { id: "po-" + id, tenantId: T1, orderNo: poNo, status, expectedDate: new Date(expected + "T00:00:00Z"), note: null, supplier: { id: supplierRow.id, name: supplierRow.name } }
  return { id: "poi-" + id, purchaseOrderId: po.id, itemId, qty, receivedQty: recv, workOrderOperationId: null, item: { tenantId: T1 }, purchaseOrder: po }
}
const price = (itemId: string, supplierId: string, unitPrice: number, over: Partial<{ currency: string; from: string; to: string | null }> = {}) => ({
  id: `price-${itemId}-${supplierId}-${over.from ?? "x"}`,
  tenantId: T1,
  itemId,
  partnerId: supplierId,
  priceType: "PURCHASE",
  unitPrice,
  currency: over.currency ?? "KRW",
  effectiveFrom: new Date((over.from ?? "2026-01-01") + "T00:00:00Z"),
  effectiveTo: over.to === undefined ? null : over.to === null ? null : new Date(over.to + "T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
})

/** 기본 세계: R1(결품) R2(일시 결품) R3(최종 부족 + peak>final) R4(공급업체 없음) */
function world(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  const seededItems = [
    poi("a", "PO-2026-000100", "ORDERED", "r2", 30, 0, "2026-10-15"),
    poi("b", "PO-2026-000101", "ORDERED", "r3", 5, 0, "2026-10-20"),
    poi("d", "PO-2026-000102", "DRAFT", "r4", 40, 0, "2026-10-30"),
  ]
  return {
    salesOrderItem: [soLine("l1", "SO-1", 60, "2026-10-12")],
    bOM: [bomA([["r1", "R1"], ["r2", "R2"], ["r3", "R3"], ["r4", "R4"]])],
    inventoryBalance: [bal("r1", 0), bal("r2", 50), bal("r3", 50), bal("r4", 0)],
    purchaseOrder: seededItems.map((i) => ({ ...i.purchaseOrder })),
    purchaseOrderItem: seededItems,
    itemSupplier: [
      rel("r1", S1, { isDefault: true }),
      rel("r1", S2, { priority: 5 }),
      rel("r1", S3, { priority: 1 }), // 거래처 비활성
      rel("r1", S4, { priority: 1, isActive: false }), // 관계 비활성
      rel("r2", S1, { priority: 10 }),
      rel("r3", S1, { priority: 10 }),
      rel("r3", S2, { priority: 10 }),
      rel("r4", C1, { priority: 1 }), // 고객 전용(자격 없음)
      rel("r1", SB, { tenantId: T2 }), // 타 tenant
    ],
    itemPrice: [
      price("r1", "s1", 100),
      price("r1", "s2", 90),
      price("r1", "s1", 80, { from: "2025-01-01", to: "2025-12-31" }), // 만료
      price("r2", "s1", 7),
    ],
    site: [{ id: "site-1", tenantId: T1, name: "본사공장" }, { id: "site-T2", tenantId: T2, name: "타사공장" }],
    item: ["r1", "r2", "r3", "r4"].map((id) => ({ id, tenantId: T1, code: id.toUpperCase(), name: id.toUpperCase() + " 자재" })).concat([
      { id: "rB", tenantId: T2, code: "RB", name: "타사자재" },
    ]),
    businessPartner: [S1, S2, S3, S4, C1, SB],
    ...over,
  } as Record<string, Row[]>
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════
  section("PS 공급업체 추천 (순수)")
  {
    const cand = (id: string, priority: number, isDefault = false): SupplierCandidateInput => ({
      supplierId: id, supplierCode: id, supplierName: id, isDefault, priority, leadTimeDays: null, moq: null, orderMultiple: null,
    })
    eq(recommendSupplier([cand("a", 50), cand("b", 100, true)]), { supplierId: "b", reason: "DEFAULT" }, "PS1 Default 가 최우선(priority 가 더 낮은 후보보다 우선)")
    eq(recommendSupplier([cand("a", 20), cand("b", 10)]), { supplierId: "b", reason: "LOWEST_PRIORITY" }, "PS2 Default 없음 + 유일한 최저 priority → 추천")
    eq(recommendSupplier([cand("a", 10), cand("b", 10), cand("c", 30)]), { supplierId: null, reason: "AMBIGUOUS_PRIORITY" }, "PS3 최저 priority 동률 → 자동 선택 안 함")
    eq(recommendSupplier([]), { supplierId: null, reason: "NONE" }, "PS4 ItemSupplier 없음 → 미지정")
    eq(recommendSupplier([cand("a", 1, true), cand("b", 2, true)]).supplierId, null, "PS3b Default 중복(데이터 이상) → 자동 선택 안 함")
  }

  section("PS5~PS7 / PQ (서비스): 정책 + 제안량")
  {
    const f = makeFakeDb(world())
    const p = await loadPurchaseSuggestions(f.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: true })
    const byCode = new Map(p.rows.map((r) => [r.code, r]))
    eq(p.rows.map((r) => r.code), ["R1", "R3", "R4", "R2"], "최종 부족(필요일·코드순) 먼저, 일시 결품은 뒤")

    const r1 = byCode.get("R1")!
    eq([r1.kind, r1.suggestedQty, r1.peakShortageQty, r1.finalShortageQty, r1.requiredDate], ["FINAL_SHORTAGE", 60, 60, 60, "2026-10-12"], "PQ1 최종 부족 → 제안 생성(60, 필요 입고일 10/12)")
    eq([r1.recommendedSupplierId, r1.supplierReason], ["s1", "DEFAULT"], "PS1 서비스: Default 공급업체 추천")
    eq(r1.suppliers.map((s) => s.supplierId), ["s1", "s2"], "PS5/PS6 비활성 관계·비활성 거래처·타 tenant 후보 제외(기본 → priority 순)")
    eq(r1.suppliers.map((s) => s.price?.unitPrice ?? null), [100, 90], "단가: 공급업체별 현재 유효 단가(만료된 80 제외)")
    eq(r1.suppliers[0].price?.currency, "KRW", "단가 통화")

    const r2 = byCode.get("R2")!
    eq([r2.kind, r2.suggestedQty, r2.peakShortageQty, r2.shortageRecoveredAt, r2.nextReceiptDate], ["TEMPORARY_SHORTAGE", 0, 10, "2026-10-15", "2026-10-15"], "PQ2 일시 결품: 제안량 0 / 최대 10 / 10/15 입고로 해소")
    eq([r2.recommendedSupplierId, r2.supplierReason], ["s1", "LOWEST_PRIORITY"], "PS2 서비스: 유일한 최저 priority 추천")

    const r3 = byCode.get("R3")!
    eq([r3.kind, r3.peakShortageQty, r3.finalShortageQty, r3.suggestedQty], ["FINAL_SHORTAGE", 10, 5, 10], "PQ3 peak(10) > final(5): 제안량은 결품 방지 필요량(peak)")
    eq([r3.recommendedSupplierId, r3.supplierReason], [null, "AMBIGUOUS_PRIORITY"], "PS3 서비스: 동률 → 자동 선택 안 함")

    const r4 = byCode.get("R4")!
    eq([r4.supplierReason, r4.recommendedSupplierId, r4.suppliers.length], ["NONE", null, 0], "PS4/PS6 서비스: 공급업체 없음(고객 전용 거래처 제외)")
    eq(r4.draftOpenQty, 40, "DRAFT 발주 미입고는 참고 정보로만 표시")
    eq(p.summary, { finalShortageCount: 3, temporaryShortageCount: 1, noSupplierCount: 1, ambiguousSupplierCount: 1 }, "요약 건수")
    eq(p.site, { id: "site-1", name: "본사공장" }, "사이트(현재 tenant, 이름순 첫 사이트)")
    ok(p.baseDate === "2026-10-01", "기준일 KST 오늘")

    // 가격 권한이 없으면 단가 조회/표시 없음
    const f2 = makeFakeDb(world())
    const noPrice = await loadPurchaseSuggestions(f2.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: false })
    ok(noPrice.rows.every((r) => r.suppliers.every((s) => s.price === null)) && !noPrice.priceVisible, "단가 권한 없음: 단가 미포함")
    eq(f2.reads.some((r) => r.model === "itemPrice"), false, "단가 권한 없음: ItemPrice 조회 없음")
  }

  section("PQ4/PQ5 입력 검증 (순수)")
  {
    const line = (qty: unknown) => ({ lines: [{ itemId: "r1", supplierId: "s1", qty: qty as number }] })
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e13, 0.0000001, "5"]) {
      eq(normalizeDraftPoInput(line(bad)).ok, false, `PQ5 수량 ${String(bad)} 거부`)
    }
    const good = normalizeDraftPoInput({ lines: [{ itemId: "r1", supplierId: "s1", qty: 12.5 }, { itemId: "r1", supplierId: "s1", qty: 2.5, requiredDate: "2026-10-12" }] })
    ok(good.ok && good.lines.length === 1 && good.lines[0].qty === 15 && good.lines[0].requiredDate === "2026-10-12", "PQ4 사용자 수량(소수) 허용 + 같은 (품목, 공급업체) 병합")
    eq(normalizeDraftPoInput({ lines: [] }).ok, false, "빈 라인 거부")
    eq(normalizeDraftPoInput({ lines: [{ itemId: "r1", supplierId: "s1", qty: 1, requiredDate: "2026/10/12" }] }).ok, false, "잘못된 날짜 거부")
    eq(normalizeDraftPoInput({ lines: [{ itemId: "r1", supplierId: "", qty: 1 }] }).ok, false, "PG4 공급업체 미지정 거부")
  }

  // ═══════════════════════════════════════════════════════════════════════════
  const actor = { id: "u1", name: "구매담당", tenantId: T1 }
  const authorize = async () => actor
  const nowDraft = () => new Date("2026-10-01T03:00:00Z")

  section("PG/PC 공급업체별 DRAFT PO 생성")
  {
    const f = makeFakeDb(world())
    f.resetStats()
    const r = await createDraftPurchaseOrdersFromSuggestions(
      { authorize, db: f.db as MrpPurchaseDraftDb, now: nowDraft, lock: f.lock },
      {
        lines: [
          { itemId: "r1", supplierId: "s1", qty: 60, requiredDate: "2026-10-12" },
          { itemId: "r2", supplierId: "s1", qty: 20, requiredDate: "2026-10-18" },
          { itemId: "r3", supplierId: "s2", qty: 10, requiredDate: "2026-10-15" },
        ],
      }
    )
    ok(r.success, "PC1/PC2 생성 성공")
    if (!r.success) return
    const orders = r.data.orders
    eq(orders.length, 2, "PG1 MAT1·MAT2 → 공급업체 A, MAT3 → 공급업체 B: DRAFT PO 2건")
    const a = orders.find((o) => o.supplierId === "s1")!
    const b = orders.find((o) => o.supplierId === "s2")!
    eq([a.itemCount, a.totalQty, a.expectedDate], [2, 80, "2026-10-12"], "PG2 공급업체 A: 2품목 / 80 / 가장 빠른 필요일 10/12")
    eq([b.itemCount, b.totalQty, b.expectedDate], [1, 10, "2026-10-15"], "PG1 공급업체 B: 1품목, 자기 필요일")
    ok(f.tables.purchaseOrder.filter((p) => orders.some((o) => o.orderNo === p.orderNo)).length === 2 && f.tables.purchaseOrder.filter((p) => orders.some((o) => o.orderNo === p.orderNo)).every((p) => p.status === "DRAFT"), "PC3 생성된 PO 2건 모두 status = DRAFT")
    eq(orders.map((o) => o.orderNo), ["PO-2026-000103", "PO-2026-000104"], "PN4 기존 최대(000102) 다음 번호를 연속 확보")
    const poA = f.tables.purchaseOrder.find((p) => p.orderNo === a.orderNo)!
    eq([poA.tenantId, poA.siteId, poA.supplierId, poA.status, poA.currency], [T1, "site-1", "s1", "DRAFT", "KRW"], "PC1 헤더: tenant/site/supplier/DRAFT")
    eq(new Date(poA.expectedDate).toISOString().slice(0, 10), "2026-10-12", "PC4 expectedDate 저장(임의 +14일 아님)")
    eq(new Date(poA.orderDate).toISOString().slice(0, 10), "2026-10-01", "orderDate = KST 오늘")
    // 단가: R1(s1) 100 → 6000, R2(s1) 7 → 140 => 6140
    eq([poA.totalAmount], [6140], "합계금액 = 수량 × 같은 공급업체 단가")
    const lineR1 = f.tables.purchaseOrderItem.find((i) => i.purchaseOrderId === poA.id && i.itemId === "r1")!
    eq([lineR1.qty, lineR1.unitPrice, lineR1.receivedQty], [60, 100, 0], "라인: 수량 / 단가(s1) / 입고 0")
    // 단가 미등록(R3-s2): 0 + 비고, 합계금액 null
    const poB = f.tables.purchaseOrder.find((p) => p.orderNo === b.orderNo)!
    const lineR3 = f.tables.purchaseOrderItem.find((i) => i.purchaseOrderId === poB.id)!
    eq([lineR3.unitPrice, lineR3.note, poB.totalAmount, b.unpricedCount], [0, "단가 미등록(MRP 발주제안)", null, 1], "단가 미등록: 0 저장 + 비고 표시, 합계금액 null")
    // 감사
    const logs = f.tables.auditLog
    eq(logs.length, 2, "PC7 감사로그: PO 당 1건")
    eq([logs[0].entityType, logs[0].action, logs[0].menuName, logs[0].afterData.source, logs[0].afterData.status], ["PurchaseOrder", "CREATE", "MRP 발주제안", "MRP_PURCHASE_SUGGESTION", "DRAFT"], "PC7 감사 내용(source/상태)")
    eq(
      [logs[0].afterData.orderNo, logs[0].afterData.supplierId, logs[0].afterData.itemCount, logs[0].afterData.totalQty, logs[0].afterData.expectedDate],
      [a.orderNo, "s1", 2, 80, "2026-10-12"],
      "PC7 감사: 발주번호/공급업체/품목 수/총수량/입고예정일"
    )
    ok(logs.every((l) => l.tenantId === T1 && l.actorId === "u1"), "PC7 감사 tenant/행위자")
  }

  section("PG3 그룹 날짜 override / 필요일 없음")
  {
    const f = makeFakeDb(world())
    const dep = { authorize, db: f.db as MrpPurchaseDraftDb, now: nowDraft, lock: f.lock }
    const o = await createDraftPurchaseOrdersFromSuggestions(dep, {
      lines: [{ itemId: "r1", supplierId: "s1", qty: 5, requiredDate: "2026-10-12" }],
      groupExpectedDates: { s1: "2026-10-25" },
    })
    ok(o.success && o.data.orders[0].expectedDate === "2026-10-25", "PG3 사용자가 수정한 그룹 입고예정일 그대로 저장")
    const g = makeFakeDb(world())
    const missing = await createDraftPurchaseOrdersFromSuggestions({ ...dep, db: g.db as MrpPurchaseDraftDb, lock: g.lock }, {
      lines: [{ itemId: "r1", supplierId: "s1", qty: 5 }],
    })
    ok(!missing.success && missing.code === "MISSING_EXPECTED_DATE" && g.countWrites() === 0, "필요일 없는 수동 행: 날짜 입력 요구, 생성/쓰기 0")
    const withGroup = await createDraftPurchaseOrdersFromSuggestions({ ...dep, db: g.db as MrpPurchaseDraftDb, lock: g.lock }, {
      lines: [{ itemId: "r1", supplierId: "s1", qty: 5 }],
      groupExpectedDates: { s1: "2026-11-02" },
    })
    ok(withGroup.success && withGroup.data.orders[0].expectedDate === "2026-11-02", "수동 행 + 그룹 날짜 입력 → 생성")
  }

  section("PS7 / PC5 소유·자격 검증 (타 tenant, 비활성, 고객 전용)")
  {
    const make = () => makeFakeDb(world())
    const run = async (lines: Array<{ itemId: string; supplierId: string }>, extra: Record<string, unknown> = {}) => {
      const f = make()
      const res = await createDraftPurchaseOrdersFromSuggestions(
        { authorize, db: f.db as MrpPurchaseDraftDb, now: nowDraft, lock: f.lock },
        { lines: lines.map((l) => ({ ...l, qty: 5, requiredDate: "2026-10-12" })), ...extra } as any
      )
      return { res, f }
    }
    const allowed = await run([{ itemId: "r1", supplierId: "s2" }])
    ok(allowed.res.success, "PS7 사용자가 같은 품목의 다른 ACTIVE ItemSupplier 선택 → 허용")
    const cases: Array<[string, Array<{ itemId: string; supplierId: string }>, Record<string, unknown>?]> = [
      ["타 tenant 품목", [{ itemId: "rB", supplierId: "s1" }]],
      ["타 tenant 공급업체(관계 포함)", [{ itemId: "r1", supplierId: "sB" }]],
      ["미등록 품목", [{ itemId: "nope", supplierId: "s1" }]],
      ["ItemSupplier 관계 없는 공급업체", [{ itemId: "r2", supplierId: "s2" }]],
      ["비활성 거래처(관계 활성)", [{ itemId: "r1", supplierId: "s3" }]],
      ["비활성 관계", [{ itemId: "r1", supplierId: "s4" }]],
      ["고객 전용 거래처", [{ itemId: "r4", supplierId: "c1" }]],
      ["타 tenant 사이트", [{ itemId: "r1", supplierId: "s1" }], { siteId: "site-T2" }],
    ]
    const messages = new Set<string>()
    for (const [label, lines, extra] of cases) {
      const { res, f } = await run(lines, extra)
      ok(!res.success && res.code === "INVALID_REFERENCE", `PC5 ${label} → INVALID_REFERENCE`)
      if (!res.success) messages.add(res.error)
      eq([f.countWrites(), f.tables.purchaseOrder.length], [0, 3], `PC5/PC9 ${label}: DB write 0(시드 PO 3건 그대로)`)
    }
    eq(messages.size, 1, "PC9 오류 메시지가 사유와 무관하게 동일(타 tenant 정보 비노출)")
    const own = await run([{ itemId: "r1", supplierId: "s1" }], { siteId: "site-1" })
    ok(own.res.success, "자기 tenant 사이트 지정 허용")
  }

  section("PC6 원자성: 중간 실패 시 전체 롤백")
  {
    const f = makeFakeDb(world())
    f.failNext.auditLogAfter = 1 // 두 번째 PO 감사에서 실패
    const before = f.tables.purchaseOrder.length
    const r = await createDraftPurchaseOrdersFromSuggestions(
      { authorize, db: f.db as MrpPurchaseDraftDb, now: nowDraft, lock: f.lock },
      {
        lines: [
          { itemId: "r1", supplierId: "s1", qty: 5, requiredDate: "2026-10-12" },
          { itemId: "r3", supplierId: "s2", qty: 5, requiredDate: "2026-10-12" },
        ],
      }
    )
    ok(!r.success && r.code === "FAILED", "PC6 실패 → FAILED(원문 오류 비노출)")
    eq([f.tables.purchaseOrder.length, f.tables.purchaseOrderItem.filter((i) => String(i.purchaseOrderId).startsWith("purchaseOrder-")).length], [before, 0], "PC6 부분 PO 없음(PO/품목 모두 롤백)")
    eq(f.tables.auditLog.length, 0, "PC6 감사로그도 롤백")
  }

  section("PC8 권한 없음 / 통화 불일치")
  {
    const f = makeFakeDb(world())
    await assert.rejects(
      () =>
        createDraftPurchaseOrdersFromSuggestions(
          { authorize: async () => { throw new Error("이 기능을 사용할 권한이 없습니다.") }, db: f.db as MrpPurchaseDraftDb, now: nowDraft, lock: f.lock },
          { lines: [{ itemId: "r1", supplierId: "s1", qty: 5, requiredDate: "2026-10-12" }] }
        ),
      /권한/
    )
    passed += 1
    eq([f.reads.length, f.writes.length], [0, 0], "PC8 권한 실패: DB read/write 0")

    const g = makeFakeDb(world({ itemPrice: [price("r1", "s1", 100), price("r2", "s1", 7, { currency: "USD" })] }))
    const r = await createDraftPurchaseOrdersFromSuggestions(
      { authorize, db: g.db as MrpPurchaseDraftDb, now: nowDraft, lock: g.lock },
      { lines: [{ itemId: "r1", supplierId: "s1", qty: 1, requiredDate: "2026-10-12" }, { itemId: "r2", supplierId: "s1", qty: 1, requiredDate: "2026-10-12" }] }
    )
    ok(!r.success && r.code === "CURRENCY_MISMATCH" && g.countWrites() === 0, "서로 다른 통화 단가 혼합 거부(단순 합산 금지), write 0")
  }

  section("PC10 DRAFT 는 예정입고에 포함되지 않음")
  {
    const f = makeFakeDb(world())
    const before = await loadPurchaseSuggestions(f.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: true })
    const r1Before = before.rows.find((r) => r.code === "R1")!
    const created = await createDraftPurchaseOrdersFromSuggestions(
      { authorize, db: f.db as MrpPurchaseDraftDb, now: nowDraft, lock: f.lock },
      { lines: [{ itemId: "r1", supplierId: "s1", qty: 60, requiredDate: "2026-10-12" }] }
    )
    ok(created.success, "DRAFT 생성")
    const mrp = await loadAndRunOrderMrp(f.db as PurchaseSuggestionDb, T1, { ...params, includeScheduledReceipts: true }, NOW)
    const m = mrp.view.materials.find((x) => x.code === "R1")!
    eq([m.scheduledReceiptQty, m.finalBalance, m.shortageQty], [0, -60, 60], "PC10 DRAFT 생성 후에도 R1 예정입고 0 / 부족 60 유지")
    const after = await loadPurchaseSuggestions(f.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: true })
    const r1After = after.rows.find((r) => r.code === "R1")!
    eq([r1After.suggestedQty, r1After.peakShortageQty], [r1Before.suggestedQty, r1Before.peakShortageQty], "PC10 제안량은 DRAFT 로 줄어들지 않음")
    eq([r1Before.draftOpenQty, r1After.draftOpenQty], [0, 60], "대신 DRAFT 미입고가 참고 정보로 표시됨(중복 발주 인지용)")
    // 확정(ORDERED)되면 예정입고에 반영
    f.tables.purchaseOrder.forEach((p) => {
      if (p.status === "DRAFT" && p.note && String(p.orderNo).startsWith("PO-2026-0001")) p.status = "ORDERED"
    })
    const confirmed = await loadAndRunOrderMrp(f.db as PurchaseSuggestionDb, T1, { ...params, includeScheduledReceipts: true }, NOW)
    const mc = confirmed.view.materials.find((x) => x.code === "R1")
    ok(mc === undefined || mc.scheduledReceiptQty === 60, "ORDERED 로 확정되면 예정입고 +60 반영(수요 충당)")
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("PN PO 채번")
  {
    eq(parsePurchaseOrderSequence("PO-2026-001", 2026), 1, "parse 3자리")
    eq(parsePurchaseOrderSequence("PO-2026-001000", 2026), 1000, "parse 6자리")
    eq(parsePurchaseOrderSequence("PO-2026-1234", 2026), 1234, "parse 4자리")
    eq([parsePurchaseOrderSequence("PO-MRP-1700000000000", 2026), parsePurchaseOrderSequence("PO-2025-009", 2026), parsePurchaseOrderSequence("PO-2026-ABC", 2026), parsePurchaseOrderSequence("PO-2026-1e3", 2026)], [null, null, null, null], "다른 접두어/연도/비숫자는 무시")
    eq(formatPurchaseOrderNo(2026, 1000), "PO-2026-001000", "format 6자리")
    eq(formatPurchaseOrderNo(2026, 1234567), "PO-2026-1234567", "6자리 초과도 안전")

    const nums = (rows: string[], tenant = T1) =>
      makeFakeDb({ purchaseOrder: rows.map((orderNo, i) => ({ id: "p" + i, tenantId: tenant, orderNo })) })

    const f1 = nums(["PO-2026-001", "PO-2026-999"])
    eq(await allocatePurchaseOrderNumbers(f1.db, T1, 1, { year: 2026, lock: f1.noLock }), ["PO-2026-001000"], "PN1 기존 999 다음 → 1000 을 안전하게 표현")
    const f2 = nums(["PO-2026-001", "PO-2026-000150", "PO-2026-1234", "PO-MRP-1700000000000"])
    eq(await allocatePurchaseOrderNumbers(f2.db, T1, 1, { year: 2026, lock: f2.noLock }), ["PO-2026-001235"], "PN2 3/4/6자리 혼재 + 레거시 PO-MRP: numeric max 1234 → 1235")
    const f7 = nums(["PO-2026-999", "PO-2026-1000", "PO-2026-0998"])
    eq(await allocatePurchaseOrderNumbers(f7.db, T1, 1, { year: 2026, lock: f7.noLock }), ["PO-2026-001001"], "PN7 문자열 정렬이면 999 가 최대지만 숫자 최대 1000 → 1001")
    const f4 = nums(["PO-2026-000100"])
    eq(await allocatePurchaseOrderNumbers(f4.db, T1, 3, { year: 2026, lock: f4.noLock }), ["PO-2026-000101", "PO-2026-000102", "PO-2026-000103"], "PN4 한 트랜잭션에서 연속 3건 확보")
    const f5 = makeFakeDb({ purchaseOrder: [{ id: "x", tenantId: T2, orderNo: "PO-2026-000500" }, { id: "y", tenantId: T1, orderNo: "PO-2026-000007" }] })
    eq(await allocatePurchaseOrderNumbers(f5.db, T1, 1, { year: 2026, lock: f5.noLock }), ["PO-2026-000008"], "PN5 tenant 별 독립(타 tenant 번호 영향 없음)")
    eq(await allocatePurchaseOrderNumbers(f5.db, T2, 1, { year: 2026, lock: f5.noLock }), ["PO-2026-000501"], "PN5 다른 tenant 도 자기 순번")
    eq(await allocatePurchaseOrderNumbers(f5.db, T1, 1, { year: 2027, lock: f5.noLock }), ["PO-2027-000001"], "PN6 연도가 바뀌면 새 연도 순번(2027 은 1부터)")
    await assert.rejects(() => allocatePurchaseOrderNumbers(f5.db, T1, 0, { year: 2026, lock: f5.noLock }), /개수/)
    passed += 1
    console.log("PASS 채번 개수 검증")
  }

  section("PN3 동시 요청: 잠금이 중복 번호를 막는다")
  {
    const attempt = async (useLock: boolean) => {
      const f = makeFakeDb({ purchaseOrder: [{ id: "seed", tenantId: T1, orderNo: "PO-2026-000100" }] })
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          f.db.$transaction(async (tx: any) => {
            const [orderNo] = await allocatePurchaseOrderNumbers(tx, T1, 1, { year: 2026, lock: useLock ? f.lock : f.noLock })
            await tx.purchaseOrder.create({ data: { tenantId: T1, orderNo, supplierId: "s" + i } })
            return orderNo
          })
        )
      )
      return { results, tables: f.tables }
    }
    const withLock = await attempt(true)
    const numbers = withLock.results.map((r) => (r.status === "fulfilled" ? (r.value as string) : "ERR"))
    eq(numbers.filter((n) => n === "ERR").length, 0, "PN3 동시 10건: 오류 0")
    eq(new Set(numbers).size, 10, "PN3 동시 10건: 중복 번호 0")
    eq([...numbers].sort(), Array.from({ length: 10 }, (_, i) => `PO-2026-${String(101 + i).padStart(6, "0")}`), "PN3 번호가 빈틈없이 연속(101~110)")
    const noLock = await attempt(false)
    ok(noLock.results.some((r) => r.status === "rejected"), "잠금이 없으면 같은 번호가 충돌(unique 가 마지막 방어선) — 잠금의 필요성 증명")
  }

  section("PN 서비스 경유: 동시 DRAFT 생성 10건")
  {
    const f = makeFakeDb(world())
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        createDraftPurchaseOrdersFromSuggestions(
          { authorize, db: f.db as MrpPurchaseDraftDb, now: nowDraft, lock: f.lock },
          { lines: [{ itemId: "r1", supplierId: "s1", qty: 1, requiredDate: "2026-10-12" }] }
        )
      )
    )
    ok(results.every((r) => r.success), "동시 생성 10건 모두 성공")
    const nos = results.map((r) => (r.success ? r.data.orders[0].orderNo : ""))
    eq(new Set(nos).size, 10, "동시 생성: 발주번호 중복 0")
    eq(f.tables.purchaseOrder.length, 13, "시드 3건 + 신규 10건")
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("쿼리 수 / N+1 없음 / 보안")
  {
    const smallLines = Array.from({ length: 3 }, (_, i) => soLine("s" + i, "SO-S" + i, 1, "2026-10-12"))
    const bigLines = Array.from({ length: 303 }, (_, i) => soLine("b" + i, "SO-B" + i, 1, "2026-10-12"))
    const a = makeFakeDb(world({ salesOrderItem: smallLines, inventoryBalance: [] }))
    const b = makeFakeDb(world({ salesOrderItem: bigLines, inventoryBalance: [] }))
    const pa = await loadPurchaseSuggestions(a.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: true })
    const pb = await loadPurchaseSuggestions(b.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: true })
    eq(pa.diagnostics.queryCount, pb.diagnostics.queryCount, "수주 3건 vs 303건 쿼리 수 동일")
    eq(pb.diagnostics.queryCount, b.reads.length, "보고된 쿼리 수 = 실제 조회 수")
    eq(pb.diagnostics.queryCount, 8, "수주 1 + BOM 1 + 재고 1 + 예정입고 1 + 공급업체 정책 1 + 단가 1 + DRAFT 1 + 사이트 1 = 8")

    // 자재 300종: 쿼리 수 불변
    const comps = Array.from({ length: 300 }, (_, i): [string, string] => ["m" + i, "M" + i])
    const many = makeFakeDb(
      world({
        bOM: [bomA(comps)],
        inventoryBalance: [],
        purchaseOrderItem: [],
        itemSupplier: comps.map(([id]) => rel(id, S1, { isDefault: true })),
        itemPrice: comps.map(([id]) => price(id, "s1", 1)),
      })
    )
    const pm = await loadPurchaseSuggestions(many.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: true })
    eq([pm.rows.length, pm.diagnostics.queryCount], [300, 8], "자재 300종도 8쿼리(자재별 ItemSupplier/ItemPrice 조회 없음)")
    eq(many.reads.filter((r) => r.model === "itemSupplier").length, 1, "ItemSupplier 는 1회 일괄 조회")
    eq(many.reads.filter((r) => r.model === "itemPrice").length, 1, "ItemPrice 는 1회 일괄 조회")

    // 요청 tenantId 위조 무시 / 권한 실패 시 DB 0
    const f = makeFakeDb(world())
    const spoof = await executePurchaseSuggestionRequest(
      { authorize: async () => ({ tenantId: T1 }), canViewPrices: async () => true, db: f.db as PurchaseSuggestionDb, now: NOW },
      { tenantId: T2, includeScheduledReceipts: false }
    )
    ok(spoof.rows.length > 0 && f.reads.every((r) => !JSON.stringify(r.where).includes(T2)), "요청의 tenantId 위조 무시(쿼리에 반영되지 않음)")
    const denied = makeFakeDb(world())
    await assert.rejects(
      () =>
        executePurchaseSuggestionRequest(
          { authorize: async () => { throw new Error("권한 없음") }, canViewPrices: async () => true, db: denied.db as PurchaseSuggestionDb, now: NOW },
          {}
        ),
      /권한 없음/
    )
    passed += 1
    eq(denied.reads.length, 0, "조회 권한 실패: DB 접근 0")
  }

  section("정적 점검")
  {
    const root = join(__dirname, "..")
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8")
    const draft = code(read("src", "lib", "services", "mrp-purchase-draft.service.ts"))
    const suggestion = code(read("src", "lib", "services", "mrp-purchase-suggestion.service.ts")) + code(read("src", "lib", "mrp", "purchase-suggestion.ts"))
    ok(!/PO-MRP|Date\.now|\* 24 \* 60 \* 60|14 \*/.test(draft), "신규 생성 경로: PO-MRP / Date.now / 임의 +14일 없음")
    ok(/status: "DRAFT"/.test(draft) && !/status: "(ORDERED|PARTIAL_RECEIVED|RECEIVED)"/.test(draft), "생성 상태는 DRAFT 고정(자동 확정 없음)")
    ok(!/businessPartner\.findFirst|partnerType:\s*\{\s*in/.test(draft + suggestion), "tenant 첫 공급업체/전체 거래처에서 자동 선택하지 않음")
    // (Phase 5D 로 LT/MOQ/배수/안전재고가 도입되어 5C 의 "미사용" 경계 검사는 "반제품 netting 미사용"으로 갱신했다)
    ok(!/netting|semiFinishedStock/i.test(draft + suggestion), "Phase 5E(반제품 netting) 미사용")
    const actions = read("src", "lib", "actions", "mrp-purchase-suggestion.actions.ts")
    ok(/requireResourcePermission\("MRP", "READ"\)/.test(actions), "조회 권한 MRP READ")
    ok(/requireResourcePermission\("MRP", "CREATE"\)/.test(actions) && /requireResourcePermission\("PURCHASE_ORDER", "CREATE"\)/.test(actions), "생성 권한 MRP CREATE + PURCHASE_ORDER CREATE")
    ok(!/export async function \w+\([^)]*tenantId/.test(actions), "액션 시그니처에 tenantId 없음")
    const poActions = read("src", "lib", "actions", "purchase-order.actions.ts")
    ok(/allocatePurchaseOrderNumbers\(tx, tenantId, 1/.test(poActions) && !/generatePurchaseOrderNo/.test(poActions), "일반 발주 생성: 트랜잭션 내 새 채번 사용, 기존 문자열 정렬 채번 제거")
    // 5C 는 migration 을 추가하지 않았다. 이후 Phase 5D 의 migration(20261014010000_add_item_safety_stock)만 더해졌다.
    const migrations = readdirSync(join(root, "prisma", "migrations")).filter((n) => /^\d{14}_/.test(n))
    ok(
      migrations.filter((n) => n < "20261014010000").length === 3,
      "5C 시점 migration 3건(Phase 5C 가 추가한 migration 없음)"
    )
    ok(/pg_advisory_xact_lock/.test(read("src", "lib", "services", "purchase-order-number.service.ts")), "운영 채번 잠금: pg_advisory_xact_lock")
  }

  console.log(`\n✅ mrp-purchase-suggestion: ${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
