/**
 * Approved Master Dataset 적용 (DB 클라이언트 주입형) — 개발 seed 와 (Phase 7B) 운영 import 가 공유한다.
 *
 * 안전 장치
 *  - 쓰기 대상은 item / bOM / bOMItem / businessPartner / itemSupplier 5개 모델뿐이다(타입 + 테스트로 고정).
 *    재고/수주/발주/입출고/생산/WIP 모델에는 접근하지 않는다.
 *  - identity(코드) 기준으로 MATCH 는 건너뛰고 CREATE 만 만든다 → 같은 데이터셋을 다시 적용해도 중복 생성 없음.
 *  - CONFLICT(같은 코드인데 내용이 다름)는 절대 overwrite 하지 않는다. 기본 정책은 ABORT(아무것도 쓰지 않고 보고).
 *  - 하나의 트랜잭션. 실패하면 전체 롤백.
 *  - dryRun 이면 쓰기 0건(조회만).
 */

import type { PrismaClient } from "@prisma/client"
import { reconcileDataset, summarize, type ReconcileEntry, type ReconcileSummary } from "./reconcile"
import type { ApprovedMasterDataset, ExistingMasterSnapshot } from "./types"

export type MasterApplyDb = Pick<PrismaClient, "item" | "bOM" | "bOMItem" | "businessPartner" | "itemSupplier" | "$transaction">
type ReadDb = Pick<PrismaClient, "item" | "bOM" | "bOMItem" | "businessPartner" | "itemSupplier">

/** 현재 tenant 의 Master 현황(읽기 전용) */
export async function loadExistingSnapshot(db: ReadDb, tenantId: string): Promise<ExistingMasterSnapshot> {
  const items = await db.item.findMany({ where: { tenantId }, select: { id: true, code: true, name: true, spec: true, uom: true, itemType: true, status: true } })
  const idToCode = new Map<string, string>()
  items.forEach((i) => idToCode.set(i.id, i.code))
  const boms = await db.bOM.findMany({ where: { tenantId }, select: { id: true, itemId: true, version: true, status: true, isDefault: true } })
  const bomIds = boms.map((b) => b.id)
  const bomItems = bomIds.length > 0 ? await db.bOMItem.findMany({ where: { bomId: { in: bomIds } }, select: { bomId: true, componentItemId: true, qtyPer: true } }) : []
  const linesByBom = new Map<string, Array<{ componentCode: string; qtyPer: number }>>()
  bomItems.forEach((l) => {
    const arr = linesByBom.get(l.bomId) ?? []
    arr.push({ componentCode: idToCode.get(l.componentItemId) ?? `?${l.componentItemId}`, qtyPer: Number(l.qtyPer) })
    linesByBom.set(l.bomId, arr)
  })
  const partners = await db.businessPartner.findMany({ where: { tenantId }, select: { id: true, code: true, name: true, partnerType: true } })
  const partnerIdToCode = new Map<string, string>()
  partners.forEach((p) => partnerIdToCode.set(p.id, p.code))
  const itemSuppliers = await db.itemSupplier.findMany({ where: { tenantId }, select: { itemId: true, supplierId: true } })
  return {
    items: items.map((i) => ({ code: i.code, name: i.name, spec: i.spec ?? null, uom: String(i.uom), itemType: String(i.itemType), status: String(i.status) })),
    boms: boms.map((b) => ({
      itemCode: idToCode.get(b.itemId) ?? `?${b.itemId}`,
      version: b.version,
      status: String(b.status),
      isDefault: b.isDefault,
      lines: linesByBom.get(b.id) ?? [],
    })),
    partners: partners.map((p) => ({ code: p.code, name: p.name, partnerType: String(p.partnerType) })),
    itemSuppliers: itemSuppliers.map((s) => ({
      itemCode: idToCode.get(s.itemId) ?? `?${s.itemId}`,
      supplierCode: partnerIdToCode.get(s.supplierId) ?? `?${s.supplierId}`,
    })),
  }
}

export type ApplyOptions = {
  tenantId: string
  dataset: ApprovedMasterDataset
  /** true 면 쓰기 0건(조회 + 분류만) */
  dryRun: boolean
  /** ABORT(기본): CONFLICT 가 하나라도 있으면 아무것도 쓰지 않는다 / SKIP: CONFLICT 만 건너뛰고 CREATE 를 진행 */
  onConflict?: "ABORT" | "SKIP"
}

export type ApplyResult = {
  dryRun: boolean
  aborted: boolean
  entries: ReconcileEntry[]
  summary: ReconcileSummary
  conflicts: ReconcileEntry[]
  created: { items: number; boms: number; bomLines: number; partners: number; itemSuppliers: number }
}

export async function applyMasterDataset(db: MasterApplyDb, opts: ApplyOptions): Promise<ApplyResult> {
  const { tenantId, dataset } = opts
  if (typeof tenantId !== "string" || tenantId.length === 0) throw new Error("tenantId 가 필요합니다")
  const onConflict = opts.onConflict ?? "ABORT"

  const run = async (tx: ReadDb): Promise<ApplyResult> => {
    const existing = await loadExistingSnapshot(tx, tenantId)
    const entries = reconcileDataset(dataset, existing)
    const summary = summarize(entries)
    const conflicts = entries.filter((e) => e.class === "CONFLICT")
    const created = { items: 0, boms: 0, bomLines: 0, partners: 0, itemSuppliers: 0 }
    const base = { dryRun: opts.dryRun, entries, summary, conflicts, created }
    if (opts.dryRun) return { ...base, aborted: false }
    if (conflicts.length > 0 && onConflict === "ABORT") return { ...base, aborted: true }

    const cls = (kind: ReconcileEntry["kind"], key: string) => entries.find((e) => e.kind === kind && e.key === key)?.class
    const writeDb = tx as unknown as MasterApplyDb

    // 1) Item
    const newItems = dataset.items.filter((i) => cls("ITEM", i.code) === "CREATE")
    if (newItems.length > 0) {
      await writeDb.item.createMany({
        data: newItems.map((i) => ({ tenantId, code: i.code, name: i.name, spec: i.spec, uom: i.uom, itemType: i.itemType, status: "ACTIVE" as const })),
      })
      created.items = newItems.length
    }
    // 2) Partner
    const newPartners = dataset.partners.filter((p) => cls("PARTNER", p.code) === "CREATE")
    if (newPartners.length > 0) {
      await writeDb.businessPartner.createMany({
        data: newPartners.map((p) => ({ tenantId, code: p.code, name: p.name, partnerType: p.partnerType, status: "ACTIVE" as const })),
      })
      created.partners = newPartners.length
    }
    // id 조회(생성분 + 기존 참조분)
    const itemCodes = Array.from(new Set<string>([...dataset.items.map((i) => i.code), ...dataset.boms.flatMap((b) => [b.parentCode, ...b.lines.map((l) => l.componentCode)]), ...dataset.itemSuppliers.map((s) => s.itemCode)]))
    const itemRows = itemCodes.length > 0 ? await writeDb.item.findMany({ where: { tenantId, code: { in: itemCodes } }, select: { id: true, code: true } }) : []
    const itemId = new Map<string, string>()
    itemRows.forEach((r) => itemId.set(r.code, r.id))
    const partnerCodes = Array.from(new Set<string>([...dataset.partners.map((p) => p.code), ...dataset.itemSuppliers.map((s) => s.supplierCode)]))
    const partnerRows = partnerCodes.length > 0 ? await writeDb.businessPartner.findMany({ where: { tenantId, code: { in: partnerCodes } }, select: { id: true, code: true } }) : []
    const partnerId = new Map<string, string>()
    partnerRows.forEach((r) => partnerId.set(r.code, r.id))

    // 3) BOM (+ 줄)
    for (const b of dataset.boms) {
      if (cls("BOM", b.parentCode) !== "CREATE") continue
      const parent = itemId.get(b.parentCode)
      if (!parent) throw new Error(`BOM 상위 품목을 찾을 수 없습니다: ${b.parentCode}`)
      const bom = await writeDb.bOM.create({ data: { tenantId, itemId: parent, version: b.version, status: "ACTIVE", isDefault: true } })
      await writeDb.bOMItem.createMany({
        data: b.lines.map((l) => {
          const comp = itemId.get(l.componentCode)
          if (!comp) throw new Error(`BOM 구성품을 찾을 수 없습니다: ${l.componentCode}`)
          return { bomId: bom.id, componentItemId: comp, seq: l.seq, qtyPer: l.qtyPer, scrapRate: 0 }
        }),
      })
      created.boms += 1
      created.bomLines += b.lines.length
    }
    // 4) ItemSupplier (isDefault=false, LT/MOQ/배수 미설정)
    const newPairs = dataset.itemSuppliers.filter((s) => cls("ITEM_SUPPLIER", `${s.itemCode}|${s.supplierCode}`) === "CREATE")
    if (newPairs.length > 0) {
      await writeDb.itemSupplier.createMany({
        data: newPairs.map((s) => {
          const item = itemId.get(s.itemCode)
          const supplier = partnerId.get(s.supplierCode)
          if (!item || !supplier) throw new Error(`ItemSupplier 참조를 찾을 수 없습니다: ${s.itemCode}/${s.supplierCode}`)
          return { tenantId, itemId: item, supplierId: supplier, isDefault: false, priority: 100, isActive: true }
        }),
      })
      created.itemSuppliers = newPairs.length
    }
    return { ...base, aborted: false }
  }

  if (opts.dryRun) return run(db)
  return db.$transaction((tx) => run(tx as unknown as ReadDb), { timeout: 60_000, maxWait: 10_000 })
}
