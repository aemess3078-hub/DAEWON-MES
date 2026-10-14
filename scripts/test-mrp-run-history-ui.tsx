/**
 * Phase 6 — MRP 실행이력 / DRAFT Coverage 화면 렌더링 테스트 (SSR 정적 렌더, 브라우저/DB 없음)
 *
 * 실행: npm run test:mrp-run-history-ui
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MrpRunDetailView, MrpRunListTable } from "../src/app/app/mes/mrp/mrp-run-views"
import {
  PurchaseSuggestionTable,
  rowNeedsOverride,
  type SuggestionRowEdit,
  type SuggestionTableRow,
} from "../src/app/app/mes/mrp/purchase-suggestion-table"
import type { MrpRunSnapshot } from "../src/lib/mrp/mrp-run-snapshot"
import type { MrpRunDetail, MrpRunListItem } from "../src/lib/services/mrp-run.service"

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log("PASS " + label)
}

// ── 목록 ─────────────────────────────────────────────────────────────────────
function item(over: Partial<MrpRunListItem> = {}): MrpRunListItem {
  return {
  id: "run-1",
  runType: "ORDER_MRP",
  mode: "NORMAL",
  status: "SAVED",
  baseDate: "2026-10-14",
  fromDate: "2026-10-01",
  toDate: "2026-10-31",
  includeDraft: false,
  demandLineCount: 66,
  materialCount: 273,
  shortageMaterialCount: 12,
  purchaseNeededCount: 9,
  warningCount: 2,
  purchaseOrderCount: 3,
  createdByName: "홍길동",
  createdAt: "2026-10-14T01:30:00.000Z",
  ...over,
  }
}
{
  const html = renderToStaticMarkup(
    <MrpRunListTable items={[item(), item({ id: "run-2", fromDate: null, toDate: null, includeDraft: true, createdByName: null })]} page={1} totalPages={3} total={45} onOpen={() => {}} onPage={() => {}} />
  )
  for (const h of ["실행일시", "실행자", "유형", "기간", "자재 수", "구매 필요 자재", "경고", "생성 PO", "상태"]) ok(html.includes(h), `목록 열: ${h}`)
  ok(html.includes("2026-10-14 10:30"), "실행일시는 KST 로 표시(UTC 01:30 → 10:30)")
  ok(html.includes("2026-10-01 ~ 2026-10-31") && html.includes("전체 기간"), "기간 / 전체 기간 표시")
  ok(html.includes("홍길동") && html.includes("수주기준 MRP") && html.includes("저장됨"), "실행자/유형/상태")
  ok(html.includes("총 45건") && html.includes("1 / 3 페이지") && html.includes("이전") && html.includes("다음"), "페이지네이션")
  ok(html.includes("상세 보기"), "상세 진입")
  const empty = renderToStaticMarkup(<MrpRunListTable items={[]} page={1} totalPages={1} total={0} onOpen={() => {}} onPage={() => {}} />)
  ok(empty.includes("저장된 MRP 실행이력이 없습니다"), "빈 목록 안내")
}

// ── 상세 ─────────────────────────────────────────────────────────────────────
const snapshot: MrpRunSnapshot = {
  version: 1,
  generatedAt: "2026-10-14T01:30:00.000Z",
  meta: { runType: "ORDER_MRP", mode: "NORMAL", baseDate: "2026-10-14", from: null, to: null, includeDraft: false, includeScheduledReceipts: true, semiFinishedNetting: true },
  summary: {
    demandLineCount: 66,
    requiredMaterialCount: 273,
    shortageMaterialCount: 12,
    temporaryShortageMaterialCount: 1,
    scheduledReceiptMaterialCount: 40,
    overdueReceiptCount: 2,
    purchaseNeededCount: 9,
    safetyStockCount: 3,
    coveredCount: 4,
    partialCoverageCount: 1,
    bomIssueLineCount: 0,
    warningCount: 2,
    semiNettedMaterialCount: 1,
  },
  scheduledReceipts: { appliedReceiptCount: 55, appliedMaterialCount: 40, excludedOutsourcingCount: 1, overdue: [] },
  warnings: [{ code: "W", severity: "WARNING", message: "경고 메시지 예시" }],
  excludedLines: [],
  stepColumns: [],
  receiptColumns: [],
  materials: [
    {
      id: "r1",
      code: "RM-1",
      name: "원자재1",
      spec: null,
      uom: "EA",
      itemType: "RAW_MATERIAL",
      qtyOnHand: 0,
      qtyHold: 0,
      qtyAvailable: 8,
      qtyExcludedByLot: 0,
      totalRequirement: 36,
      finalBalance: -28,
      shortageQty: 28,
      firstShortageDate: "2026-10-20",
      firstShortageOrderNo: "SO-1",
      scheduledReceiptQty: 0,
      scheduledReceiptCount: 0,
      nextReceiptDate: null,
      overdueReceiptQty: 0,
      peakShortageQty: 28,
      temporaryShortage: false,
      shortageRecoveredAt: null,
      safetyStock: 5,
      netting: { grossQty: 20, usedQty: 8, netQty: 12 },
      steps: [],
      stepsOmitted: false,
      receipts: [],
    },
  ],
  suggestions: [
    {
      itemId: "r1",
      code: "RM-1",
      name: "원자재1",
      uom: "EA",
      kind: "FINAL_SHORTAGE",
      autoSuggest: true,
      safetyStock: 5,
      openingStock: 8,
      finalBalance: -28,
      minProjectedBalance: -28,
      peakShortageQty: 28,
      finalShortageQty: 28,
      scheduledReceiptQty: 0,
      totalRequirement: 36,
      rawNeed: 100,
      suggestedQty: 100,
      draftCoverageQty: 80,
      draftCoverageBySupplier: { sa: 80 },
      draftOrders: [{ orderNo: "PO-2026-000012", supplierId: "sa", qty: 80 }],
      remainingRawNeed: 20,
      additionalQty: 50,
      coverageStatus: "PARTIAL",
      requiredDate: "2026-10-20",
      orderByDate: "2026-10-13",
      orderTiming: "OK",
      breachKind: "SHORTAGE",
      recommendedSupplierId: "sa",
      supplierReason: "DEFAULT",
      leadTimeDays: 7,
      moq: 50,
      orderMultiple: 10,
      moqApplied: false,
      multipleApplied: false,
      termsInvalid: false,
      suppliers: [{ supplierId: "sa", supplierCode: "SA", supplierName: "가나공급", isDefault: true, priority: 100, leadTimeDays: 7, moq: 50, orderMultiple: 10 }],
    },
  ],
  compacted: false,
}
const detail: MrpRunDetail = {
  run: { ...item(), snapshotVersion: 1, sourceHash: "a".repeat(64), resultHash: "b".repeat(64) },
  snapshot,
  purchases: [
    { id: "mp-1", purchaseOrderId: "po-1", orderNo: "PO-2026-000020", supplierId: "sa", supplierName: "가나공급", currentStatus: "ORDERED", itemCount: 1, totalQty: 50, overrideUsed: false, overrideReason: null, lines: [], createdByName: "홍길동", createdAt: "2026-10-14T02:00:00.000Z" },
    { id: "mp-2", purchaseOrderId: null, orderNo: "PO-2026-000021", supplierId: "sb", supplierName: "다라상사", currentStatus: "DELETED", itemCount: 1, totalQty: 10, overrideUsed: true, overrideReason: "RM-1: 고객 긴급 추가 주문", lines: [], createdByName: "홍길동", createdAt: "2026-10-14T02:05:00.000Z" },
  ],
}
{
  const html = renderToStaticMarkup(<MrpRunDetailView detail={detail} onBack={() => {}} />)
  ok(html.includes("MRP 실행 상세") && html.includes("홍길동") && html.includes("기준일 2026-10-14"), "상세: 실행자/기준일")
  ok(html.includes("저장된 실행 결과(Snapshot)") && html.includes("다시 계산하지 않습니다"), "상세: 저장 값 / 재계산 없음 라벨")
  ok(html.includes("MRP 정책 필요량") && html.includes("기존 DRAFT(미확정)") && html.includes("추가 DRAFT 제안"), "상세: 정책 필요량 / 기존 DRAFT / 추가 DRAFT 제안 열")
  ok(html.includes("PO-2026-000012") && html.includes("일부 충족"), "상세: 당시 DRAFT 발주번호 / 충족 상태")
  ok(html.includes("LT 7일") && html.includes("MOQ 50") && html.includes("배수 10") && html.includes("가나공급"), "상세: 추천 공급업체 / LT / MOQ / 배수")
  ok(html.includes("총 20 − 재고 사용 8 = 순소요 12"), "상세: 반제품 Netting 요약")
  ok(html.includes("발주완료") && html.includes("삭제됨"), "상세: 연결 PO 의 현재 상태(발주완료 / 삭제됨)")
  ok(html.includes("PO-2026-000021") && html.includes("고객 긴급 추가 주문"), "상세: 삭제된 PO 도 발주번호/추가 발주 사유 보존")
  ok(html.includes("DRAFT 구매발주는 확정 공급이 아니므로"), "상세: DRAFT 는 입고예정/예상재고가 아님을 안내")
  ok(html.includes("기존 DRAFT로 충족") && html.includes("구매 필요 자재"), "상세: KPI")
  ok(html.includes("목록으로"), "상세: 목록으로")
}

// ── 발주제안 표: DRAFT Coverage ────────────────────────────────────────────────
function row(over: Partial<SuggestionTableRow> = {}): SuggestionTableRow {
  return {
    componentItemId: "r1",
    code: "R1",
    name: "자재1",
    spec: null,
    uom: "EA",
    kind: "FINAL_SHORTAGE",
    qtyAvailable: 0,
    totalRequirement: 100,
    scheduledReceiptQty: 0,
    peakShortageQty: 100,
    finalShortageQty: 100,
    suggestedQty: 100,
    requiredDate: "2026-10-20",
    firstShortageOrderNo: "SO-1",
    shortageRecoveredAt: null,
    nextReceiptDate: null,
    recommendedSupplierId: "sa",
    supplierReason: "DEFAULT",
    suppliers: [
      { supplierId: "sa", supplierCode: "SA", supplierName: "가나공급", isDefault: true, priority: 100, leadTimeDays: 7, moq: 50, orderMultiple: 10, price: null },
      { supplierId: "sb", supplierCode: "SB", supplierName: "다라상사", isDefault: false, priority: 200, leadTimeDays: 5, moq: null, orderMultiple: null, price: null },
    ],
    draftOpenQty: 80,
    safetyStock: 0,
    openingStock: 0,
    finalBalance: -100,
    minProjectedBalance: -100,
    finalTargetDeficit: 100,
    peakTargetDeficit: 100,
    rawSuggestedQty: 100,
    breachKind: "SHORTAGE",
    firstBreachOrderNo: "SO-1",
    leadTimeDays: 7,
    moq: 50,
    orderMultiple: 10,
    moqApplied: false,
    multipleApplied: false,
    termsInvalid: false,
    orderByDate: "2026-10-13",
    orderTiming: "OK",
    orderOverdueDays: 0,
    baseDate: "2026-10-01",
    draftCoverageQty: 80,
    draftCoverageBySupplier: { sa: 80 },
    draftOrders: [{ orderNo: "PO-2026-000012", supplierId: "sa", qty: 80 }],
    draftOrderCount: 1,
    remainingRawNeed: 20,
    additionalQty: 50,
    coverageStatus: "PARTIAL",
    ...over,
  }
}
const edit = (over: Partial<SuggestionRowEdit> = {}): SuggestionRowEdit => ({ selected: false, qty: "50", supplierId: "sa", requiredDate: "2026-10-20", ...over })
const renderTable = (rows: SuggestionTableRow[], edits: Record<string, SuggestionRowEdit>) =>
  renderToStaticMarkup(<PurchaseSuggestionTable rows={rows} edits={edits} priceVisible={false} onChange={() => {}} onToggleAll={() => {}} />)

{
  const partial = renderTable([row()], { r1: edit() })
  ok(partial.includes("MRP 정책 필요량 100"), "표: MRP 정책 필요량 100")
  ok(partial.includes("기존 DRAFT(미확정) 80") && partial.includes("추가 DRAFT 필요 20"), "표: 기존 DRAFT 80 / 추가 DRAFT 필요 20")
  ok(partial.includes("→ MOQ 50"), "표: 남은 20 에 MOQ 50 적용 표시")
  ok(partial.includes("DRAFT 는 입고예정/재고가 아닙니다"), "표: DRAFT 는 입고예정/재고가 아님")
  ok(partial.includes("PO-2026-000012"), "표: 기존 DRAFT 발주번호")
  ok(partial.includes("기존 DRAFT 일부 충족"), "표: 일부 충족 칩")
  ok(!partial.includes("추가 발주 확인"), "추가분이 있으면 override 입력 없음")

  const covered = row({ draftCoverageQty: 110, draftOpenQty: 110, draftCoverageBySupplier: { sa: 110 }, remainingRawNeed: 0, additionalQty: 0, coverageStatus: "COVERED" })
  const unselected = renderTable([covered], { r1: edit({ qty: "" }) })
  ok(unselected.includes("기존 DRAFT 발주로 제안량 충족") && unselected.includes("기존 DRAFT 충족"), "표: 충족 → '기존 DRAFT 발주로 제안량 충족' 상태")
  ok(!unselected.includes("추가 발주 사유"), "선택하지 않으면 override 입력 숨김")
  const selected = renderTable([covered], { r1: edit({ qty: "10", selected: true }) })
  ok(selected.includes("추가 발주 확인") && selected.includes("추가 발주 사유"), "충족 품목을 선택하면 확인 + 사유 입력 노출")
  ok(selected.includes("disabled") , "확인 전에는 사유 입력 비활성")
  const confirmed = renderTable([covered], { r1: edit({ qty: "10", selected: true, override: true, overrideReason: "긴급 추가" }) })
  ok(confirmed.includes("긴급 추가"), "사유 값 표시")

  const other = renderTable([row({ draftCoverageBySupplier: { sb: 80 }, draftOrders: [{ orderNo: "PO-2026-000030", supplierId: "sb", qty: 80 }] })], { r1: edit() })
  ok(other.includes("다른 공급업체 DRAFT 80 존재"), "표: 다른 공급업체 DRAFT 존재")

  ok(rowNeedsOverride(covered, "sa") === true && rowNeedsOverride(row(), "sa") === false, "rowNeedsOverride: 남은 필요량 0 일 때만")
  const noCoverage = row()
  delete (noCoverage as Partial<SuggestionTableRow>).draftCoverageQty
  ok(rowNeedsOverride(noCoverage, "sa") === false, "Coverage 정보가 없는(5C/5D 형) 행은 override 없음")
  const legacy = renderTable([noCoverage], { r1: edit() })
  ok(legacy.includes("DRAFT 발주 80") && !legacy.includes("추가 DRAFT 필요"), "Coverage 정보가 없으면 기존 5C/5D 표시 그대로")

  const temporary = row({ kind: "TEMPORARY_SHORTAGE", rawSuggestedQty: 0, additionalQty: 0, remainingRawNeed: 0, draftCoverageQty: 0, draftOpenQty: 0, draftCoverageBySupplier: {}, draftOrders: [], coverageStatus: "NONE" })
  const tempSel = renderTable([temporary], { r1: edit({ qty: "10", selected: true }) })
  ok(tempSel.includes("추가 발주 확인"), "일시 결품(필요 0) 행을 직접 발주하려면 확인 + 사유 필요(서버 규칙과 동일)")
}

// ── 타이포그래피 (CLAUDE.md: 13px 미만 최소화) ─────────────────────────────────
{
  const root = join(__dirname, "..")
  for (const f of ["mrp-run-views.tsx", "mrp-run-history-panel.tsx"]) {
    const src = readFileSync(join(root, "src", "app", "app", "mes", "mrp", f), "utf8")
    ok(!/text-\[(?:9|10|11|12)px\]|text-xs\b/.test(src), `${f}: 13px 미만 글꼴 없음`)
  }
}

console.log(`\n✅ mrp-run-history-ui: ${passed} checks passed`)
