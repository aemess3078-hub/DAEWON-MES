/**
 * LOT 정·역추적 (N-15) — 기존 이력 데이터를 외래키로 연결해 조회한다(스키마·이력 변경 없음).
 *
 * 연결 체인(모두 DB 참조 관계. 제조번호·LOT 번호 문자열이 비슷하다는 이유로 연결하지 않는다):
 *   원자재 LOT ─(WorkOrderMaterialLot.inventoryTransaction.lotId / WipUnitMaterialLot.materialLotId)→ 작업지시
 *   작업지시 ─(FinishedGoodsReceipt.workOrderId·lotId / WipUnit.workOrderId·lotId)→ 산출(완제품·반제품) LOT
 *   산출 LOT ─(ShipmentItem.lotId)→ 출하·수주·고객
 *   반제품 단계는 LotGenealogy(INPUT·REWORK) 링크와 반제품 LOT 의 생산 작업지시를 따라 상·하위로 이어 간다.
 *
 * 연결 단위는 '작업지시'다: 한 작업지시에서 분할 입고된 완제품 LOT 들은 같은 투입 원자재 LOT 집합을 공유한다
 * (LOT 별 소비 배분은 기록되지 않음). 불량으로 폐기된 재공은 LOT 를 만들지 않으며 작업지시 요약(불량 수량)에만 나타난다.
 *
 * 모든 조회는 tenantId 로 제한하고, 레벨(깊이) 단위로 묶어서 조회해 쿼리 수가 이력 건수에 비례하지 않는다.
 * 순환 참조는 방문 집합으로 끊고 깊이 상한(MAX_DEPTH)을 둔다. DB 쓰기는 없다.
 */
import type { prisma as appPrisma } from "@/lib/db/prisma"

type Db = typeof appPrisma
export const TRACE_MAX_DEPTH = 8
const GENEALOGY_RELATIONS = ["INPUT", "REWORK"] as const

const lotSelect = { id: true, lotNo: true, status: true, item: { select: { id: true, code: true, name: true, itemType: true, uom: true } } } as const
type LotRow = { id: string; lotNo: string; status: string; item: { id: string; code: string; name: string; itemType: string | null; uom: string } }
type WoRef = { id: string; orderNo: string; manufacturingNo: string | null; status: string }

export type TraceLot = LotRow
export type InputMaterialLot = {
  lot: TraceLot
  qty: number
  unit: string | null
  workOrder: WoRef | null
  /** 0 = 이 LOT 를 만든 작업지시의 직접 투입, 1+ = 반제품·재작업 상위 단계 */
  depth: number
  /** 상위 단계에서 경유한 LOT(반제품 등). 직접 투입이면 null */
  viaLot: { id: string; lotNo: string } | null
  relation: "WORK_ORDER_MATERIAL" | "LOT_GENEALOGY_INPUT" | "LOT_GENEALOGY_REWORK"
  /** 투입 LOT 를 확정한 참조: 수불 거래의 lotId(기본) / 재공-자재 연결의 lotId / (참조가 없을 때만) 같은 테넌트·품목의 LOT 번호 */
  resolvedBy: "INVENTORY_TRANSACTION" | "WIP_MATERIAL_LOT" | "LOT_NO_FALLBACK"
}
export type ConsumedInWorkOrder = { lot: TraceLot; workOrder: WoRef; qty: number; unit: string | null; depth: number }
export type ProducedLot = { lot: TraceLot; qty: number; workOrder: WoRef | null; depth: number; relation: "WORK_ORDER_OUTPUT" | "LOT_GENEALOGY_INPUT" | "LOT_GENEALOGY_REWORK"; viaLot: { id: string; lotNo: string } | null }
export type DownstreamShipment = {
  lotId: string; lotNo: string; qty: number; shipmentNo: string; status: string; plannedDate: string; shippedDate: string | null
  salesOrder: { id: string; orderNo: string }; customer: { id: string; code: string; name: string } | null
}
export type WorkOrderTraceSummary = { id: string; orderNo: string; manufacturingNo: string | null; status: string; plannedQty: number; goodQty: number; defectQty: number; reworkQty: number; scrappedWipQty: number }

export type LotTraceability = {
  attribution: "WORK_ORDER"
  note: string
  producedByWorkOrders: Array<WoRef & { receiptQty: number }>
  inputMaterialLots: InputMaterialLot[]
  consumedInWorkOrders: ConsumedInWorkOrder[]
  producedLots: ProducedLot[]
  downstreamShipments: DownstreamShipment[]
  workOrderSummaries: WorkOrderTraceSummary[]
  diagnostics: { queryCount: number; levels: number; truncated: boolean }
}

const n = (v: unknown) => Number(v ?? 0)
const NOTE = "연결 단위는 작업지시입니다. 한 작업지시에서 나뉘어 입고된 완제품 LOT 는 같은 투입 원자재 LOT 를 공유하며 LOT 별 소비 배분은 기록되지 않습니다."

export async function buildLotTraceability(db: Db, tenantId: string, rootLotId: string): Promise<LotTraceability> {
  let queryCount = 0
  let truncated = false
  const q = <T>(p: Promise<T>): Promise<T> => { queryCount += 1; return p }
  const woCache = new Map<string, WoRef>()
  const lotCache = new Map<string, LotRow>()
  const rememberWo = (w: WoRef) => { woCache.set(w.id, w); return w }

  // ─────────── 상위(역추적): 이 LOT 를 만든 작업지시의 투입 원자재, 반제품·재작업 상위 단계 ───────────
  const inputRows = new Map<string, InputMaterialLot>()
  const producedByWorkOrders: LotTraceability["producedByWorkOrders"] = []
  const involvedWoIds = new Set<string>()
  {
    const visited = new Set<string>([rootLotId])
    let frontier: Array<{ id: string; via: { id: string; lotNo: string } | null; relation: InputMaterialLot["relation"] }> = [{ id: rootLotId, via: null, relation: "WORK_ORDER_MATERIAL" }]
    for (let depth = 0; frontier.length > 0; depth++) {
      if (depth >= TRACE_MAX_DEPTH) { truncated = true; break }
      const ids = frontier.map((f) => f.id)
      const [receipts, wips, parents] = await Promise.all([
        q(db.finishedGoodsReceipt.findMany({ where: { tenantId, lotId: { in: ids } }, select: { lotId: true, receiptQty: true, workOrder: { select: { id: true, orderNo: true, manufacturingNo: true, status: true } } } })),
        q(db.wipUnit.findMany({ where: { tenantId, lotId: { in: ids }, workOrderId: { not: null } }, select: { lotId: true, workOrder: { select: { id: true, orderNo: true, manufacturingNo: true, status: true } } } })),
        q(db.lotGenealogy.findMany({ where: { childLotId: { in: ids }, relationType: { in: [...GENEALOGY_RELATIONS] }, parentLot: { tenantId }, childLot: { tenantId } }, select: { childLotId: true, relationType: true, parentLot: { select: lotSelect } } })),
      ])
      // 만든 작업지시(LOT 별)
      const wosOfLot = new Map<string, Map<string, WoRef>>()
      const addWo = (lotId: string | null, wo: WoRef | null) => {
        if (!lotId || !wo) return
        rememberWo(wo)
        if (!wosOfLot.has(lotId)) wosOfLot.set(lotId, new Map())
        wosOfLot.get(lotId)!.set(wo.id, wo)
      }
      for (const r of receipts) addWo(r.lotId, r.workOrder)
      for (const w of wips) addWo(w.lotId, w.workOrder)
      if (depth === 0) {
        const sums = new Map<string, number>()
        for (const r of receipts) if (r.lotId === rootLotId) sums.set(r.workOrder.id, (sums.get(r.workOrder.id) ?? 0) + n(r.receiptQty))
        for (const wo of Array.from(wosOfLot.get(rootLotId)?.values() ?? [])) producedByWorkOrders.push({ ...wo, receiptQty: sums.get(wo.id) ?? 0 })
      }
      const woIds = Array.from(new Set(Array.from(wosOfLot.values()).flatMap((m) => Array.from(m.keys()))))
      woIds.forEach((id) => involvedWoIds.add(id))
      const next: typeof frontier = []

      if (woIds.length > 0) {
        const materials = await q(db.workOrderMaterialLot.findMany({
          where: { tenantId, workOrderId: { in: woIds } },
          select: {
            id: true, workOrderId: true, materialItemId: true, materialLotNo: true, qty: true, unit: true,
            inventoryTransaction: { select: { lotId: true } },
            wipUnitMaterialLots: { select: { materialLotId: true } },
          },
        }))
        type Resolved = { lotId: string | null; by: InputMaterialLot["resolvedBy"] }
        const resolve = (m: (typeof materials)[number]): Resolved => {
          if (m.inventoryTransaction?.lotId) return { lotId: m.inventoryTransaction.lotId, by: "INVENTORY_TRANSACTION" }
          const w = m.wipUnitMaterialLots.find((x) => x.materialLotId)
          if (w?.materialLotId) return { lotId: w.materialLotId, by: "WIP_MATERIAL_LOT" }
          return { lotId: null, by: "LOT_NO_FALLBACK" }
        }
        const resolved = new Map(materials.map((m) => [m.id, resolve(m)]))
        // 참조가 전혀 없는 레거시 행만 (테넌트, 품목, LOT 번호)로 보완한다. 제조번호와는 무관하다.
        const unresolved = materials.filter((m) => !resolved.get(m.id)!.lotId)
        if (unresolved.length > 0) {
          const found = await q(db.lot.findMany({ where: { tenantId, OR: unresolved.map((m) => ({ lotNo: m.materialLotNo, itemId: m.materialItemId })) }, select: { id: true, lotNo: true, itemId: true } }))
          const byKey = new Map(found.map((l) => [`${l.itemId}|${l.lotNo}`, l.id]))
          for (const m of unresolved) { const id = byKey.get(`${m.materialItemId}|${m.materialLotNo}`); if (id) resolved.set(m.id, { lotId: id, by: "LOT_NO_FALLBACK" }) }
        }
        const lotIds = Array.from(new Set(Array.from(resolved.values()).map((r) => r.lotId).filter((x): x is string => !!x && !lotCache.has(x))))
        if (lotIds.length > 0) for (const l of await q(db.lot.findMany({ where: { tenantId, id: { in: lotIds } }, select: lotSelect }))) lotCache.set(l.id, l as LotRow)
        const woOf = (id: string) => woCache.get(id)!
        for (const [producerLotId, wos] of Array.from(wosOfLot.entries())) {
          const fr = frontier.find((f) => f.id === producerLotId)!
          const producerLot = lotCache.get(producerLotId)
          const viaLot = depth === 0 || !producerLot ? null : { id: producerLotId, lotNo: producerLot.lotNo }
          for (const wo of Array.from(wos.values())) {
            for (const m of materials.filter((x) => x.workOrderId === wo.id)) {
              const rs = resolved.get(m.id)!
              if (!rs.lotId || !lotCache.has(rs.lotId)) continue
              const key = `${rs.lotId}|${wo.id}`
              const cur = inputRows.get(key)
              if (cur) { cur.qty += n(m.qty); continue }
              inputRows.set(key, {
                lot: lotCache.get(rs.lotId)!, qty: n(m.qty), unit: m.unit, workOrder: woOf(wo.id), depth, viaLot,
                relation: depth === 0 ? "WORK_ORDER_MATERIAL" : fr.relation, resolvedBy: rs.by,
              })
              // 투입 LOT 가 반제품(산출물)일 수 있으니 그 LOT 의 생산 이력도 따라간다. 원자재는 생산 이력이 없으므로 건너뛴다.
              const lot = lotCache.get(rs.lotId)!
              if (lot.item.itemType !== "RAW_MATERIAL" && !visited.has(lot.id)) { visited.add(lot.id); next.push({ id: lot.id, via: { id: producerLotId, lotNo: lotCache.get(producerLotId)?.lotNo ?? "" }, relation: "WORK_ORDER_MATERIAL" }) }
            }
          }
        }
      }
      // 반제품·재작업 족보의 상위 LOT 는 다음 단계에서 그 LOT 를 만든 작업지시의 원자재를 찾는다
      for (const p of parents) {
        lotCache.set(p.parentLot.id, p.parentLot as LotRow)
        if (visited.has(p.parentLot.id)) continue
        visited.add(p.parentLot.id)
        next.push({ id: p.parentLot.id, via: { id: p.parentLot.id, lotNo: p.parentLot.lotNo }, relation: p.relationType === "REWORK" ? "LOT_GENEALOGY_REWORK" : "LOT_GENEALOGY_INPUT" })
      }
      frontier = next
    }
  }

  // ─────────── 하위(정추적): 이 LOT 가 투입된 작업지시, 산출 LOT, 출하 ───────────
  const consumed = new Map<string, { lotId: string; workOrder: WoRef; qty: number; unit: string | null; depth: number }>()
  const produced = new Map<string, ProducedLot>()
  {
    const visited = new Set<string>([rootLotId])
    let frontier: Array<{ id: string; via: { id: string; lotNo: string } | null; relation: ProducedLot["relation"] }> = [{ id: rootLotId, via: null, relation: "WORK_ORDER_OUTPUT" }]
    for (let depth = 0; frontier.length > 0; depth++) {
      if (depth >= TRACE_MAX_DEPTH) { truncated = true; break }
      const ids = frontier.map((f) => f.id)
      const [uses, children] = await Promise.all([
        q(db.workOrderMaterialLot.findMany({
          where: { tenantId, OR: [{ inventoryTransaction: { lotId: { in: ids } } }, { wipUnitMaterialLots: { some: { materialLotId: { in: ids } } } }] },
          select: {
            id: true, qty: true, unit: true, inventoryTransaction: { select: { lotId: true } }, wipUnitMaterialLots: { select: { materialLotId: true } },
            workOrder: { select: { id: true, orderNo: true, manufacturingNo: true, status: true } },
          },
        })),
        q(db.lotGenealogy.findMany({ where: { parentLotId: { in: ids }, relationType: { in: [...GENEALOGY_RELATIONS] }, parentLot: { tenantId }, childLot: { tenantId } }, select: { parentLotId: true, relationType: true, qty: true, childLot: { select: lotSelect } } })),
      ])
      const idSet = new Set(ids)
      const woByLot = new Map<string, Map<string, WoRef>>()
      for (const u of uses) {
        const lotId = u.inventoryTransaction?.lotId && idSet.has(u.inventoryTransaction.lotId) ? u.inventoryTransaction.lotId : u.wipUnitMaterialLots.find((w) => w.materialLotId && idSet.has(w.materialLotId))?.materialLotId
        if (!lotId) continue
        rememberWo(u.workOrder)
        involvedWoIds.add(u.workOrder.id)
        const key = `${lotId}|${u.workOrder.id}`
        const cur = consumed.get(key)
        if (cur) cur.qty += n(u.qty)
        else consumed.set(key, { lotId, workOrder: u.workOrder, qty: n(u.qty), unit: u.unit, depth })
        if (!woByLot.has(lotId)) woByLot.set(lotId, new Map())
        woByLot.get(lotId)!.set(u.workOrder.id, u.workOrder)
      }
      const woIds = Array.from(new Set(Array.from(woByLot.values()).flatMap((m) => Array.from(m.keys()))))
      const next: typeof frontier = []
      const addProduced = (lot: LotRow, wo: WoRef | null, qty: number, relation: ProducedLot["relation"], via: { id: string; lotNo: string } | null) => {
        lotCache.set(lot.id, lot)
        const key = `${lot.id}|${wo?.id ?? "-"}`
        const cur = produced.get(key)
        if (cur) { cur.qty += qty; return }
        produced.set(key, { lot, qty, workOrder: wo, depth, relation, viaLot: via })
        if (!visited.has(lot.id)) { visited.add(lot.id); next.push({ id: lot.id, via, relation }) }
      }
      if (woIds.length > 0) {
        const [receipts, wips] = await Promise.all([
          q(db.finishedGoodsReceipt.findMany({ where: { tenantId, workOrderId: { in: woIds }, lotId: { not: null } }, select: { workOrderId: true, receiptQty: true, lot: { select: lotSelect } } })),
          q(db.wipUnit.findMany({ where: { tenantId, workOrderId: { in: woIds }, lotId: { not: null }, parentWipUnitId: null }, select: { workOrderId: true, qty: true, lot: { select: lotSelect } } })),
        ])
        const viaOf = (woId: string) => { for (const [lotId, wos] of Array.from(woByLot.entries())) if (wos.has(woId)) return depth === 0 ? null : { id: lotId, lotNo: lotCache.get(lotId)?.lotNo ?? "" }; return null }
        const receiptKeys = new Set<string>()
        for (const r of receipts) if (r.lot) { receiptKeys.add(`${r.lot.id}|${r.workOrderId}`); addProduced(r.lot as LotRow, woCache.get(r.workOrderId) ?? null, n(r.receiptQty), "WORK_ORDER_OUTPUT", viaOf(r.workOrderId)) }
        // 입고 기록 없이 재공(WIP)에만 LOT 가 연결된 경우(예: 반제품) 보완
        for (const w of wips) if (w.lot && w.workOrderId && !receiptKeys.has(`${w.lot.id}|${w.workOrderId}`)) addProduced(w.lot as LotRow, woCache.get(w.workOrderId) ?? null, n(w.qty), "WORK_ORDER_OUTPUT", viaOf(w.workOrderId))
      }
      for (const c of children) addProduced(c.childLot as LotRow, null, n(c.qty), c.relationType === "REWORK" ? "LOT_GENEALOGY_REWORK" : "LOT_GENEALOGY_INPUT", { id: c.parentLotId, lotNo: lotCache.get(c.parentLotId)?.lotNo ?? "" })
      // 소비 행에 LOT 정보 채우기(같은 레벨의 LOT 는 아래에서 한 번에 조회)
      frontier = next
    }
  }
  // 소비 행의 LOT 정보(루트 LOT 포함) 보완 — 한 번의 조회
  const missingLotIds = Array.from(new Set([rootLotId, ...Array.from(consumed.values()).map((c) => c.lotId)].filter((id) => !lotCache.has(id))))
  if (missingLotIds.length > 0) for (const l of await q(db.lot.findMany({ where: { tenantId, id: { in: missingLotIds } }, select: lotSelect }))) lotCache.set(l.id, l as LotRow)
  const consumedList: ConsumedInWorkOrder[] = Array.from(consumed.values()).map((c) => ({ lot: lotCache.get(c.lotId)!, workOrder: c.workOrder, qty: c.qty, unit: c.unit, depth: c.depth }))

  // ─────────── 출하(이 LOT 와 산출 LOT) ───────────
  const shipLotIds = Array.from(new Set([rootLotId, ...Array.from(produced.values()).map((p) => p.lot.id)]))
  const shipItems = await q(db.shipmentItem.findMany({
    where: { lotId: { in: shipLotIds }, shipmentOrder: { tenantId } },
    select: {
      lotId: true, qty: true, lot: { select: { lotNo: true } },
      shipmentOrder: { select: { shipmentNo: true, status: true, plannedDate: true, shippedDate: true, salesOrder: { select: { id: true, orderNo: true, customer: { select: { id: true, code: true, name: true } } } } } },
    },
    orderBy: [{ shipmentOrder: { shipmentNo: "asc" } }],
  }))
  const downstreamShipments: DownstreamShipment[] = shipItems.map((s) => ({
    lotId: s.lotId as string, lotNo: s.lot?.lotNo ?? "", qty: n(s.qty), shipmentNo: s.shipmentOrder.shipmentNo, status: s.shipmentOrder.status,
    plannedDate: s.shipmentOrder.plannedDate.toISOString(), shippedDate: s.shipmentOrder.shippedDate?.toISOString() ?? null,
    salesOrder: { id: s.shipmentOrder.salesOrder.id, orderNo: s.shipmentOrder.salesOrder.orderNo }, customer: s.shipmentOrder.salesOrder.customer,
  }))

  // ─────────── 관련 작업지시 요약(양품·불량·재작업·폐기 재공) ───────────
  const workOrderSummaries: WorkOrderTraceSummary[] = []
  const woIdList = Array.from(involvedWoIds)
  if (woIdList.length > 0) {
    const [wos, scrapped] = await Promise.all([
      q(db.workOrder.findMany({ where: { tenantId, id: { in: woIdList } }, select: { id: true, orderNo: true, manufacturingNo: true, status: true, plannedQty: true, operations: { select: { seq: true, productionResults: { select: { goodQty: true, defectQty: true, reworkQty: true } } } } }, orderBy: { orderNo: "asc" } })),
      q(db.wipUnit.findMany({ where: { tenantId, workOrderId: { in: woIdList }, status: "SCRAPPED" }, select: { workOrderId: true, qty: true } })),
    ])
    for (const w of wos) {
      const last = w.operations.reduce<(typeof w.operations)[number] | null>((a, o) => (!a || o.seq > a.seq ? o : a), null)
      const all = w.operations.flatMap((o) => o.productionResults)
      workOrderSummaries.push({
        id: w.id, orderNo: w.orderNo, manufacturingNo: w.manufacturingNo, status: w.status, plannedQty: n(w.plannedQty),
        goodQty: (last?.productionResults ?? []).reduce((s, r) => s + n(r.goodQty), 0),
        defectQty: all.reduce((s, r) => s + n(r.defectQty), 0), reworkQty: all.reduce((s, r) => s + n(r.reworkQty), 0),
        scrappedWipQty: scrapped.filter((x) => x.workOrderId === w.id).reduce((s, x) => s + n(x.qty), 0),
      })
    }
  }

  const byLotNo = (a: { lot: { lotNo: string } }, b: { lot: { lotNo: string } }) => a.lot.lotNo.localeCompare(b.lot.lotNo)
  // 같은 객체가 여러 행에서 공유되지 않도록 복사본으로 돌려준다(서버 액션 직렬화에서 참조 공유 없이 평평한 JSON 이 되게 함)
  const result: LotTraceability = {
    attribution: "WORK_ORDER",
    note: NOTE,
    producedByWorkOrders,
    inputMaterialLots: Array.from(inputRows.values()).sort((a, b) => a.depth - b.depth || byLotNo(a, b)),
    consumedInWorkOrders: consumedList.sort((a, b) => a.depth - b.depth || byLotNo(a, b) || a.workOrder.orderNo.localeCompare(b.workOrder.orderNo)),
    producedLots: Array.from(produced.values()).sort((a, b) => a.depth - b.depth || byLotNo(a, b)),
    downstreamShipments,
    workOrderSummaries,
    diagnostics: { queryCount, levels: TRACE_MAX_DEPTH, truncated },
  }
  return JSON.parse(JSON.stringify(result)) as LotTraceability
}
