import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ─── 날짜 헬퍼 ────────────────────────────────────────────────────────────────

const BASE_DATE = new Date('2026-03-28T00:00:00.000Z')

function daysAgo(n: number): Date {
  const d = new Date(BASE_DATE)
  d.setDate(d.getDate() - n)
  return d
}

function dateAt(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00.000Z')
}

function hoursOf(date: Date, hour: number): Date {
  const d = new Date(date)
  d.setUTCHours(hour, 0, 0, 0)
  return d
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-demo-001'
const SITE_FACTORY = 'site-factory-001'
const PROFILE_ADMIN = 'profile-admin-001'
const PROFILE_MANAGER = 'profile-manager-001'

const ITEM_FG_ASSY = 'item-fg-assy-001'
const ITEM_SEMI_FRAME = 'item-semi-frame-001'
const ITEM_RAW_STEEL = 'item-raw-steel-001'
const ITEM_RAW_ALUM = 'item-raw-alum-001'
const ITEM_RAW_BOLT = 'item-raw-bolt-001'
const ITEM_CONS_OIL = 'item-cons-oil-001'
const ITEM_CONS_GLOVE = 'item-cons-glove-001'

const BOM_FG_ASSY = 'bom-fg-assy-001'
const BOM_SEMI_FRAME = 'bom-semi-frame-001'

const ROUTING_FG_ASSY = 'rtg-fg-assy-001'
const ROUTING_SEMI_FRAME = 'rtg-semi-frame-001'

// RoutingOperation IDs
const ROP_ASSY_10 = 'rop-assy-10'
const ROP_ASSY_20 = 'rop-assy-20'
const ROP_ASSY_30 = 'rop-assy-30'
const ROP_ASSY_40 = 'rop-assy-40'
const ROP_FRAME_10 = 'rop-frame-10'
const ROP_FRAME_20 = 'rop-frame-20'
const ROP_FRAME_30 = 'rop-frame-30'

// Equipment IDs
const EQ_CNC_001 = 'eq-cnc-001'
const EQ_CNC_002 = 'eq-cnc-002'
const EQ_ASSY_001 = 'eq-assy-001'
const EQ_INSP_001 = 'eq-insp-001'

// Warehouse / Location IDs
const WH_RAW = 'wh-raw-001'
const WH_SEMI = 'wh-semi-001'
const WH_FG = 'wh-fg-001'

const LOC_RAW_A = 'loc-raw-A-001'
const LOC_RAW_B = 'loc-raw-B-001'
const LOC_RAW_C = 'loc-raw-C-001'
const LOC_SEMI_A = 'loc-semi-A-001'
const LOC_SEMI_B = 'loc-semi-B-001'
const LOC_FG_A = 'loc-fg-A-001'
const LOC_FG_B = 'loc-fg-B-001'
const LOC_FG_SHIP = 'loc-fg-ship-001'

// Business Partner IDs
const BP_SUPPLIER_001 = 'bp-supplier-001'
const BP_SUPPLIER_002 = 'bp-supplier-002'
const BP_CUSTOMER_001 = 'bp-customer-001'
const BP_CUSTOMER_002 = 'bp-customer-002'
const BP_BOTH_001 = 'bp-both-001'

// ─── 메인 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 데모 데이터 시드 시작 ===')

  await seedInspectionSpecs()
  await seedWorkOrders()
  await seedProductionResults()
  await seedQualityInspections()
  await seedInventoryBalances()
  await seedSalesOrders()
  await seedPurchaseOrders()
  await seedQuotations()
  await seedEngineeringChanges()
  await seedProductionPlans()

  console.log('=== 데모 데이터 시드 완료 ===')
}

// ─── 1. InspectionSpec (QualityInspection 생성을 위해 먼저 필요) ──────────────

async function seedInspectionSpecs() {
  console.log('[1/9] InspectionSpec 생성...')

  // FG ASSY 검사 공정(rop-assy-30)용 스펙
  await prisma.inspectionSpec.upsert({
    where: {
      tenantId_itemId_routingOperationId_version: {
        tenantId: TENANT_ID,
        itemId: ITEM_FG_ASSY,
        routingOperationId: ROP_ASSY_30,
        version: 'v1',
      },
    },
    update: {},
    create: {
      id: 'ispec-fg-assy-insp-001',
      tenantId: TENANT_ID,
      itemId: ITEM_FG_ASSY,
      routingOperationId: ROP_ASSY_30,
      version: 'v1',
      status: 'ACTIVE',
      inspectionItems: {
        create: [
          { seq: 10, name: '외관검사', inputType: 'BOOLEAN' },
          { seq: 20, name: '치수검사 (폭)', inputType: 'NUMERIC', lowerLimit: 99.5, upperLimit: 100.5 },
          { seq: 30, name: '치수검사 (길이)', inputType: 'NUMERIC', lowerLimit: 199.5, upperLimit: 200.5 },
          { seq: 40, name: '기능검사', inputType: 'BOOLEAN' },
        ],
      },
    },
  })

  // Semi Frame 검사 공정(rop-frame-30)용 스펙
  await prisma.inspectionSpec.upsert({
    where: {
      tenantId_itemId_routingOperationId_version: {
        tenantId: TENANT_ID,
        itemId: ITEM_SEMI_FRAME,
        routingOperationId: ROP_FRAME_30,
        version: 'v1',
      },
    },
    update: {},
    create: {
      id: 'ispec-semi-frame-insp-001',
      tenantId: TENANT_ID,
      itemId: ITEM_SEMI_FRAME,
      routingOperationId: ROP_FRAME_30,
      version: 'v1',
      status: 'ACTIVE',
      inspectionItems: {
        create: [
          { seq: 10, name: '외관검사', inputType: 'BOOLEAN' },
          { seq: 20, name: '치수검사 (두께)', inputType: 'NUMERIC', lowerLimit: 4.8, upperLimit: 5.2 },
          { seq: 30, name: '표면조도', inputType: 'NUMERIC', lowerLimit: 0, upperLimit: 1.6 },
        ],
      },
    },
  })
}

// ─── 2. Work Orders (WO-2026-003 ~ 007) ──────────────────────────────────────

async function seedWorkOrders() {
  console.log('[2/9] WorkOrder 생성...')

  const workOrders = [
    // WO-2026-003: FG ASSY 50ea COMPLETED (3/14~18)
    {
      id: 'wo-2026-003',
      orderNo: 'WO-2026-003',
      itemId: ITEM_FG_ASSY,
      bomId: BOM_FG_ASSY,
      routingId: ROUTING_FG_ASSY,
      plannedQty: 50,
      status: 'COMPLETED' as const,
      dueDate: dateAt('2026-03-18'),
    },
    // WO-2026-004: FG ASSY 80ea COMPLETED (3/17~21)
    {
      id: 'wo-2026-004',
      orderNo: 'WO-2026-004',
      itemId: ITEM_FG_ASSY,
      bomId: BOM_FG_ASSY,
      routingId: ROUTING_FG_ASSY,
      plannedQty: 80,
      status: 'COMPLETED' as const,
      dueDate: dateAt('2026-03-21'),
    },
    // WO-2026-005: Semi Frame 100ea COMPLETED (3/14~19)
    {
      id: 'wo-2026-005',
      orderNo: 'WO-2026-005',
      itemId: ITEM_SEMI_FRAME,
      bomId: BOM_SEMI_FRAME,
      routingId: ROUTING_SEMI_FRAME,
      plannedQty: 100,
      status: 'COMPLETED' as const,
      dueDate: dateAt('2026-03-19'),
    },
    // WO-2026-006: FG ASSY 60ea COMPLETED (3/19~24)
    {
      id: 'wo-2026-006',
      orderNo: 'WO-2026-006',
      itemId: ITEM_FG_ASSY,
      bomId: BOM_FG_ASSY,
      routingId: ROUTING_FG_ASSY,
      plannedQty: 60,
      status: 'COMPLETED' as const,
      dueDate: dateAt('2026-03-24'),
    },
    // WO-2026-007: FG ASSY 40ea IN_PROGRESS (3/24~현재)
    {
      id: 'wo-2026-007',
      orderNo: 'WO-2026-007',
      itemId: ITEM_FG_ASSY,
      bomId: BOM_FG_ASSY,
      routingId: ROUTING_FG_ASSY,
      plannedQty: 40,
      status: 'IN_PROGRESS' as const,
      dueDate: dateAt('2026-04-02'),
    },
  ]

  for (const wo of workOrders) {
    await prisma.workOrder.upsert({
      where: { tenantId_orderNo: { tenantId: TENANT_ID, orderNo: wo.orderNo } },
      update: {},
      create: {
        id: wo.id,
        tenantId: TENANT_ID,
        siteId: SITE_FACTORY,
        itemId: wo.itemId,
        bomId: wo.bomId,
        routingId: wo.routingId,
        orderNo: wo.orderNo,
        plannedQty: wo.plannedQty,
        status: wo.status,
        dueDate: wo.dueDate,
      },
    })
  }

  // WorkOrderOperations 생성
  await seedWorkOrderOperations()
}

async function seedWorkOrderOperations() {
  // FG ASSY 작업지시들의 공정 (003, 004, 006, 007)
  const assyWoIds = ['wo-2026-003', 'wo-2026-004', 'wo-2026-006', 'wo-2026-007']
  const assyOps = [
    { ropId: ROP_ASSY_10, seq: 10, eqId: EQ_CNC_001 },
    { ropId: ROP_ASSY_20, seq: 20, eqId: EQ_CNC_002 },
    { ropId: ROP_ASSY_30, seq: 30, eqId: EQ_INSP_001 },
    { ropId: ROP_ASSY_40, seq: 40, eqId: EQ_ASSY_001 },
  ]

  const plannedQtyMap: Record<string, number> = {
    'wo-2026-003': 50,
    'wo-2026-004': 80,
    'wo-2026-006': 60,
    'wo-2026-007': 40,
  }

  for (const woId of assyWoIds) {
    const plannedQty = plannedQtyMap[woId]
    const isCompleted = woId !== 'wo-2026-007'

    for (const op of assyOps) {
      const wooId = `${woId}-${op.seq}`
      const opStatus = isCompleted ? 'COMPLETED' : (op.seq <= 20 ? 'COMPLETED' : 'IN_PROGRESS')
      const completedQty = isCompleted ? plannedQty : (op.seq <= 10 ? plannedQty : op.seq <= 20 ? Math.floor(plannedQty * 0.9) : 0)

      await prisma.workOrderOperation.upsert({
        where: { workOrderId_seq: { workOrderId: woId, seq: op.seq } },
        update: {},
        create: {
          id: wooId,
          workOrderId: woId,
          routingOperationId: op.ropId,
          equipmentId: op.eqId,
          seq: op.seq,
          status: opStatus as any,
          plannedQty: plannedQty,
          completedQty: completedQty,
        },
      })
    }
  }

  // Semi Frame 작업지시 (005)
  const frameOps = [
    { ropId: ROP_FRAME_10, seq: 10, eqId: EQ_CNC_001 },
    { ropId: ROP_FRAME_20, seq: 20, eqId: EQ_CNC_002 },
    { ropId: ROP_FRAME_30, seq: 30, eqId: EQ_INSP_001 },
  ]

  for (const op of frameOps) {
    const wooId = `wo-2026-005-${op.seq}`
    await prisma.workOrderOperation.upsert({
      where: { workOrderId_seq: { workOrderId: 'wo-2026-005', seq: op.seq } },
      update: {},
      create: {
        id: wooId,
        workOrderId: 'wo-2026-005',
        routingOperationId: op.ropId,
        equipmentId: op.eqId,
        seq: op.seq,
        status: 'COMPLETED',
        plannedQty: 100,
        completedQty: 100,
      },
    })
  }
}

// ─── 3. ProductionResult ──────────────────────────────────────────────────────

async function seedProductionResults() {
  console.log('[3/9] ProductionResult 생성...')

  // 완료된 WO별 실적 정의: [woId, seq, plannedQty, 시작일오프셋(days), 시작시간, 종료시간]
  const resultDefs: Array<{
    wooId: string
    goodQty: number
    defectQty: number
    reworkQty: number
    startedAt: Date
    endedAt: Date
  }> = [
    // WO-2026-003 (FG ASSY 50ea, 3/14~18)
    { wooId: 'wo-2026-003-10', goodQty: 50, defectQty: 0, reworkQty: 0, startedAt: hoursOf(dateAt('2026-03-14'), 8), endedAt: hoursOf(dateAt('2026-03-14'), 16) },
    { wooId: 'wo-2026-003-20', goodQty: 48, defectQty: 1, reworkQty: 1, startedAt: hoursOf(dateAt('2026-03-15'), 8), endedAt: hoursOf(dateAt('2026-03-15'), 17) },
    { wooId: 'wo-2026-003-30', goodQty: 48, defectQty: 0, reworkQty: 0, startedAt: hoursOf(dateAt('2026-03-16'), 9), endedAt: hoursOf(dateAt('2026-03-16'), 12) },
    { wooId: 'wo-2026-003-40', goodQty: 48, defectQty: 0, reworkQty: 0, startedAt: hoursOf(dateAt('2026-03-17'), 8), endedAt: hoursOf(dateAt('2026-03-18'), 16) },

    // WO-2026-004 (FG ASSY 80ea, 3/17~21)
    { wooId: 'wo-2026-004-10', goodQty: 80, defectQty: 0, reworkQty: 0, startedAt: hoursOf(dateAt('2026-03-17'), 8), endedAt: hoursOf(dateAt('2026-03-17'), 18) },
    { wooId: 'wo-2026-004-20', goodQty: 77, defectQty: 2, reworkQty: 1, startedAt: hoursOf(dateAt('2026-03-18'), 8), endedAt: hoursOf(dateAt('2026-03-19'), 17) },
    { wooId: 'wo-2026-004-30', goodQty: 76, defectQty: 1, reworkQty: 0, startedAt: hoursOf(dateAt('2026-03-20'), 9), endedAt: hoursOf(dateAt('2026-03-20'), 14) },
    { wooId: 'wo-2026-004-40', goodQty: 76, defectQty: 0, reworkQty: 0, startedAt: hoursOf(dateAt('2026-03-20'), 14), endedAt: hoursOf(dateAt('2026-03-21'), 17) },

    // WO-2026-005 (Semi Frame 100ea, 3/14~19)
    { wooId: 'wo-2026-005-10', goodQty: 100, defectQty: 0, reworkQty: 0, startedAt: hoursOf(dateAt('2026-03-14'), 8), endedAt: hoursOf(dateAt('2026-03-15'), 17) },
    { wooId: 'wo-2026-005-20', goodQty: 97, defectQty: 2, reworkQty: 1, startedAt: hoursOf(dateAt('2026-03-16'), 8), endedAt: hoursOf(dateAt('2026-03-17'), 17) },
    { wooId: 'wo-2026-005-30', goodQty: 96, defectQty: 1, reworkQty: 0, startedAt: hoursOf(dateAt('2026-03-18'), 9), endedAt: hoursOf(dateAt('2026-03-18'), 16) },

    // WO-2026-006 (FG ASSY 60ea, 3/19~24)
    { wooId: 'wo-2026-006-10', goodQty: 60, defectQty: 0, reworkQty: 0, startedAt: hoursOf(dateAt('2026-03-19'), 8), endedAt: hoursOf(dateAt('2026-03-19'), 18) },
    { wooId: 'wo-2026-006-20', goodQty: 58, defectQty: 1, reworkQty: 1, startedAt: hoursOf(dateAt('2026-03-20'), 8), endedAt: hoursOf(dateAt('2026-03-21'), 16) },
    { wooId: 'wo-2026-006-30', goodQty: 58, defectQty: 0, reworkQty: 0, startedAt: hoursOf(dateAt('2026-03-22'), 9), endedAt: hoursOf(dateAt('2026-03-22'), 12) },
    { wooId: 'wo-2026-006-40', goodQty: 57, defectQty: 1, reworkQty: 0, startedAt: hoursOf(dateAt('2026-03-23'), 8), endedAt: hoursOf(dateAt('2026-03-24'), 16) },

    // WO-2026-007 (FG ASSY 40ea, IN_PROGRESS, 3/24~현재) - 부분 실적
    { wooId: 'wo-2026-007-10', goodQty: 40, defectQty: 0, reworkQty: 0, startedAt: hoursOf(dateAt('2026-03-24'), 8), endedAt: hoursOf(dateAt('2026-03-24'), 18) },
    { wooId: 'wo-2026-007-20', goodQty: 36, defectQty: 1, reworkQty: 1, startedAt: hoursOf(dateAt('2026-03-25'), 8), endedAt: hoursOf(dateAt('2026-03-26'), 15) },
  ]

  for (const r of resultDefs) {
    // ProductionResult는 unique key가 없으므로 workOrderOperationId로 기존 레코드 확인 후 생성
    const existing = await prisma.productionResult.findFirst({
      where: { workOrderOperationId: r.wooId },
    })
    if (!existing) {
      await prisma.productionResult.create({
        data: {
          workOrderOperationId: r.wooId,
          goodQty: r.goodQty,
          defectQty: r.defectQty,
          reworkQty: r.reworkQty,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
        },
      })
    }
  }
}

// ─── 4. QualityInspection ─────────────────────────────────────────────────────

async function seedQualityInspections() {
  console.log('[4/9] QualityInspection 생성...')

  // 검사 공정(seq=30)에 대해서만 생성
  // FG ASSY 검사: ispec-fg-assy-insp-001, Semi Frame: ispec-semi-frame-insp-001
  const inspectionDefs: Array<{
    id: string
    wooId: string
    specId: string
    result: 'PASS' | 'FAIL'
    inspectedQty: number
    inspectedAt: Date
    defectCodeId?: string
    defectQty?: number
  }> = [
    // WO-2026-003 검사 (PASS)
    { id: 'qi-003-30', wooId: 'wo-2026-003-30', specId: 'ispec-fg-assy-insp-001', result: 'PASS', inspectedQty: 48, inspectedAt: hoursOf(dateAt('2026-03-16'), 11) },

    // WO-2026-004 검사 (FAIL - 1건 불량)
    { id: 'qi-004-30', wooId: 'wo-2026-004-30', specId: 'ispec-fg-assy-insp-001', result: 'FAIL', inspectedQty: 77, inspectedAt: hoursOf(dateAt('2026-03-20'), 13), defectCodeId: 'dc-dim-001', defectQty: 1 },

    // WO-2026-005 검사 (FAIL - 1건 불량)
    { id: 'qi-005-30', wooId: 'wo-2026-005-30', specId: 'ispec-semi-frame-insp-001', result: 'FAIL', inspectedQty: 98, inspectedAt: hoursOf(dateAt('2026-03-18'), 15), defectCodeId: 'dc-vis-001', defectQty: 1 },

    // WO-2026-006 검사 (PASS)
    { id: 'qi-006-30', wooId: 'wo-2026-006-30', specId: 'ispec-fg-assy-insp-001', result: 'PASS', inspectedQty: 59, inspectedAt: hoursOf(dateAt('2026-03-22'), 11) },
  ]

  for (const insp of inspectionDefs) {
    const existing = await prisma.qualityInspection.findFirst({
      where: { workOrderOperationId: insp.wooId },
    })
    if (!existing) {
      const created = await prisma.qualityInspection.create({
        data: {
          id: insp.id,
          workOrderOperationId: insp.wooId,
          inspectionSpecId: insp.specId,
          inspectorId: PROFILE_ADMIN,
          result: insp.result,
          inspectedQty: insp.inspectedQty,
          inspectedAt: insp.inspectedAt,
        },
      })

      // FAIL 건에 대한 DefectRecord 추가
      if (insp.result === 'FAIL' && insp.defectCodeId && insp.defectQty) {
        await prisma.defectRecord.create({
          data: {
            qualityInspectionId: created.id,
            defectCodeId: insp.defectCodeId,
            qty: insp.defectQty,
            severity: 'MAJOR',
            disposition: 'REWORK',
          },
        })
      }
    }
  }
}

// ─── 5. InventoryBalance ──────────────────────────────────────────────────────

async function seedInventoryBalances() {
  console.log('[5/9] InventoryBalance 생성...')

  // 창고별 재고 배분: 각 품목을 주 창고의 위치에 배분
  const balances = [
    // 원자재 창고
    { itemId: ITEM_RAW_STEEL,  locationId: LOC_RAW_A, qtyOnHand: 300, qtyAvailable: 270, qtyHold: 30 },
    { itemId: ITEM_RAW_STEEL,  locationId: LOC_RAW_B, qtyOnHand: 200, qtyAvailable: 180, qtyHold: 20 },
    { itemId: ITEM_RAW_ALUM,   locationId: LOC_RAW_A, qtyOnHand: 120, qtyAvailable: 110, qtyHold: 10 },
    { itemId: ITEM_RAW_ALUM,   locationId: LOC_RAW_B, qtyOnHand: 80,  qtyAvailable: 70,  qtyHold: 10 },
    { itemId: ITEM_RAW_BOLT,   locationId: LOC_RAW_C, qtyOnHand: 2000, qtyAvailable: 1800, qtyHold: 200 },
    { itemId: ITEM_CONS_OIL,   locationId: LOC_RAW_C, qtyOnHand: 30,  qtyAvailable: 30,  qtyHold: 0 },
    { itemId: ITEM_CONS_GLOVE, locationId: LOC_RAW_C, qtyOnHand: 50,  qtyAvailable: 50,  qtyHold: 0 },

    // 반제품 창고
    { itemId: ITEM_SEMI_FRAME, locationId: LOC_SEMI_A, qtyOnHand: 50,  qtyAvailable: 40,  qtyHold: 10 },
    { itemId: ITEM_SEMI_FRAME, locationId: LOC_SEMI_B, qtyOnHand: 30,  qtyAvailable: 20,  qtyHold: 10 },

    // 완제품 창고
    { itemId: ITEM_FG_ASSY,    locationId: LOC_FG_A,    qtyOnHand: 80,  qtyAvailable: 70,  qtyHold: 10 },
    { itemId: ITEM_FG_ASSY,    locationId: LOC_FG_B,    qtyOnHand: 40,  qtyAvailable: 30,  qtyHold: 10 },
  ]

  for (const bal of balances) {
    const existing = await prisma.inventoryBalance.findFirst({
      where: {
        tenantId: TENANT_ID,
        itemId: bal.itemId,
        locationId: bal.locationId,
        lotId: null,
      },
    })

    if (existing) {
      await prisma.inventoryBalance.update({
        where: { id: existing.id },
        data: {
          qtyOnHand: bal.qtyOnHand,
          qtyAvailable: bal.qtyAvailable,
          qtyHold: bal.qtyHold,
        },
      })
    } else {
      await prisma.inventoryBalance.create({
        data: {
          tenantId: TENANT_ID,
          siteId: SITE_FACTORY,
          itemId: bal.itemId,
          locationId: bal.locationId,
          qtyOnHand: bal.qtyOnHand,
          qtyAvailable: bal.qtyAvailable,
          qtyHold: bal.qtyHold,
        },
      })
    }
  }
}

// ─── 6. 추가 수주 (SO-2026-003 ~ 007) ────────────────────────────────────────

async function seedSalesOrders() {
  console.log('[6/9] SalesOrder 생성...')

  const salesOrders = [
    {
      id: 'so-2026-003',
      orderNo: 'SO-2026-003',
      customerId: BP_CUSTOMER_001,
      orderDate: dateAt('2026-03-14'),
      deliveryDate: dateAt('2026-04-10'),
      status: 'CONFIRMED' as const,
      totalAmount: 48000000,
      items: [
        { itemId: ITEM_FG_ASSY, qty: 80, unitPrice: 500000, shippedQty: 0, producedQty: 0 },
        { itemId: ITEM_SEMI_FRAME, qty: 50, unitPrice: 160000, shippedQty: 0, producedQty: 0 },
      ],
    },
    {
      id: 'so-2026-004',
      orderNo: 'SO-2026-004',
      customerId: BP_CUSTOMER_002,
      orderDate: dateAt('2026-03-17'),
      deliveryDate: dateAt('2026-04-15'),
      status: 'IN_PRODUCTION' as const,
      totalAmount: 30000000,
      items: [
        { itemId: ITEM_FG_ASSY, qty: 60, unitPrice: 500000, shippedQty: 0, producedQty: 40 },
      ],
    },
    {
      id: 'so-2026-005',
      orderNo: 'SO-2026-005',
      customerId: BP_CUSTOMER_001,
      orderDate: dateAt('2026-03-20'),
      deliveryDate: dateAt('2026-04-20'),
      status: 'CONFIRMED' as const,
      totalAmount: 25000000,
      items: [
        { itemId: ITEM_FG_ASSY, qty: 50, unitPrice: 500000, shippedQty: 0, producedQty: 0 },
      ],
    },
    {
      id: 'so-2026-006',
      orderNo: 'SO-2026-006',
      customerId: BP_CUSTOMER_002,
      orderDate: dateAt('2026-03-25'),
      deliveryDate: dateAt('2026-05-01'),
      status: 'DRAFT' as const,
      totalAmount: 40000000,
      items: [
        { itemId: ITEM_FG_ASSY, qty: 80, unitPrice: 500000, shippedQty: 0, producedQty: 0 },
      ],
    },
    {
      id: 'so-2026-007',
      orderNo: 'SO-2026-007',
      customerId: BP_BOTH_001,
      orderDate: dateAt('2026-03-10'),
      deliveryDate: dateAt('2026-03-20'),
      status: 'SHIPPED' as const,
      totalAmount: 19200000,
      items: [
        { itemId: ITEM_FG_ASSY, qty: 30, unitPrice: 500000, shippedQty: 30, producedQty: 30 },
        { itemId: ITEM_SEMI_FRAME, qty: 42, unitPrice: 160000, shippedQty: 42, producedQty: 42 },
      ],
    },
  ]

  for (const so of salesOrders) {
    const existing = await prisma.salesOrder.findUnique({
      where: { tenantId_orderNo: { tenantId: TENANT_ID, orderNo: so.orderNo } },
    })
    if (!existing) {
      await prisma.salesOrder.create({
        data: {
          id: so.id,
          tenantId: TENANT_ID,
          siteId: SITE_FACTORY,
          customerId: so.customerId,
          orderNo: so.orderNo,
          orderDate: so.orderDate,
          deliveryDate: so.deliveryDate,
          status: so.status,
          totalAmount: so.totalAmount,
          currency: 'KRW',
          items: {
            create: so.items.map((item) => ({
              itemId: item.itemId,
              qty: item.qty,
              unitPrice: item.unitPrice,
              shippedQty: item.shippedQty,
              producedQty: item.producedQty,
            })),
          },
        },
      })
    }
  }
}

// ─── 7. 추가 발주 (PO-2026-003 ~ 006) ────────────────────────────────────────

async function seedPurchaseOrders() {
  console.log('[7/9] PurchaseOrder 생성...')

  const purchaseOrders = [
    {
      id: 'po-2026-003',
      orderNo: 'PO-2026-003',
      supplierId: BP_SUPPLIER_001,
      orderDate: dateAt('2026-03-14'),
      expectedDate: dateAt('2026-03-18'),
      status: 'RECEIVED' as const,
      totalAmount: 15000000,
      items: [
        { itemId: ITEM_RAW_STEEL, qty: 500, unitPrice: 20000, receivedQty: 500 },
        { itemId: ITEM_RAW_BOLT,  qty: 5000, unitPrice: 500,  receivedQty: 5000 },
      ],
    },
    {
      id: 'po-2026-004',
      orderNo: 'PO-2026-004',
      supplierId: BP_SUPPLIER_002,
      orderDate: dateAt('2026-03-20'),
      expectedDate: dateAt('2026-04-05'),
      status: 'ORDERED' as const,
      totalAmount: 8000000,
      items: [
        { itemId: ITEM_RAW_ALUM, qty: 400, unitPrice: 20000, receivedQty: 0 },
      ],
    },
    {
      id: 'po-2026-005',
      orderNo: 'PO-2026-005',
      supplierId: BP_SUPPLIER_001,
      orderDate: dateAt('2026-03-22'),
      expectedDate: dateAt('2026-03-29'),
      status: 'PARTIAL_RECEIVED' as const,
      totalAmount: 10000000,
      items: [
        { itemId: ITEM_RAW_STEEL, qty: 300, unitPrice: 20000, receivedQty: 150 },
        { itemId: ITEM_RAW_BOLT,  qty: 2000, unitPrice: 500,  receivedQty: 2000 },
      ],
    },
    {
      id: 'po-2026-006',
      orderNo: 'PO-2026-006',
      supplierId: BP_BOTH_001,
      orderDate: dateAt('2026-03-27'),
      expectedDate: dateAt('2026-04-10'),
      status: 'DRAFT' as const,
      totalAmount: 5000000,
      items: [
        { itemId: ITEM_RAW_ALUM, qty: 200, unitPrice: 20000, receivedQty: 0 },
        { itemId: ITEM_CONS_OIL, qty: 50,  unitPrice: 20000,  receivedQty: 0 },
      ],
    },
  ]

  for (const po of purchaseOrders) {
    const existing = await prisma.purchaseOrder.findUnique({
      where: { tenantId_orderNo: { tenantId: TENANT_ID, orderNo: po.orderNo } },
    })
    if (!existing) {
      const created = await prisma.purchaseOrder.create({
        data: {
          id: po.id,
          tenantId: TENANT_ID,
          siteId: SITE_FACTORY,
          supplierId: po.supplierId,
          orderNo: po.orderNo,
          orderDate: po.orderDate,
          expectedDate: po.expectedDate,
          status: po.status,
          totalAmount: po.totalAmount,
          currency: 'KRW',
          items: {
            create: po.items.map((item) => ({
              itemId: item.itemId,
              qty: item.qty,
              unitPrice: item.unitPrice,
              receivedQty: item.receivedQty,
              stockAtOrder: 0,
            })),
          },
        },
      })

      // RECEIVED / PARTIAL_RECEIVED 발주에 대한 ReceivingInspection 생성
      if (po.status === 'RECEIVED' || po.status === 'PARTIAL_RECEIVED') {
        const poItems = await prisma.purchaseOrderItem.findMany({
          where: { purchaseOrderId: created.id },
        })
        for (const poItem of poItems) {
          if (Number(poItem.receivedQty) > 0) {
            await prisma.receivingInspection.create({
              data: {
                purchaseOrderItemId: poItem.id,
                inspectorId: PROFILE_ADMIN,
                receivedQty: poItem.receivedQty,
                acceptedQty: poItem.receivedQty,
                rejectedQty: 0,
                result: 'PASS',
                inspectedAt: po.status === 'RECEIVED' ? dateAt('2026-03-18') : dateAt('2026-03-25'),
                note: '입고검사 합격',
              },
            })
          }
        }
      }
    }
  }
}

// ─── 8. 추가 견적 (QT-2026-003 ~ 006) ────────────────────────────────────────

async function seedQuotations() {
  console.log('[8/9] Quotation 생성...')

  const quotations = [
    {
      id: 'qt-2026-003',
      quotationNo: 'QT-2026-003',
      customerId: BP_CUSTOMER_001,
      quotationDate: dateAt('2026-03-15'),
      validUntil: dateAt('2026-04-30'),
      status: 'NEGOTIATING' as const,
      totalAmount: 35000000,
      items: [
        { itemId: ITEM_FG_ASSY, qty: 70, unitPrice: 500000 },
      ],
    },
    {
      id: 'qt-2026-004',
      quotationNo: 'QT-2026-004',
      customerId: BP_CUSTOMER_002,
      quotationDate: dateAt('2026-03-20'),
      validUntil: dateAt('2026-04-20'),
      status: 'DRAFT' as const,
      totalAmount: 24000000,
      items: [
        { itemId: ITEM_FG_ASSY, qty: 40, unitPrice: 500000 },
        { itemId: ITEM_SEMI_FRAME, qty: 40, unitPrice: 160000 },
      ],
    },
    {
      id: 'qt-2026-005',
      quotationNo: 'QT-2026-005',
      customerId: BP_CUSTOMER_001,
      quotationDate: dateAt('2026-03-01'),
      validUntil: dateAt('2026-03-20'),
      status: 'LOST' as const,
      totalAmount: 15000000,
      items: [
        { itemId: ITEM_FG_ASSY, qty: 30, unitPrice: 500000 },
      ],
    },
    {
      id: 'qt-2026-006',
      quotationNo: 'QT-2026-006',
      customerId: BP_CUSTOMER_002,
      quotationDate: dateAt('2026-03-10'),
      validUntil: dateAt('2026-04-10'),
      status: 'WON' as const,
      totalAmount: 30000000,
      items: [
        { itemId: ITEM_FG_ASSY, qty: 60, unitPrice: 500000 },
      ],
    },
  ]

  for (const qt of quotations) {
    const existing = await prisma.quotation.findUnique({
      where: { tenantId_quotationNo: { tenantId: TENANT_ID, quotationNo: qt.quotationNo } },
    })
    if (!existing) {
      await prisma.quotation.create({
        data: {
          id: qt.id,
          tenantId: TENANT_ID,
          siteId: SITE_FACTORY,
          customerId: qt.customerId,
          quotationNo: qt.quotationNo,
          quotationDate: qt.quotationDate,
          validUntil: qt.validUntil,
          status: qt.status,
          totalAmount: qt.totalAmount,
          currency: 'KRW',
          items: {
            create: qt.items.map((item) => ({
              itemId: item.itemId,
              qty: item.qty,
              unitPrice: item.unitPrice,
            })),
          },
        },
      })
    }
  }
}

// ─── 9. ECN (ECN-2026-002, ECN-2026-003) ─────────────────────────────────────

async function seedEngineeringChanges() {
  console.log('[9/9] EngineeringChange 생성...')

  const ecns = [
    {
      id: 'ecn-2026-002',
      ecnNo: 'ECN-2026-002',
      title: '볼트 체결 수량 변경 (BOM 수량 조정)',
      reason: '조립 강도 향상을 위한 볼트 추가 체결 필요',
      changeType: 'BOM',
      targetItemId: ITEM_FG_ASSY,
      status: 'SUBMITTED' as const,
      requestedBy: PROFILE_MANAGER,
      requestedAt: dateAt('2026-03-20'),
      details: [
        {
          changeTarget: 'BOM',
          actionType: 'UPDATE',
          beforeValue: { itemId: ITEM_RAW_BOLT, qty: 4 },
          afterValue: { itemId: ITEM_RAW_BOLT, qty: 6 },
          description: 'item-raw-bolt-001 수량 4ea → 6ea로 변경',
        },
      ],
    },
    {
      id: 'ecn-2026-003',
      ecnNo: 'ECN-2026-003',
      title: '도장 공정 추가 (라우팅 변경)',
      reason: '고객 요구 표면처리 기준 강화에 따른 도장 공정 신규 추가',
      changeType: 'ROUTING',
      targetItemId: ITEM_FG_ASSY,
      status: 'APPROVED' as const,
      requestedBy: PROFILE_MANAGER,
      approvedBy: PROFILE_ADMIN,
      requestedAt: dateAt('2026-03-10'),
      approvedAt: dateAt('2026-03-14'),
      details: [
        {
          changeTarget: 'ROUTING',
          actionType: 'ADD',
          beforeValue: null,
          afterValue: { seq: 25, workCenterId: 'wc-assembly-001', operationName: '도장', cycleTime: 30 },
          description: '조립 공정 후 도장 공정(seq=25) 추가',
        },
      ],
    },
  ]

  for (const ecn of ecns) {
    const existing = await prisma.engineeringChange.findUnique({
      where: { tenantId_ecnNo: { tenantId: TENANT_ID, ecnNo: ecn.ecnNo } },
    })
    if (!existing) {
      await prisma.engineeringChange.create({
        data: {
          id: ecn.id,
          tenantId: TENANT_ID,
          ecnNo: ecn.ecnNo,
          title: ecn.title,
          reason: ecn.reason,
          changeType: ecn.changeType,
          targetItemId: ecn.targetItemId,
          status: ecn.status,
          requestedBy: ecn.requestedBy,
          approvedBy: ecn.approvedBy ?? null,
          requestedAt: ecn.requestedAt,
          approvedAt: ecn.approvedAt ?? null,
          details: {
            create: ecn.details.map((d) => ({
              changeTarget: d.changeTarget,
              actionType: d.actionType,
              beforeValue: d.beforeValue ?? undefined,
              afterValue: d.afterValue ?? undefined,
              description: d.description,
            })),
          },
        },
      })
    }
  }
}

// ─── 10. ProductionPlan (2주치 주간/일간 계획) ────────────────────────────────

async function seedProductionPlans() {
  console.log('[10/10] ProductionPlan 생성...')

  const plans = [
    // W13: 3/14~3/20 완료
    {
      id: 'pp-2026-w13',
      planNo: 'PP-2026-W13',
      planType: 'WEEKLY' as const,
      startDate: dateAt('2026-03-14'),
      endDate: dateAt('2026-03-20'),
      status: 'COMPLETED' as const,
      note: '3월 3주차 주간계획',
      items: [
        { id: 'ppi-w13-fg', itemId: ITEM_FG_ASSY, bomId: BOM_FG_ASSY, routingId: ROUTING_FG_ASSY, plannedQty: 130, note: 'WO-003, WO-004 연계' },
        { id: 'ppi-w13-frame', itemId: ITEM_SEMI_FRAME, bomId: BOM_SEMI_FRAME, routingId: ROUTING_SEMI_FRAME, plannedQty: 100, note: 'WO-005 연계' },
      ],
    },
    // W14: 3/21~3/27 완료
    {
      id: 'pp-2026-w14-demo',
      planNo: 'PP-2026-W14-DEMO',
      planType: 'WEEKLY' as const,
      startDate: dateAt('2026-03-21'),
      endDate: dateAt('2026-03-27'),
      status: 'COMPLETED' as const,
      note: '3월 4주차 주간계획',
      items: [
        { id: 'ppi-w14-fg', itemId: ITEM_FG_ASSY, bomId: BOM_FG_ASSY, routingId: ROUTING_FG_ASSY, plannedQty: 100, note: 'WO-006, WO-007 연계' },
        { id: 'ppi-w14-frame', itemId: ITEM_SEMI_FRAME, bomId: BOM_SEMI_FRAME, routingId: ROUTING_SEMI_FRAME, plannedQty: 80, note: '반제품 재고 보충' },
      ],
    },
    // W15: 3/28~4/3 진행중
    {
      id: 'pp-2026-w15',
      planNo: 'PP-2026-W15',
      planType: 'WEEKLY' as const,
      startDate: dateAt('2026-03-28'),
      endDate: dateAt('2026-04-03'),
      status: 'IN_PROGRESS' as const,
      note: '4월 1주차 주간계획 (진행중)',
      items: [
        { id: 'ppi-w15-fg', itemId: ITEM_FG_ASSY, bomId: BOM_FG_ASSY, routingId: ROUTING_FG_ASSY, plannedQty: 120, note: 'SO-2026-003, SO-2026-004 납기 대응' },
        { id: 'ppi-w15-frame', itemId: ITEM_SEMI_FRAME, bomId: BOM_SEMI_FRAME, routingId: ROUTING_SEMI_FRAME, plannedQty: 60, note: '반제품 선행 생산' },
      ],
    },
    // W16: 4/4~4/10 예정
    {
      id: 'pp-2026-w16',
      planNo: 'PP-2026-W16',
      planType: 'WEEKLY' as const,
      startDate: dateAt('2026-04-04'),
      endDate: dateAt('2026-04-10'),
      status: 'CONFIRMED' as const,
      note: '4월 2주차 주간계획 (확정)',
      items: [
        { id: 'ppi-w16-fg', itemId: ITEM_FG_ASSY, bomId: BOM_FG_ASSY, routingId: ROUTING_FG_ASSY, plannedQty: 100, note: 'SO-2026-005 납기 대응' },
      ],
    },
    // 일간계획 3건 (최근 3일)
    {
      id: 'pp-2026-d0326',
      planNo: 'PP-2026-D0326',
      planType: 'DAILY' as const,
      startDate: dateAt('2026-03-26'),
      endDate: dateAt('2026-03-26'),
      status: 'COMPLETED' as const,
      note: '3/26 일간계획',
      items: [
        { id: 'ppi-d0326-fg', itemId: ITEM_FG_ASSY, bomId: BOM_FG_ASSY, routingId: ROUTING_FG_ASSY, plannedQty: 20, note: '일일 목표' },
      ],
    },
    {
      id: 'pp-2026-d0327',
      planNo: 'PP-2026-D0327',
      planType: 'DAILY' as const,
      startDate: dateAt('2026-03-27'),
      endDate: dateAt('2026-03-27'),
      status: 'COMPLETED' as const,
      note: '3/27 일간계획',
      items: [
        { id: 'ppi-d0327-fg', itemId: ITEM_FG_ASSY, bomId: BOM_FG_ASSY, routingId: ROUTING_FG_ASSY, plannedQty: 20, note: '일일 목표' },
      ],
    },
    {
      id: 'pp-2026-d0328',
      planNo: 'PP-2026-D0328',
      planType: 'DAILY' as const,
      startDate: dateAt('2026-03-28'),
      endDate: dateAt('2026-03-28'),
      status: 'IN_PROGRESS' as const,
      note: '3/28 일간계획 (오늘)',
      items: [
        { id: 'ppi-d0328-fg', itemId: ITEM_FG_ASSY, bomId: BOM_FG_ASSY, routingId: ROUTING_FG_ASSY, plannedQty: 15, note: '오늘 목표' },
        { id: 'ppi-d0328-frame', itemId: ITEM_SEMI_FRAME, bomId: BOM_SEMI_FRAME, routingId: ROUTING_SEMI_FRAME, plannedQty: 10, note: '반제품 보충' },
      ],
    },
  ]

  for (const plan of plans) {
    const existing = await prisma.productionPlan.findUnique({
      where: { tenantId_planNo: { tenantId: TENANT_ID, planNo: plan.planNo } },
    })
    if (existing) continue

    await prisma.productionPlan.create({
      data: {
        id: plan.id,
        tenantId: TENANT_ID,
        siteId: SITE_FACTORY,
        planNo: plan.planNo,
        planType: plan.planType,
        startDate: plan.startDate,
        endDate: plan.endDate,
        status: plan.status,
        note: plan.note,
        items: {
          create: plan.items.map((item) => ({
            id: item.id,
            itemId: item.itemId,
            bomId: item.bomId,
            routingId: item.routingId,
            plannedQty: item.plannedQty,
            note: item.note,
          })),
        },
      },
    })
  }
}

// ─── 실행 ─────────────────────────────────────────────────────────────────────

main()
  .catch((e) => {
    console.error('시드 실행 중 오류 발생:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
