/**
 * Phase 5D — 안전재고 / 리드타임 / MOQ / 발주배수 테스트 (fake DB 주입 · 실제 DB 접속/쓰기 없음)
 *
 * 실행: npm run test:mrp-purchase-policy
 *
 *  SS1~SS5  안전재고 정책(필요 없음 / 최종 미달 / 5C 일시 결품 유지 / 일시 미달 / 최대 보충량)
 *  OB       시작 재고가 이미 안전재고 미달(기준일 즉시)
 *  LT1~LT6  리드타임 → 발주 필요일(달력일, 연/윤년 경계, 경과/미등록)
 *  MM1~MM8  MOQ → 발주배수 올림(Decimal-safe), 서버 재검증
 *  SW       공급업체 변경 시 구매조건/타이밍/가격 재계산(다른 공급업체 정책 비혼합)
 *  + 물리 재고 불변, 쿼리 수(N+1 없음), 품목 안전재고 검증, DRAFT 비포함, 정적 점검
 */
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  applySupplierTerms,
  computeOrderByDate,
  daysBetween,
  describeTermsViolation,
  evaluateOrderTiming,
  validateQtyAgainstTerms,
} from "../src/lib/mrp/purchase-policy"
import {
  buildPurchaseSuggestionRows,
  classifyByPolicy,
  deriveForSupplier,
  type SupplierChoice,
} from "../src/lib/mrp/purchase-suggestion"
import type { OrderMrpView } from "../src/lib/mrp/order-mrp-adapter"
import { isValidSafetyStock, normalizeSafetyStock } from "../src/lib/item-safety-stock"
import {
  createDraftPurchaseOrdersFromSuggestions,
  type MrpPurchaseDraftDb,
} from "../src/lib/services/mrp-purchase-draft.service"
import { loadPurchaseSuggestions, type PurchaseSuggestionDb } from "../src/lib/services/mrp-purchase-suggestion.service"
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
const NOW = () => new Date("2026-10-01T03:00:00Z") // KST 2026-10-01
const params = { from: null, to: null, includeDraft: false }

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
function receipt(id: string, itemId: string, qty: number, expected: string, status = "ORDERED") {
  const po = { id: "po-" + id, tenantId: T1, orderNo: "PO-2026-0000" + id, status, expectedDate: new Date(expected + "T00:00:00Z"), note: null, supplier: { id: SA.id, name: SA.name } }
  return { id: "poi-" + id, purchaseOrderId: po.id, itemId, qty, receivedQty: 0, workOrderOperationId: null, item: { tenantId: T1 }, purchaseOrder: po }
}

type Scn = {
  opening: number
  safety?: number
  demands?: Array<[number, string]>
  receipts?: Array<[number, string]>
  relations?: Row[]
  prices?: Row[]
}
function world(sc: Scn, extra: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  const pois = (sc.receipts ?? []).map(([q, d], i) => receipt(String(i + 1), "r1", q, d))
  return {
    salesOrderItem: (sc.demands ?? []).map(([q, d], i) => soLine("l" + (i + 1), "SO-" + (i + 1), q, d)),
    bOM: [bomOf([{ id: "r1", code: "R1", safetyStock: sc.safety ?? 0 }])],
    inventoryBalance: [bal("r1", sc.opening)],
    purchaseOrder: pois.map((p) => ({ ...p.purchaseOrder })),
    purchaseOrderItem: pois,
    itemSupplier: sc.relations ?? [rel("r1", SA, { isDefault: true })],
    itemPrice: sc.prices ?? [],
    site: [{ id: "site-1", tenantId: T1, name: "본사공장" }],
    item: [{ id: "r1", tenantId: T1, code: "R1", name: "R1 자재", safetyStock: sc.safety ?? 0 }],
    businessPartner: [SA, SB],
    ...extra,
  } as Record<string, Row[]>
}
async function suggest(sc: Scn) {
  const f = makeFakeDb(world(sc))
  const p = await loadPurchaseSuggestions(f.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: true })
  return { p, row: p.rows.find((r) => r.code === "R1"), f }
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════
  section("MM 구매조건: 필요량 → MOQ → 발주배수 올림")
  {
    const q = (need: number, moq: number | null, mult: number | null) => {
      const r = applySupplierTerms(need, { moq, orderMultiple: mult })
      return r.ok ? r.qty : `ERR:${r.code}`
    }
    eq(q(17, 20, 10), 20, "MM1 필요 17 / MOQ 20 / 배수 10 → 20")
    eq(q(23, 20, 10), 30, "MM2 필요 23 / MOQ 20 / 배수 10 → 30")
    eq(q(17, null, 10), 20, "MM3 필요 17 / MOQ 없음 / 배수 10 → 20")
    eq(q(3, 10, null), 10, "MM4 필요 3 / MOQ 10 / 배수 없음 → 10")
    eq(q(2.6, null, 0.5), 3, "MM5 필요 2.6 / 배수 0.5 → 3.0")
    eq(q(2.5, null, 0.5), 2.5, "MM5b 필요 2.5 / 배수 0.5 → 2.5(이미 배수)")
    eq(q(7.77, null, null), 7.77, "MM8 MOQ/배수 없음 → 필요량 그대로")
    eq(q(17, 25, 10), 30, "순서: 17 → MOQ 25 → 배수 10 올림 30 (25 에서 끝나면 안 됨)")
    eq(q(0, 20, 10), 0, "필요량 0 → 구매 없음(MOQ 를 적용하지 않음)")
    eq(q(0.1 + 0.2, null, 0.1), 0.3, "부동소수 0.1+0.2 도 배수 0.1 에서 0.3 (오차 없음)")
    eq(q(1.1, null, 0.1), 1.1, "1.1 은 0.1 의 배수(부동소수 % 연산이면 오판되는 값)")
    eq(q(7, null, 2.5), 7.5, "필요 7 / 배수 2.5 → 7.5")
    const detail = applySupplierTerms(17, { moq: 25, orderMultiple: 10 })
    ok(detail.ok && detail.moqApplied && detail.multipleApplied && detail.qtyAfterMoq === 25 && detail.rawQty === 17, "적용 단계 정보(MOQ 25 → 배수 30)")
    eq(applySupplierTerms(5, { moq: 0, orderMultiple: null }), { ok: false, code: "INVALID_MOQ" }, "MOQ 0 은 데이터 오류(미설정은 null)")
    eq(applySupplierTerms(5, { moq: null, orderMultiple: -1 }), { ok: false, code: "INVALID_ORDER_MULTIPLE" }, "발주배수 음수는 데이터 오류")
    eq(applySupplierTerms(Number.NaN, { moq: null, orderMultiple: null }), { ok: false, code: "INVALID_QUANTITY" }, "NaN 수량 거부")

    // 서버/화면 공용 재검증
    ok(validateQtyAgainstTerms(5, { moq: null, orderMultiple: 2.5 }).ok, "배수 2.5: 5 허용")
    ok(validateQtyAgainstTerms(7.5, { moq: null, orderMultiple: 2.5 }).ok, "배수 2.5: 7.5 허용")
    ok(validateQtyAgainstTerms(10, { moq: null, orderMultiple: 2.5 }).ok, "배수 2.5: 10 허용")
    const bad = validateQtyAgainstTerms(6, { moq: null, orderMultiple: 2.5 })
    ok(!bad.ok && bad.code === "NOT_MULTIPLE", "배수 2.5: 6 거부")
    ok(validateQtyAgainstTerms(0.3, { moq: null, orderMultiple: 0.1 }).ok, "배수 0.1: 0.3 허용(부동소수 % 아님)")
    const low = validateQtyAgainstTerms(10, { moq: 20, orderMultiple: null })
    ok(!low.ok && low.code === "BELOW_MOQ" && /MOQ\) 20 미만/.test(describeTermsViolation(low as any, 10)), "MOQ 미달 거부 + 메시지")
    ok(validateQtyAgainstTerms(20, { moq: 20, orderMultiple: 10 }).ok, "정확히 MOQ 이고 배수면 허용")
  }

  section("LT 리드타임 → 발주 필요일(달력일)")
  {
    eq(computeOrderByDate("2026-10-20", 7), "2026-10-13", "LT1 목표 10/20 − 7일 = 10/13")
    eq(computeOrderByDate("2026-10-20", 0), "2026-10-20", "LT2 리드타임 0 → 목표일과 같은 날")
    eq(computeOrderByDate("2026-10-20", null), null, "LT3 리드타임 없음 → 발주 필요일 계산 불가")
    eq(computeOrderByDate("2026-01-03", 7), "2025-12-27", "LT4 연도 경계")
    eq(computeOrderByDate("2024-03-01", 1), "2024-02-29", "LT5 윤년")
    eq(computeOrderByDate("2025-03-01", 1), "2025-02-28", "LT5b 평년")
    eq(computeOrderByDate("2026-10-20", 3650), "2016-10-22", "LT 상한(3650일) 계산")
    eq(computeOrderByDate("2026-02-30", 1), null, "잘못된 날짜 → null")
    eq(daysBetween("2026-10-14", "2026-10-11"), -3, "일수 차이(음수 = 경과)")

    const t = (target: string | null, lt: number | null, base: string) => evaluateOrderTiming(target, lt, base)
    eq(t("2026-10-18", 7, "2026-10-14"), { status: "OVERDUE", orderByDate: "2026-10-11", overdueDays: 3 }, "LT6 오늘 10/14 · 필요 10/18 · LT 7 → 발주 필요일 10/11, 3일 경과")
    eq(t("2026-10-21", 7, "2026-10-14"), { status: "DUE_TODAY", orderByDate: "2026-10-14" }, "발주 필요일 = 오늘 → 오늘 발주 필요")
    eq(t("2026-10-30", 7, "2026-10-14"), { status: "OK", orderByDate: "2026-10-23", daysLeft: 9 }, "여유")
    eq(t("2026-10-30", null, "2026-10-14"), { status: "LEAD_TIME_MISSING" }, "리드타임 미등록")
    eq(t(null, 7, "2026-10-14"), { status: "NO_TARGET_DATE" }, "목표일 없음")
    // 시간대 무관(UTC 달력 계산): 어떤 TZ 환경에서도 같은 결과
    const savedTz = process.env.TZ
    process.env.TZ = "Pacific/Kiritimati"
    eq(computeOrderByDate("2026-10-20", 7), "2026-10-13", "시간대(UTC+14)에서도 하루 밀림 없음")
    process.env.TZ = "America/Los_Angeles"
    eq(computeOrderByDate("2026-10-20", 7), "2026-10-13", "시간대(UTC−8)에서도 하루 밀림 없음")
    if (savedTz === undefined) delete process.env.TZ
    else process.env.TZ = savedTz
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("SS 안전재고 정책 (물리 재고 시간축은 그대로)")
  {
    const ss1 = await suggest({ opening: 100, safety: 20, demands: [[70, "2026-10-12"]] })
    eq(ss1.row, undefined, "SS1 100 − 70 = 30 ≥ 안전재고 20 → 구매 제안 필요 없음")

    const ss2 = await suggest({ opening: 100, safety: 20, demands: [[90, "2026-10-12"]] })
    ok(ss2.row, "SS2 제안 생성")
    eq([ss2.row!.kind, ss2.row!.finalTargetDeficit, ss2.row!.peakTargetDeficit, ss2.row!.rawSuggestedQty, ss2.row!.suggestedQty], ["SAFETY_STOCK_SHORTAGE", 10, 10, 10, 10], "SS2 100 − 90 = 10 < 20: 최종 미달 10 / 최대 10 / 제안 10 (물리 부족은 아님)")
    eq([ss2.row!.finalBalance, ss2.row!.openingStock, ss2.row!.minProjectedBalance], [10, 100, 10], "SS2 물리 잔량 불변(openingStock 에서 안전재고를 빼지 않음)")
    eq([ss2.row!.breachKind, ss2.row!.requiredDate], ["DEMAND", "2026-10-12"], "SS2 필요 입고일 = 최초 안전재고 침범일(10/12)")

    // SS3: 안전재고 0 → 5C 일시 결품 의미 유지
    const ss3 = await suggest({ opening: 50, safety: 0, demands: [[60, "2026-10-12"]], receipts: [[30, "2026-10-15"]] })
    eq([ss3.row!.kind, ss3.row!.suggestedQty, ss3.row!.rawSuggestedQty, ss3.row!.peakShortageQty, ss3.row!.finalTargetDeficit, ss3.row!.peakTargetDeficit], ["TEMPORARY_SHORTAGE", 0, 0, 10, 0, 10], "SS3 안전재고 0: 일시 결품, 자동 제안 0(5C 의미 유지)")
    eq([ss3.row!.breachKind, ss3.row!.requiredDate, ss3.row!.shortageRecoveredAt], ["SHORTAGE", "2026-10-12", "2026-10-15"], "SS3 필요일 = 최초 결품일(기존 firstShortageDate 와 동일)")

    // SS4: 안전재고 일시 미달 — 자동 과잉 발주 안 함
    const ss4 = await suggest({ opening: 50, safety: 20, demands: [[40, "2026-10-12"]], receipts: [[30, "2026-10-15"]] })
    eq([ss4.row!.kind, ss4.row!.finalTargetDeficit, ss4.row!.peakTargetDeficit, ss4.row!.suggestedQty, ss4.row!.rawSuggestedQty], ["SAFETY_STOCK_TEMPORARY", 0, 10, 0, 0], "SS4 중간 10 < 20 이지만 최종 40 ≥ 20 → 자동 제안 0")
    eq([ss4.row!.minProjectedBalance, ss4.row!.finalBalance, ss4.row!.requiredDate], [10, 40, "2026-10-12"], "SS4 최저 10 / 최종 40 / 침범일 10/12")

    // SS5: 최종 미달 + 더 깊은 일시 미달 → 최대 보충량
    const ss5 = await suggest({ opening: 50, safety: 20, demands: [[45, "2026-10-12"]], receipts: [[5, "2026-10-15"]] })
    eq([ss5.row!.kind, ss5.row!.finalTargetDeficit, ss5.row!.peakTargetDeficit, ss5.row!.rawSuggestedQty], ["SAFETY_STOCK_SHORTAGE", 10, 15, 15], "SS5 5 → 10: 최종 미달 10 / 최대 미달 15 → 제안 15")
    eq([ss5.row!.minProjectedBalance, ss5.row!.finalBalance], [5, 10], "SS5 최저 5 / 최종 10")

    // 물리 부족 + 안전재고: 부족이 안전재고 미달에 포함
    const phys = await suggest({ opening: 10, safety: 20, demands: [[30, "2026-10-12"]] })
    eq([phys.row!.kind, phys.row!.finalTargetDeficit, phys.row!.peakTargetDeficit, phys.row!.peakShortageQty, phys.row!.finalShortageQty], ["FINAL_SHORTAGE", 40, 40, 20, 20], "물리 부족(−20) + 안전재고 20 → 필요 40(물리 지표는 안전재고와 무관)")
  }

  section("OB 시작 재고가 이미 안전재고 미달")
  {
    // 수주 있음: 기준일 즉시
    const r = await suggest({ opening: 10, safety: 20, demands: [[5, "2026-10-12"]] })
    eq([r.row!.breachKind, r.row!.requiredDate, r.row!.finalTargetDeficit, r.row!.rawSuggestedQty], ["IMMEDIATE", "2026-10-01", 15, 15], "시작 10 < 20: 침범일 = 기준일(IMMEDIATE) / 필요 15")
    // 수요 이벤트가 전혀 없는 자재(순수 정책 계산 확인: MRP 범위의 자재는 BOM 소요가 있는 자재뿐이다)
    const view = {
      scheduledReceipts: { baseDate: "2026-10-14" },
      materials: [
        {
          componentItemId: "x", code: "X", name: "X", spec: null, uom: "EA", qtyAvailable: 10, totalRequirement: 0, finalBalance: 10,
          shortageQty: 0, peakShortageQty: 0, scheduledReceiptQty: 0, shortageRecoveredAt: null, nextReceiptDate: null,
          firstShortageDate: null, firstShortageOrderNo: null, steps: [], safetyStock: 20,
        },
      ],
    } as unknown as OrderMrpView
    const rows = buildPurchaseSuggestionRows({ view, suppliersByItem: new Map(), prices: new Map(), draftOpenQty: new Map() })
    eq(
      [rows[0].breachKind, rows[0].requiredDate, rows[0].finalTargetDeficit, rows[0].peakTargetDeficit, rows[0].rawSuggestedQty],
      ["IMMEDIATE", "2026-10-14", 10, 10, 10],
      "수요 없음: 기준일 10/14 즉시 침범 / 최종 미달 10 / 제안 10"
    )
    eq(classifyByPolicy({ safetyStock: 0, finalBalance: 5, minProjectedBalance: 5 }).kind, null, "안전재고 0 · 결품 없음 → 제안 불필요")
  }

  section("물리 재고 불변 / 안전재고 0 = 5C 결과")
  {
    const a = await suggest({ opening: 100, safety: 0, demands: [[90, "2026-10-12"]] })
    const b = await suggest({ opening: 100, safety: 20, demands: [[90, "2026-10-12"]] })
    eq(a.row, undefined, "안전재고 0 이면 100 − 90 = 10 ≥ 0 → 제안 없음")
    eq([b.row!.finalBalance, b.row!.openingStock, b.row!.minProjectedBalance], [10, 100, 10], "안전재고 20 이어도 물리 잔량 계산은 동일")
    const c = await suggest({ opening: 0, safety: 0, demands: [[60, "2026-10-12"]] })
    eq([c.row!.kind, c.row!.suggestedQty, c.row!.peakShortageQty, c.row!.requiredDate, c.row!.breachKind], ["FINAL_SHORTAGE", 60, 60, "2026-10-12", "SHORTAGE"], "안전재고 0 최종 부족: 5C 와 동일(제안 60 / 필요일 10/12)")
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("SW 공급업체 변경 / 구매조건 / 가격")
  {
    const relations = [
      rel("r1", SA, { isDefault: true, leadTimeDays: 7, moq: 100, orderMultiple: 50 }),
      rel("r1", SB, { priority: 5, leadTimeDays: 3, moq: 20, orderMultiple: 10 }),
    ]
    const prices = [
      { id: "pa", tenantId: T1, itemId: "r1", partnerId: "sa", priceType: "PURCHASE", unitPrice: 100, currency: "KRW", effectiveFrom: new Date("2026-01-01"), effectiveTo: null, createdAt: new Date("2026-01-01") },
      { id: "pb", tenantId: T1, itemId: "r1", partnerId: "sb", priceType: "PURCHASE", unitPrice: 120, currency: "KRW", effectiveFrom: new Date("2026-01-01"), effectiveTo: null, createdAt: new Date("2026-01-01") },
    ]
    // 필요 17: opening 0, 안전재고 17 + 수요 없음에 가까운 구조 → opening 3, demand 3(10/20), safety 17 → final 0, min 0 → need 17
    const sc: Scn = { opening: 3, safety: 17, demands: [[3, "2026-10-20"]], relations, prices }
    const { row } = await suggest(sc)
    eq([row!.rawSuggestedQty, row!.recommendedSupplierId, row!.supplierReason], [17, "sa", "DEFAULT"], "필요 17, 기본 공급업체 A")
    eq([row!.suggestedQty, row!.moqApplied, row!.multipleApplied], [100, true, false], "서버 추천(A): 17 → MOQ 100 → 100(배수 50 이미 충족)")
    eq([row!.leadTimeDays, row!.moq, row!.orderMultiple], [7, 100, 50], "추천 공급업체(A) 구매조건")
    eq([row!.breachKind, row!.requiredDate], ["IMMEDIATE", "2026-10-01"], "시작 3 < 17: 필요 입고일 = 기준일")

    const a = row!.suppliers.find((s) => s.supplierId === "sa") as SupplierChoice
    const b = row!.suppliers.find((s) => s.supplierId === "sb") as SupplierChoice
    const dA = deriveForSupplier(row!, a)
    const dB = deriveForSupplier(row!, b)
    eq([dA.qty, dA.price?.unitPrice, dA.timing.status], [100, 100, "OVERDUE"], "A 선택: 100 / 단가 100 / 리드타임 7일 → 발주 필요일 경과")
    eq([dB.qty, dB.price?.unitPrice, dB.timing.status], [20, 120, "OVERDUE"], "B 선택: 17 → MOQ 20 → 20 / 단가 120(다른 공급업체 단가 비혼합)")
    eq((dA.timing as any).orderByDate, "2026-09-24", "A 발주 필요일 = 필요 입고일(기준일 10/01) − 7일 = 9/24")
    eq((dB.timing as any).orderByDate, "2026-09-28", "B 발주 필요일 = 10/01 − 3일 = 9/28")

    // 리드타임 여유가 있는 목표일(수요 10/20 침범): safety 2, opening 5, demand 4 → final 1 < 2
    const later = await suggest({ opening: 5, safety: 2, demands: [[4, "2026-10-20"]], relations, prices })
    const lr = later.row!
    const la = deriveForSupplier(lr, lr.suppliers.find((s) => s.supplierId === "sa")!)
    const lb = deriveForSupplier(lr, lr.suppliers.find((s) => s.supplierId === "sb")!)
    eq([lr.requiredDate, lr.breachKind, lr.rawSuggestedQty], ["2026-10-20", "DEMAND", 1], "침범일 10/20 / 필요 1")
    eq([la.qty, (la.timing as any).orderByDate, la.timing.status], [100, "2026-10-13", "OK"], "A(LT 7): 1 → MOQ 100 / 발주 필요일 10/13 / 여유")
    eq([lb.qty, (lb.timing as any).orderByDate, lb.timing.status], [20, "2026-10-17", "OK"], "B(LT 3): 1 → MOQ 20 / 발주 필요일 10/17")

    // 서버 재검증 (공급업체 B 정책으로 검증, A 정책 혼합 없음)
    const f = makeFakeDb(world({ opening: 5, safety: 2, demands: [[4, "2026-10-20"]], relations, prices }))
    const dep = (db: MrpPurchaseDraftDb) => ({
      authorize: async () => ({ id: "u1", name: "구매담당", tenantId: T1 }),
      db,
      now: NOW,
      lock: f.lock,
    })
    const line = (supplierId: string, qty: number) => ({ lines: [{ itemId: "r1", supplierId, qty, requiredDate: "2026-10-20" }] })
    // MM6 MOQ 미달 / MM7 배수 아님
    const below = await createDraftPurchaseOrdersFromSuggestions(dep(f.db as MrpPurchaseDraftDb), line("sb", 10))
    ok(!below.success && below.code === "SUPPLIER_TERMS_VIOLATION" && /MOQ\) 20 미만/.test(below.error), "MM6 B: 수량 10 < MOQ 20 → 서버 거부")
    const notMultiple = await createDraftPurchaseOrdersFromSuggestions(dep(f.db as MrpPurchaseDraftDb), line("sb", 25))
    ok(!notMultiple.success && /배수 10/.test(notMultiple.error), "MM7 B: 수량 25 는 배수 10 의 배수 아님 → 서버 거부")
    const aBelow = await createDraftPurchaseOrdersFromSuggestions(dep(f.db as MrpPurchaseDraftDb), line("sa", 20))
    ok(!aBelow.success && /MOQ\) 100 미만/.test(aBelow.error), "A: 20 은 A 의 MOQ 100 미달(B 정책으로 통과하지 않음)")
    eq([f.countWrites(), f.tables.purchaseOrder.length], [0, 0], "위반 시 DB write 0 (PO 생성 없음)")
    const okB = await createDraftPurchaseOrdersFromSuggestions(dep(f.db as MrpPurchaseDraftDb), line("sb", 20))
    ok(okB.success, "B: 수량 20 허용(MOQ 20, 배수 10)")
    const okA = await createDraftPurchaseOrdersFromSuggestions(dep(f.db as MrpPurchaseDraftDb), line("sa", 150))
    ok(okA.success, "A: 수량 150 허용(MOQ 100, 배수 50)")
    // 헤더 입고예정일 = 목표 입고일(리드타임이 바꾸지 않는다)
    if (okB.success) {
      eq(okB.data.orders[0].expectedDate, "2026-10-20", "헤더 입고예정일은 목표 입고일(리드타임으로 이동하지 않음)")
      eq([okB.data.orders[0].leadTimeOverdueLineCount, okB.data.orders[0].leadTimeMissingLineCount], [0, 0], "발주 필요일 경과/미등록 없음")
    }
    const audit = f.tables.auditLog.find((l) => l.afterData?.supplierId === "sb")
    eq(
      [audit?.afterData.items[0].moq, audit?.afterData.items[0].orderMultiple, audit?.afterData.items[0].leadTimeDays, audit?.afterData.items[0].orderByDate, audit?.afterData.items[0].safetyStock],
      [20, 10, 3, "2026-10-17", 2],
      "감사로그: MOQ / 배수 / 리드타임 / 발주 필요일 / 안전재고 요약"
    )
    // 구매조건 없는 공급업체(MM8): 사용자 수량 그대로
    const g = makeFakeDb(world({ opening: 5, safety: 2, demands: [[4, "2026-10-20"]], relations: [rel("r1", SA, { isDefault: true })] }))
    const free = await createDraftPurchaseOrdersFromSuggestions(
      { authorize: async () => ({ id: "u1", tenantId: T1 }), db: g.db as MrpPurchaseDraftDb, now: NOW, lock: g.lock },
      line("sa", 7.77)
    )
    ok(free.success, "MM8 MOQ/배수 null: 사용자 수량 7.77 그대로 허용")

    // 구매조건 데이터 오류(0 이하)는 생성하지 않는다
    const h = makeFakeDb(world({ opening: 5, safety: 2, demands: [[4, "2026-10-20"]], relations: [rel("r1", SA, { moq: 0 as any, isDefault: true })] }))
    const invalid = await createDraftPurchaseOrdersFromSuggestions(
      { authorize: async () => ({ id: "u1", tenantId: T1 }), db: h.db as MrpPurchaseDraftDb, now: NOW, lock: h.lock },
      line("sa", 5)
    )
    ok(!invalid.success && invalid.code === "SUPPLIER_TERMS_VIOLATION" && h.countWrites() === 0, "MOQ 0(데이터 오류) → 생성 거부, write 0")
  }

  section("LT 경과/미등록 알림(생성은 허용)")
  {
    const relations = [rel("r1", SA, { isDefault: true, leadTimeDays: 7 }), rel("r1", SB, { priority: 5 })]
    const f = makeFakeDb(world({ opening: 0, demands: [[10, "2026-10-04"]], relations }))
    const dep = { authorize: async () => ({ id: "u1", tenantId: T1 }), db: f.db as MrpPurchaseDraftDb, now: NOW, lock: f.lock }
    // 필요 10/04, LT 7 → 발주 필요일 9/27 < 기준 10/01 → 경과
    const r = await createDraftPurchaseOrdersFromSuggestions(dep, { lines: [{ itemId: "r1", supplierId: "sa", qty: 10, requiredDate: "2026-10-04" }] })
    ok(r.success && r.data.orders[0].leadTimeOverdueLineCount === 1, "발주 필요일 경과 라인 1건 알림 + 생성 허용")
    const m = await createDraftPurchaseOrdersFromSuggestions(dep, { lines: [{ itemId: "r1", supplierId: "sb", qty: 10, requiredDate: "2026-10-04" }] })
    ok(m.success && m.data.orders[0].leadTimeMissingLineCount === 1, "리드타임 미등록 라인 1건 알림 + 생성 허용")
    const { row } = await suggest({ opening: 0, demands: [[10, "2026-10-04"]], relations })
    eq([row!.orderTiming, row!.orderByDate, row!.orderOverdueDays], ["OVERDUE", "2026-09-27", 4], "제안 행: 발주 필요일 9/27, 4일 경과")
    const noLt = await suggest({ opening: 0, demands: [[10, "2026-10-04"]], relations: [rel("r1", SB, { isDefault: true })] })
    eq([noLt.row!.orderTiming, noLt.row!.orderByDate], ["LEAD_TIME_MISSING", null], "리드타임 미등록: 발주 필요일 없음")
    eq(noLt.p.policySummary.leadTimeMissingCount, 1, "KPI 리드타임 미등록 1")
    eq(row === undefined ? 0 : (await suggest({ opening: 0, demands: [[10, "2026-10-04"]], relations })).p.policySummary.orderOverdueCount, 1, "KPI 발주 필요일 경과 1")
  }

  section("DRAFT 는 안전재고/예정입고 계산에 가산하지 않음")
  {
    const f = makeFakeDb(world({ opening: 50, safety: 20, demands: [[45, "2026-10-12"]] }))
    const before = await loadPurchaseSuggestions(f.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: true })
    const created = await createDraftPurchaseOrdersFromSuggestions(
      { authorize: async () => ({ id: "u1", tenantId: T1 }), db: f.db as MrpPurchaseDraftDb, now: NOW, lock: f.lock },
      { lines: [{ itemId: "r1", supplierId: "sa", qty: 15, requiredDate: "2026-10-12" }] }
    )
    ok(created.success, "DRAFT 생성")
    const after = await loadPurchaseSuggestions(f.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: true })
    eq(
      [after.rows[0].finalBalance, after.rows[0].rawSuggestedQty, after.rows[0].scheduledReceiptQty],
      [before.rows[0].finalBalance, before.rows[0].rawSuggestedQty, 0],
      "DRAFT 생성 후에도 최종 예상재고/정책 필요량/예정입고 불변(ORDERED 이후에만 반영)"
    )
    eq(after.rows[0].draftOpenQty, 15, "참고: DRAFT 미입고 15 표시")
  }

  section("쿼리 수 / N+1 없음 (안전재고는 BOM 구성품 조회에 포함)")
  {
    const comps = Array.from({ length: 300 }, (_, i) => ({ id: "m" + i, code: "M" + i, safetyStock: 5 + (i % 7) }))
    const f = makeFakeDb({
      salesOrderItem: [soLine("l1", "SO-1", 10, "2026-10-12")],
      bOM: [bomOf(comps)],
      inventoryBalance: comps.map((c) => bal(c.id, 12)),
      purchaseOrder: [],
      purchaseOrderItem: [],
      itemSupplier: comps.map((c) => rel(c.id, SA, { isDefault: true, leadTimeDays: 5, moq: 10, orderMultiple: 5 })),
      itemPrice: [],
      site: [{ id: "site-1", tenantId: T1, name: "본사공장" }],
    })
    const p = await loadPurchaseSuggestions(f.db as PurchaseSuggestionDb, T1, params, { now: NOW, includePrices: true })
    eq(p.diagnostics.queryCount, f.reads.length, "보고된 쿼리 수 = 실제 조회 수")
    eq(p.diagnostics.queryCount, 8, "자재 300종(안전재고 포함)도 8쿼리(5C 와 동일, 추가 쿼리 0)")
    ok(p.rows.length === 300 && p.rows.every((r) => r.safetyStock > 0), "300종 모두 안전재고를 읽어 정책 반영")
    eq(f.reads.filter((r) => r.model === "item").length, 0, "자재별 Item 조회 없음")
  }

  section("품목 안전재고 입력 검증 / 정적 점검")
  {
    eq([normalizeSafetyStock(undefined), normalizeSafetyStock(null), normalizeSafetyStock(0), normalizeSafetyStock(12.5)], [0, 0, 0, 12.5], "미지정 → 0 (기존 Excel 업로드 호환), 소수 허용")
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1e12, 0.0000001, "5" as unknown as number]) {
      assert.throws(() => normalizeSafetyStock(bad), /INVALID_SAFETY_STOCK/)
      passed += 1
      console.log(`PASS 안전재고 ${String(bad)} 거부`)
    }
    ok(isValidSafetyStock(999_999_999_999) === true && isValidSafetyStock(1e12) === false, "상한 경계(1e12 미만)")

    const root = join(__dirname, "..")
    const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8")
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    const schema = read("prisma", "schema.prisma").replace(/\r/g, "")
    const itemModel = /model Item \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? ""
    ok(/\n\s+safetyStock\s+Float\s+@default\(0\)/.test(itemModel), "schema: Item.safetyStock Float @default(0) (NOT NULL)")
    const sm = /model ItemSupplier \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? ""
    ok(!/safetyStock\s/.test(sm.replace(/\/\/.*$/gm, "")), "안전재고는 ItemSupplier 에 두지 않는다")

    const migDir = "20261014010000_add_item_safety_stock"
    ok(readdirSync(join(root, "prisma", "migrations")).includes(migDir), "Phase 5D migration 존재")
    const sql = read("prisma", "migrations", migDir, "migration.sql")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
    ok(/ALTER TABLE "Item" ADD COLUMN\s+"safetyStock" DOUBLE PRECISION NOT NULL DEFAULT 0/.test(sql), "migration: NOT NULL DEFAULT 0 컬럼 추가(기존 행 0)")
    ok(/CHECK \("safetyStock" >= 0 AND "safetyStock" < 1000000000000\)/.test(sql), "migration: 음수/NaN/Infinity 차단 CHECK")
    ok(!/CREATE TABLE|DROP |TRUNCATE|DELETE FROM|ENABLE ROW LEVEL SECURITY/.test(sql), "migration: additive(신규 테이블/삭제/RLS 변경 없음)")
    ok(readdirSync(join(root, "prisma", "migrations")).filter((n) => /^\d{14}_/.test(n)).length === 4, "migration 4건(baseline, hardening, 5A, 5D)")

    const itemActions = code(read("src", "lib", "actions", "item.actions.ts"))
    ok((itemActions.match(/normalizeSafetyStock\(data\.safetyStock\)/g) ?? []).length === 2, "품목 등록/수정 모두 서버에서 안전재고 검증")
    ok(!/safetyStock/.test(code(read("src", "lib", "actions", "item-excel.actions.ts"))), "품목 Excel 업로드는 변경하지 않음(DB default 0 으로 정상 동작)")
    ok(/safetyStock: z\.coerce/.test(read("src", "app", "app", "mes", "items", "item-form-schema.ts")), "품목 폼 스키마: 안전재고(0 이상)")

    // 엔진은 안전재고를 알지 못한다(물리 재고 시간축 불변)
    ok(!/safetyStock|safety/i.test(code(read("src", "lib", "mrp", "order-mrp-engine.ts"))), "MRP 엔진: 안전재고 개념 없음(Golden 불변)")
    const suggestion = code(read("src", "lib", "mrp", "purchase-suggestion.ts"))
    ok(!/qtyAvailable\s*-\s*safety|openingStock\s*-\s*safety/.test(suggestion), "openingStock 에서 안전재고를 빼지 않음")
    const draft = code(read("src", "lib", "services", "mrp-purchase-draft.service.ts"))
    ok(/validateQtyAgainstTerms\(l\.qty, terms\)/.test(draft) && /status: "DRAFT"/.test(draft), "서버 생성: MOQ/배수 재검증 + DRAFT 고정")
    ok(!/PO-MRP|Date\.now/.test(draft), "임의 번호/시각 없음")
    ok(!/netting/i.test(draft + suggestion), "Phase 5E(반제품 netting) 미사용")
  }

  console.log(`\n✅ mrp-purchase-policy: ${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
