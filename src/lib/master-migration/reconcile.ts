/**
 * 기존 MES Master 와 후보/데이터셋 대조 (순수): CREATE / MATCH / CONFLICT / REJECT
 *
 *  - CREATE  : MES 에 같은 identity 가 없다.
 *  - MATCH   : 같은 identity 가 있고 알려진 속성이 모두 같다(재실행해도 아무것도 만들지 않는다).
 *  - CONFLICT: 같은 identity 가 있으나 내용이 다르다. 자동 overwrite 하지 않는다(사용자 확인 필요).
 *  - REJECT  : 가져올 수 없다(검증 REJECT).
 *
 * identity: Item = tenant + code, BOM = 상위 Item 의 BOM, Partner = code(있으면) 또는 정확한 이름, ItemSupplier = (품목, 공급업체).
 */

import type {
  ApprovedMasterDataset,
  ExistingMasterSnapshot,
  Grade,
  MasterAnalysis,
  ReconcileClass,
} from "./types"

export type ReconcileEntry = {
  kind: "ITEM" | "BOM" | "PARTNER" | "ITEM_SUPPLIER"
  key: string
  class: ReconcileClass
  grade: Grade | null
  diff: string[]
}

export type ReconcileCounts = Record<ReconcileClass, number>
export type ReconcileSummary = {
  ITEM: ReconcileCounts
  BOM: ReconcileCounts
  PARTNER: ReconcileCounts
  ITEM_SUPPLIER: ReconcileCounts
}

const empty = (): ReconcileCounts => ({ CREATE: 0, MATCH: 0, CONFLICT: 0, REJECT: 0 })

export function summarize(entries: readonly ReconcileEntry[]): ReconcileSummary {
  const s: ReconcileSummary = { ITEM: empty(), BOM: empty(), PARTNER: empty(), ITEM_SUPPLIER: empty() }
  entries.forEach((e) => {
    s[e.kind][e.class] += 1
  })
  return s
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim() === (b ?? "").trim()

function bomSignature(lines: ReadonlyArray<{ componentCode: string; qtyPer: number | null }>): string {
  return lines
    .map((l) => `${l.componentCode}|${l.qtyPer === null ? "?" : Math.round(l.qtyPer * 1e6) / 1e6}`)
    .sort()
    .join(";")
}

type ItemLike = { code: string; name: string | null; spec: string | null; uom: string | null; itemType: string | null }

function itemDiff(existing: ExistingMasterSnapshot["items"][number], p: ItemLike): string[] {
  const diff: string[] = []
  if (p.name !== null && !same(existing.name, p.name)) diff.push("name")
  if (p.spec !== null && !same(existing.spec, p.spec)) diff.push("spec")
  if (p.uom !== null && existing.uom !== p.uom) diff.push("uom")
  if (p.itemType !== null && existing.itemType !== p.itemType) diff.push("itemType")
  return diff
}

class Index {
  readonly itemByCode = new Map<string, ExistingMasterSnapshot["items"][number]>()
  readonly bomsByItem = new Map<string, ExistingMasterSnapshot["boms"]>()
  readonly partnerByCode = new Map<string, ExistingMasterSnapshot["partners"][number]>()
  readonly partnersByName = new Map<string, ExistingMasterSnapshot["partners"]>()
  readonly pair = new Set<string>()

  constructor(s: ExistingMasterSnapshot) {
    s.items.forEach((i) => this.itemByCode.set(i.code, i))
    s.boms.forEach((b) => {
      const arr = this.bomsByItem.get(b.itemCode) ?? []
      arr.push(b)
      this.bomsByItem.set(b.itemCode, arr)
    })
    s.partners.forEach((p) => {
      this.partnerByCode.set(p.code, p)
      const arr = this.partnersByName.get(p.name) ?? []
      arr.push(p)
      this.partnersByName.set(p.name, arr)
    })
    s.itemSuppliers.forEach((x) => this.pair.add(`${x.itemCode}|${x.supplierCode}`))
  }
}

function classifyBom(ix: Index, parentCode: string, lines: ReadonlyArray<{ componentCode: string; qtyPer: number | null }>): { cls: ReconcileClass; diff: string[] } {
  const existing = ix.bomsByItem.get(parentCode)
  if (!existing || existing.length === 0) return { cls: "CREATE", diff: [] }
  const sig = bomSignature(lines)
  if (existing.some((b) => bomSignature(b.lines) === sig)) return { cls: "MATCH", diff: [] }
  return { cls: "CONFLICT", diff: ["lines"] }
}

/** 분석 후보 전체(SAFE/REVIEW/REJECT) 대조 — dry-run 용 */
export function reconcileCandidates(analysis: MasterAnalysis, existing: ExistingMasterSnapshot): ReconcileEntry[] {
  const ix = new Index(existing)
  const out: ReconcileEntry[] = []
  analysis.items.forEach((c) => {
    if (c.grade === "REJECT") {
      out.push({ kind: "ITEM", key: c.code || c.key, class: "REJECT", grade: c.grade, diff: [] })
      return
    }
    const e = ix.itemByCode.get(c.code)
    if (!e) return void out.push({ kind: "ITEM", key: c.code, class: "CREATE", grade: c.grade, diff: [] })
    const diff = itemDiff(e, { code: c.code, ...c.proposed })
    out.push({ kind: "ITEM", key: c.code, class: diff.length === 0 ? "MATCH" : "CONFLICT", grade: c.grade, diff })
  })
  analysis.boms.forEach((b) => {
    if (b.grade === "REJECT") {
      out.push({ kind: "BOM", key: b.parentCode, class: "REJECT", grade: b.grade, diff: [] })
      return
    }
    const r = classifyBom(ix, b.parentCode, b.lines)
    out.push({ kind: "BOM", key: b.parentCode, class: r.cls, grade: b.grade, diff: r.diff })
  })
  analysis.partners.forEach((p) => {
    const same = ix.partnersByName.get(p.name) ?? []
    if (same.length === 0) return void out.push({ kind: "PARTNER", key: `${p.partnerType}|${p.name}`, class: "CREATE", grade: p.grade, diff: [] })
    const compatible = same.some((x) => x.partnerType === p.partnerType || x.partnerType === "BOTH" || p.partnerType === "BOTH")
    out.push({ kind: "PARTNER", key: `${p.partnerType}|${p.name}`, class: compatible ? "MATCH" : "CONFLICT", grade: p.grade, diff: compatible ? [] : ["partnerType"] })
  })
  analysis.itemSuppliers.forEach((s) => {
    const k = `${s.itemCode}|${s.supplierName}`
    if (s.grade === "REJECT") return void out.push({ kind: "ITEM_SUPPLIER", key: k, class: "REJECT", grade: s.grade, diff: [] })
    const partners = ix.partnersByName.get(s.supplierName) ?? []
    const exists = partners.some((p) => ix.pair.has(`${s.itemCode}|${p.code}`))
    out.push({ kind: "ITEM_SUPPLIER", key: k, class: exists ? "MATCH" : "CREATE", grade: s.grade, diff: [] })
  })
  return out
}

/** 승인된 데이터셋 대조 — apply 가 사용한다(여기서 CONFLICT 는 쓰지 않는다) */
export function reconcileDataset(dataset: ApprovedMasterDataset, existing: ExistingMasterSnapshot): ReconcileEntry[] {
  const ix = new Index(existing)
  const out: ReconcileEntry[] = []
  dataset.items.forEach((i) => {
    const e = ix.itemByCode.get(i.code)
    if (!e) return void out.push({ kind: "ITEM", key: i.code, class: "CREATE", grade: null, diff: [] })
    const diff = itemDiff(e, i)
    out.push({ kind: "ITEM", key: i.code, class: diff.length === 0 ? "MATCH" : "CONFLICT", grade: null, diff })
  })
  dataset.boms.forEach((b) => {
    const r = classifyBom(ix, b.parentCode, b.lines)
    out.push({ kind: "BOM", key: b.parentCode, class: r.cls, grade: null, diff: r.diff })
  })
  dataset.partners.forEach((p) => {
    const byCode = ix.partnerByCode.get(p.code)
    if (byCode) {
      const ok = same(byCode.name, p.name) && byCode.partnerType === p.partnerType
      return void out.push({ kind: "PARTNER", key: p.code, class: ok ? "MATCH" : "CONFLICT", grade: null, diff: ok ? [] : ["name/partnerType"] })
    }
    // 같은 이름이 다른 코드로 이미 있으면 충돌(중복 거래처 생성 방지)
    const byName = ix.partnersByName.get(p.name) ?? []
    out.push({ kind: "PARTNER", key: p.code, class: byName.length > 0 ? "CONFLICT" : "CREATE", grade: null, diff: byName.length > 0 ? ["name-exists-with-other-code"] : [] })
  })
  dataset.itemSuppliers.forEach((s) => {
    out.push({ kind: "ITEM_SUPPLIER", key: `${s.itemCode}|${s.supplierCode}`, class: ix.pair.has(`${s.itemCode}|${s.supplierCode}`) ? "MATCH" : "CREATE", grade: null, diff: [] })
  })
  return out
}
