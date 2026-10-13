/**
 * 수주 기반 MRP 엔진 (순수 함수)
 *
 * - DB / Prisma / Supabase / process.env / Date.now() / random / network 를 사용하지 않는다.
 * - 같은 입력은 항상 같은 결과를 반환한다(deterministic).
 * - 기존 생산계획 기반 MRP(`services/mrp.service.ts calculateMRP`)와 독립된 모듈이며 그것을 대체하지 않는다.
 *
 * 알고리즘(요약)
 *  1) 수주 라인(Demand)을 적격 판정(취소/출하/잔량/기간/BOM) → 제외 사유 기록
 *  2) 확정 정렬: NORMAL = 납기 ASC → (고객PO|orderNo) ASC → orderLineNo ASC → 입력 순서
 *  3) 자재 집합 = 포함된 수주 BOM 에 등장하는 자재(+음수 재고 자재)
 *  4) 자재별로 openingStock 에서 수주를 순서대로 순차 차감 (음수 허용, 0 클램프 없음)
 *       requirement = demandQty × Σ(동일 자재 qtyPer)      ← 동일 자재 반복 라인은 계산 시점에 합산
 *       balanceAfter = balanceBefore - requirement
 *  5) 결품/최초 결품/최종 부족 지표 산출
 *
 * What-if 재사용: 가상의 Demand 라인(고유 orderLineId, deliveryDate=null, remainingQty=입력 수량)을
 * 만들어 from/to 없이 호출하면 실제 수주를 건드리지 않는 독립 시뮬레이션이 된다.
 */

import { isDateOnly } from "./period"
import type {
  DemandRequirementLine,
  ExcludedOrderLine,
  ExcludedReason,
  MaterialFirstShortage,
  MaterialMovement,
  MrpBomLine,
  MrpDemandLine,
  MrpWarning,
  OrderMrpDemandResult,
  OrderMrpInput,
  OrderMrpMaterialResult,
  OrderMrpOptions,
  OrderMrpResult,
  OrderMrpSummary,
  ResolvedOrderMrpOptions,
} from "./types"

const SEMI_FINISHED = "SEMI_FINISHED"
const DEFAULT_MAX_BOM_DEPTH = 10

// ─── Options ─────────────────────────────────────────────────────────────────

export function resolveOrderMrpOptions(options: OrderMrpOptions): ResolvedOrderMrpOptions {
  const mode = options.mode
  if (mode !== "NORMAL" && mode !== "EXCEL_COMPAT") {
    throw new RangeError(`지원하지 않는 MRP mode: ${String(mode)}`)
  }
  const compat = mode === "EXCEL_COMPAT"
  const includeOpenEnded = options.includeOpenEnded ?? true
  const from = options.from ?? null
  const to = options.to ?? null
  const legacyUpperBound = options.legacyUpperBound ?? null

  if (from !== null && !isDateOnly(from)) throw new RangeError(`from 은 YYYY-MM-DD 여야 합니다: ${from}`)
  if (to !== null && !isDateOnly(to)) throw new RangeError(`to 는 YYYY-MM-DD 여야 합니다: ${to}`)
  if (legacyUpperBound !== null) {
    if (!compat) throw new RangeError("legacyUpperBound 는 EXCEL_COMPAT 에서만 사용할 수 있습니다.")
    if (!isDateOnly(legacyUpperBound)) {
      throw new RangeError(`legacyUpperBound 는 YYYY-MM-DD 여야 합니다: ${legacyUpperBound}`)
    }
  }
  if (!includeOpenEnded && (from === null || to === null)) {
    throw new RangeError("includeOpenEnded=false 이면 from 과 to 가 모두 필요합니다.")
  }
  if (from !== null && to !== null && from > to) {
    throw new RangeError(`from(${from}) 이 to(${to}) 보다 늦습니다.`)
  }

  const ordering = options.ordering ?? "DUE_DATE"
  if (ordering === "INPUT_ORDER" && !compat) {
    throw new RangeError("INPUT_ORDER(Excel 행 순서) 정렬은 EXCEL_COMPAT 에서만 사용할 수 있습니다.")
  }

  const maxBomDepth = options.maxBomDepth ?? DEFAULT_MAX_BOM_DEPTH
  if (!Number.isInteger(maxBomDepth) || maxBomDepth < 0) {
    throw new RangeError("maxBomDepth 는 0 이상의 정수여야 합니다.")
  }

  // legacy 상한(Excel "오늘까지")은 to 와 함께 적용되는 더 이른 경계
  let effectiveTo = to
  if (legacyUpperBound !== null) {
    effectiveTo = to === null || legacyUpperBound < to ? legacyUpperBound : to
    if (from !== null && from > effectiveTo) {
      throw new RangeError(`from(${from}) 이 legacyUpperBound(${legacyUpperBound}) 보다 늦습니다.`)
    }
  }

  return {
    mode,
    from,
    to: effectiveTo,
    includeOpenEnded,
    stockProviderType: options.stockProviderType ?? (compat ? "EXCEL_THEORETICAL" : "ACTUAL"),
    ordering,
    bomExplosion: options.bomExplosion ?? (compat ? "SINGLE_LEVEL" : "MULTI_LEVEL"),
    applyScrapRate: options.applyScrapRate ?? !compat,
    maxBomDepth,
    legacyUpperBound,
    demandQuantityBasis: compat ? "ORDER_QTY" : "REMAINING",
    nullDeliveryDatePlacement: compat ? "FIRST" : "LAST",
  }
}

// ─── BOM 전개 (단위 소요량) ──────────────────────────────────────────────────

type UnitEntry = {
  componentItemId: string
  componentCode: string
  componentItemType: string | null
  /** 상위 1단위당 소요량(동일 자재는 합산, 스크랩 반영 옵션 적용) */
  qty: number
}

type UnitResult = {
  units: Map<string, UnitEntry>
  invalid: boolean
  cyclic: boolean
  depthExceeded: boolean
}

type BomExplodeOptions = Pick<
  ResolvedOrderMrpOptions,
  "bomExplosion" | "applyScrapRate" | "maxBomDepth"
>

/**
 * BOM 라인 배열을 상위 품목별로 색인하고 단위 소요량 전개 함수를 만든다.
 * 입력 라인은 변경(mutate)하지 않으며 반복 자재 라인도 제거하지 않는다.
 */
export function createBomExploder(
  boms: readonly MrpBomLine[],
  options: BomExplodeOptions,
  warnings: MrpWarning[] = []
): (parentItemId: string) => UnitResult & { hasBom: boolean } {
  const byParent = new Map<string, MrpBomLine[]>()
  for (const line of boms) {
    const list = byParent.get(line.parentItemId)
    if (list) list.push(line)
    else byParent.set(line.parentItemId, [line])
  }
  // 모든 라인에 lineNo 가 있으면 그 순서(안정 정렬), 아니면 입력 순서 유지
  Array.from(byParent.entries()).forEach(([parentId, lines]) => {
    if (lines.every((l) => typeof l.lineNo === "number")) {
      const indexed = lines.map((l, i) => ({ l, i }))
      indexed.sort((a, b) => (a.l.lineNo as number) - (b.l.lineNo as number) || a.i - b.i)
      byParent.set(parentId, indexed.map((x) => x.l))
    }
  })

  const warned = new Set<string>()
  const warnOnce = (key: string, warning: MrpWarning) => {
    if (warned.has(key)) return
    warned.add(key)
    warnings.push(warning)
  }

  // 반복 자재 라인 정보(INFO) — 데이터는 건드리지 않고 알리기만 한다
  Array.from(byParent.entries()).forEach(([parentId, lines]) => {
    const seen = new Map<string, number>()
    for (const l of lines) seen.set(l.componentItemId, (seen.get(l.componentItemId) ?? 0) + 1)
    seen.forEach((count, componentId) => {
      if (count > 1) {
        const code = lines.find((l) => l.componentItemId === componentId)?.componentCode ?? componentId
        warnOnce(`dup|${parentId}|${componentId}`, {
          code: "DUPLICATE_BOM_COMPONENT",
          severity: "INFO",
          message: `BOM(상위 ${parentId})에 자재 ${code} 라인이 ${count}회 있어 계산 시 수량을 합산합니다.`,
          itemId: parentId,
          componentItemId: componentId,
        })
      }
    })
  })

  const multi = options.bomExplosion === "MULTI_LEVEL"

  const explode = (parentId: string, depth: number, path: string[]): UnitResult => {
    const result: UnitResult = { units: new Map(), invalid: false, cyclic: false, depthExceeded: false }
    const lines = byParent.get(parentId) ?? []
    const add = (entry: Omit<UnitEntry, "qty">, qty: number) => {
      const existing = result.units.get(entry.componentItemId)
      if (existing) existing.qty += qty
      else result.units.set(entry.componentItemId, { ...entry, qty })
    }

    for (const line of lines) {
      const scrap = options.applyScrapRate ? line.scrapRate ?? 0 : 0
      if (!Number.isFinite(line.qtyPer) || line.qtyPer < 0 || !Number.isFinite(scrap) || scrap < 0) {
        result.invalid = true
        warnOnce(`inv|${parentId}|${line.componentItemId}|${line.lineNo ?? ""}`, {
          code: "INVALID_BOM_QUANTITY",
          severity: "WARNING",
          message: `BOM(상위 ${parentId})의 자재 ${line.componentCode} 수량이 올바르지 않습니다: ${String(line.qtyPer)}`,
          itemId: parentId,
          componentItemId: line.componentItemId,
        })
        continue
      }
      const effective = options.applyScrapRate ? line.qtyPer * (1 + scrap) : line.qtyPer
      add(
        {
          componentItemId: line.componentItemId,
          componentCode: line.componentCode,
          componentItemType: line.componentItemType ?? null,
        },
        effective
      )

      if (multi && line.componentItemType === SEMI_FINISHED && byParent.has(line.componentItemId)) {
        if (path.includes(line.componentItemId)) {
          result.cyclic = true
          warnOnce(`cyc|${parentId}|${line.componentItemId}`, {
            code: "BOM_CYCLE_DETECTED",
            severity: "WARNING",
            message: `BOM 순환 참조: ${parentId} → ${line.componentCode}`,
            itemId: parentId,
            componentItemId: line.componentItemId,
          })
          continue
        }
        if (depth + 1 > options.maxBomDepth) {
          result.depthExceeded = true
          warnOnce(`depth|${parentId}|${line.componentItemId}`, {
            code: "BOM_DEPTH_EXCEEDED",
            severity: "WARNING",
            message: `BOM 전개 깊이(${options.maxBomDepth})를 초과하여 ${line.componentCode} 하위는 전개하지 않았습니다.`,
            itemId: parentId,
            componentItemId: line.componentItemId,
          })
          continue
        }
        const child = explode(line.componentItemId, depth + 1, [...path, line.componentItemId])
        if (child.invalid) result.invalid = true
        if (child.cyclic) result.cyclic = true
        if (child.depthExceeded) result.depthExceeded = true
        child.units.forEach((entry) => {
          add(
            {
              componentItemId: entry.componentItemId,
              componentCode: entry.componentCode,
              componentItemType: entry.componentItemType,
            },
            effective * entry.qty
          )
        })
      }
    }
    return result
  }

  const cache = new Map<string, UnitResult>()
  return (parentItemId: string) => {
    const hasBom = (byParent.get(parentItemId)?.length ?? 0) > 0
    let cached = cache.get(parentItemId)
    if (!cached) {
      cached = explode(parentItemId, 0, [parentItemId])
      cache.set(parentItemId, cached)
    }
    return { ...cached, hasBom }
  }
}

// ─── 수주 라인 적격 판정 / 정렬 ──────────────────────────────────────────────

type Eligible = {
  demand: MrpDemandLine
  arrayIndex: number
  sortIndex: number
  demandQty: number
  units: Map<string, UnitEntry>
}

function toExcluded(demand: MrpDemandLine, reason: ExcludedReason): ExcludedOrderLine {
  return {
    reason,
    orderId: demand.orderId,
    orderNo: demand.orderNo,
    orderLineId: demand.orderLineId,
    orderLineNo: demand.orderLineNo ?? null,
    itemId: demand.itemId,
    itemCode: demand.itemCode,
    deliveryDate: demand.deliveryDate,
    orderQty: demand.orderQty,
    remainingQty: demand.remainingQty ?? null,
  }
}

function demandRef(d: MrpDemandLine): Pick<MrpWarning, "orderId" | "orderNo" | "orderLineId" | "itemId" | "itemCode"> {
  return {
    orderId: d.orderId,
    orderNo: d.orderNo,
    orderLineId: d.orderLineId,
    itemId: d.itemId,
    itemCode: d.itemCode,
  }
}

function cmpString(a: string, b: string): number {
  // locale 비의존(결정적) 코드 유닛 비교
  return a < b ? -1 : a > b ? 1 : 0
}

function buildComparator(opts: ResolvedOrderMrpOptions) {
  const nullFirst = opts.nullDeliveryDatePlacement === "FIRST"
  const byDate = (a: Eligible, b: Eligible): number => {
    const da = a.demand.deliveryDate
    const db = b.demand.deliveryDate
    if (da === db) return 0
    if (da === null) return nullFirst ? -1 : 1
    if (db === null) return nullFirst ? 1 : -1
    return cmpString(da, db)
  }
  const byInput = (a: Eligible, b: Eligible): number => a.sortIndex - b.sortIndex || a.arrayIndex - b.arrayIndex

  if (opts.ordering === "INPUT_ORDER") return byInput
  if (opts.mode === "EXCEL_COMPAT") {
    // Excel 정렬 재현: 납기 오름차순, 동일 납기는 입력(시트 행) 순서 유지
    return (a: Eligible, b: Eligible) => byDate(a, b) || byInput(a, b)
  }
  // NORMAL: 납기 → (고객PO|orderNo) → orderNo → orderLineNo → 입력 순서
  return (a: Eligible, b: Eligible) =>
    byDate(a, b) ||
    cmpString(a.demand.customerPoNo ?? a.demand.orderNo, b.demand.customerPoNo ?? b.demand.orderNo) ||
    cmpString(a.demand.orderNo, b.demand.orderNo) ||
    (a.demand.orderLineNo ?? Number.POSITIVE_INFINITY) - (b.demand.orderLineNo ?? Number.POSITIVE_INFINITY) ||
    byInput(a, b)
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export function runOrderMrp(input: OrderMrpInput, options: OrderMrpOptions): OrderMrpResult {
  const opts = resolveOrderMrpOptions(options)
  const warnings: MrpWarning[] = []
  const excluded: ExcludedOrderLine[] = []
  const compat = opts.mode === "EXCEL_COMPAT"
  const periodActive = opts.from !== null || opts.to !== null

  const explodeBom = createBomExploder(input.boms, opts, warnings)

  // 1) 적격 판정
  const eligible: Eligible[] = []
  input.demands.forEach((demand, arrayIndex) => {
    if (demand.cancelled) {
      excluded.push(toExcluded(demand, "CANCELLED"))
      return
    }
    if (compat) {
      if (demand.shipped || demand.completed) {
        excluded.push(toExcluded(demand, "SHIPPED"))
        return
      }
    } else if (demand.completed) {
      excluded.push(toExcluded(demand, "COMPLETED"))
      return
    }

    const rawQty =
      opts.demandQuantityBasis === "ORDER_QTY" ? demand.orderQty : demand.remainingQty ?? demand.orderQty
    if (!Number.isFinite(rawQty) || rawQty < 0) {
      excluded.push(toExcluded(demand, "INVALID_QUANTITY"))
      warnings.push({
        code: "INVALID_DEMAND_QUANTITY",
        severity: "WARNING",
        message: `수주 라인 수량이 올바르지 않아 제외했습니다: ${String(rawQty)}`,
        ...demandRef(demand),
      })
      return
    }
    if (!compat && rawQty === 0) {
      excluded.push(toExcluded(demand, "NO_REMAINING_QTY"))
      return
    }

    const date = demand.deliveryDate
    if (date !== null && !isDateOnly(date)) {
      excluded.push(toExcluded(demand, "INVALID_DELIVERY_DATE"))
      warnings.push({
        code: "INVALID_DELIVERY_DATE",
        severity: "WARNING",
        message: `납기가 YYYY-MM-DD 형식이 아니어서 제외했습니다: ${String(date)}`,
        ...demandRef(demand),
      })
      return
    }
    if (date === null) {
      if (periodActive) {
        excluded.push(toExcluded(demand, "MISSING_DELIVERY_DATE"))
        warnings.push({
          code: "MISSING_DELIVERY_DATE",
          severity: "WARNING",
          message: "납기가 없어 기간 MRP 에서 제외했습니다.",
          ...demandRef(demand),
        })
        return
      }
      warnings.push({
        code: "MISSING_DELIVERY_DATE",
        severity: "INFO",
        message: "납기가 없는 수주 라인입니다. 정렬 시 납기 있는 라인 뒤(호환모드는 앞)에 배치됩니다.",
        ...demandRef(demand),
      })
    } else if (
      (opts.from !== null && date < opts.from) ||
      (opts.to !== null && date > opts.to)
    ) {
      excluded.push(toExcluded(demand, "OUT_OF_PERIOD"))
      return
    }

    const exploded = explodeBom(demand.itemId)
    if (!exploded.hasBom) {
      excluded.push(toExcluded(demand, "MISSING_BOM"))
      warnings.push({
        code: "MISSING_BOM",
        severity: "WARNING",
        message: `BOM 이 없는 제품이라 계산에서 제외했습니다: ${demand.itemCode}`,
        ...demandRef(demand),
      })
      return
    }
    if (exploded.invalid || exploded.cyclic) {
      excluded.push(toExcluded(demand, "INVALID_BOM"))
      return
    }

    eligible.push({
      demand,
      arrayIndex,
      sortIndex: demand.originalIndex ?? arrayIndex,
      demandQty: rawQty,
      units: exploded.units,
    })
  })

  // 2) 중복 경고 (계산에는 모든 라인 포함, 자동 병합 금지)
  const lineIdSeen = new Map<string, string[]>()
  const exactKey = new Map<string, string[]>()
  for (const e of eligible) {
    const d = e.demand
    lineIdSeen.set(d.orderLineId, [...(lineIdSeen.get(d.orderLineId) ?? []), d.orderLineId])
    const key = [d.customerPoNo ?? d.orderNo, d.itemId, d.deliveryDate ?? "", e.demandQty].join("|")
    exactKey.set(key, [...(exactKey.get(key) ?? []), d.orderLineId])
  }
  lineIdSeen.forEach((ids, lineId) => {
    if (ids.length > 1) {
      warnings.push({
        code: "DUPLICATE_ORDER_LINE_ID",
        severity: "WARNING",
        message: `동일한 orderLineId(${lineId})가 ${ids.length}번 입력되었습니다. 각각 독립 수요로 계산합니다.`,
        orderLineId: lineId,
      })
    }
  })
  exactKey.forEach((ids) => {
    if (ids.length > 1) {
      warnings.push({
        code: "POSSIBLE_DUPLICATE_DEMAND",
        severity: "WARNING",
        message: `PO·제품·납기·수량이 동일한 수주 라인이 ${ids.length}건 있습니다. 모두 독립 수요로 계산합니다(자동 병합하지 않음).`,
        relatedOrderLineIds: ids,
      })
    }
  })

  // 3) 확정 정렬
  const ordered = [...eligible].sort(buildComparator(opts))

  // 4) 재고 / 자재 집합
  const stockMap = new Map<string, number>()
  for (const s of input.stocks) {
    if (!Number.isFinite(s.quantity)) {
      warnings.push({
        code: "INVALID_STOCK_QUANTITY",
        severity: "WARNING",
        message: `재고 수량이 올바르지 않아 0 으로 처리했습니다: ${s.componentItemId}`,
        componentItemId: s.componentItemId,
      })
      continue
    }
    stockMap.set(s.componentItemId, (stockMap.get(s.componentItemId) ?? 0) + s.quantity)
  }

  type MaterialState = {
    entry: UnitEntry
    opening: number
    balance: number
    totalRequirement: number
    shortageDemandCount: number
    negativeStepCount: number
    firstShortage: MaterialFirstShortage | null
    movements: MaterialMovement[]
  }
  const materials = new Map<string, MaterialState>()
  const addMaterial = (entry: UnitEntry) => {
    if (materials.has(entry.componentItemId)) return
    const opening = stockMap.get(entry.componentItemId) ?? 0
    materials.set(entry.componentItemId, {
      entry,
      opening,
      balance: opening,
      totalRequirement: 0,
      shortageDemandCount: 0,
      negativeStepCount: 0,
      firstShortage: null,
      movements: [],
    })
  }
  for (const e of ordered) e.units.forEach((entry) => addMaterial(entry))

  // 음수 재고 자재는 수요가 없어도 Excel "누계"(음수 잔량 품목 수)에 포함되므로 집합에 넣는다
  const infoOf = (id: string) => input.componentInfo?.[id]
  Array.from(stockMap.entries()).forEach(([componentItemId, qty]) => {
    if (qty < 0) {
      const known = input.boms.find((b) => b.componentItemId === componentItemId)
      addMaterial({
        componentItemId,
        componentCode: known?.componentCode ?? componentItemId,
        componentItemType: known?.componentItemType ?? null,
        qty: 0,
      })
    }
  })
  materials.forEach((m, id) => {
    if (m.opening < 0) {
      warnings.push({
        code: "NEGATIVE_OPENING_STOCK",
        severity: "WARNING",
        message: `초기 재고가 음수입니다: ${m.entry.componentCode} (${m.opening})`,
        componentItemId: id,
      })
    }
  })

  // 5) 순차 차감
  const demandResults: OrderMrpDemandResult[] = []
  const materialList = Array.from(materials.values())
  ordered.forEach((e, i) => {
    const sequence = i + 1
    const d = e.demand
    const requirements: DemandRequirementLine[] = []
    let shortageItemCount = 0
    let cumulativeNegativeItemCount = 0

    for (const m of materialList) {
      const unit = e.units.get(m.entry.componentItemId)
      const requirement = unit ? unit.qty * e.demandQty : 0
      const balanceBefore = m.balance
      const balanceAfter = balanceBefore - requirement
      const isShortage = requirement > 0 && balanceAfter < 0
      const shortageAtThisDemand = isShortage ? Math.min(requirement, -balanceAfter) : 0

      m.balance = balanceAfter
      m.totalRequirement += requirement
      if (balanceAfter < 0) {
        m.negativeStepCount += 1
        cumulativeNegativeItemCount += 1
      }
      if (isShortage) {
        shortageItemCount += 1
        m.shortageDemandCount += 1
        if (m.firstShortage === null) {
          m.firstShortage = {
            sequence,
            orderId: d.orderId,
            orderNo: d.orderNo,
            orderLineId: d.orderLineId,
            deliveryDate: d.deliveryDate,
            requirement,
            balanceBefore,
            balanceAfter,
          }
        }
      }
      m.movements.push({
        sequence,
        orderLineId: d.orderLineId,
        requirement,
        balanceBefore,
        balanceAfter,
        shortageAtThisDemand,
        isShortage,
      })
      if (requirement > 0) {
        requirements.push({
          componentItemId: m.entry.componentItemId,
          componentCode: m.entry.componentCode,
          requirement,
          balanceBefore,
          balanceAfter,
          shortageAtThisDemand,
          isShortage,
        })
      }
    }

    demandResults.push({
      sequence,
      orderId: d.orderId,
      orderNo: d.orderNo,
      customerPoNo: d.customerPoNo ?? null,
      orderLineId: d.orderLineId,
      orderLineNo: d.orderLineNo ?? null,
      itemId: d.itemId,
      itemCode: d.itemCode,
      deliveryDate: d.deliveryDate,
      orderQty: d.orderQty,
      demandQty: e.demandQty,
      requirements,
      shortageItemCount,
      cumulativeNegativeItemCount,
    })
  })

  // 6) 결과 조립
  const materialResults: OrderMrpMaterialResult[] = materialList.map((m) => {
    const info = infoOf(m.entry.componentItemId)
    return {
      componentItemId: m.entry.componentItemId,
      componentCode: m.entry.componentCode,
      componentItemType: m.entry.componentItemType,
      name: info?.name ?? null,
      uom: info?.uom ?? null,
      supplierId: info?.supplierId ?? null,
      supplierName: info?.supplierName ?? null,
      openingStock: m.opening,
      totalRequirement: m.totalRequirement,
      finalBalance: m.balance,
      finalShortageQty: m.balance < 0 ? -m.balance : 0,
      shortageDemandCount: m.shortageDemandCount,
      negativeStepCount: m.negativeStepCount,
      firstShortage: m.firstShortage,
      movements: m.movements,
    }
  })

  let globalFirst: OrderMrpSummary["firstShortage"] = null
  for (const m of materialResults) {
    const f = m.firstShortage
    if (f === null) continue
    if (globalFirst === null || f.sequence < globalFirst.sequence) {
      globalFirst = {
        sequence: f.sequence,
        orderId: f.orderId,
        orderNo: f.orderNo,
        orderLineId: f.orderLineId,
        deliveryDate: f.deliveryDate,
        materials: [],
      }
    }
    if (f.sequence === globalFirst.sequence) {
      globalFirst.materials.push({
        componentItemId: m.componentItemId,
        componentCode: m.componentCode,
        requirement: f.requirement,
        balanceBefore: f.balanceBefore,
        balanceAfter: f.balanceAfter,
      })
    }
  }

  const summary: OrderMrpSummary = {
    includedDemandCount: demandResults.length,
    excludedDemandCount: excluded.length,
    materialCount: materialResults.length,
    shortageComponentCount: materialResults.filter((m) => m.finalBalance < 0).length,
    totalFinalShortageQty: materialResults.reduce((sum, m) => sum + m.finalShortageQty, 0),
    shortageDemandCount: demandResults.filter((d) => d.shortageItemCount > 0).length,
    firstShortage: globalFirst,
  }

  return {
    options: opts,
    demands: demandResults,
    materials: materialResults,
    summary,
    excludedOrderLines: excluded,
    warnings,
  }
}
