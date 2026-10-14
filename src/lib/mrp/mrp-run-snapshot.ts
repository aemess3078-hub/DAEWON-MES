/**
 * MRP 실행 Snapshot 빌더 (순수 모듈 — DB/Prisma 비의존, node crypto 만 사용) — Phase 6
 *
 *   OrderMrpView + 발주제안 행(PurchaseSuggestionLine[])  ──>  불변 Snapshot(JSON) + 목록/검색용 요약 + 해시
 *
 * 원칙
 *  - Snapshot 은 "당시 계산 결과 값"이다. 이후 화면은 다시 계산하지 않고 저장된 값을 보여 준다.
 *  - 업무 데이터만 담는다(수요/재고/예정입고/반제품 Netting/안전재고/공급업체 정책/제안량/DRAFT Coverage).
 *    화이트리스트 필드만 복사하며 DB URL / 토큰 / 세션 / 비밀번호 / tenantId / 단가(가격 권한 분리)는 넣지 않는다.
 *  - DRAFT 구매발주는 재고/입고예정이 아니다. Coverage 는 별도 필드(draftCoverageQty 등)로만 기록한다.
 *  - 크기: 단계(steps)는 컬럼 배열(tuple)로 저장하고, 상한(MAX_SNAPSHOT_BYTES)을 넘으면 "주의가 필요 없는 자재"의 단계만 생략한다.
 *    그래도 넘으면 저장하지 않는다(SnapshotTooLargeError).
 *  - 해시: sourceHash = 입력(수요/재고/예정입고/정책/Coverage) 기준, resultHash = 생성 시각을 제외한 Snapshot 전체.
 *    canonical JSON(키 정렬)이므로 같은 입력이면 같은 해시다.
 */

import { createHash } from "node:crypto"
import type { OrderMrpMaterialView, OrderMrpView } from "./order-mrp-adapter"
import type { PurchaseSuggestionLine } from "./purchase-suggestion"
import { AUTO_SUGGEST_KINDS } from "./purchase-suggestion"

export const MRP_SNAPSHOT_VERSION = 1
/** Snapshot JSON 상한(바이트). 273 자재 × 66 단계 기준 실측은 docs/DAEWON-MRP-PHASE6.md 참고 */
export const MAX_SNAPSHOT_BYTES = 6 * 1024 * 1024

/** [orderNo, customerName, productCode, deliveryDate, demandQty, requirement, balanceBefore, balanceAfter] */
export const SNAPSHOT_STEP_COLUMNS = [
  "orderNo",
  "customerName",
  "productCode",
  "deliveryDate",
  "demandQty",
  "requirement",
  "balanceBefore",
  "balanceAfter",
] as const
export type SnapshotStepTuple = [string, string | null, string, string | null, number, number, number, number]

/** [referenceNo(발주번호), expectedDate, quantity, supplierName] */
export const SNAPSHOT_RECEIPT_COLUMNS = ["purchaseOrderNo", "date", "quantity", "supplierName"] as const
export type SnapshotReceiptTuple = [string, string | null, number, string | null]

export type SnapshotMaterial = {
  id: string
  code: string
  name: string
  spec: string | null
  uom: string
  itemType: string
  qtyOnHand: number
  qtyHold: number
  qtyAvailable: number
  qtyExcludedByLot: number
  totalRequirement: number
  finalBalance: number
  shortageQty: number
  firstShortageDate: string | null
  firstShortageOrderNo: string | null
  scheduledReceiptQty: number
  scheduledReceiptCount: number
  nextReceiptDate: string | null
  overdueReceiptQty: number
  peakShortageQty: number
  temporaryShortage: boolean
  shortageRecoveredAt: string | null
  safetyStock: number
  /** 반제품 Netting 누계(재고를 사용한 반제품만) */
  netting: { grossQty: number; usedQty: number; netQty: number } | null
  /** SNAPSHOT_STEP_COLUMNS 순서. stepsOmitted 이면 생략됨 */
  steps: SnapshotStepTuple[]
  stepsOmitted: boolean
  /** 반영된 입고예정(ORDERED / PARTIAL_RECEIVED 만. DRAFT 아님) — SNAPSHOT_RECEIPT_COLUMNS 순서 */
  receipts: SnapshotReceiptTuple[]
}

export type SnapshotSuggestion = {
  itemId: string
  code: string
  name: string
  uom: string
  kind: string
  autoSuggest: boolean
  safetyStock: number
  openingStock: number
  finalBalance: number
  minProjectedBalance: number
  peakShortageQty: number
  finalShortageQty: number
  scheduledReceiptQty: number
  totalRequirement: number
  /** 구매조건 적용 전 정책 필요량(DRAFT 미고려) */
  rawNeed: number
  /** 추천 공급업체 구매조건을 적용한 MRP 제안량(DRAFT 미고려) */
  suggestedQty: number
  /** 당시 활성 DRAFT 미입고 합계(입고예정/재고 아님) */
  draftCoverageQty: number
  draftCoverageBySupplier: Record<string, number>
  draftOrders: Array<{ orderNo: string; supplierId: string; qty: number }>
  remainingRawNeed: number
  /** 기존 DRAFT 를 반영한 추가 DRAFT 제안량 */
  additionalQty: number
  coverageStatus: string
  requiredDate: string | null
  orderByDate: string | null
  orderTiming: string
  breachKind: string
  recommendedSupplierId: string | null
  supplierReason: string
  /** 추천 공급업체 구매조건(당시) */
  leadTimeDays: number | null
  moq: number | null
  orderMultiple: number | null
  moqApplied: boolean
  multipleApplied: boolean
  termsInvalid: boolean
  suppliers: Array<{
    supplierId: string
    supplierCode: string
    supplierName: string
    isDefault: boolean
    priority: number
    leadTimeDays: number | null
    moq: number | null
    orderMultiple: number | null
  }>
}

export type MrpRunSnapshot = {
  version: typeof MRP_SNAPSHOT_VERSION
  generatedAt: string
  meta: {
    runType: "ORDER_MRP"
    mode: "NORMAL"
    baseDate: string
    from: string | null
    to: string | null
    includeDraft: boolean
    includeScheduledReceipts: true
    semiFinishedNetting: true
  }
  summary: {
    demandLineCount: number
    requiredMaterialCount: number
    shortageMaterialCount: number
    temporaryShortageMaterialCount: number
    scheduledReceiptMaterialCount: number
    overdueReceiptCount: number
    purchaseNeededCount: number
    safetyStockCount: number
    coveredCount: number
    partialCoverageCount: number
    bomIssueLineCount: number
    warningCount: number
    semiNettedMaterialCount: number
  }
  scheduledReceipts: {
    appliedReceiptCount: number
    appliedMaterialCount: number
    excludedOutsourcingCount: number
    overdue: Array<{
      purchaseOrderNo: string
      supplierName: string | null
      itemCode: string
      expectedDate: string
      openQty: number
      daysOverdue: number
    }>
  }
  warnings: Array<{ code: string; severity: string; message: string; orderNo?: string; itemCode?: string }>
  excludedLines: Array<{ reason: string; orderNo: string; itemCode: string; deliveryDate: string | null; remainingQty: number | null }>
  stepColumns: readonly string[]
  receiptColumns: readonly string[]
  materials: SnapshotMaterial[]
  suggestions: SnapshotSuggestion[]
  /** steps 를 생략해 크기를 줄였는가 */
  compacted: boolean
}

export class SnapshotTooLargeError extends Error {
  readonly isSnapshotTooLarge = true
  constructor(readonly bytes: number, readonly limit: number) {
    super(`MRP Snapshot 이 너무 큽니다(${bytes} > ${limit} bytes).`)
    Object.setPrototypeOf(this, SnapshotTooLargeError.prototype)
  }
}
export const isSnapshotTooLarge = (e: unknown): e is SnapshotTooLargeError =>
  typeof e === "object" && e !== null && (e as { isSnapshotTooLarge?: boolean }).isSnapshotTooLarge === true

/** 키 정렬 canonical JSON(해시용). undefined 는 생략, 비유한 숫자는 null. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") {
      if (typeof v === "number" && !Number.isFinite(v)) return null
      return v
    }
    if (Array.isArray(v)) return v.map(norm)
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k]
      if (x !== undefined) out[k] = norm(x)
    }
    return out
  }
  return JSON.stringify(norm(value))
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function r6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

function buildMaterial(m: OrderMrpMaterialView, omitSteps: boolean): SnapshotMaterial {
  const receipts: SnapshotReceiptTuple[] = []
  for (const ev of m.timeline) {
    if (ev.type === "SCHEDULED_RECEIPT") receipts.push([ev.referenceNo, ev.date, ev.quantity, ev.partyName])
  }
  return {
    id: m.componentItemId,
    code: m.code,
    name: m.name,
    spec: m.spec,
    uom: m.uom,
    itemType: m.itemType,
    qtyOnHand: m.qtyOnHand,
    qtyHold: m.qtyHold,
    qtyAvailable: m.qtyAvailable,
    qtyExcludedByLot: m.qtyExcludedByLot,
    totalRequirement: m.totalRequirement,
    finalBalance: m.finalBalance,
    shortageQty: m.shortageQty,
    firstShortageDate: m.firstShortageDate,
    firstShortageOrderNo: m.firstShortageOrderNo,
    scheduledReceiptQty: m.scheduledReceiptQty,
    scheduledReceiptCount: m.scheduledReceiptCount,
    nextReceiptDate: m.nextReceiptDate,
    overdueReceiptQty: m.overdueReceiptQty,
    peakShortageQty: m.peakShortageQty,
    temporaryShortage: m.temporaryShortage,
    shortageRecoveredAt: m.shortageRecoveredAt,
    safetyStock: m.safetyStock ?? 0,
    netting: m.netting ? { grossQty: m.netting.grossQty, usedQty: m.netting.usedQty, netQty: m.netting.netQty } : null,
    steps: omitSteps
      ? []
      : m.steps.map(
          (s): SnapshotStepTuple => [
            s.orderNo,
            s.customerName,
            s.itemCode,
            s.deliveryDate,
            s.demandQty,
            s.requirement,
            s.balanceBefore,
            s.balanceAfter,
          ]
        ),
    stepsOmitted: omitSteps,
    receipts,
  }
}

function buildSuggestion(r: PurchaseSuggestionLine): SnapshotSuggestion {
  return {
    itemId: r.componentItemId,
    code: r.code,
    name: r.name,
    uom: r.uom,
    kind: r.kind,
    autoSuggest: AUTO_SUGGEST_KINDS.includes(r.kind),
    safetyStock: r.safetyStock,
    openingStock: r.openingStock,
    finalBalance: r.finalBalance,
    minProjectedBalance: r.minProjectedBalance,
    peakShortageQty: r.peakShortageQty,
    finalShortageQty: r.finalShortageQty,
    scheduledReceiptQty: r.scheduledReceiptQty,
    totalRequirement: r.totalRequirement,
    rawNeed: r.rawSuggestedQty,
    suggestedQty: r.suggestedQty,
    draftCoverageQty: r.draftCoverageQty,
    draftCoverageBySupplier: { ...r.draftCoverageBySupplier },
    draftOrders: r.draftOrders.map((o) => ({ orderNo: o.orderNo, supplierId: o.supplierId, qty: o.qty })),
    remainingRawNeed: r.remainingRawNeed,
    additionalQty: r.additionalQty,
    coverageStatus: r.coverageStatus,
    requiredDate: r.requiredDate,
    orderByDate: r.orderByDate,
    orderTiming: r.orderTiming,
    breachKind: r.breachKind,
    recommendedSupplierId: r.recommendedSupplierId,
    supplierReason: r.supplierReason,
    leadTimeDays: r.leadTimeDays,
    moq: r.moq,
    orderMultiple: r.orderMultiple,
    moqApplied: r.moqApplied,
    multipleApplied: r.multipleApplied,
    termsInvalid: r.termsInvalid,
    // 단가는 가격 조회 권한이 분리되어 있어 Snapshot 에 넣지 않는다
    suppliers: r.suppliers.map((s) => ({
      supplierId: s.supplierId,
      supplierCode: s.supplierCode,
      supplierName: s.supplierName,
      isDefault: s.isDefault,
      priority: s.priority,
      leadTimeDays: s.leadTimeDays,
      moq: s.moq,
      orderMultiple: s.orderMultiple,
    })),
  }
}

export type MrpRunSuggestionRowData = {
  itemId: string
  itemCode: string
  itemName: string
  kind: string
  rawNeed: number
  suggestedQty: number
  draftCoverageQty: number
  additionalQty: number
  supplierId: string | null
  supplierName: string | null
  targetReceiptDate: string | null
  orderByDate: string | null
  payload: {
    autoSuggest: boolean
    coverageStatus: string
    remainingRawNeed: number
    moq: number | null
    orderMultiple: number | null
    leadTimeDays: number | null
    orderTiming: string
    supplierReason: string
  }
}

export type MrpRunSummaryColumns = {
  baseDate: string
  fromDate: string | null
  toDate: string | null
  includeDraft: boolean
  demandLineCount: number
  materialCount: number
  shortageMaterialCount: number
  purchaseNeededCount: number
  warningCount: number
}

export type BuiltMrpRun = {
  snapshot: MrpRunSnapshot
  columns: MrpRunSummaryColumns
  suggestionRows: MrpRunSuggestionRowData[]
  sourceHash: string
  resultHash: string
  byteSize: number
}

export type BuildSnapshotArgs = {
  view: OrderMrpView
  rows: readonly PurchaseSuggestionLine[]
  baseDate: string
  generatedAt: Date
  maxBytes?: number
}

function assemble(args: BuildSnapshotArgs, compact: boolean): MrpRunSnapshot {
  const { view, rows } = args
  const attention = new Set<string>()
  for (const r of rows) attention.add(r.componentItemId)
  for (const m of view.materials) if (m.hadShortage || m.finalBalance < 0) attention.add(m.componentItemId)

  const auto = rows.filter((r) => AUTO_SUGGEST_KINDS.includes(r.kind))
  const warningCount = view.warnings.length + view.excludedLines.length
  return {
    version: MRP_SNAPSHOT_VERSION,
    generatedAt: args.generatedAt.toISOString(),
    meta: {
      runType: "ORDER_MRP",
      mode: "NORMAL",
      baseDate: args.baseDate,
      from: view.params.from,
      to: view.params.to,
      includeDraft: view.params.includeDraft,
      includeScheduledReceipts: true,
      semiFinishedNetting: true,
    },
    summary: {
      demandLineCount: view.kpi.demandLineCount,
      requiredMaterialCount: view.kpi.requiredMaterialCount,
      shortageMaterialCount: view.kpi.shortageMaterialCount,
      temporaryShortageMaterialCount: view.kpi.temporaryShortageMaterialCount,
      scheduledReceiptMaterialCount: view.kpi.scheduledReceiptMaterialCount,
      overdueReceiptCount: view.kpi.overdueReceiptCount,
      purchaseNeededCount: auto.length,
      safetyStockCount: rows.filter((r) => r.kind === "SAFETY_STOCK_SHORTAGE" || r.kind === "SAFETY_STOCK_TEMPORARY").length,
      coveredCount: auto.filter((r) => r.coverageStatus === "COVERED").length,
      partialCoverageCount: auto.filter((r) => r.coverageStatus === "PARTIAL").length,
      bomIssueLineCount: view.kpi.bomIssueLineCount,
      warningCount,
      semiNettedMaterialCount: view.materials.filter((m) => m.netting !== undefined).length,
    },
    scheduledReceipts: {
      appliedReceiptCount: view.scheduledReceipts.appliedReceiptCount,
      appliedMaterialCount: view.scheduledReceipts.appliedMaterialCount,
      excludedOutsourcingCount: view.scheduledReceipts.excludedOutsourcingCount,
      overdue: view.scheduledReceipts.overdue.map((o) => ({
        purchaseOrderNo: o.purchaseOrderNo,
        supplierName: o.supplierName,
        itemCode: o.itemCode,
        expectedDate: o.expectedDate,
        openQty: o.openQty,
        daysOverdue: o.daysOverdue,
      })),
    },
    warnings: view.warnings.map((w) => ({
      code: w.code,
      severity: w.severity,
      message: w.message,
      ...(w.orderNo !== undefined ? { orderNo: w.orderNo } : {}),
      ...(w.itemCode !== undefined ? { itemCode: w.itemCode } : {}),
    })),
    excludedLines: view.excludedLines.map((l) => ({
      reason: l.reason,
      orderNo: l.orderNo,
      itemCode: l.itemCode,
      deliveryDate: l.deliveryDate,
      remainingQty: l.remainingQty,
    })),
    stepColumns: SNAPSHOT_STEP_COLUMNS,
    receiptColumns: SNAPSHOT_RECEIPT_COLUMNS,
    materials: view.materials.map((m) => buildMaterial(m, compact && !attention.has(m.componentItemId))),
    suggestions: rows.map(buildSuggestion),
    compacted: compact,
  }
}

/** 입력(수요/재고/예정입고/정책/Coverage) 해시 대상 — 계산 결과값(잔량/부족/제안량)은 제외한다 */
function sourceBasis(s: MrpRunSnapshot) {
  return {
    meta: s.meta,
    materials: s.materials.map((m) => ({
      id: m.id,
      qtyOnHand: m.qtyOnHand,
      qtyHold: m.qtyHold,
      qtyAvailable: m.qtyAvailable,
      safetyStock: m.safetyStock,
      demand: m.steps.map((t) => [t[0], t[2], t[3], t[4]]),
      receipts: m.receipts,
    })),
    scheduledReceipts: s.scheduledReceipts,
    policy: s.suggestions.map((g) => ({
      itemId: g.itemId,
      suppliers: g.suppliers,
      draftCoverageQty: g.draftCoverageQty,
      draftCoverageBySupplier: g.draftCoverageBySupplier,
    })),
  }
}

export function buildMrpRunSnapshot(args: BuildSnapshotArgs): BuiltMrpRun {
  const limit = args.maxBytes ?? MAX_SNAPSHOT_BYTES
  let snapshot = assemble(args, false)
  let byteSize = Buffer.byteLength(JSON.stringify(snapshot), "utf8")
  if (byteSize > limit) {
    snapshot = assemble(args, true)
    byteSize = Buffer.byteLength(JSON.stringify(snapshot), "utf8")
    if (byteSize > limit) throw new SnapshotTooLargeError(byteSize, limit)
  }
  const { generatedAt: _ignored, ...resultBasis } = snapshot
  void _ignored
  const sourceHash = sha256Hex(canonicalJson(sourceBasis(snapshot)))
  const resultHash = sha256Hex(canonicalJson(resultBasis))

  return {
    snapshot,
    columns: {
      baseDate: args.baseDate,
      fromDate: snapshot.meta.from,
      toDate: snapshot.meta.to,
      includeDraft: snapshot.meta.includeDraft,
      demandLineCount: snapshot.summary.demandLineCount,
      materialCount: snapshot.summary.requiredMaterialCount,
      shortageMaterialCount: snapshot.summary.shortageMaterialCount,
      purchaseNeededCount: snapshot.summary.purchaseNeededCount,
      warningCount: snapshot.summary.warningCount,
    },
    suggestionRows: args.rows.map((r) => {
      const supplier = r.recommendedSupplierId ? r.suppliers.find((s) => s.supplierId === r.recommendedSupplierId) : undefined
      return {
        itemId: r.componentItemId,
        itemCode: r.code,
        itemName: r.name,
        kind: r.kind,
        rawNeed: r6(r.rawSuggestedQty),
        suggestedQty: r6(r.suggestedQty),
        draftCoverageQty: r6(r.draftCoverageQty),
        additionalQty: r6(r.additionalQty),
        supplierId: r.recommendedSupplierId,
        supplierName: supplier?.supplierName ?? null,
        targetReceiptDate: r.requiredDate,
        orderByDate: r.orderByDate,
        payload: {
          autoSuggest: AUTO_SUGGEST_KINDS.includes(r.kind),
          coverageStatus: r.coverageStatus,
          remainingRawNeed: r.remainingRawNeed,
          moq: r.moq,
          orderMultiple: r.orderMultiple,
          leadTimeDays: r.leadTimeDays,
          orderTiming: r.orderTiming,
          supplierReason: r.supplierReason,
        },
      }
    }),
    sourceHash,
    resultHash,
    byteSize,
  }
}
