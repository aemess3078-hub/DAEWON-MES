/**
 * 기준정보 검증/분류 (순수) — SAFE / REVIEW / REJECT
 *
 * 원칙
 *  - 자동 수정 금지: "." → 1, 단위 추정, 코드 생성, 고객/공급업체 자동 병합, BOM 누락 자동 생성, Default 공급업체 지정 없음.
 *  - 확실하지 않으면 REVIEW. 명백히 깨졌거나 Master 가 아니면 REJECT.
 *  - Item 후보 = 설정(자재 목록) ∪ DB(제품 목록). BOM 구성품 코드가 후보에 없으면 Item 을 만들지 않고 해당 줄을 REJECT 한다.
 *  - 수주관리대장/재고관리대장에서만 보이는 식별자는 REVIEW(ORDER_ONLY / STOCK_ONLY)로만 남긴다.
 */

import { exactUom, INVISIBLE_SPACE, parseQty, round6, uomSuggestion } from "./text"
import type {
  BomCandidate,
  BomLineCandidate,
  CodeInfo,
  DuplicateComponentReport,
  Grade,
  Issue,
  ItemCandidate,
  ItemSupplierCandidate,
  ItemTypeName,
  MasterAnalysis,
  PartnerCandidate,
  PartnerTypeName,
  RawBomLine,
  RawExtraction,
  RawMaterialRow,
  SrcRef,
} from "./types"

function worst(issues: readonly Issue[]): Grade {
  if (issues.some((i) => i.grade === "REJECT")) return "REJECT"
  if (issues.length > 0) return "REVIEW"
  return "SAFE"
}

const CODE_DIAG_ISSUE: Record<string, { code: string; message: string }> = {
  NUMERIC_CELL: { code: "CODE_NUMERIC_CELL", message: "코드가 숫자 셀입니다(선행 0/지수 표기 손실 가능)" },
  LEADING_ZERO_FORMAT: { code: "CODE_LEADING_ZERO_FORMAT", message: "숫자 서식(0 채움)으로 표시된 코드입니다" },
  OUTER_WHITESPACE: { code: "CODE_OUTER_WHITESPACE", message: "코드 앞뒤에 공백이 있습니다" },
  HIDDEN_CHAR: { code: "CODE_HIDDEN_CHAR", message: "코드에 보이지 않는 문자가 있습니다" },
  INNER_WHITESPACE_RUN: { code: "CODE_INNER_WHITESPACE", message: "코드 안에 연속 공백이 있습니다" },
  FULLWIDTH_OR_COMPAT: { code: "CODE_FULLWIDTH", message: "코드에 전각/호환 문자가 있습니다" },
}

function codeIssues(info: CodeInfo): Issue[] {
  const out: Issue[] = []
  for (const d of info.diagnostics) {
    const spec = CODE_DIAG_ISSUE[d]
    if (spec) out.push({ code: spec.code, grade: "REVIEW", message: spec.message })
  }
  return out
}

type Agg = {
  code: string
  settings: RawMaterialRow[]
  productRows: Array<{ src: SrcRef; info: CodeInfo }>
  componentLines: RawBomLine[]
  orderCount: number
  stockRows: Array<{ name: string | null; spec: string | null; supplier: string | null; src: SrcRef }>
  /** 수주/재고 시트에서의 최초 위치(provenance) */
  extraSrc: SrcRef[]
  codeInfo: CodeInfo
}

function distinct<T>(values: Array<T | null>): T[] {
  const out: T[] = []
  values.forEach((v) => {
    if (v !== null && !out.includes(v)) out.push(v)
  })
  return out
}

/** 강한 연결 요소(Tarjan) — 순환 검출 */
function stronglyConnected(nodes: string[], edges: Map<string, string[]>): string[][] {
  let index = 0
  const stack: string[] = []
  const onStack = new Set<string>()
  const idx = new Map<string, number>()
  const low = new Map<string, number>()
  const result: string[][] = []
  const visit = (v: string) => {
    idx.set(v, index)
    low.set(v, index)
    index += 1
    stack.push(v)
    onStack.add(v)
    ;(edges.get(v) ?? []).forEach((w) => {
      if (!idx.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number))
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, idx.get(w) as number))
      }
    })
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = []
      let w: string
      do {
        w = stack.pop() as string
        onStack.delete(w)
        comp.push(w)
      } while (w !== v)
      result.push(comp)
    }
  }
  nodes.forEach((n) => {
    if (!idx.has(n)) visit(n)
  })
  return result
}

const CORP_NOISE = /(\(주\)|㈜|\(유\)|주식회사|유한회사|\(株\)|co\.?,?\s*ltd\.?|inc\.?)/gi

export function partnerFoldKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(CORP_NOISE, "")
    .replace(/\s/g, "").replace(INVISIBLE_SPACE, "").replace(/[.,()\-]/g, "")
    .toUpperCase()
}

export function analyzeMaster(ex: RawExtraction): MasterAnalysis {
  // ═══ 1) 후보 집계 ═══════════════════════════════════════════════════════════
  const aggs = new Map<string, Agg>()
  const orderOf: string[] = []
  const ensure = (info: CodeInfo): Agg => {
    const key = info.raw as string
    let a = aggs.get(key)
    if (!a) {
      a = { code: key, settings: [], productRows: [], componentLines: [], orderCount: 0, stockRows: [], extraSrc: [], codeInfo: info }
      aggs.set(key, a)
      orderOf.push(key)
    }
    return a
  }
  const rejectedEmpty: ItemCandidate[] = []

  ex.materials.forEach((m) => {
    if (m.code.raw === null || m.code.raw.trim() === "") {
      rejectedEmpty.push({
        key: `EMPTY@${m.src.sheet}!${m.src.row}`,
        code: "",
        proposed: { name: m.name, spec: m.spec, uom: m.uom, itemType: null },
        suggestions: {},
        flags: { inSettings: true, isBomParent: false, isBomComponent: false, orderOnly: false, stockSheetOnly: false },
        typeBasis: "코드 없음",
        grade: "REJECT",
        issues: [{ code: "CODE_MISSING", grade: "REJECT", message: "품목코드가 없습니다" }],
        sources: [m.src],
      })
      return
    }
    ensure(m.code).settings.push(m)
  })
  ex.products.forEach((p) => {
    if (p.code.raw === null || p.code.raw.trim() === "") {
      rejectedEmpty.push({
        key: `EMPTY@${p.src.sheet}!${p.src.row}`,
        code: "",
        proposed: { name: null, spec: null, uom: null, itemType: null },
        suggestions: {},
        flags: { inSettings: false, isBomParent: false, isBomComponent: false, orderOnly: false, stockSheetOnly: false },
        typeBasis: "코드 없음",
        grade: "REJECT",
        issues: [{ code: "CODE_MISSING", grade: "REJECT", message: "제품코드가 없습니다" }],
        sources: [p.src],
      })
      return
    }
    ensure(p.code).productRows.push({ src: p.src, info: p.code })
  })
  const candidateCodes = new Set<string>(orderOf)

  // 순서: 설정/제품(위) 이후에 order-only / stock-only 후보를 추가한다
  const orderOnlyCodes: string[] = []
  ex.orderRefs.products.forEach((p) => {
    if (p.code.raw === null || p.code.raw.trim() === "") return
    if (candidateCodes.has(p.code.raw)) {
      ;(aggs.get(p.code.raw) as Agg).orderCount += p.count
      return
    }
    const a = ensure(p.code)
    a.orderCount += p.count
    a.extraSrc.push({ sheet: "수주관리대장", row: p.firstRow })
    orderOnlyCodes.push(p.code.raw)
  })
  const stockOnlyCodes: string[] = []
  ex.stockSheetMaterials.forEach((s) => {
    if (s.code.raw === null || s.code.raw.trim() === "") return
    if (!aggs.has(s.code.raw)) {
      ensure(s.code)
      stockOnlyCodes.push(s.code.raw)
    }
    ;(aggs.get(s.code.raw) as Agg).stockRows.push({ name: s.name, spec: s.spec, supplier: s.supplier, src: s.src })
    if (stockOnlyCodes.includes(s.code.raw)) (aggs.get(s.code.raw) as Agg).extraSrc.push(s.src)
  })

  const parents = new Set<string>(ex.bomLines.map((l) => l.parentCode))
  const bomLinesByParent = new Map<string, RawBomLine[]>()
  ex.bomLines.forEach((l) => {
    const arr = bomLinesByParent.get(l.parentCode) ?? []
    arr.push(l)
    bomLinesByParent.set(l.parentCode, arr)
    if (l.component.raw !== null && aggs.has(l.component.raw)) (aggs.get(l.component.raw) as Agg).componentLines.push(l)
  })

  // ═══ 2) 근접 중복(코드) ════════════════════════════════════════════════════
  const foldGroups = new Map<string, string[]>()
  orderOf.forEach((code) => {
    const fk = (aggs.get(code) as Agg).codeInfo.foldKey
    if (fk === null) return
    const arr = foldGroups.get(fk) ?? []
    arr.push(code)
    foldGroups.set(fk, arr)
  })
  const nearDup = new Set<string>()
  foldGroups.forEach((codes) => {
    if (codes.length > 1) codes.forEach((c) => nearDup.add(c))
  })

  // 설정 시트와 재고관리대장 식별 정보 불일치
  const stockSheetMismatches: Array<{ code: string; fields: string[] }> = []

  // ═══ 3) Item 후보 ══════════════════════════════════════════════════════════
  const items: ItemCandidate[] = []
  orderOf.forEach((code) => {
    const a = aggs.get(code) as Agg
    const issues: Issue[] = [...codeIssues(a.codeInfo)]
    const inSettings = a.settings.length > 0
    const isProduct = a.productRows.length > 0 || parents.has(code)
    const isComponent = a.componentLines.length > 0
    const orderOnly = !inSettings && !isProduct && a.orderCount > 0
    const stockOnly = !inSettings && !isProduct && a.orderCount === 0 && a.stockRows.length > 0
    const sources: SrcRef[] = [...a.settings.map((s) => s.src), ...a.productRows.map((p) => p.src), ...a.extraSrc]

    if (nearDup.has(code)) issues.push({ code: "CODE_NEAR_DUPLICATE", grade: "REVIEW", message: "공백/대소문자/전각만 다른 비슷한 코드가 있습니다" })
    if (a.settings.length > 1) {
      issues.push({ code: "DUPLICATE_CODE", grade: "REVIEW", message: `자재 목록에 같은 코드가 ${a.settings.length}회 있습니다` })
    }
    if (a.productRows.length > 1) issues.push({ code: "DUPLICATE_PRODUCT", grade: "REVIEW", message: `제품 목록에 같은 코드가 ${a.productRows.length}회 있습니다` })
    if (inSettings && isProduct) {
      issues.push({ code: "CODE_IN_BOTH_LISTS", grade: "REVIEW", message: "자재 목록과 제품 목록에 모두 있는 코드입니다" })
    }

    // 속성(이름/규격/단위): 설정 시트 값이 기준. 서로 다르면 REVIEW
    const names = distinct(a.settings.map((s) => s.name))
    const specs = distinct(a.settings.map((s) => s.spec))
    const uoms = distinct(a.settings.map((s) => s.uom))
    const bomNames = distinct(a.componentLines.map((l) => l.name))
    const bomSpecs = distinct(a.componentLines.map((l) => l.spec))
    const bomUoms = distinct(a.componentLines.map((l) => l.uom))
    let name: string | null = names[0] ?? null
    let spec: string | null = specs[0] ?? null
    let uomRaw: string | null = uoms[0] ?? null
    if (names.length > 1) issues.push({ code: "NAME_CONFLICT", grade: "REVIEW", message: "자재 목록의 같은 코드에 서로 다른 품명이 있습니다" })
    if (specs.length > 1) issues.push({ code: "SPEC_CONFLICT", grade: "REVIEW", message: "자재 목록의 같은 코드에 서로 다른 규격이 있습니다" })
    if (uoms.length > 1) issues.push({ code: "UOM_CONFLICT", grade: "REVIEW", message: "자재 목록의 같은 코드에 서로 다른 단위가 있습니다" })
    if (name === null && bomNames.length === 1 && inSettings) {
      // 설정 시트에 품명이 비어 있고 BOM 에만 있을 때: 사용하지 않고 제안으로만 남긴다
    }
    if (inSettings) {
      if (name !== null && bomNames.some((n) => n !== name)) {
        issues.push({ code: "NAME_MISMATCH_BOM", grade: "REVIEW", message: "BOM 줄의 부품명이 자재 목록의 품명과 다릅니다" })
      }
      if (spec !== null && bomSpecs.some((s) => s !== spec)) {
        issues.push({ code: "SPEC_MISMATCH_BOM", grade: "REVIEW", message: "BOM 줄의 규격이 자재 목록의 규격과 다릅니다" })
      }
      if (uomRaw !== null && bomUoms.some((u) => u !== uomRaw)) {
        issues.push({ code: "UOM_MISMATCH_BOM", grade: "REVIEW", message: "BOM 줄의 단위가 자재 목록의 단위와 다릅니다" })
      }
    }

    const suggestions: ItemCandidate["suggestions"] = {}
    if (name === null) {
      issues.push({ code: "NAME_MISSING", grade: "REVIEW", message: "품명이 없습니다" })
      if (isProduct) suggestions.name = code
      else if (bomNames.length === 1) suggestions.name = bomNames[0]
    }
    if (spec === null && !isProduct && !orderOnly && !stockOnly) {
      issues.push({ code: "SPEC_MISSING", grade: "REVIEW", message: "규격이 없습니다" })
    } else if (spec === null) {
      issues.push({ code: "SPEC_MISSING", grade: "REVIEW", message: "규격이 없습니다" })
    }
    let uom: string | null = null
    if (uomRaw === null) {
      issues.push({ code: "UOM_MISSING", grade: "REVIEW", message: "단위가 없습니다" })
      if (bomUoms.length === 1 && exactUom(bomUoms[0]) !== null) suggestions.uom = bomUoms[0]
    } else if (exactUom(uomRaw) === null) {
      const sug = uomSuggestion(uomRaw)
      issues.push({
        code: sug ? "UOM_NOT_EXACT" : "UOM_UNKNOWN",
        grade: "REVIEW",
        message: sug ? `단위 "${uomRaw}" 는 공백/대소문자가 달라 자동 적용하지 않습니다(제안 ${sug})` : `MES 단위로 매핑할 수 없는 단위: "${uomRaw}"`,
      })
      if (sug) suggestions.uom = sug
    } else {
      uom = uomRaw
    }

    // 품목 유형(규칙 기반, 확정 불가 시 REVIEW)
    let itemType: ItemTypeName | null = null
    let typeBasis = ""
    if (isProduct && !isComponent) {
      itemType = "FINISHED"
      typeBasis = "BOM 의 최상위 제품(구성품으로 쓰이지 않음)"
    } else if (isProduct && isComponent) {
      itemType = "SEMI_FINISHED"
      typeBasis = "BOM 상위 품목이면서 다른 BOM 의 구성품"
    } else if (!isProduct && isComponent) {
      itemType = "RAW_MATERIAL"
      typeBasis = "BOM 구성품으로만 등장"
    } else if (orderOnly) {
      typeBasis = "수주관리대장에서만 나타나는 제품 코드(BOM 없음)"
      suggestions.itemType = "FINISHED"
      issues.push({ code: "ORDER_ONLY_PRODUCT", grade: "REVIEW", message: "수주관리대장에서만 나타나는 제품 코드입니다(운영 정보에서 유래, BOM 없음)" })
    } else if (stockOnly) {
      typeBasis = "재고관리대장에서만 나타나는 자재 코드"
      issues.push({ code: "STOCK_ONLY_MATERIAL", grade: "REVIEW", message: "재고관리대장에서만 나타나는 코드입니다(운영 정보에서 유래)" })
    } else {
      typeBasis = "자재 목록에는 있으나 어떤 BOM 에서도 쓰이지 않음"
      suggestions.itemType = "RAW_MATERIAL"
      issues.push({ code: "TYPE_UNDETERMINED", grade: "REVIEW", message: "어떤 BOM 에도 쓰이지 않아 품목 유형을 확정할 수 없습니다" })
    }
    if (isProduct && parents.has(code) === false) {
      issues.push({ code: "NO_BOM", grade: "REVIEW", message: "BOM 이 없는 제품입니다(자동 생성하지 않음)" })
    }

    // 재고관리대장 교차 검증(설정 시트 기준)
    if (inSettings && a.stockRows.length > 0) {
      const fields: string[] = []
      a.stockRows.forEach((s) => {
        if (s.name !== null && name !== null && s.name !== name && !fields.includes("name")) fields.push("name")
        if (s.spec !== null && spec !== null && s.spec !== spec && !fields.includes("spec")) fields.push("spec")
        if (s.supplier !== null && a.settings[0].supplier !== null && s.supplier !== a.settings[0].supplier && !fields.includes("supplier")) fields.push("supplier")
      })
      if (fields.length > 0) {
        stockSheetMismatches.push({ code, fields })
        issues.push({ code: "STOCK_SHEET_MISMATCH", grade: "REVIEW", message: `재고관리대장의 식별 정보가 자재 목록과 다릅니다(${fields.join(", ")})` })
      }
    }

    items.push({
      key: code,
      code,
      proposed: { name, spec, uom, itemType },
      suggestions,
      flags: { inSettings, isBomParent: parents.has(code), isBomComponent: isComponent, orderOnly, stockSheetOnly: stockOnly },
      typeBasis,
      grade: worst(issues),
      issues,
      sources,
    })
  })
  rejectedEmpty.forEach((r) => items.push(r))
  const itemByCode = new Map<string, ItemCandidate>()
  items.forEach((it) => {
    if (it.code !== "") itemByCode.set(it.code, it)
  })
  // BOM 구성품/상위 판정에 쓰는 "Item 후보" = 설정 ∪ 제품 목록 (order/stock-only 는 구성품으로 인정하지 않는다)
  const isRealCandidate = (code: string) => {
    const it = itemByCode.get(code)
    return !!it && (it.flags.inSettings || it.flags.isBomParent || (aggs.get(code) as Agg).productRows.length > 0)
  }

  // ═══ 4) BOM ════════════════════════════════════════════════════════════════
  const boms: BomCandidate[] = []
  const duplicateComponents: DuplicateComponentReport[] = []
  const edgeMap = new Map<string, string[]>()
  const parentOrder: string[] = []
  bomLinesByParent.forEach((_lines, parent) => parentOrder.push(parent))

  // 1차: 줄 단위 기본 검증 + 그래프 간선 수집(구성품이 후보에 있는 줄만)
  const partial = new Map<string, BomLineCandidate[]>()
  parentOrder.forEach((parent) => {
    const raw = bomLinesByParent.get(parent) as RawBomLine[]
    const lines: BomLineCandidate[] = []
    raw.forEach((l, i) => {
      const issues: Issue[] = []
      const comp = l.component.raw
      const qty = parseQty(l.qty)
      if (comp === null || comp.trim() === "") {
        issues.push({ code: "COMPONENT_CODE_MISSING", grade: "REJECT", message: "구성품 코드가 없습니다" })
      } else {
        l.component.diagnostics.forEach((d) => {
          const spec = CODE_DIAG_ISSUE[d]
          if (spec) issues.push({ code: spec.code, grade: "REVIEW", message: spec.message })
        })
        if (!isRealCandidate(comp)) {
          issues.push({ code: "COMPONENT_NOT_FOUND", grade: "REJECT", message: "구성품이 자재/제품 목록에 없습니다(Item 을 임의 생성하지 않음)" })
        } else if (comp === parent) {
          issues.push({ code: "SELF_REFERENCE", grade: "REJECT", message: "자기 자신을 구성품으로 가집니다" })
        } else {
          const e = edgeMap.get(parent) ?? []
          if (!e.includes(comp)) e.push(comp)
          edgeMap.set(parent, e)
          if (itemByCode.get(comp)?.grade === "REJECT") {
            issues.push({ code: "COMPONENT_REJECTED", grade: "REJECT", message: "구성품 품목이 REJECT 입니다" })
          }
        }
      }
      if (qty === null) {
        issues.push({ code: "INVALID_QTY", grade: "REJECT", message: `구성수량이 올바르지 않습니다(${l.qty === null || l.qty === "" ? "빈 값" : JSON.stringify(l.qty)})` })
      }
      lines.push({
        seq: i + 1,
        componentCode: comp ?? "",
        qtyPer: qty === null ? null : round6(qty),
        qtyRaw: l.qty,
        uom: l.uom,
        grade: worst(issues),
        issues,
        src: l.src,
      })
    })
    partial.set(parent, lines)
  })

  // 순환
  const nodes = Array.from(new Set<string>([...parentOrder, ...Array.from(edgeMap.values()).reduce<string[]>((acc, v) => acc.concat(v), [])]))
  const comps = stronglyConnected(nodes, edgeMap)
  const cycles: string[][] = []
  const inCycle = new Set<string>()
  comps.forEach((c) => {
    if (c.length > 1) {
      cycles.push(c.slice().sort())
      c.forEach((n) => inCycle.add(n))
    }
  })
  // 깊이(DAG 부분) — 순환에 걸리는 노드는 null
  const depthMemo = new Map<string, number | null>()
  const depthOf = (n: string, trail: Set<string>): number | null => {
    if (depthMemo.has(n)) return depthMemo.get(n) as number | null
    if (inCycle.has(n) || trail.has(n)) return null
    trail.add(n)
    let best = 0
    let broken = false
    ;(edgeMap.get(n) ?? []).forEach((c) => {
      const d = depthOf(c, trail)
      if (d === null) broken = true
      else if (d > best) best = d
    })
    trail.delete(n)
    const res = broken ? null : best + 1
    depthMemo.set(n, res)
    return res
  }
  let maxBomDepth = 0

  parentOrder.forEach((parent) => {
    const lines = partial.get(parent) as BomLineCandidate[]
    const parentInfo = itemByCode.get(parent)
    // 중복 구성품
    const byComp = new Map<string, BomLineCandidate[]>()
    lines.forEach((l) => {
      if (l.componentCode === "") return
      const arr = byComp.get(l.componentCode) ?? []
      arr.push(l)
      byComp.set(l.componentCode, arr)
    })
    byComp.forEach((ls, comp) => {
      if (ls.length > 1) {
        const qtys = ls.map((l) => l.qtyPer)
        duplicateComponents.push({
          parentCode: parent,
          componentCode: comp,
          lineCount: ls.length,
          qtys,
          sumQty: qtys.every((q) => q !== null) ? round6(qtys.reduce<number>((s, q) => s + (q as number), 0)) : null,
          rows: ls.map((l) => l.src.row),
        })
        ls.forEach((l) => {
          l.issues.push({ code: "DUPLICATE_COMPONENT", grade: "REVIEW", message: `같은 BOM 에 같은 구성품이 ${ls.length}줄 있습니다(합산은 승인 필요)` })
          l.grade = worst(l.issues)
        })
      }
    })
    // 순환 줄 표시
    if (inCycle.has(parent)) {
      lines.forEach((l) => {
        if (l.componentCode !== "" && inCycle.has(l.componentCode)) {
          const sameScc = comps.some((c) => c.length > 1 && c.includes(parent) && c.includes(l.componentCode))
          if (sameScc) {
            l.issues.push({ code: "BOM_CYCLE", grade: "REJECT", message: "BOM 순환 참조에 포함된 줄입니다" })
            l.grade = worst(l.issues)
          }
        }
      })
    }
    const issues: Issue[] = []
    if (!parentInfo || parentInfo.grade === "REJECT") {
      issues.push({ code: "PARENT_REJECTED", grade: "REJECT", message: "상위 품목이 없거나 REJECT 입니다" })
    }
    if (lines.some((l) => l.grade === "REJECT")) issues.push({ code: "BOM_HAS_REJECTED_LINES", grade: "REJECT", message: "REJECT 줄이 있어 BOM 전체를 가져오지 않습니다(부분 BOM 방지)" })
    else if (lines.some((l) => l.grade === "REVIEW")) issues.push({ code: "BOM_HAS_REVIEW_LINES", grade: "REVIEW", message: "확인이 필요한 줄이 있습니다" })
    const depth = depthOf(parent, new Set<string>())
    if (depth !== null && depth > maxBomDepth) maxBomDepth = depth
    boms.push({
      parentCode: parent,
      lines,
      grade: worst(issues),
      issues,
      depth,
      src: (bomLinesByParent.get(parent) as RawBomLine[])[0].parentSrc,
    })
  })

  const finishedWithoutBom = items
    .filter((i) => i.code !== "" && (i.flags.orderOnly || (aggsHasProduct(aggs, i.code) && !parents.has(i.code))))
    .map((i) => i.code)

  // ═══ 5) 거래처 ═════════════════════════════════════════════════════════════
  const partnerMap = new Map<string, PartnerCandidate>()
  const touchPartner = (name: string, role: "customer" | "supplier", row: number, count: number, src: SrcRef) => {
    let p = partnerMap.get(name)
    if (!p) {
      p = { name, partnerType: role === "customer" ? "CUSTOMER" : "SUPPLIER", code: null, occurrences: 0, roles: { customer: 0, supplier: 0 }, grade: "REVIEW", issues: [], firstRow: row, sources: [] }
      partnerMap.set(name, p)
    }
    p.occurrences += count
    p.roles[role] += count
    p.sources.push(src)
    if (p.roles.customer > 0 && p.roles.supplier > 0) p.partnerType = "BOTH"
  }
  ex.orderRefs.customers.forEach((c) => touchPartner(c.name, "customer", c.firstRow, c.count, { sheet: "수주관리대장", row: c.firstRow }))
  ex.materials.forEach((m) => {
    if (m.supplier !== null) touchPartner(m.supplier, "supplier", m.src.row, 1, m.src)
  })
  ex.stockSheetMaterials.forEach((s) => {
    if (s.supplier !== null && !partnerMap.has(s.supplier)) touchPartner(s.supplier, "supplier", s.src.row, 1, s.src)
  })
  const partners = Array.from(partnerMap.values())
  const foldPartners = new Map<string, string[]>()
  partners.forEach((p) => {
    const k = partnerFoldKey(p.name)
    const arr = foldPartners.get(k) ?? []
    arr.push(p.name)
    foldPartners.set(k, arr)
  })
  const partnerNearDuplicates: Array<{ foldKey: string; names: string[] }> = []
  foldPartners.forEach((names, k) => {
    if (names.length > 1) partnerNearDuplicates.push({ foldKey: k, names: names.slice().sort() })
  })
  const nearNames = new Set<string>()
  partnerNearDuplicates.forEach((g) => g.names.forEach((n) => nearNames.add(n)))
  partners.forEach((p) => {
    p.issues.push({ code: "PARTNER_CODE_MISSING", grade: "REVIEW", message: "Excel 에 거래처 코드가 없습니다(코드를 임의 생성하지 않음)" })
    p.issues.push({
      code: p.roles.customer > 0 ? "PARTNER_STATUS_UNKNOWN" : "PARTNER_ACTIVE_UNKNOWN",
      grade: "REVIEW",
      message: "현재 거래 여부/최신 연락처를 Excel 로 확인할 수 없습니다",
    })
    if (nearNames.has(p.name)) p.issues.push({ code: "PARTNER_NEAR_DUPLICATE", grade: "REVIEW", message: "공백/법인 표기만 다른 비슷한 이름이 있습니다(자동 병합 안 함)" })
    if (p.partnerType === "BOTH") p.issues.push({ code: "PARTNER_BOTH_BY_NAME", grade: "REVIEW", message: "고객/공급업체 양쪽에 같은 이름이 있습니다(이름만 같음, 사업자번호 근거 없음)" })
    p.grade = worst(p.issues)
  })

  // ═══ 6) ItemSupplier ═══════════════════════════════════════════════════════
  const itemSuppliers: ItemSupplierCandidate[] = []
  const seenPair = new Set<string>()
  ex.materials.forEach((m) => {
    if (m.code.raw === null || m.supplier === null) return
    const k = `${m.code.raw}|${m.supplier}`
    if (seenPair.has(k)) return
    seenPair.add(k)
    const issues: Issue[] = [{ code: "SUPPLIER_UNRESOLVED", grade: "REVIEW", message: "공급업체 코드/활성 여부 확인 전(거래처 REVIEW)" }]
    const it = itemByCode.get(m.code.raw)
    if (!it || it.grade === "REJECT") issues.push({ code: "ITEM_REJECTED", grade: "REJECT", message: "품목이 없거나 REJECT 입니다" })
    itemSuppliers.push({ itemCode: m.code.raw, supplierName: m.supplier, isDefault: false, grade: worst(issues), issues, src: m.src })
  })

  const byName = new Map<string, string[]>()
  items.forEach((i) => {
    if (i.code !== "" && i.proposed.name !== null) {
      const arr = byName.get(i.proposed.name) ?? []
      arr.push(i.code)
      byName.set(i.proposed.name, arr)
    }
  })
  const sameNameDifferentCode: Array<{ name: string; codes: string[] }> = []
  byName.forEach((codes, name) => {
    if (codes.length > 1) sameNameDifferentCode.push({ name, codes })
  })

  return { items, boms, duplicateComponents, partners, partnerNearDuplicates, itemSuppliers, finishedWithoutBom, cycles, maxBomDepth, sameNameDifferentCode, stockSheetMismatches }
}

function aggsHasProduct(aggs: Map<string, Agg>, code: string): boolean {
  const a = aggs.get(code)
  return !!a && a.productRows.length > 0
}

export type GradeCounts = { total: number; SAFE: number; REVIEW: number; REJECT: number }
export function countGrades(list: ReadonlyArray<{ grade: Grade }>): GradeCounts {
  const c: GradeCounts = { total: list.length, SAFE: 0, REVIEW: 0, REJECT: 0 }
  list.forEach((x) => {
    c[x.grade] += 1
  })
  return c
}

export type PartnerTypeCounts = Record<PartnerTypeName, number>
