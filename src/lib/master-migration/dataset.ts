/**
 * Approved Master Dataset 빌더 (순수 + node crypto)
 *
 *   MasterAnalysis + (사람의 승인 결정) → ApprovedMasterDataset
 *
 *  - SAFE 는 포함 후보, REVIEW 는 명시적 ACCEPT 결정이 있을 때만, REJECT 는 절대 포함하지 않는다.
 *  - 결정에서 덮어쓴 값(품명/규격/단위/유형, 거래처 코드)은 다시 검증한다.
 *  - 의존성: BOM 은 상위/구성품 Item 이 모두 포함될 때만, ItemSupplier 는 Item + 거래처가 포함될 때만 포함한다.
 *  - 데이터셋에는 운영 정보(재고/수주/발주/입출고/생산/WIP)를 담을 필드가 아예 없다.
 */

import { createHash } from "node:crypto"
import { exactUom } from "./text"
import type {
  ApprovedMasterDataset,
  DatasetBom,
  DatasetItem,
  DatasetItemSupplier,
  DatasetPartner,
  ItemTypeName,
  MasterAnalysis,
  MasterDecisions,
  PartnerTypeName,
  UomName,
} from "./types"

const ITEM_TYPES: readonly ItemTypeName[] = ["FINISHED", "SEMI_FINISHED", "RAW_MATERIAL", "CONSUMABLE"]

export const DEFAULT_BOM_VERSION = "1"

function canonical(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v
    if (Array.isArray(v)) return v.map(norm)
    const o: Record<string, unknown> = {}
    Object.keys(v as Record<string, unknown>)
      .sort()
      .forEach((k) => {
        const x = (v as Record<string, unknown>)[k]
        if (x !== undefined) o[k] = norm(x)
      })
    return o
  }
  return JSON.stringify(norm(value))
}

export function datasetHashOf(d: Omit<ApprovedMasterDataset, "datasetHash">): string {
  return createHash("sha256").update(canonical({ ...d, excluded: undefined })).digest("hex")
}

export function buildApprovedDataset(
  analysis: MasterAnalysis,
  opts: { workbookSha256: string; bomVersion?: string; decisions?: MasterDecisions }
): ApprovedMasterDataset {
  const decisions = opts.decisions ?? {}
  const bomVersion = opts.bomVersion ?? DEFAULT_BOM_VERSION
  const excluded = { review: 0, reject: 0, droppedDependents: 0 }

  const bulk = decisions.bulk ?? {}

  /** 일괄 정책으로 승인 가능한 품목: BOM 상위 제품이며, REVIEW 이유가 정책이 허용한 것뿐일 때만 */
  const bulkItemDecision = (c: MasterAnalysis["items"][number]): { accept: true; name?: string; spec?: string | null; uom?: UomName; itemType?: ItemTypeName } | undefined => {
    if (c.proposed.itemType !== "FINISHED" || !c.flags.isBomParent) return undefined
    const allowed = new Set<string>()
    if (bulk.finishedUseCodeAsName) allowed.add("NAME_MISSING")
    if (bulk.finishedDefaultUom) allowed.add("UOM_MISSING")
    if (bulk.allowMissingSpec) allowed.add("SPEC_MISSING")
    if (allowed.size === 0 || c.issues.length === 0 || !c.issues.every((i) => allowed.has(i.code))) return undefined
    return { accept: true, name: bulk.finishedUseCodeAsName ? c.code : undefined, uom: bulk.finishedDefaultUom }
  }

  /** 단위가 앞/뒤 공백만 문제인 항목(다른 이슈 없음)의 trim 정규화. 대소문자 등 다른 보정은 하지 않는다. */
  const trimUomDecision = (c: MasterAnalysis["items"][number]): { accept: true; name?: string; spec?: string | null; uom?: UomName; itemType?: ItemTypeName } | undefined => {
    if (!bulk.trimUomWhitespace || c.uomRaw === null) return undefined
    if (c.issues.length !== 1 || c.issues[0].code !== "UOM_NOT_EXACT") return undefined
    if (c.uomRaw === c.uomRaw.trim()) return undefined
    const exact = exactUom(c.uomRaw.trim())
    return exact === null ? undefined : { accept: true, uom: exact }
  }

  // ── Item ──
  const items: DatasetItem[] = []
  const itemCodes = new Set<string>()
  analysis.items.forEach((c) => {
    if (c.grade === "REJECT" || c.code === "") {
      excluded.reject += 1
      return
    }
    const explicit = decisions.items?.[c.code]
    const bulkDecision = c.grade === "REVIEW" ? bulkItemDecision(c) : undefined
    const trimDecision = c.grade === "REVIEW" && !bulkDecision ? trimUomDecision(c) : undefined
    const decision = explicit ? (explicit.accept === true ? explicit : undefined) : (bulkDecision ?? trimDecision)
    if (c.grade === "REVIEW" && !decision) {
      excluded.review += 1
      return
    }
    const name = (decision?.name ?? c.proposed.name)?.trim() || null
    const spec = decision && "spec" in decision ? (decision.spec ?? null) : c.proposed.spec
    const uomCandidate = decision?.uom ?? c.proposed.uom
    const uom: UomName | null = uomCandidate === null || uomCandidate === undefined ? null : exactUom(uomCandidate)
    const itemType = decision?.itemType ?? c.proposed.itemType
    if (name === null || uom === null || itemType === null || !ITEM_TYPES.includes(itemType)) {
      // 승인했더라도 필수 속성이 비어 있으면 포함하지 않는다
      excluded.review += 1
      return
    }
    if (itemCodes.has(c.code)) {
      excluded.review += 1
      return
    }
    itemCodes.add(c.code)
    const record: DatasetItem = { code: c.code, name, spec: spec === null || spec === undefined ? null : spec, uom, itemType, provenance: c.sources.slice(0, 5) }
    if (!explicit && bulkDecision) {
      // 임시값(placeholder): Excel 에 실제 값이 없었던 필드만 표시
      const fields: string[] = []
      if (c.issues.some((i) => i.code === "NAME_MISSING")) fields.push("name")
      if (c.issues.some((i) => i.code === "SPEC_MISSING")) fields.push("spec")
      if (c.issues.some((i) => i.code === "UOM_MISSING")) fields.push("uom")
      if (fields.length > 0) {
        record.needsMasterEnrichment = true
        record.placeholderFields = fields
      }
    }
    if (!explicit && trimDecision) record.normalizations = ["UOM_TRIMMED"]
    items.push(record)
  })

  // ── Partner (코드는 사람이 정한다) ──
  const partners: DatasetPartner[] = []
  const partnerCodeByName = new Map<string, DatasetPartner[]>()
  const usedPartnerCodes = new Set<string>()
  // 승인된 코드 규칙(이름순 일련번호): 규칙이 있을 때만, BOTH 는 제외(명시 결정 필요)
  // 거래처 코드: 이미 부여된 코드(partnerCodeMap)는 그대로, 새 거래처만 정규화한 이름순으로 다음 번호를 받는다(재정렬 없음).
  const ruledCode = new Map<string, string>()
  if (bulk.partnerCodeRule) {
    const rule = bulk.partnerCodeRule
    const pad = (n: number) => String(n).padStart(Math.max(1, rule.width), "0")
    const sortKey = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ")
    const given = decisions.partnerCodeMap ?? {}
    const nextOf = (prefix: string) => {
      let max = 0
      Object.keys(given).forEach((k) => {
        const code = given[k]
        if (code.startsWith(prefix)) {
          const n = Number(code.slice(prefix.length))
          if (Number.isInteger(n) && n > max) max = n
        }
      })
      return max + 1
    }
    let nextC = nextOf(rule.customerPrefix)
    let nextS = nextOf(rule.supplierPrefix)
    const fresh = analysis.partners
      .filter((p) => (p.partnerType === "CUSTOMER" || p.partnerType === "SUPPLIER") && given[`${p.partnerType}|${p.name}`] === undefined)
      .sort((a, b) => {
        const ka = sortKey(a.name)
        const kb = sortKey(b.name)
        return ka < kb ? -1 : ka > kb ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0
      })
    analysis.partners.forEach((p) => {
      const k = `${p.partnerType}|${p.name}`
      if (given[k] !== undefined) ruledCode.set(k, given[k])
    })
    fresh.forEach((p) => {
      const k = `${p.partnerType}|${p.name}`
      ruledCode.set(k, p.partnerType === "CUSTOMER" ? rule.customerPrefix + pad(nextC++) : rule.supplierPrefix + pad(nextS++))
    })
  }
  analysis.partners.forEach((p) => {
    const key = `${p.partnerType}|${p.name}`
    const explicit = decisions.partners?.[key]
    const d = explicit ? (explicit.accept === true ? explicit : undefined) : ruledCode.has(key) ? { accept: true, code: ruledCode.get(key) as string } : undefined
    if (!d) {
      excluded.review += 1
      return
    }
    const code = d.code.trim()
    if (code === "" || usedPartnerCodes.has(code)) {
      excluded.review += 1
      return
    }
    usedPartnerCodes.add(code)
    const entry: DatasetPartner = { code, name: p.name, partnerType: (d.partnerType ?? p.partnerType) as PartnerTypeName }
    partners.push(entry)
    const arr = partnerCodeByName.get(p.name) ?? []
    arr.push(entry)
    partnerCodeByName.set(p.name, arr)
  })

  // ── BOM ──
  const boms: DatasetBom[] = []
  analysis.boms.forEach((b) => {
    if (b.grade === "REJECT") {
      excluded.reject += 1
      return
    }
    const explicitBom = decisions.boms?.[b.parentCode]
    const decision = explicitBom ? (explicitBom.accept === true ? explicitBom : undefined) : bulk.acceptBomsWithoutRejectedLines ? { accept: true } : undefined
    if (b.grade === "REVIEW" && !decision) {
      excluded.review += 1
      return
    }
    if (!itemCodes.has(b.parentCode) || b.lines.some((l) => !itemCodes.has(l.componentCode) || l.qtyPer === null)) {
      excluded.droppedDependents += 1
      return
    }
    boms.push({
      parentCode: b.parentCode,
      version: bomVersion,
      lines: b.lines.map((l) => ({ seq: l.seq, componentCode: l.componentCode, qtyPer: l.qtyPer as number })),
      provenance: b.src,
    })
  })

  // ── ItemSupplier ──
  const itemSuppliers: DatasetItemSupplier[] = []
  const seen = new Set<string>()
  analysis.itemSuppliers.forEach((s) => {
    if (s.grade === "REJECT") {
      excluded.reject += 1
      return
    }
    const explicitIs = decisions.itemSuppliers?.[`${s.itemCode}|${s.supplierName}`]
    const decision = explicitIs ? (explicitIs.accept === true ? explicitIs : undefined) : bulk.acceptItemSuppliersOfAcceptedPartners ? { accept: true } : undefined
    if (!decision) {
      excluded.review += 1
      return
    }
    const supplier = (partnerCodeByName.get(s.supplierName) ?? []).find((p) => p.partnerType === "SUPPLIER" || p.partnerType === "BOTH")
    if (!itemCodes.has(s.itemCode) || !supplier) {
      excluded.droppedDependents += 1
      return
    }
    const k = `${s.itemCode}|${supplier.code}`
    if (seen.has(k)) return
    seen.add(k)
    itemSuppliers.push({ itemCode: s.itemCode, supplierCode: supplier.code, isDefault: false })
  })

  const base: Omit<ApprovedMasterDataset, "datasetHash"> = {
    schemaVersion: 1,
    kind: "DAEWON_MASTER_DATASET",
    source: { workbookSha256: opts.workbookSha256, layout: "DAEWON_MRP_V09" },
    bomVersion,
    items,
    boms,
    partners,
    itemSuppliers,
    excluded,
  }
  return { ...base, datasetHash: datasetHashOf(base) }
}

/** 데이터셋 구조 검증(파일에서 읽은 JSON 을 쓰기 전에): 운영 정보 필드/알 수 없는 키가 있으면 거부 */
const ALLOWED_TOP_KEYS = ["schemaVersion", "kind", "source", "bomVersion", "items", "boms", "partners", "itemSuppliers", "excluded", "datasetHash"]

export function validateDatasetShape(raw: unknown): { ok: true; dataset: ApprovedMasterDataset } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "객체가 아닙니다" }
  const d = raw as Record<string, unknown>
  if (d.kind !== "DAEWON_MASTER_DATASET" || d.schemaVersion !== 1) return { ok: false, reason: "지원하지 않는 데이터셋 종류/버전" }
  const extra = Object.keys(d).filter((k) => !ALLOWED_TOP_KEYS.includes(k))
  if (extra.length > 0) return { ok: false, reason: `허용되지 않은 키: ${extra.join(", ")}` }
  for (const k of ["items", "boms", "partners", "itemSuppliers"]) {
    if (!Array.isArray(d[k])) return { ok: false, reason: `${k} 가 배열이 아닙니다` }
  }
  const { datasetHash, ...rest } = d as unknown as ApprovedMasterDataset
  if (datasetHashOf(rest) !== datasetHash) return { ok: false, reason: "datasetHash 불일치(변조 또는 손상)" }
  return { ok: true, dataset: d as unknown as ApprovedMasterDataset }
}
