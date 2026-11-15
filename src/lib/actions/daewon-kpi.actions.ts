"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId } from "@/lib/auth"
import {
  canReadMenuCode,
  getCurrentPermissionSnapshot,
  ROLE_PERMISSION_DENIED_MESSAGE,
} from "@/lib/auth/role-permissions"
import {
  actualProductionEquipmentWhere,
  resolveActualProductionEquipment,
} from "@/lib/equipment-result-attribution"
import { kstDateRangeToUtcBounds, kstDefaultDateRange, toKstDateKey } from "@/lib/date/kst"
import {
  DAEWON_KPI_TARGETS,
  evaluateKpi,
  summarizeDelivery,
  summarizeProduction,
  validHours,
  type DeliveryKpiSummary,
  type DeliveryLineInput,
  type KpiEvaluation,
  type ProductionFact,
  UPH_BASIS_OPERATION_SEQ,
  type ProductionKpiSummary,
  type TrendGranularity,
} from "@/lib/kpi/daewon-kpi"

// ═════════════════════════════════════════════════════════════════════════════
// 대원정밀 스마트공장 KPI 3종 (시간당 생산량 / 공정불량률 / 납기준수율)
//
// - 계산 로직은 순수 모듈 @/lib/kpi/daewon-kpi 에 있고, 여기서는 MES 운영 데이터를 조회해 넘긴다.
// - 요약 수치는 조회 조건에 해당하는 전체 유효 데이터 기준이다(상세 목록 일부 행 기준 아님).
// - 기존 kpi.actions.ts(CNS 계열 7종 KPI)는 삭제하지 않고 유지한다.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * KPI 대시보드 접근 가드: 서명 검증된 세션 + DASHBOARD(대시보드/KPI) READ 권한.
 * 라우트 가드(app/layout 의 canReadPath)와 같은 기준이며, 서버 액션 직접 호출도 막는다.
 */
async function assertKpiAccess(): Promise<void> {
  const snapshot = await getCurrentPermissionSnapshot()
  if (!snapshot) throw new Error("UNAUTHORIZED")
  if (!canReadMenuCode(snapshot, "kpi")) throw new Error(ROLE_PERMISSION_DENIED_MESSAGE)
}

export type DaewonKpiFilterOptions = {
  items: { id: string; code: string; name: string }[]
  equipments: { id: string; code: string; name: string }[]
  processes: { id: string; code: string; name: string }[]
  customers: { id: string; code: string; name: string }[]
}

export async function getDaewonKpiFilterOptions(): Promise<DaewonKpiFilterOptions> {
  await assertKpiAccess()
  const tenantId = await getTenantId()
  const [items, equipments, processes, customers] = await Promise.all([
    prisma.item.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.equipment.findMany({
      where: { tenantId },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.workCenter.findMany({
      where: { site: { tenantId } },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.businessPartner.findMany({
      where: { tenantId, partnerType: { in: ["CUSTOMER", "BOTH"] } },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])
  return { items, equipments, processes, customers }
}

export type DaewonKpiFilter = {
  from: string // YYYY-MM-DD (KST)
  to: string
  itemId?: string
  /** 공정(작업장) — 시간당 생산량/공정불량률에만 적용 */
  processId?: string
  /** 설비 — 시간당 생산량/공정불량률에만 적용 */
  equipmentIds?: string[]
  /** 거래처 — 납기준수율에만 적용 */
  customerId?: string
  granularity?: TrendGranularity
}

export type DefectTypeRow = { code: string; name: string; qty: number; pct: number }

export type ProductionDetailRow = {
  id: string
  dateKey: string
  orderNo: string
  itemName: string
  processName: string
  equipmentName: string | null
  goodQty: number
  defectQty: number
  reworkQty: number
  hours: number | null
}

export type DaewonKpiData = {
  filter: {
    from: string
    to: string
    itemId?: string
    processId?: string
    equipmentIds?: string[]
    customerId?: string
    granularity: TrendGranularity
  }
  todayKey: string
  evaluations: { uph: KpiEvaluation; ppm: KpiEvaluation; onTime: KpiEvaluation }
  targets: typeof DAEWON_KPI_TARGETS
  production: ProductionKpiSummary
  /** 개별 생산실적(계산 근거). 최근 일자 순, 최대 300건 — 요약 수치는 전체 기준 */
  productionRows: ProductionDetailRow[]
  productionRowsTruncated: boolean
  /** 검사(QualityInspection) 기준 불량 유형. 생산실적 기준 PPM 과 별개의 참고 정보 */
  inspectionDefectTypes: { totalQty: number; rows: DefectTypeRow[] }
  delivery: Omit<DeliveryKpiSummary, "rows">
  /** 납기 도래 전체 수주품목 판정 행(계산 근거) */
  deliveryRows: DeliveryKpiSummary["rows"]
}

const DETAIL_LIMIT = 300

function bounds(f: { from: string; to: string }) {
  const { fromDate, toExclusiveDate } = kstDateRangeToUtcBounds(f.from, f.to)
  return { gte: fromDate, lt: toExclusiveDate }
}

async function fetchProductionFacts(tenantId: string, f: DaewonKpiFilter): Promise<ProductionFact[]> {
  const range = bounds(f)
  const results = await prisma.productionResult.findMany({
    where: {
      AND: [
        // 일자 기준: 시작시각(없으면 종료시각)의 KST 일자
        { OR: [{ startedAt: range }, { startedAt: null, endedAt: range }] },
        {
          workOrderOperation: {
            workOrder: {
              tenantId,
              status: { not: "CANCELLED" },
              ...(f.itemId && { itemId: f.itemId }),
            },
            ...(f.processId && { routingOperation: { workCenterId: f.processId } }),
          },
        },
        actualProductionEquipmentWhere(f.equipmentIds),
      ],
    },
    select: {
      id: true,
      goodQty: true,
      defectQty: true,
      reworkQty: true,
      startedAt: true,
      endedAt: true,
      workOrderOperationAssignment: {
        select: { equipment: { select: { id: true, code: true, name: true } } },
      },
      workOrderOperation: {
        select: {
          equipment: { select: { id: true, code: true, name: true } },
          routingOperation: {
            select: { seq: true, workCenter: { select: { id: true, name: true } } },
          },
          workOrder: {
            select: {
              orderNo: true,
              item: { select: { id: true, code: true, name: true } },
            },
          },
        },
      },
    },
  })

  const facts: ProductionFact[] = []
  for (const r of results) {
    const base = r.startedAt ?? r.endedAt
    if (!base) continue
    const wo = r.workOrderOperation.workOrder
    const wc = r.workOrderOperation.routingOperation.workCenter
    const opSeq = r.workOrderOperation.routingOperation.seq
    const eq = resolveActualProductionEquipment(r)
    facts.push({
      id: r.id,
      dateKey: toKstDateKey(base),
      orderNo: wo.orderNo,
      itemId: wo.item.id,
      itemCode: wo.item.code,
      itemName: wo.item.name,
      processId: wc.id,
      processName: wc.name,
      equipmentId: eq?.id ?? null,
      equipmentName: eq?.name ?? null,
      goodQty: Number(r.goodQty),
      defectQty: Number(r.defectQty),
      reworkQty: Number(r.reworkQty),
      hours: validHours(r.startedAt, r.endedAt),
      uphBasis: opSeq === UPH_BASIS_OPERATION_SEQ,
    })
  }
  return facts
}

async function fetchInspectionDefectTypes(tenantId: string, f: DaewonKpiFilter) {
  const range = bounds(f)
  const records = await prisma.defectRecord.findMany({
    where: {
      qualityInspection: {
        inspectedAt: range,
        workOrderOperation: {
          workOrder: { tenantId, status: { not: "CANCELLED" }, ...(f.itemId && { itemId: f.itemId }) },
          ...(f.processId && { routingOperation: { workCenterId: f.processId } }),
          ...(f.equipmentIds?.length && { equipmentId: { in: f.equipmentIds } }),
        },
      },
    },
    select: { qty: true, defectCode: { select: { code: true, name: true } } },
  })
  const map = new Map<string, { code: string; name: string; qty: number }>()
  let total = 0
  for (const r of records) {
    const q = Number(r.qty)
    total += q
    const e = map.get(r.defectCode.code) ?? { code: r.defectCode.code, name: r.defectCode.name, qty: 0 }
    e.qty += q
    map.set(r.defectCode.code, e)
  }
  const rows: DefectTypeRow[] = Array.from(map.values())
    .sort((a, b) => b.qty - a.qty)
    .map((e) => ({ ...e, pct: total > 0 ? Math.round((e.qty / total) * 1000) / 10 : 0 }))
  return { totalQty: total, rows }
}

async function fetchDeliveryLines(tenantId: string, f: DaewonKpiFilter): Promise<DeliveryLineInput[]> {
  const range = bounds(f)
  const lines = await prisma.salesOrderItem.findMany({
    where: {
      salesOrder: {
        tenantId,
        // 취소·미확정(DRAFT) 수주는 유효하지 않은 건으로 제외
        status: { notIn: ["CANCELLED", "DRAFT"] },
        ...(f.customerId && { customerId: f.customerId }),
      },
      ...(f.itemId && { itemId: f.itemId }),
      // 약속 납기일 = 품목 납기일 우선, 없으면 수주 납기일
      OR: [{ deliveryDate: range }, { deliveryDate: null, salesOrder: { deliveryDate: range } }],
    },
    select: {
      id: true,
      qty: true,
      deliveryDate: true,
      item: { select: { id: true, code: true, name: true } },
      salesOrder: {
        select: {
          orderNo: true,
          deliveryDate: true,
          customer: { select: { id: true, name: true } },
        },
      },
      shipmentItems: {
        where: { shipmentOrder: { tenantId, status: { in: ["SHIPPED", "DELIVERED"] } } },
        select: {
          id: true,
          qty: true,
          shipmentOrder: { select: { shippedDate: true, deliveredDate: true } },
        },
      },
    },
  })

  return lines.map((l) => {
    const due = l.deliveryDate ?? l.salesOrder.deliveryDate
    const shipments: DeliveryLineInput["shipments"] = []
    for (const si of l.shipmentItems) {
      const d = si.shipmentOrder.shippedDate ?? si.shipmentOrder.deliveredDate
      if (!d) continue
      shipments.push({ id: si.id, dateKey: toKstDateKey(d), qty: Number(si.qty) })
    }
    return {
      salesOrderItemId: l.id,
      orderNo: l.salesOrder.orderNo,
      customerId: l.salesOrder.customer.id,
      customerName: l.salesOrder.customer.name,
      itemId: l.item.id,
      itemCode: l.item.code,
      itemName: l.item.name,
      orderedQty: Number(l.qty),
      dueKey: toKstDateKey(due),
      shipments,
    }
  })
}

export async function getDaewonKpiData(filterOverride?: Partial<DaewonKpiFilter>): Promise<DaewonKpiData> {
  await assertKpiAccess()
  const tenantId = await getTenantId()
  const defaults = kstDefaultDateRange(30)
  const granularity: TrendGranularity = filterOverride?.granularity === "month" ? "month" : "day"
  const filter: DaewonKpiFilter & { granularity: TrendGranularity } = {
    from: filterOverride?.from ?? defaults.from,
    to: filterOverride?.to ?? defaults.to,
    itemId: filterOverride?.itemId || undefined,
    processId: filterOverride?.processId || undefined,
    equipmentIds: filterOverride?.equipmentIds?.length ? filterOverride.equipmentIds : undefined,
    customerId: filterOverride?.customerId || undefined,
    granularity,
  }
  const todayKey = toKstDateKey(new Date())

  const [facts, inspectionDefectTypes, deliveryLines] = await Promise.all([
    fetchProductionFacts(tenantId, filter),
    fetchInspectionDefectTypes(tenantId, filter),
    fetchDeliveryLines(tenantId, filter),
  ])

  const production = summarizeProduction(facts, granularity)
  const { rows: deliveryRows, ...delivery } = summarizeDelivery(deliveryLines, todayKey, granularity)

  const seen = new Set<string>()
  const detail = facts
    .filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey) || a.orderNo.localeCompare(b.orderNo))
  const productionRows: ProductionDetailRow[] = detail.slice(0, DETAIL_LIMIT).map((x) => ({
    id: x.id,
    dateKey: x.dateKey,
    orderNo: x.orderNo,
    itemName: x.itemName,
    processName: x.processName,
    equipmentName: x.equipmentName,
    goodQty: x.goodQty,
    defectQty: x.defectQty,
    reworkQty: x.reworkQty,
    hours: x.hours,
  }))

  return {
    filter,
    todayKey,
    evaluations: {
      uph: evaluateKpi("uph", production.uph.value),
      ppm: evaluateKpi("ppm", production.ppm.value),
      onTime: evaluateKpi("onTime", delivery.value),
    },
    targets: DAEWON_KPI_TARGETS,
    production,
    productionRows,
    productionRowsTruncated: detail.length > DETAIL_LIMIT,
    inspectionDefectTypes,
    delivery,
    deliveryRows,
  }
}
