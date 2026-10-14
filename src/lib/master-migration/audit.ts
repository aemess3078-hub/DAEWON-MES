/**
 * 운영 Master 최종 감사 (순수 — DB/파일 비의존, 읽기 전용 입력만) — Phase 7C
 *
 *  입력: 운영 Master 스냅샷(SELECT 결과) + Approved Dataset + 분석 결과(Excel 에서 만든 REVIEW 근거)
 *  출력: Dataset 대조(MATCH/MISMATCH/MISSING/EXTRA), 결정적 Master baseline hash, 무결성/커버리지/의존성 보고,
 *        로컬 보완 템플릿(CSV). 이 모듈은 어떤 쓰기도 하지 않는다.
 */

import { createHash } from "node:crypto"
import { round6 } from "./text"
import type { ApprovedMasterDataset, MasterAnalysis } from "./types"

export type ProdItem = { code: string; name: string; spec: string | null; uom: string; itemType: string; status: string; tenantId: string }
export type ProdBomLine = { seq: number; componentCode: string | null; qtyPer: number; scrapRate: number; componentTenantId: string | null }
export type ProdBom = { itemCode: string | null; version: string; status: string; isDefault: boolean; tenantId: string; lines: ProdBomLine[] }
export type ProdPartner = {
  code: string
  name: string
  partnerType: string
  status: string
  tenantId: string
  businessNumber: string | null
  ceoName: string | null
  phone: string | null
  email: string | null
  address: string | null
  contactName: string | null
  contactPhone: string | null
}
export type ProdItemSupplier = {
  itemCode: string | null
  supplierCode: string | null
  isDefault: boolean
  leadTimeDays: number | null
  moq: number | null
  orderMultiple: number | null
  isActive: boolean
  tenantId: string
  itemTenantId: string | null
  supplierTenantId: string | null
  supplierPartnerType: string | null
}
export type ProdMaster = { tenantId: string; items: ProdItem[]; boms: ProdBom[]; partners: ProdPartner[]; itemSuppliers: ProdItemSupplier[] }

const num = (n: number | null | undefined) => (n === null || n === undefined ? null : round6(Number(n)))
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// ─── Master baseline hash ──────────────────────────────────────────────────────
/** 업무 Master 값만(id/createdAt/updatedAt 제외), 결정적 정렬 → sha256 */
export function masterBaseline(master: ProdMaster) {
  const items = master.items
    .map((i) => [i.code, i.name, i.spec ?? null, i.uom, i.itemType, i.status])
    .sort((a, b) => cmp(String(a[0]), String(b[0])))
  const boms = master.boms
    .map((b) => [
      b.itemCode,
      b.version,
      b.status,
      b.isDefault,
      b.lines
        .slice()
        .sort((x, y) => x.seq - y.seq)
        .map((l) => [l.seq, l.componentCode, num(l.qtyPer), num(l.scrapRate)]),
    ])
    .sort((a, b) => cmp(String(a[0]) + "|" + String(a[1]), String(b[0]) + "|" + String(b[1])))
  const partners = master.partners.map((p) => [p.code, p.name, p.partnerType, p.status]).sort((a, b) => cmp(String(a[0]), String(b[0])))
  const itemSuppliers = master.itemSuppliers
    .map((s) => [s.itemCode, s.supplierCode, s.isDefault, num(s.leadTimeDays), num(s.moq), num(s.orderMultiple), s.isActive])
    .sort((a, b) => cmp(String(a[0]) + "|" + String(a[1]), String(b[0]) + "|" + String(b[1])))
  const payload = JSON.stringify({ v: 1, items, boms, partners, itemSuppliers })
  return {
    hash: createHash("sha256").update(payload, "utf8").digest("hex"),
    counts: { items: items.length, boms: boms.length, bomItems: boms.reduce((s, b) => s + (b[4] as unknown[]).length, 0), partners: partners.length, itemSuppliers: itemSuppliers.length },
  }
}

// ─── Dataset ↔ Production ──────────────────────────────────────────────────────
type Bucket = { MATCH: number; MISMATCH: number; MISSING: number; EXTRA: number; mismatches: Array<{ key: string; fields: string[] }>; missing: string[]; extra: string[] }
const bucket = (): Bucket => ({ MATCH: 0, MISMATCH: 0, MISSING: 0, EXTRA: 0, mismatches: [], missing: [], extra: [] })

export function compareToDataset(master: ProdMaster, ds: ApprovedMasterDataset) {
  const out = { items: bucket(), boms: bucket(), bomItems: bucket(), partners: bucket(), itemSuppliers: bucket() }
  // Item
  const itemBy = new Map(master.items.map((i) => [i.code, i]))
  const seenItems = new Set<string>()
  ds.items.forEach((d) => {
    seenItems.add(d.code)
    const e = itemBy.get(d.code)
    if (!e) {
      out.items.MISSING += 1
      out.items.missing.push(d.code)
      return
    }
    const f: string[] = []
    if (e.name !== d.name) f.push("name")
    if ((e.spec ?? null) !== d.spec) f.push("spec")
    if (e.uom !== d.uom) f.push("uom")
    if (e.itemType !== d.itemType) f.push("type")
    if (e.status !== "ACTIVE") f.push("status")
    if (f.length === 0) out.items.MATCH += 1
    else {
      out.items.MISMATCH += 1
      out.items.mismatches.push({ key: d.code, fields: f })
    }
  })
  master.items.forEach((i) => {
    if (!seenItems.has(i.code)) {
      out.items.EXTRA += 1
      out.items.extra.push(i.code)
    }
  })
  // BOM / BOMItem
  const bomBy = new Map(master.boms.map((b) => [b.itemCode as string, b]))
  const seenBoms = new Set<string>()
  ds.boms.forEach((d) => {
    seenBoms.add(d.parentCode)
    const e = bomBy.get(d.parentCode)
    if (!e) {
      out.boms.MISSING += 1
      out.boms.missing.push(d.parentCode)
      d.lines.forEach(() => (out.bomItems.MISSING += 1))
      return
    }
    const f: string[] = []
    if (e.version !== d.version) f.push("version")
    if (!e.isDefault) f.push("isDefault")
    if (e.status !== "ACTIVE") f.push("status")
    if (f.length === 0) out.boms.MATCH += 1
    else {
      out.boms.MISMATCH += 1
      out.boms.mismatches.push({ key: d.parentCode, fields: f })
    }
    const lineBy = new Map(e.lines.map((l) => [l.seq, l]))
    const seenSeq = new Set<number>()
    d.lines.forEach((dl) => {
      seenSeq.add(dl.seq)
      const el = lineBy.get(dl.seq)
      if (!el) {
        out.bomItems.MISSING += 1
        out.bomItems.missing.push(`${d.parentCode}#${dl.seq}`)
      } else if (el.componentCode !== dl.componentCode || num(el.qtyPer) !== num(dl.qtyPer)) {
        out.bomItems.MISMATCH += 1
        out.bomItems.mismatches.push({ key: `${d.parentCode}#${dl.seq}`, fields: [el.componentCode !== dl.componentCode ? "component" : "qty"] })
      } else out.bomItems.MATCH += 1
    })
    e.lines.forEach((l) => {
      if (!seenSeq.has(l.seq)) {
        out.bomItems.EXTRA += 1
        out.bomItems.extra.push(`${d.parentCode}#${l.seq}`)
      }
    })
  })
  master.boms.forEach((b) => {
    if (!seenBoms.has(b.itemCode as string)) {
      out.boms.EXTRA += 1
      out.boms.extra.push(String(b.itemCode))
      b.lines.forEach(() => (out.bomItems.EXTRA += 1))
    }
  })
  // Partner
  const partnerBy = new Map(master.partners.map((p) => [p.code, p]))
  const seenP = new Set<string>()
  ds.partners.forEach((d) => {
    seenP.add(d.code)
    const e = partnerBy.get(d.code)
    if (!e) {
      out.partners.MISSING += 1
      out.partners.missing.push(d.code)
      return
    }
    const f: string[] = []
    if (e.name !== d.name) f.push("name")
    if (e.partnerType !== d.partnerType) f.push("type")
    if (e.status !== "ACTIVE") f.push("status")
    if (f.length === 0) out.partners.MATCH += 1
    else {
      out.partners.MISMATCH += 1
      out.partners.mismatches.push({ key: d.code, fields: f })
    }
  })
  master.partners.forEach((p) => {
    if (!seenP.has(p.code)) {
      out.partners.EXTRA += 1
      out.partners.extra.push(p.code)
    }
  })
  // ItemSupplier
  const isBy = new Map(master.itemSuppliers.map((s) => [`${s.itemCode}|${s.supplierCode}`, s]))
  const seenIs = new Set<string>()
  ds.itemSuppliers.forEach((d) => {
    const k = `${d.itemCode}|${d.supplierCode}`
    seenIs.add(k)
    const e = isBy.get(k)
    if (!e) {
      out.itemSuppliers.MISSING += 1
      out.itemSuppliers.missing.push(k)
      return
    }
    const f: string[] = []
    if (e.isDefault !== false) f.push("isDefault")
    if (e.leadTimeDays !== null) f.push("leadTimeDays")
    if (e.moq !== null) f.push("moq")
    if (e.orderMultiple !== null) f.push("orderMultiple")
    if (f.length === 0) out.itemSuppliers.MATCH += 1
    else {
      out.itemSuppliers.MISMATCH += 1
      out.itemSuppliers.mismatches.push({ key: k, fields: f })
    }
  })
  master.itemSuppliers.forEach((s) => {
    const k = `${s.itemCode}|${s.supplierCode}`
    if (!seenIs.has(k)) {
      out.itemSuppliers.EXTRA += 1
      out.itemSuppliers.extra.push(k)
    }
  })
  return out
}

// ─── Item / RAW / BOM / Partner / ItemSupplier 감사 ──────────────────────────────
const UOMS = ["EA", "KG", "G", "L", "ML", "M", "CM", "MM", "BOX", "SET"]
const ITEM_TYPES = ["RAW_MATERIAL", "SEMI_FINISHED", "FINISHED", "CONSUMABLE"]

export function auditItems(master: ProdMaster) {
  const codes = new Map<string, number>()
  master.items.forEach((i) => codes.set(i.code, (codes.get(i.code) ?? 0) + 1))
  const finished = master.items.filter((i) => i.itemType === "FINISHED")
  const placeholder = finished.filter((i) => i.name === i.code && i.uom === "EA" && (i.spec ?? null) === null)
  return {
    total: master.items.length,
    byType: {
      FINISHED: finished.length,
      RAW_MATERIAL: master.items.filter((i) => i.itemType === "RAW_MATERIAL").length,
      SEMI_FINISHED: master.items.filter((i) => i.itemType === "SEMI_FINISHED").length,
    },
    codeBlank: master.items.filter((i) => !i.code || i.code.trim() === "").length,
    duplicateCode: Array.from(codes.values()).filter((n) => n > 1).length,
    nameBlank: master.items.filter((i) => !i.name || i.name.trim() === "").length,
    invalidType: master.items.filter((i) => !ITEM_TYPES.includes(i.itemType)).length,
    invalidUom: master.items.filter((i) => !UOMS.includes(i.uom)).length,
    tenantMismatch: master.items.filter((i) => i.tenantId !== master.tenantId).length,
    inactive: master.items.filter((i) => i.status !== "ACTIVE").length,
    finishedPlaceholder: placeholder.length,
    finishedEnrichmentRequired: placeholder.length,
  }
}

export function auditBoms(master: ProdMaster) {
  const itemCodes = new Set(master.items.map((i) => i.code))
  let lines = 0
  const bad = { orphanParent: 0, orphanComponent: 0, tenantMismatch: 0, qtyInvalid: 0, duplicateComponent: 0, selfReference: 0, versionInvalid: 0 }
  const defaults = new Map<string, number>()
  let inactiveDefault = 0
  const edges = new Map<string, string[]>()
  master.boms.forEach((b) => {
    if (!b.itemCode || !itemCodes.has(b.itemCode)) bad.orphanParent += 1
    if (!b.version || b.version.trim() === "") bad.versionInvalid += 1
    if (b.tenantId !== master.tenantId) bad.tenantMismatch += 1
    if (b.isDefault) defaults.set(String(b.itemCode), (defaults.get(String(b.itemCode)) ?? 0) + 1)
    if (b.isDefault !== (b.status === "ACTIVE")) inactiveDefault += 1
    const seen = new Set<string>()
    b.lines.forEach((l) => {
      lines += 1
      if (!l.componentCode || !itemCodes.has(l.componentCode)) bad.orphanComponent += 1
      if (l.componentTenantId !== null && l.componentTenantId !== master.tenantId) bad.tenantMismatch += 1
      if (!(l.qtyPer > 0) || !Number.isFinite(l.qtyPer)) bad.qtyInvalid += 1
      if (l.componentCode && seen.has(l.componentCode)) bad.duplicateComponent += 1
      if (l.componentCode) seen.add(l.componentCode)
      if (l.componentCode && l.componentCode === b.itemCode) bad.selfReference += 1
      if (b.itemCode && l.componentCode) edges.set(b.itemCode, (edges.get(b.itemCode) ?? []).concat(l.componentCode))
    })
  })
  // 순환/깊이
  const color = new Map<string, number>()
  const depthMemo = new Map<string, number>()
  let cycles = 0
  const dfs = (n: string): number => {
    if (depthMemo.has(n)) return depthMemo.get(n) as number
    color.set(n, 1)
    let best = 0
    ;(edges.get(n) ?? []).forEach((c) => {
      if (color.get(c) === 1) cycles += 1
      else best = Math.max(best, dfs(c))
    })
    color.set(n, 2)
    const d = (edges.has(n) ? 1 : 0) + best
    depthMemo.set(n, d)
    return d
  }
  let maxDepth = 0
  Array.from(edges.keys()).forEach((n) => (maxDepth = Math.max(maxDepth, dfs(n))))
  return {
    boms: master.boms.length,
    bomItems: lines,
    ...bad,
    cycles,
    duplicateDefaultBom: Array.from(defaults.values()).filter((n) => n > 1).length,
    defaultStatusInconsistent: inactiveDefault,
    maxDepth,
    allActiveDefaultV1: master.boms.every((b) => b.status === "ACTIVE" && b.isDefault && b.version === "1"),
  }
}

export function rawUsage(master: ProdMaster) {
  const usage = new Map<string, Set<string>>()
  master.boms.forEach((b) =>
    b.lines.forEach((l) => {
      if (!l.componentCode) return
      const s = usage.get(l.componentCode) ?? new Set<string>()
      s.add(String(b.itemCode))
      usage.set(l.componentCode, s)
    })
  )
  const supplierCount = new Map<string, number>()
  master.itemSuppliers.forEach((s) => supplierCount.set(String(s.itemCode), (supplierCount.get(String(s.itemCode)) ?? 0) + 1))
  const raws = master.items.filter((i) => i.itemType === "RAW_MATERIAL")
  const dist = { "1": 0, "2-4": 0, "5-9": 0, "10-19": 0, "20+": 0, unused: 0 }
  const unusedCodes: string[] = []
  raws.forEach((r) => {
    const n = usage.get(r.code)?.size ?? 0
    if (n === 0) {
      dist.unused += 1
      unusedCodes.push(r.code)
    } else if (n === 1) dist["1"] += 1
    else if (n <= 4) dist["2-4"] += 1
    else if (n <= 9) dist["5-9"] += 1
    else if (n <= 19) dist["10-19"] += 1
    else dist["20+"] += 1
  })
  const usedCounts = raws.map((r) => usage.get(r.code)?.size ?? 0)
  return {
    raw: raws.length,
    distribution: dist,
    unusedImportedRaw: unusedCodes.length,
    unusedCodes,
    maxUsage: usedCounts.length ? Math.max(...usedCounts) : 0,
    withSupplierRelation: raws.filter((r) => (supplierCount.get(r.code) ?? 0) > 0).length,
    withoutSupplierRelation: raws.filter((r) => (supplierCount.get(r.code) ?? 0) === 0).length,
  }
}

export function auditPartners(master: ProdMaster) {
  const codes = new Map<string, number>()
  master.partners.forEach((p) => codes.set(p.code, (codes.get(p.code) ?? 0) + 1))
  const enrichFields: Array<keyof ProdPartner> = ["businessNumber", "ceoName", "phone", "email", "address", "contactName", "contactPhone"]
  const missing: Record<string, number> = {}
  enrichFields.forEach((f) => (missing[f] = master.partners.filter((p) => p[f] === null || p[f] === "").length))
  return {
    total: master.partners.length,
    customer: master.partners.filter((p) => p.partnerType === "CUSTOMER").length,
    supplier: master.partners.filter((p) => p.partnerType === "SUPPLIER").length,
    both: master.partners.filter((p) => p.partnerType === "BOTH").length,
    duplicateCode: Array.from(codes.values()).filter((n) => n > 1).length,
    nameBlank: master.partners.filter((p) => !p.name || p.name.trim() === "").length,
    invalidType: master.partners.filter((p) => !["CUSTOMER", "SUPPLIER", "BOTH"].includes(p.partnerType)).length,
    tenantMismatch: master.partners.filter((p) => p.tenantId !== master.tenantId).length,
    notActive: master.partners.filter((p) => p.status !== "ACTIVE").length,
    enrichmentMissing: missing,
    masterEnrichmentRequired: master.partners.length,
  }
}

export function auditItemSuppliers(master: ProdMaster) {
  const itemCodes = new Set(master.items.map((i) => i.code))
  const partnerCodes = new Set(master.partners.map((p) => p.code))
  const pairs = new Map<string, number>()
  master.itemSuppliers.forEach((s) => pairs.set(`${s.itemCode}|${s.supplierCode}`, (pairs.get(`${s.itemCode}|${s.supplierCode}`) ?? 0) + 1))
  return {
    total: master.itemSuppliers.length,
    duplicateRelation: Array.from(pairs.values()).filter((n) => n > 1).length,
    missingItem: master.itemSuppliers.filter((s) => !s.itemCode || !itemCodes.has(s.itemCode)).length,
    missingSupplier: master.itemSuppliers.filter((s) => !s.supplierCode || !partnerCodes.has(s.supplierCode)).length,
    supplierTypeInvalid: master.itemSuppliers.filter((s) => s.supplierPartnerType !== "SUPPLIER" && s.supplierPartnerType !== "BOTH").length,
    tenantMismatch: master.itemSuppliers.filter((s) => s.tenantId !== master.tenantId || s.itemTenantId !== master.tenantId || s.supplierTenantId !== master.tenantId).length,
    isDefaultTrue: master.itemSuppliers.filter((s) => s.isDefault).length,
    leadTimeSet: master.itemSuppliers.filter((s) => s.leadTimeDays !== null).length,
    moqSet: master.itemSuppliers.filter((s) => s.moq !== null).length,
    orderMultipleSet: master.itemSuppliers.filter((s) => s.orderMultiple !== null).length,
    inactive: master.itemSuppliers.filter((s) => !s.isActive).length,
  }
}

// ─── Coverage / Dependency (분석 결과 사용) ─────────────────────────────────────
export function coverageAndDependencies(master: ProdMaster, analysis: MasterAnalysis) {
  const finished = master.items.filter((i) => i.itemType === "FINISHED").map((i) => i.code)
  const withBom = new Set(master.boms.map((b) => String(b.itemCode)))
  const without = finished.filter((c) => !withBom.has(c))
  const invalidParents = new Set(analysis.boms.filter((b) => b.grade === "REJECT").map((b) => b.parentCode))
  const itemCodes = new Set(master.items.map((i) => i.code))
  // 승인되지 않은 RAW = 분석상 REVIEW 인데 운영에 없는 구성품
  const blocked = analysis.boms
    .filter((b) => b.grade !== "REJECT" && !withBom.has(b.parentCode))
    .map((b) => ({ parentCode: b.parentCode, blockedBy: Array.from(new Set(b.lines.map((l) => l.componentCode).filter((c) => !itemCodes.has(c)))) }))
  const explained = new Set<string>([...Array.from(invalidParents), ...blocked.map((b) => b.parentCode)])
  const unexplained = without.filter((c) => !explained.has(c))
  const impact = new Map<string, { raw: string; blockedBoms: string[] }>()
  blocked.forEach((b) =>
    b.blockedBy.forEach((raw) => {
      const e = impact.get(raw) ?? { raw, blockedBoms: [] }
      e.blockedBoms.push(b.parentCode)
      impact.set(raw, e)
    })
  )
  const onlyThis = (raw: string) => blocked.filter((b) => b.blockedBy.length === 1 && b.blockedBy[0] === raw).length
  const dependency = Array.from(impact.values())
    .map((e) => ({
      rawCode: e.raw,
      blockedBoms: e.blockedBoms.length,
      affectedFinished: new Set(e.blockedBoms).size,
      unlockedIfOnlyThisApproved: onlyThis(e.raw),
    }))
    .sort((a, b) => b.blockedBoms - a.blockedBoms || cmp(a.rawCode, b.rawCode))
  return {
    finished: finished.length,
    withBom: finished.length - without.length,
    withoutBom: without.length,
    coveragePct: finished.length ? Math.round(((finished.length - without.length) / finished.length) * 1000) / 10 : 0,
    withoutBomExplained: { invalidQtyBom: without.filter((c) => invalidParents.has(c)).length, blockedByReviewRaw: without.filter((c) => blocked.some((b) => b.parentCode === c)).length, unexplained },
    blocked,
    invalidParents: Array.from(invalidParents),
    dependency,
    orderOnlyInProduction: analysis.items.filter((i) => i.flags.orderOnly && itemCodes.has(i.code)).length,
  }
}

// ─── Review pack (CSV) ─────────────────────────────────────────────────────────
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function toCsv(header: string[], rows: Array<Array<unknown>>): string {
  // UTF-8 BOM: Excel 에서 한글이 깨지지 않도록
  return String.fromCharCode(0xfeff) + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"
}

export type RawBomLineInfo = { parentCode: string; componentCode: string; qty: unknown; name: string | null; spec: string | null; uom: string | null; row: number }

export function buildReviewPack(args: {
  master: ProdMaster
  analysis: MasterAnalysis
  coverage: ReturnType<typeof coverageAndDependencies>
  rawBomLines: RawBomLineInfo[]
}): Record<string, string> {
  const { master, analysis, coverage } = args
  const files: Record<string, string> = {}
  const finished = master.items.filter((i) => i.itemType === "FINISHED").sort((a, b) => cmp(a.code, b.code))
  const bomSet = new Set(master.boms.map((b) => String(b.itemCode)))
  files["finished-enrichment-template.csv"] = toCsv(
    ["itemCode", "currentName", "newName", "currentSpec", "newSpec", "currentUom", "newUom", "confirmed", "note", "hasBom"],
    finished.map((i) => [i.code, i.name, "", i.spec ?? "", "", i.uom, "", "", "", bomSet.has(i.code) ? "Y" : "N"])
  )
  // RAW review: 불일치 5 + 미참조 4 (운영에 없는 설정 시트 자재)
  const itemCodes = new Set(master.items.map((i) => i.code))
  const notImported = analysis.items.filter((i) => i.code !== "" && i.flags.inSettings && !itemCodes.has(i.code))
  const bomLineBy = new Map<string, RawBomLineInfo[]>()
  args.rawBomLines.forEach((l) => bomLineBy.set(l.componentCode, (bomLineBy.get(l.componentCode) ?? []).concat(l)))
  const dep = new Map(coverage.dependency.map((d) => [d.rawCode, d]))
  files["raw-review-template.csv"] = toCsv(
    ["sourceCode", "issueType", "sourceName", "sourceSpec", "sourceUom", "bomLineName(들)", "bomLineSpec(들)", "blockedBoms", "proposedAction", "confirmedName", "confirmedSpec", "confirmedUom", "include", "note"],
    notImported.map((i) => {
      const lines = bomLineBy.get(i.code) ?? []
      const uniq = (xs: Array<string | null>) => Array.from(new Set(xs.filter((x): x is string => !!x))).join(" | ")
      const issue = i.issues.map((x) => x.code).join("+")
      return [
        i.code,
        issue,
        i.proposed.name ?? "",
        i.proposed.spec ?? "",
        i.uomRaw ?? "",
        uniq(lines.map((l) => l.name)),
        uniq(lines.map((l) => l.spec)),
        dep.get(i.code)?.blockedBoms ?? 0,
        lines.length > 0 ? "품명/규격 확인 후 확정" : "용도 확인(미참조) 후 포함 여부 결정",
        "",
        "",
        "",
        "",
        "",
      ]
    })
  )
  // BOM review: 수량 오류 줄 + 막힌 BOM 줄
  const bomRows: Array<Array<unknown>> = []
  const analysisBom = new Map(analysis.boms.map((b) => [b.parentCode, b]))
  coverage.invalidParents.forEach((p) => {
    const b = analysisBom.get(p)
    ;(b?.lines ?? []).filter((l) => l.grade === "REJECT").forEach((l) => bomRows.push([p, "INVALID_QTY", l.componentCode, String(l.qtyRaw ?? ""), "", "", "", "", `원본 DB 시트 ${l.src.row}행`]))
  })
  coverage.blocked.forEach((bb) => {
    const b = analysisBom.get(bb.parentCode)
    ;(b?.lines ?? [])
      .filter((l) => bb.blockedBy.includes(l.componentCode))
      .forEach((l) => bomRows.push([bb.parentCode, "BLOCKED_BY_RAW_REVIEW", l.componentCode, l.qtyPer ?? "", "", "", "", "", `RAW 확정 시 자동 해소 대상(차단 구성품 ${bb.blockedBy.length}종)`]))
  })
  files["bom-review-template.csv"] = toCsv(
    ["parentCode", "issueType", "blockedComponentCode", "currentSourceQty", "confirmedQty", "confirmedComponentCode", "approved", "reviewer", "note"],
    bomRows
  )
  files["partner-enrichment-template.csv"] = toCsv(
    ["partnerCode", "partnerName", "type", "currentlyActive", "businessNumber", "phone", "address", "contactName", "confirmed", "note"],
    master.partners
      .slice()
      .sort((a, b) => cmp(a.code, b.code))
      .map((p) => [p.code, p.name, p.partnerType, "", "", "", "", "", "", ""])
  )
  files["item-supplier-enrichment-template.csv"] = toCsv(
    ["itemCode", "supplierCode", "isDefault", "leadTimeDays", "moq", "orderMultiple", "confirmed"],
    master.itemSuppliers
      .slice()
      .sort((a, b) => cmp(String(a.itemCode) + "|" + String(a.supplierCode), String(b.itemCode) + "|" + String(b.supplierCode)))
      .map((s) => [s.itemCode, s.supplierCode, s.isDefault, "", "", "", ""])
  )
  return files
}

// ─── Phase 8: Excel 승인 BOM ↔ 운영 Master ────────────────────────────────────
/**
 * Excel(분석 결과)의 BOM 과 운영 BOM 을 줄 단위로 대조한다.
 *  - 수량 오류 REJECT BOM → KNOWN_EXCLUSION(INVALID_QTY_SOURCE)
 *  - 운영에 없고 구성품이 운영 Item 에 없는 BOM → KNOWN_EXCLUSION(BLOCKED_BY_REVIEW_RAW)
 *  - 그 외 운영에 없는 BOM → MISSING / Excel 에 없는 운영 BOM → EXTRA
 */
export function compareExcelBomToMaster(analysis: MasterAnalysis, master: ProdMaster) {
  const prodBy = new Map(master.boms.map((b) => [String(b.itemCode), b]))
  const itemCodes = new Set(master.items.map((i) => i.code))
  const out = {
    parents: { excel: analysis.boms.length, MATCH: 0, QTY_MISMATCH: 0, COMPONENT_MISMATCH: 0, MISSING: 0, EXTRA: 0, KNOWN_EXCLUSION_INVALID_QTY_SOURCE: 0, KNOWN_EXCLUSION_BLOCKED_BY_REVIEW_RAW: 0 },
    lines: { compared: 0, MATCH: 0, QTY_MISMATCH: 0, COMPONENT_MISMATCH: 0, MISSING: 0, EXTRA: 0, excludedByKnownExclusion: 0 },
    problems: [] as string[],
  }
  const seen = new Set<string>()
  analysis.boms.forEach((b) => {
    seen.add(b.parentCode)
    const prod = prodBy.get(b.parentCode)
    if (b.grade === "REJECT") {
      out.parents.KNOWN_EXCLUSION_INVALID_QTY_SOURCE += 1
      out.lines.excludedByKnownExclusion += b.lines.length
      if (prod) out.problems.push("KNOWN_EXCLUSION 이 운영에 존재: " + b.parentCode)
      return
    }
    if (!prod) {
      const blocked = b.lines.some((l) => !itemCodes.has(l.componentCode))
      if (blocked) {
        out.parents.KNOWN_EXCLUSION_BLOCKED_BY_REVIEW_RAW += 1
        out.lines.excludedByKnownExclusion += b.lines.length
      } else {
        out.parents.MISSING += 1
        out.problems.push("MISSING: " + b.parentCode)
      }
      return
    }
    const lineBy = new Map(prod.lines.map((l) => [l.seq, l]))
    let parentOk = true
    b.lines.forEach((l) => {
      out.lines.compared += 1
      const pl = lineBy.get(l.seq)
      if (!pl) {
        out.lines.MISSING += 1
        parentOk = false
      } else if (pl.componentCode !== l.componentCode) {
        out.lines.COMPONENT_MISMATCH += 1
        parentOk = false
        out.problems.push(`COMPONENT_MISMATCH ${b.parentCode}#${l.seq}`)
      } else if (l.qtyPer === null || num(pl.qtyPer) !== num(l.qtyPer)) {
        out.lines.QTY_MISMATCH += 1
        parentOk = false
        out.problems.push(`QTY_MISMATCH ${b.parentCode}#${l.seq}`)
      } else out.lines.MATCH += 1
    })
    prod.lines.forEach((pl) => {
      if (!b.lines.some((l) => l.seq === pl.seq)) {
        out.lines.EXTRA += 1
        parentOk = false
      }
    })
    if (parentOk) out.parents.MATCH += 1
    else if (out.problems.some((p) => p.startsWith("QTY_MISMATCH " + b.parentCode))) out.parents.QTY_MISMATCH += 1
    else out.parents.COMPONENT_MISMATCH += 1
  })
  master.boms.forEach((b) => {
    if (!seen.has(String(b.itemCode))) {
      out.parents.EXTRA += 1
      out.problems.push("EXTRA: " + b.itemCode)
    }
  })
  return out
}
