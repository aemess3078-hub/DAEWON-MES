/**
 * 품목별 What-if 시뮬레이션 어댑터 (순수 모듈 — DB/Prisma 의존 없음)
 *
 *   사용자 입력(제품 × 예상수량) ──> 가상 Demand ──> runOrderMrp(Phase 1 엔진, NORMAL) ──> SimulationView
 *
 * 원칙
 *  - 실제 수주/생산계획/작업지시/예약/발주를 만들지 않는다. 읽기 + 메모리 계산만 한다.
 *  - 가상 Demand 는 `SIM-001` 형태의 식별자를 쓰며 납기(deliveryDate)는 null 이다.
 *    납기는 시뮬레이션의 업무 정보가 아니므로 만들어 내지 않는다. 엔진은 기간 조건이 없으면
 *    납기 없는 수요를 그대로 계산하고 정렬은 SIM 번호 순으로 결정한다.
 *  - 재고/BOM 정책은 Phase 2 와 동일: qtyAvailable = openingStock, ACTIVE + Default BOM 1개.
 *  - 자재별 최종 예상재고/부족은 엔진 결과를 그대로 사용한다(UI 에서 별도 계산식 없음).
 *  - (Phase 5E) 반제품(SEMI_FINISHED) 가용재고는 Netting 한다: 총 필요 → 재고 사용 → 순소요만 하위 BOM 전개.
 *    가상 수요도 실제 수주와 같은 공용 재고 pool 을 순서대로 소진한다(제품 입력 순서 = SIM 번호 순).
 */

import { runOrderMrp } from "./order-mrp-engine"
import {
  buildStepNetting,
  type NettingTraceView,
  aggregateStock,
  selectDefaultBoms,
  toBomLines,
  toStockEntries,
  type BomIssueCode,
  type BomRow,
  type InventoryBalanceRow,
} from "./order-mrp-adapter"
import type { MrpDemandLine, OrderMrpResult } from "./types"

export const SIMULATION_MAX_PRODUCTS = 500
const PRODUCIBLE_TYPES = new Set(["FINISHED", "SEMI_FINISHED"])

export type SimulationInputRow = { itemId: unknown; qty: unknown }

export type SimulationItemRow = {
  id: string
  code: string
  name: string
  uom: string
  itemType: string
}

export type SimulationExcludedReason =
  | "INVALID_PRODUCT"
  | "INVALID_QUANTITY"
  | "MISSING_DEFAULT_BOM"
  | "MULTIPLE_DEFAULT_BOM"
  | "EMPTY_DEFAULT_BOM"
  | "INVALID_BOM"

const REASON_LABEL: Record<SimulationExcludedReason, string> = {
  INVALID_PRODUCT: "유효하지 않은 제품입니다",
  INVALID_QUANTITY: "예상수량은 0보다 큰 숫자여야 합니다",
  MISSING_DEFAULT_BOM: "ACTIVE 기본(Default) BOM 없음",
  MULTIPLE_DEFAULT_BOM: "기본(Default) BOM 중복 지정 (데이터 오류)",
  EMPTY_DEFAULT_BOM: "기본 BOM 에 자재 라인 없음",
  INVALID_BOM: "BOM 수량 오류 또는 순환 참조",
}

export type SimulationProductView = {
  simId: string
  itemId: string
  code: string
  name: string
  uom: string
  qty: number
}

export type SimulationSourceView = {
  simId: string
  itemCode: string
  itemName: string
  /** 이 제품의 예상 생산수량 */
  productQty: number
  /** 제품 1단위당 이 자재 소요량(다단계·스크랩 반영 후 합산값) */
  bomQtyPerUnit: number
  /** 이 제품 때문에 필요한 자재 소요량 */
  requirement: number
  /** (Phase 5E) 이 자재가 반제품이면 이 제품 기준 총 필요 / 재고 사용 / 순소요 */
  semiNetting?: { grossQty: number; usedQty: number; netQty: number }
  /** (Phase 5E) 이 자재 소요가 반제품 순소요에서 나왔다면 그 근거 */
  netting?: NettingTraceView[]
}

export type SimulationMaterialView = {
  componentItemId: string
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
  /** qtyAvailable − 총소요 (음수 허용) */
  expectedBalance: number
  /** max(0, −expectedBalance) */
  shortageQty: number
  sources: SimulationSourceView[]
  /** (Phase 5E) 반제품 재고를 사용한 경우 총 필요 / 재고 사용 / 순소요 합계 */
  netting?: { grossQty: number; usedQty: number; netQty: number }
}

export type SimulationExcludedView = {
  itemId: string | null
  code: string
  name: string
  inputQty: number | null
  reason: SimulationExcludedReason
  reasonLabel: string
  isBomIssue: boolean
}

export type SimulationWarningView = {
  code: string
  severity: "WARNING" | "INFO"
  message: string
}

export type SimulationView = {
  mode: "WHAT_IF"
  products: SimulationProductView[]
  kpi: {
    /** 계산에 포함된 제품 수(중복 입력은 합산 후) */
    productCount: number
    requiredMaterialCount: number
    shortageMaterialCount: number
    /** BOM 문제로 계산에서 제외된 제품 수 */
    bomIssueProductCount: number
    /** 제외된 전체 입력(제품/수량/BOM 문제) */
    excludedCount: number
    /** (제품 × 자재) 전개 라인 수 — 단위가 달라 수량은 합산하지 않는다 */
    requirementLineCount: number
  }
  materials: SimulationMaterialView[]
  excluded: SimulationExcludedView[]
  warnings: SimulationWarningView[]
}

/** 요청 본문 검증/정규화. 행 단위 오류는 던지지 않고 제외 사유로 남긴다. */
export function normalizeSimulationRequest(raw: unknown): SimulationInputRow[] {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>
  const items = obj.items
  if (items === undefined || items === null) return []
  if (!Array.isArray(items)) throw new Error("시뮬레이션 입력 형식이 올바르지 않습니다.")
  if (items.length > SIMULATION_MAX_PRODUCTS) {
    throw new Error(`시뮬레이션 제품은 최대 ${SIMULATION_MAX_PRODUCTS}개까지 입력할 수 있습니다.`)
  }
  // tenantId 등 그 외 키는 의도적으로 무시한다
  return items.map((it) => {
    const o = (typeof it === "object" && it !== null ? it : {}) as Record<string, unknown>
    return { itemId: o.itemId, qty: o.qty }
  })
}

export type PreparedSimulationInput = {
  /** 유효 입력(itemId 문자열 + qty>0 유한수)을 itemId 별로 합산한 결과(입력 순서 유지) */
  merged: Array<{ itemId: string; qty: number; rows: number }>
  /** 수량/식별자 오류로 일찍 제외된 입력 */
  invalid: SimulationExcludedView[]
}

export function prepareSimulationInput(rows: readonly SimulationInputRow[]): PreparedSimulationInput {
  const merged = new Map<string, { itemId: string; qty: number; rows: number }>()
  const invalid: SimulationExcludedView[] = []
  for (const row of rows) {
    const qtyOk = typeof row.qty === "number" && Number.isFinite(row.qty) && row.qty > 0
    const idOk = typeof row.itemId === "string" && row.itemId.length > 0
    if (!idOk) {
      invalid.push({
        itemId: null,
        code: "-",
        name: "-",
        inputQty: typeof row.qty === "number" && Number.isFinite(row.qty) ? row.qty : null,
        reason: "INVALID_PRODUCT",
        reasonLabel: REASON_LABEL.INVALID_PRODUCT,
        isBomIssue: false,
      })
      continue
    }
    if (!qtyOk) {
      invalid.push({
        itemId: row.itemId as string,
        code: "",
        name: "",
        inputQty: typeof row.qty === "number" && Number.isFinite(row.qty) ? row.qty : null,
        reason: "INVALID_QUANTITY",
        reasonLabel: REASON_LABEL.INVALID_QUANTITY,
        isBomIssue: false,
      })
      continue
    }
    const id = row.itemId as string
    const existing = merged.get(id)
    if (existing) {
      existing.qty += row.qty as number
      existing.rows += 1
    } else {
      merged.set(id, { itemId: id, qty: row.qty as number, rows: 1 })
    }
  }
  return { merged: Array.from(merged.values()), invalid }
}

export type RunSimulationArgs = {
  tenantId: string
  /** 입력 정규화 결과 */
  prepared: PreparedSimulationInput
  /** tenant 소유로 확인된 품목 행(조회 결과). 없는 ID 는 INVALID_PRODUCT 로 처리 */
  itemRows: readonly SimulationItemRow[]
  bomRows: readonly BomRow[]
  stockRows: readonly InventoryBalanceRow[]
}

export function runSimulationFromRows(args: RunSimulationArgs): SimulationView {
  const { prepared, itemRows, tenantId } = args
  const itemById = new Map(itemRows.map((i) => [i.id, i]))
  // 수량 오류 행: 소유가 확인된 제품이면 코드/이름을 채우고, 아니면 제품 오류로 일반화(타 tenant 정보 비노출)
  const excluded: SimulationExcludedView[] = prepared.invalid.map((e) => {
    if (e.reason !== "INVALID_QUANTITY" || !e.itemId) return e
    const it = itemById.get(e.itemId)
    if (it) return { ...e, code: it.code, name: it.name }
    return { ...e, itemId: null, code: "-", name: "-", reason: "INVALID_PRODUCT" as const, reasonLabel: REASON_LABEL.INVALID_PRODUCT }
  })

  // 1) 소유/유형 검증된 제품만 가상 Demand 로 변환
  const accepted: Array<{ itemId: string; qty: number; rows: number; item: SimulationItemRow }> = []
  for (const m of prepared.merged) {
    const item = itemById.get(m.itemId)
    if (!item || !PRODUCIBLE_TYPES.has(item.itemType)) {
      // 존재하지 않음 / 다른 tenant / 생산 대상 아님 — 구분하지 않는다(정보 비노출)
      excluded.push({
        itemId: null,
        code: "-",
        name: "-",
        inputQty: m.qty,
        reason: "INVALID_PRODUCT",
        reasonLabel: REASON_LABEL.INVALID_PRODUCT,
        isBomIssue: false,
      })
      continue
    }
    accepted.push({ ...m, item })
  }

  const simIdOf = (index: number) => `SIM-${String(index + 1).padStart(3, "0")}`
  const demands: MrpDemandLine[] = accepted.map((a, i) => ({
    orderId: "SIM",
    orderNo: simIdOf(i),
    customerPoNo: null,
    orderLineId: simIdOf(i),
    orderLineNo: i + 1,
    itemId: a.itemId,
    itemCode: a.item.code,
    orderQty: a.qty,
    remainingQty: a.qty,
    deliveryDate: null,
    cancelled: false,
    completed: false,
    originalIndex: i,
  }))
  const productBySim = new Map<string, SimulationProductView>(
    accepted.map((a, i) => [
      simIdOf(i),
      { simId: simIdOf(i), itemId: a.itemId, code: a.item.code, name: a.item.name, uom: a.item.uom, qty: a.qty },
    ])
  )

  // 2) 기본 BOM 선택 (Phase 2 정책)
  const { selected, issues } = selectDefaultBoms(args.bomRows, tenantId)
  const bomIssues = new Map<string, BomIssueCode>()
  accepted.forEach((a) => {
    if (!selected.has(a.itemId)) bomIssues.set(a.itemId, issues.get(a.itemId) ?? "MISSING_DEFAULT_BOM")
  })
  const componentMeta = new Map<string, { code: string; name: string; spec: string | null; uom: string; itemType: string }>()
  selected.forEach((bom) => {
    for (const bi of bom.bomItems) componentMeta.set(bi.componentItemId, bi.componentItem)
  })

  // 3) 엔진 실행 (NORMAL: 다단계 + 스크랩, 기간 없음)
  const stock = aggregateStock(args.stockRows)
  const result: OrderMrpResult = runOrderMrp(
    { demands, boms: toBomLines(selected), stocks: toStockEntries(stock) },
    { mode: "NORMAL", stockProviderType: "ACTUAL" }
  )

  // 4) 제외 제품
  const demandByLine = new Map(demands.map((d) => [d.orderLineId, d]))
  for (const e of result.excludedOrderLines) {
    const product = productBySim.get(e.orderLineId)
    const reason: SimulationExcludedReason =
      e.reason === "MISSING_BOM"
        ? (bomIssues.get(e.itemId) as SimulationExcludedReason | undefined) ?? "MISSING_DEFAULT_BOM"
        : e.reason === "INVALID_BOM"
          ? "INVALID_BOM"
          : "INVALID_QUANTITY"
    excluded.push({
      itemId: e.itemId,
      code: product?.code ?? e.itemCode,
      name: product?.name ?? e.itemCode,
      inputQty: product?.qty ?? e.orderQty,
      reason,
      reasonLabel: REASON_LABEL[reason],
      isBomIssue: reason !== "INVALID_QUANTITY" && reason !== "INVALID_PRODUCT",
    })
  }

  // 5) 자재 결과 + 제품별 근거
  const resultDemandByLine = new Map(result.demands.map((d) => [d.orderLineId, d]))
  const materials: SimulationMaterialView[] = []
  for (const m of result.materials) {
    if (!(m.totalRequirement > 0)) continue
    const meta = componentMeta.get(m.componentItemId)
    const agg = stock.get(m.componentItemId)
    const sources: SimulationSourceView[] = []
    for (const mv of m.movements) {
      if (!(mv.requirement > 0)) continue
      const product = productBySim.get(mv.orderLineId)
      const demand = demandByLine.get(mv.orderLineId)
      if (!product || !demand) continue
      sources.push({
        simId: product.simId,
        itemCode: product.code,
        itemName: product.name,
        productQty: product.qty,
        bomQtyPerUnit: product.qty > 0 ? Math.round((mv.requirement / product.qty) * 1e6) / 1e6 : 0,
        requirement: mv.requirement,
        ...buildStepNetting(resultDemandByLine.get(mv.orderLineId) ?? { itemId: "" }, m.componentItemId),
      })
    }
    materials.push({
      componentItemId: m.componentItemId,
      code: m.componentCode,
      name: meta?.name ?? m.name ?? m.componentCode,
      spec: meta?.spec ?? null,
      uom: meta?.uom ?? m.uom ?? "",
      itemType: meta?.itemType ?? m.componentItemType ?? "",
      qtyOnHand: agg?.qtyOnHand ?? 0,
      qtyHold: agg?.qtyHold ?? 0,
      qtyAvailable: agg?.qtyAvailable ?? 0,
      qtyExcludedByLot: agg?.qtyExcludedByLot ?? 0,
      totalRequirement: m.totalRequirement,
      expectedBalance: m.finalBalance,
      shortageQty: m.finalShortageQty,
      sources,
      ...(m.nettedUsedQty > 0
        ? { netting: { grossQty: m.nettedUsedQty + m.nettedNetQty, usedQty: m.nettedUsedQty, netQty: m.nettedNetQty } }
        : {}),
    })
  }
  // 부족 자재 먼저(부족수량 큰 순), 그다음 코드순
  materials.sort((a, b) => {
    const sa = a.shortageQty > 0 ? 0 : 1
    const sb = b.shortageQty > 0 ? 0 : 1
    if (sa !== sb) return sa - sb
    if (a.shortageQty !== b.shortageQty) return b.shortageQty - a.shortageQty
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0
  })

  const warnings: SimulationWarningView[] = []
  for (const m of prepared.merged) {
    if (m.rows > 1) {
      const item = itemById.get(m.itemId)
      warnings.push({
        code: "DUPLICATE_PRODUCT_INPUT",
        severity: "INFO",
        message: `제품 ${item?.code ?? ""} 이(가) ${m.rows}행으로 입력되어 수량을 합산했습니다(합계 ${m.qty}).`,
      })
    }
  }
  selected.forEach((bom) => {
    for (const bi of bom.bomItems) {
      if (bi.componentItem.itemType !== "SEMI_FINISHED") continue
      if (!selected.has(bi.componentItemId) && !warnings.some((w) => w.code === "SEMI_WITHOUT_BOM:" + bi.componentItemId)) {
        warnings.push({
          code: "SEMI_WITHOUT_BOM:" + bi.componentItemId,
          severity: "INFO",
          message: `반제품 ${bi.componentItem.code} 에 ACTIVE 기본 BOM 이 없어 하위 자재를 전개하지 않았습니다(구매/외주 반제품이면 정상).`,
        })
      }
    }
  })
  for (const w of result.warnings) {
    // 납기 없음은 시뮬레이션에서 정상, MISSING_BOM 은 제외 목록(BOM 사유)으로 대체
    if (w.code === "MISSING_DELIVERY_DATE" || w.code === "MISSING_BOM") continue
    warnings.push({ code: w.code, severity: w.severity, message: w.message })
  }

  return {
    mode: "WHAT_IF",
    products: result.demands.map((d) => productBySim.get(d.orderLineId) as SimulationProductView),
    kpi: {
      productCount: result.summary.includedDemandCount,
      requiredMaterialCount: materials.length,
      shortageMaterialCount: materials.filter((m) => m.shortageQty > 0).length,
      bomIssueProductCount: excluded.filter((e) => e.isBomIssue).length,
      excludedCount: excluded.length,
      requirementLineCount: result.demands.reduce((sum, d) => sum + d.requirements.length, 0),
    },
    materials,
    excluded,
    warnings,
  }
}
