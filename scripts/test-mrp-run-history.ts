/**
 * Phase 6 — MRP 실행이력 / Snapshot / DRAFT Coverage / 중복 발주 방지 테스트
 * (fake DB 주입 · 실제 DB 접속/쓰기 없음)
 *
 * 실행: npm run test:mrp-run-history
 *
 *  RH1~RH7  실행이력(저장/불변/해시/비밀 없음/목록·상세/테넌트/페이지네이션/크기)
 *  DC1~DC8  DRAFT Coverage(추가 필요량, MOQ/배수 순서, 공급업체별, 재고·입고예정 불가산, 상태 전이)
 *  DP1~DP5  중복 발주 방지(coverage 거부, override 사유, 같은 run 재생성, 동시성, 멱등)
 *  PL1~PL4  권한/테넌트/정적 점검
 */
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { aggregateDraftCoverage, evaluateCoverage, splitCoverageBySupplier } from "../src/lib/mrp/draft-coverage"
import { buildMrpRunSnapshot, canonicalJson, isSnapshotTooLarge, MAX_SNAPSHOT_BYTES } from "../src/lib/mrp/mrp-run-snapshot"
import { deriveCoverageForSupplier } from "../src/lib/mrp/purchase-suggestion"
import {
  createDraftPurchaseOrdersFromSuggestions,
  type DraftPoInput,
  type MrpPurchaseDraftDb,
} from "../src/lib/services/mrp-purchase-draft.service"
import { loadAndRunOrderMrp } from "../src/lib/services/mrp-order.service"
import {
  buildRunFromCurrentMrp,
  getMrpRunDetail,
  listMrpRuns,
  saveMrpRun,
  type MrpRunDb,
} from "../src/lib/services/mrp-run.service"
import { computePurchaseSuggestions, loadPurchaseSuggestions, type PurchaseSuggestionDb } from "../src/lib/services/mrp-purchase-suggestion.service"
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
// 데이터 구성
// ═════════════════════════════════════════════════════════════════════════════

const T1 = "tenant-1"
const T2 = "tenant-2"
const NOW = () => new Date("2026-10-01T03:00:00Z") // KST 2026-10-01
const params = { from: null, to: null, includeDraft: false }
const actor = { id: "user-1", name: "홍길동", tenantId: T1 }

const supplier = (id: string, code: string, name: string) => ({ id, code, name, tenantId: T1, partnerType: "SUPPLIER", status: "ACTIVE" })
const SA = supplier("sa", "SA", "가나공급")
const SB = supplier("sb", "SB", "다라상사")

const rel = (
  itemId: string,
  s: ReturnType<typeof supplier>,
  over: Partial<{ isDefault: boolean; priority: number; leadTimeDays: number | null; moq: number | null; orderMultiple: number | null }> = {}
) => ({
  id: `rel-${itemId}-${s.id}`,
  tenantId: T1,
  itemId,
  supplierId: s.id,
  isDefault: over.isDefault ?? false,
  priority: over.priority ?? 100,
  leadTimeDays: over.leadTimeDays ?? null,
  moq: over.moq ?? null,
  orderMultiple: over.orderMultiple ?? null,
  isActive: true,
  supplier: s,
})

const fg = { id: "fgA", code: "FG-A", name: "제품A", tenantId: T1 }
const bomOf = (components: Array<{ id: string; code: string; safetyStock?: number }>) => ({
  id: "b-a",
  tenantId: T1,
  itemId: "fgA",
  version: "1",
  status: "ACTIVE",
  isDefault: true,
  bomItems: components.map((c, i) => ({
    componentItemId: c.id,
    seq: i + 1,
    qtyPer: 1,
    scrapRate: 0,
    componentItem: { code: c.code, name: c.code + " 자재", spec: null, uom: "EA", itemType: "RAW_MATERIAL", safetyStock: c.safetyStock ?? 0 },
  })),
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
const bal = (itemId: string, avail: number) => ({ tenantId: T1, itemId, item: { tenantId: T1 }, qtyOnHand: avail, qtyHold: 0, qtyAvailable: avail, lotId: null, lot: null })

/** 구매발주 + 품목 행(미입고 = qty − received). status 에 따라 DRAFT(미확정) 또는 확정 발주 */
function po(
  id: string,
  itemId: string,
  qty: number,
  opts: { status?: string; supplier?: typeof SA; received?: number; orderNo?: string; expected?: string; note?: string | null } = {}
) {
  const s = opts.supplier ?? SA
  const header = {
    id: "po-" + id,
    tenantId: T1,
    orderNo: opts.orderNo ?? "PO-2026-0000" + id,
    status: opts.status ?? "DRAFT",
    supplierId: s.id,
    expectedDate: new Date((opts.expected ?? "2026-10-05") + "T00:00:00Z"),
    note: opts.note ?? null,
    supplier: { id: s.id, name: s.name },
  }
  const line = {
    id: "poi-" + id,
    purchaseOrderId: header.id,
    itemId,
    qty,
    receivedQty: opts.received ?? 0,
    workOrderOperationId: null,
    item: { tenantId: T1 },
    purchaseOrder: header,
  }
  return { header, line }
}

type Scn = {
  /** 자재 id → 사용(기본 r1) */
  opening?: number
  demand?: number
  safety?: number
  relations?: Row[]
  pos?: Array<ReturnType<typeof po>>
}
function world(sc: Scn = {}, extra: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  const pos = sc.pos ?? []
  return {
    salesOrderItem: [soLine("l1", "SO-1", sc.demand ?? 100, "2026-10-20")],
    bOM: [bomOf([{ id: "r1", code: "R1", safetyStock: sc.safety ?? 0 }])],
    inventoryBalance: [bal("r1", sc.opening ?? 0)],
    purchaseOrder: pos.map((p) => ({ ...p.header })),
    purchaseOrderItem: pos.map((p) => ({ ...p.line })),
    itemSupplier: sc.relations ?? [rel("r1", SA, { isDefault: true })],
    itemPrice: [],
    site: [{ id: "site-1", tenantId: T1, name: "본사공장" }],
    item: [{ id: "r1", tenantId: T1, code: "R1", name: "R1 자재", safetyStock: sc.safety ?? 0 }],
    businessPartner: [SA, SB],
    mrpRun: [],
    mrpRunSuggestion: [],
    mrpRunPurchase: [],
    ...extra,
  } as Record<string, Row[]>
}

const historyFor = (f: ReturnType<typeof makeFakeDb>) => ({
  loadBuilt: (tenantId: string, p: { from: string | null; to: string | null; includeDraft: boolean }, now: () => Date) =>
    buildRunFromCurrentMrp(f.db as PurchaseSuggestionDb, tenantId, p, now),
})
const createDeps = (f: ReturnType<typeof makeFakeDb>, over: Record<string, unknown> = {}) => ({
  authorize: async () => actor,
  db: f.db as MrpPurchaseDraftDb,
  now: NOW,
  lock: f.lock,
  history: historyFor(f),
  ...over,
})
let keySeq = 0
const nextKey = () => "req-key-" + String(++keySeq).padStart(4, "0")
const line = (qty: number, supplierId = "sa", itemId = "r1") => ({ itemId, supplierId, qty, requiredDate: "2026-10-20" })
const input = (over: Partial<DraftPoInput> = {}): DraftPoInput => ({
  lines: [line(100)],
  groupExpectedDates: { sa: "2026-10-20" },
  requestKey: nextKey(),
  mrp: params,
  ...over,
})
const rowOf = async (f: ReturnType<typeof makeFakeDb>, p = params) =>
  (await loadPurchaseSuggestions(f.db as PurchaseSuggestionDb, T1, p, { now: NOW, includePrices: false })).rows.find((r) => r.code === "R1")!

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════
  section("DC 순수 Coverage 계산 (MRP 정책 필요량 − 기존 DRAFT → MOQ/배수)")
  {
    const e = (raw: number, cov: number, moq: number | null = null, mult: number | null = null) =>
      evaluateCoverage({ rawNeed: raw, coverageQty: cov, supplier: { moq, orderMultiple: mult } })
    const a = e(100, 80)
    eq([a.remainingRawNeed, a.additionalQty, a.status], [20, 20, "PARTIAL"], "DC1 필요 100 / 기존 DRAFT 80 → 추가 20 (MOQ 없음)")
    const b = e(100, 100)
    eq([b.remainingRawNeed, b.additionalQty, b.status], [0, 0, "COVERED"], "DC2 DRAFT = 필요 → 추가 0, 충족")
    const c = e(100, 80, 50, 10)
    eq([c.remainingRawNeed, c.qtyAfterMoq, c.additionalQty, c.moqApplied], [20, 50, 50, true], "DC3 필요 100 / DRAFT 80 / MOQ 50 / 배수 10 → 남은 20 → MOQ 50")
    const d = e(100, 110, 50, 10)
    eq([d.remainingRawNeed, d.additionalQty, d.moqApplied, d.multipleApplied, d.status], [0, 0, false, false, "COVERED"], "DC4 DRAFT 110 > 필요 100 → 0, MOQ 미적용")
    const f2 = e(100, 0, 50, 10)
    eq([f2.additionalQty, f2.status], [100, "NONE"], "DRAFT 없음 → 기존 5D 결과(100) 그대로")
    const g = e(17, 0, 25, 10)
    eq(g.additionalQty, 30, "DRAFT 없음: 17 → MOQ 25 → 배수 10 올림 30 (5D 규칙 유지)")
    const h = e(23, 3, null, 10)
    eq([h.remainingRawNeed, h.additionalQty], [20, 20], "필요 23 / DRAFT 3 → 20 → 배수 10 = 20")
    eq(e(0.3, 0.1, null, 0.1).additionalQty, 0.2, "소수: 0.3 − 0.1 = 0.2 (부동소수 오차 없음)")
    eq(e(5, 0, 0 as any, null).termsInvalid, true, "MOQ 0 = 데이터 오류(조건 미적용)")
    const split = splitCoverageBySupplier({ total: 90, bySupplier: { sa: 30, sb: 60 } }, "sa")
    eq(split, { selectedSupplierQty: 30, otherSupplierQty: 60 }, "공급업체별 분해(선택 공급업체 / 다른 공급업체)")
    const agg = aggregateDraftCoverage([
      { itemId: "i1", supplierId: "sa", orderNo: "PO-2", openQty: 30 },
      { itemId: "i1", supplierId: "sb", orderNo: "PO-1", openQty: 60 },
      { itemId: "i1", supplierId: "sa", orderNo: "PO-2", openQty: 10 },
      { itemId: "i1", supplierId: "sa", orderNo: "PO-3", openQty: 0 },
    ]).get("i1")!
    eq([agg.total, agg.orderCount, agg.orders.map((o) => o.orderNo)], [100, 2, ["PO-1", "PO-2"]], "품목별 합산(미입고 0 제외, 발주서 병합/정렬)")
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("DC 발주제안 서비스: Coverage 필드 / 재고·입고예정 불가산")
  {
    // DRAFT 80 (SA) → 추가 20
    const f1 = makeFakeDb(world({ pos: [po("1", "r1", 80)] }))
    const r1 = await rowOf(f1)
    eq(
      [r1.rawSuggestedQty, r1.suggestedQty, r1.draftCoverageQty, r1.remainingRawNeed, r1.additionalQty, r1.coverageStatus],
      [100, 100, 80, 20, 20, "PARTIAL"],
      "서비스: 필요 100 / MRP 제안 100(DRAFT 미고려 유지) / 기존 DRAFT 80 / 추가 20"
    )
    eq(r1.draftOrders.map((o) => o.orderNo), ["PO-2026-00001"], "발주번호 표시(참고)")
    // MOQ 50, 배수 10
    const f2 = makeFakeDb(world({ pos: [po("1", "r1", 80)], relations: [rel("r1", SA, { isDefault: true, moq: 50, orderMultiple: 10 })] }))
    const r2 = await rowOf(f2)
    eq([r2.suggestedQty, r2.additionalQty, deriveCoverageForSupplier(r2, r2.suppliers[0]).moqApplied], [100, 50, true], "서비스: MOQ 50/배수 10 → MRP 제안 100, 남은 20 → MOQ 적용 추가 50")
    // DRAFT 110
    const f3 = makeFakeDb(world({ pos: [po("1", "r1", 110)], relations: [rel("r1", SA, { isDefault: true, moq: 50, orderMultiple: 10 })] }))
    const r3 = await rowOf(f3)
    eq([r3.additionalQty, r3.coverageStatus, r3.moqApplied], [0, "COVERED", false], "서비스: DRAFT 110 ≥ 필요 100 → 추가 0, 충족, MOQ 미적용")
    // 다른 공급업체 DRAFT
    const f4 = makeFakeDb(world({ pos: [po("1", "r1", 60, { supplier: SB })], relations: [rel("r1", SA, { isDefault: true }), rel("r1", SB)] }))
    const r4 = await rowOf(f4)
    eq([r4.draftCoverageQty, r4.draftCoverageBySupplier], [60, { sb: 60 }], "DC5 다른 공급업체(SB) DRAFT 60 — 품목 전체 coverage 60")
    const toChoice = (id: string) => r4.suppliers.find((s) => s.supplierId === id)!
    const forSa = deriveCoverageForSupplier(r4, toChoice("sa"))
    const forSb = deriveCoverageForSupplier(r4, toChoice("sb"))
    eq([forSa.selectedSupplierDraftQty, forSa.otherSupplierDraftQty, forSa.additionalQty], [0, 60, 40], "추천 SA 선택: 선택 공급업체 DRAFT 0 / 다른 공급업체 60 / 추가 40(품목 전체 기준)")
    eq([forSb.selectedSupplierDraftQty, forSb.otherSupplierDraftQty, forSb.additionalQty], [60, 0, 40], "SB 선택: 선택 공급업체 DRAFT 60 / 다른 0 / 추가 40")

    // DC6 DRAFT 는 재고/입고예정/예상잔량에 가산하지 않는다
    const withDraft = makeFakeDb(world({ pos: [po("1", "r1", 80)] }))
    const without = makeFakeDb(world())
    const a = await loadAndRunOrderMrp(withDraft.db as PurchaseSuggestionDb, T1, { ...params, includeScheduledReceipts: true }, NOW)
    const b = await loadAndRunOrderMrp(without.db as PurchaseSuggestionDb, T1, { ...params, includeScheduledReceipts: true }, NOW)
    eq(
      JSON.stringify(a.view.materials.map((m) => [m.qtyAvailable, m.scheduledReceiptQty, m.finalBalance, m.shortageQty, m.peakShortageQty])),
      JSON.stringify(b.view.materials.map((m) => [m.qtyAvailable, m.scheduledReceiptQty, m.finalBalance, m.shortageQty, m.peakShortageQty])),
      "DC6 DRAFT 발주가 있어도 재고/예정입고/예상잔량/부족 수치는 DRAFT 없을 때와 완전히 동일"
    )
    eq(a.view.scheduledReceipts.appliedReceiptCount, 0, "DRAFT 는 예정입고 건수에 포함되지 않음(Phase 5B 정책)")

    // DC7 DRAFT → ORDERED: coverage 에서 빠지고 입고예정에 들어간다(둘 다 아님)
    const ordered = makeFakeDb(world({ pos: [po("1", "r1", 80, { status: "ORDERED", expected: "2026-10-10" })] }))
    const ro = await rowOf(ordered)
    eq([ro.draftCoverageQty, ro.scheduledReceiptQty], [0, 80], "DC7 ORDERED: Draft Coverage 0 / 예정입고 80 (이중 반영 없음)")
    eq([r1.draftCoverageQty, r1.scheduledReceiptQty], [80, 0], "DC7 DRAFT: Draft Coverage 80 / 예정입고 0")

    // DC8 제외 규칙
    const mixed = makeFakeDb(
      world({
        pos: [
          po("1", "r1", 80, { received: 30 }), // 미입고 50
          po("2", "r1", 40, { status: "CANCELLED" }),
          po("3", "r1", 40, { status: "CLOSED" }),
          po("4", "r1", 40, { status: "RECEIVED", received: 40 }),
          po("5", "r1", 40, { orderNo: "OS-2026-001" }), // 외주발주
          po("6", "r1", 40, { note: "[OUTSOURCING] 도금" }),
          po("7", "r1", 25, { received: 25 }), // 미입고 0
        ],
      })
    )
    const rm = await rowOf(mixed)
    eq(rm.draftCoverageQty, 50, "DC8 활성 DRAFT 미입고만(수령분 차감) / CANCELLED·CLOSED·RECEIVED·외주·미입고 0 제외")
    // 다른 tenant 의 DRAFT 는 제외
    const otherTenant = makeFakeDb(world({ pos: [po("1", "r1", 80)] }, {}))
    ;(otherTenant.tables.purchaseOrderItem[0].purchaseOrder as any).tenantId = T2
    const rt = await rowOf(otherTenant)
    eq(rt.draftCoverageQty, 0, "DC8 다른 tenant 의 DRAFT 는 coverage 에서 제외")
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("RH 실행 저장 / Snapshot / 불변 / 해시 / 비밀 없음")
  {
    const f = makeFakeDb(world({ pos: [po("1", "r1", 80)], relations: [rel("r1", SA, { isDefault: true, moq: 50, orderMultiple: 10, leadTimeDays: 7 })] }))
    // RH2 조회는 쓰기 0
    await loadPurchaseSuggestions(f.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: true })
    await listMrpRuns({ authorize: async () => ({ tenantId: T1 }), db: f.db as MrpRunDb }, {})
    eq(f.countWrites(), 0, "RH2 일반 조회(SSR/GET/목록)는 어떤 행도 만들지 않음(쓰기 0)")

    const key = nextKey()
    const saved = await saveMrpRun({ authorize: async () => actor, db: f.db as MrpRunDb, now: NOW }, { ...params, requestKey: key })
    ok(saved.success && saved.data.replayed === false, "RH1 명시적 저장 성공")
    if (!saved.success) throw new Error("save failed")
    eq(f.tables.mrpRun.length, 1, "MrpRun 1건")
    const run = f.tables.mrpRun[0]
    eq([run.tenantId, run.runType, run.mode, run.status, run.createdById, run.createdByName, run.requestKey], [T1, "ORDER_MRP", "NORMAL", "SAVED", "user-1", "홍길동", key], "실행자/유형/모드/상태/요청키")
    eq([run.demandLineCount, run.materialCount, run.shortageMaterialCount, run.purchaseNeededCount], [1, 1, 1, 1], "요약 컬럼(수요/자재/부족/구매 필요)")
    eq([run.includeDraft, run.includeScheduledReceipts, run.semiFinishedNetting], [false, true, true], "옵션 기록")
    ok(/^[0-9a-f]{64}$/.test(run.sourceHash) && /^[0-9a-f]{64}$/.test(run.resultHash), "sourceHash / resultHash = sha256 hex")
    eq(f.tables.mrpRunSuggestion.length, 1, "제안 행 1건(MrpRunSuggestion)")
    const sg = f.tables.mrpRunSuggestion[0]
    eq(
      [sg.itemId, sg.rawNeed, sg.suggestedQty, sg.draftCoverageQty, sg.additionalQty, sg.supplierId],
      ["r1", 100, 100, 80, 50, "sa"],
      "제안 행: 정책 필요량 100 / MRP 제안 100 / 기존 DRAFT 80 / 추가 50 / 추천 공급업체"
    )
    eq(f.tables.auditLog.filter((a) => a.entityType === "MrpRun" && a.action === "CREATE").length, 1, "AuditLog: MrpRun CREATE 1건")

    // 내용: who/when/period/mode/baseDate/demand/stock/receipts/semi/safety/supplier/MOQ/suggested
    const snap = run.snapshot
    eq([snap.version, snap.meta.mode, snap.meta.baseDate, snap.meta.from, snap.meta.to], [1, "NORMAL", "2026-10-01", null, null], "Snapshot: 버전/모드/기준일/기간")
    const m = snap.materials[0]
    eq([m.code, m.qtyAvailable, m.totalRequirement, m.finalBalance, m.shortageQty, m.safetyStock], ["R1", 0, 100, -100, 100, 0], "Snapshot: 자재 재고/소요/최종 예상/부족/안전재고")
    eq(m.steps[0].slice(0, 3), ["SO-1", "고객사", "FG-A"], "Snapshot: 수요(수주/고객/제품)")
    const s0 = snap.suggestions[0]
    eq([s0.leadTimeDays, s0.moq, s0.orderMultiple, s0.rawNeed, s0.additionalQty, s0.draftCoverageQty], [7, 50, 10, 100, 50, 80], "Snapshot: 공급업체 LT/MOQ/배수 + 필요/추가/기존 DRAFT")
    eq(s0.draftOrders.map((o: { orderNo: string }) => o.orderNo), ["PO-2026-00001"], "Snapshot: 당시 DRAFT 발주번호")
    ok(snap.scheduledReceipts && "appliedReceiptCount" in snap.scheduledReceipts, "Snapshot: 입고예정 요약")
    ok("semiNettedMaterialCount" in snap.summary, "Snapshot: 반제품 Netting 요약")

    // RH4 비밀/식별 정보 없음
    const text = JSON.stringify(snap)
    ok(!/DATABASE_URL|postgres(ql)?:\/\/|SUPABASE|service_role|JWT|jwt|password|passwd|secret|token|session|cookie|authorization|apikey|api_key/i.test(text), "RH4 Snapshot 에 DB URL/토큰/세션/비밀번호 키·값 없음")
    ok(!text.includes(T1) && !text.includes("user-1"), "RH4 tenantId / 사용자 id 는 Snapshot 에 넣지 않음(컬럼으로만 존재)")
    ok(!/unitPrice|"price"/.test(text), "단가는 Snapshot 에 넣지 않음(가격 권한 분리)")

    // RH3 저장값은 재계산하지 않는다 — 원천 데이터가 바뀌어도 상세는 저장 당시 값
    f.tables.inventoryBalance[0].qtyAvailable = 500
    f.tables.inventoryBalance[0].qtyOnHand = 500
    f.tables.purchaseOrder.length = 0
    f.tables.purchaseOrderItem.length = 0
    const detail = await getMrpRunDetail({ authorize: async () => ({ tenantId: T1 }), db: f.db as MrpRunDb }, saved.data.runId)
    ok(detail.success, "상세 조회 성공")
    if (!detail.success) throw new Error("detail failed")
    eq(
      [detail.data.snapshot.materials[0].qtyAvailable, detail.data.snapshot.suggestions[0].draftCoverageQty, detail.data.run.id],
      [0, 80, saved.data.runId],
      "RH3 재고/DRAFT 가 바뀌어도 상세는 저장 당시 값(재계산 없음)"
    )
    const fresh = await rowOf(f)
    ok(fresh === undefined || fresh.draftCoverageQty === 0, "(현재 계산은 바뀐 값을 반영 — 이력과 분리)")

    // RH2 같은 requestKey 재전송 → 새로 만들지 않음
    const again = await saveMrpRun({ authorize: async () => actor, db: f.db as MrpRunDb, now: NOW }, { ...params, requestKey: key })
    ok(again.success && again.data.replayed === true && again.data.runId === saved.data.runId, "RH2 같은 요청 키: 기존 실행 반환(replayed)")
    eq(f.tables.mrpRun.length, 1, "RH2 같은 요청 키는 Snapshot 을 중복 생성하지 않음")
    const second = await saveMrpRun({ authorize: async () => actor, db: f.db as MrpRunDb, now: NOW }, { ...params, requestKey: nextKey() })
    ok(second.success && second.data.replayed === false, "새 요청은 새 Snapshot")
    eq(f.tables.mrpRun.length, 2, "다른 요청 키는 별도 실행이력(이전 실행이 새 실행을 막지 않음)")

    // 더블클릭(동시 5건, 같은 키) → 1건
    const f2 = makeFakeDb(world())
    const k2 = nextKey()
    const results = await Promise.all(
      Array.from({ length: 5 }, () => saveMrpRun({ authorize: async () => actor, db: f2.db as MrpRunDb, now: NOW }, { ...params, requestKey: k2 }))
    )
    ok(results.every((r) => r.success), "동시 5건 모두 성공 응답")
    eq(f2.tables.mrpRun.length, 1, "RH 동시 저장(같은 요청 키)도 Snapshot 1건")
    eq(new Set(results.map((r) => (r.success ? r.data.runId : ""))).size, 1, "모두 같은 실행 id")

    // 잘못된 입력
    const bad = await saveMrpRun({ authorize: async () => actor, db: f.db as MrpRunDb, now: NOW }, { from: "2026-13-40" })
    ok(!bad.success && bad.code === "INVALID_INPUT", "잘못된 기간 → INVALID_INPUT")
    const badKey = await saveMrpRun({ authorize: async () => actor, db: f.db as MrpRunDb, now: NOW }, { ...params, requestKey: "x" })
    ok(!badKey.success && badKey.code === "INVALID_INPUT", "잘못된 요청 키 형식 거부")
  }

  section("RH 해시 결정성 / 크기 가드")
  {
    const f = makeFakeDb(world({ pos: [po("1", "r1", 80)] }))
    const c1 = await computePurchaseSuggestions(f.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: false })
    const b1 = buildMrpRunSnapshot({ view: c1.view, rows: c1.payload.rows, baseDate: "2026-10-01", generatedAt: new Date("2026-10-01T00:00:00Z") })
    const b2 = buildMrpRunSnapshot({ view: c1.view, rows: c1.payload.rows, baseDate: "2026-10-01", generatedAt: new Date("2026-10-02T09:00:00Z") })
    eq([b1.sourceHash, b1.resultHash], [b2.sourceHash, b2.resultHash], "같은 입력이면 같은 해시(생성 시각은 해시 제외)")
    f.tables.inventoryBalance[0].qtyAvailable = 7
    f.tables.inventoryBalance[0].qtyOnHand = 7
    const c2 = await computePurchaseSuggestions(f.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: false })
    const b3 = buildMrpRunSnapshot({ view: c2.view, rows: c2.payload.rows, baseDate: "2026-10-01", generatedAt: NOW() })
    ok(b3.sourceHash !== b1.sourceHash && b3.resultHash !== b1.resultHash, "입력(재고)이 바뀌면 sourceHash / resultHash 모두 변경")
    eq(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}', "canonical JSON: 키 정렬 / undefined 생략")

    // 크기 가드: 아주 작은 상한 → steps 생략으로 줄이고, 그래도 넘으면 거부
    const small = buildMrpRunSnapshot({ view: c1.view, rows: c1.payload.rows, baseDate: "2026-10-01", generatedAt: NOW(), maxBytes: b1.byteSize })
    eq(small.snapshot.compacted, false, "상한 이내면 전체 저장")
    let threw = false
    try {
      buildMrpRunSnapshot({ view: c1.view, rows: c1.payload.rows, baseDate: "2026-10-01", generatedAt: NOW(), maxBytes: 100 })
    } catch (e) {
      threw = isSnapshotTooLarge(e)
    }
    ok(threw, "상한을 넘으면 저장하지 않음(SnapshotTooLargeError)")
  }

  section("RH 크기 측정: 자재 273종 × 수주 66건 (실제 파이프라인)")
  {
    const comps = Array.from({ length: 273 }, (_, i) => ({ id: "m" + i, code: "M" + String(i).padStart(3, "0"), safetyStock: i % 5 === 0 ? 10 : 0 }))
    const lines = Array.from({ length: 66 }, (_, i) => soLine("l" + i, "SO-" + String(i + 1).padStart(3, "0"), 5 + (i % 7), `2026-10-${String(10 + (i % 18)).padStart(2, "0")}`))
    const big = makeFakeDb({
      salesOrderItem: lines,
      bOM: [bomOf(comps)],
      inventoryBalance: comps.map((c, i) => bal(c.id, 20 + (i % 40))),
      purchaseOrder: [],
      purchaseOrderItem: [],
      itemSupplier: comps.map((c) => rel(c.id, SA, { isDefault: true, leadTimeDays: 7, moq: 10, orderMultiple: 5 })),
      itemPrice: [],
      site: [{ id: "site-1", tenantId: T1, name: "본사공장" }],
      mrpRun: [],
      mrpRunSuggestion: [],
      mrpRunPurchase: [],
    })
    const built = await buildRunFromCurrentMrp(big.db as PurchaseSuggestionDb, T1, params, NOW)
    const bytes = built.byteSize
    const stepCount = built.snapshot.materials.reduce((s, m) => s + m.steps.length, 0)
    console.log(`   · 273 자재 × 66 수주: steps ${stepCount}건, Snapshot ${(bytes / 1024).toFixed(0)} KB, 제안 ${built.suggestionRows.length}건`)
    ok(built.snapshot.materials.length === 273 && stepCount > 10_000, "273 자재 / 1만+ 수요 단계 Snapshot 생성")
    ok(bytes < MAX_SNAPSHOT_BYTES && built.snapshot.compacted === false, `Snapshot 크기 ${(bytes / 1024).toFixed(0)} KB < 상한 ${(MAX_SNAPSHOT_BYTES / 1024 / 1024).toFixed(0)} MB (전체 저장)`)
    // 저장도 고정 쿼리 수: 트랜잭션 1회, 제안 행은 createMany 1회
    const saved = await saveMrpRun({ authorize: async () => actor, db: big.db as MrpRunDb, now: NOW }, { ...params, requestKey: nextKey() })
    ok(saved.success, "273 자재 저장 성공")
    eq(big.writes.filter((w) => w.model === "mrpRunSuggestion").length, 1, "제안 행 저장은 createMany 1회(자재 수와 무관)")
    eq(big.tables.mrpRunSuggestion.length, built.suggestionRows.length, "제안 행 수 일치")
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("RH 목록 / 상세 / 페이지네이션 / 테넌트 격리")
  {
    const runs: Row[] = []
    for (let i = 0; i < 45; i++) {
      runs.push({
        id: "run-" + String(i).padStart(2, "0"),
        tenantId: i < 40 ? T1 : T2,
        runType: "ORDER_MRP",
        mode: "NORMAL",
        status: "SAVED",
        baseDate: new Date("2026-10-01T00:00:00Z"),
        fromDate: null,
        toDate: null,
        includeDraft: false,
        demandLineCount: 1,
        materialCount: i,
        shortageMaterialCount: 0,
        purchaseNeededCount: 0,
        warningCount: 0,
        snapshotVersion: 1,
        snapshot: { big: "x".repeat(10) },
        sourceHash: "a".repeat(64),
        resultHash: "b".repeat(64),
        createdByName: "홍길동",
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)),
      })
    }
    const f = makeFakeDb(world({}, { mrpRun: runs, mrpRunPurchase: [{ id: "mp-1", tenantId: T1, runId: "run-39", purchaseOrderId: "po-1", orderNo: "PO-2026-000001", supplierId: "sa", supplierName: "가나공급", itemCount: 1, totalQty: 10, overrideUsed: false, overrideReason: null, lines: [], createdAt: new Date("2026-10-01T10:00:00Z"), createdByName: "홍길동", purchaseOrder: { status: "ORDERED" } }] }))
    f.resetStats()
    const p1 = await listMrpRuns({ authorize: async () => ({ tenantId: T1 }), db: f.db as MrpRunDb }, { page: 1, pageSize: 20 })
    eq([p1.items.length, p1.total, p1.totalPages, p1.page], [20, 40, 2, 1], "RH5 목록: 20건/페이지, 총 40건(타 tenant 제외), 2페이지")
    eq(p1.items[0].id, "run-39", "최신순 정렬")
    ok(p1.items.every((i) => !("snapshot" in i)), "목록은 Snapshot JSON 을 포함하지 않음(요약 컬럼만)")
    eq(p1.items[0].purchaseOrderCount, 1, "생성 PO 수 표시")
    eq(f.reads.length, 3, "목록 쿼리 3회(count + page + 연결 PO 일괄) — 페이지 크기와 무관(N+1 없음)")
    const p3 = await listMrpRuns({ authorize: async () => ({ tenantId: T1 }), db: f.db as MrpRunDb }, { page: 99, pageSize: 20 })
    eq(p3.page, 2, "범위를 벗어난 페이지는 마지막 페이지로")
    const huge = await listMrpRuns({ authorize: async () => ({ tenantId: T1 }), db: f.db as MrpRunDb }, { page: 1, pageSize: 100000 })
    eq(huge.pageSize, 100, "pageSize 상한 100")

    // RH6 테넌트 격리: 다른 tenant 의 run id
    const other = await getMrpRunDetail({ authorize: async () => ({ tenantId: T1 }), db: f.db as MrpRunDb }, "run-41")
    ok(!other.success && other.code === "NOT_FOUND", "RH6 다른 tenant 의 실행 id → 존재하지 않는 것과 동일(NOT_FOUND)")
    const none = await getMrpRunDetail({ authorize: async () => ({ tenantId: T1 }), db: f.db as MrpRunDb }, "nope")
    ok(!none.success && none.code === "NOT_FOUND" && none.error === (other as any).error, "없는 id 와 응답 동일(존재 여부 비노출)")
    const mine = await getMrpRunDetail({ authorize: async () => ({ tenantId: T1 }), db: f.db as MrpRunDb }, "run-39")
    ok(mine.success && mine.data.purchases[0].currentStatus === "ORDERED" && mine.data.purchases[0].orderNo === "PO-2026-000001", "상세: 연결 PO 의 현재 상태(ORDERED)")
    const noIdea = await getMrpRunDetail({ authorize: async () => ({ tenantId: T1 }), db: f.db as MrpRunDb }, { $ne: "x" } as unknown as string)
    ok(!noIdea.success, "비문자열 id 거부")

    // RH7 권한 실패는 DB 접근 전
    const g = makeFakeDb(world())
    let denied = false
    try {
      await listMrpRuns({ authorize: async () => { throw new Error("FORBIDDEN") }, db: g.db as MrpRunDb }, {})
    } catch {
      denied = true
    }
    ok(denied && g.reads.length === 0 && g.writes.length === 0, "RH7 권한 실패 시 DB 조회/쓰기 0건")
    denied = false
    try {
      await saveMrpRun({ authorize: async () => { throw new Error("FORBIDDEN") }, db: g.db as MrpRunDb }, params)
    } catch {
      denied = true
    }
    ok(denied && g.reads.length === 0 && g.writes.length === 0, "저장 권한 실패 시 DB 0건")
    // tenantId 입력 무시
    const h = makeFakeDb(world())
    await saveMrpRun({ authorize: async () => actor, db: h.db as MrpRunDb, now: NOW }, { ...params, tenantId: "tenant-evil", requestKey: nextKey() })
    eq(h.tables.mrpRun[0].tenantId, T1, "입력의 tenantId 는 무시(인증 사용자 tenant 만)")
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("DP 중복 발주 방지 / 멱등 / 동시성 / override")
  {
    // DP1 기존 DRAFT 로 충족 → 생성 거부, 쓰기 0
    {
      const f = makeFakeDb(world({ pos: [po("1", "r1", 100)] }))
      f.resetStats()
      const res = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), input())
      ok(!res.success && res.code === "DUPLICATE_DRAFT", "DP1 기존 DRAFT 100 ≥ 필요 100 → DUPLICATE_DRAFT")
      eq([f.tables.purchaseOrder.length, f.tables.mrpRun.length, f.tables.mrpRunPurchase.length], [1, 0, 0], "DP1 거부 시 PO/실행/연결 추가 0건")
      eq(f.countWrites("purchaseOrder"), 0, "DP1 PurchaseOrder write 0")
    }

    // DP2 부분 충족: 추가분은 허용 + Snapshot/연결/감사
    {
      const f = makeFakeDb(world({ pos: [po("1", "r1", 80)], relations: [rel("r1", SA, { isDefault: true, moq: 50, orderMultiple: 10 })] }))
      const key = nextKey()
      const res = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), input({ requestKey: key, lines: [line(50)] }))
      ok(res.success && res.data.orders.length === 1 && res.data.replayed === false, "DP2 추가 필요 20 → MOQ 50 발주 생성")
      if (!res.success) throw new Error(res.error)
      eq([f.tables.purchaseOrder.length, f.tables.mrpRun.length, f.tables.mrpRunPurchase.length], [2, 1, 1], "PO 1건 추가 + 근거 Snapshot 1건 + 연결 1건(같은 트랜잭션)")
      const link = f.tables.mrpRunPurchase[0]
      eq([link.runId, link.orderNo, link.requestKey, link.overrideUsed, link.supplierId], [f.tables.mrpRun[0].id, res.data.orders[0].orderNo, key, false, "sa"], "연결: 실행/발주번호/요청키/override 없음")
      eq([link.lines[0].rawNeed, link.lines[0].draftCoverageQty, link.lines[0].remainingRawNeed, link.lines[0].qty], [100, 80, 20, 50], "연결 라인 근거: 필요 100 / 기존 DRAFT 80 / 남은 20 / 발주 50")
      eq(f.tables.mrpRun[0].requestKey, key, "Snapshot 도 같은 요청 키(중복 방지)")
      ok(f.tables.auditLog.some((a) => a.entityType === "MrpRunPurchase" && a.afterData.kind === "MRP_PURCHASE_CREATE"), "AuditLog: MRP_PURCHASE_CREATE")
      ok(f.tables.auditLog.some((a) => a.entityType === "PurchaseOrder" && a.afterData.mrpRunId === f.tables.mrpRun[0].id), "PO 생성 감사에 근거 실행 id 포함")
      // 이제 DRAFT 합계 130 ≥ 100 → 다시 생성 불가
      const dup = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), input({ lines: [line(50)] }))
      ok(!dup.success && dup.code === "DUPLICATE_DRAFT", "DP2 연속 재생성: 이제 기존 DRAFT 130 ≥ 필요 → 거부")
    }

    // override: 사유 필수 / 사유 있으면 허용 + 감사
    {
      const f = makeFakeDb(world({ pos: [po("1", "r1", 100)] }))
      const noReason = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), input({ coverageOverrides: { r1: "   " } }))
      ok(!noReason.success && noReason.code === "OVERRIDE_REASON_REQUIRED", "DP3 override 사유가 비어 있으면 OVERRIDE_REASON_REQUIRED")
      eq(f.tables.mrpRunPurchase.length, 0, "사유 누락 → 생성 0건")
      const longReason = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), input({ coverageOverrides: { r1: "x".repeat(201) } }))
      ok(!longReason.success && longReason.code === "INVALID_INPUT", "사유 200자 초과 거부")
      const key = nextKey()
      const res = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), input({ requestKey: key, coverageOverrides: { r1: "고객 긴급 추가 주문" } }))
      ok(res.success && res.data.overrideCount === 1, "DP3 사유와 함께 override → 생성")
      const link = f.tables.mrpRunPurchase[0]
      eq([link.overrideUsed, link.overrideReason?.includes("고객 긴급 추가 주문")], [true, true], "연결 행에 override/사유 저장")
      const audit = f.tables.auditLog.find((a) => a.entityType === "MrpRunPurchase")!
      eq([audit.afterData.kind, audit.afterData.overrides[0].reason, audit.afterData.overrides[0].duplicateDraft], ["MRP_PURCHASE_CREATE_OVERRIDE", "고객 긴급 추가 주문", true], "감사로그에 override 사유/중복 사유 기록")
    }

    // 필요 없는 품목(제안 없음)도 override 없이는 불가
    {
      const f = makeFakeDb(world({ opening: 500, demand: 10 }))
      const res = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), input({ lines: [line(10)] }))
      ok(!res.success && res.code === "DUPLICATE_DRAFT", "필요 0(부족 없음) 품목은 override 없이는 발주 불가")
    }

    // DP4 같은 run 재생성: 먼저 run 저장 → 첫 발주 → 같은 run 으로 재생성 거부(ORDERED 로 바뀌어 coverage 에서 빠져도)
    {
      const f = makeFakeDb(world())
      const saved = await saveMrpRun({ authorize: async () => actor, db: f.db as MrpRunDb, now: NOW }, { ...params, requestKey: nextKey() })
      if (!saved.success) throw new Error("save")
      const first = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), {
        lines: [line(100)],
        groupExpectedDates: { sa: "2026-10-20" },
        requestKey: nextKey(),
        runId: saved.data.runId,
      })
      ok(first.success && first.data.runId === saved.data.runId, "DP4 저장한 실행(runId)에서 발주 생성 — 새 Snapshot 을 만들지 않음")
      eq(f.tables.mrpRun.length, 1, "runId 사용 시 Snapshot 중복 생성 없음")
      // 그 PO 가 확정(ORDERED)되어 coverage 에서 빠졌다고 가정
      const header = f.tables.purchaseOrder[0]
      header.status = "ORDERED"
      f.tables.purchaseOrderItem.forEach((i) => {
        if (i.purchaseOrderId === header.id) i.purchaseOrder = header
      })
      const again = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), {
        lines: [line(100)],
        groupExpectedDates: { sa: "2026-10-20" },
        requestKey: nextKey(),
        runId: saved.data.runId,
      })
      ok(!again.success && again.code === "DUPLICATE_RUN_LINE", "DP4 같은 run + 같은 품목/공급업체 재생성 거부(이미 ORDERED 라 DRAFT coverage 에는 없음)")
      const withReason = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), {
        lines: [line(100)],
        groupExpectedDates: { sa: "2026-10-20" },
        requestKey: nextKey(),
        runId: saved.data.runId,
        coverageOverrides: { r1: "추가 확보" },
      })
      ok(withReason.success, "DP4 override + 사유가 있으면 같은 run 에서도 추가 가능")
      const missing = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), {
        lines: [line(100)],
        groupExpectedDates: { sa: "2026-10-20" },
        requestKey: nextKey(),
        runId: "run-does-not-exist",
      })
      ok(!missing.success && missing.code === "RUN_NOT_FOUND", "존재하지 않는 runId → RUN_NOT_FOUND")
      // 다른 tenant 의 run
      f.tables.mrpRun.push({ id: "run-other", tenantId: T2, requestKey: null })
      const cross = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), {
        lines: [line(100)],
        groupExpectedDates: { sa: "2026-10-20" },
        requestKey: nextKey(),
        runId: "run-other",
      })
      ok(!cross.success && cross.code === "RUN_NOT_FOUND", "다른 tenant 의 runId → 존재하지 않는 것과 동일(RUN_NOT_FOUND)")
    }

    // DP5 멱등: 같은 요청 키 재전송 → 처음 결과 그대로, 추가 생성 0
    {
      const f = makeFakeDb(world())
      const key = nextKey()
      const a = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), input({ requestKey: key }))
      const b = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), input({ requestKey: key }))
      ok(a.success && b.success && b.data.replayed === true && b.data.orders[0].orderNo === a.data.orders[0].orderNo, "DP5 재전송: 같은 발주번호, replayed=true")
      eq([f.tables.purchaseOrder.length, f.tables.mrpRun.length, f.tables.mrpRunPurchase.length], [1, 1, 1], "재전송은 PO/Snapshot/연결을 추가하지 않음")
    }

    // 동시성: 같은 키 10건 → 1건 / 서로 다른 키 10건 → 1건 성공, 9건 중복 거부
    {
      const f = makeFakeDb(world())
      const key = nextKey()
      const rs = await Promise.all(Array.from({ length: 10 }, () => createDraftPurchaseOrdersFromSuggestions(createDeps(f), input({ requestKey: key }))))
      ok(rs.every((r) => r.success), "같은 키 동시 10건: 모두 성공 응답")
      eq(f.tables.purchaseOrder.length, 1, "같은 키 동시 10건 → PO 1건")
      eq(new Set(rs.map((r) => (r.success ? r.data.orders[0].orderNo : ""))).size, 1, "모두 같은 발주번호")
      eq(rs.filter((r) => r.success && r.data.replayed === false).length, 1, "새로 생성한 요청은 정확히 1건")

      const g = makeFakeDb(world())
      const rs2 = await Promise.all(Array.from({ length: 10 }, () => createDraftPurchaseOrdersFromSuggestions(createDeps(g), input())))
      eq(rs2.filter((r) => r.success).length, 1, "서로 다른 키 동시 10건 → 성공 1건")
      eq(rs2.filter((r) => !r.success && r.code === "DUPLICATE_DRAFT").length, 9, "나머지 9건은 DUPLICATE_DRAFT")
      eq(g.tables.purchaseOrder.length, 1, "DRAFT PO 1건만 존재(중복 DRAFT 없음)")
      eq(g.tables.mrpRun.length, 1, "근거 Snapshot 도 1건(거부된 요청은 저장하지 않음)")
    }

    // 원자성: 중간 실패 → PO/Snapshot/연결 모두 롤백, 같은 키 재시도 가능
    {
      const f = makeFakeDb(world())
      f.failNext.auditLogAfter = 1 // MrpRun 감사(0) 이후 첫 PO 감사(1)에서 실패
      const key = nextKey()
      const bad = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), input({ requestKey: key }))
      ok(!bad.success && bad.code === "FAILED", "중간 실패 → FAILED")
      eq([f.tables.purchaseOrder.length, f.tables.mrpRun.length, f.tables.mrpRunSuggestion.length, f.tables.mrpRunPurchase.length], [0, 0, 0, 0], "전체 롤백(PO/Snapshot/제안/연결 0건)")
      f.failNext.auditLogAfter = -1
      const retry = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), input({ requestKey: key }))
      ok(retry.success && retry.data.replayed === false, "같은 키로 재시도 성공(실패한 시도는 흔적이 없음)")
    }

    // ID 요청 키 재사용: 같은 키 + 같은 의미 → replay / 같은 키 + 다른 의미 → 거부(쓰기 0)
    {
      const twoItems = (): Record<string, Row[]> => {
        const w = world({ relations: [rel("r1", SA, { isDefault: true }), rel("r1", SB)] })
        return w
      }
      const state = (f: ReturnType<typeof makeFakeDb>) =>
        JSON.stringify([f.tables.purchaseOrder.length, f.tables.purchaseOrderItem.length, f.tables.mrpRun.length, f.tables.mrpRunSuggestion.length, f.tables.mrpRunPurchase.length, f.tables.auditLog.length])
      const base = (key: string, over: Partial<DraftPoInput> = {}): DraftPoInput => ({
        lines: [line(100)],
        groupExpectedDates: { sa: "2026-10-20" },
        requestKey: key,
        mrp: params,
        ...over,
      })
      const MISMATCH = "IDEMPOTENCY_KEY_REUSE_MISMATCH"

      // ID1 같은 키 + 같은 payload → replay, 쓰기 0
      const f = makeFakeDb(twoItems())
      const key = nextKey()
      const first = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), base(key))
      ok(first.success && first.data.replayed === false, "ID1 첫 요청 생성")
      f.resetStats()
      const before = state(f)
      const same = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), base(key))
      ok(same.success && same.data.replayed === true && first.success && same.data.orders[0].orderNo === first.data.orders[0].orderNo, "ID1 같은 키 + 같은 payload → 기존 결과 replay(replayed=true)")
      eq(state(f), before, "ID1 replay 는 PO/Snapshot/연결/감사 추가 0")
      eq(f.countWrites(), 0, "ID1 replay 는 DB write 0")
      ok(same.success && !("requestHash" in (same.data.orders[0] as object)), "replay 응답에 내부 해시/사이트 필드가 노출되지 않음")

      // 동일한 의미(라인 순서/중복 병합)면 replay
      const g = makeFakeDb(twoItems())
      const gk = nextKey()
      const a = await createDraftPurchaseOrdersFromSuggestions(createDeps(g), base(gk, { lines: [line(60), line(40)] }))
      const b = await createDraftPurchaseOrdersFromSuggestions(createDeps(g), base(gk, { lines: [line(100)] }))
      ok(a.success && b.success && b.data.replayed === true, "같은 수량을 나눠 보내도(병합 후 동일) 같은 의미 → replay")

      // ID2 qty 다름
      const mm = async (label: string, over: Partial<DraftPoInput>, expectLabel = label) => {
        const h = makeFakeDb(twoItems())
        const k = nextKey()
        const ok1 = await createDraftPurchaseOrdersFromSuggestions(createDeps(h), base(k))
        ok(ok1.success, label + ": 첫 요청 성공")
        h.resetStats()
        const snap = state(h)
        const r = await createDraftPurchaseOrdersFromSuggestions(createDeps(h), base(k, over))
        ok(!r.success && r.code === MISMATCH, expectLabel + " → IDEMPOTENCY_KEY_REUSE_MISMATCH")
        eq(state(h), snap, label + ": PO/Snapshot/연결/감사 추가 0")
        eq(h.countWrites(), 0, label + ": DB write 0")
        return h
      }
      await mm("ID2 같은 키 + 다른 수량", { lines: [line(90)] })
      await mm("ID3 같은 키 + 다른 공급업체", { lines: [line(100, "sb")], groupExpectedDates: { sb: "2026-10-20" } })
      await mm("ID4 같은 키 + 다른 입고예정일", { groupExpectedDates: { sa: "2026-10-25" } })
      await mm("같은 키 + 다른 품목 목록(라인 추가)", { lines: [line(100), line(10, "sb")], groupExpectedDates: { sa: "2026-10-20", sb: "2026-10-20" } })
      await mm("같은 키 + 다른 필요일(라인)", { lines: [{ ...line(100), requiredDate: "2026-10-22" }] })
      await mm("같은 키 + 다른 근거(mrp 기간)", { mrp: { from: "2026-10-01", to: "2026-10-31", includeDraft: false } })
      await mm("같은 키 + 다른 override 사유", { coverageOverrides: { r1: "다른 사유" } })

      // 같은 키가 "실행 저장"에 이미 쓰였다면 발주 생성에 재사용 불가
      const sv = makeFakeDb(twoItems())
      const svKey = nextKey()
      await saveMrpRun({ authorize: async () => actor, db: sv.db as MrpRunDb, now: NOW }, { ...params, requestKey: svKey })
      sv.resetStats()
      const reuse = await createDraftPurchaseOrdersFromSuggestions(createDeps(sv), base(svKey))
      ok(!reuse.success && reuse.code === MISMATCH && sv.countWrites() === 0 && sv.tables.purchaseOrder.length === 0, "저장에 쓴 키를 발주 생성에 재사용 → 거부(쓰기 0)")

      // 실행 저장: 같은 키 + 다른 기간 → 거부, 같은 기간 → replay
      const sv2 = makeFakeDb(twoItems())
      const k2 = nextKey()
      const s1 = await saveMrpRun({ authorize: async () => actor, db: sv2.db as MrpRunDb, now: NOW }, { ...params, requestKey: k2 })
      const s2 = await saveMrpRun({ authorize: async () => actor, db: sv2.db as MrpRunDb, now: NOW }, { ...params, requestKey: k2 })
      ok(s1.success && s2.success && s2.data.replayed === true, "저장: 같은 키 + 같은 파라미터 → replay")
      sv2.resetStats()
      const s3 = await saveMrpRun({ authorize: async () => actor, db: sv2.db as MrpRunDb, now: NOW }, { from: "2026-10-01", to: "2026-10-31", includeDraft: false, requestKey: k2 })
      ok(!s3.success && s3.code === MISMATCH && sv2.countWrites() === 0 && sv2.tables.mrpRun.length === 1, "저장: 같은 키 + 다른 기간 → IDEMPOTENCY_KEY_REUSE_MISMATCH(쓰기 0)")
      const s4 = await saveMrpRun({ authorize: async () => actor, db: sv2.db as MrpRunDb, now: NOW }, { ...params, includeDraft: true, requestKey: k2 })
      ok(!s4.success && s4.code === MISMATCH, "저장: 같은 키 + DRAFT 수주 포함 여부 다름 → 거부")

      // ID5 동시 동일 요청 → 1건
      const c = makeFakeDb(twoItems())
      const ck = nextKey()
      const same10 = await Promise.all(Array.from({ length: 10 }, () => createDraftPurchaseOrdersFromSuggestions(createDeps(c), base(ck))))
      ok(same10.every((r) => r.success), "ID5 동시 동일 요청 10건: 모두 성공 응답")
      eq([c.tables.purchaseOrder.length, c.tables.mrpRun.length, c.tables.mrpRunPurchase.length], [1, 1, 1], "ID5 PO/Snapshot/연결 각 1건")
      eq(same10.filter((r) => r.success && r.data.replayed === false).length, 1, "ID5 새로 생성한 요청은 1건")

      // ID6 동시 같은 키 + 서로 다른 body → 한 종류만 생성, 나머지는 mismatch(또는 replay 동일 body)
      const d = makeFakeDb(twoItems())
      const dk = nextKey()
      const bodies = [100, 90, 80, 100, 90, 80].map((q) => base(dk, { lines: [line(q)] }))
      const mixed = await Promise.all(bodies.map((bd) => createDraftPurchaseOrdersFromSuggestions(createDeps(d), bd)))
      eq(d.tables.purchaseOrder.length, 1, "ID6 같은 키 아래 PO 는 1건뿐")
      eq(d.tables.mrpRun.length, 1, "ID6 Snapshot 1건")
      const winnerQty = Number(d.tables.purchaseOrderItem[0].qty)
      ok(
        mixed.every((r, i) => (r.success ? bodies[i].lines[0].qty === winnerQty : r.code === MISMATCH)),
        "ID6 성공/replay 는 승자와 같은 내용뿐이고, 다른 내용은 모두 MISMATCH"
      )
      eq(mixed.filter((r) => r.success && r.data.replayed === false).length, 1, "ID6 새로 생성된 것은 정확히 1건")
      ok(mixed.some((r) => !r.success && r.code === MISMATCH), "ID6 다른 내용의 요청은 거부됨")
    }

    // 입력 검증: history 주입 시 requestKey / 근거 필수
    {
      const f = makeFakeDb(world())
      const noKey = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), { lines: [line(100)], groupExpectedDates: { sa: "2026-10-20" }, mrp: params })
      ok(!noKey.success && noKey.code === "INVALID_INPUT", "서버 경로: requestKey 없으면 INVALID_INPUT")
      const noBasis = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), { lines: [line(100)], groupExpectedDates: { sa: "2026-10-20" }, requestKey: nextKey() })
      ok(!noBasis.success && noBasis.code === "INVALID_INPUT", "서버 경로: runId/mrp 근거가 없으면 INVALID_INPUT")
      eq(f.tables.purchaseOrder.length, 0, "검증 실패 시 쓰기 0")
    }

    // PO 링크 보존: PO 가 삭제돼도 연결/발주번호/라인 근거는 남는다
    {
      const f = makeFakeDb(world())
      const res = await createDraftPurchaseOrdersFromSuggestions(createDeps(f), input())
      if (!res.success) throw new Error(res.error)
      const runId = res.data.runId!
      const deps = { authorize: async () => ({ tenantId: T1 }), db: f.db as MrpRunDb }
      // fake DB 는 관계 include 를 해석하지 않으므로 조인 결과(연결된 PO 헤더)를 직접 연결한다
      f.tables.mrpRunPurchase[0].purchaseOrder = f.tables.purchaseOrder[0]
      const before = await getMrpRunDetail(deps, runId)
      ok(before.success && before.data.purchases[0].currentStatus === "DRAFT", "PO 링크: 생성 직후 DRAFT")
      f.tables.purchaseOrder[0].status = "CLOSED"
      const closed = await getMrpRunDetail(deps, runId)
      ok(closed.success && closed.data.purchases[0].currentStatus === "CLOSED", "PO 링크: CLOSED 로 바뀌어도 연결 유지(현재 상태 표시)")
      // DB 의 FK SET NULL 동작 흉내
      f.tables.mrpRunPurchase[0].purchaseOrderId = null
      f.tables.mrpRunPurchase[0].purchaseOrder = null
      const deleted = await getMrpRunDetail(deps, runId)
      ok(
        deleted.success && deleted.data.purchases[0].currentStatus === "DELETED" && deleted.data.purchases[0].orderNo === res.data.orders[0].orderNo,
        "PO 삭제(SET NULL) 후에도 발주번호/연결 이력 보존, 상태 DELETED 표시"
      )
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("쿼리 수: Coverage 일괄 조회 (N+1 없음)")
  {
    const make = (n: number) => {
      const comps = Array.from({ length: n }, (_, i) => ({ id: "m" + i, code: "M" + i }))
      const pos = comps.flatMap((c, i) => (i % 3 === 0 ? [po("d" + i, c.id, 30)] : []))
      return makeFakeDb({
        salesOrderItem: [soLine("l1", "SO-1", 100, "2026-10-12")],
        bOM: [bomOf(comps)],
        inventoryBalance: comps.map((c) => bal(c.id, 0)),
        purchaseOrder: pos.map((p) => ({ ...p.header })),
        purchaseOrderItem: pos.map((p) => ({ ...p.line })),
        itemSupplier: comps.map((c) => rel(c.id, SA, { isDefault: true })),
        itemPrice: [],
        site: [{ id: "site-1", tenantId: T1, name: "본사공장" }],
      })
    }
    const small = make(3)
    const large = make(300)
    const ps = await loadPurchaseSuggestions(small.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: true })
    const pl = await loadPurchaseSuggestions(large.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: true })
    eq(ps.diagnostics.queryCount, pl.diagnostics.queryCount, "자재 3종 / 300종 쿼리 수 동일(Coverage 1회 일괄)")
    eq(large.reads.filter((r) => r.model === "purchaseOrderItem").length, 2, "purchaseOrderItem 조회 2회(예정입고 1 + DRAFT coverage 1)")
    ok(pl.rows.length === 300 && pl.rows.filter((r) => r.draftCoverageQty > 0).length === 100, "300종 중 DRAFT 가 있는 100종에 coverage 반영")
    eq(pl.coverageSummary.draftExistsCount, 100, "coverageSummary.draftExistsCount")
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("PL 권한 / 테넌트 / 정적 점검")
  {
    const root = join(__dirname, "..")
    const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8")
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    const runActions = code(read("src", "lib", "actions", "mrp-run.actions.ts"))
    ok(/"use server"/.test(runActions), "실행이력 액션: use server")
    ok(/saveOrderMrpRun[\s\S]*?requireResourcePermission\("MRP", "CREATE"\)/.test(runActions), "PL1 저장: MRP CREATE")
    ok(/listOrderMrpRuns[\s\S]*?requireResourcePermission\("MRP", "READ"\)/.test(runActions), "PL2 목록: MRP READ")
    ok(/getOrderMrpRun[\s\S]*?requireResourcePermission\("MRP", "READ"\)/.test(runActions), "PL2 상세: MRP READ")
    ok(!/tenantId\s*:/.test(runActions.replace(/tenantId: user\.tenantId/g, "")), "PL3 tenantId 는 인증 사용자에서만(입력으로 받지 않음)")
    const sugActions = code(read("src", "lib", "actions", "mrp-purchase-suggestion.actions.ts"))
    ok(/requireResourcePermission\("MRP", "CREATE"\)[\s\S]*requireResourcePermission\("PURCHASE_ORDER", "CREATE"\)[\s\S]*requireRole\("OPERATOR"/.test(sugActions), "PL4 발주 생성: MRP CREATE + PURCHASE_ORDER CREATE + OPERATOR 유지")
    ok(/history:\s*\{[\s\S]*buildRunFromCurrentMrp\(prisma, tenantId, params, now\)/.test(sugActions), "서버 액션은 항상 중복 방지/Snapshot 연결(history)을 주입")

    // 이력 수정/삭제 기능 없음
    const scan = (dir: string): string[] => {
      const out: string[] = []
      for (const name of readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel2 = join(dir, name.name)
        if (name.isDirectory()) out.push(...scan(rel2))
        else if (/\.(ts|tsx)$/.test(name.name)) out.push(rel2)
      }
      return out
    }
    const offenders = [...scan("src/lib"), ...scan("src/app")].filter((p) =>
      /mrpRun(Suggestion|Purchase)?\.(update|updateMany|delete|deleteMany|upsert)\(/.test(code(readFileSync(join(root, p), "utf8")))
    )
    eq(offenders, [], "실행이력 UPDATE/DELETE 코드 없음(불변)")

    // 서비스 정적: Snapshot 에 비밀/가격 없음, 순수 모듈은 DB 비의존
    const snapSrc = code(read("src", "lib", "mrp", "mrp-run-snapshot.ts"))
    ok(!/prisma|process\.env|DATABASE_URL/i.test(snapSrc), "Snapshot 빌더: DB/환경변수 비의존")
    const cov = code(read("src", "lib", "mrp", "draft-coverage.ts"))
    ok(!/prisma|process\.env/i.test(cov), "Coverage 모듈: 순수")
    // 엔진/입고예정 정책 불변
    ok(!/draft/i.test(code(read("src", "lib", "mrp", "order-mrp-engine.ts"))), "MRP 엔진은 DRAFT 개념을 모른다(Golden 불변)")
    const sched = code(read("src", "lib", "mrp", "scheduled-receipt.ts"))
    ok(/SCHEDULED_RECEIPT_PO_STATUSES = \["ORDERED", "PARTIAL_RECEIVED"\]/.test(sched), "예정입고 상태는 ORDERED/PARTIAL_RECEIVED 만(DRAFT 불가산)")

    // schema / migration
    const schema = read("prisma", "schema.prisma").replace(/\r/g, "")
    for (const m of ["MrpRun", "MrpRunSuggestion", "MrpRunPurchase"]) ok(new RegExp(`model ${m} \\{`).test(schema), `schema: ${m}`)
    ok(/@@unique\(\[tenantId, requestKey\]\)/.test(schema) && /@@unique\(\[tenantId, requestKey, supplierId\]\)/.test(schema), "schema: 요청 단위 멱등 unique")
    ok(/@@unique\(\[purchaseOrderId\]\)/.test(schema), "schema: PO 당 연결 1건")
    ok(/onDelete: SetNull/.test(/model MrpRunPurchase \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? ""), "schema: PO 삭제 시 연결 보존(SetNull)")
    const migs = readdirSync(join(root, "prisma", "migrations")).filter((n) => /^\d{14}_/.test(n)).sort()
    // 이후 migration(예: 자재입고 멱등성)이 추가되어도 Phase 6 migration 이 그대로 존재하면 된다 — "최신" 고정은 새 migration 마다 깨진다
    ok(migs.includes("20261014020000_add_mrp_run_history"), "Phase 6 migration 존재")
    ok(migs.filter((n) => n > "20261014020000_add_mrp_run_history").every((n) => !/mrp/i.test(read("prisma", "migrations", n, "migration.sql").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n"))), "이후 migration 은 MRP 테이블을 건드리지 않음")
    const sql = read("prisma", "migrations", "20261014020000_add_mrp_run_history", "migration.sql")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
    eq((sql.match(/CREATE TABLE/g) ?? []).length, 3, "migration: 신규 테이블 3개")
    eq((sql.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length, 3, "migration: 신규 테이블 RLS 활성 3개")
    ok(/REVOKE ALL ON TABLE public\.%I FROM %I/.test(sql), "migration: anon/authenticated REVOKE")
    ok(!/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|ALTER TABLE "(?!MrpRun)/.test(sql.replace(/ALTER TABLE "MrpRun(Suggestion|Purchase)?"/g, "")), "migration: additive(기존 테이블 변경/삭제 없음)")
    ok(/CREATE TRIGGER "MrpRun_immutable_trg"/.test(sql), "migration: 불변 trigger")
    for (const t of ["MrpRun", "MrpRunSuggestion", "MrpRunPurchase"]) ok(new RegExp(`"${t}_tenantId_`).test(sql), `migration: ${t} tenant 인덱스`)
  }

  console.log(`\n✅ mrp-run-history: ${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
